"""Serve case files (media, thumbnails, satellite crops, proofs) to the UI.

Only paths inside a case directory are reachable (Case.resolve_inside refuses
traversal), and the server itself binds to localhost only.

Every response carries an ETag and revalidates, so reopening a picker costs one
conditional request per image instead of a full redownload. Thumbnail URLs
embed the content hash and a generation counter, so they are handed out as
immutable and the browser stops asking at all.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from ..engine.thumbnails import THUMB_DIR
from ..workspace import CaseError
from .cases import get_case

router = APIRouter(prefix="/files", tags=["files"])

IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"


@router.get("/{case_id}/{rel_path:path}")
def case_file(case_id: str, rel_path: str, request: Request) -> Response:
    case = get_case(case_id)
    try:
        path = case.resolve_inside(rel_path)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="file not found")

    cache = IMMUTABLE if path.parent.name == THUMB_DIR else REVALIDATE
    # stat here so the ETag is on the response before we answer, and so a file
    # edited in place (Inspect writes back) invalidates its own cache entry.
    response = FileResponse(path, stat_result=path.stat())
    response.headers["cache-control"] = cache
    etag = response.headers.get("etag", "")
    if etag and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"etag": etag, "cache-control": cache})
    return response
