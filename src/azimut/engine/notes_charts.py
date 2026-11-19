"""A chart in a note: the `::: chart` block, the numbers it reads, and how it is drawn.

A chart is a table plus a kind. The note holds both in one block, the settings as
`key: value` lines above a GFM table, so what was published is in the note's own text
and cannot move when the case does:

    ::: chart
    kind: stacked bars
    title: At least 41 armoured vehicles, by model and grade
    count: At least
    by: Model
    colour by: Grade
    order: Confirmed, Almost sure, Strong doubt
    | Model | Grade | At least |
    | --- | --- | ---: |
    | Streit Cougar | Confirmed | 8 |
    | Harrow Tygor E1 | Almost sure | 7 |
    :::

Other Markdown readers show the settings as a paragraph, then the table.

**The settings** (`KEYS`; every other line is named by the check, never a crash):
- ``kind``: bars, columns, stacked bars, stacked columns, or one of the kinds
  `notes_chart_kinds` draws (pie, donut, segments, pictograms, silhouette rows, waffle,
  key figures, timeline, line, circles), registered at this module's foot. ``bars:
  across`` or ``bars: up`` turns a bar kind, and stands a segmented bar up.
- ``count``: the number column, or ``rows`` to count rows. Left out, a table with one
  number column counts it, and any other counts rows.
- ``by``: the column whose values are the bars (the first text column if left out).
- ``colour by``: the column that colours and stacks them (``colour`` reads the same).
- ``order``: that column's values in legend order. A value written here and in no row
  stays in the legend at 0, so a grade scale never loses a step.
- ``colours``: ``Confirmed #184f95, UAE #eb6834``, this chart's own colours.
- ``only``: ``Grade is Confirmed, Almost sure`` or ``Grade is not Set aside``, one a
  line. The figure says what it left out.
- ``highlight``: values painted in the accent, every other one greyed.
- ``sort``: largest first, smallest first, as written, a to z. ``last``: values kept
  at the end, after a rule (``Model open``).
- ``show``: ``chart`` or ``chart and table``. ``caption``: the line under the title.
  ``source``: a credit line written by hand. ``style``: report, book or dark.
- ``from``: where the rows were copied from, for *Read again*. Nothing here reads it:
  the rows in the note are the chart (owner question 10).

**Honesty is built in, not offered.** A count is a floor when its column says *at
least* (or ≥, minimum), when a cell says ``≥ 41`` or ``41+``, or when the note calls
its figures minimums: then the title must say so, and the check proposes one (`Check.
fix`). A row whose first cell reads as a total is left out and named. A legend keeps
every value, a zero one included. The credit line is read off the sources the table
cites (`[[entity:…|label]]` chips, written links) and the ``source`` line. Negative
numbers and ranges are refused with a message, never drawn. What a chart leaves out (a
filter, rows with no number, bars past `MAX_BARS`) is said on the figure, not only in
the check.

**Colours by name** (owner question 11): a value takes, in this order, the chart's own
``colours``, the case's named colour (`layerediting.PALETTE_KEY`, the one My layers and
legends read, so *Confirmed* is one blue in a chart, a map and a layer), the grade ramp
when the value reads as a certainty (`GRADES`: one blue ramp plus grey, *Strong doubt*
hatched as the second channel the validator asks for beside grey), else the next of a
fixed, validated order (`CATEGORICAL`). Colour follows the value, never its rank: the
order is read off the whole table before ``only`` filters it.

**Three looks, not per-element styling** (`theme_for`): Report (light, the reference
infographic), Book (the poster's paper, red and black) and Dark plate (the map plates'
Night). The faces follow the note's Look (`pdffonts.FONTS`).

**One layout model, two painters.** `layout` reads the block, lays the title, legend,
plot, notes and credit in CSS pixels and returns marks (`Rect`, `Line`, `Shape`,
`Circle`, `Text`, `Group`, `Picture`) with the facts tests read (`Layout.bars`, `Layout.scale`,
`Layout.legend`). `svg` writes them for HTML and the editor: real text, a `<title>` per
mark, `role="img"` with a title and a description, and `data_table_html` for screen
readers. `render_png` paints the same with Pillow, at a destination's size (`render`,
`DESTINATIONS`). The PDF takes the PNG at 300 dpi, as MAPS does: fpdf2's SVG path draws
text in one face with no fallback (Arabic, CJK and ``≥`` vanish without a word), no
shaping and no `<pattern>` (the hatch), and a silently short model name is worse than a
raster at print resolution.

**A kind is one registration** (`Kind`, `register`): its name and the words that write
it, the keys it reads beyond the common ones, the picker's *Fits* rule, and `plot`, which
lays the plot inside the frame's box from the `Reading` (rows, categories, colours) and
returns marks. The frame draws the title, legend, notes and credit around it; a kind
that draws its own legend (a donut beside its parts) says so. A kind of parts reads the
``by`` column as its colours when none is written; a kind that reads its own columns (a
timeline) counts nothing, so no title is proposed from a sum, and gives its own
description and data table. Painters never know a kind.
"""

from __future__ import annotations

import base64
import html
import math
import re
from dataclasses import dataclass, field
from functools import lru_cache
from io import BytesIO
from typing import TYPE_CHECKING, Any, Callable, Mapping, Sequence, Union

from PIL import Image, ImageDraw, ImageFont

from . import pdffonts
from .notetext import COMMENT, EMPHASIS, ENTITY_REF, IMAGE, LINK, MEDIA_REF

if TYPE_CHECKING:
    from ..workspace import Case

#: The block's name, and the token the Markdown reading hands each renderer for it.
BLOCK = "chart"
TOKEN = "az_chart"

#: Owner question 11: the case's named colours come before the chart's fallback order.
#: False would colour every chart on its own.
CASE_COLOURS = True

#: What one block may hold: rows, columns, a cell's and a line's length.
MAX_ROWS = 500
MAX_COLUMNS = 24
MAX_CELL = 300
MAX_TITLE = 200
MAX_LINE = 400
#: Values one colour column shows before the rest are drawn as one "Other".
MAX_VALUES = 8
#: Sources a credit line names before it counts the rest.
MAX_CREDITS = 4
#: Columns before the check proposes bars, whose names read across.
MAX_COLUMN_BARS = 14
#: Bars one chart draws: past it the rest are summed in one, said on the figure.
MAX_BARS = 40
OTHER = "Other"
ROWS = "rows"

ACROSS = "across"
UP = "up"
SHOW_CHART = "chart"
SHOW_BOTH = "chart and table"
SHOWS = (SHOW_CHART, SHOW_BOTH)
DEFAULT_SHOW = SHOW_CHART
SORTS = ("largest first", "smallest first", "as written", "a to z")
STYLES = ("report", "book", "dark")

#: What a check is about, in the words `notes_markdown.WARNING_KINDS` uses.
MISSING = "missing"
UNSOURCED = "unsourced"
OTHER_KIND = "other"

#: The settings a block reads, by every way they may be written, to the one word the
#: Notebook writes. A kind adds its own (`Kind.keys`).
KEYS: dict[str, str] = {
    "kind": "kind", "type": "kind",
    "title": "title",
    "caption": "caption",
    "count": "count",
    "by": "by",
    "colour by": "colour by", "color by": "colour by", "colour": "colour by", "color": "colour by",
    "coloured by": "colour by", "colored by": "colour by",
    "order": "order",
    "colours": "colours", "colors": "colours",
    "only": "only",
    "highlight": "highlight",
    "sort": "sort",
    "last": "last",
    "show": "show",
    "bars": "bars",
    "source": "source", "sources": "source", "credit": "source",
    "from": "from",
    "style": "style",
}
#: The order the Notebook writes the settings in.
WRITTEN_ORDER = ("kind", "title", "caption", "count", "by", "colour by", "order", "colours", "only",
                 "highlight", "sort", "last", "show", "bars")
WRITTEN_LAST = ("source", "from", "style")

SETTING_LINE = re.compile(r"^([A-Za-z][A-Za-z ]{0,24}?)\s*:\s?(.*)$")
TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
COLOUR_PAIR = re.compile(r"^(.+?)\s+(#[0-9a-fA-F]{6})$")
ONLY = re.compile(r"^(.+?)\s+(is not|isn't|is|=|!=)\s+(.+)$", re.I)
#: A count column or a cell that says the number is a floor.
FLOOR_WORDS = re.compile(r"\bat least\b|\bminimum\b|≥|>=|\bor more\b|\bno fewer than\b", re.I)
#: A note that calls its figures minimums: "Every figure is a minimum", "counts are floors".
MINIMUM_NOTE = re.compile(
    r"\b(?:figures?|counts?|numbers?|totals?)\s+(?:here\s+|above\s+|below\s+|given\s+)?(?:is|are)\s+"
    r"(?:all\s+)?(?:a\s+|the\s+)?(?:minimums?|minima|floors?|lower bounds?)\b", re.I)
#: A title that says its count is a floor.
TITLE_FLOOR = re.compile(r"\bat least\b|\bminimum\b|≥|>=|\bor more\b|\bno fewer than\b", re.I)
#: A row whose first cell says it is a total, which a chart would count twice.
TOTAL_ROW = re.compile(r"^(?:sub)?totals?\b", re.I)
#: A column that numbers the rows, which is never what a chart counts.
ROW_NUMBER = re.compile(r"^(?:#|n[o°º]?\.?|nr\.?|id|ref\.?|row)$", re.I)
#: A column of shares, never summed on its own: percentages, confidences, ratios, rates.
SHARE_HEADER = re.compile(r"%|\bper ?cent|\bpct\b|\bshare\b|\bratio\b|\brates?\b|\bconf(?:idence)?\b|"
                          r"\bprobability\b|\blikelihood\b|\bodds\b|\bproportion\b", re.I)
#: What XML refuses and no chart should print.
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
WHOLLY_BOLD = re.compile(r"^\*\*[^*]+\*\*$|^__[^_]+__$")
NUMBER = re.compile(
    r"^(?P<floor>≥|>=)?\s*(?:~|≈|about|c\.|ca\.)?\s*"
    r"(?P<sign>[-−–])?\s*[$€£]?\s*"
    r"(?P<num>\d{1,3}(?:[,   ]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)\s*"
    r"(?P<mag>k|K|M|bn|B)?\s*%?\s*(?P<plus>\+)?$")
RANGE = re.compile(r"\d[\d.,]*\s*[kKMB]?\s*(?:-|–|—|to)\s*[$€£]?\s*\d")
MAGNITUDES = {"k": 1e3, "K": 1e3, "M": 1e6, "bn": 1e9, "B": 1e9}
#: Words a count's column may be named that say nothing of what is counted.
NOT_A_NOUN = {"count", "counts", "number", "numbers", "total", "totals", "n", "amount", "value", "values",
              "sum", "rows", "at least", "minimum", "figure", "figures", "how many", "#"}


# -- the grades and the colours ---------------------------------------------------------------


@dataclass(frozen=True)
class Grade:
    """A step of certainty, the words that write it and its colour on light and dark paper."""

    key: str
    name: str
    words: tuple[str, ...]
    light: str
    dark: str
    hatch: bool = False
    outline: bool = False


#: The reference's ordinal ramp: one blue, darkest where surest, then grey for what was
#: set aside and an outline for what was too far to type. Validated as an ordinal ramp on
#: both papers; Strong doubt is hatched, so it never leans on hue alone beside the grey.
GRADES: tuple[Grade, ...] = (
    Grade("confirmed", "Confirmed", ("confirmed", "identified", "verified", "certain", "sure"),
          "#184f95", "#b7d3f6"),
    Grade("almost", "Almost sure", ("almost sure", "almost certain", "probable", "likely", "highly likely"),
          "#3987e5", "#5598e7"),
    Grade("doubt", "Strong doubt", ("strong doubt", "doubtful", "doubt", "possible", "unconfirmed",
                                    "unverified", "claimed", "model open"),
          "#86b6ef", "#256abf", hatch=True),
    Grade("aside", "Set aside", ("set aside", "aside", "ruled out", "excluded", "rejected", "not counted"),
          "#a9a79f", "#6f6d66"),
    Grade("far", "Too far to type", ("too far or too wrecked to type", "too far to type", "too far",
                                     "unreadable"),
          "#86b6ef", "#5598e7", outline=True),
)
_GRADE_WORDS = sorted(((word, grade) for grade in GRADES for word in grade.words), key=lambda pair: -len(pair[0]))

#: The fixed order a value with no colour of its own takes, light and dark: eight hues
#: that pass the colour-blind and normal-vision checks on adjacent pairs on both papers.
CATEGORICAL = ("#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948")
CATEGORICAL_DARK = ("#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767")


def grade_of(value: str) -> Grade | None:
    """The grade a value reads as: ``Almost sure, identified`` is almost sure."""
    text = " ".join(re.sub(r"[^\w\s]", " ", str(value or "").casefold()).split())
    for word, grade in _GRADE_WORDS:
        if text == word or text.startswith(word + " "):
            return grade
    return None


@dataclass(frozen=True)
class Paint:
    """How one value is drawn: its colour, a hatch's background, or an outline only."""

    colour: str
    hatch: str = ""
    outline: bool = False
    #: Where the colour came from: "chart", "case", "grade", "order", "highlight", "other".
    origin: str = "order"


# -- the faces and the looks ---------------------------------------------------------------------

CSS_STACKS = {
    pdffonts.SERIF: "'Noto Serif', Georgia, serif",
    pdffonts.SANS: "'Noto Sans', 'Helvetica Neue', Arial, sans-serif",
    pdffonts.BOOK: "Literata, 'Noto Serif', Georgia, serif",
    pdffonts.MODERN: "'IBM Plex Sans', 'Noto Sans', 'Helvetica Neue', Arial, sans-serif",
}


