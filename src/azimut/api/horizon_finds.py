"""Searches for where a photo was taken: started, followed, stopped and kept (engine/horizon_finds.py).

A search is started by the analyst's press and runs on the case's background
queue; the browser follows its progress by reading it again, and the points it
has scored so far (`points`) to fill the map in, stops it with `cancel`, and
opens a finished one with every point it scored. The place the analyst
confirmed is kept on it (`found`), which stops it too. A search is case work
like a saved view: listed, renamed by nothing but its own name, deleted to the
Trash.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from .. import layout
from ..engine import artifacts as artifact_engine
from ..engine import finder, horizon, horizon_finds, skymatch, terrain, workqueue
from ..workspace import CaseError
from .cases import delete_by_path, get_case
from .horizon import HEIGHT_LIMITS, MARK_FAR_MAX, MATCH_PLANE_MAX, MATCH_POINTS_MAX, SKYLINE_CUTS, MarksIn
from .horizon_views import Marks, PhotoPoint

router = APIRouter(prefix="/api", tags=["horizon"])

FALLBACK = "Search"
#: A compass direction the photo may face (engine/finder.py DIRECTIONS).
Direction = Literal["n", "ne", "e", "se", "s", "sw", "w", "nw"]
#: The ground the eye may stand on (engine/landform.py STANDS).
Stand = Literal["summit", "slope", "valley", "plain", "water"]
#: Which way the camera looks when not about level (engine/finder.py `tilts_for`).
View = Literal["down", "up"]
AREA_CORNERS_MAX = 200
ALIGNMENTS_MAX = 12
ZONES_MAX = 12
# Areas beside the first, and strokes of the brush (each a path this long at most, this wide either side).
AREAS_MAX = 12
STROKES_MAX = 200
STROKE_POINTS_MAX = 500
STROKE_RADIUS_M = (5.0, 5_000.0)
# An area or a zone is this large at the most, square metres, and this small at the least.
AREA_MAX_M2 = 10_000e6
AREA_MIN_M2 = 1e4


class LatLon(BaseModel):
    lat: float = Field(ge=-terrain.MAX_LAT, le=terrain.MAX_LAT)
    lon: float = Field(ge=-180, le=180)


class TraceIn(MarksIn):
    """The trace on the picture plane and its lens, and the marks beside it, as `/api/horizon/match` takes them."""

    x: list[float] = Field(min_length=skymatch.MIN_POINTS, max_length=MATCH_POINTS_MAX)
    y: list[float] = Field(min_length=skymatch.MIN_POINTS, max_length=MATCH_POINTS_MAX)
    half_width: float = Field(gt=0, le=20_000)
    fov: float = Field(ge=skymatch.FOV_MIN, le=skymatch.PANORAMA_FOV_MAX)
    known: bool = False
    within: list[float] | None = Field(default=None, min_length=2, max_length=2)
    projection: Literal["camera", "panorama"] = "camera"
    facing: list[float] | None = Field(default=None, min_length=2, max_length=2)

    @model_validator(mode="after")
    def _sane(self) -> TraceIn:
        if len(self.x) != len(self.y):
            raise ValueError("the trace needs as many x as y")
        if any(abs(v) > MATCH_PLANE_MAX for v in self.x + self.y):
            raise ValueError("the trace lies off the picture")
        top = skymatch.widest(self.projection)
        if self.fov > top or (self.within and not (skymatch.FOV_MIN <= min(self.within) and max(self.within) <= top)):
            raise ValueError(f"lenses run from {skymatch.FOV_MIN:g}° to {top:g}°")
        if self.facing is not None and not (0 <= self.facing[0] < 360 and 0 < self.facing[1] <= 180):
            raise ValueError("a sector is its middle (0 to 360°) and half its width (up to 180°)")
        self.check_marks(len(self.x))
        return self


class WhoIn(BaseModel):
    mode: Literal["ground", "drone", "aircraft"] = "ground"
    low: float = Field(default=horizon.EYE_HEIGHT, ge=0, le=15000)
    high: float = Field(default=horizon.EYE_HEIGHT, ge=0, le=15000)

    @model_validator(mode="after")
    def _sane(self) -> WhoIn:
        floor, ceiling = HEIGHT_LIMITS[self.mode]
        if self.low > self.high or self.low < floor or self.high > ceiling:
            raise ValueError(f"a {self.mode} eye is {floor:g} to {ceiling:g} m high, the lowest first")
        return self


class AlignmentIn(BaseModel):
    """An alignment as the browser made it (lib/horizon/find.js): its ends, its line and where it stands in the photo."""

    near: LatLon
    far: LatLon
    bearing: float = Field(ge=0, lt=360)
    tolerance: float = Field(default=1.0, gt=0, le=10)
    offset: float = 0.0
    photo_x: float | None = Field(default=None, ge=-MATCH_PLANE_MAX, le=MATCH_PLANE_MAX)
    photo: dict[str, Any] | None = None
    tops: bool = False
    heights: dict[str, float] | None = None
    colour: str | None = Field(default=None, max_length=20)


class PhotoIn(BaseModel):
    path: str = Field(min_length=1, max_length=1000)
    kind: Literal["image", "video"] = "image"
    title: str = Field(default="", max_length=300)
    time: float = 0.0
    strokes: list[list[dict[str, float]]] = Field(default_factory=list, max_length=200)
    marks: Marks | None = None
    #: The lens's curve undone and the pulled corners the trace was read through, so it opens on the same plane.
    bend: float = Field(default=0, ge=-0.3, le=0.3, allow_inf_nan=False)
    corners: list[PhotoPoint] | None = Field(default=None, min_length=4, max_length=4)


def _sized(area: list[LatLon], what: str) -> None:
    size = finder.area_m2([(p.lat, p.lon) for p in area])
    if size < AREA_MIN_M2:
        raise ValueError(f"the {what} is too small to search")
    if size > AREA_MAX_M2:
        raise ValueError(f"the {what} is too large: keep it under {AREA_MAX_M2 / 1e6:.0f} km²")


class ZoneIn(BaseModel):
    """A zone beside the area: searched on its own grid (`spacing` metres, None: finer than the area's), or left out."""

    area: list[LatLon] = Field(min_length=3, max_length=AREA_CORNERS_MAX)
    spacing: float | None = Field(default=None, ge=20, le=5000)
    out: bool = False

    @model_validator(mode="after")
    def _sane(self) -> ZoneIn:
        _sized(self.area, "zone")
        return self


class StrokeIn(BaseModel):
    """A stroke of the brush: the points within `radius` metres of its path left out (`out`), or searched."""

    path: list[LatLon] = Field(min_length=1, max_length=STROKE_POINTS_MAX)
    radius: float = Field(ge=STROKE_RADIUS_M[0], le=STROKE_RADIUS_M[1], allow_inf_nan=False)
    out: bool = True


class GroundIn(BaseModel):
    """Where a search would look, by whom and on what ground: what its grid is laid from, the trace aside."""

    area: list[LatLon] = Field(min_length=3, max_length=AREA_CORNERS_MAX)
    who: WhoIn = Field(default_factory=WhoIn)
    reach: int | None = None
    spacing: float | None = Field(default=None, ge=20, le=5000)
    alignments: list[AlignmentIn] = Field(default_factory=list, max_length=ALIGNMENTS_MAX)
    #: The ground the eye may stand on, none for any.
    stands: list[Stand] = Field(default_factory=list, max_length=5)
    #: How far the nearest traced line is said to stand, metres: the grid is laid finely enough for it.
    near: float | None = Field(default=None, ge=0, le=MARK_FAR_MAX)
    #: Zones searched on their own grid beside the area, or left out.
    zones: list[ZoneIn] = Field(default_factory=list, max_length=ZONES_MAX)
    #: More areas searched beside the first, on the same grid.
    areas: list[list[LatLon]] = Field(default_factory=list, max_length=AREAS_MAX)
    #: The brush's strokes, in the order painted: each over the ones before.
    strokes: list[StrokeIn] = Field(default_factory=list, max_length=STROKES_MAX)
    #: How thorough Auto's grid is against the time it takes (engine/finder.py EFFORTS).
    effort: Literal["quick", "normal", "thorough"] = "normal"
    #: What the photo shows that rules points out before the search (engine/ruleout.py): a line along the
    #: sea's horizon (said of the trace once drawn), the sea or a lake, the eye above the land round it or below.
    sea: bool = False
    water: bool = False
    over: Literal["above", "below"] | None = None

    @model_validator(mode="after")
    def _sane(self) -> GroundIn:
        if self.reach is not None and self.reach not in {int(c) for c in SKYLINE_CUTS}:
            raise ValueError("a reach is one the panorama keeps its skyline at")
        _sized(self.area, "area")
        for area in self.areas:
            if not 3 <= len(area) <= AREA_CORNERS_MAX:
                raise ValueError(f"an area has 3 to {AREA_CORNERS_MAX} corners")
            _sized(area, "area")
        if sum(finder.area_m2([(p.lat, p.lon) for p in area]) for area in [self.area, *self.areas]) > AREA_MAX_M2:
            raise ValueError(f"the areas are too large together: keep them under {AREA_MAX_M2 / 1e6:.0f} km²")
        return self


class SunIn(BaseModel):
    """Where the sun stood against the camera, on a day, between two local hours at the place."""

    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    start: str = Field(default="06:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(default="18:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    sides: list[Literal["ahead", "left", "right", "behind"]] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def _sane(self) -> SunIn:
        from datetime import date

        try:
            date.fromisoformat(self.date)
        except ValueError as exc:
            raise ValueError("the sun's day is a date, year first") from exc
        return self


class FindIn(GroundIn):
    """What a search asks: where, for what trace, by whom, and how finely."""

    title: str | None = Field(default=None, max_length=200)
    photo: PhotoIn | None = None
    trace: TraceIn
    #: The compass directions the photo may face, none for any.
    facing: list[Direction] = Field(default_factory=list, max_length=8)
    #: The camera looks down from a height, or up at a summit: its tilt is let go that way.
    view: list[View] = Field(default_factory=list, max_length=2)
    #: A selfie: searched mirrored too.
    mirror: bool = False
    #: Lines nearer than a few kilometres judged rounded to the relief's coarse cell, the nearer the rounder.
    round: bool = False
    #: Where the sun stood against the camera, when the analyst says it.
    sun: SunIn | None = None
    #: Fastest scores a large grid on every core of the machine, fast on up to four, gentle on one, leaving
    #: the computer free.
    speed: Literal["gentle", "fast", "fastest"] = "fast"
    hints: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _headings_left(self) -> FindIn:
        if self.sun is not None and horizon_finds.facing_of(_asked(self)) == ():
            raise ValueError("the sun and the directions ticked leave no heading to search")
        return self


def _names(case: Any) -> set[str]:
    folder = case.resolve_inside(layout.horizon_find_rel("x")).parent
    return {path.stem.casefold() for path in folder.glob("*.json")} if folder.is_dir() else set()


def _asked(body: GroundIn) -> dict[str, Any]:
    """A question as the case keeps it: corners as `[lat, lon]` pairs."""
    return {
        **body.model_dump(),
        "area": [[p.lat, p.lon] for p in body.area],
        "zones": [{**zone.model_dump(), "area": [[p.lat, p.lon] for p in zone.area]} for zone in body.zones],
        "areas": [[[p.lat, p.lon] for p in area] for area in body.areas],
        "strokes": [{**stroke.model_dump(), "path": [[p.lat, p.lon] for p in stroke.path]} for stroke in body.strokes],
    }


@router.post("/cases/{case_id}/horizon/finds")
def start_find(case_id: str, body: FindIn) -> dict[str, Any]:
    """Keep the question as a search of the case and start it on the background queue."""
    case = get_case(case_id)
    title = body.title or (f"{body.photo.title} search" if body.photo and body.photo.title else FALLBACK)
    name = layout.free_stem(_names(case), layout.slugify(title, FALLBACK), FALLBACK)
    ask = _asked(body)
    ask.pop("title", None)
    record = horizon_finds.new_record(name, ask)
    rel = layout.horizon_find_rel(name)
    horizon_finds.write(case, name, record)
    if case.find_entity(attr="spec", value=rel) is None:
        case.add_entity(horizon_finds.TYPE, name, attrs={"spec": rel}, by="horizon")
    workqueue.enqueue(case, horizon_finds.JOB, key=name, payload={"name": name})
    return {"name": name, **horizon_finds.row(name, record)}


class SectorsIn(BaseModel):
    """The headings a setup leaves to search: the compass directions ticked and the sun, at the area."""

    area: list[LatLon] = Field(min_length=3, max_length=AREA_CORNERS_MAX)
    facing: list[Direction] = Field(default_factory=list, max_length=8)
    sun: SunIn | None = None


@router.post("/horizon/finds/sectors")
def find_sectors(body: SectorsIn) -> dict[str, Any]:
    """The headings searched, as sectors `[middle, half width]` (None: every heading; []: none left), and
    what the sun said: its zone and its azimuths over the window, and whether it was up."""
    ask = {"area": [[p.lat, p.lon] for p in body.area], "facing": body.facing,
           "sun": None if body.sun is None else body.sun.model_dump()}
    sectors = horizon_finds.facing_of(ask)
    return {
        "sectors": None if sectors is None else [[round(c, 1), round(h, 1)] for c, h in sectors],
        "sun": horizon_finds.sun_of(ask),
    }


@router.post("/horizon/finds/estimate")
def estimate_find(body: FindIn) -> dict[str, Any]:
    """How many points a search would lay and refine, and the columns of its turns, before it runs."""
    plan, trace = horizon_finds.plan_of(_asked(body))
    return {**finder.estimate(plan), "step": finder.column_step(trace), "turn": round(finder.turn_share(trace), 3)}


@router.post("/cases/{case_id}/horizon/finds/pace")
def pace_find(case_id: str, body: FindIn) -> dict[str, Any]:
    """How long this machine takes to rank one point of the search, timed on a few points of its grid as the
    search would (a collage read frame by frame), with the lanes each speed would run in: what the time a
    search takes is worked out from, before it runs."""
    case = get_case(case_id)
    ask = _asked(body)
    plan, trace = horizon_finds.plan_of(ask)
    plan, trace, _ = horizon_finds.on_frames(case, ask, plan, trace)
    try:
        timed = finder.pace(plan, trace)
    except terrain.TerrainUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"The terrain could not be loaded: {exc}") from exc
    lanes = {speed: horizon_finds.lanes_for(speed) for speed in horizon_finds.SPEEDS}
    return {**timed, "lanes": lanes, "lane_min": finder.LANE_MIN_POINTS}


@router.post("/horizon/finds/preview")
def preview_find(body: GroundIn) -> dict[str, Any]:
    """The grid a search would lay, each point with the ground it stands on and whether it is searched.

    Reads the terrain over the area, which the search reads anyway: asked once the
    analyst has drawn the area, never before.
    """
    plan = horizon_finds.plan_from(_asked(body))
    try:
        return finder.preview(plan)
    except terrain.TerrainUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"The terrain could not be loaded: {exc}") from exc


