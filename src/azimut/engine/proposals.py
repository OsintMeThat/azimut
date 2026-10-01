"""Links the case proposes by itself, out of what it already holds.

Two things an analyst writes by hand on every case, which the files already say:

- **Who posted this.** A download keeps the address of the post it came from, and on
  most platforms that address names the account. The account is filed, or found when
  the case already holds that handle, and joined to the file with ``posted``.
- **Which points are one site.** Two geolocations 200 m apart on one airfield draw as
  two islands until somebody says they belong together. Points closer than
  ``SITE_RADIUS_M`` are joined with ``same-site-as``.

Everything is filed ``suggested`` (ONTOLOGY §4). The analyst confirms it or drops it
wherever the edge is read.

**Each entity is read once.** The manifest keeps how far the last pass read
(``Case.link_pass``): the newest filing moment it saw, and which entities filed in that
same second it already read, since a filing time has no finer grain than the second and
the job runs the moment something is filed. A pass reads only what lies past that mark,
which is what makes a dismissal stick: a dropped edge belongs to an entity already read,
so no later pass proposes it again. Enrichment keeps the same promise with its version
stamp.

**One edge per join, never one per pair.** Eight points on one site get seven edges,
a spanning tree, not twenty-eight. The edge says "these belong together", and a mesh
would bury the picture it is there to clear up.

It runs as a queued job when a place, a file or a bookmark is filed, and on demand
from the graph. Nothing is fetched: an address is parsed, a distance is computed.
"""

from __future__ import annotations

import math
import re
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from . import entities as entity_engine
from . import links as link_engine
from . import workqueue

if TYPE_CHECKING:
    from ..workspace import Case

#: How close two points must be to be proposed as one site. Measured on real cases: at
#: 300 m the points of one airfield join, and a city full of geolocations does not chain
#: into a single blob the way it starts to at 500 m.
SITE_RADIUS_M = 300

#: The provenance every proposal carries, so the analyst and the code can tell them
#: from the edges somebody stated.
BY = "link-finder"

#: The durable job that runs a pass. Keyed on the case, so a burst of imports queues
#: one pass rather than one per file.
KIND = "propose-links"

#: What a pass reads for accounts, and where each keeps its address.
URL_ATTRS = {"media": "source_url", "bookmark": "url"}

#: Which types are read for a site. Only `place`: a capture is imagery of a point
#: rather than a point, and it already hangs off the place it was framed on.
SITE_TYPES = ("place",)

#: Grid cell, in degrees, the points are bucketed in so a pass compares a point with its
#: neighbours rather than with the whole case. About 1.1 km, wider than the radius.
_CELL = 0.01

_PAGE = 500

#: Path words a platform uses for itself, which an address can hold where a handle goes.
_RESERVED = frozenset({
    "i", "home", "search", "hashtag", "intent", "share", "explore", "settings", "p",
    "reel", "reels", "tv", "stories", "s", "c", "joinchat", "watch", "shorts", "channel",
    "user", "profile", "status", "video", "post", "messages", "notifications", "web",
})

_HANDLE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,63}$")

#: Prefixes a host is written with that name the same site.
_HOST_PREFIXES = ("www.", "mobile.", "m.")


# -- who posted it ------------------------------------------------------------


