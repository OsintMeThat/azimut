"""The bounded catalog: a page of entities, and the counts that describe them.

Every read here is bounded and filtered in SQL (docs/STORAGE_AND_PERFORMANCE.md).
The summary, the attribute facets and the tally are what let the Board offer a
filter built from what the case actually holds rather than from typed syntax.
"""

from __future__ import annotations

from typing import Any, cast

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...engine import analysis_views as analysis_view_engine
from ...engine import entities as entity_engine
from ...engine import tally as tally_engine
from ...repository import EntityStatus
from ...store.filters import lacking
from ...workspace import CaseError
from .common import _temporal_filter_args, get_case

router = APIRouter(prefix="/api/cases", tags=["cases"])


def _explain_catalog_matches(page: dict[str, Any], query: str | None) -> dict[str, Any]:
    if not query:
        return page
    for entity in page.get("items", []):
        if matches := entity_engine.search_matches(entity, query):
            entity["matches"] = matches
    return page

@router.get("/{case_id}/catalog/entities")
def catalog_entities(
    case_id: str,
    cursor: str | None = None,
    limit: int = 100,
    type: str | None = None,
    status: str | None = None,
    q: str | None = None,
    folder: str | None = None,
    unfiled: bool = False,
    recursive: bool = False,
    attr: str | None = None,
    value: str | None = None,
    linked: str | None = None,
    unlinked: bool = False,
    lacks: str | None = None,
    since: str | None = None,
    until: str | None = None,
    by: str | None = None,
    temporal_from: str | None = None,
    temporal_to: str | None = None,
    temporal_category: str | None = None,
    order: str = "",
    view: str | None = None,
    previews: bool = False,
    counts: str | None = None,
) -> dict[str, Any]:
    """A bounded page of the entity catalog (Step 5, "Bounded loading").

    Stable cursor order, server-side filters and a ``next_cursor`` that is null on the
    last page. ``limit`` is clamped so no request can ask for the whole graph at once.

    The filters: a comma-separated ``type`` set, ``status``, a label substring ``q``,
    folder (``unfiled=true`` or a ``folder`` path, optionally including descendants),
    one stored field holding one value (``attr`` with ``value``), having a neighbour of
    a type (``linked``) or none at all (``unlinked``), and how the row got here —
    ``since``/``until`` over the date it was filed, and a comma-separated ``by`` set of
    whatever filed it. Together they are what make the page an answer rather than a
    shorter list: *media, kind video, linked to a place* is "which videos have
    coordinates", and ``total`` is how many.

    ``order`` sorts the whole filtered set rather than the page — ``created`` and
    ``label``, each with a ``-`` prefix for the other direction. Empty is the insertion
    order that has always been the default.

    ``attr`` without ``value`` is not a term — it is the analyst having chosen which
    field they are about to ask about, and answering it as "holds nothing" would empty
    the table between two clicks of one act.

    ``previews`` also joins the picture a file, a capture, a proof or a collage already has, for
    a picker that has to tell twenty sources apart at a glance. Only what is cached
    or recorded: nothing is made, and the table, which draws its own, does not ask.

    ``counts=type`` adds ``by_type``, the matching count per type, so the Board can
    say how much of the answer each of its groups holds in the one request.
    """
    case = get_case(case_id)
    limit = max(1, min(limit, 500))
    if counts not in (None, "", "type"):
        raise HTTPException(status_code=400, detail=f"'{counts}' is not a count")
    by_type = counts == "type"
    types = [t.strip() for t in type.split(",") if t.strip()] if type else None
    if view:
        saved = case.get_analysis_view(view)
        if saved is None:
            raise HTTPException(status_code=404, detail=f"analysis view '{view}' not found")
        if saved["mode"] == "snapshot":
            try:
                return _explain_catalog_matches(
                    analysis_view_engine.snapshot_page(
                        saved, limit=limit, cursor=cursor, order=order,
                        types=types, count_by_type=by_type,
                    ),
                    q,
                )
            except CaseError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
    filed_by = [name.strip() for name in by.split(",") if name.strip()] if by else None
    temporal_since, temporal_until, temporal_categories = _temporal_filter_args(
        temporal_from, temporal_to, temporal_category
    )
    valid_status = (
        cast(EntityStatus, status) if status in ("confirmed", "suggested") else None
    )
    try:
        page = case.page_entities(
            limit=limit, cursor=cursor, types=types, status=valid_status,
            query=q, folder=folder, unfiled=unfiled, recursive=recursive,
            attr=attr, attr_value=value, linked=linked, unlinked=unlinked,
            lacks=lacking(lacks),
            since=since, until=until, filed_by=filed_by, order=order,
            temporal_since=temporal_since, temporal_until=temporal_until,
            temporal_categories=temporal_categories, count_by_type=by_type,
        )
        thumbs = case.entity_image_thumbs([entity["id"] for entity in page["items"]])
        if previews:
            files = [entity["id"] for entity in page["items"] if entity["type"] == "media"]
            thumbs = {**case.media_thumbs(files), **thumbs}
            for entity in page["items"]:
                recorded = (entity.get("attrs") or {}).get("thumb")
                if entity["type"] in ("capture", "proof", "collage") and isinstance(recorded, str):
                    thumbs.setdefault(entity["id"], recorded)
        for entity in page["items"]:
            if thumb := thumbs.get(entity["id"]):
                entity["thumb"] = thumb
        return _explain_catalog_matches(page, q)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