class TryIn(BaseModel):
    """A trace tried from one point of the map, as a search would score it there: what a search
    asks, the area aside."""

    at: LatLon
    photo: PhotoIn | None = None
    trace: TraceIn
    who: WhoIn = Field(default_factory=WhoIn)
    reach: int | None = None
    alignments: list[AlignmentIn] = Field(default_factory=list, max_length=ALIGNMENTS_MAX)
    facing: list[Direction] = Field(default_factory=list, max_length=8)
    view: list[View] = Field(default_factory=list, max_length=2)
    mirror: bool = False
    round: bool = False
    sun: SunIn | None = None
    hints: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _sane(self) -> TryIn:
        if self.reach is not None and self.reach not in {int(c) for c in SKYLINE_CUTS}:
            raise ValueError("a reach is one the panorama keeps its skyline at")
        return self


@router.post("/cases/{case_id}/horizon/finds/try")
def try_point(case_id: str, body: TryIn) -> dict[str, Any]:
    """The trace tried from one point, searched in full as a search's best places are: how much it
    explains there and the camera that lays it, before (or instead of) a whole search."""
    case = get_case(case_id)
    ask = body.model_dump()
    ask["area"] = [[body.at.lat, body.at.lon]] * 3
    plan, trace = horizon_finds.plan_of(ask)
    plan, trace, framed = horizon_finds.on_frames(case, ask, plan, trace)
    try:
        place = finder.score_point(
            body.at.lat, body.at.lon, trace, plan, sampler=terrain.Sampler(), quick=False,
            heights=plan.final_heights or None,
        )
    except terrain.TerrainUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"The terrain could not be loaded: {exc}") from exc
    return {"place": place, "frames": framed}


