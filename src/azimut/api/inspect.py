"""REST API for the Examine tools: probe media, capture frames, apply
adjustments, keep each file's work, lay out collages, run analyses.

Outputs are filed as ordinary case media (they appear in the Media Library and
the Proof Composer picker with zero extra plumbing). Long scans run as jobs.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from .. import jobs
from .. import layout
from ..engine import artifacts as artifact_engine
from ..engine import geolocate
from ..engine import inspect as inspect_engine
from ..engine import inspectwork
from ..engine import scenes as scenes_engine
from ..workspace import CaseError
from . import events
from .cases import delete_by_path, get_case
from .naming import slugify

router = APIRouter(prefix="/api", tags=["inspect"])


class SuggestIn(BaseModel):
    path: str
    # How many suggestions to return. Every frame is scanned regardless — this
    # only sizes the shortlist.
    count: int = Field(default=12, ge=1, le=inspect_engine.SUGGEST_CAP)
    min_gap: float | None = Field(default=None, ge=0, le=60)


class Op(BaseModel):
    op: str
    params: dict[str, Any] = {}


class RenderPreviewIn(BaseModel):
    path: str
    time: float | None = Field(default=None, ge=0)
    ops: list[Op] = []
    format: Literal["png", "jpeg"] = "png"
    # Snap `time` to the frame a player shows at that moment and say which in the
    # X-Frame-Time header. Off, `time` is used exactly as sent.
    snap: bool = False


class FrameSpec(BaseModel):
    path: str
    time: float | None = Field(default=None, ge=0)
    ops: list[Op] = []
    label: str | None = Field(default=None, max_length=200)


class SaveFramesIn(BaseModel):
    items: list[FrameSpec] = Field(min_length=1)
    folder: str | None = None
    notes: str | None = Field(default=None, max_length=2000)


class NodeSrc(BaseModel):
    path: str
    time: float | None = Field(default=None, ge=0)
    ops: list[Op] = []


class ComposeNode(BaseModel):
    src: NodeSrc
    quad: list[tuple[float, float]] = Field(min_length=4, max_length=4)


class Cut(BaseModel):
    """A frame over the collage, canvas pixels: the picture keeps what lies inside it."""

    x: float = Field(ge=-inspectwork.MAX_CLIP, le=inspectwork.MAX_CLIP, allow_inf_nan=False)
    y: float = Field(ge=-inspectwork.MAX_CLIP, le=inspectwork.MAX_CLIP, allow_inf_nan=False)
    w: float = Field(gt=0, le=inspectwork.MAX_CLIP, allow_inf_nan=False)
    h: float = Field(gt=0, le=inspectwork.MAX_CLIP, allow_inf_nan=False)


class ComposeIn(BaseModel):
    width: int = Field(ge=16, le=8192)
    height: int = Field(ge=16, le=8192)
    nodes: list[ComposeNode] = Field(min_length=1)
    background: str | None = "#12141c"  # None → transparent (RGBA) canvas
    label: str | None = Field(default=None, max_length=200)
    folder: str | None = None
    notes: str | None = Field(default=None, max_length=2000)
    # Collage → Cut: the picture is cropped to this frame, the pieces left whole
    clip: Cut | None = None
    # The saved collage this is the export of, recorded on the picture
    collage: str | None = Field(default=None, max_length=200)


class StraightenNode(ComposeNode):
    # the name its bent picture is filed under
    label: str | None = Field(default=None, max_length=200)


class StraightenIn(BaseModel):
    # the canvas the collage is bent on, room for the bend included
    width: int = Field(ge=16, le=8192)
    height: int = Field(ge=16, le=8192)
    nodes: list[StraightenNode] = Field(min_length=1, max_length=inspectwork.MAX_PIECES)
    # each column's downward shift, pixels: one for every column of the canvas
    bend: list[float] = Field(min_length=16, max_length=8192)
    folder: str | None = None


class StitchIn(BaseModel):
    width: int = Field(ge=16, le=8192)
    height: int = Field(ge=16, le=8192)
    nodes: list[NodeSrc] = Field(min_length=2, max_length=inspectwork.MAX_PIECES)
    # 'planar' keeps pieces hand-warpable; the panorama modes trade that for a
    # bounded, undistorted strip (see engine/stitch).
    mode: Literal["planar", "cylindrical", "spherical"] = "planar"
    # The areas painted out of each piece, one entry per node (null: none), checked
    # by the rule the saved collage keeps them under (`inspectwork.clean_exclude`).
    exclude: list[list[dict[str, Any]] | None] | None = Field(default=None, max_length=inspectwork.MAX_PIECES)

    @field_validator("exclude")
    @classmethod
    def _strokes(cls, value: list[list[dict[str, Any]] | None] | None) -> list[list[dict[str, Any]] | None] | None:
        if value is None:
            return None
        try:
            return [inspectwork.clean_exclude(strokes) or None for strokes in value]
        except CaseError as exc:
            raise ValueError(str(exc)) from exc

    @model_validator(mode="after")
    def _one_entry_per_node(self) -> StitchIn:
        if self.exclude is not None and len(self.exclude) != len(self.nodes):
            raise ValueError("exclude needs one entry per node")
        return self


class EnhanceVideoIn(BaseModel):
    path: str
    params: dict[str, Any] = {}
    rotation: Literal[-180, -90, 0, 90, 180] = 0
    label: str | None = Field(default=None, max_length=200)
    folder: str | None = None
    notes: str | None = Field(default=None, max_length=2000)


class AnalyzeIn(BaseModel):
    path: str
    name: str
    params: dict[str, Any] = {}
    time: float | None = Field(default=None, ge=0)
    ops: list[Op] = []


class WorkIn(BaseModel):
    # The file the work belongs to. The spec holds its frames and their edits as
    # recipes; `engine/inspectwork` documents the shape and bounds it.
    path: str = Field(min_length=1)
    spec: dict[str, Any]


class CollageIn(BaseModel):
    # The name the tool has the collage open under, absent for one never saved.
    # A title different from it is a rename.
    name: str | None = Field(default=None, max_length=200)
    title: str = Field(min_length=1, max_length=200)
    spec: dict[str, Any]


@router.get("/inspect/ops")
def ops() -> dict[str, Any]:
    """Self-describing filter + analysis registries (drives the UI controls)."""
    return inspect_engine.registries()


@router.get("/cases/{case_id}/inspect/probe")
def probe(case_id: str, path: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        return inspect_engine.probe(case, path)
    except (CaseError, FileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/cases/{case_id}/inspect/suggest")
def suggest_frames(case_id: str, body: SuggestIn) -> dict[str, str]:
    case = get_case(case_id)

    def work(set_progress):
        return inspect_engine.suggest_frames(
            case, body.path, body.count, body.min_gap, set_progress
        )

    return {"job_id": jobs.start("suggest", work)}


class OverviewIn(BaseModel):
    path: str = Field(min_length=1)


@router.post("/cases/{case_id}/inspect/overview")
def video_overview(case_id: str, body: OverviewIn) -> dict[str, Any]:
    """A video's hover thumbnails and waveform, plus its last focus scan.

    Cached: the overview comes straight back, otherwise a job makes it. Either way
    ``scan`` is the last saved focus scan (frames and shots), or null.
    """
    case = get_case(case_id)
    try:
        scan = inspect_engine.cached_scan(case, body.path)
        overview = inspect_engine.cached_overview(case, body.path)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if overview is not None:
        return {"overview": overview, "scan": scan}

    def work(set_progress):
        return inspect_engine.video_overview(case, body.path, set_progress)

    return {"job_id": jobs.start("overview", work), "scan": scan}


@router.get("/cases/{case_id}/inspect/overview/strip")
def video_overview_strip(case_id: str, path: str) -> FileResponse:
    """The tile sprite of a video's overview (404 until it has been made)."""
    case = get_case(case_id)
    try:
        strip = inspect_engine.overview_strip(case, path)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if strip is None:
        raise HTTPException(status_code=404, detail="no overview has been made for this video")
    return FileResponse(strip, media_type="image/jpeg", headers={"Cache-Control": "no-cache"})


