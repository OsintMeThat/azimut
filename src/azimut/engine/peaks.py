"""Named summits around an eye, for the labels on a panorama.

They are OpenStreetMap's, read from OpenFreeMap's vector tiles: the
OpenMapTiles `mountain_peak` layer, every `natural=peak` or `natural=volcano`
that carries a name. OpenFreeMap is free, key-less and has no request quota; it
is served from a CDN, rebuilt every week, and the map's place names already read
it. The public Overpass servers asked before were shared and often busy, and one
turned an address away for up to an hour after the burst of questions a single
view makes.

A tile carries every layer of the map, roads and buildings included, so how deep
the tiles are read falls with distance (`RINGS`). Below zoom 14 a tile keeps only
its most important summits (a Wikipedia article first, then height), so a
shallower tile still names the far ones a panorama can pick out. Each tile's
summits are kept under the workspace for three months, so a reopened view and its
neighbours ask for nothing. A tile with no summit is kept too, as an empty one.

The names never hold the view up. Tiles not in yet are asked in the background,
nearest first, and the view reads whatever is in so far (`known_around`) and asks
again while some are still coming. A tile that could not be read is left a while,
twice as long each time, then asked again when the view next asks, or at once
when the analyst says to try again.

Nothing is asked until summit names are switched on in a view, which is the
analyst asking what they are looking at.
"""

from __future__ import annotations

import functools
import json
import logging
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import httpx

from .. import config
from . import mvt, terrain, tiles

logger = logging.getLogger(__name__)

# The tile paths name the weekly build, so the source is the TileJSON naming the
# current one, read again after `TEMPLATE_TTL`, or after `TEMPLATE_FRESH` when a
# tile is missing (the build it named is gone).
TILEJSON = "https://tiles.openfreemap.org/planet"
TILE_HOST = "https://tiles.openfreemap.org/"
TEMPLATE_TTL = 6 * 3600.0
TEMPLATE_FRESH = 60.0
LAYER = "mountain_peak"
CLASSES = frozenset({"peak", "volcano"})
TTL_DAYS = 90
# The zoom read out to each distance from the eye, in metres. Measured against
# Overpass on four 1° cells (2026-10-09): zoom 12 named all but one of the 487
# summits of the densest, zoom 11 nine in ten and zoom 10 half, and every zoom
# from 10 named all of them in the three sparser cells. A whole 150 km view in the
# Alps is about 160 tiles and 15 MB, read once.
RINGS = ((15_000.0, 12), (40_000.0, 11), (100_000.0, 10), (math.inf, 9))
# Tiles asked at once, as a browser asks a map host.
PARALLEL = 6
# How long a tile that could not be read is left the first time, and at most.
RETRY_AFTER = 30.0
RETRY_MAX = 600.0
# The most tiles one view reads, nearest first. Far north a 200 km view crosses
# about 560 (Lyngen, 69.6° N); past this the labels stop at the nearer summits.
MAX_TILES = 800

Key = tuple[int, int, int]


class PeaksUnavailable(Exception):
    """A tile could not be read."""


@dataclass(frozen=True)
class Peak:
    name: str
    lat: float
    lon: float
    ele: float | None
    name_en: str | None = None


def cache_dir() -> Path:
    return config.internal_dir() / "cache" / "peaks"


def _tile_path(key: Key) -> Path:
    z, x, y = key
    return cache_dir() / str(z) / str(x) / f"{y}.json"


