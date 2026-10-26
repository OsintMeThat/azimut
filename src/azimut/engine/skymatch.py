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

How far each line stands, when the analyst says it (`Marks.far`: a stroke and
the distances it may stand at, metres), bounds the ground it may lie on: a point
whose skyline column is set by ground nearer or farther than its line's band,
widened by `BAND_SLACK` for the guess and the terrain's grain, counts as lost.
A line said to stand 1 to 3 km off then cannot be laid on a ridge 20 km out, nor
on the slope at the eye's feet. Lines the analyst said nothing about may be kept
off the ground nearer than a `floor` the search gives: on foot, the terrain's
30 m grain draws the eye's own slope as a ridge a few metres high that any trace
can be laid on with a steep tilt (measured on the owner's searches: 12 of 136
places lay on ground 25 to 150 m away).

A line the analyst is sure has only sky above it (`Marks.clear`) says more than
where it lies: no terrain stands over it. So it is laid on the top of the land
the photo would show over it, not on a cut's: as far as the analyst says the
photo sees (`clear`), else out to `CLEAR_NEAR` times as far as the ground the line
lies on at that cut (`_tops`). A place cannot then lay it on a near ridge with a
range standing behind. And a place where the terrain still stands over such a
line loses its score as that share of the line grows, and is ruled out past
`CLEAR_HARD` of it, saying how far out that land stands (`Fit.over_far`). Left
to Auto, land past `CLEAR_NEAR` times the line's own distance counts less and
less out to `CLEAR_FAR` times it: haze grows ever likelier to hide it.

The camera's tilt may be bounded too (`tilts`, degrees): a skyline filmed on foot
is near level, and a place that needs the camera 40° down to lay the trace has
found the ground, not the skyline.

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
from collections.abc import Sequence
from typing import Literal, cast

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
# A rough slide over at least `SIFT_HEADINGS` headings (a narrow lens) is read first off every `SIFT_EVERY`th
# point, and only its `SIFT_KEEP` cheapest headings are slid with them all. Measured on the owner's telephoto
# views (2026-10-24): the best place of 90 points stood within the sifted 89 cheapest of up to 3,600; across a
# wide lens the sift lost it, so a wide lens is slid whole.
SIFT_HEADINGS = 1500
SIFT_EVERY = 5
SIFT_KEEP = 256
# The score: the trace is judged in this many parts across its width, the weakest
# `LET_GO` of them let go and the next `WEAKEST` averaged, so one stretch the
# terrain cannot hold (a collage's edge, a ridge too near for its cell) does not
# zero a place whose other parts fit, while a place must still fit across most
# of the trace (measured on the owner's solved views, 2026-10-21). A part a
# straight line already follows within this many pixels has no shape of its own:
# it must only lie on the terrain that close.
PARTS = 4
LET_GO = 1
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
# A line said to stand between two distances may lie on ground this many times nearer than the
# first and farther than the second: a guess, and ridges known only as finely as the terrain.
BAND_SLACK = 1.33
# A fit whose tilt ends this far past the bounds asked is no fit.
TILT_SLACK = 1.0
# Near lines rounded, when asked: the trace and the terrain under it are both averaged over this many times
# the angle a cell of the terrain spans at the distance of the ground a point is laid on, out to `ROUND_FAR`
# metres. A ridge a few hundred metres off is known to the terrain's cell only, so the teeth a photo shows on
# it are in no terrain: the nearer, the rounder. Ground nearer than `ROUND_CLOSEST` is rounded as if it stood
# that far: rounded harder still, a near hillside loses all its shape and passes for any trace. Measured on
# the owner's solved views (2026-10-21): a whole cell, or no closest, lifted near hills' chance fits over a
# cliff's truth; half a cell from a kilometre kept every truth first but the cliff, second.
ROUND_SPAN = 0.5
ROUND_FAR = 3_000.0
ROUND_CLOSEST = 1_000.0
# A pair of strokes standing in the wrong order takes this share of the score per pair asked, shared as if there
# were PAIR_MIN at least: one pair alone never halves a place (v29's truth: its two strokes 2,249 and 2,303 m out,
# the front not a tenth nearer, lost half its score; a lone pair counted as one of three, 19th of 41 to 3rd, no
# other case moved).
PAIR_COST = 0.5
PAIR_MIN = 3
# A ridge stands in front of another when it is nearer by this share of the other's distance.
PAIR_NEARER = 0.9
# A point of a line said to have only sky above lies under the terrain when the terrain stands over it by more
# than this many pixels and more than the angle the heights' own error spans at that terrain's distance, metres.
# The terrain may stand over this share of such lines (a stroke's end run high, a spike in the heights); the
# place keeps none of its score once it stands over the second. Measured on the owner's solved views with every
# skyline line marked (2026-10-21): at 4 px a wide collage's own fit, 13 px off at 13 km, sank its truth from
# first to seventeenth; at the loss's lost level no truth moved back, one rose to first, rivals lost score.
CLEAR_PX = LOST_PX
CLEAR_GRAIN_M = 15.0
CLEAR_FREE = 0.02
# Past this share the place is ruled out, and says so. Measured on the bench (2026-10-22): ruled out at a twentieth,
# the owner's hilltop view with every skyline line marked sank from fifth to eighteenth (its truth has 3% of a line
# under a ridge 2.6 km out, the heights' own grain); at a tenth it rose to fourth.
CLEAR_HARD = 0.10
# What a place keeps of its score at worst, land over its sky-only lines past CLEAR_HARD: 0 rules it out.
CLEAR_KEEP = 0.0
# Left to Auto, a line with only sky above is laid on the top of the land out to CLEAR_NEAR times as far as the ground
# it lies on, and land standing over it counts in full that far, then less and less out to CLEAR_FAR times it, haze
# growing likelier to hide it (until the photo's own visibility is read: Koschmieder, FIND_SMART_PLAN §3). Measured
# on the bench's 34 sky-only cases (2026-10-22): 3 and 6 lift the truths first from 50% to 53% and rule out the
# fewest truths (2 of 34); 1.5 and 3 lost one, 2 and 4 ruled out four.
CLEAR_NEAR = 3.0
CLEAR_FAR = 6.0
# Land over a line with only sky above counts only standing behind the ridge the place lays the line on, this many
# times as far out. That ridge a few pixels over the trace is the line's own crest drawn a little low (30 m cells
# round a cliff's top, a stroke's width, a lens a little off): the fit's give, which its loss already charges, not
# a range behind. Measured on the owner's real cases (2026-10-24): at each truth's heading the land counted "over"
# stood at the line's own distance (v01 2.9 km on a skyline 2.3–6.2 km out, v06 1.9 on 0.5–2.3, v09 3.1 on
# 1.3–7.3), and ruled the truth out though nothing stands behind (the owner's 3D view of v01).
BEHIND = 1.5
# The ridge the line lies on standing over the trace counts as this share of land behind: the photo shows sky where
# the terrain has land, some evidence against the place, though cells round a crest and a stroke has a width.
OWN_SHARE = 0.0

