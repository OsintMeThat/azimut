"""Saved Board, Graph and Timeline readings.

A live view is a recipe: the Search+ question is asked again whenever it opens. A
snapshot is evidence of a reading at one moment, so it stores copies of the matching
entities and the links among them. Both live in the case database and therefore move
with a bundle without becoming semantic graph entities.

Views come in two families: Board and Graph share one question of the catalog, the
Timeline reads time. See `family()`.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from datetime import datetime, timezone
from typing import Any, cast

from ..repository import EntityStatus
from ..workspace import Case, CaseError
from .temporal import TemporalError, window_bound

VERSION = 1
MAX_SPEC_BYTES = 8 * 1024 * 1024
MAX_SNAPSHOT_ENTITIES = 2000
MAX_SNAPSHOT_LINKS = 10000
MAX_SNAPSHOT_TIMELINE_ITEMS = 5000
MAX_SNAPSHOT_PREVIEW_BYTES = 4 * 1024 * 1024
MAX_ONE_PREVIEW_BYTES = 512 * 1024


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def family(surface: Any) -> str:
    """Which family of tools a saved view belongs to.

    Board and Graph ask one question of the catalog and share their views. The Timeline
    asks about time — tracks, a window, a clock — and shares with neither, so the two
    are separate namespaces: a name taken in one is free in the other.
    """
    return "timeline" if surface == "timeline" else "catalog"


def summary(view: dict[str, Any]) -> dict[str, Any]:
    """The bounded row a view menu needs, without its snapshot payload."""
    return {key: value for key, value in view.items() if key != "spec"}


def _short(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    return text[:limit]


def _query_terms(spec: dict[str, Any]) -> dict[str, str]:
    query = spec.get("query")
    raw = query.get("terms") if isinstance(query, dict) else None
    if not isinstance(raw, dict):
        return {}
    allowed = {
        "type", "status", "q", "folder", "unfiled", "recursive", "attr",
        "value", "linked", "unlinked", "since", "until", "by",
    }
    return {
        key: _short(value, 1000)
        for key, value in raw.items()
        if key in allowed and value not in (None, "")
    }


def _bound(raw: Any, *, upper: bool) -> str | None:
    """One end of the window a capture freezes, read the way the live view reads it.

    A snapshot answers the question its view was showing, so both ends go through the
    same reader as the route: a period saved as `2024-03` has to freeze March, not
    stop at its first instant.
    """
    if not raw:
        return None
    try:
        return window_bound(str(raw), upper=upper)
    except TemporalError as exc:
        raise CaseError(str(exc)) from exc


def _string_list(value: Any, *, limit: int = 100, item_limit: int = 160) -> list[str]:
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(
        _short(item, item_limit) for item in value[:limit] if _short(item, item_limit)
    ))


#: The colours a track may be given, by name — the frontend's own palette
#: (`lib/timelineTracks.js`). An unset colour means the lane keeps the colours of the
#: categories it holds.
TRACK_COLORS = ("red", "blue", "amber", "green", "magenta", "orange")


def _clean_track(value: Any, index: int) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CaseError("timeline track is invalid")
    track_id = _short(value.get("id"), 64) or f"track-{index + 1}"
    label = _short(value.get("label"), 80) or f"Track {index + 1}"
    categories = [
        category for category in _string_list(value.get("categories"), limit=3, item_limit=40)
        if category in {"statement", "media", "case_activity"}
    ]
    if not categories:
        raise CaseError(f"timeline track '{label}' needs a category")
    query: dict[str, Any] = (
        value["query"] if isinstance(value.get("query"), dict) else {}
    )
    filter_ = query.get("filter") if isinstance(query.get("filter"), dict) else {}
    roles = [
        role for role in _string_list(query.get("roles"), limit=4, item_limit=24)
        if role in {"occurred", "observed", "valid", "unset"}
    ]
    relation = query.get("relation")
    if relation not in {"any", "owner", "about", "place", "source"}:
        relation = "any"
    color = _short(value.get("color"), 16)
    return {
        "id": track_id,
        "label": label,
        "color": color if color in TRACK_COLORS else "",
        "categories": categories,
        "query": {
            "filter": filter_,
            "terms": _query_terms({"query": {"terms": query.get("terms")}}),
            "label": _short(query.get("label"), 300),
            "relation": relation,
            "roles": roles,
        },
        "collapsed": bool(value.get("collapsed")),
        "hidden": _string_list(value.get("hidden"), limit=500),
        "pinned": _string_list(value.get("pinned"), limit=500),
    }


_ZONE_NAME = re.compile(r"[A-Za-z0-9+\-_/]{1,64}")


def _valid_zone_choice(choice: str) -> bool:
    """Which clock the axis was read on: UTC, this machine, a saved point, or a zone
    named outright. The last one has to travel — a view made on `zone:Asia/Tokyo` must
    not come back on UTC — so the name is kept whether or not the machine reopening it
    can load the name; the axis asks that when it draws."""
    if choice in {"utc", "machine"}:
        return True
    if choice.startswith("place:"):
        rest = choice.removeprefix("place:")
        return bool(rest) and not any(character.isspace() for character in rest)
    if choice.startswith("zone:"):
        return bool(_ZONE_NAME.fullmatch(choice.removeprefix("zone:")))
    return False


def _clean_timeline(value: Any, *, surface: str) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    if surface != "timeline":
        categories = [
            category
            for category in _string_list(raw.get("categories"), limit=3, item_limit=40)
            if category in {"statement", "media", "case_activity"}
        ]
        return {
            "from": _short(raw.get("from"), 40) or None,
            "to": _short(raw.get("to"), 40) or None,
            "field": _short(raw.get("field"), 64) or None,
            "categories": categories or ["statement", "media"],
        }
    tracks_raw: list[Any] = (
        raw["tracks"] if isinstance(raw.get("tracks"), list) else []
    )
    if len(tracks_raw) > 20:
        raise CaseError("a timeline view holds at most 20 tracks")
    tracks = [_clean_track(track, index) for index, track in enumerate(tracks_raw)]
    ids = [track["id"] for track in tracks]
    if len(ids) != len(set(ids)):
        raise CaseError("timeline track ids must be unique")
    if surface == "timeline" and not tracks:
        tracks = [
            _clean_track({"id": "events", "label": "Events", "categories": ["statement"]}, 0),
            _clean_track({"id": "media", "label": "Media", "categories": ["media"]}, 1),
        ]
    entity = raw.get("entity") if isinstance(raw.get("entity"), dict) else None
    zone_choice = _short(raw.get("zone_choice"), 72)
    if not _valid_zone_choice(zone_choice):
        zone_choice = "utc"
    return {
        "from": _short(raw.get("from"), 40) or None,
        "to": _short(raw.get("to"), 40) or None,
        "field": _short(raw.get("field"), 64) or None,
        "timezone": _short(raw.get("timezone"), 80) or "UTC",
        "zone_choice": zone_choice,
        "view_mode": raw.get("view_mode") if raw.get("view_mode") in {"plot", "list"} else "plot",
        "group_by": (
            raw.get("group_by")
            if raw.get("group_by") in {"none", "subject", "type", "place", "source", "role"}
            else "none"
        ),
        "tracks": tracks,
        # Kept in the serialized view for compatibility. Tracks own category
        # selection, so there is no second visibility switch to reconcile.
        "visible_categories": list(
            dict.fromkeys(category for track in tracks for category in track["categories"])
        ),
        "entity": (
            {"id": _short(entity.get("id"), 64), "label": _short(entity.get("label"), 300)}
            if entity and _short(entity.get("id"), 64) else None
        ),
    }


def _preview_data(case: Case, rel: Any, budget: list[int]) -> str | None:
    if not isinstance(rel, str) or not rel:
        return None
    try:
        path = case.resolve_inside(rel)
        size = path.stat().st_size
    except (CaseError, OSError):
        return None
    if size > MAX_ONE_PREVIEW_BYTES:
        raise CaseError("one captured preview is too large; use a smaller thumbnail")
    if budget[0] + size > MAX_SNAPSHOT_PREVIEW_BYTES:
        raise CaseError("snapshot previews are too large; narrow the view")
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    budget[0] += len(raw)
    suffix = path.suffix.casefold()
    mime = {
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(suffix, "image/jpeg")
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def _capture_previews(case: Case, captured: list[dict[str, Any]]) -> None:
    """Embed bounded gallery thumbnails so a frozen row keeps its visual identity."""
    budget = [0]
    media = case.media_thumbs([entity["id"] for entity in captured])
    for entity in captured:
        previews: list[dict[str, Any]] = []
        for image in case.entity_images(entity["id"]):
            data = _preview_data(case, image.get("thumbnail") or image.get("path"), budget)
            if data:
                previews.append({
                    "id": _short(image.get("id"), 64),
                    "title": _short(image.get("title"), 300) or "Photo",
                    "primary": bool(image.get("primary")),
                    "data": data,
                })
        own = _preview_data(case, media.get(entity["id"]), budget)
        if own and not previews:
            previews.append({"id": "preview", "title": "Preview", "primary": True, "data": own})
        if previews:
            entity["snapshot_images"] = previews
            primary = next((image for image in previews if image["primary"]), previews[0])
            entity["thumb"] = primary["data"]


def _capture(case: Case, spec: dict[str, Any]) -> dict[str, Any]:
    ids = spec.pop("capture_ids", None)
    if ids is not None:
        if not isinstance(ids, list) or any(not isinstance(one, str) for one in ids):
            raise CaseError("snapshot capture ids are invalid")
        wanted = list(dict.fromkeys(ids))
        if len(wanted) > MAX_SNAPSHOT_ENTITIES:
            raise CaseError(
                f"a snapshot view holds at most {MAX_SNAPSHOT_ENTITIES} entities; narrow the view"
            )
        entities = case.entities_by_ids(wanted)
    else:
        terms = _query_terms(spec)
        saved_period = spec.get("timeline")
        temporal: dict[str, Any] = saved_period if isinstance(saved_period, dict) else {}
        types = [part for part in terms.get("type", "").split(",") if part]
        filed_by = [part for part in terms.get("by", "").split(",") if part]
        page = case.page_entities(
            limit=MAX_SNAPSHOT_ENTITIES + 1,
            types=types or None,
            status=(
                cast(EntityStatus, terms["status"])
                if terms.get("status") in {"confirmed", "suggested"}
                else None
            ),
            query=terms.get("q"),
            folder=terms.get("folder"),
            unfiled=terms.get("unfiled") == "true",
            recursive=terms.get("recursive") == "true",
            attr=terms.get("attr"),
            attr_value=terms.get("value"),
            linked=terms.get("linked"),
            unlinked=terms.get("unlinked") == "true",
            since=terms.get("since"),
            until=terms.get("until"),
            filed_by=filed_by or None,
            temporal_since=_bound(temporal.get("from"), upper=False),
            temporal_until=_bound(temporal.get("to"), upper=True),
            temporal_categories=temporal.get("categories"),
        )
        entities = list(page["items"])
        if page["total"] > MAX_SNAPSHOT_ENTITIES:
            raise CaseError(
                f"a snapshot view holds at most {MAX_SNAPSHOT_ENTITIES} entities; narrow the question"
            )
    _capture_previews(case, entities)
    entity_ids = [entity["id"] for entity in entities]
    links = case.links_among(entity_ids) if entity_ids else []
    if len(links) > MAX_SNAPSHOT_LINKS:
        raise CaseError(
            f"a snapshot view holds at most {MAX_SNAPSHOT_LINKS} relations; narrow the question"
        )
    return {"captured_at": _now(), "entities": entities, "links": links}


def _clean_preview(value: Any, budget: list[int]) -> str:
    text = str(value or "")
    allowed = (
        "data:image/jpeg;base64,",
        "data:image/png;base64,",
        "data:image/webp;base64,",
        "data:image/gif;base64,",
    )
    prefix = next((entry for entry in allowed if text.startswith(entry)), None)
    if prefix is None:
        raise CaseError("snapshot preview is invalid")
    try:
        raw = base64.b64decode(text[len(prefix):], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise CaseError("snapshot preview is invalid") from exc
    if len(raw) > MAX_ONE_PREVIEW_BYTES:
        raise CaseError("snapshot preview is too large")
    budget[0] += len(raw)
    if budget[0] > MAX_SNAPSHOT_PREVIEW_BYTES:
        raise CaseError("snapshot previews are too large")
    return text


def _clean_snapshot(value: Any) -> dict[str, Any]:
    """Validate a snapshot copied inside its case."""
    if not isinstance(value, dict):
        raise CaseError("snapshot data is missing")
    entities = value.get("entities", [])
    links = value.get("links", [])
    timeline_items = value.get("timeline_items", [])
    if (
        not isinstance(entities, list)
        or not isinstance(links, list)
        or not isinstance(timeline_items, list)
    ):
        raise CaseError("snapshot data is invalid")
    if (
        len(entities) > MAX_SNAPSHOT_ENTITIES
        or len(links) > MAX_SNAPSHOT_LINKS
        or len(timeline_items) > MAX_SNAPSHOT_TIMELINE_ITEMS
    ):
        raise CaseError("snapshot data is too large")
    clean_entities: list[dict[str, Any]] = []
    ids: set[str] = set()
    preview_budget = [0]
    for entity in entities:
        if not isinstance(entity, dict):
            raise CaseError("snapshot entity is invalid")
        entity_id = _short(entity.get("id"), 64)
        type_ = _short(entity.get("type"), 40)
        label = _short(entity.get("label"), 300)
        if not entity_id or not type_ or not label or entity_id in ids:
            raise CaseError("snapshot entity is invalid")
        ids.add(entity_id)
        raw_images = entity.get("snapshot_images") or []
        if not isinstance(raw_images, list):
            raise CaseError("snapshot previews are invalid")
        images = []
        for image in raw_images:
            if not isinstance(image, dict):
                raise CaseError("snapshot preview is invalid")
            images.append({
                "id": _short(image.get("id"), 64),
                "title": _short(image.get("title"), 300) or "Photo",
                "primary": bool(image.get("primary")),
                "data": _clean_preview(image.get("data"), preview_budget),
            })
        clean_entity: dict[str, Any] = {
            "id": entity_id,
            "type": type_,
            "label": label,
            "attrs": entity.get("attrs") if isinstance(entity.get("attrs"), dict) else {},
            "provenance": entity.get("provenance")
            if isinstance(entity.get("provenance"), dict) else {},
        }
        if images:
            clean_entity["snapshot_images"] = images
            clean_entity["thumb"] = next(
                (image["data"] for image in images if image["primary"]), images[0]["data"]
            )
        clean_entities.append(clean_entity)
    clean_links: list[dict[str, Any]] = []
    link_ids: set[str] = set()
    for link in links:
        if not isinstance(link, dict):
            raise CaseError("snapshot relation is invalid")
        link_id = _short(link.get("id"), 64)
        from_id = _short(link.get("from"), 64)
        to_id = _short(link.get("to"), 64)
        type_ = _short(link.get("type"), 40)
        if (
            not link_id or link_id in link_ids or from_id not in ids or to_id not in ids
            or not type_
        ):
            raise CaseError("snapshot relation is invalid")
        link_ids.add(link_id)
        clean_links.append({
            "id": link_id,
            "from": from_id,
            "to": to_id,
            "type": type_,
            "provenance": link.get("provenance")
            if isinstance(link.get("provenance"), dict) else {},
            **({"confidence": link["confidence"]} if "confidence" in link else {}),
            **({"nature": link["nature"]} if "nature" in link else {}),
        })
    clean_timeline: list[dict[str, Any]] = []
    temporal_ids: set[str] = set()

    def references(item: dict[str, Any], key: str) -> list[dict[str, str]]:
        raw = item.get(key)
        if not isinstance(raw, list):
            return []
        clean = []
        for entry in raw[:100]:
            if not isinstance(entry, dict):
                continue
            entity_id = _short(entry.get("id"), 64)
            if entity_id:
                clean.append({
                    "id": entity_id,
                    "label": _short(entry.get("label"), 300) or entity_id,
                    "type": _short(entry.get("type"), 40),
                })
        return clean

    for item in timeline_items:
        if not isinstance(item, dict):
            raise CaseError("snapshot timeline entry is invalid")
        temporal_id = _short(item.get("id"), 160)
        owner_id = _short(item.get("owner_id"), 64)
        category = _short(item.get("category"), 40)
        label = _short(item.get("label"), 300)
        if (
            not temporal_id or temporal_id in temporal_ids or not owner_id
            or category not in {"statement", "media", "case_activity"} or not label
        ):
            raise CaseError("snapshot timeline entry is invalid")
        temporal_ids.add(temporal_id)
        clean_timeline.append({
            "id": temporal_id,
            "owner_id": owner_id,
            "authority": _short(item.get("authority"), 40),
            "category": category,
            "kind": _short(item.get("kind"), 40),
            "label": label,
            "raw": _short(item.get("raw"), 100) or None,
            "earliest": _short(item.get("earliest"), 40) or None,
            "latest": _short(item.get("latest"), 40) or None,
            "precision": _short(item.get("precision"), 24) or None,
            "shape": _short(item.get("shape"), 24) or None,
            "time_role": _short(item.get("time_role"), 24) or None,
            "uncertain": bool(item.get("uncertain")),
            "approximate": bool(item.get("approximate")),
            "zone": _short(item.get("zone"), 24) or None,
            "sortable": bool(item.get("sortable")),
            "status": _short(item.get("status"), 24) or None,
            "confidence": _short(item.get("confidence"), 24) or None,
            "parse_error": _short(item.get("parse_error"), 500) or None,
            "owner_type": _short(item.get("owner_type"), 40),
            "subjects": _string_list(item.get("subjects"), item_limit=64),
            "places": _string_list(item.get("places"), item_limit=64),
            "sources": _string_list(item.get("sources"), item_limit=64),
            "subject_entities": references(item, "subject_entities"),
            "place_entities": references(item, "place_entities"),
            "source_entities": references(item, "source_entities"),
        })
    result: dict[str, Any] = {
        "captured_at": _short(value.get("captured_at"), 40) or _now(),
        "entities": clean_entities,
        "links": clean_links,
    }
    if "timeline_items" in value or "timeline_tracks" in value:
        result["timeline_items"] = clean_timeline
        raw_tracks = value.get("timeline_tracks")
        if not isinstance(raw_tracks, dict):
            raise CaseError("snapshot timeline tracks are invalid")
        result["timeline_tracks"] = {
            _short(track_id, 64): [
                item_id for item_id in _string_list(item_ids, limit=MAX_SNAPSHOT_TIMELINE_ITEMS)
                if item_id in temporal_ids
            ]
            for track_id, item_ids in list(raw_tracks.items())[:20]
            if _short(track_id, 64)
        }
    return result


def _capture_timeline(case: Case, spec: dict[str, Any]) -> dict[str, Any]:
    """Freeze the exact temporal rows the Timeline presentation currently reads."""
    timeline = spec["timeline"]
    since = _bound(timeline.get("from"), upper=False)
    until = _bound(timeline.get("to"), upper=True)
    captured: dict[str, dict[str, Any]] = {}
    track_items: dict[str, list[str]] = {}
    for track in timeline["tracks"]:
        categories = track["categories"]
        cursor: str | None = None
        track_items[track["id"]] = []
        if not categories:
            continue
        while True:
            page = case.timeline_page(
                since=since,
                until=until,
                categories=categories,
                entity_id=(timeline.get("entity") or {}).get("id"),
                include_undated=True,
                limit=200,
                cursor=cursor,
                track={**track["query"], "hidden": track["hidden"]},
            )
            for item in page["items"]:
                captured[item["id"]] = item
                track_items[track["id"]].append(item["id"])
            if len(captured) > MAX_SNAPSHOT_TIMELINE_ITEMS:
                raise CaseError(
                    f"a timeline snapshot holds at most {MAX_SNAPSHOT_TIMELINE_ITEMS} entries;"
                    " narrow the view"
                )
            cursor = page["next_cursor"]
            if cursor is None:
                break
    return {
        "captured_at": _now(),
        "entities": [],
        "links": [],
        "timeline_items": list(captured.values()),
        "timeline_tracks": track_items,
    }


def prepare(
    case: Case,
    raw: dict[str, Any],
    *,
    mode: str,
    surface: str,
    snapshot_copy: bool = False,
) -> dict[str, Any]:
    """Validate a recipe and materialise its snapshot when requested."""
    if not isinstance(raw, dict):
        raise CaseError("analysis view spec must be an object")
    # JSON round-trip strips Pydantic or reactive wrappers and proves the value is
    # serialisable before it reaches SQLite.
    try:
        spec = json.loads(json.dumps(raw, ensure_ascii=False))
    except (TypeError, ValueError) as exc:
        raise CaseError("analysis view spec is not valid JSON") from exc
    spec["version"] = VERSION
    spec["surface"] = surface
    query = spec.get("query") if isinstance(spec.get("query"), dict) else {}
    query["terms"] = _query_terms(spec)
    spec["query"] = query
    spec["timeline"] = _clean_timeline(spec.get("timeline"), surface=surface)
    if mode == "snapshot":
        if "snapshot" in spec:
            if not snapshot_copy:
                raise CaseError("snapshot data can only be duplicated inside its case")
            spec["snapshot"] = _clean_snapshot(spec["snapshot"])
        elif surface == "timeline":
            spec["snapshot"] = _capture_timeline(case, spec)
        else:
            spec["snapshot"] = _capture(case, spec)
    else:
        spec.pop("snapshot", None)
        spec.pop("capture_ids", None)
        spec.pop("capture_timeline_ids", None)
    size = len(json.dumps(spec, ensure_ascii=False).encode("utf-8"))
    if size > MAX_SPEC_BYTES:
        raise CaseError("analysis view is too large")
    return spec


def snapshot_page(view: dict[str, Any], *, limit: int, cursor: str | None, order: str) -> dict[str, Any]:
    """A bounded Board page over immutable captured rows."""
    snapshot = view.get("spec", {}).get("snapshot") or {}
    rows = list(snapshot.get("entities") or [])
    if order in {"label", "-label"}:
        rows.sort(key=lambda row: str(row.get("label") or "").casefold(), reverse=order.startswith("-"))
    elif order in {"created", "-created"}:
        rows.sort(
            key=lambda row: str(row.get("provenance", {}).get("at") or ""),
            reverse=order.startswith("-"),
        )
    elif order:
        raise CaseError(f"'{order}' is not an ordering")
    try:
        start = int(cursor or "0")
    except ValueError as exc:
        raise CaseError(f"invalid snapshot cursor '{cursor}'") from exc
    if start < 0:
        raise CaseError(f"invalid snapshot cursor '{cursor}'")
    page = rows[start : start + limit]
    next_cursor = str(start + limit) if start + limit < len(rows) else None
    return {"items": page, "next_cursor": next_cursor, "total": len(rows)}
