"""Where an eye stands on the ground: a summit or a ridge, a slope, a valley, a plain, or water.

Find asks it of every point of its grid, so the analyst can say where the photo
was taken from (one or several kinds ticked) and the search starts only there.
A summit sees the whole turn and fits more traces by chance than a valley floor
does, so saying it is not one is worth as much as saying it is.

The rule is stated in the words the tool shows, so the analyst can check it on
the map before trusting it. A point is judged on the ground round it, not on the
whole area: an eye on a spur halfway up a mountain stands on a ridge, however
high the mountain rises behind it.

- a **plain** where the ground within `LOCAL_M` varies by less than
  `LOCAL_FLAT_M`, or that within `AROUND_M` by less than `FLAT_M`: flat ground at
  the foot of hills is a plain;
- else a **summit or ridge** in the top `TOP` share of the ground within
  `LOCAL_M` (two rings about it), a **valley** in the bottom `BOTTOM` share, and
  a **slope** between.

**Water** is ground with no relief at all: the sea, which the terrain gives as a
surface at 0, and the lakes Copernicus GLO-30 flattens to one height. A point
whose own ring of `WATER_RING_M` holds not a centimetre of relief is water; land
at the shore, even a metre above the sea, varies by more (measured on the owner's
Bab-el-Mandeb plain, 0 to 3 m above the sea, and Lake Tanganyika). Nobody on foot
stands there, but one on a boat does: the analyst may tick water too.
"""

from __future__ import annotations

from typing import Literal

import numpy as np

from . import terrain

Kind = Literal["summit", "slope", "valley", "plain", "water"]
WATER: Kind = "water"
# The kinds the analyst may tick, the order the tool lists them in.
STANDS: tuple[Kind, ...] = ("summit", "slope", "valley", "plain", WATER)

# A plain is read on a ring this far out and one at INNER_M, of RING samples each: less relief than
# FLAT_M within it, metres, and the ground is a plain.
AROUND_M = 1_500.0
INNER_M = 600.0
RING = 16
FLAT_M = 30.0
# Summits, slopes and valleys are read on the ground this near, on a ring at LOCAL_M and one at half
# it: in the top TOP share of it a summit or ridge, in the bottom BOTTOM share a valley; ground there
# varying by less than LOCAL_FLAT_M is a plain.
LOCAL_M = 400.0
LOCAL_FLAT_M = 8.0
TOP = 0.75
BOTTOM = 0.25
# A point with no more relief than WATER_FLAT_M on a ring this wide, of WATER_RING samples, is water.
WATER_RING_M = 150.0
WATER_RING = 8
WATER_FLAT_M = 0.05
# The terrain read: the deepest level that covers the planet, about 19 m a pixel.
ZOOM = terrain.PLANET_ZOOM


def ring(lat: np.ndarray, lon: np.ndarray, metres: float, count: int, sampler: terrain.Sampler) -> np.ndarray:
    """Heights on a ring about each point: one row per point."""
    bearings = np.arange(count) * 360.0 / count
    lats, lons = terrain.destination(lat[:, None], lon[:, None], bearings[None, :], metres)
    return np.asarray(sampler.heights(lats.ravel(), lons.ravel(), ZOOM), dtype=np.float64).reshape(lat.size, count)


def kinds(lat: np.ndarray, lon: np.ndarray, sampler: terrain.Sampler | None = None) -> np.ndarray:
    """The kind of ground each point stands on, as strings (`Kind`)."""
    lat = np.atleast_1d(np.asarray(lat, dtype=np.float64))
    lon = np.atleast_1d(np.asarray(lon, dtype=np.float64))
    out = np.full(lat.size, "slope", dtype=object)
    if not lat.size:
        return out
    sampler = sampler or terrain.Sampler()
    here = np.asarray(sampler.heights(lat, lon, ZOOM), dtype=np.float64)
    near = ring(lat, lon, WATER_RING_M, WATER_RING, sampler)
    local = np.concatenate(
        [here[:, None], ring(lat, lon, LOCAL_M / 2, RING, sampler), ring(lat, lon, LOCAL_M, RING, sampler)], axis=1,
    )
    around = np.concatenate([local, ring(lat, lon, INNER_M, RING, sampler), ring(lat, lon, AROUND_M, RING, sampler)], axis=1)
    low = local.min(axis=1)
    relief = local.max(axis=1) - low
    share = np.where(relief > 0, (here - low) / np.where(relief > 0, relief, 1.0), 0.5)
    shaped = relief >= LOCAL_FLAT_M
    out[shaped & (share >= TOP)] = "summit"
    out[shaped & (share <= BOTTOM)] = "valley"
    out[~shaped | (np.ptp(around, axis=1) < FLAT_M)] = "plain"
    still = np.ptp(np.concatenate([here[:, None], near], axis=1), axis=1) <= WATER_FLAT_M
    out[still] = WATER
    return out
