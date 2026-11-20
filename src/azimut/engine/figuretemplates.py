"""Figure templates: an infographic's, a chart's or a map's layout, without its data.

A template is kept in ``templates.json`` (kind ``figure``, `api/templates.py`) as the
block's own text, so it reads and is edited with the Notebook's own syntax:

    {"figure": "infographic", "text": ":::: infographic\\nlook: report\\n…\\n::::"}

What a template keeps, and never:

- **an infographic**: its look, its legend, its panels in order and their widths, and the
  band's words the analyst typed into the template itself. Never its ``data:`` nor the
  band a case wrote (*At least 60 vehicles…* is that case's), and a words panel made from
  a case starts as `WORDS_PANEL`, its words left with the case;
- **a chart**: its kind and its settings, the columns it is drawn by named (`chart_roles`),
  and its table's header with no row. Never its title, caption, credit, ``from:`` or rows:
  a chart made from it proposes its title from the rows it gets;
- **a map**: how it is shown (`MAP_KEYS`: base, legend, size, north arrow, scale, the
  timeline, Play's pace, the cards, names and crowds). Never what it shows (its layers,
  plate, proofs, ground, steps, colours) nor where (its view and frame).

**Applying one** (`apply`) maps the template's columns onto the data's: by name first
(`match`), and a column the data does not name is asked (the builder's *match the
columns* step), with *count the rows* offered for a column that counts. A chart panel
whose columns are all given takes the page's data, its rows copied in; one with a column
left to fill by hand opens its own form with no row (``rows: own``). Key figures are always
typed. Nothing is invented: a value the data does not hold drops its colour, icon or
highlight, and a title is only the one the data proposes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from typing import Any, Literal, Mapping, Sequence

from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import notes_chart_kinds as kinds_module
from . import notes_chart_picker as picker
from . import notes_chart_timeline
from . import notes_charts as nc
from . import notes_infographic as ni
from . import notes_maps as nm
from .notetext import ENTITY_REF, IMAGE, MEDIA_REF

FIGURES = ("infographic", "chart", "map")
Figure = Literal["infographic", "chart", "map"]
#: How long one template's text may be: a page of sixteen panels with no row is far less.
MAX_TEXT = 48 * 1024
MAX_WORDS = 4000
#: How a map is shown, the one part of a map a template keeps.
MAP_KEYS = ("base", "proof points", "labels", "crowds", "north", "scale", "timeline", "speed", "card", "size", "legend")
#: A words panel made from a case, its words left there (`InfographicBuilder`'s own).
WORDS_PANEL = "### A heading\nA few words about what the panels show."
#: ``icons: each``, ``flags: each``: one per category, each the icon of the library named
#: like it, found when the template meets its data.
EACH = "each"
#: What `count` is given to count the data's rows instead of a column.
ROWS = nc.ROWS
#: The kinds whose columns are their own reading: always typed, never a sheet's.
TYPED = ("key figures",)
UNTIL = re.compile(r"\b(?:until|end|to|till)\b", re.I)
#: Settings that name values of the data, kept only for the values it holds.
VALUE_PAIRS = ("icons", "flags")

CHART_OPEN = re.compile(r"^:::[ \t]*chart[ \t]*$")
MAP_OPEN = re.compile(r"^:::[ \t]*map[ \t]*$")
CLOSE = re.compile(r"^:::[ \t]*$")


class TemplateError(ValueError):
    """A template's text that is not the figure it says it is."""


# -- the blocks -----------------------------------------------------------------------------------


def _inner(text: str, opener: re.Pattern[str], closer: re.Pattern[str] = CLOSE) -> str | None:
    """A block's lines without its fences, None when ``text`` is not that block."""
    lines = str(text or "").strip("\n").split("\n")
    if not lines or not opener.match(lines[0].strip()):
        return None
    end = len(lines) - 1
    while end > 0 and not closer.match(lines[end].strip()):
        end -= 1
    if end <= 0:
        return None
    return "\n".join(lines[1:end])


