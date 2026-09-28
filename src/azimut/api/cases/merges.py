"""Merging two subjects, and undoing it (`engine/merge.py` holds the rules).

A preview first, written nowhere, then the merge, then an undo for as long as the
record exists. The redirects the merges leave are read here too, so a note or a
sheet naming an absorbed id can show the entity that took it in.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...engine import merge as merge_engine
from ...workspace import CaseError
from .common import get_case
from .. import events

router = APIRouter(prefix="/api/cases", tags=["cases"])


class MergeIn(BaseModel):
    other: str = Field(min_length=1, max_length=64)


class RedirectIds(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=2000)


@router.post("/{case_id}/entities/redirects")
def entity_redirects(case_id: str, body: RedirectIds) -> dict[str, Any]:
    """Resolve only the ids a document actually references."""
    return {"redirects": get_case(case_id).entity_redirects(body.ids)}


@router.get("/{case_id}/entities/{survivor_id}/merge-preview")
def merge_preview(case_id: str, survivor_id: str, other: str) -> dict[str, Any]:
    """What folding `other` into this entity would do. Nothing is written."""
    try:
        return merge_engine.preview(get_case(case_id), survivor_id, other)
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{case_id}/entities/{survivor_id}/merge")
def merge_entities(case_id: str, survivor_id: str, body: MergeIn) -> dict[str, Any]:
    """Fold `other` into this entity, in one transaction."""
    try:
        result = merge_engine.merge(get_case(case_id), survivor_id, body.other)
        events.publish({"type": "saved", "case_id": case_id})
        return result
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{case_id}/entities/{survivor_id}/merges")
def entity_merges(case_id: str, survivor_id: str) -> dict[str, Any]:
    """The merges this entity took in that can still be undone, newest first."""
    return {"merges": get_case(case_id).merges_into(survivor_id)}


@router.post("/{case_id}/merges/{merge_id}/undo")
def undo_merge(case_id: str, merge_id: str) -> dict[str, Any]:
    """Take one merge back out, listing whatever could not come back."""
    try:
        result = merge_engine.undo(get_case(case_id), merge_id)
        events.publish({"type": "saved", "case_id": case_id})
        return result
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
