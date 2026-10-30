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
# What the heights at that level are worth: Copernicus GLO-30's 30 m, however finely its tiles are cut.
PLANET_DETAIL_M = 30.0
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
# A sampler that keeps its mosaics (`Sampler.plates`) grows one to take in the next read's tiles up to this many
# tiles, and holds this many bytes of them in all, the level read longest ago let go first.
PLATE_GROW_TILES = 16
PLATES_BYTES = 160 << 20
# A ceiling stands this far over the highest ground it bounds, metres: a bilinear read in float32 may round
# a hair past its highest neighbour.
CEILING_SLACK_M = 0.05


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
    """Whole or not at all, so a reader on another thread never meets half a
    tile. Never raises: the cache is an optimisation."""
    path = _path(folder, z, x, y, ext)
    part = path.with_name(f"{path.name}.{threading.get_ident()}.part")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        part.write_bytes(content)
        os.replace(part, path)
    except OSError:
        try:
            part.unlink()
        except OSError:
            pass


def _forget(z: int, x: int, y: int) -> None:
    """Drop a tile's cached copies, so the next read asks for it again."""
    for source in SOURCES:
        for ext in _MEDIA:
            try:
                _path(source.id, z, x, y, ext).unlink()
            except OSError:
                pass


_fetching: dict[Key, threading.Lock] = {}
_fetching_guard = threading.Lock()


def _fetch_lock(key: Key) -> threading.Lock:
    with _fetching_guard:
        if len(_fetching) > 4096:
            _fetching.clear()
        return _fetching.setdefault(key, threading.Lock())


def tile(z: int, x: int, y: int) -> Fetched | None:
    """One terrain tile of the 512 px grid, or None where there is no data.

    Raises `TerrainUnavailable` when no source can be reached. Threads asking
    for the same tile at once wait for one download rather than make several.
    """
    cached = _cached(z, x, y)
    if not isinstance(cached, _Miss):
        return cached
    with _fetch_lock((z, x, y)):
        cached = _cached(z, x, y)
        if not isinstance(cached, _Miss):
            return cached
        return _download(z, x, y)


def _download(z: int, x: int, y: int) -> Fetched | None:
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
class _Plate:
    """One level's tiles laid side by side and kept between reads (`Sampler.plates`): which slots hold their tile
    yet, which tiles do not exist, and once asked, the highest-ground pyramid (`Sampler.ceiling`)."""

    zoom: int
    tx: int
    ty: int
    nx: int
    ny: int
    heights: np.ndarray
    loaded: np.ndarray
    absent: np.ndarray
    tops: list[np.ndarray] | None = None
    # the slots whose pyramid is up to date with the tiles laid in
    ready: np.ndarray | None = None

    def covers(self, tx: int, ty: int, nx: int, ny: int) -> bool:
        return self.tx <= tx and self.ty <= ty and tx + nx <= self.tx + self.nx and ty + ny <= self.ty + self.ny


# Levels of a plate's highest-ground pyramid: the last one's cell spans a whole tile.
TOPS_LEVELS = _SHIFT + 1


