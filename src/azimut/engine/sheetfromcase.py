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


# -- the outgoing shape: one row per proof -------------------------------------
#
# The other document in this app carrying these columns is the `geoloc` template, and it
# runs the other way: addresses pasted in, pressed, downloaded, turned into proofs. This
# one starts from proofs the case already holds and turns them into a table. Confusing
# the two is the mistake to avoid — the incoming one holds *text of URLs*, this one holds
# *links to entities*, and `canBuild()` refuses to offer the sheet-to-proofs build here
# because there is nothing left to fetch.

#: The label of the proof, and the column its link hangs on.
TITLE_COLUMN = "Title"

#: What the proof was made from, and where it says the picture was taken. Both carry a
#: link and no role beyond `locked`: `linkable()` refuses a column holding `url` or any
#: other kind, so a role naming what these hold would cost them their link.
SOURCE_COLUMN = "Source media"
PLACE_COLUMN = "Place"

#: Filled by the app off the graph, never copied into the file by hand. `from` names the
#: place column rather than the title column on purpose: `_points_by_entity` walks
#: `located-at`, `sited-at`, `at` and `about`, and **not** `depicts` — so a hop from the
#: proof would resolve nothing. The place holds its own point, which is one lookup.
POINT_COLUMN = "Coordinates"

#: Whether the case still holds the proof this row was built from. A row whose proof has
#: since been deleted keeps its text, its notes and its place in the table, and says NO
#: here — which is the column the analyst filters on to find them and decide.
IN_CASE_COLUMN = "In case"

#: What the proof derives from. `capture` as well as `media`: a frame grabbed out of a
#: video is a source like any other, and a column that skipped it would be blank on
#: exactly the proofs built the careful way.
SOURCE_TYPES = ("media", "capture")


def _edges(case: "Case") -> dict[str, dict[str, list[str]]]:
    """The two edges this shape reads, indexed by the proof they leave.

    One pass over the graph rather than two queries per row: a build may take two
    thousand proofs and the graph is the same graph for all of them.
    """
    from . import links as link_engine

    wanted = (link_engine.DERIVED_FROM, link_engine.DEPICTS)
    found: dict[str, dict[str, list[str]]] = {}
    for link in case.list_links():
        kind = str(link.get("type") or "")
        if kind not in wanted:
            continue
        source, target = str(link.get("from") or ""), str(link.get("to") or "")
        if source and target:
            found.setdefault(source, {}).setdefault(kind, []).append(target)
    return found


def _first(ids: list[str], known: dict[str, dict[str, Any]], types: tuple[str, ...]) -> str:
    """Which of these a cell holds, when a cell holds one and the proof has several.

    A proof rests on up to eight sources and a cell carries one link, so one is chosen —
    otherwise "one row per proof" stops being true. Chosen **by label**, not by whatever
    order the graph hands back: `list_links()` reads in insertion order today, which is
    stable but arbitrary, and a bundle restored elsewhere may insert them in another one.
    Sorting by what the analyst can see means two builds of the same case agree, and
    agree with what somebody reading the panel would have picked.
    """
    holding = [
        entity_id
        for entity_id in ids
        if (entity := known.get(entity_id)) is not None and entity.get("type") in types
    ]
    if not holding:
        return ""
    return min(holding, key=lambda entity_id: (str(known[entity_id].get("label") or ""), entity_id))


def proof_columns() -> list[str]:
    """The shape's headings, in reading order: what the case says, then what you say."""
    return [
        sheet_engine.ID_COLUMN,
        TITLE_COLUMN,
        SOURCE_COLUMN,
        PLACE_COLUMN,
        POINT_COLUMN,
        IN_CASE_COLUMN,
        STATUS_COLUMN,
        NOTES_COLUMN,
    ]


