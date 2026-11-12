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
read here from the case itself. An export a post carries is filed in the case
instead, as a media file naming its plate.
"""

from __future__ import annotations

import asyncio
import atexit
import hashlib
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
from ..engine import exportdir, inspectwork, mapplates, snapshots
from ..engine import media as media_engine
from ..engine import renames as rename_engine
from ..engine.sheets import replace_atomic
from ..workspace import Case, CaseError
from .cases import delete_by_path, get_case
from .naming import case_only, existing_stem, holders, read_created_at, slugify

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
    stem = existing_stem(name, mapplates.FALLBACK)
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
    old = existing_stem(rename_from, mapplates.FALLBACK) if rename_from else None
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
    # A rename lands first, on its own, a change of case included: the plate and its
    # preview move, and the figures filed from it and whatever else names them follow
    # (`engine/renames.py`). The save then writes onto the new name like any other.
    if old_rel and case.resolve_inside(old_rel).is_file():
        rename_engine.rename_record(case, mapplates.TYPE, old_rel, rel)
    path = case.resolve_inside(rel)
    saved = {
        "azimut_plate": mapplates.VERSION,
        "title": name,
        "created_at": read_created_at(path) or _now(),
        "updated_at": _now(),
        "app_version": __version__,
        "spec": spec,
    }
    media_engine.write_json_atomic(path, saved)
    thumb = _thumb_of(case, name)
    attrs: dict[str, Any] = {"spec": rel}
    if thumb:
        attrs["thumb"] = thumb
    existing = case.find_entity(attr="spec", value=rel)
    if existing:
        case.update_entity(existing["id"], {"label": name, "attrs": attrs})
    else:
        case.add_entity(mapplates.TYPE, name, attrs=attrs, by=mapplates.PRODUCER)
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
    stem = existing_stem(name, mapplates.FALLBACK)
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
    stem = existing_stem(name, mapplates.FALLBACK)
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
    """The case's videos and GIFs a sequence's clips name, each found inside the case; `ExportError` for any that is not."""
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
        if media_engine.media_kind(path.name) != "video" and path.suffix.lower() != ".gif":
            raise mapplates.ExportError(f"{PurePosixPath(clip.src).name} is not a video or a GIF")
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
#: The transitions' frames are as many as a plate can ask for, so they are held to a size on disk in all.
TWEENS_TOO_LARGE = ("the video's transitions run to more pictures than one export keeps: "
                    "export it at a smaller size, or with shorter transitions")


@dataclass
class Staged:
    """A played plate's pictures as they come in, kept on disk until its export is written."""

    case_id: str
    root: Path
    kept: mapplates.Kept = field(default_factory=mapplates.Kept)
    #: The first picture's, which every other is held to.
    size: tuple[int, int] | None = None
    #: The bytes of the transitions' frames kept so far.
    tween_bytes: int = 0
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
                if series == "tweens":
                    stage.tween_bytes += len(raw)
                    if stage.tween_bytes > mapplates.MAX_TWEENS_TOTAL_BYTES:
                        raise mapplates.ExportError(TWEENS_TOO_LARGE)
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


def plate_spec(name: str) -> str:
    """The record a plate's name stands for, as its delete and its preview read it."""
    return layout.map_plate_rel(existing_stem(name, mapplates.FALLBACK))


@router.delete("/cases/{case_id}/map-plates/{name}")
def delete_plate(case_id: str, name: str) -> dict[str, Any]:
    """Send the plate and its preview to the Trash. What it exported stays where it went."""
    case = get_case(case_id)
    rel = plate_spec(name)
    result = delete_by_path(case, rel)
    if not result["deleted"]:
        artifact_engine.delete(case, {"type": mapplates.TYPE, "attrs": {"spec": rel}})
    return result


