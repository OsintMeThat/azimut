"""An infographic in a note: a page of panels, read as one figure.

An infographic is the reference's page (`.docs/n7-reference/infographic.png`): a title
band, then panels side by side, one source line under them. Each panel is a block that
also works alone, so the wrapper only lays them out and exports them as one picture:

    :::: infographic
    kicker: Bab al-Mandab, Yemen · October to November 2026
    title: At least 60 vehicles lost on one road, at least 41 of them armoured
    standfirst: Every figure is a minimum: it covers only what the two videos show.
    widths: wide, half, half, wide

    ::: chart
    kind: key figures
    | Figure | Words |
    …
    :::

    ::: chart
    kind: silhouette rows
    …
    :::

    ### Where they lie
    Six groups, none wider than 1.3 km.

    ::: map
    layer: Vehicles and route
    ground: e_7d1e0a
    :::
    ::::

The outer fence has four colons (Pandoc's nesting), so every inner block keeps its own
syntax and reads the same if moved out. The wrapper's own lines are only these, written
before its first panel (`KEYS`):

- ``kicker``, ``title``, ``standfirst``: the title band;
- ``look``: the page's look, report, book or dark (`notes_charts.STYLES`), one for every
  panel; left out, the note's Look decides as it does for a chart;
- ``widths``: each panel's width in reading order, ``half`` or ``wide``. A panel past
  the list takes its kind's (`default_width`): words, key figures and a timeline span
  the page, the rest take a column;
- ``legend``: ``each panel`` to keep one legend per chart. Left out, charts that colour by
  the same column (Grade) share one legend at the top, every value of it kept;
  a column's name asks for that one;
- ``data``: what the page's charts are drawn from, named as a chart's ``from:`` names it
  (`engine/notecharts.py`): ``sheet:<id>`` (a sheet of the case, the usual), or
  ``note:<id>#<heading>`` (a table of a note).

**The data.** A chart panel with no ``from:`` of its own, whose columns the data all
holds, *inherits* it (`inherits`): its rows are still copied in, so the page reads the same
tomorrow, and the data says when they moved on. A panel whose columns the data does not
hold (key figures typed in) keeps its own rows; one with its own ``from:`` keeps its own
source. *Read again (all panels)* is the editor's: it copies the data's rows into every
panel that inherits it, as one change.

**The panels**, in the text's order: a `::: chart` block, a `::: map` block, or words
(the headings and paragraphs between two blocks, one panel). A wide panel spans the
page; half panels fill the shorter of two columns, so a tall panel stands beside two
short ones as in the reference. A wide panel starts below both columns (`Band`).

**Honesty holds across the page.** Every chart keeps its own checks (an *at least* title,
its grades, what a filter left out), except that a title band saying the figures are
floors says it for every panel (`says_floor`): each guarantee stated once. The page adds:
a title that states a number when a panel counts a floor must say *at least*; one colour per value on the whole page, the
first panel's choice kept by the next (`_shared_palette`); one legend for a shared
column, a zero value kept; one credit line gathered from every panel's sources and the
map's imagery, never written twice (`credits_of`). A page with no source says so.

**One layout, every destination.** `read` lays the page out `PAGE_WIDTH` CSS pixels
wide, its panels in `Band`s. `compose` turns it into one `notes_charts.Layout`, so the
two chart painters draw the whole page (`svg`, `notes_charts.render_png`); a picture of a
fixed shape (X at 16:9, 4:5, 1:1) sets the bands side by side in strips until the page
is as near that shape as it gets, and pads the rest with paper (`picture`). The PDF
breaks the page between bands only (`chunks`). The HTML report lays the same columns out
as a grid of the panels' own SVG, map and words (`engine/notes_html.py`).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field, replace
from itertools import combinations
from typing import TYPE_CHECKING, Any, Mapping, Sequence

from . import notes_chart_kinds as kinds_module
from . import notes_charts as nc
from . import notes_maps

if TYPE_CHECKING:
    from ..workspace import Case
    from .notelook import NoteLook

#: The block's name, and the token the Markdown reading hands each renderer for it.
BLOCK = "infographic"
TOKEN = "az_infographic"
OPEN = re.compile(r"^::::[ \t]*infographic[ \t]*$")
CLOSE = re.compile(r"^::::[ \t]*$")
INNER_OPEN = re.compile(r"^:::[ \t]*(chart|map)[ \t]*$")
INNER_CLOSE = re.compile(r"^:::[ \t]*$")

CHART = "chart"
MAP = "map"
WORDS = "words"
HALF = "half"
WIDE = "wide"
WIDTHS = (HALF, WIDE)
#: What ``legend:`` says to keep one legend per chart.
EACH_PANEL = "each panel"

#: The wrapper's settings, by every way they may be written, to the one word written.
KEYS: dict[str, str] = {
    "kicker": "kicker", "eyebrow": "kicker",
    "title": "title", "headline": "title",
    "standfirst": "standfirst", "subtitle": "standfirst", "dek": "standfirst", "intro": "standfirst",
    "look": "look", "style": "look",
    "widths": "widths", "width": "widths", "panels": "widths",
    "legend": "legend",
    "data": "data",
}
#: The order the Notebook writes them in.
WRITTEN_ORDER = ("data", "kicker", "title", "standfirst", "look", "legend", "widths")

#: What one infographic may hold.
MAX_PANELS = 16
MAX_TEXT = 400
MAX_BODY = 512 * 1024

#: The page's width and its spacing, in CSS pixels: the reference's measure.
PAGE_WIDTH = 1200.0
MARGIN = 48.0
GUTTER = 44.0
GAP = 36.0
#: The width the HTML page lays it out at: its panels drawn at the size they are read.
HTML_WIDTH = 1000.0
#: Strips of bands a picture of a fixed shape may set side by side.
MAX_STRIPS = 4
STRIP_GAP = 64.0
#: The sizes the title band and the words are set at.
KICKER_SIZE = 13.0
TITLE_SIZE = 34.0
STANDFIRST_SIZE = 17.0
HEADING_SIZE = 22.0
SMALL_HEADING_SIZE = 18.0
WORDS_SIZE = 15.0
SOURCES_SIZE = 12.0
#: How sharp a map panel's picture is, against its width on the page.
MAP_PIXELS = 2.0
MAP_PIXELS_LIGHT = 1.0
MAX_MAP_PIXELS = 2400

#: The pictures a destination asks for: its shape, and how many pixels a CSS pixel takes.
#: The page is the PDF's frame at print resolution; the others are X's shapes.
DESTINATIONS: dict[str, tuple[str, float | None, float]] = {
    "page": ("PDF page", None, 2.0),
    "x": ("X, 16:9", 16 / 9, 2.0),
    "portrait": ("4:5", 4 / 5, 2.0),
    "square": ("1:1", 1.0, 2.0),
}
#: The widest and the tallest picture made, in pixels, as the painter draws them.
MAX_PICTURE = 4000
MAX_TALL = 8000
MIN_PICTURE = 1080

#: The kinds that span the page unless the wrapper says otherwise.
WIDE_KINDS = ("key figures", "timeline")
NO_PANEL = "The infographic holds no panel: put a chart, a map or a few words inside it."
NO_SOURCE = "The infographic names no source: give its charts a source line."
DATA_GONE = ("The infographic's data is no longer in the case: its panels keep the rows they copied, but cannot "
             "read them again. Change its data, or name it again.")

SETTING_LINE = re.compile(r"^([A-Za-z][A-Za-z ]{0,24}?)\s*:\s?(.*)$")
COMMENT_ONLY = re.compile(r"^\s*(?:<!--.*?-->\s*)+$", re.S)
NUMBER_WORD = re.compile(r"\d")
SOURCE_PREFIX = re.compile(r"^(?:sources?|credits?)\s*:\s*", re.I)


# -- the block ---------------------------------------------------------------------------------------


@dataclass
class Panel:
    """One panel as written: what it is, its lines, and where it starts in the wrapper."""

    kind: str
    #: A chart's or a map's lines inside its fences; a words panel's own text.
    body: str
    #: The wrapper's line its first line is on (0 for the line after ``:::: infographic``).
    line: int
    #: ``half`` or ``wide`` as ``widths`` writes it, or "".
    written: str = ""
    #: What it takes: as written, else its kind's.
    width: str = HALF

    @property
    def text(self) -> str:
        """The panel as it reads alone: a block with its fences, or the words."""
        return f"::: {self.kind}\n{self.body}\n:::" if self.kind in (CHART, MAP) else self.body


@dataclass
class Infographic:
    """One `:::: infographic` block as written."""

    kicker: str = ""
    title: str = ""
    standfirst: str = ""
    look: str = ""
    legend: str = ""
    #: What its charts are drawn from: ``sheet:<id>`` or ``note:<id>#<anchor>``, or "".
    data: str = ""
    widths: list[str] = field(default_factory=list)
    panels: list[Panel] = field(default_factory=list)
    #: Lines it could not read, as ``(line, text, why)``.
    unread: list[tuple[int, str, str]] = field(default_factory=list)
    #: Where each setting was written.
    where: dict[str, int] = field(default_factory=dict)

    def shared_legend(self) -> bool:
        return self.legend.casefold() != EACH_PANEL


def _clean(value: str, limit: int = MAX_TEXT) -> str:
    return nc._cut(nc.CONTROL.sub("", " ".join(str(value or "").split())), limit)


def default_width(panel: Panel) -> str:
    """The width a panel takes when the wrapper does not say: words, key figures and a
    timeline span the page, every other panel a column."""
    if panel.kind == WORDS:
        return WIDE
    if panel.kind == CHART:
        kind = nc.effective_kind(nc.parse_block(panel.body))
        if kind is not None and kind.name in WIDE_KINDS:
            return WIDE
    return HALF


def parse_block(body: str) -> Infographic:
    """A wrapper's lines, read: its settings, then its panels in order."""
    graphic = Infographic()
    lines = str(body or "")[:MAX_BODY].split("\n")
    index = 0
    # the settings: known `key: value` lines before the first panel, blank lines between them
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue
        found = SETTING_LINE.match(line)
        key = KEYS.get(" ".join(found.group(1).split()).casefold()) if found else None
        if found is None or key is None or INNER_OPEN.match(line):
            break
        value = found.group(2)
        graphic.where.setdefault(key, index)
        if key == "widths":
            if not graphic.widths:
                for word in [part.strip().casefold() for part in value.split(",") if part.strip()]:
                    if word in WIDTHS:
                        graphic.widths.append(word)
                    else:
                        graphic.widths.append("")
                        graphic.unread.append((index, line[:120], f'"{word[:40]}" is no width: write half or wide'))
        elif key == "data":
            said = " ".join(value.split())[:200]
            if _data_known(said):
                graphic.data = graphic.data or said
            else:
                graphic.unread.append((index, line[:120], f'"{said[:40]}" is no data: name a sheet (sheet:<id>) or a '
                                                          f"table (note:<id>#<heading>)"))
        elif key == "look":
            word = _clean(value).casefold()
            if word in nc.STYLES:
                graphic.look = graphic.look or word
            else:
                graphic.unread.append((index, line[:120], f'"{word[:40]}" is no look: write report, book or dark'))
        elif not getattr(graphic, key):
            setattr(graphic, key, _clean(value))
        index += 1
    words: list[str] = []
    words_line = index

    def close_words() -> None:
        text = "\n".join(words).strip("\n")
        # guidance alone (`<!--? … -->`) is no panel: it is never printed
        if text.strip() and not COMMENT_ONLY.match(text):
            first = next(offset for offset, line in enumerate(words) if line.strip())
            graphic.panels.append(Panel(WORDS, text, words_line + first))
        words.clear()

    while index < len(lines):
        line = lines[index]
        opened = INNER_OPEN.match(line)
        if opened is None:
            if not words:
                words_line = index
            words.append(line)
            index += 1
            continue
        end = index + 1
        while end < len(lines) and not INNER_CLOSE.match(lines[end]):
            end += 1
        if end >= len(lines):
            graphic.unread.append((index, line[:120], f"its {opened.group(1)} is never closed with :::"))
            words.extend(lines[index:])
            break
        close_words()
        graphic.panels.append(Panel(opened.group(1), "\n".join(lines[index + 1:end]), index))
        index = end + 1
        words_line = index
    close_words()
    if len(graphic.panels) > MAX_PANELS:
        extra = graphic.panels[MAX_PANELS]
        graphic.unread.append((extra.line, "", f"an infographic shows its first {MAX_PANELS} panels"))
        graphic.panels = graphic.panels[:MAX_PANELS]
    for position, panel in enumerate(graphic.panels):
        written = graphic.widths[position] if position < len(graphic.widths) else ""
        panel.written = written
        panel.width = written or default_width(panel)
    if len(graphic.widths) > len(graphic.panels):
        graphic.unread.append((graphic.where.get("widths", 0), "",
                               f"widths names {len(graphic.widths)} panels and the infographic holds "
                               f"{len(graphic.panels)}"))
    return graphic


