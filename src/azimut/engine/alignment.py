"""Where an alignment's tops touch: the eye's height along the line, and where it stands.

An alignment is two things one behind the other in a photo (frontend
lib/horizon/find.js): seen from above, the camera stands on the line through
them, on the near one's side. When the top of the near one just touches the
far one in the photo, the camera also stands on the straight line through the
two tops, in three dimensions. Walking out along the line from the near one,
that gives the eye's altitude at every step; where the eye then stands at a
person's height over the ground under it, a person could have taken the photo.
A drone's or an aircraft's range of heights gives stretches of the line instead.

Both tops are seen on the refraction-enlarged sphere `horizon.py` draws every
ray on, so a far summit's drop below a flat line is counted (about 60 m at 30
km). A top given no height of its own is a summit or a ridge: the highest
ground within `TOP_REACH_M` of the click, since a click on a peak rarely lands
on its very top.

The answer is only as good as the two heights. A near top off by a metre moves
the place along the line by as much as the near one is from the camera, times
the slope of the line between the tops: the stretches come back with the eye
height at each end so the analyst can judge it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from . import horizon, terrain

# A top with no height of its own is the highest ground this far round the click.
TOP_REACH_M = 60.0
TOP_SAMPLES = 9
# The line is walked in steps this long.
STEP_M = 10.0


@dataclass(frozen=True)
class Top:
    """A point of the alignment and how far its top stands over the ground there (0: the ground itself)."""

    lat: float
    lon: float
    height: float = 0.0


def _top(top: Top, sampler: terrain.Sampler) -> tuple[float, float]:
    """The ground under a point and its top's altitude, metres above the sea."""
    ground = float(sampler.heights(top.lat, top.lon, terrain.MAX_ZOOM))
    if top.height > 0:
        return ground, ground + top.height
    offsets = np.linspace(-TOP_REACH_M, TOP_REACH_M, TOP_SAMPLES)
    north, east = np.meshgrid(offsets, offsets)
    reach = np.hypot(north, east)
    keep = reach <= TOP_REACH_M
    lat, lon = terrain.destination(top.lat, top.lon, np.degrees(np.arctan2(east, north))[keep], reach[keep])
    return ground, float(np.max(sampler.heights(lat, lon, terrain.MAX_ZOOM)))


def eye_altitudes(
    distances: np.ndarray, near_top: float, far_top: float, apart: float, k: float = horizon.REFRACTION_K,
) -> np.ndarray:
    """The eye's altitude at each distance behind the near point that lays both tops on one ray.

    In the plane of the line, on the enlarged sphere: the eye at the centre's
    angle 0, the near top `distances` away and the far one `apart` farther.
    """
    radius = horizon.effective_radius(k)
    near_angle = np.asarray(distances, dtype=np.float64) / radius
    far_angle = (np.asarray(distances, dtype=np.float64) + apart) / radius
    xn, yn = (radius + near_top) * np.sin(near_angle), (radius + near_top) * np.cos(near_angle)
    xf, yf = (radius + far_top) * np.sin(far_angle), (radius + far_top) * np.cos(far_angle)
    return (yn * xf - yf * xn) / (xf - xn) - radius


def tops_touch(
    near: Top, far: Top, *, bearing: float, mode: horizon.Mode, low: float, high: float,
    reach: float = 40_000.0, k: float = horizon.REFRACTION_K, sampler: terrain.Sampler | None = None,
) -> dict[str, Any]:
    """Where along an alignment's line the eye lays the near top on the far one.

    `bearing` is the line's, from the near point out to the camera's side.
    `low` and `high` are the eye's height over the ground for a person or a
    drone, its altitude for an aircraft. Returns both tops, and `fits`: for a
    person the points where the eye stands at that height, for a range the
    stretches where it stays within it, each with its distance from the near
    point, its place, the ground and the eye there.
    """
    sampler = sampler or terrain.Sampler()
    near_ground, near_top = _top(near, sampler)
    far_ground, far_top = _top(far, sampler)
    apart = terrain.distance(near.lat, near.lon, far.lat, far.lon)
    distances = np.arange(STEP_M, reach + STEP_M / 2, STEP_M)
    lat, lon = terrain.destination(near.lat, near.lon, bearing, distances)
    ground = np.asarray(sampler.heights(lat, lon, terrain.MAX_ZOOM), dtype=np.float64)
    altitude = eye_altitudes(distances, near_top, far_top, apart, k)
    over = altitude if mode == "aircraft" else altitude - ground
    airborne = altitude > ground

    def place(i: float) -> dict[str, float]:
        """A point between two steps, `i` a fractional index."""
        j = int(min(max(np.floor(i), 0), distances.size - 2))
        t = float(i - j)
        mix = lambda a: float(a[j] + (a[j + 1] - a[j]) * t)  # noqa: E731
        return {
            "distance": round(mix(distances), 1), "lat": round(mix(lat), 6), "lon": round(mix(lon), 6),
            "ground": round(mix(ground), 1), "eye": round(mix(over), 1),
        }

    fits: list[dict[str, Any]] = []
    if high - low < 1e-6:
        # one height: where the eye's height over the ground crosses it
        off = over - low
        for i in np.flatnonzero((np.sign(off[:-1]) != np.sign(off[1:])) & airborne[:-1] & airborne[1:]):
            fits.append({"at": place(i + off[i] / (off[i] - off[i + 1]))})
    else:
        inside = (over >= low) & (over <= high) & airborne
        edges = np.flatnonzero(np.diff(np.concatenate([[0], inside.astype(np.int8), [0]])))
        for start, end in zip(edges[::2], edges[1::2]):
            fits.append({"from": place(float(start)), "to": place(float(end - 1))})
    return {
        "near": {"ground": round(near_ground, 1), "top": round(near_top, 1)},
        "far": {"ground": round(far_ground, 1), "top": round(far_top, 1)},
        "apart": round(apart, 1),
        "fits": fits,
    }
