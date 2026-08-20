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


#: Which attribute holds the rounded point two places are considered one at.
#: Five decimals is about a metre. The name is import enrichment's, which wrote
#: the key first, and it is **shared rather than copied**: a photo's EXIF point
#: and a capture framed on the same spot have to land on one node, or the case
#: grows two places nobody asked it to tell apart.
COORD_KEY = "enrich_coord_key"


def coord_key(lat: float, lon: float) -> str:
    """The dedup key for a point, rounded to roughly one metre."""
    return f"{float(lat):.5f},{float(lon):.5f}"


def place_at(
    case: Case, lat: float, lon: float, *, keyed_only: bool = True
) -> dict[str, Any] | None:
    """The place already standing at this point, or None.

    ``keyed_only`` is the difference between a machine's reading and the
    analyst's own gesture, and it decides whether a place they pinned by hand can
    be reused.

    **Enrichment keeps it on** (the default). A camera's EXIF proposing a point
    must not attach itself to a pin somebody placed deliberately: those two may
    be the same spot or may not, and deciding is a judgement the Suggestions
    panel exists to let them make.

    **A capture turns it off.** The analyst framed that view themselves, so the
    pin already at that point is not somebody else's claim to be weighed — it is
    the same act, made twice. Reusing it is what keeps one point from drawing as
    two pins a metre apart.
    """
    key = coord_key(lat, lon)
    found = case.find_entity(attr=COORD_KEY, value=key)
    if found is not None or keyed_only:
        return found
    for place in _page_all(case, ["place"]):
        attrs = place.get("attrs") or {}
        if attrs.get("lat") is None or attrs.get("lon") is None:
            continue
        try:
            if coord_key(attrs["lat"], attrs["lon"]) == key:
                return place
        except (TypeError, ValueError):
            continue
    return None


def place_for_proof(
    case: Case,
    point: dict[str, Any],
    *,
    by: str = "proof-composer",
) -> dict[str, Any]:
    """File one point a proof states as a ``place``.

    **A geolocation is concluded in the composer, not while framing the map.** The
    coordinates a proof carries are the analyst's answer — what they typed, or the
    point their panels gave it and they left standing — where a capture is one of
    the dozen views taken while looking. So the point becomes a node here, once,
    at the moment somebody commits to it, rather than on every crop.

    **The label names the ground.** A place is the one entity whose identity is a
    number, so it is normally called by its coordinates; a proof that says which
    impact this is has already named it better than the numbers can, and the tree
    reads "impact 2" instead of `64.148100, -21.940100`.

    Filed ``confirmed``: whether it was typed or accepted from the panels, the
    proof is the analyst's own act, and a review step over one's own answer is a
    step over nothing.

    Files only. The caller decides *whether* to ask (``config.proof_place_auto``),
    checks :func:`place_at` first so a point already in the case is never
    duplicated, and states the whole list at once
    (:func:`restate_proof_point`) — a point cannot be joined on its own without
    withdrawing the others the same proof concludes on.
    """
    lat, lon = float(point["lat"]), float(point["lon"])
    label = str(point.get("label") or "").strip()
    return save_place(
        case, lat, lon, title=label or None, by=by,
        extra_attrs={COORD_KEY: coord_key(lat, lon)},
    )


#: The two verbs a proof's point is stated with. `depicts` for the composition and
#: for anything it shows; `located-at` for material POV says was recorded there.
PLACE_VERBS = (links.DEPICTS, links.LOCATED_AT)


