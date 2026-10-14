"""Where a traced skyline lies on a turn of terrain, and whether it lies anywhere.

The analyst traces the skyline on a photo. On the picture plane that trace is a
row of points, right and up from the lens's middle, in units of half the
frame's width: a lens F degrees wide sees a point (x, y) along the tangents
(x·tan(F/2), y·tan(F/2)). The camera is the Horizon tab's own (frontend
lib/horizon/camera.js, `basis` and `rayFor`), mirrored in `directions`. Its
heading is the outermost turn, so turning the camera only slides every point's
azimuth: one lens and tilt give the trace's directions once for the whole turn.

For each lens the trace is slid over every heading. A tilt is not a shift: a
point off the middle of a wide lens rises less than the middle does as the
camera tilts. So each point carries how far it rises per degree of tilt, and at
each heading the tilt that best lays the trace on the skyline is the median of
what each point asks. The cost is how far the trace then lies in screen pixels,
so a narrow lens cannot make every point fit by squeezing the trace into one
degree. The loss is `fitToTrace`'s (lib/horizon/overlay.js, which then refines
the winner in the browser): square near the line, straight past a few pixels,
and here level past `LOST_PX`, so a stretch traced over the wrong edge costs
what a point off the terrain does, however far off it went.

A fit is judged by how much of the trace's shape it explains (`explained`),
measured against the best straight line across the picture, at any slope. A
level line would not do: the roll a camera may have turns any slope into a level
one, so a straight trace drawn on a hillside would pass for a skyline found.
And every part of the trace must fit, not the most of it: a wrong place lays the
trace's easy stretches on some ridge and misses its peaks, which is what the
eye sees on the overlay. So the trace is cut into `PARTS` parts across its
width, each judged on its own, and the score is the lesser of the whole trace's
and the weakest parts'. Nothing more is searched for it: it is read off the fit
already made.

The terrain is known only as finely as its heights (Copernicus GLO-30's 30 m
over most of the world), so a near ridge is drawn coarsely. The score does not
forgive it: letting a near ridge's points off, or weighing them less, was
measured on the owner's two views and lifted wrong places more than the true
one (a 4.8° frame of a massif 16 km out, a 77° desert collage). The browser
shows that grain beside the trace instead (lib/horizon/overlay.js
`terrainMargin`).

The best places far enough apart to be separate on the turn come back with a
verdict: `match` when one explains the trace clearly, `loose` when the best
explains less than half of it, `ambiguous` when another explains it about as
well, `none` when nothing on the turn does, `flat` when the trace is too flat or
too straight to tell a heading.

What the search is told narrows it. The lens can be bounded by a range (the
zoom the analyst sees in the picture) rather than the view's own give or take,
and the headings by a sector (roughly where it faces). The roll is laid at each
heading of the slide as the slope the trace asks for, then eased in the
refinement, a few degrees either way: a hand-held camera is rarely level, and a
lens reads a degree of roll as a ramp across the whole frame. And
the turn can come cut at several reaches: haze hides ridges the terrain still
holds, so the skyline a photo shows is often a nearer one than the turn's
outermost. Each cut is searched and the place says which reach explained the
trace, which tells how far the photo sees.

The lens the analyst bounds stays inside the bounds, the refinement included: a
lens free to grow past the widest one said finds a hilltop where a tilted
wide-angle bends any trace onto the near slopes (measured on the owner's desert
collage: 122° where Wide said 110°, out-scoring the true place).

What the analyst marks beside the skyline counts too (`Marks`). A ridge seen
against farther land, not the sky, is traced as an inner edge: it is left out
of the skyline's fit, then read through the fitted camera against the terrain's
silhouettes in its columns (`Ridges`, from the sweep), and a place where none
lies under it loses score, never gains any: the score becomes the lesser of the
skyline's and the mean of the skyline's and the inner edges'. "This one stands
in front of that one" pairs two strokes: where the ridges they lie on are not
nearer and farther in that order, the place loses a share of its score. A
collage joined by hand from frames of a pan is cut in pieces, and each piece's
camera may turn, tilt and roll a little from the whole's, as much as joining
frames by eye leaves between them and no more: each piece free would fit
anywhere.

A panorama is read through the view's other projection (`projection="panorama"`,
camera.js's strip): the same number of degrees per pixel along and up, so the
trace's x is its azimuth and its y its elevation, a phone's panorama or a collage
Azimut stitched on a cylinder. Its lens is how many degrees the whole strip spans,
up to the whole turn, and it is held level: the strip has no roll to give.

The verdict is a hint, not a proof. With the lens free, a weak trace finds a
coincidence somewhere on most turns: measured over real relief (the Schilthorn,
and a desert in Yemen with a real photo), the right heading came first at the
right eye, and its `explained` beat the best of every wrong eye nearby, but a
wrong eye could still pass for `loose`. Horizon's Fit asks it at the eye; the
viewpoint finder is meant to ask it at every point of an area and compare.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Literal

import numpy as np

# The loss: square up to this many pixels, straight beyond.
HUBER_PX = 3.0
# A point this far off, or with no terrain skyline under it, counts as lost:
# no more, so a stretch traced wrong cannot outweigh the rest, and no less, or
# a fit could drop the hard ones.
LOST_PX = 4 * HUBER_PX
# Fewer points than this against the terrain say nothing.
MIN_POINTS = 6
# Points the whole-turn slide reads; every point refines the best few.
SLIDE_POINTS = 160
# A lens is slid in steps of this share of its width, within these bounds (degrees).
# The whole-turn slide steps no finer than the turn's own columns: its places are
# found again finely by the refinement, which starts at the finer steps.
PACE = 1 / 240
STEP_MIN = 0.05
STEP_MAX = 0.5
COARSE_MIN = 0.1
# Headings slid at once: bounds the memory of a narrow lens's long slide.
BLOCK = 1024
# When the photo does not say its lens, lenses from the view's own divided by
# this to multiplied by it are tried, each this much wider than the last. Set
# the view's lens near the photo's first: a free lens fits too much.
LENS_REACH = 1.5
LENS_RATIO = 1.08
# Across a range the analyst gives, lenses this much wider than the last: the
# refinement then eases each by up to this much either way, so none falls between.
RANGE_RATIO = 1.12
RANGE_EASE = 1.06
# The roll is eased in the refinement this far from where the search started,
# first in these steps either way, then in halving ones.
ROLL_REACH = 5.0
ROLL_STEPS = (-3.0, -1.5, 0.0, 1.5, 3.0)
ROLL_EASE = 0.75
# The whole-turn slide lays a roll as well as a tilt at each heading, within
# this many degrees: a wide lens reads a degree of roll as a slope across the
# frame, enough to bury the right heading under others before the refinement
# could ease it. The roll is fitted to the points lying within the second
# number of pixels once the tilt is laid, so a stretch traced wrong cannot steer it.
SLIDE_ROLL = 4.0
SLIDE_ROLL_PX = 3 * LOST_PX
FOV_MIN = 1.0
FOV_MAX = 150.0
# A panorama's strip may span the whole turn.
PANORAMA_FOV_MAX = 360.0
# Headings closer than this, or than half the trace's width, are one place.
APART_MIN = 5.0
# Places kept per lens, places refined, and places returned. The cheapest
# `CANDIDATES` headings of a slide are enough to find a lens's places apart.
CANDIDATES = 400
PER_LENS = 6
REFINED = 8
KEPT = 3
# Places a quick search refines.
QUICK_REFINED = 2
# A rough search, for ranking many points before the best are searched in full: fewer trace
# points slid, lenses this much wider than the last across a range, one place refined.
ROUGH_POINTS = 80
ROUGH_RATIO = 1.25
# The score: the trace is judged in this many parts across its width, the weakest
# `WEAKEST` of them averaged. A part a straight line already follows within this
# many pixels has no shape of its own: it must only lie on the terrain that close.
PARTS = 4
WEAKEST = 2
PART_FLOOR_PX = 5.0
# A whole trace straying less than this from a straight line, in pixels, has next to no shape:
# it can be explained no more than it has.
LINE_FLOOR_PX = 1.5
# The straight line is fitted with the loss's own give: these many rounds of reweighting.
LINE_ROUNDS = 6
# The verdict. A trace whose points all stand within this many screen pixels of
# a straight line, but for a stray few, has no shape to place: one clear peak is
# enough, so the stray few are a fiftieth of the trace.
FLAT_PX = 5.0
FLAT_SHARE = 0.98
# The best place explains less of the trace's shape than this: nothing on the
# turn is the traced skyline. Under the second, it is a loose fit.
NONE_BELOW = 0.25
LOOSE_BELOW = 0.5
# A second place explaining at least this share of what the best one does fits
# about as well.
AMBIGUOUS_SHARE = 0.75
# A collage's pieces: each piece's camera turns, tilts and rolls at most this far from the whole's
# (degrees), tried in these many steps across, so a piece cannot wander onto another ridge.
PIECE_TURN = 1.0
PIECE_TILT = 1.0
PIECE_ROLL = 1.5
PIECE_STEPS = (9, 9, 5)
# A pair of strokes standing in the wrong order takes this share of the score per pair asked.
PAIR_COST = 0.5
# A ridge stands in front of another when it is nearer by this share of the other's distance.
PAIR_NEARER = 0.9

Verdict = Literal["match", "loose", "ambiguous", "none", "flat"]
Projection = Literal["camera", "panorama"]


@dataclass(frozen=True)
class Turn:
    """The terrain's skyline all round: degrees at `start + i·step`, NaN where none stands."""

    start: float
    step: float
    angles: np.ndarray
    # how far out the turn was cut, metres: None when it reaches as far as the terrain is read
    reach: float | None = None
    # how far out the ground setting each column's skyline stands, metres, when the sweep said
    distance: np.ndarray | None = None

    def __post_init__(self) -> None:
        angles = np.asarray(self.angles, dtype=np.float64)
        # the first column again at the end, so the column after the last needs no wrap
        object.__setattr__(self, "_ring", np.append(angles, angles[:1]))
        object.__setattr__(self, "_holes", bool(np.isnan(angles).any()))

    def at(self, azimuth: np.ndarray | float) -> np.ndarray:
        """The skyline at any azimuth, between the two columns either side."""
        count = self.angles.size
        place = np.remainder(np.asarray(azimuth, dtype=np.float64) - self.start, 360.0) / self.step
        below = np.floor(place)
        share = place - below
        # 360° itself can round onto the column past the last
        i0 = np.minimum(below.astype(np.int64), count - 1)
        ring: np.ndarray = self._ring  # type: ignore[attr-defined]
        a = ring[i0]
        b = ring[i0 + 1]
        out = a + (b - a) * share
        if not self._holes:  # type: ignore[attr-defined]
            return out
        # one column without ground: the other stands for both, as in the browser
        out = np.where(np.isnan(a), b, out)
        return np.where(np.isnan(b), a, out)

    def far(self, azimuth: np.ndarray) -> np.ndarray:
        """How far out the skyline stands at each azimuth, the nearest column's: NaN when the sweep did not say."""
        azimuth = np.asarray(azimuth, dtype=np.float64)
        if self.distance is None:
            return np.full(azimuth.shape, np.nan)
        count = self.angles.size
        column = np.rint(np.remainder(azimuth - self.start, 360.0) / self.step).astype(np.int64) % count
        return np.asarray(self.distance, dtype=np.float64)[column]


