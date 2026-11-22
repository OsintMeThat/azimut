"""One note sent for review: a case bundle holding only what its public web page needs.

A guest analyst sends an investigation to somebody else's site, who imports it into
their own Azimut, reads it and publishes it under the guest's name. What travels is a
plain case bundle (`engine/bundles.py`), so the receiving Azimut draws the pages itself
and no stranger's HTML runs anywhere. What it holds is one article, never the whole case.

**What leaves** (`contents`, the one reading the dialog's preview and the export share):

- the note, its text being its public text: every internal passage is blanked
  (`notes_markdown.strip_internal`) before anything is looked for, so what only an
  internal passage names stays; the chapters it includes, each public too, two levels
  deep as the page prints them; and the note a chart or an infographic reads its rows from;
- the pictures it shows (`[[media:…]]`, `azimut://media/…`, a case file's `/files/…`
  address) and those its look shows (`notelook.cover_image_ids`), with what their source
  reads (`notesources.Reader`): the `derived-from` chain as far as a citation follows it,
  the account a `posted` edge names, the sidecar under `media/.meta/`, a comparison's two
  sides, a proof's spec, export and pasted pictures and the place it depicts;
- the posts it draws (`::: post`) with their kept pictures and the proof made from each;
  the sheets its charts and infographics read, and the records a sheet's cells link to;
  the pictures its picture walls show;
- the records it mentions (`[[entity:…]]`) and what its written links find in the case
  (`urltitles.AddressIndex`), so its citations and its sources list come out the same;
- every map it draws (`::: map`, read as `notes_maps.derive` reads it, never drawn): its layers by name
  with their spec, snapshot and icons, the entities an editable layer's markers follow and
  where they stand, its plate, ground and detail captures, the proofs its steps open or its
  period selects, the pictures its cards show, and the case's named colours and icons;
- each map page it links to (`notelinks.linked_maps`), with everything that page needs.

**Source videos** (`Contents.videos`): a video the page only cites, never plays nor shows a still
of (a frame's video, a proof's footage, a kept post's video with a still of its own), may leave its
file behind, its record, sidecar and links still travelling. Its file stays behind unless asked for:
the page and its maps read the same without it, and only a reviewer checking frames uses it.

**What stays**: the rest of the case, its Trash and its jobs, and what the note's earlier
publishing recorded (its editions, GitHub, WordPress and site records): the receiver starts
fresh. The source case is never written: the copy is built in a hidden folder beside the
bundles (`config.bundles_dir`), exported from there by `bundles.export_case`, and removed
on success and on failure.

**What the copy writes again.** A picture written by the sender's file address (`/files/<case>/…`)
is written by its record, and a link written to the address a carried map page was published at
is written as a mention of the map (`[[entity:<map>|<its words>]]`): the receiving case has
another name, and keeps no record of where the sender published anything. Off-site a mention of a
note reads as its words where the link was a link; on the receiver's site it is the map's address.

**Who signs.** A note with no author in its look is signed by whoever publishes it, from
their own Settings. The copy's look therefore names the author the dialog was given, and the
picture beside the name: one of the case's pictures, or the exporter's own logo filed in
the copy as a picture of its own (`LOGO`). Each map page it carries is a page of
its own, so it is signed the same, unless it already names another author.
"""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
import stat
import tempfile
from contextlib import closing
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any, Iterator
from urllib.parse import unquote

from .. import config, layout
from ..sqlite_backend import SqliteCase
from ..store.rows import _entity_search_text
from ..workspace import CaseError, _now, ensure_dir
from . import artifacts, bundles, notecharts, notelinks, notelook, notes_charts, notes_infographic, notes_maps
from . import layerediting, layerlinks, maplayers, notesources, notetext, satellite, sheets, socialposts, urltitles
from . import workqueue
from . import links as link_engine
from . import media as media_engine
from . import notes_markdown as md

if TYPE_CHECKING:
    from ..workspace import Case

#: The job that writes one.
REVIEW_JOB = "review-export"
#: The picture choice that files the exporter's own logo (`config.signature_path`) in the copy.
LOGO = "logo"
#: What the file and the case it imports as are called after the note.
FOR_REVIEW = " (for review)"
SUFFIX = ".azimut.zip"
#: Where the copy is built: a hidden folder in the bundles folder, one per export.
STAGING_PREFIX = ".review-"
#: How many names of each group the dialog lists; its counts stay whole.
MAX_NAMES = 12
#: The largest file osintmethat.com/contribute takes, 1 GB as its form says it, which the dialog
#: says a file passes.
SITE_LIMIT = 1073741824

#: The groups the dialog lists what leaves under, in its order: the key and the words.
GROUPS: tuple[tuple[str, str], ...] = (
    ("note", "Note"),
    ("chapters", "Chapters"),
    ("pages", "Map pages"),
    ("pictures", "Pictures"),
    ("layers", "Map layers"),
    ("posts", "Posts"),
    ("sheets", "Sheets"),
    ("records", "Records"),
    ("sources", "Sources"),
)
#: A record's group by its type, once its role as a note is settled.
_BY_TYPE = {
    **{kind: "pictures" for kind in link_engine.EMBEDDED_TYPES},
    "compare-session": "pictures",
    "map-layer": "layers",
    "map-plate": "layers",
    socialposts.TYPE: "posts",
    "sheet": "sheets",
}
#: The attributes of a note that travel: its file and its look. Its record of editions and
#: of archived links are this machine's publishing, which the receiver starts without.
_NOTE_ATTRS = ("path", "look")
#: The case's own settings a map or a table reads (`layerediting.palette`, `icon_names`), and
#: the mark that its notes' mentions were restated, which an open would otherwise redo.
_SETTINGS = ("layer_palette", "layer_icon_names", notelinks.RESTATED)
#: The database's own keys that travel; `name` and the days are the copy's.
_META = ("schema_version", "name", "created_at", "updated_at", "media_index_ready")
#: Chapters a page prints, as `notes_markdown.expand` reads them.
_CHAPTER_DEPTH = md.MAX_INCLUDE_DEPTH
#: The most notes one export carries: an article, its chapters and the map pages it links to.
MAX_NOTES = md.MAX_CHAPTERS
#: The depth a note only mentioned is held at: any reading of its text goes deeper.
_UNREAD = 1 << 16
#: A record's id as a reference writes it.
_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
#: `azimut://media/<id>` and `azimut://entity/<id>` written as an address.
_AZIMUT_REF = re.compile(r"azimut://(media|entity)/([A-Za-z0-9_-]{1,64})")
#: An image written with a case file's address (`![alt](/files/<case>/<path>…`): what the
#: copy writes again by its record, since the address names a case the receiver has not.
_FILE_IMAGE = re.compile(r"(!\[[^\]\n]*\]\()(/files/([^/\s()\"'<>]+)/((?:[^\s()\"'<>?#]|\([^\s()\"'<>?#]*\))+))")


