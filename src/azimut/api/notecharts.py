"""A chart of a note drawn on its own: the editor's chart card, and Export as a picture.

`POST /api/cases/{id}/notes/figure` takes a `::: chart` block's text (the block with its
fences, or its lines) and the note's look, and answers the chart as an SVG, or as a PNG
for one destination (`notes_charts.DESTINATIONS`: the PDF page, X at 16:9, 4:5 and 1:1).
A picture standing alone carries its title. Nothing is written.

The look in the body wins; without one, the note named is read for its look and its
words (whether it calls its figures minimums), and the case for its named colours.
What the check would say of the block rides in the headers, each with its line in the
block, so the card shows it where it is drawn.
"""

from __future__ import annotations

import json
import re
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..engine import notecharts, notelook, notes_charts, notes_markdown
from ..engine.notelook import NoteLook
from .cases import get_case

router = APIRouter(prefix="/api", tags=["notes"])

#: The longest block the route reads, in bytes: a chart's rows at their most, with room.
MAX_FIGURE_BYTES = 256 * 1024
#: How many warnings, and how long each, ride in the headers.
MAX_WARNINGS = 20
MAX_WARNING_CHARS = 300
#: What an SVG answered from this origin may do when opened on its own: nothing.
SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'"


class FigureIn(BaseModel):
    """A chart block, the look it is drawn in, and what is wanted of it."""

    text: str = Field(max_length=MAX_FIGURE_BYTES)
    look: NoteLook | None = None
    note: str = Field(default="", max_length=64, pattern=r"^([A-Za-z0-9_-]+)?$")
    format: Literal["svg", "png"] = "svg"
    size: Literal["page", "x", "portrait", "square"] = "page"


@router.post("/cases/{case_id}/notes/figure")
def chart_figure(case_id: str, body: FigureIn) -> Response:
    """The chart a block draws, as SVG or as a PNG for one destination, its title drawn."""
    case = get_case(case_id)
    if len(body.text.encode("utf-8")) > MAX_FIGURE_BYTES:
        raise HTTPException(status_code=413, detail="the chart is too large to draw")
    look = body.look
    note_text = ""
    if body.note:
        found = notes_markdown.read_note(case, body.note)
        if found is None:
            raise HTTPException(status_code=404, detail=f"note '{body.note}' not found")
        note_text = found[1]
        if look is None:
            look = notelook.effective(case, body.note)
    chart = notecharts.read(case, notecharts.block_of(body.text), look=look, note_text=note_text)
    if not chart.drawable:
        raise HTTPException(status_code=422, detail="the chart holds no table: write its rows under its settings")
    warnings = chart.warnings[:MAX_WARNINGS]
    headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Chart-Title": _ascii_json(chart.title),
        "X-Note-Warnings": _ascii_json([message[:MAX_WARNING_CHARS] for message, _, _ in warnings]),
        "X-Note-Warning-Lines": _ascii_json([line for _, _, line in warnings]),
        "X-Note-Warning-Kinds": _ascii_json([kind for _, kind, _ in warnings]),
    }
    if body.format == "png":
        return Response(content=chart.picture(body.size), media_type="image/png", headers=headers)
    drawing = chart.drawn(title=True)
    return Response(content=notes_charts.svg(drawing, ident=_ident(chart.title)), media_type="image/svg+xml",
                    headers={**headers, "Content-Security-Policy": SVG_POLICY})


def _ident(title: str) -> str:
    """The SVG's own id, from its title: a designer's file reads better named."""
    words = re.sub(r"[^A-Za-z0-9]+", "-", title.casefold()).strip("-")[:40].strip("-")
    return f"chart-{words}" if words else "chart"


def _ascii_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))