def _height(value: object) -> float | None:
    """A summit height from the tile, which is whole metres, or nothing when absurd."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if -500 < value < 9000 else None


@functools.lru_cache(maxsize=16)
def tiles_around(lat: float, lon: float, radius_m: float) -> tuple[tuple[Key, float, float], ...]:
    """The tiles a view of `radius_m` reads, nearest first, each with the band of
    distances it names: ``(key, inner, outer)``.

    A tile is read at its ring's zoom when it reaches into that ring, and names
    only the summits inside it, so each summit comes from exactly one tile.
    """
    plan: list[tuple[float, Key, float, float]] = []
    inner = 0.0
    for reach, zoom in RINGS:
        if inner >= radius_m:
            break
        outer = min(reach, radius_m)
        dlat = outer / 111_195.0
        dlon = min(outer / (111_195.0 * max(math.cos(math.radians(lat)), 0.01)), 180.0)
        x0, y0 = tiles.project(lat + dlat, lon - dlon, zoom)
        x1, y1 = tiles.project(lat - dlat, lon + dlon, zoom)
        count = 1 << zoom
        for x in range(math.floor(x0), math.floor(x1) + 1):
            for y in range(max(math.floor(y0), 0), min(math.floor(y1), count - 1) + 1):
                north, west = tiles.unproject(x, y, zoom)
                south, east = tiles.unproject(x + 1, y + 1, zoom)
                nearest = terrain.distance(lat, lon, min(max(lat, south), north), min(max(lon, west), east))
                farthest = max(
                    terrain.distance(lat, lon, corner_lat, corner_lon)
                    for corner_lat in (south, north) for corner_lon in (west, east)
                )
                if nearest < outer and farthest >= inner:
                    plan.append((nearest, (zoom, x % count, y), inner, outer))
        inner = outer
    plan.sort(key=lambda row: row[0])
    return tuple((key, low, high) for _near, key, low, high in plan[:MAX_TILES])


def _read_tile(key: Key) -> list[Peak] | None:
    path = _tile_path(key)
    try:
        if time.time() - path.stat().st_mtime > TTL_DAYS * 86400:
            return None
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return [Peak(**row) for row in rows]


def _write_tile(key: Key, found: list[Peak]) -> None:
    """Written aside then moved in, so a view reading meanwhile never sees half of it."""
    path = _tile_path(key)
    part = path.with_name(f"{path.stem}.{threading.get_ident()}.part")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        part.write_text(json.dumps([peak.__dict__ for peak in found]), encoding="utf-8")
        os.replace(part, path)
    except OSError:
        part.unlink(missing_ok=True)


# -- reading OpenFreeMap -------------------------------------------------------

_client_lock = threading.Lock()
_client_instance: httpx.Client | None = None
_template_lock = threading.Lock()
_template: tuple[str, float] | None = None
# when the TileJSON last could not be read: until `RETRY_AFTER` has passed, every
# tile fails at once rather than each waiting its turn to ask a host that is down
_template_missed = -math.inf


def _client() -> httpx.Client:
    global _client_instance
    with _client_lock:
        if _client_instance is None:
            _client_instance = httpx.Client(
                follow_redirects=True,
                timeout=tiles.TILE_TIMEOUT,
                limits=httpx.Limits(max_keepalive_connections=PARALLEL, max_connections=PARALLEL),
                headers={"User-Agent": tiles.USER_AGENT},
            )
        return _client_instance


def _get(url: str) -> tuple[int, bytes]:
    """Status and body of one GET, asked again on a transient failure."""
    for attempt in range(1, tiles.MAX_TILE_TRIES + 1):
        last = attempt == tiles.MAX_TILE_TRIES
        try:
            response = _client().get(url)
        except httpx.HTTPError as exc:
            if last:
                raise PeaksUnavailable(tiles.upstream_failure(exc)) from exc
            continue
        if response.status_code in tiles.TRANSIENT_STATUSES and not last:
            time.sleep(tiles.RETRY_PAUSE)
            continue
        return response.status_code, response.content
    raise AssertionError("unreachable")  # the loop returns or raises on its last turn


def _tile_template(fresh: bool = False) -> str:
    """The current build's tile address, from the TileJSON. `fresh` reads it again
    unless that was done in the last `TEMPLATE_FRESH` seconds."""
    global _template, _template_missed
    with _template_lock:
        now = time.monotonic()
        if _template and now - _template[1] < (TEMPLATE_FRESH if fresh else TEMPLATE_TTL):
            return _template[0]
        if now - _template_missed < RETRY_AFTER:
            raise PeaksUnavailable("OpenFreeMap could not be reached a moment ago")
        try:
            status, body = _get(TILEJSON)
            if status != 200:
                raise PeaksUnavailable(f"OpenFreeMap answered {status}")
            try:
                template = json.loads(body)["tiles"][0]
            except (ValueError, KeyError, IndexError, TypeError) as exc:
                raise PeaksUnavailable("OpenFreeMap sent a TileJSON without tiles") from exc
            if not isinstance(template, str) or not template.startswith(TILE_HOST):
                raise PeaksUnavailable("OpenFreeMap named its tiles somewhere else")
        except PeaksUnavailable:
            _template_missed = time.monotonic()
            raise
        _template = (template, time.monotonic())
        return template


def _ask_tile(key: Key) -> list[Peak]:
    """One tile's named summits, inside the tile itself."""
    z, x, y = key
    template = _tile_template()
    status, body = _get(template.format(z=z, x=x, y=y))
    if status == 404:
        # the build it named may be gone: the TileJSON names the new one
        newer = _tile_template(fresh=True)
        if newer != template:
            status, body = _get(newer.format(z=z, x=x, y=y))
    if status == 404:
        return []
    if status != 200:
        raise PeaksUnavailable(f"OpenFreeMap answered {status}")
    found = []
    for fx, fy, tags in mvt.read_points(body, LAYER):
        name = str(tags.get("name") or "").strip()
        if not name or tags.get("class") not in CLASSES or not (0 <= fx < 1 and 0 <= fy < 1):
            continue
        lat, lon = tiles.unproject(x + fx, y + fy, z)
        english = str(tags.get("name:en") or "").strip()
        found.append(Peak(
            name=name, lat=round(lat, 6), lon=round(lon, 6),
            ele=_height(tags.get("ele")), name_en=english if english and english != name else None,
        ))
    return found


