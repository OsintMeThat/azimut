"""Points of a search's grid ruled out before any turn is swept: what the analyst said the photo shows could
not be seen from there (FIND_SMART_PLAN §5.0, tier 0).

Each test is a necessary condition, never a score: a point is ruled out only where the truth could not
stand, with the terrain's tolerance, and in doubt it stays. Three are read here, off the heights alone:

- a line traced along the sea's horizon (`Plan.sea`): the sea lies within the sea's horizon from the eye
  there, as far as the search reads that line (finder `SEA_FAR` · skymatch `BAND_SLACK` times its distance);
- water said to show in the photo, the sea or a lake (`Plan.water`): flat water within the farthest the turn
  is read (finder `reaches`), since water shows in front of the skyline;
- the eye said to stand above the land round it, or below it (`Plan.over`): its ground against the middle of
  the land 1 to 3 km round, past `OVER_SLACK_M` (measured on the owner's cases: every view taken from high
  stands 43 m or more above it, every one looking up 90 m or more below).

Water is the sea and the lakes the map draws (engine/water.py, rivers left out as the hint says the sea or
a lake), read over the whole reach: the sea at the map's coarser levels as far as an eye on a mountain sees
it, the lakes at its own level. Where the map cannot be read, it is ground with no relief on the terrain
(engine/landform.py): the sea at zero, the lakes GLO-30 flattens, and plains the tiles round to a flat step,
which only keep more points. A point keeps this test when any water lies within a square its reach wide
either side: the square holds the disk, so it errs towards keeping. A lake's reach past `REACH_MAX_M` keeps
every point.

Water within reach is not water in sight: a lake 30 km off lies behind every ridge in between. The second
test (`sight`, tier 1, dearer: rays to be marched) aims rays at the water within reach and walks them out
as the sweep does (engine/horizon.py), coarsely; a point keeps it when any water along them is in sight,
raised `SIGHT_SLACK_M` for the terrain's error and the trees, read on the map's water pooled to the rays'
spacing so a narrow lake is not stepped over. What it finds is remembered point by point (`_SEEN`): the Mesh
step's check fills it, the live preview reads what it holds (`sight="known"`) and says how many points are
still unchecked, and the search reuses it, looking only at the points nobody checked yet.

The reasons are said as the ground a point stands on is (finder `preview`), so the map greys a point ruled
out and says why.
"""

from __future__ import annotations

import math
import threading
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

import numpy as np

from . import finder, horizon, landform, skymatch, terrain, water

# The reasons a point is ruled out, as the preview says its ground.
NO_SEA = "nosea"
NO_WATER = "nowater"
LOW = "low"
HIGH = "high"
# the sea, or the sea or a lake, within reach but hidden by the land in between (`sight`)
SEA_HIDDEN = "seahidden"
WATER_HIDDEN = "waterhidden"
REASONS = (NO_SEA, NO_WATER, SEA_HIDDEN, WATER_HIDDEN, LOW, HIGH)
# the reasons only a test in sight gives, so a preview without them says nothing of them
SIGHT_REASONS = (SEA_HIDDEN, WATER_HIDDEN)
# Water is read at this level at the deepest (about 76 m a pixel at the equator), a coarser one where the
# reach would lay more than MOSAIC_TILES_MAX tiles (16 tiles hold 4 million heights), down to WATER_ZOOM_MIN;
# flat within this much over a pixel's neighbours; the sea is such water within this much of zero.
WATER_ZOOM = 11
WATER_ZOOM_MIN = 8
MOSAIC_TILES_MAX = 16
WATER_FLAT_M = landform.WATER_FLAT_M
SEA_LEVEL_M = 1.0
# The map's water is read in this many of its tiles at the most (a mask of 256 pixels a side each), the sea at
# a coarser level of the map where its own level would lay more (the sea is drawn whole at every level, a
# small lake is not); past this reach a water test keeps every point (an eye 1.5 km up sees the sea 140 km out).
MAP_TILES_MAX = 64
MAP_SEA_ZOOM_MIN = 3
REACH_MAX_M = 300_000.0
# The sea is read as far as this (an eye 8 km up sees it some 370 km out, read twice as far as a line along
# it is), and offline off the terrain's flat ground down to this level.
SEA_REACH_MAX_M = 1_000_000.0
SEA_FLAT_ZOOM_MIN = 4
# Water in sight (`sight`): rays aimed this many degrees apart at the water within reach, sampled every
# SIGHT_NEAR_M near the eye and SIGHT_RATIO of the distance farther out, each sample on the terrain level
# whose pixel is about its spacing; water raised SIGHT_SLACK_M that would show counts as in sight. The water
# a point aims at is read on its cells pooled until at most SIGHT_CELLS of them lie within reach.
SIGHT_STEP = 0.5
SIGHT_NEAR_M = 50.0
SIGHT_RATIO = 0.01
SIGHT_SLACK_M = 20.0
SIGHT_CELLS = 6_000
# About how long one point takes to check, seconds (measured over a DRC area with a lake and rivers within
# reach, on an 8-core laptop): what the Mesh step says before its check.
SIGHT_SECONDS = 0.025
# Points whose water in sight is remembered, the latest kept: a search's grid several times over.
SEEN_MAX = 400_000

