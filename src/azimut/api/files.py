"""Serve case files (media, thumbnails, satellite crops, proofs) to the UI.

Only paths inside a case directory are reachable (Case.resolve_inside refuses
traversal), and the server itself binds to localhost only.

A case file comes from anywhere: a bundle someone sent, a page a download pulled.
Opened in a tab it would be a page of this origin, with every power the app has, so
anything a browser could run script in is served sandboxed: shown, never run.

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

#: Types that only ever display. Everything else (SVG, HTML, XML and whatever the
#: extension does not name) can carry script, and gets `SANDBOX`. PDF stays out
#: because a sandboxed page cannot load the browser's viewer, and a PDF's own
#: script already runs in that viewer's sandbox, not in this origin.
PASSIVE_PREFIXES = ("video/", "audio/")
PASSIVE_TYPES = frozenset({
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp",
    "image/tiff", "image/x-icon", "image/vnd.microsoft.icon", "image/heic", "image/heif",
    "application/pdf", "text/plain", "text/csv", "application/json",
})
SANDBOX = (
    "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; "
    "style-src 'unsafe-inline'"
)


def _security_headers(media_type: str) -> dict[str, str]:
    headers = {"x-content-type-options": "nosniff"}
    kind = media_type.split(";")[0].strip().lower()
    if kind not in PASSIVE_TYPES and not kind.startswith(PASSIVE_PREFIXES):
        headers["content-security-policy"] = SANDBOX
    return headers


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
    guard = _security_headers(response.media_type or "")
    response.headers.update(guard)
    etag = response.headers.get("etag", "")
    if etag and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"etag": etag, "cache-control": cache, **guard})
    return response
