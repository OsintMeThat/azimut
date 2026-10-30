"""Personal-layer markers that stand on a case entity and follow it.

A marker can carry ``entity_id``: the place, capture, comparison, view, proof or
file it was added from. It then has no position of its own. Where it is drawn is
where that entity stands now, so correcting a proof's point or moving a place
moves every layer marker that shows it. The point kept in the layer's working
copy is the last answer, refreshed on every save, and it is what the marker
falls back to while its entity sits in the Trash.

**One entity can stand in several places**: a proof concluding on three impacts,
a file filmed on a roof and showing the street below. A marker follows the one
nearest to the point it was last drawn at, which is the one it was added from.

**A link to an entity that is gone is hidden, not dropped.** The stored id stays,
so restoring the entity from the Trash links the marker again, with nothing to
migrate.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any

from ..workspace import Case, CaseError
from . import links, maplayers, satellite

#: The kinds a marker can be added from, and so follow.
LINKABLE_TYPES = ("place", "capture", "compare-session", "horizon-view", "proof", "media")
#: How far apart two points can be and still be one place, in metres.
SAME_SPOT = 1.0
#: Types that state their point in their own attributes.
_OWN_POINT = ("place", "compare-session", "horizon-view")


def _distance(first: tuple[float, float], second: tuple[float, float]) -> float:
    """Metres between two `(lon, lat)` points, which is only ever compared."""
    lon1, lat1 = map(math.radians, first)
    lon2, lat2 = map(math.radians, second)
    x = (lon2 - lon1) * math.cos((lat1 + lat2) / 2)
    return math.hypot(x, lat2 - lat1) * 6_371_000


def entity_points(case: Case, entity: dict[str, Any]) -> list[tuple[float, float]]:
    """Every `(lon, lat)` this entity stands on now, checked points only."""
    kind = entity.get("type")
    if kind in _OWN_POINT:
        attrs = entity.get("attrs") or {}
        try:
            lat, lon = float(attrs["lat"]), float(attrs["lon"])
        except (KeyError, TypeError, ValueError):
            return []
        return [(lon, lat)] if math.isfinite(lat) and math.isfinite(lon) else []
    if kind in ("capture", "proof"):
        points = satellite._entity_points(case, entity)
    elif kind == "media":
        # where the map's Media position draws the file, a place stated in its
        # Details included; a point only a tool proposed is not the analyst's yet
        points = [spot for spot in satellite.media_spots(case, entity["id"])
                  if any(road["status"] != "suggested" for road in spot["roads"])]
    else:
        placed = satellite.placements(case, entity["id"]) or {}
        points = placed.get("points") or []
    return [(float(point["lon"]), float(point["lat"])) for point in points
            if not point.get("proposed")]


def positions(case: Case, features: list[dict[str, Any]]) -> dict[str, Any]:
    """`key → (lon, lat)` for every linked marker, or None when its entity is gone.

    A marker whose entity is there but stands nowhere keeps its stored point and
    is left out, as is every marker that links nothing.
    """
    found: dict[str, Any] = {}
    entities: dict[str, Any] = {}
    for feature in features:
        properties = feature["properties"]
        entity_id = properties.get("entity_id")
        if not entity_id or feature["geometry"]["type"] != "Point":
            continue
        if entity_id not in entities:
            entity = case.get_entity(entity_id)
            entities[entity_id] = (None if entity is None else
                                   (entity, entity_points(case, entity)))
        known = entities[entity_id]
        key = properties["key"]
        if known is None:
            found[key] = None
            continue
        points = known[1]
        if not points:
            continue
        stored = tuple(feature["geometry"]["coordinates"][:2])
        found[key] = min(points, key=lambda point: _distance(point, stored))
    return found


def follow(case: Case, features: list[dict[str, Any]], *, rendered: bool) -> None:
    """Move linked markers onto their entity, in place.

    ``rendered`` is the copy a map draws or an editor reads: there a dead link is
    taken off and a live one names what it stands on, with its picture and, for
    a proof, the footage it rests on. The working copy itself only has its points
    refreshed and keeps every id.
    """
    moved = positions(case, features)
    labels: dict[str, dict[str, Any] | None] = {}
    shown: dict[str, dict[str, str]] = {}
    for feature in features:
        properties = feature["properties"]
        if rendered:
            properties.pop("synced", None)  # bookkeeping of the sync, nothing to draw
        key = properties.get("key")
        if key not in moved:
            continue
        point = moved[key]
        if point is not None:
            coordinates = feature["geometry"]["coordinates"]
            feature["geometry"]["coordinates"] = [point[0], point[1], *coordinates[2:]]
        if not rendered:
            continue
        if point is None:
            properties.pop("entity_id", None)
            continue
        entity_id = properties["entity_id"]
        if entity_id not in labels:
            labels[entity_id] = case.get_entity(entity_id)
        entity = labels[entity_id]
        if entity:
            properties["entity_type"] = entity["type"]
            properties["entity_label"] = entity.get("label") or ""
            if entity_id not in shown:
                shown[entity_id] = _shown(case, entity)
            properties.update(shown[entity_id])


def _proof_spec(case: Case, entity: dict[str, Any]) -> dict[str, Any]:
    """A proof's saved spec, or an empty one if it cannot be read."""
    rel = (entity.get("attrs") or {}).get("spec")
    if not isinstance(rel, str) or not rel:
        return {}
    try:
        spec = json.loads(case.resolve_inside(rel).read_text(encoding="utf-8"))
    except (OSError, ValueError, CaseError):
        return {}
    return spec if isinstance(spec, dict) else {}


