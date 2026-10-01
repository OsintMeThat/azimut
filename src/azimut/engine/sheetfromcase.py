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


# -- the outgoing shape: one row per point a proof concludes on ------------------
#
# The other document in this app carrying these columns is the `geoloc` template, and it
# runs the other way: addresses pasted in, pressed, downloaded, turned into proofs. This
# one starts from proofs the case already holds and turns them into a table. Confusing
# the two is the mistake to avoid — the incoming one holds *text of URLs*, this one holds
# *links to entities*, and `canBuild()` refuses to offer the sheet-to-proofs build here
# because there is nothing left to fetch.
#
# **One row per point, not per proof.** A video placed at three spots is three
# geolocations, and an index that gave it one row with one of the three places on it
# lost the other two. A proof that concludes nowhere yet still gets its one row.

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

#: What Geo Proof says about the proof, restated per row: the date of the event as the
#: analyst wrote it (`2026-09-08~` keeps its `~`), whether this point is where the camera
#: stood, the address of the post the footage came from, and the description.
DATE_COLUMN = "Date"
POV_COLUMN = "POV"
SOURCE_URL_COLUMN = "Source URL"
DESCRIPTION_COLUMN = "Description"

#: What the proof derives from. `capture` as well as `media`: a frame grabbed out of a
#: video is a source like any other, and a column that skipped it would be blank on
#: exactly the proofs built the careful way.
SOURCE_TYPES = ("media", "capture")

#: How far up a derivation the footage behind a proof is looked for: the frame, the
#: video it was cut from, the post that video came from.
_ASCENT = 6


def _edges(case: "Case") -> dict[str, dict[str, list[str]]]:
    """The edges this shape reads, indexed by the entity they leave.

    One pass over the graph rather than queries per row: a build may take two thousand
    proofs and the graph is the same graph for all of them.
    """
    from . import links as link_engine

    wanted = (link_engine.DERIVED_FROM, link_engine.DEPICTS, link_engine.LOCATED_AT)
    found: dict[str, dict[str, list[str]]] = {}
    for link in case.list_links():
        kind = str(link.get("type") or "")
        if kind not in wanted:
            continue
        source, target = str(link.get("from") or ""), str(link.get("to") or "")
        if source and target:
            found.setdefault(source, {}).setdefault(kind, []).append(target)
    return found


def _ancestors(edges: dict[str, dict[str, list[str]]], entity_id: str) -> list[str]:
    """What this was made from, every step up, nearest first."""
    from . import links as link_engine

    seen: list[str] = []
    frontier = [entity_id]
    for _ in range(_ASCENT):
        step = [
            parent
            for current in frontier
            for parent in edges.get(current, {}).get(link_engine.DERIVED_FROM, [])
            if parent not in seen and parent != entity_id
        ]
        step = list(dict.fromkeys(step))
        if not step:
            break
        seen.extend(step)
        frontier = step
    return seen


