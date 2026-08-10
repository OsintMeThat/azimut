"""Named, case-owned Board and Graph readings."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..engine import analysis_views as view_engine
from ..engine import trash as trash_engine
from ..workspace import CaseError
from .cases import get_case

router = APIRouter(
    prefix="/api/cases/{case_id}/analysis-views", tags=["analysis views"]
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class AnalysisViewIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    mode: Literal["live", "snapshot"] = "live"
    surface: Literal["board", "graph"] = "board"
    spec: dict[str, Any] = Field(default_factory=dict)


class AnalysisViewDuplicateIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


def _unique(case, name: str, *, ignore: str | None = None) -> None:
    wanted = name.strip().casefold()
    if any(
        view["id"] != ignore and str(view["name"]).strip().casefold() == wanted
        for view in case.list_analysis_views()
    ):
        raise HTTPException(status_code=409, detail=f"an analysis view named '{name}' already exists")


def _save(
    case,
    view_id: str,
    body: AnalysisViewIn,
    *,
    created_at: str,
    snapshot_copy: bool = False,
) -> dict[str, Any]:
    name = body.name.strip()
    _unique(case, name, ignore=view_id)
    try:
        spec = view_engine.prepare(
            case,
            body.spec,
            mode=body.mode,
            surface=body.surface,
            snapshot_copy=snapshot_copy,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    now = _now()
    return case.save_analysis_view({
        "id": view_id,
        "name": name,
        "mode": body.mode,
        "surface": body.surface,
        "spec": spec,
        "created_at": created_at,
        "updated_at": now,
    })


@router.get("")
def list_analysis_views(case_id: str) -> dict[str, Any]:
    case = get_case(case_id)
    return {"views": [view_engine.summary(view) for view in case.list_analysis_views()]}


@router.post("")
def create_analysis_view(case_id: str, body: AnalysisViewIn) -> dict[str, Any]:
    case = get_case(case_id)
    now = _now()
    return _save(case, f"v_{uuid.uuid4().hex[:16]}", body, created_at=now)


@router.get("/{view_id}")
def get_analysis_view(case_id: str, view_id: str) -> dict[str, Any]:
    view = get_case(case_id).get_analysis_view(view_id)
    if view is None:
        raise HTTPException(status_code=404, detail=f"analysis view '{view_id}' not found")
    return view


@router.post("/{view_id}/duplicate")
def duplicate_analysis_view(
    case_id: str, view_id: str, body: AnalysisViewDuplicateIn
) -> dict[str, Any]:
    case = get_case(case_id)
    current = case.get_analysis_view(view_id)
    if current is None:
        raise HTTPException(status_code=404, detail=f"analysis view '{view_id}' not found")
    now = _now()
    duplicate = AnalysisViewIn(
        name=body.name,
        mode=current["mode"],
        surface=current["surface"],
        spec=current["spec"],
    )
    return _save(
        case,
        f"v_{uuid.uuid4().hex[:16]}",
        duplicate,
        created_at=now,
        snapshot_copy=True,
    )


@router.put("/{view_id}")
def update_analysis_view(
    case_id: str, view_id: str, body: AnalysisViewIn
) -> dict[str, Any]:
    case = get_case(case_id)
    current = case.get_analysis_view(view_id)
    if current is None:
        raise HTTPException(status_code=404, detail=f"analysis view '{view_id}' not found")
    if current["mode"] == "snapshot":
        raise HTTPException(status_code=409, detail="a snapshot is immutable; duplicate it instead")
    return _save(case, view_id, body, created_at=current["created_at"])


@router.delete("/{view_id}")
def delete_analysis_view(case_id: str, view_id: str) -> dict[str, Any]:
    case = get_case(case_id)
    view = case.get_analysis_view(view_id)
    if view is None:
        raise HTTPException(status_code=404, detail=f"analysis view '{view_id}' not found")
    group = trash_engine.send_analysis_view(case, view)
    try:
        case.remove_analysis_view(view_id)
        trash_engine.commit(case, group["id"])
    except Exception:
        trash_engine.rollback(case, group["id"])
        raise
    return {"status": "deleted", "deleted": [view_id], "trash": group["id"]}
