"""What can be seen from a point: the one horizon every relief tool reads.

Horizon's panorama, the viewpoint finder, the sun going behind a ridge and the
viewshed all ask this module, so they cannot disagree about a ridge.

How it is computed. Rays leave the observer at every azimuth step and are
sampled outward, finely near the eye and in growing steps farther out, each
sample reading the terrain level whose pixel matches its spacing (Mapterhorn's
z14 near a Swiss eye, z8 a hundred kilometres out). Each sample's elevation angle
is taken on a sphere enlarged for refraction (radius R / (1 − k), k = 0.13 by
default), which is the standard surveying model: at 100 km the Earth hides about
680 m of a mountain's foot.

Walking a ray outward, a sample is in sight when its angle reaches the highest
angle seen so far. Three things follow from that running maximum:

- the skyline: its last value, and where along the ray it was set;
- the ridges: a sample in sight whose next stretch of ground drops out of sight,
  the silhouettes a panorama draws at their own depth;
- the picture: a pixel at elevation θ shows the first sample whose running
  maximum reaches θ, the column-by-column "voxel space" rendering. A panorama is
  therefore exact to this model by construction, not a second renderer that
  happens to agree.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from . import terrain

REFRACTION_K = 0.13
EYE_HEIGHT = 1.7
# Ray sampling: fixed steps near the eye, then steps growing with distance. At
# 0.003 a step spans 0.17° of the view, finer than the terrain under it.
NEAR_STEP = 5.0
STEP_RATIO = 0.003
# Terrain level per distance: a pixel about this fraction of the distance.
LOD_RATIO = 0.003
FAR_MAX = 500_000.0
# Azimuths marched at once; bounds the memory a full turn needs.
CHUNK = 240
# Threads a sweep reads levels and marches blocks on.
WORKERS = 4
# A ridge is drawn where the ground behind it stays out of sight for at least
# this long, absolutely and as a share of its distance. Shorter dips are the
# texture of a slope, not a skyline.
RIDGE_GAP_M = 150.0
RIDGE_GAP_RATIO = 0.04

Mode = Literal["ground", "drone", "aircraft"]


class BelowGround(ValueError):
    """An aircraft altitude under the terrain it is said to fly over."""


@dataclass(frozen=True)
class Observer:
    """Where the eye is.

    `height` is above the ground for a person or a drone, and above the sea for
    an aircraft, which is how each of them reports it.
    """

    lat: float
    lon: float
    mode: Mode = "ground"
    height: float = EYE_HEIGHT

    def altitude(self, ground: float) -> float:
        if self.mode == "aircraft":
            if self.height < ground:
                raise BelowGround(
                    f"An aircraft at {self.height:.0f} m would be under the ground here "
                    f"({ground:.0f} m)"
                )
            return self.height
        return ground + self.height


def effective_radius(k: float = REFRACTION_K) -> float:
    return terrain.EARTH_RADIUS / (1.0 - k)


def elevation_angle(
    distance: np.ndarray | float, height: np.ndarray | float, altitude: float,
    k: float = REFRACTION_K,
) -> np.ndarray:
    """Apparent elevation in radians of ground `height` m high, `distance` m away.

    Exact on the refraction-enlarged sphere, so it holds for an aircraft eye
    too, where the flat-earth-plus-drop shortcut drifts.
    """
    radius = effective_radius(k)
    delta = np.asarray(distance, dtype=np.float64) / radius
    reach = radius + np.asarray(height, dtype=np.float64)
    return np.arctan2(reach * np.cos(delta) - (radius + altitude), reach * np.sin(delta))


def ray_distances(far: float, near_step: float = NEAR_STEP, ratio: float = STEP_RATIO) -> np.ndarray:
    """Sample distances along one ray, from `near_step` to `far` metres."""
    far = float(min(max(far, near_step * 2), FAR_MAX))
    switch = near_step / ratio
    near = np.arange(near_step, min(switch, far), near_step)
    if switch >= far:
        return np.append(near, far)
    steps = math.ceil(math.log(far / switch) / math.log1p(ratio))
    return np.concatenate([near, switch * (1.0 + ratio) ** np.arange(steps + 1)])


def lod_zooms(distances: np.ndarray, lat: float) -> np.ndarray:
    """The terrain level each sample reads: pixel ≈ LOD_RATIO × distance."""
    return np.array([terrain.zoom_for(max(d * LOD_RATIO, 1.0), lat) for d in distances])


def default_far(observer: Observer) -> float:
    """How far to look by default: 150 km from the ground, more from an aircraft."""
    return 300_000.0 if observer.mode == "aircraft" else 150_000.0


@dataclass
class Horizon:
    """One sweep: the skyline, the ridges, and optionally the picture."""

    observer: Observer
    ground: float  # terrain height under the observer
    altitude: float  # the eye, above the sea
    k: float
    far: float
    azimuths: np.ndarray  # degrees, one per column
    skyline: np.ndarray  # degrees, highest angle per azimuth
    skyline_distance: np.ndarray  # metres to the ground that sets it
    # Ridges, flattened: the column, the angle (degrees) and the distance (metres)
    ridge_column: np.ndarray
    ridge_angle: np.ndarray
    ridge_distance: np.ndarray
    # The picture, when rows were asked for: distance per pixel (NaN = sky),
    # rows from the top, and the ground's unit normal there as its east and
    # north components (the up one follows). The normal rather than a shade, so
    # the browser can light the relief from any sun without a new sweep.
    rows: np.ndarray | None = None
    depth: np.ndarray | None = None
    normal_east: np.ndarray | None = None
    normal_north: np.ndarray | None = None
    sources: set[str] = field(default_factory=set)
    zooms: set[int] = field(default_factory=set)


def sweep(
    observer: Observer,
    *,
    azimuths: Sequence[float] | np.ndarray,
    far: float | None = None,
    k: float = REFRACTION_K,
    rows: Sequence[float] | np.ndarray | None = None,
    sampler: terrain.Sampler | None = None,
    near_step: float = NEAR_STEP,
    near: float = 0.0,
) -> Horizon:
    """March rays at `azimuths` (degrees) and read what they see.

    `rows`, elevation angles in degrees from the top of the picture down, turn on
    the picture. `near` starts every ray that far out, which takes away the
    ground in front, a hill that hides the range behind it.
    """
    sampler = sampler or terrain.Sampler()
    ground = float(sampler.heights(observer.lat, observer.lon, terrain.MAX_ZOOM))
    altitude = observer.altitude(ground)
    far = float(far if far is not None else default_far(observer))
    az = np.asarray(azimuths, dtype=np.float64)
    distances = ray_distances(far, near_step)
    if near > 0:
        distances = distances[distances >= min(near, float(distances[-1]))]
    zooms = lod_zooms(distances, observer.lat)
    bands = _bands(zooms)
    row_angles = None if rows is None else np.radians(np.asarray(rows, dtype=np.float64))

    skyline = np.empty(az.size)
    skyline_distance = np.empty(az.size)
    depth = normal_east = normal_north = None
    if row_angles is not None:
        depth = np.full((row_angles.size, az.size), np.nan, dtype=np.float32)
        normal_east = np.zeros((row_angles.size, az.size), dtype=np.float32)
        normal_north = np.zeros((row_angles.size, az.size), dtype=np.float32)

    ground_all = _ground(observer, az, distances, bands, sampler)
    if row_angles is not None:
        pixel = np.array([terrain.metres_per_pixel(observer.lat, int(z)) for z in zooms])
        east_all, north_all = _normals(ground_all, distances, az, pixel)

    def march(start: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """One block of azimuths: its skyline, ridges and picture columns."""
        chunk = az[start:start + CHUNK]
        heights = ground_all[start:start + chunk.size]
        angles = elevation_angle(distances[None, :], heights, altitude, k)
        reach = np.maximum.accumulate(angles, axis=1)

        last = reach[:, -1]
        skyline[start:start + chunk.size] = np.degrees(last)
        skyline_distance[start:start + chunk.size] = distances[np.argmax(angles, axis=1)]
        found = _ridges(angles, reach, distances, start)

        if row_angles is not None and depth is not None:
            index = _first_reaching(reach, row_angles)
            sky = index >= distances.size
            hit = np.where(sky, 0, index)
            before = np.maximum(hit - 1, 0)
            columns = np.arange(chunk.size)[None, :]
            # The row's ray meets the ground between the sample before and the
            # one it reaches. Placing it between them by angle keeps a steep
            # face seen from afar from smearing one sample down many rows.
            a0, a1 = angles[columns, before], angles[columns, hit]
            share = np.where(
                hit > 0, np.clip((row_angles[:, None] - a0) / np.maximum(a1 - a0, 1e-12), 0, 1), 1
            )
            block = (distances[before] + share * (distances[hit] - distances[before]))
            block = block.astype(np.float32)
            block[sky] = np.nan
            depth[:, start:start + chunk.size] = block
            east = east_all[start:start + chunk.size]
            north = north_all[start:start + chunk.size]
            for source, target in ((east, normal_east), (north, normal_north)):
                v0, v1 = source[columns, before], source[columns, hit]
                picked = v0 + share * (v1 - v0)
                picked[sky] = 0
                target[:, start:start + chunk.size] = picked  # type: ignore[index]
        return found

    # blocks write disjoint columns, and numpy lets go of the interpreter
    # while it works, so they run side by side
    starts = range(0, az.size, CHUNK)
    if len(starts) > 1:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            ridges = list(pool.map(march, starts))
    else:
        ridges = [march(start) for start in starts]

    column, angle, dist = (np.concatenate(parts) for parts in zip(*ridges))
    return Horizon(
        observer=observer, ground=ground, altitude=altitude, k=k, far=far,
        azimuths=az, skyline=skyline, skyline_distance=skyline_distance,
        ridge_column=column, ridge_angle=angle, ridge_distance=dist,
        rows=None if rows is None else np.asarray(rows, dtype=np.float64),
        depth=depth, normal_east=normal_east, normal_north=normal_north,
        sources=set(sampler.sources), zooms=set(sampler.zooms),
    )


def _ground(
    observer: Observer, azimuths: np.ndarray, distances: np.ndarray,
    bands: list[tuple[int, slice]], sampler: terrain.Sampler,
) -> np.ndarray:
    """The ground height under every sample of every ray, (azimuths, distances).

    One terrain level at a time: each level is one read over the whole turn,
    which the sampler answers off its tiles laid side by side rather than tile
    by tile (`terrain.Sampler._sample_mosaic`). The levels are read side by
    side, each into its own columns.
    """
    ground = np.empty((azimuths.size, distances.size), dtype=np.float32)

    def read(item: tuple[int, slice]) -> None:
        zoom, band = item
        lat, lon = terrain.destination(
            observer.lat, observer.lon, azimuths[:, None], distances[None, band]
        )
        ground[:, band] = sampler.heights(lat, lon, zoom)

    if len(bands) > 1 and azimuths.size > 1:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            list(pool.map(read, bands))
    else:
        for item in bands:
            read(item)
    return ground


def _bands(zooms: np.ndarray) -> list[tuple[int, slice]]:
    """Contiguous runs of samples reading the same level (zoom falls with distance)."""
    edges = np.flatnonzero(np.diff(zooms)) + 1
    starts = np.concatenate([[0], edges])
    ends = np.concatenate([edges, [zooms.size]])
    return [(int(zooms[s]), slice(int(s), int(e))) for s, e in zip(starts, ends)]


def _ridges(
    angles: np.ndarray, reach: np.ndarray, distances: np.ndarray, column0: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Silhouettes: in-sight samples whose next stretch of ground falls out of sight."""
    count = distances.size
    before = np.concatenate([np.full((angles.shape[0], 1), -np.inf), reach[:, :-1]], axis=1)
    seen = angles >= before
    edge = seen.copy()
    edge[:, :-1] &= ~seen[:, 1:]
    # index of the next sample in sight, or `count` when nothing beyond is seen
    marks = np.where(seen, np.arange(count)[None, :], count)
    following = np.concatenate(
        [np.minimum.accumulate(marks[:, ::-1], axis=1)[:, ::-1][:, 1:],
         np.full((angles.shape[0], 1), count)], axis=1
    )
    reopen = np.where(following < count, distances[np.minimum(following, count - 1)], np.inf)
    gap = reopen - distances[None, :]
    keep = edge & (gap >= np.maximum(RIDGE_GAP_M, RIDGE_GAP_RATIO * distances[None, :]))
    rows, cols = np.nonzero(keep)
    return (
        (rows + column0).astype(np.int32),
        np.degrees(angles[rows, cols]).astype(np.float32),
        distances[cols].astype(np.float32),
    )