def figure_of(text: str) -> str:
    """Which figure a block's text is, '' for none."""
    first = str(text or "").strip("\n").split("\n", 1)[0].strip()
    if ni.OPEN.match(first):
        return "infographic"
    if CHART_OPEN.match(first):
        return "chart"
    if MAP_OPEN.match(first):
        return "map"
    return ""


def _fold(word: str) -> str:
    return " ".join(nc.plain_cell(str(word or "")).split()).casefold()


def _clean(text: str, limit: int = MAX_WORDS) -> str:
    """Words without what names a case: a chip by its label, a picture by its words."""
    text = ENTITY_REF.sub(lambda match: match.group(2), str(text or ""))
    text = MEDIA_REF.sub(lambda match: match.group(2), text)
    text = IMAGE.sub(lambda match: match.group(1), text)
    return nc.CONTROL.sub("", text)[:limit]


# -- a chart --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Role:
    """A column a chart is drawn by: its name, what it does, and whether the chart needs it."""

    column: str
    role: str
    required: bool = True


def _drawn_block(block: nc.ChartBlock) -> tuple[nc.ChartBlock, list[str]]:
    """``block`` with the columns it is drawn by written out, read off its rows, and those
    columns in the table's order. A block with no row says them already, and keeps its header."""
    table = block.table
    kind = nc.effective_kind(block)
    out = replace(block, extra=dict(block.extra), only=list(block.only))
    if table is None or not table.headers or kind is None:
        return out, []
    headers = list(table.headers)
    if not table.cells:
        # a template already: its header is the columns its lines name, a column none names left out
        named = [role.column for role in chart_roles(block)]
        if not named:
            return out, headers
        held = {_fold(header): header for header in headers}
        return out, [held.get(_fold(name), name) for name in named]
    used: set[int] = set()
    reading = nc.read(block)
    if kind.name in TYPED:
        used = {index for index in (0, 1) if index < len(headers)}
    elif kind.name == "timeline":
        start, until, what = notes_chart_timeline.timeline_columns(reading)
        used = {index for index in (start, what, until) if index is not None}
        out.by = headers[what] if what is not None else ""
        out.count = ""
        if reading.colour is not None and block.colour_by:
            used.add(reading.colour)
    elif kind.name == "line":
        x, y, _ = kinds_module._line_columns(reading)
        used = {index for index in (x, y) if index is not None}
        out.by = headers[x] if x is not None else ""
        out.count = headers[y] if y is not None else ""
        if reading.colour is not None and block.colour_by:
            used.add(reading.colour)
            out.colour_by = headers[reading.colour]
    else:
        out.count = headers[reading.count] if reading.count is not None else ROWS
        if reading.count is not None:
            used.add(reading.count)
        drawn = reading.colour if kind.parts and reading.colour is not None and block.colour_by else reading.by
        if kind.parts:
            if drawn is not None:
                out.by = headers[drawn]
                used.add(drawn)
            out.colour_by = ""
        else:
            if reading.by is not None:
                out.by = headers[reading.by]
                used.add(reading.by)
            if reading.colour is not None and block.colour_by:
                out.colour_by = headers[reading.colour]
                used.add(reading.colour)
    for key in ("icon", "flag"):
        at = table.column(block.extra.get(key, ""))
        if at is not None:
            used.add(at)
    for only in block.only:
        at = table.column(only.column)
        if at is not None:
            used.add(at)
    return out, [headers[index] for index in sorted(used)]


def _header_only(block: nc.ChartBlock, columns: Sequence[str]) -> nc.Table | None:
    if not columns:
        return None
    table = block.table
    align = []
    for name in columns:
        at = table.column(name) if table is not None else None
        align.append(table.align[at] if table is not None and at is not None and at < len(table.align) else "")
    text = nc.table_text(list(columns), [], align)
    return nc.Table(list(columns), [], align, text.split("\n"), 0, True)


def _without_numbers(value: str) -> str:
    """A waffle's whole named as a row, never a number of the case's."""
    return "" if isinstance(nc.read_number(value), nc.Number) else value


