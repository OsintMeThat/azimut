"""The links the case proposes by itself (`engine/proposals.py`): read them, ask for a
pass, drop one, and what a geolocation shares with the rest of the case.

Confirming one is the ordinary link patch (`api/cases/links.py`), so a proposal
confirmed here and one confirmed in the graph are the same act.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from ..engine import links as link_engine
from ..engine import proposals as proposal_engine
from ..workspace import CaseError
from .cases.common import delete_entity_deep, get_case

router = APIRouter(prefix="/api/cases", tags=["proposals"])

#: How many waiting proposals one read lists. The count is always whole; past this the
#: list is a sample, and confirming the first page brings up the next.
MAX_LISTED = 200


def _waiting(case: Any) -> dict[str, Any]:
    """The proposals still waiting, with both ends named so a row reads as a sentence."""
    suggestions = case.suggestions(proposal_engine.BY, limit=MAX_LISTED)
    listed = suggestions["items"]
    ends = {
        entity["id"]: entity
        for entity in case.entities_by_ids(
            sorted({link["from"] for link in listed} | {link["to"] for link in listed})
        )
    }
    items: list[dict[str, Any]] = []
    for link in listed:
        start, end = ends.get(link["from"]), ends.get(link["to"])
        if start is None or end is None:
            continue
        item: dict[str, Any] = {
            "id": link["id"],
            "type": link["type"],
            "from": {"id": start["id"], "label": start["label"], "type": start["type"]},
            "to": {"id": end["id"], "label": end["label"], "type": end["type"]},
        }
        if link["type"] == link_engine.SAME_SITE_AS:
            a, b = proposal_engine.point_of(start), proposal_engine.point_of(end)
            if a is not None and b is not None:
                item["metres"] = round(proposal_engine.metres(a, b))
        items.append(item)
    return {
        "pending": proposal_engine.counted(suggestions),
        "items": items,
        "listed": len(items),
        "through": (case.link_pass() or {}).get("at"),
        "radius": proposal_engine.SITE_RADIUS_M,
    }


@router.get("/{case_id}/proposals")
def list_proposals(case_id: str) -> dict[str, Any]:
    """What is waiting, and when the case was last read for it."""
    return _waiting(get_case(case_id))


@router.post("/{case_id}/proposals")
def run_proposals(case_id: str) -> dict[str, Any]:
    """Read what was filed since the last pass now, rather than after the next import.

    Pressed by the analyst, never run on open: a pass writes, and looking at a case
    must not change it.
    """
    case = get_case(case_id)
    filed = proposal_engine.propose(case)
    return {"filed": filed, **_waiting(case)}


@router.delete("/{case_id}/proposals/{link_id}")
def drop_proposal(case_id: str, link_id: str) -> dict[str, Any]:
    """Drop one proposal. An account the pass filed for it goes too when nothing else
    holds it, since an account nobody posted anything as was only ever the proposal."""
    case = get_case(case_id)
    link = case.get_link(link_id)
    if link is None:
        raise HTTPException(status_code=404, detail=f"link '{link_id}' not found")
    if (link.get("provenance") or {}).get("by") != proposal_engine.BY:
        raise HTTPException(status_code=400, detail="this link was not proposed by the case")
    try:
        link_engine.remove_relation(case, link_id)
        dropped: list[str] = []
        for end_id in (link["from"], link["to"]):
            end = case.get_entity(end_id)
            provenance = (end or {}).get("provenance") or {}
            if (
                end is not None
                and end["type"] == "account"
                and provenance.get("by") == proposal_engine.BY
                and provenance.get("status") == "suggested"
                and not case.links_of(end_id)
            ):
                delete_entity_deep(case, end_id)
                dropped.append(end_id)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "deleted", "dropped": dropped, **_waiting(case)}


@router.get("/{case_id}/entities/{entity_id}/kin")
def entity_kin(case_id: str, entity_id: str) -> dict[str, Any]:
    """Other geolocations on the same site, and the accounts behind its material."""
    case = get_case(case_id)
    try:
        return proposal_engine.kin(case, entity_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"entity '{entity_id}' not found") from exc