@dataclass(frozen=True)
class Found:
    """An infographic in a note: its wrapper's lines (0-based, the fences included) and body."""

    first: int
    last: int
    body: str


def blocks_in(text: str) -> list[Found]:
    """Every infographic a note's text holds, outside code fences."""
    found: list[Found] = []
    lines = str(text or "").split("\n")
    fenced = False
    index = 0
    while index < len(lines):
        line = lines[index]
        if re.match(r"^\s*(```|~~~)", line):
            fenced = not fenced
        elif not fenced and OPEN.match(line):
            end = index + 1
            while end < len(lines) and not CLOSE.match(lines[end]):
                end += 1
            if end < len(lines):
                found.append(Found(index, end, "\n".join(lines[index + 1:end])))
                index = end
        index += 1
    return found


def block_of(text: str) -> str:
    """An infographic's lines from what the editor sends: the whole block with its
    fences, or its lines alone."""
    lines = str(text or "").strip("\n").split("\n")
    if lines and OPEN.match(lines[0]):
        lines = lines[1:]
        if lines and CLOSE.match(lines[-1]):
            lines = lines[:-1]
    return "\n".join(lines)


# -- the data ---------------------------------------------------------------------------------------


def _data_known(origin: str) -> bool:
    """Whether ``data:`` (or a chart's ``from:``) names something the case can read rows from."""
    from .notecharts import origin_known

    kind, _, rest = str(origin or "").partition(":")
    return bool(kind.strip()) and origin_known(origin) and bool(rest.strip())