@dataclass(frozen=True)
class Face:
    """A family the chart's words are set in: its files by style, its CSS stack, its kind."""

    family: str
    files: tuple[tuple[str, str], ...]
    css: str
    serif: bool

    def file(self, style: str) -> str:
        own = dict(self.files)
        return own.get(style) or own.get(style.replace("I", "")) or own[""]


def face(family: str) -> Face:
    """The shipped face of ``family`` (`pdffonts`), the files its four styles are in."""
    files: dict[str, str] = {}
    for (name, style), filename in {**pdffonts.CORE_FACES, **pdffonts.SANS_ITALICS}.items():
        if name == family:
            files[style] = filename
    for font in pdffonts.FONTS:
        for name, style, filename in font.faces:
            if name == family:
                files[style] = filename
    if "" not in files:
        return face(pdffonts.SANS)
    serif = family in (pdffonts.SERIF, pdffonts.BOOK)
    return Face(family, tuple(sorted(files.items())), CSS_STACKS.get(family, CSS_STACKS[pdffonts.SANS]), serif)


@dataclass(frozen=True)
class ChartTheme:
    """Every colour, face and size a look lays a chart out with."""

    name: str
    paper: str
    ink: str
    ink2: str
    muted: str
    grid: str
    axis: str
    #: One series with no colour column, the highlight, and what a highlight greys.
    series: str
    accent: str
    others: str
    dark: bool
    head: Face
    body: Face
    categorical: tuple[str, ...] = CATEGORICAL
    caps_title: bool = False
    title_rule: bool = False
    radius: float = 3.0
    title_size: float = 17.0
    caption_size: float = 13.0
    label_size: float = 12.5
    value_size: float = 12.5
    tick_size: float = 11.0
    inside_size: float = 10.5
    note_size: float = 11.5
    credit_size: float = 10.5
    pad: float = 16.0


def theme_for(name: str = "report", *, font: str = "") -> ChartTheme:
    """One of the three looks, set in the note's face when its Look picked one
    (``font`` is `NoteLook.font`, a key of `pdffonts.FONTS_BY_KEY`)."""
    chosen = pdffonts.FONTS_BY_KEY.get(font)
    head = face(chosen.headings if chosen else pdffonts.SANS)
    if name == "book":
        return ChartTheme(
            name="book", paper="#efe6d3", ink="#1d1d1b", ink2="#3d3a33", muted="#6e675a", grid="#d8cdb6",
            axis="#1d1d1b", series="#c8231b", accent="#c8231b", others="#57534a", dark=False,
            head=head, body=face(chosen.body if chosen else pdffonts.SERIF), caps_title=True, title_rule=True,
            radius=0.0, title_size=18.0)
    if name == "dark":
        return ChartTheme(
            name="dark", paper="#12161b", ink="#e8ebef", ink2="#b9c0c8", muted="#8a929c", grid="#262c34",
            axis="#4a525d", series="#5598e7", accent="#f2b134", others="#5b616b", dark=True,
            head=head, body=head, categorical=CATEGORICAL_DARK)
    return ChartTheme(
        name="report", paper="#ffffff", ink="#0b0b0b", ink2="#52514e", muted="#898781", grid="#e6e5df",
        axis="#c3c2b7", series="#2a78d6", accent="#eb6834", others="#b4b2aa", dark=False,
        head=head, body=head)


def preset_for(style: str) -> str:
    """The chart look a note's Look style asks for: every note style reads as a report;
    a block's own ``style`` line and an export's destination may choose another."""
    return style if style in STYLES else "report"


# -- the block -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Only:
    """``Grade is Confirmed, Almost sure``: the rows a chart keeps."""

    column: str
    values: tuple[str, ...]
    negate: bool = False

    def text(self) -> str:
        return f"{self.column} {'is not' if self.negate else 'is'} {', '.join(self.values)}"


@dataclass
class Table:
    """The GFM table a block holds: its header, its cells as written and as read."""

    headers: list[str]
    cells: list[list[str]]
    align: list[str]
    #: The table's lines as written, so writing the block back leaves them as they were.
    lines: list[str]
    #: Where in the block its header line is.
    line: int = 0
    ruled: bool = True

    @property
    def rows(self) -> list[list[str]]:
        return [[plain_cell(cell) for cell in row] for row in self.cells]

    def column(self, name: str) -> int | None:
        wanted = " ".join(str(name or "").split()).casefold()
        for index, header in enumerate(self.headers):
            if header.casefold() == wanted:
                return index
        return None

    def text(self) -> str:
        if self.lines:
            return "\n".join(self.lines)
        return table_text(self.headers, self.cells, self.align)


@dataclass
class ChartBlock:
    """One `::: chart` block as written."""

    kind: str = ""
    title: str = ""
    caption: str = ""
    count: str = ""
    by: str = ""
    colour_by: str = ""
    order: list[str] = field(default_factory=list)
    colours: dict[str, str] = field(default_factory=dict)
    only: list[Only] = field(default_factory=list)
    highlight: list[str] = field(default_factory=list)
    sort: str = ""
    last: list[str] = field(default_factory=list)
    show: str = ""
    source: str = ""
    origin: str = ""
    style: str = ""
    #: ``across`` or ``up`` when a ``bars`` line turned the kind.
    bars: str = ""
    #: Settings a registered kind reads (`Kind.keys`), first value each.
    extra: dict[str, str] = field(default_factory=dict)
    table: Table | None = None
    #: Lines the block could not read, as ``(line, text, why)``.
    unread: list[tuple[int, str, str]] = field(default_factory=list)
    #: Where in the block each setting was written, so the check points at its line.
    where: dict[str, int] = field(default_factory=dict)

    def shows_table(self) -> bool:
        return (self.show or DEFAULT_SHOW) == SHOW_BOTH


def split_row(line: str) -> list[str]:
    """A table line's cells: cut at each ``|`` that is not escaped and not inside a
    ``[[…]]`` reference, as `notes_markdown` reads a chip whole before the table rule."""
    text = line.strip()
    if text.startswith("|"):
        text = text[1:]
    if text.endswith("|") and not text.endswith("\\|"):
        text = text[:-1]
    cells: list[str] = []
    current: list[str] = []
    depth = index = 0
    while index < len(text):
        if text.startswith("\\|", index):
            current.append("\\|")
            index += 2
            continue
        if text.startswith("[[", index):
            depth += 1
            current.append("[[")
            index += 2
            continue
        if text.startswith("]]", index) and depth:
            depth -= 1
            current.append("]]")
            index += 2
            continue
        char = text[index]
        if char == "|" and not depth:
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(char)
        index += 1
    cells.append("".join(current).strip())
    return [cell[:MAX_CELL] for cell in cells]


def plain_cell(cell: str) -> str:
    """A cell as a reader says it: a chip by its label, a link by its words, no marks."""
    text = COMMENT.sub("", CONTROL.sub("", cell))
    text = MEDIA_REF.sub(lambda match: match.group(2), text)
    text = ENTITY_REF.sub(lambda match: match.group(2), text)
    text = IMAGE.sub(lambda match: match.group(1), text)
    text = LINK.sub(lambda match: match.group(1), text)
    text = EMPHASIS.sub("", text)
    text = re.sub(r"\\([\\`*_{}\[\]()#+\-.!|~<>])", r"\1", text)
    return " ".join(text.split())


def table_text(headers: Sequence[str], cells: Sequence[Sequence[str]], align: Sequence[str] = ()) -> str:
    """A table as the Notebook writes it: a cell's ``|`` escaped, except inside ``[[…]]``."""
    def cell(value: str) -> str:
        out, depth, index = [], 0, 0
        value = " ".join(str(value).split())
        while index < len(value):
            if value.startswith("[[", index):
                depth += 1
            elif value.startswith("]]", index) and depth:
                depth -= 1
            char = value[index]
            if char == "|" and not depth and (index == 0 or value[index - 1] != "\\"):
                out.append("\\|")
            else:
                out.append(char)
            index += 1
        return "".join(out)

    rule = {"left": ":---", "right": "---:", "center": ":---:"}
    lines = ["| " + " | ".join(cell(header) for header in headers) + " |",
             "| " + " | ".join(rule.get(align[index] if index < len(align) else "", "---")
                               for index in range(len(headers))) + " |"]
    lines.extend("| " + " | ".join(cell(value) for value in row) + " |" for row in cells)
    return "\n".join(lines)


def _list(value: str) -> list[str]:
    seen: list[str] = []
    for part in value.split(","):
        part = " ".join(part.split())
        if part and part.casefold() not in (one.casefold() for one in seen):
            seen.append(part[:120])
    return seen


def parse_block(body: str) -> ChartBlock:
    """A block's lines, read: its settings, the first of each (``only`` one a line), and
    its table. A line it cannot read is kept in `ChartBlock.unread` for the check."""
    block = ChartBlock()
    lines = str(body or "").split("\n")
    index = 0
    while index < len(lines):
        raw = lines[index]
        line = raw.strip()
        if not line or line.startswith("<!--"):
            index += 1
            continue
        if line.startswith("|"):
            if block.table is not None:
                block.unread.append((index, line[:120], "a second table"))
                index += 1
                continue
            end = index
            while end < len(lines) and lines[end].strip().startswith("|"):
                end += 1
            block.table = _table(lines[index:end], index)
            index = end
            continue
        _setting(block, index, line)
        index += 1
    return block


def _table(lines: list[str], offset: int) -> Table:
    rows = [split_row(line) for line in lines]
    headers = [plain_cell(cell)[:120] for cell in rows[0]][:MAX_COLUMNS]
    ruled = len(rows) > 1 and bool(TABLE_RULE.match(lines[1].strip()))
    align = [""] * len(headers)
    if ruled:
        for column, rule in enumerate(rows[1][:len(headers)]):
            rule = rule.strip()
            align[column] = ("center" if rule.startswith(":") and rule.endswith(":") else
                             "right" if rule.endswith(":") else "left" if rule.startswith(":") else "")
    body = rows[2:] if ruled else rows[1:]
    cells = [(row + [""] * len(headers))[:len(headers)] for row in body[:MAX_ROWS]]
    return Table(headers, cells, align, [line.rstrip() for line in lines], offset, ruled)


def _setting(block: ChartBlock, offset: int, line: str) -> None:
    match = SETTING_LINE.match(line)
    if not match:
        block.unread.append((offset, line[:120], "not a setting"))
        return
    written = " ".join(match.group(1).split()).casefold()
    value = " ".join(CONTROL.sub("", match.group(2)).split())[:MAX_LINE]
    key = KEYS.get(written) or (written if written in _KIND_KEYS else "")
    if not key:
        block.unread.append((offset, line[:120], "unknown"))
        return
    if key == "only":
        found = ONLY.match(value)
        if not found:
            block.unread.append((offset, line[:120], "unreadable"))
            return
        negate = found.group(2).casefold() in ("is not", "isn't", "!=")
        block.only.append(Only(" ".join(found.group(1).split()), tuple(_list(found.group(3))), negate))
        block.where.setdefault("only", offset)
        return
    if key in block.where:
        block.unread.append((offset, line[:120], "again"))
        return
    block.where[key] = offset
    if key in _KIND_KEYS and key not in KEYS.values():
        block.extra[key] = value
        return
    if key == "kind":
        kind = kind_named(value)
        if kind is None:
            block.unread.append((offset, line[:120], "kind"))
        else:
            block.kind = kind.name
    elif key == "title":
        block.title = value[:MAX_TITLE]
    elif key == "caption":
        block.caption = value
    elif key == "count":
        block.count = ROWS if value.casefold() == ROWS else value[:120]
    elif key == "by":
        block.by = value[:120]
    elif key == "colour by":
        block.colour_by = value[:120]
    elif key == "order":
        block.order = _list(value)
    elif key == "highlight":
        block.highlight = _list(value)
    elif key == "last":
        block.last = _list(value)
    elif key == "colours":
        for part in value.split(","):
            pair = COLOUR_PAIR.match(" ".join(part.split()))
            if pair is None:
                block.unread.append((offset, line[:120], "unreadable"))
                break
            block.colours[pair.group(1)[:120]] = pair.group(2).lower()
    elif key in ("sort", "show", "style", "bars"):
        choices = {"sort": SORTS, "show": SHOWS, "style": STYLES, "bars": (ACROSS, UP)}[key]
        word = value.casefold()
        if word not in choices:
            block.unread.append((offset, line[:120], "unreadable"))
        elif key == "sort":
            block.sort = word
        elif key == "show":
            block.show = word
        elif key == "style":
            block.style = word
        else:
            block.bars = word
    elif key == "source":
        block.source = value
    elif key == "from":
        block.origin = value[:200]


def block_text(block: ChartBlock) -> str:
    """The block as the Notebook writes it: settings in one order, then its table."""
    settings: dict[str, str] = {}
    kind = effective_kind(block)
    if kind is not None and (block.kind or block.bars):
        settings["kind"] = kind.name
    settings.update({
        "title": block.title, "caption": block.caption, "count": block.count, "by": block.by,
        "colour by": block.colour_by, "order": ", ".join(block.order),
        "colours": ", ".join(f"{name} {colour}" for name, colour in block.colours.items()),
        "highlight": ", ".join(block.highlight), "sort": block.sort, "last": ", ".join(block.last),
        "show": block.show, "source": block.source, "from": block.origin, "style": block.style,
        # a kind that does not turn into another reads ``bars`` itself (a segmented bar standing up)
        "bars": block.bars if kind is not None and not kind.turns else "",
    })
    lines = ["::: chart"]
    for key in WRITTEN_ORDER:
        if key == "only":
            lines.extend(f"only: {only.text()}" for only in block.only)
        elif settings.get(key):
            lines.append(f"{key}: {settings[key]}")
    lines.extend(f"{key}: {value}" for key, value in block.extra.items() if value)
    lines.extend(f"{key}: {settings[key]}" for key in WRITTEN_LAST if settings.get(key))
    if block.table is not None:
        lines.append(block.table.text())
    lines.append(":::")
    return "\n".join(lines)


