"""REST API for case lifecycle, notes, entities and links."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..workspace import Case, CaseError

router = APIRouter(prefix="/api/cases", tags=["cases"])


def get_case(case_id: str) -> Case:
    try:
        return Case.open(case_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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
    try:
        promoted = case.promote(body.name)
    except CaseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"id": promoted.id, **promoted.read()}


@router.patch("/{case_id}")
def rename_case(case_id: str, body: CreateCase) -> dict[str, Any]:
    case = get_case(case_id)
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


@router.delete("/{case_id}/entities/{entity_id}")
def remove_entity(case_id: str, entity_id: str) -> dict[str, str]:
    try:
        get_case(case_id).remove_entity(entity_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "deleted"}


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

