"""REST API for the Inspect tool: probe media, capture frames, apply
adjustments, build collages, run analyses.

Outputs are filed as ordinary case media (they appear in the Media Library and
the Proof Composer picker with zero extra plumbing). Long scans run as jobs.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from .. import jobs
from ..engine import artifacts as artifact_engine
from ..engine import inspect as inspect_engine
from ..engine import links as link_engine
from ..workspace import CaseError
from .cases import delete_by_path, get_case
from .naming import read_created_at, slugify
from .. import layout

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


class SessionIn(BaseModel):
    # The filename always follows the title, so renaming a saved session moves
    # its file. ``rename_from`` is the stem the workspace is currently bound to
    # (absent on a first save); a save that lands elsewhere renames that file in
    # place instead of leaving a copy behind under the old name.
    rename_from: str | None = None
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
    """Composite a perspective-warped collage from tray/case images (Save gate)."""
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


@router.post("/cases/{case_id}/inspect/compose-preview")
def compose_preview(case_id: str, body: ComposeIn) -> Response:
    """Render the composited collage to a PNG for the Save tab — nothing is filed."""
    case = get_case(case_id)
    nodes: list[dict[str, Any]] = []
    for n in body.nodes:
        src = n.src.model_dump(exclude={"ops"})
        src["ops"] = [op.model_dump() for op in n.src.ops]
        nodes.append({"src": src, "quad": [list(pt) for pt in n.quad]})
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
# Saveable workspace sessions (persist the whole Inspect scratch, reopen later).
# Mirrors the proofs pattern: a JSON spec on disk + an upserted entity, so a
# session reopens from the sidebar. Only recipes are stored (no pixels).
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/cases/{case_id}/inspect/sessions")
def list_sessions(case_id: str) -> list[dict[str, Any]]:
    case = get_case(case_id)
    out = []
    for spec_path in sorted(case.subdir(layout.INSPECT_DIR).glob("*.json")):
        try:
            spec = json.loads(spec_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if spec.get("azimut_inspect") != 1:
            continue
        # Sessions hold an array of collages; older ones held a single `collage`
        # (the loader still reads both). Count the pieces across all of them.
        collages = spec.get("collages") or (
            [spec["collage"]] if isinstance(spec.get("collage"), dict) else []
        )
        out.append({
            "name": spec_path.stem,
            "title": spec.get("title", spec_path.stem),
            "updated_at": spec.get("updated_at"),
            "frames": len(spec.get("frames", [])),
            "collages": len(collages),
            "collage": sum(len(c.get("nodes", [])) for c in collages),
            "source": spec.get("source", {}).get("path"),
        })
    out.sort(key=lambda s: s.get("updated_at") or "", reverse=True)
    return out


@router.get("/cases/{case_id}/inspect/sessions/{name}")
def load_session(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        spec_path = case.resolve_inside(layout.session_rel(name))
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not spec_path.exists():
        raise HTTPException(status_code=404, detail="session not found")
    return json.loads(spec_path.read_text(encoding="utf-8"))


@router.post("/cases/{case_id}/inspect/sessions")
def save_session(case_id: str, body: SessionIn) -> dict[str, Any]:
    case = get_case(case_id)
    case.subdir(layout.INSPECT_DIR)  # born on first save, so the folder exists
    name = slugify(body.title, "Inspect")
    rel = layout.session_rel(name)
    spec_path = case.resolve_inside(rel)

    # A rename lands on a free name or not at all: taking a name another session
    # holds would leave two entities pointing at one file, and there is no sane
    # merge of the two. The first save of an unbound workspace still writes over
    # a same-named session — there the analyst is updating that one.
    old = slugify(body.rename_from, "session") if body.rename_from else None
    old_rel = layout.session_rel(old) if old and old != name else None
    if old_rel and spec_path.exists():
        raise HTTPException(status_code=409, detail="another session already uses that name")

    spec = dict(body.spec)
    spec["azimut_inspect"] = 1
    spec["title"] = name
    previous = case.resolve_inside(layout.session_rel(old or name))
    spec.setdefault("created_at", read_created_at(previous) or _now())
    spec["updated_at"] = _now()
    spec_path.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Rebind the entity the old name held rather than filing a second one, so a
    # rename keeps the session's folder, notes and links.
    existing = case.find_entity(attr="spec", value=old_rel or rel)
    if existing:
        patch: dict[str, Any] = {"label": name}
        if old_rel:
            patch["attrs"] = {"spec": rel}
        case.update_entity(existing["id"], patch)
        entity_id = existing["id"]
    else:
        entity_id = case.add_entity(
            "inspect-session", name, attrs={"spec": rel}, by="inspect"
        )["id"]
    if old_rel:
        case.resolve_inside(layout.session_rel(str(old))).unlink(missing_ok=True)

    # A session is only adjustments and crops over its subject — nothing usable
    # is left of it once the subject is gone, so it depends on it and is deleted
    # with it (ONTOLOGY §3). Collage pieces pulled from the case are *not*
    # subjects: losing one leaves a placeholder, it does not void the session.
    link_engine.sync(
        case,
        entity_id,
        link_engine.DEPENDS_ON,
        [spec.get("source", {}).get("path")],
        by="inspect",
    )
    return {"name": name, "title": name, "spec_path": rel}


@router.delete("/cases/{case_id}/inspect/sessions/{name}")
def delete_session(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    rel = layout.session_rel(name)
    try:
        case.resolve_inside(rel)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    result = delete_by_path(case, rel)
    if not result["deleted"]:  # never filed as an entity: drop the file anyway
        artifact_engine.delete(case, {"type": "inspect-session", "attrs": {"spec": rel}})
    return result
