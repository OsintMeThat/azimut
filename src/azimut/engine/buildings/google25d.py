"""Building heights from Google's Open Buildings 2.5D Temporal rasters.

Google publishes, for Africa, South and South-East Asia, Latin America and the
Caribbean, one raster a year (2016 to 2023) of where buildings stand and how
tall they are: heights about 1.5 m off on average, capped at 100 m, in 0.5 m
pixels that tell apart 4 m. They are Cloud-Optimised GeoTIFFs of 12.5 km
squares in UTM, often hundreds of megabytes each, in a public bucket listed by
manifests (one per S2 cell, UTM zone and year). Licence CC BY 4.0 (or ODbL, the
user's choice).

Nobody downloads a whole raster: each tile reads, over HTTP ranges, only the
blocks of the raster's 2 m overview that cover it (engine/cog.py), about 6 MB a
z14 tile. Reading at 2 m changes a footprint's height by 0.14 m at the median
(0.34 m for nine in ten, measured over 3,400 houses in Caracas) against the
full 0.5 m pixels, which are four times finer than what the model can tell.

They lend heights, not footprints: each footprint the merge draws is looked up
in the latest year's raster, and takes the median height of the pixels inside
it that the raster calls a building (the pixel under its middle for a house
smaller than one). A footprint over no such pixel takes nothing, rather than a
height read off its neighbours.

What reaches the network, and when. The manifests of the eye's UTM zone are
read once the analyst switches buildings on, and kept; the rasters' blocks only
after the analyst has agreed to the area's estimated size (buildings/service.py
asks), and each tile's are kept.
"""

from __future__ import annotations

import json
import logging
import math
import os
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
import numpy as np

from .. import tiles, utm
from . import model
from .model import Building, BuildingsUnavailable

logger = logging.getLogger(__name__)

SOURCE = "google"
LABEL = "Open Buildings 2.5D (Google)"
LICENCE = "CC BY 4.0"
LINK = "https://sites.research.google/gr/open-buildings/temporal"
# the latest year published, and the date its rasters stand for
YEAR = "2023"
STAMP = "2023_06_30"
BUCKET = "open-buildings-temporal-data"
LISTING = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o"
MEDIA = f"https://storage.googleapis.com/{BUCKET}/"
# the list of manifests is read again after this, should Google add a year or a region
LIST_TTL_DAYS = 90
TIMEOUT = httpx.Timeout(30.0, read=120.0)
CHUNK = 1 << 20
# A pixel is a building where the raster's presence reaches this
PRESENCE = 0.5


@dataclass(frozen=True)
class Raster:
    """One GeoTIFF: its path in the bucket, its UTM code, and its bounds there."""

    name: str
    epsg: int
    west: float
    south: float
    east: float
    north: float
    size: int = 0


def _root() -> Path:
    return model.cache_root() / SOURCE


def _client() -> httpx.Client:
    return httpx.Client(follow_redirects=True, timeout=TIMEOUT, headers={"User-Agent": tiles.USER_AGENT})


def _get_json(url: str) -> object:
    for attempt in range(1, tiles.MAX_TILE_TRIES + 1):
        last = attempt == tiles.MAX_TILE_TRIES
        try:
            with _client() as client:
                response = client.get(url)
        except httpx.HTTPError as exc:
            if last:
                raise BuildingsUnavailable(
                    f"Google's building heights could not be read just now ({tiles.upstream_failure(exc)})"
                ) from exc
            continue
        if response.status_code in tiles.TRANSIENT_STATUSES and not last:
            time.sleep(tiles.RETRY_PAUSE)
            continue
        if response.status_code != 200:
            raise BuildingsUnavailable(f"Google's building heights could not be read just now (HTTP {response.status_code})")
        try:
            return response.json()
        except ValueError as exc:
            raise BuildingsUnavailable("Google sent something other than JSON") from exc
    raise AssertionError("unreachable")