class ReviewExportError(CaseError):
    """The note could not be exported for review, said for the analyst."""


@dataclass
class Contents:
    """What one export for review carries, read once for the preview and the export alike."""

    note_id: str
    title: str
    #: The look the copy's note keeps: the author and the picture asked for applied.
    look: notelook.NoteLook
    #: Each note carried, by its id (`case` for the case notes), as its copy is written.
    texts: dict[str, str] = field(default_factory=dict)
    #: Each record carried, by its id, with the group the dialog lists it under.
    entities: dict[str, str] = field(default_factory=dict)
    #: Each record's name, for the dialog.
    names: dict[str, str] = field(default_factory=dict)
    #: Each file or folder copied as it is, case-relative, with its size in bytes.
    files: dict[str, int] = field(default_factory=dict)
    #: The maps the notes draw, by their titles.
    maps: list[str] = field(default_factory=list)
    #: Pictures written with a case file's address that no record files: the copy files each.
    unfiled: dict[str, str] = field(default_factory=dict)
    #: Internal passages left out, over every note carried.
    internal: int = 0
    #: Whether the copy files the exporter's logo as the author's picture.
    logo: bool = False
    #: The look each map page it carries keeps, signed as the article is (`signed`): a map page
    #: is published as a page of its own, so it carries the same author and picture.
    pages: dict[str, notelook.NoteLook] = field(default_factory=dict)
    #: The source videos the page only cites and never plays or shows a frame of, by their file,
    #: with its size: a frame's video, a proof's footage, a kept post's video with its own still.
    videos: dict[str, int] = field(default_factory=dict)

    @property
    def size(self) -> int:
        """About how much leaves, in bytes: the files, the notes and the logo."""
        texts = sum(len(text.encode("utf-8")) for text in self.texts.values())
        logo = _size(config.signature_path()) if self.logo else 0
        return sum(self.files.values()) + texts + logo

    def groups(self) -> list[dict[str, Any]]:
        """What leaves, grouped as the dialog lists it: each group's key, words, count and first names."""
        found: dict[str, list[str]] = {key: [] for key, _ in GROUPS}
        for entity_id, group in self.entities.items():
            found[group].append(self.names.get(entity_id) or entity_id)
        if self.texts.get(notelook.CASE_NOTE) is not None:
            found["chapters"].append("Case notes")
        for path, label in self.unfiled.items():
            found["pictures"].append(label or PurePosixPath(path).name)
        if self.logo:
            found["pictures"].append("Your logo")
        out = []
        for key, words in GROUPS:
            names = found[key]
            if names:
                out.append({"key": key, "label": words, "count": len(names), "names": names[:MAX_NAMES]})
        return out


def _size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _tree_size(path: Path) -> int:
    """A file's size, or every file's under a folder; a link counts for nothing."""
    try:
        status = path.lstat()
    except OSError:
        return 0
    if stat.S_ISREG(status.st_mode):
        return status.st_size
    if not stat.S_ISDIR(status.st_mode):
        return 0
    return sum(_tree_size(child) for child in path.iterdir())


