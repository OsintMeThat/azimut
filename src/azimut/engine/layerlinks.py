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

import math
from typing import Any

from ..workspace import Case
from . import satellite

#: The kinds a marker can be added from, and so follow.
LINKABLE_TYPES = ("place", "capture", "compare-session", "horizon-view", "proof", "media")
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
    taken off and a live one names what it stands on. The working copy itself
    only has its points refreshed and keeps every id.
    """
    moved = positions(case, features)
    labels: dict[str, dict[str, Any] | None] = {}
    for feature in features:
        properties = feature["properties"]
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
    from .maplayers import LayerError

    entity = case.get_entity(entity_id)
    if entity is None or entity.get("type") not in LINKABLE_TYPES:
        raise LayerError("one of these items is no longer in the case")
    points = entity_points(case, entity)
    if not points:
        raise LayerError(f"“{entity.get('label') or 'This item'}” has no point on the map")
    return entity, min(points, key=lambda point: _distance(point, (lon, lat)))
