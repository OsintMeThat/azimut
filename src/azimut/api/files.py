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

A video or a sound goes to its player a piece at a time (`PLAYER_PIECE`), so a
paused player never keeps one of the browser's few connections to the app.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
from starlette.datastructures import Headers
from starlette.types import Receive, Scope, Send

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


#: The most one answer to a player carries. A video or audio element asks from
#: where it reads to the end of the file, keeps what it wants to buffer and then
#: stops reading, and the browser holds that connection for it. A browser keeps
#: six connections to one host, so a few paused players (Inspect's, a reference
#: window's, a proof's scene) left every other call of the app waiting for a free
#: one. An answer this short lands whole in the browser's own buffer and the
#: connection goes back to the pool; the player asks again for the next piece.
#: Measured in Chrome: 2 MB still frees the connection, 8 MB holds it.
PLAYER_PIECE = 1024 * 1024

_ONE_RANGE = re.compile(r"bytes=(\d+)-(\d*)")


def player_range(asked: str | None, size: int) -> str | None:
    """The ``Range`` a player's ask for the rest of the file is answered with, one
    piece long, or None to answer what was asked. The rest is ``bytes=N-``, or a range
    that runs to the last byte: Chrome asks the first way, then, knowing the size, the
    second. A range that stops short of the end, several ranges or a suffix are served
    as they come."""
    found = _ONE_RANGE.fullmatch((asked or "").replace(" ", ""))
    if found is None:
        return None
    start = int(found.group(1))
    if found.group(2) and int(found.group(2)) < size - 1:
        return None
    if size - start <= PLAYER_PIECE:
        return None
    return f"bytes={start}-{start + PLAYER_PIECE - 1}"


class _CaseFileResponse(FileResponse):
    """A case file, a video or a sound answered a piece at a time (`player_range`)."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        kind = (self.media_type or "").split(";")[0].strip().lower()
        if scope["type"] == "http" and self.stat_result is not None and kind.startswith(PASSIVE_PREFIXES):
            shorter = player_range(Headers(scope=scope).get("range"), self.stat_result.st_size)
            if shorter is not None:
                headers = [(key, value) for key, value in scope["headers"] if key != b"range"]
                scope = {**scope, "headers": [*headers, (b"range", shorter.encode("latin-1"))]}
        await super().__call__(scope, receive, send)


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
    response = _CaseFileResponse(path, stat_result=path.stat())
    response.headers["cache-control"] = cache
    guard = _security_headers(response.media_type or "")
    response.headers.update(guard)
    etag = response.headers.get("etag", "")
    if etag and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"etag": etag, "cache-control": cache, **guard})
    return response
