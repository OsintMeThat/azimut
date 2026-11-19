"""What a note's Ready to publish? panel says, read off the check before export.

The check before export (`api/notes.check_pdf`) already says most of what stands between
a note and its readers, but it says it as one list. The panel gathers it by what each
line is about (`GROUPS`): the words, the sources, the figures, the edition, the weight
and reach. Each warning keeps its words, its line and its kind as the export dialog
shows it, so both always count the same things; this module only says which group it
goes in (`group_of`), read from its kind and from where its line stands in the note.

What only the panel asks is added beside the warnings (`extras`), each read off the
document the check laid out (`notes_markdown.Cited.ready`) or off the case:

- the pictures a reader who cannot see them is told nothing about (their words a bare
  label and no caption), and those nothing names the owner of, when no warning of the
  check says so already;
- the records of the Claim kind the note cites that cite nothing themselves, so they
  rest on the analyst's word alone (as the catalog's *No source* asks);
- the pages the last *Archive every link* run found no longer answering;
- every outside link with no archived copy and every one the case holds nothing of, with
  its address, however the style words the check's lines (each, or one per kind);
- the note's marking, its style, and the edition and format checked.

Nothing here renders and nothing reaches the network: the archive run's record is read
as it was left.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from . import notes_markdown as md
from . import urltitles

if TYPE_CHECKING:
    from ..workspace import Case

#: What a line of the panel is about, in the order it lists them.
GROUPS = ("words", "sources", "figures", "edition", "reach")
#: Kinds whose group never depends on where their line stands.
KIND_GROUPS = {
    md.COUNT: "words", md.EMPTY_SECTION: "words", md.OPEN_TASK: "words",
    md.UNARCHIVED: "sources", md.UNSEEN: "sources", md.LOCAL_LINK: "sources",
    md.SETTING: "edition", md.LEFT_OUT: "edition",
    md.STALE: "figures",
    # a web folder's: the address it will live at, and how many files go up at once
    "address": "reach", "upload": "reach",
}
#: The HTML page's own line about its weight, which the panel says with the weight.
WEIGHT_SAID = "The page weighs "
#: A block drawn whole as a figure: a chart, a map, an infographic, a diagram.
FIGURE_OPEN = re.compile(r"^(:{3,})[ \t]*(chart|map|infographic)\b", re.I)
FENCE_OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})[ \t]*(\w*)")
#: How many pictures, claims or gone pages the panel lists before it counts the rest.
MAX_LISTED = 200


def figure_lines(text: str) -> set[int]:
    """The note's lines that belong to a figure: a chart, a map or an infographic block
    from its opening line to its closing one, a Mermaid diagram's fence, a table's rows."""
    lines = text.split("\n")
    found: set[int] = set()
    index = 0
    while index < len(lines):
        line = lines[index]
        fence = FENCE_OPEN.match(line)
        if fence:
            end = index + 1
            while end < len(lines) and not lines[end].lstrip().startswith(fence.group(1)):
                end += 1
            if fence.group(2).lower() == "mermaid":
                found.update(range(index, min(end, len(lines) - 1) + 1))
            index = end + 1
            continue
        opened = FIGURE_OPEN.match(line)
        if opened:
            closing = re.compile(rf"^{opened.group(1)}[ \t]*$")
            end = index + 1
            while end < len(lines) and not closing.match(lines[end]):
                end += 1
            found.update(range(index, min(end, len(lines) - 1) + 1))
            index = end + 1
            continue
        if line.lstrip().startswith("|"):
            found.add(index)
        index += 1
    return found


def group_of(kind: str, line: int | None, text: str, figures: set[int], pictures: set[int]) -> str:
    """Which group of the panel a warning of the check goes in: by its kind where that says
    it, else a line inside a figure or on a picture is the figures', a record or chapter gone
    the sources', the page's weight its reach, and anything else the words'."""
    if kind in KIND_GROUPS:
        return KIND_GROUPS[kind]
    if line is not None and (line in figures or line in pictures):
        return "figures"
    if kind == md.UNSOURCED:
        return "figures"
    if kind == md.MISSING:
        return "sources"
    if text.startswith(WEIGHT_SAID):
        return "reach"
    return "words"


def extras(case: "Case", note_id: str, ready: dict[str, Any], warnings: list[dict[str, Any]]) -> dict[str, Any]:
    """What the panel lists beside the check's warnings, from the document the check laid
    out (``ready``, its `Cited.ready`) and the case: pictures, claims and gone pages."""
    sourced_lines = {warning.get("line") for warning in warnings if warning.get("kind") == md.UNSOURCED}
    pictures: list[dict[str, Any]] = []
    seen: set[tuple[str, int | None]] = set()
    for picture in ready.get("pictures") or []:
        # a picture the check says has no source is said there; the panel adds what else it lacks
        credit = bool(picture.get("credit")) or picture.get("line") in sourced_lines
        alt = bool(picture.get("alt"))
        key = (str(picture.get("text")), picture.get("line"))
        if (alt and credit) or key in seen:
            continue
        seen.add(key)
        pictures.append({"text": picture["text"], "line": picture.get("line"), "alt": alt, "credit": credit})
    return {
        "pictures": pictures[:MAX_LISTED],
        "claims": claims(case, ready.get("records") or [])[:MAX_LISTED],
        "gone": gone(case, note_id, ready.get("outside") or [])[:MAX_LISTED],
        # the links behind the check's lines, each with its address, however the style words them
        "unarchived": _links(ready.get("unarchived")),
        "unseen": _links(ready.get("unseen")),
    }


def _links(found: Any) -> list[dict[str, Any]]:
    return [{"text": md.cut_text(str(item.get("text") or ""), 120), "url": str(item.get("url") or "")[:2048],
             "line": item.get("line")} for item in (found or [])[:md.MAX_LISTED_LINKS]]


def claims(case: "Case", records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The Claims the note cites that cite nothing themselves, each once, at its first line."""
    found: list[dict[str, Any]] = []
    asked: set[str] = set()
    for record in records:
        ident = str(record.get("id") or "")
        if not ident or ident in asked:
            continue
        asked.add(ident)
        entity = case.get_entity(ident)
        if entity is None or entity.get("type") != "claim":
            continue
        if any(link.get("type") == "cites" and link.get("from") == ident for link in case.links_of(ident)):
            continue
        said = str(record.get("text") or "").strip() or str(entity.get("label") or "Claim")
        found.append({"id": ident, "text": md.cut_text(said, 120), "line": record.get("line")})
    return found


def gone(case: "Case", note_id: str, outside: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The note's outside links whose page the last Archive every link run found no longer
    answering, as the run recorded it: read from its record, never asked again."""
    from . import linkarchive

    try:
        record = linkarchive.read(case, note_id)
    except Exception:  # a record this build cannot read says nothing
        return []
    dead = {urltitles.url_key(str(link.get("url") or "")) for link in (record or {}).get("links") or []
            if link.get("gone") is True}
    dead.discard("")
    if not dead:
        return []
    found: list[dict[str, Any]] = []
    for link in outside:
        address = str(link.get("url") or "")
        if urltitles.url_key(address) in dead:
            words = str(link.get("text") or "").strip() or urltitles.title_of(address)
            found.append({"text": md.cut_text(words, 120), "url": address[:2048], "line": link.get("line")})
    return found
