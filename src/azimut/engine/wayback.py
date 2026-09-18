"""Esri World Imagery Wayback: every published release of World Imagery, dated.

Esri republishes World Imagery a few times a month and keeps each release
online under its own number. That archive is what answers "what did this place
look like before", key-less, from the same imagery the default basemap already
shows. Three services make it up, and all three are asked only once the analyst
picks the basemap or opens its picker (local-first):

- **The release list** (`CONFIG_URL`), one JSON document naming every release,
  its publication date and its metadata service.
- **The tilemap**, which answers for one tile and one release which release
  that tile's pixels were actually published in. Walking it backwards shortlists
  the releases that touched a point without reading every release, the same walk
  Esri's own Wayback app makes. It answers in bytes, not in ground, so the
  shortlist is then settled on the pixels: one tile per candidate, compared.
- **The metadata service** of each release, which says when the pixels under a
  point were acquired and by which sensor. A release date is when Esri
  published the mosaic, which can be years after the picture was taken.

A release rides on the provider id as a variant, `esri-wayback~64776`, the way
a Sentinel-2 window does (engine/sentinel.py). So the tile proxy, the disk
cache and a capture's provenance all key on the release the pixels came from.
Release tiles never change once published, which is why caching them is safe.
"""

from __future__ import annotations

import hashlib
import io
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

import httpx
import numpy as np
from PIL import Image

BASE_ID = "esri-wayback"
VARIANT_SEP = "~"

CONFIG_URL = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json"
_SERVICE = "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery"
# {release} is filled per variant; {z}/{y}/{x} stay for tiles.tile_url.
TILE_TEMPLATE = _SERVICE + "/WMTS/1.0.0/default028mm/MapServer/tile/{release}/{{z}}/{{y}}/{{x}}"
TILEMAP_URL = _SERVICE + "/MapServer/tilemap/{release}/{z}/{row}/{col}"
USER_AGENT = "Azimut/0.1 (+local OSINT workbench; single-user)"

# The list names a metadata service per release. It is fetched from a bucket
# and then asked questions server-side, so only the one host Esri uses, in the
# one shape it uses, is ever followed.
_METADATA_RE = re.compile(
    r"^https://metadata\.maptiles\.arcgis\.com/arcgis/rest/services/"
    r"World_Imagery_Metadata_[A-Za-z0-9_]{1,40}/MapServer$"
)
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
# A release number is a URL path segment and a cache directory name: digits only.
_RELEASE_RE = re.compile(r"^[0-9]{1,9}$")

# The list changes a few times a month, so a session does not need to re-read it.
LIST_TTL_S = 6 * 3600
# The walk takes one small request per change it finds. A point with more than
# this many distinct pictures in a decade is not one anybody reads a list of.
MAX_STEPS = 80
# The metadata service has fourteen sub-layers, one per level of detail: layer 0
# describes zoom 23 and layer 13 everything from zoom 10 out.
_METADATA_MAX_ZOOM = 23
_METADATA_LAST_LAYER = 13
# How many metadata questions go out side by side during a walk.
METADATA_WORKERS = 12
# …and how many tiles, which the walk reads one per candidate release.
TILE_WORKERS = 8
# Tiles are asked for at the view zoom, and World Imagery is offered to z19.
MAX_ZOOM = 19

# A tile is compared as a 32x32 grey thumbnail: eight pixels of the tile to a
# cell, which is past JPEG's own noise and still fine enough to see a building.
_THUMB_SIDE = 32
# The cells are standardised — mean nought, spread one — before they are
# compared, so a release that only re-toned one acquisition compares equal to
# it. What is left is structure, and these two say how much of it may differ
# and still be the same picture: a cell counts as unchanged within this much of
# the tile's own spread…
_CELL_TOLERANCE = 0.7
# …and this much of the thumbnail may exceed it. Five cells of 1024 is a patch
# some 7% of the tile across — at the zoom a walk runs at, a roof. Measured
# against re-encoding, sharpening and a hard gamma over one acquisition, none
# of which reaches half of it, and a new roof, which passes it twice over.
_CHANGED_CELLS = 0.005
# Below this spread a tile carries no structure — open sea, cloud, no data —
# and standardising it would stretch sensor noise into structure.
_FLAT_SPREAD = 4.0


@dataclass(frozen=True)
class Release:
    number: int
    date: str  # publication date, YYYY-MM-DD
    metadata_url: str | None


def parse_config(data: Any) -> list[Release]:
    """The release list, newest first. Entries in any other shape are skipped."""
    found: list[Release] = []
    if not isinstance(data, dict):
        return found
    for key, entry in data.items():
        if not isinstance(key, str) or not _RELEASE_RE.match(key) or not isinstance(entry, dict):
            continue
        match = _DATE_RE.search(str(entry.get("itemTitle") or ""))
        if not match:
            continue
        metadata = str(entry.get("metadataLayerUrl") or "")
        found.append(
            Release(
                number=int(key),
                date=match.group(0),
                metadata_url=metadata if _METADATA_RE.match(metadata) else None,
            )
        )
    # Release numbers are not in date order, so the date sorts and the number
    # only breaks a tie.
    found.sort(key=lambda release: (release.date, release.number), reverse=True)
    return found