@dataclass(frozen=True)
class Ridges:
    """The terrain's silhouettes all round, the skyline among them: in each column of a turn
    (`start + i·step`) the angle (degrees) and distance (metres) of every edge seen against
    farther ground or the sky, NaN past a column's last."""

    start: float
    step: float
    angle: np.ndarray  # (columns, most)
    distance: np.ndarray

    @classmethod
    def of(cls, start: float, step: float, columns: int, column: np.ndarray, angle: np.ndarray,
           distance: np.ndarray) -> Ridges:
        """Packed from a sweep's flat lists (engine/horizon.py `Horizon.ridge_*`), `column` the turn's column of each."""
        column = np.asarray(column, dtype=np.int64)
        order = np.argsort(column, kind="stable")
        column = column[order]
        counts = np.bincount(column, minlength=columns) if column.size else np.zeros(columns, dtype=np.int64)
        most = max(1, int(counts.max()) if counts.size else 1)
        first = np.concatenate([[0], np.cumsum(counts)[:-1]])
        rank = np.arange(column.size) - first[column]
        angles = np.full((columns, most), np.nan)
        distances = np.full((columns, most), np.nan)
        angles[column, rank] = np.asarray(angle, dtype=np.float64)[order]
        distances[column, rank] = np.asarray(distance, dtype=np.float64)[order]
        return cls(start, step, angles, distances)

    def nearest(
        self, azimuth: np.ndarray, elevation: np.ndarray, reach: float | None = None,
    ) -> tuple[np.ndarray, np.ndarray]:
        """For each direction, the angle (degrees, + above) to the nearest silhouette in its column within
        `reach` metres, and that silhouette's distance: NaN where the column holds none."""
        azimuth = np.asarray(azimuth, dtype=np.float64)
        elevation = np.asarray(elevation, dtype=np.float64)
        count = self.angle.shape[0]
        column = np.rint(np.remainder(azimuth - self.start, 360.0) / self.step).astype(np.int64) % count
        angles = self.angle[column]
        distances = self.distance[column]
        if reach is not None:
            angles = np.where(distances <= reach, angles, np.nan)
        off = elevation[:, None] - angles
        held = ~np.isnan(off)
        pick = np.argmin(np.where(held, np.abs(off), np.inf), axis=1)
        rows = np.arange(azimuth.size)
        some = held.any(axis=1)
        return np.where(some, off[rows, pick], np.nan), np.where(some, distances[rows, pick], np.nan)