def blocks_in(text: str) -> list[ChartBlock]:
    """Every chart block a note's text holds, outside code fences."""
    found: list[ChartBlock] = []
    lines = str(text or "").split("\n")
    fenced = False
    index = 0
    while index < len(lines):
        line = lines[index]
        if re.match(r"^\s*(```|~~~)", line):
            fenced = not fenced
        elif not fenced and re.match(r"^:::[ \t]*chart[ \t]*$", line):
            end = index + 1
            while end < len(lines) and not re.match(r"^:::[ \t]*$", lines[end]):
                end += 1
            if end < len(lines):
                found.append(parse_block("\n".join(lines[index + 1:end])))
                index = end
        index += 1
    return found


# -- numbers ---------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Number:
    """A count as a cell writes it: its value, and whether it said it is a floor."""

    value: float
    floor: bool = False


def read_number(cell: str) -> Number | str:
    """A cell's number, or why it is none: "empty", "range", "negative" or "text"."""
    text = " ".join(plain_cell(cell).split())
    if not text or text in ("-", "–", "—"):
        return "empty"
    lowered = text.casefold()
    floor = False
    for word in ("at least", "minimum"):
        if lowered.startswith(word + " "):
            text, floor = text[len(word):].strip(), True
            break
    match = NUMBER.match(text)
    if match is None:
        return "range" if RANGE.search(text) else "text"
    if match.group("sign"):
        return "negative"
    value = float(re.sub(r"[,   ]", "", match.group("num")))
    value *= MAGNITUDES.get(match.group("mag") or "", 1.0)
    if not math.isfinite(value):
        return "text"
    return Number(value, floor or bool(match.group("floor")) or bool(match.group("plus")))


def number_text(value: float) -> str:
    """A value as a chart prints it: whole numbers with thousands marked, else at most two decimals."""
    if abs(value - round(value)) < 1e-9:
        return f"{int(round(value)):,}"
    return f"{value:,.2f}".rstrip("0").rstrip(".")


def tick_text(value: float, top: float) -> str:
    """A tick on an axis that reaches ``top``: in full under 10,000, compact past it."""
    if top >= 10_000:
        for size, unit in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
            if abs(value) >= size:
                return f"{value / size:.1f}".rstrip("0").rstrip(".") + unit
    return number_text(value)


@dataclass(frozen=True)
class Scale:
    """An axis from 0 to its last tick, which is at or past the largest value."""

    ticks: tuple[float, ...]

    @property
    def top(self) -> float:
        return self.ticks[-1]

    def at(self, value: float, length: float) -> float:
        return length * value / self.top if self.top else 0.0


def nice_scale(largest: float, *, most: int = 5, whole: bool = True) -> Scale:
    """Ticks on round steps (1, 2, 2.5, 4 or 5 times a power of ten), at most ``most``
    intervals, the one that wastes least room past the largest value and, of those, ticks
    most often; ``whole`` keeps a count's steps at one or more."""
    if largest <= 0 or not math.isfinite(largest):
        return Scale((0.0, 1.0))
    best: tuple[float, int, float] | None = None
    power = 10 ** math.floor(math.log10(largest))
    for magnitude in (power / 100, power / 10, power, power * 10):
        for multiple in (1, 2, 2.5, 4, 5):
            step = multiple * magnitude
            if whole and (step < 1 or abs(step - round(step)) > 1e-9):
                continue
            count = max(1, math.ceil(largest / step - 1e-9))
            if count > most:
                continue
            waste = count * step - largest
            if best is None or (waste, -count) < (best[0], -best[1]):
                best = (waste, count, step)
    if best is None:
        return Scale((0.0, float(math.ceil(largest))))
    _, count, step = best
    return Scale(tuple(round(index * step, 10) for index in range(count + 1)))


# -- the kinds --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Box:
    """Where a kind lays its plot: ``height`` None lets it take what it needs."""

    x: float
    y: float
    width: float
    height: float | None = None


@dataclass
class Plot:
    """What a kind lays out: its marks, the height it took, and the facts tests read."""

    marks: list["Mark"]
    height: float
    scale: Scale | None = None
    bars: list["Bar"] = field(default_factory=list)
    #: One line per mark for alt text and the description, in reading order.
    lines: list[str] = field(default_factory=list)
    #: A kind's own legend (a donut's parts beside it); None lets the frame draw one.
    legend: list["Swatch"] | None = None
    #: Facts a kind keeps for its tests (a pie's angles, a waffle's squares).
    facts: dict[str, Any] = field(default_factory=dict)
    #: Said under the plot: an axis's name, what a filter left out.
    notes: list[str] = field(default_factory=list)
    #: A kind that reads its own columns says itself what it shows and gives its own data
    #: table (key figures, a timeline); left empty, the frame says it from the bars.
    desc: str = ""
    table: tuple[list[str], list[list[str]]] | None = None


@dataclass(frozen=True)
class Kind:
    """A kind of chart, registered once (`register`) and found by any word that writes it.

    ``plot`` lays the kind inside the box the frame leaves it; it reads only the
    `Reading` and the theme, and returns marks every painter draws.
    """

    name: str
    label: str
    plot: Callable[["Reading", ChartTheme, Box], Plot]
    words: tuple[str, ...] = ()
    #: Settings this kind reads beyond the common ones (a waffle's ``of``, pictograms' ``icon``).
    keys: tuple[str, ...] = ()
    #: The picker's rule: does this table's shape suit the kind?
    fits: Callable[[Table], bool] = lambda table: True
    #: How it orders its categories when the block says nothing.
    sort: str = "largest first"
    #: Whether the frame draws the legend of the colour column above the plot.
    legend: bool = True
    #: Whether bars of several colours are expected (no check proposes stacking).
    stacked: bool = False
    #: Bars and columns: which way they run, and whether ``bars: across/up`` turns them.
    up: bool = False
    turns: str = ""
    #: Parts of one whole (a pie, a waffle): with no colour column written, the ``by``
    #: column's values are the parts and take their colours, the case's ones first.
    parts: bool = False
    #: False for a kind that reads its own columns rather than a count (key figures, a
    #: timeline, a line): no title is proposed from a sum and no row is left out for
    #: having no number in a count column it does not read.
    counts: bool = True
    #: The kind's own checks, said after the common ones (a waffle's whole, an icon).
    check: Callable[["Reading"], list["Check"]] | None = None


KINDS: dict[str, Kind] = {}
_KIND_WORDS: dict[str, str] = {}
_KIND_KEYS: dict[str, str] = {}


def register(kind: Kind) -> Kind:
    """Add a kind: its name and words write it, its keys become settings a block reads."""
    KINDS[kind.name] = kind
    for word in (kind.name, *kind.words):
        _KIND_WORDS[" ".join(word.casefold().split())] = kind.name
    for key in kind.keys:
        _KIND_KEYS[key.casefold()] = key.casefold()
    return kind


def kind_named(word: str) -> Kind | None:
    name = _KIND_WORDS.get(" ".join(str(word or "").casefold().split()))
    return KINDS.get(name) if name else None


def kinds() -> list[Kind]:
    """Every kind, in the order the picker shows them."""
    return list(KINDS.values())


def effective_kind(block: ChartBlock) -> Kind | None:
    """The kind a block draws as: its ``kind``, turned by a ``bars`` line, bars by default."""
    kind = KINDS.get(block.kind) or KINDS.get("bars")
    if kind is not None and block.bars and kind.turns:
        if (block.bars == UP) != kind.up:
            kind = KINDS.get(kind.turns, kind)
    return kind


def fitting(table: Table) -> list[str]:
    """The kinds whose shape this table suits, for the picker's *Fits* marks."""
    return [kind.name for kind in KINDS.values() if kind.fits(table)]


# -- reading the rows ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Check:
    """What the check before export says of a chart, where, and the setting that fixes it."""

    message: str
    kind: str = OTHER_KIND
    #: The line in the block, or None.
    line: int | None = None
    #: Settings to write to fix it: ``(("title", "At least 41 …"),)``.
    fix: tuple[tuple[str, str], ...] = ()

    def as_warning(self) -> tuple[str, str, int | None]:
        """As `notes_maps.Derived.warnings` holds one: message, kind, line in the block."""
        return self.message, self.kind, self.line


@dataclass
class Segment:
    """One colour value's part of a bar."""

    value: str
    amount: float
    rows: list[int] = field(default_factory=list)


@dataclass
class Category:
    """A bar: one value of the ``by`` column, its parts by colour, its rows."""

    name: str
    segments: list[Segment]
    rows: list[int] = field(default_factory=list)
    last: bool = False

    @property
    def total(self) -> float:
        return sum(segment.amount for segment in self.segments)


@dataclass
class Reading:
    """A block read against its own rows: what every kind lays out from."""

    block: ChartBlock
    kind: Kind
    table: Table | None
    #: The number column, or None to count rows.
    count: int | None
    by: int | None
    colour: int | None
    #: The rows kept, by index into the table's rows, and the amount each adds.
    rows: list[int]
    amounts: dict[int, float]
    categories: list[Category]
    #: The colour column's values in legend order, every one kept, and each one's total.
    values: list[str]
    totals: dict[str, float]
    paints: dict[str, Paint]
    floor: bool
    graded: bool
    checks: list[Check]
    #: Rows left out and why, by index.
    left_out: list[tuple[int, str]]
    #: Every row the table holds, for "35 of 60 rows".
    all_rows: int
    #: Bars past `MAX_BARS` summed in one.
    summed: int = 0

    @property
    def total(self) -> float:
        return sum(category.total for category in self.categories)

    @property
    def count_label(self) -> str:
        if self.count is None or self.table is None:
            return "Rows"
        return self.table.headers[self.count]

    def paint(self, value: str) -> Paint:
        return self.paints.get(value) or Paint("#888888", origin="other")

    def said(self) -> str:
        title = self.block.title or ""
        return f'The chart "{_cut(title, 60)}"' if title else "A chart"