Sight = Literal["no", "known", "all"]
# What `_sees` found at a point, by the sea or any water, where, how far it read and how high the eye stood.
_SEEN: OrderedDict[tuple[bool, float, float, int, int], bool] = OrderedDict()
_SEEN_LOCK = threading.Lock()


def _seen_key(sea: bool, lat: float, lon: float, reach: float, altitude: float) -> tuple[bool, float, float, int, int]:
    return (sea, round(lat, 6), round(lon, 6), round(reach), round(altitude * 10))


def forget_seen() -> None:
    """Drop what was found in sight (tests)."""
    with _SEEN_LOCK:
        _SEEN.clear()
# The land round an eye is read on rings this far out, of this many samples each; the eye said above it
# may still stand this much below its middle, the eye said below it this much above.
RINGS_M = (1_000.0, 2_000.0, 3_000.0)
RING_SAMPLES = 16
OVER_SLACK_M = 15.0


def rise(lat: np.ndarray, lon: np.ndarray, sampler: terrain.Sampler) -> np.ndarray:
    """How high each point's ground stands over the middle of the land 1 to 3 km round it, metres."""
    here = np.asarray(sampler.heights(lat, lon, landform.ZOOM), dtype=np.float64)
    around = np.concatenate([landform.ring(lat, lon, metres, RING_SAMPLES, sampler) for metres in RINGS_M], axis=1)
    return here - np.median(around, axis=1)


def _tiles(box: tuple[float, float, float, float], zoom: int, side: int) -> tuple[int, int, int, int]:
    """The tiles at `zoom` a box (north, south, west, east) lies on: the first across and down, and how many."""
    north, south, west, east = box
    px, py = terrain._pixels(np.array([north, south]), np.array([west, east]), zoom)
    scale = side / terrain.TILE
    tx0, tx1 = int((px[0] + 0.5) * scale) // side, int((px[1] + 0.5) * scale) // side
    ty0, ty1 = int((py[0] + 0.5) * scale) // side, int((py[1] + 0.5) * scale) // side
    return tx0, ty0, tx1 - tx0 + 1, ty1 - ty0 + 1


def _within(
    water: np.ndarray, origin: tuple[int, int], zoom: int, side: int, lat: np.ndarray, lon: np.ndarray,
    reach: np.ndarray,
) -> np.ndarray:
    """Whether any pixel of `water` (a mosaic of `side`-pixel tiles from tile `origin`) lies within a square
    `reach` metres either side of each point, a pixel more for its own width."""
    table = np.zeros((water.shape[0] + 1, water.shape[1] + 1), dtype=np.int64)
    table[1:, 1:] = np.cumsum(np.cumsum(water, axis=0), axis=1)
    px, py = terrain._pixels(lat, lon, zoom)
    scale = side / terrain.TILE
    x = (px + 0.5) * scale - 0.5 - origin[0] * side
    y = (py + 0.5) * scale - 0.5 - origin[1] * side
    per_pixel = 2 * math.pi * terrain.EARTH_RADIUS * np.cos(np.radians(lat)) / (side << zoom)
    half = np.ceil(reach / per_pixel) + 1
    x0 = np.clip(np.floor(x - half).astype(np.int64), 0, water.shape[1])
    x1 = np.clip(np.floor(x + half).astype(np.int64) + 1, 0, water.shape[1])
    y0 = np.clip(np.floor(y - half).astype(np.int64), 0, water.shape[0])
    y1 = np.clip(np.floor(y + half).astype(np.int64) + 1, 0, water.shape[0])
    return (table[y1, x1] - table[y0, x1] - table[y1, x0] + table[y0, x0]) > 0