# -- which rasters cover a tile --------------------------------------------------------

_lock = threading.Lock()
_manifests: dict[str, list[Raster]] = {}
# bytes read so far for the tiles being read, for the progress the view shows
_received_lock = threading.Lock()
_received: dict[tuple[int, int, int], int] = {}


def _manifest_names() -> list[str]:
    """The latest year's manifests, read from the bucket's listing and kept a while."""
    kept = _root() / "manifests.json"
    try:
        if time.time() - kept.stat().st_mtime < LIST_TTL_DAYS * 86400:
            names = json.loads(kept.read_text(encoding="utf-8"))
            if isinstance(names, list):
                return [str(n) for n in names]
    except (OSError, ValueError):
        pass
    found: list[str] = []
    token = ""
    for _page in range(50):
        url = f"{LISTING}?prefix=v1/manifests/&fields=items(name),nextPageToken&maxResults=1000"
        if token:
            url += f"&pageToken={quote(token)}"
        page = _get_json(url)
        # a listing without items is no answer to keep: asked again next time
        if not isinstance(page, dict) or not isinstance(page.get("items"), list):
            raise BuildingsUnavailable("Google's bucket sent a listing without its files")
        found += [item["name"] for item in page["items"] if STAMP in item.get("name", "")]
        token = page.get("nextPageToken") or ""
        if not token:
            break
    if not found:
        raise BuildingsUnavailable(f"Google's bucket lists no rasters for {YEAR} just now")
    _write(kept, json.dumps(sorted(found)).encode("utf-8"))
    return sorted(found)


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(f"{path.name}.{uuid.uuid4().hex}.part")
    try:
        part.write_bytes(data)
        os.replace(part, path)
    finally:
        part.unlink(missing_ok=True)


def _parse_manifest(manifest: dict, epsg: int) -> list[Raster]:
    prefix = str(manifest.get("uriPrefix", "")).replace(f"gs://{BUCKET}/", "")
    out = []
    for tileset in manifest.get("tilesets", []):
        for source in tileset.get("sources", []):
            try:
                uri = source["uris"][0]
                t = source["affineTransform"]
                d = source["dimensions"]
                x0, y0 = float(t["translateX"]), float(t["translateY"])
                x1 = x0 + float(t["scaleX"]) * int(d["width"])
                y1 = y0 + float(t["scaleY"]) * int(d["height"])
            except (KeyError, IndexError, TypeError, ValueError):
                continue
            out.append(Raster(prefix + uri, epsg, min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)))
    return out


