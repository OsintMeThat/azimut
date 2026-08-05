"""Satellite captures and their one-to-one ``capture`` entities.

A capture is a satellite imagery crop. It is filed through the *media* pipeline
(:mod:`azimut.engine.media`) so it lives in ``<case>/media/`` alongside every
other image — hashed, thumbnailed, listed in the Media Library and openable in
Inspect — but it is registered under a ``capture`` entity (not ``media``) that
carries the crop's coordinates/zoom/bearing. Its media sidecar's ``source`` dict
holds the full capture provenance (provider, attribution, acquisition, …) with
``type == "satellite"``, which is how a capture is told apart from an ordinary
media item both here and in the Media Library facet.

Because a capture *is* a media item, all of its lifecycle (list/patch/delete)
funnels through the media engine; this module adds the satellite-flavoured
listing view on top of it, plus the compact saved index the Map's Saved panel
navigates (places and captures together, with the geography each was resolved
to).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ..repository import EntityStatus
from ..workspace import Case, CaseError
from . import continents
from . import coords as coords_engine
from . import countries
from . import geo as geo_engine
from . import links
from . import media as media_engine
from .. import layout

# Saved work is places plus captures; a screenshot filed by the capture
# extension is a capture with a different origin, not a third entity type.
SAVED_TYPES = ["place", "capture"]

# One page of the catalog per query while collecting saved entities: bounded
# memory per round-trip, and the whole set is still tens of KB on the wire.
_ENTITY_PAGE = 500


def coords_label(lat: float, lon: float, fmt: str | None = None) -> str:
    """Default capture title / place label: the point's coordinates, written in
    the user's coordinate format (Settings → General).

    Only *new* labels are minted here — a title already stored keeps whatever it
    was named, so switching format never rewrites the case's existing titles.
    Machine-readable fields (``lat``/``lon``, the ``coords`` attribute) stay in
    decimal degrees regardless.
    """
    return coords_engine.format_coords(lat, lon, fmt)


def save_place(
    case: Case,
    lat: float,
    lon: float,
    zoom: Any = None,
    bearing: Any = None,
    title: str | None = None,
    by: str = "satellite",
    extra_attrs: dict[str, Any] | None = None,
    status: EntityStatus = "confirmed",
) -> dict[str, Any]:
    """Register a point as a navigable ``place`` — no image, no download.

    Two callers save places: the map's own pin (api/satellite.py) and the
    capture extension filing the map site you are looking at (api/ingest.py).
    They agree on what a place *is* here, so the Saved panel renders both the
    same way whatever route wrote them. The caller resolves the geography
    afterwards (``locate_on_save``); ``extra_attrs`` carries whatever only one
    of them has, such as the extension's source URL.

    ``status`` is how a place the analyst has not seen yet enters the case:
    import enrichment proposes one from a photo's EXIF as ``suggested`` (a
    camera's claim, not a finding), and the map's own pin stays ``confirmed``.
    """
    attrs: dict[str, Any] = {
        "coords": coords_label(lat, lon, "dd"),
        "lat": lat,
        "lon": lon,
        "plus_code": geo_engine.plus_code(lat, lon),
        "zoom": zoom,
        "bearing": bearing,
    }
    attrs.update(extra_attrs or {})
    label = (title or "").strip() or coords_label(lat, lon)
    return case.add_entity("place", label, attrs=attrs, by=by, status=status)


def is_capture(item: dict[str, Any]) -> bool:
    """True if a media listing item is a capture: a satellite crop, or an
    external-map screenshot filed by the capture extension (api/ingest.py) —
    the latter rides the same panel so its coordinates stay one click away."""
    return (item.get("source") or {}).get("type") in ("satellite", "screenshot")


def list_captures(case: Case) -> list[dict[str, Any]]:
    """The case's satellite captures, newest first, flattened for the UI.

    Each item merges the capture provenance (from the media sidecar's
    ``source``: provider, zoom, bearing, coordinates, acquisition date, …) with
    the media item's own fields (path, title, notes, thumbnail), so the Satellite
    panel keeps rendering exactly the fields it did when captures had their own
    store.
    """
    captures: list[dict[str, Any]] = []
    for item in media_engine.list_media(case):
        if not is_capture(item):
            continue
        source = item.get("source") or {}
        merged = {**source, **item}  # media fields (title/notes/path) win
        lat, lon = merged.get("lat"), merged.get("lon")
        if not merged.get("title") and lat is not None and lon is not None:
            merged["title"] = coords_label(lat, lon)
        captures.append(merged)
    captures.sort(key=lambda d: d.get("fetched_at") or d.get("added_at") or "", reverse=True)
    return captures


# -- saved work: the compact index the Saved panel navigates ----------------------


def _page_all(case: Case, types: list[str]) -> list[dict[str, Any]]:
    """Every entity of these types, read a bounded page at a time.

    Never materialises the whole graph — the panels above these lists are the
    screens that must stay fast on a case with hundreds of saved points.
    """
    out: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        page = case.page_entities(limit=_ENTITY_PAGE, cursor=cursor, types=types)
        out.extend(page["items"])
        cursor = page.get("next_cursor")
        if not cursor:
            return out


def saved_entities(case: Case) -> list[dict[str, Any]]:
    """Every ``place`` and ``capture`` entity, in insertion order."""
    return _page_all(case, SAVED_TYPES)


def _utc_stamp(value: Any) -> str:
    """One timestamp spelling for the whole index: ``2026-07-20T09:12:04Z``.

    Places carry the entity's ``provenance.at`` (already Z-suffixed), captures
    the media sidecar's ``fetched_at`` (an offset-aware isoformat). Both mean
    the same instant, but they don't sort against each other as text — and both
    the "newest first" order here and the client's own sort are text sorts. So
    normalise once, at the edge, rather than parsing dates in three places.
    """
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    if moment.tzinfo is not None:
        moment = moment.astimezone(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _saved_when(entity: dict[str, Any], capture: dict[str, Any] | None) -> str:
    """The one timestamp the saved list orders on: when the item was filed."""
    if capture:
        stamp = capture.get("fetched_at") or capture.get("added_at")
        if stamp:
            return _utc_stamp(stamp)
    return _utc_stamp((entity.get("provenance") or {}).get("at"))


def _saved_row(
    case: Case,
    entity: dict[str, Any],
    capture: dict[str, Any] | None,
    proofs: int = 0,
    relations: int = 0,
) -> dict[str, Any]:
    attrs = entity.get("attrs") or {}
    source = capture or {}
    geo = attrs.get("geo") if isinstance(attrs.get("geo"), dict) else None
    lat, lon = attrs.get("lat"), attrs.get("lon")
    if capture is None:
        kind = "place"
    else:
        kind = "screenshot" if source.get("method") == "screenshot" else "capture"

    thumbnail = source.get("thumbnail")
    # a thumbnail the LRU budget has evicted must read as absent, not as a
    # broken image — the row falls back to its kind glyph
    if thumbnail and not case.resolve_inside(str(thumbnail)).exists():
        thumbnail = None

    return {
        "id": entity["id"],
        # a saved point is one row, so its render key is its id. Proof rows
        # repeat one entity across its source points and key themselves apart.
        "key": entity["id"],
        "kind": kind,
        "title": source.get("title") or entity.get("label") or "",
        # the My-work folder, so the saved-work modal can browse by folder. The
        # capture sidecar is the authority for images; places carry their own.
        "folder": source.get("folder") or attrs.get("folder") or "",
        "lat": lat,
        "lon": lon,
        "geo": geo,
        # the point decides for a country that straddles two continents, so an
        # eastern-Russia capture files under Asia and not under its country's
        # single verdict
        "continent": continents.continent_for((geo or {}).get("country_code"), lat, lon),
        # derived on read like the continent, so every row saved before the
        # tree spoke English gets its English country name without a lookup
        "country_en": countries.name_for((geo or {}).get("country_code")),
        "path": source.get("path"),
        "thumbnail": thumbnail,
        "zoom": attrs.get("zoom") if attrs.get("zoom") is not None else source.get("zoom"),
        "bearing": attrs.get("bearing") if attrs.get("bearing") is not None else source.get("bearing"),
        "provider": source.get("provider_label") or source.get("provider"),
        "site": attrs.get("site") or source.get("site"),
        "source_url": attrs.get("source_url") or source.get("source_url"),
        "fetched_at": _saved_when(entity, capture),
        "imagery_date": source.get("imagery_date"),
        "notes": source.get("notes") or attrs.get("notes") or "",
        # How tightly the point is pinned (ONTOLOGY §2). Carried in the index
        # because the map overlay draws it: an approximate place is a circle or a
        # polygon rather than a pin, and a pin on a guess is the lie this fixes.
        # Absent stays absent — a point with no radius draws exactly as before.
        "radius_m": attrs.get("radius_m"),
        "footprint": attrs.get("footprint"),
        # how many proofs were built on this point. `All` draws every point
        # once, so a worked row is marked rather than doubled by a proof
        # marker landing on the capture it composes.
        "proofs": proofs,
        # how many relations (non-chain edges) touch this point, so the popup can
        # offer to load them without the index carrying the edges themselves.
        "relations": relations,
        # `suggested` means a tool proposed this point and nobody has looked yet —
        # enrichment mints one per GPS-tagged file. The tree and the popup mark
        # those rather than letting them read as the analyst's own work.
        "status": (entity.get("provenance") or {}).get("status") or "confirmed",
    }


def saved_index(case: Case) -> list[dict[str, Any]]:
    """Places and captures as one flat list, newest first.

    Everything the Saved tree, the search modal and the map overlay read, and
    nothing else: no media rows, no derivation, no edges. Work that hangs off a
    point is a count (proofs, relations) rather than a list, so hundreds of rows
    stay in the tens of KB — which is what lets the panel load the whole set on
    case open instead of paging it. The popup loads the edges themselves from the
    bounded chain endpoint when it opens.
    """
    by_path = {c["path"]: c for c in list_captures(case)}
    # two grouped queries for the whole case rather than one per row: this list
    # is read on case open and must not walk the graph row by row
    worked = case.count_dependents(link_type=links.DERIVED_FROM, from_type="proof")
    related = case.count_incident_links(
        exclude_types=[
            *links.CHAIN_TYPES,
            links.MENTIONS,
            *links.CLAIM_CONNECTION_TYPES,
        ]
    )
    rows = []
    for entity in saved_entities(case):
        is_image = entity["type"] == "capture"
        capture = by_path.get((entity.get("attrs") or {}).get("path")) if is_image else None
        if is_image and capture is None:
            continue  # the image is gone; the media listing is the authority
        rows.append(
            _saved_row(
                case,
                entity,
                capture,
                worked.get(entity["id"], 0),
                related.get(entity["id"], 0),
            )
        )
    # newest first, and within one second the later save wins — saving a place
    # and capturing it are one gesture, and they must not come back shuffled
    order = {row["id"]: i for i, row in enumerate(rows)}
    rows.sort(key=lambda r: (r["fetched_at"], order[r["id"]]), reverse=True)
    return rows


def own_point(spec: dict[str, Any]) -> dict[str, float] | None:
    """The point a proof states for itself, or None if it states none.

    A proof is not only placed by what it composes. ``coordsText`` is what the
    analyst typed into the composer's coordinate field, in whatever format they
    use, and it wins: it is their own assertion, and it is the reason the field
    exists. ``coords`` is what the panels gave the proof, frozen at save — which
    is what keeps a proof on the map after the capture it was built from is
    deleted, since outputs outlive their sources (ONTOLOGY §3).
    """
    text = str(spec.get("coordsText") or "").strip()
    if text:
        parsed = geo_engine.parse_coords(text)
        if parsed:  # prose in the field is a caption, not a point
            return {"lat": parsed[0], "lon": parsed[1]}
    coords = spec.get("coords")
    if isinstance(coords, dict) and coords.get("lat") is not None and coords.get("lon") is not None:
        try:
            return {"lat": float(coords["lat"]), "lon": float(coords["lon"])}
        except (TypeError, ValueError):
            return None
    return None


def _source_points(
    case: Case, proof_id: str, incident: list[dict[str, Any]] | None = None
) -> list[dict[str, Any]]:
    """The distinct points a proof's panels were composed from.

    Read one hop back along ``derived-from``: a proof carries no coordinates of
    its own, only the sources it composes. Two panels cropped from one capture,
    or two captures of one roof, are one point and come back once — the point is
    what they share. Panels with no point (a photo, a frame) contribute nothing.
    """
    seen: dict[tuple[Any, Any], dict[str, Any]] = {}
    for link in incident if incident is not None else case.links_of(proof_id):
        if link["type"] != links.DERIVED_FROM or link["from"] != proof_id:
            continue
        source = case.get_entity(link["to"])
        attrs = (source or {}).get("attrs") or {}
        lat, lon = attrs.get("lat"), attrs.get("lon")
        if lat is None or lon is None:
            continue
        seen.setdefault((lat, lon), attrs)
    return [{"lat": lat, "lon": lon, "attrs": attrs} for (lat, lon), attrs in seen.items()]


def _linked_posts(
    proof_id: str,
    incident: list[dict[str, Any]],
    post_entities: dict[str, dict[str, Any]],
    drafts: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Saved post drafts directly derived from this proof, newest first."""
    linked: list[dict[str, Any]] = []
    for link in incident:
        if link["type"] != links.DERIVED_FROM or link["to"] != proof_id:
            continue
        entity = post_entities.get(link["from"])
        if entity is None:
            continue
        draft_path = (entity.get("attrs") or {}).get("draft")
        draft = drafts.get(draft_path) if isinstance(draft_path, str) else None
        draft = draft or {}
        draft_name = draft.get("name")
        if not draft_name and isinstance(draft_path, str):
            draft_name = draft_path.removeprefix(layout.DRAFTS_DIR + "/").removesuffix(".json")
        linked.append(
            {
                "id": entity["id"],
                "name": draft_name,
                "title": draft.get("title") or entity.get("label") or "Untitled post",
                "target": draft.get("target"),
                "updated_at": draft.get("updated_at"),
            }
        )
    linked.sort(
        key=lambda post: (post.get("updated_at") or "", post["title"].casefold()),
        reverse=True,
    )
    return linked


