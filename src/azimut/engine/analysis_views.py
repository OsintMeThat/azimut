"""Saved Board and Graph readings.

A live view is a recipe: the Search+ question is asked again whenever it opens. A
snapshot is evidence of a reading at one moment, so it stores copies of the matching
entities and the links among them. Both live in the case database and therefore move
with a bundle without becoming semantic graph entities.
"""

from __future__ import annotations

import base64
import binascii
import json
from datetime import datetime, timezone
from typing import Any, cast

from ..repository import EntityStatus
from ..workspace import Case, CaseError

VERSION = 1
MAX_SPEC_BYTES = 8 * 1024 * 1024
MAX_SNAPSHOT_ENTITIES = 2000
MAX_SNAPSHOT_LINKS = 10000
MAX_SNAPSHOT_PREVIEW_BYTES = 4 * 1024 * 1024
MAX_ONE_PREVIEW_BYTES = 512 * 1024


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


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
    entities = value.get("entities")
    links = value.get("links")
    if not isinstance(entities, list) or not isinstance(links, list):
        raise CaseError("snapshot data is invalid")
    if len(entities) > MAX_SNAPSHOT_ENTITIES or len(links) > MAX_SNAPSHOT_LINKS:
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
    return {
        "captured_at": _short(value.get("captured_at"), 40) or _now(),
        "entities": clean_entities,
        "links": clean_links,
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
    timeline = spec.get("timeline") if isinstance(spec.get("timeline"), dict) else {}
    spec["timeline"] = {
        "from": _short(timeline.get("from"), 40) or None,
        "to": _short(timeline.get("to"), 40) or None,
        "field": _short(timeline.get("field"), 64) or None,
    }
    if mode == "snapshot":
        if "snapshot" in spec:
            if not snapshot_copy:
                raise CaseError("snapshot data can only be duplicated inside its case")
            spec["snapshot"] = _clean_snapshot(spec["snapshot"])
        else:
            spec["snapshot"] = _capture(case, spec)
    else:
        spec.pop("snapshot", None)
        spec.pop("capture_ids", None)
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
