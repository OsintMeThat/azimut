"""REST API for the notebook: note bodies, and exporting them to PDF.

The case scratchpad and the filed notes are read and written here. So is the
export, which is the reason this left `api/cases.py`: turning a note into a
document is a surface of its own — a payload to bound, a renderer to drive and
files to write into the case's export folder.

An export writes one PDF per note, named after the note, into the folder the
analyst chose for notes — the case's own `exports/` until they pick another one
(`engine/exportdir.py`). Names follow the same rule as an imported media's
(`layout.visible_filename`).

Inside the case, a re-export overwrites: that folder is meant to be refreshed in
one click, not to accumulate `note (2).pdf`. In a folder of the analyst's own it
never overwrites, because the files there are theirs.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import layout
from ..engine import exportdir
from ..engine import notes_pdf as pdf_engine
from ..engine import pdffonts
from ..engine import reveal as reveal_engine
from ..workspace import Case, CaseError
from .cases import get_case

router = APIRouter(prefix="/api/cases", tags=["notes"])

#: The case's own scratchpad, which is a note without an entity behind it.
CASE_NOTE = "case"
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


class Notes(BaseModel):
    text: str


class NoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    folder: str = Field(default="", max_length=120)
    content: str = ""


class NoteSelection(BaseModel):
    notes: list[str] = Field(min_length=1, max_length=MAX_NOTES)


class ExportIn(NoteSelection):
    """Which notes to export, and the diagrams the browser drew for them.

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
    return get_case(case_id).create_note(body.title.strip(), body.folder.strip(), body.content)


@router.get("/{case_id}/notes/{note_id}")
def read_note(case_id: str, note_id: str) -> dict[str, str]:
    try:
        return {"text": get_case(case_id).read_note(note_id)}
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{case_id}/notes/{note_id}")
def write_note(case_id: str, note_id: str, body: Notes) -> dict[str, str]:
    try:
        get_case(case_id).write_note(note_id, body.text)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "saved"}


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


def _pdf_filename(title: str, note_id: str, peers: dict[str, list[str]]) -> str:
    """A stable flat filename, keeping a homonym marker after truncation."""
    if len(peers.get(title.casefold(), [])) < 2:
        return layout.visible_filename(title, ".pdf")
    token = hashlib.sha256(note_id.encode("utf-8")).hexdigest()[:16]
    marker = f" [{token}]"
    stem_limit = max(1, layout.MAX_MEDIA_NAME - len(".pdf") - len(marker))
    stem = layout.slugify(title, "Note", limit=stem_limit)
    return f"{stem}{marker}.pdf"


@router.post("/{case_id}/notes/pdf/diagrams")
def export_diagrams(case_id: str, body: NoteSelection) -> dict[str, Any]:
    """The Mermaid fences a selection holds, for the browser to draw.

    The browser could look for them itself, but then two parsers would decide
    what counts as a diagram and they would drift. This way the notes are read
    once, on the side that renders them, and the answer is deduplicated: the
    same diagram in four notes is drawn once.
    """
    case = get_case(case_id)
    fences: dict[str, str] = {}
    for note_id in dict.fromkeys(body.notes):
        _, text = _note_source(case, note_id)
        for source in pdf_engine.mermaid_sources(text):
            fences.setdefault(pdf_engine.diagram_key(source), source)
    pending = list(fences.items())[:MAX_DIAGRAMS]
    return {"diagrams": [{"key": key, "source": source} for key, source in pending]}


@router.post("/{case_id}/notes/pdf")
def export_pdf(case_id: str, body: ExportIn) -> dict[str, Any]:
    """Write one PDF per requested note into the notes export folder."""
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
    for note_id, title, text in selected:
        try:
            rendered = pdf_engine.render(case, title=title, text=text, diagrams=diagrams)
        except pdffonts.FontError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except pdf_engine.NotesPdfError as exc:
            # One unlayoutable note must not lose the rest of the batch.
            warnings.append(f"{title}: {exc}")
            continue
        filename = _pdf_filename(title, note_id, peers)
        try:
            if in_case:
                path = destination / filename
                path.write_bytes(rendered.pdf)
            else:
                path = exportdir.write_out(rendered.pdf, destination, filename)
        except (OSError, exportdir.ExportDirError) as exc:
            raise HTTPException(status_code=409, detail=f"could not write the PDF: {exc}") from exc
        written.append({"note": note_id, "title": title, "file": path.name})
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
