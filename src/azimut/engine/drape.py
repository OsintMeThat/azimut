"""The ground's imagery laid over a panorama: what the eye would see in colour.

Every pixel of a panorama that meets the ground is a point on the map: the
eye, the pixel's azimuth, the distance the horizon march found there
(engine/horizon.py). Its colour is read from imagery tiles at the level whose
pixel matches the ground that panorama pixel covers, so the slope at the
observer's feet reads at street scale and a range eighty kilometres out at the
scale of a valley, the same way the march reads its terrain.

A tile with no picture at its level (a coverage gap, a placeholder) hands its
pixels to the level above, as the live map's proxy does. A view asks for a few
hundred tiles at most, from a free provider and through the same disk cache as
the map, and the count is bounded by coarsening the whole picture a level at a
time rather than by leaving holes.

A second provider can be laid on the ground nearer than a distance (`Near`):
Sentinel-2 on the valley at the eye's feet, the free imagery beyond, which is
how a billed picture is kept to the few tiles it is worth. Tiles may be 256 or
512 pixels (Sentinel Hub's), each read in its own grid.
"""

from __future__ import annotations

import io
import math
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
from PIL import Image

from . import terrain

TILE = 256
# Metres per pixel at level 0 of the 256 px grid, at the equator.
EQUATOR_PIXEL = 2 * math.pi * 6378137.0 / TILE
MIN_ZOOM = 2
# Tiles one picture may read; past this every level goes up one.
MAX_TILES = 700
FETCH_WORKERS = 16
# The colour of ground no level could picture: a neutral rock grey.
NO_IMAGE = (118, 112, 104)

# z, x, y → the tile's pixels as (256, 256, 3) uint8, or None where it has none
Fetch = Callable[[int, int, int], np.ndarray | None]


@dataclass(frozen=True)
class Near:
    """A provider laid on the ground nearer than `reach` metres, in its own grid."""

    reach: float
    fetch: Fetch
    ceiling: int
    tile: int = TILE


def decode(content: bytes, tile: int = TILE) -> np.ndarray | None:
    """A tile's pixels, or None for something that is not a picture."""
    try:
        with Image.open(io.BytesIO(content)) as image:
            rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    except OSError:
        return None
    if rgb.shape[:2] != (tile, tile):
        rgb = np.asarray(Image.fromarray(rgb).resize((tile, tile)), dtype=np.uint8)
    return rgb


def _exact(
    lat: np.ndarray, lon: np.ndarray, zoom: np.ndarray, tile: int = TILE
) -> tuple[np.ndarray, np.ndarray]:
    """Global pixel coordinates of each point at its own level, unrounded."""
    world = tile * np.exp2(zoom)
    sin = np.sin(np.radians(np.clip(lat, -terrain.MAX_LAT, terrain.MAX_LAT)))
    px = (lon + 180.0) / 360.0 * world
    py = (0.5 - np.log((1 + sin) / (1 - sin)) / (4 * math.pi)) * world
    return px, py


def _grid(
    lat: np.ndarray, lon: np.ndarray, zoom: np.ndarray, tile: int = TILE
) -> tuple[np.ndarray, np.ndarray]:
    """Global pixel column and row of each point at its own level."""
    px, py = _exact(lat, lon, zoom, tile)
    return np.floor(px).astype(np.int64), np.floor(py).astype(np.int64)


