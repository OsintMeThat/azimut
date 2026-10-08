"""Shadows the sun or the moon casts over the ground a panorama shows.

A face turned away from the light is already dark in the browser, which lights
the relief from the ground's normal (renderer.js). What the normal cannot say
is that a ridge stands between a sunlit face and the sun: that is a march, from
each ground point toward the light, over the same terrain the horizon reads.

The march is vectorised over every point at once and stops for each as soon as
its answer is known: once its ray toward the light has climbed over the
highest ground around, or once the ground it met hides the light's whole disc.
Steps lengthen with the distance marched and read coarser terrain as they go,
the way the horizon sweep does, so a far march reads a handful of tiles.

The answer is how much of the light's disc each point sees, 0 to 1, so a
shadow's edge is as soft as the sun's own width makes it on the ground.
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from . import horizon, terrain

# The sun's and the moon's apparent width, in degrees.
DISC = 0.53
# The first step clears the terrain pixel the point stands on.
FIRST_STEP = 15.0
# Each step this share farther than the last.
STEP_RATIO = 0.06
# Past this no ridge is worth the march: a light this low is all but set.
MARCH_MAX = 60_000.0
# The terrain level a step reads: a pixel about this share of the distance marched,
# a third of a step, so a crest a step crosses is not smoothed away.
LOD_RATIO = 0.02
# Points marched together, and blocks marched side by side (numpy lets go of the
# interpreter while it works, as the horizon sweep's blocks do).
BLOCK = 16_384
WORKERS = 4
# A point stands this high over the ground it was read from, so its own pixel never hides it.
LIFT = 1.0
# The highest ground a march may meet is read on a coarse grid this many points a side, then
# raised by a margin and a share of its pixel: coarse terrain rounds summits off.
CEILING_GRID = 96
CEILING_MARGIN = 300.0
CEILING_PIXEL_SHARE = 0.3


def ceiling(
    lat: np.ndarray, lon: np.ndarray, light_azimuth: float, longest: float, sampler: terrain.Sampler,
) -> float:
    """The highest the ground can stand anywhere these points' marches may reach, in metres.

    Read on a coarse grid over the points and the same box moved `longest`
    metres toward the light, so the march knows when nothing higher is left.
    """
    north = longest * math.cos(math.radians(light_azimuth))
    east = longest * math.sin(math.radians(light_azimuth))
    middle = math.radians(float(np.mean(lat)))
    shift_lat = math.degrees(north / terrain.EARTH_RADIUS)
    shift_lon = math.degrees(east / (terrain.EARTH_RADIUS * math.cos(middle)))
    south, north_edge = float(lat.min()), float(lat.max())
    west, east_edge = float(lon.min()), float(lon.max())
    box_lat = (min(south, south + shift_lat), max(north_edge, north_edge + shift_lat))
    box_lon = (min(west, west + shift_lon), max(east_edge, east_edge + shift_lon))
    box_lat = (max(box_lat[0], -terrain.MAX_LAT), min(box_lat[1], terrain.MAX_LAT))
    across = max(
        (box_lat[1] - box_lat[0]) * 111_195.0,
        (box_lon[1] - box_lon[0]) * 111_195.0 * math.cos(middle),
        1.0,
    )
    pixel = across / CEILING_GRID
    zoom = terrain.zoom_for(pixel, math.degrees(middle))
    grid_lat, grid_lon = np.meshgrid(
        np.linspace(box_lat[0], box_lat[1], CEILING_GRID),
        np.linspace(box_lon[0], box_lon[1], CEILING_GRID),
        indexing="ij",
    )
    highest = float(sampler.heights(grid_lat, grid_lon, zoom).max())
    return highest + CEILING_MARGIN + CEILING_PIXEL_SHARE * terrain.metres_per_pixel(math.degrees(middle), zoom)


def levels(distance: np.ndarray, lat: float) -> np.ndarray:
    """The terrain level the horizon sweep reads at each distance (`horizon.lod_zooms`), at once."""
    metres = np.maximum(np.asarray(distance, dtype=np.float64) * horizon.LOD_RATIO, 1.0)
    across = 2 * math.pi * terrain.EARTH_RADIUS * math.cos(math.radians(lat)) / terrain.TILE
    return np.clip(np.ceil(np.log2(across / metres)), 0, terrain.MAX_ZOOM).astype(np.int64)


def march_distances(longest: float) -> np.ndarray:
    """The distances a march steps through, out to `longest` metres."""
    longest = max(FIRST_STEP, min(longest, MARCH_MAX))
    count = math.ceil(math.log(longest / FIRST_STEP) / math.log1p(STEP_RATIO)) + 1
    return FIRST_STEP * (1.0 + STEP_RATIO) ** np.arange(count)


def lit_fraction(
    lat: np.ndarray, lon: np.ndarray, zooms: np.ndarray, light_azimuth: float,
    light_altitude: float, sampler: terrain.Sampler, *, k: float = horizon.REFRACTION_K,
) -> np.ndarray:
    """How much of the light each ground point sees, 0 (in shadow) to 1.

    `zooms` is the terrain level each point is read at, the level its panorama
    cell reads (finer near the eye, coarser far out). The light stands at
    `light_azimuth`, `light_altitude` degrees, as seen from the ground.
    """
    count = np.asarray(lat).size
    if not count:
        return np.ones(0, dtype=np.float32)
    if light_altitude <= -DISC / 2:
        return np.zeros(count, dtype=np.float32)
    # by level, once: every read below is then a run of neighbours
    order = np.argsort(np.asarray(zooms, dtype=np.int64).ravel(), kind="stable")
    lat = np.asarray(lat, dtype=np.float64).ravel()[order]
    lon = np.asarray(lon, dtype=np.float64).ravel()[order]
    zooms = np.asarray(zooms, dtype=np.int64).ravel()[order]

    ground = np.empty(count, dtype=np.float32)
    for zoom, run in _runs(zooms):
        ground[run] = sampler.heights(lat[run], lon[run], zoom)
    base = ground.astype(np.float64) + LIFT

    rise = math.tan(math.radians(max(light_altitude, 0.05)))
    # the highest ground the marches could meet, over as far as the lowest point must look
    highest = max(float(ground.max()), ceiling(lat, lon, light_azimuth, MARCH_MAX, sampler))
    distances = march_distances((highest - float(base.min())) / rise)
    altitude = math.radians(light_altitude)
    # a point is done once its ray toward the light has cleared the highest
    # ground, or once that ground hides the whole disc
    reach = (highest - base) / rise
    hidden = altitude + math.radians(DISC / 2)
    north = math.degrees(math.cos(math.radians(light_azimuth)) / terrain.EARTH_RADIUS)
    east = math.degrees(math.sin(math.radians(light_azimuth)) / terrain.EARTH_RADIUS)
    widen = 1.0 / np.cos(np.radians(lat))
    blocked = np.full(count, -np.inf)

    def march(block: slice) -> None:
        active = np.arange(block.start, min(block.stop, count))
        active = active[reach[active] > 0]
        middle = float(np.mean(lat[block]))
        for distance in distances:
            if not active.size:
                break
            la = lat[active] + distance * north
            lo = lon[active] + distance * east * widen[active]
            step_zoom = terrain.zoom_for(max(distance * LOD_RATIO, 1.0), middle)
            level = np.minimum(zooms[active], step_zoom)
            heights = np.empty(active.size, dtype=np.float64)
            for zoom, run in _runs(level):
                heights[run] = sampler.heights(la[run], lo[run], zoom)
            # seen from the point: its own height taken off the ground ahead
            angle = horizon.elevation_angle(distance, heights - base[active], 0.0, k)
            seen = np.maximum(blocked[active], angle)
            blocked[active] = seen
            active = active[(distance < reach[active]) & (seen < hidden)]

    blocks = [slice(start, start + BLOCK) for start in range(0, count, BLOCK)]
    if len(blocks) > 1:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            list(pool.map(march, blocks))
    else:
        march(blocks[0])

    lit = np.empty(count, dtype=np.float32)
    lit[order] = np.clip((altitude - blocked) / math.radians(DISC) + 0.5, 0.0, 1.0)
    return lit


def _runs(sorted_levels: np.ndarray) -> list[tuple[int, slice]]:
    """Runs of one level in levels sorted in order."""
    edges = np.flatnonzero(np.diff(sorted_levels)) + 1
    starts = np.concatenate([[0], edges])
    ends = np.concatenate([edges, [sorted_levels.size]])
    return [(int(sorted_levels[a]), slice(int(a), int(b))) for a, b in zip(starts, ends)]


def shadow_panorama(
    observer_lat: float, observer_lon: float, azimuths: np.ndarray, step: float,
    depth: np.ndarray, light_azimuth: float, light_altitude: float,
    sampler: terrain.Sampler, *, k: float = horizon.REFRACTION_K,
) -> np.ndarray:
    """A panorama's light raster, (rows, columns) uint8: 255 lit, 0 in shadow.

    `depth` is the panorama's distance raster (NaN for sky) over `azimuths`
    columns at `step` degrees a cell. Sky is lit, so a browser blending
    neighbouring cells never darkens a ridge's edge with it.
    """
    rows, columns = depth.shape
    light = np.full((rows, columns), 255, dtype=np.uint8)
    ground = np.isfinite(depth)
    if not ground.any():
        return light
    row_index, column_index = np.nonzero(ground)
    distance = depth[ground].astype(np.float64)
    lat, lon = terrain.destination(observer_lat, observer_lon, azimuths[column_index], distance)
    # each point read at the level the sweep read its cell at
    zooms = levels(distance, observer_lat)
    lit = lit_fraction(np.asarray(lat), np.asarray(lon), zooms, light_azimuth, light_altitude, sampler, k=k)
    light[row_index, column_index] = np.rint(lit * 255).astype(np.uint8)
    return light
