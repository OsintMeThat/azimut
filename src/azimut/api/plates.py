"""REST API for analysis plates: the Graph or the Timeline, written out as a page.

A plate is what an analysis reading looks like once it has left the tab — the drawing
plus the lens, the question, the window, the clock and the legend it was read under.
It is drawn in the browser, because that is where the geometry lives: Konva serialises
no SVG and the Timeline is HTML, so both surfaces write their own SVG from the same
scene their screen rendering uses (`frontend/src/lib/plate.js`).

What is left for the backend is what a browser cannot do: write the file into the
folder the analyst chose for this kind of work (`engine/exportdir.py`), and open that
folder afterwards. A plate is a file, like a note's PDF — not a case artifact — so
nothing here touches the graph, the Trash or a bundle.

**The posted markup is bounded and inspected before it is written.** The app's own
generator emits no script, no event handler and no remote reference, so a body carrying
one is not ours; it is refused rather than filed. The file is never re-read or rendered
by Azimut, but it is written where the analyst opens documents, and an SVG a browser
opens is a document a browser executes.
"""

from __future__ import annotations

import base64
import binascii
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import layout
from ..engine import exportdir
from ..engine import reveal as reveal_engine
from .cases import get_case

router = APIRouter(prefix="/api/cases", tags=["plates"])

#: Which saved destination a plate goes to, and the case subdir it falls back to.
KIND = "views"
EXPORTS_DIR = "exports"

#: Bounds on one plate. A vector page of a few hundred nodes is tens of kilobytes; a
#: megabyte is already a case nobody can read on one page, and the raster of it is
#: capped in the browser at twice a 4000px edge.
MAX_SVG_CHARS = 8_000_000
MAX_PNG_BYTES = 24_000_000
#: JSON + base64 overhead above the payload limits. Enforced by the ASGI receive
#: wrapper in `server.py` before Pydantic materialises the request.
MAX_PLATE_BODY_BYTES = 34_000_000

#: Half of a surrogate pair, which JSON carries and UTF-8 cannot express.
#:
#: It reaches here when a label holding an emoji was cut mid-pair — the truncation that
#: did it is fixed in `lib/graph.js`, but the route has to hold anyway: one broken
#: character in one entity name must not be the reason a whole export fails, and a lone
#: surrogate stands for nothing that could be drawn.
_LONE_SURROGATE = re.compile(r"[\ud800-\udfff]")

#: What the app's own generator never writes, and what an SVG must not carry into a
#: folder where documents are opened: script, event handlers, embedded HTML, and any
#: reference that leaves the file.
_FORBIDDEN = (
    re.compile(r"<\s*script", re.IGNORECASE),
    re.compile(r"<\s*foreignObject", re.IGNORECASE),
    re.compile(r"<\s*(iframe|embed|object|use)\b", re.IGNORECASE),
    re.compile(r"\son[a-z]+\s*=", re.IGNORECASE),
    re.compile(r"javascript\s*:", re.IGNORECASE),
    re.compile(r"(?:xlink:)?href\s*=\s*[\"'](?!#)", re.IGNORECASE),
)


class PlateIn(BaseModel):
    """One serialised reading, and what to call it."""

    filename: str = Field(min_length=1, max_length=120)
    format: str = Field(default="svg", pattern="^(svg|png)$")
    svg: str = ""
    png: str = ""


def _clean_svg(markup: str) -> bytes:
    text = _LONE_SURROGATE.sub("", markup.strip())
    if not text:
        raise HTTPException(status_code=422, detail="the plate is empty")
    if len(text) > MAX_SVG_CHARS:
        raise HTTPException(status_code=413, detail="the plate is too large to write")
    if not text.startswith("<svg"):
        raise HTTPException(status_code=422, detail="that is not an SVG plate")
    for pattern in _FORBIDDEN:
        if pattern.search(text):
            raise HTTPException(
                status_code=422,
                detail="a plate carries no script, no embedded document and no remote reference",
            )
    return text.encode("utf-8")


def _clean_png(encoded: str) -> bytes:
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=422, detail="the plate image is invalid") from exc
    if not raw:
        raise HTTPException(status_code=422, detail="the plate is empty")
    if len(raw) > MAX_PNG_BYTES:
        raise HTTPException(status_code=413, detail="the plate is too large to write")
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=422, detail="the plate image is not a PNG")
    return raw


@router.post("/{case_id}/plates")
def write_plate(case_id: str, body: PlateIn) -> dict[str, Any]:
    """Write one plate into the folder saved for analysis views.

    Inside the case a re-export overwrites, the way a note's PDF does: that folder is
    refreshed in one click rather than accumulating copies. In a folder of the
    analyst's own nothing is ever overwritten, because the files there are theirs.
    """
    case = get_case(case_id)
    data = _clean_png(body.png) if body.format == "png" else _clean_svg(body.svg)
    stem = layout.slugify(body.filename, "plate")
    filename = f"{stem}.{body.format}"
    try:
        destination = exportdir.destination(KIND, case.path)
    except exportdir.ExportDirError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    in_case = destination == layout.subdir(case.path, EXPORTS_DIR)
    try:
        if in_case:
            path = destination / filename
            path.write_bytes(data)
        else:
            path = exportdir.write_out(data, destination, filename)
    except (OSError, exportdir.ExportDirError) as exc:
        raise HTTPException(status_code=409, detail=f"could not write the plate: {exc}") from exc
    return {"file": path.name, "path": str(destination)}


@router.post("/{case_id}/plates/reveal")
def reveal_plates(case_id: str) -> dict[str, str]:
    """Open the folder the plates were written to, in the system file manager.

    Takes no path: the case id and the saved destination are enough to find the folder,
    so nothing the browser sends can point somewhere else.
    """
    case = get_case(case_id)
    try:
        destination = exportdir.destination(KIND, case.path)
    except exportdir.ExportDirError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    try:
        reveal_engine.reveal(destination, workspace_only=False)
    except reveal_engine.RevealError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"status": "revealed", "path": str(destination)}