def _geo_at(sources: list[dict[str, Any]], point: dict[str, float]) -> dict[str, Any]:
    """The attrs of the source standing on this exact point, or nothing.

    Five decimals is about a metre — the same precision the map groups marks at.
    """
    here = (round(point["lat"], 5), round(point["lon"], 5))
    for source in sources:
        if (round(float(source["lat"]), 5), round(float(source["lon"]), 5)) == here:
            return dict(source["attrs"])
    return {}


def _proof_row(
    proof: dict[str, Any], entity: dict[str, Any], point: dict[str, Any] | None
) -> dict[str, Any]:
    entity_id = entity["id"]
    attrs = (point or {}).get("attrs") or {}
    geo = attrs.get("geo") if isinstance(attrs.get("geo"), dict) else None
    lat, lon = (point or {}).get("lat"), (point or {}).get("lon")
    return {
        "id": entity_id,
        # one proof can hold two points, and the two rows must not collide as
        # render keys or as marker identities
        "key": f"{entity_id}@{lat},{lon}",
        "kind": "proof",
        "name": proof["name"],
        "title": proof.get("title") or proof["name"],
        # a proof is filed like any other artifact, so the panel groups it by
        # folder as well as by place
        "folder": (entity.get("attrs") or {}).get("folder") or "",
        "notes": "",
        "lat": lat,
        "lon": lon,
        "geo": geo,
        "continent": continents.continent_for((geo or {}).get("country_code"), lat, lon),
        "country_en": countries.name_for((geo or {}).get("country_code")),
        "path": proof.get("png"),
        "thumbnail": proof.get("thumb"),
        "fetched_at": _utc_stamp(proof.get("updated_at")),
        "posts": proof.get("posts", 0),
        "linked_posts": proof.get("linked_posts", []),
    }