def _zone_rasters(epsg: int) -> list[Raster]:
    """Every raster of the latest year in one UTM zone, from its manifests, each read once and kept."""
    with _lock:
        hit = _manifests.get(str(epsg))
    if hit is not None:
        return hit
    found: list[Raster] = []
    for name in _manifest_names():
        if f"_EPSG_{epsg}_" not in name:
            continue
        kept = _root() / "manifests" / Path(name).name
        try:
            manifest = json.loads(kept.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            manifest = _get_json(MEDIA + name)
            _write(kept, json.dumps(manifest).encode("utf-8"))
        if isinstance(manifest, dict):
            found += _parse_manifest(manifest, epsg)
    with _lock:
        _manifests[str(epsg)] = found
    return found


def _tile_box(z: int, x: int, y: int, epsg: int) -> tuple[float, float, float, float]:
    west, south, east, north = model.tile_bounds(z, x, y)
    zone, south_zone = epsg % 100, epsg >= 32700
    lats = np.array([south, south, north, north, (south + north) / 2])
    lons = np.array([west, east, west, east, (west + east) / 2])
    ux, uy = utm.forward(lats, lons, zone, south_zone)
    return float(ux.min()), float(uy.min()), float(ux.max()), float(uy.max())


def _sizes_path(z: int, x: int, y: int) -> Path:
    return _root() / "tiles" / str(z) / str(x) / f"{y}.json"


def cached_rasters(z: int, x: int, y: int) -> list[Raster] | None:
    """The rasters a tile needs, as found earlier; None when not looked up yet."""
    try:
        rows = json.loads(_sizes_path(z, x, y).read_text(encoding="utf-8"))
        return [Raster(**row) for row in rows]
    except (OSError, ValueError, TypeError):
        return None


def resolve_tile(z: int, x: int, y: int) -> list[Raster]:
    """The rasters that cover a tile: network, the first time a UTM zone is asked."""
    west, south, east, north = model.tile_bounds(z, x, y)
    zone, south_zone = utm.zone_of((south + north) / 2, (west + east) / 2)
    epsg = utm.epsg_of(zone, south_zone)
    x0, y0, x1, y1 = _tile_box(z, x, y, epsg)
    found = [r for r in _zone_rasters(epsg) if r.west < x1 and r.east > x0 and r.south < y1 and r.north > y0]
    _write(_sizes_path(z, x, y), json.dumps([r.__dict__ for r in found]).encode("utf-8"))
    return found


# -- reading a tile's heights ---------------------------------------------------------

# Metres a pixel of the overview read: twice the model's own resolution
PIXEL = 2.0
# What one tile's blocks weigh, about, for the question before they are read
TILE_BYTES = 6_500_000
_http_lock = threading.Lock()
_http: httpx.Client | None = None


def _range_reader(name: str) -> Callable[[int, int], bytes]:
    """Bytes of one raster in the bucket, read over HTTP ranges with one shared client."""

    def read(offset: int, length: int) -> bytes:
        global _http
        with _http_lock:
            if _http is None:
                _http = httpx.Client(follow_redirects=True, timeout=TIMEOUT, headers={"User-Agent": tiles.USER_AGENT})
            client = _http
        headers = {"Range": f"bytes={offset}-{offset + length - 1}"}
        for attempt in range(1, tiles.MAX_TILE_TRIES + 1):
            last = attempt == tiles.MAX_TILE_TRIES
            try:
                response = client.get(MEDIA + name, headers=headers)
            except httpx.HTTPError as exc:
                if last:
                    raise BuildingsUnavailable(
                        f"Google's building heights could not be read just now ({tiles.upstream_failure(exc)})"
                    ) from exc
                continue
            if response.status_code in tiles.TRANSIENT_STATUSES and not last:
                time.sleep(tiles.RETRY_PAUSE)
                continue
            if response.status_code == 206:
                return response.content
            if response.status_code == 200:
                return response.content[offset:offset + length]
            raise BuildingsUnavailable(f"Google answered HTTP {response.status_code} for a height raster")
        raise AssertionError("unreachable")

    return read


def _grid_path(z: int, x: int, y: int) -> Path:
    return _root() / "grids" / str(z) / str(x) / f"{y}.npz"


def fetch_tile(z: int, x: int, y: int) -> int:
    """Read and keep the heights over one tile from every raster that covers it; the count of rasters read."""
    from .. import cog

    rasters = cached_rasters(z, x, y)
    if rasters is None:
        rasters = resolve_tile(z, x, y)
    try:
        return _fetch_rasters(z, x, y, rasters, cog)
    finally:
        with _received_lock:
            _received.pop((z, x, y), None)


def received(z: int, x: int, y: int) -> int:
    """The bytes read so far for a tile whose heights are being read."""
    with _received_lock:
        return _received.get((z, x, y), 0)


def _counted(z: int, x: int, y: int, read: Callable[[int, int], bytes]) -> Callable[[int, int], bytes]:
    def counting(offset: int, length: int) -> bytes:
        body = read(offset, length)
        with _received_lock:
            _received[(z, x, y)] = _received.get((z, x, y), 0) + len(body)
        return body

    return counting


def _fetch_rasters(z: int, x: int, y: int, rasters: list[Any], cog: Any) -> int:
    parts: dict[str, np.ndarray] = {}
    for n, raster in enumerate(rasters):
        try:
            tiff = cog.GeoTiff(_counted(z, x, y, _range_reader(raster.name)), PIXEL)
        except ValueError as exc:
            raise BuildingsUnavailable(f"A Google height raster could not be read ({exc})") from exc
        names = [b.lower() for b in tiff.band_names]
        presence = next((i for i, b in enumerate(names) if "presence" in b), 2)
        height = next((i for i, b in enumerate(names) if "height" in b), 1)
        origin_x, pixel_x, origin_y, pixel_y = tiff.transform
        x0, y0, x1, y1 = _tile_box(z, x, y, raster.epsg)
        c0 = max(0, int(math.floor((x0 - origin_x) / pixel_x)) - 2)
        c1 = min(tiff.width, int(math.ceil((x1 - origin_x) / pixel_x)) + 2)
        r0 = max(0, int(math.floor((y1 - origin_y) / pixel_y)) - 2)
        r1 = min(tiff.height, int(math.ceil((y0 - origin_y) / pixel_y)) + 2)
        if c1 <= c0 or r1 <= r0:
            continue
        try:
            here = tiff.window(presence, c0, r0, c1, r1)
            tall = tiff.window(height, c0, r0, c1, r1)
        except ValueError as exc:
            raise BuildingsUnavailable(f"A Google height raster could not be read ({exc})") from exc
        # kept small: heights in decimetres, presence in two-hundredths
        built = np.isfinite(here) & np.isfinite(tall) & (here >= PRESENCE) & (tall > 0)
        parts[f"h{n}"] = np.where(built, np.clip(np.round(np.nan_to_num(tall) * 10), 0, 65535), 0).astype(np.uint16)
        parts[f"t{n}"] = np.array(
            [raster.epsg, origin_x + c0 * pixel_x, pixel_x, origin_y + r0 * pixel_y, pixel_y], dtype=np.float64
        )
    path = _grid_path(z, x, y)
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(f"{path.name}.{uuid.uuid4().hex}.part")
    try:
        with part.open("wb") as out:
            np.savez_compressed(out, **parts)  # type: ignore[arg-type]  # numpy types the keywords as allow_pickle
        os.replace(part, path)
    finally:
        part.unlink(missing_ok=True)
    return len(rasters)


def has_tile(z: int, x: int, y: int) -> float | None:
    """When a tile's heights were kept, or None when they were not."""
    try:
        return _grid_path(z, x, y).stat().st_mtime
    except OSError:
        return None


def sampler(z: int, x: int, y: int) -> Callable[[list[Building]], list[float | None]]:
    """Footprints' heights from a tile's kept heights, all asked at once: the median of each
    one's building pixels, or None."""
    grids = []
    try:
        with np.load(_grid_path(z, x, y)) as data:
            for key in sorted(k for k in data.files if k.startswith("h")):
                grids.append((data[key], data["t" + key[1:]]))
    except (OSError, ValueError, KeyError) as exc:
        logger.info("Google heights for tile %s: %s", (z, x, y), exc)

    def heights_of(buildings: list[Building]) -> list[float | None]:
        found: list[float | None] = [None] * len(buildings)
        if not grids or not buildings:
            return found
        rings = [np.asarray(b.rings[0], dtype=np.float64) for b in buildings]
        bounds = np.cumsum([0] + [len(r) for r in rings])
        points = np.concatenate(rings)
        starts = bounds[:-1]
        # a footprint is answered by the first raster it lies in, even with nothing
        answered = np.zeros(len(buildings), dtype=bool)
        for heights, (epsg, origin_x, pixel_x, origin_y, pixel_y) in grids:
            ux, uy = utm.forward(points[:, 1], points[:, 0], int(epsg) % 100, int(epsg) >= 32700)
            cols = (ux - origin_x) / pixel_x
            rows = (uy - origin_y) / pixel_y
            tall, wide = heights.shape
            within = (
                (np.minimum.reduceat(cols, starts) >= 0) & (np.minimum.reduceat(rows, starts) >= 0)
                & (np.maximum.reduceat(cols, starts) <= wide) & (np.maximum.reduceat(rows, starts) <= tall)
            )
            take = within & ~answered
            if not take.any():
                continue
            medians = _medians(heights, cols, rows, bounds, take)
            for i in np.flatnonzero(take):
                found[i] = None if math.isnan(medians[i]) else round(float(medians[i]) / 10, 1)
            answered |= take
        return found

    return heights_of


def grid_files() -> list[Path]:
    root = _root() / "grids"
    return list(root.rglob("*.npz")) if root.is_dir() else []


# -- finding the building pixels -------------------------------------------------------


def _medians(heights: np.ndarray, cols: np.ndarray, rows: np.ndarray, bounds: np.ndarray, take: np.ndarray) -> np.ndarray:
    """Each taken footprint's median building pixel, NaN for none: every ring, in pixel
    coordinates one after the other (`bounds`), filled at once by scanlines.

    A pixel is a footprint's when its centre lies inside the ring (even-odd); a footprint
    with no building pixel inside, a house smaller than a pixel, takes the pixel under its
    middle."""
    tall, wide = heights.shape
    count = np.diff(bounds)
    owner = np.repeat(np.arange(len(count)), count)
    following = np.arange(len(cols)) + 1
    following[bounds[1:] - 1] = bounds[:-1]  # each ring closes on its first corner
    edge = take[owner]
    ax, ay, lab = cols[edge], rows[edge], owner[edge]
    bx, by = cols[following][edge], rows[following][edge]

    # where each edge crosses the rows of pixel centres it spans: [low, high)
    first = np.ceil(np.minimum(ay, by) - 0.5).astype(np.int64)
    rows_crossed = np.maximum(np.ceil(np.maximum(ay, by) - 0.5).astype(np.int64) - first, 0)
    e = np.repeat(np.arange(len(ax)), rows_crossed)
    r = first[e] + np.arange(len(e)) - np.repeat(np.cumsum(rows_crossed) - rows_crossed, rows_crossed)
    x = ax[e] + (r + 0.5 - ay[e]) * (bx[e] - ax[e]) / (by[e] - ay[e])
    who = lab[e]
    order = np.lexsort((x, r, who))
    x, r, who = x[order], r[order], who[order]
    # a closed ring crosses each row an even number of times: the pixels between pairs are inside
    x0, x1, r, who = x[0::2], x[1::2], r[0::2], who[0::2]
    left = np.clip(np.ceil(x0 - 0.5).astype(np.int64), 0, wide)
    right = np.clip(np.ceil(x1 - 0.5).astype(np.int64), 0, wide)
    span = np.where((r >= 0) & (r < tall), np.maximum(right - left, 0), 0)
    s = np.repeat(np.arange(len(span)), span)
    c = left[s] + np.arange(len(s)) - np.repeat(np.cumsum(span) - span, span)
    h, who = heights[r[s], c], who[s]
    built = h > 0
    h, who = h[built], who[built]

    medians = np.full(len(count), np.nan)
    if len(h):
        order = np.lexsort((h, who))
        h, who = h[order], who[order]
        names, at, n = np.unique(who, return_index=True, return_counts=True)
        medians[names] = (h[at + (n - 1) // 2].astype(np.float64) + h[at + n // 2]) / 2
    small = take & np.isnan(medians)
    if small.any():
        cy = (np.add.reduceat(rows, bounds[:-1]) / count).astype(np.int64)
        cx = (np.add.reduceat(cols, bounds[:-1]) / count).astype(np.int64)
        small &= (cy >= 0) & (cy < tall) & (cx >= 0) & (cx < wide)
        under = heights[cy[small], cx[small]].astype(np.float64)
        medians[np.flatnonzero(small)] = np.where(under > 0, under, np.nan)
    return medians
