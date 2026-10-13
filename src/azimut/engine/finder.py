"""Find where a photo was taken: its traced skyline searched over an area of the map.

Each point of a grid laid over the area gets the skyline seen from it
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

import math
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np

from . import horizon, skymatch, terrain

# Searched when the analyst left the reach to Auto: these cuts and the turn out to the last.
AUTO_FAR = 50_000.0
AUTO_CUTS = (5_000.0, 10_000.0, 20_000.0)
# The grid is refined down to this many times the terrain's own detail (`detail`), within these metres.
FINE_PER_DETAIL = 2.0
FINE_MIN = 25.0
FINE_MAX = 100.0
# The terrain over most of the world: Copernicus GLO-30, however finely its tiles are cut.
PLANET_DETAIL_M = 30.0
# Points kept at each level and refined about, three by three.
KEEP = 12
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
# Two places nearer than this are one hot spot, however good both are: only farther ones make it ambiguous.
SEPARATE_M = 3_000.0
# The best place must stand this far above the area's top tenth of points to stand out: below,
# many places fit about as well and none is named.
STANDOUT_MIN = 0.06
# The coarse grid's spacing when left to Auto: about this many points over the area.
AUTO_POINTS = 900
NICE_SPACINGS = (100.0, 150.0, 250.0, 400.0, 500.0, 750.0, 1_000.0, 1_500.0, 2_000.0, 3_000.0)
# The most points a coarse grid may hold, whatever spacing was asked.
COARSE_MAX = 2_500
# Columns a thirtieth of the narrowest lens, within these bounds (degrees).
STEP_MIN = 0.1
STEP_MAX = 0.5
# An unknown lens's columns are set for lenses this narrow at the least: narrower ones are "very zoomed".
STEP_LENS_FLOOR = 6.0
# Threads one sweep uses: the search runs on the analyst's machine beside everything else.
WORKERS = 2
# A sector searched about the heading an alignment gives, degrees either side at the least.
FACING_MIN = 3.0

Verdict = Literal["match", "loose", "ambiguous", "none", "flat", "unclear"]


class Cancelled(Exception):
    """The analyst stopped the search."""


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
    # a sector the analyst said the photo faces: middle and half width
    facing: tuple[float, float] | None = None


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


def auto_spacing(area: Sequence[tuple[float, float]]) -> float:
    """The coarse spacing that lays about `AUTO_POINTS` points over the area, rounded to a plain number."""
    wanted = math.sqrt(max(area_m2(area), 1.0) / AUTO_POINTS)
    return next((s for s in NICE_SPACINGS if s >= wanted), NICE_SPACINGS[-1])


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
    corners = [(float(a), float(o)) for a, o in plan.area]
    reach = max(terrain.distance(line.lat, line.lon, a, o) for a, o in corners)
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


def grid(plan: Plan, spacing: float) -> tuple[np.ndarray, np.ndarray]:
    """The grid's points over the area and on the alignments' lines."""
    if plan.alignments:
        lat, lon = _along(plan, spacing)
        keep = inside(plan.area, lat, lon) & on_lines(plan.alignments, lat, lon)
        return lat[keep], lon[keep]
    area = plan.area
    lat0, lon0 = area[0]
    lats = np.array([p[0] for p in area])
    lons = np.array([p[1] for p in area])
    x, y = _local(lat0, lon0, lats, lons)
    xs = np.arange(x.min() + spacing / 2, x.max(), spacing)
    ys = np.arange(y.min() + spacing / 2, y.max(), spacing)
    gx, gy = np.meshgrid(xs, ys)
    lat, lon = _from_local(lat0, lon0, gx.ravel(), gy.ravel())
    keep = inside(area, lat, lon)
    return lat[keep], lon[keep]


def coarse_spacing(plan: Plan) -> float:
    """The coarse grid's spacing: the analyst's, or Auto's, widened until the grid is within `COARSE_MAX`."""
    spacing = plan.spacing or auto_spacing(plan.area)
    while grid(plan, spacing)[0].size > COARSE_MAX:
        spacing *= 1.25
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
    deepest = max(probe.zooms) if probe.zooms else terrain.PLANET_ZOOM
    if deepest <= terrain.PLANET_ZOOM:
        return PLANET_DETAIL_M
    return float(terrain.metres_per_pixel(lat, deepest))


