"""Searches for where a photo was taken: started, followed, stopped and kept (engine/horizon_finds.py).

A search is started by the analyst's press and runs on the case's background
queue; the browser follows its progress by reading it again, stops it with
`cancel`, and opens a finished one with every point it scored. A search is case
work like a saved view: listed, renamed by nothing but its own name, deleted to
the Trash.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from .. import layout
from ..engine import artifacts as artifact_engine
from ..engine import finder, horizon, horizon_finds, skymatch, terrain, workqueue
from ..workspace import CaseError
from .cases import delete_by_path, get_case
from .horizon import HEIGHT_LIMITS, MATCH_PLANE_MAX, MATCH_POINTS_MAX, SKYLINE_CUTS

router = APIRouter(prefix="/api", tags=["horizon"])

FALLBACK = "Search"
AREA_CORNERS_MAX = 200
ALIGNMENTS_MAX = 12


class LatLon(BaseModel):
    lat: float = Field(ge=-terrain.MAX_LAT, le=terrain.MAX_LAT)
    lon: float = Field(ge=-180, le=180)


class TraceIn(BaseModel):
    """The trace on the picture plane and its lens, as `/api/horizon/match` takes them."""

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


class FindIn(BaseModel):
    """What a search asks: where, for what trace, by whom, and how finely."""

    title: str | None = Field(default=None, max_length=200)
    photo: PhotoIn | None = None
    trace: TraceIn
    area: list[LatLon] = Field(min_length=3, max_length=AREA_CORNERS_MAX)
    who: WhoIn = Field(default_factory=WhoIn)
    reach: int | None = None
    spacing: float | None = Field(default=None, ge=50, le=5000)
    alignments: list[AlignmentIn] = Field(default_factory=list, max_length=ALIGNMENTS_MAX)
    hints: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _sane(self) -> FindIn:
        if self.reach is not None and self.reach not in {int(c) for c in SKYLINE_CUTS}:
            raise ValueError("a reach is one the panorama keeps its skyline at")
        area = [(p.lat, p.lon) for p in self.area]
        size = finder.area_m2(area)
        if size < 1e4:
            raise ValueError("the area is too small to search")
        if size > 2_500e6:
            raise ValueError("the area is too large: keep it under 2500 km²")
        return self


def _names(case: Any) -> set[str]:
    folder = case.resolve_inside(layout.horizon_find_rel("x")).parent
    return {path.stem.casefold() for path in folder.glob("*.json")} if folder.is_dir() else set()


@router.post("/cases/{case_id}/horizon/finds")
def start_find(case_id: str, body: FindIn) -> dict[str, Any]:
    """Keep the question as a search of the case and start it on the background queue."""
    case = get_case(case_id)
    title = body.title or (f"{body.photo.title} search" if body.photo and body.photo.title else FALLBACK)
    name = layout.free_stem(_names(case), layout.slugify(title, FALLBACK), FALLBACK)
    ask = body.model_dump()
    ask["area"] = [[p.lat, p.lon] for p in body.area]
    ask.pop("title", None)
    record = horizon_finds.new_record(name, ask)
    rel = layout.horizon_find_rel(name)
    horizon_finds.write(case, name, record)
    if case.find_entity(attr="spec", value=rel) is None:
        case.add_entity(horizon_finds.TYPE, name, attrs={"spec": rel}, by="horizon")
    workqueue.enqueue(case, horizon_finds.JOB, key=name, payload={"name": name})
    return {"name": name, **horizon_finds.row(name, record)}


@router.post("/horizon/finds/estimate")
def estimate_find(body: FindIn) -> dict[str, Any]:
    """How many points a search would lay and refine, and the columns of its turns, before it runs."""
    plan, trace = horizon_finds.plan_of({**body.model_dump(), "area": [[p.lat, p.lon] for p in body.area]})
    return {**finder.estimate(plan), "step": finder.column_step(trace)}


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


@router.post("/cases/{case_id}/horizon/finds/{name}/cancel")
def cancel_find(case_id: str, name: str) -> dict[str, Any]:
    """Stop a search that is queued or running: it stops between two points."""
    case = get_case(case_id)
    safe, record = _one(case, name)
    if record.get("status") in horizon_finds.ACTIVE:
        record["status"] = "cancelled"
        horizon_finds.write(case, safe, record)
    return horizon_finds.row(safe, record)


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