class _Reading:
    """One walk over what a note's public page reads, from the note out."""

    def __init__(self, case: "Case", root: str) -> None:
        self.case = case
        self.root = root
        self.reader = notesources.Reader(case)
        self.contents = Contents(note_id=root, title="", look=notelook.DEFAULT)
        self._rows: dict[str, dict[str, Any] | None] = {}
        self._waiting: list[str] = []
        self._origins: set[str] = set()
        #: The records whose file the page plays or shows, a still of a video included.
        self._shown: set[str] = set()
        self._index: urltitles.AddressIndex | None = None
        self._published: dict[str, list[str]] | None = None
        self._post_proofs: Any = None
        self._prefixes = md.file_prefixes(case)
        #: Each note met, at the shallowest depth its text was read from.
        self._depth: dict[str, int] = {}

    # -- the records --------------------------------------------------------------------

    def row(self, entity_id: str) -> dict[str, Any] | None:
        if not _ID.match(entity_id or ""):
            return None
        if entity_id not in self._rows:
            self._rows[entity_id] = self.case.get_entity(entity_id)
        return self._rows[entity_id]

    def add(self, entity_id: str, group: str = "sources", *, origin: bool = False) -> bool:
        """Carry one record and what it owns on disk; True the first time. A note is listed by the
        role it was first met in, anything else by its type when the note shows or names it, and
        among the sources when only something else leads to it. ``origin`` is a record met as
        another's origin, whose own origins its reader does not follow further."""
        record = self.row(entity_id)
        if record is None:
            return False
        if group == "pictures":
            self._shown.add(entity_id)  # its file, or a still of it, is on the page
        held = self.contents.entities
        kind = str(record.get("type") or "")
        listed = group if kind == "note" or group in ("sources", "records") else _BY_TYPE.get(kind, group)
        if entity_id in held:
            if held[entity_id] == "sources" and listed != "sources":
                held[entity_id] = listed  # what the note shows is listed as that, however it was met first
            if not origin and entity_id in self._origins:
                self._origins.discard(entity_id)
                self._waiting.append(entity_id)  # met first as an origin, now shown: its own origins follow
            return False
        held[entity_id] = listed
        self.contents.names[entity_id] = " ".join(str(record.get("label") or "").split())
        if kind != "note":  # a note's text is written public, never copied
            for rel in artifacts.owned(self.case, record):
                self.file(rel)
        if origin:
            self._origins.add(entity_id)
        self._waiting.append(entity_id)
        return True

    def file(self, rel: str) -> bool:
        """Carry one case file or folder as it is, a media's sidecar with it."""
        if not rel or rel in self.contents.files:
            return rel in self.contents.files
        try:
            path = self.case.resolve_inside(rel)
        except CaseError:
            return False
        if not path.exists() or path.is_symlink():
            return False
        self.contents.files[rel] = _tree_size(path)
        if rel.startswith("media/") and PurePosixPath(rel).parent.as_posix() == "media":
            sidecar = layout.sidecar_rel(rel)
            if sidecar not in self.contents.files and self.case.resolve_inside(sidecar).is_file():
                self.contents.files[sidecar] = _size(self.case.resolve_inside(sidecar))
        return True

    def item(self, rel: str) -> dict[str, Any]:
        """What the media index says of a case file, or nothing."""
        try:
            found = self.case.media_items_by_paths([rel])
        except CaseError:
            return {}
        return found[0] if found and isinstance(found[0], dict) else {}

    def path_entity(self, rel: str, group: str) -> str:
        """A case file named by its path: its record when the index files one, else the file. The
        record's id, "" for none."""
        if not self.file(rel):
            return ""
        entity_id = str(self.item(rel).get("entity_id") or "")
        if entity_id:
            self.add(entity_id, group)
        return entity_id

    def drain(self) -> None:
        """What each record carried brings with it, until nothing new comes."""
        while self._waiting:
            entity_id = self._waiting.pop()
            record = self.row(entity_id)
            if record is not None:
                self._follow(record)

    def _follow(self, record: dict[str, Any]) -> None:
        entity_id = str(record["id"])
        kind = str(record.get("type") or "")
        attrs = record.get("attrs") or {}
        path = str(attrs.get("path") or "")
        if path and (kind in notesources.FILE_TYPES or not kind) and entity_id not in self._origins:
            self._lineage(entity_id)
        if path and kind in link_engine.EMBEDDED_TYPES:
            self._posted_by(entity_id)
            sides = (self.item(path).get("source") or {}).get("sides")
            for side in ("a", "b"):
                if isinstance(sides, dict) and isinstance(sides.get(side), str):
                    self.path_entity(sides[side], "sources")
        if kind == "proof":
            self._proof(entity_id)
        elif kind == socialposts.TYPE:
            self._post(record)
        elif kind == "sheet":
            self._sheet(record)

    def _lineage(self, entity_id: str) -> None:
        """What an item was made from, as far as its citation reads back (`notesources.MAX_HOPS`),
        every origin at each hop: what a caption, a card and the sources list say of it."""
        seen = {entity_id}
        frontier = [entity_id]
        for _ in range(notesources.MAX_HOPS):
            following: list[str] = []
            for one in frontier:
                for parent in self.reader._parents_of(one):
                    if parent not in seen:
                        seen.add(parent)
                        following.append(parent)
            frontier = following
        for parent in seen - {entity_id}:
            self.add(parent, "sources", origin=True)

    def _posted_by(self, entity_id: str) -> None:
        """The account a confirmed `posted` edge says put an item online."""
        for edge in self.case.links_of(entity_id):
            if edge.get("type") != link_engine.POSTED or edge.get("to") != entity_id:
                continue
            if (edge.get("provenance") or {}).get("status") == "suggested":
                continue
            account = self.row(str(edge.get("from") or ""))
            if account is not None and account.get("type") == "account":
                self.add(str(account["id"]), "sources")

    def _proof(self, proof_id: str) -> None:
        """The places a proof depicts or stands at (its Geolocations row, its points), and the
        footage it rests on (the card a map marker following it shows)."""
        for edge in self.case.links_of(proof_id):
            if edge.get("from") == proof_id and edge.get("type") in satellite.PLACE_VERBS:
                self.add(str(edge.get("to") or ""), "sources")
        for footage in layerlinks.source_media(self.case, proof_id):
            self.add(str(footage["id"]), "sources")

    def _post(self, record: dict[str, Any]) -> None:
        """A kept post's pictures and videos, and the proof made from it, which its card names."""
        spec = socialposts.read_spec(self.case, record) or {}
        for picture in spec.get("pictures") or []:
            if isinstance(picture, dict) and isinstance(picture.get("media"), str):
                kept = self.path_entity(picture["media"], "sources")
                # a video with no still of its own shows one made from its file (`socialposts._post`)
                poster = picture.get("poster")
                if kept and picture.get("kind") == "video" and not (isinstance(poster, str) and self.file(poster)):
                    self._shown.add(kept)
        if self._post_proofs is None:
            self._post_proofs = socialposts._Proofs(self.case)
        proof = self._post_proofs.of(str(spec.get("url") or ""))
        if proof is not None:
            self.add(proof.entity_id, "sources")

    def _sheet(self, record: dict[str, Any]) -> None:
        """What a chart drawn from a sheet writes as chips: the records its cells link to, and
        the media a picture column names by its path."""
        try:
            read = sheets.read(self.case, str(record["id"]))
        except Exception:  # a sheet gone or unreadable draws nothing
            return
        meta = read.get("meta") or {}
        linked = meta.get("links") if isinstance(meta, dict) else None
        for cells in (linked or {}).values() if isinstance(linked, dict) else ():
            for entity_id in (cells or {}).values() if isinstance(cells, dict) else ():
                self.add(str(entity_id), "records")
        roles = meta.get("roles") if isinstance(meta, dict) else None
        columns = [str(cell) for cell in read.get("columns") or []]
        pictures = {name for name, role in (roles or {}).items()
                    if isinstance(role, dict) and role.get("kind") == "picture"}
        for row in read.get("rows") or []:
            for index, name in enumerate(columns):
                if name in pictures and index < len(row):
                    rel = str(row[index]).strip().replace("\\", "/")
                    if rel and "://" not in rel and not rel.startswith("/") and ".." not in rel:
                        self.path_entity(rel, "pictures")

    # -- the notes ----------------------------------------------------------------------

    def note(self, note_id: str, group: str, depth: int, *, read: bool = True) -> None:
        """Carry one note as its public text, then what that text names. A note only mentioned
        (``read`` False) travels as its public text alone, so the mention finds its record."""
        seen = self._depth.get(note_id)
        if seen is not None and seen <= depth:
            return
        if note_id not in self.contents.texts:
            if len(self.contents.texts) >= MAX_NOTES:
                raise ReviewExportError(f"this note brings more than {MAX_NOTES} notes with it")
            found = md.read_note(self.case, note_id)
            if found is None:
                return
            public, passages = md.strip_internal(found[1])
            self.contents.internal += passages
            self.contents.texts[note_id] = public
            if note_id != notelook.CASE_NOTE:
                self.add(note_id, group)
        self._depth[note_id] = depth if read else _UNREAD
        if read:
            self.text(self.contents.texts[note_id], depth)

    def text(self, text: str, depth: int) -> None:
        """Everything one public text names, which a page of it draws or cites."""
        if depth < _CHAPTER_DEPTH:
            for chapter in notetext.included_ids(text):
                self.note(chapter, "chapters", depth + 1)
        for map_id in notelinks.linked_maps(self.case, text):
            self.note(map_id, "pages", 0)
        mentioned = [*notetext.mentioned_ids(text), *(ident for kind, ident in _AZIMUT_REF.findall(text)
                                                       if kind == "entity")]
        for entity_id in dict.fromkeys(mentioned):
            if (self.row(entity_id) or {}).get("type") == "note":
                self.note(entity_id, "records", _UNREAD, read=False)
            else:
                self.add(entity_id, "records")
        for match in md.MEDIA_REF.finditer(text):
            self.add(match.group(1), "pictures")
        for kind, entity_id in _AZIMUT_REF.findall(text):
            if kind == "media":
                self.add(entity_id, "pictures")
        for rel in self._case_files(text):
            self.path_entity(rel, "pictures")
        for posts in socialposts.blocks_in(text):
            for entry in posts.entries:
                record = (self.row(entry.value) if entry.kind == "post"
                          else self._held_post(entry.value))
                if record is not None:
                    self.add(str(record["id"]), "posts")
        for drawn in notes_maps.blocks_in(text):
            self.map(drawn)
        for body in notecharts.chart_bodies(text):
            chart = notes_charts.parse_block(body)
            self.origin(chart.origin, depth)
            self._wall(chart)
        for found in notes_infographic.blocks_in(text):
            self.origin(notes_infographic.parse_block(found.body).data, depth)
        for address in notelinks.outside_links(text):
            self.address(address)
        self.drain()

    def _case_files(self, text: str) -> Iterator[str]:
        """The case files a text addresses as `/files/<this case>/…`."""
        for prefix in self._prefixes:
            at = 0
            while (start := text.find(prefix, at)) >= 0:
                end = start + len(prefix)
                while end < len(text) and not text[end].isspace() and text[end] not in "()\"'<>?#{}":
                    end += 1
                at = end
                rel = unquote(text[start + len(prefix):end])
                if rel:
                    yield rel

    def _held_post(self, link: str) -> dict[str, Any] | None:
        parsed = socialposts.parse_link(link)
        return socialposts.held_post(self.case, parsed.key) if parsed is not None else None

    def _wall(self, chart: Any) -> None:
        """The pictures a picture wall's rows show, by their records."""
        from . import notes_chart_wall

        kind = notes_charts.effective_kind(chart)
        if kind is None or kind.name != notes_charts.PICTURE_WALL.name or chart.table is None:
            return
        column = notes_chart_wall.picture_column(chart.table, (chart.extra.get("picture") or "").strip())
        if column is None:
            return
        for cells in chart.table.cells:
            ref = notes_chart_wall.picture_ref(cells[column]) if column < len(cells) else ""
            if ref:
                self.add(ref, "pictures")

    def origin(self, origin: str, depth: int) -> None:
        """What a chart's ``from:`` or an infographic's ``data:`` reads its rows from."""
        kind, _, rest = str(origin or "").partition(":")
        ident = rest.partition("#")[0].strip()
        if not _ID.match(ident):
            return
        if kind.strip().casefold() == "sheet":
            self.add(ident, "sheets")
        elif kind.strip().casefold() == "note":
            self.note(ident, "chapters", max(depth, _CHAPTER_DEPTH))

    def address(self, address: str) -> None:
        """What a written link finds in the case, and a proof of the analyst's own published there."""
        if self._index is None:
            self._index = self.reader.index
        held = self._index.first(address)
        if held is not None:
            self.add(str(held["id"]), "sources")
        key = urltitles.url_key(address)
        for proof_id in self._published_at().get(key, []) if key else []:
            self.add(proof_id, "sources")

    def _published_at(self) -> dict[str, list[str]]:
        """Each address a proof of the case was published at, with the proofs published there."""
        if self._published is None:
            self._published = {}
            for proof in _every(self.case, "proof"):
                for url in urltitles.own_posts(proof.get("attrs")):
                    self._published.setdefault(urltitles.url_key(url), []).append(str(proof["id"]))
        return self._published

    # -- the maps -----------------------------------------------------------------------

    def map(self, block: notes_maps.MapBlock) -> None:
        """Everything one map reads, as `notes_maps.derive` reads it: its layers and plate, its
        ground and details, what its editable layers' markers follow or show, and the proofs its
        steps open or its period selects. Read without drawing it, since a drawing would write
        a layer's parsed copy into the case this only reads."""
        self.contents.maps.append(block.title or "Map")
        names = list(block.layers)
        if block.plate and notes_maps.NAME.match(block.plate):
            rel = layout.map_plate_rel(block.plate)
            plate = self.case.find_entity(attr="spec", value=rel)
            if plate is not None:
                self.add(str(plate["id"]), "layers")
            else:
                self.file(rel)
            read = notes_maps._plate(self.case, block.plate)
            names += [name for name, _frame in (read or {}).get("layers") or []]
        hidden = set(block.hidden)
        for name in dict.fromkeys(names):
            if name not in hidden and notes_maps.NAME.match(name or ""):
                self._layer(name)
        for picture in (block.ground, *block.details):
            if picture:
                self.add(picture, "pictures")
        for step in block.steps:
            for one in notes_maps.step_ids(step.proof):
                self.add(one, "pictures")
        period = block.period()
        if period is not None:
            out = notes_maps.Derived(data={})
            notes_maps._proofs(self.case, period, encode=None, anchors={}, round_pov=False, card_side=0, out=out,
                               filmed=block.proof_points == "filmed")
            for proof_id in out.proofs:
                self.add(proof_id, "pictures")

    def _layer(self, name: str) -> None:
        """One layer by its name: its record and files, and for an editable one what each marker
        follows, where that stands, and the picture its card shows (`layerlinks.follow`)."""
        rel = layout.layer_spec_rel(name)
        layer = self.case.find_entity(attr="spec", value=rel)
        if layer is not None:
            self.add(str(layer["id"]), "layers")
        else:
            for one in (rel, layout.layer_snapshot_rel(name), layout.layer_icons_rel(name)):
                self.file(one)
        try:
            spec = maplayers._read_spec(self.case, name)
        except maplayers.LayerError:
            return
        if not layerediting.editable(spec) or not isinstance((spec.get("document") or {}).get("features"), list):
            return
        drawn = layerediting.drawing(spec, self.case)["geojson"]
        for feature in drawn.get("features") or []:
            properties = feature.get("properties") if isinstance(feature, dict) else None
            if not isinstance(properties, dict):
                continue
            followed = str(properties.get("entity_id") or "")
            if followed:
                self.add(followed, "sources")
                self._shown.add(followed)  # its card shows its picture, a video's still
                self._stands(followed)
            picture = str(properties.get("picture") or "")
            if picture:
                self.add(picture, "pictures")

    def _stands(self, entity_id: str) -> None:
        """What says where a followed item stands (`layerlinks.positions`): a file's places
        and the work that placed it, a proof's points."""
        record = self.row(entity_id)
        if record is None or record.get("type") != "media":
            return
        for spot in satellite.media_spots(self.case, entity_id):
            for road in spot.get("roads") or []:
                if road.get("id"):
                    self.add(str(road["id"]), "sources")
        for edge in self.case.links_of(entity_id):
            if edge.get("from") == entity_id and edge.get("type") in satellite.PLACE_VERBS:
                self.add(str(edge.get("to") or ""), "sources")

    # -- the look -----------------------------------------------------------------------

    def look(self, look: notelook.NoteLook | None) -> None:
        """The pictures a look shows: its cover, its line in a site's list, its author's."""
        for picture in notelook.cover_image_ids(look):
            self.add(picture, "pictures")
        self.drain()


