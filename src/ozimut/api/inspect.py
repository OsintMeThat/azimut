"""REST API for the Inspect tool: probe media, capture frames, apply
adjustments, build collages, run analyses.

Outputs are filed as ordinary case media (they appear in the Media Library and
the Proof Composer picker with zero extra plumbing). Long scans run as jobs.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
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


class AnalyzeIn(BaseModel):
    path: str
    name: str
    params: dict[str, Any] = {}


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


@router.post("/cases/{case_id}/inspect/analyze")
def analyze(case_id: str, body: AnalyzeIn) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        return inspect_engine.run_analysis(case, body.path, body.name, body.params)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
