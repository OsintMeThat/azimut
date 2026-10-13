"""Per tile: whose footprints are drawn, and whose height each one carries.

The rule is fixed and said in the view, so an analyst can always tell why a
building stands as tall as it does:

1. Footprints. A national survey's where it has any in the tile (the IGN's in
   France), every building there being surveyed. Elsewhere OpenStreetMap's,
   when they cover at least `FOOTPRINT_SHARE` of the ground the fuller sources
   call built; else Overture's (OpenStreetMap's with Google's and Microsoft's
   traced footprints added) on the same test against 3D-GloBFP; otherwise
   3D-GloBFP's. Two sources' footprints are not mixed over
   the same ground: both draw the same houses a few metres apart, and mixing
   them stacks one on the other. The one exception is where the survey has
   nothing within `FILL_GAP_M`: across a border (Geneva, Basel, Tournai) the
   other side's buildings come from the next source rather than leaving the
   half tile empty.
2. Height. A building keeps a measured height of its own. One without takes,
   in this order: a measured height from another source's footprint at the
   same place; an estimate read off a picture of heights (Google's 2.5D, about
   1.5 m off); a count of floors Overture gives; 3D-GloBFP's estimate.
   Otherwise it is left unknown, and the
   view shows it as unknown rather than inventing a storey count.

"At the same place" first allows for the datasets disagreeing as a whole: 3D-GloBFP's
footprints in Taiz sit about 3.7 m west of Microsoft's, enough to pair a
house with its neighbour. Each donor set's shift is measured on the tile (the
median offset of nearest centroids) and taken off before footprints are
paired, nearest centroid within `JOIN_M` and of a comparable size.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, replace

import numpy as np

from collections.abc import Callable

from .model import NATIONAL, Building, Kind, centroid, footprint_area, metres_frame, tile_bounds

# A source's footprints are used when they cover at least this share of the ground
# the fuller sources after it call built in the tile.
FOOTPRINT_SHARE = 0.8
# Whose footprints are drawn where no national survey has the tile, in the order they are tried.
FALLBACKS = ("osm", "overture", "globfp")
# Who lends an estimate to a building nobody measured, best first.
ESTIMATES = ("overture", "globfp")
# Two footprints are the same building when their centres, after the shift, are
# this close and neither is more than AREA_RATIO times the other.
JOIN_M = 10.0
AREA_RATIO = 3.0
# The shift between two datasets is trusted from this many pairs, each nearer
# than SHIFT_REACH; a larger shift than SHIFT_MAX is a mismatch, not a shift.
SHIFT_PAIRS = 20
SHIFT_REACH = 30.0
SHIFT_MAX = 25.0
# The shift is a median: this many footprints of the tile measure it as well as all of them.
SHIFT_SAMPLE = 600
# Where the IGN draws footprints, another source's footprint is added only this far
# from every one of them: the far side of a border, never a second copy of a house.
FILL_GAP_M = 40.0


@dataclass(frozen=True)
class Merged:
    """One tile's buildings, and what the merge decided for it."""

    buildings: list[Building]
    footprints: str | None  # whose footprints are drawn, None for none
    shifts: dict[str, tuple[float, float]]  # each donor's shift taken off, metres east and north


class _Places:
    """Footprint centres in metres from the tile's centre, for nearest-neighbour questions."""

    def __init__(self, buildings: list[Building], origin: tuple[float, float], scale: tuple[float, float]):
        self.buildings = buildings
        if buildings:
            points = np.array([centroid(b) for b in buildings], dtype=np.float64)
            self.xy = np.column_stack(((points[:, 0] - origin[0]) * scale[0], (points[:, 1] - origin[1]) * scale[1]))
        else:
            self.xy = np.zeros((0, 2))
        self.area = np.array([footprint_area(b) for b in buildings], dtype=np.float64)
        self._grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        for i, (x, y) in enumerate(self.xy):
            self._grid[(math.floor(x / SHIFT_REACH), math.floor(y / SHIFT_REACH))].append(i)

    def nearest(self, x: float, y: float, reach: float) -> tuple[int, float] | None:
        """The nearest centre within `reach` (≤ SHIFT_REACH) of (x, y), and its distance."""
        cx, cy = math.floor(x / SHIFT_REACH), math.floor(y / SHIFT_REACH)
        best: tuple[int, float] | None = None
        for gx in (cx - 1, cx, cx + 1):
            for gy in (cy - 1, cy, cy + 1):
                for i in self._grid.get((gx, gy), ()):
                    d = math.hypot(self.xy[i, 0] - x, self.xy[i, 1] - y)
                    if d <= reach and (best is None or d < best[1]):
                        best = (i, d)
        return best


