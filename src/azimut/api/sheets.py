"""REST API for case sheets: list, create, import, read, save and hand over.

Three of the routes here are not about the table at all, and they exist because the
grid's own state and the file's own state are different things:

- ``PUT .../meta`` writes the sidecar alone. A filter, a colour, a hidden column and a
  pinned row are the grid, not the table, and rewriting the CSV to record one of them
  moved the modification time the stamp is made of.
- ``GET .../stamp`` is a stat, asked when the window comes back into focus, so an analyst
  who edited the file in a spreadsheet hears about it then rather than at their next save.
- ``POST .../links/check`` asks whether a column of sources still answers. It reaches the
  network, and only on a press. The other road that does is not here at all: building
  proofs out of a geolocation index runs as a job in `api/sheetproofs.py`, because it
  fetches files and everything in this module is a reading of what the analyst typed.

The tables themselves live in `engine/sheets.py`, which owns the one CSV parser
and the one CSV writer in the app. That matters more here than it looks: the
browser never parses or serialises CSV, so an imported file and a saved grid go
through the same code and cannot drift into two readings of the same table.

An import therefore posts **text**, not a parsed table — a dropped file and a
pasted block are the same request, and the delimiter is guessed on the side that
will write the file back.

Saving also restates what the sheet's cells point at. Every entity a cell links to
becomes a ``mentions`` edge, so a row naming a subject is visible from that
subject's side too, and a link the analyst clears loses its edge on the next save.

A save is **conditional**. The read handed out a stamp of the file; presenting it
back is what proves the grid is editing the table that is on disk. Since the file is
the artifact, the analyst may well have it open in a spreadsheet at the same time,
and a 409 telling them to reload is the only honest answer to two writers.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .. import layout
from ..engine import exportdir
from ..engine import reveal as reveal_engine
from ..engine import sheetfromcase as fromcase_engine
from ..engine import sheetlinks
from ..engine import sheetpass as pass_engine
from ..engine import sheetpromote as promote_engine
from ..engine import sheetroles
from ..engine import sheets as sheet_engine
from ..engine import sheetxlsx as xlsx_engine
from ..workspace import CaseError
from .cases import get_case

router = APIRouter(prefix="/api/cases", tags=["sheets"])

#: JSON overhead above a full table of maximum cells. Enforced by the ASGI body
#: guard in `server.py` before Pydantic materialises the request.
MAX_SHEET_BODY_BYTES = 32_000_000

#: Where a downloaded file records the page it came from (`engine/media.py`). Matched
#: rather than guessed at: it is the one field that means "this file came from that
#: page", where a title looking like a filename means nothing at all.
SOURCE_URL_ATTR = "source_url"


class SheetIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class SheetImportIn(SheetIn):
    """A CSV to file as a sheet, as the text of the file.

    Text rather than an upload because the same route serves a dropped file and a
    table pasted out of a browser, and because parsing belongs on the side that
    writes the result back.
    """

    text: str = Field(max_length=sheet_engine.MAX_IMPORT_BYTES)


class SheetSaveIn(BaseModel):
    """A table to write, and the stamp of the file it was read from.

    ``stamp`` is what the grid received from the read it is editing. Sent, the save
    is refused when the file has moved on; omitted, the write is unconditional. The
    grid always sends it — the field is optional so that a caller holding a table it
    built itself is not made to invent one.
    """

    columns: list[str] = Field(max_length=sheet_engine.MAX_COLUMNS)
    rows: list[list[str]] = Field(max_length=sheet_engine.MAX_ROWS)
    meta: dict[str, Any] = Field(default_factory=dict)
    stamp: str | None = Field(default=None, max_length=80)


def _sheets(case: Any) -> list[dict[str, Any]]:
    return [
        sheet_engine.summary(case, entity)
        for entity in case.list_entities()
        if entity.get("type") == "sheet"
    ]


@router.get("/{case_id}/sheets")
def list_sheets(case_id: str) -> dict[str, Any]:
    return {"sheets": _sheets(get_case(case_id))}


class SheetCreateIn(SheetIn):
    """A new sheet, and the columns it is born with.

    ``columns`` is what a template amounts to: the four tables an analyst rebuilds by hand
    every case — a verification worklist, a geolocation index, a list of accounts, a run of
    events — are a list of headings and nothing more. What the app should *know* about those
    columns is a sidecar, so it arrives by the ordinary save that follows: there is one
    writer for a sidecar and this is not it.
    """

    columns: list[str] | None = Field(default=None, max_length=sheet_engine.MAX_COLUMNS)


@router.post("/{case_id}/sheets")
def create_sheet(case_id: str, body: SheetCreateIn) -> dict[str, Any]:
    """A new sheet, born with columns rather than empty.

    An empty grid asks the analyst to design a table before they have anything to
    put in it. *Subject · Status · Notes* is the worklist every case starts with,
    and renaming a column is one click.
    """
    case = get_case(case_id)
    try:
        return sheet_engine.create(case, body.title.strip(), body.columns)
    except (CaseError, sheet_engine.SheetError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{case_id}/sheets/import")
def import_sheet(case_id: str, body: SheetImportIn) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        columns, rows = sheet_engine.parse_csv(body.text)
        return sheet_engine.create(case, body.title.strip(), columns, rows)
    except (CaseError, sheet_engine.SheetError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class SheetFromCaseIn(SheetIn):
    """A worklist to build out of the catalog: which type, and which of its fields.

    The fields are named rather than swept: a sheet holding every attribute of every
    entity would be a second copy of the graph, and the second copy is the one that goes
    stale. Anything the type does not declare is dropped rather than refused, the same
    rule a promotion's column mapping follows.
    """

    type: str = Field(min_length=1, max_length=40)
    fields: list[str] = Field(default_factory=list, max_length=sheet_engine.MAX_COLUMNS)
    limit: int = Field(default=fromcase_engine.MAX_FROM_CASE, ge=1)


@router.post("/{case_id}/sheets/from-case")
def sheet_from_case(case_id: str, body: SheetFromCaseIn) -> dict[str, Any]:
    """File a sheet whose rows are entities the case already holds.

    The other direction of the promotion road. Written in two steps on purpose: the
    create route owns making the file, and the save owns the sidecar — so the links this
    build hangs on the rows go through the one writer that cleans them, and the sheet
    gains its ``mentions`` edges by the same code every other save uses.
    """
    case = get_case(case_id)
    try:
        built = fromcase_engine.build(
            case, entity_type=body.type, fields=body.fields, limit=body.limit
        )
        entity = sheet_engine.create(case, body.title.strip(), built["columns"], built["rows"])
        saved = sheet_engine.write(
            case, entity["id"], built["columns"], built["rows"], built["meta"]
        )
    except (CaseError, sheet_engine.SheetError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _sync_mentions(case, entity["id"], saved["meta"])
    return {**entity, "taken": built["taken"], "total": built["total"]}


#: How many entities one request may ask the place of, and how many addresses one row may
#: offer the media library. A bound rather than the row limit: both are answered out of the
#: graph in one read, and a caller asking about twenty thousand is not asking a question.
MAX_POINTS = 2000


class SheetPointsIn(BaseModel):
    """The entities a column's cells point at, whose place the sheet wants to read."""

    ids: list[str] = Field(max_length=MAX_POINTS)