def read(block: ChartBlock, *, theme: ChartTheme | None = None, palette: Sequence[Mapping[str, str]] = (),
         note_text: str = "") -> Reading:
    """The rows a block keeps, what each counts, and every value's colour.

    ``palette`` is the case's named colours (`case_palette`); ``note_text`` the note
    around the block, read only for whether it calls its figures minimums.
    """
    theme = theme or theme_for(block.style or "report")
    kind = effective_kind(block) or next(iter(KINDS.values()))
    checks: list[Check] = []
    table = block.table
    said = f'The chart "{_cut(block.title, 60)}"' if block.title else "A chart"

    def warn(message: str, kind_of: str = OTHER_KIND, key: str | None = None, *,
             fix: tuple[tuple[str, str], ...] = (), line: int | None = None) -> None:
        where = line if line is not None else (block.where.get(key) if key else None)
        checks.append(Check(message, kind_of, where, fix))

    _check_lines(block, kind, said, warn)
    empty = Reading(block, kind, table, None, None, None, [], {}, [], [], {}, {}, False, False, checks, [], 0)
    if table is None or not table.headers:
        warn(f"{said} holds no table: write its rows under its settings.", MISSING)
        return empty
    if not table.ruled:
        warn(f"{said}: its table needs a line of dashes under its header.", line=table.line)
    rows = table.rows
    empty.all_rows = len(rows)
    count = _count_column(block, table, rows, said, warn) if kind.counts else None
    by = _named_column(block.by, table, said, "by", warn)
    if by is None:
        by = next((index for index in range(len(table.headers)) if index != count and not _numeric(rows, index)), 0)
    colour = _named_column(block.colour_by, table, said, "colour by", warn) if block.colour_by else None
    if colour is None and kind.parts and not block.colour_by:
        colour = by
    floor = bool(count is not None and FLOOR_WORDS.search(table.headers[count])) or bool(MINIMUM_NOTE.search(note_text or ""))
    kept: list[int] = []
    amounts: dict[int, float] = {}
    left_out: list[tuple[int, str]] = []
    unnumbered: list[tuple[int, str, str]] = []
    filters = [(only, table.column(only.column)) for only in block.only]
    for only, column in filters:
        if column is None:
            warn(f'{said} keeps rows by "{_cut(only.column, 40)}", a column its table does not have.',
                 MISSING, "only")
    for index, row in enumerate(rows):
        first = row[0] if row else ""
        if TOTAL_ROW.match(first) or WHOLLY_BOLD.match(table.cells[index][0].strip() if row else ""):
            left_out.append((index, "total"))
            continue
        if any(column is not None and (row[column].casefold() in {value.casefold() for value in only.values})
               == only.negate for only, column in filters):
            left_out.append((index, "only"))
            continue
        if by is not None and not row[by]:
            left_out.append((index, "blank"))
            continue
        if count is None:
            amounts[index] = 1.0
        else:
            number = read_number(table.cells[index][count])
            if isinstance(number, str):
                left_out.append((index, number))
                unnumbered.append((index, row[count], number))
                continue
            amounts[index] = number.value
            floor = floor or number.floor
        kept.append(index)
    for index, why in left_out:
        if why == "total":
            label = rows[index][0] if rows[index] else ""
            warn(f'{said} leaves out the row "{_cut(label, 40)}", which reads as a total.',
                 line=table.line + 2 + index if table.ruled else None)
    blank = [index for index, why in left_out if why == "blank"]
    if blank and by is not None:
        warn(f'{said} leaves out {len(blank)} row{"s" if len(blank) > 1 else ""} with nothing in '
             f'"{_cut(table.headers[by], 30)}".', key="by")
    if unnumbered:
        index, cell, why = unnumbered[0]
        header = table.headers[count] if count is not None else ""
        more = f", and {len(unnumbered) - 1} more" if len(unnumbered) > 1 else ""
        row_name = f'the row "{_cut(rows[index][by], 40)}"' if by is not None and rows[index][by] \
            else f"row {index + 1}"
        cell, header = _cut(cell, 30), _cut(header, 30)
        message = {
            "empty": f'{said}: {row_name} has no number in "{header}", so it is left out{more}.',
            "range": f'{said}: {row_name} holds a range, "{cell}", so it is left out{more}: '
                     f"give its floor a column of its own.",
            "negative": f'{said}: {row_name} holds "{cell}", below zero, so it is left out{more}: '
                        f"a chart of counts draws none.",
        }.get(why, f'{said}: {row_name} holds "{cell}" in "{header}", not a number, so it is left out{more}.')
        warn(message, line=table.line + 2 + index if table.ruled else None)
    # every value of the colour column, read off the whole table, so a filter never repaints
    seen_values: list[str] = []
    if colour is not None:
        for row in rows:
            value = row[colour]
            if value and value.casefold() not in (one.casefold() for one in seen_values):
                seen_values.append(value)
    graded = bool(seen_values) and sum(1 for value in seen_values if grade_of(value)) * 2 >= len(seen_values)
    values = _value_order(block, seen_values, graded, colour, rows, kept)
    paints, folded = _paints(block, values, graded, theme, palette)
    alias: dict[str, str] = {}
    if folded:
        warn(f'{said} colours {len(values)} values: past {MAX_VALUES} the rest are drawn as "{OTHER}".',
             key="colour by")
        gone = [value for value in values if paints[value].origin == "other"]
        alias = {value.casefold(): OTHER for value in gone}
        values = [value for value in values if value not in gone] + [OTHER]
        paints = {value: paint for value, paint in paints.items() if value not in gone}
        paints[OTHER] = Paint(theme.others, origin="other")
    if colour is not None:
        held = {rows[index][colour].casefold() for index in range(len(rows))}
        for value in block.order:
            if value.casefold() not in held:
                warn(f'{said}: "{_cut(value, 40)}" in its order is in no row, so its legend shows it at 0.',
                     key="order")
    categories = _categories(block, kind, rows, kept, amounts, by, colour, values, alias)
    summed = len(categories) - MAX_BARS + 1 if len(categories) > MAX_BARS else 0
    if summed:
        categories = _sum_tail(categories, summed, values)
        warn(f"{said} has {MAX_BARS + summed - 1} bars: past {MAX_BARS - 1}, the other {summed} are summed in one.",
             key="by")
    totals = {value: 0.0 for value in values}
    for category in categories:
        for segment in category.segments:
            totals[segment.value] = totals.get(segment.value, 0.0) + segment.amount
    reading = Reading(block, kind, table, count, by, colour, kept, amounts, categories, values, totals, paints,
                      floor, graded, checks, left_out, len(rows), summed)
    _check_reading(reading, said, warn)
    return reading


def _check_lines(block: ChartBlock, kind: Kind, said: str,
                 warn: Callable[..., None]) -> None:
    for offset, line, why in block.unread:
        if why == "unknown":
            key = line.split(":", 1)[0].strip()
            warn(f'{said}: "{_cut(key, 30)}" is not a chart setting.', line=offset)
        elif why == "kind":
            names = ", ".join(one.label for one in KINDS.values())
            warn(f'{said}: "{_cut(line.split(":", 1)[-1].strip(), 30)}" is not a kind of chart ({names}).',
                 line=offset)
        elif why == "again":
            warn(f'{said} says "{_cut(line.split(":", 1)[0].strip(), 30)}" twice: the first one counts.', line=offset)
        elif why == "a second table":
            warn(f"{said} holds a second table: a chart reads one.", line=offset)
        else:
            warn(f'{said} cannot read "{_cut(line, 60)}".', line=offset)
    for key in block.extra:
        if key not in kind.keys:
            warn(f'{said}: a {kind.label.lower()} chart does not read "{key}".', key=key)


def reads_as_share(table: Table, column: int) -> bool:
    """Whether a column holds shares rather than amounts: its header says a percentage, a
    confidence, a ratio or a rate, or half its cells end in ``%``. Summing those means nothing."""
    if SHARE_HEADER.search(table.headers[column]):
        return True
    cells = [row[column] for row in table.rows if column < len(row) and row[column]]
    return bool(cells) and sum(1 for cell in cells if cell.rstrip().endswith("%")) * 2 >= len(cells)


def _count_column(block: ChartBlock, table: Table, rows: list[list[str]], said: str,
                  warn: Callable[..., None]) -> int | None:
    """What a chart counts: the column its ``count`` names, or its rows. With no ``count``
    line it sums its one column of amounts and says which; a column of shares is never
    summed on its own (`reads_as_share`), and the rows are counted, said too."""
    if block.count == ROWS:
        return None
    if block.count:
        column = table.column(block.count)
        if column is None:
            warn(f'{said} counts "{_cut(block.count, 40)}", a column its table does not have.', MISSING, "count")
        return column
    numeric = [index for index in range(len(table.headers))
               if _numeric(rows, index, most=True) and not ROW_NUMBER.match(table.headers[index])]
    amounts = [index for index in numeric if not reads_as_share(table, index)]
    if len(amounts) == 1:
        header = _cut(table.headers[amounts[0]], 40)
        warn(f'{said} sums "{header}", its one column of amounts, as no count is written.',
             fix=(("count", table.headers[amounts[0]]),))
        return amounts[0]
    if numeric and not amounts:
        header = _cut(table.headers[numeric[0]], 40)
        warn(f'{said} counts its rows: "{header}" reads as a share, which is never summed on its own.',
             fix=(("count", ROWS),))
    return None


def _named_column(name: str, table: Table, said: str, key: str, warn: Callable[..., None]) -> int | None:
    if not name:
        return None
    column = table.column(name)
    if column is None:
        warn(f'{said} reads "{_cut(name, 40)}" {key}, a column its table does not have.', MISSING, key)
    return column


def _numeric(rows: list[list[str]], column: int, *, most: bool = False) -> bool:
    """Whether a column holds numbers: all its cells, or with ``most`` at least half, so
    a count with one cell in error is still read as the count (and the cell is named)."""
    cells = [row[column] for row in rows if column < len(row) and row[column] and not TOTAL_ROW.match(row[0])]
    numbers = sum(1 for cell in cells if isinstance(read_number(cell), Number))
    return bool(cells) and (numbers * 2 >= len(cells) if most else numbers == len(cells))


def _value_order(block: ChartBlock, seen: list[str], graded: bool, colour: int | None,
                 rows: list[list[str]], kept: list[int]) -> list[str]:
    if colour is None:
        return [""]
    ordered: list[str] = []
    folded = {value.casefold(): value for value in seen}
    for value in block.order:
        ordered.append(folded.get(value.casefold(), value))
    rest = [value for value in seen if value.casefold() not in (one.casefold() for one in ordered)]
    if graded:
        ranks = {grade.key: index for index, grade in enumerate(GRADES)}
        rest.sort(key=lambda value: ranks.get(grade.key, 99) if (grade := grade_of(value)) else 99)
    elif not block.order and len(rest) > MAX_VALUES:
        size = {value.casefold(): 0 for value in rest}
        for index in kept:
            size[rows[index][colour].casefold()] = size.get(rows[index][colour].casefold(), 0) + 1
        rest.sort(key=lambda value: -size.get(value.casefold(), 0))
    return ordered + rest


def _paints(block: ChartBlock, values: list[str], graded: bool, theme: ChartTheme,
            palette: Sequence[Mapping[str, str]]) -> tuple[dict[str, Paint], bool]:
    """Every value's paint, in the order `CASE_COLOURS` and the module docstring say."""
    if values == [""]:
        return {"": Paint(theme.series, origin="order")}, False
    named = {str(entry.get("name", "")).strip().casefold(): str(entry.get("colour", "")).lower()
             for entry in (palette if CASE_COLOURS else ()) if HEX.match(str(entry.get("colour", "")))}
    written = {name.casefold(): colour for name, colour in block.colours.items()}
    lit = {value.casefold() for value in block.highlight}
    lit_values = lit & {value.casefold() for value in values}
    paints: dict[str, Paint] = {}
    used = set(named.values()) | set(written.values())
    order = [colour for colour in theme.categorical if colour not in used]
    folded = False
    shown = 0
    for value in values:
        key = value.casefold()
        grade = grade_of(value) if graded else None
        if lit_values:
            paints[value] = Paint(theme.accent if key in lit_values else theme.others, origin="highlight")
            continue
        if key in written:
            paints[value] = Paint(written[key], origin="chart")
        elif key in named:
            paints[value] = Paint(named[key], origin="case")
        elif grade is not None:
            colour = grade.dark if theme.dark else grade.light
            hatch = _mix(colour, theme.paper, 0.6) if grade.hatch else ""
            paints[value] = Paint(colour, hatch, grade.outline, origin="grade")
        elif shown < MAX_VALUES and order:
            paints[value] = Paint(order.pop(0), origin="order")
        else:
            paints[value] = Paint(theme.others, origin="other")
            folded = True
        shown += 1
    return paints, folded


def _categories(block: ChartBlock, kind: Kind, rows: list[list[str]], kept: list[int], amounts: dict[int, float],
                by: int | None, colour: int | None, values: list[str], alias: dict[str, str]) -> list[Category]:
    found: dict[str, Category] = {}
    canonical = {**{value.casefold(): value for value in values}, **alias}
    for index in kept:
        name = rows[index][by] if by is not None else ""
        category = found.get(name.casefold())
        if category is None:
            category = Category(name, [Segment(value, 0.0) for value in values])
            found[name.casefold()] = category
        value = canonical.get(rows[index][colour].casefold(), "") if colour is not None else ""
        segment = next((one for one in category.segments if one.value == value), None)
        if segment is None:
            segment = Segment(value, 0.0)
            category.segments.append(segment)
        segment.amount += amounts[index]
        segment.rows.append(index)
        category.rows.append(index)
    ordered = list(found.values())
    how = block.sort or kind.sort
    if how == "largest first":
        ordered.sort(key=lambda category: -category.total)
    elif how == "smallest first":
        ordered.sort(key=lambda category: category.total)
    elif how == "a to z":
        ordered.sort(key=lambda category: category.name.casefold())
    if block.last:
        pinned = [value.casefold() for value in block.last]
        ordered.sort(key=lambda category: pinned.index(category.name.casefold())
                     if category.name.casefold() in pinned else -1)
        for category in ordered:
            category.last = category.name.casefold() in pinned
    return ordered


def _sum_tail(categories: list[Category], summed: int, values: list[str]) -> list[Category]:
    """The first bars as they are, the rest summed in one bar named for how many it holds;
    the bars kept last stay last."""
    pinned = [category for category in categories if category.last]
    loose = [category for category in categories if not category.last]
    keep = max(0, len(loose) - summed)
    tail = loose[keep:]
    whole = Category(f"{len(tail)} others", [Segment(value, 0.0) for value in values])
    for category in tail:
        whole.rows.extend(category.rows)
        for segment in category.segments:
            into = next((one for one in whole.segments if one.value == segment.value), None)
            if into is None:
                into = Segment(segment.value, 0.0)
                whole.segments.append(into)
            into.amount += segment.amount
            into.rows.extend(segment.rows)
    return [*loose[:keep], whole, *pinned]


def _check_reading(reading: Reading, said: str, warn: Callable[..., None]) -> None:
    block = reading.block
    if not reading.rows and reading.table is not None:
        warn(f"{said} has no rows left to draw.", MISSING)
    if reading.colour is not None and not reading.kind.stacked and reading.kind.turns:
        mixed = [category for category in reading.categories
                 if sum(1 for segment in category.segments if segment.amount) > 1]
        if mixed:
            stacked = "stacked columns" if reading.kind.up else "stacked bars"
            warn(f'{said}: "{_cut(mixed[0].name, 40)}" holds several values of "{block.colour_by}", '
                 f"so its bar is stacked.", key="kind", fix=(("kind", stacked),))
    if reading.kind.up and len(reading.categories) > MAX_COLUMN_BARS:
        warn(f"{said} draws {len(reading.categories)} columns, too many for their names: bars read them across.",
             key="kind", fix=(("kind", "stacked bars" if reading.kind.stacked else "bars"),))
    held = {value.casefold() for value in reading.values} | {category.name.casefold() for category in reading.categories}
    for value in block.highlight:
        if value.casefold() not in held:
            warn(f'{said} highlights "{_cut(value, 40)}", which no row holds.', key="highlight")
    if reading.kind.counts and reading.floor and not TITLE_FLOOR.search(block.title or ""):
        proposal = propose_title(reading)
        if block.title:
            message = f'"{_cut(block.title, 60)}" counts at least: say so in its title.'
        else:
            message = "A chart counts at least: give it a title that says so."
        warn(message, key="title", fix=(("title", proposal),))
    if reading.kind.check is not None and reading.table is not None:
        reading.checks.extend(reading.kind.check(reading))
    if not credit_line(reading):
        warn(f"{said} cites no source: cite one in its table, or write a source line.", UNSOURCED)


