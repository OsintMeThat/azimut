"""Serve case files (media, thumbnails, satellite crops, proofs) to the UI.

Only paths inside a case directory are reachable (Case.resolve_inside refuses
traversal), and the server itself binds to localhost only.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..workspace import CaseError
from .cases import get_case

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/{case_id}/{rel_path:path}")
def case_file(case_id: str, rel_path: str) -> FileResponse:
    case = get_case(case_id)
    try:
        path = case.resolve_inside(rel_path)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(path)
