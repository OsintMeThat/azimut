"""Map plates: a page laid out round the case's maps (`engine/mapplates.py`).

A plate is saved work like a comparison or a Horizon view: a named layout under
``.mapplates/`` with the preview the lists show, filed as a ``map-plate`` entity
that the Trash and a bundle answer for. Its name follows its title, on Windows and
macOS too, and a rename carries the preview along.

What a plate exports is drawn in the browser, which is where its maps are, and
posted here to be written into the folder saved for views: a PNG, a PDF of the
paper size, or the page played through its days as a GIF or an MP4.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .. import __version__, errors, layout
from ..engine import artifacts as artifact_engine
from ..engine import exportdir, inspectwork, mapplates
from ..engine import media as media_engine
from ..engine.sheets import replace_atomic
from ..workspace import Case, CaseError
from .cases import delete_by_path, get_case
from .naming import case_only, holders, read_created_at, slugify

router = APIRouter(prefix="/api", tags=["map plates"])

#: Read by `server.BulkBodyLimit` before an export is parsed.
MAX_EXPORT_BODY_BYTES = mapplates.MAX_EXPORT_BODY_BYTES


class PlateIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    #: The name the plate was open under, to rename it; absent for a new one.
    rename_from: str | None = Field(default=None, max_length=200)
    spec: mapplates.PlateSpec


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read(case: Case, name: str) -> dict[str, Any] | None:
    try:
        path = case.resolve_inside(layout.map_plate_rel(name))
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (CaseError, OSError, ValueError):
        return None
    return saved if isinstance(saved, dict) and saved.get("azimut_plate") == mapplates.VERSION else None


def _thumb_of(case: Case, name: str) -> str | None:
    rel = layout.map_plate_thumb_rel(name)
    try:
        return rel if case.resolve_inside(rel).is_file() else None
    except CaseError:
        return None


@router.get("/cases/{case_id}/map-plates")
def list_plates(case_id: str) -> list[dict[str, Any]]:
    case = get_case(case_id)
    out = []
    for path in sorted(case.subdir(layout.MAPPLATE_DIR).glob("*.json")):
        saved = _read(case, path.stem)
        if saved is None:
            continue
        spec = saved.get("spec") or {}
        out.append({
            "name": path.stem,
            "title": saved.get("title", path.stem),
            "updated_at": saved.get("updated_at"),
            "paper": (spec.get("page") or {}).get("paper"),
            "maps": sum(1 for element in spec.get("elements", []) if element.get("kind") == "map"),
            "thumb": _thumb_of(case, path.stem),
        })
    out.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return out


@router.get("/cases/{case_id}/map-plates/{name}")
def load_plate(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    stem = slugify(name, mapplates.FALLBACK)
    saved = _read(case, stem)
    if saved is None:
        raise HTTPException(status_code=404, detail="plate not found")
    return {**saved, "name": stem, "thumb": _thumb_of(case, stem)}


@router.post("/cases/{case_id}/map-plates")
def save_plate(case_id: str, body: PlateIn) -> dict[str, Any]:
    case = get_case(case_id)
    spec = body.spec.model_dump(mode="json")
    if len(json.dumps(spec)) > mapplates.MAX_SPEC_CHARS:
        raise HTTPException(status_code=413, detail="this plate is too large to keep")
    with case.lock:
        return _save(case, body.title, body.rename_from, spec)


def _save(case: Case, title: str, rename_from: str | None, spec: dict[str, Any]) -> dict[str, Any]:
    """Names answer to Windows and macOS, and to the Trash, as a Horizon view's do."""
    folder = case.subdir(layout.MAPPLATE_DIR)
    name = slugify(title, mapplates.FALLBACK)
    old = slugify(rename_from, mapplates.FALLBACK) if rename_from else None
    old_rel = layout.map_plate_rel(old) if old and old != name else None
    trashed = case.trashed_stems(layout.MAPPLATE_DIR)
    if old_rel:
        if holders(folder, name, source=old):
            raise HTTPException(status_code=409, detail="another plate already uses that name")
        if name.casefold() in trashed and not case_only(old, name):
            raise HTTPException(status_code=409, detail="a plate in the Trash uses that name")
    elif rename_from is None:
        # A new plate takes the next free name rather than writing over another.
        taken = {path.stem.casefold() for path in folder.glob("*.json")} | trashed
        if name.casefold() in taken:
            name = layout.free_stem(taken, name, mapplates.FALLBACK)
    rel = layout.map_plate_rel(name)
    path = case.resolve_inside(rel)
    if old_rel and case_only(old, name):
        source = case.resolve_inside(old_rel)
        # The name asked for, not `path`'s: Windows resolves a path to the case already on disk.
        if source.is_file():
            path = source.with_name(PurePosixPath(rel).name)
            media_engine.rename_path(source, path)
    previous = path if old_rel and case_only(old, name) else case.resolve_inside(layout.map_plate_rel(old or name))
    saved = {
        "azimut_plate": mapplates.VERSION,
        "title": name,
        "created_at": read_created_at(previous) or _now(),
        "updated_at": _now(),
        "app_version": __version__,
        "spec": spec,
    }
    media_engine.write_json_atomic(path, saved)
    thumb: str | None = None
    if old_rel:
        moved = case.resolve_inside(layout.map_plate_thumb_rel(old or name))
        if moved.is_file():
            target = layout.map_plate_thumb_rel(name)
            media_engine.rename_path(moved, moved.with_name(PurePosixPath(target).name))
            thumb = target
    thumb = thumb or _thumb_of(case, name)
    attrs: dict[str, Any] = {"spec": rel}
    if thumb:
        attrs["thumb"] = thumb
    existing = case.find_entity(attr="spec", value=old_rel or rel)
    if existing:
        case.update_entity(existing["id"], {"label": name, "attrs": attrs})
    else:
        case.add_entity(mapplates.TYPE, name, attrs=attrs, by=mapplates.PRODUCER)
    if old_rel and not case_only(old, name):
        case.resolve_inside(old_rel).unlink(missing_ok=True)
    return {"name": name, "title": name, "spec_path": rel, "thumb": thumb}


