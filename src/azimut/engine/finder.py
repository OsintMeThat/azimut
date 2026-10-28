"""Find where a photo was taken: its traced skyline searched over an area of the map.

Each point of a grid laid over the area (a hex lattice: as close to every spot as a square grid
`spacing` apart, with 23% fewer points) gets the skyline seen from it
(`horizon.sweep`, the skyline alone, cut where haze would stop it) and the trace
is looked for on it (`skymatch.match`, Fit's own search): a point's score is how
much of the trace's shape the best place there explains.

It works in stages, each finer and dearer than the last on fewer points. The
grid is ranked roughly (fewer trace points slid over fewer lenses, the ground
near the eye read every 25 m: about four times cheaper a point, and measured to
find the same heading at the true place), then refined three by three about its
best points down to the finest spacing the terrain there is worth (Copernicus
GLO-30's 30 m over most of the world, a national survey's finer metres where one
was published: `detail`); the three best are polished on a finer grid with the
quick search, and the best five searched in full, as a Fit is.

Where the relief stands near, the skyline changes over little ground: a point
1.5 km from the hills it sees can explain the trace half as well as one 300 m
off (the owner's desert collage). So once the grid is ranked, each of its
cells is filled in at a tenth of the distance to the ridges the trace was laid
on there (no finer than the terrain's detail), the cells nearest their ridges
first, within a budget of points, and those are ranked too before the best
are refined. A trace laid on far ridges asks for no filling: the skyline they
make changes slowly over the ground.

A reach the analyst gives is read as about that far: the turn is cut there and
searched out to twice as far as well, so a ridge just past it still counts.

The analyst may say which way the photo faces: one or several of the eight
compass directions, each the 45° about it, those side by side read as one
sector. Only those sectors of the turn are marched and slid over, which makes
each point as much cheaper as the turn is narrowed, and leaves fewer headings
for a wrong place to fit by chance.

Where the eye stands narrows the ground too (engine/landform.py): the analyst may
tick a summit or a ridge, a slope, a valley or a plain, and the grid and its
filling-in keep only points on that ground; the refinement about a kept point
is left free, since a summit's top and the slope beside it are one answer. Water
is never stood on: on foot, points on the sea or a lake are left out everywhere.

How far each line stands, when the analyst says it (skymatch `Marks.far`),
narrows it three ways: a line is laid only on ground within its distances, the
turn is read no farther than the farthest line can stand (so haze past it is
nothing to search), and the grid is laid finely enough for the nearest line,
a tenth or so of its distance. Lines the analyst says nothing of are kept off
the ground nearer than `FLOOR_M`, the eye's own slope as the terrain's grain
draws it. The camera's tilt is bounded by who took the photo (`TILTS`), wider
when the analyst says it looks down from a height or up at a summit. A selfie
may be mirrored: asked, the trace is searched as shot and mirrored, and a place
says which.

A line traced along the sea's horizon (`Marks.sea`) stands where the sea's own
horizon does from the eye's height above it, a few kilometres from a beach and
tens from a cliff: it is laid only on a skyline that far, which open sea makes
and land rarely does.

The sun narrows the heading too, when the analyst says where it stood against
the camera (ahead, on the left, on the right, behind) on a day and between two
local hours: the sun's azimuth over that window, read at the area's middle,
gives the headings the camera may have faced, each side a quarter turn wide.
Ticked with compass directions, a heading must agree with both.

Zones drawn beside the area shape where it looks. A zone searched is laid on
a grid of its own, finer than the area's where the analyst expects the camera
(`Zone.spacing`), and searched with the area as one: one ranking, one map. A
zone left out is never searched, whatever covers it (a lake, a place checked
already). Each point refined about a kept one stays inside what is searched.

A large grid is scored by several processes at once (`lanes`), each with the
plan and its own terrain reader, its tiles bounded: threads would not help, the
work holds Python's lock (measured: 4 threads slower than 1; 4 processes 1.9
times as fast as 1 over 600 points of a DRC search on an 8-core laptop, 8 2.6
times, 12 no faster than 8).

Alignments (frontend lib/horizon/find.js) narrow it twice. A point off any
alignment's line is not searched at all. And with the lens known, an alignment
says which way the photo faces from each point: the bearing to its near point,
less how far across the photo that point stands, so only a sector of the turn
is searched there.

The skyline is read in columns fine enough for the narrowest lens the search
may try (a thirtieth of it): a long zoom asks for a finer turn, which is why
saying how zoomed the photo is speeds the search as much as it narrows it.

Never a probability: a place "explains N%" of the trace, and the answer says
when two separate places explain it about as well, or when the trace is too
flat to tell. Neighbouring points see far ridges almost alike, so the score
changes slowly across the map: the hot spot it shows is a region, as wide as
the near ridges allow.
"""

from __future__ import annotations

import heapq
import math
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field, replace
from typing import Any, Literal

import numpy as np

from . import horizon, landform, ruleout, skymatch, terrain, turncache

# Searched when the analyst left the reach to Auto: these cuts and the turn out to the last.
AUTO_FAR = 50_000.0
AUTO_CUTS = (5_000.0, 10_000.0, 20_000.0)
# A reach given is searched out to this many times as far too, within Auto's farthest.
REACH_PAST = 2.0
# With a reach given, a line with only sky above is read as far as the band said for it reaches, these many times
# its far end, never short of the reach nor past REACH_PAST times it; a line said nothing of, to REACH_PAST times the
# reach, as the trace is searched. Measured on the owner's real cases (FIND_FIX_HANDOVER item 2, each truth against
# the 100 best places its Quick search found): read to the reach alone, v27's Sky-only lines could not lie on their
# own mountain 12–14 km out (reach 10 km). Read so, v27 100th → 1st, v08 45th → 7th, v01 2nd → 1st, v21 56th → 45th,
# v22 99th → 85th, v18 60th → 51st; v09 15th → 16th. With the band's third of slack, v29 fell 46th → 67th.
SKY_SLACK = 1.0
# A cell is filled in at this share of the distance to the ridges its point's best fit lies on, the
# nearest first, and the filling-in adds at most this many times the grid's points.
NEAR_SHARE = 0.1
DENSE_MAX = 3.0
# The grid is refined down to this many times the terrain's own detail (`detail`), within these metres.
FINE_PER_DETAIL = 2.0
FINE_MIN = 25.0
FINE_MAX = 100.0
# Points kept at each level and refined about, three by three. A truth's score peak is narrower than the grid
# (80 m off v25's it falls from 0.72 to 0.43–0.55, its grid 226 m apart), so the point nearest it may rank about
# 100th roughly. Measured on the owner's 30 real cases at Quick (FIND_FIX_HANDOVER, nights quick28 and keep100p3):
# with 12, 7 of the 21 working cases found first and 11 in the top 5; with 100, 8 and 14 (rdc1 and v19 first, v25 and
# v23 second), held out unchanged, 13% more points. v08's first place moved 600 m → 1,007 m off, its second 890 m.
KEEP = 100
# The best places polished on a grid this fine about them (a fraction of the finest spacing), this many either way.
POLISH = 3
POLISH_STEPS = 2
# The ground near the eye read every this many metres while ranking, and finely for the best places.
ROUGH_NEAR_M = 25.0
POLISH_NEAR_M = 10.0
# A rival this close to the best one's score, and far enough away, makes the answer ambiguous.
AMBIGUOUS_MARGIN = 0.04
# Places in the answer, and how far apart they stand to be listed apart, metres.
TOP = 5
APART_M = 1_500.0
# Places searched in full before the TOP best are listed: a rough read misjudges a place by a few hundredths, so
# the place a full fit puts first may stand 6th or 12th roughly (the bench's v04 and v21).
FULL_PLACES = 15
# Two places nearer than this are one hot spot, however good both are: only farther ones make it ambiguous.
SEPARATE_M = 3_000.0
# The best place must stand this far above the area's top tenth of points to stand out: below,
# many places fit about as well and none is named.
STANDOUT_MIN = 0.06
# The coarse grid's spacing when left to Auto: about this many points over the area, some ten minutes of
# search, so a small area is searched every 50 or 20 m.
AUTO_POINTS = 4_000
# How thorough Auto's grid is, as the analyst picks it against the time it takes: these times AUTO_POINTS.
EFFORTS = {"quick": 0.25, "normal": 1.0, "thorough": 3.0}
NICE_SPACINGS = (20.0, 50.0, 100.0, 150.0, 250.0, 400.0, 500.0, 750.0, 1_000.0, 1_500.0, 2_000.0, 3_000.0)
# The most points a coarse grid may hold: past it the spacing widens, and the estimate says so. Auto's grid
# holds COARSE_MAX at the most and the zones' own grids ZONES_MAX more between them; a spacing the analyst
# picks is kept up to PICKED_MAX, hours of search as the estimate says, for the area and its zones alike.
COARSE_MAX = 6_000
ZONES_MAX = 6_000
PICKED_MAX = 100_000
# A zone searched with no spacing of its own is laid this many times finer than the area, no finer than
# the terrain's detail is worth.
ZONE_SHARE = 1 / 3
# A grid `spacing` apart is laid as a hex lattice leaving no spot farther from a point than a square one that
# dense would (spacing/√2), with 23% fewer points: its points HEX_ACROSS times the spacing apart along a row,
# its rows HEX_ROWS times apart, every other row shifted by half (FIND_SMART_PLAN §5.3).
HEX_ACROSS = math.sqrt(1.5)
HEX_ROWS = HEX_ACROSS * math.sqrt(3) / 2
# Columns a thirtieth of the narrowest lens, within these bounds (degrees).
STEP_MIN = 0.1
STEP_MAX = 0.5
# An unknown lens's columns are set for lenses this narrow at the least: narrower ones are "very zoomed".
STEP_LENS_FLOOR = 6.0
# Threads one sweep uses: the search runs on the analyst's machine beside everything else.
WORKERS = 2
# A grid this large is scored by several processes, when asked; and the tiles a search's terrain reader holds.
LANE_MIN_POINTS = 200
SEARCH_TILES = 256
# A search in n lanes goes n to this power times as fast (measured over 600 points of a DRC search on an
# 8-core laptop: 4 processes 1.9 times as fast as one, 8 2.6 times; engine/horizon_finds.py SPEEDS).
LANE_POWER = 0.46
# A search's pace is timed on this many points of its grid, after one that reads the terrain in; a place
# searched in full takes about this many times as long as one ranked roughly.
PACE_POINTS = 3
FULL_COST = 8.0
# A sector searched about the heading an alignment gives, degrees either side at the least.
FACING_MIN = 3.0
# A point warm-started from its scored neighbours (C9) slides over the headings this many degrees either side of
# theirs, or this share of the widest lens if more, and an unknown lens this many times either way of theirs.
WARM_DEG = 6.0
WARM_LENS_SHARE = 0.05
WARM_LENS = 1.15
# The rough passes are scored outward (C9): along a Hilbert curve, in runs of WARM_BLOCK points (a process takes a
# run), each point warm-started from the best two fits within WARM_NEAR times its spacing scored before it in its
# run, or from the point it refines, when they explain WARM_FLOOR or more; every WARM_EVERY-th point of a run, a
# point with no such start, and one whose warm score falls WARM_DROP under its start's are slid in full. Measured
# on 400 points about each of 19 working truths, no turn read back: 1.34 times as fast, every truth's best within
# 300 m kept to 0.005 (every 4th and 0.1: 1.30 times, ranks a little worse).
WARM = True
WARM_BLOCK = 48
# A run is shorter when the points are few, so every process has two at least, but no shorter than this.
WARM_RUN_MIN = 12
# Once ranked, the best points a warm start scored are slid again in full, a neighbour's fit may have led them
# astray: the best RECHECK_PLACES places apart and the best RECHECK_NEAR a spacing apart; the better score is kept.
RECHECK_PLACES = 10
RECHECK_NEAR = 24
WARM_NEAR = 1.6
WARM_FLOOR = 0.1
WARM_EVERY = 6
WARM_DROP = 0.15
# A grid of BOUND_MIN points or more is ranked best-first (C7): its points gathered in cells BOUND_CELL spacings a
# side, the one nearest each cell's middle scored first; each cell then bounded by its score and BOUND_SLACK, as
# much as a point within it may explain more, and its other points scored best bound first, BOUND_BATCH cells at a
# time, while a bound reaches the last of the places the answer lists, and for the best BOUND_SHARE of the cells
# whatever the bounds say. Measured on 28 real windows scored point by point: within a cell of 9 a point explains up to 0.26 more than
# the middle one in 1 cell of 10, 0.49 in 1 of 100, and how near the relief stands says little of it (correlation
# 0.22): the rough score's own grain. A slack of 0.4 scored 65% of the working windows' points and 82% of the held
# out ones', no truth's best within 300 m lower by more than 0.013 (0.3: 47%, v17's lower by 0.09).
# Off: the owner wants the grid the analyst lays scored whole, the best-first ranking kept for the refinement
# finer than it (FIND_SMART_PLAN C7, 25 Oct).
BOUND = False
BOUND_MIN = 600
BOUND_CELL = 3
BOUND_SLACK = 0.4
BOUND_SHARE = 0.1
BOUND_BATCH = 16
# A line the analyst says nothing of is laid on no ground nearer than this, metres: on foot, the
# terrain's 30 m grain draws the eye's own slope as a ridge any trace can be laid on.
FLOOR_M = 250.0
# The camera's tilt a search allows, degrees, by who took the photo; looking down from a height or up
# at a summit, as the analyst may say, opens it that way.
TILTS: dict[str, tuple[float, float]] = {"ground": (-20.0, 25.0), "drone": (-80.0, 25.0), "aircraft": (-80.0, 15.0)}
LOOK_DOWN = -60.0
LOOK_UP = 60.0
# The grid is laid at this share of the nearest distance a line is said to stand at, in metres,
# reading a line said to stand nearer than a kilometre as this far.
SAID_SHARE = 0.12
SAID_NEAREST = 400.0
# A line along the sea's horizon is laid on a skyline between these shares of the distance to the sea's
# horizon from the eye's height above the sea; the eye is read at least this high (a deck, a beach).
SEA_NEAR = 0.6
SEA_FAR = 1.5
SEA_EYE_MIN = 2.0
# The compass directions the analyst may tick for where the photo faces, clockwise from north.
DIRECTIONS = ("n", "ne", "e", "se", "s", "sw", "w", "nw")
# Half the sector one direction stands for, degrees: the eight cover the turn.
DIRECTION_HALF = 360.0 / len(DIRECTIONS) / 2
# Where the sun stood against the camera, as the heading's turn from the sun's azimuth, degrees: the sun on
# the right of the picture stands a quarter turn clockwise of where the camera faces.
SUN_SIDES = {"ahead": 0.0, "right": -90.0, "behind": 180.0, "left": 90.0}
# Half the headings each side stands for, degrees, and the minutes between the sun's positions read.
SUN_HALF = 45.0
SUN_EVERY_MIN = 10
# The ground the grid's preview says of a point the brush left out.
PAINTED = "painted"