def _first(ids: list[str], known: dict[str, dict[str, Any]], types: tuple[str, ...]) -> str:
    """Which of these a cell holds, when a cell holds one and the proof has several.

    A proof rests on up to eight sources and a cell carries one link, so one is chosen.
    Chosen **by label**, not by whatever order the graph hands back: `list_links()` reads
    in insertion order today, which is stable but arbitrary, and a bundle restored
    elsewhere may insert them in another one. Sorting by what the analyst can see means
    two builds of the same case agree, and agree with what somebody reading the panel
    would have picked.
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
        DATE_COLUMN,
        PLACE_COLUMN,
        POV_COLUMN,
        POINT_COLUMN,
        SOURCE_COLUMN,
        SOURCE_URL_COLUMN,
        DESCRIPTION_COLUMN,
        IN_CASE_COLUMN,
        STATUS_COLUMN,
        NOTES_COLUMN,
    ]


def proof_roles() -> dict[str, Any]:
    """What each column is, which is also what may be typed in and what may not.

    The analyst's half of the table is `Status`, `Notes` and any column they add: the
    case's half is the app's to write, and a view somebody can type over is a view that
    starts lying the first time they do. The date and the description are Geo Proof's,
    so they are changed there.
    """
    return {
        TITLE_COLUMN: {"kind": "locked"},
        DATE_COLUMN: {"kind": "locked"},
        PLACE_COLUMN: {"kind": "locked"},
        POV_COLUMN: {"kind": "locked"},
        POINT_COLUMN: {"kind": "computed", "of": "point", "from": PLACE_COLUMN},
        SOURCE_COLUMN: {"kind": "locked"},
        SOURCE_URL_COLUMN: {"kind": "locked"},
        DESCRIPTION_COLUMN: {"kind": "locked"},
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
        reachable.update(_ancestors(edges, str(proof["id"])))
    known = {str(entity["id"]): entity for entity in case.entities_by_ids(sorted(reachable))}
    return edges, known


def _proof_points(
    proof: dict[str, Any],
    edges: dict[str, dict[str, list[str]]],
    known: dict[str, dict[str, Any]],
) -> list[tuple[str, dict[str, str], dict[str, str]]]:
    """One proof as one row per point it concludes on: the match key the refresh finds
    the row by, the cells, and the links behind them.

    A proof with no place gives one row whose `Place` and `Coordinates` are empty, and the
    row is filed anyway. That is information — the case holds a proof nobody has placed —
    and refusing the row would be the build deciding which of the analyst's proofs count.
    """
    from . import links as link_engine

    proof_id = str(proof["id"])
    held = edges.get(proof_id, {})
    media = _first(held.get(link_engine.DERIVED_FROM, []), known, SOURCE_TYPES)
    ancestry = _ancestors(edges, proof_id)
    # The post the footage came from, so a file's address and not a capture's: a capture
    # records the imagery provider it was framed on, which is not a source anybody cites.
    address = next(
        (
            str(url)
            for entity_id in ancestry
            if (known.get(entity_id) or {}).get("type") == "media"
            and (url := ((known.get(entity_id) or {}).get("attrs") or {}).get("source_url"))
        ),
        "",
    )
    recorded = {
        place for entity_id in ancestry for place in edges.get(entity_id, {}).get(link_engine.LOCATED_AT, [])
    }
    places = sorted(
        {
            place for place in held.get(link_engine.DEPICTS, [])
            if (known.get(place) or {}).get("type") == "place"
        },
        key=lambda place: (str(known[place].get("label") or "").casefold(), place),
    )
    attrs = proof.get("attrs") or {}
    shared = {
        TITLE_COLUMN: _cell(proof.get("label")),
        DATE_COLUMN: _cell(attrs.get("when")),
        SOURCE_COLUMN: _cell((known.get(media) or {}).get("label")) if media else "",
        SOURCE_URL_COLUMN: address,
        DESCRIPTION_COLUMN: _cell(attrs.get("notes")),
    }
    base_links = {TITLE_COLUMN: proof_id, **({SOURCE_COLUMN: media} if media else {})}
    if not places:
        return [(_match(proof_id, ""), {**shared, PLACE_COLUMN: "", POV_COLUMN: ""}, base_links)]
    return [
        (
            _match(proof_id, place),
            {
                **shared,
                PLACE_COLUMN: _cell(known[place].get("label")),
                POV_COLUMN: "YES" if place in recorded else "NO",
            },
            {**base_links, PLACE_COLUMN: place},
        )
        for place in places
    ]


def _match(proof_id: str, place_id: str) -> str:
    return f"{proof_id}|{place_id}"


def _proof_rows(case: "Case", limit: int) -> tuple[list[dict[str, Any]], int]:
    """Every point of the proofs taken, as the items a build or a refresh lays out."""
    taken = max(0, min(int(limit), MAX_FROM_CASE))
    page = case.page_entities(limit=taken or 1, types=["proof"], order="label")
    proofs = list(page.get("items", []))[:taken]
    edges, known = _resolve(case, proofs)
    items = [
        {"id": str(proof["id"]), "match": match, "cells": cells, "links": cell_links}
        for proof in proofs
        for match, cells, cell_links in _proof_points(proof, edges, known)
    ]
    return items, int(page.get("total", len(proofs)))


def build_proofs(case: "Case", *, limit: int = MAX_FROM_CASE) -> dict[str, Any]:
    """The table, the sidecar and the counts for one row per point the proofs conclude on.

    Ordered by proof label like the generic shape, because that is how a row is looked up,
    and a proof's points by their own labels under it.

    `Status` arrives at `done` on every row rather than `to do`: each line is a
    geolocation that exists, and forty rows claiming work still to do would be forty lies.
    The column earns its keep the moment the analyst adds a line for a place **not** yet
    proven — that one arrives at `to do`, and the column then means "is there a proof for
    this row".

    ``taken``/``total`` count proofs, which is what the limit is on.
    """
    columns = proof_columns()
    items, total = _proof_rows(case, limit)

    rows: list[list[str]] = []
    links: dict[str, dict[str, str]] = {}
    promoted: dict[str, dict[str, str]] = {}
    built: dict[str, str] = {}
    for item in items:
        key = sheet_engine.new_row_id()
        filled = {sheet_engine.ID_COLUMN: key, STATUS_COLUMN: "done", **item["cells"]}
        rows.append([filled.get(name, "") for name in columns])
        links[key] = item["links"]
        promoted[key] = {TITLE_COLUMN: item["cells"][TITLE_COLUMN]}
        built[key] = item["id"]

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
        "taken": len(set(built.values())),
        "total": total,
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
    refresh nobody presses twice. A sheet built before a column existed keeps its own
    columns: the new ones are not forced on it.

    **New rows land at the end**, in label order among themselves. Inserting them in
    place would reshuffle a table somebody is working down; the sheet's own sort is where
    order is decided. A point added to a proof is a new row like any other.

    A row is found again by its proof and its place, so one per point: a sheet built when
    this shape was one row per proof finds its rows by the place they carry.

    Refused on any other sheet. The shape is recognised by its `Title` column being
    `locked` — a heading alone would not do, since nothing stops an imported binder from
    holding a column called *Title*, and pouring every proof in the case into it would
    file a hundred rows of empty cells nobody asked for. Only this build writes that role.
    """
    roles = (meta.get("roles") or {}) if isinstance(meta, dict) else {}
    if (roles.get(TITLE_COLUMN) or {}).get("kind") != "locked" or TITLE_COLUMN not in columns:
        raise sheet_engine.SheetError("this sheet was not built out of the case's proofs")
    items, _ = _proof_rows(case, limit)
    return _refresh(
        case,
        columns,
        rows,
        meta,
        items,
        key_column=TITLE_COLUMN,
        born=lambda cells: "done",
        row_match=lambda built_id, row_links: _match(built_id, row_links.get(PLACE_COLUMN, "")),
    )


