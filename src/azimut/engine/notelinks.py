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

A **written link** to a page the case holds (`[words](https://…)`, or the address
written bare) is no edge: which item it finds depends on what the case holds when it is
asked, so it is read live, by `outside_links` here, for the Media Library's Unused filter
and every delete's preview (`engine/uses.py`), and for the print (`engine/notesources.py`).

A **link to a map** is a mention of a web map, a note whose look lays it out as a map page
(`look.web == "map"`): `[[entity:<map note>|the words]]`. A written link whose address is
one the map was published at counts too, so an article written before the mention keeps
its link. `linked_maps` reads both, for the publish that gives each the map's address on
the site it goes to (`api/notes.py`) and for the delete preview (`engine/uses.py`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Iterator, Mapping
from urllib.parse import urlsplit

from ..workspace import CaseError
from . import links as link_engine
from . import notelook, notes_markdown, notesources, notetext

if TYPE_CHECKING:
    from ..workspace import Case

#: Set once every note of the case has had its mentions restated.
RESTATED = "notes.mentions_restated"
#: Bound on the one pass: past it, the rest are restated as they are saved.
MAX_NOTES = 5000
#: What a note's look says of a web map (`NoteLook.web`).
WEB_MAP = "map"
#: The attr a filed note keeps its record of editions under (`api/notes.py`), and the formats
#: among them that put the note at an address: GitHub Pages, and a web folder given one.
EDITIONS = "editions"
ADDRESSED = ("github", "web")
#: How many records of one note are read, as many as it keeps (`api/notes.MAX_EDITIONS`).
MAX_EDITIONS = 50


def outside_links(text: str) -> list[str]:
    """The web addresses a note's text links to, in order and each once: its written
    links and the addresses written bare, read as the print reads them, so an address
    in a code block or one a reader cannot open (this machine, a private network) is none. A
    footnote's links are the note's like any other."""
    found: list[str] = []
    for token in notes_markdown.parse(text):
        if token.type != "inline":
            continue
        for child in notes_markdown.with_footnotes(token.children):
            if child.type == "link_open":
                href = str(child.attrGet("href") or "")
                if notesources.web(href) and not notes_markdown.is_local(href, ()):
                    found.append(href)
            elif child.type == "text":
                found.extend(address for _, _, address in notes_markdown.bare_urls(child.content)
                             if not notes_markdown.is_local(address, ()))
    return list(dict.fromkeys(found))


# -- links to a map ----------------------------------------------------------------


def is_map(entity: dict[str, Any] | None) -> bool:
    """Whether a record is a web map: a note whose look lays it out as a map page."""
    if not entity or entity.get("type") != "note":
        return False
    look = (entity.get("attrs") or {}).get(notelook.ATTR)
    return isinstance(look, dict) and look.get("web") == WEB_MAP


def published_addresses(entity: dict[str, Any] | None) -> list[str]:
    """The addresses a note's editions put it at, newest first: where GitHub Pages published it,
    and the address a web folder of it was made for."""
    raw = ((entity or {}).get("attrs") or {}).get(EDITIONS)
    found: list[str] = []
    for item in raw[:MAX_EDITIONS] if isinstance(raw, list) else []:
        address = item.get("address") if isinstance(item, dict) and item.get("format") in ADDRESSED else None
        if isinstance(address, str) and address.startswith("https://"):
            found.append(address)
    return list(dict.fromkeys(found))


def page_key(address: str) -> str:
    """An address as two addresses of one page are compared: its host and its path, with
    `index.html`, the closing slash, the query and the fragment left out; "" for no web page."""
    try:
        parts = urlsplit(str(address or "").strip())
        host = (parts.hostname or "").rstrip(".")
        port = parts.port
    except ValueError:
        return ""
    if parts.scheme.lower() not in ("http", "https") or not host:
        return ""
    path = parts.path
    if path.endswith("/index.html"):
        path = path[: -len("index.html")]
    path = path.rstrip("/")
    return f"{host}{f':{port}' if port is not None else ''}{path}"


def map_addresses(case: "Case") -> dict[str, str]:
    """Each address a web map of the case was published at, by its `page_key`: which map it is.
    The first map to claim an address keeps it."""
    found: dict[str, str] = {}
    cursor: str | None = None
    read = 0
    while read < MAX_NOTES:
        page = case.page_entities(types=["note"], limit=500, cursor=cursor)
        for entity in page.get("items", []):
            read += 1
            if is_map(entity):
                for address in published_addresses(entity):
                    key = page_key(address)
                    if key:
                        found.setdefault(key, str(entity["id"]))
        cursor = page.get("next_cursor")
        if not cursor:
            break
    return found


def _links(text: str) -> Iterator[tuple[str, str]]:
    """What a note's text links to, in order, read as the print reads it: each mention as
    ("entity", its id), each written or bare web address as ("address", it)."""
    for token in notes_markdown.parse(text):
        if token.type != "inline":
            continue
        for child in notes_markdown.with_footnotes(token.children):
            if child.type == "link_open":
                href = str(child.attrGet("href") or "")
                entity = notes_markdown.ENTITY_HREF.match(href)
                if entity:
                    yield "entity", entity.group(1)
                elif notesources.web(href) and not notes_markdown.is_local(href, ()):
                    yield "address", href
            elif child.type == "text":
                for _, _, address in notes_markdown.bare_urls(child.content):
                    if not notes_markdown.is_local(address, ()):
                        yield "address", address


def linked_maps(case: "Case", text: str) -> list[str]:
    """The ids of the web maps a note's text links to, in order and each once: the maps it
    mentions (`[[entity:<map note>|…]]`) and those whose published address it links to.

    It reads the text it is given: for what a published page links to, that is the public
    text (`notes_markdown.strip_internal`, chapters in place)."""
    found = list(_links(text))
    if not found:
        return []
    addresses = map_addresses(case) if any(kind == "address" for kind, _ in found) else {}
    known: dict[str, bool] = {}
    linked: list[str] = []
    for kind, value in found:
        if kind == "address":
            ident = addresses.get(page_key(value))
            if ident:
                linked.append(ident)
            continue
        if value not in known:
            known[value] = is_map(case.get_entity(value))
        if known[value]:
            linked.append(value)
    return list(dict.fromkeys(linked))


@dataclass(frozen=True)
class SiteMaps:
    """Where the web maps a page links to stand on the site it is published to: each map's
    address there, by the map's id (``ids``) and by the `page_key` of every address the map
    was published at (``addresses``), so a written link to it on another site finds it too."""

    ids: Mapping[str, str] = field(default_factory=dict)
    addresses: Mapping[str, str] = field(default_factory=dict)

    def of(self, entity_id: str) -> str:
        """The address on the site of the map a mention names, "" when it is none there."""
        return self.ids.get(entity_id, "")

    def instead_of(self, href: str) -> str:
        """The address on the site of the map a written link is to, "" when it is none there."""
        return self.addresses.get(page_key(href), "") if self.addresses else ""


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
