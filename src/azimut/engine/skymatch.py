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
SLIDE_POINTS = 240
# A lens is slid in steps of this share of its width, within these bounds (degrees).
PACE = 1 / 240
STEP_MIN = 0.05
STEP_MAX = 0.5
# Headings slid at once: bounds the memory of a narrow lens's long slide.
BLOCK = 1024
# When the photo does not say its lens, lenses from the view's own divided by
# this to multiplied by it are tried, each this much wider than the last. Set
# the view's lens near the photo's first: a free lens fits too much.
LENS_REACH = 1.5
LENS_RATIO = 1.08
FOV_MIN = 1.0
FOV_MAX = 150.0
# Headings closer than this, or than half the trace's width, are one place.
APART_MIN = 5.0
# Places kept per lens, places refined, and places returned.
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

    def at(self, azimuth: np.ndarray | float) -> np.ndarray:
        """The skyline at any azimuth, between the two columns either side."""
        count = self.angles.size
        place = ((np.asarray(azimuth, dtype=np.float64) - self.start) % 360.0) / self.step
        below = np.floor(place)
        share = place - below
        i0 = below.astype(np.int64) % count
        a = self.angles[i0]
        b = self.angles[(i0 + 1) % count]
        out = a + (b - a) * share
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


def lenses(fov: float, *, known: bool) -> list[float]:
    """The fields of view tried: the photo's own when it says one, else a range about the view's."""
    fov = min(FOV_MAX, max(FOV_MIN, float(fov)))
    if known:
        return [fov]
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


def _through(
    x: np.ndarray, y: np.ndarray, fov: float, tilt: float, roll: float, half_width: float,
) -> _Seen:
    azimuth, elevation = directions(x, y, fov=fov, tilt=tilt, roll=roll)
    _, above = directions(x, y, fov=fov, tilt=tilt + 0.5, roll=roll)
    _, below = directions(x, y, fov=fov, tilt=tilt - 0.5, roll=roll)
    # a point never rises less than a tenth as fast as the middle, short of a lens wider than any
    lift = np.maximum(above - below, 0.1)
    return _Seen(fov, tilt, azimuth, elevation, lift, _per_degree(fov, half_width))


