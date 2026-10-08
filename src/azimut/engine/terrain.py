"""Terrain heights for the relief views: Satellite in 3D and Horizon.

Where the numbers come from. Mapterhorn publishes terrain as terrarium-encoded
512 px WebP tiles built from open data: Copernicus GLO-30 everywhere, national
surveys where they are finer (swissALTI3D, the Austrian and Scandinavian lidar
models...). It needs no key. The planet is complete to z12, about 19 m a pixel at
the equator; deeper levels exist only where a survey published finer data and
answer 404 elsewhere, which here means "use the level above". At z12 and above a
404 is the sea, whose surface is what an eye sees.

When Mapterhorn cannot be reached, the same pixels are asked of AWS's Terrain
Tiles (Mapzen's terrarium set, 256 px): four of its tiles one level deeper are
exactly one of ours, so the fallback needs no resampling. That set carries
bathymetry, which is clamped to the sea surface for the same reason.

Tiles are cached under the workspace with no expiry. Terrain does not change
month to month the way imagery does, and a view reopened offline should still
draw. The cache is bounded by size instead and swept at startup. A tile that does
not exist is remembered too, for a month, so a sea or a missing survey is not
asked about again on every pan.

Everything here is vectorised over numpy arrays of points: the cursor readout
asks for one height, a panorama for millions, and both go through `Sampler`.
"""

from __future__ import annotations

import io
import math
import os
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

from .. import config
from . import tiles

TILE = 512
_SHIFT = 9  # log2(TILE)
# Deepest level every land tile exists at.
PLANET_ZOOM = 12
# Deepest level ever asked for. Regional surveys go to z17, but past z14 (about
# 5 m a pixel) the tiles a near field needs multiply faster than they help.
MAX_ZOOM = 14
EARTH_RADIUS = 6_371_008.8  # mean radius, metres
MAX_LAT = 85.0511287798  # Web Mercator's edge

# A tile known not to exist is asked about again after this long, so a survey
# Mapterhorn adds later is picked up.
NONE_TTL_DAYS = 30
# On-disk budget. A 512 px tile is 80-200 KB, so this holds several thousand:
# far more than any one region needs.
CACHE_BUDGET_BYTES = 1 << 30
# Decoded tiles kept in memory across requests, at 1 MiB each. A panorama
# reads about ninety, so a second one from nearby decodes almost nothing.
DECODED_KEEP = 128
FETCH_WORKERS = 8
# A request of at least this many points is read off one array of its tiles
# laid side by side (`Sampler._sample_mosaic`), up to this many tiles (1 MiB each).
MOSAIC_MIN_POINTS = 4096
MOSAIC_MAX_TILES = 64


@dataclass(frozen=True)
class Source:
    id: str
    label: str
    url: str  # template with {z} {x} {y}
    attribution: str
    link: str


MAPTERHORN = Source(
    id="mapterhorn",
    label="Mapterhorn",
    url="https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
    attribution="© Mapterhorn",
    link="https://mapterhorn.com/attribution",
)
AWS_TERRAIN = Source(
    id="aws-terrain",
    label="AWS Terrain Tiles",
    url="https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    attribution="Terrain Tiles, Mapzen and AWS Open Data",
    link="https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
)
SOURCES = (MAPTERHORN, AWS_TERRAIN)
_BY_ID = {source.id: source for source in SOURCES}

# (content, media type, source id) of a tile that exists.
Fetched = tuple[bytes, str, str]
Key = tuple[int, int, int]


class TerrainUnavailable(Exception):
    """Neither source answered for a tile the view needs."""


# -- fetching and the disk cache ----------------------------------------------

_client_lock = threading.Lock()
_client_instance: httpx.Client | None = None


def _client() -> httpx.Client:
    global _client_instance
    with _client_lock:
        if _client_instance is None:
            _client_instance = httpx.Client(
                follow_redirects=True,
                timeout=tiles.TILE_TIMEOUT,
                limits=httpx.Limits(max_keepalive_connections=FETCH_WORKERS, max_connections=16),
                headers={"User-Agent": tiles.USER_AGENT},
            )
        return _client_instance