def account_from_url(url: Any) -> dict[str, str] | None:
    """The account a post's address names, or None when it names none.

    Read off the address alone, so only where the platform writes the handle into it:
    X, Telegram, TikTok, YouTube, Instagram, Threads, Bluesky and the fediverse's
    ``/@user/123``. A YouTube ``watch`` link or an Instagram ``/p/`` link names no
    account, and guessing one from the uploader's display name would join two people
    who share a name.
    """
    if not isinstance(url, str) or not url.strip():
        return None
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    if parts.scheme not in ("http", "https"):
        return None
    host = (parts.hostname or "").lower()
    for prefix in _HOST_PREFIXES:
        if host.startswith(prefix):
            host = host[len(prefix):]
    segs = [seg for seg in parts.path.split("/") if seg]

    handle, platform, profile = "", "", ""
    if host in ("x.com", "twitter.com"):
        if len(segs) >= 3 and segs[1] == "status":
            handle, platform = segs[0], "X"
            profile = f"https://x.com/{handle}"
    elif host in ("t.me", "telegram.me"):
        if segs and segs[0] == "s":
            segs = segs[1:]
        if len(segs) >= 2 and segs[1].isdigit():
            handle, platform = segs[0], "Telegram"
            profile = f"https://t.me/{handle}"
    elif host in ("tiktok.com", "youtube.com", "threads.net", "threads.com"):
        if segs and segs[0].startswith("@") and (host == "youtube.com" or len(segs) >= 2):
            handle = segs[0][1:]
            platform = {"tiktok.com": "TikTok", "youtube.com": "YouTube"}.get(host, "Threads")
            profile = f"https://{host}/@{handle}"
    elif host == "instagram.com":
        if len(segs) >= 3 and segs[1] in ("p", "reel"):
            handle, platform = segs[0], "Instagram"
            profile = f"https://instagram.com/{handle}"
    elif host == "bsky.app":
        if len(segs) >= 4 and segs[0] == "profile" and segs[2] == "post":
            handle, platform = segs[1], "Bluesky"
            profile = f"https://bsky.app/profile/{handle}"
    elif len(segs) == 2 and segs[0].startswith("@") and segs[1].isdigit():
        # A Mastodon status, on any server: the handle carries the server, since the
        # same name on two servers is two people.
        if _HANDLE.match(segs[0][1:]):
            handle, platform = f"{segs[0][1:]}@{host}", "Mastodon"
            profile = f"https://{host}/{segs[0]}"
            return {"label": f"@{handle}", "platform": platform, "url": profile}
    if not handle or handle.lower() in _RESERVED or not _HANDLE.match(handle):
        return None
    return {"label": f"@{handle}", "platform": platform, "url": profile}


def _address(entity: dict[str, Any]) -> Any:
    key = URL_ATTRS.get(str(entity.get("type") or ""))
    return (entity.get("attrs") or {}).get(key) if key else None