def proof_index(
    case: Case,
    listing: list[dict[str, Any]],
    draft_listing: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Proofs as map rows, newest first — one row per distinct source point.

    ``listing`` is the proofs listing (title, export, thumbnail), which the
    proofs API owns; everything geographic is read here so the Saved panel gets
    the row shape it already knows. A proof whose panels are all unlocated still
    comes back, without a point, and files under ``Unlocated`` in the tree.

    Kept out of ``saved_index`` on purpose: that one is read on every case open,
    this one only when the Proofs position of the switch is first opened.
    """
    by_spec = {
        (entity.get("attrs") or {}).get("spec"): entity
        for entity in _page_all(case, ["proof"])
    }
    post_entities = {entity["id"]: entity for entity in _page_all(case, ["post"])}
    drafts = {
        layout.draft_rel(draft["name"]): draft for draft in (draft_listing or [])
    }
    rows: list[dict[str, Any]] = []
    for proof in listing:
        entity = by_spec.get(proof.get("spec_path"))
        if entity is None:
            continue  # a spec file with no entity is not in the graph to place
        incident = case.links_of(entity["id"])
        linked_posts = _linked_posts(entity["id"], incident, post_entities, drafts)
        proof = {**proof, "posts": len(linked_posts), "linked_posts": linked_posts}
        sources = _source_points(case, entity["id"], incident)
        stated = proof.get("coords")
        if stated:
            # the proof says where it is, so it says it once. Its geography is
            # borrowed only from a source standing on that same point — a
            # neighbouring capture's country would be a guess, and a wrong
            # country files the proof under the wrong branch.
            points: list[dict[str, Any] | None] = [{**stated, "attrs": _geo_at(sources, stated)}]
        else:
            # a proof none of whose panels carry a point still lists, without
            # one: it files under Unlocated rather than leaving its own tool
            points = list(sources) or [None]
        rows.extend(_proof_row(proof, entity, point) for point in points)
    rows.sort(key=lambda r: r["fetched_at"], reverse=True)
    return rows


# -- placement: where the chain puts an entity (ONTOLOGY §3) ----------------------
#
# The chain is read backwards as geography: a proof with no point of its own stands
# at the point of every capture it composes. `proof_index` does that one hop back
# for the map. This walks the same edges in both directions and further, because
# the artifact holding the point is rarely the one being read: a video reaches its
# capture through a proof that composed a frame of it, three hops away through a
# shared descendant. That V is what the geolocation gesture actually looks like —
# putting a frame beside a satellite view *is* the assertion they are one place.

#: How far a placement walk travels over chain edges. A note sits three hops above a
#: capture (note → post → proof → capture) and a video three below one
#: (video ← frame ← proof → capture), so four covers every shape `CHAIN_ENDPOINTS`
#: declares with one hop to spare.
PLACEMENT_DEPTH = 4
#: Entities one walk may read, whatever the depth would allow. A video cut into forty
#: frames across ten proofs must not turn opening a panel into a graph scan.
PLACEMENT_NODES = 200
#: Points one entity reports. Fifteen distinct placements is a case already
#: contradicting itself; past that the panel is a wall rather than a reading.
PLACEMENT_LIMIT = 15


def _point(lat: Any, lon: Any) -> dict[str, float] | None:
    if lat is None or lon is None:
        return None
    try:
        return {"lat": float(lat), "lon": float(lon)}
    except (TypeError, ValueError):
        return None


def _entity_point(case: Case, entity: dict[str, Any]) -> dict[str, float] | None:
    """The point this entity carries itself, or None if it carries none.

    Two types hold one inside a chain. A ``capture`` records the marker it was taken
    at. A ``proof`` states its own through the composer, and ``own_point`` is what
    decides which: what the analyst typed wins over what the panels froze. Reusing it
    here is what keeps a video from reporting a capture's raw point while the proof
    beside it shows the corrected one.
    """
    attrs = entity.get("attrs") or {}
    if entity.get("type") == "capture":
        return _point(attrs.get("lat"), attrs.get("lon"))
    if entity.get("type") != "proof":
        return None
    spec_rel = attrs.get("spec")
    if not isinstance(spec_rel, str) or not spec_rel:
        return None
    try:
        spec = json.loads(case.resolve_inside(spec_rel).read_text(encoding="utf-8"))
    except (OSError, ValueError, CaseError):
        return None  # a spec deleted or half-written places nothing
    return own_point(spec) if isinstance(spec, dict) else None


def _filed_at(entity: dict[str, Any]) -> str:
    return str((entity.get("provenance") or {}).get("at") or "")


def placements(
    case: Case, entity_id: str, *, limit: int | None = None
) -> dict[str, Any] | None:
    """Where the derivation chain puts one entity, nearest placement first.

    Breadth-first over ``derived-from``/``depends-on`` in both directions, so the
    artifact that placed this one is found however far round the V it sits. Each
    point comes back with the entity it was read off — the *via* the panel names —
    and the entity's own point comes back with none, because nothing placed it.

    **An artifact that carries a point is where the walk stops.** ``proof_index``
    already settles this for the map — a proof that states where it is says it once,
    rather than also drawing at the panels it overrode — and a panel that listed both
    would contradict the map about the same proof. Stopping there is also what keeps
    a video to its own argument: the capture behind its proof is reached, the second
    proof that happens to reuse that capture is not.

    Points are deduplicated on the exact pair, never on a rounded one: two captures
    of the same roof are metres apart, and merging them would assert they are one
    place, which is the analyst's call and not a rounding. The nearest hop wins a
    repeated point, and the most recently filed artifact wins inside one hop.

    A ``capture`` reports nothing at all. Its point is its own, written at the save
    and already read under Info, so listing it here would show one datum twice in one
    panel for the single type that never derived it.

    Returns ``None`` when the entity is gone.
    """
    root = case.get_entity(entity_id)
    if root is None:
        return None
    if root.get("type") == "capture":
        return {"points": [], "truncated": False}

    cap = PLACEMENT_LIMIT if limit is None else limit
    found: dict[tuple[float, float], dict[str, Any]] = {}
    seen: set[str] = {entity_id}
    frontier = [root]
    reads = 1
    truncated = False
    for depth in range(PLACEMENT_DEPTH + 1):
        if not frontier:
            break
        # newest first inside one hop: when two artifacts state the same point, the
        # freshest reading is the one worth attributing it to
        frontier.sort(key=_filed_at, reverse=True)
        neighbours: list[str] = []
        for node in frontier:
            point = _entity_point(case, node)
            if point is not None:
                key = (point["lat"], point["lon"])
                if key in found:  # a nearer artifact already stands here
                    continue
                if len(found) >= cap:
                    truncated = True
                else:
                    found[key] = {
                        "lat": point["lat"],
                        "lon": point["lon"],
                        "depth": depth,
                        "via": None
                        if node["id"] == entity_id
                        else {
                            "id": node["id"],
                            "type": node.get("type"),
                            "label": node.get("label"),
                        },
                    }
                continue  # this artifact is the placement; what it was made from is not
            if depth == PLACEMENT_DEPTH:
                continue
            for link in case.links_of(node["id"]):
                if link["type"] not in links.CHAIN_TYPES:
                    continue
                other = link["to"] if link["from"] == node["id"] else link["from"]
                if other in seen:
                    continue
                seen.add(other)
                neighbours.append(other)
        nxt: list[dict[str, Any]] = []
        for other_id in neighbours:
            if reads >= PLACEMENT_NODES:
                truncated = True  # the walk stopped short, so the list may be partial
                break
            neighbour = case.get_entity(other_id)
            reads += 1
            if neighbour is not None:
                nxt.append(neighbour)
        frontier = nxt
    return {"points": list(found.values()), "truncated": truncated}


def is_unlocated(entity: dict[str, Any]) -> bool:
    """True when geography was never resolved for this entity, or the lookup
    failed. ``nocoords``/``nocountry``/``ok`` are settled and never retried."""
    geo = (entity.get("attrs") or {}).get("geo")
    if not isinstance(geo, dict):
        return True
    return geo.get("state") == "failed"


def unlocated_entities(case: Case, limit: int | None = None) -> list[dict[str, Any]]:
    """Saved entities still waiting on a country, oldest first.

    Oldest first so a long backfill works forward through the case's history
    and the analyst watches the tree fill from the top. ``limit`` caps the
    batch; None counts the whole backlog.
    """
    found = [e for e in saved_entities(case) if is_unlocated(e)]
    return found if limit is None else found[:limit]


def resolve_geo(case: Case, entity_id: str, lat: Any, lon: Any, timeout: float = 8) -> None:
    """Look up one saved item's geography and file it. Never raises.

    The entity is already written by the time this runs, so a failed or slow
    lookup can only leave ``state: failed`` behind for a later Locate pass — it
    can never turn a filed capture into an error the analyst sees.
    """
    if lat is None or lon is None:
        set_geo(case, entity_id, {"state": "nocoords"})
        return
    set_geo(case, entity_id, geo_engine.locate_point(float(lat), float(lon), timeout))


def set_geo(case: Case, entity_id: str, geo: dict[str, Any]) -> None:
    """File a geography verdict on an entity, leaving every other attr alone.

    Tolerant of a vanished entity: the lookup that produced ``geo`` runs after
    the response was sent, and the item may have been deleted meanwhile.
    """
    try:
        case.update_entity(entity_id, {"attrs": {"geo": geo}})
    except Exception:
        pass