@router.post("/{case_id}/sheets/{sheet_id}/points")
def sheet_points(case_id: str, sheet_id: str, body: SheetPointsIn) -> dict[str, Any]:
    """Where the case puts each of these entities.

    What makes a column of place names two halves rather than one: the rows already
    pointing at something the case has placed are answered here — exactly, offline and at
    once — and only the words left over are worth a paced request to a geocoder that is
    guessing from a name. Before this, a linked row cost a second of somebody else's
    server to be told nothing.

    An entity reached by two different points is left out rather than resolved: the row
    keeps its analyst.
    """
    case = get_case(case_id)
    # Checked and not read, like `match`: this is a question about the graph, and parsing
    # twenty thousand rows to prove the caller owns a column would be a read nothing uses.
    entity = case.get_entity(sheet_id)
    if entity is None or entity.get("type") != "sheet":
        raise HTTPException(status_code=404, detail=f"sheet '{sheet_id}' not found")
    return {"points": sheetroles.entity_points(case, body.ids)}


class SheetTextIn(BaseModel):
    """The text of a CSV, to be read into a table and handed straight back."""

    text: str = Field(max_length=sheet_engine.MAX_IMPORT_BYTES)


@router.post("/{case_id}/sheets/parse")
def parse_sheet_text(case_id: str, body: SheetTextIn) -> dict[str, Any]:
    """A CSV read into a table, without filing anything.

    What "add these rows to the sheet I already have" needs, and the reason it is a route
    rather than three lines in the browser: there is one CSV parser in this app. A second
    one on the other side would guess the delimiter differently, and the file it disagreed
    about would be the one an analyst is importing at that moment.

    Nothing is written, so nothing is named: the case is read only to prove the caller
    holds one.
    """
    get_case(case_id)
    try:
        columns, rows = sheet_engine.parse_csv(body.text)
    except sheet_engine.SheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"columns": columns, "rows": rows}


class SheetTitleIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    #: Whether the copy carries the rows or only the shape. A binder is three tables at
    #: one schema — an inbox, a worklist, a reference — and the second of them starts as
    #: the first one's columns with nothing under them.
    empty: bool = Field(default=False)


@router.post("/{case_id}/sheets/{sheet_id}/duplicate")
def duplicate_sheet(case_id: str, sheet_id: str, body: SheetTitleIn) -> dict[str, Any]:
    """A second sheet holding the same table and the same sidecar, or only its shape.

    "Another reading of these rows is another sheet" is this app's answer to saved views,
    and it was an answer with no button behind it: the only way to fork a sheet was to
    export the CSV and import it back, which arrives stripped of every colour, role and
    link. The copy gains its own `mentions` edges, because its cells point where the
    original's did.

    ``empty`` forks the headings and everything the app knows about them and leaves the
    rows behind. Which is the *other* thing an analyst wanted from a duplicate, and the
    two are one route because they are one write with one flag between them.
    """
    case = get_case(case_id)
    try:
        made = sheet_engine.duplicate(case, sheet_id, body.title, with_rows=not body.empty)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except sheet_engine.SheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _sync_mentions(case, made["id"], made["meta"])
    return made


class SheetMoveIn(SheetSaveIn):
    """The rows to take out of this sheet, and the sheet to put them in.

    The table travels with the request for the same reason a promotion's does: the
    analyst moves what is on screen, and the version on disk may be a minute behind. So
    the stamp is presented and the write is refused if the file moved on underneath.
    """

    to: str = Field(min_length=1, max_length=80)
    keys: list[str] = Field(max_length=sheet_engine.MAX_ROWS)
    #: Which column lands in which, over there. Omitted, the names are matched as they
    #: always were; given, it is the answer to a screen that read both shapes and let the
    #: analyst line up two spellings of the same column.
    mapping: dict[str, str] | None = Field(default=None, max_length=sheet_engine.MAX_COLUMNS)


@router.post("/{case_id}/sheets/{sheet_id}/move")
def move_sheet_rows(case_id: str, sheet_id: str, body: SheetMoveIn) -> dict[str, Any]:
    """Move the ticked rows into another sheet, columns matched by name.

    The gesture the binders' tabs were built out of: an inbox, a worklist and a reference
    table at one schema, and a row moves up a floor once it has been worked out. Both
    sheets are written, and both restate what they mention, so a promoted row that moves
    is still reachable from its subject's side afterwards.
    """
    case = get_case(case_id)
    try:
        return sheet_engine.move_rows(
            case,
            sheet_id,
            body.to,
            body.keys,
            body.columns,
            body.rows,
            body.meta,
            mapping=body.mapping,
            expected=body.stamp,
        )
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except sheet_engine.SheetConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except sheet_engine.SheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class SheetUndoMoveIn(SheetSaveIn):
    """The sheet as it stood before a move, and the keys the rows landed under.

    The table travels for a second reason here: it *is* the undo. A move is not replayed
    backwards — it drops the columns the destination does not have, so a reverse move
    would hand the rows back with holes in them — so what goes back on disk is the copy
    the grid still has on screen.
    """

    to: str = Field(min_length=1, max_length=80)
    keys: list[str] = Field(max_length=sheet_engine.MAX_ROWS)


@router.post("/{case_id}/sheets/{sheet_id}/move/undo")
def undo_sheet_move(case_id: str, sheet_id: str, body: SheetUndoMoveIn) -> dict[str, Any]:
    """Put a move back, both ends of it, in one call.

    A move writes two files and the grid's own undo stack reaches neither, which is what
    made a mis-aimed one final. The stamp is presented as usual: an analyst who has typed
    into the sheet since is not overwritten by a button they pressed on the toast.
    """
    case = get_case(case_id)
    try:
        return sheet_engine.undo_move(
            case,
            sheet_id,
            body.to,
            body.keys,
            body.columns,
            body.rows,
            body.meta,
            expected=body.stamp,
        )
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except sheet_engine.SheetConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except sheet_engine.SheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class SheetMediaIn(BaseModel):
    """Addresses out of a row, to be matched against what the library already imported."""

    urls: list[str] = Field(max_length=MAX_POINTS)