Verdict = Literal["match", "loose", "ambiguous", "none", "flat"]
Projection = Literal["camera", "panorama"]
# A sector of headings: its middle and half its width, degrees.
Sector = tuple[float, float]


def sectors_of(facing: Sector | Sequence[Sector] | None) -> tuple[Sector, ...] | None:
    """One sector or several as a tuple of sectors; None for the whole turn."""
    if facing is None or len(facing) == 0:
        return None
    if isinstance(facing[0], (int, float)):
        one = cast(Sector, facing)
        return ((float(one[0]), float(one[1])),)
    return tuple((float(c), float(h)) for c, h in cast(Sequence[Sector], facing))


def within_sectors(heading: float, sectors: tuple[Sector, ...]) -> bool:
    """Whether a heading lies in any of the sectors."""
    return any(_apart(heading, centre) <= half for centre, half in sectors)


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
        # each column and the one after it (the first again after the last), where one has no ground the other
        # standing for both, as in the browser: what a read between them starts from and goes to
        after = np.roll(angles, -1)
        object.__setattr__(self, "_from", np.where(np.isnan(angles), after, angles))
        object.__setattr__(self, "_to", np.where(np.isnan(after), angles, after))

    def place(self, azimuth: np.ndarray | float) -> np.ndarray:
        """Where each azimuth falls among the columns, in columns from the first: what `at` and `far` read off."""
        turned = np.asarray(azimuth, dtype=np.float64) - self.start
        if turned.size and -360.0 <= turned.min() and turned.max() < 720.0:
            # `np.remainder(turned, 360.0)` to the bit, three times cheaper, on the span a slide reads: taking 360
            # off [360, 720) is exact, adding it to [-360, 0) rounds as remainder's own fix-up does, and + 0.0
            # gives its +0 for -0
            wrapped = np.where(turned < 0.0, turned + 360.0, np.where(turned >= 360.0, turned - 360.0, turned)) + 0.0
        else:
            wrapped = np.remainder(turned, 360.0)
        return wrapped / self.step

    def at(self, azimuth: np.ndarray | float) -> np.ndarray:
        """The skyline at any azimuth, between the two columns either side."""
        return self.at_place(self.place(azimuth))

    def at_place(self, place: np.ndarray) -> np.ndarray:
        """`at`, the azimuths given by their `place`."""
        # a place is never below the first column: its whole part is its floor
        below = np.asarray(place).astype(np.int64)
        share = place - below
        # 360° itself can round onto the column past the last
        i0 = np.minimum(below, self.angles.size - 1)
        a = self._from.take(i0)  # type: ignore[attr-defined]
        return a + (self._to.take(i0) - a) * share  # type: ignore[attr-defined]

    def far(self, azimuth: np.ndarray) -> np.ndarray:
        """How far out the skyline stands at each azimuth, the nearest column's: NaN when the sweep did not say."""
        azimuth = np.asarray(azimuth, dtype=np.float64)
        if self.distance is None:
            return np.full(azimuth.shape, np.nan)
        return self.far_place(self.place(azimuth))

    def far_place(self, place: np.ndarray) -> np.ndarray:
        """`far`, the azimuths given by their `place`."""
        if self.distance is None:
            return np.full(np.shape(place), np.nan)
        count = self.angles.size
        column = np.rint(place).astype(np.int64) % count
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
        self, azimuth: np.ndarray, elevation: np.ndarray, bands: tuple[np.ndarray, np.ndarray] | None = None,
    ) -> tuple[np.ndarray, np.ndarray]:
        """For each direction, the angle (degrees, + above) to the nearest silhouette in its column, within
        each direction's band (`bands`: low and high, metres) when given, and that silhouette's distance: NaN
        where the column holds none."""
        azimuth = np.asarray(azimuth, dtype=np.float64)
        elevation = np.asarray(elevation, dtype=np.float64)
        count = self.angle.shape[0]
        column = np.rint(np.remainder(azimuth - self.start, 360.0) / self.step).astype(np.int64) % count
        angles = self.angle[column]
        distances = self.distance[column]
        if bands is not None:
            low, high = bands
            angles = np.where((distances >= low[:, None]) & (distances <= high[:, None]), angles, np.nan)
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
    `ridge_piece` say which piece of a collage each point lies in. `far` says
    how far some strokes stand: (stroke, nearest, farthest) in metres. `sea`
    names the strokes traced along the sea's horizon, whose distance the eye's
    height above the sea sets (engine/finder.py). `clear` names the strokes the
    analyst is sure have only sky above them.
    """

    ridge_x: np.ndarray = field(default_factory=lambda: np.empty(0))
    ridge_y: np.ndarray = field(default_factory=lambda: np.empty(0))
    line: np.ndarray | None = None
    ridge_line: np.ndarray | None = None
    pairs: tuple[tuple[int, int], ...] = ()
    piece: np.ndarray | None = None
    ridge_piece: np.ndarray | None = None
    far: tuple[tuple[int, float, float], ...] = ()
    sea: tuple[int, ...] = ()
    clear: tuple[int, ...] = ()

    @property
    def cut(self) -> bool:
        """Whether the photo is a collage cut in more than one piece."""
        return self.piece is not None and np.unique(self.piece).size > 1


def bands_of(
    lines: np.ndarray | None, count: int, far: Sequence[tuple[int, float, float]], floor: float = 0.0,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Each point's band, metres (low, high): its stroke's as the analyst said it, widened by
    `BAND_SLACK`, else from `floor` out to anywhere; None when nothing bounds any point."""
    said = bool(far) and lines is not None and np.asarray(lines).size == count
    if not said and floor <= 0:
        return None
    low = np.full(count, float(floor))
    high = np.full(count, np.inf)
    if said:
        lines = np.asarray(lines)
        for stroke, nearest, farthest in far:
            on = lines == stroke
            low[on] = float(nearest) / BAND_SLACK
            high[on] = float(farthest) * BAND_SLACK
    return low, high


