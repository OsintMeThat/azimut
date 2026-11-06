"""Where an item of the case comes from: the one reading a printed note uses.

A note printed for someone else has to say, for everything it shows or cites,
where that came from, and say it the same way everywhere. The credit line under a
picture, the `Watch` line under a video, the address a reference links to and the
numbered list of sources at the end of the document all read this module, so the
four can never disagree.

**What it reads.** Only the case's own index: the entity, the media sidecar the
browse index keeps (`media_items_by_paths`), the `derived-from` chain
(`links.derivation_subgraph`, the slice Geo Proof and the Post composer trace a
picture back to its original over) and a confirmed `posted` edge. Nothing is
fetched, and every address is checked to be one a reader can open (`web`).

**What each producer recorded.** A download keeps its post's address, author and
day; a capture its imagery's provider, day and credit; an extension screenshot
the page it was taken on as well; a Compare or Detect picture the day of each of
its two images; a Horizon picture the eye it was drawn from and the terrain's
credits. A file uploaded with nothing said about it says nothing, and nothing is
made up for it.

**Origins.** An Inspect frame, a collage, a proof: each was made in the case out
of other items and carries no address of its own. Its origins are the items it was
made from, followed a few hops at most and never round a loop, and its credit is
taken from them: a frame cut from a video posted on x.com credits `Source: x.com`,
linked to the post, and a collage of three posts says the first and `+2`.

**One source, one key.** Two citations of the same item are one source: an item of
the case is keyed by its entity id (or its path, for a file the graph does not
hold) and a written link by its address. A written link to the page of an item the
document also cites is that item: the same address, or the same page as the case's
source lookup reads it (`urltitles.url_key`), which drops the `#fragment`. So a
quote linked to the passage it was taken from (`#:~:text=…`) beside the chip of the
page it is on is one source, not two.
"""

from __future__ import annotations

import math
import re
from collections import deque
from dataclasses import dataclass
from datetime import date
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Any, Iterable, Iterator
from urllib.parse import urlsplit

from . import copernicus_credit, entities, links, notes_style, timeline, urltitles
from .proposals import URL_ATTRS

if TYPE_CHECKING:
    from ..workspace import Case

#: How far back a made item's origins are followed: a proof, the frame it shows,
#: the video that frame was cut from, and one more.
MAX_HOPS = 4
#: How many items one made item names as its origins (a collage of many pieces).
MAX_ORIGINS = 12
#: How many sources the list at the end of a document holds.
MAX_ENTRIES = 500
#: How long a label or an author is kept, in characters.
MAX_LABEL = 200

#: The types a note can show as a picture: a file of the case, with its origins.
FILE_TYPES = links.EMBEDDED_TYPES
#: The attr an archived copy is kept under (a bookmark's declared field).
ARCHIVE = "archive_url"
#: Where the analyst published an item of their own, a proof on X say (a proof's
#: declared field). Not where it comes from: a report links the item to it.
POSTED = "posted_url"

#: What kind of thing a source is.
PAGE = "page"
POST = "post"
ACCOUNT = "account"
IMAGERY = "imagery"
FILE = "file"

#: The routes a picture of the ground from above came in by, which say whose
#: imagery it is and of which day.
IMAGERY_ROUTES = ("satellite", "screenshot", "compare")
#: A picture Horizon drew of the terrain from an eye.
HORIZON = "horizon"
#: A page of a Map plate, whose face carries the credits it owes.
PLATE = "map-plate"
#: A Graph or a Timeline reading drawn as a picture, and the snapshot that froze it.
READING = "analysis-view"
#: How the day an item came into the case is said, by the route it came in by.
ARRIVALS = {"satellite": "captured", "screenshot": "captured", "inspect": "made", "compare": "made",
            "horizon": "made", "map-plate": "made", "analysis-view": "made"}

