"""REST API for the Examine tools: probe media, capture frames, apply
adjustments, keep each file's work, lay out collages, run analyses.

Outputs are filed as ordinary case media (they appear in the Media Library and
the Proof Composer picker with zero extra plumbing). Long scans run as jobs.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from .. import jobs
from .. import layout
from ..engine import artifacts as artifact_engine
from ..engine import inspect as inspect_engine
from ..engine import inspectwork
from ..workspace import CaseError
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


class ComposeIn(BaseModel):
    width: int = Field(ge=16, le=8192)
    height: int = Field(ge=16, le=8192)
    nodes: list[ComposeNode] = Field(min_length=1)
    background: str | None = "#12141c"  # None → transparent (RGBA) canvas
    label: str | None = Field(default=None, max_length=200)
    folder: str | None = None
    notes: str | None = Field(default=None, max_length=2000)


class StitchIn(BaseModel):
    width: int = Field(ge=16, le=8192)
    height: int = Field(ge=16, le=8192)
    nodes: list[NodeSrc] = Field(min_length=2)
    # 'planar' keeps pieces hand-warpable; the panorama modes trade that for a
    # bounded, undistorted strip (see engine/stitch).
    mode: Literal["planar", "cylindrical", "spherical"] = "planar"


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
        return {
            "frames": inspect_engine.suggest_frames(
                case, body.path, body.count, body.min_gap, set_progress
            )
        }

    return {"job_id": jobs.start("suggest", work)}


@router.post("/cases/{case_id}/inspect/render-preview")
def render_preview(case_id: str, body: RenderPreviewIn) -> Response:
    """Render a recipe (frame/image + ops) to a PNG — nothing is filed.

    Backs frame previews and collage pieces, and rebuilding both when a work or
    a collage is reopened.
    """
    case = get_case(case_id)
    ops = [op.model_dump() for op in body.ops]
    try:
        png = inspect_engine.render_preview_png(case, body.path, time_s=body.time, ops=ops)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(content=png, media_type="image/png")


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
    try:
        return inspect_engine.compose_perspective(
            case, width=body.width, height=body.height, nodes=nodes,
            background=body.background, label=body.label, folder=body.folder,
            notes=body.notes,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/cases/{case_id}/inspect/auto-stitch")
def auto_stitch(case_id: str, body: StitchIn) -> dict[str, Any]:
    """Solve collage placement for overlapping pieces — nothing is filed.

    The pieces stay live on the canvas afterwards (spec § v2 Panorama: machine
    stitch first, hand-tune after), so this returns a recipe, not pixels: a quad
    each, plus — in the panorama modes — the remap op that shapes the piece.
    """
    case = get_case(case_id)
    srcs = [
        {**n.model_dump(exclude={"ops"}), "ops": [op.model_dump() for op in n.ops]}
        for n in body.nodes
    ]
    try:
        return inspect_engine.solve_collage_layout(
            case, srcs=srcs, width=body.width, height=body.height, mode=body.mode
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
        return inspectwork.save_work(case, body.path, body.spec)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


@router.delete("/cases/{case_id}/collages/{name}")
def delete_collage(case_id: str, name: str) -> dict[str, Any]:
    """Delete the layout. A picture already exported from it stays in Media."""
    case = get_case(case_id)
    rel = layout.collage_rel(slugify(name, "Collage"))
    try:
        case.resolve_inside(rel)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    result = delete_by_path(case, rel)
    if not result["deleted"]:
        artifact_engine.delete(case, {"type": inspectwork.COLLAGE_TYPE, "attrs": {"spec": rel}})
    return result
