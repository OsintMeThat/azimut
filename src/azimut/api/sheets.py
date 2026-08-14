"""REST API for case sheets: list, create, import, read and save.

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

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..engine import links as link_engine
from ..engine import sheets as sheet_engine
from ..workspace import CaseError
from .cases import get_case

router = APIRouter(prefix="/api/cases", tags=["sheets"])

#: JSON overhead above a full table of maximum cells. Enforced by the ASGI body
#: guard in `server.py` before Pydantic materialises the request.
MAX_SHEET_BODY_BYTES = 32_000_000


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


@router.post("/{case_id}/sheets")
def create_sheet(case_id: str, body: SheetIn) -> dict[str, Any]:
    """A new sheet, born with three columns rather than empty.

    An empty grid asks the analyst to design a table before they have anything to
    put in it. *Subject · Status · Notes* is the worklist every case starts with,
    and renaming a column is one click.
    """
    case = get_case(case_id)
    try:
        return sheet_engine.create(case, body.title.strip())
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


def _sync_mentions(case: Any, sheet_id: str, meta: dict[str, Any]) -> None:
    """Restate the entities this sheet's cells point at, as ``mentions`` edges.

    A target the vocabulary refuses is skipped rather than raised: the cell keeps
    its link and the grid keeps working, exactly as a note's body does with a token
    pointing somewhere odd. The sidecar is the record either way — the edges are
    what make the sheet visible from the other end.
    """
    source = case.get_entity(sheet_id)
    if source is None:
        return
    wanted: list[str] = []
    for entity_id in sheet_engine.linked_entity_ids(meta):
        try:
            link_engine.check_relation_target(case, source, entity_id, link_engine.MENTIONS)
        except CaseError:
            continue
        wanted.append(entity_id)
    case.sync_links(sheet_id, link_engine.MENTIONS, wanted, by="sheet")