#: The words a figure's credits take at most, as the plate's face wrote them.
FIGURE_CREDIT_MAX = 2000


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
    into: Literal["views", "case"] = Form(default="views"),
    plate: str = Form(default="", max_length=200),
    kind: Literal["page", "sheet"] = Form(default="page"),
    day: str = Form(default="", max_length=40),
    step: str = Form(default="", max_length=64),
    attribution: str = Form(default="", max_length=FIGURE_CREDIT_MAX),
) -> dict[str, Any]:
    """Write one export of a plate into the folder saved for views, or file it in the case.

    A PNG or a PDF is one page, sent with it. A GIF or an MP4 is the page on each of
    its days, two to `MAX_FRAMES` of them, each shown `interval` milliseconds: its
    pictures were `staged` before it (`stage_pictures`), and go once it is written.
    A transparent PNG keeps the paper see-through.

    A plate played through its steps sends `beats`, one per frame: how long it holds
    and, for an MP4, the clips that run over it (a video of the case, the part of it,
    its box in pixels) and which of the see-through pictures stands over them. A
    clip's file is found inside the case, and must be a video. An MP4's beat can open
    on its transition, frames of the transitions' series played before it holds.

    `into=case` files it in the case instead (`_file_export`), for a post to carry: the
    saved `plate` it shows, a page's `day` and `step` or an evolution `sheet`, and the
    credits its face carries. A PDF is a document to print and stays out of it.
    """
    case = get_case(case_id)
    played = format in ("gif", "mp4")
    if played and (frames or not staged):
        raise HTTPException(status_code=422, detail="a played plate sends its pictures before it")
    if not played and (len(frames) != 1 or staged):
        raise HTTPException(status_code=422, detail="a page is one picture")
    rel = ""
    if into == "case":
        if format == "pdf":
            raise HTTPException(status_code=422, detail="a PDF is written out, not filed in the case")
        stem = existing_stem(plate, mapplates.FALLBACK)
        rel = layout.map_plate_rel(stem)
        if not plate.strip() or _read(case, stem) is None or case.find_entity(attr="spec", value=rel) is None:
            raise HTTPException(status_code=404, detail="save the plate before filing what it exports")
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
    if into == "case":
        shows = "played" if played else kind
        return _file_export(case, rel, data, filename, format, shows=shows, attribution=attribution,
                            day=day if shows == "page" else "", step=step if shows == "page" else "")
    name = f"{layout.slugify(filename, mapplates.FALLBACK)}.{format}"
    try:
        destination = exportdir.destination("views", case.path)
        path = exportdir.write_out(data, destination, name)
    except (OSError, exportdir.ExportDirError) as exc:
        raise HTTPException(status_code=409, detail=f"could not write the export: {errors.explain(exc)}") from exc
    return {"file": path.name, "path": str(destination), "format": format}


def _file_export(case: Case, rel: str, data: bytes, filename: str, format: str, *, shows: str,
                 attribution: str, day: str, step: str) -> dict[str, Any]:
    """File an export of the saved plate `rel` in the case, as a media file that names it.

    What a post carries goes in through here (Map plate's To Post): the page as a PNG,
    its days side by side, or its days played as a GIF or an MP4. Like a figure it
    names its plate, a page's day and step, and the credits its face carries, so it
    opens its plate again from a note and a rename of the plate carries it along. The
    same bytes filed from this plate before are cited again rather than kept twice.
    """
    digest = hashlib.sha256(data).hexdigest()
    before = case.find_entity(attr="sha256", value=digest)
    if before is not None and (before.get("attrs") or {}).get(mapplates.FIGURE_ATTR) == rel:
        kept = str((before.get("attrs") or {}).get("path") or "")
        return {"file": PurePosixPath(kept).name, "path": kept, "entity": before["id"], "format": format, "reused": True}
    source: dict[str, Any] = {
        "type": mapplates.SOURCE_TYPE,
        "plate": rel,
        "kind": shows,
        "rendered_at": _now(),
        # the plate's face carries its credits
        "attribution_burned": True,
    }
    attrs: dict[str, Any] = {mapplates.FIGURE_ATTR: rel}
    if day:
        source["day"] = attrs["plate_day"] = day
    if step:
        source["step"] = attrs["plate_step"] = step
    if attribution.strip():
        source["attribution"] = attribution.strip()
    try:
        filed = media_engine.import_rendered_bytes(case, data, filename, f".{format}", source, by=mapplates.PRODUCER,
                                                   extra_attrs=attrs)
    except (OSError, ValueError, CaseError) as exc:
        raise HTTPException(status_code=409, detail=f"could not file the export: {errors.explain(exc)}") from exc
    path = filed["item"]["path"]
    return {"file": PurePosixPath(path).name, "path": path, "entity": filed["entity"]["id"], "format": format}