def _refresh(
    case: "Case",
    columns: list[str],
    rows: list[list[str]],
    meta: dict[str, Any],
    items: list[dict[str, Any]],
    *,
    key_column: str,
    born: Any,
    row_match: Any,
    advance: Any = None,
) -> dict[str, Any]:
    """The refresh both fixed shapes share: rewrite the case's columns on the rows that
    stand for an item, add a row for each item that has none, count the rows whose entity
    is gone.

    An item is ``{id, match, cells, links}``: the entity a row is built from, the key it
    is found again by, and what it fills. ``row_match`` reads that key back off a standing
    row. ``born`` is the status a new row starts at; ``advance`` may move a standing row's
    status on, and returns None to leave it alone."""
    key_at = sheet_engine.key_index(columns)
    index = {name: position for position, name in enumerate(columns)}
    links = {str(key): dict(cells) for key, cells in (meta.get("links") or {}).items()}
    promoted = {str(key): dict(cells) for key, cells in (meta.get("promoted") or {}).items()}
    built = {str(key): str(value) for key, value in (meta.get("built") or {}).items() if value}

    # Which row already stands for which item. The sidecar's own record rather than a
    # match on the text: the label is what changes, so matching on it would file a second
    # row for every entity somebody renamed.
    standing_at: dict[str, str] = {}
    for row_key, entity_id in built.items():
        standing_at.setdefault(row_match(entity_id, links.get(row_key) or {}), row_key)

    table = [list(row) for row in rows]
    where = {row[key_at]: position for position, row in enumerate(table) if key_at < len(row)}
    status_at = index.get(STATUS_COLUMN)
    updated, added = 0, 0
    for item in items:
        cells, cell_links = item["cells"], item["links"]
        standing = standing_at.get(item["match"])
        if standing is not None and standing in where:
            row = table[where[standing]]
            for name, value in cells.items():
                position = index.get(name)
                if position is not None and position < len(row) and row[position] != value:
                    row[position] = value
                    updated += 1
            if advance is not None and status_at is not None and status_at < len(row):
                moved = advance(row[status_at], cells)
                if moved is not None and moved != row[status_at]:
                    row[status_at] = moved
                    updated += 1
            links[standing] = cell_links
            promoted[standing] = {key_column: cells[key_column]}
            continue
        key = sheet_engine.new_row_id()
        row = [""] * len(columns)
        if key_at < len(row):
            row[key_at] = key
        for name, value in {**cells, STATUS_COLUMN: born(cells)}.items():
            position = index.get(name)
            if position is not None and position < len(row):
                row[position] = value
        table.append(row)
        links[key] = cell_links
        promoted[key] = {key_column: cells[key_column]}
        built[key] = item["id"]
        added += 1

    # What the rows already on the table were built from, and which of those the case
    # still holds. Asked of the case rather than of the page above: a build cut at the
    # limit must not report every entity past it as deleted.
    carried = {str(key): built[key] for key in where if key in built}
    alive = {
        str(entity["id"])
        for entity in case.entities_by_ids(sorted(set(carried.values())))
    }
    gone = sum(1 for entity_id in set(carried.values()) if entity_id not in alive)
    return {
        "columns": list(columns),
        "rows": table,
        "meta": {**meta, "links": links, "promoted": promoted, "built": built},
        "added": added,
        "updated": updated,
        "gone": gone,
    }


