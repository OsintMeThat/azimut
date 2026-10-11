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

A low skyline fits a flat line almost as well as it fits the right heading, so
a fit is judged by how much of the trace's shape it explains: one minus its
cost over the cost of a level line across the picture, a sea horizon
(`explained`). The best places far enough apart to be separate on the turn
come back with a verdict: `match` when one explains the trace clearly, `loose`
when the best explains less than half of it, `ambiguous` when another explains
it about as well, `none` when nothing on the turn does, `flat` when the trace
has too little shape to tell a heading.

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

The verdict is a hint, not a proof. With the lens free, a weak trace finds a
coincidence somewhere on most turns: measured over real relief (the Schilthorn,
and a desert in Yemen with a real photo), the right heading came first at the
right eye, and its `explained` beat the best of every wrong eye nearby, but a
wrong eye could still pass for `loose`. Horizon's Fit asks it at the eye; the
viewpoint finder is meant to ask it at every point of an area and compare.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
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
# Headings closer than this, or than half the trace's width, are one place.
APART_MIN = 5.0
# Places kept per lens, places refined, and places returned. The cheapest
# `CANDIDATES` headings of a slide are enough to find a lens's places apart.
CANDIDATES = 400
PER_LENS = 6
REFINED = 8
KEPT = 3
# The verdict. A trace whose points all stand within this many screen pixels of
# a level line, but for a stray few, has no shape to place: one clear peak is
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

Verdict = Literal["match", "loose", "ambiguous", "none", "flat"]


@dataclass(frozen=True)
class Turn:
    """The terrain's skyline all round: degrees at `start + i·step`, NaN where none stands."""

    start: float
    step: float
    angles: np.ndarray
    # how far out the turn was cut, metres: None when it reaches as far as the terrain is read
    reach: float | None = None

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


def directions(
    x: np.ndarray, y: np.ndarray, *, fov: float, tilt: float = 0.0, roll: float = 0.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Azimuth from the heading and elevation, in degrees, of picture-plane points.

    camera.js `rayFor` at heading 0: forward tilted up by `tilt`, the frame
    turned clockwise by `roll`.
    """
    t, r = math.radians(tilt), math.radians(roll)
    scale = math.tan(math.radians(fov) / 2)
    sx = np.asarray(x, dtype=np.float64) * scale
    sy = np.asarray(y, dtype=np.float64) * scale
    st, ct, sr, cr = math.sin(t), math.cos(t), math.sin(r), math.cos(r)
    east = sx * cr + sy * sr
    north = ct + sx * st * sr - sy * st * cr
    up = st - sx * ct * sr + sy * ct * cr
    return np.degrees(np.arctan2(east, north)), np.degrees(np.arctan2(up, np.hypot(east, north)))


def lenses(fov: float, *, known: bool, within: tuple[float, float] | None = None) -> list[float]:
    """The fields of view tried: the photo's own when it says one, else every step
    across `within` when the analyst bounds it, else a range about the view's."""
    fov = min(FOV_MAX, max(FOV_MIN, float(fov)))
    if known:
        return [fov]
    if within is not None:
        low, high = (min(FOV_MAX, max(FOV_MIN, float(v))) for v in sorted(within))
        count = max(1, int(math.ceil(math.log(high / low) / math.log(RANGE_RATIO))))
        return sorted({low * (high / low) ** (i / count) for i in range(count + 1)}) if high > low else [low]
    steps = int(math.floor(math.log(LENS_REACH) / math.log(LENS_RATIO)))
    # clipped at either end of the lenses a view has, where several steps then meet
    tried = {min(FOV_MAX, max(FOV_MIN, fov * LENS_RATIO**i)) for i in range(-steps, steps + 1)}
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


@dataclass(frozen=True)
class Match:
    verdict: Verdict
    fits: list[Fit]  # best first, each a separate place on the turn


LOST_LOSS = HUBER_PX * (LOST_PX - 0.5 * HUBER_PX)


def _loss(px: np.ndarray) -> np.ndarray:
    a = np.abs(px)
    huber = np.where(a <= HUBER_PX, 0.5 * a * a, HUBER_PX * (a - 0.5 * HUBER_PX))
    return np.minimum(huber, LOST_LOSS)


def _per_degree(fov: float, half_width: float) -> float:
    """Screen pixels a degree spans at the lens's middle."""
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


def _through(
    x: np.ndarray, y: np.ndarray, fov: float, tilt: float, roll: float, half_width: float,
    *, twist: bool = False,
) -> _Seen:
    azimuth, elevation = directions(x, y, fov=fov, tilt=tilt, roll=roll)
    _, above = directions(x, y, fov=fov, tilt=tilt + 0.5, roll=roll)
    _, below = directions(x, y, fov=fov, tilt=tilt - 0.5, roll=roll)
    # a point never rises less than a tenth as fast as the middle, short of a lens wider than any
    lift = np.maximum(above - below, 0.1)
    turned = None
    if twist:
        _, right = directions(x, y, fov=fov, tilt=tilt, roll=roll + 0.5)
        _, left = directions(x, y, fov=fov, tilt=tilt, roll=roll - 0.5)
        turned = right - left
    return _Seen(fov, tilt, azimuth, elevation, lift, _per_degree(fov, half_width), turned)


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
    start: float | None = None,
) -> Fit | None:
    """A coarse place made exact: heading searched finely, tilt laid onto the trace, lens and roll eased.

    The roll is eased about `roll`, never farther than `ROLL_REACH` from `start`
    (where the search began).
    """
    step = _step(fov)
    start = roll if start is None else start
    ease: float | None = None
    for _ in range(3):
        best: tuple[float, float, float, float, float] | None = None
        rolls = [roll] if level else _rolls(start, roll, ease)
        for lens in ([fov / widen, fov, fov * widen] if free else [fov]):
            lens = min(FOV_MAX, max(FOV_MIN, lens))
            for turned in rolls:
                seen = _through(x, y, lens, tilt, turned, half_width)
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
    seen = _through(x, y, fov, tilt, roll, half_width)
    gap = seen.elevation - turn.at(heading + seen.azimuth)
    hit = ~np.isnan(gap)
    if hit.sum() < MIN_POINTS:
        return None
    middle = float(np.median(gap[hit]))
    loss = np.full(gap.size, LOST_LOSS)
    loss[hit] = _loss((gap[hit] - middle) * seen.per_degree)
    level_cost = float(_loss(_off_level(x, y, seen, roll) * seen.per_degree).mean())
    return Fit(
        heading=heading % 360.0,
        tilt=float(np.clip(tilt - middle, -89.0, 89.0)),
        fov=fov,
        gap=float(np.median(np.abs(gap[hit] - middle))),
        explained=1.0 - float(loss.mean()) / level_cost if level_cost > 0 else 0.0,
        points=int(hit.sum()),
        roll=roll,
        reach=turn.reach,
    )


