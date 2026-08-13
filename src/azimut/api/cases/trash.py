"""The trash: what was deleted, put back, or purged for good.

One row per delete action rather than per entity, so a video deleted with its three
Inspect sessions comes back as the one thing the analyst removed.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from ...engine import trash as trash_engine
from ...workspace import CaseError
from .common import get_case

router = APIRouter(prefix="/api/cases", tags=["cases"])


@router.get("/{case_id}/trash")
def list_trash(case_id: str) -> dict[str, Any]:
    """What the case is holding for you, newest first.

    Head columns only — no payload is read here, so the node costs one indexed
    query however much is waiting in it.
    """
    case = get_case(case_id)
    summary = case.trash_summary()
    return {
        "groups": case.list_trash(),
        "items": summary["items"],
        "size_bytes": summary["size_bytes"],
    }

@router.post("/{case_id}/trash/{group_id}/restore")
def restore_trash(case_id: str, group_id: str) -> dict[str, Any]:
    """Take one delete back, all of it or none.

    A 409 means a file is back at a path the group wants: restoring would have to
    rename an artifact behind the analyst, so it refuses and names the path
    instead.
    """
    case = get_case(case_id)
    try:
        return trash_engine.restore(case, group_id)
    except CaseError as exc:
        message = str(exc)
        status = 404 if "not found" in message else 409
        raise HTTPException(status_code=status, detail=message) from exc

@router.delete("/{case_id}/trash/{group_id}")
def purge_trash(case_id: str, group_id: str) -> dict[str, str]:
    """Drop one group for good. This is where the bytes actually go."""
    case = get_case(case_id)
    try:
        trash_engine.purge(case, group_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "purged"}

@router.delete("/{case_id}/trash")
def empty_trash(case_id: str) -> dict[str, int]:
    return {"purged": trash_engine.empty(get_case(case_id))}
