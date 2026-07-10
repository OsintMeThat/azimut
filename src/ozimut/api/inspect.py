"""REST API for the Inspect tool: probe media, capture frames, apply
adjustments, build collages, run analyses.

Outputs are filed as ordinary case media (they appear in the Media Library and
the Proof Composer picker with zero extra plumbing). Long scans run as jobs.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from .. import jobs
from ..engine import inspect as inspect_engine
from ..workspace import CaseError
from .cases import get_case

router = APIRouter(prefix="/api", tags=["inspect"])


class FrameIn(BaseModel):
    path: str
    time: float = Field(ge=0)
    label: str | None = None


class FramesIn(BaseModel):
    path: str
    times: list[float]


class SuggestIn(BaseModel):
    path: str
    bins: int = Field(default=12, ge=1, le=inspect_engine.FRAME_SCAN_CAP)


class Op(BaseModel):
    op: str
    params: dict[str, Any] = {}


class BakeIn(BaseModel):
    path: str
    ops: list[Op]
    label: str | None = None


class CollageIn(BaseModel):
    paths: list[str] = Field(min_length=1)
    columns: int = Field(default=2, ge=1, le=8)
    gap: int = Field(default=8, ge=0, le=64)
    background: str = "#12141c"
    cell: int = Field(default=480, ge=64, le=1024)
    label: str | None = None


class PreviewIn(BaseModel):
    path: str
    time: float = Field(ge=0)


class RenderPreviewIn(BaseModel):
    path: str
    time: float | None = Field(default=None, ge=0)
    ops: list[Op] = []


class FrameSpec(BaseModel):
    path: str
    time: float | None = Field(default=None, ge=0)
    ops: list[Op] = []
    label: str | None = None


class SaveFramesIn(BaseModel):
    items: list[FrameSpec] = Field(min_length=1)
    folder: str | None = None


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
    label: str | None = None
    folder: str | None = None


class EnhanceVideoIn(BaseModel):
    path: str
    params: dict[str, Any] = {}
    label: str | None = None
    folder: str | None = None


class AnalyzeIn(BaseModel):
    path: str
    name: str
    params: dict[str, Any] = {}
    time: float | None = Field(default=None, ge=0)
    ops: list[Op] = []


class SessionIn(BaseModel):
    name: str | None = None  # slug; None → derived from title
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


@router.post("/cases/{case_id}/inspect/frame")
def capture_frame(case_id: str, body: FrameIn) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        return inspect_engine.capture_frame(case, body.path, body.time, body.label)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/cases/{case_id}/inspect/frames")
def capture_frames(case_id: str, body: FramesIn) -> dict[str, str]:
    case = get_case(case_id)

    def work(set_progress):
        results = []
        total = len(body.times) or 1
        for i, t in enumerate(body.times):
            results.append(inspect_engine.capture_frame(case, body.path, t))
            set_progress({"percent": round((i + 1) * 100 / total, 1)})
        return {"captured": results}

    return {"job_id": jobs.start("frames", work)}


@router.post("/cases/{case_id}/inspect/suggest")
def suggest_frames(case_id: str, body: SuggestIn) -> dict[str, str]:
    case = get_case(case_id)

    def work(set_progress):
        return {"frames": inspect_engine.suggest_frames(case, body.path, body.bins, set_progress)}

    return {"job_id": jobs.start("suggest", work)}


@router.post("/cases/{case_id}/inspect/bake")
def bake(case_id: str, body: BakeIn) -> dict[str, Any]:
    case = get_case(case_id)
    ops = [op.model_dump() for op in body.ops]
    try:
        return inspect_engine.bake(case, body.path, ops, body.label)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/cases/{case_id}/inspect/collage")
def collage(case_id: str, body: CollageIn) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        return inspect_engine.collage(
            case, body.paths, columns=body.columns, gap=body.gap,
            background=body.background, cell=body.cell, label=body.label,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/cases/{case_id}/inspect/frame/preview")
def preview_frame(case_id: str, body: PreviewIn) -> Response:
    """Decode one video frame and return the PNG — nothing is filed (tray preview)."""
    case = get_case(case_id)
    try:
        png = inspect_engine.preview_frame_png(case, body.path, body.time)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(content=png, media_type="image/png")


@router.post("/cases/{case_id}/inspect/render-preview")
def render_preview(case_id: str, body: RenderPreviewIn) -> Response:
    """Render a recipe (frame/image + ops) to a PNG — nothing is filed.

    Backs collage snapshots and rebuilding tray/collage previews when a saved
    session is reopened.
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
    """Commit selected tray frames to the case (Save gate)."""
    case = get_case(case_id)
    results = []
    try:
        for item in body.items:
            ops = [op.model_dump() for op in item.ops]
            results.append(
                inspect_engine.save_frame(
                    case, item.path, time_s=item.time, ops=ops,
                    label=item.label, folder=body.folder,
                )
            )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"saved": results}