def fine_spacing(plan: Plan, sampler: terrain.Sampler | None = None, *, probe: bool = True) -> float:
    """The finest spacing the grid is refined to: the analyst's, else what the terrain there is worth.

    Without `probe` the terrain is not read (an estimate asks nothing of the network): GLO-30's then.
    """
    if plan.fine:
        return float(plan.fine)
    seen = detail(plan, sampler) if probe else PLANET_DETAIL_M
    return float(min(FINE_MAX, max(FINE_MIN, FINE_PER_DETAIL * seen)))


def _polish_count() -> int:
    return POLISH * ((2 * POLISH_STEPS + 1) ** 2 - 1)


def estimate(plan: Plan) -> dict[str, Any]:
    """How many points a search lays and refines, before it is run, the terrain left unread."""
    spacing = coarse_spacing(plan)
    fine = fine_spacing(plan, probe=False)
    coarse = int(grid(plan, spacing)[0].size)
    depth = levels(spacing, fine)
    refined = depth * KEEP * 8
    return {
        "spacing": spacing, "fine": round(fine, 1), "coarse": coarse,
        "points": coarse + refined + _polish_count() + TOP, "levels": depth,
    }


# -- one point -----------------------------------------------------------------


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


def _facing(trace: Trace, plan: Plan, lat: float, lon: float) -> tuple[float, float] | None:
    """The sector searched from a point: an alignment's, the lens known; else the analyst's."""
    if trace.known:
        for line in plan.alignments:
            if line.photo_x is None:
                continue
            toward = terrain.bearing(lat, lon, line.lat, line.lon)
            if trace.projection == "panorama":
                across = line.photo_x * trace.fov / 2
            else:
                across = math.degrees(math.atan(line.photo_x * math.tan(math.radians(trace.fov) / 2)))
            return ((toward - across) % 360.0, max(FACING_MIN, 2 * line.tolerance + 1.0))
    return trace.facing


