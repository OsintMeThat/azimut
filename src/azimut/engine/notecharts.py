"""A note's charts in the documents made from it, read one way for all of them.

`engine/notes_charts.py` reads a `::: chart` block and draws it. This module is what
the PDF, the HTML report and its web folder, the WordPress draft, To Post and the
figure route share around that, so none of them reads a chart its own way:

- **the look** (`theme_of`): the note's Look picks the preset (`notes_charts.preset_for`)
  and the face, a block's own ``style`` line wins, and a dark stage (the Story layout's)
  draws it dark;
- **the colours**: the case's named colours (`notes_charts.case_palette`), so a value is
  one colour in every chart, layer and plate of the case;
- **what the check says** (`Chart.warnings`): the engine's checks at their lines, and
  whether the rows still match where they were copied from (``from:``, `origin_rows`);
- **its pictures** (`png`, `svg`), and the one filed in the case for Post (`file_for_post`);
- **the case's pictures a picture wall shows** (`case_pictures`): each read from the case's
  own files, its thumbnail first, and credited as its media say, never fetched.

**In a document the title is the figure's caption.** A PDF, an HTML page and a
WordPress draft caption a chart as they caption every figure (``Figure 3.`` and its
title, under it), so the chart is drawn without its title there (`IN_DOCUMENT`). A
picture that stands alone (a post, an exported picture) carries its title.

**Where the rows came from.** ``from:`` names what the rows were copied from, written by
the Notebook's *Copy rows from…*: ``note:<id>`` (the note's first table) or
``note:<id>#<heading>`` (the first table under that heading, named as its anchor),
``note:<id>#<heading>/<n>`` (its n-th table; ``#/<n>`` counts from the note's start, for
a table under no heading), and ``sheet:<id>``. A chart's own rows are never a table there. The rows in the note are the chart; this only says when the source moved
on: the source's rows, kept to the chart's own columns, are compared with the chart's,
in any order. Anything else written there is not read.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any, Callable

from . import notelook, notes_chart_kinds, notes_chart_picker, notes_charts
from .notelook import DEFAULT as DEFAULT_LOOK
from .notelook import NoteLook
from .notes_charts import ChartBlock, ChartTheme, Layout

if TYPE_CHECKING:
    from ..workspace import Case

#: The width a document lays a chart out at, in CSS pixels: the PDF's frame and the
#: HTML page's text column. The page destination's own (`notes_charts.DESTINATIONS`).
DOCUMENT_WIDTH = notes_charts.DESTINATIONS["page"].design
#: The width a phone reads a chart at in the HTML page.
PHONE_WIDTH = 360.0
#: A web page's picture (WordPress) is the document's chart at twice its pixels.
WEB_PIXELS = 2
#: Whether a document's caption carries the title, the chart then drawn without it.
IN_DOCUMENT = True
#: Where To Post's picture goes, and the producer named on what it files.
POST_DESTINATION = "x"
PRODUCER = "notebook"
SOURCE_TYPE = "note-chart"
#: What a figure says in place of a chart that holds no table.
NO_TABLE = "Chart not drawn: it holds no table."
#: What a chart's numbers are called where they are folded under it.
THE_NUMBERS = "The numbers"
#: The longest alt text a picture of a chart carries, in characters.
MAX_ALT = 1000

SLUG = re.compile(r"[^\w]+")
CHART_OPEN = re.compile(r"^:::[ \t]*chart[ \t]*$")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")


def theme_of(look: NoteLook | None, block: ChartBlock, *, dark: bool = False) -> ChartTheme:
    """The look a chart takes in a note: its own ``style`` line, else the one the note's
    Look asks for, in the Look's face; ``dark`` on a dark stage."""
    look = look or DEFAULT_LOOK
    name = "dark" if dark else (block.style or notes_charts.preset_for(look.style))
    return notes_charts.theme_for(name, font=look.font)


def palette(case: "Case | None") -> list[dict[str, str]]:
    """The case's named colours, or none outside a case."""
    return notes_charts.case_palette(case) if case is not None else []


def case_pictures(case: "Case | None") -> notes_charts.PictureLookup | None:
    """Finds a picture of the case by the id a cell names (a picture wall's): a media, a
    capture or a proof, read from its own file with its thumbnail first (a video by its
    still), and its credit as a picture's credit line says it. Each id is read once.
    None outside a case."""
    if case is None:
        return None
    from . import notesources

    reader = notesources.Reader(case)
    found: dict[str, notes_charts.Frame | None] = {}

    def look(ref: str) -> notes_charts.Frame | None:
        if ref not in found:
            found[ref] = _frame(case, reader, ref)
        return found[ref]

    return look