def chart_template(text: str) -> str:
    """A chart's block as a template keeps it (module docstring): its kind, its settings and
    the columns it is drawn by, its table's header and no row."""
    body = _inner(text, CHART_OPEN)
    if body is None:
        raise TemplateError("a chart template holds one ::: chart block")
    block = nc.parse_block(body)
    drawn, columns = _drawn_block(block)
    extra = {key: value for key, value in drawn.extra.items() if value}
    if "of" in extra:
        extra["of"] = _without_numbers(extra["of"])
    kept = nc.ChartBlock(
        kind=drawn.kind, count=drawn.count, by=drawn.by, colour_by=drawn.colour_by, order=drawn.order,
        colours=drawn.colours, only=drawn.only, highlight=drawn.highlight, sort=drawn.sort, last=drawn.last,
        show=drawn.show, style=drawn.style, bars=drawn.bars,
        extra={key: value for key, value in extra.items() if value},
        table=_header_only(drawn, columns),
    )
    return nc.block_text(kept)


def chart_roles(block: nc.ChartBlock) -> list[Role]:
    """The columns a chart template is drawn by, as its lines name them, in its table's
    order: what it counts, by and colours by; a timeline's day, words and end; a line's
    days, values and series; the column naming each row's icon or flag, and a filter's."""
    kind = nc.effective_kind(block)
    if kind is None or kind.name in TYPED:
        return []
    headers = list(block.table.headers) if block.table is not None else []
    roles: list[Role] = []

    def add(name: str, role: str, required: bool = True) -> None:
        if name and _fold(name) not in {_fold(one.column) for one in roles}:
            roles.append(Role(name, role, required))

    if kind.name == "timeline":
        what = block.by or next((header for header in headers[1:] if not UNTIL.search(header)), "")
        when = next((header for header in headers if _fold(header) != _fold(what) and not UNTIL.search(header)), "")
        add(when, "when")
        add(what, "what")
        add(next((header for header in headers if UNTIL.search(header) and _fold(header) not in (_fold(when), _fold(what))), ""),
            "until", False)
        add(block.colour_by, "colour by", False)
    elif kind.name == "line":
        add(block.by, "along")
        add(block.count if block.count != ROWS else "", "value")
        add(block.colour_by, "series", False)
    else:
        if block.count and block.count != ROWS:
            add(block.count, "count")
        add(block.by, "parts" if kind.parts else "by")
        add(block.colour_by, "colour by")
    for key in ("icon", "flag"):
        word = block.extra.get(key, "")
        if any(_fold(word) == _fold(header) for header in headers):
            add(word, key, False)
    for only in block.only:
        add(only.column, "only", False)
    order = {_fold(header): index for index, header in enumerate(headers)}
    return sorted(roles, key=lambda role: order.get(_fold(role.column), len(order)))


# -- a map ----------------------------------------------------------------------------------------


def map_template(text: str) -> str:
    """A map's block as a template keeps it: how it is shown, never what or where."""
    body = _inner(text, MAP_OPEN)
    if body is None:
        raise TemplateError("a map template holds one ::: map block")
    read = nm.parse_block(body)
    kept = nm.MapBlock(base=read.base, proof_points=read.proof_points, labels=read.labels, crowds=read.crowds,
                       north=read.north, scale=read.scale, timeline=read.timeline, speed=read.speed, card=read.card,
                       size=read.size, legend=read.legend)
    return nm.block_text(kept)


def map_settings(text: str) -> dict[str, str]:
    """A map template's settings as the map card writes them, every one it keeps: its value,
    or '' for one it leaves at the default, so applying it sets the whole look."""
    body = _inner(map_template(text), MAP_OPEN) or ""
    said = {key: "" for key in MAP_KEYS}
    for line in body.split("\n"):
        key, _, value = line.partition(":")
        key = " ".join(key.split()).lower()
        if key in said:
            said[key] = value.strip()
    return said


# -- an infographic -------------------------------------------------------------------------------