def _first_reaching(reach: np.ndarray, row_angles: np.ndarray) -> np.ndarray:
    """For each row and column, the first sample whose running maximum reaches the row.

    `reach` rises along each ray, so the answer is one searchsorted per column;
    offsetting each column by more than the span of an angle lets one flat
    search answer them all. Returns (rows, columns); `count` means sky.
    """
    columns, count = reach.shape
    offset = (np.arange(columns) * 4.0)[:, None]  # angles span at most π
    flat = (reach + offset).ravel()
    queries = (row_angles[None, :] + offset).ravel()
    found = np.searchsorted(flat, queries, side="left").reshape(columns, row_angles.size)
    index = found - (np.arange(columns) * count)[:, None]
    return np.minimum(index, count).T


def _normals(
    heights: np.ndarray, distances: np.ndarray, azimuths: np.ndarray, pixel: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """East and north components of the ground's unit normal at every sample.

    Slopes are read along each ray and across neighbouring rays at the same
    distance, then turned from the ray's frame into the map's. Across rays, the
    slope is taken between rays at least a terrain pixel apart (`pixel`, metres
    per sample): near the eye, rays a tenth of a degree apart are closer than
    that, and a slope read between them steps from pixel to pixel of the
    interpolated terrain, which a lit relief shows as streaks.
    """
    along = np.gradient(heights, distances, axis=1)
    count = heights.shape[0]
    across = np.zeros_like(along)
    if count > 1:
        whole_turn = bool(np.isclose((azimuths[1] - azimuths[0]) * count, 360.0))
        step = np.radians(np.median(np.diff(azimuths))) if count > 1 else 1.0
        spacing = np.maximum(step * distances, 1e-6)
        strides = np.clip(np.ceil(pixel / spacing), 1, max(1, count // 4)).astype(int)
        rows = np.arange(count)
        for stride in np.unique(strides):
            columns = strides == stride
            if whole_turn:
                ahead, behind = (rows + stride) % count, (rows - stride) % count
                span = np.full(count, 2.0 * stride)
            else:
                ahead = np.minimum(rows + stride, count - 1)
                behind = np.maximum(rows - stride, 0)
                span = (ahead - behind).astype(np.float64)
            band = heights[:, columns]
            rise = band[ahead] - band[behind]
            across[:, columns] = rise / (np.maximum(span, 1.0)[:, None] * spacing[None, columns])
    theta = np.radians(azimuths)[:, None]
    # slope along the ray points away from the eye; across points to its right
    rise_east = along * np.sin(theta) + across * np.cos(theta)
    rise_north = along * np.cos(theta) - across * np.sin(theta)
    norm = np.sqrt(rise_east**2 + rise_north**2 + 1.0)
    return (-rise_east / norm).astype(np.float32), (-rise_north / norm).astype(np.float32)


def line_of_sight(
    observer: Observer, lat: float, lon: float, target_height: float = 0.0,
    *, k: float = REFRACTION_K, sampler: terrain.Sampler | None = None,
) -> tuple[bool, float, float]:
    """Whether a point is in sight, its elevation angle and the margin, both in degrees.

    The margin is how far the point stands above (positive) or below the highest
    ground between, as seen from the eye.
    """
    sampler = sampler or terrain.Sampler()
    ground = float(sampler.heights(observer.lat, observer.lon, terrain.MAX_ZOOM))
    altitude = observer.altitude(ground)
    span = terrain.distance(observer.lat, observer.lon, lat, lon)
    heading = terrain.bearing(observer.lat, observer.lon, lat, lon)
    distances = ray_distances(span)
    distances = distances[distances < span]
    target_ground = float(sampler.heights(lat, lon, terrain.MAX_ZOOM))
    target = float(elevation_angle(span, target_ground + target_height, altitude, k))
    if distances.size == 0:
        return True, math.degrees(target), 90.0
    la, lo = terrain.destination(observer.lat, observer.lon, heading, distances)
    heights = np.empty(distances.size, dtype=np.float32)
    for zoom, band in _bands(lod_zooms(distances, observer.lat)):
        heights[band] = sampler.heights(la[band], lo[band], zoom)
    blocking = float(np.max(elevation_angle(distances, heights, altitude, k)))
    margin = math.degrees(target - blocking)
    return margin >= 0, math.degrees(target), margin