@dataclass(frozen=True)
class Marks:
    """What the analyst marked on the photo beside the skyline.

    `ridge_x`, `ridge_y` are inner edges, ridges seen against farther land, on
    the picture plane as the trace is. `line` and `ridge_line` say which stroke
    each point (of the skyline, of the inner edges) was drawn in, which `pairs`
    name: (the stroke in front, the stroke behind it). `piece` and
    `ridge_piece` say which piece of a collage each point lies in.
    """

    ridge_x: np.ndarray = field(default_factory=lambda: np.empty(0))
    ridge_y: np.ndarray = field(default_factory=lambda: np.empty(0))
    line: np.ndarray | None = None
    ridge_line: np.ndarray | None = None
    pairs: tuple[tuple[int, int], ...] = ()
    piece: np.ndarray | None = None
    ridge_piece: np.ndarray | None = None

    @property
    def cut(self) -> bool:
        """Whether the photo is a collage cut in more than one piece."""
        return self.piece is not None and np.unique(self.piece).size > 1


def directions(
    x: np.ndarray, y: np.ndarray, *, fov: float, tilt: float = 0.0, roll: float = 0.0,
    projection: Projection = "camera",
) -> tuple[np.ndarray, np.ndarray]:
    """Azimuth from the heading and elevation, in degrees, of picture-plane points.

    camera.js `rayFor` at heading 0: forward tilted up by `tilt`, the frame
    turned clockwise by `roll`; on the panorama strip, half a width is half the
    field across and as many degrees up, and the strip has no roll.
    """
    if projection == "panorama":
        half = float(fov) / 2
        return np.asarray(x, dtype=np.float64) * half, np.asarray(y, dtype=np.float64) * half + tilt
    t, r = math.radians(tilt), math.radians(roll)
    scale = math.tan(math.radians(fov) / 2)
    sx = np.asarray(x, dtype=np.float64) * scale
    sy = np.asarray(y, dtype=np.float64) * scale
    st, ct, sr, cr = math.sin(t), math.cos(t), math.sin(r), math.cos(r)
    east = sx * cr + sy * sr
    north = ct + sx * st * sr - sy * st * cr
    up = st - sx * ct * sr + sy * ct * cr
    return np.degrees(np.arctan2(east, north)), np.degrees(np.arctan2(up, np.hypot(east, north)))