def restate_proof_point(
    case: Case,
    proof_id: str,
    stated: list[dict[str, Any]],
    *,
    by: str = "proof-composer",
) -> list[dict[str, Any]]:
    """Make the graph say what this proof says now, and stop saying what it said.

    **A save is the restatement of everything a proof states** — the same rule its
    panels already follow (``links.sync``, ONTOLOGY §3). Re-opening a proof and
    correcting the coordinates is the analyst withdrawing an answer, so the old
    edges go rather than piling up beside the new ones; taking a point off the list
    rends its place exactly as clearing the field once did; moving POV to another
    line is them saying the two points mean something else, so the verbs on the
    material follow. Without this a corrected proof read as two geolocations, and a
    POV answer could only ever be given once.

    ``stated`` is the whole list the proof concludes on now — ``{"id", "pov"}`` per
    place, in the composer's own order — and an empty one withdraws everything.
    **It has to be the whole list**: this reconciles by difference, so filing one
    point on its own would take back every other point the same proof holds.

    **Only what the composer itself wrote is reconciled** (``by``). An edge the
    analyst stated by hand in Details, or one import enrichment proposed from a
    photo's EXIF, is a separate claim about the same file: saving a proof must not
    silently drop it.

    Answers with the places this proof let go of that nothing else holds — the
    caller asks about deleting them (``api/proofs``), since a point nobody points
    at is the analyst's own leftover to keep or drop, not ours to sweep.
    """
    material = [
        entity
        for entity in (links.derivation_subgraph(case, proof_id) or {}).get("entities", [])
        if entity["id"] != proof_id
    ]
    wanted = {entry["id"]: bool(entry.get("pov")) for entry in stated}
    released: list[dict[str, Any]] = []
    for old_id in _stated_places(case, proof_id, by=by):
        if old_id in wanted:
            continue
        _withdraw_point(case, proof_id, old_id, material, by=by)
        old = case.get_entity(old_id)
        if old is not None and not case.links_of(old_id):
            released.append(old)
    for place_id, pov in wanted.items():
        _state_point(case, proof_id, place_id, material, pov=pov, by=by)
    return released


def _stated_places(case: Case, proof_id: str, *, by: str) -> list[str]:
    """The points this proof currently concludes on, read off its own edges.

    The proof is the only reliable record of where a save put its material: the
    edges it wrote on a video carry no proof id, so what a re-save has to undo is
    read from the composition that wrote them.
    """
    seen: list[str] = []
    for link in case.links_of(proof_id):
        if link["from"] != proof_id or link["type"] not in PLACE_VERBS:
            continue
        if (link.get("provenance") or {}).get("by") != by:
            continue
        target = case.get_entity(link["to"])
        if target is not None and target["type"] == "place" and link["to"] not in seen:
            seen.append(link["to"])
    return seen


def _other_proof_states(case: Case, place_id: str, proof_id: str, *, by: str) -> bool:
    """True if another proof still concludes on this point.

    Two proofs built from one video can land on the same roof, and the edges they
    wrote on that video are indistinguishable. So a save withdraws its own point
    only while it is the last one claiming it: dropping the material's edge here
    would undo a conclusion this proof never made.
    """
    for link in case.links_of(place_id):
        if link["to"] != place_id or link["type"] not in PLACE_VERBS or link["from"] == proof_id:
            continue
        if (link.get("provenance") or {}).get("by") != by:
            continue
        source = case.get_entity(link["from"])
        if source is not None and source["type"] == "proof":
            return True
    return False


def _drop_stated(case: Case, entity_id: str, place_id: str, verbs: tuple[str, ...], by: str) -> None:
    """Remove this entity's own statements about a point, and nothing else's."""
    for link in case.links_of(entity_id):
        if link["from"] != entity_id or link["to"] != place_id or link["type"] not in verbs:
            continue
        if (link.get("provenance") or {}).get("by") == by:
            case.remove_link(link["id"])


def _withdraw_point(
    case: Case, proof_id: str, place_id: str, material: list[dict[str, Any]], *, by: str
) -> None:
    """Take back a point this proof no longer concludes on, material included."""
    shared = _other_proof_states(case, place_id, proof_id, by=by)
    _drop_stated(case, proof_id, place_id, PLACE_VERBS, by)
    if shared:
        return
    for entity in material:
        _drop_stated(case, entity["id"], place_id, PLACE_VERBS, by)