def own_origin(panel: Panel) -> str:
    """A chart panel's own ``from:``, when it names a note's table or a sheet; else ""."""
    if panel.kind != CHART:
        return ""
    origin = nc.parse_block(panel.body).origin
    return origin if _data_known(origin) else ""


def _fold(header: str) -> str:
    return " ".join(nc.plain_cell(str(header)).split()).casefold()


def inherits(panel: Panel, columns: Sequence[str]) -> bool:
    """Whether a panel takes the page's data, whose columns are ``columns``: a chart with no
    ``from:`` of its own whose table's columns the data holds every one of, or which holds
    no table yet. A table with a column the data lacks (key figures typed in) is its own."""
    if panel.kind != CHART or own_origin(panel):
        return False
    table = nc.parse_block(panel.body).table
    if table is None or not table.headers:
        return True
    held = {_fold(column) for column in columns}
    return all(_fold(header) in held for header in table.headers if _fold(header))


def data_warnings(case: "Case", graphic: Infographic) -> list[tuple[str, str, int | None]]:
    """What the check says of where the page's rows came from, each at its line: its data no
    longer in the case, a panel that inherits it whose rows differ from it, and a panel's
    own ``from:`` gone or moved on (`notecharts.origin_warning`). Each source is read once."""
    from . import notecharts

    read: dict[str, tuple[str, list[str], list[list[str]]] | None] = {}

    def rows_of(_case: "Case", origin: str) -> tuple[str, list[str], list[list[str]]] | None:
        if origin not in read:
            read[origin] = notecharts.origin_rows(case, origin)
        return read[origin]

    out: list[tuple[str, str, int | None]] = []
    data = rows_of(case, graphic.data) if graphic.data else None
    if graphic.data and data is None:
        out.append((DATA_GONE, nc.MISSING, graphic.where.get("data")))
    for panel in graphic.panels:
        if panel.kind != CHART:
            continue
        block = nc.parse_block(panel.body)
        if block.table is None or not block.table.headers:
            continue
        if own_origin(panel):
            said = notecharts.origin_warning(case, block, read=rows_of)
            if said is not None:
                out.append(_offset(said, panel))
            continue
        if data is None or not inherits(panel, data[1]):
            continue
        name, headers, rows = data
        if notecharts.compare_rows(block.table, headers, rows) != notecharts.DIFFERS:
            continue
        chart = f'The chart "{nc._cut(block.title, 60)}"' if block.title else "A chart of the infographic"
        out.append(_offset((f'{chart}: its rows differ from the infographic\'s data, "{nc._cut(name, 40)}". '
                            f"Read again (all panels) brings them up to date.", nc.OTHER_KIND, None), panel))
    return out