def _fetch(key: Key) -> None:
    """Ask one tile and keep the answer. The tile stays in flight until its file
    is written, so a view reading meanwhile never asks for it twice."""
    try:
        found = _ask_tile(key)
    except Exception as exc:  # any failure is the same "not now" for one tile
        logger.info("summit names for tile %s: %s", key, exc)
        with _lock:
            wait = min(_failed[key][1] * 2, RETRY_MAX) if key in _failed else RETRY_AFTER
            _failed[key] = (time.monotonic() + wait, wait)
            _in_flight.discard(key)
        return
    _write_tile(key, found)
    with _lock:
        _failed.pop(key, None)
        _in_flight.discard(key)


_lock = threading.Lock()
_in_flight: set[Key] = set()
# when a tile that could not be read may be asked again, and how long it was left
_failed: dict[Key, tuple[float, float]] = {}
_pool: ThreadPoolExecutor | None = None


def _start(key: Key) -> None:
    global _pool
    if _pool is None:
        _pool = ThreadPoolExecutor(max_workers=PARALLEL, thread_name_prefix="peaks")
    _in_flight.add(key)
    _pool.submit(_fetch, key)


@dataclass(frozen=True)
class Known:
    """What the tiles around an eye hold so far."""

    peaks: list[Peak]
    pending: int  # tiles still being read
    failed: int  # tiles that could not be read just now
    retry_in: float  # seconds until the first of those is asked again


def known_around(lat: float, lon: float, radius_m: float, retry: bool = False) -> Known:
    """Every named summit the cache holds around a point, asking for the rest.

    Never waits on the network: tiles not in yet are asked in the background,
    nearest first, and counted as pending. `retry` asks the tiles that could not
    be read again now rather than once their wait is over.
    """
    found: list[Peak] = []
    pending = failed = 0
    retry_in = math.inf
    with _lock:
        now = time.monotonic()
        for key, inner, outer in tiles_around(lat, lon, radius_m):
            cached = _read_tile(key)
            if cached is not None:
                found.extend(
                    peak for peak in cached if inner <= terrain.distance(lat, lon, peak.lat, peak.lon) < outer
                )
            elif key in _in_flight:
                pending += 1
            elif key in _failed and now < _failed[key][0] and not retry:
                failed += 1
                retry_in = min(retry_in, _failed[key][0] - now)
            else:
                _start(key)
                pending += 1
    return Known(found, pending, failed, retry_in if failed else 0.0)


def wait_idle(timeout: float = 10.0) -> bool:
    """Block until no tile is being read. For tests."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with _lock:
            if not _in_flight:
                return True
        time.sleep(0.01)
    return False


def forget() -> None:
    """Let every tile be asked again at once, and the build be read again. For tests."""
    global _template, _template_missed
    with _lock:
        _failed.clear()
    with _template_lock:
        _template = None
        _template_missed = -math.inf
    tiles_around.cache_clear()