def widest(projection: Projection) -> float:
    """The widest lens a projection has."""
    return PANORAMA_FOV_MAX if projection == "panorama" else FOV_MAX


def lenses(
    fov: float, *, known: bool, within: tuple[float, float] | None = None, projection: Projection = "camera",
    ratio: float = RANGE_RATIO,
) -> list[float]:
    """The fields of view tried: the photo's own when it says one, else every step
    across `within` when the analyst bounds it, else a range about the view's."""
    top = widest(projection)
    fov = min(top, max(FOV_MIN, float(fov)))
    if known:
        return [fov]
    if within is not None:
        low, high = (min(top, max(FOV_MIN, float(v))) for v in sorted(within))
        count = max(1, int(math.ceil(math.log(high / low) / math.log(ratio))))
        return sorted({low * (high / low) ** (i / count) for i in range(count + 1)}) if high > low else [low]
    steps = int(math.floor(math.log(LENS_REACH) / math.log(LENS_RATIO)))
    # clipped at either end of the lenses a view has, where several steps then meet
    tried = {min(top, max(FOV_MIN, fov * LENS_RATIO**i)) for i in range(-steps, steps + 1)}
    return sorted(tried)


@dataclass(frozen=True)
class Fit:
    """A camera bringing the terrain's skyline onto the trace."""

    heading: float
    tilt: float
    fov: float
    gap: float  # the median angle between trace and skyline, degrees
    explained: float  # share of the trace's shape the terrain accounts for, at most 1
    points: int  # trace points against the terrain
    roll: float = 0.0
    reach: float | None = None  # the cut of the turn it was found on, metres; None for the whole
    # what the skyline alone explains, when inner edges or pairs were judged too; how much of the inner
    # edges lies on the terrain's ridges (0 to 1); the pairs standing in the order asked, of those judged
    sky: float | None = None
    inner: float | None = None
    pairs: tuple[int, int] | None = None
    # a collage's pieces, each (piece, turn, tilt, roll) from the whole's camera in degrees, which the view
    # lays each piece's skyline by
    pieces: tuple[tuple[int, float, float, float], ...] | None = None


@dataclass(frozen=True)
class Match:
    verdict: Verdict
    fits: list[Fit]  # best first, each a separate place on the turn


LOST_LOSS = HUBER_PX * (LOST_PX - 0.5 * HUBER_PX)


def _loss(px: np.ndarray) -> np.ndarray:
    a = np.abs(px)
    huber = np.where(a <= HUBER_PX, 0.5 * a * a, HUBER_PX * (a - 0.5 * HUBER_PX))
    return np.minimum(huber, LOST_LOSS)


PART_FLOOR_LOSS = float(_loss(np.array([PART_FLOOR_PX]))[0])
LINE_FLOOR_LOSS = float(_loss(np.array([LINE_FLOOR_PX]))[0])


def off_line(x: np.ndarray, y: np.ndarray, half_width: float) -> np.ndarray:
    """How far each point of the trace stands from the best straight line through it, in screen pixels.

    The line is drawn on the picture itself, at any slope: a straight stroke on
    a photo stays straight whatever the lens and the tilt, and a hillside's edge
    is one. It is fitted with the loss's own give, a few rounds of reweighting,
    so one peak does not drag it up.
    """
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    across = np.column_stack([x, np.ones(x.size)])
    weight = np.ones(x.size)
    off = y - y.mean()
    for _ in range(LINE_ROUNDS):
        coef, *_ = np.linalg.lstsq(across * weight[:, None], y * weight, rcond=None)
        off = y - across @ coef
        px = np.abs(off) * half_width
        weight = np.sqrt(np.where(px <= HUBER_PX, 1.0, HUBER_PX / np.maximum(px, 1e-9)))
    return off * half_width


def parts(x: np.ndarray) -> list[np.ndarray]:
    """The trace cut into `PARTS` spans of equal width across the picture, as masks; a span with
    too few points to judge is left out."""
    x = np.asarray(x, dtype=np.float64)
    edges = np.linspace(float(x.min()), float(x.max()), PARTS + 1)
    found = []
    for i in range(PARTS):
        inside = (x >= edges[i]) & ((x < edges[i + 1]) if i < PARTS - 1 else (x <= edges[i + 1]))
        if inside.sum() >= MIN_POINTS:
            found.append(inside)
    return found