@router.post("/cases/{case_id}/map-plates/{name}/figure")
async def file_figure(
    case_id: str,
    name: str,
    frame: UploadFile = File(),
    filename: str = Form(min_length=1, max_length=120),
    kind: Literal["page", "sheet"] = Form(default="page"),
    day: str = Form(default="", max_length=40),
    step: str = Form(default="", max_length=64),
    attribution: str = Form(default="", max_length=FIGURE_CREDIT_MAX),
    reuse: bool = Form(default=False),
) -> dict[str, Any]:
    """File a picture of a saved plate in the case, for a note to show.

    A page at print resolution, or the page on each of its days side by side (an
    evolution sheet, what a printed report holds where a video cannot go). It is
    an ordinary media file that says which plate, which day and which step it
    shows, and the credits its face carries, so it can be hashed, cited and found
    again, and the note can open the plate where it was taken. The same plate, day,
    step and size are one figure, which a second press cites rather than files again.
    """
    case = get_case(case_id)
    stem = existing_stem(name, mapplates.FALLBACK)
    rel = layout.map_plate_rel(stem)
    saved = _read(case, stem)
    if saved is None or case.find_entity(attr="spec", value=rel) is None:
        raise HTTPException(status_code=404, detail="save the plate before filing its pictures")
    raw = await frame.read(mapplates.MAX_PAGE_BYTES + 1)
    try:
        page = mapplates.picture(raw, max_bytes=mapplates.MAX_PAGE_BYTES, max_pixels=mapplates.MAX_PAGE_PIXELS)
    except mapplates.ExportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # What decides the pixels: the plate as saved, what it was read on, and how large it is drawn.
    state_key = snapshots.view_key(mapplates.SOURCE_TYPE, plate=rel, spec=saved.get("spec"), shows=kind,
                                   day=day, step=step, size=[page.width, page.height])
    if reuse and (filed := snapshots.filed_view(case, state_key)) is not None:
        return {"path": (filed.get("attrs") or {}).get("path"), "entity": filed["id"], "reused": True}
    data = await run_in_threadpool(mapplates.png_bytes, page)
    source: dict[str, Any] = {
        "type": mapplates.SOURCE_TYPE,
        "plate": rel,
        "kind": kind,
        "rendered_at": _now(),
        # the plate's face carries its credits
        "attribution_burned": True,
        snapshots.VIEW_KEY: state_key,
    }
    attrs: dict[str, Any] = {mapplates.FIGURE_ATTR: rel, snapshots.VIEW_KEY: state_key}
    if day:
        source["day"] = attrs["plate_day"] = day
    if step:
        source["step"] = attrs["plate_step"] = step
    if attribution.strip():
        source["attribution"] = attribution.strip()
    try:
        filed_new = media_engine.import_rendered_bytes(case, data, filename, ".png", source, by=mapplates.PRODUCER,
                                                       extra_attrs=attrs)
    except (OSError, ValueError, CaseError) as exc:
        raise HTTPException(status_code=409, detail=f"could not file the picture: {errors.explain(exc)}") from exc
    return {"path": filed_new["item"]["path"], "entity": filed_new["entity"]["id"]}