# -- what the frame says around the plot ------------------------------------------------------------


def _lower(word: str) -> str:
    """A column's name inside a sentence: ``Model`` → ``model``, ``UAE`` kept."""
    word = " ".join(word.split())
    if not word or word.isupper() or (len(word) > 1 and word[1].isupper()):
        return word
    return word[0].lower() + word[1:]


def noun_of(reading: Reading) -> str:
    """What a chart counts, read off its title (``Vehicles by model``) or its count column."""
    title = (reading.block.title or "").strip()
    match = re.match(r"^(?:at least\s+)?(?:[\d.,]+\s+)?(?P<noun>[^\d,].*?)\s*,?\s+(?:by|per|across|in)\s", title, re.I)
    if match and match.group("noun").casefold() not in NOT_A_NOUN:
        return _lower(match.group("noun"))
    counted = re.search(r"\b\d[\d,.]*\s+((?:[A-Za-z-]+\s+){0,2}[A-Za-z-]+s)\b", title)
    if counted:
        return _lower(counted.group(1))
    header = reading.count_label if reading.count is not None else ""
    header = FLOOR_WORDS.sub("", header)
    header = re.sub(r"[()\[\],:;]", " ", header)
    header = " ".join(header.split())
    if header and header.casefold() not in NOT_A_NOUN:
        return _lower(header)
    return ""


def propose_title(reading: Reading, noun: str = "") -> str:
    """A title from the data: ``At least 41 armoured vehicles, by model and grade``.
    ``noun`` is what the rows are (the heading above, or typed); else the title's or
    the count column's."""
    block = reading.block
    title = (block.title or "").strip()
    if title and re.match(r"^[\d~≈]", title):
        return f"At least {title}" if reading.floor and not TITLE_FLOOR.search(title) else title
    noun = noun or noun_of(reading)
    count = number_text(reading.total)
    head = f"At least {count}" if reading.floor else count
    head = f"{head} {noun}" if noun else head
    parts = [_lower(reading.table.headers[reading.by])] if reading.table and reading.by is not None else []
    if reading.table and reading.colour is not None and reading.colour != reading.by:
        parts.append(_lower(reading.table.headers[reading.colour]))
    return f"{head}, by {' and '.join(parts)}" if parts else head


def axis_name(reading: Reading) -> str:
    """The value axis's name: ``Vehicles, at least``."""
    noun = noun_of(reading)
    if reading.floor:
        return f"{noun[:1].upper()}{noun[1:]}, at least" if noun else "At least"
    if reading.count is None:
        return f"{noun[:1].upper()}{noun[1:]}" if noun else "Rows"
    return reading.count_label


def sources_cited(reading: Reading) -> list[str]:
    """The sources the table's cells cite, by their label, first seen first."""
    found: list[str] = []
    if reading.table is None:
        return found
    for row in reading.table.cells:
        for cell in row:
            for match in ENTITY_REF.finditer(cell):
                label = " ".join(match.group(2).split())
                if label and label not in found:
                    found.append(label)
            for match in re.finditer(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", cell):
                label = plain_cell(match.group(1))
                if label and label not in found:
                    found.append(label)
    return found


def credit_line(reading: Reading) -> str:
    """The line under a chart that says where its numbers come from."""
    written = reading.block.source.strip()
    cited = [label for label in sources_cited(reading) if label.casefold() not in written.casefold()]
    if len(cited) > MAX_CREDITS:
        cited = [*cited[:MAX_CREDITS], f"and {len(cited) - MAX_CREDITS} more"]
    if written and re.match(r"^(?:sources?|credits?|data)\b", written, re.I):
        return "; ".join([written, *cited]) if cited else written
    parts = [part for part in [written, *cited] if part]
    if not parts:
        return ""
    return f"{'Sources' if len(parts) > 1 else 'Source'}: {'; '.join(parts)}"


def left_notes(reading: Reading) -> list[str]:
    """What the figure must say it left out: the rows a filter kept, the rows with nothing
    to draw them by, the rows with no number."""
    notes: list[str] = []
    totals = sum(1 for _, why in reading.left_out if why == "total")
    if reading.block.only:
        said = " and ".join(only.text() for only in reading.block.only)
        notes.append(f"Only rows where {said}: {len(reading.rows)} of {reading.all_rows - totals}.")
    blank = sum(1 for _, why in reading.left_out if why == "blank")
    if blank and reading.table is not None and reading.by is not None:
        notes.append(f"{blank} row{'s' if blank > 1 else ''} with no {_lower(reading.table.headers[reading.by])} "
                     f"{'are' if blank > 1 else 'is'} not drawn.")
    if reading.summed:
        notes.append(f'"{reading.summed} others" sums the bars past the first {MAX_BARS - 1}.')
    unread = sum(1 for _, why in reading.left_out if why in ("empty", "range", "negative", "text"))
    if unread:
        notes.append(f"{unread} row{'s' if unread > 1 else ''} with no number {'are' if unread > 1 else 'is'} "
                     f"not drawn.")
    return notes


# -- the marks ----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Rect:
    """A box: ``round`` names the corners its radius rounds (``"right"``, ``"top"``, ``"all"``)."""

    x: float
    y: float
    w: float
    h: float
    fill: str
    radius: float = 0.0
    round: str = ""
    hatch: str = ""
    stroke: str = ""
    stroke_width: float = 0.0


@dataclass(frozen=True)
class Line:
    points: tuple[tuple[float, float], ...]
    stroke: str
    width: float = 1.0
    dash: tuple[float, float] | None = None


@dataclass(frozen=True)
class Shape:
    """An SVG path in the chart's units, moved by ``x``, ``y`` and scaled by ``scale``:
    a wedge, a pictogram, an outline."""

    d: str
    fill: str
    x: float = 0.0
    y: float = 0.0
    scale: float = 1.0
    stroke: str = ""
    stroke_width: float = 0.0
    hatch: str = ""


@dataclass(frozen=True)
class Circle:
    cx: float
    cy: float
    r: float
    fill: str
    stroke: str = ""
    stroke_width: float = 0.0


@dataclass(frozen=True)
class Text:
    """Words on one line, ``y`` their baseline. ``full`` is the whole text of a cut one."""

    x: float
    y: float
    text: str
    size: float
    colour: str
    bold: bool = False
    anchor: str = "start"
    body: bool = False
    italic: bool = False
    full: str = ""


@dataclass(frozen=True)
class Group:
    """Marks read as one thing, said by ``title`` (``Streit Cougar, Confirmed: 8``)."""

    marks: tuple["Mark", ...]
    title: str = ""


@dataclass(frozen=True)
class Picture:
    """A picture in a box: an icon of the analyst's own, later a frame on a wall. ``data``
    is a PNG or a JPEG; ``cover`` fills the box and crops what is past it, else the whole
    picture is fitted in the box, centred."""

    x: float
    y: float
    w: float
    h: float
    data: bytes
    cover: bool = False


Mark = Union[Rect, Line, Shape, Circle, Text, Group, Picture]


@dataclass(frozen=True)
class Swatch:
    """A legend's entry: a value, its paint, its total."""

    value: str
    paint: Paint
    total: float


@dataclass
class Bar:
    """A drawn bar, for tests and the data table: its parts as laid, in data order."""

    name: str
    total: float
    #: ``(value, amount, start, length)`` along the value axis, in the chart's units.
    parts: list[tuple[str, float, float, float]]
    #: Where the bar sits across the axis: its band's start and its thickness.
    at: float
    thickness: float


@dataclass
class Layout:
    """A chart laid out: its size, its marks in paint order, and what a reader is told."""

    width: float
    height: float
    theme: ChartTheme
    marks: list[Mark]
    title: str
    desc: str
    lines: list[str]
    legend: list[Swatch]
    scale: Scale | None
    bars: list[Bar]
    notes: list[str]
    credit: str
    kind: str
    checks: list[Check]
    #: The numbers as a table, for screen readers and `data_table_html`.
    table_head: list[str]
    table_rows: list[list[str]]
    facts: dict[str, Any] = field(default_factory=dict)

    @property
    def alt(self) -> str:
        """Alt text for the picture: the title, then one line per mark."""
        return "\n".join([self.title or self.desc, *self.lines])


# -- measuring words ---------------------------------------------------------------------------------

_MEASURE_PX = 64


@lru_cache(maxsize=48)
def _pil_font(filename: str, size: float) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(pdffonts.FONT_DIR / filename), size)


@lru_cache(maxsize=24)
def _cmap(filename: str) -> frozenset[int]:
    from fontTools.ttLib import TTFont

    try:
        font = TTFont(str(pdffonts.FONT_DIR / filename), lazy=True)
        return frozenset((font.getBestCmap() or {}).keys())
    except Exception:  # an unreadable face covers nothing, so the next one is asked
        return frozenset()


def _chain(primary: str, serif: bool) -> list[str]:
    nearest = "NotoSerif-Regular.ttf" if serif else "NotoSans-Regular.ttf"
    return [primary] + ([nearest] if nearest != primary else [])


def runs(text: str, primary: str, serif: bool = False) -> list[tuple[str, str]]:
    """``text`` cut where its face changes: the chosen face, the Noto face of its kind,
    the script face that holds a letter (`pdffonts.SCRIPTS`), then the symbols. The PDF
    picks faces the same way, so a model's name in Arabic is drawn, not dropped."""
    chain = _chain(primary, serif)
    out: list[tuple[str, str]] = []
    for char in text:
        code = ord(char)
        chosen = primary
        if not char.isspace() and code not in _cmap(primary):
            chosen = next((name for name in chain[1:] if code in _cmap(name)), "")
            if not chosen:
                script = next((one for one in pdffonts.SCRIPTS if one.holds(code)), None)
                chosen = script.file if script and code in _cmap(script.file) else pdffonts.SYMBOL_FILE
        if out and out[-1][0] == chosen:
            out[-1] = (chosen, out[-1][1] + char)
        else:
            out.append((chosen, char))
    return out


def text_width(text: str, size: float, the_face: Face, bold: bool = False, italic: bool = False) -> float:
    """How wide ``text`` is set at ``size`` CSS pixels, in the faces the painters use."""
    style = ("B" if bold else "") + ("I" if italic else "")
    primary = the_face.file(style)
    total = 0.0
    for filename, part in runs(text, primary, the_face.serif):
        total += _pil_font(filename, _MEASURE_PX).getlength(part)
    return total * size / _MEASURE_PX


def wrap(text: str, width: float, size: float, the_face: Face, *, bold: bool = False,
         lines: int = 2) -> tuple[list[str], bool]:
    """``text`` broken into at most ``lines`` lines of ``width``; the last cut with an
    ellipsis when it does not fit. Returns the lines and whether anything was cut."""
    words = text.split()
    out: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if not current or text_width(trial, size, the_face, bold) <= width:
            current = trial
        else:
            out.append(current)
            current = word
    if current:
        out.append(current)
    cut = len(out) > lines
    out = out[:lines]
    if out and (cut or text_width(out[-1], size, the_face, bold) > width):
        out[-1] = _fit(out[-1] + ("…" if cut else ""), width, size, the_face, bold)
        cut = True
    return out, cut


def _fit(text: str, width: float, size: float, the_face: Face, bold: bool) -> str:
    if text_width(text, size, the_face, bold) <= width:
        return text
    base = text.rstrip("…")
    while base and text_width(base.rstrip() + "…", size, the_face, bold) > width:
        base = base[:-1]
    return base.rstrip() + "…"


# -- the frame -------------------------------------------------------------------------------------------


def layout(block: ChartBlock, *, theme: ChartTheme | None = None, palette: Sequence[Mapping[str, str]] = (),
           note_text: str = "", width: float = 640.0, height: float | None = None,
           title: bool = True, noun: str = "") -> Layout:
    """The chart laid out ``width`` CSS pixels wide: the title (unless the page's own figure
    caption carries it), the caption, the legend, the plot, the notes and the credit line.
    ``height`` fixes the frame (a picture for X or a square), the plot taking what is left."""
    theme = theme or theme_for(block.style or "report")
    reading = read(block, theme=theme, palette=palette, note_text=note_text)
    width = max(240.0, float(width))
    pad = theme.pad
    inner = width - 2 * pad
    head: list[Mark] = []
    y = pad
    shown_title = block.title or (propose_title(reading, noun) if reading.table is not None and reading.kind.counts
                                  else "")
    if title and shown_title:
        words = shown_title.upper() if theme.caps_title else shown_title
        lines, _ = wrap(words, inner, theme.title_size, theme.head, bold=True, lines=3)
        for line in lines:
            y += theme.title_size * 1.05
            head.append(Text(pad, y, line, theme.title_size, theme.ink, bold=True))
            y += theme.title_size * 0.28
        if theme.title_rule:
            y += 6
            head.append(Line(((pad, y), (width - pad, y)), theme.ink, 1.2))
            y += 4
    if block.caption:
        y += 6
        lines, _ = wrap(block.caption, inner, theme.caption_size, theme.body, lines=3)
        for line in lines:
            y += theme.caption_size * 1.1
            head.append(Text(pad, y, line, theme.caption_size, theme.ink2, body=True))
            y += theme.caption_size * 0.35
    legend = _legend(reading) if reading.kind.legend else []
    if legend:
        y += 12
        swatches, used = legend_marks(legend, theme, pad, y, inner)
        head.extend(swatches)
        y += used
    y += 14
    notes = left_notes(reading)
    credit = credit_line(reading)
    _, foot_height = _foot(notes, credit, theme, pad, inner)
    box_height = None if height is None else max(40.0, height - y - foot_height - pad)
    plot = reading.kind.plot(reading, theme, Box(pad, y, inner, box_height))
    if plot.legend is not None:
        legend = plot.legend
    y += plot.height if box_height is None else max(box_height, plot.height)
    notes = [*plot.notes, *notes]
    foot_marks, foot_height = _foot(notes, credit, theme, pad, inner)
    total_height = y + foot_height + pad if height is None else max(float(height), y + foot_height + pad)
    if height is not None:
        y = total_height - pad - foot_height
    moved = [_moved(mark, y) for mark in foot_marks]
    background = Rect(0, 0, width, total_height, theme.paper)
    marks: list[Mark] = [background, *head, *plot.marks, *moved]
    kind_name = reading.kind.name
    desc = plot.desc or _describe(reading, kind_name)
    table_head, table_rows = plot.table if plot.table is not None else _data_table(reading)
    return Layout(width, round(total_height, 2), theme, marks, shown_title, desc, plot.lines, legend, plot.scale,
                  plot.bars, notes, credit, kind_name, reading.checks, table_head, table_rows, plot.facts)