Verdict = Literal["match", "loose", "ambiguous", "none", "flat", "unclear"]


class Cancelled(Exception):
    """The analyst stopped the search: `result` is what it had found by then (`so_far`), once `search` says."""

    result: dict[str, Any] | None = None


@dataclass(frozen=True)
class Trace:
    """The traced skyline on the picture plane (engine/skymatch.py), and its lens."""

    x: np.ndarray
    y: np.ndarray
    half_width: float
    fov: float
    known: bool = False
    within: tuple[float, float] | None = None
    projection: skymatch.Projection = "camera"
    # the sectors the analyst said the photo faces, each its middle and half width; None for the whole turn
    facing: tuple[skymatch.Sector, ...] | None = None
    # what else the analyst marked: inner edges, pairs, a collage's pieces, how far lines stand
    marks: skymatch.Marks | None = None
    # lines said nothing of are laid on no ground nearer than this, metres
    floor: float = 0.0
    # the camera's tilt allowed, degrees, low and high; None for any
    tilts: tuple[float, float] | None = None
    # a selfie: searched mirrored too
    mirror: bool = False
    # near lines judged rounded to the terrain's cell, metres (skymatch._rounded); None to judge them as drawn
    rounding: float | None = None
    # an unknown lens slid only over the lenses within these, out of those a full slide tries (a warm start, C9)
    lens_window: tuple[float, float] | None = None
    # the widest lens the picture can span: a panorama no taller than a phone's tallest frame (R16)
    lens_max: float | None = None


def tilts_for(mode: str, view: Sequence[str] = ()) -> tuple[float, float]:
    """The tilts a search allows for who took the photo, opened down or up as the analyst says (`down`, `up`)."""
    low, high = TILTS.get(mode, TILTS["ground"])
    if "down" in view:
        low = min(low, LOOK_DOWN)
    if "up" in view:
        high = max(high, LOOK_UP)
    return low, high


def said_bands(trace: Trace) -> tuple[np.ndarray, np.ndarray] | None:
    """Each skyline point's band as the analyst said its line's distance (slack included), or None
    unless every point has one."""
    marks = trace.marks
    if marks is None or not marks.far:
        return None
    bands = skymatch.bands_of(marks.line, trace.x.size, marks.far)
    if bands is None or not np.isfinite(bands[1]).all():
        return None
    return bands


def unmarked(trace: Trace) -> Trace:
    """The trace with the analyst's judging marks left out (lines' distances, Sky only, pairs, key lines), its
    strokes, sea lines and pieces kept; the very trace when it has none."""
    marks = trace.marks
    if marks is None or not (marks.far or marks.clear or marks.pairs or marks.key):
        return trace
    return replace(trace, marks=replace(marks, far=(), clear=(), pairs=(), key=()))


def sky_reaches(marks: skymatch.Marks, reach: float) -> dict[int, float]:
    """How far each line with only sky above is read, metres, a reach being given (`SKY_SLACK`)."""
    said = {int(stroke): float(farthest) * SKY_SLACK for stroke, _, farthest in marks.far}
    most = REACH_PAST * reach
    return {int(stroke): min(most, max(reach, said[int(stroke)])) if int(stroke) in said else most for stroke in marks.clear}


def said_nearest(far: Sequence[Sequence[float]] | None) -> float | None:
    """The nearest distance a line is said to stand at, metres, a line said nearer than a kilometre read
    as `SAID_NEAREST`; None when no line's distance is said."""
    if not far:
        return None
    return float(max(SAID_NEAREST, min(float(one[1]) for one in far)))


@dataclass(frozen=True)
class Alignment:
    """Two things one behind the other in the photo: the camera stands on the line from `near`.

    `bearing` is the line's, from the near point out to the camera's side;
    `photo_x` is where the near point stands across the picture plane (half
    widths from the middle), which with the lens known says which way the
    photo faces.
    """

    lat: float
    lon: float
    bearing: float
    tolerance: float = 1.0
    photo_x: float | None = None


@dataclass(frozen=True)
class Zone:
    """A zone drawn beside the area: searched on its own grid, `spacing` metres apart (None: a third of the
    area's, within the terrain's detail), or left out (`out`), whatever else covers it."""

    area: Sequence[tuple[float, float]]
    spacing: float | None = None
    out: bool = False


@dataclass(frozen=True)
class Stroke:
    """A stroke of the brush across the map: the points within `radius` metres of its `path` left out (`out`),
    or searched though no area covers them. A stroke paints over the strokes before it."""

    path: Sequence[tuple[float, float]]
    radius: float
    out: bool = True


@dataclass(frozen=True)
class Plan:
    """Where to search and who took the photo."""

    area: Sequence[tuple[float, float]]  # (lat, lon) corners
    mode: horizon.Mode = "ground"
    # the heights the grid is scored at, and those the best places are searched at in full
    heights: Sequence[float] = (horizon.EYE_HEIGHT,)
    final_heights: Sequence[float] = ()
    reach: float | None = None  # metres; None is Auto
    spacing: float | None = None  # the coarse grid's, metres; None is Auto
    fine: float | None = None  # the finest, metres; None reads it off the terrain (`detail`)
    alignments: Sequence[Alignment] = field(default_factory=tuple)
    # the ground the eye may stand on (landform.STANDS), none for any
    stands: Sequence[str] = ()
    # the nearest a traced line is said to stand, metres: the grid is laid finely enough for it
    near: float | None = None
    # zones searched on their own grid beside the area, or left out
    zones: Sequence[Zone] = field(default_factory=tuple)
    # more areas searched beside the first, on the same grid
    areas: Sequence[Sequence[tuple[float, float]]] = field(default_factory=tuple)
    # the brush's strokes, in the order they were painted
    strokes: Sequence[Stroke] = field(default_factory=tuple)
    # how thorough Auto's grid is (EFFORTS): it lays this many times AUTO_POINTS
    effort: float = 1.0
    # what the photo shows that rules points out before any sweep (engine/ruleout.py): a line along the sea's
    # horizon, water (the sea or a lake), the eye standing above the land round it or below it
    sea: bool = False
    water: bool = False
    over: str | None = None


def marks_of(trace: dict[str, Any]) -> skymatch.Marks | None:
    """The marks beside the skyline a saved trace holds (api/horizon.py `MarksIn`), or None."""
    pairs = trace.get("pairs") or []
    far = trace.get("far") or []
    sea = trace.get("sea") or []
    clear = trace.get("clear") or []
    key = trace.get("key") or []
    bent = any(trace.get("bent") or ()) or any(trace.get("ridge_bent") or ())
    if not trace.get("ridge_x") and not pairs and trace.get("piece") is None and not far and not sea and not clear and not key and not bent:
        return None

    def ints(key: str) -> np.ndarray | None:
        values = trace.get(key)
        return None if values is None else np.asarray(values, dtype=np.int64)

    return skymatch.Marks(
        ridge_x=np.asarray(trace.get("ridge_x") or [], dtype=np.float64),
        ridge_y=np.asarray(trace.get("ridge_y") or [], dtype=np.float64),
        line=ints("line"), ridge_line=ints("ridge_line"),
        pairs=tuple((int(front), int(back)) for front, back in pairs),
        piece=ints("piece"), ridge_piece=ints("ridge_piece"),
        far=tuple((int(stroke), float(nearest), float(farthest)) for stroke, nearest, farthest in far),
        sea=tuple(int(stroke) for stroke in sea),
        clear=tuple(int(stroke) for stroke in clear),
        key=tuple(int(stroke) for stroke in key),
        bent=None if trace.get("bent") is None else np.asarray(trace["bent"], dtype=bool),
        ridge_bent=None if trace.get("ridge_bent") is None else np.asarray(trace["ridge_bent"], dtype=bool),
    )