_ADDRESS = re.compile(r"^https?://\S+$", re.IGNORECASE)


def proof_sources(spec: dict[str, Any], footage: list[str] | None = None) -> list[str]:
    """The addresses a proof cites, as its Sources field shows them.

    What the analyst stated wins, an empty list included: that one says the
    footage has no public source. A proof that states nothing cites the address
    each of its panels came from (`statedSources` and `autoSourceUrls` in the
    composer), then the `footage` it rests on.
    """
    stated = spec.get("sources")
    if isinstance(stated, str):
        parts = [part for part in re.split(r"\s*·\s*|\s+", stated.strip()) if part]
        stated = (parts if all(_ADDRESS.match(part) for part in parts) else []) if parts else None
    if isinstance(stated, list):
        found = [str(one or "").strip() for one in stated]
    else:
        found = []
        for panel in spec.get("panels") or []:
            meta = (panel.get("meta") if isinstance(panel, dict) else None) or {}
            urls = meta.get("source_urls")
            found += [str(one or "").strip() for one in (urls if isinstance(urls, list) else [meta.get("source_url")])]
        found += [str(one or "").strip() for one in footage or []]
    return [one for one in dict.fromkeys(found) if _ADDRESS.match(one)]


def source_media(case: Case, proof_id: str) -> list[dict[str, Any]]:
    """The footage a proof rests on: what its panels and material read back to."""
    start = [link["to"] for link in case.links_of(proof_id)
             if link["type"] == links.DERIVED_FROM and link["from"] == proof_id]
    return links.collected_roots(case, start)


def _placing_proofs(case: Case, media_id: str, point: tuple[float, float] | None = None) -> list[str]:
    """The proofs that put a file on the map, on `point` alone when one is given."""
    found: list[str] = []
    for spot in satellite.media_spots(case, media_id):
        if point is not None and _distance((float(spot["lon"]), float(spot["lat"])), point) > SAME_SPOT:
            continue
        found += [road["id"] for road in spot["roads"] if road.get("type") == "proof" and road.get("id")]
    return list(dict.fromkeys(found))


def anchor(case: Case, entity: dict[str, Any], point: tuple[float, float]) -> dict[str, Any]:
    """What a marker added from this item follows.

    **A proof and the footage it rests on are one geolocation**, so a marker added
    from either is the same marker. It follows the proof, which holds the
    corrected point, the day and the description; a file no proof places on this
    point follows the file itself.
    """
    if entity.get("type") != "media":
        return entity
    for proof_id in _placing_proofs(case, entity["id"], point):
        proof = case.get_entity(proof_id)
        if proof is not None:
            return proof
    return entity


def family(case: Case, entity: dict[str, Any]) -> set[str]:
    """The items one geolocation answers to: a proof and its footage, a file and its proofs."""
    ids = {entity["id"]}
    if entity.get("type") == "proof":
        ids |= {media["id"] for media in source_media(case, entity["id"])}
    elif entity.get("type") == "media":
        ids |= set(_placing_proofs(case, entity["id"]))
    return ids


def _named(text: str, fallback: str) -> tuple[str, str]:
    """A marker's name and note from an item's description.

    The first line names it, as a GeoConfirmed event is named by its sentence;
    the note keeps the whole only when there is more to it than that line.
    """
    text = text.strip()
    if not text:
        return fallback, ""
    first = text.splitlines()[0].strip()
    if len(first) > maplayers.MAX_NAME:
        first = first[: maplayers.MAX_NAME - 1].rsplit(" ", 1)[0] + "…"
    return first, "" if first == text else text