def _every(case: "Case", kind: str) -> Iterator[dict[str, Any]]:
    cursor: str | None = None
    while True:
        page = case.page_entities(types=[kind], limit=500, cursor=cursor)
        yield from page.get("items") or []
        cursor = page.get("next_cursor")
        if not cursor:
            return


def picture_of(case: "Case", entity_id: str) -> dict[str, Any] | None:
    """A picture of the case an author can be shown by: a file, a capture or a proof with a file,
    neither a video nor a sound, as the Look route asks (`api/notes.write_look`)."""
    record = case.get_entity(entity_id) if _ID.match(entity_id or "") else None
    attrs = (record or {}).get("attrs") or {}
    if (record is None or record.get("type") not in link_engine.EMBEDDED_TYPES
            or attrs.get("kind") in ("video", "audio") or not attrs.get("path")):
        return None
    try:
        if not case.resolve_inside(str(attrs["path"])).is_file():
            return None
    except CaseError:
        return None
    return record


def _note_title(case: "Case", note_id: str) -> str:
    record = case.get_entity(note_id) if note_id != notelook.CASE_NOTE else None
    if note_id == notelook.CASE_NOTE or record is None or record.get("type") != "note":
        raise ReviewExportError("only a note of the case can be exported for review")
    return " ".join(str(record.get("label") or "Note").split()) or "Note"


