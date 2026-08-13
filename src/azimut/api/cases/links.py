"""Relations between entities: state one, restate it, drop it.

The vocabulary and every endpoint check live in `engine/links.py`; these routes are
the thin edge that turns a refusal there into a status code.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StrictInt

from ...engine import links as link_engine
from ...repository import EntityStatus
from ...workspace import CaseError
from .common import get_case

router = APIRouter(prefix="/api/cases", tags=["cases"])


class LinkIn(BaseModel):
    # `from`/`to` are the link's own field names, but `from` is a Python keyword;
    # the request spells them out rather than aliasing around it.
    from_id: str = Field(min_length=1, max_length=64)
    to_id: str = Field(min_length=1, max_length=64)
    type: str = Field(min_length=1, max_length=40)

class LinkPatch(BaseModel):
    status: EntityStatus | None = None
    type: str | None = Field(default=None, min_length=1, max_length=40)
    #: One closed ordinal, or `null` to return the edge to "not assessed". Sending it
    #: at all is what counts, so the route reads `model_fields_set` rather than the
    #: value: `null` clears a rating, where omitting the key leaves it alone.
    #:
    #: Strict, so JSON `true` is refused rather than coerced to `1`: a lax int would
    #: turn a nonsense body into the "possible" level without anyone noticing, and
    #: `2.5` into `2`.
    confidence: StrictInt | None = None
    #: What kind of tie the edge states, in the analyst's own words, or `null` to
    #: clear it. Read through `model_fields_set` like the rating above, for the same
    #: reason: `null` unsays it, omitting the key leaves it alone. Only a verb
    #: declaring a `qualifier` accepts one (`engine/links.set_qualifier`).
    nature: str | None = None

@router.post("/{case_id}/links")
def create_link(case_id: str, body: LinkIn) -> dict[str, Any]:
    """State one relation by hand. Confirmed, and only from the registry."""
    try:
        return link_engine.add_relation(
            get_case(case_id), body.from_id, body.to_id, body.type, by="user"
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.patch("/{case_id}/links/{link_id}")
def update_link(case_id: str, link_id: str, body: LinkPatch) -> dict[str, Any]:
    """Confirm a suggestion, correct which relation an edge states, rate it, or say
    what kind of tie it is.

    Restating the type goes through the vocabulary, so a 400 means the ontology
    has no such reading for those two entities; a missing link is a 404.

    Rating runs last on purpose: confirming a suggestion and rating it can arrive in
    one request, and a rating is refused on an unreviewed edge — so the confirm has
    to have landed before the rating is judged. The qualifier runs last for the
    mirror reason: a reword that drops it must not be undone by a value sent against
    the verb the edge no longer states.
    """
    rating = "confidence" in body.model_fields_set
    qualifying = "nature" in body.model_fields_set
    if body.status is None and body.type is None and not rating and not qualifying:
        raise HTTPException(status_code=400, detail="nothing to update")
    case = get_case(case_id)
    try:
        link = case.get_link(link_id)
        if link is None:
            raise HTTPException(status_code=404, detail=f"link '{link_id}' not found")
        if body.type is not None and body.type != link["type"]:
            link = link_engine.set_relation_type(case, link_id, body.type)
        if body.status == "confirmed":
            link = link_engine.confirm_relation(case, link_id)
        elif body.status is not None:
            link = case.update_link(link_id, {"status": body.status})
        if rating:
            link = link_engine.set_confidence(case, link_id, body.confidence)
        if qualifying:
            link = link_engine.set_qualifier(case, link_id, body.nature)
        return link
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.delete("/{case_id}/links/{link_id}")
def remove_link(case_id: str, link_id: str) -> dict[str, str]:
    """Take back one relation. Dismissing a proposal and retracting a confirmed
    statement are the same gesture; a derivation is neither, and is refused with a
    400 rather than dropped without its tombstone."""
    case = get_case(case_id)
    if case.get_link(link_id) is None:
        raise HTTPException(status_code=404, detail=f"link '{link_id}' not found")
    try:
        link_engine.remove_relation(case, link_id)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "deleted"}
