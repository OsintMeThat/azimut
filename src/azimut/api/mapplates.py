"""Map plates: a page laid out round the case's maps (`engine/mapplates.py`).

A plate is saved work like a comparison or a Horizon view: a named layout under
``.mapplates/`` with the preview the lists show, filed as a ``map-plate`` entity
that the Trash and a bundle answer for. Its name follows its title, on Windows and
macOS too, and a rename carries the preview along.

What a plate exports is drawn in the browser, which is where its maps are, and
posted here to be written into the folder saved for views: a PNG, a PDF of the
paper size, or the page played through its days as a GIF or an MP4. A played
plate's pictures come first, in batches as they are drawn, and are kept on disk
until its export names them. A plate with steps sends its sequence too: how long
each picture holds, and the clips of the case's videos that run over it, which are
read here from the case itself.
"""

from __future__ import annotations

import asyncio
import atexit
import json
import secrets
import shutil
import tempfile
import time
from dataclasses import dataclass, field
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

#: Read by `server.BulkBodyLimit` before an export, or a batch of its pictures, is parsed.
MAX_EXPORT_BODY_BYTES = mapplates.MAX_EXPORT_BODY_BYTES
MAX_PICTURES_BODY_BYTES = mapplates.MAX_PICTURES_BODY_BYTES
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


# -- a played plate's pictures, sent as they are drawn ----------------------------------

#: How long a played plate's pictures wait, untouched, for the rest of their export.
STAGE_IDLE_SECONDS = 15 * 60
#: Played plates being sent at once, each with its folder of pictures.
MAX_STAGED = 4
#: Their folders, in the system's temporary folder.
STAGE_PREFIX = "azimut-plate-"
#: Each series of a played plate's pictures, in the order it came: how many it holds and how large each is.
SERIES = {
    "frames": (mapplates.MAX_FRAMES, mapplates.MAX_FRAME_BYTES),
    "overs": (mapplates.MAX_FRAMES, mapplates.MAX_FRAME_BYTES),
    "tweens": (mapplates.MAX_TWEENS, mapplates.MAX_TWEEN_BYTES),
}


@dataclass
class Staged:
    """A played plate's pictures as they come in, kept on disk until its export is written."""

    case_id: str
    root: Path
    kept: mapplates.Kept = field(default_factory=mapplates.Kept)
    #: The first picture's, which every other is held to.
    size: tuple[int, int] | None = None
    touched: float = field(default_factory=time.monotonic)
    #: One batch at a time, so a series keeps its order and the export waits for the last.
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


_staged: dict[str, Staged] = {}


def _let_go(token: str) -> None:
    staged = _staged.pop(token, None)
    if staged is not None:
        shutil.rmtree(staged.root, ignore_errors=True)


def _make_room() -> None:
    """The pictures of an export never finished go after a while, and the least recently sent to when too many wait.

    Never those of a batch being kept or a video being made. `_staged` is kept in the
    order the folders were last sent to, which a coarse clock could not tell apart.
    """
    now = time.monotonic()
    idle = [token for token, staged in _staged.items() if not staged.lock.locked()]
    for token in idle:
        if now - _staged[token].touched > STAGE_IDLE_SECONDS:
            _let_go(token)
    idle = [token for token in idle if token in _staged]
    while len(_staged) >= MAX_STAGED and idle:
        _let_go(idle.pop(0))
    # the folders an app stopped mid-export left behind: a closed window or a crash runs no exit code
    waiting = {staged.root for staged in _staged.values()}
    for folder in Path(tempfile.gettempdir()).glob(f"{STAGE_PREFIX}*"):
        try:
            left = folder not in waiting and time.time() - folder.stat().st_mtime > STAGE_IDLE_SECONDS
        except OSError:
            continue
        if left:
            shutil.rmtree(folder, ignore_errors=True)


@atexit.register
def _let_all_go() -> None:
    """On a quiet exit the folders go at once; after a crash, the next export clears them."""
    for token in list(_staged):
        _let_go(token)


def _staged_for(case_id: str, token: str) -> Staged:
    staged = _staged.get(token)
    if staged is None or staged.case_id != case_id:
        raise HTTPException(status_code=404, detail="the pictures of this export are no longer waiting; export again")
    return staged