def exported_look(case: "Case", note_id: str, *, author: str | None = None,
                  picture: str | None = None) -> tuple[notelook.NoteLook, bool]:
    """The look the copy's note keeps, and whether it files the exporter's logo.

    ``author`` None keeps the look's; ``picture`` None keeps the look's, "" shows none, `LOGO`
    the exporter's logo, else one of the case's pictures by its id.
    """
    look = notelook.stored(case, note_id) or notelook.DEFAULT
    changed: dict[str, Any] = {}
    if author is not None:
        changed["author"] = author
    logo = False
    if picture is not None:
        if picture == LOGO:
            if not config.signature_path().is_file():
                raise ReviewExportError("Settings › Publishing holds no logo to show beside the author's name")
            logo = True
            changed["author_image"] = ""
        elif picture:
            if picture_of(case, picture) is None:
                raise ReviewExportError("the author's picture must be a picture in this case")
            changed["author_image"] = picture
        else:
            changed["author_image"] = ""
    if changed:
        try:
            look = notelook.NoteLook.model_validate({**look.model_dump(mode="json"), **changed})
        except ValueError as exc:
            raise ReviewExportError(f"the author's name is one line of at most {notelook.AUTHOR_MAX} characters") \
                from exc
    return look, logo


def contents(case: "Case", note_id: str, *, author: str | None = None, picture: str | None = None,
             videos: bool = False) -> Contents:
    """What exporting ``note_id`` for review carries, and what it leaves out: the one reading
    the dialog shows and the export writes. The files of the source videos the page never plays
    stay behind unless ``videos`` (`Contents.videos`)."""
    title = _note_title(case, note_id)
    look, logo = exported_look(case, note_id, author=author, picture=picture)
    reading = _Reading(case, note_id)
    reading.contents.title = title
    reading.contents.look = look
    reading.contents.logo = logo
    reading.note(note_id, "note", 0)
    reading.look(look)
    for page in [one for one, group in reading.contents.entities.items() if group == "pages"]:
        reading.contents.pages[page] = signed(notelook.stored(case, page), look)
        reading.look(reading.contents.pages[page])
    _unfiled(case, reading.contents)
    _source_videos(case, reading, videos)
    return reading.contents


def _source_videos(case: "Case", reading: _Reading, send: bool) -> None:
    """The videos the page cites and never plays nor shows a still of, and, unless ``send``, their
    files left out: their records, sidecars and links still travel, so the page and its sources
    read the same."""
    found = reading.contents
    for entity_id in found.entities:
        if entity_id in reading._shown:
            continue
        attrs = (reading.row(entity_id) or {}).get("attrs") or {}
        rel = str(attrs.get("path") or "")
        if attrs.get("kind") == "video" and rel in found.files:
            found.videos[rel] = found.files[rel]
    if not send:
        for rel in found.videos:
            found.files.pop(rel, None)


def signed(page: notelook.NoteLook | None, article: notelook.NoteLook) -> notelook.NoteLook:
    """A map page's look in the copy: the article's author and picture beside the name, unless the
    page already names an author of its own, who keeps it and their picture. Chapters print inside
    the article and are never signed apart."""
    page = page or notelook.DEFAULT
    if page.author and page.author != article.author:
        return page
    return page.model_copy(update={"author": article.author, "author_image": article.author_image})


def _unfiled(case: "Case", found: Contents) -> None:
    """The pictures written by a case file's address whose file no record files."""
    prefixes = md.file_prefixes(case)
    for text in found.texts.values():
        for match in _FILE_IMAGE.finditer(text):
            address = match.group(2)
            prefix = next((one for one in prefixes if address.startswith(one)), "")
            rel = unquote(address[len(prefix):]) if prefix else ""
            if not rel or rel not in found.files or rel in found.unfiled:
                continue
            items = case.media_items_by_paths([rel]) if rel.startswith("media/") else []
            if items and not items[0].get("entity_id") and items[0].get("kind") not in ("video", "audio"):
                found.unfiled[rel] = str(items[0].get("title") or PurePosixPath(rel).stem)


