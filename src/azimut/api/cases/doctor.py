"""The case doctor: what is inconsistent on disk, and the repairs offered.

Read the report, then apply one repair by name. Every repair is stated as an
explicit action rather than run on open, because a case that silently rewrites
itself is one an analyst cannot vouch for.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...engine import doctor as doctor_engine
from ...engine import media as media_engine
from ...workspace import Case, CaseError
from .common import delete_entity_deep

router = APIRouter(prefix="/api/cases", tags=["cases"])


class DoctorRepair(BaseModel):
    action: str = Field(min_length=1, max_length=20)
    entity_id: str | None = Field(default=None, max_length=64)
    path: str | None = Field(default=None, max_length=300)
    replacement: str | None = Field(default=None, max_length=300)

@router.get("/{case_id}/doctor")
def doctor_report(case_id: str) -> dict[str, Any]:
    """Inspect a case even when its database is missing."""
    try:
        return doctor_engine.scan(Case.locate(case_id))
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

@router.post("/{case_id}/doctor/repair")
def doctor_repair(case_id: str, body: DoctorRepair) -> dict[str, Any]:
    """Apply one repair that the current Doctor report explicitly offers."""
    try:
        located = Case.locate(case_id)
        if body.action == "rebuild":
            result = doctor_engine.rebuild_database(located)
            case = located
        else:
            case = Case.open(case_id)
            if body.action == "rebuild-timeline":
                doctor_engine.require_stale_temporal_projection(case)
                result = {
                    "status": "rebuilt",
                    "items": case.rebuild_temporal_projection(),
                }
            elif body.action == "import" and body.path:
                doctor_engine.require_unknown_media(case, body.path)
                result = media_engine.register_existing(case, body.path)
            elif body.action == "drop" and body.entity_id:
                doctor_engine.require_missing_media(case, body.entity_id)
                result = delete_entity_deep(case, body.entity_id)
            elif body.action == "relink" and body.entity_id and body.replacement:
                doctor_engine.require_missing_media(case, body.entity_id)
                doctor_engine.require_unknown_media(case, body.replacement)
                result = media_engine.relink_existing(
                    case,
                    body.entity_id,
                    body.replacement,
                )
            else:
                raise CaseError("this repair action is not valid")
        return {"repair": result, "report": doctor_engine.scan(case)}
    except (CaseError, OSError, ValueError, sqlite3.Error) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