def _page_all(case: "Case", types: list[str], since: str | None = None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        page = case.page_entities(limit=_PAGE, cursor=cursor, types=types, since=since)
        out.extend(page["items"])
        cursor = page.get("next_cursor")
        if not cursor:
            return out


def _filed_at(entity: dict[str, Any]) -> str:
    return str((entity.get("provenance") or {}).get("at") or "")


class _Mark:
    """How far the passes have read, and the question "is this one new?".

    ``at`` is the newest filing moment read so far and ``read`` the ids filed in that
    second that were. Asking about an entity records it, so the mark a pass leaves
    behind is exactly what it read.
    """

    def __init__(self, stored: dict[str, Any] | None) -> None:
        stored = stored or {}
        self.at: str | None = stored.get("at") or None
        self.read: set[str] = set(stored.get("read") or [])
        self.newest, self.newest_ids = self.at, set(self.read)

    def fresh(self, entity: dict[str, Any]) -> bool:
        at, entity_id = _filed_at(entity), str(entity["id"])
        if self.at is not None and (at < self.at or (at == self.at and entity_id in self.read)):
            return False
        if at and (self.newest is None or at > self.newest):
            self.newest, self.newest_ids = at, {entity_id}
        elif at and at == self.newest:
            self.newest_ids.add(entity_id)
        return True

    def stored(self) -> dict[str, Any] | None:
        if self.newest is None:
            return None
        return {"at": self.newest, "read": sorted(self.newest_ids)}


def _propose_accounts(case: "Case", mark: _Mark, counts: dict[str, int]) -> None:
    """Join each file and bookmark filed since the last pass to the account that posted it.

    A file somebody already said who posted is left alone, whatever they said: the
    analyst's ``posted`` is an answer, and a second one beside it would be an argument.
    """
    held: dict[str, str] = {}
    for account_id, label in case.labels_of_type("account"):
        held.setdefault(entity_engine.identity_key("account", label), account_id)
    for entity in _page_all(case, list(URL_ATTRS), mark.at):
        if not mark.fresh(entity):
            continue
        account = account_from_url(_address(entity))
        if account is None:
            continue
        if any(link["type"] == link_engine.POSTED for link in case.links_of(entity["id"])):
            continue
        key = entity_engine.identity_key("account", account["label"])
        found = held.get(key)
        if found is not None:
            account_id = found
        else:
            made = case.add_entity(
                "account",
                account["label"],
                attrs={"platform": account["platform"], "url": account["url"]},
                by=BY,
                status="suggested",
            )
            account_id = held[key] = made["id"]
            counts["accounts"] += 1
        case.add_link(
            account_id, entity["id"], link_engine.POSTED, by=BY, status="suggested", unique=True
        )
        counts["posted"] += 1


# -- which points are one site -------------------------------------------------


def point_of(entity: dict[str, Any]) -> tuple[float, float] | None:
    attrs = entity.get("attrs") or {}
    try:
        lat, lon = float(attrs["lat"]), float(attrs["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon


def metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance between two ``(lat, lon)`` points, in metres."""
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlat, dlon = lat2 - lat1, math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6_371_000 * math.asin(min(1.0, math.sqrt(h)))


class _Points:
    """Points bucketed on a grid, so "what is near this" reads nine cells."""

    def __init__(self, points: dict[str, tuple[float, float]]) -> None:
        self.points = points
        self.cells: dict[tuple[int, int], list[str]] = {}
        for entity_id, point in points.items():
            self.cells.setdefault(self._cell(point), []).append(entity_id)

    @staticmethod
    def _cell(point: tuple[float, float]) -> tuple[int, int]:
        return int(math.floor(point[0] / _CELL)), int(math.floor(point[1] / _CELL))

    def near(self, point: tuple[float, float], radius: float = SITE_RADIUS_M) -> list[str]:
        """The ids within ``radius`` of ``point``, nearest first. The radius stays under
        a cell, so the cell and its eight neighbours hold every answer."""
        row, col = self._cell(point)
        found: list[tuple[float, str]] = []
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                for entity_id in self.cells.get((row + dr, col + dc), ()):
                    distance = metres(point, self.points[entity_id])
                    if distance <= radius:
                        found.append((distance, entity_id))
        return [entity_id for _, entity_id in sorted(found)]


def _propose_sites(case: "Case", mark: _Mark, counts: dict[str, int]) -> None:
    """Join each point filed since the last pass to the sites standing within reach.

    Union-find over the joins already standing, whoever made them, so a site the
    analyst has already tied together gets no second edge, and a new point between two
    sites gets one edge to each.
    """
    places = _page_all(case, list(SITE_TYPES))
    points = {place["id"]: point for place in places if (point := point_of(place)) is not None}
    fresh = sorted(
        (place for place in places if mark.fresh(place) and place["id"] in points),
        key=lambda place: (_filed_at(place), place["id"]),
    )
    if not fresh:
        return

    parent = {entity_id: entity_id for entity_id in points}

    def root(entity_id: str) -> str:
        while parent[entity_id] != entity_id:
            parent[entity_id] = parent[parent[entity_id]]
            entity_id = parent[entity_id]
        return entity_id

    for link in case.links_touching(sorted(points), types=[link_engine.SAME_SITE_AS]):
        if link["from"] in parent and link["to"] in parent:
            parent[root(link["from"])] = root(link["to"])

    grid = _Points(points)
    for place in fresh:
        for other in grid.near(points[place["id"]]):
            if other == place["id"] or root(other) == root(place["id"]):
                continue
            # Symmetric in meaning, canonical in storage, like `same-image-as`.
            first, second = sorted((place["id"], other))
            case.add_link(
                first, second, link_engine.SAME_SITE_AS, by=BY, status="suggested", unique=True
            )
            parent[root(other)] = root(place["id"])
            counts["sites"] += 1


# -- the pass ------------------------------------------------------------------


def propose(case: "Case") -> dict[str, int]:
    """Read what was filed past the mark and propose what it says.

    One transaction. The mark moves to what was actually read, so anything filed while
    the pass runs is read by the next one rather than skipped.
    """
    mark = _Mark(case.link_pass())
    counts = {"accounts": 0, "posted": 0, "sites": 0}
    with case.batch():
        _propose_accounts(case, mark, counts)
        _propose_sites(case, mark, counts)
    stored = mark.stored()
    if stored is not None:
        case.set_link_pass(stored)
    return counts


#: The types whose filing queues a pass.
TRIGGER_TYPES = frozenset({*URL_ATTRS, *SITE_TYPES})


def on_filed(case: "Case", entity_type: str) -> None:
    """Queue a pass after something it reads was filed. One per case at a time."""
    if entity_type in TRIGGER_TYPES:
        workqueue.enqueue(case, KIND, key="case")


def _handle(case: "Case", job: dict[str, Any]) -> None:
    propose(case)


workqueue.register(KIND, _handle)


def unreviewed(link: dict[str, Any]) -> bool:
    """Whether this edge is a proposal of this module nobody has looked at yet.

    Such an edge holds nothing up. A place a proof lets go of is the analyst's leftover
    even when a pass has proposed its neighbour as the same site: the proposal was made
    about the place, not by the analyst for it.
    """
    provenance = link.get("provenance") or {}
    return provenance.get("by") == BY and provenance.get("status") == "suggested"


def pending(case: "Case") -> dict[str, int]:
    """How many proposals still wait for the analyst, by what they say."""
    waiting = {"accounts": 0, "posted": 0, "sites": 0}
    for link in case.list_links():
        if not unreviewed(link):
            continue
        if link["type"] == link_engine.POSTED:
            waiting["posted"] += 1
        elif link["type"] == link_engine.SAME_SITE_AS:
            waiting["sites"] += 1
    waiting["accounts"] = sum(
        1
        for entity in _page_all(case, ["account"])
        if (entity.get("provenance") or {}).get("by") == BY
        and (entity.get("provenance") or {}).get("status") == "suggested"
    )
    return waiting


# -- what a proof shares with the rest of the case -----------------------------

#: How far up a derivation a proof's sources are looked for. A proof made from a frame
#: of a video is two steps from the file that was downloaded.
_ANCESTRY = 6


def _sources(case: "Case", entity_id: str) -> list[str]:
    """What this was made from, every step up, nearest first."""
    seen: list[str] = []
    frontier = [entity_id]
    for _ in range(_ANCESTRY):
        step: list[str] = []
        for current in frontier:
            for link in case.links_of(current):
                if link["type"] == link_engine.DERIVED_FROM and link["from"] == current:
                    if link["to"] not in seen and link["to"] != entity_id:
                        seen.append(link["to"])
                        step.append(link["to"])
        if not step:
            break
        frontier = step
    return seen


def kin(case: "Case", entity_id: str) -> dict[str, Any]:
    """What a geolocation shares with the rest of the case: other geolocations on the
    same site, the other points within reach whatever filed them, and the account its
    material came from with what else that account posted here.

    Read, never written, and answered from geometry and addresses rather than from the
    proposed edges: it is asked the moment a proof is saved, before the pass that will
    file those edges has run.
    """
    entity = case.get_entity(entity_id)
    if entity is None:
        raise KeyError(entity_id)

    # Its places: what it shows or was recorded at.
    shown = link_engine.DEPICTS, link_engine.LOCATED_AT
    own_places = [
        link["to"] for link in case.links_of(entity_id)
        if link["from"] == entity_id and link["type"] in shown
    ]
    own_points = [
        point
        for place in case.entities_by_ids(own_places)
        if (point := point_of(place)) is not None
    ]
    others: set[str] = set()
    near: set[str] = set()
    if own_points:
        places = _page_all(case, list(SITE_TYPES))
        points = {place["id"]: point for place in places if (point := point_of(place)) is not None}
        grid = _Points(points)
        near = {
            other for point in own_points for other in grid.near(point)
        } - set(own_places)
        for link in case.links_touching(sorted(near), types=[link_engine.DEPICTS]):
            proof = link["from"]
            if link["to"] in near and proof != entity_id:
                others.add(proof)
        known = {item["id"]: item for item in case.entities_by_ids(sorted(others))}
        others = {proof for proof in others if (known.get(proof) or {}).get("type") == "proof"}

    # Its accounts: whoever posted the files it was made from.
    sources = [entity_id, *_sources(case, entity_id)]
    mine = set(sources)
    accounts: dict[str, dict[str, Any]] = {}
    for source in case.entities_by_ids(sources):
        for link in case.links_of(source["id"]):
            if link["type"] == link_engine.POSTED and link["to"] == source["id"]:
                poster = case.get_entity(link["from"])
                if poster is not None:
                    key = entity_engine.identity_key("account", poster["label"])
                    accounts.setdefault(key, {"label": poster["label"], "id": poster["id"]})
        parsed = account_from_url(_address(source))
        if parsed is not None:
            key = entity_engine.identity_key("account", parsed["label"])
            accounts.setdefault(key, {"label": parsed["label"], "id": None})

    if accounts:
        posted: dict[str, set[str]] = {key: set() for key in accounts}
        for item in _page_all(case, list(URL_ATTRS)):
            parsed = account_from_url(_address(item))
            if parsed is not None:
                key = entity_engine.identity_key("account", parsed["label"])
                if key in posted:
                    posted[key].add(item["id"])
        for key, account in accounts.items():
            if account["id"]:
                for link in case.links_of(account["id"]):
                    if link["type"] == link_engine.POSTED and link["from"] == account["id"]:
                        posted[key].add(link["to"])
            account["files"] = len(posted[key] - mine)

    return {
        "sites": sorted(others),
        "places": sorted(near),
        "radius": SITE_RADIUS_M,
        "accounts": sorted(
            accounts.values(), key=lambda account: (-account.get("files", 0), account["label"])
        ),
    }