def _legend(reading: Reading) -> list[Swatch]:
    if reading.colour is None or not reading.values:
        return []
    lit = {value.casefold() for value in reading.block.highlight}
    swatches = [Swatch(value, reading.paint(value), reading.totals.get(value, 0.0)) for value in reading.values]
    if lit & {value.casefold() for value in reading.values}:
        kept = [swatch for swatch in swatches if swatch.value.casefold() in lit]
        rest = sum(swatch.total for swatch in swatches if swatch.value.casefold() not in lit)
        others = [swatch for swatch in swatches if swatch.value.casefold() not in lit]
        if others:
            kept.append(Swatch(f"Other {_lower(reading.block.colour_by)}" if len(others) > 1 else others[0].value,
                               others[0].paint, rest))
        return kept
    shown = [swatch for swatch in swatches if swatch.paint.origin != "other"]
    folded = [swatch for swatch in swatches if swatch.paint.origin == "other"]
    if folded:
        shown.append(Swatch(OTHER, folded[0].paint, sum(swatch.total for swatch in folded)))
    return shown


def legend_marks(legend: list[Swatch], theme: ChartTheme, x0: float, y0: float,
                 width: float) -> tuple[list[Mark], float]:
    """A legend laid in rows from ``(x0, y0)``, ``width`` wide: its marks and its height."""
    marks: list[Mark] = []
    size = theme.label_size - 0.5
    x, row = x0, 0
    line_height = size * 1.7
    for swatch in legend:
        label_width = text_width(swatch.value, size, theme.head)
        total = number_text(swatch.total)
        total_width = text_width(total, size, theme.head, bold=True)
        item = 11 + 6 + label_width + 5 + total_width
        if x > x0 and x + item > x0 + width:
            x, row = x0, row + 1
        base = y0 + row * line_height + size
        group = (
            swatch_rect(swatch.paint, x, base - 10, 11, 11, theme),
            Text(x + 17, base, swatch.value, size, theme.ink2),
            Text(x + 17 + label_width + 5, base, total, size, theme.ink, bold=True),
        )
        marks.append(Group(group, f"{swatch.value}: {total}"))
        x += item + 16
    return marks, (row + 1) * line_height - size * 0.4


def swatch_rect(paint: Paint, x: float, y: float, w: float, h: float, theme: ChartTheme) -> Rect:
    """A legend's square in a value's paint: filled, hatched or outlined."""
    radius = 2.0 if theme.radius else 0.0
    if paint.outline:
        return Rect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, theme.paper, radius, "all", stroke=paint.colour,
                    stroke_width=1.5)
    return Rect(x, y, w, h, paint.colour, radius, "all", hatch=paint.hatch)


def _foot(notes: list[str], credit: str, theme: ChartTheme, x: float, width: float) -> tuple[list[Mark], float]:
    """The notes and the credit line, laid from 0 down; moved under the plot after."""
    marks: list[Mark] = []
    y = 4.0 if notes else 0.0
    for note in notes:
        lines, _ = wrap(note, width, theme.note_size, theme.body, lines=3)
        for line in lines:
            y += theme.note_size * 1.35
            marks.append(Text(x, y, line, theme.note_size, theme.ink2, body=True))
    if credit:
        y += 8 if notes else 4
        lines, _ = wrap(credit, width, theme.credit_size, theme.body, lines=3)
        for line in lines:
            y += theme.credit_size * 1.4
            marks.append(Text(x, y, line, theme.credit_size, theme.muted, body=True))
    return marks, y + (4 if marks else 0)


def _moved(mark: Mark, dy: float) -> Mark:
    if isinstance(mark, Text):
        return Text(mark.x, mark.y + dy, mark.text, mark.size, mark.colour, mark.bold, mark.anchor, mark.body,
                    mark.italic, mark.full)
    return mark


def _describe(reading: Reading, kind: str) -> str:
    """One sentence a screen reader says before the bars: what is counted, by what, in all."""
    table = reading.table
    if table is None or reading.by is None:
        return "A chart with no table."
    noun = noun_of(reading) or ("rows" if reading.count is None else _lower(reading.count_label))
    floor = " (at least)" if reading.floor else ""
    colour = f", coloured by {_lower(table.headers[reading.colour])}" \
        if reading.colour is not None and reading.colour != reading.by else ""
    label = KINDS[kind].label if kind in KINDS else kind
    largest = max(reading.categories, key=lambda category: category.total, default=None)
    most = f" The largest is {largest.name}, {number_text(largest.total)}." if largest else ""
    return (f"{label}: {noun}{floor} by {_lower(table.headers[reading.by])}{colour}. "
            f"{len(reading.categories)} in all, {number_text(reading.total)} together.{most}")


def _data_table(reading: Reading) -> tuple[list[str], list[list[str]]]:
    if reading.table is None:
        return [], []
    by = reading.table.headers[reading.by] if reading.by is not None else ""
    if reading.colour is None or reading.colour == reading.by:
        head = [by, axis_name(reading)]
        return head, [[category.name, number_text(category.total)] for category in reading.categories]
    head = [by, *reading.values, "All"]
    rows = []
    for category in reading.categories:
        amounts = {segment.value: segment.amount for segment in category.segments}
        rows.append([category.name, *(number_text(amounts.get(value, 0.0)) for value in reading.values),
                     number_text(category.total)])
    return head, rows


# -- bars and columns -------------------------------------------------------------------------------------


def _luminance(colour: str) -> float:
    red, green, blue = (int(colour[index:index + 2], 16) / 255 for index in (1, 3, 5))
    def channel(value: float) -> float:
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)


def ink_on(paint: Paint, theme: ChartTheme) -> str:
    """The words set inside a mark: white on a dark fill, near-black on a light one."""
    if paint.outline or paint.hatch:
        return theme.ink
    return "#ffffff" if _luminance(paint.colour) < 0.36 else "#0b0b0b"


def _bar_marks(reading: Reading, theme: ChartTheme, category: Category, *, up: bool, base: float,
               at: float, thickness: float, length: float, scale: Scale) -> tuple[list[Mark], Bar]:
    """One bar's parts along the value axis from ``base`` (x across, y up), a 2 px gap of
    paper between parts, the data end rounded, a hairline where it counts nothing."""
    marks: list[Mark] = []
    parts: list[tuple[str, float, float, float]] = []
    shown = [segment for segment in category.segments if segment.amount > 0]
    lit = {value.casefold() for value in reading.block.highlight}
    bar_lit = category.name.casefold() in lit
    start = 0.0
    gap = 2.0
    for number, segment in enumerate(shown):
        size = scale.at(segment.amount, length)
        last = number == len(shown) - 1
        drawn = max(size - (0 if last else gap), 0.6)
        paint = reading.paint(segment.value)
        if lit and not (lit & {value.casefold() for value in reading.values}):
            paint = Paint(theme.accent if bar_lit else theme.others, origin="highlight") if reading.colour is None \
                else (paint if bar_lit else Paint(theme.others, origin="highlight"))
        radius = min(theme.radius, drawn / 2, thickness / 2) if last else 0.0
        if up:
            rect = fill_rect(paint, at, base - start - drawn, thickness, drawn, radius, "top", theme)
        else:
            rect = fill_rect(paint, base + start, at, drawn, thickness, radius, "right", theme)
        label = f"{category.name}, {segment.value}: {number_text(segment.amount)}" if segment.value \
            else f"{category.name}: {number_text(segment.amount)}"
        inside: list[Mark] = []
        if len(shown) > 1 and not paint.hatch:
            text = number_text(segment.amount)
            text_size = theme.inside_size
            need = text_width(text, text_size, theme.head, bold=True)
            if up and drawn >= text_size + 5 and thickness >= need + 4:
                inside.append(Text(at + thickness / 2, base - start - drawn + text_size + 2, text, text_size,
                                   ink_on(paint, theme), bold=True, anchor="middle"))
            elif not up and drawn >= need + 8 and thickness >= text_size + 1:
                inside.append(Text(base + start + 4, at + thickness / 2 + text_size * 0.36, text, text_size,
                                   ink_on(paint, theme), bold=True))
        marks.append(Group((rect, *inside), label))
        parts.append((segment.value, segment.amount, start, drawn))
        start += size
    if not shown:
        hairline = Rect(at, base - 1.0, thickness, 1.0, theme.ink2) if up else Rect(base, at, 1.0, thickness, theme.ink2)
        marks.append(Group((hairline,), f"{category.name}: 0"))
        parts.append(("", 0.0, 0.0, 0.0))
    return marks, Bar(category.name, category.total, parts, at, thickness)


def fill_rect(paint: Paint, x: float, y: float, w: float, h: float, radius: float, corners: str,
              theme: ChartTheme) -> Rect:
    """A box in a value's paint, ``corners`` rounded (``"right"``, ``"top"``, ``"all"``)."""
    if paint.outline:
        inset = 0.75
        return Rect(x + inset, y + inset, max(w - 2 * inset, 0.5), max(h - 2 * inset, 0.5), theme.paper, radius,
                    corners, stroke=paint.colour, stroke_width=1.5)
    return Rect(x, y, w, h, paint.colour, radius, corners if radius else "", hatch=paint.hatch)


def _plot_across(reading: Reading, theme: ChartTheme, box: Box) -> Plot:
    """Bars across: names right-aligned in a column, the bars from one baseline, their
    totals at their ends, ticks along the top and the axis's name under it."""
    categories = reading.categories
    if not categories:
        return Plot([], 0.0)
    size = theme.label_size
    largest = max((category.total for category in categories), default=0.0)
    scale = nice_scale(largest, most=5)
    value_width = max(text_width(number_text(category.total), theme.value_size, theme.head, bold=True)
                      for category in categories) + 8
    names = [category.name for category in categories]
    longest = max(text_width(name, size, theme.head) for name in names)
    column = min(longest, box.width * 0.36)
    labels = [wrap(name, column, size, theme.head, lines=2) for name in names]
    x0 = box.x + column + 10
    length = box.x + box.width - value_width - x0
    tick_room = theme.tick_size + 8
    foot_room = theme.tick_size + 10
    separator = 14.0 if any(category.last for category in categories) else 0.0
    weights = [1.0 if len(lines) == 1 else 1.55 for lines, _ in labels]
    natural_band = 22.0
    if box.height is None:
        band = natural_band
    else:
        room = box.height - tick_room - foot_room - separator
        band = max(15.0, min(40.0, room / max(sum(weights), 1)))
    thickness = min(24.0, max(8.0, band * 0.64))
    marks: list[Mark] = []
    bars: list[Bar] = []
    lines_out: list[str] = []
    top = box.y + tick_room
    # the bands first, so the grid can run their whole height
    y = top
    rows: list[tuple[Category, float, float, tuple[list[str], bool]]] = []
    for category, (lines, cut), weight in zip(categories, labels, weights):
        if category.last and rows and not rows[-1][0].last:
            y += separator
        rows.append((category, y, band * weight, (lines, cut)))
        y += band * weight
    bottom = y
    for tick in scale.ticks:
        x = x0 + scale.at(tick, length)
        marks.append(Line(((round(x, 2), top - 3), (round(x, 2), bottom)), theme.axis if tick == 0 else theme.grid, 1.0))
        marks.append(Text(x, box.y + theme.tick_size, tick_text(tick, scale.top), theme.tick_size, theme.muted,
                          anchor="middle"))
    if separator:
        first_last = next(row_y for category, row_y, _, _ in rows if category.last)
        line_y = first_last - separator / 2
        marks.append(Line(((box.x, line_y), (box.x + box.width, line_y)), theme.grid, 1.0))
    for category, row_y, height, (lines, cut) in rows:
        at = row_y + (height - thickness) / 2
        bar_marks, bar = _bar_marks(reading, theme, category, up=False, base=x0, at=at, thickness=thickness,
                                    length=length, scale=scale)
        marks.extend(bar_marks)
        bars.append(bar)
        centre = row_y + height / 2
        first = centre + size * 0.36 - (len(lines) - 1) * size * 0.6
        for number, line in enumerate(lines):
            marks.append(Text(x0 - 8, first + number * size * 1.2, line, size, theme.ink, anchor="end",
                              full=category.name if cut else ""))
        end = x0 + scale.at(category.total, length)
        marks.append(Text(end + 5, centre + theme.value_size * 0.36, number_text(category.total), theme.value_size,
                          theme.ink, bold=True))
        lines_out.append(_bar_line(reading, category))
    marks.append(Text(x0, bottom + foot_room, axis_name(reading), theme.tick_size, theme.muted))
    return Plot(marks, bottom + foot_room + 4 - box.y, scale, bars, lines_out)