@router.post("/cases/{case_id}/inspect/compose")
def compose(case_id: str, body: ComposeIn) -> dict[str, Any]:
    """Composite a perspective-warped collage from tray/case images (Save gate)."""
    case = get_case(case_id)
    nodes = [
        {"src": {**n.src.model_dump(exclude={"ops"}),
                 "ops": [op.model_dump() for op in n.src.ops]},
         "quad": [list(pt) for pt in n.quad]}
        for n in body.nodes
    ]
    try:
        return inspect_engine.compose_perspective(
            case, width=body.width, height=body.height, nodes=nodes,
            background=body.background, label=body.label, folder=body.folder,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/cases/{case_id}/inspect/compose-preview")
def compose_preview(case_id: str, body: ComposeIn) -> Response:
    """Render the composited collage to a PNG for the Save tab — nothing is filed."""
    case = get_case(case_id)
    nodes = [
        {"src": {**n.src.model_dump(exclude={"ops"}),
                 "ops": [op.model_dump() for op in n.src.ops]},
         "quad": [list(pt) for pt in n.quad]}
        for n in body.nodes
    ]
    try:
        png = inspect_engine.compose_preview_png(
            case, width=body.width, height=body.height, nodes=nodes, background=body.background,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(content=png, media_type="image/png")


@router.post("/cases/{case_id}/inspect/enhance-video")
def enhance_video(case_id: str, body: EnhanceVideoIn) -> dict[str, Any]:
    """Re-encode a video with the gear's adjustments and file it as new media."""
    case = get_case(case_id)
    try:
        return inspect_engine.enhance_video(
            case, body.path, body.params, label=body.label, folder=body.folder
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
# Saveable workspace sessions (persist the whole Inspect scratch, reopen later).
# Mirrors the proofs pattern: a JSON spec on disk + an upserted entity, so a
# session reopens from the sidebar. Only recipes are stored (no pixels).
# ---------------------------------------------------------------------------


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:80] or "session"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/cases/{case_id}/inspect/sessions")
def list_sessions(case_id: str) -> list[dict[str, Any]]:
    case = get_case(case_id)
    out = []
    for spec_path in sorted(case.subdir("inspect").glob("*.json")):
        try:
            spec = json.loads(spec_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if spec.get("ozimut_inspect") != 1:
            continue
        out.append({
            "name": spec_path.stem,
            "title": spec.get("title", spec_path.stem),
            "updated_at": spec.get("updated_at"),
            "frames": len(spec.get("frames", [])),
            "collage": len(spec.get("collage", {}).get("nodes", [])),
            "source": spec.get("source", {}).get("path"),
        })
    out.sort(key=lambda s: s.get("updated_at") or "", reverse=True)
    return out


@router.get("/cases/{case_id}/inspect/sessions/{name}")
def load_session(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        spec_path = case.resolve_inside(f"inspect/{name}.json")
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not spec_path.exists():
        raise HTTPException(status_code=404, detail="session not found")
    return json.loads(spec_path.read_text(encoding="utf-8"))


@router.post("/cases/{case_id}/inspect/sessions")
def save_session(case_id: str, body: SessionIn) -> dict[str, Any]:
    case = get_case(case_id)
    name = _slug(body.name or body.title)
    spec = dict(body.spec)
    spec["ozimut_inspect"] = 1
    spec["title"] = body.title
    spec.setdefault("created_at", _now())
    spec["updated_at"] = _now()

    spec_path = case.subdir("inspect") / f"{name}.json"
    spec_path.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    rel = f"inspect/{name}.json"
    existing = case.find_entity(attr="spec", value=rel)
    if existing:
        case.update_entity(existing["id"], {"label": body.title})
    else:
        case.add_entity("inspect-session", body.title, attrs={"spec": rel}, by="inspect")
    return {"name": name, "spec_path": rel}


@router.delete("/cases/{case_id}/inspect/sessions/{name}")
def delete_session(case_id: str, name: str) -> dict[str, str]:
    case = get_case(case_id)
    try:
        spec_path = case.resolve_inside(f"inspect/{name}.json")
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    spec_path.unlink(missing_ok=True)
    entity = case.find_entity(attr="spec", value=f"inspect/{name}.json")
    if entity:
        case.remove_entity(entity["id"])
    return {"status": "deleted"}