def explained_by(loss: np.ndarray, x: np.ndarray, y: np.ndarray, half_width: float) -> float:
    """How much of the trace's shape a fit explains, from 0 to 1: what each point costs against
    the terrain (`loss`) against what it would cost against the best straight line.

    The whole trace is judged, and so is each part of it across the picture, a
    part with no shape of its own only asked to lie on the terrain: the score is
    the lesser of the whole's and the weakest parts'. A straight trace explains
    nothing, however well it lies on some hillside.
    """
    line = _loss(off_line(x, y, half_width))
    whole_line = float(line.mean())
    # a trace with next to no shape can be explained no more than it has
    score = (whole_line - float(loss.mean())) / max(whole_line, LINE_FLOOR_LOSS)
    each = sorted(1.0 - float(loss[part].mean()) / max(float(line[part].mean()), PART_FLOOR_LOSS) for part in parts(x))
    if each:
        score = min(score, float(np.mean(each[:WEAKEST])))
    return float(min(1.0, max(0.0, score)))


def _per_degree(fov: float, half_width: float, projection: Projection = "camera") -> float:
    """Screen pixels a degree spans at the lens's middle: everywhere, on a panorama."""
    if projection == "panorama":
        return half_width / (fov / 2)
    return half_width / math.tan(math.radians(fov) / 2) * math.pi / 180


def _step(fov: float) -> float:
    return min(STEP_MAX, max(STEP_MIN, fov * PACE))


@dataclass(frozen=True)
class _Seen:
    """The trace through one lens and tilt: each point's direction and rise per degree of tilt."""

    fov: float
    tilt: float
    azimuth: np.ndarray
    elevation: np.ndarray
    lift: np.ndarray
    per_degree: float
    # each point's rise per degree of roll, when the slide lays a roll too
    twist: np.ndarray | None = None
    projection: Projection = "camera"


def _through(
    x: np.ndarray, y: np.ndarray, fov: float, tilt: float, roll: float, half_width: float,
    *, twist: bool = False, projection: Projection = "camera",
) -> _Seen:
    azimuth, elevation = directions(x, y, fov=fov, tilt=tilt, roll=roll, projection=projection)
    _, above = directions(x, y, fov=fov, tilt=tilt + 0.5, roll=roll, projection=projection)
    _, below = directions(x, y, fov=fov, tilt=tilt - 0.5, roll=roll, projection=projection)
    # a point never rises less than a tenth as fast as the middle, short of a lens wider than any
    lift = np.maximum(above - below, 0.1)
    turned = None
    if twist:
        _, right = directions(x, y, fov=fov, tilt=tilt, roll=roll + 0.5, projection=projection)
        _, left = directions(x, y, fov=fov, tilt=tilt, roll=roll - 0.5, projection=projection)
        turned = right - left
    return _Seen(
        fov, tilt, azimuth, elevation, lift, _per_degree(fov, half_width, projection), turned, projection,
    )


def _median_tilt(asked: np.ndarray, lost: np.ndarray, found: np.ndarray) -> np.ndarray:
    """Per heading, the tilt change the points ask for, the middle of them."""
    if not lost.any():
        return np.median(asked, axis=1)
    change = np.zeros(asked.shape[0])
    some = found > 0
    change[some] = np.nanmedian(asked[some], axis=1)
    return change


