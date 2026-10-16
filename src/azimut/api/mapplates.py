"""Map plates: a page laid out round the case's maps (`engine/mapplates.py`).

A plate is saved work like a comparison or a Horizon view: a named layout under
``.mapplates/`` with the preview the lists show, filed as a ``map-plate`` entity
that the Trash and a bundle answer for. Its name follows its title, on Windows and
macOS too, and a rename carries the preview along.

What a plate exports is drawn in the browser, which is where its maps are, and
posted here to be written into the folder saved for views: a PNG, a PDF of the
paper size, or the page played through its days as a GIF or an MP4. A plate with
steps sends its sequence too: how long each picture holds, and the clips of the
case's videos that run over it, which are read here from the case itself.
"""

from __future__ import annotations

import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

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
#: A plate's save: its layout, with the pictures it keeps inside it, and its title.
MAX_PLATE_BODY_BYTES = mapplates.MAX_SPEC_CHARS + 100_000


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
    if not isinstance(saved, dict) or saved.get("azimut_plate") != mapplates.VERSION:
        return None
    if isinstance(saved.get("spec"), dict):
        mapplates.as_periods(saved["spec"])
    return saved


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
            "orientation": (spec.get("page") or {}).get("orientation"),
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


@router.post("/cases/{case_id}/map-plates/{name}/duplicate")
def duplicate_plate(case_id: str, name: str) -> dict[str, Any]:
    """A copy of a plate under the next free name, its preview copied with it so the list shows it at once."""
    case = get_case(case_id)
    stem = slugify(name, mapplates.FALLBACK)
    with case.lock:
        saved = _read(case, stem)
        if saved is None:
            raise HTTPException(status_code=404, detail="plate not found")
        answer = _save(case, f"{saved.get('title') or stem} copy", None, saved["spec"])
        source = case.resolve_inside(layout.map_plate_thumb_rel(stem))
        if source.is_file():
            thumb = layout.map_plate_thumb_rel(answer["name"])
            replace_atomic(case.resolve_inside(thumb), source.read_bytes())
            entity = case.find_entity(attr="spec", value=answer["spec_path"])
            if entity:
                case.update_entity(entity["id"], {"attrs": {"thumb": thumb}})
            answer["thumb"] = thumb
    return answer


def clip_files(case: Case, sequence: list[mapplates.Beat]) -> dict[str, Path]:
    """The case's videos a sequence's clips name, each found inside the case; `ExportError` for any that is not."""
    files: dict[str, Path] = {}
    for clip in (clip for beat in sequence for clip in beat.clips):
        if clip.src in files:
            continue
        try:
            path = case.resolve_inside(clip.src)
        except (CaseError, ValueError) as exc:
            raise mapplates.ExportError("a clip names a file outside the case") from exc
        if not path.is_file():
            raise mapplates.ExportError(f"the video {PurePosixPath(clip.src).name} is no longer in the case")
        if media_engine.media_kind(path.name) != "video":
            raise mapplates.ExportError(f"{PurePosixPath(clip.src).name} is not a video")
        files[clip.src] = path
    return files