def infographic_template(text: str, *, from_case: bool = False) -> str:
    """An infographic's block as a template keeps it (module docstring). ``from_case``
    leaves the band's and the words panels' words with the case."""
    body = _inner(text, ni.OPEN, ni.CLOSE)
    if body is None:
        raise TemplateError("an infographic template holds one :::: infographic block")
    graphic = ni.parse_block(body)
    lines = [":::: infographic"]
    if not from_case:
        for key in ("kicker", "title", "standfirst"):
            value = " ".join(_clean(getattr(graphic, key), ni.MAX_TEXT).split())
            if value:
                lines.append(f"{key}: {value}")
    if graphic.look:
        lines.append(f"look: {graphic.look}")
    if not graphic.shared_legend():
        lines.append(f"legend: {ni.EACH_PANEL}")
    panels: list[tuple[str, ni.Panel]] = []
    for panel in graphic.panels:
        if panel.kind == ni.CHART:
            made = chart_template(panel.text)
        elif panel.kind == ni.MAP:
            made = map_template(panel.text)
        else:
            made = WORDS_PANEL if from_case else _clean(panel.body).strip() or WORDS_PANEL
        panels.append((made, panel))
    widths = [panel.width for _, panel in panels]
    defaults = [ni.default_width(ni.Panel(panel.kind, _inner(made, ni.INNER_OPEN) or made, 0)) for made, panel in panels]
    if widths != defaults:
        lines.append(f"widths: {', '.join(widths)}")
    if panels:
        lines.append("")
        lines.append("\n\n".join(made for made, _ in panels))
    lines.append("::::")
    return "\n".join(lines)


# -- one gate for every template --------------------------------------------------------------------


EMPTY = {
    "infographic": ":::: infographic\n::::",
    "chart": "::: chart\nkind: bars\n:::",
    "map": "::: map\n:::",
}


def canonical(figure: str, text: str, *, from_case: bool = False) -> str:
    """A template's text as it is kept, whatever was sent: the gate every save passes."""
    if figure not in FIGURES:
        raise TemplateError(f"no figure is called {figure!r}")
    if not str(text or "").strip():
        return EMPTY[figure]
    if figure_of(text) != figure:
        raise TemplateError(f"a {figure} template holds a {figure} block")
    if figure == "infographic":
        return infographic_template(text, from_case=from_case)
    if figure == "chart":
        return chart_template(text)
    return map_template(text)


class TemplateData(BaseModel):
    """A figure template as ``templates.json`` keeps it (`api/templates.py`)."""

    model_config = ConfigDict(extra="ignore")

    figure: Figure
    text: str = Field(default="", max_length=MAX_TEXT)

    @model_validator(mode="after")
    def _kept_as_a_template(self) -> "TemplateData":
        try:
            self.text = canonical(self.figure, self.text)
        except TemplateError as exc:
            raise ValueError(str(exc)) from exc
        if len(self.text) > MAX_TEXT:
            raise ValueError("a figure template is too long")
        return self


def from_block(text: str) -> dict[str, str]:
    """A figure of a case as a template: ``{figure, text, name}``, its data left with the case."""
    figure = figure_of(text)
    if not figure:
        raise TemplateError("pick an infographic, a chart or a map")
    made = canonical(figure, text, from_case=True)
    return {"figure": figure, "text": made, "name": proposed_name(figure, made)}


def proposed_name(figure: str, text: str) -> str:
    """What a template is first called, from what it holds."""
    if figure == "chart":
        kind = nc.effective_kind(nc.parse_block(_inner(text, CHART_OPEN) or ""))
        return f"{kind.label if kind else 'Bars'} chart"
    if figure == "map":
        return "Map settings"
    count = len(ni.parse_block(_inner(text, ni.OPEN, ni.CLOSE) or "").panels)
    return f"Infographic of {count} panel{'' if count == 1 else 's'}"


# -- the ready ones ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Ready:
    """A template the app ships: neutral, generic, holding no case's data."""

    id: str
    name: str
    about: str
    text: str

    def record(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "about": self.about, "data": {"figure": "infographic", "text": self.text}}