def _mapped(box: tuple[float, float, float, float], sea: bool) -> tuple[np.ndarray, int, tuple[int, int]] | None:
    """The sea (and the lakes, unless `sea`) as the map draws them over the box, laid as one mask with its
    level, or None when the box is too wide for it or a tile of it could not be read."""
    for zoom in range(water.ZOOM, (MAP_SEA_ZOOM_MIN if sea else water.ZOOM) - 1, -1):
        tx, ty, nx, ny = _tiles(box, zoom, water.SIDE)
        if nx * ny <= MAP_TILES_MAX:
            break
    else:
        return None
    out = np.zeros((ny * water.SIDE, nx * water.SIDE), dtype=bool)
    across = 1 << zoom
    for j in range(ny):
        for i in range(nx):
            read = water.masks(zoom, (tx + i) % across, ty + j)
            if read is None:
                return None
            seas, lakes = read
            out[j * water.SIDE:(j + 1) * water.SIDE, i * water.SIDE:(i + 1) * water.SIDE] = seas if sea else seas | lakes
    return out, zoom, (tx, ty)


def _flat(box: tuple[float, float, float, float], sampler: terrain.Sampler, sea: bool) -> tuple[np.ndarray, int, tuple[int, int]] | None:
    """Ground with no relief over the box, the sea alone at zero with `sea`, at the deepest level that lays it
    in `MOSAIC_TILES_MAX` terrain tiles: what the map would say when it cannot be read. A plain the tiles round
    to a flat step reads as water too, which only keeps more points."""
    for zoom in range(WATER_ZOOM, (SEA_FLAT_ZOOM_MIN if sea else WATER_ZOOM_MIN) - 1, -1):
        tx, ty, nx, ny = _tiles(box, zoom, terrain.TILE)
        if nx * ny <= MOSAIC_TILES_MAX:
            break
    else:
        return None
    heights = sampler.mosaic(zoom, tx, ty, nx, ny)
    # flat: a pixel and its eight neighbours within a few centimetres; the mosaic's own edge is never water
    padded = np.pad(heights, 1, mode="edge")
    high, low = heights.copy(), heights.copy()
    for dy in range(3):
        for dx in range(3):
            view = padded[dy:dy + heights.shape[0], dx:dx + heights.shape[1]]
            np.maximum(high, view, out=high)
            np.minimum(low, view, out=low)
    flat = high - low <= WATER_FLAT_M
    flat[0, :] = flat[-1, :] = flat[:, 0] = flat[:, -1] = False
    if sea:
        flat &= np.abs(heights) <= SEA_LEVEL_M
    return flat, zoom, (tx, ty)


@dataclass(frozen=True)
class Water:
    """Water laid as one mask over a box: its pixels, the map's level, the first tile across and down, and the
    side of its tiles in pixels (the map's or the terrain's)."""

    mask: np.ndarray
    zoom: int
    origin: tuple[int, int]
    side: int

    def at(self, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Where points fall on the mask, in pixels from its first pixel's middle."""
        px, py = terrain._pixels(lat, lon, self.zoom)
        scale = self.side / terrain.TILE
        return (px + 0.5) * scale - 0.5 - self.origin[0] * self.side, (py + 0.5) * scale - 0.5 - self.origin[1] * self.side

    def where(self, x: np.ndarray, y: np.ndarray, size: int = 1) -> tuple[np.ndarray, np.ndarray]:
        """The middles of pixels (x, y) of the mask pooled `size` pixels a side, as latitudes and longitudes."""
        world = float(self.side << self.zoom)
        gx = (np.asarray(x, dtype=np.float64) + 0.5) * size + self.origin[0] * self.side
        gy = (np.asarray(y, dtype=np.float64) + 0.5) * size + self.origin[1] * self.side
        return np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * gy / world)))), gx / world * 360.0 - 180.0

    def metres(self, lat: float) -> float:
        """A pixel's width at a latitude, metres."""
        return 2 * math.pi * terrain.EARTH_RADIUS * math.cos(math.radians(lat)) / (self.side << self.zoom)