@router.post("/cases/{case_id}/inspect/render-preview")
def render_preview(case_id: str, body: RenderPreviewIn) -> Response:
    """Render a recipe (frame/image + ops) to a PNG or JPEG — nothing is filed.

    Backs frame previews and collage pieces, and rebuilding both when a work or
    a collage is reopened.
    """
    case = get_case(case_id)
    ops = [op.model_dump() for op in body.ops]
    time_s = body.time
    try:
        if body.snap and time_s is not None:
            snapped = inspect_engine.frame_time_at(case.resolve_inside(body.path), time_s)
            time_s = time_s if snapped is None else snapped
        data, media_type = inspect_engine.render_preview(
            case, body.path, time_s=time_s, ops=ops, fmt=body.format
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    headers = {"X-Frame-Time": f"{time_s:.6f}"} if body.snap and time_s is not None else None
    return Response(content=data, media_type=media_type, headers=headers)


@router.post("/cases/{case_id}/inspect/save-frames")
def save_frames(case_id: str, body: SaveFramesIn) -> dict[str, Any]:
    """File frames as case media (Save to case)."""
    case = get_case(case_id)
    results = []
    try:
        for item in body.items:
            ops = [op.model_dump() for op in item.ops]
            results.append(
                inspect_engine.save_frame(
                    case, item.path, time_s=item.time, ops=ops,
                    label=item.label, folder=body.folder, notes=body.notes,
                )
            )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"saved": results}


