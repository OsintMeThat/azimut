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
a lake), read over the whole reach. Where the map cannot be read, it is ground with no relief on the terrain
(engine/landform.py): the sea at zero, the lakes GLO-30 flattens, and plains the tiles round to a flat step,
which only keep more points. A point keeps its test when any water lies within a square its reach wide either
side: the square holds the disk, so it errs towards keeping. A reach past `REACH_MAX_M` keeps every point.

The reasons are said as the ground a point stands on is (finder `preview`), so the map greys a point ruled
out and says why.
"""

from __future__ import annotations

import math

import numpy as np

from . import finder, landform, skymatch, terrain, water

# The reasons a point is ruled out, as the preview says its ground.
NO_SEA = "nosea"
NO_WATER = "nowater"
LOW = "low"
HIGH = "high"
REASONS = (NO_SEA, NO_WATER, LOW, HIGH)
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
MAP_SEA_ZOOM_MIN = 6
REACH_MAX_M = 300_000.0
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
    for zoom in range(WATER_ZOOM, WATER_ZOOM_MIN - 1, -1):
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


def water_within(
    lat: np.ndarray, lon: np.ndarray, reach: np.ndarray, sampler: terrain.Sampler, *, sea: bool,
) -> np.ndarray:
    """Whether the sea, or with `sea` False the sea or a lake, lies within a square `reach` metres either side
    of each point: as the map draws them (engine/water.py), else as flat ground on the terrain; True wherever
    the reach is too far to read."""
    keep = np.ones(lat.size, dtype=bool)
    read = reach <= REACH_MAX_M
    if not read.any():
        return keep
    far = float(np.max(reach[read]))
    lat_pad = far / (math.radians(1) * terrain.EARTH_RADIUS)
    north = float(min(terrain.MAX_LAT, np.max(lat[read]) + lat_pad))
    south = float(max(-terrain.MAX_LAT, np.min(lat[read]) - lat_pad))
    lon_pad = lat_pad / max(0.05, math.cos(math.radians(max(abs(north), abs(south)))))
    west, east = float(np.min(lon[read]) - lon_pad), float(np.max(lon[read]) + lon_pad)
    if west < -180 or east > 180:
        return keep
    box = (north, south, west, east)
    mapped = _mapped(box, sea)
    if mapped is not None:
        mask, zoom, origin = mapped
        keep[read] = _within(mask, origin, zoom, water.SIDE, lat[read], lon[read], reach[read])
        return keep
    flat = _flat(box, sampler, sea)
    if flat is not None:
        mask, zoom, origin = flat
        keep[read] = _within(mask, origin, zoom, terrain.TILE, lat[read], lon[read], reach[read])
    return keep


def ruled(plan: finder.Plan, lat: np.ndarray, lon: np.ndarray, sampler: terrain.Sampler) -> np.ndarray:
    """Why each point is ruled out (`REASONS`), '' where it stays."""
    lat = np.atleast_1d(np.asarray(lat, dtype=np.float64))
    lon = np.atleast_1d(np.asarray(lon, dtype=np.float64))
    out = np.full(lat.size, "", dtype=object)
    if not lat.size or not (plan.sea or plan.water or plan.over):
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
            eye = max([*plan.final_heights, *plan.heights], default=0.0)
            ground = np.asarray(sampler.heights(lat[left], lon[left], landform.ZOOM), dtype=np.float64)
            reach = np.array([
                finder.SEA_FAR * skymatch.BAND_SLACK * finder.sea_horizon(max(0.0, float(g)) + eye) for g in ground
            ])
            seen = water_within(lat[left], lon[left], reach, sampler, sea=True)
            out[np.flatnonzero(left)[~seen]] = NO_SEA
    if plan.water:
        left = out == ""
        if left.any():
            reach = np.full(int(left.sum()), finder.reaches(plan)[0])
            seen = water_within(lat[left], lon[left], reach, sampler, sea=False)
            out[np.flatnonzero(left)[~seen]] = NO_WATER
    return out
