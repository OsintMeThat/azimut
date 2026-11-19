"""The kind picker: every kind a chart's table fits, each with the settings it is drawn by.

Pressing Chart on a table shows each kind already drawn from that table's real rows
(`api/notecharts.py`, the gallery). A kind's *Fits* rule (`notes_charts.fitting`) says
whether the table suits it; this says which columns it is drawn by, so a pie of grades is
drawn by the grade column and not by the first one:

- **count**: the one column of whole numbers when the table has exactly one (a column of
  percentages or of row numbers is never a count), else the rows;
- **by**: the first column of words holding more than one value;
- **colour by**, for the kinds that stack: the column of a few values that repeat, a column
  of grades first;
- **the parts** of a pie, a donut, a segmented bar, pictograms, a waffle and silhouette
  rows: the column of as many values as the kind draws (`notes_chart_kinds.PARTS`), a
  column of grades first.

What the block already says wins: a chart whose kind changes keeps its count, its columns
and its title. Only what the new kind cannot draw by is replaced (a pie's column of forty
values, bars losing the colour column they would stack by), a kind of parts writes the
column it is drawn by as its ``by``, and a setting of the old kind's own (a waffle's
``of``) is dropped. A key, written ``""``, is taken out.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from . import notes_chart_kinds as kinds_module
from . import notes_charts as nc

#: The width a kind is laid out at in the gallery, in CSS pixels: narrower than a page,
#: so its words read at the size of a thumbnail.
THUMB_WIDTH = 420.0
#: What a count of rows is called when nothing names what the rows are.
ROWS_NOUN = "rows"


@dataclass(frozen=True)
class Proposal:
    """A kind the table fits, and the settings to write for it: a key to its value, or
    ``""`` to take the line out."""

    kind: str
    label: str
    settings: dict[str, str]


def _whole(cell: str) -> bool:
    number = nc.read_number(cell)
    return isinstance(number, nc.Number) and "%" not in cell and abs(number.value - round(number.value)) < 1e-9


def count_column(table: nc.Table) -> str:
    """What a chart of this table counts: its one column of whole numbers, else its rows."""
    rows, _, numbers = kinds_module._shape(table)
    whole = [column for column in numbers if all(_whole(row[column]) for row in rows if row[column])]
    return table.headers[whole[0]] if len(whole) == 1 else nc.ROWS


def colour_columns(table: nc.Table) -> list[int]:
    """The columns a chart may stack or colour by: a few values that repeat, grades first."""
    rows, texts, _ = kinds_module._shape(table)
    found = [column for column in texts
             if 1 < kinds_module._distinct(rows, column) <= nc.MAX_VALUES
             and kinds_module._distinct(rows, column) < len(rows)]
    return sorted(found, key=lambda column: 0 if kinds_module._graded(rows, column) else 1)


def by_column(table: nc.Table, *, besides: int | None = None) -> int | None:
    """The column a chart's bars are: the first of words holding more than one value."""
    rows, texts, _ = kinds_module._shape(table)
    for column in texts:
        if column != besides and kinds_module._distinct(rows, column) > 1:
            return column
    return texts[0] if texts else None


def _distinct(table: nc.Table, name: str) -> int:
    column = table.column(name)
    if column is None:
        return 0
    rows, _, _ = kinds_module._shape(table)
    return kinds_module._distinct(rows, column)


def settings_for(kind: nc.Kind, block: nc.ChartBlock) -> dict[str, str]:
    """The settings to write so ``block`` is drawn as ``kind`` (module docstring)."""
    table = block.table
    assert table is not None
    out: dict[str, str] = {"kind": kind.name}
    if not block.count:
        out["count"] = count_column(table)
    colour = block.colour_by
    by = block.by
    if kind.name in kinds_module.PARTS:
        low, high, whole = kinds_module.PARTS[kind.name]
        drawn = (colour if kind.parts else "") or by
        if not drawn or not low <= _distinct(table, drawn) <= high:
            columns = kinds_module.parts_columns(table, low, high, whole=whole)
            if columns:
                out["by"] = table.headers[columns[0]]
                if colour and kind.parts:
                    out["colour by"] = ""
        elif kind.parts and colour:
            # its parts are one column, written as its by: the card shows them by that name
            out["by"] = drawn
            out["colour by"] = ""
    elif kind.stacked:
        if not colour or table.column(colour) is None:
            columns = colour_columns(table)
            if columns:
                colour = table.headers[columns[0]]
                out["colour by"] = colour
        if not by or by.casefold() == (colour or "").casefold():
            column = by_column(table, besides=table.column(colour) if colour else None)
            if column is not None:
                out["by"] = table.headers[column]
    elif kind.turns:
        # plain bars draw one colour: a colour column would stack them again
        if colour:
            out["colour by"] = ""
        if not by:
            column = by_column(table)
            if column is not None:
                out["by"] = table.headers[column]
    elif kind.counts and not by:
        column = by_column(table)
        if column is not None:
            out["by"] = table.headers[column]
    if not kind.counts:
        out.pop("count", None)
    for key in block.extra:
        if key not in kind.keys:
            out[key] = ""
    if block.bars and kind.turns:
        out["bars"] = ""
    return out


def applied(block: nc.ChartBlock, settings: dict[str, str]) -> nc.ChartBlock:
    """``block`` as it reads once ``settings`` are written over it."""
    changes: dict[str, str] = {}
    fields = {"kind": "kind", "title": "title", "count": "count", "by": "by", "colour by": "colour_by", "bars": "bars"}
    for key, value in settings.items():
        if key == "kind":
            kind = nc.kind_named(value)
            changes["kind"] = kind.name if kind is not None else ""
        elif key == "count":
            changes["count"] = nc.ROWS if value.casefold() == nc.ROWS else value
        elif key in fields:
            changes[fields[key]] = value
    drawn = replace(block, extra={key: value for key, value in block.extra.items() if settings.get(key, value)})
    for name, value in changes.items():
        setattr(drawn, name, value)
    return drawn


def proposals(block: nc.ChartBlock) -> list[Proposal]:
    """Every kind the block's table fits, in the picker's order, with what to write for it."""
    table = block.table
    if table is None or not table.headers:
        return []
    return [Proposal(name, nc.KINDS[name].label, settings_for(nc.KINDS[name], block)) for name in nc.fitting(table)]


def title_for(reading: nc.Reading) -> str:
    """The title a new chart is written with: the one its data proposes, saying *at least*
    when its count is a floor, and naming its rows when nothing else says what they are.
    Empty for a kind that counts nothing (key figures, a timeline, a line)."""
    if not reading.kind.counts or reading.table is None:
        return ""
    noun = nc.noun_of(reading) or (ROWS_NOUN if reading.count is None else "")
    return nc.propose_title(reading, noun)
