"""When things happened: the timeline page, its map, and the Claims behind it.

A Claim is the entity that states a time, so creating one is an entity write plus
its connectors. The projection those rows are read from is derived and rebuildable
(`store/temporal.py`); Claims and media sidecars stay authoritative.
"""

from __future__ import annotations

import json
import math
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, StrictInt

from ...engine import links as link_engine
from ...engine import timeline as timeline_engine
from ...repository import EntityStatus
from ...workspace import Case, CaseError
from .common import _check_attrs, _timeline_bound, delete_entity_deep, get_case

router = APIRouter(prefix="/api/cases", tags=["cases"])


class TemporalClaimIn(BaseModel):
    statement: str = Field(min_length=1, max_length=300)
    when: str | None = None
    time_role: Literal["occurred", "observed", "valid"] | None = None
    confidence: Literal["certain", "probable", "possible", "refuted"] | None = None
    method: str | None = None
    verbatim: str | None = None
    count: StrictInt | None = None
    condition: Literal["intact", "damaged", "destroyed", "abandoned"] | None = None
    about: list[str] = Field(default_factory=list, max_length=200)
    at: list[str] = Field(default_factory=list, max_length=50)
    cites: list[str] = Field(default_factory=list, max_length=200)

class TemporalClaimPatch(BaseModel):
    statement: str | None = Field(default=None, min_length=1, max_length=300)
    when: str | None = None
    time_role: Literal["occurred", "observed", "valid"] | None = None
    confidence: Literal["certain", "probable", "possible", "refuted"] | None = None
    method: str | None = None
    verbatim: str | None = None
    count: StrictInt | None = None
    condition: Literal["intact", "damaged", "destroyed", "abandoned"] | None = None
    about: list[str] | None = Field(default=None, max_length=200)
    at: list[str] | None = Field(default=None, max_length=50)
    cites: list[str] | None = Field(default=None, max_length=200)
    status: EntityStatus | None = None

@router.get("/{case_id}/timeline")
def timeline(
    case_id: str,
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    category: list[str] | None = Query(default=None),
    entity: str | None = None,
    include_undated: bool = True,
    limit: int = Query(default=100, ge=1, le=200),
    cursor: str | None = None,
    bucket: Literal["year", "month", "day", "hour"] | None = None,
    track: str | None = None,
    spread: bool = False,
) -> dict[str, Any]:
    """One bounded temporal page, independent of the projection's SQL shape.

    ``spread`` is for a caller drawing the page on an axis: it samples the window
    rather than serving its front, so a lopsided case fills the axis it spans.
    """
    since = _timeline_bound(from_, upper=False)
    until = _timeline_bound(to, upper=True)
    if since is not None and until is not None and since >= until:
        raise HTTPException(status_code=400, detail="the timeline window ends before it starts")
    if track and len(track.encode("utf-8")) > 64 * 1024:
        raise HTTPException(status_code=400, detail="timeline track query is too large")
    try:
        track_query = json.loads(track) if track else None
        if track_query is not None and not isinstance(track_query, dict):
            raise CaseError("a timeline track query must be an object")
        page = get_case(case_id).timeline_page(
            since=since,
            until=until,
            categories=category,
            entity_id=entity,
            include_undated=include_undated,
            limit=limit,
            cursor=cursor,
            bucket=bucket,
            track=track_query,
            spread=spread,
        )
    except (CaseError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**page, "window": {"from": since, "to": until}}

# Every way the case puts something on the map. A Claim says where it happened with
# `at`, and that was the only one this layer knew — so a window full of photographs
# recorded somewhere, captures showing somewhere, or a structure standing somewhere
# answered with an empty map and the words "nothing carries a place". `mentions` is
# not here: a note referring to a place is not a thing that was there.
_MAP_PLACE_LINKS = (
    link_engine.AT,
    link_engine.LOCATED_AT,
    link_engine.DEPICTS,
    link_engine.SITED_AT,
)