# -- the worklist shape: one row per file to geolocate ---------------------------
#
# The analyst's queue rather than their index. `My geolocations` lists what has been
# done, one row per proof; this lists what was brought in to be done, one row per picture
# or video the analyst imported, and says which of them a proof already answers. Only
# imported material: a frame cut in Inspect, a capture or a Compare render is the work
# itself, and a row for each would be a worklist of the worklist.

#: The file, and the column its link hangs on.
FILE_COLUMN = "File"

#: The address of the post the file came from, as the case recorded it at import. Locked
#: and linkless: it is a fact about the file, and the grid opens any address it shows.
ADDRESS_COLUMN = "Source URL"

#: The proof made out of this file, however many steps down: a proof built on a frame of
#: a video answers for the video.
PROOF_COLUMN = "Proof"

#: What a file must be to have a row: something a place can be read off.
FILE_KINDS = ("image", "video")

#: How far down a derivation a file's proofs are looked for.
_DESCENT = 6

#: The words a refresh may move on to `done` when a proof appears. A status the analyst
#: set to anything else — `ruled out`, a word of their own — is theirs and stays.
_OPEN_STATES = ("", "to do", "in progress")


def files_columns() -> list[str]:
    """The shape's headings: what the case says, then what you say."""
    return [
        sheet_engine.ID_COLUMN,
        FILE_COLUMN,
        ADDRESS_COLUMN,
        PROOF_COLUMN,
        PLACE_COLUMN,
        POINT_COLUMN,
        IN_CASE_COLUMN,
        STATUS_COLUMN,
        NOTES_COLUMN,
    ]


def files_roles() -> dict[str, Any]:
    """Locked where the case answers, free where the analyst does: `Status` and `Notes`."""
    return {
        FILE_COLUMN: {"kind": "locked"},
        ADDRESS_COLUMN: {"kind": "locked"},
        PROOF_COLUMN: {"kind": "locked"},
        PLACE_COLUMN: {"kind": "locked"},
        POINT_COLUMN: {"kind": "computed", "of": "point", "from": PLACE_COLUMN},
        IN_CASE_COLUMN: {"kind": "computed", "of": "in_case"},
        STATUS_COLUMN: {"kind": "state"},
    }