@router.get("/cases/{case_id}/horizon/finds")
def list_finds(case_id: str) -> list[dict[str, Any]]:
    """The case's searches, newest first."""
    case = get_case(case_id)
    folder = case.resolve_inside(layout.horizon_find_rel("x")).parent
    rows = []
    for path in folder.glob("*.json") if folder.is_dir() else []:
        record = horizon_finds.read(case, path.stem)
        if record is not None:
            rows.append(horizon_finds.row(path.stem, record))
    rows.sort(key=lambda row: row.get("created_at") or "", reverse=True)
    return rows


def _one(case: Any, name: str) -> tuple[str, dict[str, Any]]:
    safe = layout.slugify(name, FALLBACK)
    try:
        record = horizon_finds.read(case, safe)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(status_code=404, detail="no such search in the case")
    return safe, record


@router.get("/cases/{case_id}/horizon/finds/{name}")
def get_find(case_id: str, name: str) -> dict[str, Any]:
    """A search: what it asked, how far it got and, once done, every point and the best places."""
    safe, record = _one(get_case(case_id), name)
    return {"name": safe, **record}


@router.get("/cases/{case_id}/horizon/finds/{name}/points")
def find_points(
    case_id: str, name: str, since: int = Query(default=0, ge=0), started: float | None = None,
) -> dict[str, Any]:
    """The points a running search has scored so far, from the `since`-th of the run `started` on, for
    the map to fill in as it runs; every point when that run is not the one under way."""
    return horizon_finds.live(get_case(case_id), layout.slugify(name, FALLBACK), since, started)