# -- the page laid out -------------------------------------------------------------------------------


@dataclass
class Drawn:
    """A panel laid out: where it stands on the page and what it draws."""

    index: int
    panel: Panel
    #: Its box, in the page's CSS pixels, relative to its band's top.
    x: float
    y: float
    w: float
    h: float
    #: Which column a half panel fell in (0 or 1), -1 for a wide one.
    column: int
    marks: list[nc.Mark]
    #: A chart's own layout, in its own units (the HTML page draws it as SVG).
    chart: nc.Layout | None = None
    #: A map's data and pictures, read from the case.
    map: notes_maps.Derived | None = None
    title: str = ""
    #: What a screen reader is told of it, one line each.
    lines: list[str] = field(default_factory=list)
    credits: list[str] = field(default_factory=list)
    #: Whether a chart's legend is the page's shared one, so it draws none of its own.
    shares: bool = False


@dataclass
class Band:
    """Panels between two cuts no panel crosses: one wide panel, or a run of half ones."""

    panels: list[Drawn]
    height: float


@dataclass
class Page:
    """An infographic laid out: its title band, its bands of panels and its foot."""

    graphic: Infographic
    theme: nc.ChartTheme
    bands: list[Band]
    legend: list[nc.Swatch]
    #: The column the shared legend is for, as the first chart names it, or "".
    shared: str
    credits: list[str]
    #: What the check before export says: ``(message, kind, line in the wrapper body)``.
    warnings: list[tuple[str, str, int | None]]
    width: float = PAGE_WIDTH
    #: The colours every chart of it paints with, and the note around it.
    palette: list[dict[str, str]] = field(default_factory=list)
    note_text: str = ""

    @property
    def panels(self) -> list[Drawn]:
        return [drawn for band in self.bands for drawn in band.panels]

    @property
    def title(self) -> str:
        return self.graphic.title or next((drawn.title for drawn in self.panels if drawn.title), "")

    @property
    def credit(self) -> str:
        return "; ".join(self.credits)

    @property
    def alt(self) -> str:
        """The one picture's alt text: the title band, every panel's lines, the sources."""
        parts = [self.graphic.title, self.graphic.standfirst]
        for drawn in self.panels:
            said = ". ".join(part.rstrip(".") for part in [drawn.title, *drawn.lines] if part)
            parts.append(said)
        if self.credits:
            parts.append(f"Sources: {self.credit}")
        return nc._cut(" ".join(f"{part.rstrip('.')}." for part in parts if part), 1500)


def credits_of(credit: str) -> list[str]:
    """A chart's credit line as the sources it names, its ``Source:`` word taken off."""
    said = SOURCE_PREFIX.sub("", " ".join(str(credit or "").split())).strip().rstrip(".")
    return [part.strip() for part in said.split(";") if part.strip()]


def _merge(into: list[str], more: Sequence[str]) -> None:
    for one in more:
        if one and one.casefold() not in {kept.casefold() for kept in into}:
            into.append(one)


def theme_of(graphic: Infographic, look: "NoteLook | None") -> nc.ChartTheme:
    """The page's look: its own ``look``, else the one the note's Look asks of a chart."""
    from .notelook import DEFAULT

    look = look or DEFAULT
    return nc.theme_for(graphic.look or nc.preset_for(look.style), font=look.font)


def _shared_palette(graphic: Infographic, theme: nc.ChartTheme, palette: Sequence[Mapping[str, str]],
                    note_text: str) -> tuple[list[dict[str, str]], dict[int, nc.Reading]]:
    """The case's colours, plus every colour a chart chose for a value the case has none
    for, so the next chart paints that value the same: one colour per value on the page.
    A highlight paints for its own chart only."""
    kept: list[dict[str, str]] = [dict(entry) for entry in palette]
    readings: dict[int, nc.Reading] = {}
    for position, panel in enumerate(graphic.panels):
        if panel.kind != CHART:
            continue
        block = nc.parse_block(panel.body)
        if block.table is None:
            continue
        reading = nc.read(block, theme=theme, palette=kept, note_text=note_text)
        readings[position] = reading
        if block.highlight:
            continue
        named = {str(entry.get("name", "")).casefold() for entry in kept}
        for value, paint in reading.paints.items():
            if paint.origin == "order" and value and value.casefold() not in named:
                kept.append({"name": value, "colour": paint.colour})
    return kept, readings


def _shared_column(graphic: Infographic, readings: Mapping[int, nc.Reading]) -> str:
    """The colour column several charts' legends would say: theirs is drawn once, on top."""
    if not graphic.shared_legend():
        return ""
    counts: dict[str, int] = {}
    names: dict[str, str] = {}
    for reading in readings.values():
        if not reading.kind.legend or reading.colour is None or reading.table is None or reading.block.highlight:
            continue
        name = reading.table.headers[reading.colour]
        counts[name.casefold()] = counts.get(name.casefold(), 0) + 1
        names.setdefault(name.casefold(), name)
    asked = graphic.legend.casefold()
    if asked and asked in counts:
        return names[asked]
    best = max(counts.items(), key=lambda item: item[1], default=("", 0))
    return names[best[0]] if best[1] >= 2 else ""


def _shares(reading: nc.Reading | None, shared: str) -> bool:
    return bool(shared and reading is not None and reading.kind.legend and reading.colour is not None
                and reading.table is not None and not reading.block.highlight
                and reading.table.headers[reading.colour].casefold() == shared.casefold())