# -- the dialog ----------------------------------------------------------------------------


def report_name() -> str:
    """The exporter's own name, as Settings › Publishing keeps it."""
    return " ".join(str(config.load_settings().get("report_name") or "").split())[:notelook.AUTHOR_MAX]


def preview(case: "Case", note_id: str, *, picture: str | None = None) -> dict[str, Any]:
    """What the dialog shows before the press: what leaves, what stays, who signs. ``size`` counts
    the source videos (``videos``), which the dialog leaves behind until they are asked for, and
    ``limit`` is what the site takes (`SITE_LIMIT`)."""
    look = notelook.stored(case, note_id) or notelook.DEFAULT
    own = look.author_image if look.author_image and picture_of(case, look.author_image) is not None else ""
    has_logo = config.signature_path().is_file()
    choices = []
    if own:
        record = case.get_entity(own) or {}
        choices.append({"value": own, "label": " ".join(str(record.get("label") or "Picture").split())})
    if has_logo:
        choices.append({"value": LOGO, "label": "Your logo"})
    chosen = picture if picture is not None else (own or (LOGO if has_logo else ""))
    if chosen not in [one["value"] for one in choices]:
        chosen = ""
    found = contents(case, note_id, picture=chosen, videos=True)
    return {
        "title": found.title,
        "file": output_name(found.title),
        "groups": found.groups(),
        "maps": found.maps[:MAX_NAMES],
        "map_count": len(found.maps),
        "size": found.size,
        "videos": {"count": len(found.videos), "size": sum(found.videos.values())},
        "limit": SITE_LIMIT,
        "internal": found.internal,
        "author": look.author or report_name(),
        "picture": chosen,
        "pictures": choices,
    }


# -- the export ----------------------------------------------------------------------------


def output_name(title: str) -> str:
    """The bundle's file name: the note's, said to be for review."""
    return layout.visible_filename(f"{title}{FOR_REVIEW}", SUFFIX, "note")


def output_path(title: str) -> Path:
    return config.bundles_dir() / output_name(title)


