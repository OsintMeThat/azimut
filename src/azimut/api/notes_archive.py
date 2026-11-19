"""Archive every link of a note: what a press would do, the press, its progress, Stop.

`GET …/archive` says what the press would do, read from the case alone: the note's
outside links, which have an archived copy, how many the case lacks and would file
as bookmarks, how many more its internal passages hold, and the note's last run.
`GET …/archive/run` is that run alone, which the dialog asks while it goes. Neither
reaches the network.

`POST …/archive` is the press: it queues the run on the case's queue
(`engine/linkarchive.py`), which is the only thing that asks the Internet Archive
anything. `POST …/archive/stop` stops it, after the link under way.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..engine import linkarchive
from ..engine.notelook import CASE_NOTE
from ..workspace import Case
from .cases import get_case

router = APIRouter(prefix="/api/cases", tags=["notes"])


class ArchiveIn(BaseModel):
    #: Take the links of internal passages too (owner question 5: no by default).
    internal: bool = False
    #: Make a new copy even where the archive holds one under 30 days old (question 3).
    fresh: bool = False


def _note(case_id: str, note_id: str) -> Case:
    case = get_case(case_id)
    if note_id != CASE_NOTE:
        entity = case.get_entity(note_id)
        if entity is None or entity.get("type") != "note":
            raise HTTPException(status_code=404, detail=f"note '{note_id}' not found")
    return case


@router.get("/{case_id}/notes/{note_id}/archive")
def archive_plan(case_id: str, note_id: str, internal: bool = False) -> dict[str, Any]:
    """What Archive every link would do, and the last run. Nothing is fetched."""
    case = _note(case_id, note_id)
    try:
        said = linkarchive.plan(case, note_id, internal=internal)
    except linkarchive.ArchiveError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {**said, "run": linkarchive.view(case, note_id)}


@router.get("/{case_id}/notes/{note_id}/archive/run")
def archive_run(case_id: str, note_id: str) -> dict[str, Any]:
    """The note's run as it stands: each link's state and copy, its counts, the time left."""
    case = _note(case_id, note_id)
    return {"run": linkarchive.view(case, note_id)}


@router.post("/{case_id}/notes/{note_id}/archive")
def archive_links(case_id: str, note_id: str, body: ArchiveIn) -> dict[str, Any]:
    """The press: queue the run over every link of the note with no archived copy."""
    case = _note(case_id, note_id)
    try:
        run = linkarchive.start(case, note_id, internal=body.internal, fresh=body.fresh)
    except linkarchive.ArchiveError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"run": run}


@router.post("/{case_id}/notes/{note_id}/archive/stop")
def stop_archiving(case_id: str, note_id: str) -> dict[str, Any]:
    """Stop the run: at once while it waits, after the link under way while it runs."""
    case = _note(case_id, note_id)
    return {"run": linkarchive.stop(case, note_id)}