def _slide(seen: _Seen, turn: Turn, headings: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The cost of the trace at each heading, and the tilt change that lays it there."""
    cost = np.empty(headings.size)
    tilt = np.empty(headings.size)
    for start in range(0, headings.size, BLOCK):
        block = headings[start:start + BLOCK]
        gap = seen.elevation[None, :] - turn.at(block[:, None] + seen.azimuth[None, :])
        asked = -gap / seen.lift[None, :]
        lost = np.isnan(gap)
        found = (~lost).sum(axis=1)
        if lost.any():
            change = np.zeros(block.size)
            some = found > 0
            change[some] = np.nanmedian(asked[some], axis=1)
        else:
            change = np.median(asked, axis=1)
        loss = _loss((gap + change[:, None] * seen.lift[None, :]) * seen.per_degree)
        loss[lost] = LOST_LOSS
        block_cost = loss.mean(axis=1)
        block_cost[found < MIN_POINTS] = np.inf
        cost[start:start + BLOCK] = block_cost
        tilt[start:start + BLOCK] = change
    return cost, tilt


def _apart(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


# A place found by a slide: its cost, heading, lens and tilt.
_Row = tuple[float, float, float, float]


def _spread_out(order: list[_Row], apart: float, most: int) -> list[_Row]:
    """The first rows of `order` whose headings stand `apart` degrees from each other."""
    kept: list[_Row] = []
    for row in order:
        if all(_apart(row[1], k[1]) >= apart for k in kept):
            kept.append(row)
            if len(kept) == most:
                break
    return kept


def _refine(
    x: np.ndarray, y: np.ndarray, turn: Turn, *, heading: float, tilt: float, fov: float,
    roll: float, half_width: float, free: bool,
) -> Fit | None:
    """A coarse place made exact: heading searched finely, tilt laid onto the trace, lens eased."""
    step = _step(fov)
    widen = 1.03
    for _ in range(3):
        best: _Row | None = None
        for lens in ([fov / widen, fov, fov * widen] if free else [fov]):
            lens = min(FOV_MAX, max(FOV_MIN, lens))
            seen = _through(x, y, lens, tilt, roll, half_width)
            headings = heading + np.linspace(-2 * step, 2 * step, 17)
            cost, change = _slide(seen, turn, headings)
            i = int(np.argmin(cost))
            if np.isfinite(cost[i]) and (best is None or cost[i] < best[0]):
                best = (float(cost[i]), float(headings[i]), lens, tilt + float(change[i]))
        if best is None:
            return None
        _, heading, fov, tilt = best
        tilt = float(np.clip(tilt, -89.0, 89.0))
        step /= 4
        widen = 1 + (widen - 1) / 2
    seen = _through(x, y, fov, tilt, roll, half_width)
    gap = seen.elevation - turn.at(heading + seen.azimuth)
    hit = ~np.isnan(gap)
    if hit.sum() < MIN_POINTS:
        return None
    middle = float(np.median(gap[hit]))
    loss = np.full(gap.size, LOST_LOSS)
    loss[hit] = _loss((gap[hit] - middle) * seen.per_degree)
    level = float(_loss(_off_level(x, y, seen, roll) * seen.per_degree).mean())
    return Fit(
        heading=heading % 360.0,
        tilt=float(np.clip(tilt - middle, -89.0, 89.0)),
        fov=fov,
        gap=float(np.median(np.abs(gap[hit] - middle))),
        explained=1.0 - float(loss.mean()) / level if level > 0 else 0.0,
        points=int(hit.sum()),
    )


def match(
    x: np.ndarray, y: np.ndarray, turn: Turn, *, half_width: float, fov: float,
    known: bool = False, tilt: float = 0.0, roll: float = 0.0,
) -> Match:
    """The headings, lenses and tilts that bring `turn` onto the trace (x, y), and a verdict.

    `half_width` is half the frame's width in screen pixels, which sets how
    many pixels a degree spans. `fov` is the lens, `known` when the photo says
    it, and `tilt` and `roll` the camera the search starts from: the roll is
    kept, the tilt and an unknown lens follow the trace.
    """
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    if x.size < MIN_POINTS:
        return Match("none", [])
    pick = np.unique(np.linspace(0, x.size - 1, min(x.size, SLIDE_POINTS)).round().astype(int))
    xs, ys = x[pick], y[pick]

    rows: list[_Row] = []
    widths: dict[float, float] = {}
    for lens in lenses(fov, known=known):
        seen = _through(xs, ys, lens, tilt, roll, half_width)
        widths[lens] = float(seen.azimuth.max() - seen.azimuth.min())
        headings = np.arange(0.0, 360.0, _step(lens))
        cost, change = _slide(seen, turn, headings)
        order = [
            (float(cost[i]), float(headings[i]), lens, tilt + float(change[i]))
            for i in np.argsort(cost) if np.isfinite(cost[i])
        ]
        # each lens's own few places, so one lens cannot crowd out the others
        rows.extend(_spread_out(order, max(APART_MIN, widths[lens] / 2), PER_LENS))
    if not rows:
        return Match("none", [])
    rows.sort(key=lambda row: row[0])
    apart = max(APART_MIN, widths[rows[0][2]] / 2)
    refined = [
        _refine(x, y, turn, heading=h, tilt=float(np.clip(t, -89.0, 89.0)), fov=f, roll=roll,
                half_width=half_width, free=not known)
        for _, h, f, t in _spread_out(rows, apart, REFINED)
    ]
    found = sorted((fit for fit in refined if fit is not None), key=lambda fit: -fit.explained)
    fits: list[Fit] = []
    for fit in found:
        if all(_apart(fit.heading, k.heading) >= apart for k in fits):
            fits.append(fit)
    fits = fits[:KEPT]
    if not fits:
        return Match("none", [])
    return Match(_verdict(x, y, fits, roll, half_width), fits)


def _off_level(x: np.ndarray, y: np.ndarray, seen: _Seen, roll: float) -> np.ndarray:
    """How far each point stands from a level line across the picture, in degrees.

    The line runs through the trace's middle height: what a sea horizon would
    show, at any tilt.
    """
    middle = np.full(x.size, float(np.median(y)))
    _, level = directions(x, middle, fov=seen.fov, tilt=seen.tilt, roll=roll)
    return seen.elevation - level


def _shape(x: np.ndarray, y: np.ndarray, fit: Fit, roll: float, half_width: float) -> float:
    """How far the trace rises or falls from a level line, in pixels, but for a stray few points."""
    seen = _through(x, y, fit.fov, fit.tilt, roll, half_width)
    return float(np.quantile(np.abs(_off_level(x, y, seen, roll)), FLAT_SHARE)) * seen.per_degree


def _verdict(
    x: np.ndarray, y: np.ndarray, fits: list[Fit], roll: float, half_width: float,
) -> Verdict:
    best = fits[0]
    if _shape(x, y, best, roll, half_width) < FLAT_PX:
        return "flat"
    if best.explained < NONE_BELOW:
        return "none"
    if len(fits) > 1 and fits[1].explained >= AMBIGUOUS_SHARE * best.explained:
        return "ambiguous"
    if best.explained < LOOSE_BELOW:
        return "loose"
    return "match"