def prefill(case: Case, entity: dict[str, Any], point: tuple[float, float]) -> dict[str, Any]:
    """What a marker following this item says, from the item itself.

    A proof is named by its description (its title when it has none, with the
    point's label on a proof of several) and gives the day it states and the
    addresses it cites, the footage's among them. A file is named by its notes,
    else its title, and gives the address it came from but no day: a post's date
    is often not when it was filmed, and the analyst sets that one. `sync`
    writes these again whenever the item is saved.
    """
    attrs = entity.get("attrs") or {}
    found: dict[str, Any] = {"name": entity.get("label") or "", "description": "", "date": "", "date_end": "",
                             "links": []}
    if entity.get("type") == "proof":
        points = [p for p in satellite._entity_points(case, entity) if not p.get("proposed")]
        nearest = min(points, default=None,
                      key=lambda p: _distance((float(p["lon"]), float(p["lat"])), point))
        label = str((nearest or {}).get("label") or "").strip()
        name, note = _named(str(attrs.get("notes") or ""), found["name"])
        if label and len(points) > 1:
            name = f"{name} · {label}" if name else label
        # an interval, `2024-05-10/2024-05-12`, gives its first and last day
        start, _, end = str(attrs.get("when") or "").partition("/")
        footage = [str((media.get("attrs") or {}).get("source_url") or "") for media in source_media(case, entity["id"])]
        found.update(name=name, description=note, date=start, date_end=end,
                     links=proof_sources(_proof_spec(case, entity), footage))
    elif entity.get("type") == "media":
        name, note = _named(str(attrs.get("notes") or ""), found["name"])
        found.update(name=name, description=note,
                     links=[url for url in [str(attrs.get("source_url") or "").strip()] if _ADDRESS.match(url)])
    return found


def picture(case: Case, entity: dict[str, Any]) -> str:
    """The case file that shows an item on a marker's card: a proof's plate, a file's thumbnail."""
    attrs = entity.get("attrs") or {}
    if entity.get("type") == "proof":
        return str(attrs.get("thumb") or attrs.get("path") or "")
    if entity.get("type") == "media" and attrs.get("path"):
        items = case.media_items_by_paths([str(attrs["path"])])
        thumbnail = (items[0] if items else {}).get("thumbnail")
        if thumbnail:
            return str(thumbnail)
        return str(attrs["path"]) if attrs.get("kind") == "image" else ""
    return ""


def _shown(case: Case, entity: dict[str, Any]) -> dict[str, str]:
    """What a drawn marker shows of its item: its picture, and a proof's footage first."""
    found = {"entity_picture": picture(case, entity)}
    if entity.get("type") == "proof":
        for media in source_media(case, entity["id"]):
            found.update(source_id=media["id"], source_label=str(media.get("label") or ""),
                         source_picture=picture(case, media))
            break
    return {key: value for key, value in found.items() if value}


def digest_part(case: Case, features: list[dict[str, Any]]) -> list[Any]:
    """What a drawing depends on outside the layer: its links and where they stand."""
    return sorted([key, None if point is None else [round(point[0], 7), round(point[1], 7)]]
                  for key, point in positions(case, features).items())


def linkable(case: Case) -> list[dict[str, Any]]:
    """Everything located in the case that a marker can be added from, one row per point."""
    rows: list[dict[str, Any]] = []
    for row in satellite.saved_index(case):
        if row.get("lat") is None or row.get("lon") is None:
            continue
        rows.append({"id": row["id"], "kind": row["kind"], "title": row.get("title") or "",
                     "lat": row["lat"], "lon": row["lon"]})
    for proof in satellite._page_all(case, ["proof"]):
        points = satellite._entity_points(case, proof)
        for index, point in enumerate(point for point in points if not point.get("proposed")):
            label = str(point.get("label") or "").strip()
            title = proof.get("label") or ""
            rows.append({"id": proof["id"], "kind": "proof",
                         "title": f"{title} · {label}" if label else title if index == 0 else f"{title} · point {index + 1}",
                         "lat": point["lat"], "lon": point["lon"]})
    for row in satellite.media_index(case):
        rows.append({"id": row["id"], "kind": "media", "title": row.get("title") or "",
                     "lat": row["lat"], "lon": row["lon"]})
    return rows


def resolve(case: Case, entity_id: str, lat: float, lon: float) -> tuple[dict[str, Any], tuple[float, float]]:
    """The entity a marker is added from, and its point nearest to the one asked for."""
    entity = case.get_entity(entity_id)
    if entity is None or entity.get("type") not in LINKABLE_TYPES:
        raise maplayers.LayerError("one of these items is no longer in the case")
    points = entity_points(case, entity)
    if not points:
        raise maplayers.LayerError(f"“{entity.get('label') or 'This item'}” has no point on the map")
    return entity, min(points, key=lambda point: _distance(point, (lon, lat)))