def _slide(seen: _Seen, turn: Turn, headings: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The cost of the trace at each heading, and the tilt and roll changes that lay it there."""
    cost = np.empty(headings.size)
    tilt = np.empty(headings.size)
    roll = np.zeros(headings.size)
    lift = seen.lift[None, :]
    for start in range(0, headings.size, BLOCK):
        block = headings[start:start + BLOCK]
        gap = seen.elevation[None, :] - turn.at(block[:, None] + seen.azimuth[None, :])
        lost = np.isnan(gap)
        found = (~lost).sum(axis=1)
        change = _median_tilt(-gap / lift, lost, found)
        if seen.twist is not None:
            # the slope left once the tilt is laid, read off the points near the line
            twist = seen.twist[None, :]
            rest = gap + change[:, None] * lift
            near = np.abs(rest * seen.per_degree) < SLIDE_ROLL_PX
            weight = np.where(near, twist * twist, 0.0).sum(axis=1)
            pull = np.where(near, -rest * twist, 0.0).sum(axis=1)
            turned = np.clip(pull / np.maximum(weight, 1e-12), -SLIDE_ROLL, SLIDE_ROLL)
            turned[weight <= 1e-12] = 0.0
            gap = gap + turned[:, None] * twist
            change = _median_tilt(-gap / lift, lost, found)
            roll[start:start + BLOCK] = turned
        loss = _loss((gap + change[:, None] * lift) * seen.per_degree)
        loss[lost] = LOST_LOSS
        block_cost = loss.mean(axis=1)
        block_cost[found < MIN_POINTS] = np.inf
        cost[start:start + BLOCK] = block_cost
        tilt[start:start + BLOCK] = change
    return cost, tilt, roll


def _apart(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


# A place found by a slide: its cost, heading, lens, tilt, which turn it lies on, and its roll.
_Row = tuple[float, float, float, float, int, float]


def _spread_out(order: list[_Row], apart: float, most: int) -> list[_Row]:
    """The first rows of `order` whose headings stand `apart` degrees from each other."""
    kept: list[_Row] = []
    for row in order:
        if all(_apart(row[1], k[1]) >= apart for k in kept):
            kept.append(row)
            if len(kept) == most:
                break
    return kept


def _cheapest(cost: np.ndarray, count: int) -> np.ndarray:
    """The cheapest headings first, enough of them for `PER_LENS` places standing apart."""
    keep = min(count, CANDIDATES)
    if keep == count:
        return np.argsort(cost)
    near = np.argpartition(cost, keep - 1)[:keep]
    return near[np.argsort(cost[near])]


def _headings(step: float, facing: tuple[float, float] | None) -> np.ndarray:
    """The headings a lens is slid over: all round, or across the sector the analyst gave."""
    if facing is None:
        return np.arange(0.0, 360.0, step)
    centre, half = facing
    half = min(180.0, max(step, float(half)))
    return (np.arange(centre - half, centre + half + step / 2, step)) % 360.0


def _rolls(start: float, centre: float, ease: float | None) -> list[float]:
    """The rolls one round of the refinement tries: steps about the place's, then about the best so far."""
    tried = [centre + d for d in ROLL_STEPS] if ease is None else [centre - ease, centre, centre + ease]
    return sorted({float(np.clip(r, start - ROLL_REACH, start + ROLL_REACH)) for r in tried})


def _refine(
    x: np.ndarray, y: np.ndarray, turn: Turn, *, heading: float, tilt: float, fov: float,
    roll: float, half_width: float, free: bool, level: bool, widen: float = 1.03,
    start: float | None = None, projection: Projection = "camera", bounds: tuple[float, float] | None = None,
) -> Fit | None:
    """A coarse place made exact: heading searched finely, tilt laid onto the trace, lens and roll eased.

    The roll is eased about `roll`, never farther than `ROLL_REACH` from `start`
    (where the search began); an eased lens stays within `bounds`.
    """
    step = _step(fov)
    start = roll if start is None else start
    low, high = bounds if bounds is not None else (FOV_MIN, widest(projection))
    ease: float | None = None
    for _ in range(3):
        best: tuple[float, float, float, float, float] | None = None
        rolls = [roll] if level else _rolls(start, roll, ease)
        for lens in ([fov / widen, fov, fov * widen] if free else [fov]):
            lens = min(high, widest(projection), max(low, FOV_MIN, lens))
            for turned in rolls:
                seen = _through(x, y, lens, tilt, turned, half_width, projection=projection)
                headings = heading + np.linspace(-2 * step, 2 * step, 17)
                cost, change, _ = _slide(seen, turn, headings)
                i = int(np.argmin(cost))
                if np.isfinite(cost[i]) and (best is None or cost[i] < best[0]):
                    best = (float(cost[i]), float(headings[i]), lens, tilt + float(change[i]), turned)
        if best is None:
            return None
        _, heading, fov, tilt, roll = best
        tilt = float(np.clip(tilt, -89.0, 89.0))
        step /= 4
        widen = 1 + (widen - 1) / 2
        ease = ROLL_EASE if ease is None else ease / 2
    seen = _through(x, y, fov, tilt, roll, half_width, projection=projection)
    gap = seen.elevation - turn.at(heading + seen.azimuth)
    hit = ~np.isnan(gap)
    if hit.sum() < MIN_POINTS:
        return None
    middle = float(np.median(gap[hit]))
    loss = np.full(gap.size, LOST_LOSS)
    loss[hit] = _loss((gap[hit] - middle) * seen.per_degree)
    return Fit(
        heading=heading % 360.0,
        tilt=float(np.clip(tilt - middle, -89.0, 89.0)),
        fov=fov,
        gap=float(np.median(np.abs(gap[hit] - middle))),
        explained=explained_by(loss, x, y, half_width),
        points=int(hit.sum()),
        roll=roll,
        reach=turn.reach,
    )


def _pieces(
    x: np.ndarray, y: np.ndarray, piece: np.ndarray, turn: Turn, fit: Fit, half_width: float, projection: Projection,
) -> tuple[np.ndarray, dict[int, tuple[float, float, float]]]:
    """Each piece's camera eased from the whole's, no farther than the piece bounds: what every point
    then costs, and each piece's (turn, tilt, roll) from the whole's."""
    loss = np.full(x.size, LOST_LOSS)
    offsets: dict[int, tuple[float, float, float]] = {}
    for k in np.unique(piece):
        inside = piece == k
        if inside.sum() < MIN_POINTS:
            turns, tilts, rolls = np.zeros(1), np.zeros(1), np.zeros(1)
        else:
            turns = np.linspace(-PIECE_TURN, PIECE_TURN, PIECE_STEPS[0])
            tilts = np.linspace(-PIECE_TILT, PIECE_TILT, PIECE_STEPS[1])
            # a panorama's strip has no roll to give
            rolls = np.zeros(1) if projection == "panorama" else np.linspace(-PIECE_ROLL, PIECE_ROLL, PIECE_STEPS[2])
        best: tuple[float, np.ndarray, tuple[float, float, float]] | None = None
        for turned in rolls:
            seen = _through(x[inside], y[inside], fit.fov, fit.tilt, fit.roll + turned, half_width, projection=projection)
            base = seen.elevation[None, :] - turn.at(fit.heading + turns[:, None] + seen.azimuth[None, :])
            gap = base[:, None, :] + tilts[None, :, None] * seen.lift[None, None, :]
            lost = np.isnan(gap)
            cost = np.where(lost, LOST_LOSS, _loss(np.where(lost, 0.0, gap) * seen.per_degree))
            mean = cost.mean(axis=2)
            i, j = np.unravel_index(int(np.argmin(mean)), mean.shape)
            if best is None or mean[i, j] < best[0]:
                best = (float(mean[i, j]), cost[i, j], (float(turns[i]), float(tilts[j]), float(turned)))
        assert best is not None
        loss[inside] = best[1]
        offsets[int(k)] = best[2]
    return loss, offsets


def pieces_of(fit: Fit) -> list[dict[str, float]]:
    """A fit's eased pieces as the app reads them: each piece, and its turn, tilt and roll from the whole's camera."""
    return [
        {"piece": k, "turn": round(t, 3), "tilt": round(lift, 3), "roll": round(r, 3)}
        for k, t, lift, r in fit.pieces or ()
    ]


def _judge(
    fit: Fit, x: np.ndarray, y: np.ndarray, turn: Turn, marks: Marks, ridges: Ridges | None,
    half_width: float, projection: Projection,
) -> Fit:
    """A place judged on all the analyst marked: a collage's pieces eased, the inner edges read
    against the terrain's ridges, the pairs' order checked."""
    piece = marks.piece if marks.cut and marks.piece is not None and marks.piece.size == x.size else None
    offsets: dict[int, tuple[float, float, float]] = {}
    sky = fit.explained
    if piece is not None:
        loss, offsets = _pieces(x, y, piece, turn, fit, half_width, projection)
        sky = explained_by(loss, x, y, half_width)

    def through(px: np.ndarray, py: np.ndarray, which: np.ndarray | None) -> tuple[np.ndarray, np.ndarray, float]:
        """Directions of points through their piece's camera."""
        azimuth = np.empty(px.size)
        elevation = np.empty(px.size)
        groups = [(-1, np.ones(px.size, dtype=bool))]
        if offsets and which is not None and which.size == px.size:
            groups = [(int(k), which == k) for k in np.unique(which)]
        per = _per_degree(fit.fov, half_width, projection)
        for k, inside in groups:
            turned, tilted, rolled = offsets.get(k, (0.0, 0.0, 0.0))
            seen = _through(px[inside], py[inside], fit.fov, fit.tilt + tilted, fit.roll + rolled, half_width,
                            projection=projection)
            azimuth[inside] = fit.heading + turned + seen.azimuth
            elevation[inside] = seen.elevation
        return azimuth, elevation, per

    score = sky
    inner: float | None = None
    ridge_far: np.ndarray | None = None
    if ridges is not None and marks.ridge_x.size >= MIN_POINTS:
        azimuth, elevation, per = through(marks.ridge_x, marks.ridge_y, marks.ridge_piece)
        off, ridge_far = ridges.nearest(azimuth, elevation, fit.reach)
        cost = np.where(np.isnan(off), LOST_LOSS, _loss(np.nan_to_num(off) * per))
        inner = float(1.0 - cost.mean() / LOST_LOSS)
        # an inner edge with no ridge under it takes score away, one lying on its ridge adds none
        score = min(sky, (sky + inner) / 2)
    kept: tuple[int, int] | None = None
    if marks.pairs:
        far: dict[int, float] = {}
        if marks.line is not None and marks.line.size == x.size and turn.distance is not None:
            distance = turn.far(through(x, y, piece)[0])
            for stroke in np.unique(marks.line):
                values = distance[marks.line == stroke]
                if np.isfinite(values).any():
                    far[int(stroke)] = float(np.nanmedian(values))
        if ridge_far is not None and marks.ridge_line is not None and marks.ridge_line.size == ridge_far.size:
            for stroke in np.unique(marks.ridge_line):
                values = ridge_far[marks.ridge_line == stroke]
                if np.isfinite(values).any():
                    far[int(stroke)] = float(np.nanmedian(values))
        judged = [(front, back) for front, back in marks.pairs if front in far and back in far]
        if judged:
            good = sum(1 for front, back in judged if far[front] < PAIR_NEARER * far[back])
            score *= 1.0 - PAIR_COST * (len(judged) - good) / len(judged)
            kept = (good, len(judged))
    if piece is None and inner is None and kept is None:
        return fit
    eased = tuple((k, *offsets[k]) for k in sorted(offsets)) or None
    return replace(fit, explained=float(min(1.0, max(0.0, score))), sky=sky, inner=inner, pairs=kept, pieces=eased)


def match(
    x: np.ndarray, y: np.ndarray, turn: Turn | list[Turn], *, half_width: float, fov: float,
    known: bool = False, tilt: float = 0.0, roll: float = 0.0,
    within: tuple[float, float] | None = None, facing: tuple[float, float] | None = None,
    level: bool = False, projection: Projection = "camera", quick: bool = False, rough: bool = False,
    marks: Marks | None = None, ridges: Ridges | None = None,
) -> Match:
    """The headings, lenses and tilts that bring `turn` onto the trace (x, y), and a verdict.

    `half_width` is half the frame's width in screen pixels, which sets how
    many pixels a degree spans. `fov` is the lens, `known` when the photo says
    it, and `tilt` and `roll` the camera the search starts from: the tilt and an
    unknown lens follow the trace, the roll is eased a few degrees unless
    `level` holds it. `within` bounds an unknown lens (degrees, low and high),
    `facing` the heading to a sector (its middle and half its width). `turn`
    may be several cuts of the same turn (`Turn.reach`): each place says which
    one it lies on. `projection` is the picture's: a panorama strip is held level.
    `quick` refines only the two best places, for a search that asks it at many
    points and only needs the best one's score; `rough` slides fewer points over
    fewer lenses too, to rank a grid before its best points are searched again.
    `marks` holds what the analyst marked beside the skyline (inner edges,
    pairs, a collage's pieces), judged on each place found; inner edges are
    read against `ridges`, the terrain's silhouettes, when given.
    """
    if projection == "panorama":
        level, roll = True, 0.0
    turns = [turn] if isinstance(turn, Turn) else list(turn)
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    if x.size < MIN_POINTS or not turns:
        return Match("none", [])
    slid = ROUGH_POINTS if rough else SLIDE_POINTS
    pick = np.unique(np.linspace(0, x.size - 1, min(x.size, slid)).round().astype(int))
    xs, ys = x[pick], y[pick]

    rows: list[_Row] = []
    widths: dict[float, float] = {}
    for lens in lenses(fov, known=known, within=within, projection=projection, ratio=ROUGH_RATIO if rough else RANGE_RATIO):
        seen = _through(xs, ys, lens, tilt, roll, half_width, twist=not level, projection=projection)
        widths[lens] = float(seen.azimuth.max() - seen.azimuth.min())
        for index, one in enumerate(turns):
            headings = _headings(max(_step(lens), COARSE_MIN, one.step), facing)
            cost, change, turned = _slide(seen, one, headings)
            order = [
                (float(cost[i]), float(headings[i]), lens, tilt + float(change[i]), index, roll + float(turned[i]))
                for i in _cheapest(cost, headings.size) if np.isfinite(cost[i])
            ]
            # each lens's and cut's own few places, so one cannot crowd out the others
            rows.extend(_spread_out(order, max(APART_MIN, widths[lens] / 2), PER_LENS))
    if not rows:
        return Match("none", [])
    rows.sort(key=lambda row: row[0])
    apart = max(APART_MIN, widths[rows[0][2]] / 2)
    # a lens the analyst bounds stays within the bounds
    bounds = (min(within), max(within)) if within is not None and not known else None
    refined = []
    for _, h, f, t, index, r in _spread_out(rows, apart, 1 if rough else QUICK_REFINED if quick else REFINED):
        fit = _refine(x, y, turns[index], heading=h, tilt=float(np.clip(t, -89.0, 89.0)), fov=f, roll=r,
                      half_width=half_width, free=not known, level=level, start=roll,
                      widen=RANGE_EASE if within is not None else 1.03, projection=projection, bounds=bounds)
        if fit is not None and marks is not None:
            fit = _judge(fit, x, y, turns[index], marks, ridges, half_width, projection)
        refined.append(fit)
    found = sorted((fit for fit in refined if fit is not None), key=lambda fit: -fit.explained)
    if facing is not None:
        found = [fit for fit in found if _apart(fit.heading, facing[0]) <= facing[1]]
    fits: list[Fit] = []
    for fit in found:
        if all(_apart(fit.heading, k.heading) >= apart for k in fits):
            fits.append(fit)
    fits = fits[:KEPT]
    if not fits:
        return Match("none", [])
    return Match(_verdict(x, y, fits, half_width), fits)


def shape(x: np.ndarray, y: np.ndarray, half_width: float) -> float:
    """How far the trace strays from a straight line, in pixels, but for a stray few points."""
    return float(np.quantile(np.abs(off_line(x, y, half_width)), FLAT_SHARE))


def _verdict(x: np.ndarray, y: np.ndarray, fits: list[Fit], half_width: float) -> Verdict:
    best = fits[0]
    if shape(x, y, half_width) < FLAT_PX:
        return "flat"
    if best.explained < NONE_BELOW:
        return "none"
    if len(fits) > 1 and fits[1].explained >= AMBIGUOUS_SHARE * best.explained:
        return "ambiguous"
    if best.explained < LOOSE_BELOW:
        return "loose"
    return "match"
