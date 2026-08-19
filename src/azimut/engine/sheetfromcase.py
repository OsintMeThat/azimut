"""A sheet built out of what the case already believes.

Promotion runs one way — rows become entities — and until now nothing ran the other. So
an analyst holding forty places in the graph and wanting to work through them had two
answers, both bad: retype the forty, or work in a Board that has no column to write a
verdict in. The graph says what the case believes; a sheet says what it is *checking*,
and there was no road from the first to the second.

This is that road. It reads a type out of the catalog and writes a worklist: one row per
entity, its name, whichever declared fields the analyst asked for, and the two empty
columns the work needs — a status and a note.

Three things make it a bridge rather than an export:

**Every row points back.** The name cell carries the entity's link in the sidecar, so the
sheet gains a ``mentions`` edge per row and the entity is reachable from the sheet's side
and the sheet from the entity's.

**A second pass updates rather than twins.** The link is written into the same place a
promotion writes one (``links[key][label_column]``), with what the cell said beside it, so
promoting these rows back after editing them updates the entities they came from. Round
trip, not fork.

**Nothing is copied that was not asked for.** The label, and the fields named. A sheet
that swept every attribute would be a second copy of the graph, drifting from the first
the moment either is edited.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from . import entities as entity_engine
from . import sheets as sheet_engine

if TYPE_CHECKING:
    from ..workspace import Case

#: How many entities one build may take. A sheet holds twenty thousand rows, but a
#: worklist of two thousand is already past what anyone works through — and past this the
#: honest answer is a filtered Board, not a longer table.
MAX_FROM_CASE = 2_000

#: The column carrying the entity's name, which is also the column the link hangs on —
#: the same one a promotion uses, so the two agree about what a promoted row is.
NAME_COLUMN = "Name"

#: The two the work needs and the graph does not hold: where the checking got to, and
#: why. They are the whole reason the rows are in a sheet rather than in the Board.
STATUS_COLUMN = "Status"
NOTES_COLUMN = "Notes"

#: Fields not worth a column: a drawn shape is not something a cell can hold, and a grid
#: showing its coordinates as a wall of digits would say the sheet is where it is edited.
SKIPPED_KINDS = ("geojson",)


def declared_fields(entity_type: str) -> list[entity_engine.Attr]:
    """The fields of this type an analyst could put in a column."""
    for declared in entity_engine.ENTITY_TYPES:
        if declared.type == entity_type:
            return [attr for attr in declared.attrs if attr.kind not in SKIPPED_KINDS]
    return []


def _cell(value: Any) -> str:
    """One stored field as the text a CSV holds.

    A list is joined rather than serialised: `aliases` is three names, and a cell reading
    `["a", "b"]` is a cell nobody can filter on or hand to a spreadsheet.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "YES" if value else "NO"
    if isinstance(value, (list, tuple)):
        return ", ".join(_cell(entry) for entry in value if entry not in (None, ""))
    return str(value)


def build(
    case: "Case",
    *,
    entity_type: str,
    fields: list[str] | None = None,
    limit: int = MAX_FROM_CASE,
) -> dict[str, Any]:
    """The table, the sidecar and the counts for a worklist over one type.

    Ordered by name rather than by insertion, because the analyst about to work through
    it will look rows up by name. ``total`` is how many the case holds against ``taken``,
    which is what lets the screen say a build was cut before it is pressed.
    """
    declared = {attr.key: attr for attr in declared_fields(entity_type)}
    wanted = [key for key in (fields or []) if key in declared]
    columns = [
        sheet_engine.ID_COLUMN,
        NAME_COLUMN,
        *(declared[key].label for key in wanted),
        STATUS_COLUMN,
        NOTES_COLUMN,
    ]

    taken = max(0, min(int(limit), MAX_FROM_CASE))
    page = case.page_entities(limit=taken or 1, types=[entity_type], order="label")
    items = list(page.get("items", []))[:taken]

    rows: list[list[str]] = []
    links: dict[str, dict[str, str]] = {}
    promoted: dict[str, dict[str, str]] = {}
    for entity in items:
        key = sheet_engine.new_row_id()
        label = _cell(entity.get("label"))
        attrs = entity.get("attrs") or {}
        rows.append([key, label, *(_cell(attrs.get(field)) for field in wanted), "", ""])
        links[key] = {NAME_COLUMN: str(entity["id"])}
        promoted[key] = {NAME_COLUMN: label}

    meta = {
        **sheet_engine.empty_meta(),
        "links": links,
        "promoted": promoted,
        # The status column arrives as a state with its four words: the sheet exists to
        # be worked through, and a worklist whose progress cannot be counted on the day
        # it is made is a worklist somebody has to set up first.
        "roles": {STATUS_COLUMN: {"kind": "state"}},
        "progress": STATUS_COLUMN,
    }
    return {
        "columns": columns,
        "rows": rows,
        "meta": meta,
        "taken": len(rows),
        "total": int(page.get("total", len(rows))),
    }