#: The most rows one events read covers: a Board page, with room for the pinned row.
MAX_EVENT_ROWS = 200


class EventRowsIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=MAX_EVENT_ROWS)


@router.post("/{case_id}/catalog/events")
def catalog_events(case_id: str, body: EventRowsIn) -> dict[str, Any]:
    """What the case's Claims say about these rows: how many name each one, when the
    dated ones fall, how many sources and places they reach, and a density over the
    case's own span of dated Claims (``engine`` side: ``event_summaries``).

    A POST because it carries a page of ids, and bounded to one page of them: the Board
    reads it once per page it shows, never once per row.
    """
    return get_case(case_id).event_summaries(body.ids)

@router.get("/{case_id}/catalog/summary")
def catalog_summary(case_id: str) -> dict[str, Any]:
    """Counts per type, status, folder and filer, plus how many the case connects to
    nothing, so the catalog shows badges and populates its filter menus without
    loading the graph."""
    return get_case(case_id).catalog_summary()

@router.get("/{case_id}/catalog/attributes")
def catalog_attributes(case_id: str, type: str | None = None) -> dict[str, Any]:
    """Which stored fields these entities hold, and which values, as a menu.

    What lets a field be filtered on without a query language: the field select and
    the value select are both populated from the case, so every term of a search is
    chosen rather than typed (SPEC anti-goals). It reaches fields the vocabulary does
    not declare, which is the point — `kind` is written by the importer, so a
    registry-driven menu would never have offered the one field an analyst most wants.

    Narrowed by the same comma-separated ``type`` set as the page it filters: the
    fields a media holds are not the fields a claim holds, and one menu of both is a
    menu of neither.
    """
    types = [t.strip() for t in type.split(",") if t.strip()] if type else None
    return {"attrs": get_case(case_id).attr_facets(types=types)}

@router.get("/{case_id}/catalog/tally")
def catalog_tally(
    case_id: str,
    type: str | None = None,
    status: str | None = None,
    q: str | None = None,
    folder: str | None = None,
    unfiled: bool = False,
    recursive: bool = False,
    attr: str | None = None,
    value: str | None = None,
    linked: str | None = None,
    unlinked: bool = False,
    lacks: str | None = None,
    since: str | None = None,
    until: str | None = None,
    by: str | None = None,
    temporal_from: str | None = None,
    temporal_to: str | None = None,
    temporal_category: str | None = None,
) -> dict[str, Any]:
    """What the statements in this narrowing add up to, per subject.

    The same terms as the catalog page it sits beside, spelled the same way, because
    it is the same question: the table lists the statements, this one adds them up
    (``engine/tally.py``). Every rule about what may enter a sum is there — a ruled-out
    statement never does, an absent count is not one, and nothing is totalled across
    subjects.
    """
    types = [t.strip() for t in type.split(",") if t.strip()] if type else None
    filed_by = [name.strip() for name in by.split(",") if name.strip()] if by else None
    temporal_since, temporal_until, temporal_categories = _temporal_filter_args(
        temporal_from, temporal_to, temporal_category
    )
    try:
        return tally_engine.tally(
            get_case(case_id), types=types, status=status, query=q,
            folder=folder, unfiled=unfiled, recursive=recursive,
            attr=attr, attr_value=value, linked=linked, unlinked=unlinked,
            lacks=lacking(lacks),
            since=since, until=until, filed_by=filed_by,
            temporal_since=temporal_since, temporal_until=temporal_until,
            temporal_categories=temporal_categories,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