def proof_roles() -> dict[str, Any]:
    """What each column is, which is also what may be typed in and what may not.

    Three locked, two computed, one state, one free. The analyst's half of the table is
    `Status`, `Notes` and any column they add: the case's half is the app's to write, and
    a view somebody can type over is a view that starts lying the first time they do.
    """
    return {
        TITLE_COLUMN: {"kind": "locked"},
        SOURCE_COLUMN: {"kind": "locked"},
        PLACE_COLUMN: {"kind": "locked"},
        POINT_COLUMN: {"kind": "computed", "of": "point", "from": PLACE_COLUMN},
        IN_CASE_COLUMN: {"kind": "computed", "of": "in_case"},
        STATUS_COLUMN: {"kind": "state"},
    }


def _resolve(case: "Case", proofs: list[dict[str, Any]]) -> tuple[
    dict[str, dict[str, list[str]]], dict[str, dict[str, Any]]
]:
    """The graph this shape needs, read in two bounded lookups for the whole build."""
    edges = _edges(case)
    reachable: set[str] = set()
    for proof in proofs:
        for targets in edges.get(str(proof["id"]), {}).values():
            reachable.update(targets)
    known = {str(entity["id"]): entity for entity in case.entities_by_ids(sorted(reachable))}
    return edges, known


def _proof_cells(
    proof: dict[str, Any],
    edges: dict[str, dict[str, list[str]]],
    known: dict[str, dict[str, Any]],
) -> tuple[dict[str, str], dict[str, str]]:
    """One proof as the three cells it fills and the three links behind them.

    A proof with no place gives a row whose `Place` and `Coordinates` are empty, and the
    row is filed anyway. That is information — the case holds a proof nobody has placed —
    and refusing the row would be the build deciding which of the analyst's proofs count.
    """
    from . import links as link_engine

    held = edges.get(str(proof["id"]), {})
    media = _first(held.get(link_engine.DERIVED_FROM, []), known, SOURCE_TYPES)
    place = _first(held.get(link_engine.DEPICTS, []), known, ("place",))
    label = _cell(proof.get("label"))
    cells = {
        TITLE_COLUMN: label,
        SOURCE_COLUMN: _cell((known.get(media) or {}).get("label")) if media else "",
        PLACE_COLUMN: _cell((known.get(place) or {}).get("label")) if place else "",
    }
    links = {TITLE_COLUMN: str(proof["id"])}
    if media:
        links[SOURCE_COLUMN] = media
    if place:
        links[PLACE_COLUMN] = place
    return cells, links


def build_proofs(case: "Case", *, limit: int = MAX_FROM_CASE) -> dict[str, Any]:
    """The table, the sidecar and the counts for one row per proof the case holds.

    Ordered by label like the generic shape, because that is how a row is looked up.

    `Status` arrives at `done` on every row rather than `to do`: each line is a proof that
    exists, and forty rows claiming work still to do would be forty lies. The column earns
    its keep the moment the analyst adds a line for a place **not** yet proven — that one
    arrives at `to do`, and the column then means "is there a proof for this row".
    """
    columns = proof_columns()
    taken = max(0, min(int(limit), MAX_FROM_CASE))
    page = case.page_entities(limit=taken or 1, types=["proof"], order="label")
    proofs = list(page.get("items", []))[:taken]
    edges, known = _resolve(case, proofs)

    rows: list[list[str]] = []
    links: dict[str, dict[str, str]] = {}
    promoted: dict[str, dict[str, str]] = {}
    built: dict[str, str] = {}
    for proof in proofs:
        key = sheet_engine.new_row_id()
        cells, cell_links = _proof_cells(proof, edges, known)
        filled = {sheet_engine.ID_COLUMN: key, STATUS_COLUMN: "done", **cells}
        rows.append([filled.get(name, "") for name in columns])
        links[key] = cell_links
        promoted[key] = {TITLE_COLUMN: cells[TITLE_COLUMN]}
        built[key] = str(proof["id"])

    meta = {
        **sheet_engine.empty_meta(),
        "links": links,
        "promoted": promoted,
        "built": built,
        "roles": proof_roles(),
        "progress": STATUS_COLUMN,
    }
    return {
        "columns": columns,
        "rows": rows,
        "meta": meta,
        "taken": len(rows),
        "total": int(page.get("total", len(rows))),
    }