async def _played(case: Case, root: Path, format: str, frames: list[UploadFile], interval: int, beats: str,
                  overs: list[UploadFile], tweens: list[UploadFile]) -> bytes:
    """A GIF or an MP4 of a played plate, each picture checked and kept as it is read.

    An MP4's pictures are written into `root` one by one (`mapplates.keep_frame`), so a
    long video with its transitions never holds more than one of them in memory; a GIF
    keeps its frames in 255 colours. The first frame sets the size of all the others.
    """
    size: tuple[int, int] | None = None
    kept: list[Any] = []

    async def take(upload: UploadFile, path: Path, *, max_bytes: int, alpha: bool = False) -> None:
        nonlocal size
        image = mapplates.picture(await upload.read(max_bytes + 1), max_bytes=max_bytes, max_pixels=mapplates.MAX_FRAME_PIXELS, alpha=alpha)
        if size is None:
            if max(image.size) > mapplates.MAX_VIDEO_EDGE:
                raise mapplates.ExportError("a played plate is at most 3840 pixels across")
            size = image.size
        if format == "gif":
            kept.append(mapplates.gif_frame(image, size))
        else:
            await run_in_threadpool(mapplates.keep_frame, image, size, path)
        image.close()
        await upload.close()

    for index, frame in enumerate(frames):
        await take(frame, root / f"f{index:04d}.png", max_bytes=mapplates.MAX_FRAME_BYTES)
    sequence = mapplates.read_beats(beats, len(frames), len(overs), len(tweens)) if beats else None
    if format == "gif":
        durations = [round(beat.seconds * 1000) for beat in sequence] if sequence else None
        return await run_in_threadpool(mapplates.gif_bytes, kept, interval, durations)
    if sequence is None:
        return await run_in_threadpool(mapplates.mp4_bytes, root, len(frames), interval)
    files = clip_files(case, sequence)
    for index, over in enumerate(overs):
        await take(over, root / f"o{index:04d}.png", max_bytes=mapplates.MAX_FRAME_BYTES, alpha=True)
    for index, tween in enumerate(tweens):
        await take(tween, root / f"t{index:04d}.png", max_bytes=mapplates.MAX_TWEEN_BYTES)
    return await run_in_threadpool(mapplates.sequence_mp4, root, sequence, files)


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
    transparent: bool = Form(default=False),
    beats: str = Form(default="", max_length=400_000),
    overs: list[UploadFile] = File(default=[]),
    tweens: list[UploadFile] = File(default=[]),
) -> dict[str, Any]:
    """Write one export of a plate into the folder saved for views.

    A PNG or a PDF is one page; a GIF or an MP4 is the page on each of its days,
    two to `MAX_FRAMES` of them, each shown `interval` milliseconds. A transparent
    PNG keeps the paper see-through.

    A plate played through its steps sends `beats`, one per picture: how long it
    holds and, for an MP4, the clips that run over it (a video of the case, the part
    of it, its box in pixels) with `overs`, the see-through pictures of what stands
    over the clips. A clip's file is found inside the case, and must be a video.
    An MP4's beat can open on its transition, frames of `tweens` played before it holds.
    """
    case = get_case(case_id)
    played = format in ("gif", "mp4")
    if not played and len(frames) != 1:
        raise HTTPException(status_code=422, detail="a page is one picture")
    if played and not (1 if beats else 2) <= len(frames) <= mapplates.MAX_FRAMES:
        raise HTTPException(status_code=422, detail=f"a played plate holds 2 to {mapplates.MAX_FRAMES} days")
    if len(overs) > mapplates.MAX_FRAMES:
        raise HTTPException(status_code=422, detail="too many pictures for one sequence")
    if tweens and (format != "mp4" or not beats):
        raise HTTPException(status_code=422, detail="only a video plays transitions")
    if len(tweens) > mapplates.MAX_TWEENS:
        raise HTTPException(status_code=422, detail="too many transition frames for one video")
    try:
        if played:
            with tempfile.TemporaryDirectory(prefix="azimut-plate-") as folder:
                data = await _played(case, Path(folder), format, frames, interval, beats, overs, tweens)
        else:
            raw = await frames[0].read(mapplates.MAX_PAGE_BYTES + 1)
            page = mapplates.picture(raw, max_bytes=mapplates.MAX_PAGE_BYTES, max_pixels=mapplates.MAX_PAGE_PIXELS,
                                     alpha=transparent and format == "png")
            # a print page is tens of millions of pixels: encoded off the loop, so the app keeps answering
            if format == "pdf":
                data = await run_in_threadpool(mapplates.pdf_bytes, page, width_mm, height_mm, filename)
            else:
                data = await run_in_threadpool(mapplates.png_bytes, page)
    except mapplates.ExportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    name = f"{layout.slugify(filename, mapplates.FALLBACK)}.{format}"
    try:
        destination = exportdir.destination("views", case.path)
        path = exportdir.write_out(data, destination, name)
    except (OSError, exportdir.ExportDirError) as exc:
        raise HTTPException(status_code=409, detail=f"could not write the export: {errors.explain(exc)}") from exc
    return {"file": path.name, "path": str(destination), "format": format}