def _tops_tile(levels: list[np.ndarray], heights: np.ndarray, row: int, column: int) -> None:
    """One tile's slot of the highest-ground pyramid: at the first level each pixel the highest of the four a
    bilinear read there blends (the plate's last row and column standing for their own neighbours), each next
    level the highest of four cells of the one before, down to the whole tile."""
    height, width = heights.shape
    y0, x0 = row * TILE, column * TILE
    y1, x1 = y0 + TILE, x0 + TILE
    window = heights[y0:min(y1 + 1, height), x0:min(x1 + 1, width)]
    across = window[:, :TILE].copy()
    np.maximum(across[:, :window.shape[1] - 1], window[:, 1:], out=across[:, :window.shape[1] - 1])
    first = across[:TILE].copy()
    np.maximum(first[:across.shape[0] - 1], across[1:], out=first[:across.shape[0] - 1])
    levels[0][y0:y1, x0:x1] = first
    for level in range(1, len(levels)):
        size = TILE >> level
        a, c = y0 >> level, x0 >> level
        last = levels[level - 1][2 * a:2 * (a + size), 2 * c:2 * (c + size)]
        out = levels[level][a:a + size, c:c + size]
        np.maximum(last[0::2, 0::2], last[0::2, 1::2], out=out)
        np.maximum(out, last[1::2, 0::2], out=out)
        np.maximum(out, last[1::2, 1::2], out=out)


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

    `keep` bounds the tiles held, the oldest let go first, for a computation
    that roams far (a search over thousands of square kilometres would hold
    gigabytes): a tile let go is read again from the disk cache when needed.

    `plates` keeps each level's mosaic between reads rather than laying it out
    again for every one, for a computation reading many sweeps over the same
    ground (a search), and lets `ceiling` bound the ground ahead of a read.
    """

    fetch: Callable[[int, int, int], Fetched | None] | None = None
    sources: set[str] = field(default_factory=set)
    zooms: set[int] = field(default_factory=set)
    keep: int | None = None
    plates: bool = False
    _held: OrderedDict[Key, np.ndarray | None] = field(default_factory=OrderedDict)
    # one sweep reads with several threads: what is held changes under one of them at a time (unlocked, a read
    # listing the tiles to let go met another's new tile: "OrderedDict mutated during iteration")
    _held_lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)
    _plates: OrderedDict[int, _Plate] = field(default_factory=OrderedDict, repr=False, compare=False)
    _plates_lock: threading.RLock = field(default_factory=threading.RLock, repr=False, compare=False)

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

    def _void(self, lat: np.ndarray, lon: np.ndarray, zoom: int) -> bool:
        """Whether the level's kept plate already knows that no tile exists at `zoom` anywhere a read of these
        points there touches: every point would climb a level, so the read may start a level down."""
        if zoom <= PLANET_ZOOM or not self.plates or not lat.size:
            return False
        with self._plates_lock:
            plate = self._plates.get(zoom)
            if plate is None or not plate.absent.any():
                return False
            # pixels rise with longitude and fall with latitude: the corners bound every point's, a pixel more
            # either way for rounding and for the right and lower neighbours a read takes
            corners = np.array([np.max(lat), np.min(lat)]), np.array([np.min(lon), np.max(lon)])
            if not np.isfinite(corners).all():
                return False
            px, py = _pixels(*corners, zoom)
            world = TILE << zoom
            x_lo, x_hi = int(np.floor(px[0])) - 1, int(np.floor(px[1])) + 2
            y_lo, y_hi = max(0, int(np.floor(py[0])) - 1), min(world - 1, int(np.floor(py[1])) + 2)
            if x_lo < 0 or x_hi >= world:
                return False
            tx_lo, tx_hi = (x_lo >> _SHIFT) - plate.tx, (x_hi >> _SHIFT) - plate.tx
            ty_lo, ty_hi = (y_lo >> _SHIFT) - plate.ty, (y_hi >> _SHIFT) - plate.ty
            if tx_lo < 0 or ty_lo < 0 or tx_hi >= plate.nx or ty_hi >= plate.ny:
                return False
            # a slot is marked absent only once its tile was asked for
            return bool(plate.absent[ty_lo:ty_hi + 1, tx_lo:tx_hi + 1].all())

    def _sample(
        self, lat: np.ndarray, lon: np.ndarray, zoom: int, out: np.ndarray, where: np.ndarray
    ) -> None:
        # where the plate knows the level holds nothing, every point would climb: read a level down at once
        while self._void(lat, lon, zoom):
            zoom -= 1
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
        held = self._load(zoom, np.unique(keys), tiles_across)

        values = np.zeros(gx.size, dtype=np.float32)
        absent = np.zeros(gx.size, dtype=bool)
        order = np.argsort(keys, kind="stable")
        starts = np.flatnonzero(np.diff(keys[order])) + 1
        for segment in np.split(order, starts):
            key = int(keys[segment[0]])
            heights = held[(zoom, key // tiles_across, key % tiles_across)]
            if heights is None:
                if zoom > PLANET_ZOOM:
                    absent[segment] = True  # no survey this deep here: climb a level
                # else: the sea, at zero
                continue
            values[segment] = heights[gy[segment] & (TILE - 1), gx[segment] & (TILE - 1)]

        count = lat.size
        v = values.reshape(4, count)
        climb = absent.reshape(4, count).any(axis=0)
        # the mosaic's own arithmetic, so the two reads agree to the bit
        top = v[0] + fx * (v[1] - v[0])
        bottom = v[2] + fx * (v[3] - v[2])
        blended = top + fy * (bottom - top)
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
        if (x0.size < MOSAIC_MIN_POINTS and not self.plates) or x0.min() < 0 or x0.max() + 1 >= world:
            return False
        tx_lo, tx_hi = int(x0.min()) >> _SHIFT, (int(x0.max()) + 1) >> _SHIFT
        ty_lo, ty_hi = int(ya.min()) >> _SHIFT, int(yb.max()) >> _SHIFT
        nx, ny = tx_hi - tx_lo + 1, ty_hi - ty_lo + 1
        if nx * ny > MOSAIC_MAX_TILES:
            return False
        # local pixel coordinates, one flat index a point into the mosaic; the
        # right neighbour is the next pixel, the lower one a row down (none at
        # the world's lower edge, where the row is held)
        width = nx * TILE
        lx0 = x0 - tx_lo * TILE
        ly0 = ya - ty_lo * TILE
        down = yb - ya
        i00 = ly0 * width + lx0
        # the tiles touched: the upper-left neighbour's, and for points on a
        # tile's last pixel the tiles their other neighbours spill into
        touched = np.zeros(nx * ny, dtype=bool)
        touched[(ly0 >> _SHIFT) * nx + (lx0 >> _SHIFT)] = True
        last = TILE - 1
        edge = ((lx0 & last) == last) | (((ly0 & last) == last) & (down > 0))
        if edge.any():
            ex, ey = lx0[edge], ly0[edge]
            for ly in (ey, ey + down[edge]):
                for lx in (ex, ex + 1):
                    touched[(ly >> _SHIFT) * nx + (lx >> _SHIFT)] = True
        used = np.flatnonzero(touched)
        if self.plates:
            # the level's kept mosaic, its new tiles laid in: the same pixels at other offsets
            plate = self._plate(zoom, tx_lo, ty_lo, nx, ny, used)
            mosaic, absent = plate.heights, plate.absent
            lx0 = x0 - plate.tx * TILE
            ly0 = ya - plate.ty * TILE
            nx, width = plate.nx, plate.nx * TILE
            i00 = ly0 * width + lx0
        else:
            tiles_across = 1 << zoom
            held = self._load(zoom, (tx_lo + used % nx) * tiles_across + (ty_lo + used // nx), tiles_across)
            mosaic = np.zeros((ny * TILE, width), dtype=np.float32)
            absent = np.zeros((ny, nx), dtype=bool)
            for slot in used:
                row, column = divmod(int(slot), nx)
                heights = held[(zoom, tx_lo + column, ty_lo + row)]
                if heights is None:
                    absent[row, column] = True  # the sea at zero, or no survey this deep
                else:
                    mosaic[row * TILE:(row + 1) * TILE, column * TILE:(column + 1) * TILE] = heights

        flat = mosaic.ravel()
        i10 = i00 + down * width
        v00 = flat.take(i00)
        top = v00 + fx * (flat.take(i00 + 1) - v00)
        v10 = flat.take(i10)
        bottom = v10 + fx * (flat.take(i10 + 1) - v10)
        blended = top + fy * (bottom - top)
        climb = None
        if zoom > PLANET_ZOOM and absent.any():
            gone = absent.ravel()
            climb = np.zeros(x0.size, dtype=bool)
            for ly in (ly0, ly0 + down):
                for lx in (lx0, lx0 + 1):
                    climb |= gone[(ly >> _SHIFT) * nx + (lx >> _SHIFT)]
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

    def _plate(self, zoom: int, tx: int, ty: int, nx: int, ny: int, used: np.ndarray) -> _Plate:
        """The level's kept mosaic holding the `used` slots of the box of tiles (tx, ty, nx, ny): the one kept
        when it covers the box, grown to take it in while small, else laid out for the box alone."""
        with self._plates_lock:
            plate = self._plates.get(zoom)
            if plate is None or not plate.covers(tx, ty, nx, ny):
                gx, gy = tx, ty
                gw, gh = nx, ny
                if plate is not None:
                    gx, gy = min(tx, plate.tx), min(ty, plate.ty)
                    gw = max(tx + nx, plate.tx + plate.nx) - gx
                    gh = max(ty + ny, plate.ty + plate.ny) - gy
                old = plate if plate is not None and gw * gh <= PLATE_GROW_TILES else None
                if old is None:
                    gx, gy, gw, gh = tx, ty, nx, ny
                plate = _Plate(
                    zoom, gx, gy, gw, gh, np.zeros((gh * TILE, gw * TILE), dtype=np.float32),
                    np.zeros((gh, gw), dtype=bool), np.zeros((gh, gw), dtype=bool),
                )
                if old is not None:
                    # what the smaller one held, moved across rather than read again
                    oy, ox = old.ty - gy, old.tx - gx
                    plate.heights[oy * TILE:(oy + old.ny) * TILE, ox * TILE:(ox + old.nx) * TILE] = old.heights
                    plate.loaded[oy:oy + old.ny, ox:ox + old.nx] = old.loaded
                    plate.absent[oy:oy + old.ny, ox:ox + old.nx] = old.absent
                self._plates.pop(zoom, None)
                self._plates[zoom] = plate
                # within the bytes kept, the level read longest ago let go first
                while sum(p.heights.nbytes for p in self._plates.values()) > PLATES_BYTES and len(self._plates) > 1:
                    self._plates.popitem(last=False)
            else:
                self._plates.move_to_end(zoom)
            columns = tx - plate.tx + used % nx
            rows = ty - plate.ty + used // nx
            need = ~plate.loaded[rows, columns]
            if need.any():
                tiles_across = 1 << zoom
                held = self._load(
                    zoom, (plate.tx + columns[need]) * tiles_across + (plate.ty + rows[need]), tiles_across
                )
                for row, column in zip(rows[need].tolist(), columns[need].tolist()):
                    heights = held[(zoom, plate.tx + column, plate.ty + row)]
                    if heights is None:
                        plate.absent[row, column] = True  # the sea at zero, or no survey this deep
                    else:
                        plate.heights[row * TILE:(row + 1) * TILE, column * TILE:(column + 1) * TILE] = heights
                    plate.loaded[row, column] = True
                    if plate.ready is not None:
                        # its pyramid, and those of the tiles left of it and above it that read into it, to redo
                        plate.ready[max(0, row - 1):row + 1, max(0, column - 1):column + 1] = False
            return plate

    def ceiling(
        self, lat: np.ndarray, lon: np.ndarray, lat_end: np.ndarray, lon_end: np.ndarray, zoom: int,
    ) -> np.ndarray:
        """The highest a read at `zoom` can give anywhere between each pair of points a few dozen pixels apart
        (a stretch of a ray): read off the plates' highest-ground pyramids, a level up where a tile does not
        exist this deep, as `heights` climbs. Infinite where the plates cannot say (a stretch across the
        antimeridian, or on more tiles than a mosaic takes). Needs `plates`."""
        lat = np.asarray(lat, dtype=np.float64)
        ends = np.concatenate([lat.ravel(), np.ravel(lat_end)]), np.concatenate([np.ravel(lon), np.ravel(lon_end)])
        if self._void(*ends, zoom):
            # every read between these ends climbs a level: that level's ceiling stands over them
            return self.ceiling(lat, lon, lat_end, lon_end, zoom - 1)
        out = np.full(lat.shape, -np.inf)
        world = TILE << zoom
        xa, ya = _pixels(lat, np.asarray(lon, dtype=np.float64), zoom)
        xb, yb = _pixels(np.asarray(lat_end, dtype=np.float64), np.asarray(lon_end, dtype=np.float64), zoom)
        # a pixel either way for the arc between the ends, and the right and lower neighbours the pyramid holds
        x_lo = np.floor(np.minimum(xa, xb)).astype(np.int64) - 1
        x_hi = np.floor(np.maximum(xa, xb)).astype(np.int64) + 1
        y_lo = np.clip(np.floor(np.minimum(ya, yb)).astype(np.int64) - 1, 0, world - 1)
        y_hi = np.clip(np.floor(np.maximum(ya, yb)).astype(np.int64) + 1, 0, world - 1)
        if not lat.size:
            return out
        if x_lo.min() < 0 or x_hi.max() + 1 >= world:
            return np.full(lat.shape, np.inf)
        tx_lo, tx_hi = int(x_lo.min()) >> _SHIFT, (int(x_hi.max()) + 1) >> _SHIFT
        ty_lo, ty_hi = int(y_lo.min()) >> _SHIFT, (int(y_hi.max()) + 1) >> _SHIFT
        nx, ny = tx_hi - tx_lo + 1, ty_hi - ty_lo + 1
        if nx * ny > MOSAIC_MAX_TILES:
            return np.full(lat.shape, np.inf)
        # the tiles under each box's corners: a box spans fewer pixels than a tile
        touched = np.zeros(nx * ny, dtype=bool)
        for bx in (x_lo, x_hi + 1):
            for by in (y_lo, np.minimum(y_hi + 1, world - 1)):
                touched[((by >> _SHIFT) - ty_lo) * nx + ((bx >> _SHIFT) - tx_lo)] = True
        with self._plates_lock:
            plate = self._plate(zoom, tx_lo, ty_lo, nx, ny, np.flatnonzero(touched))
            if plate.tops is None or plate.ready is None:
                plate.tops = [np.empty((plate.ny * TILE >> level, plate.nx * TILE >> level), dtype=np.float32)
                              for level in range(TOPS_LEVELS)]
                plate.ready = np.zeros((plate.ny, plate.nx), dtype=bool)
            # the pyramid made only where these stretches read it, tile by tile
            for slot in np.flatnonzero(touched).tolist():
                row, column = ty_lo - plate.ty + slot // nx, tx_lo - plate.tx + slot % nx
                if not plate.ready[row, column]:
                    _tops_tile(plate.tops, plate.heights, row, column)
                    plate.ready[row, column] = True
            tops = plate.tops
            climb = zoom > PLANET_ZOOM and bool(plate.absent.any())
        extent = int(max((x_hi - x_lo).max(), (y_hi - y_lo).max())) + 1
        level = max(0, math.ceil(math.log2(extent)))
        if level >= len(tops):
            return np.full(lat.shape, np.inf)
        top = tops[level]
        lx_lo, lx_hi = (x_lo - plate.tx * TILE) >> level, (x_hi - plate.tx * TILE) >> level
        ly_lo, ly_hi = (y_lo - plate.ty * TILE) >> level, (y_hi - plate.ty * TILE) >> level
        rows, columns = top.shape
        if lx_hi.max() >= columns or ly_hi.max() >= rows:
            return np.full(lat.shape, np.inf)
        for cy in (ly_lo, ly_hi):
            for cx in (lx_lo, lx_hi):
                out = np.maximum(out, top[cy, cx])
        out = out + CEILING_SLACK_M
        if climb:
            out = np.maximum(out, self.ceiling(lat, lon, lat_end, lon_end, zoom - 1))
        return out

    def _load(self, zoom: int, keys: np.ndarray, tiles_across: int) -> dict[Key, np.ndarray | None]:
        """The tiles asked for, loaded where they were not held: a mapping of its own, so another
        thread letting a tile go meanwhile takes nothing from this read."""
        wanted = [(zoom, int(k) // tiles_across, int(k) % tiles_across) for k in keys]
        with self._held_lock:
            before = {key: self._held[key] for key in wanted if key in self._held}
            missing = [key for key in wanted if key not in before]
            if self.keep is not None:
                for key in wanted:
                    if key in self._held:
                        self._held.move_to_end(key)
                # room for what this read needs, the oldest let go and never one it needs
                needed = set(wanted)
                spare = [key for key in self._held if key not in needed]
                for key in spare[: max(0, len(self._held) + len(missing) - self.keep)]:
                    self._held.pop(key, None)
        if not missing:
            return before
        shared = self.fetch is None
        to_fetch: list[Key] = []
        for key in missing:
            remembered = _recall(key) if shared else None
            if remembered is None:
                to_fetch.append(key)
            else:
                with self._held_lock:
                    self._held[key] = before[key] = remembered[0]
                if remembered[0] is not None:
                    self.sources.add(remembered[1])
        if not to_fetch:
            return before
        fetch = self.fetch or tile

        def one(key: Key) -> tuple[Key, np.ndarray | None, str]:
            fetched = fetch(*key)
            if fetched is None:
                return key, None, ""
            try:
                heights = decode(fetched[0])
            except TerrainUnavailable:
                if self.fetch is not None:
                    raise
                # a cached copy cut short (a crash mid-write): fetched again, once
                _forget(*key)
                fetched = tile(*key)
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
            with self._held_lock:
                self._held[key] = before[key] = heights
            if heights is not None:
                self.sources.add(source)
            if shared:
                _remember(key, (heights, source))
        return before

    def mosaic(self, zoom: int, tx: int, ty: int, nx: int, ny: int) -> np.ndarray:
        """The heights of the tiles `nx` across and `ny` down from tile (`tx`, `ty`), laid side by side as one
        array, at a level that covers the planet: where it holds no tile, the sea at zero."""
        if zoom > PLANET_ZOOM:
            raise ValueError("a mosaic is laid at a level that covers the planet")
        across = 1 << zoom
        slots = [((tx + i) % across, ty + j) for j in range(ny) for i in range(nx)]
        held = self._load(zoom, np.unique([x * across + y for x, y in slots]), across)
        out = np.zeros((ny * TILE, nx * TILE), dtype=np.float32)
        for index, (x, y) in enumerate(slots):
            heights = held[(zoom, x, y)]
            if heights is not None:
                row, column = divmod(index, nx)
                out[row * TILE:(row + 1) * TILE, column * TILE:(column + 1) * TILE] = heights
        self.zooms.add(zoom)
        return out

    def credits(self) -> list[dict[str, str]]:
        """Who to credit for the heights this sampler read."""
        return [
            {"label": s.label, "attribution": s.attribution, "link": s.link}
            for s in SOURCES if s.id in self.sources
        ]

    def resolution(self, lat: float) -> float | None:
        """Ground size of the finest heights that answered, in metres: a survey's pixel where a level
        past the planet's answered, else GLO-30's own 30 m, which the planet's tiles cut finer than it is."""
        if not self.zooms:
            return None
        deepest = max(self.zooms)
        if deepest <= PLANET_ZOOM:
            return PLANET_DETAIL_M
        return round(metres_per_pixel(lat, deepest), 1)


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