def refresh_proofs(
    case: "Case",
    columns: list[str],
    rows: list[list[str]],
    meta: dict[str, Any],
    *,
    limit: int = MAX_FROM_CASE,
) -> dict[str, Any]:
    """Bring a proofs sheet back level with the case, and say what that took.

    Three rules, and the second is the one that makes the button safe to press:

    **Rows are added, never removed.** A proof the case no longer holds keeps its row,
    its notes and its colour, and answers NO in `In case`. Deleting it is the analyst's
    call — their notes are on that line and nothing here wrote them.

    **Only the case's columns are rewritten.** `Status`, `Notes` and anything the analyst
    added are read and put back untouched. A refresh that reset a status would be a
    refresh nobody presses twice.

    **New rows land at the end**, in label order among themselves. Inserting them in
    place would reshuffle a table somebody is working down; the sheet's own sort is where
    order is decided.

    Refused on any other sheet. The shape is recognised by its `Title` column being
    `locked` — a heading alone would not do, since nothing stops an imported binder from
    holding a column called *Title*, and pouring every proof in the case into it would
    file a hundred rows of empty cells nobody asked for. Only this build writes that role.
    """
    roles = (meta.get("roles") or {}) if isinstance(meta, dict) else {}
    if (roles.get(TITLE_COLUMN) or {}).get("kind") != "locked" or TITLE_COLUMN not in columns:
        raise sheet_engine.SheetError("this sheet was not built out of the case's proofs")
    key_at = sheet_engine.key_index(columns)
    index = {name: position for position, name in enumerate(columns)}
    links = {str(key): dict(cells) for key, cells in (meta.get("links") or {}).items()}
    promoted = {str(key): dict(cells) for key, cells in (meta.get("promoted") or {}).items()}
    built = {str(key): str(value) for key, value in (meta.get("built") or {}).items() if value}

    taken = max(0, min(int(limit), MAX_FROM_CASE))
    page = case.page_entities(limit=taken or 1, types=["proof"], order="label")
    proofs = list(page.get("items", []))[:taken]
    edges, known = _resolve(case, proofs)

    # Which row already stands for which proof. The sidecar's own record rather than a
    # match on the text: the label is what changes, so matching on it would file a second
    # row for every proof somebody renamed.
    at_proof: dict[str, str] = {}
    for row_key, entity_id in built.items():
        at_proof.setdefault(entity_id, row_key)

    table = [list(row) for row in rows]
    where = {row[key_at]: position for position, row in enumerate(table) if key_at < len(row)}
    updated, added = 0, 0
    for proof in proofs:
        cells, cell_links = _proof_cells(proof, edges, known)
        standing = at_proof.get(str(proof["id"]))
        if standing is not None and standing in where:
            row = table[where[standing]]
            for name, value in cells.items():
                position = index.get(name)
                if position is not None and position < len(row) and row[position] != value:
                    row[position] = value
                    updated += 1
            links[standing] = cell_links
            promoted[standing] = {TITLE_COLUMN: cells[TITLE_COLUMN]}
            continue
        key = sheet_engine.new_row_id()
        row = [""] * len(columns)
        if key_at < len(row):
            row[key_at] = key
        for name, value in {**cells, STATUS_COLUMN: "done"}.items():
            position = index.get(name)
            if position is not None and position < len(row):
                row[position] = value
        table.append(row)
        links[key] = cell_links
        promoted[key] = {TITLE_COLUMN: cells[TITLE_COLUMN]}
        built[key] = str(proof["id"])
        added += 1

    # What the rows already on the table were built from, and which of those the case
    # still holds. Asked of the case rather than of the page above: a build cut at the
    # limit must not report every proof past it as deleted.
    carried = {str(key): built[key] for key in where if key in built}
    alive = {
        str(entity["id"])
        for entity in case.entities_by_ids(sorted(set(carried.values())))
    }
    gone = sum(1 for entity_id in carried.values() if entity_id not in alive)
    return {
        "columns": list(columns),
        "rows": table,
        "meta": {**meta, "links": links, "promoted": promoted, "built": built},
        "added": added,
        "updated": updated,
        "gone": gone,
    }