def _chart(*lines: str) -> str:
    return "\n".join(["::: chart", *lines, ":::"])


_FIGURES_PANEL = _chart("kind: key figures", "| Figure | What it says |", "| --- | --- |")
_TIMELINE_PANEL = _chart("kind: timeline", "by: What happened", "| Date | What happened |", "| --- | --- |")


def _page(widths: str, *panels: str) -> str:
    return "\n".join([":::: infographic", "look: report", f"widths: {widths}", "", "\n\n".join(panels), "::::"])


READY: tuple[Ready, ...] = (
    Ready(
        "losses-at-a-glance", "Losses at a glance",
        "Key figures, pictograms by grade, a donut, segments and a timeline",
        _page("wide, half, half, wide, wide",
              _FIGURES_PANEL,
              _chart("kind: pictograms", "count: rows", "by: Grade", "| Grade |", "| --- |"),
              _chart("kind: donut", "count: rows", "by: Status", "| Status |", "| --- |"),
              _chart("kind: segments", "count: rows", "by: Type", "| Type |", "| --- |"),
              _TIMELINE_PANEL),
    ),
    Ready(
        "a-front-on-a-map", "A front on a map",
        "A map, key figures and a timeline",
        _page("wide, wide, wide",
              "\n".join(["::: map", "north: on", "legend: shown", ":::"]),
              _FIGURES_PANEL,
              _TIMELINE_PANEL),
    ),
    Ready(
        "who-supplied-them", "Who supplied them",
        "Silhouette rows with their flags, and a donut",
        _page("wide, half",
              _chart("kind: silhouette rows", "count: rows", "by: Supplier", "icon: armoured vehicle", f"flags: {EACH}",
                     "| Supplier |", "| --- |"),
              _chart("kind: donut", "count: rows", "by: Supplier", "| Supplier |", "| --- |")),
    ),
)


def ready() -> list[dict[str, Any]]:
    return [one.record() for one in READY]


# -- the columns --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Use:
    """Where a template reads a column: its panel (0 for a chart alone), the panel's kind, the role."""

    panel: int
    kind: str
    role: str
    required: bool


@dataclass
class Need:
    """A column a template reads, every place it does."""

    column: str
    uses: list[Use] = field(default_factory=list)

    @property
    def required(self) -> bool:
        return any(use.required for use in self.uses)

    @property
    def counts(self) -> bool:
        """Whether it is what a chart counts, so counting the data's rows may stand for it."""
        return any(use.role in ("count",) for use in self.uses)

    def said(self) -> dict[str, Any]:
        return {"column": self.column, "required": self.required, "counts": self.counts,
                "uses": [{"panel": use.panel, "kind": use.kind, "role": use.role} for use in self.uses]}


def _charts(figure: str, text: str) -> list[tuple[int, nc.ChartBlock]]:
    if figure == "chart":
        return [(0, nc.parse_block(_inner(text, CHART_OPEN) or ""))]
    if figure != "infographic":
        return []
    graphic = ni.parse_block(_inner(text, ni.OPEN, ni.CLOSE) or "")
    return [(index, nc.parse_block(panel.body)) for index, panel in enumerate(graphic.panels) if panel.kind == ni.CHART]


def needs(figure: str, text: str) -> list[Need]:
    """Every column a template reads, the same name once, in the order its panels read them."""
    found: dict[str, Need] = {}
    for index, block in _charts(figure, text):
        kind = nc.effective_kind(block)
        for role in chart_roles(block):
            need = found.setdefault(_fold(role.column), Need(role.column))
            need.uses.append(Use(index, kind.label if kind else "Bars", role.role, role.required))
    return list(found.values())


def match(wanted: Sequence[Need], columns: Sequence[str]) -> dict[str, str]:
    """Each column the template reads, given the data's column of the same name; a column
    the data does not name is left out, to be asked."""
    held = {_fold(column): column for column in columns}
    return {need.column: held[_fold(need.column)] for need in wanted if _fold(need.column) in held}