@router.post("/{case_id}/sheets/{sheet_id}/media")
def sheet_media(case_id: str, sheet_id: str, body: SheetMediaIn) -> dict[str, Any]:
    """Which media the case already holds for each of these addresses.

    A worklist's link column and the Media Library's imports are the same pages twice, and
    until this existed nothing joined them: the analyst had downloaded the video, and the
    row pointing at its post could not say so. Matched on the **source URL the download
    recorded**, which is the one field that means "this file came from that page" — not on
    a resemblance between a title and a filename.
    """
    case = get_case(case_id)
    entity = case.get_entity(sheet_id)
    if entity is None or entity.get("type") != "sheet":
        raise HTTPException(status_code=404, detail=f"sheet '{sheet_id}' not found")
    found: dict[str, dict[str, str]] = {}
    for url in dict.fromkeys(text.strip() for text in body.urls):
        if not url:
            continue
        held = case.find_entity(attr=SOURCE_URL_ATTR, value=url)
        if held is not None:
            found[url] = {
                "id": str(held["id"]),
                "label": str(held.get("label") or ""),
                "type": str(held.get("type") or ""),
            }
    return {"media": found}


class SheetLinksIn(BaseModel):
    """Addresses out of one column, to be asked whether they still answer."""

    urls: list[str] = Field(max_length=sheetlinks.MAX_LINKS)


@router.post("/{case_id}/sheets/{sheet_id}/links/check")
def check_sheet_links(case_id: str, sheet_id: str, body: SheetLinksIn) -> dict[str, Any]:
    """Whether these addresses answer. The one part of a sheet that reaches the network.

    On a press and never on a read: a sheet that checked its own sources when it opened
    would tell forty hosts which case is being worked on, which is the boundary this app
    does not cross on its own.

    The sheet is checked and not read: the addresses come from the grid, so parsing twenty
    thousand rows to prove the caller owns a column would be a read nothing here uses.
    """
    case = get_case(case_id)
    entity = case.get_entity(sheet_id)
    if entity is None or entity.get("type") != "sheet":
        raise HTTPException(status_code=404, detail=f"sheet '{sheet_id}' not found")
    return {"links": sheetlinks.check_all(body.urls)}


@router.get("/{case_id}/sheets/{sheet_id}/stamp")
def sheet_stamp(case_id: str, sheet_id: str) -> dict[str, str]:
    """What the file looks like right now, as the token a save would present.

    Cheap on purpose — a stat, not a read — because the grid asks it every time the window
    comes back into focus. Without it, an analyst who edited the CSV in a spreadsheet went
    on working in a grid that showed the old table and only found out at the next save,
    which is the worst moment to be told.
    """
    case = get_case(case_id)
    entity = case.get_entity(sheet_id)
    if entity is None or entity.get("type") != "sheet":
        raise HTTPException(status_code=404, detail=f"sheet '{sheet_id}' not found")
    rel = (entity.get("attrs") or {}).get("path")
    if not isinstance(rel, str) or not rel:
        raise HTTPException(status_code=404, detail=f"sheet '{sheet_id}' has no file")
    return {"stamp": sheet_engine.stamp(case.resolve_inside(rel))}


class SheetMetaIn(BaseModel):
    """The grid's own state, on its own.

    No table and no stamp, because neither is touched: this is the route behind a filter
    ticked, a column hidden, a colour painted, a row pinned.
    """

    meta: dict[str, Any] = Field(default_factory=dict)


@router.put("/{case_id}/sheets/{sheet_id}/meta")
def save_sheet_meta(case_id: str, sheet_id: str, body: SheetMetaIn) -> dict[str, Any]:
    """Write the sidecar alone, leaving the CSV byte-identical.

    Half of what the grid remembers is not in the table — the widths, the sort, the
    filters, the colours — and routing those through the ordinary save meant rewriting the
    CSV to record that a funnel had been clicked. That moved the file's modification time,
    which is what the stamp is made of, so the analyst's own next save answered a conflict
    nobody caused and a spreadsheet open on the same file was told it had been overwritten.

    Since nothing here can lose a cell, no stamp is presented and none is checked.
    """
    case = get_case(case_id)
    try:
        saved = sheet_engine.write_meta(case, sheet_id, body.meta)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except sheet_engine.SheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _sync_mentions(case, sheet_id, saved["meta"])
    return {"status": "saved", **saved}


