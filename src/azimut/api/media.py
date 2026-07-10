"""REST API for the Media Library: upload, URL download (async job), list, delete."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel, HttpUrl

from .. import jobs
from ..engine import media as media_engine
from ..workspace import CaseError
from .cases import get_case

router = APIRouter(prefix="/api", tags=["media"])


class DownloadIn(BaseModel):
    url: HttpUrl


class DeleteIn(BaseModel):
    path: str


class UpdateIn(BaseModel):
    path: str
    notes: str | None = None
    folder: str | None = None
    title: str | None = None


@router.get("/cases/{case_id}/media")
def list_media(case_id: str) -> list[dict[str, Any]]:
    return media_engine.list_media(get_case(case_id))


@router.post("/cases/{case_id}/media/upload")
async def upload(case_id: str, file: UploadFile) -> dict[str, Any]:
    case = get_case(case_id)
    result = media_engine.import_stream(case, file.filename or "file", file.file)
    return result


@router.post("/cases/{case_id}/media/download")
def download(case_id: str, body: DownloadIn) -> dict[str, str]:
    case = get_case(case_id)
    url = str(body.url)

    def work(set_progress):
        def hook(d):
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                done = d.get("downloaded_bytes") or 0
                set_progress(
                    {
                        "percent": round(done * 100 / total, 1) if total else None,
                        "speed": d.get("_speed_str", "").strip() or None,
                    }
                )
            elif d.get("status") == "finished":
                set_progress({"percent": 100, "stage": "processing"})

        return media_engine.download_url(case, url, progress_hook=hook)

    job_id = jobs.start("download", work)
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.delete("/cases/{case_id}/media")
def delete_media(case_id: str, path: str) -> dict[str, str]:
    case = get_case(case_id)
    try:
        media_engine.delete_media(case, path)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "deleted"}


@router.patch("/cases/{case_id}/media")
def update_media_item(case_id: str, body: UpdateIn) -> dict[str, Any]:
    case = get_case(case_id)
    patch: dict[str, Any] = {}
    if body.notes is not None:
        patch["notes"] = body.notes
    if body.folder is not None:
        patch["folder"] = body.folder
    if body.title is not None:
        patch["title"] = body.title
    try:
        return media_engine.update_media(case, body.path, patch)
    except (ValueError, CaseError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