def _frame(case: "Case", reader: Any, ref: str) -> notes_charts.Frame | None:
    from . import thumbnails
    from .links import EMBEDDED_TYPES

    if not re.match(r"^[A-Za-z0-9_-]{1,64}$", ref or ""):
        return None
    record = case.get_entity(ref)
    attrs = (record or {}).get("attrs") or {}
    if record is None or record.get("type") not in EMBEDDED_TYPES or not attrs.get("path"):
        return None
    sha = str(attrs.get("sha256") or "")
    video = attrs.get("kind") == "video"
    named: list[str] = []
    if record.get("type") == "proof" and attrs.get("thumb"):
        named.append(str(attrs["thumb"]))
    still = thumbnails.thumb_relpath(sha, "video" if video else "image") if sha else None
    if still:
        named.append(still)
    if not video:
        named.append(str(attrs["path"]))
    files: list[Path] = []
    for relative in named:
        try:
            files.append(case.resolve_inside(relative))
        except Exception:  # a path that leaves the case is no picture of it
            continue
    if not files:
        return None
    try:
        source = reader.entity(ref)
        credit = source.credit() if source is not None else None
    except Exception:  # a case whose index cannot say leaves the picture uncredited
        credit = None
    return notes_charts.Frame(ref, str(record.get("label") or ""), tuple(files),
                              credit.value if credit is not None else "")


@dataclass
class Chart:
    """One `::: chart` block as a document reads it: the block, its look and colours,
    what the check says, and its layout at the document's width (drawn without its
    title when a caption carries it)."""

    block: ChartBlock
    look: NoteLook
    palette: list[dict[str, str]]
    note_text: str
    layout: Layout
    #: The title shown: as written, or proposed from the data.
    title: str
    #: What the check before export says, as ``(message, kind, line in the block)``.
    warnings: list[tuple[str, str, int | None]] = field(default_factory=list)
    #: For each warning, the settings that fix it (`notes_charts.Check.fix`), or none.
    fixes: list[tuple[tuple[str, str], ...]] = field(default_factory=list)
    #: The title the data proposes for these settings, whatever title is written: what the
    #: chart's card offers when the written one says something else.
    proposed: str = ""
    #: The values a kind of glyphs gives each its own glyph (`notes_chart_kinds.glyph_values`),
    #: listed by the card's Icon and Flag rows.
    values: list[str] = field(default_factory=list)
    #: Finds the case's pictures a picture wall shows (`case_pictures`).
    pictures: notes_charts.PictureLookup | None = None

    @property
    def drawable(self) -> bool:
        return self.block.table is not None and bool(self.block.table.headers)

    @property
    def alt(self) -> str:
        """The picture's alt text, on one line: its title, then each bar and its parts."""
        head = self.title or self.layout.desc
        lines = "; ".join(self.layout.lines)
        return _cut(f"{head.rstrip('.')}. {lines}." if lines else head, MAX_ALT)

    def drawn(self, width: float = DOCUMENT_WIDTH, *, dark: bool = False, title: bool = not IN_DOCUMENT,
              room: float | None = None, still: bool = False) -> Layout:
        """The chart laid out again: another width, the dark look, with its title, within
        ``room`` (a page) for a kind that lays itself smaller to fit, ``still`` for a
        picture nothing hovers over (`notes_charts.Box.still`)."""
        theme = theme_of(self.look, self.block, dark=dark)
        return notes_charts.layout(self.block, theme=theme, palette=self.palette, note_text=self.note_text,
                                   width=width, title=title, pictures=self.pictures, room=room, still=still)

    def png(self, width_px: int, *, dpi: int | None = None, room: float | None = None) -> bytes:
        """The document's drawing painted ``width_px`` pixels wide, as a picture nothing hovers
        over: laid again when the page's drawing cut words it shows whole on hover (a
        timeline's short labels), or when it is taller than ``room`` (a page's height, in the
        document's CSS pixels), to stand within it."""
        hovers = bool(self.layout.facts.get("short"))
        if hovers or (room is not None and self.layout.height > room):
            drawing = self.drawn(room=room, still=True)
        else:
            drawing = self.layout
        return notes_charts.render_png(drawing, width_px, dpi=dpi)

    def picture(self, destination: str) -> bytes:
        """A picture standing alone for one of `notes_charts.DESTINATIONS`, its title drawn."""
        return notes_charts.render(self.block, destination, theme=theme_of(self.look, self.block),
                                   palette=self.palette, note_text=self.note_text, title=True,
                                   pictures=self.pictures)


