"""REST API for case lifecycle, notes, entities and links."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..engine import links as link_engine
from ..engine import media as media_engine
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
    target = next(e for e in case.read()["entities"] if e["id"] == entity_id)
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


class EntityIn(BaseModel):
    type: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=300)
    attrs: dict[str, Any] = Field(default_factory=dict)
    status: str = "confirmed"


class EntityPatch(BaseModel):
    type: str | None = None
    label: str | None = None
    attrs: dict[str, Any] | None = None
    status: str | None = None


class LinkIn(BaseModel):
    from_id: str
    to_id: str
    type: str = Field(min_length=1, max_length=60)
    status: str = "confirmed"


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
    return {"id": case.id, **case.read()}


@router.post("/scratch")
def create_scratch() -> dict[str, Any]:
    case = Case.create("Scratch session", scratch=True)
    return {"id": case.id, **case.read()}


@router.get("/{case_id}")
def read_case(case_id: str) -> dict[str, Any]:
    case = get_case(case_id)
    return {"id": case.id, "scratch": case.is_scratch, **case.read()}


@router.post("/{case_id}/promote")
def promote_case(case_id: str, body: PromoteCase) -> dict[str, Any]:
    case = get_case(case_id)
    _ensure_name_free(body.name)
    try:
        promoted = case.promote(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"id": promoted.id, **promoted.read()}


@router.patch("/{case_id}")
def rename_case(case_id: str, body: CreateCase) -> dict[str, Any]:
    case = get_case(case_id)
    _ensure_name_free(body.name, exclude_id=case.id)
    case.rename(body.name)
    return {"id": case.id, **case.read()}


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


@router.post("/{case_id}/entities")
def add_entity(case_id: str, body: EntityIn) -> dict[str, Any]:
    case = get_case(case_id)
    return case.add_entity(
        body.type, body.label, body.attrs, by="user", status=body.status  # type: ignore[arg-type]
    )


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


@router.delete("/{case_id}/entities/{entity_id}")
def remove_entity(case_id: str, entity_id: str) -> dict[str, Any]:
    """Delete an entity and the on-disk artifact it stands for, so removing a
    row in the sidebar deletes it everywhere it appears (spec §3.5)."""
    case = get_case(case_id)
    try:
        return delete_entity_deep(case, entity_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{case_id}/links")
def add_link(case_id: str, body: LinkIn) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        return case.add_link(
            body.from_id, body.to_id, body.type, by="user", status=body.status  # type: ignore[arg-type]
        )
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{case_id}/links/{link_id}")
def remove_link(case_id: str, link_id: str) -> dict[str, str]:
    try:
        get_case(case_id).remove_link(link_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "deleted"}


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