@router.post("/cases/{case_id}/inspect/compose")
def compose(case_id: str, body: ComposeIn) -> dict[str, Any]:
    """Composite a perspective-warped collage from frames and case images (Save to case)."""
    case = get_case(case_id)
    nodes: list[dict[str, Any]] = []
    for n in body.nodes:
        src = n.src.model_dump(exclude={"ops"})
        src["ops"] = [op.model_dump() for op in n.src.ops]
        nodes.append({"src": src, "quad": [list(pt) for pt in n.quad]})
    # the picture this collage exported before, whose mark follows the new one
    before = inspectwork.collage_export(case, body.collage) if body.collage else None
    clip = (body.clip.x, body.clip.y, body.clip.w, body.clip.h) if body.clip else None
    try:
        made = inspect_engine.compose_perspective(
            case, width=body.width, height=body.height, nodes=nodes,
            background=body.background, label=body.label, folder=body.folder,
            notes=body.notes, clip=clip, collage=body.collage,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    after = (made.get("item") or {}).get("path")
    if before and after and before != after:
        follow_mark(case, before, after)
    return made


@router.post("/cases/{case_id}/inspect/straighten")
def straighten(case_id: str, body: StraightenIn) -> dict[str, Any]:
    """Collage → Straighten: bend every piece by the line's column shifts and file one
    picture each, all or none. Answers ``pieces``, each as filed with its ``box`` on the
    bent canvas (left, top, right, bottom), in the order sent."""
    case = get_case(case_id)
    nodes = [
        {
            "src": {**n.src.model_dump(exclude={"ops"}), "ops": [op.model_dump() for op in n.src.ops]},
            "quad": [list(pt) for pt in n.quad],
            "label": n.label,
        }
        for n in body.nodes
    ]
    try:
        pieces = inspect_engine.straighten_pieces(
            case, width=body.width, height=body.height, nodes=nodes, bend=body.bend,
            folder=body.folder, discard=lambda path: _take_back(case, path),
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"pieces": pieces}


def _take_back(case: Any, path: str) -> None:
    """A picture a straighten filed before one of its pieces failed: gone again."""
    if not delete_by_path(case, path)["deleted"]:
        artifact_engine.delete(case, {"type": "media", "attrs": {"path": path}})


def follow_mark(case: Any, before: str, after: str) -> None:
    """A collage saved again: a mark to geolocate on its last picture, not proved yet,
    moves to the new one with its captures. A proved picture keeps what proved it."""
    if scenes_engine.laid_out_by(scenes_engine.proof_specs(case), before):
        return
    try:
        moved = inspectwork.move_scenes(case, before, after)
    except CaseError:
        return
    if not moved:
        return
    if geolocate.repath(case, before, after, {scene["id"] for scene in moved}):
        say_geolocating(case)
    events.publish({"type": "scenes", "case_id": case.id, "video": after})


@router.post("/cases/{case_id}/inspect/auto-stitch")
def auto_stitch(case_id: str, body: StitchIn) -> dict[str, Any]:
    """Solve collage placement for overlapping pieces — nothing is filed.

    The pieces stay live on the canvas afterwards (spec § v2 Panorama: machine
    stitch first, hand-tune after), so this returns a recipe, not pixels: a quad
    each, plus — in the panorama modes — the remap op that shapes the piece.
    ``exclude`` keeps the matcher off what the analyst painted out of a piece.
    """
    case = get_case(case_id)
    srcs = [
        {**n.model_dump(exclude={"ops"}), "ops": [op.model_dump() for op in n.ops]}
        for n in body.nodes
    ]
    try:
        return inspect_engine.solve_collage_layout(
            case, srcs=srcs, width=body.width, height=body.height, mode=body.mode,
            exclude=body.exclude,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/cases/{case_id}/inspect/enhance-video")
def enhance_video(case_id: str, body: EnhanceVideoIn) -> dict[str, Any]:
    """Re-encode a video with its adjustments and orientation, then file it."""
    case = get_case(case_id)
    try:
        return inspect_engine.enhance_video(
            case, body.path, body.params, rotation=body.rotation,
            label=body.label, folder=body.folder, notes=body.notes,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/cases/{case_id}/inspect/analyze")
def analyze(case_id: str, body: AnalyzeIn) -> dict[str, Any]:
    case = get_case(case_id)
    ops = [op.model_dump() for op in body.ops]
    try:
        return inspect_engine.run_analysis(
            case, body.path, body.name, body.params, time_s=body.time, ops=ops
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Work, one per file, saved as it is made; and collages, one document each.
# `engine/inspectwork` owns both shapes and the merge that brought older
# sessions into them.
# ---------------------------------------------------------------------------


@router.get("/cases/{case_id}/inspect/works")
def list_works(case_id: str) -> list[dict[str, Any]]:
    return inspectwork.list_works(get_case(case_id))


@router.get("/cases/{case_id}/inspect/work")
def get_work(case_id: str, path: str) -> dict[str, Any]:
    """The work saved for one file. Nothing done to it yet answers `work: null`."""
    case = get_case(case_id)
    try:
        return {"work": inspectwork.find_work(case, path)}
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/cases/{case_id}/scenes")
def list_scenes(case_id: str, video: str) -> dict[str, Any]:
    """The scenes of one video: the proofs resting on it and the stretches still to prove."""
    case = get_case(case_id)
    # the collages composed from its frames alone, placed among its scenes by time
    collages = scenes_engine.video_collages(case, video)
    # the proofs read once, for the list and for the scene being geolocated
    proofs = scenes_engine.read_proofs(case)
    try:
        found = scenes_engine.video_scenes(case, video, proofs, collages=[row["times"] for row in collages])
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    held = geolocate.current(case, proofs)
    return {
        **found,
        # the scene of this video being geolocated, which Inspect marks in its list
        "geolocating": held["id"] if held and held["video"] == video else None,
        "collages": collages,
    }


@router.get("/cases/{case_id}/scenes/{draft}/frames")
def list_draft_frames(case_id: str, draft: str, video: str) -> dict[str, Any]:
    """The frames Inspect cut inside one scene still to prove, in clip order, with the
    picture each was saved as, if any: what Geo Proof offers to make it a slide."""
    case = get_case(case_id)
    try:
        frames = scenes_engine.draft_frames(case, video, draft)
    except scenes_engine.UnknownDraft as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except scenes_engine.BadScene as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"frames": frames}


# -- geolocating a scene (engine/geolocate.py) ----------------------------------------


class GeolocateIn(BaseModel):
    video: str = Field(min_length=1, max_length=1024)
    draft: str = Field(min_length=1, max_length=64)


class AbandonIn(BaseModel):
    video: str = Field(min_length=1, max_length=1024)
    reason: str = Field(default="", max_length=geolocate.MAX_REASON)


def say_geolocating(case: Any) -> dict[str, Any] | None:
    """Tell every open surface, the app's tabs and the extension's map panels, which
    scene the case is geolocating now, and answer with it."""
    held = geolocate.current(case)
    events.publish({
        "type": "geolocating", "case_id": case.id,
        "video": held["video"] if held else None, "draft": held["id"] if held else None,
    })
    return held


def attach_capture(case: Any, path: str) -> dict[str, Any] | None:
    """Attach a capture just filed to the scene the case is geolocating, if any, so the
    capture's answer can say which. Every route that files a capture calls this."""
    scene = geolocate.attach(case, path)
    if scene is not None:
        # said at once, with the capture and the count: the pills update without reading
        # the scene again, which walks every proof of the case
        events.publish({
            "type": "geolocating", "case_id": case.id, "video": scene["video"], "draft": scene["id"],
            "capture": path, "captures": scene["captures"],
        })
    return scene


class MarkIn(BaseModel):
    path: str = Field(min_length=1, max_length=1024)
    label: str = Field(default="", max_length=inspectwork.MAX_SCENE_LABEL)
    # on a video (or a collage of one): a moment, its end making it a passage
    start: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    end: float | None = Field(default=None, ge=0, allow_inf_nan=False)


@router.post("/cases/{case_id}/scenes/mark")
def mark_to_geolocate(case_id: str, body: MarkIn) -> dict[str, Any]:
    """Mark a picture or a video to geolocate, from the Media Library or the Collage tool:
    a picture whole, a video whole or over a moment, a collage of one video's frames as
    that video. Answers with the scene, or the one already there."""
    case = get_case(case_id)
    try:
        scene = geolocate.mark(case, body.path, body.label, body.start, body.end)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    events.publish({"type": "scenes", "case_id": case.id, "video": scene["video"]})
    return {"scene": scene}


@router.get("/cases/{case_id}/scenes/queue")
def scene_queue(case_id: str) -> dict[str, Any]:
    """Every scene still to prove in the case, by file, and the one being geolocated,
    with the proofs made for a scene that state no place yet."""
    return geolocate.queue(get_case(case_id), with_proofs=True)


@router.get("/cases/{case_id}/geolocating")
def geolocating(case_id: str) -> dict[str, Any]:
    return {"geolocating": geolocate.current(get_case(case_id))}


@router.put("/cases/{case_id}/geolocating")
def start_geolocating(case_id: str, body: GeolocateIn) -> dict[str, Any]:
    """Geolocate a scene: from now on every capture filed in the case is attached to it."""
    case = get_case(case_id)
    try:
        geolocate.start(case, body.video, body.draft)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"geolocating": say_geolocating(case)}


@router.delete("/cases/{case_id}/geolocating")
def stop_geolocating(case_id: str) -> dict[str, Any]:
    case = get_case(case_id)
    ended = geolocate.stop(case)
    if ended:
        say_geolocating(case)
    return {"ended": ended}


class MomentIn(BaseModel):
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float | None = Field(default=None, ge=0, allow_inf_nan=False)


class RetimeIn(BaseModel):
    video: str = Field(min_length=1, max_length=1024)
    # both null for the whole video, no end for an instant
    start: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    end: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    # the moments after the first, for a scene showing its place again further on
    more: list[MomentIn] | None = Field(default=None, max_length=inspectwork.MAX_SCENE_MOMENTS)


@router.put("/cases/{case_id}/scenes/{draft}/time")
def retime_scene(case_id: str, draft: str, body: RetimeIn) -> dict[str, Any]:
    """Give a scene to prove a new time, the rest of its video's work untouched. Answers
    with the time it had, for an Undo."""
    case = get_case(case_id)
    more = [m.model_dump() for m in body.more] if body.more else None
    try:
        before = inspectwork.retime_scene(case, body.video, draft, body.start, body.end, more)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    events.publish({"type": "scenes", "case_id": case.id, "video": body.video})
    return {"before": before}


class JoinIn(BaseModel):
    video: str = Field(min_length=1, max_length=1024)
    # the scene this one shows the same place as, which it joins
    into: str = Field(min_length=1, max_length=64)


@router.post("/cases/{case_id}/scenes/{draft}/join")
def join_scene(case_id: str, draft: str, body: JoinIn) -> dict[str, Any]:
    """Same place as…: a scene to prove joins another of its video, their moments, labels
    and captures in one scene. Answers with it, and what an Undo hands back."""
    case = get_case(case_id)
    try:
        answer = geolocate.join(case, body.video, draft, body.into)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if answer.pop("moved"):
        say_geolocating(case)
    events.publish({"type": "scenes", "case_id": case.id, "video": body.video})
    return answer


class UnjoinIn(BaseModel):
    video: str = Field(min_length=1, max_length=1024)
    # both scenes as the join answered them, and the one geolocated then, if it moved
    kept: dict[str, Any]
    gone: dict[str, Any]
    geolocating: str | None = Field(default=None, max_length=64)


@router.post("/cases/{case_id}/scenes/{draft}/unjoin")
def unjoin_scene(case_id: str, draft: str, body: UnjoinIn) -> dict[str, Any]:
    """Undo a join: both scenes back as they were, ids, captures and all."""
    if body.kept.get("id") != draft:
        raise HTTPException(status_code=400, detail="that is not the scene joined into")
    case = get_case(case_id)
    try:
        answer = geolocate.unjoin(case, body.video, body.kept, body.gone, body.geolocating)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if answer.pop("moved"):
        say_geolocating(case)
    events.publish({"type": "scenes", "case_id": case.id, "video": body.video})
    return answer


@router.put("/cases/{case_id}/scenes/{draft}/abandon")
def abandon_scene(case_id: str, draft: str, body: AbandonIn) -> dict[str, Any]:
    """Give up on a scene to prove, with a word if there is one. It stays, greyed."""
    case = get_case(case_id)
    was = geolocate.current(case)
    try:
        scene = geolocate.abandon(case, body.video, draft, body.reason)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if was and was["id"] == draft:
        say_geolocating(case)
    # the queue changed wherever it is shown: the other tabs and the extension's panel
    events.publish({"type": "scenes", "case_id": case.id, "video": body.video})
    return {"scene": scene}


@router.delete("/cases/{case_id}/scenes/{draft}/abandon")
def restore_scene(case_id: str, draft: str, video: str) -> dict[str, Any]:
    """Take an abandoned scene up again, as it was."""
    case = get_case(case_id)
    try:
        scene = geolocate.restore(case, video, draft)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    events.publish({"type": "scenes", "case_id": case.id, "video": video})
    return {"scene": scene}


class ProofAbandonIn(BaseModel):
    reason: str = Field(default="", max_length=geolocate.MAX_REASON)


@router.put("/cases/{case_id}/proofs/{name}/abandon")
def abandon_proof(case_id: str, name: str, body: ProofAbandonIn) -> dict[str, Any]:
    """Give up on a proof that states no place yet, as on a scene: it stays, greyed."""
    case = get_case(case_id)
    try:
        answer = geolocate.abandon_proof(case, name, body.reason)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    events.publish({"type": "scenes", "case_id": case.id, "video": answer["video"]})
    return answer


@router.delete("/cases/{case_id}/proofs/{name}/abandon")
def restore_proof(case_id: str, name: str) -> dict[str, Any]:
    """Take an abandoned proof up again."""
    case = get_case(case_id)
    try:
        answer = geolocate.restore_proof(case, name)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    events.publish({"type": "scenes", "case_id": case.id, "video": answer["video"]})
    return answer


@router.get("/cases/{case_id}/inspect/works/{name}")
def load_work(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        work = inspectwork.load_work(case, name)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if work is None:
        raise HTTPException(status_code=404, detail="nothing was inspected under that name")
    return work


@router.put("/cases/{case_id}/inspect/work")
def save_work(case_id: str, body: WorkIn) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        saved = inspectwork.save_work(case, body.path, body.spec)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # its scenes moved: the To-do and the extension's queue read them again. An autosave
    # that changed nothing about them says nothing.
    if saved.pop("scenes_moved"):
        events.publish({"type": "scenes", "case_id": case.id, "video": body.path})
    return saved


@router.delete("/cases/{case_id}/inspect/work")
def delete_work(case_id: str, path: str) -> dict[str, Any]:
    """Clear one file's work. It goes to the Trash, so the reset can be taken back."""
    case = get_case(case_id)
    try:
        rel = inspectwork.work_rel(case, path)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if rel is None:
        return {"status": "deleted", "deleted": [], "tombstoned": []}
    result = delete_by_path(case, rel)
    if not result["deleted"]:  # never filed as an entity: drop the file anyway
        artifact_engine.delete(case, {"type": inspectwork.WORK_TYPE, "attrs": {"spec": rel}})
    return result


@router.get("/cases/{case_id}/collages")
def list_collages(case_id: str) -> list[dict[str, Any]]:
    return inspectwork.list_collages(get_case(case_id))


@router.get("/cases/{case_id}/collages/{name}")
def load_collage(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        collage = inspectwork.load_collage(case, name)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if collage is None:
        raise HTTPException(status_code=404, detail="collage not found")
    return collage


@router.post("/cases/{case_id}/collages")
def save_collage(case_id: str, body: CollageIn) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        return inspectwork.save_collage(case, body.name, body.title, body.spec)
    except inspectwork.NameTaken as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/cases/{case_id}/collages/{name}/thumb")
async def save_collage_thumb(case_id: str, name: str, file: UploadFile) -> dict[str, Any]:
    """The picture the collage list shows for it, drawn by the browser from the layout."""
    case = get_case(case_id)
    raw = await file.read(inspectwork.MAX_THUMB_BYTES + 1)
    try:
        saved = inspectwork.save_collage_thumb(case, name, raw)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if saved is None:
        raise HTTPException(status_code=404, detail="collage not found")
    return saved


def collage_spec(name: str) -> str:
    """The record a collage's name stands for, as its delete and its preview read it."""
    return layout.collage_rel(slugify(name, "Collage"))


@router.delete("/cases/{case_id}/collages/{name}")
def delete_collage(case_id: str, name: str) -> dict[str, Any]:
    """Delete the layout. A picture already exported from it stays in Media."""
    case = get_case(case_id)
    rel = collage_spec(name)
    try:
        case.resolve_inside(rel)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    result = delete_by_path(case, rel)
    if not result["deleted"]:
        artifact_engine.delete(case, {"type": inspectwork.COLLAGE_TYPE, "attrs": {"spec": rel}})
    return result