def read(case: "Case | None", body: str, *, look: NoteLook | None = None, note_text: str = "",
         origins: bool = True) -> Chart:
    """A `::: chart` block's lines as a document reads them. ``note_text`` is the note
    around it, for whether it calls its figures minimums; ``origins`` checks ``from:``."""
    look = look or DEFAULT_LOOK
    block = notes_charts.parse_block(body)
    colours = palette(case)
    pictures = case_pictures(case)
    drawing = notes_charts.layout(block, theme=theme_of(look, block), palette=colours, note_text=note_text,
                                  width=DOCUMENT_WIDTH, title=not IN_DOCUMENT, pictures=pictures)
    chart = Chart(block, look, colours, note_text, drawing, drawing.title, pictures=pictures)
    chart.warnings = [check.as_warning() for check in drawing.checks]
    chart.fixes = [check.fix for check in drawing.checks]
    if block.table is not None and block.table.headers:
        reading = notes_charts.read(block, theme=theme_of(look, block), palette=colours, note_text=note_text,
                                    pictures=pictures)
        chart.proposed = notes_chart_picker.title_for(reading)
        if notes_chart_kinds.ICONS in reading.kind.keys or notes_chart_kinds.FLAGS in reading.kind.keys:
            chart.values = notes_chart_kinds.glyph_values(reading)[:notes_charts.MAX_BARS]
    if origins and case is not None and block.origin:
        said = origin_warning(case, block)
        if said is not None:
            chart.warnings.append(said)
            chart.fixes.append(())
    return chart


def block_of(text: str) -> str:
    """A chart's lines from what the editor sends: the whole block with its fences, or
    its lines alone."""
    lines = str(text or "").strip("\n").split("\n")
    if lines and re.match(r"^:::[ \t]*chart[ \t]*$", lines[0]):
        lines = lines[1:]
        if lines and re.match(r"^:::[ \t]*$", lines[-1]):
            lines = lines[:-1]
    return "\n".join(lines)


# -- the kind picker ---------------------------------------------------------------------------------


def gallery(case: "Case | None", body: str, *, look: NoteLook | None = None, note_text: str = "") -> list[dict[str, Any]]:
    """Every kind a block's table fits, each drawn small from its rows with the settings
    it would be written with (`notes_chart_picker`), and the title a new chart of it
    would carry: what pressing Chart on a table shows. ``body`` is a block's lines, or a
    table alone."""
    look = look or DEFAULT_LOOK
    block = notes_charts.parse_block(body)
    colours = palette(case)
    pictures = case_pictures(case)
    shown: list[dict[str, Any]] = []
    for index, proposal in enumerate(notes_chart_picker.proposals(block)):
        drawn = notes_chart_picker.applied(block, proposal.settings)
        theme = theme_of(look, drawn)
        reading = notes_charts.read(drawn, theme=theme, palette=colours, note_text=note_text, pictures=pictures)
        drawing = notes_charts.layout(drawn, theme=theme, palette=colours, note_text=note_text,
                                      width=notes_chart_picker.THUMB_WIDTH, title=False, pictures=pictures)
        shown.append({"kind": proposal.kind, "label": proposal.label, "settings": proposal.settings,
                      "title": notes_chart_picker.title_for(reading),
                      "svg": notes_charts.svg(drawing, ident=f"az-pick-{index}")})
    return shown


# -- where the rows came from ------------------------------------------------------------------


#: A source's rows as `origin_rows` answers them: ``(its name, headers, rows)``.
Rows = tuple[str, list[str], list[list[str]]]