@router.get("/{case_id}/timeline/map")
def timeline_map(
    case_id: str,
    from_: str = Query(alias="from"),
    to: str = Query(),
    category: list[str] | None = Query(default=None),
) -> dict[str, Any]:
    """Whatever the window holds that the case has put somewhere, for the Map layer."""
    since = _timeline_bound(from_, upper=False)
    until = _timeline_bound(to, upper=True)
    if since is None or until is None or since >= until:
        raise HTTPException(status_code=400, detail="the timeline window ends before it starts")
    categories = (
        list(dict.fromkeys(part.strip() for part in ",".join(category).split(",") if part.strip()))
        if category
        else list(timeline_engine.DEFAULT_CATEGORIES)
    )
    invalid = sorted(set(categories) - set(timeline_engine.ALL_CATEGORIES))
    if invalid:
        raise HTTPException(status_code=400, detail=f"unknown timeline category '{invalid[0]}'")
    if not categories:
        raise HTTPException(status_code=400, detail="a temporal filter needs a category")

    case = get_case(case_id)
    rows: list[dict[str, Any]] = []
    cursor: str | None = None
    read = 0
    total = 0
    ceiling = 5000
    while read < ceiling:
        page = case.timeline_page(
            since=since,
            until=until,
            categories=categories,
            include_undated=False,
            limit=min(200, ceiling - read),
            cursor=cursor,
        )
        if read == 0:
            total = int(page["total"])
        batch = list(page["items"])
        rows.extend(batch)
        read += len(batch)
        cursor = page["next_cursor"]
        if cursor is None or not batch:
            break

    # Resolved from the edges themselves rather than from the row's own `at` list,
    # which only a Claim ever fills.
    owners = {str(item["owner_id"]) for item in rows}
    held: dict[str, list[str]] = {}
    for edge in case.links_touching(
        sorted(owners), types=list(_MAP_PLACE_LINKS), end_types=["place"]
    ):
        if edge["from"] in owners and edge["to"] != edge["from"]:
            held.setdefault(edge["from"], []).append(edge["to"])

    place_ids = list(dict.fromkeys(
        place_id for places in held.values() for place_id in places
    ))
    places = {entity["id"]: entity for entity in case.entities_by_ids(place_ids)}

    # What a mark on the map has to know to hand its row back to the tool that owns
    # it, and to show a photograph as a photograph rather than as a line of text.
    placed_owners = sorted(held)
    owned = {entity["id"]: entity for entity in case.entities_by_ids(placed_owners)}
    thumbs = dict(case.media_thumbs(placed_owners))
    thumbs.update(case.entity_image_thumbs(placed_owners))
    for owner_id, entity in owned.items():
        # A capture or a proof records its own preview rather than owning an indexed
        # media row, and the graph reads them the same way.
        recorded = (entity.get("attrs") or {}).get("thumb")
        if recorded and owner_id not in thumbs:
            thumbs[owner_id] = recorded

    mapped: list[dict[str, Any]] = []
    mark_count = 0
    for item in rows:
        owner_id = str(item["owner_id"])
        owner = owned.get(owner_id)
        positioned = []
        for place_id in dict.fromkeys(held.get(owner_id, [])):
            place = places.get(place_id)
            attrs = place.get("attrs") if place else None
            if place is None or not isinstance(attrs, dict):
                continue
            try:
                lat = float(attrs["lat"])
                lon = float(attrs["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            if not math.isfinite(lat) or not math.isfinite(lon):
                continue
            positioned.append({
                "id": place_id,
                "label": place.get("label", "Place"),
                "lat": lat,
                "lon": lon,
                "radius_m": attrs.get("radius_m"),
                "footprint": attrs.get("footprint"),
            })
        if positioned:
            mapped.append({
                **item,
                "place_entities": positioned,
                "owner": {
                    "id": owner_id,
                    "type": owner.get("type", "") if owner else item.get("owner_type", ""),
                    "label": owner.get("label", "") if owner else item.get("label", ""),
                    "attrs": owner.get("attrs") or {} if owner else {},
                    "thumb": thumbs.get(owner_id),
                },
            })
            mark_count += len(positioned)

    return {
        "items": mapped,
        "matched": total,
        "mapped": len(mapped),
        "marks": mark_count,
        "truncated": read < total,
        "window": {"from": since, "to": until},
    }

_TEMPORAL_CLAIM_ATTRS = (
    "when", "time_role", "confidence", "method", "verbatim", "count", "condition"
)
_TEMPORAL_CONNECTORS = ("about", "at", "cites")

def _temporal_item(case: Case, claim_id: str) -> dict[str, Any]:
    """The row this Claim owns, wherever the entity scope puts it.

    That scope also answers with rows owned by whatever cites the Claim, and they
    are ordered by date rather than by ownership — so a Claim many others rest on
    can sit past the first page, and reading only that page would fail a write
    that has already been committed.
    """
    cursor: str | None = None
    while True:
        page = case.timeline_page(
            categories=[timeline_engine.STATEMENT],
            entity_id=claim_id,
            include_undated=True,
            limit=200,
            cursor=cursor,
        )
        for item in page["items"]:
            if item["owner_id"] == claim_id:
                return item
        cursor = page["next_cursor"]
        if cursor is None:
            raise HTTPException(
                status_code=500,
                detail=f"claim '{claim_id}' was saved without a temporal row",
            )

def _check_claim_connectors(
    case: Case,
    source: dict[str, Any],
    connectors: dict[str, list[str]],
) -> None:
    for type_, targets in connectors.items():
        for target in dict.fromkeys(targets):
            target_entity = case.get_entity(target)
            if type_ == "about" and target_entity is not None and target_entity["type"] == "claim":
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "A Claim has one date or range. Edit its date, or create a"
                        " separate Claim."
                    ),
                )
            try:
                link_engine.check_relation_target(case, source, target, type_)
            except CaseError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.post("/{case_id}/timeline/claims")