def read(case: "Case | None", body: str, *, look: "NoteLook | None" = None, palette: Sequence[Mapping[str, str]] | None = None,
         note_text: str = "", maps: bool = True, light: bool = False, width: float = PAGE_WIDTH,
         origins: bool = True) -> Page:
    """An infographic's lines laid out ``width`` CSS pixels wide, in the note's look and
    the case's colours. ``maps`` False reads a map's data without painting its picture or
    saying what its check finds: the HTML page draws and checks its maps as every map;
    ``light`` paints it smaller (the Page pane). ``origins`` False leaves where the rows
    came from to the editor, whose Data bar reads it as the note is typed (`data_warnings`)."""
    graphic = parse_block(body)
    theme = theme_of(graphic, look)
    if palette is None:
        palette = nc.case_palette(case) if case is not None else []
    colours, readings = _shared_palette(graphic, theme, palette, note_text)
    shared = _shared_column(graphic, readings)
    warnings: list[tuple[str, str, int | None]] = [(f"The infographic: {why}.", nc.OTHER_KIND, line)
                                                   for line, _, why in graphic.unread]
    content = width - 2 * MARGIN
    column = (content - GUTTER) / 2
    credits: list[str] = []
    legend: list[nc.Swatch] = []
    floors = False
    bands: list[Band] = []
    run: list[Drawn] = []
    heights = [0.0, 0.0]

    def close_run() -> None:
        if run:
            bands.append(Band(list(run), max(0.0, max(heights) - GAP)))
            run.clear()
            heights[0] = heights[1] = 0.0

    for position, panel in enumerate(graphic.panels):
        wide = panel.width == WIDE
        panel_width = content if wide else column
        drawn = Drawn(position, panel, 0.0, 0.0, panel_width, 0.0, -1, [])
        if panel.kind == CHART:
            reading = readings.get(position)
            shares = _shares(reading, shared)
            _chart_panel(drawn, theme, colours, note_text, shares, warnings, says_floor(graphic))
            if reading is not None:
                floors = floors or reading.floor
                if shares:
                    for swatch in drawn.chart.legend if drawn.chart is not None else []:
                        if swatch.value.casefold() not in {kept.value.casefold() for kept in legend}:
                            legend.append(nc.Swatch(swatch.value, swatch.paint, 0.0))
        elif panel.kind == MAP:
            _map_panel(drawn, case, theme, warnings, maps=maps, light=light)
        else:
            _words_panel(drawn, theme)
        _merge(credits, drawn.credits)
        if wide:
            close_run()
            drawn.x = MARGIN
            bands.append(Band([drawn], drawn.h))
            continue
        side = 0 if heights[0] <= heights[1] + 0.5 else 1
        drawn.column = side
        drawn.x = MARGIN + side * (column + GUTTER)
        drawn.y = heights[side]
        heights[side] += drawn.h + GAP
        run.append(drawn)
    close_run()
    if case is not None and origins:
        warnings.extend(data_warnings(case, graphic))
    if not graphic.panels:
        warnings.append((NO_PANEL, nc.OTHER_KIND, None))
    elif not credits:
        warnings.append((NO_SOURCE, nc.UNSOURCED, None))
    title = graphic.title
    if floors and title and NUMBER_WORD.search(title) and not nc.TITLE_FLOOR.search(title):
        warnings.append((f'The infographic "{nc._cut(title, 60)}" counts at least: say so in its title.',
                         nc.OTHER_KIND, graphic.where.get("title")))
    return Page(graphic, theme, bands, legend, shared, credits, warnings, width, colours, note_text)


def relaid(page: Page, drawn: Drawn, width: float) -> nc.Layout | None:
    """A chart panel laid out again at another width (a phone's), as the page draws it."""
    if drawn.panel.kind != CHART or drawn.chart is None:
        return None
    return nc.layout(nc.parse_block(drawn.panel.body), theme=page.theme, palette=page.palette,
                     note_text=page.note_text, width=width, title=True, legend=not drawn.shares, credit=False)


def _offset(warning: tuple[str, str, int | None], panel: Panel) -> tuple[str, str, int | None]:
    """A panel's own warning at its line in the wrapper: past its opening fence."""
    message, kind, line = warning
    if line is None:
        return message, kind, panel.line
    return message, kind, panel.line + (1 if panel.kind in (CHART, MAP) else 0) + line


def says_floor(graphic: Infographic) -> bool:
    """Whether the title band says the page's figures are floors: once said there, no
    panel needs to say *at least* again."""
    return bool(nc.TITLE_FLOOR.search(graphic.title) or nc.TITLE_FLOOR.search(graphic.standfirst)
                or nc.MINIMUM_NOTE.search(graphic.standfirst))


def _floor_title(check: nc.Check) -> bool:
    """A chart's check that its title should say *at least*."""
    return "counts at least" in check.message


def _chart_panel(drawn: Drawn, theme: nc.ChartTheme, palette: Sequence[Mapping[str, str]], note_text: str,
                 shares: bool, warnings: list[tuple[str, str, int | None]], floor_said: bool = False) -> None:
    block = nc.parse_block(drawn.panel.body)
    if block.table is None or not block.table.headers:
        warnings.append(_offset(("A chart of the infographic holds no table: write its rows under its settings.",
                                 nc.MISSING, None), drawn.panel))
        words = nc.Text(0, theme.title_size, "Chart not drawn: it holds no table.", theme.note_size, theme.muted,
                        body=True)
        drawn.marks, drawn.h = [words], theme.title_size + 8
        return
    pad = theme.pad
    chart = nc.layout(block, theme=theme, palette=palette, note_text=note_text, width=drawn.w + 2 * pad,
                      title=True, legend=not shares, credit=False)
    drawn.chart = chart
    drawn.shares = shares
    drawn.marks = [kinds_module.shifted(mark, -pad, -pad) for mark in chart.marks[1:]]
    drawn.h = max(0.0, chart.height - 2 * pad)
    drawn.title = chart.title
    drawn.lines = list(chart.lines)
    drawn.credits = credits_of(chart.credit)
    warnings.extend(_offset(check.as_warning(), drawn.panel) for check in chart.checks
                    if not (floor_said and _floor_title(check)))


