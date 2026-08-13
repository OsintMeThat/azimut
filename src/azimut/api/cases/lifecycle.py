"""Cases as folders: create, open, rename, promote, delete, reveal.

Also the workspace routes beside them — the folders someone made in their file
manager that are not cases yet, and the two ways one becomes a case.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ... import workspace
from ...engine import reveal as reveal_engine
from ...workspace import Case, CaseError
from .common import get_case

router = APIRouter(prefix="/api/cases", tags=["cases"])

#: Folders in the workspace that are not cases yet. Deliberately *not* under
#: `/api/cases`: a case's id is its folder name, so a literal segment there is a
#: name someone can give a folder — `/api/cases/folders` is already the case
#: named "Folders" (`tests/test_cases_api.py`). These operate on the workspace
#: anyway, one level above any case.
workspace_router = APIRouter(prefix="/api/workspace", tags=["cases"])


def _ensure_name_free(name: str, *, exclude_id: str | None = None) -> None:
    """Reject a case name already taken by another (non-scratch) case, matched
    case-insensitively on the trimmed name. ``exclude_id`` lets a rename keep
    its own name."""
    wanted = name.strip().casefold()
    for c in Case.list_all():
        if c.get("scratch") or c["id"] == exclude_id:
            continue
        if str(c.get("name", "")).strip().casefold() == wanted:
            raise HTTPException(status_code=409, detail=f"a case named '{name}' already exists")

class CreateCase(BaseModel):
    name: str = Field(min_length=1, max_length=120)

class PromoteCase(BaseModel):
    name: str = Field(min_length=1, max_length=120)

class FolderName(BaseModel):
    """A directory name in the workspace root, never a path: what it may hold is
    `layout.usable_case_name`'s answer, checked where the folder is opened."""

    name: str = Field(min_length=1, max_length=120)

class MediaPath(BaseModel):
    """One case-relative file path, bounded the way every other media route bounds
    one. Where it may point is `Case.resolve_inside`'s answer, not this model's."""

    path: str = Field(min_length=1, max_length=300)

@router.get("")
def list_cases(q: str | None = None, limit: int | None = None) -> list[dict[str, Any]]:
    return Case.list_all(q=q, limit=limit)

@router.post("")
def create_case(body: CreateCase) -> dict[str, Any]:
    _ensure_name_free(body.name)
    try:
        case = Case.create(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"id": case.id, **case.overview()}

@workspace_router.get("/folders")
def list_workspace_folders() -> list[dict[str, Any]]:
    """Folders sitting in the workspace that are not cases yet, and their state."""
    return workspace.list_workspace_folders()

@workspace_router.post("/folders/adopt")
def adopt_folder(body: FolderName) -> dict[str, Any]:
    """Make a case out of one of those folders, where it already is."""
    _ensure_name_free(body.name)
    try:
        case = Case.adopt(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"id": case.id, **case.overview()}

@workspace_router.post("/folders/recover")
def recover_folder(body: FolderName) -> dict[str, Any]:
    """Write back the manifest of a folder holding a case that lost it.

    The manifest and nothing else: the case is reachable again after this, and
    anything still damaged belongs to the Doctor, which the caller opens next.
    """
    try:
        case = workspace.restore_manifest(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"id": case.id, "name": case.read().get("name", case.id)}

@router.post("/scratch")
def create_scratch() -> dict[str, Any]:
    case = Case.create("Scratch session", scratch=True)
    return {"id": case.id, **case.overview()}

@router.get("/{case_id}")
def read_case(case_id: str) -> dict[str, Any]:
    case = get_case(case_id)
    return {"id": case.id, "scratch": case.is_scratch, **case.overview()}

@router.post("/{case_id}/promote")
def promote_case(case_id: str, body: PromoteCase) -> dict[str, Any]:
    case = get_case(case_id)
    _ensure_name_free(body.name)
    try:
        promoted = case.promote(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"id": promoted.id, **promoted.overview()}

@router.patch("/{case_id}")
def rename_case(case_id: str, body: CreateCase) -> dict[str, Any]:
    case = get_case(case_id)
    _ensure_name_free(body.name, exclude_id=case.id)
    case.rename(body.name)
    return {"id": case.id, **case.overview()}

@router.delete("/{case_id}")
def delete_case(case_id: str) -> dict[str, str]:
    get_case(case_id).delete()
    return {"status": "deleted"}

@router.post("/{case_id}/reveal")
def reveal_case_folder(case_id: str) -> dict[str, str]:
    """Open this case's folder in the system file manager.

    The route takes no path: the case id is enough to find the folder, so nothing
    the browser sends can point somewhere else.
    """
    case = get_case(case_id)
    try:
        reveal_engine.reveal(case.path)
    except reveal_engine.RevealError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"path": str(case.path)}

@router.post("/{case_id}/media/reveal")
def reveal_media_folder(case_id: str, body: MediaPath) -> dict[str, str]:
    """Show the folder holding one of this case's files.

    For what the app cannot display: a PDF, a scan bundle, a spreadsheet. Handing
    those to the browser downloads a second copy into Downloads, which is how an
    analyst ends up working on a file the case no longer knows about. The folder is
    the honest answer — the original is opened in whatever program owns it.

    The path is the browser's, so it goes through ``resolve_inside`` like every
    other media route; ``reveal`` then re-checks that the folder is inside the
    workspace, and it is a folder that is opened, never the file itself.
    """
    case = get_case(case_id)
    try:
        target = case.resolve_inside(body.path)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    try:
        reveal_engine.reveal(target.parent)
    except reveal_engine.RevealError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"path": str(target.parent)}
