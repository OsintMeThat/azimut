"""The work on Horizon's bench, kept in the case so it can be resumed (engine/horizon_work.py).

The browser writes the bench a moment after each change and reads it when the
tab opens on a case, offering it back unless a save keeps all of it. It is
checked here as a saved view and a search are: the view's own models, Find's,
and a photo that must be a file of this case.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..engine import horizon_work, terrain
from ..workspace import CaseError
from .cases import get_case
from .horizon_finds import ALIGNMENTS_MAX, AREA_CORNERS_MAX, ZONES_MAX, Direction, Stand, View, WhoIn
from .horizon_views import Photo, PhotoPoint, ViewSpec, _photo_here

router = APIRouter(prefix="/api", tags=["horizon"])


class MapPoint(BaseModel):
    lat: float = Field(ge=-terrain.MAX_LAT, le=terrain.MAX_LAT, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)


class MapEnds(BaseModel):
    near: MapPoint
    far: MapPoint


class PhotoEnds(BaseModel):
    near: PhotoPoint
    far: PhotoPoint


class Heights(BaseModel):
    near: float = Field(default=0, ge=0, le=1000)
    far: float = Field(default=0, ge=0, le=1000)


class AlignmentWork(BaseModel):
    """An alignment as Find holds it (lib/horizon/find.js): its two ends on the photo and on the map."""

    colour: str | None = Field(default=None, max_length=20)
    photo: PhotoEnds
    map: MapEnds
    offset: float = Field(default=0, ge=-180, le=180, allow_inf_nan=False)
    offset_known: bool = True
    tops: bool = False
    heights: Heights = Field(default_factory=Heights)


class ZoneWork(BaseModel):
    """A zone beside the area as Find holds it: its corners, its grid, and whether it is left out."""

    points: list[MapPoint] = Field(default_factory=list, max_length=AREA_CORNERS_MAX)
    spacing: Literal["auto", 100, 250, 500, 1000] = "auto"
    out: bool = False


class SunWork(BaseModel):
    """The sun as Find holds it while it is set: a day (blank until typed), two hours, the sides ticked."""

    date: str = Field(default="", pattern=r"^(\d{4}-\d{2}-\d{2})?$")
    start: str = Field(default="06:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(default="18:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    sides: list[Literal["ahead", "left", "right", "behind"]] = Field(default_factory=list, max_length=4)


class FindWork(BaseModel):
    """Find's setup: the area, the alignments, who took the photo, the settings, the search on show."""

    area: list[MapPoint] = Field(default_factory=list, max_length=AREA_CORNERS_MAX)
    alignments: list[AlignmentWork] = Field(default_factory=list, max_length=ALIGNMENTS_MAX)
    who: WhoIn = Field(default_factory=WhoIn)
    spacing: Literal["auto", 100, 250, 500, 1000] = "auto"
    tolerance: float = Field(default=1.0, gt=0, le=10)
    speed: Literal["gentle", "fast"] = "fast"
    #: The compass directions the photo may face, none for any.
    facing: list[Direction] = Field(default_factory=list, max_length=8)
    #: The ground the eye may stand on, none for any.
    stands: list[Stand] = Field(default_factory=list, max_length=5)
    #: The camera looks down from a height, or up at a summit.
    view: list[View] = Field(default_factory=list, max_length=2)
    #: A selfie, searched mirrored too.
    mirror: bool = False
    zones: list[ZoneWork] = Field(default_factory=list, max_length=ZONES_MAX)
    #: Where the sun stood against the camera, as Find holds it (its day may be blank while typed).
    sun: SunWork | None = None
    search: str | None = Field(default=None, max_length=200)


class WorkIn(BaseModel):
    """The bench: the saved view it came from, the view as it stands, the photo laid, Find's setup, the mode."""

    view: str | None = Field(default=None, max_length=200)
    spec: ViewSpec | None = None
    photo: Photo | None = None
    find: FindWork | None = None
    mode: Literal["view", "overlay", "find"] = "view"
    #: A save keeps all of it (the saved view unchanged, the search's own setup): nothing to offer back.
    saved: bool = False


@router.get("/cases/{case_id}/horizon/work")
def read_work(case_id: str) -> dict[str, Any]:
    """The bench as it was left, and whether its photo is still in the case."""
    case = get_case(case_id)
    work = horizon_work.read(case)
    return {"work": work, "photo_here": _photo_here(case, work or {})}


@router.put("/cases/{case_id}/horizon/work")
def keep_work(case_id: str, body: WorkIn) -> dict[str, Any]:
    case = get_case(case_id)
    if body.photo is not None:
        try:
            case.resolve_inside(body.photo.path)
        except CaseError as exc:
            raise HTTPException(400, "the photo must be a file of this case") from exc
    horizon_work.write(case, body.model_dump(mode="json"))
    return {"ok": True}


@router.delete("/cases/{case_id}/horizon/work")
def clear_work(case_id: str) -> dict[str, Any]:
    return {"cleared": horizon_work.clear(get_case(case_id))}