def score_point(
    lat: float, lon: float, trace: Trace, plan: Plan, *, sampler: terrain.Sampler, quick: bool = True,
    heights: Sequence[float] | None = None, rough: bool = False, near_step: float = horizon.NEAR_STEP,
) -> dict[str, Any]:
    """How well the trace lies on the turn seen from a point: the best place and how much it explains."""
    far = plan.reach or AUTO_FAR
    cuts = [] if plan.reach else [c for c in AUTO_CUTS if c < far]
    step = column_step(trace)
    facing = _facing(trace, plan, lat, lon)
    best: dict[str, Any] = {"lat": round(lat, 6), "lon": round(lon, 6), "explained": -1.0}
    columns = np.arange(0.0, 360.0, step)
    # facing a known way, only the sector the photo can span is marched; the rest of the turn is left empty
    marched = np.ones(columns.size, dtype=bool)
    if facing is not None:
        reach_deg = facing[1] + trace.fov / 2 + 2.0
        if reach_deg < 180.0:
            marched = np.abs((columns - facing[0] + 180.0) % 360.0 - 180.0) <= reach_deg
    for height in heights or plan.heights:
        observer = horizon.Observer(lat, lon, plan.mode, float(height))
        try:
            swept = horizon.sweep(
                observer, azimuths=columns[marched], far=far, cuts=cuts, sampler=sampler, workers=WORKERS,
                near_step=near_step,
            )
        except horizon.BelowGround:
            continue

        def whole(row: np.ndarray) -> np.ndarray:
            out = np.full(columns.size, np.nan)
            out[marched] = row
            return out

        turns = [skymatch.Turn(0.0, step, whole(row), reach=float(at)) for at, row in zip(swept.cuts, swept.skyline_cuts)]
        turns.append(skymatch.Turn(0.0, step, whole(swept.skyline), reach=far))
        found = skymatch.match(
            trace.x, trace.y, turns, half_width=trace.half_width, fov=trace.fov, known=trace.known,
            within=trace.within, facing=facing, projection=trace.projection, quick=quick, rough=rough,
        )
        if not found.fits:
            continue
        fit = found.fits[0]
        if fit.explained > best["explained"]:
            best = {
                "lat": round(lat, 6), "lon": round(lon, 6), "explained": round(fit.explained, 4),
                "heading": round(fit.heading, 3), "tilt": round(fit.tilt, 3), "roll": round(fit.roll, 3),
                "fov": round(fit.fov, 3), "gap": round(fit.gap, 4), "reach": fit.reach, "height": float(height),
                "ground": round(swept.ground, 1), "verdict": found.verdict,
            }
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
    cancelled: Callable[[], bool] = lambda: False,
) -> dict[str, Any]:
    """Search the area for where the trace lies best: every point scored, the best places, a verdict.

    `progress(done, total)` is told as points are scored; `cancelled()` is asked
    between them and stops the search by raising `Cancelled`.
    """
    sampler = sampler or terrain.Sampler()
    started = time.monotonic()
    spacing = coarse_spacing(plan)
    fine = fine_spacing(plan, sampler)
    lat, lon = grid(plan, spacing)
    depth = levels(spacing, fine)
    total = int(lat.size) + depth * KEEP * 8 + _polish_count() + TOP
    done = 0
    scored: list[dict[str, Any]] = []
    seen: set[tuple[float, float]] = set()

    def score(
        a: float, o: float, step: float, *, stage: str, heights: Sequence[float] | None = None,
    ) -> dict[str, Any]:
        nonlocal done
        if cancelled():
            raise Cancelled
        if stage == "rough":
            point = score_point(a, o, trace, plan, sampler=sampler, rough=True, near_step=ROUGH_NEAR_M)
        elif stage == "polish":
            point = score_point(a, o, trace, plan, sampler=sampler, quick=True, near_step=POLISH_NEAR_M)
        else:
            point = score_point(a, o, trace, plan, sampler=sampler, quick=False, heights=heights)
        point["spacing"] = step
        done += 1
        progress(min(done, total), total)
        return point

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
                if key in seen or not inside(plan.area, np.array([a]), np.array([o]))[0]:
                    continue
                if plan.alignments and not on_lines(plan.alignments, np.array([a]), np.array([o]))[0]:
                    continue
                seen.add(key)
                out.append((a, o))
        return out

    # ranked roughly over the whole grid
    for a, o in zip(lat, lon):
        seen.add((round(float(a), 6), round(float(o), 6)))
        scored.append(score(float(a), float(o), spacing, stage="rough"))
    # refined three by three about the best, down to what the terrain is worth
    step = spacing
    for _ in range(depth):
        kept = _spread(scored, step, KEEP)
        step /= 3
        for point in kept:
            for a, o in about(point, step, 1):
                scored.append(score(a, o, step, stage="rough"))
    # the three best polished on a finer grid, with the ground near the eye read finely
    polish_step = step / 2
    for point in _spread(scored, max(APART_M, 2 * fine), POLISH):
        for a, o in about(point, polish_step, POLISH_STEPS):
            scored.append(score(a, o, polish_step, stage="polish"))
    # the best places, searched in full as a Fit is
    places = []
    for point in _spread(scored, max(APART_M, 2 * fine), TOP):
        full = score(point["lat"], point["lon"], point["spacing"], stage="full", heights=plan.final_heights or None)
        places.append(full if full["explained"] >= point["explained"] else point)
    places.sort(key=lambda p: -p["explained"])
    progress(total, total)
    rise = standout(places, scored)
    return {
        "verdict": verdict(places, rise),
        "standout": None if rise is None else round(rise, 3),
        "places": places,
        "points": [
            {"lat": p["lat"], "lon": p["lon"], "explained": p["explained"], "spacing": round(p["spacing"], 1)}
            for p in scored if p["explained"] >= 0
        ],
        "spacing": round(spacing, 1),
        "fine": round(fine, 1),
        "step": column_step(trace),
        "seconds": round(time.monotonic() - started, 1),
    }


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