@router.get("/{case_id}/sheets/{sheet_id}")
def read_sheet(case_id: str, sheet_id: str) -> dict[str, Any]:
    try:
        return sheet_engine.read(get_case(case_id), sheet_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except sheet_engine.SheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/{case_id}/sheets/{sheet_id}")
def save_sheet(case_id: str, sheet_id: str, body: SheetSaveIn) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        saved = sheet_engine.write(
            case, sheet_id, body.columns, body.rows, body.meta, expected=body.stamp
        )
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except sheet_engine.SheetConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except sheet_engine.SheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _sync_mentions(case, sheet_id, saved["meta"])
    return {"status": "saved", **saved}


class SheetExportIn(BaseModel):
    """The table as the grid is showing it, to be written out as a CSV.

    No stamp and no sidecar: an export reads, it does not write, and what it reads is
    the screen rather than the file — a sheet filtered to the rows left to check
    exports those rows.
    """

    columns: list[str] = Field(max_length=sheet_engine.MAX_COLUMNS)
    rows: list[list[str]] = Field(max_length=sheet_engine.MAX_ROWS)


#: Which saved destination a sheet's CSV goes to, and the case subdir it falls back to.
#: Its own kind rather than the plates': an analyst files a table where they file tables,
#: and one folder for both would be a setting that cannot say either.
EXPORT_KIND = "sheets"
EXPORTS_DIR = "exports"


@router.post("/{case_id}/sheets/{sheet_id}/csv")
def export_sheet(case_id: str, sheet_id: str, body: SheetExportIn) -> dict[str, str]:
    """Write the rows on screen as a CSV, into the folder saved for sheet exports.

    A file rather than a download, the way a note's PDF and an analysis plate are: every
    other finished thing in this app lands in a folder the analyst chose, and a table that
    arrived in the browser's downloads instead was the one export nobody could find twice.

    Inside the case a re-export **overwrites**, so that folder is refreshed in one click
    rather than accumulating copies; in a folder of the analyst's own nothing is ever
    overwritten, because the files there are theirs.
    """
    case = get_case(case_id)
    try:
        written = sheet_engine.export_csv(case, sheet_id, body.columns, body.rows)
        destination = exportdir.destination(EXPORT_KIND, case.path)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except sheet_engine.SheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except exportdir.ExportDirError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # The same encoding the case's own CSV is written with, so a table handed to a
    # colleague opens in Excel the way the one in the case folder does.
    data = written["csv"].encode(sheet_engine.CSV_ENCODING)
    in_case = destination == layout.subdir(case.path, EXPORTS_DIR)
    try:
        if in_case:
            path = destination / written["filename"]
            path.write_bytes(data)
        else:
            path = exportdir.write_out(data, destination, written["filename"])
    except (OSError, exportdir.ExportDirError) as exc:
        raise HTTPException(status_code=409, detail=f"could not write the CSV: {exc}") from exc
    return {"file": path.name, "path": str(destination)}


@router.post("/{case_id}/sheets/csv/reveal")
def reveal_sheet_exports(case_id: str) -> dict[str, str]:
    """Open the folder the CSVs were written to, in the system file manager.

    Takes no path: the case and the saved destination are enough to find the folder, so
    nothing the browser sends can point somewhere else.
    """
    case = get_case(case_id)
    try:
        destination = exportdir.destination(EXPORT_KIND, case.path)
    except exportdir.ExportDirError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    try:
        reveal_engine.reveal(destination, workspace_only=False)
    except reveal_engine.RevealError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"status": "revealed", "path": str(destination)}


class SheetSubjectIn(BaseModel):
    """The one column that is the row's subject, and what it becomes.

    At most one per pass: two subjects in a row is the question the joins answer, not a
    second column in this mode.
    """

    column: str = Field(min_length=1, max_length=sheet_engine.MAX_COLUMN_NAME)
    type: str = Field(min_length=1, max_length=40)
    #: Column name to declared attr key. Anything undeclared is dropped rather than
    #: stored: it would become a field of the vocabulary nothing can show.
    fields: dict[str, str] = Field(default_factory=dict)
    attach: dict[str, str] = Field(default_factory=dict, max_length=promote_engine.MAX_PROMOTED)
    skip: list[str] = Field(default_factory=list, max_length=promote_engine.MAX_PROMOTED)
    #: Whether the ticked rows become one entity instead of one each.
    group: bool = Field(default=False)
    group_label: str | None = Field(default=None, max_length=sheet_engine.MAX_CELL)