def origin_rows(case: "Case", origin: str) -> Rows | None:
    """What ``from:`` names, as ``(its name, headers, rows)``, each cell as a reader sees
    it; None when it is no longer in the case or names nothing this reads."""
    kind, _, rest = origin.strip().partition(":")
    kind = kind.strip().casefold()
    if kind == "note":
        from . import notes_markdown

        ident, _, anchor = rest.strip().partition("#")
        found = notes_markdown.read_note(case, ident.strip()) if ident.strip() else None
        if found is None:
            return None
        table = _table_under(found[1], anchor.strip())
        if table is None:
            return None
        return found[0], table.headers, table.rows
    if kind == "sheet":
        from . import sheets

        try:
            sheet = sheets.read(case, rest.strip())
        except Exception:  # a sheet gone, or a record that is no sheet
            return None
        headers = [notes_charts.plain_cell(str(cell)) for cell in sheet.get("columns") or []]
        rows = [[notes_charts.plain_cell(str(cell)) for cell in row] for row in sheet.get("rows") or []]
        return str(sheet.get("title") or "Sheet"), headers, rows
    return None


def origin_table(case: "Case", origin: str) -> tuple[str, str] | None:
    """What ``from:`` names, as ``(its name, the table's Markdown)``: a note's table as it is
    written there, chips and links kept, or a sheet's rows written as a table, its row keys
    left out. What *Read again* writes into a chart whose rows came from elsewhere. None when
    it is no longer in the case or names nothing this reads."""
    kind, _, rest = origin.strip().partition(":")
    kind = kind.strip().casefold()
    if kind == "note":
        from . import notes_markdown

        ident, _, anchor = rest.strip().partition("#")
        found = notes_markdown.read_note(case, ident.strip()) if ident.strip() else None
        table = _table_under(found[1], anchor.strip()) if found is not None else None
        return (found[0], table.text()) if found is not None and table is not None else None
    if kind == "sheet":
        from . import sheets

        try:
            sheet = sheets.read(case, rest.strip())
        except Exception:  # a sheet gone, or a record that is no sheet
            return None
        columns = [str(cell) for cell in sheet.get("columns") or []]
        kept = [index for index, name in enumerate(columns) if name.strip().casefold() != sheets.ID_COLUMN]
        if not kept:
            return None
        rows = [[str(row[index]) if index < len(row) else "" for index in kept] for row in sheet.get("rows") or []]
        return (str(sheet.get("title") or "Sheet"),
                notes_charts.table_text([columns[index] for index in kept], rows[:notes_charts.MAX_ROWS]))
    return None


def note_tables(text: str) -> list[tuple[str, str, notes_charts.Table]]:
    """A note's tables as ``from:`` names them, in order: ``(anchor, the words of the heading
    above, the table)``. A chart's own rows and code are never one; the anchor is the one the
    editor writes (``editor/chartText.js``'s ``anchorFor``)."""
    lines = str(text or "").split("\n")
    heads = [(index, len(heading.group(1)), slug(heading.group(2)), notes_charts.plain_cell(heading.group(2)))
             for index, heading in _headings(lines)]
    spans: list[tuple[int, int]] = []
    fenced = charted = False
    index = 0
    while index < len(lines):
        line = lines[index]
        if re.match(r"^\s*(```|~~~)", line):
            fenced = not fenced
        elif not fenced and CHART_OPEN.match(line):
            charted = True
        elif charted and re.match(r"^:::[ \t]*$", line):
            charted = False
        elif not fenced and not charted and line.strip().startswith("|"):
            end = index
            while end + 1 < len(lines) and lines[end + 1].strip().startswith("|"):
                end += 1
            if end > index and notes_charts.TABLE_RULE.match(lines[index + 1].strip()):
                spans.append((index, end))
            index = end + 1
            continue
        index += 1

    def stretch(name: str) -> tuple[int, int] | None:
        if not name:
            return 0, len(lines)
        at = next((position for position, head in enumerate(heads) if head[2] == name), None)
        if at is None:
            return None
        end = next((head[0] for head in heads[at + 1:] if head[1] <= heads[at][1]), len(lines))
        return heads[at][0] + 1, end

    out: list[tuple[str, str, notes_charts.Table]] = []
    for start, end in spans:
        above = [head for head in heads if head[0] < start]
        anchor = ""
        for name in ([above[-1][2], ""] if above else [""]):
            within = stretch(name)
            if within is None:
                continue
            here = [span[0] for span in spans if within[0] <= span[0] < within[1]]
            if start not in here:
                continue
            nth = here.index(start)
            anchor = (name if nth == 0 else f"{name}/{nth + 1}") if name else ("" if nth == 0 else f"/{nth + 1}")
            break
        table = notes_charts.parse_block("\n".join(lines[start:end + 1])).table
        if table is not None and table.headers:
            out.append((anchor, above[-1][3] if above else "", table))
    return out