def suggest(column: str, columns: Sequence[str]) -> str:
    """The data's one column whose name holds the template's whole, or is held in it
    (*Grade* in *Confidence grade*); '' when none or two do. A suggestion, said and asked."""
    wanted = _fold(column)
    if not wanted:
        return ""
    near = [one for one in columns if _fold(one) and (f" {wanted} " in f" {_fold(one)} " or f" {_fold(one)} " in f" {wanted} ")]
    return near[0] if len(near) == 1 else ""


# -- applying one ---------------------------------------------------------------------------------------


@dataclass
class Data:
    """The data a template meets: its table and where it is from (``sheet:<id>``…)."""

    table: nc.Table
    origin: str = ""

    def values(self, column: str) -> set[str]:
        at = self.table.column(column)
        if at is None:
            return set()
        return {_fold(row[at]) for row in self.table.rows if at < len(row) and row[at].strip()}

    def column_values(self, column: str) -> list[str]:
        at = self.table.column(column)
        seen: dict[str, str] = {}
        if at is None:
            return []
        for row in self.table.rows:
            if at < len(row) and row[at].strip():
                seen.setdefault(_fold(row[at]), row[at])
        return list(seen.values())


def data_of(table_text: str, origin: str = "") -> Data | None:
    """The data's table read as a chart reads one, None for none."""
    lines = [line for line in str(table_text or "").split("\n") if line.strip().startswith("|")]
    if not lines:
        return None
    table = nc.parse_block("\n".join(lines)).table
    if table is None or not table.headers:
        return None
    return Data(table, origin)


def _icon_library() -> list[tuple[str, str]]:
    """The analyst's icons as ``(key, name)``, for a flag found by its name."""
    from . import iconlibrary

    try:
        listing = iconlibrary.listing()
    except Exception:  # an unreadable library finds no flag; the card picks them by hand
        return []
    return [(str(icon.get("key", "")), str(icon.get("name", ""))) for icon in listing.get("icons", [])]


def _named_like(value: str, icons: Sequence[tuple[str, str]]) -> str:
    """The icon whose name names ``value`` (the card's own rule, `chartIcons.matchByName`):
    the same name, else the one whose name stands whole in the value's or the value's in
    its, the longest; '' when none, or two of that length differ."""
    def fold(text: str) -> str:
        import unicodedata

        bare = "".join(char for char in unicodedata.normalize("NFKD", text) if not unicodedata.combining(char))
        return " ".join(re.sub(r"[^\w]+|_", " ", bare.casefold()).split())

    wanted = fold(value)
    if not wanted:
        return ""
    named = [(key, fold(name)) for key, name in icons if len(fold(name)) >= 2]
    same = next((key for key, name in named if name == wanted), "")
    if same:
        return f"own:{same}"
    near = [(key, name) for key, name in named if f" {name} " in f" {wanted} " or f" {wanted} " in f" {name} "]
    if not near:
        return ""
    longest = max(len(name) for _, name in near)
    best = {key for key, name in near if len(name) == longest}
    return f"own:{best.pop()}" if len(best) == 1 else ""


def _pairs_held(text: str, held: set[str]) -> str:
    kept = [f"{name} = {word}" for name, word in kinds_module.glyph_pairs(text) if word and _fold(name) in held]
    return ", ".join(kept)


@dataclass
class Applied:
    """A chart applied: its block, whether it reads the data, and what it says it left out."""

    block: nc.ChartBlock
    reads: str
    notes: list[str] = field(default_factory=list)


def _own(block: nc.ChartBlock) -> Applied:
    """A chart left to its own form: its columns and no row, never the page's data."""
    extra = {key: value for key, value in block.extra.items() if key not in VALUE_PAIRS and key != "of"}
    if extra.get("centre", "").casefold() not in ("", "total", "none"):
        extra.pop("centre", None)
    if extra.get("center", "").casefold() not in ("", "total", "none"):
        extra.pop("center", None)
    own = replace(block, extra=extra, only=[], highlight=[], last=[], own_rows=True, origin="", title="")
    return Applied(own, "own")


