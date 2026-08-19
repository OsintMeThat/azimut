"""Entities: create, amend, look up, delete, and what each one is tied to.

The reads beside them answer questions a single entity raises — what depends on it,
what it was derived from, where it sits, what it counts.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...engine import entities as entity_engine
from ...engine import links as link_engine
from ...engine import satellite as satellite_engine
from ...engine import tally as tally_engine
from ...repository import EntityStatus
from ...workspace import CaseError
from .common import (
    _check_attrs,
    _summary,
    delete_entities_deep,
    delete_entity_deep,
    get_case,
)

router = APIRouter(prefix="/api/cases", tags=["cases"])


class EntityIn(BaseModel):
    type: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=300)
    attrs: dict[str, Any] = Field(default_factory=dict)
    status: EntityStatus = "confirmed"

class EntityPatch(BaseModel):
    type: str | None = None
    label: str | None = Field(default=None, min_length=1, max_length=300)
    attrs: dict[str, Any] | None = None
    status: EntityStatus | None = None

class EntityDeleteIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=200)

class EntityIdsIn(BaseModel):
    #: A sheet may point at one entity per cell, so the bound is the sidecar's, not a
    #: selection's.
    ids: list[str] = Field(min_length=1, max_length=2000)

@router.get("/{case_id}/entities/lookup")
def lookup_entity(case_id: str, attr: str, value: str) -> dict[str, Any]:
    """One entity by an ``attrs`` value (``path``, ``spec``, ``draft``), or null.

    The bounded replacement for a tool scanning the whole graph to answer "is the
    file/spec I am bound to still in the case?" after a delete elsewhere, or to
    resolve a file path back to its entity (Step 5).
    """
    entity = get_case(case_id).find_entity(attr=attr, value=value)
    return {"entity": entity}

@router.get("/{case_id}/entities/twin")
def entity_twin(
    case_id: str, type: str, label: str, ignore: str = ""
) -> dict[str, Any]:
    """The entity already holding this identifier's value, or null.

    Only the ``identifier`` family answers anything: there the value *is* the
    identity, so two records of it are two records of one thing (ONTOLOGY §2).
    Everywhere else two entities may share a label and the question is meaningless.

    **It warns, it never refuses.** Merging is not shipped (`same-as`, SPEC §10), and
    a create that failed would leave the analyst holding a value with nowhere to put
    it — so this reports and the surface offers the row it found. ``ignore`` is the
    entity being renamed, which is not its own twin.

    The comparison lives in ``engine/entities.identity_key`` and is served rather
    than reimplemented: the create form used to lowercase the raw label in the
    browser, which let `@handle` and `handle` sit side by side as two accounts.
    """
    key = entity_engine.identity_key(type, label)
    if not key:
        return {"entity": None}
    case = get_case(case_id)
    for entity_id, existing in case.labels_of_type(type):
        if entity_id != ignore and entity_engine.identity_key(type, existing) == key:
            return {"entity": case.get_entity(entity_id)}
    return {"entity": None}

@router.post("/{case_id}/entities")
def add_entity(case_id: str, body: EntityIn) -> dict[str, Any]:
    case = get_case(case_id)
    _check_attrs(body.type, body.attrs)
    if body.type == "note":
        attrs = body.attrs
        return case.create_note(
            body.label.strip(),
            str(attrs.get("folder", "")).strip(),
            str(attrs.get("content", "")),
        )
    return case.add_entity(body.type, body.label, body.attrs, by="user", status=body.status)

@router.patch("/{case_id}/entities/{entity_id}")
def update_entity(case_id: str, entity_id: str, body: EntityPatch) -> dict[str, Any]:
    case = get_case(case_id)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if body.attrs is not None:
        # Against the type it will have once patched, and the entity has to exist
        # before its fields can be judged.
        current = case.get_entity(entity_id)
        if current is None:
            raise HTTPException(status_code=404, detail=f"entity '{entity_id}' not found")
        _check_attrs(
            body.type or str(current["type"]),
            body.attrs,
            current=current.get("attrs") or {},
        )
    try:
        entity = case.update_entity(entity_id, patch)
        if body.status == "confirmed":
            link_engine.confirm_incident_relations(case, entity_id)
        return entity
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

@router.get("/{case_id}/entities/{entity_id}/dependents")
def entity_dependents(case_id: str, entity_id: str) -> dict[str, Any]:
    """What deleting this entity would take with it, and what it would scar.

    Feeds the confirm dialog so a delete states its consequences before it is
    irreversible (ONTOLOGY §3).
    """
    case = get_case(case_id)
    try:
        plan = link_engine.plan_delete(case, entity_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "cascade": [_summary(e) for e in plan["cascade"]],
        "tombstone": [_summary(e) for e in plan["tombstone"]],
    }

@router.get("/{case_id}/entities/{entity_id}/chain")
def entity_chain(case_id: str, entity_id: str) -> dict[str, Any]:
    """One entity plus its derivation chain and direct relations, read from its
    incident links only without shipping the whole graph."""
    case = get_case(case_id)
    chain = link_engine.chain_of(case, entity_id)
    if chain is None:
        raise HTTPException(status_code=404, detail=f"entity '{entity_id}' not found")
    return chain

@router.get("/{case_id}/entities/{entity_id}/placement")
def entity_placement(case_id: str, entity_id: str) -> dict[str, Any]:
    """Where the derivation chain puts this entity, nearest placement first.

    Its own route rather than a field on the chain payload: the chain is read on
    every Details open and every map popup, and this walks further than one hop.
    """
    case = get_case(case_id)
    placement = satellite_engine.placements(case, entity_id)
    if placement is None:
        raise HTTPException(status_code=404, detail=f"entity '{entity_id}' not found")
    return placement

@router.get("/{case_id}/entities/{entity_id}/tally")
def entity_tally(case_id: str, entity_id: str) -> dict[str, Any]:
    """What the statements about this entity come to, or 404 when nothing states one.

    Its own route for the same reason placement is: the panel already lists the claims
    pointing here, and adding them up walks their attributes, which the chain read has
    no reason to carry on every Details open.

    Over the whole case, never a filter: the panel is not narrowed, so a total obeying
    a narrowing set on another screen would be a different number under one wording.
    """
    row = tally_engine.for_subject(get_case(case_id), entity_id)
    if row is None:
        raise HTTPException(status_code=404, detail="no statement is about this entity")
    return row

@router.get("/{case_id}/entities/{entity_id}/derivation")
def entity_derivation(case_id: str, entity_id: str) -> dict[str, Any]:
    """The transitive ``derived-from`` closure rooted at this entity as
    ``{entities, links}`` — the Post composer traces a proof back to its original
    downloaded media over this slice, not the whole graph (Step 5)."""
    case = get_case(case_id)
    subgraph = link_engine.derivation_subgraph(case, entity_id)
    if subgraph is None:
        raise HTTPException(status_code=404, detail=f"entity '{entity_id}' not found")
    return subgraph

@router.delete("/{case_id}/entities/{entity_id}")
def remove_entity(case_id: str, entity_id: str) -> dict[str, Any]:
    """Delete an entity and the on-disk artifact it stands for, so removing a
    row in the sidebar deletes it everywhere it appears (spec §3.5)."""
    case = get_case(case_id)
    try:
        return delete_entity_deep(case, entity_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

@router.post("/{case_id}/entities/delete")
def remove_entities(case_id: str, body: EntityDeleteIn) -> dict[str, Any]:
    """Delete a multi-selection as one recoverable trash group."""
    case = get_case(case_id)
    try:
        return delete_entities_deep(case, body.ids)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

@router.post("/{case_id}/entities/missing")
def missing_entities(case_id: str, body: EntityIdsIn) -> dict[str, list[str]]:
    """Which of these ids the case no longer holds.

    A sidecar keeps ids and only ids — a sheet cell's link, the files a row carries —
    so a delete on another screen leaves a tool holding pointers at nothing. This is
    how it finds out in one bounded lookup: there is no route that reads one entity,
    and asking per id would be a request per cell.
    """
    case = get_case(case_id)
    held = {str(entity["id"]) for entity in case.entities_by_ids(body.ids)}
    return {"missing": [row for row in dict.fromkeys(body.ids) if row not in held]}