@router.post("/cases/{case_id}/map-plates/export/pictures")
async def stage_pictures(
    case_id: str,
    series: Literal["frames", "overs", "tweens"] = Form(),
    pictures: list[UploadFile] = File(),
    staged: str = Form(default="", max_length=64),
) -> dict[str, Any]:
    """Keep a batch of a played plate's pictures on disk, as the browser draws them.

    A long video is hundreds of pictures. Sent in batches and written as they come
    (`mapplates.keep_frame`), they are never all in memory, here or in the browser.
    The first batch opens a folder and answers its `staged` token, which the next
    batches and the export name. Each series keeps its order: the frames, what stands
    over the clips, the transitions' frames. A picture the export cannot take lets the
    whole folder go.
    """
    get_case(case_id)
    if len(pictures) > mapplates.MAX_PICTURES_PER_POST:
        raise HTTPException(status_code=422, detail="too many pictures in one batch")
    if staged:
        stage = _staged_for(case_id, staged)
        # the folder sent to last goes last
        _staged[staged] = _staged.pop(staged)
    else:
        _make_room()
        staged = secrets.token_urlsafe(16)
        stage = _staged[staged] = Staged(case_id, Path(tempfile.mkdtemp(prefix=STAGE_PREFIX)))
    most, max_bytes = SERIES[series]
    async with stage.lock:
        stage.touched = time.monotonic()
        kept: list[Path] = getattr(stage.kept, series)
        try:
            if len(kept) + len(pictures) > most:
                raise mapplates.ExportError(f"a played plate holds at most {most} of these pictures")
            for upload in pictures:
                raw = await upload.read(max_bytes + 1)
                await upload.close()
                # a series ffmpeg reads by one pattern keeps the format of its first picture; each
                # picture over the clips is read on its own and keeps its own, see-through
                suffix = kept[0].suffix if kept and series != "overs" else None
                path, size = await run_in_threadpool(mapplates.keep_frame, raw, stage.root / f"{series[0]}{len(kept):04d}",
                                                     size=stage.size, suffix=suffix, max_bytes=max_bytes)
                stage.size = size
                if max(size) > mapplates.MAX_VIDEO_EDGE:
                    raise mapplates.ExportError("a played plate is at most 3840 pixels across")
                kept.append(path)
        except mapplates.ExportError as exc:
            _let_go(staged)
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"staged": staged, **{name: len(getattr(stage.kept, name)) for name in SERIES}}


@router.delete("/cases/{case_id}/map-plates/export/pictures/{staged}")
async def drop_pictures(case_id: str, staged: str) -> dict[str, Any]:
    """Let go the pictures of an export stopped on the way."""
    get_case(case_id)
    dropped = staged in _staged and _staged[staged].case_id == case_id
    if dropped:
        _let_go(staged)
    return {"dropped": dropped}


def _gif_frames(paths: list[Path], size: tuple[int, int]) -> list[Any]:
    return [mapplates.gif_frame(mapplates.picture(path.read_bytes(), max_bytes=mapplates.MAX_FRAME_BYTES,
                                                  max_pixels=mapplates.MAX_FRAME_PIXELS), size) for path in paths]


async def _played(case: Case, stage: Staged, format: str, interval: int, beats: str) -> bytes:
    """A GIF or an MP4 of a played plate, from the pictures already kept on disk for it.

    A GIF holds its frames in 255 colours; an MP4 is made by ffmpeg from the disk.
    """
    kept = stage.kept
    if not (1 if beats else 2) <= len(kept.frames) <= mapplates.MAX_FRAMES:
        raise mapplates.ExportError(f"a played plate holds 2 to {mapplates.MAX_FRAMES} days")
    if kept.tweens and (format != "mp4" or not beats):
        raise mapplates.ExportError("only a video plays transitions")
    sequence = mapplates.read_beats(beats, len(kept.frames), len(kept.overs), len(kept.tweens)) if beats else None
    if format == "gif":
        durations = [round(beat.seconds * 1000) for beat in sequence] if sequence else None
        shown = await run_in_threadpool(_gif_frames, kept.frames, stage.size or (0, 0))
        return await run_in_threadpool(mapplates.gif_bytes, shown, interval, durations)
    if sequence is None:
        return await run_in_threadpool(mapplates.mp4_bytes, kept.frames, interval)
    files = clip_files(case, sequence)
    return await run_in_threadpool(mapplates.sequence_mp4, stage.root, sequence, files, kept)


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
    frames: list[UploadFile] = File(default=[]),
    format: Literal["png", "pdf", "gif", "mp4"] = Form(),
    filename: str = Form(default=mapplates.FALLBACK, min_length=1, max_length=120),
    width_mm: float = Form(default=297, gt=0, le=mapplates.MAX_EDGE_MM),
    height_mm: float = Form(default=210, gt=0, le=mapplates.MAX_EDGE_MM),
    interval: int = Form(default=900, ge=150, le=6000),
    transparent: bool = Form(default=False),
    beats: str = Form(default="", max_length=400_000),
    staged: str = Form(default="", max_length=64),
) -> dict[str, Any]:
    """Write one export of a plate into the folder saved for views.

    A PNG or a PDF is one page, sent with it. A GIF or an MP4 is the page on each of
    its days, two to `MAX_FRAMES` of them, each shown `interval` milliseconds: its
    pictures were `staged` before it (`stage_pictures`), and go once it is written.
    A transparent PNG keeps the paper see-through.

    A plate played through its steps sends `beats`, one per frame: how long it holds
    and, for an MP4, the clips that run over it (a video of the case, the part of it,
    its box in pixels) and which of the see-through pictures stands over them. A
    clip's file is found inside the case, and must be a video. An MP4's beat can open
    on its transition, frames of the transitions' series played before it holds.
    """
    case = get_case(case_id)
    played = format in ("gif", "mp4")
    if played and (frames or not staged):
        raise HTTPException(status_code=422, detail="a played plate sends its pictures before it")
    if not played and (len(frames) != 1 or staged):
        raise HTTPException(status_code=422, detail="a page is one picture")
    try:
        if played:
            stage = _staged_for(case_id, staged)
            # the last batch is in before the video is made of them
            async with stage.lock:
                try:
                    data = await _played(case, stage, format, interval, beats)
                finally:
                    _let_go(staged)
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