def apply_chart(block: nc.ChartBlock, data: Data | None, given: Mapping[str, str], rows_for: Sequence[str],
                *, icons: Sequence[tuple[str, str]] | None = None) -> Applied:
    """A template's chart drawn from ``data``: its columns renamed to the data's (``given``,
    and ``rows_for`` the columns counted as rows), the data's rows in, the values it does not
    hold dropped, the title its rows propose; or its own form when a column it needs is not
    given or there is no data."""
    kind = nc.effective_kind(block)
    roles = chart_roles(block)
    counted = {_fold(name) for name in rows_for}
    if data is None or kind is None or kind.name in TYPED:
        return _own(block)
    for role in roles:
        if role.required and not given.get(role.column) and not (role.role == "count" and _fold(role.column) in counted):
            return _own(block)
    present = {_fold(column) for column in data.table.headers}
    mapped = {role.column: given[role.column] for role in roles if given.get(role.column) and _fold(given[role.column]) in present}
    notes: list[str] = []
    out = replace(block, extra=dict(block.extra), only=[], origin="", own_rows=False, title="", caption="", source="")
    if block.count and block.count != ROWS:
        out.count = ROWS if _fold(block.count) in counted else mapped.get(block.count, "")
    out.by = mapped.get(block.by, "") if block.by else ""
    out.colour_by = mapped.get(block.colour_by, "") if block.colour_by else ""
    for key in ("icon", "flag"):
        word = block.extra.get(key, "")
        if word and any(_fold(word) == _fold(role.column) for role in roles):
            if word in mapped:
                out.extra[key] = mapped[word]
            else:
                out.extra.pop(key, None)
    for only in block.only:
        column = mapped.get(only.column, "")
        values = data.values(column) if column else set()
        kept = tuple(value for value in only.values if _fold(value) in values)
        if column and kept:
            out.only.append(nc.Only(column, kept, only.negate))
        else:
            notes.append(f"its filter on {only.column} is left out")
    drawn = [column for column in (out.colour_by, out.by) if column]
    held: set[str] = set()
    for column in drawn:
        held |= data.values(column)
    if out.order and not any(_fold(value) in held for value in out.order):
        out.order = []
    out.colours = {name: colour for name, colour in out.colours.items() if _fold(name) in held}
    out.highlight = [value for value in out.highlight if _fold(value) in held]
    out.last = [value for value in out.last if _fold(value) in held]
    for key in ("centre", "center", "of"):
        word = out.extra.get(key, "")
        if word and word.casefold() not in ("total", "none") and _fold(word) not in held:
            out.extra.pop(key, None)
    parts = out.colour_by if kind.parts and out.colour_by else out.by
    for key in VALUE_PAIRS:
        said = out.extra.get(key, "")
        if not said:
            continue
        if said.strip().casefold() == EACH:
            library = list(icons if icons is not None else _icon_library())
            found = [(value, _named_like(value, library)) for value in data.column_values(parts)] if parts else []
            pairs = [f"{value} = {word}" for value, word in found if word]
            if pairs:
                out.extra[key] = ", ".join(pairs)
            else:
                out.extra.pop(key, None)
                notes.append(f"no {'flag' if key == 'flags' else 'icon'} of your library is named like these rows: pick each in its card")
        else:
            kept_pairs = _pairs_held(said, held)
            if kept_pairs:
                out.extra[key] = kept_pairs
            else:
                out.extra.pop(key, None)
    out.table = data.table
    reading = nc.read(out)
    out.title = picker.title_for(reading)
    return Applied(out, "data", notes)


