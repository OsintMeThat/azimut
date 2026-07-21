"""REST API for the Media Library: upload, URL download (async job), list, delete."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel, HttpUrl

from .. import jobs
from ..engine import media as media_engine
from ..engine import thumbnails as thumbnail_engine
from ..workspace import Case, CaseError
from .cases import delete_by_path, get_case

router = APIRouter(prefix="/api", tags=["media"])


class DownloadIn(BaseModel):
    url: HttpUrl
    index: int | None = None
    title: str | None = None


class DeleteIn(BaseModel):
    path: str


class UpdateIn(BaseModel):
    path: str
    notes: str | None = None
    folder: str | None = None
    title: str | None = None


class ThumbRegenIn(BaseModel):
    path: str | None = None


def _with_thumb_state(case: Case, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Tag each media item with a ``thumb_state`` the grid renders: ``ready`` when
    the cached file is present, ``queued``/``running``/``failed`` from its
    thumbnail job while the worker is on it, else ``none`` (no thumbnail, e.g. an
    audio file, or one pruned from the cache). A referenced-but-missing thumbnail
    (evicted by the budget) is reported as absent so the grid falls back cleanly.
    """
    jobs_by_path = {j["key"]: j for j in case.list_jobs(kind=thumbnail_engine.THUMB_KIND)}
    for item in items:
        thumb = item.get("thumbnail")
        if thumb and case.resolve_inside(thumb).exists():
            item["thumb_state"] = "ready"
            continue
        item["thumbnail"] = None
        if item.get("kind") not in thumbnail_engine.THUMBNAILED_KINDS:
            item["thumb_state"] = "none"
        else:
            job = jobs_by_path.get(item["path"])
            item["thumb_state"] = (
                job["state"] if job and job["state"] in ("queued", "running", "failed") else "none"
            )
    return items


@router.get("/cases/{case_id}/media")
def list_media(case_id: str) -> list[dict[str, Any]]:
    case = get_case(case_id)
    return _with_thumb_state(case, media_engine.list_media(case))


@router.post("/cases/{case_id}/media/thumbnails/regenerate")
def regenerate_thumbnails(case_id: str, body: ThumbRegenIn) -> dict[str, int]:
    """Queue (re)generation of thumbnails. With a ``path`` it re-queues that one
    item — the per-card retry for a failed thumbnail. Without one it queues every
    thumbnailable item whose cached thumbnail is missing or failed, skipping the
    ones already ready. The single worker drains the queue one at a time.
    """
    case = get_case(case_id)
    items = media_engine.list_media(case)
    if body.path is not None:
        targets = [i["path"] for i in items if i["path"] == body.path]
    else:
        targets = [
            i["path"]
            for i in items
            if i.get("kind") in thumbnail_engine.THUMBNAILED_KINDS
            and not (i.get("thumbnail") and case.resolve_inside(i["thumbnail"]).exists())
        ]
    for path in targets:
        thumbnail_engine.enqueue(case, path)
    return {"queued": len(targets)}


@router.post("/cases/{case_id}/media/upload")
async def upload(case_id: str, file: UploadFile) -> dict[str, Any]:
    case = get_case(case_id)
    result = media_engine.import_stream(case, file.filename or "file", file.file)
    return result


@router.post("/cases/{case_id}/media/download")
def download(case_id: str, body: DownloadIn) -> dict[str, str]:
    case = get_case(case_id)
    url = str(body.url)
    index, title = body.index, body.title

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

        return media_engine.download_url(case, url, progress_hook=hook, index=index, title=title)

    job_id = jobs.start("download", work)
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.delete("/cases/{case_id}/media")
def delete_media(case_id: str, path: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        result = delete_by_path(case, path)
        if not result["deleted"]:  # never filed as an entity: drop the files anyway
            media_engine.delete_media_files(case, path)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


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