#: How many days one provider's imagery names before the first and the last stand for them.
MAX_DAYS_SAID = 4
#: What a figure filed from a Map plate is called.
PLATE_NOUN = "Map plate"
#: What a file of the case is called, by what its bytes are.
FILE_NOUNS = {"image": "Picture", "video": "Video", "audio": "Audio"}
#: Imagery named when the app no longer lists it (a keyed basemap whose key is gone):
#: the passes Detect reads and the keyed basemaps a Compare picture can hold.
KNOWN_NAMES = {
    "sentinel2": "Sentinel-2", "sentinel1": "Sentinel-1", "esri-wayback": "Esri Wayback",
    "google-satellite": "Google Satellite", "google-js": "Google Satellite", "mapbox-satellite": "Mapbox Satellite",
}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
#: A day, and a moment of one (`2026-03-02T10:22:00Z`, a radar pass's time).
INSTANT = re.compile(r"^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?Z$")


@dataclass(frozen=True)
class Credit:
    """The small line under a picture saying where it came from: what kind of source
    (`Source`, `Imagery`, `Terrain`, `Watch`), the place, and the address it links to
    ("" for none)."""

    kind: str
    value: str
    link: str = ""


@dataclass(frozen=True)
class Reading:
    """One picture of the ground in an item: whose imagery, and of which day (as the
    Time panel reads it, `~` at the end when the provider only estimates it)."""

    provider: str
    day: str = ""


@dataclass(frozen=True)
class Source:
    """What the case knows about where one item comes from, each field empty when it
    knows nothing."""

    #: What makes two citations one source: `entity:<id>`, `path:<case path>` or `url:<address>`.
    key: str
    #: What the item is called, and what kind of thing it is: `page`, `post`,
    #: `account`, `imagery` or `file`, and the word a reader is told (`Video`).
    label: str = ""
    kind: str = ""
    noun: str = ""
    #: The original address and an archived copy, both http(s).
    address: str = ""
    archive: str = ""
    #: Where the analyst published it (`POSTED`), http(s).
    posted: str = ""
    #: The account or author the case records.
    author: str = ""
    #: The day the content is from (a post's day; imagery days are in ``readings``),
    #: and the day it came into the case, said with ``arrival`` (`collected`, `made`).
    published: str = ""
    collected: str = ""
    arrival: str = "collected"
    #: Each picture of the ground it holds, and the provider's own credit line.
    readings: tuple[Reading, ...] = ()
    attribution: str = ""
    #: Where a drawn view was seen from, and the moment a frame was cut at.
    seen: str = ""
    at: str = ""
    #: A file of the case: its fingerprint and its path.
    sha256: str = ""
    path: str = ""
    entity_id: str = ""
    #: Made in the case out of other items, which are its origins (nearest first).
    derived: bool = False
    origins: tuple["Source", ...] = ()

    @property
    def host(self) -> str:
        return host(self.address or self.archive)

    @property
    def sourced(self) -> bool:
        """Whether anything says where it comes from: an address, an archived copy, an
        author, the imagery it holds, the terrain it draws, or what it was made from."""
        return bool(
            self.address or self.archive or self.author or self.readings or self.attribution or self.origins
        )

    @property
    def citable(self) -> bool:
        """Whether a reference to it belongs in a list of sources: it says where it
        comes from, or it is a file of the case, which is evidence of its own."""
        return self.sourced or bool(self.path)

    def lineage(self) -> Iterator["Source"]:
        """Itself, then its origins, nearest first, each once."""
        seen: set[str] = set()
        queue: deque[Source] = deque([self])
        while queue:
            one = queue.popleft()
            if one.key in seen:
                continue
            seen.add(one.key)
            yield one
            queue.extend(one.origins)

    @property
    def traced_address(self) -> str:
        """Its own address, else the first one along its origins."""
        return next((one.address for one in self.lineage() if one.address), "")

    @property
    def link(self) -> str:
        """Where a reference to it links: its address, its archived copy, else the
        first address along its origins. A reader wants the page itself and only
        falls back on the snapshot."""
        return self.address or self.archive or self.traced_address

    def imagery(self) -> str:
        """`Esri World Imagery, about 12 March 2024 · Maxar`: whose imagery and of
        which day, a pair's two days together, and the provider's own credit last,
        where a cut costs least."""
        said: list[str] = []
        for provider in dict.fromkeys(reading.provider for reading in self.readings):
            days = [spoken_day(reading.day) for reading in self.readings if reading.provider == provider]
            days = [day for day in days if day]
            # an evolution sheet holds many days: its first and last stand for the rest
            if len(days) > MAX_DAYS_SAID:
                when = f"{len(days)} pictures, {days[0]} to {days[-1]}"
            else:
                when = ", ".join(days[:-1]) + (" and " if len(days) > 1 else "") + "".join(days[-1:])
            said.append(", ".join(part for part in (provider, when) if part))
        shown = " and ".join(part for part in said if part)
        lead = self.readings[0].provider if len(self.readings) == 1 else ""
        if self.attribution and self.attribution != lead and self.kind == IMAGERY:
            shown = f"{shown} · {self.attribution}" if shown else self.attribution
        return shown

    def credit(self) -> Credit | None:
        """The line under a picture of it, from what the case recorded.

        Imagery says whose and of which day, linked to the page it was taken on when
        there was one. Anything else with an address says where it is online. A
        made item says what its origins say, the first and how many more; a terrain
        drawing with no photo of its own credits the terrain.
        """
        if self.kind == IMAGERY:
            shown = self.imagery()
            if shown:
                return Credit("Imagery", shown, self.address)
        if self.address:
            return Credit("Source", host(self.address), self.address)
        found: list[Credit] = []
        for origin in self.origins:
            credit = origin.credit()
            if credit is not None and credit not in found:
                found.append(credit)
        if found:
            first = found[0]
            more = f" +{len(found) - 1}" if len(found) > 1 else ""
            return Credit(first.kind, f"{first.value}{more}", first.link)
        if self.attribution:
            return Credit("Map" if self.noun == PLATE_NOUN else "Terrain", self.attribution)
        return None


