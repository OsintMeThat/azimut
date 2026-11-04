"""What a note's body points at, kept as ``mentions`` edges.

``[[entity:…]]`` in a note is a pointer at a record, a mention (ONTOLOGY §3).
So is ``[[include:…]]``: the note prints another note as a chapter, read live
at print time, so it refers to it rather than being made from it. Every save
restates them (`api/notes.py`), which is what puts the note in that
record's Details and beside it in the Graph. The mentions are the body's own
(``own_only``): one stated by hand in Details is a separate claim the text
cannot take back.

Notes written before the Notebook did this cite records the graph never heard
about. ``restate_once`` reads each of them once, on the first open of a case by
a version that knows, so those citations show up without anyone retyping a
note. It writes edges only, never a note, and marks the case in its own
settings rather than bumping the schema: a case opened by an older Azimut
afterwards reads the same edges a hand-stated mention would have left.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ..workspace import CaseError
from . import links as link_engine
from . import notetext

if TYPE_CHECKING:
    from ..workspace import Case

#: Set once every note of the case has had its mentions restated.
RESTATED = "notes.mentions_restated"
#: Bound on the one pass: past it, the rest are restated as they are saved.
MAX_NOTES = 5000


def sync_mentions(case: "Case", note_id: str, text: str) -> None:
    holder = case.get_entity(note_id)
    if holder is None:
        return
    wanted: list[str] = []
    named = notetext.mentioned_ids(text) + notetext.included_ids(text)
    for entity_id in dict.fromkeys(named):
        try:
            link_engine.check_relation_target(case, holder, entity_id, link_engine.MENTIONS)
        except CaseError:
            continue
        wanted.append(entity_id)
    case.sync_links(note_id, link_engine.MENTIONS, wanted, by="note", own_only=True)


def restate_once(case: "Case") -> int:
    """Restate every note's mentions, the first time this case is opened. Returns how many notes."""
    if case.get_setting(RESTATED) == "1":
        return 0
    done = 0
    cursor: str | None = None
    while done < MAX_NOTES:
        page = case.page_entities(types=["note"], limit=500, cursor=cursor)
        for entity in page["items"]:
            try:
                text = case.read_note(str(entity["id"]))
                if "[[entity:" in text or "[[include:" in text:
                    sync_mentions(case, str(entity["id"]), text)
            except CaseError:
                continue
            done += 1
        cursor = page.get("next_cursor")
        if not cursor:
            break
    case.set_setting(RESTATED, "1")
    return done