def _plot_up(reading: Reading, theme: ChartTheme, box: Box) -> Plot:
    """Columns: ticks and grid on the left, a total on each cap, names under them in up
    to three lines, the axis's name over the ticks."""
    categories = reading.categories
    if not categories:
        return Plot([], 0.0)
    size = theme.label_size - 0.5
    largest = max((category.total for category in categories), default=0.0)
    scale = nice_scale(largest, most=5)
    tick_width = max(text_width(tick_text(tick, scale.top), theme.tick_size, theme.head) for tick in scale.ticks)
    x0 = box.x + tick_width + 8
    plot_width = box.x + box.width - x0
    separator = 14.0 if any(category.last for category in categories) else 0.0
    step = (plot_width - separator) / len(categories)
    thickness = min(28.0, max(6.0, step * 0.56))
    labels = [wrap(category.name, max(step - 6, 24), size, theme.head, lines=3) for category in categories]
    if any(cut for _, cut in labels):
        labels = [wrap(category.name, max(step - 6, 24), size, theme.head, lines=4) for category in categories]
    label_lines = max(len(lines) for lines, _ in labels)
    name_room = label_lines * size * 1.2 + 8
    head_room = theme.tick_size + theme.value_size + 10
    if box.height is None:
        plot_height = 200.0
    else:
        plot_height = max(60.0, box.height - head_room - name_room)
    top = box.y + head_room
    base = top + plot_height
    marks: list[Mark] = [Text(box.x, box.y + theme.tick_size, axis_name(reading), theme.tick_size, theme.muted)]
    for tick in scale.ticks:
        y = base - scale.at(tick, plot_height)
        marks.append(Line(((x0 - 4, round(y, 2)), (box.x + box.width, round(y, 2))),
                          theme.axis if tick == 0 else theme.grid, 1.0))
        marks.append(Text(x0 - 8, y + theme.tick_size * 0.36, tick_text(tick, scale.top), theme.tick_size,
                          theme.muted, anchor="end"))
    bars: list[Bar] = []
    lines_out: list[str] = []
    x = x0
    for number, (category, (lines, cut)) in enumerate(zip(categories, labels)):
        if category.last and number and not categories[number - 1].last:
            line_x = x + separator / 2
            marks.append(Line(((line_x, top), (line_x, base + name_room - 4)), theme.grid, 1.0))
            x += separator
        at = x + (step - thickness) / 2
        bar_marks, bar = _bar_marks(reading, theme, category, up=True, base=base, at=at, thickness=thickness,
                                    length=plot_height, scale=scale)
        marks.extend(bar_marks)
        bars.append(bar)
        cap = base - scale.at(category.total, plot_height)
        marks.append(Text(at + thickness / 2, cap - 5, number_text(category.total), theme.value_size, theme.ink,
                          bold=True, anchor="middle"))
        for line_number, line in enumerate(lines):
            marks.append(Text(x + step / 2, base + 6 + size + line_number * size * 1.2, line, size, theme.ink2,
                              anchor="middle", full=category.name if cut else ""))
        lines_out.append(_bar_line(reading, category))
        x += step
    return Plot(marks, head_room + plot_height + name_room, scale, bars, lines_out)


def _bar_line(reading: Reading, category: Category) -> str:
    parts = [f"{segment.value} {number_text(segment.amount)}" for segment in category.segments
             if segment.value and segment.amount]
    inside = f" ({', '.join(parts)})" if reading.colour is not None and parts else ""
    return f"{category.name}: {number_text(category.total)}{inside}"


def _fits_bars(table: Table) -> bool:
    return len(table.headers) >= 1 and bool(table.cells)


def _fits_stacked(table: Table) -> bool:
    rows = table.rows
    for column in range(len(table.headers)):
        values = {row[column].casefold() for row in rows if row[column]}
        if 1 < len(values) <= MAX_VALUES and len(values) < len(rows) and not _numeric(rows, column):
            return True
    return False


BARS = register(Kind("bars", "Bars", _plot_across, words=("bar", "bar chart", "horizontal bars"),
                     fits=_fits_bars, turns="columns"))
COLUMNS = register(Kind("columns", "Columns", _plot_up, words=("column", "column chart", "vertical bars"),
                        fits=_fits_bars, sort="as written", up=True, turns="bars"))
STACKED = register(Kind("stacked bars", "Stacked", _plot_across, words=("stacked", "stacked bar"),
                        fits=_fits_stacked, stacked=True, turns="stacked columns"))
STACKED_COLUMNS = register(Kind("stacked columns", "Stacked columns", _plot_up, words=("stacked column",),
                                fits=_fits_stacked, sort="as written", stacked=True, up=True, turns="stacked bars"))


# -- the SVG painter ------------------------------------------------------------------------------------


def svg(chart: Layout, *, ident: str = "az-chart", transparent: bool = False,
        faces: Mapping[str, str] | None = None) -> str:
    """The chart as an SVG a page holds inline: real text in the note's faces (``faces``
    names a page's own families, ``{"head": "az-head", "body": "az-body"}``), a title and a
    description, a `<title>` on every mark, a hatch as a pattern. ``transparent`` leaves
    the paper out, so the chart sits on the page's own."""
    ident = re.sub(r"[^A-Za-z0-9_-]", "-", ident) or "az-chart"
    theme = chart.theme
    head_css = (faces or {}).get("head", "")
    body_css = (faces or {}).get("body", "")
    head = f"{head_css}, {theme.head.css}" if head_css else theme.head.css
    body = f"{body_css}, {theme.body.css}" if body_css else theme.body.css
    patterns: dict[tuple[str, str], str] = {}
    out: list[str] = []

    def hatch(colour: str, background: str) -> str:
        key = (colour, background)
        if key not in patterns:
            patterns[key] = f"{ident}-h{len(patterns) + 1}"
        return f"url(#{patterns[key]})"

    def paint(mark: Mark, depth: int) -> None:
        if isinstance(mark, Group):
            out.append("<g>" + (f"<title>{_esc(mark.title)}</title>" if mark.title else ""))
            for inner in mark.marks:
                paint(inner, depth + 1)
            out.append("</g>")
        elif isinstance(mark, Rect):
            if transparent and depth == 0 and mark is chart.marks[0]:
                return
            fill = hatch(mark.fill, mark.hatch) if mark.hatch else mark.fill
            stroke = f' stroke="{mark.stroke}" stroke-width="{_n(mark.stroke_width)}"' if mark.stroke else ""
            if mark.radius and mark.round and mark.round != "all":
                out.append(f'<path d="{_rounded_path(mark)}" fill="{fill}"{stroke}/>')
            else:
                radius = f' rx="{_n(mark.radius)}"' if mark.radius else ""
                out.append(f'<rect x="{_n(mark.x)}" y="{_n(mark.y)}" width="{_n(mark.w)}" height="{_n(mark.h)}"'
                           f'{radius} fill="{fill}"{stroke}/>')
        elif isinstance(mark, Line):
            points = " ".join(f"{_n(x)},{_n(y)}" for x, y in mark.points)
            dash = f' stroke-dasharray="{_n(mark.dash[0])} {_n(mark.dash[1])}"' if mark.dash else ""
            if len(mark.points) == 2:
                (x1, y1), (x2, y2) = mark.points
                out.append(f'<line x1="{_n(x1)}" y1="{_n(y1)}" x2="{_n(x2)}" y2="{_n(y2)}" stroke="{mark.stroke}" '
                           f'stroke-width="{_n(mark.width)}"{dash}/>')
            else:
                out.append(f'<polyline points="{points}" fill="none" stroke="{mark.stroke}" '
                           f'stroke-width="{_n(mark.width)}" stroke-linejoin="round" stroke-linecap="round"{dash}/>')
        elif isinstance(mark, Shape):
            fill = hatch(mark.fill, mark.hatch) if mark.hatch else (mark.fill or "none")
            stroke = f' stroke="{mark.stroke}" stroke-width="{_n(mark.stroke_width)}"' if mark.stroke else ""
            moved = (f' transform="translate({_n(mark.x)} {_n(mark.y)}) scale({_n(mark.scale)})"'
                     if (mark.x or mark.y or mark.scale != 1) else "")
            out.append(f'<path d="{_esc(mark.d)}" fill="{fill}"{stroke}{moved}/>')
        elif isinstance(mark, Circle):
            stroke = f' stroke="{mark.stroke}" stroke-width="{_n(mark.stroke_width)}"' if mark.stroke else ""
            out.append(f'<circle cx="{_n(mark.cx)}" cy="{_n(mark.cy)}" r="{_n(mark.r)}" fill="{mark.fill}"{stroke}/>')
        elif isinstance(mark, Picture):
            kind = picture_type(mark.data)
            if kind:
                fit = "xMidYMid slice" if mark.cover else "xMidYMid meet"
                out.append(f'<image href="data:image/{kind};base64,{base64.b64encode(mark.data).decode("ascii")}" '
                           f'x="{_n(mark.x)}" y="{_n(mark.y)}" width="{_n(mark.w)}" height="{_n(mark.h)}" '
                           f'preserveAspectRatio="{fit}"/>')
        elif isinstance(mark, Text):
            attrs = [f'x="{_n(mark.x)}"', f'y="{_n(mark.y)}"', f'font-size="{_n(mark.size)}"', f'fill="{mark.colour}"']
            if mark.bold:
                attrs.append('font-weight="700"')
            if mark.italic:
                attrs.append('font-style="italic"')
            if mark.anchor != "start":
                attrs.append(f'text-anchor="{mark.anchor}"')
            if mark.body and body != head:
                attrs.append(f'font-family="{_esc(body)}"')
            full = f"<title>{_esc(mark.full)}</title>" if mark.full else ""
            out.append(f"<text {' '.join(attrs)}>{full}{_esc(mark.text)}</text>")

    for mark in chart.marks:
        paint(mark, 0)
    defs = "".join(
        f'<pattern id="{name}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">'
        f'<rect width="6" height="6" fill="{background}"/><rect width="2.6" height="6" fill="{colour}"/></pattern>'
        for (colour, background), name in patterns.items())
    width, height = _n(chart.width), _n(chart.height)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" id="{ident}" class="az-chart az-chart-{theme.name}" '
            f'viewBox="0 0 {width} {height}" width="{width}" height="{height}" role="img" '
            f'aria-labelledby="{ident}-title {ident}-desc" font-family="{_esc(head)}">'
            f'<title id="{ident}-title">{_esc(chart.title or "Chart")}</title>'
            f'<desc id="{ident}-desc">{_esc(" ".join([chart.desc, "; ".join(chart.lines)]).strip())}</desc>'
            + (f"<defs>{defs}</defs>" if defs else "") + "".join(out) + "</svg>")


def _rounded_path(rect: Rect) -> str:
    x, y, w, h = rect.x, rect.y, rect.w, rect.h
    r = min(rect.radius, w / 2, h / 2)
    if rect.round == "right":
        return (f"M{_n(x)} {_n(y)}H{_n(x + w - r)}Q{_n(x + w)} {_n(y)} {_n(x + w)} {_n(y + r)}"
                f"V{_n(y + h - r)}Q{_n(x + w)} {_n(y + h)} {_n(x + w - r)} {_n(y + h)}H{_n(x)}Z")
    return (f"M{_n(x)} {_n(y + h)}V{_n(y + r)}Q{_n(x)} {_n(y)} {_n(x + r)} {_n(y)}"
            f"H{_n(x + w - r)}Q{_n(x + w)} {_n(y)} {_n(x + w)} {_n(y + r)}V{_n(y + h)}Z")


def data_table_html(chart: Layout, *, caption: bool = True) -> str:
    """The chart's numbers as an HTML table, for screen readers and *The numbers*."""
    if not chart.table_head:
        return ""
    head = "".join(f'<th scope="col">{_esc(cell)}</th>' for cell in chart.table_head)
    rows = "".join(
        "<tr>" + f'<th scope="row">{_esc(row[0])}</th>' + "".join(f"<td>{_esc(cell)}</td>" for cell in row[1:]) + "</tr>"
        for row in chart.table_rows)
    said = f"<caption>{_esc(chart.title)}</caption>" if caption and chart.title else ""
    return f'<table class="az-chart-data">{said}<thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>'


# -- the PNG painter ----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Destination:
    """Where a picture goes: its pixels, and the width its words are laid out for."""

    label: str
    width: int
    height: int | None
    #: The layout's width in CSS pixels: smaller sets the words larger in the picture.
    design: float
    dpi: int | None = None


DESTINATIONS: dict[str, Destination] = {
    #: a PDF page: the Report's frame, 166 mm, at 300 dpi
    "page": Destination("PDF page", 1960, None, 640.0, 300),
    "x": Destination("X, 16:9", 1600, 900, 560.0),
    "portrait": Destination("4:5", 1080, 1350, 480.0),
    "square": Destination("1:1", 1080, 1080, 480.0),
}