#: How many notes *Copy rows from…* reads, and how many tables and sheets it lists.
MAX_SOURCE_NOTES = 200
MAX_SOURCES = 150


def table_sources(case: "Case", *, besides: str = "") -> dict[str, list[dict[str, Any]]]:
    """What a chart's rows may be copied from (*Copy rows from…*): each note's tables but
    ``besides``'s (the note the chart goes in, whose tables its own picker offers), and each
    sheet, each with the ``from:`` that names it, its rows and its columns."""
    from . import notes_markdown, sheets

    tables: list[dict[str, Any]] = []
    notes = [(notelook.CASE_NOTE, "Case notes")]
    cursor: str | None = None
    while len(notes) < MAX_SOURCE_NOTES:
        page = case.page_entities(types=["note"], limit=200, cursor=cursor)
        notes.extend((str(entity["id"]), str(entity.get("label") or "Note")) for entity in page["items"])
        cursor = page.get("next_cursor")
        if not cursor:
            break
    for ident, title in notes[:MAX_SOURCE_NOTES]:
        if ident == besides or len(tables) >= MAX_SOURCES:
            continue
        found = notes_markdown.read_note(case, ident)
        if found is None:
            continue
        for anchor, heading, table in note_tables(found[1]):
            tables.append({"origin": f"note:{ident}" + (f"#{anchor}" if anchor else ""), "note": title,
                           "heading": heading, "rows": len(table.rows), "columns": table.headers[:8]})
    listed: list[dict[str, Any]] = []
    for entity in case.list_entities():
        if entity.get("type") != "sheet" or len(listed) >= MAX_SOURCES:
            continue
        summary = sheets.summary(case, entity)
        columns = [str(name) for name in summary.get("headings") or [] if str(name).strip().casefold() != sheets.ID_COLUMN]
        listed.append({"origin": f"sheet:{entity['id']}", "title": str(entity.get("label") or "Sheet"),
                       "rows": int(summary.get("rows") or 0), "columns": columns[:8]})
    return {"tables": tables[:MAX_SOURCES], "sheets": listed}


def origin_known(origin: str) -> bool:
    """Whether ``from:`` names something `origin_rows` reads."""
    return origin.strip().partition(":")[0].strip().casefold() in ("note", "sheet")


def origin_warning(case: "Case", block: ChartBlock, *, read: Callable[["Case", str], Rows | None] | None = None
                   ) -> tuple[str, str, int | None] | None:
    """What the check says of ``from:``: the source gone, or its rows moved on. ``read``
    answers a source's rows (`origin_rows` by default; an infographic reads each once)."""
    if not origin_known(block.origin) or block.table is None:
        return None
    said = f'The chart "{_cut(block.title, 60)}"' if block.title else "A chart"
    line = block.where.get("from")
    found = (read or origin_rows)(case, block.origin)
    if found is None:
        return (f"{said}: its rows were copied from something no longer in the case, so they cannot be "
                f"read again.", notes_charts.MISSING, line)
    name, headers, rows = found
    state = compare_rows(block.table, headers, rows)
    if state == COLUMNS_GONE:
        return (f'{said}: "{_cut(name, 40)}", where its rows were copied from, no longer has its columns.',
                notes_charts.OTHER_KIND, line)
    if state == SAME:
        return None
    return (f'{said}: its rows differ from "{_cut(name, 40)}", where they were copied from. Read them again '
            f"to bring them up to date.", STALE_KIND, line)


#: The check's kind for rows that moved on, which Read again brings up to date
#: (`notes_markdown.STALE`, written out here as `notes_charts` writes its own kinds).
STALE_KIND = "stale"
#: What `compare_rows` says of a chart's rows against where they came from.
SAME = "same"
DIFFERS = "differs"
COLUMNS_GONE = "columns"


def compare_rows(table: notes_charts.Table, headers: list[str], rows: list[list[str]]) -> str:
    """Whether a chart's rows are those of a source's ``headers`` and ``rows``, kept to the
    chart's own columns and in any order: `SAME`, `DIFFERS`, or `COLUMNS_GONE` when the
    source has none of the chart's columns. The editor's ``compareRows`` reads them alike."""
    wanted = [header.casefold() for header in table.headers]
    columns = {header.casefold(): index for index, header in enumerate(headers)}
    shared = [(position, columns[header]) for position, header in enumerate(wanted) if header in columns]
    if not shared:
        return COLUMNS_GONE
    mine = Counter(tuple(row[position] if position < len(row) else "" for position, _ in shared) for row in table.rows)
    theirs = Counter(tuple(row[index] if index < len(row) else "" for _, index in shared) for row in rows)
    return SAME if mine == theirs else DIFFERS