@router.post("/cases/{case_id}/horizon/finds/{name}/cancel")
def cancel_find(case_id: str, name: str) -> dict[str, Any]:
    """Stop a search that is queued or running: it stops between two points, keeping what it found."""
    case = get_case(case_id)
    safe, record = _one(case, name)
    if record.get("status") in horizon_finds.ACTIVE:
        horizon_finds.stop(record)
        horizon_finds.write(case, safe, record)
    return horizon_finds.row(safe, record)


class FoundIn(BaseModel):
    """The place the analyst confirmed: where the eye stood, how the camera looked, what the search
    scored there, and the view kept of it."""

    lat: float = Field(ge=-terrain.MAX_LAT, le=terrain.MAX_LAT)
    lon: float = Field(ge=-180, le=180)
    height: float | None = Field(default=None, ge=0, le=15000)
    heading: float | None = Field(default=None, ge=-360, le=720, allow_inf_nan=False)
    tilt: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    roll: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    fov: float | None = Field(default=None, gt=0, le=360, allow_inf_nan=False)
    explained: float | None = Field(default=None, ge=-1, le=1, allow_inf_nan=False)
    view: str | None = Field(default=None, max_length=200)


@router.post("/cases/{case_id}/horizon/finds/{name}/found")
def found_place(case_id: str, name: str, body: FoundIn) -> dict[str, Any]:
    """Keep the place the analyst confirmed on the search; one still running stops, keeping what it found."""
    case = get_case(case_id)
    safe, record = _one(case, name)
    record["found"] = {**body.model_dump(exclude_none=True), "at": horizon_finds.now()}
    horizon_finds.stop(record)
    horizon_finds.write(case, safe, record)
    return {"name": safe, **record}


