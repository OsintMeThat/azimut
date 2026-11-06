"""REST API for the notebook: note bodies, and exporting them to PDF.

The case scratchpad and the filed notes are read and written here. So is the
export, which is the reason this left `api/cases.py`: turning a note into a
document is a surface of its own — a payload to bound, a renderer to drive and
files to write into the case's export folder.

An export writes one PDF per note into the folder the analyst chose for notes, the
case's own `exports/` until they pick another one (`engine/exportdir.py`), in one of
two editions: internal, the note whole, or public, without its `> [!internal]`
passages (`engine/notes_pdf.py`). A note with no such passage has one edition,
shareable as it stands, recorded as public. A PDF is never replaced. Each is named
`<title> - <edition> - <day>.pdf`, or `<title> - <day>.pdf` when there was no
edition to choose, a second one that day `… (2).pdf`, and the note
keeps a record of it among its editions (the `editions` attr, the case setting
`notes.case_editions` for the case notes): when, which edition, where, how many
pages, and the SHA-256 of the file and of the text it printed. `/notes/{id}/editions`
lists them; Check hashes a file again to say whether it is still the one written.
The files stay where they were written and are not case state.

Each note prints in its own look (`engine/notelook.py`), kept beside the note and
set through `/notes/{id}/look`. The page pane asks `/notes/preview` for the PDF of
the text being typed: the same renderer, the same bounds, nothing written. The
faces a look can pick are listed, and their regular weights served for the Look
control's samples, under `/api/notes/fonts`, outside any case. So are the three
pictures every note can show (`engine/notefill.py`), under `/api/notes/pictures`,
for the editor to draw: the Azimut logo, the analyst's logo and their signature.

A note cites a web source through `/sources/lookup`: the address is read for a name
and looked for among what the case already filed for it (`engine/urltitles.py`), so
a link pasted twice cites one item. Nothing is fetched.

Before an export, `/notes/pdf/check` lays the chosen notes out in memory and says,
note by note, what the PDF would get wrong (a picture no longer in the case, one
with no source, a task left open, a link a reader cannot open): the warnings the
page pane lists, with the line each is about and its kind. It writes nothing and
never stands in the way: the export goes on whatever it finds. For the public
edition it also says how many internal passages are left out.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
import stat
import threading
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Literal, NamedTuple

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import errors, layout
from ..engine import exportdir
from ..engine import links as link_engine
from ..engine import notelook
from ..engine import notes_pdf as pdf_engine
from ..engine import notefill, notefromcase, notelinks, notetext
from ..engine import pdffonts
from ..engine import reveal as reveal_engine
from ..engine import urltitles
from ..workspace import Case, CaseError
from .cases import get_case

router = APIRouter(prefix="/api/cases", tags=["notes"])
#: What every case's notes share: the faces a look can set a note in.
fonts_router = APIRouter(prefix="/api/notes", tags=["notes"])

#: The case's own scratchpad, which is a note without an entity behind it.
CASE_NOTE = notelook.CASE_NOTE
#: Where the PDFs land, until the case can point somewhere of its own.
EXPORTS_DIR = "exports"

#: Bounds on one export request. Generous enough for a whole case, small enough
#: that a single call cannot ask the machine to lay out a library.
MAX_NOTES = 200
MAX_DIAGRAMS = 120
MAX_DIAGRAM_BYTES = 4_000_000
MAX_DIAGRAM_TOTAL_BYTES = 16_000_000
#: JSON + base64 overhead above the decoded batch limit. Enforced by an ASGI
#: receive wrapper before Pydantic materialises the request.
MAX_PDF_BODY_BYTES = 24_000_000

#: What one note's Markdown may weigh, bounded like every other document the browser
#: hands back whole (`server.BulkBodyLimit`). Eight mebibytes is some eight million
#: characters — far past any note somebody writes, and a bound rather than none, which is
#: what this was. A note embeds its pictures by case-relative path, never as base64, so
#: the body is text and nothing else.
MAX_NOTE_BODY_BYTES = 8 * 1024 * 1024

#: How many notes the home, the search, the citations and the tasks read at most,
#: and how much of each. A case's notes are typed by a person, so these are far
#: past any real case and still a bound on one request.
MAX_READ_NOTES = 2000
MAX_READ_BYTES = 512 * 1024
MAX_SEARCH_RESULTS = 50

#: A preview carries one unsaved note and the diagrams drawn for it: the note as a
#: save bounds it, the pictures as an export does. Read by `server.BulkBodyLimit`.
MAX_PREVIEW_BODY_BYTES = MAX_PDF_BODY_BYTES
#: What the preview's headers may carry. A header is not a body, and a page map or a
#: list of warnings that outgrew this would be cut rather than refused.
MAX_PAGE_MAP = 2000
#: The pictures header's budget, in bytes: well under what a browser accepts.
MAX_PICTURES_HEADER = 48_000
MAX_HEADER_WARNINGS = 20
MAX_WARNING_CHARS = 300
MAX_DIAGRAM_HEADER_BYTES = 48 * 1024
#: One preview at a time in the process: the page pane asks again after every pause in
#: typing, and two layouts of one long report at once would only make both late. A
#: request that cannot have the turn in this long is told to try again.
PREVIEW_WAIT_SECONDS = 30.0
_preview_turn = threading.Lock()

#: Which edition a PDF is: the note whole, or without its internal passages.
Edition = Literal["internal", "public"]
#: How many editions a note keeps a record of, newest first. The files stay on disk.
MAX_EDITIONS = 50
#: Where the case notes, which have no entity, keep their record of editions.
CASE_EDITIONS = "notes.case_editions"
EDITIONS_ATTR = "editions"
#: The room an export's name keeps for the ` (2)` a later one the same day takes.
COUNTER_ROOM = len(" (999)")
#: A record is read back from the case and may have come in a bundle: each part checked.
SHA256 = re.compile(r"^[0-9a-f]{64}$")
STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
#: One edition record written at a time, so two exports of one note keep both.
_editions_turn = threading.Lock()


class Notes(BaseModel):
    text: str


class NoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    folder: str = Field(default="", max_length=120)
    content: str = ""
    #: Case-relative paths of the artifacts this note was written from, recorded as
    #: ``derived-from`` edges. A note typed from scratch sends none; a report note
    #: composed out of a proof and its media sends every one it embeds, so the chain
    #: is traversable from either end and deleting a source scars the note instead of
    #: leaving a dead image link nothing accounts for.
    sources: list[str] = Field(default_factory=list, max_length=200)


class TaskTick(BaseModel):
    line: int = Field(ge=0, le=1_000_000)
    text: str = Field(max_length=4000)
    done: bool


class NoteSelection(BaseModel):
    notes: list[str] = Field(min_length=1, max_length=MAX_NOTES)


class EditionSelection(NoteSelection):
    """Notes, and the edition they are laid out in: internal unless said."""

    edition: Edition = "internal"


class PreviewIn(BaseModel):
    """A note as the editor holds it right now, unsaved, and the look to print it in.

    ``text`` is bounded by bytes in the route (the same bound a save has) and the
    whole body by `server.BulkBodyLimit`, before it is parsed.
    """

    title: str = Field(default="", max_length=300)
    text: str = Field(default="", max_length=MAX_NOTE_BODY_BYTES)
    look: notelook.NoteLook | None = None
    diagrams: dict[str, str] = Field(default_factory=dict)
    edition: Edition = "internal"


class NotePreviewIn(PreviewIn):
    note: str = Field(default=CASE_NOTE, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class ExportIn(EditionSelection):
    """Which notes to export, in which edition, and the diagrams the browser drew for them.

    Mermaid needs a browser, so the caller asks which fences a selection holds
    (`/notes/pdf/diagrams`), draws them, and posts each one back as a PNG under
    the key it was given. One map serves every note in the request: two notes
    holding the same diagram upload it once.
    """

    diagrams: dict[str, str] = Field(default_factory=dict)


@router.get("/{case_id}/notes")
def read_notes(case_id: str) -> dict[str, str]:
    return {"text": get_case(case_id).read_notes()}


@router.put("/{case_id}/notes")
def write_notes(case_id: str, body: Notes) -> dict[str, str]:
    get_case(case_id).write_notes(body.text)
    return {"status": "saved"}


@router.post("/{case_id}/notes")
def create_note(case_id: str, body: NoteIn) -> dict[str, Any]:
    """File a Markdown note, and record what it was written from.

    ``sources`` goes through the same chain the other composing tools use on save
    (`api/proofs.py`, `api/drafts.py`): a note assembled out of a proof and its media
    is an artifact made from case files, so it says so. Without this a report note was
    the one filed artifact with no chain — its images pointed at case files that
    nothing in the graph knew it depended on.
    """
    case = get_case(case_id)
    note = case.create_note(body.title.strip(), body.folder.strip(), body.content)
    if body.sources:
        link_engine.sync(case, note["id"], link_engine.DERIVED_FROM, body.sources, by="note")
    # a note started from a template may already point at records; what it shows is
    # left to `sources` here, which a report states in full
    if body.content:
        _sync_mentions(case, note["id"], body.content)
    return note


class _Listed(NamedTuple):
    id: str
    title: str
    folder: str
    file: Path
    look: notelook.NoteLook | None


def _notes_on_disk(case: Case) -> Iterator[_Listed]:
    """Case notes, then every filed note: id, title, folder, file and look, bounded."""
    yield _Listed(CASE_NOTE, "Case notes", "", case.notes_path, notelook.stored(case, CASE_NOTE))
    cursor: str | None = None
    read = 0
    while read < MAX_READ_NOTES:
        page = case.page_entities(types=["note"], limit=500, cursor=cursor)
        for entity in page["items"]:
            path = (entity.get("attrs") or {}).get("path")
            if not isinstance(path, str):
                continue
            try:
                file = case.resolve_inside(path)
            except CaseError:
                continue
            read += 1
            folder = str((entity.get("attrs") or {}).get("folder") or "")
            look = notelook.stored(case, str(entity["id"]), entity=entity)
            yield _Listed(str(entity["id"]), str(entity.get("label") or "Note"), folder, file, look)
            if read >= MAX_READ_NOTES:
                return
        cursor = page.get("next_cursor")
        if not cursor:
            return


def _read_head(file: Path) -> str:
    """A note's text, up to the bound one listing reads of it."""
    try:
        with file.open("rb") as handle:
            return handle.read(MAX_READ_BYTES).decode("utf-8", errors="replace")
    except OSError:
        return ""