def _get(url: str) -> tuple[int, bytes]:
    """Status and body of one GET, asked again on a transient failure.

    Raises `TerrainUnavailable` when the host cannot be reached at all.
    """
    for attempt in range(1, tiles.MAX_TILE_TRIES + 1):
        last = attempt == tiles.MAX_TILE_TRIES
        try:
            response = _client().get(url)
        except httpx.HTTPError as exc:
            if last:
                raise TerrainUnavailable(tiles.upstream_failure(exc)) from exc
            continue
        if response.status_code in tiles.TRANSIENT_STATUSES and not last:
            time.sleep(tiles.RETRY_PAUSE)
            continue
        return response.status_code, response.content
    raise AssertionError("unreachable")  # the loop returns or raises on its last turn


_EXT = {"image/webp": "webp", "image/png": "png"}
_MEDIA = {ext: media for media, ext in _EXT.items()}
_NONE = "none"


def _path(folder: str, z: int, x: int, y: int, ext: str = "") -> Path:
    name = f"{x}_{y}.{ext}" if ext else f"{x}_{y}"
    return config.terrain_cache_dir() / folder / str(z) / name


class _Miss:
    pass


_MISS = _Miss()


def _cached(z: int, x: int, y: int) -> Fetched | None | _Miss:
    """The cached answer for a tile: its bytes, None (known absent), or a miss."""
    for source in SOURCES:
        for ext, media in _MEDIA.items():
            path = _path(source.id, z, x, y, ext)
            try:
                content = path.read_bytes()
            except OSError:
                continue
            try:
                os.utime(path)  # the size sweep evicts least recently read first
            except OSError:
                pass
            return content, media, source.id
    marker = _path(_NONE, z, x, y)
    try:
        if time.time() - marker.stat().st_mtime < NONE_TTL_DAYS * 86400:
            return None
    except OSError:
        pass
    return _MISS


def _store(folder: str, z: int, x: int, y: int, content: bytes, ext: str = "") -> None:
    """Never raises: the cache is an optimisation."""
    path = _path(folder, z, x, y, ext)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    except OSError:
        pass


def known(z: int, x: int, y: int) -> bool:
    """Whether a tile, or its known absence, is on disk already, without reading it."""
    for source in SOURCES:
        for ext in _MEDIA:
            if _path(source.id, z, x, y, ext).is_file():
                return True
    try:
        return time.time() - _path(_NONE, z, x, y).stat().st_mtime < NONE_TTL_DAYS * 86400
    except OSError:
        return False


def tile(z: int, x: int, y: int) -> Fetched | None:
    """One terrain tile of the 512 px grid, or None where there is no data.

    Raises `TerrainUnavailable` when no source can be reached.
    """
    cached = _cached(z, x, y)
    if not isinstance(cached, _Miss):
        return cached
    reason = ""
    try:
        status, content = _get(MAPTERHORN.url.format(z=z, x=x, y=y))
    except TerrainUnavailable as exc:
        status, content, reason = 0, b"", str(exc)
    if status == 200 and content:
        _store(MAPTERHORN.id, z, x, y, content, "webp")
        return content, "image/webp", MAPTERHORN.id
    if status == 404:
        _store(_NONE, z, x, y, b"")
        return None
    # Unreachable, or refusing for a reason of its own: ask the fallback for the
    # same pixels rather than leave a hole in the view.
    composite = _from_aws(z, x, y)
    if composite is None:
        raise TerrainUnavailable(reason or f"terrain tile answered {status}")
    _store(AWS_TERRAIN.id, z, x, y, composite, "png")
    return composite, "image/png", AWS_TERRAIN.id


def _from_aws(z: int, x: int, y: int) -> bytes | None:
    """Our (z, x, y) stitched from AWS's four 256 px tiles one level deeper."""
    heights = np.zeros((TILE, TILE), dtype=np.float32)
    half = TILE // 2
    for dy in (0, 1):
        for dx in (0, 1):
            url = AWS_TERRAIN.url.format(z=z + 1, x=2 * x + dx, y=2 * y + dy)
            try:
                status, content = _get(url)
            except TerrainUnavailable:
                return None
            if status != 200 or not content:
                return None
            quarter = decode(content)
            if quarter.shape != (half, half):
                return None
            heights[dy * half:(dy + 1) * half, dx * half:(dx + 1) * half] = quarter
    # bathymetry: the eye sees the sea surface, not the sea floor
    np.maximum(heights, 0.0, out=heights)
    return encode(heights)