def export(case: "Case", note_id: str, *, author: str | None = None, picture: str | None = None,
           videos: bool = False, output: Path | None = None) -> Path:
    """Write the bundle of one note for review and return its path. The source case is only
    read; the copy is built beside the bundles and gone once this returns, however it ends.
    The source videos' files go only with ``videos`` (`contents`)."""
    found = contents(case, note_id, author=author, picture=picture, videos=videos)
    config.bundles_dir().mkdir(parents=True, exist_ok=True)
    target = Path(output) if output is not None else output_path(found.title)
    staging = Path(tempfile.mkdtemp(prefix=STAGING_PREFIX, dir=config.bundles_dir()))
    try:
        copy = _build(case, found, staging)
        return bundles.export_case(copy, output=target)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def _build(case: "Case", found: Contents, staging: Path) -> "Case":
    """The reduced copy, as a case folder under ``staging``."""
    from ..workspace import Case

    root = staging / layout.case_folder_name(found.title, "note")
    tool = layout.tool_root(root)
    for directory in (tool, layout.data_dir(root), *layout.content_dirs(root)):
        ensure_dir(directory)
    for rel in found.files:
        _copy(case.resolve_inside(rel), tool.joinpath(*PurePosixPath(rel).parts))
    db = layout.database(root)
    bundles._clean_database(case.db_path, db)
    name = f"{found.title}{FOR_REVIEW}"[:bundles.MAX_CASE_NAME]
    _prune(db, found, name=name)
    graph = SqliteCase(db)
    filed = {rel: _file_unfiled(graph, tool, rel, label) for rel, label in found.unfiled.items()}
    look = found.look
    logo = _file_logo(graph, tool) if found.logo else ""
    if logo:
        look = look.model_copy(update={"author_image": logo})
    _write_note(graph, found.note_id, look)
    for page, page_look in found.pages.items():
        if page_look.author == found.look.author and page_look.author_image == found.look.author_image:
            page_look = page_look.model_copy(update={"author_image": look.author_image})  # the one logo, filed once
        _write_note(graph, page, page_look)
    maps = _published_maps(case, found)
    texts = {note_id: _mentioned(_addressed(case, text, filed), maps) for note_id, text in found.texts.items()}
    for note_id, text in texts.items():
        if note_id == notelook.CASE_NOTE:
            continue
        record = graph.get_entity(note_id) or {}
        rel = str((record.get("attrs") or {}).get("path") or "")
        destination = tool.joinpath(*PurePosixPath(rel).parts)
        if not rel or not destination.resolve().is_relative_to(tool.resolve()):
            raise ReviewExportError("a note of this case has no file to write")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(text, encoding="utf-8")
    _restate(graph, texts)
    # a link written to a map page's address is a mention of the map now: its edge, as a save states it
    for note_id, text in texts.items():
        if note_id != notelook.CASE_NOTE and text != found.texts[note_id]:
            for map_id in dict.fromkeys(ident for ident, _title in maps.values()):
                if f"[[entity:{map_id}|" in text:
                    graph.add_link(note_id, map_id, link_engine.MENTIONS, by="note", unique=True)
    case_notes = texts.get(notelook.CASE_NOTE)
    layout.notes_file(root).write_text(case_notes if case_notes is not None else f"# {name}\n\n", encoding="utf-8")
    manifest = case.read()
    now = _now()
    layout.manifest(root).write_text(json.dumps({
        "azimut": manifest.get("azimut") or {"schema": 0, "storage": "sqlite"},
        "name": name, "created_at": now, "updated_at": now,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return Case(root)


def _copy(source: Path, destination: Path) -> None:
    """A file or a folder copied as it is; a link inside a folder is never followed."""
    if source.is_dir():
        destination.mkdir(parents=True, exist_ok=True)
        for child in source.iterdir():
            if not child.is_symlink() and not (child.name.startswith(".") and child.name.endswith(".tmp")):
                _copy(child, destination / child.name)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    if bundles._live_read(lambda: shutil.copyfile(source, destination)) is None:
        raise ReviewExportError(f"'{source.name}' went away while it was being copied; try again")


def _prune(db: Path, found: Contents, *, name: str) -> None:
    """The copy's database holding the records carried and nothing else of the case."""
    keep = set(found.entities)
    with closing(sqlite3.connect(db)) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA secure_delete = ON")
        conn.execute("CREATE TEMP TABLE kept(id TEXT PRIMARY KEY)")
        conn.executemany("INSERT INTO kept(id) VALUES(?)", [(one,) for one in keep])
        conn.execute("CREATE TEMP TABLE kept_paths(path TEXT PRIMARY KEY)")
        # a source video left behind keeps its row in the media index, its sidecar travelling
        conn.executemany("INSERT INTO kept_paths(path) VALUES(?)", [(one,) for one in {*found.files, *found.videos}])
        for statement in (
            "DELETE FROM links WHERE from_id NOT IN (SELECT id FROM kept) OR to_id NOT IN (SELECT id FROM kept)",
            # presentation of the sender's own graph, their saved readings and merges
            "DELETE FROM entity_images",
            "DELETE FROM graph_pins",
            "DELETE FROM analysis_views",
            "DELETE FROM entity_redirects",
            "DELETE FROM entity_merges",
            "DELETE FROM trash",
            "DELETE FROM jobs",
            "DELETE FROM entities WHERE id NOT IN (SELECT id FROM kept)",
            "DELETE FROM media_items WHERE path NOT IN (SELECT path FROM kept_paths)",
            "UPDATE media_items SET entity_id = NULL WHERE entity_id IS NOT NULL"
            " AND entity_id NOT IN (SELECT id FROM kept)",
        ):
            conn.execute(statement)
        used = {row[0] for row in conn.execute("SELECT DISTINCT folder FROM entities WHERE folder IS NOT NULL")}
        used |= {row[0] for row in conn.execute("SELECT DISTINCT folder FROM media_items WHERE folder IS NOT NULL")}
        folders = {"/".join(parts[:end]) for one in used if one for parts in [str(one).split("/")]
                   for end in range(1, len(parts) + 1)}
        conn.execute("CREATE TEMP TABLE kept_folders(path TEXT PRIMARY KEY)")
        conn.executemany("INSERT INTO kept_folders(path) VALUES(?)", [(one,) for one in folders])
        conn.execute("DELETE FROM folders WHERE path NOT IN (SELECT path FROM kept_folders)")
        settings = [f"setting:{key}" for key in _SETTINGS]
        marks = ", ".join("?" for _ in (*_META, *settings))
        conn.execute(f"DELETE FROM meta WHERE key NOT IN ({marks})", (*_META, *settings))
        now = _now()
        for key, value in (("name", name), ("created_at", now), ("updated_at", now)):
            conn.execute("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                         (key, value))
        for row in conn.execute("SELECT id, type, label, attrs_json FROM entities WHERE type = 'note'").fetchall():
            attrs = json.loads(row[3] or "{}")
            kept_attrs = {key: attrs[key] for key in _NOTE_ATTRS if key in attrs}
            conn.execute("UPDATE entities SET attrs_json = ?, search_text = ? WHERE id = ?",
                         (json.dumps(kept_attrs, ensure_ascii=False), _entity_search_text(row[1], row[2], kept_attrs),
                          row[0]))
        conn.commit()
        conn.execute("VACUUM")


def _restate(graph: SqliteCase, texts: dict[str, str]) -> None:
    """Each note's mentions and shown pictures as its public text states them
    (`notelinks.sync_mentions`, `links.sync_embedded`): an edge the note drew from a passage
    left out goes with it. One the analyst stated by hand is theirs, and stays."""
    with closing(sqlite3.connect(graph.db_path)) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA secure_delete = ON")
        for note_id, text in texts.items():
            if note_id == notelook.CASE_NOTE:
                continue
            mentioned = {*notetext.mentioned_ids(text), *notetext.included_ids(text)}
            shown = {match.group(1) for match in md.MEDIA_REF.finditer(text)}
            row = conn.execute("SELECT attrs_json FROM entities WHERE id = ?", (note_id,)).fetchone()
            shown |= set(notelook.cover_image_ids(notelook.parse(json.loads(row[0] if row else "{}")
                                                                 .get(notelook.ATTR))))
            embedded = ", ".join("?" for _ in link_engine.EMBEDDED_TYPES)
            for link_id, kind, target in conn.execute(
                    "SELECT links.id, links.type, links.to_id FROM links JOIN entities ON entities.id = links.to_id"
                    " WHERE links.from_id = ? AND links.prov_by = 'note' AND (links.type = ?"
                    f" OR (links.type = ? AND entities.type IN ({embedded})))",
                    (note_id, link_engine.MENTIONS, link_engine.DERIVED_FROM,
                     *sorted(link_engine.EMBEDDED_TYPES))).fetchall():
                if target not in (mentioned if kind == link_engine.MENTIONS else shown):
                    conn.execute("DELETE FROM links WHERE id = ?", (link_id,))
        conn.commit()
        conn.execute("VACUUM")


def _write_note(graph: SqliteCase, note_id: str, look: notelook.NoteLook) -> None:
    """The copy's note keeps the look asked for, its author and the picture beside the name, and
    shows that picture as it shows one on its cover (`api/notes.write_look`)."""
    value = None if look.is_default else look.model_dump(mode="json")
    graph.update_entity(note_id, {"attrs": {notelook.ATTR: value}})
    if look.author_image and graph.get_entity(look.author_image) is not None:
        graph.add_link(note_id, look.author_image, link_engine.DERIVED_FROM, by="note", unique=True)


def _file_picture(graph: SqliteCase, tool: Path, rel: str, label: str, source: dict[str, Any],
                  *, by: str) -> str:
    """File one picture already in the copy's `media/` as a record of its own: its sidecar,
    its row in the media index and its entity, as a picture filed in the app has them."""
    path = tool.joinpath(*PurePosixPath(rel).parts)
    digest = media_engine.sha256_file(path)
    sidecar_path = tool.joinpath(*PurePosixPath(layout.sidecar_rel(rel)).parts)
    try:
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        sidecar = {}
    if not isinstance(sidecar, dict) or not sidecar:
        sidecar = {"filename": path.name, "title": label, "kind": media_engine.media_kind(path.name),
                   "sha256": digest, "size": path.stat().st_size, "added_at": _now(), "source": source,
                   "thumbnail": None}
        sidecar_path.parent.mkdir(parents=True, exist_ok=True)
        sidecar_path.write_text(json.dumps(sidecar, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    entity = graph.add_entity("media", label, {"path": rel, "sha256": digest, "kind": sidecar.get("kind") or "image"},
                              by=by)
    graph.upsert_media_item({**sidecar, "path": rel}, entity_id=entity["id"])
    return str(entity["id"])


def _file_unfiled(graph: SqliteCase, tool: Path, rel: str, label: str) -> str:
    return _file_picture(graph, tool, rel, label, {"type": "manual", "original_name": PurePosixPath(rel).name},
                         by="review-export")


def _file_logo(graph: SqliteCase, tool: Path) -> str:
    """The exporter's logo filed in the copy as a picture, which the author's picture names."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    name = layout.visible_filename(f"author-{stamp}", ".png")
    shutil.copyfile(config.signature_path(), tool / "media" / name)
    return _file_picture(graph, tool, f"media/{name}", "Author", {"type": "upload", "original_name": "logo.png"},
                         by="review-export")


#: A link written in a note: its words and its address, an image's left alone.
_WRITTEN_LINK = re.compile(r"(?<!!)\[([^\]\n]*)\]\(\s*<?(https?://[^\s()<>]+)>?(?:\s+\"[^\"\n]*\")?\s*\)")
#: An address written between angle brackets, which Markdown reads as a link to itself.
_AUTOLINK = re.compile(r"<(https?://[^\s<>]+)>")
#: A code span, whose words are never a link.
_CODE_SPAN = re.compile(r"(`+)[^`]*?\1")


def _published_maps(case: "Case", found: Contents) -> dict[str, tuple[str, str]]:
    """Each address a carried map page was published at, by `notelinks.page_key`: the map and its title."""
    return {key: (map_id, found.names.get(map_id) or "Map") for key, map_id in notelinks.map_addresses(case).items()
            if map_id in found.entities}


def _mentioned(text: str, maps: dict[str, tuple[str, str]]) -> str:
    """A note's text with each link written to a carried map page's published address written as a
    mention of the map (`[[entity:<map>|<the link's words>]]`), a bare address taking the map's title.

    The address names where the sender published the map, which the receiving case keeps no record
    of (`notelinks.published_addresses`); a mention it reads as a link to a map
    (`notelinks.linked_maps`), which publishing gives the receiver's own address."""
    if not maps or "http" not in text:
        return text

    def mention(address: str, words: str = "") -> str | None:
        found = maps.get(notelinks.page_key(address))
        if found is None:
            return None
        said = " ".join(words.split())
        return f"[[entity:{found[0]}|{said if said and said != address else found[1]}]]"

    lines = text.split("\n")
    fenced = False
    for number, line in enumerate(lines):
        if notetext.FENCE.match(line):
            fenced = not fenced
            continue
        if fenced or "http" not in line:
            continue
        code = [match.span() for match in _CODE_SPAN.finditer(line)]

        def outside(start: int, end: int, held: list[tuple[int, int]]) -> bool:
            return not any(first < end and start < last for first, last in held)

        def written(match: re.Match[str]) -> str:
            said = mention(match.group(2), match.group(1)) if outside(*match.span(), code) else None
            return said or match.group(0)

        def angled(match: re.Match[str]) -> str:
            said = mention(match.group(1)) if outside(*match.span(), code) else None
            return said or match.group(0)

        line = _AUTOLINK.sub(angled, _WRITTEN_LINK.sub(written, line))
        held = [match.span() for match in _CODE_SPAN.finditer(line)]
        held += [match.span() for match in (*md.ENTITY_REF.finditer(line), *md.MEDIA_REF.finditer(line))]
        for start, end, address in reversed(md.bare_urls(line)):
            # an address a link or a picture is written to is no bare one
            written_to = line[max(0, start - 2):start] == "](" or line[start - 1:start] == "<"
            said = mention(address) if outside(start, end, held) and not written_to else None
            if said:
                line = f"{line[:start]}{said}{line[end:]}"
        lines[number] = line
    return "\n".join(lines)


def _addressed(case: "Case", text: str, filed: dict[str, str]) -> str:
    """A note's text with each picture written by this case's file address written by its record,
    which the receiving case answers to under any name."""
    prefixes = md.file_prefixes(case)
    if not any(prefix in text for prefix in prefixes):
        return text

    def by_record(match: re.Match[str]) -> str:
        address = match.group(2)
        prefix = next((one for one in prefixes if address.startswith(one)), "")
        if not prefix:
            return match.group(0)
        rel = unquote(address[len(prefix):])
        entity_id = filed.get(rel)
        if entity_id is None:
            items = case.media_items_by_paths([rel]) if rel.startswith("media/") else []
            entity_id = str(items[0].get("entity_id") or "") if items else ""
        return f"{match.group(1)}azimut://media/{entity_id}" if entity_id else match.group(0)

    return _FILE_IMAGE.sub(by_record, text)


# -- the job ---------------------------------------------------------------------------------


def queue(case: "Case", note_id: str, *, author: str | None = None, picture: str | None = None,
          videos: bool = False) -> dict[str, Any]:
    """Queue one export for review, once what it was asked is checked; the file is named now."""
    title = _note_title(case, note_id)
    exported_look(case, note_id, author=author, picture=picture)
    job = case.enqueue_job(
        REVIEW_JOB,
        payload={"note": note_id, "author": author, "picture": picture, "videos": videos,
                 "output": str(output_path(title))},
        max_attempts=1,
    )
    workqueue.wake(case)
    return job


def _handle(case: "Case", job: dict[str, Any]) -> None:
    payload = job.get("payload") or {}
    try:
        export(case, str(payload.get("note") or ""), author=payload.get("author"), picture=payload.get("picture"),
               videos=payload.get("videos") is True, output=Path(str(payload.get("output") or "")))
    except (ReviewExportError, bundles.BundleError) as exc:
        raise workqueue.JobRefused(str(exc)) from exc


workqueue.register(REVIEW_JOB, _handle)


def sweep_staging() -> int:
    """Remove the copies exports left when the process stopped under them, at startup, before
    any export runs again. Returns how many went."""
    directory = config.bundles_dir()
    removed = 0
    for path in sorted(directory.glob(f"{STAGING_PREFIX}*")) if directory.is_dir() else []:
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path, ignore_errors=True)
            removed += not path.exists()
    return removed


__all__ = [
    "Contents", "GROUPS", "LOGO", "REVIEW_JOB", "ReviewExportError", "contents", "export", "exported_look",
    "output_name", "output_path", "picture_of", "preview", "queue", "report_name", "sweep_staging",
]
