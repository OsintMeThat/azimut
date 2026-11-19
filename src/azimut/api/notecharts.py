"""A chart of a note drawn on its own: the editor's chart card, and Export as a picture.

`POST /api/cases/{id}/notes/figure` takes a `::: chart` block's text (the block with its
fences, or its lines) and the note's look, and answers the chart as an SVG, or as a PNG
for one destination (`notes_charts.DESTINATIONS`: the PDF page, X at 16:9, 4:5 and 1:1).
A picture standing alone carries its title. Nothing is written.

`POST /api/cases/{id}/notes/figure/kinds` is the kind picker: a table (or a chart's block)
drawn small as every kind it fits, each with the settings it would be written with.

`GET /api/cases/{id}/notes/figure/sources` lists what a chart's rows may be copied from, each
note's tables and each sheet with the ``from:`` that names it (*Copy rows from…*), and `POST
/api/cases/{id}/notes/figure/rows` answers the rows a ``from:`` names as a table's Markdown,
what *Read again* writes when they came from another note or a sheet.

The look in the body wins; without one, the note named is read for its look and its
words (whether it calls its figures minimums), and the case for its named colours.
What the check would say of the block rides in the headers, each with its line in the
block, so the card shows it where it is drawn.
"""

from __future__ import annotations

import json
import re
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
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
    #: Whether the check reads ``from:`` against the case as saved. The editor says it
    #: itself for rows copied from the note it is in, against what is typed now.
    origins: bool = True


class KindsIn(BaseModel):
    """A table, or a chart block, to draw as every kind it fits, in the note's look."""

    text: str = Field(max_length=MAX_FIGURE_BYTES)
    look: NoteLook | None = None
    note: str = Field(default="", max_length=64, pattern=r"^([A-Za-z0-9_-]+)?$")


class RowsIn(BaseModel):
    """Where a chart's rows were copied from, as its ``from:`` line says it."""

    origin: str = Field(max_length=300)


def _note_and_look(case: Any, note: str, look: NoteLook | None, text: str) -> tuple[str, NoteLook | None]:
    """The note's words and its look, the look sent winning; 413 past the size read."""
    if len(text.encode("utf-8")) > MAX_FIGURE_BYTES:
        raise HTTPException(status_code=413, detail="the chart is too large to draw")
    if not note:
        return "", look
    found = notes_markdown.read_note(case, note)
    if found is None:
        raise HTTPException(status_code=404, detail=f"note '{note}' not found")
    return found[1], look if look is not None else notelook.effective(case, note)


@router.post("/cases/{case_id}/notes/figure")
def chart_figure(case_id: str, body: FigureIn) -> Response:
    """The chart a block draws, as SVG or as a PNG for one destination, its title drawn."""
    case = get_case(case_id)
    note_text, look = _note_and_look(case, body.note, body.look, body.text)
    chart = notecharts.read(case, notecharts.block_of(body.text), look=look, note_text=note_text, origins=body.origins)
    if not chart.drawable:
        raise HTTPException(status_code=422, detail="the chart holds no table: write its rows under its settings")
    warnings = chart.warnings[:MAX_WARNINGS]
    headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Chart-Title": _ascii_json(chart.title),
        "X-Chart-Proposed-Title": _ascii_json(chart.proposed),
        "X-Chart-Kind": _ascii_json(_kind_said(chart)),
        "X-Note-Warnings": _ascii_json([message[:MAX_WARNING_CHARS] for message, _, _ in warnings]),
        "X-Note-Warning-Lines": _ascii_json([line for _, _, line in warnings]),
        "X-Note-Warning-Kinds": _ascii_json([kind for _, kind, _ in warnings]),
        # the settings that fix each warning, written by the card's one press: [[key, value], ...]
        "X-Note-Warning-Fixes": _ascii_json([[list(pair) for pair in fix] for fix in chart.fixes[:MAX_WARNINGS]]),
        # each value's colour and where it came from, for the card's Keep these colours for the case
        "X-Chart-Colours": _ascii_json(_colours(chart)),
    }
    if body.format == "png":
        return Response(content=chart.picture(body.size), media_type="image/png", headers=headers)
    drawing = chart.drawn(title=True)
    return Response(content=notes_charts.svg(drawing, ident=_ident(chart.title)), media_type="image/svg+xml",
                    headers={**headers, "Content-Security-Policy": SVG_POLICY})