_lock = threading.Lock()
_listed: tuple[float, list[Release]] | None = None
_changes: dict[tuple[int, int, int, int], list["Change"]] = {}


def reset() -> None:
    """Forget what this session read. For tests, and nothing else."""
    global _listed
    with _lock:
        _listed = None
        _changes.clear()


def _get(url: str, **kwargs: Any) -> httpx.Response:
    return httpx.get(
        url, headers={"User-Agent": USER_AGENT}, timeout=15, follow_redirects=True, **kwargs
    )


def releases(*, get: Callable[..., Any] | None = None) -> list[Release]:
    """Every release, newest first, read once per `LIST_TTL_S`.

    Raises when the list cannot be read and nothing was read before it.
    """
    global _listed
    with _lock:
        if _listed and time.monotonic() - _listed[0] < LIST_TTL_S:
            return _listed[1]
    response = (get or _get)(CONFIG_URL)
    response.raise_for_status()
    parsed = parse_config(response.json())
    if not parsed:
        raise ValueError("the Wayback release list came back empty")
    with _lock:
        _listed = (time.monotonic(), parsed)
    return parsed


def find(number: int, listed: list[Release]) -> Release | None:
    return next((release for release in listed if release.number == number), None)


def parse_variant(spec: str) -> int:
    """``"64776"`` → ``64776``. The validation boundary for a path segment."""
    if not _RELEASE_RE.match(spec):
        raise ValueError(f"malformed Wayback release '{spec}'")
    return int(spec)


def variant_id(number: int) -> str:
    return f"{BASE_ID}{VARIANT_SEP}{int(number)}"


def tile_url(number: int) -> str:
    """The XYZ template of one release, with `{z}`/`{x}`/`{y}` left to fill."""
    return TILE_TEMPLATE.format(release=int(number))


@dataclass(frozen=True)
class Change:
    """One picture a point has had: the release that first published it, and
    when and by what it was taken, when the release's metadata says."""

    release: int
    acquired: str | None
    source: str | None


@dataclass(frozen=True)
class _Picture:
    """One release's tile at the walked point, in the forms it is compared in."""

    digest: str
    cells: np.ndarray | None  # the standardised thumbnail, None when it will not decode


def _thumbnail(content: bytes) -> np.ndarray | None:
    """A tile as a standardised grey thumbnail, or None when it will not decode."""
    try:
        with Image.open(io.BytesIO(content)) as image:
            grey = image.convert("L").resize(
                (_THUMB_SIDE, _THUMB_SIDE), Image.Resampling.BILINEAR
            )
        cells = np.asarray(grey, dtype=np.float32)
    except Exception:
        return None
    spread = max(float(cells.std()), _FLAT_SPREAD)
    return (cells - float(cells.mean())) / spread


def _same_picture(one: _Picture | None, other: _Picture | None) -> bool:
    """Whether two releases published the same picture of this point."""
    if one is None or other is None:
        return False  # a tile that could not be read is never a twin
    if one.digest == other.digest:
        return True
    if one.cells is None or other.cells is None:
        return False
    apart = np.abs(one.cells - other.cells) > _CELL_TOLERANCE
    return float(apart.mean()) <= _CHANGED_CELLS


def local_changes(
    lat: float,
    lon: float,
    zoom: int,
    *,
    get: Callable[..., Any] | None = None,
) -> list[Change]:
    """The distinct pictures of this point, newest first.

    Starts from the newest release and asks the tilemap which release that
    tile really comes from, then continues from the release before that one,
    until a release has no tile there. What the tilemap calls a change is a
    change of bytes, and Esri republishes the same picture far more often than
    the ground under it moves: re-encoded, or re-processed under a new colour
    balance. So the pixels themselves settle it — every candidate's tile is
    read and compared with the one kept before it — and the metadata each
    release states (the acquisition date and the sensor) merges what is left.
    Either way the release that first published the picture is the one kept.

    One pooled connection carries the whole walk: a fresh TLS handshake per
    step made a ten-change point take most of a minute.
    """
    if get is not None:
        return _walk_changes(lat, lon, zoom, get)
    with _open_client() as client:
        return _walk_changes(lat, lon, zoom, client.get)


def _open_client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=15,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=METADATA_WORKERS + 4),
    )