def _state_point(
    case: Case,
    proof_id: str,
    place_id: str,
    material: list[dict[str, Any]],
    *,
    pov: bool,
    by: str,
) -> None:
    """Join the proof and the material it was composed from to the same point.

    **The proof itself always ``depicts``.** It was composed, never recorded
    anywhere, so ``located-at`` is not a reading it can take — which is what the
    registry says too. ``pov`` decides the verb for the *material*, and only there.

    A proof stating a point is the analyst's answer about **the footage**, not
    about the composition: the whole reason the proof exists is to say where that
    video was. So the files behind it carry the edge too — the frame, the collage,
    the video two hops up, the capture — read off the derivation closure rather
    than the panels alone, since a frame stands between a proof and the clip it
    came from.

    **``pov`` picks the verb, because the composition cannot.** Recorded-at and
    shows are independent claims: a rooftop shot was recorded somewhere it never
    shows, and a skyline is shown from kilometres away. Neither entails the other,
    and a match between a frame and an imagery says only that they meet — not
    whether the analyst located the camera or what it was pointed at. So the
    answer is given per point, on the line it belongs to, and travels in the spec:

    - ``pov`` — the point is where the camera stood → ``located-at`` on the media
      (an image, a video or a recording of the moment);
    - otherwise — the point is what the frame shows → ``depicts``.

    **A capture is never ``located-at``.** Orbital imagery was not recorded on the
    ground, so it shows the place whichever answer the analyst gave.

    Filed ``confirmed``, because composing is the assertion: putting a frame beside
    a capture and writing the coordinates *is* the geolocation, and there is no
    second opinion to collect from the person who just made it. A review everybody
    clicks through is what makes ``suggested`` stop meaning anything where it is
    real, on a camera's EXIF or a hash match (ONTOLOGY §4). Being wrong costs one
    removal: a relation drops alone, cascading nothing and leaving no tombstone.

    Only what the verb accepts. A PDF in the chain is skipped rather than refused,
    and so is an audio file unless the point is where it was recorded.

    **The verb is restated, not only added.** Answering POV differently on a
    re-save is the analyst correcting what the point means, so the reading it
    replaces goes: a video stops showing the place and is recorded there instead,
    and an audio file drops the edge ``shows`` would refuse. A point another proof
    still concludes on is left alone (:func:`_other_proof_states`) — the answer
    being restated is this proof's, and it does not speak for that one.
    """
    verb = links.LOCATED_AT if pov else links.DEPICTS
    kinds = ("image", "video", "audio") if pov else ("image", "video")
    shared = _other_proof_states(case, place_id, proof_id, by=by)
    case.add_link(proof_id, place_id, links.DEPICTS, by=by, unique=True)
    for entity in material:
        wanted: str | None = None
        if entity["type"] == "capture":
            wanted = links.DEPICTS
        elif entity["type"] == "media" and links.media_kind(entity) in kinds:
            wanted = verb
        if not shared:
            stale = tuple(v for v in PLACE_VERBS if v != wanted)
            _drop_stated(case, entity["id"], place_id, stale, by)
        if wanted is not None:
            case.add_link(entity["id"], place_id, wanted, by=by, unique=True)


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


#: How many points one proof may state. A composition arguing fifteen positions is
#: a case rather than a proof, and the cap is what keeps a spec written by hand from
#: filing a hundred places on one save. Same number as ``PLACEMENT_LIMIT``, for the
#: same reason: past that a panel is a wall rather than a reading.
MAX_PROOF_POINTS = 15


def _typed_point(text: Any) -> dict[str, Any] | None:
    """One coordinate field read as a point, or None when it holds no point.

    The text comes back with it. A proof reopened has to show the analyst what
    they wrote, not a rendering of it: somebody who works in DMS typed DMS.
    """
    trimmed = str(text or "").strip()
    parsed = geo_engine.parse_coords(trimmed)
    return {"lat": parsed[0], "lon": parsed[1], "coords": trimmed} if parsed else None