@router.post("/cases/{case_id}/notes/figure/kinds")
def chart_kinds(case_id: str, body: KindsIn) -> dict[str, Any]:
    """The kind picker: every kind the table fits, drawn small from its rows, with the
    settings and the title a chart of that kind is written with."""
    case = get_case(case_id)
    note_text, look = _note_and_look(case, body.note, body.look, body.text)
    lines = notecharts.block_of(body.text)
    kinds = notecharts.gallery(case, lines, look=look, note_text=note_text)
    if not kinds:
        raise HTTPException(status_code=422, detail="no table to draw: a chart is drawn from a table's rows")
    table = notes_charts.parse_block(lines).table
    return {"rows": len(table.rows) if table is not None else 0, "kinds": kinds}


@router.get("/cases/{case_id}/notes/figure/sources")
def chart_sources(case_id: str, note: str = Query(default="", max_length=64, pattern=r"^([A-Za-z0-9_-]+)?$")
                  ) -> dict[str, Any]:
    """Every table of the case's notes but ``note``'s, and every sheet, a chart's rows may be
    copied from; nothing is written."""
    return notecharts.table_sources(get_case(case_id), besides=note)


@router.post("/cases/{case_id}/notes/figure/rows")
def chart_rows(case_id: str, body: RowsIn) -> dict[str, Any]:
    """The rows a chart's ``from:`` names, as a table's Markdown, and the name of where they
    are; ``found`` false once it is no longer in the case. Nothing is written."""
    case = get_case(case_id)
    if not notecharts.origin_known(body.origin):
        raise HTTPException(status_code=422, detail="from: names a note's table or a sheet")
    found = notecharts.origin_table(case, body.origin)
    if found is None:
        return {"found": False, "name": "", "text": ""}
    name, text = found
    return {"found": True, "name": name, "text": text}


def _kind_said(chart: notecharts.Chart) -> dict[str, Any]:
    """The kind a chart is drawn as, and what of it the editor's card asks: whether it
    counts, draws parts or stacks, which kind it turns into, the look it takes, and for a
    kind of glyphs the values each given its own."""
    kind = notes_charts.effective_kind(chart.block)
    if kind is None:
        return {}
    return {"name": kind.name, "label": kind.label, "counts": kind.counts, "parts": kind.parts,
            "stacked": kind.stacked, "up": kind.up, "turns": kind.turns,
            "style": notecharts.theme_of(chart.look, chart.block).name,
            # what the card's Icon and Flag rows read: the settings this kind takes, and the
            # values a glyph each is given for
            "keys": list(kind.keys), **({"values": chart.values} if chart.values else {})}


#: How many of a chart's colours ride in the header.
MAX_COLOURS = 24


def _colours(chart: notecharts.Chart) -> list[dict[str, str]]:
    """Each value a chart's legend names, its colour and where the colour came from."""
    return [{"value": swatch.value[:MAX_WARNING_CHARS], "colour": swatch.paint.colour, "origin": swatch.paint.origin}
            for swatch in chart.layout.legend[:MAX_COLOURS] if swatch.value.strip()]


def _ident(title: str) -> str:
    """The SVG's own id, from its title: a designer's file reads better named."""
    words = re.sub(r"[^A-Za-z0-9]+", "-", title.casefold()).strip("-")[:40].strip("-")
    return f"chart-{words}" if words else "chart"


def _ascii_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))