def render(block: ChartBlock, destination: str = "page", *, theme: ChartTheme | None = None,
           palette: Sequence[Mapping[str, str]] = (), note_text: str = "", title: bool = True) -> bytes:
    """The chart as a PNG for one of `DESTINATIONS`. A frame of fixed size that cannot
    hold every bar at its words' size is laid wider and drawn smaller, never cut."""
    where = DESTINATIONS.get(destination) or DESTINATIONS["page"]
    design = where.design
    if where.height is None:
        chart = layout(block, theme=theme, palette=palette, note_text=note_text, width=design, title=title)
    else:
        ratio = where.height / where.width
        chart = layout(block, theme=theme, palette=palette, note_text=note_text, width=design,
                       height=design * ratio, title=title)
        for _ in range(4):
            if chart.height <= design * ratio + 0.5:
                break
            design *= chart.height / (design * ratio) * 1.02
            chart = layout(block, theme=theme, palette=palette, note_text=note_text, width=design,
                           height=design * ratio, title=title)
    return render_png(chart, where.width, height=where.height, dpi=where.dpi)


def render_png(chart: Layout, width: int, *, height: int | None = None, dpi: int | None = None) -> bytes:
    """The chart painted ``width`` pixels wide: its shapes drawn twice the size and
    brought down, so edges are smooth, then its words at the final size, so they are sharp."""
    width = max(120, min(int(width), 4000))
    scale = width / chart.width
    out_height = int(height) if height else max(60, round(chart.height * scale))
    out_height = min(out_height, 8000)
    supersample = 2 if width * out_height <= 6_000_000 else 1
    big = Image.new("RGB", (width * supersample, out_height * supersample), _rgb(chart.theme.paper))
    draw = ImageDraw.Draw(big)
    unit = scale * supersample
    texts: list[Text] = []

    def shapes(mark: Mark) -> None:
        if isinstance(mark, Group):
            for inner in mark.marks:
                shapes(inner)
        elif isinstance(mark, Text):
            texts.append(mark)
        elif isinstance(mark, Rect):
            _paint_rect(big, draw, mark, unit)
        elif isinstance(mark, Line):
            _paint_line(draw, mark, unit)
        elif isinstance(mark, Shape):
            _paint_shape(big, draw, mark, unit)
        elif isinstance(mark, Circle):
            box = ((mark.cx - mark.r) * unit, (mark.cy - mark.r) * unit, (mark.cx + mark.r) * unit,
                   (mark.cy + mark.r) * unit)
            draw.ellipse(box, fill=_rgb(mark.fill) if mark.fill and mark.fill != "none" else None,
                         outline=_rgb(mark.stroke) if mark.stroke else None,
                         width=max(1, round(mark.stroke_width * unit)) if mark.stroke else 1)
        elif isinstance(mark, Picture):
            _paint_picture(big, mark, unit)

    for mark in chart.marks:
        shapes(mark)
    # an even box average of the doubled drawing: smooth edges, and faster than a filter
    picture = big.reduce(supersample) if supersample > 1 else big
    words = ImageDraw.Draw(picture)
    for text in texts:
        _paint_text(words, text, chart.theme, scale)
    buffer = BytesIO()
    if dpi:
        picture.save(buffer, "PNG", optimize=True, dpi=(dpi, dpi))
    else:
        picture.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def _rgb(colour: str) -> tuple[int, int, int]:
    value = colour.lstrip("#")
    if len(value) != 6:
        return (136, 136, 136)
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def _corners(rect: Rect) -> tuple[bool, bool, bool, bool]:
    """Pillow's corners, top-left first and clockwise."""
    return {"right": (False, True, True, False), "top": (True, True, False, False),
            "all": (True, True, True, True)}.get(rect.round, (True, True, True, True))


def _paint_rect(canvas: Image.Image, draw: ImageDraw.ImageDraw, rect: Rect, unit: float) -> None:
    x0, y0 = rect.x * unit, rect.y * unit
    x1, y1 = (rect.x + rect.w) * unit, (rect.y + rect.h) * unit
    if x1 - x0 < 1:
        x1 = x0 + 1
    if y1 - y0 < 1:
        y1 = y0 + 1
    radius = rect.radius * unit if rect.round or rect.radius else 0
    corners = _corners(rect)
    if rect.hatch:
        _hatched(canvas, (x0, y0, x1, y1), radius, corners, rect.hatch, rect.fill, unit)
        return
    outline = _rgb(rect.stroke) if rect.stroke else None
    line = max(1, round(rect.stroke_width * unit)) if rect.stroke else 1
    fill = None if rect.fill == "none" else _rgb(rect.fill)
    if radius:
        draw.rounded_rectangle((x0, y0, x1, y1), radius=radius, fill=fill, outline=outline, width=line,
                               corners=corners)
    else:
        draw.rectangle((x0, y0, x1, y1), fill=fill, outline=outline, width=line)


def _hatched(canvas: Image.Image, box: tuple[float, float, float, float], radius: float,
             corners: tuple[bool, bool, bool, bool], background: str, stripe: str, unit: float,
             phase: float | None = None) -> None:
    """Stripes at 45°, six units apart and on one grid, so two hatched boxes line up;
    ``phase`` is where the box sits on the picture when ``canvas`` is a layer of its own."""
    x0, y0, x1, y1 = (round(value) for value in box)
    width, height = max(1, x1 - x0), max(1, y1 - y0)
    tile = Image.new("RGB", (width, height), _rgb(background))
    pen = ImageDraw.Draw(tile)
    spacing = 6 * unit * math.sqrt(2)
    thickness = max(1, round(2.6 * unit))
    start = -(((x0 + y0) if phase is None else phase) % spacing)
    offset = start - height
    while offset < width + height:
        pen.line([(offset, height), (offset + height, 0)], fill=_rgb(stripe), width=thickness)
        offset += spacing
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius=radius, fill=255, corners=corners)
    canvas.paste(tile, (x0, y0), mask)


#: The most pixels a picture in a chart may decode to: a 4K frame is a third of it.
MAX_PICTURE_PIXELS = 25_000_000


def picture_type(data: bytes) -> str:
    """``png`` or ``jpeg`` by the picture's first bytes, else empty: nothing else is drawn."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    return "jpeg" if data[:3] == b"\xff\xd8\xff" else ""


def _paint_picture(canvas: Image.Image, mark: Picture, unit: float) -> None:
    if not picture_type(mark.data):
        return
    try:
        with Image.open(BytesIO(mark.data)) as opened:
            if opened.width * opened.height > MAX_PICTURE_PIXELS:
                return
            picture = opened.convert("RGBA")
    except Exception:  # a picture that cannot be read is left out, the chart still drawn
        return
    box_w, box_h = max(1, round(mark.w * unit)), max(1, round(mark.h * unit))
    ratio = (max if mark.cover else min)(box_w / picture.width, box_h / picture.height)
    picture = picture.resize((max(1, round(picture.width * ratio)), max(1, round(picture.height * ratio))),
                             Image.Resampling.LANCZOS)
    if mark.cover:
        left, top = (picture.width - box_w) // 2, (picture.height - box_h) // 2
        picture = picture.crop((left, top, left + box_w, top + box_h))
    x = round(mark.x * unit + (box_w - picture.width) / 2)
    y = round(mark.y * unit + (box_h - picture.height) / 2)
    canvas.paste(picture, (x, y), picture)


def _paint_line(draw: ImageDraw.ImageDraw, mark: Line, unit: float) -> None:
    points = [(x * unit, y * unit) for x, y in mark.points]
    width = max(1, round(mark.width * unit))
    if not mark.dash:
        draw.line(points, fill=_rgb(mark.stroke), width=width, joint="curve")
        return
    on, off = mark.dash[0] * unit, mark.dash[1] * unit
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        length = math.hypot(bx - ax, by - ay)
        at = 0.0
        while at < length:
            end = min(at + on, length)
            draw.line([(ax + (bx - ax) * at / length, ay + (by - ay) * at / length),
                       (ax + (bx - ax) * end / length, ay + (by - ay) * end / length)], fill=_rgb(mark.stroke),
                      width=width)
            at = end + off


@lru_cache(maxsize=512)
def _path_points(d: str) -> tuple[tuple[tuple[tuple[float, float], ...], bool], ...]:
    """A path's points, read once: a pictogram's glyph is drawn many times."""
    from .notes_maps import path_points

    return tuple((tuple(points), closed) for points, closed in path_points(d))


def _paint_shape(canvas: Image.Image, draw: ImageDraw.ImageDraw, mark: Shape, unit: float) -> None:
    read = _path_points(mark.d)
    subpaths = [[((mark.x + x * mark.scale) * unit, (mark.y + y * mark.scale) * unit) for x, y in points]
                for points, _closed in read]
    if mark.fill and mark.fill != "none":
        for points in subpaths:
            if len(points) >= 3:
                if mark.hatch:
                    # striped in a layer the size of the shape's box, not of the whole picture
                    left = math.floor(min(p[0] for p in points))
                    top = math.floor(min(p[1] for p in points))
                    size = (max(1, math.ceil(max(p[0] for p in points)) - left + 1),
                            max(1, math.ceil(max(p[1] for p in points)) - top + 1))
                    layer = Image.new("RGB", size, _rgb(mark.hatch))
                    _hatched(layer, (0, 0, size[0], size[1]), 0, (True,) * 4, mark.hatch, mark.fill, unit,
                             phase=left + top)
                    mask = Image.new("L", size, 0)
                    ImageDraw.Draw(mask).polygon([(x - left, y - top) for x, y in points], fill=255)
                    canvas.paste(layer, (left, top), mask)
                else:
                    draw.polygon(points, fill=_rgb(mark.fill))
    if mark.stroke:
        width = max(1, round(mark.stroke_width * mark.scale * unit))
        for points, (_, closed) in zip(subpaths, read):
            if len(points) >= 2:
                draw.line(points + points[:1] if closed else points, fill=_rgb(mark.stroke), width=width,
                          joint="curve")


def _paint_text(draw: ImageDraw.ImageDraw, mark: Text, theme: ChartTheme, scale: float) -> None:
    the_face = theme.body if mark.body else theme.head
    style = ("B" if mark.bold else "") + ("I" if mark.italic else "")
    size = mark.size * scale
    parts = runs(mark.text, the_face.file(style), the_face.serif)
    widths = [_pil_font(filename, size).getlength(part) for filename, part in parts]
    total = sum(widths)
    x = mark.x * scale - (total if mark.anchor == "end" else total / 2 if mark.anchor == "middle" else 0)
    y = mark.y * scale
    for (filename, part), part_width in zip(parts, widths):
        draw.text((x, y), part, font=_pil_font(filename, size), fill=_rgb(mark.colour), anchor="ls")
        x += part_width


# -- small readings -------------------------------------------------------------------------------------------


def case_palette(case: "Case") -> list[dict[str, str]]:
    """The case's named colours, the ones My layers offers and its legends read."""
    from . import layerediting

    return layerediting.palette(case)


def _mix(colour: str, other: str, amount: float) -> str:
    a, b = _rgb(colour), _rgb(other)
    return "#" + "".join(f"{round(a[index] + (b[index] - a[index]) * amount):02x}" for index in range(3))


def _n(value: float) -> str:
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def _esc(value: str) -> str:
    return html.escape(CONTROL.sub("", str(value)), quote=True)


def _cut(text: str, limit: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


# -- the other kinds, in the order the picker shows them (`notes_chart_kinds`) --------------------------------

from . import notes_chart_kinds as _kinds  # noqa: E402  (its kinds draw with this module's marks)

PIE = register(Kind("pie", "Pie", _kinds.plot_pie, words=("pie chart",), fits=_kinds.fits_pie, legend=False,
                    parts=True, check=_kinds.check_parts))
DONUT = register(Kind("donut", "Donut", _kinds.plot_donut, words=("doughnut", "donut chart", "ring"),
                      keys=("centre", "center"), fits=_kinds.fits_pie, legend=False, parts=True,
                      check=_kinds.check_parts))
SEGMENTS = register(Kind("segments", "Segments", _kinds.plot_segments,
                         words=("segmented bar", "segment", "share bar", "100% bar"), fits=_kinds.fits_segments,
                         legend=False, parts=True))
PICTOGRAMS = register(Kind("pictograms", "Pictograms", _kinds.plot_pictograms,
                           words=("pictogram", "unit chart", "isotype", "icons"), keys=("icon", "per glyph"),
                           fits=_kinds.fits_pictograms, parts=True, check=_kinds.check_glyphs))
SILHOUETTES = register(Kind("silhouette rows", "Silhouette rows", _kinds.plot_silhouettes,
                            words=("silhouettes", "icon rows", "pictogram rows"), keys=("icon", "flag", "per glyph"),
                            fits=_kinds.fits_silhouettes, check=_kinds.check_glyphs))
WAFFLE = register(Kind("waffle", "Waffle", _kinds.plot_waffle, words=("waffle chart", "squares", "grid"),
                       keys=("of", "squares"), fits=_kinds.fits_waffle, sort="as written", legend=False, parts=True,
                       check=_kinds.check_waffle))
KEY_FIGURES = register(Kind("key figures", "Key figures", _kinds.plot_figures,
                            words=("figures", "stat tiles", "tiles", "stats"), fits=_kinds.fits_figures,
                            sort="as written", legend=False, counts=False))
TIMELINE = register(Kind("timeline", "Timeline", _kinds.plot_timeline, words=("time line", "chronology", "sequence"),
                         fits=_kinds.fits_timeline, sort="as written", counts=False, check=_kinds.check_timeline))
LINE = register(Kind("line", "Line", _kinds.plot_line, words=("line chart", "lines"), fits=_kinds.fits_line,
                     sort="as written", legend=False, counts=False, check=_kinds.check_line))
CIRCLES = register(Kind("circles", "Circles", _kinds.plot_circles, words=("circle comparison", "compare circles"),
                        fits=_kinds.fits_circles, legend=False, parts=True, check=_kinds.check_circles))