@router.put("/cases/{case_id}/map-plates/{name}/thumb")
async def save_plate_thumb(case_id: str, name: str, file: UploadFile = File()) -> dict[str, Any]:
    """The picture the saved work lists show for a plate, drawn by the browser at its save."""
    case = get_case(case_id)
    raw = await file.read(inspectwork.MAX_THUMB_BYTES + 1)
    try:
        data = inspectwork.preview_webp(raw)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    stem = slugify(name, mapplates.FALLBACK)
    rel = layout.map_plate_rel(stem)
    thumb = layout.map_plate_thumb_rel(stem)
    with case.lock:
        if not case.resolve_inside(rel).is_file():
            raise HTTPException(status_code=404, detail="plate not found")
        replace_atomic(case.resolve_inside(thumb), data)
        entity = case.find_entity(attr="spec", value=rel)
        if entity and (entity.get("attrs") or {}).get("thumb") != thumb:
            case.update_entity(entity["id"], {"attrs": {"thumb": thumb}})
    return {"thumb": thumb}


@router.delete("/cases/{case_id}/map-plates/{name}")
def delete_plate(case_id: str, name: str) -> dict[str, Any]:
    """Send the plate and its preview to the Trash. What it exported stays where it went."""
    case = get_case(case_id)
    rel = layout.map_plate_rel(slugify(name, mapplates.FALLBACK))
    result = delete_by_path(case, rel)
    if not result["deleted"]:
        artifact_engine.delete(case, {"type": mapplates.TYPE, "attrs": {"spec": rel}})
    return result


@router.post("/cases/{case_id}/map-plates/export")
async def export_plate(
    case_id: str,
    frames: list[UploadFile] = File(),
    format: Literal["png", "pdf", "gif", "mp4"] = Form(),
    filename: str = Form(default=mapplates.FALLBACK, min_length=1, max_length=120),
    width_mm: float = Form(default=297, gt=0, le=mapplates.MAX_EDGE_MM),
    height_mm: float = Form(default=210, gt=0, le=mapplates.MAX_EDGE_MM),
    interval: int = Form(default=900, ge=150, le=6000),
) -> dict[str, Any]:
    """Write one export of a plate into the folder saved for views.

    A PNG or a PDF is one page; a GIF or an MP4 is the page on each of its days,
    two to `MAX_FRAMES` of them, each shown `interval` milliseconds.
    """
    case = get_case(case_id)
    played = format in ("gif", "mp4")
    if not played and len(frames) != 1:
        raise HTTPException(status_code=422, detail="a page is one picture")
    if played and not 2 <= len(frames) <= mapplates.MAX_FRAMES:
        raise HTTPException(status_code=422, detail=f"a played plate holds 2 to {mapplates.MAX_FRAMES} days")
    try:
        if played:
            pictures = [mapplates.picture(await frame.read(mapplates.MAX_FRAME_BYTES + 1),
                                          max_bytes=mapplates.MAX_FRAME_BYTES, max_pixels=mapplates.MAX_FRAME_PIXELS)
                        for frame in frames]
            if max(pictures[0].size) > mapplates.MAX_VIDEO_EDGE:
                raise mapplates.ExportError("a played plate is at most 3840 pixels across")
            data = mapplates.gif_bytes(pictures, interval) if format == "gif" else mapplates.mp4_bytes(pictures, interval)
        else:
            raw = await frames[0].read(mapplates.MAX_PAGE_BYTES + 1)
            page = mapplates.picture(raw, max_bytes=mapplates.MAX_PAGE_BYTES, max_pixels=mapplates.MAX_PAGE_PIXELS)
            data = (mapplates.pdf_bytes(page, width_mm, height_mm, filename) if format == "pdf"
                    else mapplates.png_bytes(page))
    except mapplates.ExportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    name = f"{layout.slugify(filename, mapplates.FALLBACK)}.{format}"
    try:
        destination = exportdir.destination("views", case.path)
        path = exportdir.write_out(data, destination, name)
    except (OSError, exportdir.ExportDirError) as exc:
        raise HTTPException(status_code=409, detail=f"could not write the export: {errors.explain(exc)}") from exc
    return {"file": path.name, "path": str(destination), "format": format}

