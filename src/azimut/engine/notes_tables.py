"""How a table of a note shows in the documents made from it: its settings line.

A table is the pipes an expert writes. What it does in the HTML report (a search bar,
sorting, folding a long one) and how it looks there and in the PDF (stripes, rows
coloured by a column's values, a column kept in sight, its density, a caption and a
source) is one line of braces right under its last row, written the way a picture's
braces are (``{width=50% caption="…"}``)::

    | # | Identification | Grade |
    | --- | --- | --- |
    | 1 | Streit Cougar | confirmed |
    {search=always fold=20 stripes colour="Grade"}

The line is the table's last row to any Markdown reader, so it holds no pipe outside a
quoted value, and it counts only when it names a key this module knows: a table whose
last row is ``{x}`` keeps that row. `attach` takes the line out of the parsed table and
hands the settings on with its ``table_open`` token (`look_of`), so every renderer reads
one table one way. A table with no line reads as every table did before (`DEFAULT`).

The keys, each written only when it is not its default:

- ``search=auto|always|never``: the bar that filters the rows, past twelve rows by default;
- ``sort=off``: no sorting by a press on a header;
- ``fold=N``: the first N rows shown, the rest under *Show all*;
- ``header=scrolls``: the header leaves with the rows, on the screen and on paper;
- ``first-column=sticky``: the first column stays when the table slides sideways;
- ``stripes`` (or ``stripes=off``): every other row tinted, or none even where the style stripes;
- ``colour="Grade"``: each row tinted by its value in that column, as a chart colours it;
- ``density=compact``;
- ``caption="…"`` and ``source="…"``: a line under the table and where its rows came from.

The search bar, sorting, folding and the column kept in sight are the web page's; the
PDF prints the stripes, the colours, the caption and source, the density and whether the
header repeats on each page. The editor reads and writes the same line
(``frontend/src/lib/notes/editor/tableLook.js``).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Sequence

if TYPE_CHECKING:
    from markdown_it.token import Token

    from ..workspace import Case
    from .notelook import NoteLook

#: The line: braces alone on it, right under the table's last row. A quoted value holds
#: no ``"``, ``}`` or line break, as a picture's caption; a bare one no quote, brace or pipe.
LOOK_LINE = re.compile(r"^[ \t]*\{([^{}\n]*)\}[ \t\r]*$")
TOKEN = re.compile(r'[ \t]*([A-Za-z][A-Za-z0-9_-]*)(?:[ \t]*=[ \t]*(?:"([^"}\n]*)"|([^\s"{}|]+)))?[ \t]*')
#: What one quoted value may run to, as a picture's caption.
MAX_TEXT = 300
MAX_FOLD = 500

SEARCHES = ("auto", "always", "never")
DENSITIES = ("comfortable", "compact")
#: The rows past which the search bar shows by itself (`search=auto`).
SEARCH_PAST = 12
#: How much of a row's colour tints it, and its value's own cell, on paper.
ROW_TINT = 0.84
KEY_TINT = 0.6

ON = ("on", "yes", "true")
OFF = ("off", "no", "false")


@dataclass(frozen=True)
class TableLook:
    """A table's settings as its line says them; the defaults are every table's before."""

    search: str = "auto"
    sort: bool = True
    fold: int = 0
    sticky_header: bool = True
    sticky_column: bool = False
    #: None leaves it to the style: a styled PDF stripes its tables, the web page does not.
    stripes: bool | None = None
    colour: str = ""
    density: str = "comfortable"
    caption: str = ""
    source: str = ""
    #: What the line holds that this does not read, kept as written.
    rest: str = ""

    @property
    def compact(self) -> bool:
        return self.density == "compact"

    def shows_search(self, rows: int) -> bool:
        """Whether a table of ``rows`` rows gets the bar that filters them."""
        return self.search == "always" or (self.search == "auto" and rows > SEARCH_PAST)


DEFAULT = TableLook()


def _flag(value: str | None) -> bool | None:
    """``on``/``off`` and their kin, a bare key meaning on; None for anything else."""
    if value is None:
        return True
    folded = value.casefold()
    return True if folded in ON else False if folded in OFF else None


def clean_text(value: str) -> str:
    """A caption, a source or a column's name as it can be written in the braces: one line,
    no quote, brace or pipe, at most `MAX_TEXT`."""
    return " ".join(re.sub(r'["{}|]', "", str(value or "")).split())[:MAX_TEXT].strip()


def read_line(line: str) -> TableLook | None:
    """The settings ``line`` writes, or None when it is no settings line: not braces alone,
    a token it cannot read, or no key this module knows."""
    match = LOOK_LINE.match(str(line or ""))
    if match is None:
        return None
    body = match.group(1)
    values: dict[str, Any] = {}
    rest: list[str] = []
    known = False
    position = 0
    while position < len(body):
        token = TOKEN.match(body, position)
        if token is None or token.end() == position:
            if body[position:].strip():
                return None
            break
        position = token.end()
        key = token.group(1).casefold()
        quoted, bare = token.group(2), token.group(3)
        value = quoted if quoted is not None else bare
        written = token.group(0).strip()
        if key == "color":
            key = "colour"
        if key not in KEYS:
            rest.append(written)
            continue
        known = True
        read = _read_value(key, value)
        if read is not None:
            values[KEYS[key]] = read
    if not known:
        return None
    return TableLook(**values, rest=" ".join(rest))


def _read_value(key: str, value: str | None) -> Any:
    """One known key's value, or None when it says nothing this reads (its default then holds)."""
    folded = (value or "").casefold()
    if key == "search":
        return folded if folded in SEARCHES else None
    if key in ("sort", "stripes"):
        return _flag(value)
    if key == "fold":
        if folded in OFF:
            return 0
        return int(folded) if re.fullmatch(r"[0-9]+", folded) and 0 < int(folded) <= MAX_FOLD else None
    if key in ("header", "first-column"):
        if value is None:
            return True
        return True if folded in ("sticky", *ON) else False if folded in ("scrolls", *OFF) else None
    if key == "density":
        return folded if folded in DENSITIES else None
    # colour, caption, source: words
    words = clean_text(value or "")
    return words or None