class SheetValueColumnIn(BaseModel):
    """A column whose distinct words each become an entity, created or attached."""

    column: str = Field(min_length=1, max_length=sheet_engine.MAX_COLUMN_NAME)
    type: str = Field(min_length=1, max_length=40)
    attach: dict[str, str] = Field(default_factory=dict, max_length=promote_engine.MAX_COLUMN_WORDS)
    skip: list[str] = Field(default_factory=list, max_length=promote_engine.MAX_COLUMN_WORDS)


class SheetRowEdgeIn(BaseModel):
    """A column naming other rows of the same sheet, and the verb between them."""

    column: str = Field(min_length=1, max_length=sheet_engine.MAX_COLUMN_NAME)
    verb: str = Field(min_length=1, max_length=40)


class SheetJoinIn(BaseModel):
    """Two columns that designate something, and the verb the analyst picked.

    Ordered: the verb runs from the first to the second, and the reading the screen
    showed is what settled the direction.
    """

    from_: str = Field(alias="from", min_length=1, max_length=sheet_engine.MAX_COLUMN_NAME)
    to: str = Field(min_length=1, max_length=sheet_engine.MAX_COLUMN_NAME)
    verb: str = Field(min_length=1, max_length=40)

    model_config = {"populate_by_name": True}


class SheetPassIn(SheetSaveIn):
    """One declaration of what a sheet's columns become, and what joins what.

    The table travels with the request for the same reason every other promotion's does:
    the analyst sends what is on screen, which may hold edits the autosave has not written
    yet, and promoting the version on disk would promote yesterday's labels.

    One scope for the whole pass — `keys`, the ticked rows — so a count that does not add
    up has one reading rather than one per mode.
    """

    keys: list[str] = Field(default_factory=list, max_length=promote_engine.MAX_PROMOTED)
    subject: SheetSubjectIn | None = Field(default=None)
    #: Which column holds the coordinates. A place is deduplicated on the point itself,
    #: and the verb joining the subject to it is read out of the registry.
    point: str = Field(default="", max_length=sheet_engine.MAX_COLUMN_NAME)
    #: Which column holds the pages a row rests on. Each becomes a bookmark that mentions
    #: the subject, which is a `bookmark` and never a file: this road fetches nothing.
    addresses: str = Field(default="", max_length=sheet_engine.MAX_COLUMN_NAME)
    values: list[SheetValueColumnIn] = Field(default_factory=list, max_length=20)
    #: The claims engine's own arguments, passed through. A column of hours is a statement
    #: about the row's subject, and that engine already builds the whole thing.
    statement: dict[str, Any] | None = Field(default=None)
    row_edges: list[SheetRowEdgeIn] = Field(default_factory=list, max_length=20)
    joins: list[SheetJoinIn] = Field(default_factory=list, max_length=40)
    #: One confidence for the pass, applied to the edges the registry declares ratable.
    #: Absent means the analyst asserted nothing beyond the edge itself.
    confidence: int | None = Field(default=None)


def _declaration(body: SheetPassIn, names: list[str], table: list[list[str]]) -> dict[str, Any]:
    """The arguments the plan and the press both take, stated once."""
    return {
        "columns": names,
        "rows": table,
        "meta": body.meta,
        "keys": body.keys,
        "subject": body.subject.model_dump() if body.subject else None,
        "point": body.point,
        "addresses": body.addresses,
        "values": [column.model_dump() for column in body.values],
        "statement": body.statement,
        "row_edges": [column.model_dump() for column in body.row_edges],
        "joins": [{"from": join.from_, "to": join.to, "verb": join.verb} for join in body.joins],
        "confidence": body.confidence,
    }