def _water(lat: np.ndarray, lon: np.ndarray, reach: np.ndarray, sampler: terrain.Sampler, sea: bool) -> Water | None:
    """The sea, or the sea and the lakes, over every point's reach: as the map draws them, else as flat ground on
    the terrain; None when neither can be read."""
    far = float(np.max(reach))
    lat_pad = far / (math.radians(1) * terrain.EARTH_RADIUS)
    north = float(min(terrain.MAX_LAT, np.max(lat) + lat_pad))
    south = float(max(-terrain.MAX_LAT, np.min(lat) - lat_pad))
    lon_pad = lat_pad / max(0.05, math.cos(math.radians(max(abs(north), abs(south)))))
    west, east = float(np.min(lon) - lon_pad), float(np.max(lon) + lon_pad)
    if west < -180 or east > 180:
        return None
    box = (north, south, west, east)
    mapped = _mapped(box, sea)
    if mapped is not None:
        return Water(mapped[0], mapped[1], mapped[2], water.SIDE)
    flat = _flat(box, sampler, sea)
    return None if flat is None else Water(flat[0], flat[1], flat[2], terrain.TILE)


def _readable(reach: np.ndarray, sea: bool) -> np.ndarray:
    """Which reaches a water test reads: past them it keeps the point."""
    return reach <= (SEA_REACH_MAX_M if sea else REACH_MAX_M)


def water_within(
    lat: np.ndarray, lon: np.ndarray, reach: np.ndarray, sampler: terrain.Sampler, *, sea: bool,
) -> np.ndarray:
    """Whether the sea, or with `sea` False the sea or a lake, lies within a square `reach` metres either side
    of each point: as the map draws them (engine/water.py), else as flat ground on the terrain; True wherever
    the reach is too far to read."""
    keep = np.ones(lat.size, dtype=bool)
    read = _readable(reach, sea)
    if not read.any():
        return keep
    laid = _water(lat[read], lon[read], reach[read], sampler, sea)
    if laid is not None:
        keep[read] = _within(laid.mask, laid.origin, laid.zoom, laid.side, lat[read], lon[read], reach[read])
    return keep