#: Each key as written, and the field of `TableLook` it sets.
KEYS = {
    "search": "search", "sort": "sort", "fold": "fold", "header": "sticky_header", "first-column": "sticky_column",
    "stripes": "stripes", "colour": "colour", "density": "density", "caption": "caption", "source": "source",
}


def write_line(look: TableLook) -> str:
    """The line ``look`` is written as, each key only when it is not its default; '' when
    nothing is set (the line then goes)."""
    parts: list[str] = []
    if look.search != DEFAULT.search:
        parts.append(f"search={look.search}")
    if not look.sort:
        parts.append("sort=off")
    if look.fold:
        parts.append(f"fold={look.fold}")
    if not look.sticky_header:
        parts.append("header=scrolls")
    if look.sticky_column:
        parts.append("first-column=sticky")
    if look.stripes is not None:
        parts.append("stripes" if look.stripes else "stripes=off")
    if clean_text(look.colour):
        parts.append(f'colour="{clean_text(look.colour)}"')
    if look.density != DEFAULT.density:
        parts.append(f"density={look.density}")
    for key, value in (("caption", look.caption), ("source", look.source)):
        if clean_text(value):
            parts.append(f'{key}="{clean_text(value)}"')
    if not parts:
        return ""
    if look.rest:
        parts.append(look.rest)
    return "{" + " ".join(parts) + "}"


# -- the parsed note ------------------------------------------------------------------------


def attach(tokens: list["Token"], source: str) -> list["Token"]:
    """``tokens`` with each table's settings line taken out of its rows and handed on with
    its ``table_open`` (``meta["look"]``). ``source`` is what was parsed, for the line as
    written: only a table's last row, written as braces alone, is one."""
    if "{" not in source:
        return tokens
    lines = source.split("\n")
    index = len(tokens) - 1
    while index >= 0:
        if tokens[index].type == "table_close":
            index = _take(tokens, index, lines)
        index -= 1
    return tokens


def _take(tokens: list["Token"], close: int, lines: list[str]) -> int:
    """Take the settings row of the table ending at ``close``; answers its ``table_open``."""
    depth = 0
    opened = close
    while opened >= 0:
        kind = tokens[opened].type
        if kind == "table_close":
            depth += 1
        elif kind == "table_open":
            depth -= 1
            if depth == 0:
                break
        opened -= 1
    if opened < 0 or tokens[close - 1].type != "tbody_close" or tokens[close - 2].type != "tr_close":
        return opened
    row = close - 2
    while row > opened and tokens[row].type != "tr_open":
        row -= 1
    where = tokens[row].map
    if row <= opened or not where or where[0] >= len(lines):
        return opened
    look = read_line(lines[where[0]])
    if look is None:
        return opened
    del tokens[row:close - 1]
    body = row - 1
    if tokens[body].type == "tbody_open" and tokens[body + 1].type == "tbody_close":
        del tokens[body:body + 2]
    table = tokens[opened]
    table.meta = {**(table.meta or {}), "look": look}
    return opened


def look_of(token: "Token") -> TableLook:
    """The settings a ``table_open`` token carries, or every table's defaults."""
    look = (token.meta or {}).get("look")
    return look if isinstance(look, TableLook) else DEFAULT


# -- the colours ------------------------------------------------------------------------------


def colour_column(headers: Sequence[str], name: str) -> int | None:
    """The column ``colour="…"`` names, by its header's words in any case; None when none does."""
    wanted = " ".join(str(name or "").split()).casefold()
    if not wanted:
        return None
    for index, header in enumerate(headers):
        if " ".join(str(header).split()).casefold() == wanted:
            return index
    return None


def tint(colour: str, amount: float) -> str:
    """``colour`` (``#rrggbb``) mixed with white by ``amount``, as a hex code."""
    value = colour.lstrip("#")
    channels = [int(value[index:index + 2], 16) for index in (0, 2, 4)]
    return "#" + "".join(f"{round(channel + (255 - channel) * amount):02x}" for channel in channels)


def missing_colour(name: str) -> str:
    """What the check says of a table coloured by a column it does not have."""
    return f'A table is coloured by "{name[:40]}", a column it does not have, so its rows are not.'


def row_colours(headers: Sequence[str], rows: Sequence[Sequence[str]], name: str, *,
                case: "Case | None", look: "NoteLook | None") -> tuple[int | None, list[str]]:
    """The column ``name`` and each row's colour by its value there, as a chart coloured by
    that column paints it: the case's named colours first, a grade's own, then the charts'
    order; '' for a row with nothing in it. ``(None, [])`` when the table has no such column."""
    column = colour_column(headers, name)
    if column is None:
        return None, []
    from . import notecharts, notes_charts

    texts = [str(row[column]).strip() if column < len(row) else "" for row in rows]
    theme = notecharts.theme_of(look, notes_charts.ChartBlock())
    paints = notes_charts.value_paints(texts, theme=theme, palette=notecharts.palette(case))
    return column, [paints.get(text.casefold(), "") if text else "" for text in texts]
