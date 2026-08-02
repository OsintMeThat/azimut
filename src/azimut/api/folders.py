"""REST API for the folder picker behind every export destination.

A browser cannot hand back a real path and the repo rules forbid a GUI toolkit,
so the picker is served from here: the analyst starts at one of `roots()` and
walks down. Only directory names travel — see `engine/exportdir.py` for why the
listing stops there.

Nothing in this router writes an export. It answers "which folders are there",
and `POST /create` makes one; the exports themselves are written by the routes
that own the artifact (notes, media, proofs).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..engine import exportdir

router = APIRouter(prefix="/api/folders", tags=["folders"])


class NewFolderIn(BaseModel):
    parent: str
    name: str = Field(min_length=1, max_length=exportdir.MAX_NEW_NAME)


@router.get("/roots")
def folder_roots() -> dict[str, Any]:
    """Where the picker offers to start: the analyst's own folders, then the
    workspace, then the drives on Windows."""
    return {"roots": exportdir.roots()}


@router.get("")
def folder_listing(path: str) -> dict[str, Any]:
    """The subfolders of one folder, plus the crumbs back out to the root."""
    try:
        return exportdir.listing(path)
    except exportdir.ExportDirError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/create")
def create_folder(body: NewFolderIn) -> dict[str, str]:
    """Make one subfolder, so an export can go somewhere that isn't there yet."""
    try:
        return exportdir.create_folder(body.parent, body.name)
    except exportdir.ExportDirError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