class Reader:
    """One document's reading of a case: each item read once, nothing written.

    A source is kept once read, so a picture shown three times and cited twice
    costs one lookup. A reading that fails (an index the case does not have) leaves
    the item without what it would have said rather than failing the document.
    ``case`` is None for a template, which cites only the web.
    """

    def __init__(self, case: "Case | None") -> None:
        self.case = case
        self._entities: dict[str, Source | None] = {}
        self._files: dict[str, Source | None] = {}
        self._links: dict[str, Source] = {}
        self._items: dict[str, dict[str, Any]] = {}
        self._rows: dict[str, dict[str, Any] | None] = {}
        self._parents: dict[str, list[str]] = {}
        self._reading: set[str] = set()
        self._names: dict[str, str] | None = None

    # -- what a note can point at ---------------------------------------------

    def entity(self, entity_id: str) -> Source | None:
        """The source of a record of the case, or None when it is no longer there."""
        return self._entity(entity_id, 0)

    def file(self, relative: str) -> Source | None:
        """The source of a case file named by its path: its entity's, when the index
        knows one, else what the index says of the file itself."""
        if self.case is None:
            return None
        if relative in self._files:
            return self._files[relative]
        item = self._item(relative)
        entity_id = str(item.get("entity_id") or "")
        source = self.entity(entity_id) if entity_id else None
        if source is None:
            source = self._read(None, relative, 0)
        self._files[relative] = source
        return source

    def link(self, address: str, words: str = "") -> Source:
        """A web page a note links to, named by the words of its first link."""
        found = self._links.get(address)
        if found is not None:
            return found
        label = _line(words)
        if not label or label == address:
            label = host(address)
        source = Source(key=f"url:{address}", label=label, kind=PAGE, noun="Web page", address=address)
        self._links[address] = source
        return source

    # -- reading --------------------------------------------------------------

    def _entity(self, entity_id: str, depth: int) -> Source | None:
        if entity_id in self._entities:
            return self._entities[entity_id]
        record = self._row(entity_id)
        if record is None:
            self._entities[entity_id] = None
            return None
        kind = str(record.get("type") or "")
        attrs = record.get("attrs") or {}
        # a record with no type is read as the file it points at, as the renderer does
        path = str(attrs.get("path") or "") if kind in FILE_TYPES or not kind else ""
        self._reading.add(entity_id)
        try:
            source = self._read(record, path, depth)
        finally:
            self._reading.discard(entity_id)
        self._entities[entity_id] = source
        return source

    def _read(self, record: dict[str, Any] | None, path: str, depth: int) -> Source:
        """What one item says about itself and, for a file, what its sidecar says."""
        attrs: dict[str, Any] = (record or {}).get("attrs") or {}
        kind = str((record or {}).get("type") or "")
        entity_id = str((record or {}).get("id") or "")
        item = self._item(path) if path else {}
        recorded = item.get("source")
        sidecar: dict[str, Any] = recorded if isinstance(recorded, dict) else {}
        route = str(sidecar.get("type") or "")
        imagery = route in IMAGERY_ROUTES or kind == "capture"

        declared = entities.entity_type(kind)
        keys = [
            *([URL_ATTRS[kind]] if kind in URL_ATTRS else []),
            "url",
            "source_url",
            *(attr.key for attr in (declared.attrs if declared else ()) if attr.kind == "url" and attr.key not in (ARCHIVE, POSTED)),
        ]
        address = next((one for one in (web(attrs.get(key)) for key in keys) if one), "")
        address = address or web(sidecar.get("url")) or web(sidecar.get("webpage_url"))
        archive = web(attrs.get(ARCHIVE)) or web(sidecar.get(ARCHIVE))

        author = _line(sidecar.get("uploader"))
        if not author and entity_id and path:
            author = self._posted_by(entity_id)
        collected = ""
        if path or kind == "bookmark":
            provenance = (record or {}).get("provenance") or {}
            collected = next(
                (day for day in (_day(sidecar.get("fetched_at")), _day(attrs.get("fetched_at")),
                                 _day(sidecar.get("rendered_at")), _day(item.get("added_at")),
                                 _day(provenance.get("at"))) if day),
                "",
            )
        sha = str(attrs.get("sha256") or item.get("sha256") or "").lower()

        readings = self._readings(sidecar, attrs) if imagery else ()
        # Older captures keep the app's former Copernicus wording on disk: read as the notice,
        # dated by the imagery they show (`engine/copernicus_credit.py`).
        attribution = copernicus_credit.normalise_attribution(
            _line(sidecar.get("attribution")), *(reading.day.rstrip("~") for reading in readings)
        ) if imagery or route in (HORIZON, PLATE) else ""
        if kind == "account":
            noun, what = "Account", ACCOUNT
        elif kind == "bookmark":
            noun, what = "Web page", PAGE
        elif imagery:
            noun, what = "Imagery", IMAGERY
        elif path:
            media = str(attrs.get("kind") or item.get("kind") or "")
            if kind == "proof":
                noun = "Proof"
            elif route == HORIZON and sidecar.get("kind") != "photo":
                noun = "Terrain view"
            elif route == PLATE:
                noun = PLATE_NOUN
            elif route == READING:
                noun = f"{str(sidecar.get('surface') or 'analysis').capitalize()} snapshot"
            else:
                noun = FILE_NOUNS.get(media, "File")
            what = POST if address else FILE
        else:
            noun, what = (declared.label if declared else "Record"), (PAGE if address else "")

        origins = self._origins(entity_id, depth) if entity_id and path else ()
        derived = bool(self._parents.get(entity_id)) if entity_id and path else False
        label = _line((record or {}).get("label")) or _line(item.get("title")) or PurePosixPath(path).name
        return Source(
            key=f"entity:{entity_id}" if entity_id else f"path:{path}",
            label=label,
            kind=what,
            noun=noun,
            address=address,
            archive=archive,
            posted=web(attrs.get(POSTED)),
            author=author,
            published=timeline.media_published(sidecar) or "" if not imagery else "",
            collected=collected,
            arrival="made" if derived or kind == "proof" else ARRIVALS.get(route, "collected"),
            readings=readings,
            attribution=attribution,
            seen=_seen(sidecar) if route == HORIZON else "",
            at=_moment(sidecar.get("time")) if route == "inspect" and sidecar.get("op") == "frame" else "",
            sha256=sha if path and SHA256.match(sha) else "",
            path=path,
            entity_id=entity_id,
            derived=derived,
            origins=origins,
        )

    def _readings(self, sidecar: dict[str, Any], attrs: dict[str, Any]) -> tuple[Reading, ...]:
        """The pictures of the ground an item holds: a capture's one, or a Compare or
        Detect picture's two, or every day of an evolution sheet, each with whose imagery
        it is and its day."""
        evolution = sidecar.get("evolution")
        if isinstance(evolution, dict) and isinstance(evolution.get("days"), list):
            name = self._name(evolution.get("provider"))
            held = [(one.get("day"), one.get("exact") is not False) for one in evolution["days"] if isinstance(one, dict)]
            return tuple(Reading(name, f"{day}{'' if exact else '~'}") for day, exact in held if isinstance(day, str) and day)
        pair = [(side, timeline.imagery_reading(sidecar, f"imagery_{side}")) for side in ("a", "b")]
        if any(day for _, day in pair):
            providers = sidecar.get("providers")
            named: dict[str, Any] = providers if isinstance(providers, dict) else {}
            passes = self._passes(sidecar)
            return tuple(
                Reading(self._name(named.get(side) or passes.get(side, {}).get("provider")), day or "")
                for side, day in pair
                if day
            )
        day = timeline.capture_imagery(sidecar) or ""
        provider = _line(sidecar.get("provider_label") or attrs.get("provider"))
        if not provider:
            # a Detect picture of one pass names its imagery in the run it came from
            provider = self._name(self._passes(sidecar).get("b", {}).get("provider"))
        return (Reading(provider, day),) if provider or day else ()

    @staticmethod
    def _passes(sidecar: dict[str, Any]) -> dict[str, dict[str, Any]]:
        """The two passes a Detect picture was read on, as its run recorded them."""
        candidate = sidecar.get("candidate")
        found = candidate.get("sources") if isinstance(candidate, dict) else None
        held = found if isinstance(found, dict) else sidecar.get("input")
        if not isinstance(held, dict):
            return {}
        return {side: held[side] for side in ("a", "b") if isinstance(held.get(side), dict)}

    def _name(self, provider_id: Any) -> str:
        """What a basemap is called, as this app's own list of basemaps (read from
        its settings, never the network) names it; its id when it is not one."""
        text = str(provider_id or "").strip()
        if not text:
            return ""
        if self._names is None:
            self._names = {}
            try:
                from . import tiles

                for provider in tiles.all_providers():
                    self._names[provider.id] = provider.label.split(" (", 1)[0]
            except Exception:  # a name is a nicety; the day still prints
                pass
        base = text.split("~", 1)[0]
        return self._names.get(base) or KNOWN_NAMES.get(base) or text

    def _origins(self, entity_id: str, depth: int) -> tuple[Source, ...]:
        """The items one was made from, each read as a source with its own origins."""
        parents = self._parents_of(entity_id)
        if depth >= MAX_HOPS:
            return ()
        found: list[Source] = []
        for parent in parents:
            if parent in self._reading:
                continue  # a loop: the chain is already being read above
            source = self._entity(parent, depth + 1)
            if source is not None and all(one.key != source.key for one in found):
                found.append(source)
            if len(found) >= MAX_ORIGINS:
                break
        return tuple(found)

    def _parents_of(self, entity_id: str) -> list[str]:
        """The items one was made from, read off the `derived-from` closure the other
        tools trace with. One closure answers for every item in it."""
        if entity_id in self._parents:
            return self._parents[entity_id]
        try:
            graph = links.derivation_subgraph(self.case, entity_id) if self.case is not None else None
        except Exception:  # a case without a graph to walk tells nothing more
            graph = None
        if not graph:
            self._parents[entity_id] = []
            return []
        fresh = {str(row["id"]) for row in graph["entities"] if str(row["id"]) not in self._parents}
        for row in graph["entities"]:
            self._rows.setdefault(str(row["id"]), row)
        for one in fresh:
            self._parents[one] = []
        for link in graph["links"]:
            holder, target = str(link["from"]), str(link["to"])
            if holder in fresh and target not in self._parents[holder]:
                self._parents[holder].append(target)
        self._parents.setdefault(entity_id, [])
        return self._parents[entity_id]

    def _posted_by(self, entity_id: str) -> str:
        """The account a confirmed `posted` edge says put this item online."""
        links_of = getattr(self.case, "links_of", None)
        if links_of is None:
            return ""
        try:
            edges = links_of(entity_id)
        except Exception:
            return ""
        for edge in edges:
            if edge.get("type") != links.POSTED or edge.get("to") != entity_id:
                continue
            if (edge.get("provenance") or {}).get("status") == "suggested":
                continue  # a proposal nobody has looked at says nothing yet
            account = self._row(str(edge.get("from") or ""))
            if account is not None and account.get("type") == "account":
                return _line(account.get("label"))
        return ""

    def _row(self, entity_id: str) -> dict[str, Any] | None:
        if not entity_id or self.case is None:
            return None
        if entity_id not in self._rows:
            self._rows[entity_id] = self.case.get_entity(entity_id)
        return self._rows[entity_id]

    def _item(self, path: str) -> dict[str, Any]:
        """What the media index says of a case file, or nothing."""
        if path in self._items:
            return self._items[path]
        lookup = getattr(self.case, "media_items_by_paths", None)
        found: list[Any] = []
        if lookup is not None:
            try:
                found = lookup([path])
            except Exception:
                found = []
        item = found[0] if found and isinstance(found[0], dict) else {}
        self._items[path] = item
        return item