def create_temporal_claim(case_id: str, body: TemporalClaimIn) -> dict[str, Any]:
    """Create the statement, date and all of its connectors in one transaction."""
    case = get_case(case_id)
    statement = body.statement.strip()
    if not statement:
        raise HTTPException(status_code=400, detail="a Claim statement cannot be empty")
    attrs = {
        key: getattr(body, key)
        for key in _TEMPORAL_CLAIM_ATTRS
        if getattr(body, key) is not None
    }
    _check_attrs("claim", attrs)
    connectors = {key: getattr(body, key) for key in _TEMPORAL_CONNECTORS}
    _check_claim_connectors(case, {"type": "claim"}, connectors)
    try:
        saved = case.save_temporal_claim(
            entity_id=None,
            label=statement,
            attrs=attrs,
            connectors=connectors,
            by="user",
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**saved, "temporal": _temporal_item(case, saved["entity"]["id"])}

@router.patch("/{case_id}/timeline/claims/{claim_id}")
def update_temporal_claim(
    case_id: str, claim_id: str, body: TemporalClaimPatch
) -> dict[str, Any]:
    """Replace a Claim's temporal fields and selected connector sets atomically."""
    if not body.model_fields_set:
        raise HTTPException(status_code=400, detail="nothing to update")
    case = get_case(case_id)
    current = case.get_entity(claim_id)
    if current is None:
        raise HTTPException(status_code=404, detail=f"entity '{claim_id}' not found")
    if current["type"] != "claim":
        raise HTTPException(status_code=400, detail=f"entity '{claim_id}' is not a Claim")
    if "statement" in body.model_fields_set and body.statement is None:
        raise HTTPException(status_code=400, detail="a Claim statement cannot be empty")
    statement = (body.statement or current["label"]).strip()
    if not statement:
        raise HTTPException(status_code=400, detail="a Claim statement cannot be empty")

    attrs = dict(current.get("attrs") or {})
    for key in _TEMPORAL_CLAIM_ATTRS:
        if key in body.model_fields_set:
            attrs[key] = getattr(body, key)
    _check_attrs("claim", attrs, current=current.get("attrs") or {})
    connector_keys = set(_TEMPORAL_CONNECTORS) & body.model_fields_set
    connectors = (
        {key: list(getattr(body, key) or []) for key in connector_keys}
        if connector_keys
        else None
    )
    if connectors is not None:
        _check_claim_connectors(case, current, connectors)
    try:
        saved = case.save_temporal_claim(
            entity_id=claim_id,
            label=statement,
            attrs=attrs,
            connectors=connectors,
            by="user",
            status=body.status or current["provenance"]["status"],
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**saved, "temporal": _temporal_item(case, claim_id)}

@router.delete("/{case_id}/timeline/claims/{claim_id}")
def remove_temporal_claim(case_id: str, claim_id: str) -> dict[str, Any]:
    """Delete one Claim through the normal recoverable Trash workflow."""
    case = get_case(case_id)
    entity = case.get_entity(claim_id)
    if entity is None:
        raise HTTPException(status_code=404, detail=f"entity '{claim_id}' not found")
    if entity["type"] != "claim":
        raise HTTPException(status_code=400, detail=f"entity '{claim_id}' is not a Claim")
    try:
        return delete_entity_deep(case, claim_id)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