def _map_panel(drawn: Drawn, case: "Case | None", theme: nc.ChartTheme,
               warnings: list[tuple[str, str, int | None]], *, maps: bool, light: bool) -> None:
    block = notes_maps.parse_block(drawn.panel.body)
    derived = notes_maps.derive(case, block)
    drawn.map = derived
    if maps:
        warnings.extend(_offset(warning, drawn.panel) for warning in derived.warnings)
    data = derived.data
    frame_w, frame_h = notes_maps.frame_of(list(data.get("bounds") or [-10, -10, 10, 10]))
    y = 0.0
    marks: list[nc.Mark] = []
    title = block.title or str(data.get("title") or "")
    if title:
        for line in kinds_module.lines_of(title.upper() if theme.caps_title else title, drawn.w, theme.title_size,
                                          theme.head, bold=True):
            y += theme.title_size * 1.05
            marks.append(nc.Text(0, y, line, theme.title_size, theme.ink, bold=True))
            y += theme.title_size * 0.28
        y += 12
    height = drawn.w * frame_h / frame_w
    if maps:
        pixels = min(MAX_MAP_PIXELS, round(drawn.w * (MAP_PIXELS_LIGHT if light else MAP_PIXELS)))
        picture = notes_maps.render_png(data, pixels, ground=derived.ground, icons=derived.icons, fmt="JPEG")
        marks.append(nc.Picture(0, y, drawn.w, height, picture))
    else:
        marks.append(nc.Rect(0, y, drawn.w, height, notes_maps.PLAIN_GROUND))
    drawn.marks = marks
    drawn.h = y + height
    drawn.title = title
    features = len(data.get("features") or [])
    drawn.lines = [f"A map of {features} feature{'s' if features != 1 else ''}"] if features else []
    drawn.credits = [str(one) for one in data.get("credits") or [] if one]


def words_of(text: str) -> list[tuple[str, str]]:
    """A words panel as ``(kind, text)`` lines: ``h1``–``h6``, ``p`` and ``li``, each its
    plain words (marks, links and chips read as their words)."""
    from . import notes_markdown

    out: list[tuple[str, str]] = []
    tokens = notes_markdown.parse(text)
    pending = ""
    for token in tokens:
        if token.type == "heading_open":
            pending = token.tag
        elif token.type == "list_item_open":
            pending = "li"
        elif token.type == "paragraph_open" and pending != "li":
            pending = "p"
        elif token.type == "inline":
            words = "".join(" " if child.type in ("softbreak", "hardbreak") else child.content
                            for child in token.children or [] if child.type in ("text", "code_inline", "softbreak",
                                                                                 "hardbreak"))
            words = _clean(words, 2000)
            if words:
                out.append((pending or "p", words))
        elif token.type in ("list_item_close", "heading_close"):
            pending = ""
    return out


def _words_panel(drawn: Drawn, theme: nc.ChartTheme) -> None:
    marks: list[nc.Mark] = []
    y = 0.0
    lines: list[str] = []
    for kind, words in words_of(drawn.panel.body):
        if kind.startswith("h"):
            size = HEADING_SIZE if kind in ("h1", "h2", "h3") else SMALL_HEADING_SIZE
            if y:
                y += 10
            for line in kinds_module.lines_of(words.upper() if theme.caps_title else words, drawn.w, size,
                                              theme.head, bold=True):
                y += size * 1.1
                marks.append(nc.Text(0, y, line, size, theme.ink, bold=True))
            y += 8
            if not drawn.title:
                drawn.title = words
        else:
            text = f"•  {words}" if kind == "li" else words
            # a column of words reads best at about 80 characters
            measure = min(drawn.w, 820.0)
            for line in kinds_module.lines_of(text, measure, WORDS_SIZE, theme.body):
                y += WORDS_SIZE * 1.45
                marks.append(nc.Text(0, y, line, WORDS_SIZE, theme.ink2, body=True))
            y += 6
        lines.append(words)
    drawn.marks = marks
    drawn.h = max(0.0, y - 4)
    drawn.lines = lines[1:] if drawn.title and lines and lines[0] == drawn.title else lines


# -- the whole page as one drawing ---------------------------------------------------------------------


def _header(page: Page, x: float, width: float) -> tuple[list[nc.Mark], float]:
    """The title band and the shared legend, laid from 0 down."""
    theme, graphic = page.theme, page.graphic
    marks: list[nc.Mark] = []
    y = 0.0
    if graphic.kicker:
        for line in kinds_module.lines_of(graphic.kicker.upper(), width, KICKER_SIZE, theme.head, bold=True):
            y += KICKER_SIZE * 1.3
            marks.append(nc.Text(x, y, line, KICKER_SIZE, theme.muted, bold=True))
        y += 10
    if graphic.title:
        title = graphic.title.upper() if theme.caps_title else graphic.title
        for line in kinds_module.lines_of(title, width, TITLE_SIZE, theme.head, bold=True):
            y += TITLE_SIZE * 1.1
            marks.append(nc.Text(x, y, line, TITLE_SIZE, theme.ink, bold=True))
        y += 6
        if theme.title_rule:
            y += 8
            marks.append(nc.Line(((x, y), (x + width, y)), theme.ink, 2.0))
            y += 4
    if graphic.standfirst:
        y += 8
        for line in kinds_module.lines_of(graphic.standfirst, min(width, 900.0), STANDFIRST_SIZE, theme.body):
            y += STANDFIRST_SIZE * 1.45
            marks.append(nc.Text(x, y, line, STANDFIRST_SIZE, theme.ink2, body=True))
    if page.legend:
        y += 22 if y else 0
        legend, used = kinds_module.names_legend(page.legend, theme, x, y, width, numbers=False)
        marks.extend(legend)
        y += used
    return marks, (y + 30 if marks else 0.0)