def _pooled(mask: np.ndarray) -> list[np.ndarray]:
    """The mask and coarser copies of it, each pixel two of the one before either way, water where any was."""
    levels = [mask]
    while min(levels[-1].shape) > 1 and len(levels) < 16:
        last = levels[-1]
        rows, columns = (last.shape[0] + 1) // 2 * 2, (last.shape[1] + 1) // 2 * 2
        padded = np.zeros((rows, columns), dtype=bool)
        padded[:last.shape[0], :last.shape[1]] = last
        levels.append(padded.reshape(rows // 2, 2, columns // 2, 2).any(axis=(1, 3)))
    return levels


def _summed(mask: np.ndarray) -> np.ndarray:
    table = np.zeros((mask.shape[0] + 1, mask.shape[1] + 1), dtype=np.int64)
    table[1:, 1:] = np.cumsum(np.cumsum(mask, axis=0), axis=1)
    return table


def _range_bearing(lat0: float, lon0: float, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Great-circle distances (metres) and initial bearings (degrees) from one point to many."""
    p1, p2 = math.radians(lat0), np.radians(lat)
    dl = np.radians(lon - lon0)
    h = np.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    distance = 2 * terrain.EARTH_RADIUS * np.arcsin(np.minimum(1.0, np.sqrt(h)))
    bearing = np.degrees(np.arctan2(np.sin(dl) * np.cos(p2), math.cos(p1) * np.sin(p2) - math.sin(p1) * np.cos(p2) * np.cos(dl)))
    return distance, bearing % 360.0


def _aimed(bearing: np.ndarray, half: np.ndarray) -> np.ndarray:
    """The rays, `SIGHT_STEP` apart, that pass over cells seen at `bearing` and `half` a width either side."""
    count = int(round(360.0 / SIGHT_STEP))
    first = np.floor((bearing - half) / SIGHT_STEP).astype(np.int64)
    last = np.floor((bearing + half) / SIGHT_STEP).astype(np.int64)
    if np.any(last - first + 1 >= count):
        return (np.arange(count) + 0.5) * SIGHT_STEP
    # every span of rays marked once, round the turn: a running count over two turns, folded
    marks = np.zeros(3 * count + 1, dtype=np.int64)
    np.add.at(marks, first % count, 1)
    np.add.at(marks, first % count + (last - first) + 1, -1)
    hit = np.cumsum(marks)[:2 * count].reshape(2, count).sum(axis=0) > 0
    return (np.flatnonzero(hit) + 0.5) * SIGHT_STEP


def _sees(
    lat0: float, lon0: float, altitude: float, reach: float, laid: Water, pooled: list[np.ndarray],
    tables: list[np.ndarray], sampler: terrain.Sampler,
) -> bool:
    """Whether any water within `reach` metres is in sight from an eye `altitude` metres up at a point."""
    x, y = laid.at(np.array([lat0]), np.array([lon0]))
    pixel = laid.metres(lat0)
    # the finest pooling that leaves few enough cells of water within reach to aim at
    level = 0
    window = (0, 0, 0, 0)
    for level, table in enumerate(tables):
        size = 1 << level
        half = math.ceil(reach / (pixel * size)) + 1
        cx, cy = float((x[0] + 0.5) / size - 0.5), float((y[0] + 0.5) / size - 0.5)
        rows, columns = pooled[level].shape
        x0, x1 = min(max(math.floor(cx - half), 0), columns), min(max(math.floor(cx + half) + 1, 0), columns)
        y0, y1 = min(max(math.floor(cy - half), 0), rows), min(max(math.floor(cy + half) + 1, 0), rows)
        count = int(table[y1, x1] - table[y0, x1] - table[y1, x0] + table[y0, x0])
        if not count:
            return False
        window = (x0, x1, y0, y1)
        if count <= SIGHT_CELLS:
            break
    x0, x1, y0, y1 = window
    size = 1 << level
    rows_at, columns_at = np.nonzero(pooled[level][y0:y1, x0:x1])
    wlat, wlon = laid.where(columns_at + x0, rows_at + y0, size)
    distance, bearing = _range_bearing(lat0, lon0, wlat, wlon)
    cell = pixel * size
    near = distance <= reach + cell
    if not near.any():
        return False
    distance, bearing = distance[near], bearing[near]
    # water at the eye's feet is in sight whatever stands round
    if float(distance.min()) <= max(2 * cell, 2 * SIGHT_NEAR_M):
        return True
    azimuths = _aimed(bearing, np.degrees(np.arctan2(0.75 * cell, distance)))
    far = float(min(reach, distance.max() + cell))
    distances = horizon.ray_distances(far, SIGHT_NEAR_M, SIGHT_RATIO)
    spacing = np.maximum(SIGHT_NEAR_M, distances * SIGHT_RATIO)
    # each sample on the terrain level whose pixel is about its spacing
    bands = horizon._bands(horizon.lod_zooms(spacing / horizon.LOD_RATIO, lat0))
    ground = horizon._ground(horizon.Observer(lat0, lon0), azimuths, distances, bands, sampler, workers=1)
    angles = horizon.elevation_angle(distances[None, :], ground, altitude)
    before = np.concatenate([np.full((azimuths.size, 1), -np.inf), np.maximum.accumulate(angles, axis=1)[:, :-1]], axis=1)
    shown = horizon.elevation_angle(distances[None, :], ground + SIGHT_SLACK_M, altitude) >= before
    if not shown.any():
        return False
    ray, sample = np.nonzero(shown)
    slat, slon = terrain.destination(lat0, lon0, azimuths[ray], distances[sample])
    sx, sy = laid.at(slat, slon)
    # the water read pooled to each sample's spacing, so a narrow lake between two samples still shows
    levels = np.clip(np.ceil(np.log2(np.maximum(spacing[sample] / pixel, 1.0))), 0, len(pooled) - 1).astype(np.int64)
    for one in np.unique(levels):
        at = levels == one
        size = 1 << int(one)
        grid = pooled[int(one)]
        ix = np.floor((sx[at] + 0.5) / size).astype(np.int64)
        iy = np.floor((sy[at] + 0.5) / size).astype(np.int64)
        inside = (ix >= 0) & (iy >= 0) & (ix < grid.shape[1]) & (iy < grid.shape[0])
        if np.any(grid[iy[inside], ix[inside]]):
            return True
    return False


def water_seen(
    lat: np.ndarray, lon: np.ndarray, altitude: np.ndarray, reach: np.ndarray, sampler: terrain.Sampler, *,
    sea: bool, sight: Sight = "all", tell: Callable[[int], None] | None = None,
) -> tuple[np.ndarray, int]:
    """Whether the sea, or with `sea` False any water, is in sight within `reach` metres of an eye `altitude`
    metres up at each point (rays marched coarsely, `_sees`), True wherever the water cannot be read; and how
    many points were left unchecked. Points checked before are read back; the others are looked at with
    `sight="all"`, kept unchecked with "known". `tell(n)` is told after each point looked at, and may stop the
    work by raising."""
    keep = np.ones(lat.size, dtype=bool)
    read = _readable(reach, sea)
    keys = [_seen_key(sea, float(a), float(o), float(r), float(h)) for a, o, r, h in zip(lat, lon, reach, altitude)]
    left: list[int] = []
    with _SEEN_LOCK:
        for index in np.flatnonzero(read):
            known = _SEEN.get(keys[index])
            if known is None:
                left.append(int(index))
            else:
                keep[index] = known
    if not left or sight != "all":
        return keep, len(left)
    todo = np.array(left)
    laid = _water(lat[todo], lon[todo], reach[todo], sampler, sea)
    if laid is None:
        return keep, 0
    pooled = _pooled(laid.mask)
    tables = [_summed(level) for level in pooled]
    for n, at in enumerate(left):
        shown = _sees(float(lat[at]), float(lon[at]), float(altitude[at]), float(reach[at]), laid, pooled, tables,
                      sampler)
        keep[at] = shown
        with _SEEN_LOCK:
            _SEEN[keys[at]] = shown
            _SEEN.move_to_end(keys[at])
            while len(_SEEN) > SEEN_MAX:
                _SEEN.popitem(last=False)
        if tell is not None:
            tell(n + 1)
    return keep, 0


def _altitudes(plan: finder.Plan, ground: np.ndarray) -> np.ndarray:
    """The highest eye the plan searches at each point, above the sea; an aircraft's under the ground there
    as high as the ground (the search leaves such a point out)."""
    eye = max([*plan.final_heights, *plan.heights], default=horizon.EYE_HEIGHT)
    if plan.mode == "aircraft":
        return np.maximum(ground, eye)
    return np.maximum(ground, 0.0) + eye


def ruled(
    plan: finder.Plan, lat: np.ndarray, lon: np.ndarray, sampler: terrain.Sampler, *, sight: Sight = "no",
    tell: Callable[[int], None] | None = None, pending: list[int] | None = None,
) -> np.ndarray:
    """Why each point is ruled out (`REASONS`), '' where it stays. Water within reach is also looked for in sight
    (`water_seen`): with `sight="known"` as far as it was checked before, with "all" at every point, `tell(n)`
    told as each is; `pending` gets how many points with water within reach are still unchecked."""
    lat = np.atleast_1d(np.asarray(lat, dtype=np.float64))
    lon = np.atleast_1d(np.asarray(lon, dtype=np.float64))
    out = np.full(lat.size, "", dtype=object)
    unchecked = 0
    if not lat.size or not (plan.sea or plan.water or plan.over):
        if pending is not None:
            pending.append(0)
        return out
    if plan.over in ("above", "below"):
        risen = rise(lat, lon, sampler)
        if plan.over == "above":
            out[risen < -OVER_SLACK_M] = LOW
        else:
            out[risen > OVER_SLACK_M] = HIGH
    if plan.sea:
        left = out == ""
        if left.any():
            ground = np.asarray(sampler.heights(lat[left], lon[left], landform.ZOOM), dtype=np.float64)
            altitude = _altitudes(plan, ground)
            reach = finder.SEA_FAR * skymatch.BAND_SLACK * np.sqrt(2 * horizon.effective_radius() * np.maximum(finder.SEA_EYE_MIN, altitude))
            seen = water_within(lat[left], lon[left], reach, sampler, sea=True)
            out[np.flatnonzero(left)[~seen]] = NO_SEA
            if sight != "no" and seen.any():
                kept = np.flatnonzero(left)[seen]
                shown, waiting = water_seen(lat[kept], lon[kept], altitude[seen], reach[seen], sampler, sea=True,
                                            sight=sight, tell=tell)
                out[kept[~shown]] = SEA_HIDDEN
                unchecked += waiting
    if plan.water:
        left = out == ""
        if left.any():
            reach = np.full(int(left.sum()), finder.reaches(plan)[0])
            seen = water_within(lat[left], lon[left], reach, sampler, sea=False)
            out[np.flatnonzero(left)[~seen]] = NO_WATER
            if sight != "no" and seen.any():
                kept = np.flatnonzero(left)[seen]
                ground = np.asarray(sampler.heights(lat[kept], lon[kept], landform.ZOOM), dtype=np.float64)
                shown, waiting = water_seen(lat[kept], lon[kept], _altitudes(plan, ground), reach[seen], sampler,
                                            sea=False, sight=sight, tell=tell)
                out[kept[~shown]] = WATER_HIDDEN
                unchecked += waiting
    if pending is not None:
        pending.append(unchecked)
    return out