@router.post("/{case_id}/sheets/{sheet_id}/promote/preview")
def preview_sheet_pass(case_id: str, sheet_id: str, body: SheetPassIn) -> dict[str, Any]:
    """Both layers of one pass, counted, with nothing written and no stamp checked.

    Reading a plan is not a change, and a preview refused because a spreadsheet touched
    the file would be a refusal to *look*. The press itself still checks.
    """
    case = get_case(case_id)
    try:
        names, table = sheet_engine.normalize(body.columns, body.rows)
        return pass_engine.plan(case, **_declaration(body, names, table))
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except sheet_engine.SheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{case_id}/sheets/{sheet_id}/promote")
def run_sheet_pass(case_id: str, sheet_id: str, body: SheetPassIn) -> dict[str, Any]:
    """Write one pass: every column's mode, the edges between them, the sheet's own save.

    All of it or none of it. The graph writes and the sheet's save run inside one
    `case.batch()`, so a file that moved under the analyst rolls the entities back on the
    way out — where the older roads had to hand their `made` ids to a compensating undo,
    which is code that only ever runs when something has already gone wrong.

    The stamp is still checked first, before a single entity exists: it used to be checked
    only by the save at the end, which meant a file touched in a spreadsheet produced a
    409 the analyst read as "nothing happened" over a case that had already gained forty
    subjects.
    """
    case = get_case(case_id)
    try:
        names, table = sheet_engine.normalize(body.columns, body.rows)
        sheet_engine.ensure_current(case, sheet_id, body.stamp)
        with case.batch():
            result = pass_engine.run(case, sheet_id, **_declaration(body, names, table))
            saved = sheet_engine.write(
                case,
                sheet_id,
                names,
                table,
                {
                    **body.meta,
                    "links": result["links"],
                    "values": result["values"],
                    "promoted": result["promoted"],
                },
                expected=body.stamp,
            )
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except sheet_engine.SheetConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except sheet_engine.SheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "status": "promoted",
        "entities": result["entities"],
        "joins": result["joins"],
        **saved,
    }


#: Restating what a sheet mentions lives beside the sidecar it reads
#: (`engine/sheets.sync_mentions`): the edges are a function of the sidecar, and the
#: routes here need exactly the same restatement after they have written one.
_sync_mentions = sheet_engine.sync_mentions


def _unfile(case: Any, made: list[dict[str, Any]]) -> None:
    """Take back the sheets one import filed, before its refusal is answered."""
    for filed in made:
        sheet_engine.discard(case, filed)


@router.post("/{case_id}/sheets/import-xlsx")
async def import_workbook(case_id: str, file: UploadFile) -> dict[str, Any]:
    """File every tab of a workbook as its own sheet, keeping the tabs' names.

    Multipart rather than the text the CSV import takes, because an .xlsx is a zip and
    base64 in JSON would be a third of the file again for nothing. What lands is the same
    thing a dropped CSV lands: real files in `sheets/`, parsed by the one parser.

    A tab with no cells is **named and not filed**: two tabs of a timeline binder hold
    nothing but pasted screenshots, and filing two empty sheets nobody asked for is worse
    than saying they were empty.

    An import is all of the tabs or none of them. A tab whose file cannot be written takes
    the ones already filed back out with it, so the retry that follows does not land a
    second copy of half a binder.

    ``dropped`` and ``cut`` are what the three ceilings left out. Said rather than applied
    quietly: the toast is the only place an analyst could learn that a thirty thousand row
    export arrived as twenty thousand.
    """
    case = get_case(case_id)
    data = await file.read(xlsx_engine.MAX_XLSX_BYTES + 1)
    if len(data) > xlsx_engine.MAX_XLSX_BYTES:
        raise HTTPException(status_code=413, detail="this workbook is too large to read")
    try:
        book = xlsx_engine.read_book(data)
    except sheet_engine.SheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    made: list[dict[str, Any]] = []
    empty: list[str] = []
    cut: list[dict[str, Any]] = []
    for tab in book["tabs"]:
        if not tab["columns"]:
            empty.append(tab["title"])
            continue
        try:
            made.append(sheet_engine.create(case, tab["title"], tab["columns"], tab["rows"]))
        except (CaseError, sheet_engine.SheetError) as exc:
            _unfile(case, made)
            raise HTTPException(status_code=422, detail=f"{tab['title']}: {exc}") from exc
        except sheet_engine.SheetUnwritable:
            # Answered 409 by the application handler, with the sentence naming the file.
            _unfile(case, made)
            raise
        if tab["cut_rows"] or tab["cut_columns"]:
            cut.append(
                {
                    "title": tab["title"],
                    "rows": tab["cut_rows"],
                    "columns": tab["cut_columns"],
                }
            )
    return {"sheets": made, "empty": empty, "dropped": book["dropped"], "cut": cut}