class _Cover:
    """Whether a point lies inside one of these footprints: a big block's centre can be
    far from a small house drawn inside it by another source."""

    CELL = 0.002  # degrees, a couple of hundred metres

    def __init__(self, buildings: list[Building]):
        self._rings: dict[tuple[int, int], list[tuple[tuple[float, float, float, float], tuple]]] = defaultdict(list)
        for building in buildings:
            ring = building.rings[0]
            xs, ys = [p[0] for p in ring], [p[1] for p in ring]
            box = (min(xs), min(ys), max(xs), max(ys))
            for gx in range(math.floor(box[0] / self.CELL), math.floor(box[2] / self.CELL) + 1):
                for gy in range(math.floor(box[1] / self.CELL), math.floor(box[3] / self.CELL) + 1):
                    self._rings[(gx, gy)].append((box, ring))

    def holds(self, point: tuple[float, float]) -> bool:
        x, y = point
        for box, ring in self._rings.get((math.floor(x / self.CELL), math.floor(y / self.CELL)), ()):
            if not (box[0] <= x <= box[2] and box[1] <= y <= box[3]):
                continue
            inside = False
            for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1]):
                if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                    inside = not inside
            if inside:
                return True
        return False


def _shift(base: _Places, donor: _Places) -> tuple[float, float]:
    """How far the donor's footprints sit from the base's, as a whole: (east, north) metres,
    measured on an even sample of the base's footprints."""
    offsets = []
    step = max(1, len(base.xy) // SHIFT_SAMPLE)
    for x, y in base.xy[::step]:
        hit = donor.nearest(x, y, SHIFT_REACH)
        if hit is not None:
            offsets.append(donor.xy[hit[0]] - (x, y))
    if len(offsets) < SHIFT_PAIRS:
        return 0.0, 0.0
    dx, dy = np.median(np.array(offsets), axis=0)
    if math.hypot(dx, dy) > SHIFT_MAX:
        return 0.0, 0.0
    return float(dx), float(dy)


def _donor_for(base: _Places, i: int, donor: _Places, shift: tuple[float, float]) -> Building | None:
    hit = donor.nearest(base.xy[i, 0] + shift[0], base.xy[i, 1] + shift[1], JOIN_M)
    if hit is None:
        return None
    a, b = base.area[i], donor.area[hit[0]]
    if a <= 0 or b <= 0 or max(a / b, b / a) > AREA_RATIO:
        return None
    return donor.buildings[hit[0]]


def _built_area(buildings: list[Building]) -> float:
    return sum(footprint_area(b) for b in buildings)


# Heights read off a raster for footprints asked all at once, and the date they stand for.
Raster = tuple[Callable[[list[Building]], list[float | None]], str]


def merge_tile(
    z: int, x: int, y: int, found: dict[str, list[Building] | None], enabled: set[str],
    rasters: dict[str, Raster] | None = None,
) -> Merged:
    """The tile's buildings by the rule above.

    `found` maps a source to its buildings for the tile, or to None when it has
    nothing to say there (outside its coverage, not downloaded, or failing just
    now). A source not in `enabled` is ignored even when found. `rasters` are
    sources of estimated heights read off a picture of heights (Google's 2.5D),
    asked for each footprint: better than 3D-GloBFP's estimates, below any
    measured height.
    """
    have = {source: found.get(source) for source in enabled if found.get(source) is not None}
    # a national survey's footprints, the first that has any in the tile: a tile it has
    # nothing in is no tile of its country worth trusting it on
    national = next((source for source in NATIONAL if have.get(source)), None)
    ign = have[national] if national else None
    fallback = _fallback(have)

    west, south, east, north = tile_bounds(z, x, y)
    origin = ((west + east) / 2, (south + north) / 2)
    scale = metres_frame(origin[1])

    footprints: str | None
    if ign is not None:
        footprints = national
        base_list = list(ign)
        if fallback is not None and have[fallback]:
            french = _Places(base_list, origin, scale)
            others = _Places(have[fallback] or [], origin, scale)
            covered = _Cover(base_list)
            base_list += [
                building for i, building in enumerate(others.buildings)
                if french.nearest(others.xy[i, 0], others.xy[i, 1], FILL_GAP_M) is None
                and not covered.holds(centroid(building))
            ]
    else:
        footprints = fallback
        base_list = list(have[fallback] or []) if fallback is not None else []
    if not base_list:
        return Merged([], footprints, {})
    base = _Places(base_list, origin, scale)

    # who may lend a height, best first: measured heights, then estimates
    donors: list[tuple[str, _Places, tuple[float, float]]] = []
    for source in (*NATIONAL, "osm", "overture", "globfp"):
        candidates = have.get(source)
        if not candidates:
            continue
        lending = [b for b in candidates if b.height is not None and b.kind in ("measured", "estimated")]
        if lending:
            places = _Places(lending, origin, scale)
            donors.append((source, places, _shift(base, places)))
    measured = [d for d in donors if d[0] != "globfp"]
    estimates = sorted((d for d in donors if d[0] in ESTIMATES), key=lambda d: ESTIMATES.index(d[0]))
    pictures = [(source, raster) for source, raster in (rasters or {}).items() if source in enabled]

    # first the measured heights lent, then the pictures asked once for every footprint still without
    given: list[tuple[float, Kind, str, str] | None] = [
        None if building.kind == "measured" else _lend(base, i, building, measured, lambda b: b.kind == "measured")
        for i, building in enumerate(base_list)
    ]
    for picture, (heights_of, taken) in pictures:
        asking = [i for i, building in enumerate(base_list) if building.kind != "measured" and given[i] is None]
        if not asking:
            break
        for i, read in zip(asking, heights_of([base_list[i] for i in asking])):
            if read is not None:
                given[i] = (read, "estimated", picture, taken)
    out = []
    for i, building in enumerate(base_list):
        lent = given[i]
        if lent is None and building.kind == "unknown":
            lent = _lend(base, i, building, estimates, lambda b: True)
        if lent is None:
            out.append(building)
        else:
            height, kind, lender, date = lent
            out.append(replace(building, height=height, kind=kind, height_source=lender, height_date=date))
    return Merged(out, footprints, {source: shift for source, _places, shift in donors})


def _fallback(have: dict[str, list[Building] | None]) -> str | None:
    """Whose footprints are drawn where no survey has the tile: the first that covers
    `FOOTPRINT_SHARE` of the ground the fuller sources after it call built."""
    present = [(source, _built_area(have[source] or [])) for source in FALLBACKS if have.get(source) is not None]
    for i, (source, area) in enumerate(present):
        fuller = max((later for _name, later in present[i + 1:]), default=0.0)
        if fuller <= 0 or area >= FOOTPRINT_SHARE * fuller:
            return source
    return None


def _lend(
    base: _Places, i: int, building: Building, donors: list[tuple[str, _Places, tuple[float, float]]],
    takes: Callable[[Building], bool],
) -> tuple[float, Kind, str, str] | None:
    """The first donor footprint at the same place that `takes` accepts: its height, kind, source, date."""
    for source, places, shift in donors:
        if source == building.source:
            continue
        candidate = _donor_for(base, i, places, shift)
        if candidate is not None and candidate.height is not None and takes(candidate):
            return candidate.height, candidate.kind, candidate.source, candidate.date
    return None