def legend_drawing(page: Page, width: float) -> nc.Layout:
    """The shared legend alone, ``width`` wide: the HTML page draws it over its panels."""
    theme = page.theme
    marks, height = kinds_module.names_legend(page.legend, theme, 0.0, 0.0, width, numbers=False)
    drawn_width = min(width, max((_right_edge(mark, theme) for mark in marks), default=0.0) + 2.0)
    paper = nc.Rect(0, 0, drawn_width, height + 4, theme.paper)
    return nc.Layout(drawn_width, round(height + 4, 2), theme, [paper, *marks], "Legend",
                     ", ".join(swatch.value for swatch in page.legend), [], page.legend, None, [], [], "", "legend",
                     [], [], [])


def _right_edge(mark: nc.Mark, theme: nc.ChartTheme) -> float:
    if isinstance(mark, nc.Group):
        return max((_right_edge(inner, theme) for inner in mark.marks), default=0.0)
    if isinstance(mark, nc.Text):
        return mark.x + nc.text_width(mark.text, mark.size, theme.head, mark.bold)
    if isinstance(mark, nc.Rect):
        return mark.x + mark.w
    return 0.0


def _foot(page: Page, x: float, width: float) -> tuple[list[nc.Mark], float]:
    """The one source line, under a rule, laid from 0 down."""
    if not page.credits:
        return [], 0.0
    theme = page.theme
    marks: list[nc.Mark] = [nc.Line(((x, 0.0), (x + width, 0.0)), theme.grid, 1.0)]
    head = "Sources." if len(page.credits) > 1 else "Source."
    said = f"{head} {sentence(page.credit)}"
    y = 12.0
    lead = nc.text_width(head, SOURCES_SIZE, theme.body, bold=True)
    for number, line in enumerate(kinds_module.lines_of(said, width, SOURCES_SIZE, theme.body)):
        y += SOURCES_SIZE * 1.5
        if number == 0 and line.startswith(head):
            marks.append(nc.Text(x, y, head, SOURCES_SIZE, theme.ink, bold=True, body=True))
            marks.append(nc.Text(x + lead + SOURCES_SIZE * 0.3, y, line[len(head):].strip(), SOURCES_SIZE,
                                 theme.muted, body=True))
        else:
            marks.append(nc.Text(x, y, line, SOURCES_SIZE, theme.muted, body=True))
    return marks, y + 6


def sentence(credit: str) -> str:
    """The source line as a sentence: its first letter up, a full stop at its end."""
    said = credit.strip().rstrip(".")
    return f"{said[:1].upper()}{said[1:]}." if said else ""


def _strips(bands: list[Band], count: int) -> list[list[Band]]:
    """The bands in ``count`` strips, in reading order, the tallest strip as short as it can
    be. Words alone in a band stay with the band after them: a heading never ends a strip."""
    units: list[list[Band]] = []
    for band in bands:
        glued = bool(units) and len(units[-1]) == 1 and all(drawn.panel.kind == WORDS for drawn in units[-1][0].panels)
        if glued:
            units[-1].append(band)
        else:
            units.append([band])
    count = max(1, min(count, len(units)))
    if count == 1:
        return [list(bands)]

    def height(group: Sequence[list[Band]]) -> float:
        inside = [band for unit in group for band in unit]
        return sum(band.height for band in inside) + GAP * max(0, len(inside) - 1)

    best: tuple[float, tuple[int, ...]] = (math.inf, ())
    for cuts in combinations(range(1, len(units)), count - 1):
        edges = (0, *cuts, len(units))
        tallest = max(height(units[edges[at]:edges[at + 1]]) for at in range(count))
        if tallest < best[0] - 1e-6:
            best = (tallest, cuts)
    edges = (0, *best[1], len(units))
    return [[band for unit in units[edges[at]:edges[at + 1]] for band in unit] for at in range(count)]


def compose(page: Page, *, strips: int = 1, bands: Sequence[Band] | None = None, header: bool = True,
            foot: bool = True) -> nc.Layout:
    """The page as one drawing the chart painters take: its title band across the top,
    its bands in ``strips`` side by side, its source line across the foot. ``bands``,
    ``header`` and ``foot`` draw a part of it (a page of the PDF)."""
    theme = page.theme
    chosen = list(page.bands if bands is None else bands)
    columns = _strips(chosen, strips)
    strip_width = page.width - 2 * MARGIN
    width = 2 * MARGIN + len(columns) * strip_width + (len(columns) - 1) * STRIP_GAP
    inner = width - 2 * MARGIN
    marks: list[nc.Mark] = []
    y = MARGIN
    if header:
        head, used = _header(page, MARGIN, inner)
        marks.extend(kinds_module.shifted(mark, 0, y) for mark in head)
        y += used
    top = y
    bottom = top
    for number, strip in enumerate(columns):
        dx = number * (strip_width + STRIP_GAP)
        at = top
        for band in strip:
            for drawn in band.panels:
                for mark in drawn.marks:
                    marks.append(kinds_module.shifted(mark, drawn.x + dx, at + drawn.y))
            at += band.height + GAP
        bottom = max(bottom, at - GAP if strip else at)
        if number and strip:
            x = MARGIN + dx - STRIP_GAP / 2
            marks.append(nc.Line(((x, top), (x, at - GAP)), theme.grid, 1.0))
    y = bottom + (GAP if chosen else 0.0)
    if foot:
        tail, used = _foot(page, MARGIN, inner)
        marks.extend(kinds_module.shifted(mark, 0, y) for mark in tail)
        y += used
    height = y + MARGIN - (GAP if chosen and not (foot and page.credits) else 0.0)
    background = nc.Rect(0, 0, width, height, theme.paper)
    title = page.title
    lines = [line for drawn in page.panels for line in ([drawn.title] if drawn.title else []) + drawn.lines]
    return nc.Layout(width, round(height, 2), theme, [background, *marks], title,
                     page.graphic.standfirst or "An infographic.", lines, page.legend, None, [], [], page.credit,
                     BLOCK, [], [], [], {"strips": len(columns)})