def imported_files(case: "Case") -> list[dict[str, Any]]:
    """Every picture and video the analyst brought in, by name.

    What the Media Library calls collected: not a route the app produced it by
    (``links.PRODUCED_HERE``), and a kind a place can be read off.
    """
    from . import links as link_engine

    files: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        page = case.page_entities(limit=500, cursor=cursor, types=["media"], order="label")
        items = list(page.get("items", []))
        ids = [str(item["id"]) for item in items]
        kinds = case.media_kinds(ids)
        origins = case.media_origins(ids)
        for item in items:
            origin = (origins.get(str(item["id"])) or {}).get("type")
            if kinds.get(str(item["id"])) in FILE_KINDS and origin not in link_engine.PRODUCED_HERE:
                files.append(item)
        cursor = page.get("next_cursor")
        if not cursor:
            return files


def _file_graph(case: "Case") -> tuple[dict[str, list[str]], dict[str, list[str]], dict[str, Any]]:
    """Which proofs answer for each file, where each file and proof is placed, and the
    entities those name. One pass over the links for the whole build."""
    from . import links as link_engine

    parents: dict[str, list[str]] = {}
    shows: dict[str, list[str]] = {}
    for link in case.list_links():
        kind = str(link.get("type") or "")
        source, target = str(link.get("from") or ""), str(link.get("to") or "")
        if not source or not target:
            continue
        if kind == link_engine.DERIVED_FROM:
            parents.setdefault(source, []).append(target)
        elif kind in (link_engine.DEPICTS, link_engine.LOCATED_AT):
            shows.setdefault(source, []).append(target)

    proofs: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        page = case.page_entities(limit=500, cursor=cursor, types=["proof"])
        proofs.extend(page.get("items", []))
        cursor = page.get("next_cursor")
        if not cursor:
            break

    answered: dict[str, list[str]] = {}
    for proof in proofs:
        proof_id = str(proof["id"])
        seen: set[str] = set()
        frontier = [proof_id]
        for _ in range(_DESCENT):
            frontier = [
                parent for current in frontier for parent in parents.get(current, [])
                if parent not in seen
            ]
            frontier = list(dict.fromkeys(frontier))
            if not frontier:
                break
            for parent in frontier:
                seen.add(parent)
                answered.setdefault(parent, []).append(proof_id)

    named = {target for targets in shows.values() for target in targets}
    known = {str(proof["id"]): proof for proof in proofs}
    known.update(
        {str(entity["id"]): entity for entity in case.entities_by_ids(sorted(named))}
    )
    return answered, shows, known


def _file_cells(
    item: dict[str, Any],
    answered: dict[str, list[str]],
    shows: dict[str, list[str]],
    known: dict[str, Any],
) -> tuple[dict[str, str], dict[str, str]]:
    """One file as its four cells and the links behind them. The place is the proof's
    when there is one, else wherever the case already puts the file itself."""
    file_id = str(item["id"])
    proof = _first(answered.get(file_id, []), known, ("proof",))
    place = (_first(shows.get(proof, []), known, ("place",)) if proof else "") or _first(
        shows.get(file_id, []), known, ("place",)
    )
    cells = {
        FILE_COLUMN: _cell(item.get("label")),
        ADDRESS_COLUMN: _cell((item.get("attrs") or {}).get("source_url")),
        PROOF_COLUMN: _cell((known.get(proof) or {}).get("label")) if proof else "",
        PLACE_COLUMN: _cell((known.get(place) or {}).get("label")) if place else "",
    }
    links = {FILE_COLUMN: file_id}
    if proof:
        links[PROOF_COLUMN] = proof
    if place:
        links[PLACE_COLUMN] = place
    return cells, links


def _born(cells: dict[str, str]) -> str:
    return "done" if cells.get(PROOF_COLUMN) else "to do"


def _advance(status: str, cells: dict[str, str]) -> str | None:
    """A file that now has a proof is done, unless the analyst already said otherwise."""
    if cells.get(PROOF_COLUMN) and status.strip().casefold() in _OPEN_STATES:
        return "done"
    return None