def _read(
    turn: Turn, top: Turn | None, sure: np.ndarray | None, azimuth: np.ndarray, far: bool,
) -> tuple[np.ndarray, np.ndarray | None]:
    """`_at`, and `_far` when asked, read off one placing of the azimuths: the turn's for every point, the top's
    for the points of lines with only sky above (`sure`, along the last axis)."""
    place = turn.place(azimuth)
    ground = turn.at_place(place)
    out = turn.far_place(place) if far else None
    if top is None or sure is None or not sure.any():
        return ground, out
    held = place[..., sure] if (top.start, top.step) == (turn.start, turn.step) else top.place(azimuth[..., sure])
    ground[..., sure] = top.at_place(held)
    if out is not None:
        out[..., sure] = top.far_place(held)
    return ground, out


def _gap(
    elevation: np.ndarray, turn: Turn, top: Turn | None, sure: np.ndarray | None, azimuth: np.ndarray,
    low: np.ndarray | None, high: np.ndarray | None,
) -> np.ndarray:
    """How far each point stands over the skyline it is laid on (`_at`), NaN where that skyline's ground stands
    outside the point's band (`_gate`): both read off one placing of the azimuths."""
    gated = low is not None and high is not None and turn.distance is not None
    ground, far = _read(turn, top, sure, azimuth, gated)
    gap = elevation - ground
    if far is not None:
        gap = np.where((far < low) | (far > high), np.nan, gap)
    return gap


def _at(turn: Turn, top: Turn | None, sure: np.ndarray | None, azimuth: np.ndarray) -> np.ndarray:
    """The skyline each point is laid on: the turn's, or the top of the land for the points of lines said to
    have only sky above (`sure`, along the last axis of `azimuth`)."""
    ground = turn.at(azimuth)
    if top is None or sure is None or not sure.any():
        return ground
    return np.where(sure, top.at(azimuth), ground)


def _far(turn: Turn, top: Turn | None, sure: np.ndarray | None, azimuth: np.ndarray) -> np.ndarray:
    """How far out the skyline each point is laid on stands (`_at`), metres."""
    out = turn.far(azimuth)
    if top is None or sure is None or not sure.any():
        return out
    return np.where(sure, top.far(azimuth), out)


def _gate(
    gap: np.ndarray, turn: Turn, azimuth: np.ndarray, low: np.ndarray | None, high: np.ndarray | None,
    top: Turn | None = None, sure: np.ndarray | None = None,
) -> np.ndarray:
    """The gaps of points whose skyline is set by ground outside their band made NaN: lost."""
    if low is None or high is None or turn.distance is None:
        return gap
    out = _far(turn, top, sure, azimuth)
    return np.where((out < low) | (out > high), np.nan, gap)