# -- the list at the end of a document --------------------------------------------


@dataclass
class Entry:
    """One numbered source, and the numbers of the items it was made from."""

    number: int
    source: Source
    origins: tuple[int, ...] = ()


class Annex:
    """The numbered sources a document cites, in the order they first appear.

    Built from every citation at once, so a written link to the address of an item
    the document shows later is still that item. An item made from others brings
    them in after itself. Past ``limit`` entries the rest are counted, not listed.
    """

    def __init__(self, cited: Iterable[Source], *, limit: int | None = None) -> None:
        self.limit = MAX_ENTRIES if limit is None else limit
        self.entries: list[Entry] = []
        self._numbers: dict[str, int] = {}
        self._left_out: set[str] = set()
        cited = list(cited)
        #: Who owns an address, and the page it is, so a written link to it is that item.
        self._owners: dict[str, Source] = {}
        self._pages: dict[str, Source] = {}
        for source in cited:
            for one in source.lineage():
                if one.address and (one.entity_id or one.path):
                    self._owners.setdefault(one.address, one)
                    page = urltitles.url_key(one.address)
                    if page:
                        self._pages.setdefault(page, one)
        for source in cited:
            self._add(source)

    def _owner(self, source: Source) -> Source:
        """The item a citation is of: itself, or for a written link the item whose page it is."""
        if source.entity_id or source.path:
            return source
        owner = self._owners.get(source.address)
        if owner is None and self._pages:
            owner = self._pages.get(urltitles.url_key(source.address))
        return owner or source

    def _key(self, source: Source) -> str:
        return self._owner(source).key

    def _add(self, cited: Source) -> int:
        # a link written before the item whose page it is lists that item, not the link
        source = self._owner(cited)
        key = source.key
        if key in self._numbers:
            return self._numbers[key]
        if key in self._left_out:
            return 0
        if len(self.entries) >= self.limit:
            self._left_out.add(key)
            return 0
        entry = Entry(len(self.entries) + 1, source)
        self._numbers[key] = entry.number
        self.entries.append(entry)
        entry.origins = tuple(number for number in (self._add(origin) for origin in source.origins) if number)
        return entry.number

    def number(self, source: Source | None) -> int:
        """The entry a citation of ``source`` links to, or 0 when it has none."""
        if source is None:
            return 0
        return self._numbers.get(self._key(source), 0)

    @property
    def left_out(self) -> int:
        """How many sources the list had no room for."""
        return len(self._left_out)


