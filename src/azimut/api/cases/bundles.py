"""Case bundles: export one, inspect an upload, import it back.

The work itself runs as a durable job (`engine/bundles.py`); these routes queue it,
report on it and hand back the finished file.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ... import config
from ...engine import bundles as bundle_engine
from ...workspace import CaseError
from .common import get_case

router = APIRouter(prefix="/api/cases", tags=["cases"])


class BundlePassword(BaseModel):
    password: str | None = Field(default=None, max_length=1024)

class BundleUpload(BundlePassword):
    upload_id: str = Field(min_length=32, max_length=32)

@router.post("/bundles/inspect")
def inspect_bundle(
    file: UploadFile = File(),
    password: str | None = Form(default=None, max_length=1024),
) -> dict[str, Any]:
    upload_id: str | None = None
    try:
        upload_id, path = bundle_engine.stage_upload(file.file)
        preview = bundle_engine.inspect_bundle(path, password=password)
    except CaseError as exc:
        if upload_id is not None:
            bundle_engine.discard_upload(upload_id)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    preview.pop("path", None)
    return {**preview, "upload_id": upload_id}

@router.post("/bundles/import")
def import_bundle(body: BundleUpload) -> dict[str, Any]:
    try:
        source = bundle_engine.uploaded_bundle(body.upload_id)
        case, job = bundle_engine.queue_import(
            source,
            password=body.password,
            cleanup_source=True,
        )
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "case_id": case.id,
        "name": case.read().get("name", case.id),
        "job_id": job["id"],
        "state": job["state"],
    }

@router.delete("/bundles/uploads/{upload_id}")
def discard_bundle_upload(upload_id: str) -> dict[str, str]:
    try:
        bundle_engine.discard_upload(upload_id)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "discarded"}

@router.post("/{case_id}/bundle/export")
def export_bundle(case_id: str, body: BundlePassword) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        job = bundle_engine.queue_export(case, password=body.password)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "case_id": case.id,
        "job_id": job["id"],
        "state": job["state"],
    }

@router.get("/{case_id}/bundle/jobs/{job_id}")
def bundle_job(case_id: str, job_id: str) -> dict[str, Any]:
    job = bundle_engine.job_status(case_id, job_id)
    if job is None or job.get("kind") not in {
        bundle_engine.EXPORT_JOB,
        bundle_engine.IMPORT_JOB,
    }:
        raise HTTPException(status_code=404, detail=f"bundle job '{job_id}' not found")
    return {
        "id": job["id"],
        "kind": job["kind"],
        "state": job["state"],
        "error": job.get("error"),
    }

@router.get("/{case_id}/bundle/jobs/{job_id}/download")
def download_bundle(case_id: str, job_id: str) -> FileResponse:
    job = bundle_engine.job_status(case_id, job_id)
    if (
        job is None
        or job.get("kind") != bundle_engine.EXPORT_JOB
        or job.get("state") != "ready"
    ):
        raise HTTPException(status_code=404, detail="bundle download not ready")
    path = Path(job.get("payload", {}).get("output", ""))
    try:
        allowed = path.resolve().parent == config.bundles_dir().resolve()
    except OSError:
        allowed = False
    if not allowed or not path.is_file():
        raise HTTPException(status_code=404, detail="bundle download not found")
    return FileResponse(
        path,
        filename=path.name,
        media_type="application/octet-stream",
    )