def _modified(file: Path) -> str | None:
    try:
        stamp = file.stat().st_mtime
    except OSError:
        return None
    return datetime.fromtimestamp(stamp, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/{case_id}/notes/index")
def notes_index(case_id: str) -> dict[str, Any]:
    """Every note as its card on the Notebook's home says it.

    Case notes come first and are always there, written or not. Each row carries
    what the card shows: the first words, how many words, the tasks left, what it
    cites, and when its file last changed.
    """
    case = get_case(case_id)
    items: list[dict[str, Any]] = []
    for note_id, title, folder, file, look in _notes_on_disk(case):
        text = _read_head(file)
        tasks = notetext.tasks(text)
        items.append({
            "id": note_id,
            "title": title,
            "folder": folder,
            "updated_at": _modified(file),
            "excerpt": notetext.excerpt(text, title),
            "words": notetext.word_count(text),
            "tasks": {"open": sum(not task.done for task in tasks), "done": sum(task.done for task in tasks)},
            "mentions": len(notetext.mentioned_ids(text)),
            "pictures": len(pdf_engine.embedded_entity_ids(text)),
            # how it prints, null for the plain default, and how many chapters it pulls in
            "look": look.model_dump(mode="json") if look is not None else None,
            "includes": len(notetext.included_ids(text)),
        })
    return {"items": items}


@router.get("/{case_id}/notes/search")
def search_notes(case_id: str, q: str = "", limit: int = 20) -> dict[str, Any]:
    """The notes holding every word of ``q``, each with the line it is first found on."""
    case = get_case(case_id)
    if not q.strip() or len(q) > 200:
        return {"items": [], "total": 0}
    bound = max(1, min(limit, MAX_SEARCH_RESULTS))
    items: list[dict[str, Any]] = []
    total = 0
    for note_id, title, folder, file, _ in _notes_on_disk(case):
        text = _read_head(file)
        hit = notetext.find(f"{title}\n{text}", q)
        if hit is None:
            continue
        total += 1
        if len(items) < bound:
            # the title was read as line 0, so the note's own lines are one further down
            line, snippet = hit
            items.append({"id": note_id, "title": title, "folder": folder,
                          "line": max(0, line - 1), "snippet": snippet})
    return {"items": items, "total": total}


@router.get("/{case_id}/notes/citations/{entity_id}")
def note_citations(case_id: str, entity_id: str) -> dict[str, Any]:
    """The notes that name ``entity_id``, with the lines they name it in."""
    case = get_case(case_id)
    items: list[dict[str, Any]] = []
    for note_id, title, folder, file, _ in _notes_on_disk(case):
        if note_id == entity_id:
            continue
        lines = notetext.citations(_read_head(file), entity_id)
        if lines:
            items.append({"id": note_id, "title": title, "folder": folder,
                          "lines": [{"line": line, "text": said} for line, said in lines[:5]]})
    return {"items": items}


@router.get("/{case_id}/sources/lookup")
def source_lookup(
    case_id: str, url: str, title: str = Query(default="", max_length=300)
) -> dict[str, Any]:
    """What a web address is called, and the case items already filed for it.

    Read off the address and the case alone: nothing is fetched, so a link pasted
    offline is named and found the same way. ``title`` is the one the page gave
    itself, when the browser that showed it passed it on (the extension's notes
    panel); it names the page only when the address says nothing better.
    """
    address = url.strip()
    if len(address) > 2048 or not urltitles.url_key(address):
        raise HTTPException(status_code=422, detail="the source must be an http(s) address")
    case = get_case(case_id)
    found = urltitles.find_by_url(case, address)
    return {
        "url": address,
        "title": urltitles.title_of(address, title),
        "found": [
            {"id": entity["id"], "type": entity["type"], "label": entity.get("label") or "",
             "attrs": entity.get("attrs") or {}}
            for entity in found
        ],
    }


@router.get("/{case_id}/notes/tasks")
def note_tasks(case_id: str) -> dict[str, Any]:
    """The tasks still open in the case's notes, note by note."""
    case = get_case(case_id)
    items: list[dict[str, Any]] = []
    for note_id, title, folder, file, _ in _notes_on_disk(case):
        tasks = notetext.tasks(_read_head(file))
        open_tasks = [task for task in tasks if not task.done]
        if open_tasks:
            items.append({"id": note_id, "title": title, "folder": folder,
                          "done": len(tasks) - len(open_tasks),
                          "tasks": [{"line": task.line, "text": task.text} for task in open_tasks[:50]]})
    return {"items": items}


@router.post("/{case_id}/notes/{note_id}/task")
def tick_task(case_id: str, note_id: str, body: TaskTick) -> dict[str, str]:
    """Tick or untick one task of a note, from outside the editor."""
    case = get_case(case_id)
    _, text = _note_source(case, note_id)
    try:
        changed = notetext.set_task(text, body.line, body.done, body.text)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if note_id == CASE_NOTE:
        case.write_notes(changed)
    else:
        case.write_note(note_id, changed)
    return {"text": changed}


# -- from the case ------------------------------------------------------------------
#
# Declared before `/notes/{note_id}`, which would otherwise take `from-case` for a note.


def _day(value: str, name: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{name} must be a day, YYYY-MM-DD") from exc


@router.get("/{case_id}/notes/from-case")
def notes_from_case(
    case_id: str,
    start: str = Query(default="", alias="from", max_length=10),
    end: str = Query(default="", alias="to", max_length=10),
    by: str = notefromcase.SHOWN,
    zone: str = Query(default="UTC", max_length=64),
) -> dict[str, Any]:
    """The geolocations of a period, for the note *From the case* writes
    (`engine/notefromcase.py`): the first 200 by date, how many the period holds, and
    how many this reading cannot date. Read only; nothing is fetched."""
    first, last = _day(start, "from"), _day(end, "to")
    case = get_case(case_id)
    try:
        found = notefromcase.period(case, start=first, end=last, by=by, zone=zone)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"from": start, "to": end, "by": by, "zone": zone, **found}


@router.get("/{case_id}/notes/{note_id}")
def read_note(case_id: str, note_id: str) -> dict[str, str]:
    try:
        return {"text": get_case(case_id).read_note(note_id)}
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{case_id}/notes/{note_id}")
def write_note(case_id: str, note_id: str, body: Notes) -> dict[str, str]:
    """Save a note's Markdown, and restate what it is made from.

    The body is the note's own statement of which case files it shows, so it is read
    on every save the way a proof's spec is: an image inserted through the Notebook's
    Media button gets its ``derived-from`` edge, and one deleted from the text loses
    it. Only the types the text can name are reconciled — the draft a report was
    composed in is the composer's to declare, and no wording could restate it.
    """
    case = get_case(case_id)
    try:
        case.write_note(note_id, body.text)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _restate(case, note_id, body.text)
    return {"status": "saved"}


@router.get("/{case_id}/notes/{note_id}/look")
def read_look(case_id: str, note_id: str) -> dict[str, Any]:
    """How a note prints, every key filled in (the default when it has none)."""
    case = get_case(case_id)
    _require_note(case, note_id)
    return {"look": notelook.effective(case, note_id).model_dump(mode="json")}


@router.put("/{case_id}/notes/{note_id}/look")
def write_look(case_id: str, note_id: str, body: notelook.NoteLook) -> dict[str, Any]:
    """Keep how a note prints. Writes the entity's attrs or the case settings, never
    the Markdown, and restates what the note shows: a cover picture is a picture the
    note shows, as one in its text is."""
    case = get_case(case_id)
    _require_note(case, note_id)
    if body.cover.image:
        picture = case.get_entity(body.cover.image) or {}
        kind = (picture.get("attrs") or {}).get("kind")
        if picture.get("type") not in link_engine.EMBEDDED_TYPES or kind in ("video", "audio"):
            raise HTTPException(status_code=422, detail="the cover picture must be a picture in this case")
    notelook.save(case, note_id, body)
    if note_id != CASE_NOTE:
        link_engine.sync_embedded(
            case,
            note_id,
            pdf_engine.embedded_entity_ids(_note_source(case, note_id)[1]) + notelook.cover_image_ids(body),
            by="note",
        )
    return {"look": body.model_dump(mode="json")}


def _require_note(case: Case, note_id: str) -> None:
    if note_id == CASE_NOTE:
        return
    entity = case.get_entity(note_id)
    if entity is None or entity.get("type") != "note":
        raise HTTPException(status_code=404, detail=f"note '{note_id}' not found")


@router.post("/{case_id}/notes/preview")
def preview_note(case_id: str, body: NotePreviewIn) -> Response:
    """The PDF a note would export as, from the text in the editor, written nowhere.

    The page pane draws these bytes. The look in the body wins over the stored one,
    so a look being tried prints before it is kept; included notes print as saved.
    The edition asked for is the one drawn, so the public pages are seen before
    they are written.
    """
    case = get_case(case_id)
    _require_note(case, body.note)
    title = body.title.strip() or _note_title(case, body.note)
    look = body.look if body.look is not None else notelook.effective(case, body.note)
    return preview_response(
        case,
        title=title,
        text=body.text,
        look=look,
        diagrams=body.diagrams,
        note_id=body.note,
        resolve=_resolver(case),
        edition=body.edition,
    )


def preview_response(
    case: Case | None,
    *,
    title: str,
    text: str,
    look: notelook.NoteLook,
    diagrams: dict[str, str],
    note_id: str = "",
    resolve: pdf_engine.Resolve | None = None,
    edition: Edition = "internal",
) -> Response:
    """Render a preview under the one-at-a-time turn and answer it as PDF bytes.

    Shared with the template preview (`api/templates.py`), which passes no case.
    The headers say what the page pane needs beside the pages: where each page
    starts in the text, which diagrams still need drawing, what was left out, and
    how many internal passages the note holds, for the pane to offer both editions.
    """
    if len(text.encode("utf-8")) > MAX_NOTE_BODY_BYTES:
        raise HTTPException(status_code=413, detail="the note is too large to preview")
    decoded = _decode_diagrams(diagrams)
    if not _preview_turn.acquire(timeout=PREVIEW_WAIT_SECONDS):
        raise HTTPException(status_code=503, detail="another preview is still being laid out")
    try:
        rendered = pdf_engine.render(
            case, title=title or "Untitled", text=text, diagrams=decoded, look=look,
            note_id=note_id, resolve=resolve, public=edition == pdf_engine.PUBLIC, light=True,
        )
    except pdffonts.FontError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except pdf_engine.NotesPdfError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        _preview_turn.release()
    return Response(
        content=rendered.pdf,
        media_type="application/pdf",
        headers={
            "Cache-Control": "no-store",
            "X-Note-Pages": _ascii_json(rendered.pages[:MAX_PAGE_MAP]),
            "X-Note-Diagrams": _diagram_header(rendered.diagrams),
            "X-Note-Warnings": _ascii_json(
                [warning[:MAX_WARNING_CHARS] for warning in rendered.warnings[:MAX_HEADER_WARNINGS]]
            ),
            # beside the list rather than in it, so a reader of the list alone keeps working
            "X-Note-Warning-Lines": _ascii_json(rendered.warning_lines[:MAX_HEADER_WARNINGS]),
            "X-Note-Warning-Kinds": _ascii_json(rendered.warning_kinds[:MAX_HEADER_WARNINGS]),
            "X-Note-Pictures": _pictures_header(rendered.pictures),
            "X-Note-Internal": str(rendered.internal),
        },
    )


@fonts_router.get("/fonts")
def note_fonts() -> dict[str, Any]:
    """The faces a note's look can set its text in, in the order the Look lists them."""
    return {"fonts": [{"key": font.key, "label": font.label, "kind": font.kind} for font in pdffonts.FONTS]}


@fonts_router.get("/fonts/{name}")
def note_font_file(name: str) -> FileResponse:
    """One choice's regular face, for the Look control to draw its sample in.

    Named by key from the fixed list, never by path, so nothing the browser sends
    can reach another file.
    """
    key, dot, extension = name.rpartition(".")
    font = pdffonts.FONTS_BY_KEY.get(key) if dot and extension == "ttf" else None
    if font is None:
        raise HTTPException(status_code=404, detail="no such font")
    return FileResponse(
        pdffonts.FONT_DIR / font.regular,
        media_type="font/ttf",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@fonts_router.get("/pictures/{name}")
def note_picture(name: str) -> FileResponse:
    """One of the three pictures a note can show, for the editor: ``logo`` (the
    app's), ``my-logo`` and ``my-signature`` (the analyst's, from Settings).

    Named from a fixed list, never by path. Not set answers 404. ``no-cache``: the
    analyst replaces their pictures, and a picture kept by the browser would show
    the old one under the new name.
    """
    path = notefill.picture_file(name)
    if path is None:
        raise HTTPException(status_code=404, detail="no such picture")
    media = "image/svg+xml" if name == notefill.LOGO else "image/png"
    return FileResponse(path, media_type=media, headers={"Cache-Control": "no-cache"})


def _ascii_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def _pictures_header(pictures: list[pdf_engine.PagePicture]) -> str:
    """Where the note's pictures landed, as many as the header holds: a long
    address is what a picture is found by again, so one past the cap is dropped
    rather than cut."""
    items: list[str] = []
    room = MAX_PICTURES_HEADER
    for picture in pictures:
        item = _ascii_json(picture.as_json())
        if len(item) + 1 > room:
            break
        room -= len(item) + 1
        items.append(item)
    return f"[{','.join(items)}]"


def _diagram_header(pending: list[tuple[str, str]]) -> str:
    """The fences still to draw, as many as the header holds: the browser draws
    those, asks again, and is handed the rest then."""
    kept: list[dict[str, str]] = []
    size = 2
    for key, source in pending[:MAX_DIAGRAMS]:
        item = {"key": key, "source": source}
        cost = len(_ascii_json(item)) + 1
        if size + cost > MAX_DIAGRAM_HEADER_BYTES:
            break
        kept.append(item)
        size += cost
    return _ascii_json(kept)


def _note_title(case: Case, note_id: str) -> str:
    if note_id == CASE_NOTE:
        return "Case notes"
    entity = case.get_entity(note_id)
    return str((entity or {}).get("label") or "Note")


def _resolver(case: Case) -> pdf_engine.Resolve:
    """How a chapter finds the note it prints: as saved, the case notes included."""

    def resolve(note_id: str) -> tuple[str, str] | None:
        if note_id == CASE_NOTE:
            return "Case notes", case.read_notes()
        entity = case.get_entity(note_id)
        if entity is None or entity.get("type") != "note":
            return None
        try:
            return str(entity.get("label") or "Note"), case.read_note(note_id)
        except CaseError:
            return None

    return resolve


def _restate(case: Case, note_id: str, text: str) -> None:
    """What a note's body says it shows and points at, as edges.

    ``[[media:…]]`` is the note showing a file, a derivation, and so is the picture on
    its cover; ``[[entity:…]]`` and ``[[include:…]]`` are pointers, mentions
    (`engine/notelinks.py`).
    """
    shown = pdf_engine.embedded_entity_ids(text) + notelook.cover_image_ids(notelook.stored(case, note_id))
    link_engine.sync_embedded(case, note_id, shown, by="note")
    _sync_mentions(case, note_id, text)


def _sync_mentions(case: Case, note_id: str, text: str) -> None:
    notelinks.sync_mentions(case, note_id, text)


def _decode_diagrams(encoded: dict[str, str]) -> dict[str, bytes]:
    """Decode the whole batch before a single page is laid out."""
    if len(encoded) > MAX_DIAGRAMS:
        raise HTTPException(
            status_code=422, detail=f"an export carries at most {MAX_DIAGRAMS} diagrams"
        )
    decoded: dict[str, bytes] = {}
    total_bytes = 0
    for key, payload in encoded.items():
        if not key or len(key) > 64 or not key.isalnum():
            raise HTTPException(status_code=422, detail="invalid diagram key")
        try:
            data = base64.b64decode(payload, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(status_code=422, detail="invalid diagram payload") from exc
        if not data or len(data) > MAX_DIAGRAM_BYTES:
            raise HTTPException(status_code=422, detail="diagram image too large")
        total_bytes += len(data)
        if total_bytes > MAX_DIAGRAM_TOTAL_BYTES:
            raise HTTPException(status_code=422, detail="diagram batch too large")
        decoded[key] = data
    return decoded


def _note_source(case: Case, note_id: str) -> tuple[str, str]:
    """The title and Markdown of one note, scratchpad included."""
    if note_id == CASE_NOTE:
        return "Case notes", case.read_notes()
    entity = case.get_entity(note_id)
    if entity is None or entity.get("type") != "note":
        raise HTTPException(status_code=404, detail=f"note '{note_id}' not found")
    return str(entity.get("label") or "Note"), case.read_note(note_id)


def _pdf_filename(title: str, note_id: str, peers: dict[str, list[str]], edition: str, day: date) -> str:
    """`<title> - <edition> - <day>.pdf`, or `<title> - <day>.pdf` with no edition
    named (a note with one edition only), flat, a homonym's stable marker after its
    title, and room left for the ` (2)` a second one that day takes."""
    tail = f" - {edition} - {day.isoformat()}.pdf" if edition else f" - {day.isoformat()}.pdf"
    marker = ""
    if len(peers.get(title.casefold(), [])) >= 2:
        marker = f" [{hashlib.sha256(note_id.encode('utf-8')).hexdigest()[:16]}]"
    stem_limit = max(1, layout.MAX_MEDIA_NAME - len(tail) - len(marker) - COUNTER_ROOM)
    stem = layout.slugify(title, "Note", limit=stem_limit)
    return f"{stem}{marker}{tail}"


def _now() -> datetime:
    """This machine's clock, in its own zone: an export is named after its local day."""
    return datetime.now().astimezone()


@router.post("/{case_id}/notes/pdf/diagrams")
def export_diagrams(case_id: str, body: EditionSelection) -> dict[str, Any]:
    """The Mermaid fences a selection holds, for the browser to draw.

    The browser could look for them itself, but then two parsers would decide
    what counts as a diagram and they would drift. This way the notes are read
    once, on the side that renders them, and the answer is deduplicated: the
    same diagram in four notes is drawn once. The public edition asks for none an
    internal passage holds.
    """
    case = get_case(case_id)
    fences: dict[str, str] = {}
    resolve = _resolver(case)
    public = body.edition == pdf_engine.PUBLIC
    for note_id in dict.fromkeys(body.notes):
        _, text = _note_source(case, note_id)
        for source in pdf_engine.mermaid_sources(text, resolve=resolve, note_id=note_id, public=public):
            fences.setdefault(pdf_engine.diagram_key(source), source)
    pending = list(fences.items())[:MAX_DIAGRAMS]
    return {"diagrams": [{"key": key, "source": source} for key, source in pending]}


@router.post("/{case_id}/notes/pdf/check")
def check_pdf(case_id: str, body: EditionSelection) -> dict[str, Any]:
    """What each requested note's PDF would get wrong, before it is exported.

    Every note is laid out in its own look and in the edition asked for, in memory,
    with no diagram drawn (a fence prints as its source, which changes no warning),
    and nothing is written. Each one answers in the order asked, with an empty list
    when all is well; one that cannot be laid out answers the reason as its one
    warning. ``internal`` counts its internal passages, chapters included, which is
    what the dialog offers the two editions on; the public edition says, as a warning
    of its own kind, how many it leaves out.
    """
    case = get_case(case_id)
    resolve = _resolver(case)
    public = body.edition == pdf_engine.PUBLIC
    answered: list[dict[str, Any]] = []
    for note_id in dict.fromkeys(body.notes):
        title, text = _note_source(case, note_id)
        warnings: list[dict[str, Any]]
        internal = 0
        try:
            rendered = pdf_engine.render(
                case, title=title, text=text, look=notelook.stored(case, note_id), note_id=note_id,
                resolve=resolve, public=public, light=True,
            )
        except pdffonts.FontError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except pdf_engine.NotesPdfError as exc:
            warnings = [{"text": str(exc)[:MAX_WARNING_CHARS], "line": None, "kind": pdf_engine.OTHER}]
        else:
            internal = rendered.internal
            warnings = [
                {"text": said[:MAX_WARNING_CHARS], "line": line, "kind": kind}
                for said, line, kind in zip(rendered.warnings, rendered.warning_lines, rendered.warning_kinds)
            ]
            if public and internal:
                said = f"{internal} internal passage{'s' if internal > 1 else ''} left out."
                warnings.append({"text": said, "line": None, "kind": pdf_engine.LEFT_OUT})
        answered.append({"note": note_id, "title": title, "warnings": warnings, "internal": internal})
    return {"notes": answered}


@router.post("/{case_id}/notes/pdf")
def export_pdf(case_id: str, body: ExportIn) -> dict[str, Any]:
    """Write one PDF per requested note into the notes export folder, in the edition
    asked for, each a new file the note keeps a record of."""
    case = get_case(case_id)
    diagrams = _decode_diagrams(body.diagrams)
    try:
        destination = exportdir.destination("notes", case.path)
    except exportdir.ExportDirError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    in_case = destination == layout.subdir(case.path, EXPORTS_DIR)

    selected = [
        (note_id, *_note_source(case, note_id)) for note_id in dict.fromkeys(body.notes)
    ]
    peers = case.note_ids_by_titles({title for _, title, _ in selected})
    peers.setdefault("case notes", []).append(CASE_NOTE)

    written: list[dict[str, str]] = []
    warnings: list[str] = []
    resolve = _resolver(case)
    public = body.edition == pdf_engine.PUBLIC
    for note_id, title, text in selected:
        try:
            rendered = pdf_engine.render(
                case, title=title, text=text, diagrams=diagrams,
                look=notelook.stored(case, note_id), note_id=note_id, resolve=resolve, public=public,
            )
        except pdffonts.FontError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except pdf_engine.NotesPdfError as exc:
            # One unlayoutable note must not lose the rest of the batch.
            warnings.append(f"{title}: {exc}")
            continue
        now = _now()
        # a note with no internal passage has one edition, shareable as it stands:
        # its name says no edition, and it is recorded as public
        edition = body.edition if rendered.internal else pdf_engine.PUBLIC
        filename = _pdf_filename(title, note_id, peers, body.edition if rendered.internal else "", now.date())
        try:
            # never over an earlier one: a second export that day is numbered
            path = exportdir.write_out(rendered.pdf, destination, filename)
        except (OSError, exportdir.ExportDirError) as exc:
            raise HTTPException(status_code=409, detail=f"could not write the PDF: {errors.explain(exc)}") from exc
        _record_edition(case, note_id, {
            "at": now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "edition": edition,
            "file": path.name,
            "folder": EXPORTS_DIR if in_case else str(destination),
            "pages": len(rendered.pages),
            "pdf_sha256": hashlib.sha256(rendered.pdf).hexdigest(),
            "text_sha256": rendered.text_sha256,
        })
        written.append({"note": note_id, "title": title, "file": path.name, "edition": edition})
        warnings.extend(f"{title}: {warning}" for warning in rendered.warnings)

    if not written:
        raise HTTPException(status_code=422, detail="; ".join(warnings) or "nothing to export")
    return {
        "written": written,
        "warnings": warnings,
        "folder": EXPORTS_DIR if in_case else str(destination),
        "path": str(destination),
    }


@router.post("/{case_id}/notes/pdf/reveal")
def reveal_exports(case_id: str) -> dict[str, str]:
    """Open the folder the PDFs were written to, in the system file manager.

    Takes no path: the case id and the saved notes destination are enough to find
    the folder, so nothing the browser sends can point somewhere else. That saved
    folder is allowed to be outside the workspace, which is the whole point of
    choosing one.
    """
    case = get_case(case_id)
    try:
        destination = exportdir.destination("notes", case.path)
    except exportdir.ExportDirError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    try:
        reveal_engine.reveal(destination, workspace_only=False)
    except reveal_engine.RevealError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"path": str(destination)}


# -- editions ---------------------------------------------------------------------


class EditionRef(BaseModel):
    """One edition of a note, named by when it was written, its file's name and the
    folder its record gives: matched against the record, never read as a path."""

    at: str = Field(max_length=32)
    file: str = Field(max_length=300)
    folder: str = Field(default="", max_length=4096)


def _read_editions(case: Case, note_id: str) -> list[dict[str, Any]]:
    """The editions a note keeps a record of, newest first, each checked part by part.

    The record is case data and can arrive in a bundle, so a part that is not what
    an export writes drops its record rather than reach a path or a hash.
    """
    raw: Any
    if note_id == CASE_NOTE:
        try:
            raw = json.loads(case.get_setting(CASE_EDITIONS) or "[]")
        except ValueError:
            raw = []
    else:
        raw = ((case.get_entity(note_id) or {}).get("attrs") or {}).get(EDITIONS_ATTR)
    if not isinstance(raw, list):
        return []
    kept = [_edition_record(item) for item in raw[:MAX_EDITIONS]]
    return [item for item in kept if item is not None]


def _edition_record(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    at, edition, file, folder = item.get("at"), item.get("edition"), item.get("file"), item.get("folder")
    pages, pdf_sha, text_sha = item.get("pages"), item.get("pdf_sha256"), item.get("text_sha256")
    if not (isinstance(at, str) and STAMP.match(at) and edition in pdf_engine.EDITIONS):
        return None
    if not (isinstance(file, str) and layout.names_one_child(file) and isinstance(folder, str) and folder):
        return None
    if not (isinstance(pages, int) and not isinstance(pages, bool) and pages >= 0):
        return None
    if not (isinstance(pdf_sha, str) and SHA256.match(pdf_sha) and isinstance(text_sha, str) and SHA256.match(text_sha)):
        return None
    return {"at": at, "edition": edition, "file": file, "folder": folder, "pages": pages,
            "pdf_sha256": pdf_sha, "text_sha256": text_sha}


def _record_edition(case: Case, note_id: str, record: dict[str, Any]) -> None:
    """Put one edition first in the note's record, the oldest past the cap let go."""
    with _editions_turn:
        kept = [record, *_read_editions(case, note_id)][:MAX_EDITIONS]
        if note_id == CASE_NOTE:
            case.set_setting(CASE_EDITIONS, json.dumps(kept, sort_keys=True))
        else:
            case.update_entity(note_id, {"attrs": {EDITIONS_ATTR: kept}})


def _edition(case: Case, note_id: str, ref: EditionRef) -> dict[str, Any]:
    _require_note(case, note_id)
    for record in _read_editions(case, note_id):
        if record["at"] == ref.at and record["file"] == ref.file and ref.folder in ("", record["folder"]):
            return record
    raise HTTPException(status_code=404, detail="that edition is not in the note's record")


def _edition_path(case: Case, record: dict[str, Any]) -> Path | None:
    """Where an edition was written: the case's own exports, or the absolute folder
    the analyst had chosen. None for a folder this machine cannot name."""
    folder = record["folder"]
    if folder == EXPORTS_DIR:
        return layout.subdir(case.path, EXPORTS_DIR) / record["file"]
    where = Path(folder)
    return where / record["file"] if where.is_absolute() else None


def _file_sha256(path: Path) -> str | None:
    """A regular file's SHA-256, read in chunks; None when there is no such file."""
    try:
        if not stat.S_ISREG(path.stat().st_mode):
            return None
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise HTTPException(status_code=409, detail=f"could not read the file: {errors.explain(exc)}") from exc
    return digest.hexdigest()


@router.get("/{case_id}/notes/{note_id}/editions")
def note_editions(case_id: str, note_id: str) -> dict[str, Any]:
    """The PDFs a note was exported as, newest first: day, edition, file, pages, hashes."""
    case = get_case(case_id)
    _require_note(case, note_id)
    return {"editions": _read_editions(case, note_id)}


@router.post("/{case_id}/notes/{note_id}/editions/check")
def check_edition(case_id: str, note_id: str, body: EditionRef) -> dict[str, str]:
    """Whether an edition's file is still the one written: ``unchanged``, ``changed``
    or ``missing``. Hashes the file again; nothing is fetched or written."""
    case = get_case(case_id)
    record = _edition(case, note_id, body)
    path = _edition_path(case, record)
    found = _file_sha256(path) if path is not None else None
    if found is None:
        return {"state": "missing"}
    return {"state": "unchanged" if found == record["pdf_sha256"] else "changed"}


@router.post("/{case_id}/notes/{note_id}/editions/reveal")
def reveal_edition(case_id: str, note_id: str, body: EditionRef) -> dict[str, str]:
    """Open the folder an edition was written to, in the system file manager.

    The folder is read from the note's record, never from the request.
    """
    case = get_case(case_id)
    record = _edition(case, note_id, body)
    path = _edition_path(case, record)
    if path is None:
        raise HTTPException(status_code=409, detail="that folder is not on this machine")
    try:
        reveal_engine.reveal(path.parent, workspace_only=False)
    except reveal_engine.RevealError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"path": str(path.parent)}