def _blend(pixels: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Bilinear colours inside one tile, `x`, `y` in its pixels from their centres.

    Ground seen a few metres away spans many panorama cells per imagery pixel,
    which nearest sampling draws as blocks; blending draws it soft, as a lens
    out of its depth of field would. At a tile's edge the last pixel is held.
    """
    size = pixels.shape[0]
    x = np.clip(x, 0.0, size - 1.0)
    y = np.clip(y, 0.0, size - 1.0)
    x0 = np.minimum(np.floor(x).astype(np.int64), size - 2)
    y0 = np.minimum(np.floor(y).astype(np.int64), size - 2)
    fx = (x - x0)[:, None]
    fy = (y - y0)[:, None]
    top = pixels[y0, x0] * (1 - fx) + pixels[y0, x0 + 1] * fx
    bottom = pixels[y0 + 1, x0] * (1 - fx) + pixels[y0 + 1, x0 + 1] * fx
    return np.rint(top * (1 - fy) + bottom * fy).astype(np.uint8)


def levels(lat: np.ndarray, footprint: np.ndarray, ceiling: int, tile: int = TILE) -> np.ndarray:
    """The level whose pixel is about the size of each panorama cell's ground."""
    metres = np.maximum(footprint, 0.05)
    zoom = np.floor(np.log2(EQUATOR_PIXEL * TILE / tile * np.cos(np.radians(lat)) / metres))
    return np.clip(zoom, MIN_ZOOM, ceiling).astype(np.int64)


def _keys(px: np.ndarray, py: np.ndarray, zoom: np.ndarray, tile: int = TILE) -> np.ndarray:
    """One integer per tile, unique across levels: level, then column, then row."""
    shift = int(math.log2(tile))
    return (zoom << 58) | ((px >> shift) << 29) | (py >> shift)


def _levels_within_budget(
    lat: np.ndarray, lon: np.ndarray, footprint: np.ndarray, ceiling: int, tile: int
) -> np.ndarray:
    """Each point's level, the whole picture coarsened a level at a time until it fits `MAX_TILES`."""
    zoom = levels(lat, footprint, ceiling, tile)
    while True:
        px, py = _grid(lat, lon, zoom, tile)
        if np.unique(_keys(px, py, zoom, tile)).size <= MAX_TILES or zoom.max() <= MIN_ZOOM:
            return zoom
        zoom = np.maximum(zoom - 1, MIN_ZOOM)


def tiles_for(
    lat: np.ndarray, lon: np.ndarray, footprint: np.ndarray, ceiling: int, tile: int = TILE,
) -> set[tuple[int, int, int]]:
    """The tiles a drape of these points would ask for first, `(z, x, y)`, none fetched."""
    if not lat.size:
        return set()
    zoom = _levels_within_budget(lat, lon, footprint, ceiling, tile)
    px, py = _grid(lat, lon, zoom, tile)
    shift = int(math.log2(tile))
    return {(int(z), int(x), int(y)) for z, x, y in zip(zoom, px >> shift, py >> shift)}


def drape(
    lat: np.ndarray, lon: np.ndarray, footprint: np.ndarray, fetch: Fetch, ceiling: int,
    tile: int = TILE,
) -> tuple[np.ndarray, set[int]]:
    """Colours for ground points, and the levels that gave them.

    `lat`, `lon` are the points, `footprint` the ground each panorama cell
    covers there in metres; `tile` the provider's tile size in pixels.
    """
    count = lat.size
    colours = np.empty((count, 3), dtype=np.uint8)
    colours[:] = NO_IMAGE
    if not count:
        return colours, set()
    zoom = _levels_within_budget(lat, lon, footprint, ceiling, tile)
    shift = int(math.log2(tile))

    held: dict[int, np.ndarray | None] = {}
    used: set[int] = set()
    pending = np.arange(count)
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        while pending.size:
            z = zoom[pending]
            fx, fy = _exact(lat[pending], lon[pending], z, tile)
            px, py = np.floor(fx).astype(np.int64), np.floor(fy).astype(np.int64)
            keys = _keys(px, py, z, tile)
            wanted = [int(k) for k in np.unique(keys) if int(k) not in held]

            def one(key: int) -> tuple[int, np.ndarray | None]:
                level = key >> 58
                column = (key >> 29) & ((1 << 29) - 1)
                row = key & ((1 << 29) - 1)
                return key, fetch(level, column, row)

            for key, pixels in pool.map(one, wanted):
                held[key] = pixels
            missing = np.zeros(pending.size, dtype=bool)
            order = np.argsort(keys, kind="stable")
            starts = np.flatnonzero(np.diff(keys[order])) + 1
            for segment in np.split(order, starts):
                key = int(keys[segment[0]])
                pixels = held[key]
                if pixels is None:
                    missing[segment] = True
                    continue
                left = (px[segment] >> shift) * tile
                top = (py[segment] >> shift) * tile
                colours[pending[segment]] = _blend(
                    pixels.astype(np.float32), fx[segment] - left - 0.5, fy[segment] - top - 0.5
                )
                used.add(key >> 58)
            # a gap at one level is asked of the one above, down to the coarsest
            retry = missing & (z > MIN_ZOOM)
            zoom[pending[retry]] -= 1
            pending = pending[retry]
    return colours, used


def ground_points(
    observer_lat: float, observer_lon: float, azimuths: np.ndarray, step: float, depth: np.ndarray,
) -> tuple[tuple[np.ndarray, np.ndarray], np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """A panorama's ground cells as points: their (rows, columns), lat, lon, distance and footprint."""
    ground = np.isfinite(depth)
    row_index, column_index = np.nonzero(ground)
    distance = depth[ground].astype(np.float64)
    lat, lon = terrain.destination(observer_lat, observer_lon, azimuths[column_index], distance)
    return (row_index, column_index), np.asarray(lat), np.asarray(lon), distance, distance * math.radians(step)


def drape_panorama(
    observer_lat: float, observer_lon: float, azimuths: np.ndarray, step: float,
    depth: np.ndarray, fetch: Fetch, ceiling: int, *, near: Near | None = None,
) -> tuple[np.ndarray, set[int]]:
    """A panorama's colour picture, (rows, columns, 3).

    `depth` is the panorama's distance raster (NaN for sky) over `azimuths`
    columns at `step` degrees a cell. The sky of each column takes the colour
    of the skyline under it, so a browser blending neighbouring cells never
    darkens a ridge's edge with sky it does not draw anyway. With `near`, its
    provider colours the ground nearer than its reach.
    """
    rows, columns = depth.shape
    picture = np.zeros((rows, columns, 3), dtype=np.uint8)
    ground = np.isfinite(depth)
    if not ground.any():
        return picture, set()
    (row_index, column_index), lat, lon, distance, footprint = ground_points(
        observer_lat, observer_lon, azimuths, step, depth
    )
    colours = np.empty((lat.size, 3), dtype=np.uint8)
    close = distance < near.reach if near else np.zeros(lat.size, dtype=bool)
    colours[~close], used = drape(lat[~close], lon[~close], footprint[~close], fetch, ceiling)
    if near and close.any():
        colours[close], _near_used = drape(
            lat[close], lon[close], footprint[close], near.fetch, near.ceiling, near.tile
        )
    picture[row_index, column_index] = colours
    # a column is sky down to its skyline, then ground all the way down
    first = np.argmax(ground, axis=0)
    has_ground = ground.any(axis=0)
    skyline = picture[first, np.arange(columns)]
    sky = (np.arange(rows)[:, None] < first[None, :]) & has_ground[None, :]
    picture[sky] = np.broadcast_to(skyline[None, :, :], picture.shape)[sky]
    return picture, used