def details(source: Source) -> list[str]:
    """What an entry says after its label: `Video`, `x.com`, `by @port_watch`,
    `posted 12 March 2026`, `collected 13 March 2026`."""
    parts = [source.noun]
    if source.at:
        parts.append(f"at {source.at}")
    if source.readings or (source.kind == IMAGERY and source.attribution):
        parts.append(source.imagery())
    if source.seen:
        parts.append(source.seen)
    if source.attribution and source.kind != IMAGERY:
        parts.append(source.attribution)
    if source.host and source.host != source.label:
        parts.append(source.host)
    if source.author:
        parts.append(f"by {source.author}")
    if source.published:
        parts.append(f"posted {spoken_day(source.published)}")
    if source.collected:
        parts.append(f"{source.arrival} {spoken_day(source.collected)}")
    return [part for part in parts if part]


# -- small readings ---------------------------------------------------------------


def web(value: Any) -> str:
    """``value`` when it is a web address a reader can open, else ""."""
    text = str(value or "").strip()
    try:
        parts = urlsplit(text)
        hostname = parts.hostname
    except ValueError:
        return ""
    return text if parts.scheme in ("http", "https") and hostname else ""


def host(url: str) -> str:
    """`example.org` for an address, as a credit line names where a picture came from."""
    try:
        name = (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""
    return name[4:] if name.startswith("www.") else name


def spoken_day(reading: str | None) -> str:
    """A day as the Time panel reads it (`2024-03-12`, `2024-03-12~` when the
    provider only estimates it, `2024-03-12T10:22:00Z` for a radar pass) said in
    words: `about 12 March 2024`, `12 March 2024, 10:22 UTC`."""
    text = " ".join((reading or "").split())[:40]
    about = text.endswith("~")
    text = text.rstrip("~")
    if not text:
        return ""
    clock = ""
    instant = INSTANT.match(text)
    if instant:
        text, clock = instant.group(1), f", {instant.group(2)} UTC"
    try:
        text = notes_style.long_date(date.fromisoformat(text)) if len(text) == 10 else text
    except ValueError:
        pass
    return f"about {text}{clock}" if about else f"{text}{clock}"


def _seen(sidecar: dict[str, Any]) -> str:
    """Where a Horizon picture was drawn from: `eye at 15.36940, 44.19100, facing 245°`."""
    try:
        lat, lon = float(sidecar["lat"]), float(sidecar["lon"])
    except (KeyError, TypeError, ValueError):
        return ""
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return ""
    said = f"eye at {lat:.5f}, {lon:.5f}"
    heading = sidecar.get("heading")
    if isinstance(heading, (int, float)) and math.isfinite(heading):
        said += f", facing {round(heading) % 360}°"
    return said


def _moment(seconds: Any) -> str:
    """`1:23.5` for a frame cut 83.5 seconds into its video."""
    if not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds < 0:
        return ""
    whole = int(seconds)
    tenths = int(round((seconds - whole) * 10))
    if tenths == 10:
        whole, tenths = whole + 1, 0
    hours, rest = divmod(whole, 3600)
    minutes, secs = divmod(rest, 60)
    said = f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"
    return f"{said}.{tenths}" if tenths else said


def _day(value: Any) -> str:
    """The day of a stamp (`2026-03-13T10:02:00Z` → `2026-03-13`), or ""."""
    text = str(value or "").strip()[:10]
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return ""


def _line(value: Any) -> str:
    """A value on one line, bounded."""
    return " ".join(value.split())[:MAX_LABEL] if isinstance(value, str) else ""


__all__ = ["Annex", "Credit", "Entry", "Reader", "Reading", "Source", "details", "host", "spoken_day", "web"]