def _walk_changes(lat: float, lon: float, zoom: int, fetch: Callable[..., Any]) -> list[Change]:
    from . import tiles

    listed = releases(get=fetch)
    order = {release.number: index for index, release in enumerate(listed)}
    z = max(0, min(int(zoom), MAX_ZOOM))
    x, y = tiles.project(lat, lon, z)
    col, row = int(x), int(y)
    key = (listed[0].number, z, row, col)
    with _lock:
        if key in _changes:
            return _changes[key]

    found: list[int] = []
    current = listed[0].number
    for _ in range(MAX_STEPS):
        response = fetch(TILEMAP_URL.format(release=current, z=z, row=row, col=col))
        response.raise_for_status()
        answer = response.json()
        data = answer.get("data") if isinstance(answer, dict) else None
        if not data or not data[0]:
            break
        select = answer.get("select") or []
        chosen = int(select[0]) if select and str(select[0]).isdigit() else current
        if chosen not in order:
            break  # a release the list does not know: stop rather than guess its date
        if not found or found[-1] != chosen:
            found.append(chosen)
        following = order[chosen] + 1
        if following >= len(listed):
            break
        current = listed[following].number

    def read_picture(number: int) -> _Picture | None:
        """The release's tile here, or None when it cannot be read: an unknown is
        never a twin, so a dropped connection keeps a change rather than losing it."""
        for _attempt in (1, 2):
            try:
                reply = fetch(tiles.tile_url(tile_url(number), z, col, row))
                reply.raise_for_status()
                return _Picture(hashlib.sha256(reply.content).hexdigest(), _thumbnail(reply.content))
            except Exception:
                continue
        return None

    # Every candidate is compared by its pixels, so all of them are read up
    # front and side by side rather than one per comparison.
    with ThreadPoolExecutor(max_workers=TILE_WORKERS) as pool:
        pictures = dict(zip(found, pool.map(read_picture, found)))

    distinct: list[int] = []
    for number in reversed(found):  # oldest first, so the older twin stays
        previous = distinct[-1] if distinct else None
        if previous is not None and _same_picture(pictures[previous], pictures[number]):
            continue
        distinct.append(number)

    # What each picture is, asked at the middle of the tile the walk read, so
    # every point of that tile gets the same answer the cache will give it.
    centre = tiles.unproject(col + 0.5, row + 0.5, z)

    def describe(number: int) -> dict[str, Any]:
        release = find(number, listed)
        if not release:
            return {}
        for _attempt in (1, 2):
            try:
                return _metadata(release, centre[0], centre[1], z, fetch)
            except Exception:
                continue
        return {}  # unknown, which never merges two pictures

    # The metadata service is the slow one, a couple of seconds a question, so
    # a whole history is asked at once rather than six at a time.
    with ThreadPoolExecutor(max_workers=METADATA_WORKERS) as pool:
        described = list(pool.map(describe, distinct))

    kept: list[tuple[Change, tuple[str, str] | None]] = []
    for number, attrs in zip(distinct, described):  # still oldest first
        acquired = _day(attrs.get("SRC_DATE2"))
        sensor = str(attrs.get("SRC_DESC") or "")
        picture = (acquired, sensor) if acquired else None
        if kept and picture and kept[-1][1] == picture:
            continue  # the same acquisition, published again
        kept.append((Change(number, acquired, _source(attrs)), picture))
    result = [change for change, _ in reversed(kept)]
    with _lock:
        _changes[key] = result
    return result


def _day(value: Any) -> str | None:
    """SRC_DATE2 is epoch milliseconds; anything else is not a date we can state."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        return None
    try:
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    except (OverflowError, OSError, ValueError):
        return None


def _source(attrs: dict[str, Any]) -> str | None:
    """Who took the picture, then with which satellite, as in `Maxar WV03`."""
    return " ".join(str(part) for part in (attrs.get("NICE_DESC"), attrs.get("SRC_DESC")) if part) or None


def metadata_layer(zoom: int) -> int:
    return max(0, min(_METADATA_LAST_LAYER, _METADATA_MAX_ZOOM - int(zoom)))


def _metadata(
    release: Release, lat: float, lon: float, zoom: int, fetch: Callable[..., Any]
) -> dict[str, Any]:
    """The attributes one release's metadata states for a point, `{}` for none.

    Raises when the service cannot be reached, which callers keep apart from
    a release that simply says nothing there.
    """
    if not release.metadata_url:
        return {}
    params = {
        "f": "json",
        "where": "1=1",
        "outFields": "SRC_DATE2,NICE_DESC,SRC_DESC,SAMP_RES,SRC_ACC",
        "geometry": f'{{"spatialReference":{{"wkid":4326}},"x":{lon},"y":{lat}}}',
        "geometryType": "esriGeometryPoint",
        "spatialRel": "esriSpatialRelIntersects",
        "returnGeometry": "false",
    }
    response = fetch(f"{release.metadata_url}/{metadata_layer(zoom)}/query", params=params)
    response.raise_for_status()
    features = response.json().get("features") or []
    return (features[0].get("attributes") or {}) if features else {}


def capture_date(
    lat: float,
    lon: float,
    zoom: int,
    number: int,
    *,
    get: Callable[..., Any] | None = None,
) -> dict[str, Any] | None:
    """When the pixels of one release were acquired at a point, and by what.

    ``None`` when a service cannot be reached; a dict with ``date: None`` when
    the release carries no metadata there. Never raises.
    """
    try:
        release = find(number, releases(get=get))
    except Exception:
        return None
    if release is None:
        return {"date": None, "source": None, "release_date": None}
    try:
        attrs = _metadata(release, lat, lon, zoom, get or _get)
    except Exception:
        return None
    return {
        "date": _day(attrs.get("SRC_DATE2")),
        "source": _source(attrs),
        "release_date": release.date,
    }