def fitted(page: Page, ratio: float) -> nc.Layout:
    """The page set in as many strips as bring it nearest ``ratio`` (width over height),
    then padded with paper to that shape exactly, centred: nothing cut, nothing stretched."""
    best: nc.Layout | None = None
    best_gap = math.inf
    for count in range(1, min(MAX_STRIPS, max(1, len(page.bands))) + 1):
        drawing = compose(page, strips=count)
        gap = abs(math.log((drawing.width / max(drawing.height, 1.0)) / ratio))
        if gap < best_gap - 1e-6:
            best, best_gap = drawing, gap
    assert best is not None
    width, height = best.width, best.height
    if width / height < ratio:
        width = height * ratio
    else:
        height = width / ratio
    dx, dy = (width - best.width) / 2, (height - best.height) / 2
    moved = [kinds_module.shifted(mark, dx, dy) for mark in best.marks[1:]]
    return replace(best, width=round(width, 2), height=round(height, 2),
                   marks=[nc.Rect(0, 0, width, height, page.theme.paper), *moved])


def picture(page: Page, destination: str = "page") -> bytes:
    """The infographic as one PNG for one of `DESTINATIONS`: the PDF page's measure, or a
    shape for X (16:9, 4:5, 1:1)."""
    _, ratio, scale = DESTINATIONS.get(destination) or DESTINATIONS["page"]
    drawing = compose(page) if ratio is None else fitted(page, ratio)
    width = max(MIN_PICTURE, min(MAX_PICTURE, round(drawing.width * scale)))
    # never past what the painter draws: 4000 pixels across, 8000 down
    width = min(width, math.floor(MAX_TALL * drawing.width / max(drawing.height, 1.0)))
    height = None if ratio is None else round(width / ratio)
    return nc.render_png(drawing, width, height=height)


def svg(page: Page, *, ident: str = "az-infographic", transparent: bool = False,
        faces: Mapping[str, str] | None = None) -> str:
    """The whole page as one SVG: a designer's file, and the editor's drawing."""
    return nc.svg(compose(page), ident=ident, transparent=transparent, faces=faces)


def boxes(page: Page) -> list[dict[str, Any]]:
    """Where each panel stands in `compose`'s drawing, for the editor to know what a press
    on the drawn page is about: ``{index, x, y, w, h}`` in its units."""
    _, used = _header(page, MARGIN, page.width - 2 * MARGIN)
    out: list[dict[str, Any]] = []
    at = MARGIN + used
    for band in page.bands:
        for drawn in band.panels:
            out.append({"index": drawn.index, "x": round(drawn.x, 1), "y": round(at + drawn.y, 1),
                        "w": round(drawn.w, 1), "h": round(drawn.h, 1)})
        at += band.height + GAP
    return out


def chunks(page: Page, room: float) -> list[nc.Layout]:
    """The page cut for a PDF between bands only, each part at most ``room`` tall in the
    page's CSS pixels where a band allows: the title band on the first, the sources on
    the last. A band taller than ``room`` stands alone, drawn smaller."""
    parts: list[list[Band]] = [[]]
    _, header_height = _header(page, MARGIN, page.width - 2 * MARGIN)
    used = MARGIN + header_height
    for band in page.bands:
        if parts[-1] and used + band.height + MARGIN > room:
            parts.append([])
            used = MARGIN
        parts[-1].append(band)
        used += band.height + GAP
    last = len(parts) - 1
    return [compose(page, bands=part, header=number == 0, foot=number == last) for number, part in enumerate(parts)]


# -- the picture To Post files -------------------------------------------------------------------------

#: Where To Post's picture goes, and what it files.
POST_DESTINATION = "x"
SOURCE_TYPE = "note-infographic"


def file_for_post(case: "Case", page: Page, *, note_id: str = "") -> dict[str, Any] | None:
    """The infographic as one picture for X, filed in the case's media: the path and
    entity Post takes it by. The same picture filed before is used again. None when it
    holds no panel."""
    import hashlib
    from datetime import datetime, timezone
    from pathlib import PurePosixPath

    from . import media as media_engine
    from .notecharts import PRODUCER

    if not page.panels:
        return None
    data = picture(page, POST_DESTINATION)
    digest = hashlib.sha256(data).hexdigest()
    before = case.find_entity(attr="sha256", value=digest)
    if before is not None and (before.get("attrs") or {}).get("path"):
        path = str(before["attrs"]["path"])
        return {"path": path, "id": str(before["id"]), "file": PurePosixPath(path).name}
    source: dict[str, Any] = {"type": SOURCE_TYPE, "title": page.title,
                              "rendered_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    if note_id:
        source["note"] = note_id
    filed = media_engine.import_rendered_bytes(case, data, page.title or "Infographic", ".png", source, by=PRODUCER)
    path = str(filed["item"]["path"])
    return {"path": path, "id": str(filed["entity"]["id"]), "file": PurePosixPath(path).name}