# -- the grid ------------------------------------------------------------------


def _local(lat0: float, lon0: float, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    k = math.radians(1) * terrain.EARTH_RADIUS
    return (np.asarray(lon) - lon0) * k * math.cos(math.radians(lat0)), (np.asarray(lat) - lat0) * k


def _from_local(lat0: float, lon0: float, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    k = math.radians(1) * terrain.EARTH_RADIUS
    return lat0 + np.asarray(y) / k, lon0 + np.asarray(x) / (k * math.cos(math.radians(lat0)))


def area_m2(area: Sequence[tuple[float, float]]) -> float:
    """The polygon's area, square metres, worked flat about its first corner."""
    if len(area) < 3:
        return 0.0
    lat0, lon0 = area[0]
    x, y = _local(lat0, lon0, np.array([p[0] for p in area]), np.array([p[1] for p in area]))
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2)


def auto_spacing(area: Sequence[tuple[float, float]] | float, effort: float = 1.0) -> float:
    """The coarse spacing a square grid would lay about `AUTO_POINTS` points over the area (a polygon, or square
    metres) at, rounded to a plain number, for about `effort` times as many: the hex lattice lays a quarter
    fewer, as close to every spot."""
    size = float(area) if isinstance(area, (int, float)) else area_m2(area)
    wanted = math.sqrt(max(size, 1.0) / AUTO_POINTS)
    plain = next((s for s in NICE_SPACINGS if s >= wanted), NICE_SPACINGS[-1])
    if effort == 1.0:
        return plain
    # another effort scales the plain spacing itself, so a small area's 50 m grid still tightens: to 5 m
    return max(NICE_SPACINGS[0], round(plain / math.sqrt(effort) / 5) * 5)


def areas_of(plan: Plan) -> list[Sequence[tuple[float, float]]]:
    """Every area the plan searches on its grid: the first and those beside it."""
    return [plan.area, *plan.areas]


def searched_m2(plan: Plan) -> float:
    """How much ground the plan's grid covers, square metres: its areas and what the brush painted in."""
    size = sum(area_m2(area) for area in areas_of(plan))
    for stroke in plan.strokes:
        if not stroke.out:
            size += _path_length(stroke.path) * 2 * stroke.radius + math.pi * stroke.radius**2
    return size


def _path_length(path: Sequence[tuple[float, float]]) -> float:
    return sum(terrain.distance(*a, *b) for a, b in zip(path, path[1:]))


def near_path(path: Sequence[tuple[float, float]], radius: float, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Which points lie within `radius` metres of the path (a stroke of the brush), worked flat about its start."""
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    if not path or not lat.size:
        return np.zeros(lat.shape, dtype=bool)
    lat0, lon0 = path[0]
    px, py = _local(lat0, lon0, lat, lon)
    sx, sy = _local(lat0, lon0, np.array([p[0] for p in path]), np.array([p[1] for p in path]))
    best = np.hypot(px - sx[0], py - sy[0])
    for i in range(len(path) - 1):
        dx, dy = sx[i + 1] - sx[i], sy[i + 1] - sy[i]
        length = dx * dx + dy * dy
        if length <= 0:
            continue
        share = np.clip(((px - sx[i]) * dx + (py - sy[i]) * dy) / length, 0.0, 1.0)
        best = np.minimum(best, np.hypot(px - (sx[i] + share * dx), py - (sy[i] + share * dy)))
    return best <= radius


def inside(area: Sequence[tuple[float, float]], lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Which points lie in the polygon (ray casting in degrees, as the map draws it)."""
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    hit = np.zeros(lat.shape, dtype=bool)
    count = len(area)
    for i in range(count):
        y1, x1 = area[i]
        y2, x2 = area[(i + 1) % count]
        crosses = (y1 > lat) != (y2 > lat)
        with np.errstate(divide="ignore", invalid="ignore"):
            at = (x2 - x1) * (lat - y1) / (y2 - y1) + x1
        hit ^= crosses & (lon < at)
    return hit


def _apart(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


def on_lines(alignments: Sequence[Alignment], lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Which points stand on every alignment's line, within its tolerance."""
    keep = np.ones(np.shape(lat), dtype=bool)
    for line in alignments:
        bearings = np.array([terrain.bearing(line.lat, line.lon, a, o) for a, o in zip(np.ravel(lat), np.ravel(lon))])
        off = np.abs((bearings - line.bearing + 180.0) % 360.0 - 180.0).reshape(np.shape(lat))
        keep &= off <= line.tolerance
    return keep


def _along(plan: Plan, spacing: float) -> tuple[np.ndarray, np.ndarray]:
    """Points laid along the first alignment's line, as far as the area goes, across its wedge.

    A wedge a degree wide is narrower than any grid near its point, so a grid
    over the area would miss it: the points follow the line instead, `spacing`
    apart along it and across it, the line itself always among them.
    """
    line = plan.alignments[0]
    corners = [(float(a), float(o)) for area in areas_of(plan) for a, o in area]
    corners += [(float(a), float(o)) for zone in plan.zones if not zone.out for a, o in zone.area]
    reach = max(terrain.distance(line.lat, line.lon, a, o) for a, o in corners)
    # what the brush painted in reaches as far as its strokes, and their width beyond
    for stroke in plan.strokes:
        if not stroke.out:
            reach = max(reach, *(terrain.distance(line.lat, line.lon, a, o) + stroke.radius for a, o in stroke.path))
    lats: list[float] = []
    lons: list[float] = []
    for distance in np.arange(spacing / 2, reach + spacing, spacing):
        half = distance * math.tan(math.radians(line.tolerance))
        across = np.arange(-half, half + 1e-6, spacing) if half >= spacing else np.array([0.0])
        for offset in across:
            bearing = line.bearing + math.degrees(math.atan2(offset, distance))
            a, o = terrain.destination(line.lat, line.lon, bearing, math.hypot(distance, offset))
            lats.append(float(a))
            lons.append(float(o))
    return np.array(lats), np.array(lons)


def within(plan: Plan, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Which points are searched: in an area or a zone searched, and in no zone left out; then as the brush
    painted them, each stroke over the ones before."""
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    keep = inside(plan.area, lat, lon)
    for area in plan.areas:
        keep |= inside(area, lat, lon)
    for zone in plan.zones:
        if not zone.out:
            keep |= inside(zone.area, lat, lon)
    for zone in plan.zones:
        if zone.out:
            keep &= ~inside(zone.area, lat, lon)
    for stroke in plan.strokes:
        painted = near_path(stroke.path, stroke.radius, lat, lon)
        keep = keep & ~painted if stroke.out else keep | painted
    return keep


def zone_spacings(plan: Plan, spacing: float) -> list[float]:
    """Each zone searched's own spacing, metres (the area's `spacing` given), widened alike until the zones'
    grids hold `ZONES_MAX` points between them, `PICKED_MAX` once a zone's spacing is picked; 0 for a zone
    left out."""
    wanted = _zones_wanted(plan, spacing)
    most = PICKED_MAX if any(zone.spacing and not zone.out for zone in plan.zones) else ZONES_MAX
    for _ in range(40):
        count = sum(_polygon_grid(zone.area, step)[0].size for zone, step in zip(plan.zones, wanted) if step)
        if count <= most:
            break
        wanted = [step * 1.25 for step in wanted]
    return wanted


def _zones_wanted(plan: Plan, spacing: float) -> list[float]:
    """Each zone's spacing as asked, metres (the area's `spacing` given, a third of it for Auto); 0 for one left out."""
    finest = FINE_PER_DETAIL * terrain.PLANET_DETAIL_M
    return [0.0 if zone.out else float(zone.spacing or max(finest, spacing * ZONE_SHARE)) for zone in plan.zones]


def zones_wider(plan: Plan, spacing: float) -> float | None:
    """How many times wider than asked the zones given a spacing are laid, holding too many points for it;
    None when they are laid as asked."""
    laid = zone_spacings(plan, spacing) if plan.zones else []
    wider = max(
        (step / want for zone, step, want in zip(plan.zones, laid, _zones_wanted(plan, spacing)) if zone.spacing and not zone.out),
        default=1.0,
    )
    return round(wider, 2) if wider > 1.01 else None


def grid(plan: Plan, spacing: float) -> tuple[np.ndarray, np.ndarray]:
    """The grid's points over the areas, and each zone searched on its own, out of the zones left out, as the
    brush painted them and on the alignments' lines."""
    lat, lon, _ = spaced_grid(plan, spacing)
    return lat, lon


def spaced_grid(plan: Plan, spacing: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The grid (`grid`) with each point's own spacing, metres: the area's, or its zone's where a zone is
    laid finer."""
    if plan.alignments:
        lat, lon = _along(plan, spacing)
        keep = within(plan, lat, lon) & on_lines(plan.alignments, lat, lon)
        return lat[keep], lon[keep], np.full(int(keep.sum()), spacing)
    spacings = zone_spacings(plan, spacing) if plan.zones else []
    painted = any(not stroke.out for stroke in plan.strokes)
    # several areas, or ground painted in, share one lattice: overlapping areas lay each point once
    parts = [(*(_union_grid(plan, spacing) if plan.areas or painted else _polygon_grid(plan.area, spacing)), spacing)]
    for zone, step in zip(plan.zones, spacings):
        if step:
            parts.append((*_polygon_grid(zone.area, step), step))
    lat = np.concatenate([part[0] for part in parts])
    lon = np.concatenate([part[1] for part in parts])
    steps = np.concatenate([np.full(part[0].size, part[2]) for part in parts])
    if plan.zones:
        # inside a zone laid finer, its grid stands for the coarser ones
        for zone, step in zip(plan.zones, spacings):
            if step:
                coarser = (steps > step) & inside(zone.area, lat, lon)
                lat, lon, steps = lat[~coarser], lon[~coarser], steps[~coarser]
        order = np.argsort(steps, kind="stable")
        lat, lon, steps = lat[order], lon[order], steps[order]
        _, first = np.unique(np.round(np.column_stack([lat, lon]), 6), axis=0, return_index=True)
        first = np.sort(first)
        lat, lon, steps = lat[first], lon[first], steps[first]
        keep = within(plan, lat, lon)
        lat, lon, steps = lat[keep], lon[keep], steps[keep]
    elif plan.strokes:
        keep = within(plan, lat, lon)
        lat, lon, steps = lat[keep], lon[keep], steps[keep]
    return lat, lon, steps


def _lattice(
    lat0: float, lon0: float, x: np.ndarray, y: np.ndarray, spacing: float,
    origin: tuple[float, float] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """A hex lattice (`HEX_ACROSS`, `HEX_ROWS`) as close to every spot as a square grid `spacing` metres apart,
    over the box of the local points (x, y) about (lat0, lon0): from the box's corner, or set on `origin`, a
    corner in local metres the box may grow past, so the points it held stay where they were (the map lays
    the ones the brush paints in on the same lattice, frontend lib/horizon/find.js `latticeNear`)."""
    across = spacing * HEX_ACROSS
    rows = spacing * HEX_ROWS
    gxs: list[np.ndarray] = []
    gys: list[np.ndarray] = []
    if origin is None:
        for i, row in enumerate(np.arange(y.min() + rows / 2, y.max() + rows / 2, rows)):
            # every other row shifted by half, its first point on the box's edge
            xs = np.arange(x.min(), x.max() + across / 2, across) if i % 2 else np.arange(x.min() + across / 2, x.max(), across)
            gxs.append(xs)
            gys.append(np.full(xs.size, row))
    else:
        x0, y0 = origin
        # the rows and columns over the box and one more each way; the caller keeps those inside
        for i in range(math.floor((y.min() - y0) / rows - 0.5) - 1, math.ceil((y.max() - y0) / rows - 0.5) + 2):
            shift = 0.0 if i % 2 else across / 2
            columns = np.arange(math.floor((x.min() - x0 - shift) / across) - 1, math.ceil((x.max() - x0 - shift) / across) + 2)
            xs = x0 + shift + columns * across
            gxs.append(xs)
            gys.append(np.full(xs.size, y0 + rows / 2 + i * rows))
    if not gxs:
        return np.empty(0), np.empty(0)
    return _from_local(lat0, lon0, np.concatenate(gxs), np.concatenate(gys))


def _polygon_grid(area: Sequence[tuple[float, float]], spacing: float) -> tuple[np.ndarray, np.ndarray]:
    """Points over a polygon as close to every spot as a square grid `spacing` metres apart (`_lattice`)."""
    lat0, lon0 = area[0]
    x, y = _local(lat0, lon0, np.array([p[0] for p in area]), np.array([p[1] for p in area]))
    lat, lon = _lattice(lat0, lon0, x, y, spacing)
    keep = inside(area, lat, lon)
    return lat[keep], lon[keep]


def _union_grid(plan: Plan, spacing: float) -> tuple[np.ndarray, np.ndarray]:
    """One lattice over every area and every stroke painted in (`_lattice`, about the first area's first corner
    and set on the corner of its box, so it lays the first area's points as that area alone does), each point
    laid once however the areas overlap; `within` then says which are searched."""
    lat0, lon0 = plan.area[0]
    xs: list[np.ndarray] = []
    ys: list[np.ndarray] = []
    for area in areas_of(plan):
        x, y = _local(lat0, lon0, np.array([p[0] for p in area]), np.array([p[1] for p in area]))
        xs.append(x)
        ys.append(y)
    origin = (float(xs[0].min()), float(ys[0].min()))
    for stroke in plan.strokes:
        if stroke.out:
            continue
        x, y = _local(lat0, lon0, np.array([p[0] for p in stroke.path]), np.array([p[1] for p in stroke.path]))
        xs.extend([x - stroke.radius, x + stroke.radius])
        ys.extend([y - stroke.radius, y + stroke.radius])
    lat, lon = _lattice(lat0, lon0, np.concatenate(xs), np.concatenate(ys), spacing, origin)
    covered = np.zeros(lat.shape, dtype=bool)
    for area in areas_of(plan):
        covered |= inside(area, lat, lon)
    for stroke in plan.strokes:
        if not stroke.out:
            covered |= near_path(stroke.path, stroke.radius, lat, lon)
    return lat[covered], lon[covered]


def rules_out(plan: Plan) -> bool:
    """Whether the plan says something of the photo that rules points out before any sweep (engine/ruleout.py)."""
    return bool(plan.sea or plan.water or plan.over)


def seen_from(
    plan: Plan, lat: np.ndarray, lon: np.ndarray, sampler: terrain.Sampler, *, sight: ruleout.Sight = "no",
    tell: Callable[[int], None] | None = None,
) -> np.ndarray:
    """Which points may have taken the photo for what it shows (engine/ruleout.py), water in sight looked for
    as `sight` says: all of them when it says nothing that rules one out."""
    if not rules_out(plan) or not np.size(lat):
        return np.ones(np.size(lat), dtype=bool)
    return ruleout.ruled(plan, np.asarray(lat), np.asarray(lon), sampler, sight=sight, tell=tell) == ""


def standing(plan: Plan, lat: np.ndarray, lon: np.ndarray, sampler: terrain.Sampler, *, kinds: bool = True) -> np.ndarray:
    """Which points the eye may stand at: on foot never on water unless it is ticked, and on the ground
    ticked when `kinds`."""
    keep = np.ones(lat.size, dtype=bool)
    stands = [kind for kind in plan.stands if kind in landform.STANDS] if kinds else []
    # on foot, nobody stands on water unless the analyst ticked it (a boat)
    dry = plan.mode == "ground" and landform.WATER not in plan.stands
    if not lat.size or (not dry and not stands):
        return keep
    ground = landform.kinds(lat, lon, sampler)
    if dry:
        keep &= ground != landform.WATER
    if stands and len(stands) < len(landform.STANDS):
        keep &= np.isin(ground, stands)
    return keep


def preview(plan: Plan, sampler: terrain.Sampler | None = None) -> dict[str, Any]:
    """The coarse grid before a search, each point with the ground it stands on and whether it is searched; a
    point the brush left out stays on it, greyed, its ground said `PAINTED` and the ground under it after (the
    map turns it back on in its colour while the brush paints), and one what the photo shows rules out its
    reason (engine/ruleout.py `REASONS`), counted in `ruled`. Water in sight is said as far as it was checked
    (the Mesh step's check, `ruleout.ruled` with `sight="known"`); `sight` says how many points with water
    within reach are still to check, and about how long that takes here."""
    sampler = sampler or terrain.Sampler()
    spacing = coarse_spacing(plan)
    # the grid laid as if the brush had painted nothing out, then what it painted out said so
    shown = replace(plan, strokes=tuple(stroke for stroke in plan.strokes if not stroke.out)) if plan.strokes else plan
    lat, lon = grid(shown, spacing)
    painted = ~within(plan, lat, lon) if plan.strokes else np.zeros(lat.size, dtype=bool)
    under = landform.kinds(lat, lon, sampler) if lat.size else np.empty(0, dtype=object)
    ground = np.where(painted, PAINTED, under).astype(object)
    kept = np.zeros(lat.size, dtype=bool)
    if (~painted).any():
        kept[~painted] = standing(plan, lat[~painted], lon[~painted], sampler)
    counts = {kind: int(np.sum(ground == kind)) for kind in landform.STANDS}
    # what the photo shows rules out, said as the ground those points stand on
    ruled: dict[str, int] = {}
    pending: list[int] = []
    if rules_out(plan) and kept.any():
        why = ruleout.ruled(plan, lat[kept], lon[kept], sampler, sight="known", pending=pending)
        out = np.flatnonzero(kept)[why != ""]
        ground[out] = why[why != ""]
        kept[out] = False
        ruled = {reason: int(np.sum(why == reason)) for reason in ruleout.REASONS if np.any(why == reason)}
    return {
        "spacing": spacing,
        "total": int(lat.size),
        "kept": int(kept.sum()),
        "kinds": counts,
        "ruled": ruled,
        "sight": {"pending": sum(pending), "seconds": round(sum(pending) * ruleout.SIGHT_SECONDS, 1)},
        "points": [
            [round(float(a), 6), round(float(o), 6), str(k), bool(on), *([str(u)] if k == PAINTED else [])]
            for a, o, k, on, u in zip(lat, lon, ground, kept, under)
        ],
    }


def check_sight(
    plan: Plan, sampler: terrain.Sampler | None = None,
    tell: Callable[[int, int], None] = lambda done, total: None, cancelled: Callable[[], bool] = lambda: False,
) -> int:
    """Look for water in sight (engine/ruleout.py) from each point of the grid the preview lays that has water
    within reach and was not checked yet, so the preview and the search read it back: the Mesh step's check.
    `tell(done, total)` is told as each point is; `cancelled()` stops it by raising `Cancelled`, what was
    checked by then kept. How many points were checked."""
    sampler = sampler or terrain.Sampler(keep=SEARCH_TILES, plates=True)
    lat, lon = grid(plan, coarse_spacing(plan))
    if not rules_out(plan) or not lat.size:
        return 0
    on_ground = standing(plan, lat, lon, sampler)
    lat, lon = lat[on_ground], lon[on_ground]
    pending: list[int] = []
    ruleout.ruled(plan, lat, lon, sampler, sight="known", pending=pending)
    total = sum(pending)
    done = 0

    def told(_: int) -> None:
        nonlocal done
        done += 1
        tell(done, total)
        if cancelled():
            raise Cancelled

    if total:
        ruleout.ruled(plan, lat, lon, sampler, sight="all", tell=told)
    return done


def asked_spacing(plan: Plan) -> float:
    """The coarse spacing asked: the analyst's, else Auto's, no wider than the nearest line said asks for."""
    if plan.spacing:
        return float(plan.spacing)
    spacing = auto_spacing(searched_m2(plan), plan.effort)
    if plan.near:
        spacing = min(spacing, max(FINE_MIN, SAID_SHARE * plan.near))
    return spacing


def coarse_spacing(plan: Plan) -> float:
    """The coarse grid's spacing: the one asked (`asked_spacing`), widened until the grid is within `COARSE_MAX`,
    or `PICKED_MAX` for a spacing the analyst picked."""
    spacing = asked_spacing(plan)
    most = PICKED_MAX if plan.spacing else round(COARSE_MAX * max(1.0, plan.effort))
    if not plan.alignments:
        # a fine grid over a large area starts about as wide as it must end, not by laying millions of points:
        # the hex lattice lays one point every HEX_ACROSS·HEX_ROWS square spacings
        spacing = max(spacing, math.sqrt(searched_m2(plan) / (most * HEX_ACROSS * HEX_ROWS)))
    while grid(plan, spacing)[0].size > most:
        spacing *= 1.05
    return spacing


def levels(coarse: float, fine: float) -> int:
    """How many times the grid is refined, three by three, from the coarse spacing to the fine one."""
    return max(0, math.ceil(math.log(max(coarse / max(fine, 1.0), 1.0)) / math.log(3) - 1e-9))


def detail(plan: Plan, sampler: terrain.Sampler | None = None) -> float:
    """The terrain's own detail over the area, metres: a survey's where the deepest level answers, else GLO-30's."""
    lat = sum(p[0] for p in plan.area) / len(plan.area)
    lon = sum(p[1] for p in plan.area) / len(plan.area)
    probe = terrain.Sampler() if sampler is None else sampler
    probe.heights(lat, lon, terrain.MAX_ZOOM)
    return float(probe.resolution(lat) or terrain.PLANET_DETAIL_M)


def fine_spacing(plan: Plan, sampler: terrain.Sampler | None = None, *, probe: bool = True) -> float:
    """The finest spacing the grid is refined to: the analyst's, else what the terrain there is worth.

    Without `probe` the terrain is not read (an estimate asks nothing of the network): GLO-30's then.
    """
    if plan.fine:
        return float(plan.fine)
    seen = detail(plan, sampler) if probe else terrain.PLANET_DETAIL_M
    return float(min(FINE_MAX, max(FINE_MIN, FINE_PER_DETAIL * seen)))


def _polish_count() -> int:
    return POLISH * ((2 * POLISH_STEPS + 1) ** 2 - 1)


def estimate(plan: Plan, *, efforts: bool = True) -> dict[str, Any]:
    """How many points a search lays and refines, before it is run, the terrain left unread; with Auto's grid,
    as many for each effort the analyst may pick (`efforts`)."""
    spacing = coarse_spacing(plan)
    fine = fine_spacing(plan, probe=False)
    coarse = int(grid(plan, spacing)[0].size)
    depth = levels(spacing, fine)
    refined = depth * KEEP * 8
    points = coarse + refined + _polish_count() + FULL_PLACES
    asked = asked_spacing(plan)
    return {
        "spacing": spacing, "fine": round(fine, 1), "coarse": coarse,
        "points": points, "levels": depth,
        # the spacing asked, when the area was too large for it and a wider one is used
        "asked": round(asked, 1) if spacing > asked * 1.01 else None,
        # the zones given a spacing, when they hold too many points for it: how many times wider they are laid
        "zones_wider": zones_wider(plan, spacing),
        # where relief stands near, the cells are filled in: at most this many points in all
        "most": points + int(DENSE_MAX * coarse),
        **({"efforts": {
            name: {key: told[key] for key in ("points", "most", "spacing", "coarse")}
            for name, effort in EFFORTS.items()
            for told in [estimate(replace(plan, effort=effort), efforts=False)]
        }} if efforts and not plan.spacing else {}),
    }


# Which points the next pace is timed on: other ones each time, so a point timed before, its turn kept, does not
# pass for the grid's (only points a search swept already are as quick).
_PACED = {"round": 0}


def pace(plan: Plan, trace: Trace, sampler: terrain.Sampler | None = None) -> dict[str, Any]:
    """How long this machine takes to rank one point of the search, seconds: timed on `PACE_POINTS` points of
    the grid, after one that reads the terrain in, as the search ranks them. Their turns are kept
    (engine/turncache.py), so the search does not sweep them again."""
    sampler = sampler or terrain.Sampler(keep=SEARCH_TILES, plates=True)
    spacing = coarse_spacing(plan)
    lat, lon = grid(plan, spacing)
    if not lat.size:
        return {"seconds": None, "timed": 0}
    _PACED["round"] += 1
    picks = np.random.default_rng(_PACED["round"]).permutation(lat.size)[:PACE_POINTS + 1]
    timed = picks[1:] if picks.size > 1 else picks
    if picks.size > 1:
        _score_stage(float(lat[picks[0]]), float(lon[picks[0]]), spacing, "rough", None, trace, plan, sampler)
    started = time.monotonic()
    for index in timed:
        _score_stage(float(lat[index]), float(lon[index]), spacing, "rough", None, trace, plan, sampler)
    seconds = (time.monotonic() - started) / timed.size
    # the places listed are fitted once more without the judging marks, when the trace has any
    top = FULL_PLACES + (TOP if unmarked(trace) is not trace else 0)
    return {"seconds": round(seconds, 3), "timed": int(timed.size), "full": FULL_COST, "lane_power": LANE_POWER, "top": top}


# -- one point -----------------------------------------------------------------


def reaches(plan: Plan, trace: Trace | None = None) -> tuple[float, list[float]]:
    """How far the turn is read and where it is cut: as far as the farthest line said can stand, cut at
    each other line's; else Auto's cuts, or the analyst's reach and on to twice it."""
    said = said_bands(trace) if trace is not None else None
    if said is not None:
        highs = sorted({round(float(v)) for v in said[1]})
        far = float(min(horizon.FAR_MAX, highs[-1]))
        return far, [float(v) for v in highs[:-1] if v < far]
    if not plan.reach:
        return AUTO_FAR, [c for c in AUTO_CUTS if c < AUTO_FAR]
    far = max(plan.reach, min(plan.reach * REACH_PAST, AUTO_FAR))
    return far, [plan.reach] if far > plan.reach else []


def relief(turn: skymatch.Turn, fit: skymatch.Fit) -> float:
    """How far out the ridges the trace was laid on stand, metres: the middle of the skyline's distances
    across the lens the fit found, on the cut it lies on; infinite where the turn does not say."""
    if turn.distance is None:
        return math.inf
    half = min(180.0, fit.fov / 2)
    columns = np.arange(fit.heading - half, fit.heading + half + turn.step / 2, turn.step)
    far = turn.far(columns)
    far = far[np.isfinite(far)]
    return float(np.median(far)) if far.size else math.inf


def column_step(trace: Trace) -> float:
    """Degrees between the turn's columns: a thirtieth of the narrowest lens the search may try."""
    if trace.known:
        narrowest = trace.fov
    elif trace.within is not None:
        low, high = min(trace.within), max(trace.within)
        # any lens at all: the columns are set for "very zoomed" at the narrowest, which has its own word
        narrowest = STEP_LENS_FLOOR if high >= 100 and low < STEP_LENS_FLOOR else low
    else:
        narrowest = trace.fov / skymatch.LENS_REACH
    return float(min(STEP_MAX, max(STEP_MIN, narrowest / 30)))


def facing_sectors(words: Sequence[str] | None) -> tuple[skymatch.Sector, ...] | None:
    """The sectors the compass directions ticked stand for, those side by side joined; None for none or all."""
    ticked = sorted({DIRECTIONS.index(word) for word in words or () if word in DIRECTIONS})
    if not ticked or len(ticked) == len(DIRECTIONS):
        return None
    # runs of neighbours round the turn, the first starting after a gap
    start = next(i for i in ticked if (i - 1) % len(DIRECTIONS) not in ticked)
    order = [(start + k) % len(DIRECTIONS) for k in range(len(DIRECTIONS))]
    runs: list[list[int]] = []
    for i in order:
        if i not in ticked:
            continue
        if runs and (runs[-1][-1] + 1) % len(DIRECTIONS) == i:
            runs[-1].append(i)
        else:
            runs.append([i])
    width = 2 * DIRECTION_HALF
    return tuple(
        ((run[0] * width + (len(run) - 1) * width / 2) % 360.0, len(run) * DIRECTION_HALF) for run in runs
    )


def half_span(trace: Trace) -> float:
    """Degrees the trace may reach either side of where the photo faces: half the widest lens tried,
    or half its own width when it spans more (a collage read frame by frame)."""
    lens = trace.fov if trace.known or trace.within is None else max(trace.within)
    if trace.lens_window is not None and not trace.known:
        # a warm start's lenses, and as far again as its refinement may ease them
        lens = min(lens, max(trace.lens_window) * WARM_LENS)
    reach = float(np.abs(trace.x).max()) if trace.x.size else 1.0
    if trace.projection == "panorama":
        return max(lens / 2, reach * lens / 2)
    return max(lens / 2, math.degrees(math.atan(reach * math.tan(math.radians(min(lens, 179.0)) / 2))))


def heading_mask(sectors: Sequence[skymatch.Sector] | None) -> np.ndarray:
    """The headings a list of sectors holds, degree by degree (360 of them): all when None."""
    out = np.zeros(360, dtype=bool)
    if sectors is None:
        out[:] = True
        return out
    degrees = np.arange(360.0) + 0.5
    for centre, half in sectors:
        out |= np.abs((degrees - centre + 180.0) % 360.0 - 180.0) <= half
    return out


def mask_sectors(mask: np.ndarray) -> tuple[skymatch.Sector, ...] | None:
    """Sectors holding the headings a degree-by-degree mask holds: None when it holds every one."""
    if mask.all():
        return None
    if not mask.any():
        return ()
    start = int(np.flatnonzero(~mask)[0])
    rolled = np.roll(mask, -start)
    out: list[skymatch.Sector] = []
    i = 0
    while i < 360:
        if not rolled[i]:
            i += 1
            continue
        j = i
        while j < 360 and rolled[j]:
            j += 1
        out.append((((start + (i + j) / 2) % 360.0), (j - i) / 2))
        i = j
    return tuple(out)


def sun_headings(
    lat: float, lon: float, day: str, start: str, end: str, sides: Sequence[str],
) -> tuple[np.ndarray, dict[str, Any]] | None:
    """The headings the sun allows, degree by degree, and what was read: `{ zone, from, to, up }`, `from`
    and `to` the sun's azimuths over the window and `up` whether it stood above the horizon then.
    `day` is a date, `start` and `end` local hours (`HH:MM`) at the point; None when no side is said."""
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    from . import localtime, sky

    said = [side for side in sides if side in SUN_SIDES]
    if not said:
        return None
    zone = localtime.zone_for(lat, lon)
    first = datetime.fromisoformat(f"{day}T{start}").replace(tzinfo=ZoneInfo(zone))
    last = datetime.fromisoformat(f"{day}T{end}").replace(tzinfo=ZoneInfo(zone))
    if last < first:
        first, last = last, first
    count = max(1, int((last - first).total_seconds() // (SUN_EVERY_MIN * 60)) + 1)
    times = [first + timedelta(minutes=SUN_EVERY_MIN * i) for i in range(count)]
    if times[-1] < last:
        times.append(last)
    where = sky.positions(lat, lon, times)
    azimuth = np.asarray(where["sun_azimuth"], dtype=np.float64)
    up = np.asarray(where["sun_altitude"], dtype=np.float64) > -1.0
    mask = np.zeros(360, dtype=bool)
    for side in said:
        mask |= heading_mask([((a + SUN_SIDES[side]) % 360.0, SUN_HALF) for a in azimuth[up]])
    read = {
        "zone": zone,
        "from": round(float(azimuth[0]), 1),
        "to": round(float(azimuth[-1]), 1),
        "up": bool(up.any()),
    }
    return mask, read


def facing_with_sun(
    facing: tuple[skymatch.Sector, ...] | None, sun: np.ndarray | None,
) -> tuple[skymatch.Sector, ...] | None:
    """The headings both the compass directions ticked and the sun allow, as sectors."""
    if sun is None:
        return facing
    return mask_sectors(heading_mask(facing) & sun)


def marched(columns: np.ndarray, facing: tuple[skymatch.Sector, ...] | None, half_width: float) -> np.ndarray:
    """The columns of the turn a point marches: those a photo facing within the sectors can span,
    `half_width` degrees either side."""
    if facing is None:
        return np.ones(columns.size, dtype=bool)
    out = np.zeros(columns.size, dtype=bool)
    for centre, half in facing:
        reach_deg = half + half_width + 2.0
        if reach_deg >= 180.0:
            return np.ones(columns.size, dtype=bool)
        out |= np.abs((columns - centre + 180.0) % 360.0 - 180.0) <= reach_deg
    return out


def turn_share(trace: Trace) -> float:
    """The share of the turn a point marches, what the directions the analyst ticked save."""
    columns = np.arange(0.0, 360.0, column_step(trace))
    return float(marched(columns, trace.facing, half_span(trace)).mean())


def _facing(trace: Trace, plan: Plan, lat: float, lon: float) -> tuple[skymatch.Sector, ...] | None:
    """The sectors searched from a point: an alignment's, the lens known; else the analyst's."""
    if trace.known:
        for line in plan.alignments:
            if line.photo_x is None:
                continue
            toward = terrain.bearing(lat, lon, line.lat, line.lon)
            if trace.projection == "panorama":
                across = line.photo_x * trace.fov / 2
            else:
                across = math.degrees(math.atan(line.photo_x * math.tan(math.radians(trace.fov) / 2)))
            return (((toward - across) % 360.0, max(FACING_MIN, 2 * line.tolerance + 1.0)),)
    return trace.facing


def warm_half(trace: Trace) -> float:
    """Degrees either side of a neighbour's heading a point warm-started from it slides over (`WARM_*`)."""
    lens = trace.fov if trace.known or trace.within is None else max(trace.within)
    return float(max(WARM_DEG, WARM_LENS_SHARE * min(lens, 360.0)))


def warmed(trace: Trace, plan: Plan, lat: float, lon: float, seeds: Sequence[tuple[float, float]]) -> Trace | None:
    """The trace as a point warm-started from its neighbours' fits searches it (C9): its headings narrowed to
    `warm_half` about each seed's heading, within the analyst's own, and an unknown lens to the lenses a full
    slide tries within `WARM_LENS` times the seeds' either way; None when no heading is left."""
    half = warm_half(trace)
    near = heading_mask(tuple((float(h) % 360.0, half) for h, _ in seeds))
    facing = mask_sectors(heading_mask(_facing(trace, plan, lat, lon)) & near)
    if facing == ():
        return None
    if trace.known:
        return replace(trace, facing=facing)
    fovs = [float(f) for _, f in seeds]
    return replace(trace, facing=facing, lens_window=(min(fovs) / WARM_LENS, max(fovs) * WARM_LENS))


def sea_horizon(altitude: float) -> float:
    """How far the sea's horizon stands from an eye this high above it, metres (with refraction)."""
    return math.sqrt(2 * horizon.effective_radius() * max(SEA_EYE_MIN, altitude))


def _at_sea(marks: skymatch.Marks | None, altitude: float) -> skymatch.Marks | None:
    """The marks with each sea line's distance said, from the eye's height above the sea."""
    if marks is None or not marks.sea:
        return marks
    reach = sea_horizon(altitude)
    said = tuple((stroke, SEA_NEAR * reach, SEA_FAR * reach) for stroke in marks.sea)
    return replace(marks, far=tuple(marks.far) + said)


def _mirrored(marks: skymatch.Marks | None) -> skymatch.Marks | None:
    """The marks of a trace mirrored left to right: the inner edges with it, the strokes and pieces kept."""
    if marks is None:
        return None
    return replace(marks, ridge_x=-marks.ridge_x)


def score_point(
    lat: float, lon: float, trace: Trace, plan: Plan, *, sampler: terrain.Sampler, quick: bool = True,
    heights: Sequence[float] | None = None, rough: bool = False, near_step: float = horizon.NEAR_STEP,
) -> dict[str, Any]:
    """How well the trace lies on the turn seen from a point: the best place and how much it explains."""
    far, cuts = reaches(plan, trace)
    step = column_step(trace)
    facing = _facing(trace, plan, lat, lon)
    best: dict[str, Any] = {"lat": round(lat, 6), "lon": round(lon, 6), "explained": -1.0}
    columns = np.arange(0.0, 360.0, step)
    # facing a known way, only the sectors the photo can span are marched; the rest of the turn is left empty
    marching = marched(columns, facing, half_span(trace))
    for height in heights or plan.heights:
        observer = horizon.Observer(lat, lon, plan.mode, float(height))
        marks = trace.marks
        reach = far
        try:
            if marks is not None and marks.sea:
                # the sea's horizon from this eye: the turn reads out past it
                altitude = observer.altitude(float(sampler.heights(lat, lon, terrain.MAX_ZOOM)))
                marks = _at_sea(marks, altitude)
                reach = max(far, SEA_FAR * skymatch.BAND_SLACK * sea_horizon(altitude))
            # a line said to have only sky above is read as far as the photo may see over it, past where the trace
            # is searched if need be: a range there would have shown over it. With a reach given, each line as far
            # as its own said distance reaches (`sky_reaches`), on the top of the land that far; left to Auto, as far
            # as land standing over it may still count (skymatch.CLEAR_FAR times as far as the farthest line may
            # stand), however near the lines are said to stand
            limits = sky_reaches(marks, plan.reach) if marks is not None and marks.clear and plan.reach else {}
            wanted = sorted(set(limits.values()))
            on = min(AUTO_FAR, skymatch.CLEAR_FAR * reach) if marks is not None and marks.clear and not wanted else None
            read = max(reach, wanted[-1]) if wanted else max(reach, on) if on is not None else reach
            extra = [reach] if read > reach else []
            extra += [v for v in wanted if v < read and v not in cuts and v not in extra]
            # a turn swept by an earlier search over the same ground is read back (engine/turncache.py)
            swept = turncache.swept(
                observer, azimuths=columns[marching], far=read, cuts=[*cuts, *extra], sampler=sampler,
                workers=WORKERS, near_step=near_step,
            )
        except horizon.BelowGround:
            continue

        def whole(row: np.ndarray) -> np.ndarray:
            out = np.full(columns.size, np.nan)
            out[marching] = row
            return out

        rows = [
            skymatch.Turn(0.0, step, whole(row), reach=float(at), distance=whole(far_row))
            for at, row, far_row in zip(swept.cuts, swept.skyline_cuts, swept.skyline_cuts_distance)
        ]
        full = skymatch.Turn(0.0, step, whole(swept.skyline), reach=read, distance=whole(swept.skyline_distance))
        turns = rows[:len(cuts)]
        by_cut = dict(zip([*cuts, *extra], rows))
        clear = None
        beyond: list[skymatch.Turn] = []
        if read > reach:
            # the trace is searched out to the reach, its lines with only sky above read on past it: each as far as
            # it is read, else as Auto reads them (skymatch._over)
            turns.append(replace(by_cut[reach], reach=reach))
            if not wanted:
                beyond.append(full)
        else:
            turns.append(full)
        if wanted:
            clear = skymatch.Stack(
                tuple(full if v >= read else by_cut[v] for v in wanted),
                tuple((stroke, wanted.index(v)) for stroke, v in limits.items()),
            )
        ridges = None
        if trace.marks is not None and trace.marks.ridge_x.size:
            ridges = skymatch.Ridges.of(
                0.0, step, columns.size, np.flatnonzero(marching)[swept.ridge_column], swept.ridge_angle,
                swept.ridge_distance,
            )
        tries = [(False, trace.x, marks)]
        if trace.mirror:
            tries.append((True, -trace.x, _mirrored(marks)))
        for mirrored, x, marks in tries:
            found = skymatch.match(
                x, trace.y, turns, half_width=trace.half_width, fov=trace.fov, known=trace.known,
                within=trace.within, facing=facing, projection=trace.projection, quick=quick, rough=rough,
                marks=marks, ridges=ridges, floor=trace.floor, tilts=trace.tilts, rounding=trace.rounding,
                clear=clear, beyond=beyond, lens_window=None if trace.known else trace.lens_window, lens_max=trace.lens_max,
            )
            if not found.fits or found.fits[0].explained <= best["explained"]:
                continue
            fit = found.fits[0]
            best = {
                "lat": round(lat, 6), "lon": round(lon, 6), "explained": round(fit.explained, 4),
                "heading": round(fit.heading, 3), "tilt": round(fit.tilt, 3), "roll": round(fit.roll, 3),
                "fov": round(fit.fov, 3), "gap": round(fit.gap, 4), "reach": fit.reach, "height": float(height),
                "ground": round(swept.ground, 1), "verdict": found.verdict,
                "relief": round(relief(next(t for t in turns if t.reach == fit.reach), fit), 1),
            }
            if mirrored:
                best["mirrored"] = True
            if fit.sky is not None:
                best["sky"] = round(fit.sky, 4)
            if fit.inner is not None:
                best["inner"] = round(fit.inner, 4)
            if fit.pairs is not None:
                best["pairs"] = list(fit.pairs)
            if fit.pieces is not None:
                best["pieces"] = skymatch.pieces_of(fit, trace.projection)
            if fit.scale != 1.0:
                best["scale"] = fit.scale
            if fit.over is not None:
                best["over"] = round(fit.over, 4)
            if fit.over_far is not None:
                best["over_far"] = round(fit.over_far)
    return best


# -- the search ------------------------------------------------------------------


def _distance(a: dict[str, Any], b: dict[str, Any]) -> float:
    return terrain.distance(a["lat"], a["lon"], b["lat"], b["lon"])


def _spread(points: list[dict[str, Any]], apart: float, most: int) -> list[dict[str, Any]]:
    """The best points standing `apart` metres from each other."""
    kept: list[dict[str, Any]] = []
    for point in sorted(points, key=lambda p: -p["explained"]):
        if point["explained"] < 0:
            break
        if all(_distance(point, k) >= apart for k in kept):
            kept.append(point)
            if len(kept) == most:
                break
    return kept


def search(
    plan: Plan, trace: Trace, *, sampler: terrain.Sampler | None = None,
    progress: Callable[[int, int], None] = lambda done, total: None,
    cancelled: Callable[[], bool] = lambda: False, lanes: int = 1,
    scored_one: Callable[[dict[str, Any]], None] = lambda point: None,
) -> dict[str, Any]:
    """Search the area for where the trace lies best: every point scored, the best places, a verdict.

    `progress(done, total)` is told as points are scored, one call at a time,
    and `scored_one(point)` each point itself, for a map that fills in while the
    search runs; `cancelled()` is asked before each and stops the search by
    raising `Cancelled`, which carries what was found by then (`so_far`).
    `lanes` points are scored at once, each in its own process.
    """
    sampler = sampler or terrain.Sampler(keep=SEARCH_TILES, plates=True)
    started = time.monotonic()
    spacing = coarse_spacing(plan)
    fine = fine_spacing(plan, sampler)
    lat, lon, steps = spaced_grid(plan, spacing)
    on_ground = standing(plan, lat, lon, sampler)
    lat, lon, steps = lat[on_ground], lon[on_ground], steps[on_ground]

    def checking(_: int) -> None:
        if cancelled():
            raise Cancelled

    # water in sight looked for where the Mesh step did not check it yet
    visible = seen_from(plan, lat, lon, sampler, sight="all", tell=checking)
    lat, lon, steps = lat[visible], lon[visible], steps[visible]
    depth = levels(spacing, fine)
    count = {"total": int(lat.size) + depth * KEEP * 8 + _polish_count() + FULL_PLACES}
    done = 0
    scored: list[dict[str, Any]] = []
    # every point as it was scored, the stage under way's too: what a search stopped had found
    heard: list[dict[str, Any]] = []
    seen: set[tuple[float, float]] = set()
    pool = _lanes(lanes, plan, trace) if lanes > 1 and lat.size >= LANE_MIN_POINTS else None

    def tell(point: dict[str, Any]) -> None:
        nonlocal done
        done += 1
        heard.append(point)
        scored_one(point)
        progress(min(done, count["total"]), count["total"])

    def score(
        a: float, o: float, step: float, *, stage: str, heights: Sequence[float] | None = None, quiet: bool = False,
    ) -> dict[str, Any]:
        if cancelled():
            raise Cancelled
        point = _score_stage(a, o, step, stage, heights, trace, plan, sampler)
        if not quiet:
            tell(point)
        return point

    def batch(
        jobs: Sequence[tuple[float, float, float]], stage: str, heights: Sequence[float] | None = None,
        *, quiet: bool = False,
    ) -> list[dict[str, Any]]:
        """Points scored in the order given: here, or by the processes when the search has them. `quiet` ones are
        not told: they score again a point told already."""
        if pool is None or len(jobs) < 2:
            return [score(a, o, step, stage=stage, heights=heights, quiet=quiet) for a, o, step in jobs]
        futures = {pool.submit(_lane_score, (a, o, step, stage, heights)): i for i, (a, o, step) in enumerate(jobs)}
        out: list[dict[str, Any] | None] = [None] * len(jobs)
        try:
            for future in as_completed(futures):
                point = future.result()
                out[futures[future]] = point
                if not quiet:
                    tell(point)
                if cancelled():
                    raise Cancelled
        except BaseException:
            for future in futures:
                future.cancel()
            raise
        return [point for point in out if point is not None]

    def warm(jobs: Sequence[Job], stage: str) -> list[dict[str, Any]]:
        """Points scored roughly outward (C9): along a Hilbert curve in runs of `WARM_BLOCK`, each from the fits
        beside it; here, or a run to each process when the search has them."""
        if not jobs:
            return []
        x, y = _local(plan.area[0][0], plan.area[0][1], np.array([j[0] for j in jobs]), np.array([j[1] for j in jobs]))
        ordered = [jobs[i] for i in hilbert_order(x, y)]
        # every process two runs at least, when there are points enough
        length = WARM_BLOCK if pool is None else max(WARM_RUN_MIN, min(WARM_BLOCK, math.ceil(len(jobs) / (2 * lanes))))
        runs = [ordered[i:i + length] for i in range(0, len(ordered), length)]

        def told(point: dict[str, Any]) -> None:
            tell(point)
            if cancelled():
                raise Cancelled

        if pool is None or len(runs) < 2:
            if cancelled():
                raise Cancelled
            return [point for run in runs for point in _warm_run(run, stage, trace, plan, sampler, told)]
        futures = [pool.submit(_lane_run, (run, stage)) for run in runs]
        out: list[dict[str, Any]] = []
        try:
            for future in as_completed(futures):
                for point in future.result():
                    out.append(point)
                    told(point)
        except BaseException:
            for future in futures:
                future.cancel()
            raise
        return out

    try:
        return _search(plan, trace, sampler, spacing, fine, lat, lon, steps, depth, count, scored, seen, batch, warm, progress, started)
    except Cancelled as stopped:
        stopped.result = so_far(heard, spacing, fine, trace, started)
        raise
    finally:
        if pool is not None:
            pool.shutdown(wait=False, cancel_futures=True)


def hilbert_order(x: np.ndarray, y: np.ndarray, bits: int = 16) -> np.ndarray:
    """The points' order along a Hilbert curve over their box: each point beside the ones before it."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    if x.size < 2:
        return np.arange(x.size)
    side = (1 << bits) - 1
    span = max(float(np.ptp(x)), float(np.ptp(y)), 1e-9)
    xi = np.clip(((x - x.min()) / span * side).astype(np.int64), 0, side)
    yi = np.clip(((y - y.min()) / span * side).astype(np.int64), 0, side)
    index = np.zeros(x.size, dtype=np.int64)
    s = 1 << (bits - 1)
    while s > 0:
        rx = (xi & s) > 0
        ry = (yi & s) > 0
        index += s * s * ((3 * rx.astype(np.int64)) ^ ry.astype(np.int64))
        # the quadrant turned so the curve runs on through it
        turn = ~ry
        flipped_x = np.where(turn & rx, side - xi, xi)
        flipped_y = np.where(turn & rx, side - yi, yi)
        xi, yi = np.where(turn, flipped_y, flipped_x), np.where(turn, flipped_x, flipped_y)
        s >>= 1
    return np.argsort(index, kind="stable")


# a rough job: where, its spacing, and the fit it refines (explained, heading, lens), when it refines one
Job = tuple[float, float, float, "tuple[float, float, float] | None"]


def _starts(
    a: float, o: float, step: float, given: tuple[float, float, float] | None, run: list[dict[str, Any]],
    trace: Trace,
) -> list[tuple[float, float, float]]:
    """The fits a point may start from (C9), best first: the best two, headings apart, among the points scored
    before it in its run within `WARM_NEAR` spacings and the fit it refines, each explaining `WARM_FLOOR` or more."""
    found = [given] if given is not None else []
    reach = WARM_NEAR * step
    for point in run:
        if point["explained"] < WARM_FLOOR or "heading" not in point:
            continue
        if terrain.distance(a, o, point["lat"], point["lon"]) <= reach:
            found.append((point["explained"], point["heading"], point["fov"]))
    found.sort(key=lambda one: -one[0])
    half = warm_half(trace)
    kept: list[tuple[float, float, float]] = []
    for one in found:
        if one[0] >= WARM_FLOOR and all(_apart(one[1], k[1]) > half for k in kept):
            kept.append(one)
            if len(kept) == 2:
                break
    return kept


def _warm_run(
    jobs: Sequence[Job], stage: str, trace: Trace, plan: Plan, sampler: terrain.Sampler,
    tell: Callable[[dict[str, Any]], None] = lambda point: None,
) -> list[dict[str, Any]]:
    """A run of points scored in the order given, each warm-started where it may be (`_starts`, C9)."""
    out: list[dict[str, Any]] = []
    for i, (a, o, step, given) in enumerate(jobs):
        point = None
        starts = _starts(a, o, step, given, out[-WARM_BLOCK:], trace) if WARM and i % WARM_EVERY else []
        if starts:
            narrowed = warmed(trace, plan, a, o, [(h, f) for _, h, f in starts])
            if narrowed is not None:
                point = _score_stage(a, o, step, stage, None, narrowed, plan, sampler)
                if point["explained"] < starts[0][0] - WARM_DROP:
                    point = None
                else:
                    point["warm"] = True
        if point is None:
            point = _score_stage(a, o, step, stage, None, trace, plan, sampler)
        out.append(point)
        tell(point)
    return out


def _seed(point: dict[str, Any]) -> tuple[float, float, float] | None:
    """The fit a point refined about it starts from: its score, heading and lens, when it has a fit."""
    return (point["explained"], point["heading"], point["fov"]) if "heading" in point else None


def _score_stage(
    a: float, o: float, step: float, stage: str, heights: Sequence[float] | None, trace: Trace, plan: Plan,
    sampler: terrain.Sampler,
) -> dict[str, Any]:
    """One point scored as a stage of the search asks: roughly, polished, in full, or in full with the analyst's
    judging marks left out (`bare`)."""
    if stage == "rough":
        point = score_point(a, o, trace, plan, sampler=sampler, rough=True, near_step=ROUGH_NEAR_M)
    elif stage == "polish":
        point = score_point(a, o, trace, plan, sampler=sampler, quick=True, near_step=POLISH_NEAR_M)
    elif stage == "bare":
        point = score_point(a, o, unmarked(trace), plan, sampler=sampler, quick=False, heights=heights)
    else:
        point = score_point(a, o, trace, plan, sampler=sampler, quick=False, heights=heights)
    point["spacing"] = step
    return point


# what each process of a search holds: the plan, the trace and its own terrain reader
_LANE: dict[str, Any] = {}


def _lane_start(plan: Plan, trace: Trace, fetch: Any) -> None:
    """A search's process made ready: its plan, its trace and a terrain reader of its own, its tiles bounded."""
    if fetch is not None:
        terrain.tile = fetch
    _LANE.update(plan=plan, trace=trace, sampler=terrain.Sampler(keep=SEARCH_TILES, plates=True))


def _lane_score(job: tuple[float, float, float, str, Sequence[float] | None]) -> dict[str, Any]:
    a, o, step, stage, heights = job
    return _score_stage(a, o, step, stage, heights, _LANE["trace"], _LANE["plan"], _LANE["sampler"])


def _lane_run(job: tuple[list[Job], str]) -> list[dict[str, Any]]:
    jobs, stage = job
    return _warm_run(jobs, stage, _LANE["trace"], _LANE["plan"], _LANE["sampler"])


def _lanes(lanes: int, plan: Plan, trace: Trace) -> ProcessPoolExecutor:
    """Processes for a search, started the way every system can (spawn), told where tiles come from."""
    import multiprocessing
    import pickle

    fetch: Any = terrain.tile
    try:
        pickle.dumps(fetch)
    except Exception:  # a source only this process knows: the processes read the usual one
        fetch = None
    return ProcessPoolExecutor(
        max_workers=lanes, mp_context=multiprocessing.get_context("spawn"),
        initializer=_lane_start, initargs=(plan, trace, fetch),
    )


def _search(
    plan: Plan, trace: Trace, sampler: terrain.Sampler, spacing: float, fine: float, lat: np.ndarray,
    lon: np.ndarray, steps: np.ndarray, depth: int, count: dict[str, int], scored: list[dict[str, Any]],
    seen: set[tuple[float, float]],
    batch: Callable[..., list[dict[str, Any]]], warm: Callable[..., list[dict[str, Any]]],
    progress: Callable[[int, int], None], started: float,
) -> dict[str, Any]:
    """The search's stages, each scoring its points through `batch`; `count["total"]` grows as the
    filling-in adds points."""

    def about(point: dict[str, Any], step: float, reach: int) -> list[tuple[float, float]]:
        """Grid points `step` apart about a point, `reach` steps either way, not scored yet, in the area and on the lines."""
        out = []
        for i in range(-reach, reach + 1):
            for j in range(-reach, reach + 1):
                if i == 0 and j == 0:
                    continue
                lats, lons = _from_local(point["lat"], point["lon"], np.array([i * step]), np.array([j * step]))
                a, o = float(lats[0]), float(lons[0])
                key = (round(a, 6), round(o, 6))
                if key in seen or not within(plan, np.array([a]), np.array([o]))[0]:
                    continue
                if plan.alignments and not on_lines(plan.alignments, np.array([a]), np.array([o]))[0]:
                    continue
                seen.add(key)
                out.append((a, o))
        # the refinement about a kept point is free, but never out on the water, nor where the photo could not be
        if out and (plan.mode == "ground" or rules_out(plan)):
            lats, lons = np.array([a for a, _ in out]), np.array([o for _, o in out])
            dry = standing(plan, lats, lons, sampler, kinds=False) if plan.mode == "ground" else np.ones(len(out), dtype=bool)
            out = [one for one, keep in zip(out, dry & seen_from(plan, lats, lons, sampler)) if keep]
        return out

    # ranked roughly over the whole grid, best-first on a large one
    for a, o in zip(lat, lon):
        seen.add((round(float(a), 6), round(float(o), 6)))
    laid: list[Job] = [(float(a), float(o), float(own), None) for a, o, own in zip(lat, lon, steps)]
    bounded = None
    if BOUND and len(laid) >= BOUND_MIN and not plan.alignments:
        ranked, bounded = _best_first(laid, plan.area[0], warm, batch)
        count["total"] -= bounded["skipped"]
        scored.extend(ranked)
    else:
        scored.extend(warm(laid, "rough"))
    # the cells near relief filled in, and ranked as roughly, each from its cell's fit
    extra = filled(plan, scored, spacing, fine, seen)
    if extra:
        lats, lons = np.array([one[0] for one in extra]), np.array([one[1] for one in extra])
        dry = standing(plan, lats, lons, sampler) & seen_from(plan, lats, lons, sampler)
        extra = [one for one, keep in zip(extra, dry) if keep]
    count["total"] += len(extra)
    scored.extend(warm(extra, "rough"))
    # the best points a warm start scored, slid again in full: a peak its neighbours' fit led astray (C9)
    contenders = {id(p): p for p in [*_spread(scored, APART_M, RECHECK_PLACES), *_spread(scored, spacing, RECHECK_NEAR)] if p.get("warm")}
    if contenders:
        count["total"] += len(contenders)
        held = list(contenders.values())
        for point, again in zip(held, batch([(p["lat"], p["lon"], p["spacing"]) for p in held], "rough")):
            point.pop("warm", None)
            if again["explained"] > point["explained"]:
                point.update(again)
    # refined three by three about the best, each from its own spacing, down to what the terrain is worth
    step = spacing
    for _ in range(depth):
        kept = _spread(scored, step, KEEP)
        step /= 3
        refined: list[Job] = []
        for point in kept:
            own = max(fine, min(step, point["spacing"] / 3))
            refined.extend((a, o, own, _seed(point)) for a, o in about(point, own, 1))
        scored.extend(warm(refined, "rough"))
    # the three best polished on a finer grid, with the ground near the eye read finely
    polish_step = step / 2
    jobs: list[tuple[float, float, float]] = []
    for point in _spread(scored, max(APART_M, 2 * fine), POLISH):
        jobs.extend((a, o, polish_step) for a, o in about(point, polish_step, POLISH_STEPS))
    scored.extend(batch(jobs, "polish"))
    # the best places, searched in full as a Fit is, more of them than are listed
    best = _spread(scored, max(APART_M, 2 * fine), FULL_PLACES)
    fulls = batch([(p["lat"], p["lon"], p["spacing"]) for p in best], "full", heights=plan.final_heights or None)
    places = [full if full["explained"] >= point["explained"] else point for point, full in zip(best, fulls)]
    places = sorted(places, key=lambda p: -p["explained"])[:TOP]
    # what each place listed explains with the analyst's distances, Sky only and pairs left out: a place they cost
    # much says one of them may be wrong there
    if unmarked(trace) is not trace:
        bares = batch([(p["lat"], p["lon"], p["spacing"]) for p in places], "bare", heights=plan.final_heights or None,
                      quiet=True)
        for place, bare in zip(places, bares):
            if bare["explained"] > place["explained"]:
                place["bare"] = bare["explained"]
    progress(count["total"], count["total"])
    answer = _answer(places, scored, spacing, fine, trace, started)
    if bounded is not None:
        answer["bounded"] = bounded
    return answer


def cells_of(origin: tuple[float, float], jobs: Sequence[Job]) -> list[list[int]]:
    """The grid's points gathered in cells `BOUND_CELL` of their spacings a side (as much ground as that many
    squared of the lattice's points stand for), each cell's points listed the one nearest its middle first."""
    x, y = _local(origin[0], origin[1], np.array([j[0] for j in jobs]), np.array([j[1] for j in jobs]))
    groups: dict[tuple[float, int, int], list[int]] = {}
    for i, job in enumerate(jobs):
        side = BOUND_CELL * job[2] * math.sqrt(HEX_ACROSS * HEX_ROWS)
        groups.setdefault((job[2], math.floor(x[i] / side), math.floor(y[i] / side)), []).append(i)
    cells = []
    for (step, cx, cy), members in groups.items():
        side = BOUND_CELL * step * math.sqrt(HEX_ACROSS * HEX_ROWS)
        mx, my = (cx + 0.5) * side, (cy + 0.5) * side
        cells.append(sorted(members, key=lambda i: (x[i] - mx) ** 2 + (y[i] - my) ** 2))
    return cells


def bound(point: dict[str, Any]) -> float:
    """The most a point of a scored one's cell may explain (C7): its score and `BOUND_SLACK`."""
    return max(0.0, point["explained"]) + BOUND_SLACK


def _best_first(
    jobs: Sequence[Job], origin: tuple[float, float], warm: Callable[..., list[dict[str, Any]]],
    batch: Callable[..., list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """A large grid ranked best-first (C7): one point a cell first, drawn as large as its cell, then each cell's
    others, the best bound first, while a bound can still reach the last of the `TOP` places found (places
    `APART_M` apart, as the answer lists them: every place, not the first alone), or the cell is among the best
    `BOUND_SHARE`. Each cell's first point is slid in full (`batch`): its bound rests on it, and a warm start reads
    low at times (with both, two truths' best fell 0.15 where either alone kept it); the others start from it
    (`warm`). What was scored, and `{ cells, filled, skipped }`: how many cells, how many were searched at the
    grid's own spacing, how many of its points were never needed. A cell left keeps its first point as large as the
    cell (`bounded` on it), so the map shows no hole."""
    cells = cells_of(origin, jobs)
    side = {i: BOUND_CELL * jobs[cell[0]][2] * math.sqrt(HEX_ACROSS * HEX_ROWS) for i, cell in enumerate(cells)}
    firsts = [(jobs[cell[0]][0], jobs[cell[0]][1], side[i]) for i, cell in enumerate(cells)]
    head: dict[int, dict[str, Any]] = dict(enumerate(batch(firsts, "rough")))
    for point in head.values():
        point["bounded"] = True
    out = list(head.values())

    def last_place() -> float:
        """The score a cell must reach to change the places: the last of `TOP`, none while fewer are found."""
        places = _spread(out, APART_M, TOP)
        return places[-1]["explained"] if len(places) == TOP else -math.inf

    floor = last_place()
    queue = [(-bound(head[i]), i) for i in head if len(cells[i]) > 1]
    heapq.heapify(queue)
    least = math.ceil(BOUND_SHARE * len(queue))
    filled = 0
    while queue:
        taken: list[int] = []
        while queue and len(taken) < BOUND_BATCH:
            top, i = queue[0]
            if -top < floor and filled + len(taken) >= least:
                queue.clear()
                break
            heapq.heappop(queue)
            taken.append(i)
        if not taken:
            break
        inside = [(jobs[j][0], jobs[j][1], jobs[j][2], _seed(head[i])) for i in taken for j in cells[i][1:]]
        found = warm(inside, "rough")
        for i in taken:
            # its cell searched at the grid's own spacing: its first point drawn as one of them
            head[i]["spacing"] = jobs[cells[i][0]][2]
            head[i].pop("bounded", None)
        out.extend(found)
        floor = last_place()
        filled += len(taken)
    skipped = sum(len(cells[i]) - 1 for i in head if head[i].get("bounded"))
    return out, {"cells": len(cells), "filled": filled, "skipped": skipped}


def _answer(
    places: list[dict[str, Any]], scored: list[dict[str, Any]], spacing: float, fine: float, trace: Trace,
    started: float,
) -> dict[str, Any]:
    """A search's answer from its places and every point it scored."""
    rise = standout(places, scored)
    return {
        "verdict": verdict(places, rise),
        "standout": None if rise is None else round(rise, 3),
        "places": places,
        "points": [shown(p) for p in scored if p["explained"] >= 0],
        "spacing": round(spacing, 1),
        "fine": round(fine, 1),
        "step": column_step(trace),
        "seconds": round(time.monotonic() - started, 1),
    }


def shown(point: dict[str, Any]) -> dict[str, Any]:
    """A point scored as the map draws it: with how far off the terrain the trace lies there, degrees, so
    that where nothing explains the trace the map still shows where it lies nearest; a point ruled out by
    land over a line with only sky above says so, and how far out that land stands."""
    return {
        "lat": point["lat"], "lon": point["lon"], "explained": point["explained"],
        "spacing": round(point["spacing"], 1), "gap": round(point["gap"], 2), **_ruled(point),
    }


def so_far(
    heard: list[dict[str, Any]], spacing: float, fine: float, trace: Trace, started: float,
) -> dict[str, Any]:
    """What a search stopped had found (`partial`): the points it had scored, each once as last scored,
    and its best places among them, as finely as they were scored by then."""
    latest = list({(p["lat"], p["lon"]): p for p in heard}.values())
    places = _spread(latest, max(APART_M, 2 * fine), TOP)
    return {**_answer(places, latest, spacing, fine, trace, started), "partial": True}


def _ruled(point: dict[str, Any]) -> dict[str, Any]:
    """Why a point is no place, when land stands over a line with only sky above past `CLEAR_HARD` of it."""
    if point.get("over", 0.0) < skymatch.CLEAR_HARD:
        return {}
    return {"over": point["over"], "over_far": point.get("over_far")}


def filled(
    plan: Plan, coarse: list[dict[str, Any]], spacing: float, fine: float, seen: set[tuple[float, float]],
) -> list[Job]:
    """Points filling in the cells of the coarse grid whose relief stands near: (lat, lon, spacing, the cell's
    fit to start from).

    Each cell, a square holding as much ground as its point's lattice gives it (√(HEX_ACROSS·HEX_ROWS) times its
    spacing, `spacing` where it says none), is filled in at `NEAR_SHARE` of
    the distance to the ridges its point sees, no finer than `fine`. The cells
    nearest their relief come first; past `DENSE_MAX` times the grid's points,
    the rest are filled two by two, and none once even that does not fit.
    Points off the area or the alignments' lines, or scored already, are left
    out; the ones it lays are added to `seen`.
    """
    budget = int(DENSE_MAX * len(coarse))
    out: list[Job] = []
    for point in sorted(coarse, key=lambda p: p.get("relief", math.inf)):
        near = point.get("relief", math.inf)
        if not math.isfinite(near):
            break
        # a cell the best-first ranking judged could not win is not filled in either
        if point.get("bounded"):
            continue
        # a square as large as the ground each point of the hex lattice stands for: wider ones overlap and would
        # spend the filling-in's budget twice on the same ground
        cell = float(point.get("spacing") or spacing) * math.sqrt(HEX_ACROSS * HEX_ROWS)
        count = int(round(cell / max(fine, NEAR_SHARE * near)))
        if count < 2:
            continue
        if len(out) + count * count > budget:
            count = 2
            if len(out) + count * count > budget:
                break
        own = cell / count
        offsets = (np.arange(count) + 0.5) / count * cell - cell / 2
        gx, gy = np.meshgrid(offsets, offsets)
        lats, lons = _from_local(point["lat"], point["lon"], gx.ravel(), gy.ravel())
        keep = within(plan, lats, lons)
        if plan.alignments:
            keep &= on_lines(plan.alignments, lats, lons)
        for a, o in zip(lats[keep], lons[keep]):
            key = (round(float(a), 6), round(float(o), 6))
            if key not in seen:
                seen.add(key)
                out.append((float(a), float(o), own, _seed(point)))
    return out


def standout(places: list[dict[str, Any]], points: list[dict[str, Any]]) -> float | None:
    """How far the best place stands above the area's top tenth of points: a real place rises clear of
    the rest, a coincidence sits among many about as good. None with too few points to say."""
    scores = sorted(p["explained"] for p in points if p["explained"] >= 0)
    if not places or len(scores) < 10:
        return None
    return float(places[0]["explained"] - scores[int(0.9 * (len(scores) - 1))])


def verdict(places: list[dict[str, Any]], rise: float | None = None) -> Verdict:
    """What the best places say: as `skymatch`'s verdict, `unclear` when the best does not stand out
    of the area (`standout`), `ambiguous` for a rival `SEPARATE_M` apart."""
    if not places:
        return "none"
    best = places[0]
    if best.get("verdict") == "flat":
        return "flat"
    if best["explained"] < skymatch.NONE_BELOW:
        return "none"
    if rise is not None and rise < STANDOUT_MIN:
        return "unclear"
    rivals = [p for p in places[1:] if _distance(p, best) >= SEPARATE_M]
    if rivals and rivals[0]["explained"] >= best["explained"] - AMBIGUOUS_MARGIN:
        return "ambiguous"
    if best["explained"] < skymatch.LOOSE_BELOW:
        return "loose"
    return "match"