def _tops(turns: Sequence[Turn]) -> list[Turn | None]:
    """For each cut of a turn, the top of the land a line with only sky above is laid on there: in each column,
    the highest skyline among the cuts whose ground there stands within the cut, or within `CLEAR_NEAR` times
    as far as that cut's own ground, and never short of the cut itself. None for a cut whose distances the sweep
    did not say."""
    if any(one.distance is None for one in turns):
        return [None] * len(turns)
    reach = np.array([math.inf if one.reach is None else float(one.reach) for one in turns])
    angles = np.stack([np.asarray(one.angles, dtype=np.float64) for one in turns])
    distances = np.stack([np.asarray(one.distance, dtype=np.float64) for one in turns])
    out: list[Turn | None] = []
    for i, one in enumerate(turns):
        sees = np.maximum(reach[i], CLEAR_NEAR * np.nan_to_num(distances[i], nan=0.0))
        held = (np.nan_to_num(distances, nan=np.inf) <= sees[None, :]) | (np.arange(len(turns)) == i)[:, None]
        pick = np.argmax(np.where(held, np.nan_to_num(angles, nan=-np.inf), -np.inf), axis=0)
        columns = np.arange(angles.shape[1])
        out.append(replace(one, angles=angles[pick, columns], distance=distances[pick, columns]))
    return out


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
    # the share of the lines said to have only sky above that the terrain stands over, and how far out that
    # land stands, metres (the middle of it)
    over: float | None = None
    over_far: float | None = None


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
    the lesser of the whole's and the weakest parts' once the very weakest is let
    go. A straight trace explains nothing, however well it lies on some hillside.
    """
    line = _loss(off_line(x, y, half_width))
    whole_line = float(line.mean())
    # a trace with next to no shape can be explained no more than it has
    score = (whole_line - float(loss.mean())) / max(whole_line, LINE_FLOOR_LOSS)
    each = sorted(1.0 - float(loss[part].mean()) / max(float(line[part].mean()), PART_FLOOR_LOSS) for part in parts(x))
    if each:
        score = min(score, float(np.mean(each[LET_GO:LET_GO + WEAKEST] or each)))
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
    # each point's band, metres: the ground its skyline may be set by
    low: np.ndarray | None = None
    high: np.ndarray | None = None
    # the points of lines said to have only sky above, laid on the top of the land (`_tops`)
    sure: np.ndarray | None = None


def _through(
    x: np.ndarray, y: np.ndarray, fov: float, tilt: float, roll: float, half_width: float,
    *, twist: bool = False, projection: Projection = "camera", bands: tuple[np.ndarray, np.ndarray] | None = None,
    sure: np.ndarray | None = None,
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
        None if bands is None else bands[0], None if bands is None else bands[1], sure,
    )


def _rounded(
    azimuth: np.ndarray, rise: np.ndarray, turn: Turn, cell: float, top: Turn | None = None,
    sure: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """The trace's rise and the terrain's under it at each point, both rounded alike where the ground the point
    is laid on stands nearer than `ROUND_FAR`: averaged over the trace's points within `ROUND_SPAN` times the
    angle a `cell` metres wide spans there, so a trace lying exactly on the terrain still does."""
    ground = _at(turn, top, sure, azimuth)
    far = _far(turn, top, sure, azimuth)
    near = np.isfinite(far) & (far < ROUND_FAR) & np.isfinite(ground)
    if not near.any():
        return rise, ground
    sigma = np.degrees(ROUND_SPAN * cell / np.maximum(far[near], max(cell, ROUND_CLOSEST)))
    held = np.isfinite(ground)
    weight = np.exp(-0.5 * ((azimuth[None, :] - azimuth[near, None]) / sigma[:, None]) ** 2) * held[None, :]
    weight /= weight.sum(axis=1, keepdims=True)
    rise, ground = rise.copy(), ground.copy()
    rise[near] = weight @ rise
    ground[near] = weight @ np.where(held, ground, 0.0)
    return rise, ground


def _median_tilt(asked: np.ndarray, lost: np.ndarray, found: np.ndarray) -> np.ndarray:
    """Per heading, the tilt change the points ask for, the middle of them."""
    if not lost.any():
        return np.median(asked, axis=1)
    change = np.zeros(asked.shape[0])
    some = found > 0
    change[some] = _nanmedian_rows(asked[some], found[some])
    return change


def _nanmedian_rows(values: np.ndarray, count: np.ndarray) -> np.ndarray:
    """`np.nanmedian(values, axis=1)` for rows holding `count` numbers each, every one at least one. Rows under
    600 long send numpy's own through masked arrays, most of a telephoto's match time: a sort puts the NaN last,
    and the middle of the numbers is read straight off it."""
    ordered = np.sort(values, axis=1)
    rows = np.arange(values.shape[0])
    return (ordered[rows, (count - 1) // 2] + ordered[rows, count // 2]) / 2


def _slide(
    seen: _Seen, turn: Turn, headings: np.ndarray, tilts: tuple[float, float] | None = None, top: Turn | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The cost of the trace at each heading, and the tilt and roll changes that lay it there; a heading
    whose tilt falls outside `tilts` costs everything. The points of lines with only sky above are laid
    on `top` (`_tops`)."""
    cost = np.empty(headings.size)
    tilt = np.empty(headings.size)
    roll = np.zeros(headings.size)
    lift = seen.lift[None, :]
    for start in range(0, headings.size, BLOCK):
        block = headings[start:start + BLOCK]
        azimuth = block[:, None] + seen.azimuth[None, :]
        gap = _gap(seen.elevation[None, :], turn, top, seen.sure, azimuth, seen.low, seen.high)
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
        if tilts is not None:
            laid = seen.tilt + change
            block_cost[(laid < tilts[0]) | (laid > tilts[1])] = np.inf
        cost[start:start + BLOCK] = block_cost
        tilt[start:start + BLOCK] = change
    return cost, tilt, roll


def _alike(a: Turn | None, b: Turn | None) -> np.ndarray | None:
    """The columns two turns read alike, angle and distance; None when they cannot be told apart column by column."""
    if a is None or b is None:
        return None if a is not b else np.ones(0, dtype=bool)
    if (a.start, a.step, a.angles.size) != (b.start, b.step, b.angles.size) or (a.distance is None) != (b.distance is None):
        return None
    same = (a.angles == b.angles) | (np.isnan(a.angles) & np.isnan(b.angles))
    if a.distance is not None and b.distance is not None:
        far_a, far_b = np.asarray(a.distance), np.asarray(b.distance)
        same &= (far_a == far_b) | (np.isnan(far_a) & np.isnan(far_b))
    return same