def sweep(budget: int = CACHE_BUDGET_BYTES, now: float | None = None) -> int:
    """Hold the cache under its budget and forget stale "no tile here" markers.

    Evicts the least recently read tiles until the cache is back under 80% of the
    budget, so the next sweep has room to spare. Returns how many files went.
    Never raises: a file another process holds is left for next time.
    """
    root = config.terrain_cache_dir()
    if not root.is_dir():
        return 0
    cutoff = (time.time() if now is None else now) - NONE_TTL_DAYS * 86400
    dropped = 0
    files: list[tuple[float, int, Path]] = []
    for folder, _subfolders, names in os.walk(root):
        for name in names:
            path = Path(folder) / name
            try:
                stat = path.stat()
            except OSError:
                continue
            if path.parent.parent.name == _NONE:
                if stat.st_mtime < cutoff:
                    try:
                        path.unlink()
                        dropped += 1
                    except OSError:
                        pass
                continue
            files.append((stat.st_mtime, stat.st_size, path))
    total = sum(size for _mtime, size, _path_ in files)
    if total <= budget:
        return dropped
    target = budget * 0.8
    for _mtime, size, path in sorted(files):
        if total <= target:
            break
        try:
            path.unlink()
        except OSError:
            continue
        total -= size
        dropped += 1
    return dropped


# -- encoding -------------------------------------------------------------------


def decode(content: bytes) -> np.ndarray:
    """Heights in metres from a terrarium tile (R·256 + G + B/256 − 32768)."""
    try:
        with Image.open(io.BytesIO(content)) as image:
            rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    except OSError as exc:
        raise TerrainUnavailable("a terrain tile could not be read") from exc
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0


def encode(heights: np.ndarray) -> bytes:
    """A lossless terrarium PNG of heights in metres."""
    value = np.clip(np.asarray(heights, dtype=np.float64) + 32768.0, 0.0, 65535.996)
    whole = np.floor(value)
    rgb = np.stack(
        [whole // 256, whole % 256, np.floor((value - whole) * 256.0)], axis=-1
    ).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buffer, format="PNG")
    return buffer.getvalue()


_sea: bytes | None = None


def sea_tile() -> bytes:
    """A flat tile at sea level, for where there is no land to draw."""
    global _sea
    if _sea is None:
        _sea = encode(np.zeros((TILE, TILE), dtype=np.float32))
    return _sea


# -- geometry -------------------------------------------------------------------


def metres_per_pixel(lat: float, zoom: int) -> float:
    return 2 * math.pi * EARTH_RADIUS * math.cos(math.radians(lat)) / (TILE << zoom)


def zoom_for(metres: float, lat: float, ceiling: int = MAX_ZOOM) -> int:
    """The coarsest level whose pixel is no larger than `metres`."""
    for zoom in range(0, ceiling + 1):
        if metres_per_pixel(lat, zoom) <= metres:
            return zoom
    return ceiling


def destination(
    lat: np.ndarray | float, lon: np.ndarray | float,
    bearing: np.ndarray | float, distance: np.ndarray | float,
) -> tuple[np.ndarray, np.ndarray]:
    """Points `distance` metres from (lat, lon) along `bearing` degrees, on the sphere."""
    phi = np.radians(lat)
    theta = np.radians(bearing)
    delta = np.asarray(distance, dtype=np.float64) / EARTH_RADIUS
    sin_phi2 = np.sin(phi) * np.cos(delta) + np.cos(phi) * np.sin(delta) * np.cos(theta)
    phi2 = np.arcsin(np.clip(sin_phi2, -1.0, 1.0))
    lam = np.radians(lon) + np.arctan2(
        np.sin(theta) * np.sin(delta) * np.cos(phi), np.cos(delta) - np.sin(phi) * sin_phi2
    )
    return np.degrees(phi2), (np.degrees(lam) + 540.0) % 360.0 - 180.0


def distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS * math.asin(min(1.0, math.sqrt(h)))


def bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing from the first point to the second, in degrees."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return math.degrees(math.atan2(y, x)) % 360.0


def _pixels(lat: np.ndarray, lon: np.ndarray, zoom: int) -> tuple[np.ndarray, np.ndarray]:
    """Global pixel coordinates at `zoom`, measured from pixel centres."""
    world = float(TILE << zoom)
    sin = np.sin(np.radians(np.clip(lat, -MAX_LAT, MAX_LAT)))
    px = (lon + 180.0) / 360.0 * world - 0.5
    py = (0.5 - np.log((1 + sin) / (1 - sin)) / (4 * math.pi)) * world - 0.5
    return px, py


# -- sampling -------------------------------------------------------------------

_decoded_lock = threading.Lock()
# key -> (heights or None for "no tile", source id)
_decoded: OrderedDict[Key, tuple[np.ndarray | None, str]] = OrderedDict()


def _remember(key: Key, value: tuple[np.ndarray | None, str]) -> None:
    with _decoded_lock:
        _decoded[key] = value
        _decoded.move_to_end(key)
        while len(_decoded) > DECODED_KEEP:
            _decoded.popitem(last=False)


def _recall(key: Key) -> tuple[np.ndarray | None, str] | None:
    with _decoded_lock:
        value = _decoded.get(key)
        if value is not None:
            _decoded.move_to_end(key)
        return value


def forget_decoded() -> None:
    with _decoded_lock:
        _decoded.clear()


