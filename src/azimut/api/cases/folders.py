"""The folders a case files its entities into."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...workspace import CaseError
from .common import get_case

router = APIRouter(prefix="/api/cases", tags=["cases"])


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)

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