def build_files(case: "Case", *, limit: int = MAX_FROM_CASE) -> dict[str, Any]:
    """The table, the sidecar and the counts for one row per imported picture or video.

    A row starts at `done` when a proof already answers for its file and at `to do`
    otherwise, so the progress count on the day it is built is the true one.
    """
    columns = files_columns()
    taken = max(0, min(int(limit), MAX_FROM_CASE))
    everything = imported_files(case)
    files = everything[:taken]
    answered, shows, known = _file_graph(case)

    rows: list[list[str]] = []
    links: dict[str, dict[str, str]] = {}
    promoted: dict[str, dict[str, str]] = {}
    built: dict[str, str] = {}
    for item in files:
        key = sheet_engine.new_row_id()
        cells, cell_links = _file_cells(item, answered, shows, known)
        filled = {sheet_engine.ID_COLUMN: key, STATUS_COLUMN: _born(cells), **cells}
        rows.append([filled.get(name, "") for name in columns])
        links[key] = cell_links
        promoted[key] = {FILE_COLUMN: cells[FILE_COLUMN]}
        built[key] = str(item["id"])

    meta = {
        **sheet_engine.empty_meta(),
        "links": links,
        "promoted": promoted,
        "built": built,
        "roles": files_roles(),
        "progress": STATUS_COLUMN,
    }
    return {
        "columns": columns,
        "rows": rows,
        "meta": meta,
        "taken": len(rows),
        "total": len(everything),
    }


def refresh_files(
    case: "Case",
    columns: list[str],
    rows: list[list[str]],
    meta: dict[str, Any],
    *,
    limit: int = MAX_FROM_CASE,
) -> dict[str, Any]:
    """Bring a files worklist level with the case: the proofs rules, plus one more.

    **A status moves on by itself, once.** A file that a proof now answers goes from
    `to do` or `in progress` to `done`. That is the whole point of the list, and the only
    status a refresh ever writes; one the analyst set to anything else stays.

    Recognised by its `File` column being `locked`, which only this build writes.
    """
    roles = (meta.get("roles") or {}) if isinstance(meta, dict) else {}
    if (roles.get(FILE_COLUMN) or {}).get("kind") != "locked" or FILE_COLUMN not in columns:
        raise sheet_engine.SheetError("this sheet was not built out of the case's files")
    taken = max(0, min(int(limit), MAX_FROM_CASE))
    files = imported_files(case)[:taken]
    answered, shows, known = _file_graph(case)
    items = []
    for item in files:
        cells, cell_links = _file_cells(item, answered, shows, known)
        file_id = str(item["id"])
        items.append({"id": file_id, "match": file_id, "cells": cells, "links": cell_links})
    return _refresh(
        case,
        columns,
        rows,
        meta,
        items,
        key_column=FILE_COLUMN,
        born=_born,
        row_match=lambda built_id, row_links: built_id,
        advance=_advance,
    )


def files_preview(case: "Case") -> dict[str, Any]:
    """What a files worklist would hold, and the one the case already has.

    ``total`` is every imported picture and video, ``answered`` how many a proof already
    answers for. ``sheet`` is the newest sheet built in this shape, so a second press
    opens the worklist the analyst is working down instead of starting a twin of it.
    """
    files = imported_files(case)
    answered, _, _ = _file_graph(case) if files else ({}, {}, {})
    sheets = sorted(
        (entity for entity in case.list_entities() if entity.get("type") == "sheet"),
        key=lambda entity: str((entity.get("provenance") or {}).get("at") or ""),
        reverse=True,
    )
    existing = next(
        (
            str(entity["id"])
            for entity in sheets
            if (sheet_engine.stored_roles(case, entity).get(FILE_COLUMN) or {}).get("kind")
            == "locked"
        ),
        None,
    )
    return {
        "total": len(files),
        "answered": sum(1 for item in files if answered.get(str(item["id"]))),
        "sheet": existing,
    }


def refresh(
    case: "Case",
    columns: list[str],
    rows: list[list[str]],
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Refresh whichever fixed shape this sheet was built as."""
    roles = (meta.get("roles") or {}) if isinstance(meta, dict) else {}
    if (roles.get(FILE_COLUMN) or {}).get("kind") == "locked":
        return refresh_files(case, columns, rows, meta)
    return refresh_proofs(case, columns, rows, meta)