def _slide_after(
    seen: _Seen, turn: Turn, headings: np.ndarray, tilts: tuple[float, float] | None, top: Turn | None,
    last: tuple[Turn, Turn | None, np.ndarray, tuple[np.ndarray, np.ndarray, np.ndarray]] | None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """`_slide` over a cut of the turn, the slide `last` made over the cut before it (turn, top, headings, result)
    taken as it is at every heading whose trace reads no column the two cuts tell apart: the same numbers in give
    the same numbers out. Most of a narrow lens's headings, where a nearer cut already holds the skyline."""
    if last is None or not np.array_equal(last[2], headings):
        return _slide(seen, turn, headings, tilts, top)
    same = _alike(last[0], turn)
    if seen.sure is not None and seen.sure.any():
        tops = _alike(last[1], top)
        if top is not None and (top.start, top.step) != (turn.start, turn.step):
            tops = None
        same = None if same is None or tops is None else same & tops if tops.size else same
    azimuth = seen.azimuth
    # the columns must close the turn, for a column's number to say where it stands
    if same is None or not np.isfinite(azimuth).all() or abs(same.size * turn.step - 360.0) > 1e-9:
        return _slide(seen, turn, headings, tilts, top)
    count = same.size
    # the columns a heading's points can read: floor and the one after for the skyline, the nearest for the
    # distance, a column more either side for rounding
    first = np.floor((headings + float(azimuth.min()) - turn.start) / turn.step).astype(np.int64) - 1
    width = np.floor((headings + float(azimuth.max()) - turn.start) / turn.step).astype(np.int64) + 3 - first
    differ = np.concatenate([[0], np.cumsum(np.tile(~same, 2))])
    at = first % count
    kept = (width < count) & (differ[at + np.minimum(width, count)] == differ[at])
    cost, change, turned = (np.array(one) for one in last[3])
    redo = ~kept
    if redo.any():
        cost[redo], change[redo], turned[redo] = _slide(seen, turn, headings[redo], tilts, top)
    return cost, change, turned


def _sift(
    seen: _Seen, turn: Turn, headings: np.ndarray, tilts: tuple[float, float] | None, top: Turn | None,
    last: tuple[Turn, Turn | None, np.ndarray, tuple[np.ndarray, np.ndarray, np.ndarray]] | None,
) -> tuple[tuple[np.ndarray, np.ndarray, np.ndarray], tuple[Turn, Turn | None, np.ndarray, tuple[np.ndarray, np.ndarray, np.ndarray]]]:
    """A rough `_slide` over many headings: every `SIFT_EVERY`th point slid first (over the cut before's sift,
    `last`, as `_slide_after` does), then every point at the `SIFT_KEEP` cheapest headings only, the others
    costing everything. Also gives the sift, for the next cut's."""
    pick = np.arange(0, seen.azimuth.size, SIFT_EVERY)

    def few(values: np.ndarray | None) -> np.ndarray | None:
        return None if values is None else values[pick]

    thin = replace(seen, azimuth=seen.azimuth[pick], elevation=seen.elevation[pick], lift=seen.lift[pick],
                   twist=few(seen.twist), low=few(seen.low), high=few(seen.high), sure=few(seen.sure))
    sifted = _slide_after(thin, turn, headings, tilts, top, last)
    keep = np.sort(np.argpartition(sifted[0], SIFT_KEEP)[:SIFT_KEEP])
    cost, change, turned = np.full(headings.size, np.inf), np.zeros(headings.size), np.zeros(headings.size)
    cost[keep], change[keep], turned[keep] = _slide(seen, turn, headings[keep], tilts, top)
    return (cost, change, turned), (turn, top, headings, sifted)


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


def _places(cost: np.ndarray, headings: np.ndarray, apart: float, most: int) -> np.ndarray:
    """`_spread_out` over the cheapest finite headings (`_cheapest`), as indices: the first `most` whose headings
    stand `apart` degrees from each other's, each the cheapest left once those near the ones kept are put by."""
    order = _cheapest(cost, headings.size)
    order = order[np.isfinite(cost[order])]
    free = np.ones(order.size, dtype=bool)
    kept: list[int] = []
    while len(kept) < most:
        left = np.flatnonzero(free)
        if not left.size:
            break
        first = int(left[0])
        kept.append(int(order[first]))
        # `_apart`, the same float steps as the Python one
        free &= np.abs(np.remainder(headings[order] - headings[order[first]] + 180.0, 360.0) - 180.0) >= apart
    return np.asarray(kept, dtype=np.int64)


def _cheapest(cost: np.ndarray, count: int) -> np.ndarray:
    """The cheapest headings first, enough of them for `PER_LENS` places standing apart."""
    keep = min(count, CANDIDATES)
    if keep == count:
        return np.argsort(cost)
    near = np.argpartition(cost, keep - 1)[:keep]
    return near[np.argsort(cost[near])]


def _headings(step: float, facing: tuple[Sector, ...] | None) -> np.ndarray:
    """The headings a lens is slid over: all round, or across the sectors the analyst gave."""
    if facing is None:
        return np.arange(0.0, 360.0, step)
    rows: list[np.ndarray] = []
    for centre, half in facing:
        half = min(180.0, max(step, float(half)))
        rows.append(np.arange(centre - half, centre + half + step / 2, step) % 360.0)
    if len(rows) == 1:
        return rows[0]
    # sectors that touch would slide the same headings twice
    return np.unique(np.round(np.concatenate(rows), 6))


def _rolls(start: float, centre: float, ease: float | None) -> list[float]:
    """The rolls one round of the refinement tries: steps about the place's, then about the best so far."""
    tried = [centre + d for d in ROLL_STEPS] if ease is None else [centre - ease, centre, centre + ease]
    return sorted({float(np.clip(r, start - ROLL_REACH, start + ROLL_REACH)) for r in tried})


def _refine(
    x: np.ndarray, y: np.ndarray, turn: Turn, *, heading: float, tilt: float, fov: float,
    roll: float, half_width: float, free: bool, level: bool, widen: float = 1.03,
    start: float | None = None, projection: Projection = "camera", bounds: tuple[float, float] | None = None,
    bands: tuple[np.ndarray, np.ndarray] | None = None, tilts: tuple[float, float] | None = None,
    rounding: float | None = None, top: Turn | None = None, sure: np.ndarray | None = None,
) -> Fit | None:
    """A coarse place made exact: heading searched finely, tilt laid onto the trace, lens and roll eased.

    The roll is eased about `roll`, never farther than `ROLL_REACH` from `start`
    (where the search began); an eased lens stays within `bounds`; points are
    read within their `bands`, and a tilt past `tilts` is no fit. With `rounding`,
    the terrain's cell in metres, near lines are judged rounded (`_rounded`).
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
                seen = _through(x, y, lens, tilt, turned, half_width, projection=projection, bands=bands, sure=sure)
                headings = heading + np.linspace(-2 * step, 2 * step, 17)
                cost, change, _ = _slide(seen, turn, headings, tilts, top)
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
    seen = _through(x, y, fov, tilt, roll, half_width, projection=projection, bands=bands, sure=sure)
    azimuth = heading + seen.azimuth
    if rounding:
        rise, ground = _rounded(azimuth, seen.elevation, turn, rounding, top, sure)
        gap = _gate(rise - ground, turn, azimuth, seen.low, seen.high, top, sure)
    else:
        rise = seen.elevation
        gap = _gap(seen.elevation, turn, top, sure, azimuth, seen.low, seen.high)
    hit = ~np.isnan(gap)
    if hit.sum() < MIN_POINTS:
        return None
    middle = float(np.median(gap[hit]))
    if tilts is not None and not tilts[0] - TILT_SLACK <= tilt - middle <= tilts[1] + TILT_SLACK:
        return None
    loss = np.full(gap.size, LOST_LOSS)
    loss[hit] = _loss((gap[hit] - middle) * seen.per_degree)
    # a rounded trace is judged on the shape it still has: rounded flat, it explains no more than a line
    shape = y if not rounding else y + (rise - seen.elevation) * seen.per_degree / half_width
    return Fit(
        heading=heading % 360.0,
        tilt=float(np.clip(tilt - middle, -89.0, 89.0)),
        fov=fov,
        gap=float(np.median(np.abs(gap[hit] - middle))),
        explained=explained_by(loss, x, shape, half_width),
        points=int(hit.sum()),
        roll=roll,
        reach=turn.reach,
    )


def _pieces(
    x: np.ndarray, y: np.ndarray, piece: np.ndarray, turn: Turn, fit: Fit, half_width: float, projection: Projection,
    bands: tuple[np.ndarray, np.ndarray] | None = None, top: Turn | None = None, sure: np.ndarray | None = None,
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
            seen = _through(x[inside], y[inside], fit.fov, fit.tilt, fit.roll + turned, half_width, projection=projection,
                            bands=None if bands is None else (bands[0][inside], bands[1][inside]),
                            sure=None if sure is None else sure[inside])
            azimuth = fit.heading + turns[:, None] + seen.azimuth[None, :]
            base = _gap(seen.elevation[None, :], turn, top, seen.sure, azimuth, seen.low, seen.high)
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


def under_terrain(azimuth: np.ndarray, elevation: np.ndarray, turn: Turn, per_degree: float) -> np.ndarray:
    """Which directions the terrain's skyline stands over by more than `CLEAR_PX` pixels and more than the
    heights' error at that terrain's distance (`CLEAR_GRAIN_M`)."""
    above = turn.at(azimuth) - elevation
    far = turn.far(azimuth)
    grain = np.where(np.isfinite(far), np.degrees(np.arctan2(CLEAR_GRAIN_M, np.maximum(far, 1.0))), 0.0)
    return np.nan_to_num(above, nan=-np.inf) > np.maximum(CLEAR_PX / per_degree, grain)


def _over(
    azimuth: np.ndarray, elevation: np.ndarray, turn: Turn, top: Turn | None, clear: Turn | None,
    turns: Sequence[Turn], per_degree: float,
) -> tuple[float, float | None]:
    """The share of the lines with only sky above that the terrain stands over, and how far out that land
    stands, metres (the middle of it; None when none does). Read in full against `clear`, as far as the
    analyst says the photo sees; else against every cut of the turn, land within the place's own cut in full,
    land past it in full out to `CLEAR_NEAR` times as far as the ground the line lies on, then less and less out
    to `CLEAR_FAR` times it. Land `BEHIND` the ridge the place's own cut lays the line on counts in full, that
    ridge itself `OWN_SHARE`."""
    ridge = turn.far(azimuth)

    def behind(land: np.ndarray) -> np.ndarray:
        """Each point's weight: 1 for land behind the line's ridge, `OWN_SHARE` for that ridge itself."""
        own = np.where(np.nan_to_num(land, nan=0.0) > BEHIND * ridge, 1.0, OWN_SHARE)
        return np.where(np.isfinite(ridge), own, 1.0)

    if clear is not None:
        far = clear.far(azimuth)
        weight = under_terrain(azimuth, elevation, clear, per_degree) * behind(far)
    else:
        line = np.maximum((top or turn).far(azimuth), 1.0)
        own = math.inf if turn.reach is None else float(turn.reach)
        weight = np.zeros(azimuth.size)
        far = np.full(azimuth.size, np.nan)
        for one in turns or (turn,):
            land = one.far(azimuth)
            fade = np.clip((CLEAR_FAR * line - land) / ((CLEAR_FAR - CLEAR_NEAR) * line), 0.0, 1.0)
            counted = under_terrain(azimuth, elevation, one, per_degree) * behind(land) * np.where(
                land <= own, 1.0, np.nan_to_num(fade, nan=0.0))
            more = counted > weight
            weight = np.where(more, counted, weight)
            far = np.where(more, land, far)
    held = (weight >= 0.5) & np.isfinite(far)
    return float(weight.mean()), (float(np.median(far[held])) if held.any() else None)


def _judge(
    fit: Fit, x: np.ndarray, y: np.ndarray, turn: Turn, marks: Marks, ridges: Ridges | None,
    half_width: float, projection: Projection, bands: tuple[np.ndarray, np.ndarray] | None = None,
    floor: float = 0.0, clear: Turn | None = None, top: Turn | None = None, turns: Sequence[Turn] = (),
    sure: np.ndarray | None = None,
) -> Fit:
    """A place judged on all the analyst marked: a collage's pieces eased, the inner edges read
    against the terrain's ridges, the pairs' order checked, the lines said to have only sky above
    (`sure`, laid on `top`) held clear of the terrain (`_over`: `clear`, the turn as far as the photo is
    said to see, else every cut of it in `turns`)."""
    piece = marks.piece if marks.cut and marks.piece is not None and marks.piece.size == x.size else None
    offsets: dict[int, tuple[float, float, float]] = {}
    sky = fit.explained
    if piece is not None:
        loss, offsets = _pieces(x, y, piece, turn, fit, half_width, projection, bands, top, sure)
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
        ridge_bands = bands_of(marks.ridge_line, marks.ridge_x.size, marks.far, floor)
        # read against every silhouette the sweep found, past the skyline's cut too: a ridge seen in front of
        # farther land may stand past the cut the skyline fits best (a near cut once lost a night view's ridges)
        off, ridge_far = ridges.nearest(azimuth, elevation, ridge_bands)
        cost = np.where(np.isnan(off), LOST_LOSS, _loss(np.nan_to_num(off) * per))
        inner = float(1.0 - cost.mean() / LOST_LOSS)
        # an inner edge with no ridge under it takes score away, one lying on its ridge adds none
        score = min(sky, (sky + inner) / 2)
    kept: tuple[int, int] | None = None
    if marks.pairs:
        far: dict[int, float] = {}
        if marks.line is not None and marks.line.size == x.size and turn.distance is not None:
            distance = _far(turn, top, sure, through(x, y, piece)[0])
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
            score *= 1.0 - PAIR_COST * (len(judged) - good) / max(len(judged), PAIR_MIN)
            kept = (good, len(judged))
    over: float | None = None
    over_far: float | None = None
    if sure is not None and sure.any():
        azimuth, elevation, per = through(x[sure], y[sure], None if piece is None else piece[sure])
        over, over_far = _over(azimuth, elevation, turn, top, clear, turns, per)
        # past a fiftieth the place pays, past CLEAR_HARD it keeps CLEAR_KEEP of its score (none: ruled out)
        paid = float(np.clip((over - CLEAR_FREE) / (CLEAR_HARD - CLEAR_FREE), 0.0, 1.0))
        score *= 1.0 - (1.0 - CLEAR_KEEP) * paid
    if piece is None and inner is None and kept is None and over is None:
        return fit
    eased = tuple((k, *offsets[k]) for k in sorted(offsets)) or None
    return replace(
        fit, explained=float(min(1.0, max(0.0, score))), sky=sky, inner=inner, pairs=kept, pieces=eased, over=over,
        over_far=over_far,
    )


def match(
    x: np.ndarray, y: np.ndarray, turn: Turn | list[Turn], *, half_width: float, fov: float,
    known: bool = False, tilt: float = 0.0, roll: float = 0.0,
    within: tuple[float, float] | None = None, facing: Sector | Sequence[Sector] | None = None,
    level: bool = False, projection: Projection = "camera", quick: bool = False, rough: bool = False,
    marks: Marks | None = None, ridges: Ridges | None = None, floor: float = 0.0,
    tilts: tuple[float, float] | None = None, rounding: float | None = None, clear: Turn | None = None,
    beyond: Sequence[Turn] = (), lens_window: tuple[float, float] | None = None, lens_max: float | None = None,
) -> Match:
    """The headings, lenses and tilts that bring `turn` onto the trace (x, y), and a verdict.

    `half_width` is half the frame's width in screen pixels, which sets how
    many pixels a degree spans. `fov` is the lens, `known` when the photo says
    it, and `tilt` and `roll` the camera the search starts from: the tilt and an
    unknown lens follow the trace, the roll is eased a few degrees unless
    `level` holds it. `within` bounds an unknown lens (degrees, low and high),
    `facing` the heading to a sector (its middle and half its width) or to
    any of several. `turn`
    may be several cuts of the same turn (`Turn.reach`): each place says which
    one it lies on. `projection` is the picture's: a panorama strip is held level.
    `quick` refines only the two best places, for a search that asks it at many
    points and only needs the best one's score; `rough` slides fewer points over
    fewer lenses too, to rank a grid before its best points are searched again.
    `marks` holds what the analyst marked beside the skyline (inner edges,
    pairs, a collage's pieces), judged on each place found; inner edges are
    read against `ridges`, the terrain's silhouettes, when given. Points are
    read within the distances `marks.far` says their strokes stand at, those of
    strokes it says nothing of no nearer than `floor` metres; a place whose
    camera tilts past `tilts` (degrees, low and high) is not one. With
    `rounding`, the terrain's cell in metres, near lines are judged rounded.
    The lines `marks.clear` says have only sky above are laid on, and read against,
    `clear`, the turn as far as the analyst says the photo sees, whatever cut a
    place lies on; without it, on the top of the land out to `CLEAR_NEAR` times
    the line's own distance (`_tops`), and against every cut of the turn
    (`_over`), and `beyond`'s: the turn read on past the farthest the trace is
    searched, for them alone. `lens_window` keeps the lenses slid over to those it holds, out of the ones the
    slide would try, so a search narrowed about a neighbour's lens slides the very lenses a full one does.
    `lens_max` leaves out, and bounds the refinement under, the lenses wider than the picture can span; the others
    are the very ones tried without it.
    """
    if projection == "panorama":
        level, roll = True, 0.0
    sectors = sectors_of(facing)
    turns = [turn] if isinstance(turn, Turn) else list(turn)
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    if x.size < MIN_POINTS or not turns:
        return Match("none", [])
    slid = ROUGH_POINTS if rough else SLIDE_POINTS
    pick = np.unique(np.linspace(0, x.size - 1, min(x.size, slid)).round().astype(int))
    xs, ys = x[pick], y[pick]
    bands = bands_of(None if marks is None else marks.line, x.size, () if marks is None else marks.far, floor)
    picked = None if bands is None else (bands[0][pick], bands[1][pick])
    # the points of lines said to have only sky above, and the top of the land each cut lays them on
    sure = None
    if marks is not None and marks.clear and marks.line is not None and np.asarray(marks.line).size == x.size:
        sure = np.isin(marks.line, marks.clear)
        sure = sure if sure.any() else None
    tops: list[Turn | None] = [None] * len(turns)
    read = [*turns, *beyond]
    if sure is not None:
        tops = [clear] * len(turns) if clear is not None else _tops(read)[:len(turns)]

    rows: list[_Row] = []
    widths: dict[float, float] = {}
    tried = lenses(fov, known=known, within=within, projection=projection, ratio=ROUGH_RATIO if rough else RANGE_RATIO)
    if lens_max is not None and not known:
        tried = [lens for lens in tried if lens <= lens_max] or [min(tried)]
    if lens_window is not None:
        held = [lens for lens in tried if lens_window[0] <= lens <= lens_window[1]]
        # a window between two lenses slides the nearer
        tried = held or [min(tried, key=lambda lens: abs(math.log(lens / math.sqrt(lens_window[0] * lens_window[1]))))]
    for lens in tried:
        seen = _through(xs, ys, lens, tilt, roll, half_width, twist=not level, projection=projection, bands=picked,
                        sure=None if sure is None else sure[pick])
        widths[lens] = float(seen.azimuth.max() - seen.azimuth.min())
        last = None
        for index, one in enumerate(turns):
            headings = _headings(max(_step(lens), COARSE_MIN, one.step), sectors)
            if rough and headings.size >= SIFT_HEADINGS:
                (cost, change, turned), last = _sift(seen, one, headings, tilts, tops[index], last)
            else:
                cost, change, turned = _slide_after(seen, one, headings, tilts, tops[index], last)
                last = (one, tops[index], headings, (cost, change, turned))
            # each lens's and cut's own few places, so one cannot crowd out the others
            rows.extend(
                (float(cost[i]), float(headings[i]), lens, tilt + float(change[i]), index, roll + float(turned[i]))
                for i in _places(cost, headings, max(APART_MIN, widths[lens] / 2), PER_LENS)
            )
    if not rows:
        return Match("none", [])
    rows.sort(key=lambda row: row[0])
    apart = max(APART_MIN, widths[rows[0][2]] / 2)
    # a lens the analyst bounds stays within the bounds
    bounds = (min(within), max(within)) if within is not None and not known else None
    if bounds is not None and lens_max is not None:
        bounds = (bounds[0], max(bounds[0], min(bounds[1], lens_max)))
    refined = []
    for _, h, f, t, index, r in _spread_out(rows, apart, 1 if rough else QUICK_REFINED if quick else REFINED):
        fit = _refine(x, y, turns[index], heading=h, tilt=float(np.clip(t, -89.0, 89.0)), fov=f, roll=r,
                      half_width=half_width, free=not known, level=level, start=roll,
                      widen=RANGE_EASE if within is not None else 1.03, projection=projection, bounds=bounds,
                      bands=bands, tilts=tilts, rounding=rounding, top=tops[index], sure=sure)
        if fit is not None and marks is not None:
            fit = _judge(fit, x, y, turns[index], marks, ridges, half_width, projection, bands, floor, clear,
                         tops[index], read, sure)
        refined.append(fit)
    found = sorted((fit for fit in refined if fit is not None), key=lambda fit: -fit.explained)
    if sectors is not None:
        found = [fit for fit in found if within_sectors(fit.heading, sectors)]
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