@dataclass
class Sampler:
    """Heights at many points at once, read from the tiles they fall in.

    One sampler serves one computation: it holds every tile it loaded until it
    goes, so a panorama never reloads a tile the shared memory cache dropped
    halfway through. `sources` and `zooms` record what actually answered, which
    is what a saved view states about its terrain.

    `fetch` is the tile source; the default reads the cache and the network. A
    sampler given its own keeps away from the shared memory cache, so tests and
    real views never see each other's tiles.
    """

    fetch: Callable[[int, int, int], Fetched | None] | None = None
    sources: set[str] = field(default_factory=set)
    zooms: set[int] = field(default_factory=set)
    _held: dict[Key, np.ndarray | None] = field(default_factory=dict)

    def heights(
        self, lat: np.ndarray | float, lon: np.ndarray | float, zoom: int
    ) -> np.ndarray:
        """Bilinear heights in metres, at `zoom` or the deepest level above it that exists."""
        lat_a, lon_a = np.broadcast_arrays(
            np.asarray(lat, dtype=np.float64), np.asarray(lon, dtype=np.float64)
        )
        shape = lat_a.shape
        flat_lat, flat_lon = lat_a.ravel(), lon_a.ravel()
        out = np.zeros(flat_lat.size, dtype=np.float32)
        if flat_lat.size:
            self._sample(flat_lat, flat_lon, max(0, min(zoom, MAX_ZOOM)), out,
                         np.arange(flat_lat.size))
        return out.reshape(shape)

    def _sample(
        self, lat: np.ndarray, lon: np.ndarray, zoom: int, out: np.ndarray, where: np.ndarray
    ) -> None:
        world = TILE << zoom
        px, py = _pixels(lat, lon, zoom)
        x0 = np.floor(px).astype(np.int64)
        y0 = np.floor(py).astype(np.int64)
        fx = (px - x0).astype(np.float32)
        fy = (py - y0).astype(np.float32)
        ya, yb = np.clip(y0, 0, world - 1), np.clip(y0 + 1, 0, world - 1)
        if self._sample_mosaic(x0, ya, yb, fx, fy, zoom, out, where, lat, lon):
            return
        xa, xb = x0 % world, (x0 + 1) % world
        gx = np.concatenate([xa, xb, xa, xb])
        gy = np.concatenate([ya, ya, yb, yb])
        tiles_across = 1 << zoom
        keys = (gx >> _SHIFT) * tiles_across + (gy >> _SHIFT)
        self._load(zoom, np.unique(keys), tiles_across)

        values = np.zeros(gx.size, dtype=np.float32)
        absent = np.zeros(gx.size, dtype=bool)
        order = np.argsort(keys, kind="stable")
        starts = np.flatnonzero(np.diff(keys[order])) + 1
        for segment in np.split(order, starts):
            key = int(keys[segment[0]])
            heights = self._held[(zoom, key // tiles_across, key % tiles_across)]
            if heights is None:
                if zoom > PLANET_ZOOM:
                    absent[segment] = True  # no survey this deep here: climb a level
                # else: the sea, at zero
                continue
            values[segment] = heights[gy[segment] & (TILE - 1), gx[segment] & (TILE - 1)]

        count = lat.size
        v = values.reshape(4, count)
        climb = absent.reshape(4, count).any(axis=0)
        blended = (v[0] * (1 - fx) + v[1] * fx) * (1 - fy) + (v[2] * (1 - fx) + v[3] * fx) * fy
        keep = ~climb
        if keep.any():
            out[where[keep]] = blended[keep]
            self.zooms.add(zoom)
        if climb.any():
            self._sample(lat[climb], lon[climb], zoom - 1, out, where[climb])

    def _sample_mosaic(
        self, x0: np.ndarray, ya: np.ndarray, yb: np.ndarray, fx: np.ndarray, fy: np.ndarray,
        zoom: int, out: np.ndarray, where: np.ndarray, lat: np.ndarray, lon: np.ndarray,
    ) -> bool:
        """The same bilinear read off one array holding every tile the points touch.

        A request of many points (a band of a panorama: thousands of rays at
        one level) touches a dozen tiles. Laying those side by side once makes
        each of the four neighbours a single gather, where grouping the points
        tile by tile costs a sort of all of them. Declines, returning False, for
        a handful of points, for points across the antimeridian, and for a
        spread too wide to lay out, which the tile-by-tile read then takes.
        """
        world = TILE << zoom
        if x0.size < MOSAIC_MIN_POINTS or x0.min() < 0 or x0.max() + 1 >= world:
            return False
        tx_lo, tx_hi = int(x0.min()) >> _SHIFT, (int(x0.max()) + 1) >> _SHIFT
        ty_lo, ty_hi = int(ya.min()) >> _SHIFT, int(yb.max()) >> _SHIFT
        nx, ny = tx_hi - tx_lo + 1, ty_hi - ty_lo + 1
        if nx * ny > MOSAIC_MAX_TILES:
            return False
        # local pixel coordinates, and the tiles the four neighbours fall in
        lx0 = x0 - tx_lo * TILE
        lx1 = lx0 + 1
        ly0 = ya - ty_lo * TILE
        ly1 = yb - ty_lo * TILE
        cells = [
            (ly >> _SHIFT) * nx + (lx >> _SHIFT)
            for ly in (ly0, ly1) for lx in (lx0, lx1)
        ]
        touched = np.zeros(nx * ny, dtype=bool)
        for neighbour in cells:
            touched[neighbour] = True
        used = np.flatnonzero(touched)
        tiles_across = 1 << zoom
        self._load(zoom, (tx_lo + used % nx) * tiles_across + (ty_lo + used // nx), tiles_across)

        mosaic = np.zeros((ny * TILE, nx * TILE), dtype=np.float32)
        absent = np.zeros((ny, nx), dtype=bool)
        for slot in used:
            row, column = divmod(int(slot), nx)
            heights = self._held[(zoom, tx_lo + column, ty_lo + row)]
            if heights is None:
                absent[row, column] = True  # the sea at zero, or no survey this deep
            else:
                mosaic[row * TILE:(row + 1) * TILE, column * TILE:(column + 1) * TILE] = heights

        v00 = mosaic[ly0, lx0]
        v01 = mosaic[ly0, lx1]
        v10 = mosaic[ly1, lx0]
        v11 = mosaic[ly1, lx1]
        blended = (v00 * (1 - fx) + v01 * fx) * (1 - fy) + (v10 * (1 - fx) + v11 * fx) * fy
        if zoom > PLANET_ZOOM and absent.any():
            flat = absent.ravel()
            climb = flat[cells[0]] | flat[cells[1]] | flat[cells[2]] | flat[cells[3]]
        else:
            climb = None
        if climb is None or not climb.any():
            out[where] = blended
            self.zooms.add(zoom)
            return True
        keep = ~climb
        if keep.any():
            out[where[keep]] = blended[keep]
            self.zooms.add(zoom)
        self._sample(lat[climb], lon[climb], zoom - 1, out, where[climb])
        return True

    def _load(self, zoom: int, keys: np.ndarray, tiles_across: int) -> None:
        wanted = [(zoom, int(k) // tiles_across, int(k) % tiles_across) for k in keys]
        missing = [key for key in wanted if key not in self._held]
        if not missing:
            return
        shared = self.fetch is None
        to_fetch: list[Key] = []
        for key in missing:
            remembered = _recall(key) if shared else None
            if remembered is None:
                to_fetch.append(key)
            else:
                self._held[key] = remembered[0]
                if remembered[0] is not None:
                    self.sources.add(remembered[1])
        if not to_fetch:
            return
        fetch = self.fetch or tile

        def one(key: Key) -> tuple[Key, np.ndarray | None, str]:
            fetched = fetch(*key)
            if fetched is None:
                return key, None, ""
            heights = decode(fetched[0])
            if heights.shape != (TILE, TILE):
                raise TerrainUnavailable("a terrain tile came in an unexpected size")
            return key, heights, fetched[2]

        if len(to_fetch) == 1:
            results = [one(to_fetch[0])]
        else:
            with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
                results = list(pool.map(one, to_fetch))
        for key, heights, source in results:
            self._held[key] = heights
            if heights is not None:
                self.sources.add(source)
            if shared:
                _remember(key, (heights, source))

    def credits(self) -> list[dict[str, str]]:
        """Who to credit for the heights this sampler read."""
        return [
            {"label": s.label, "attribution": s.attribution, "link": s.link}
            for s in SOURCES if s.id in self.sources
        ]

    def resolution(self, lat: float) -> float | None:
        """Ground size of the finest pixel that answered, in metres."""
        return round(metres_per_pixel(lat, max(self.zooms)), 1) if self.zooms else None


def source(source_id: str) -> Source:
    return _BY_ID[source_id]


# -- the questions the API asks ------------------------------------------------


def elevation_at(lat: float, lon: float, sampler: Sampler | None = None) -> tuple[float, Sampler]:
    """Height of one point, from the finest level that covers it."""
    sampler = sampler or Sampler()
    height = float(sampler.heights(lat, lon, MAX_ZOOM))
    return height, sampler


def profile(
    points: Sequence[tuple[float, float]], samples: int, sampler: Sampler | None = None
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, Sampler]:
    """Heights at `samples` evenly spaced points along a path of (lat, lon) vertices.

    Returns the distance of each sample from the start in metres, its latitude,
    longitude and height. The level read has two pixels to a spacing, enough
    that a summit between two samples is not flattened, while a 300 km profile
    still does not fetch street-scale tiles.
    """
    if len(points) < 2:
        raise ValueError("a profile needs two points")
    sampler = sampler or Sampler()
    legs = [distance(*points[i], *points[i + 1]) for i in range(len(points) - 1)]
    total = sum(legs)
    along = np.linspace(0.0, total, samples)
    lat = np.empty(samples)
    lon = np.empty(samples)
    start = 0.0
    for i, leg in enumerate(legs):
        last = i == len(legs) - 1
        mask = (along >= start) & ((along <= start + leg) if last else (along < start + leg))
        if mask.any():
            heading = bearing(*points[i], *points[i + 1])
            lat[mask], lon[mask] = destination(
                points[i][0], points[i][1], heading, along[mask] - start
            )
        start += leg
    mid_lat = float(np.mean([p[0] for p in points]))
    zoom = zoom_for(max(total / max(samples - 1, 1) / 2, 1.0), mid_lat)
    heights = sampler.heights(lat, lon, zoom)
    return along, lat, lon, heights, sampler