def _stated_once(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """The single point a spec written before the list states.

    ``coordsText`` is what the analyst typed into the composer's coordinate field,
    in whatever format they use, and it wins: it is their own assertion, and it is
    the reason the field exists. ``coords`` is what the panels gave the proof,
    frozen at save — which is what keeps a proof on the map after the capture it
    was built from is deleted, since outputs outlive their sources (ONTOLOGY §3).

    Still the live reading for a sheet row and an import, which each state one
    point and have no reason to learn the list to say so.
    """
    point = _typed_point(spec.get("coordsText"))
    if point is None:
        coords = spec.get("coords")
        frozen = _point((coords or {}).get("lat"), (coords or {}).get("lon")) \
            if isinstance(coords, dict) else None
        # nothing was typed, so the row carries no text: the composer shows the
        # panels' own answer there and the reset arrow stays away, as it always has
        point = {**frozen, "coords": ""} if frozen else None
    if point is None:
        return []
    return [{**point, "label": "", "pov": bool(spec.get("pov"))}]


def _mirror_broken(spec: dict[str, Any], entries: list[Any]) -> bool:
    """True when the single-point field says something the list does not.

    Only when the field is *there*: a spec holding a list and no ``coordsText`` was
    written by something that states them all, and has nothing to disagree with.
    """
    if "coordsText" not in spec:
        return False
    first = entries[0] if entries and isinstance(entries[0], dict) else {}
    return str(spec.get("coordsText") or "").strip() != str(first.get("coords") or "").strip()


def spec_points(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Every point a proof states, its conclusion first.

    **A proof shows more than one place more often than it shows one** — three
    impacts, a building and the camera that filmed it. Each is a point the analyst
    concluded on, and they are peers: the list is what they typed, in the order
    they typed it.

    **The first one is the conclusion.** It places the proof on the map, a post
    cites it, the export prints it — every surface that can carry only one answer
    reads that one. Nothing else about a point takes that rank, POV included: an
    analyst concluding on the camera moves it to the top themselves, and a list
    that reordered itself would take a coordinate out of a tweet without saying so.

    **``pov`` rides on the point, not on the proof**, because that is what it says:
    the material was recorded *there*. At most one point carries it — a camera
    stood in one place, and two would have one video recorded twice — so the first
    to claim it keeps it whatever a hand-written spec asked for.

    Text that reads as no point is skipped (prose in the field is a caption), and
    two entries a metre apart are one place, so the second is dropped rather than
    drawn as a second mark on the same roof.

    A spec holding no list falls back to the single point it was written with
    (:func:`_stated_once`), so nothing has to be migrated and nothing that states
    one point has to learn the list.

    **The mirror is also a check.** ``coordsText`` and the first entry are written
    together and never drift (:func:`state_points`), so when they disagree the
    field was set by something that does not know the list — an older build, a
    route stating one point by hand — and what it says is the newer answer. The
    list is dropped rather than quietly outvoting the coordinates somebody typed.
    """
    entries = spec.get("points")
    points: list[dict[str, Any]] = []
    if isinstance(entries, list) and not _mirror_broken(spec, entries):
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            point = _typed_point(entry.get("coords"))
            if point is None:
                continue
            points.append(
                {
                    **point,
                    "label": str(entry.get("label") or "").strip(),
                    "pov": bool(entry.get("pov")),
                }
            )
    return _settled(points or _stated_once(spec))


def _settled(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One entry per point, one POV at most, capped — whatever order they arrived in."""
    kept: list[dict[str, Any]] = []
    seen: set[str] = set()
    pov_taken = False
    for point in points:
        key = coord_key(point["lat"], point["lon"])
        if key in seen:
            continue
        seen.add(key)
        if point["pov"] and pov_taken:
            point = {**point, "pov": False}
        pov_taken = pov_taken or point["pov"]
        kept.append(point)
        if len(kept) == MAX_PROOF_POINTS:
            break
    return kept


def _recorded_there(case: Case, place_id: str) -> bool:
    """True when some material says it was recorded at this point — POV, read off
    the graph rather than off a spec that never learned about the point."""
    for link in case.links_of(place_id):
        if link["to"] == place_id and link["type"] == links.LOCATED_AT:
            source = case.get_entity(link["from"])
            if source is not None and source["type"] == "media":
                return True
    return False


def _adopted_points(
    case: Case,
    proof_id: str,
    held: set[str],
    incident: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Points filed for this proof by a road that never wrote its composition.

    A sheet row does exactly that (``api/sheetproofs._added_point``): the binder's
    cross-border shape is one picture and two lines, so the second line's point
    joins the proof under the sheet's own provenance rather than composing the
    picture twice. The graph then holds a point the spec never learned, and a
    composer opening on one row while the map draws two is the proof saying two
    different things.

    ``held`` is what the spec already states, and skipping those early is what
    keeps the common case cheap: every proof points at its own places, so without
    it the index would read the POV of every point it already knows about.

    A place named by its own coordinates is unnamed — that label is what a place
    with nothing else to say gets — so it arrives as a point with no name.
    """
    found: list[dict[str, Any]] = []
    for link in incident if incident is not None else case.links_of(proof_id):
        if link["from"] != proof_id or link["type"] not in PLACE_VERBS:
            continue
        place = case.get_entity(link["to"])
        if place is None or place.get("type") != "place":
            continue
        attrs = place.get("attrs") or {}
        point = _point(attrs.get("lat"), attrs.get("lon"))
        if point is None or coord_key(point["lat"], point["lon"]) in held:
            continue
        label = str(place.get("label") or "").strip()
        if label == coords_label(point["lat"], point["lon"]):
            label = ""
        found.append({
            **point,
            "coords": coords_label(point["lat"], point["lon"], "dd"),
            "label": label,
            "pov": _recorded_there(case, place["id"]),
        })
    return found


def proof_points(
    case: Case,
    proof_id: str,
    stated: list[dict[str, Any]],
    incident: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Every point a proof concludes on: what it states, then what was filed for it.

    ``stated`` is :func:`spec_points` — the analyst's own list, and the authority
    on order, so the conclusion stays the conclusion. What another road filed
    follows, and only where the list does not already hold that point.

    Every surface that asks what a proof concludes on reads this one: the map rows,
    the composer opening the proof, the placement walk. Reading only the spec left
    the composer showing one row for a proof the map drew twice.
    """
    held = {coord_key(one["lat"], one["lon"]) for one in stated}
    return _settled([*stated, *_adopted_points(case, proof_id, held, incident)])


def open_spec(case: Case, proof_id: str, spec: dict[str, Any]) -> dict[str, Any]:
    """The spec a proof reopens on, holding every point it concludes on.

    Untouched when the spec already states them all, which is every proof but the
    one a sheet row filed a second point for — reopening must not rewrite what the
    analyst wrote, down to the format they typed it in.

    When there *is* more to show, the rows are materialised: a point with no text
    is the panels answering for the proof, and that answer has to become the
    conclusion in writing before another point can sit under it. Same rule as the
    composer's own `+`.
    """
    stated = spec_points(spec)
    merged = proof_points(case, proof_id, stated)
    if len(merged) <= len(stated):
        return spec
    return state_points(spec, [
        {**one, "coords": one["coords"] or coords_label(one["lat"], one["lon"], "dd")}
        for one in merged
    ])


def state_points(spec: dict[str, Any], entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Write what a proof states into its spec: the list, and the mirror of it.

    **One place writes a point, on both sides at once**, so a spec on disk never
    carries the two saying different things. Setting ``coordsText`` alone on a proof
    that holds a list leaves a contradiction behind, and while the read resolves it
    the right way (:func:`spec_points`), a file nobody can read twice the same way
    is not a file to write. Everything that states a point for a proof it did not
    compose comes through here.

    **The mirror is not a leftover.** A case bundle travels between installations
    and the binaries are versioned, so a build older than the list has to find the
    conclusion where it has always been rather than open a proof with no point.
    It carries the first point, which is the one such a build could hold anyway.
    """
    points: list[dict[str, Any]] = []
    for entry in entries:
        coords = str(entry.get("coords") or "").strip()
        if not coords:
            continue
        point: dict[str, Any] = {"coords": coords}
        label = str(entry.get("label") or "").strip()
        if label:
            point["label"] = label
        if entry.get("pov"):
            point["pov"] = True
        points.append(point)
    spec["points"] = points
    first = points[0] if points else {}
    spec["coordsText"] = first.get("coords", "")
    spec["pov"] = bool(first.get("pov"))
    return spec


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


def _at(lat: Any, lon: Any) -> tuple[float, float] | None:
    """One point rounded to about a metre — the precision the map groups marks at."""
    try:
        return (round(float(lat), 5), round(float(lon), 5))
    except (TypeError, ValueError):
        return None


def _located(attrs: dict[str, Any]) -> bool:
    """True once this entity's geography came back with a country."""
    geo = attrs.get("geo")
    return isinstance(geo, dict) and geo.get("state") == "ok"


def _place_geo(case: Case) -> dict[tuple[float, float], dict[str, Any]]:
    """The geography of the case's places, by the point each one stands on.

    A proof carries no geography of its own and no Locate pass ever gives it one
    (``saved_entities`` is places and captures). But the point it states in the
    composer is filed as a ``place``, whose country is resolved right there
    (``api/proofs._state_points``) — so the answer is already in the case, one
    node away, for exactly the proofs whose panels place nothing: a frame and a
    photo carry no point, and their proof would otherwise file under Unlocated
    while the place it just wrote knows the country.

    Read once per index rather than once per row, since a case holds far fewer
    places than the proofs index has rows.

    A located place wins a point two of them share: a pin dropped before the
    Locate pass ran and the place a proof filed on the same metre are one spot,
    and only the one that knows its country answers anything.
    """
    found: dict[tuple[float, float], dict[str, Any]] = {}
    for place in _page_all(case, ["place"]):
        attrs = place.get("attrs") or {}
        key = _at(attrs.get("lat"), attrs.get("lon"))
        if key is not None and not _located(found.get(key) or {}):
            found[key] = attrs
    return found


def _geo_at(
    sources: list[dict[str, Any]],
    point: dict[str, float],
    places: dict[tuple[float, float], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """The attrs of whatever stands on this exact point, or nothing.

    A source the proof composes answers first — it is what the proof was built
    from. Failing that, the place standing there does, which is how a proof made
    of photos still files under its country.
    """
    here = _at(point["lat"], point["lon"])
    if here is None:
        return {}
    for source in sources:
        if _at(source["lat"], source["lon"]) == here:
            return dict(source["attrs"])
    return dict((places or {}).get(here) or {})


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
        # what the analyst called this point, when they called it anything. It is
        # what tells three rows of one proof apart: same title, same thumbnail,
        # three places.
        "label": (point or {}).get("label") or "",
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
    """Proofs as map rows, newest first — one row per distinct point.

    ``listing`` is the proofs listing (title, export, thumbnail, the points its
    spec states), which the proofs API owns; everything geographic is read here so
    the Saved panel gets the row shape it already knows. A proof stating three
    points is three rows: the map is about places, and a proof arguing three of
    them draws three marks. A proof whose panels are all unlocated still comes
    back, without a point, and files under ``Unlocated`` in the tree.

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
    places = _place_geo(case)
    rows: list[dict[str, Any]] = []
    for proof in listing:
        entity = by_spec.get(proof.get("spec_path"))
        if entity is None:
            continue  # a spec file with no entity is not in the graph to place
        incident = case.links_of(entity["id"])
        linked_posts = _linked_posts(entity["id"], incident, post_entities, drafts)
        proof = {**proof, "posts": len(linked_posts), "linked_posts": linked_posts}
        sources = _source_points(case, entity["id"], incident)
        stated = proof_points(case, entity["id"], proof.get("points") or [], incident)
        if stated:
            # the proof says where it is, so what it composes stops answering for
            # it. Each point's geography is borrowed only from what stands on that
            # same point: a source it composes, or the place the save filed there.
            # A neighbouring capture's country would be a guess, and a place the
            # analyst linked by hand from somewhere else is about somewhere else —
            # a wrong country files the proof under the wrong branch.
            points: list[dict[str, Any] | None] = [
                {**point, "attrs": _geo_at(sources, point, places)} for point in stated
            ]
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


def _entity_points(case: Case, entity: dict[str, Any]) -> list[dict[str, Any]]:
    """The points this entity carries itself, or nothing if it carries none.

    Two types hold them inside a chain. A ``capture`` records the one marker it was
    taken at. A ``proof`` states its own through the composer, and ``spec_points``
    is what decides which: what the analyst typed wins over what the panels froze,
    and a proof arguing three impacts reports all three. Reading them here is what
    keeps a video from reporting a capture's raw point while the proof beside it
    shows the corrected one — and what makes the footage behind a three-point proof
    answer for all three rather than for its conclusion alone.
    """
    attrs = entity.get("attrs") or {}
    if entity.get("type") == "capture":
        point = _point(attrs.get("lat"), attrs.get("lon"))
        return [point] if point is not None else []
    if entity.get("type") != "proof":
        return []
    spec_rel = attrs.get("spec")
    if not isinstance(spec_rel, str) or not spec_rel:
        return []
    try:
        spec = json.loads(case.resolve_inside(spec_rel).read_text(encoding="utf-8"))
    except (OSError, ValueError, CaseError):
        return []  # a spec deleted or half-written places nothing
    stated = spec_points(spec) if isinstance(spec, dict) else []
    return proof_points(case, entity["id"], stated)


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
    already settles this for the map — a proof that states where it is answers with
    its own points, rather than also drawing at the panels it overrode — and a panel
    that listed both would contradict the map about the same proof. Stopping there is also what keeps
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
            carried = _entity_points(case, node)
            if carried:
                for point in carried:
                    key = (point["lat"], point["lon"])
                    if key in found:  # a nearer artifact already stands here
                        continue
                    if len(found) >= cap:
                        truncated = True
                        break
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
