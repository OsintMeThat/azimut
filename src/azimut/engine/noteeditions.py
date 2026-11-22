"""A note's public texts, kept so two editions can be compared (`engine/notediff.py`).

Every export keeps a record of the text it printed as a SHA-256 (``text_sha256``,
`notes_markdown.printed_source`), and a hash alone cannot say what changed. So a
public edition also keeps that text, as it was printed: chapters in place, internal
passages already out, nothing else. It lands in `notes/.editions/<note id>/` under its
own SHA-256, so the same text exported as a PDF, an HTML page and a web folder is one
file, and a file whose bytes no longer hash to its name is never read as an edition.

An internal edition keeps nothing: it is the note whole, and only what went out is
ever corrected in public.

**Bounded.** A note keeps the texts of its newest `MAX_KEPT` public texts, the record
deciding which: an article corrected nine times is far past what a published piece goes
through, and ten copies of a note is a cost nobody notices. A text over
`MAX_TEXT_BYTES` (a book, not an article) is not kept, and its comparison says so. The
records stay as they are: an older edition is still listed, only not compared.

**Owned by the note** (`artifacts.KINDS`, named by its id so a rename leaves it): it goes
to the Trash with the note and comes back with it, and travels in a bundle under
`notes/`. The case notes, which have no entity, keep theirs under `case`, as their record
stays in the case settings. The texts name the pictures they printed, which is a record
of what was published and not a use (`engine/uses.py`): a picture an old edition showed
can still be deleted, and the comparison then names it as the text wrote it.

Nothing here reaches the network.
"""

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable

from .. import layout
from ..workspace import CaseError, _replace_with_retry, ensure_dir
from . import notefill
from . import notes_markdown as md
from .notelook import DEFAULT as DEFAULT_LOOK
from .notelook import NoteLook

if TYPE_CHECKING:
    from ..workspace import Case

#: How many public texts a note keeps, newest first by its record.
MAX_KEPT = 10
#: The longest text kept, in bytes.
MAX_TEXT_BYTES = 2 * 1024 * 1024
#: Where the case notes keep theirs: no entity id takes this form (`workspace._new_id`).
CASE_OWNER = "case"
#: What an owner's name and a text's name may be.
OWNER = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
PUBLIC = "public"


def _owner(note_id: str) -> str:
    owner = note_id or CASE_OWNER
    if not OWNER.match(owner):
        raise CaseError(f"invalid note '{note_id}'")
    return owner


def folder(case: "Case", note_id: str) -> Path:
    """The folder a note's kept texts live in, which may not exist yet."""
    return case.resolve_inside(layout.note_editions_rel(_owner(note_id)))


def _path(case: "Case", note_id: str, sha: str) -> Path | None:
    if not SHA256.match(sha or ""):
        return None
    return case.resolve_inside(layout.note_edition_text_rel(_owner(note_id), sha))


def keep(case: "Case", note_id: str, text: str) -> str | None:
    """Keep one public text under its SHA-256, once; its SHA-256, or None when it is
    too long to keep. The bytes are written whole, then renamed into place."""
    data = text.encode("utf-8")
    if len(data) > MAX_TEXT_BYTES:
        return None
    sha = hashlib.sha256(data).hexdigest()
    path = _path(case, note_id, sha)
    if path is None:
        return None
    if path.is_file():
        return sha
    ensure_dir(path.parent)
    scratch = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        scratch.write_bytes(data)
        _replace_with_retry(scratch, path)
    finally:
        scratch.unlink(missing_ok=True)
    return sha


def wanted(records: Iterable[dict[str, Any]]) -> list[str]:
    """The texts a note's record keeps, newest first: its newest `MAX_KEPT` public ones."""
    out: list[str] = []
    for record in records:
        sha = record.get("text_sha256")
        if record.get("edition") != PUBLIC or not isinstance(sha, str) or not SHA256.match(sha) or sha in out:
            continue
        out.append(sha)
        if len(out) >= MAX_KEPT:
            break
    return out


def prune(case: "Case", note_id: str, records: Iterable[dict[str, Any]]) -> None:
    """Let go of every kept text the record no longer wants, and of the folder once empty."""
    where = folder(case, note_id)
    if not where.is_dir():
        return
    keep_these = set(wanted(records))
    for path in where.iterdir():
        if path.is_file() and path.stem not in keep_these:
            path.unlink(missing_ok=True)
    try:
        where.rmdir()  # only when empty; the next export makes it again
    except OSError:
        pass
    case.prune_note_dirs(layout.note_editions_rel(_owner(note_id)))


def kept(case: "Case", note_id: str, records: Iterable[dict[str, Any]]) -> list[str]:
    """The texts the record wants that are on disk, newest first."""
    out = []
    for sha in wanted(records):
        path = _path(case, note_id, sha)
        if path is not None and path.is_file():
            out.append(sha)
    return out


def read(case: "Case", note_id: str, sha: str) -> str | None:
    """One kept text, or None when it is not kept or its bytes no longer hash to its name."""
    path = _path(case, note_id, sha)
    if path is None:
        return None
    try:
        if path.stat().st_size > MAX_TEXT_BYTES:
            return None
        data = path.read_bytes()
    except OSError:
        return None
    if hashlib.sha256(data).hexdigest() != sha:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def printed_now(case: "Case | None", *, title: str, text: str, look: NoteLook | None, note_id: str,
                resolve: md.Resolve | None, identity: notefill.Identity | None = None,
                created: datetime | None = None) -> str:
    """The text the note's public edition would print now, as a PDF or an HTML page
    prints it (`notes_html.render`): its own cover, then the note with its chapters in
    place and its internal passages out. Laid out in memory; nothing is drawn or written."""
    look = look or DEFAULT_LOOK
    day = date.fromisoformat(look.cover.date) if look.cover.date else (created or datetime.now()).date()
    # a note someone else wrote fills `{name}` with theirs, as its pages print it
    identity, look = notefill.signing(look, identity)
    values = identity.values(day)
    empty: dict[str, int] = {}
    passages = [0]
    text = md.sections_cut(text, look, look.profile())
    cut = notefill.split_cover(text) if look.cover.own else None
    pieces = md.expand(title, cut.body if cut is not None else text, resolve=resolve, note_id=note_id,
                       public=True, counter=passages, values=values, empty=empty)
    if cut is not None:
        cover = md.cover_piece(title, cut.text, public=True, counter=passages, values=values, empty=empty)
        if notefill.prints_anything(cover.text):
            pieces = [cover, *pieces]
    return md.printed_source(pieces)
