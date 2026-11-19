"""An infographic of a note drawn on its own: the builder's page, and Export as a picture.

`POST /api/cases/{id}/notes/infographic` takes a `:::: infographic` block's text (with its
fences, or its lines) and the note's look, and answers the page drawn (`engine/
notes_infographic.py`):

- ``json`` (the builder): the page as SVG, where each panel stands on it, the shared
  legend and its colours, the sources line and what the check says, each at its line;
- ``svg``: the page as one SVG file, for a designer;
- ``png``: one picture for a destination, the PDF page or X at 16:9, 4:5 or 1:1.

Nothing is written. What "Add a panel" and `/` › Infographic's starter offer is the chart's
own kind picker (`POST /notes/figure/kinds`, `api/notecharts.py`) on each table of the note.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..engine import notelook, notes_infographic, notes_markdown
from ..engine.notelook import NoteLook
from .cases import get_case

router = APIRouter(prefix="/api", tags=["notes"])

#: The longest block the route reads, in bytes: a dozen charts at their most, with room.
MAX_BYTES = notes_infographic.MAX_BODY
#: What an SVG answered from this origin may do when opened on its own: nothing.
SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"


class InfographicIn(BaseModel):
    """An infographic block, the look it is drawn in, and what is wanted of it."""

    text: str = Field(max_length=MAX_BYTES)
    look: NoteLook | None = None
    note: str = Field(default="", max_length=64, pattern=r"^([A-Za-z0-9_-]+)?$")
    format: Literal["json", "svg", "png"] = "json"
    size: Literal["page", "x", "portrait", "square"] = "page"


def _note_and_look(case: Any, note: str, look: NoteLook | None) -> tuple[str, NoteLook | None]:
    """The note's words and its look, the look sent winning."""
    if not note:
        return "", look
    found = notes_markdown.read_note(case, note)
    if found is None:
        raise HTTPException(status_code=404, detail=f"note '{note}' not found")
    return found[1], look if look is not None else notelook.effective(case, note)


@router.post("/cases/{case_id}/notes/infographic", response_model=None)
def infographic(case_id: str, body: InfographicIn) -> Response | dict[str, Any]:
    """The page a block draws: for the builder, as one SVG file, or as one picture."""
    case = get_case(case_id)
    note_text, look = _note_and_look(case, body.note, body.look)
    lines = notes_infographic.block_of(body.text)
    page = notes_infographic.read(case, lines, look=look, note_text=note_text, light=body.format == "json")
    if not page.panels:
        raise HTTPException(status_code=422, detail="the infographic holds no panel: put a chart, a map or words in it")
    headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    ident = _ident(page.title)
    if body.format == "png":
        return Response(content=notes_infographic.picture(page, body.size), media_type="image/png", headers=headers)
    if body.format == "svg":
        return Response(content=notes_infographic.svg(page, ident=ident), media_type="image/svg+xml",
                        headers={**headers, "Content-Security-Policy": SVG_POLICY})
    drawing = notes_infographic.compose(page)
    return {
        "svg": notes_infographic.svg(page, ident=ident),
        "width": drawing.width,
        "height": drawing.height,
        "title": page.title,
        "look": page.theme.name,
        "panels": [
            {**box, "kind": drawn.panel.kind, "width": drawn.panel.width, "title": drawn.title,
             "chart": (drawn.chart.kind if drawn.chart is not None else "")}
            for box, drawn in zip(notes_infographic.boxes(page), page.panels)
        ],
        "legend": {
            "column": page.shared,
            "values": [{"value": swatch.value, "colour": swatch.paint.colour, "hatch": bool(swatch.paint.hatch),
                        "outline": swatch.paint.outline, "origin": swatch.paint.origin} for swatch in page.legend],
        },
        "credit": page.credit,
        "alt": page.alt,
        "warnings": [{"message": message, "kind": kind, "line": line} for message, kind, line in page.warnings],
    }


def _ident(title: str) -> str:
    """The SVG's own id, from its title: a designer's file reads better named."""
    words = re.sub(r"[^A-Za-z0-9]+", "-", title.casefold()).strip("-")[:40].strip("-")
    return f"infographic-{words}" if words else "infographic"