def match(
    x: np.ndarray, y: np.ndarray, turn: Turn | list[Turn], *, half_width: float, fov: float,
    known: bool = False, tilt: float = 0.0, roll: float = 0.0,
    within: tuple[float, float] | None = None, facing: tuple[float, float] | None = None,
    level: bool = False,
) -> Match:
    """The headings, lenses and tilts that bring `turn` onto the trace (x, y), and a verdict.

    `half_width` is half the frame's width in screen pixels, which sets how
    many pixels a degree spans. `fov` is the lens, `known` when the photo says
    it, and `tilt` and `roll` the camera the search starts from: the tilt and an
    unknown lens follow the trace, the roll is eased a few degrees unless
    `level` holds it. `within` bounds an unknown lens (degrees, low and high),
    `facing` the heading to a sector (its middle and half its width). `turn`
    may be several cuts of the same turn (`Turn.reach`): each place says which
    one it lies on.
    """
    turns = [turn] if isinstance(turn, Turn) else list(turn)
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    if x.size < MIN_POINTS or not turns:
        return Match("none", [])
    pick = np.unique(np.linspace(0, x.size - 1, min(x.size, SLIDE_POINTS)).round().astype(int))
    xs, ys = x[pick], y[pick]

    rows: list[_Row] = []
    widths: dict[float, float] = {}
    for lens in lenses(fov, known=known, within=within):
        seen = _through(xs, ys, lens, tilt, roll, half_width, twist=not level)
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
    refined = [
        _refine(x, y, turns[index], heading=h, tilt=float(np.clip(t, -89.0, 89.0)), fov=f, roll=r,
                half_width=half_width, free=not known, level=level, start=roll,
                widen=RANGE_EASE if within is not None else 1.03)
        for _, h, f, t, index, r in _spread_out(rows, apart, REFINED)
    ]
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


def _off_level(x: np.ndarray, y: np.ndarray, seen: _Seen, roll: float) -> np.ndarray:
    """How far each point stands from a level line across the picture, in degrees.

    The line runs through the trace's middle height: what a sea horizon would
    show, at any tilt.
    """
    middle = np.full(x.size, float(np.median(y)))
    _, level = directions(x, middle, fov=seen.fov, tilt=seen.tilt, roll=roll)
    return seen.elevation - level


def _shape(x: np.ndarray, y: np.ndarray, fit: Fit, half_width: float) -> float:
    """How far the trace rises or falls from a level line, in pixels, but for a stray few points."""
    seen = _through(x, y, fit.fov, fit.tilt, fit.roll, half_width)
    return float(np.quantile(np.abs(_off_level(x, y, seen, fit.roll)), FLAT_SHARE)) * seen.per_degree


def _verdict(x: np.ndarray, y: np.ndarray, fits: list[Fit], half_width: float) -> Verdict:
    best = fits[0]
    if _shape(x, y, best, half_width) < FLAT_PX:
        return "flat"
    if best.explained < NONE_BELOW:
        return "none"
    if len(fits) > 1 and fits[1].explained >= AMBIGUOUS_SHARE * best.explained:
        return "ambiguous"
    if best.explained < LOOSE_BELOW:
        return "loose"
    return "match"
