"""REST API for case lifecycle, notes, entities and links."""

from __future__ import annotations

from typing import Any, cast

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..engine import links as link_engine
from ..engine import media as media_engine
from ..repository import EntityStatus
from ..workspace import Case, CaseError

router = APIRouter(prefix="/api/cases", tags=["cases"])


def get_case(case_id: str) -> Case:
    try:
        return Case.open(case_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _ensure_name_free(name: str, *, exclude_id: str | None = None) -> None:
    """Reject a case name already taken by another (non-scratch) case, matched
    case-insensitively on the trimmed name. ``exclude_id`` lets a rename keep
    its own name."""
    wanted = name.strip().casefold()
    for c in Case.list_all():
        if c.get("scratch") or c["id"] == exclude_id:
            continue
        if str(c.get("name", "")).strip().casefold() == wanted:
            raise HTTPException(status_code=409, detail=f"a case named '{name}' already exists")


def _unlink_inside(case: Case, rel_path: str) -> None:
    try:
        case.resolve_inside(rel_path).unlink(missing_ok=True)
    except CaseError:
        pass


def _delete_artifact_files(case: Case, entity: dict[str, Any]) -> None:
    """Drop the on-disk artifact an entity stands for (spec §6 delete/edit sync).

    A bare ``place`` has no file; an unknown (free-typed) entity is assumed to
    have none either, so a future type files its own deletion here or not at all.
    """
    etype = entity.get("type")
    attrs = entity.get("attrs", {})
    if etype in ("media", "capture") and attrs.get("path"):
        media_engine.delete_media_files(case, attrs["path"])
    elif etype == "proof" and attrs.get("spec"):
        _unlink_inside(case, attrs["spec"])
        _unlink_inside(case, attrs["spec"].removesuffix(".json") + ".png")
    elif etype == "post" and attrs.get("draft"):
        _unlink_inside(case, attrs["draft"])
    elif etype == "inspect-session" and attrs.get("spec"):
        _unlink_inside(case, attrs["spec"])
    elif etype == "note" and attrs.get("path"):
        _unlink_inside(case, attrs["path"])


def delete_entity_deep(case: Case, entity_id: str) -> dict[str, Any]:
    """Delete an entity, its artifact, and whatever cannot outlive it.

    The one door every delete goes through — sidebar, Media Library, a tool's
    own list — so the rules hold wherever the click came from:

    - artifacts that ``depends-on`` the target die with it (an Inspect session
      is only adjustments over a video), transitively;
    - artifacts ``derived-from`` it are never touched, and are scarred with a
      tombstone first, while the target can still describe itself.
    """
    plan = link_engine.plan_delete(case, entity_id)
    target = case.get_entity(entity_id)
    if target is None:
        raise CaseError(f"entity '{entity_id}' not found")
    going = [target, *plan["cascade"]]

    # Scar the survivors first, while the doomed can still describe themselves.
    for survivor_id, lost_sources in link_engine.losses(
        case, {e["id"] for e in going}
    ).items():
        for lost in lost_sources:
            info = link_engine.tombstone_of(lost)
            if info.get("path"):
                link_engine.add_tombstone(case, survivor_id, info)

    for entity in going:
        _delete_artifact_files(case, entity)
        try:
            case.remove_entity(entity["id"])
        except CaseError:
            pass  # a cascade may already have taken it

    return {
        "status": "deleted",
        "deleted": [e["id"] for e in going],
        "tombstoned": [e["id"] for e in plan["tombstone"]],
    }


def _summary(entity: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entity["id"],
        "type": entity.get("type"),
        "label": entity.get("label"),
        "path": link_engine.artifact_path(entity),
    }


def delete_by_path(case: Case, rel_path: str) -> dict[str, Any]:
    """Chokepoint entry for a tool that knows its artifact by path, not by id.

    Returns an empty ``deleted`` when no entity claims the path: the artifact was
    never filed, so there is no graph to honour and the caller drops the files
    itself.
    """
    entity = (
        case.find_entity(attr="path", value=rel_path)
        or case.find_entity(attr="spec", value=rel_path)
        or case.find_entity(attr="draft", value=rel_path)
    )
    if entity is None:
        return {"status": "deleted", "deleted": [], "tombstoned": []}
    return delete_entity_deep(case, entity["id"])


class CreateCase(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class PromoteCase(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class Notes(BaseModel):
    text: str


class NoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    folder: str = Field(default="", max_length=120)
    content: str = ""


class EntityIn(BaseModel):
    type: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=300)
    attrs: dict[str, Any] = Field(default_factory=dict)
    status: EntityStatus = "confirmed"


class EntityPatch(BaseModel):
    type: str | None = None
    label: str | None = None
    attrs: dict[str, Any] | None = None
    status: EntityStatus | None = None


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@router.get("")
def list_cases() -> list[dict[str, Any]]:
    return Case.list_all()


@router.post("")
def create_case(body: CreateCase) -> dict[str, Any]:
    _ensure_name_free(body.name)
    try:
        case = Case.create(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"id": case.id, **case.overview()}


@router.post("/scratch")
def create_scratch() -> dict[str, Any]:
    case = Case.create("Scratch session", scratch=True)
    return {"id": case.id, **case.overview()}


@router.get("/{case_id}")
def read_case(case_id: str) -> dict[str, Any]:
    case = get_case(case_id)
    return {"id": case.id, "scratch": case.is_scratch, **case.overview()}


@router.post("/{case_id}/promote")
def promote_case(case_id: str, body: PromoteCase) -> dict[str, Any]:
    case = get_case(case_id)
    _ensure_name_free(body.name)
    try:
        promoted = case.promote(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"id": promoted.id, **promoted.overview()}


@router.patch("/{case_id}")
def rename_case(case_id: str, body: CreateCase) -> dict[str, Any]:
    case = get_case(case_id)
    _ensure_name_free(body.name, exclude_id=case.id)
    case.rename(body.name)
    return {"id": case.id, **case.overview()}


@router.delete("/{case_id}")
def delete_case(case_id: str) -> dict[str, str]:
    get_case(case_id).delete()
    return {"status": "deleted"}


@router.get("/{case_id}/notes")
def read_notes(case_id: str) -> dict[str, str]:
    return {"text": get_case(case_id).read_notes()}


@router.put("/{case_id}/notes")
def write_notes(case_id: str, body: Notes) -> dict[str, str]:
    get_case(case_id).write_notes(body.text)
    return {"status": "saved"}


@router.post("/{case_id}/notes")
def create_note(case_id: str, body: NoteIn) -> dict[str, Any]:
    return get_case(case_id).create_note(body.title.strip(), body.folder.strip(), body.content)


@router.get("/{case_id}/notes/{note_id}")
def read_note(case_id: str, note_id: str) -> dict[str, str]:
    try:
        return {"text": get_case(case_id).read_note(note_id)}
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{case_id}/notes/{note_id}")
def write_note(case_id: str, note_id: str, body: Notes) -> dict[str, str]:
    try:
        get_case(case_id).write_note(note_id, body.text)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "saved"}


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
) -> dict[str, Any]:
    """A bounded page of the entity catalog (Step 5, "Bounded loading").

    Stable cursor order, server-side filters (a comma-separated ``type`` set,
    ``status``, a label substring ``q``, and folder — ``unfiled=true`` or an
    exact ``folder`` path) and a ``next_cursor`` that is null on the last page.
    ``limit`` is clamped so no request can ask for the whole graph at once.
    """
    case = get_case(case_id)
    limit = max(1, min(limit, 500))
    types = [t.strip() for t in type.split(",") if t.strip()] if type else None
    valid_status = (
        cast(EntityStatus, status) if status in ("confirmed", "suggested") else None
    )
    try:
        return case.page_entities(
            limit=limit, cursor=cursor, types=types, status=valid_status,
            query=q, folder=folder, unfiled=unfiled,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{case_id}/catalog/summary")
def catalog_summary(case_id: str) -> dict[str, Any]:
    """Total plus per-type and per-status counts, so the catalog can show badges
    without loading the graph."""
    return get_case(case_id).catalog_summary()


@router.get("/{case_id}/entities/lookup")
def lookup_entity(case_id: str, attr: str, value: str) -> dict[str, Any]:
    """One entity by an ``attrs`` value (``path``, ``spec``, ``draft``), or null.

    The bounded replacement for a tool scanning the whole graph to answer "is the
    file/spec I am bound to still in the case?" after a delete elsewhere, or to
    resolve a file path back to its entity (Step 5).
    """
    entity = get_case(case_id).find_entity(attr=attr, value=value)
    return {"entity": entity}


@router.post("/{case_id}/entities")
def add_entity(case_id: str, body: EntityIn) -> dict[str, Any]:
    case = get_case(case_id)
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
    try:
        return case.update_entity(entity_id, patch)
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
    """One entity plus its derivation chain (sources, dependents, lost sources),
    read from its incident links only — the Details panel's relations without
    shipping the whole graph (Step 5)."""
    case = get_case(case_id)
    chain = link_engine.chain_of(case, entity_id)
    if chain is None:
        raise HTTPException(status_code=404, detail=f"entity '{entity_id}' not found")
    return chain


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


@router.get("/{case_id}/folders")
def list_folders(case_id: str) -> list[str]:
    return get_case(case_id).list_folders()


@router.post("/{case_id}/folders")
def add_folder(case_id: str, body: FolderIn) -> list[str]:
    case = get_case(case_id)
    try:
        return case.add_folder(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{case_id}/folders")
def remove_folder(case_id: str, name: str) -> list[str]:
    return get_case(case_id).remove_folder(name)