def apply(figure: str, text: str, *, table_text: str = "", origin: str = "", given: Mapping[str, str] | None = None,
          rows_for: Sequence[str] = (), icons: Sequence[tuple[str, str]] | None = None) -> dict[str, Any]:
    """A template applied (module docstring). ``given`` maps a template's column to the
    data's ('' to fill it by hand); a column it leaves out is matched by name.

    An infographic answers ``{text, panels}``: the page's block, ``data:`` naming
    ``origin``, and what each panel reads (``data``, ``own``, ``map`` or ``words``). A chart
    answers ``{changes}``, the settings its card writes over the chart's own table
    (``table_text``), its title, source and rows left as they are. A map answers
    ``{changes}``, every setting it keeps."""
    template = canonical(figure, text)
    data = data_of(table_text, origin)
    wanted = needs(figure, template)
    chosen: dict[str, str] = {}
    if data is not None:
        chosen.update(match(wanted, data.table.headers))
    for column, to in (given or {}).items():
        chosen[column] = to
    if figure == "map":
        return {"changes": map_settings(template)}
    if figure == "chart":
        block = nc.parse_block(_inner(template, CHART_OPEN) or "")
        if data is None:
            return {"changes": {}, "reads": "own", "notes": []}
        applied = apply_chart(block, data, chosen, rows_for, icons=icons)
        if applied.reads != "data":
            return {"changes": {}, "reads": "own", "notes": ["a column it needs was not given: nothing was changed"]}
        return {"changes": _chart_changes(block, applied.block), "reads": "data", "notes": applied.notes}
    graphic = ni.parse_block(_inner(template, ni.OPEN, ni.CLOSE) or "")
    lines = [":::: infographic"]
    if data is not None and origin:
        lines.append(f"data: {' '.join(origin.split())[:200]}")
    for key in ("kicker", "title", "standfirst"):
        if getattr(graphic, key):
            lines.append(f"{key}: {getattr(graphic, key)}")
    if graphic.look:
        lines.append(f"look: {graphic.look}")
    if not graphic.shared_legend():
        lines.append(f"legend: {ni.EACH_PANEL}")
    if "widths" in graphic.where:
        lines.append(f"widths: {', '.join(panel.width for panel in graphic.panels)}")
    texts: list[str] = []
    panels: list[dict[str, Any]] = []
    for index, panel in enumerate(graphic.panels):
        if panel.kind == ni.CHART:
            block = nc.parse_block(panel.body)
            applied = apply_chart(block, data, chosen, rows_for, icons=icons)
            texts.append(nc.block_text(applied.block))
            kind = nc.effective_kind(applied.block)
            panels.append({"index": index, "kind": kind.label if kind else "Bars", "reads": applied.reads, "notes": applied.notes})
        elif panel.kind == ni.MAP:
            texts.append(map_template(panel.text))
            panels.append({"index": index, "kind": "Map", "reads": "map", "notes": []})
        else:
            texts.append(panel.body)
            panels.append({"index": index, "kind": "Words", "reads": "words", "notes": []})
    if texts:
        lines.extend(["", "\n\n".join(texts)])
    lines.append("::::")
    return {"text": "\n".join(lines), "panels": panels}


#: The chart settings a template sets when it is applied to a chart: every one it keeps.
CHART_KEYS = ("kind", "count", "by", "colour by", "order", "colours", "highlight", "sort", "last", "show", "bars",
              "style", "icon", "icons", "flag", "flags", "per glyph", "centre", "of", "squares")


def _chart_changes(template: nc.ChartBlock, applied: nc.ChartBlock) -> dict[str, str]:
    """What a chart's card writes for a template applied to it: each setting the template
    keeps, its value or '' to take the chart's own out. Its filter only when the template has one."""
    kind = nc.effective_kind(applied)
    said = {
        "kind": kind.name if kind is not None and (applied.kind or applied.bars) else "",
        "count": applied.count, "by": applied.by, "colour by": applied.colour_by, "order": ", ".join(applied.order),
        "colours": ", ".join(f"{name} {colour}" for name, colour in applied.colours.items()),
        "highlight": ", ".join(applied.highlight), "sort": applied.sort, "last": ", ".join(applied.last),
        "show": applied.show, "bars": applied.bars, "style": applied.style,
    }
    for key in CHART_KEYS:
        if key not in said:
            said[key] = applied.extra.get(key, "")
    if template.only and applied.only:
        said["only"] = applied.only[0].text()
    return said