def chart_bodies(text: str) -> list[str]:
    """The lines of every `::: chart` block a note's text holds outside code fences, an
    infographic's panels included (they keep a chart's own fences)."""
    bodies: list[str] = []
    lines = str(text or "").split("\n")
    fenced = False
    index = 0
    while index < len(lines):
        line = lines[index]
        if re.match(r"^\s*(```|~~~)", line):
            fenced = not fenced
        elif not fenced and CHART_OPEN.match(line):
            end = index + 1
            while end < len(lines) and not re.match(r"^:::[ \t]*$", lines[end]):
                end += 1
            bodies.append("\n".join(lines[index + 1:end]))
            index = end
        index += 1
    return bodies


def _table_under(text: str, anchor: str) -> notes_charts.Table | None:
    """The table ``anchor`` names in a note: the first, or the first under the heading
    named ``anchor``, or the n-th with ``/<n>`` after it. A chart's own rows are not one."""
    lines = str(text or "").split("\n")
    start = 0
    anchor, _, nth = anchor.partition("/")
    wanted_index = int(nth) if nth.strip().isdigit() and int(nth) > 0 else 1
    if anchor:
        wanted = slug(anchor)
        found = [(index, len(heading.group(1)), slug(heading.group(2))) for index, heading in _headings(lines)]
        at = next((position for position, (_, _, name) in enumerate(found) if name == wanted), None)
        if at is None:
            return None
        start, level = found[at][0] + 1, found[at][1]
        end = next((index for index, depth, _ in found[at + 1:] if depth <= level), len(lines))
        lines = lines[:end]
    fenced = charted = False
    seen = 0
    index = start
    while index < len(lines):
        line = lines[index]
        if re.match(r"^\s*(```|~~~)", line):
            fenced = not fenced
        elif not fenced and CHART_OPEN.match(line):
            charted = True
        elif charted and re.match(r"^:::[ \t]*$", line):
            charted = False
        elif not fenced and not charted and line.strip().startswith("|"):
            end = index
            while end < len(lines) and lines[end].strip().startswith("|"):
                end += 1
            table = notes_charts.parse_block("\n".join(lines[index:end])).table
            if table is not None and table.ruled:
                seen += 1
                if seen == wanted_index:
                    return table
            index = end
            continue
        index += 1
    return None


def _headings(lines: list[str]) -> list[tuple[int, re.Match[str]]]:
    """A note's headings with their lines, outside code."""
    found: list[tuple[int, re.Match[str]]] = []
    fenced = False
    for index, line in enumerate(lines):
        if re.match(r"^\s*(```|~~~)", line):
            fenced = not fenced
        elif not fenced and (heading := HEADING.match(line)):
            found.append((index, heading))
    return found


def slug(words: str) -> str:
    """A heading's anchor, as the HTML report names it."""
    folded = unicodedata.normalize("NFKC", words).casefold()
    return SLUG.sub("-", folded).strip("-_")[:60].strip("-_")


# -- the picture To Post files ---------------------------------------------------------------------


def file_for_post(case: "Case", chart: Chart, *, note_id: str = "") -> dict[str, Any] | None:
    """The chart as a picture for X, filed in the case's media, its title drawn: the path
    and entity Post takes it by. The same picture filed before is used again. None when
    the chart holds no table."""
    from . import media as media_engine

    if not chart.drawable:
        return None
    data = chart.picture(POST_DESTINATION)
    digest = hashlib.sha256(data).hexdigest()
    before = case.find_entity(attr="sha256", value=digest)
    if before is not None and (before.get("attrs") or {}).get("path"):
        path = str(before["attrs"]["path"])
        return {"path": path, "id": str(before["id"]), "file": PurePosixPath(path).name}
    source: dict[str, Any] = {"type": SOURCE_TYPE, "title": chart.title,
                              "rendered_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    if note_id:
        source["note"] = note_id
    filed = media_engine.import_rendered_bytes(case, data, chart.title or "Chart", ".png", source, by=PRODUCER)
    path = str(filed["item"]["path"])
    return {"path": path, "id": str(filed["entity"]["id"]), "file": PurePosixPath(path).name}


def _cut(text: str, limit: int) -> str:
    text = str(text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"