@router.delete("/cases/{case_id}/horizon/finds/{name}/found")
def unfound_place(case_id: str, name: str) -> dict[str, Any]:
    """Take back the place confirmed: the search is as it ended, its view kept."""
    case = get_case(case_id)
    safe, record = _one(case, name)
    if record.pop("found", None) is not None:
        horizon_finds.write(case, safe, record)
    return {"name": safe, **record}


@router.post("/cases/{case_id}/horizon/finds/{name}/check")
def check_find(case_id: str, name: str) -> dict[str, Any]:
    """A finished search's places tried again with decoy traces, the search kept with what they explain."""
    case = get_case(case_id)
    safe, record = _one(case, name)
    if record.get("status") != "done" or not (record.get("result") or {}).get("places"):
        raise HTTPException(status_code=409, detail="only a finished search with places can be checked")
    try:
        horizon_finds.check(case, record)
    except terrain.TerrainUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"The terrain could not be loaded: {exc}") from exc
    record["result"]["checked"] = True
    horizon_finds.write(case, safe, record)
    return {"name": safe, **record}


@router.delete("/cases/{case_id}/horizon/finds/{name}")
def delete_find(case_id: str, name: str) -> dict[str, Any]:
    """Delete a search to the Trash; one still running stops first."""
    case = get_case(case_id)
    safe, record = _one(case, name)
    if record.get("status") in horizon_finds.ACTIVE:
        record["status"] = "cancelled"
        horizon_finds.write(case, safe, record)
    rel = layout.horizon_find_rel(safe)
    result = delete_by_path(case, rel)
    if not result["deleted"]:
        artifact_engine.delete(case, {"type": horizon_finds.TYPE, "attrs": {"spec": rel}})
    return result
