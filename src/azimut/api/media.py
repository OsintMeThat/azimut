"""REST API for the Media Library: upload, clipboard paste, URL download (async
job), list, delete, and copying one file back out to a folder of the analyst's own."""

from __future__ import annotations

import io
import warnings
from typing import Any

from fastapi import APIRouter, Form, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel, Field, HttpUrl

from .. import config, jobs
from ..engine import enrich as enrich_engine
from ..engine import exportdir
from ..engine import media as media_engine
from ..engine import reveal as reveal_engine
from ..engine import thumbnails as thumbnail_engine
from ..workspace import Case, CaseError
from .cases import delete_by_path, get_case
from .limits import MAX_IMAGE_BYTES

router = APIRouter(prefix="/api", tags=["media"])


class DownloadIn(BaseModel):
    url: HttpUrl
    index: int | None = None
    title: str | None = None
    # opt-in per call: only a retry after a login wall sets this, so the first
    # (default) attempt stays cookie-less and public media never uses the session
    use_cookies: bool = False


class DeleteIn(BaseModel):
    path: str


class ExportIn(BaseModel):
    """One media file to copy out. Where it goes is the folder saved for media
    (engine/exportdir.py), never something the request names."""

    path: str


class UpdateIn(BaseModel):
    path: str
    notes: str | None = None
    folder: str | None = None
    title: str | None = None
    # Where the analyst says a collected file came from. Empty drops the claim;
    # a download refuses it (engine/media.py).
    source_url: str | None = Field(default=None, max_length=4000)


class ThumbRegenIn(BaseModel):
    path: str | None = None


class EnrichIn(BaseModel):
    path: str | None = None


class MediaMetadataIn(BaseModel):
    paths: list[str] = Field(max_length=500)


def stated_source(source_url: str) -> str:
    """A hand-typed origin, or a refusal.

    One reading of "source" for every surface that lets one be stated — the paste
    dialog, an import, a later correction. Links only: the field feeds the entity's
    ``source_url``, the proof plate's source line and the lineage a lost file leaves
    behind, all of which are addresses. An origin that is not one (a hand-off, a
    disk) is a note, and Notes is where it goes.
    """
    source_url = source_url.strip()
    if source_url and not media_engine.is_address(source_url):
        raise HTTPException(status_code=422, detail="the source must be an http(s) URL")
    return source_url


def with_thumb_state(case: Case, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Tag each media item with the background states the UI polls.

    ``thumb_state`` is ``ready`` when the cached file is present,
    ``queued``/``running``/``failed`` from its thumbnail job, else ``none``.
    ``enrich_state`` follows the enrichment job and is ``ready`` once the current
    enrichment version has landed. A referenced-but-missing thumbnail (evicted
    by the budget) is reported as absent so the grid falls back cleanly.
    """
    thumb_jobs = {j["key"]: j for j in case.list_jobs(kind=thumbnail_engine.THUMB_KIND)}
    enrich_jobs = {j["key"]: j for j in case.list_jobs(kind=enrich_engine.ENRICH_KIND)}
    for item in items:
        thumb = item.get("thumbnail")
        if thumb and case.resolve_inside(thumb).exists():
            item["thumb_state"] = "ready"
        else:
            item["thumbnail"] = None
            if item.get("kind") not in thumbnail_engine.THUMBNAILED_KINDS:
                item["thumb_state"] = "none"
            else:
                job = thumb_jobs.get(item["path"])
                item["thumb_state"] = (
                    job["state"]
                    if job and job["state"] in ("queued", "running", "failed")
                    else "none"
                )

        enrich_job = enrich_jobs.get(item["path"])
        if enrich_job and enrich_job["state"] in ("queued", "running", "failed"):
            item["enrich_state"] = enrich_job["state"]
        elif item.get("enrich_version") == enrich_engine.ENRICH_VERSION:
            item["enrich_state"] = "ready"
        else:
            item["enrich_state"] = "none"
    return items


@router.get("/cases/{case_id}/media")
def list_media(case_id: str) -> list[dict[str, Any]]:
    case = get_case(case_id)
    return with_thumb_state(case, media_engine.list_media(case))


@router.get("/cases/{case_id}/media/page")
def page_media(
    case_id: str,
    q: str | None = None,
    kind: str | None = None,
    category: str | None = None,
    folder: str | None = None,
    gps: bool = False,
    collected_only: bool = False,
    sort: str = "newest",
    direction: str | None = None,
    limit: int = 200,
    cursor: str | None = None,
) -> dict[str, Any]:
    """A bounded, filterable page of the media list for the browse surfaces
    (Media Library, Files). Small cases return one page with a null
    ``next_cursor``, so the client filters in memory with no further calls; a
    large case pages via ``cursor`` and searches server-side via ``q``.
    ``gps=true`` keeps only the files whose metadata states a position.
    ``collected_only=true`` drops what the case made out of its own material — an
    extracted frame, a collage — and scopes the counts with it; the number it hides
    comes back as ``facets.made_here_count``.
    ``facets`` counts the whole filtered set so category/folder/GPS controls stay
    accurate. The unbounded ``GET .../media`` stays for consumers that need the
    full index (pickers, satellite crops, derivation)."""
    case = get_case(case_id)
    limit = max(1, min(limit, 500))
    offset = int(cursor) if cursor and cursor.isdigit() else 0
    result = case.page_media_items(
        q=q,
        kind=kind,
        category=category,
        folder=folder,
        gps=gps,
        collected_only=collected_only,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
    )
    result["items"] = with_thumb_state(case, result["items"])
    thumb_jobs = case.count_jobs(kind=thumbnail_engine.THUMB_KIND)
    result.setdefault("facets", {})["thumbnail_pending"] = (
        thumb_jobs.get("queued", 0) + thumb_jobs.get("running", 0)
    )
    return result


@router.get("/cases/{case_id}/media/item")
def read_media_item(case_id: str, path: str) -> dict[str, Any]:
    """One media file, read from its sidecar — the whole record, enrichment's full
    metadata dumps included.

    The browse index leaves those dumps out on purpose (they are hundreds of rows
    per file, and the listings are read 200 at a time), so this is where a surface
    that shows one file gets them. ``entity_id`` comes off the index row rather
    than a graph lookup, so opening one file never scans the case.
    """
    case = get_case(case_id)
    try:
        item = media_engine.read_item(case, path)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail=f"no media at {path!r}")
    indexed = case.media_items_by_paths([path])
    entity_id = indexed[0].get("entity_id") if indexed else None
    return with_thumb_state(case, [{**item, "entity_id": entity_id}])[0]


@router.post("/cases/{case_id}/media/metadata")
def media_metadata(case_id: str, body: MediaMetadataIn) -> list[dict[str, Any]]:
    """Thumbnail, kind and size metadata for the paths on the current Files page."""
    case = get_case(case_id)
    try:
        items = case.media_items_by_paths(body.paths)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return with_thumb_state(case, items)


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


@router.post("/cases/{case_id}/media/enrich")
def enrich_media(case_id: str, body: EnrichIn) -> dict[str, int]:
    """Queue local image and video enrichment.

    With a ``path`` this re-reads that one item. Without one it queues images
    that have not reached the current enrichment version, including media from
    older Azimut releases. Merely opening a case never starts this backfill.

    ``queued`` counts jobs the queue actually took, not items considered: naming a
    path whose kind carries no enrichment (an audio file, a PDF) queues nothing,
    and reporting one would have the toast announce work that will never run.
    """
    case = get_case(case_id)
    items = media_engine.list_media(case)
    if body.path is not None:
        targets = [item for item in items if item["path"] == body.path]
    else:
        targets = [
            item
            for item in items
            if item.get("kind") in enrich_engine.ENRICHED_KINDS
            and item.get("enrich_version") != enrich_engine.ENRICH_VERSION
        ]
    queued = 0
    for item in targets:
        if enrich_engine.on_register(
            case,
            item["path"],
            item.get("kind", ""),
            item.get("entity_id") or "",
        ):
            queued += 1
    return {"queued": queued}


@router.post("/cases/{case_id}/media/upload")
async def upload(
    case_id: str,
    file: UploadFile,
    source_url: str = Form(default="", max_length=4000),
) -> dict[str, Any]:
    """File an uploaded file, with the origin the importer states for it.

    A file fetched by hand and then dropped here carries no address of its own, so
    the import is the first chance to say where it came from — and for a batch out
    of one thread, the same chance for all of it.
    """
    case = get_case(case_id)
    return media_engine.import_stream(
        case, file.filename or "file", file.file, source_url=stated_source(source_url)
    )


@router.post("/cases/{case_id}/media/paste")
async def paste(
    case_id: str,
    file: UploadFile,
    title: str = Form(default="", max_length=200),
    source_url: str = Form(default="", max_length=4000),
) -> dict[str, Any]:
    """File an image pasted out of the clipboard (lib/clipboardPaste.js).

    Separate from ``upload`` because the provenance differs and provenance is the
    point: a dropped file states its own name and came off a disk, while a pasted
    screenshot has neither, so the dialog behind this route is where a title and an
    origin get stated at all. Both are optional — an unnamed paste is stamped, and a
    crop of the analyst's own screen honestly has no source.

    Bounded at the edge like every other surface that swallows an image, and against
    the same limit. The pixel clamp answers a decompression bomb; refusing early is
    what keeps a mistaken Ctrl+V from writing an enormous temporary nobody asked for.
    Images only: the clipboard is not a file picker, and a case takes a pasted
    screenshot, not an arbitrary payload.
    """
    raw = await file.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"pasted image must be under {MAX_IMAGE_BYTES // 1024 // 1024} MB",
        )
    try:
        # Kept explicit even when a test runner or embedding process installs its
        # own warning policy after Azimut starts.
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            Image.open(io.BytesIO(raw)).verify()
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=413, detail="image exceeds the 100 MP limit") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"not a readable image: {exc}") from exc

    return media_engine.import_paste(
        get_case(case_id),
        file.filename or "pasted-image.png",
        io.BytesIO(raw),
        source_url=stated_source(source_url),
        title=title,
    )


@router.post("/cases/{case_id}/media/download")
def download(case_id: str, body: DownloadIn) -> dict[str, str]:
    case = get_case(case_id)
    url = str(body.url)
    index, title = body.index, body.title
    cookies = (
        media_engine.cookies_from_preference(config.load_settings().get("download_cookies"))
        if body.use_cookies
        else None
    )

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

        return media_engine.fetch_url(
            case, url, progress_hook=hook, index=index, title=title, cookies=cookies
        )

    job_id = jobs.start("download", work)
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict[str, bool]:
    """Ask a job to stop where stopping is safe.

    Only the jobs that took the promise can answer it — a download is one call
    into yt-dlp and has no safe point inside it, where a sheet building a hundred
    proofs has one between every two rows. ``stopped`` is false for a job that was
    already finished, which is the honest answer to cancelling something that is
    over rather than an error about it.
    """
    if jobs.get(job_id) is None:
        raise HTTPException(status_code=404, detail="job not found")
    return {"stopped": jobs.cancel(job_id)}


@router.post("/cases/{case_id}/media/export")
def export_media_item(case_id: str, body: ExportIn) -> dict[str, str]:
    """Copy one media file out of the case, into the media export folder.

    A copy, never a move: the case keeps the original, hashes and all. The name
    it lands under is the one on disk, and an existing file is never overwritten.
    """
    case = get_case(case_id)
    try:
        item = media_engine.read_item(case, body.path)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="media not found")
    source = case.resolve_inside(item["path"])
    try:
        folder = exportdir.destination("media", case.path)
        written = exportdir.copy_out(source, folder, source.name)
    except exportdir.ExportDirError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"file": written.name, "folder": str(folder), "path": str(written)}


@router.post("/cases/{case_id}/media/export/reveal")
def reveal_media_exports(case_id: str) -> dict[str, str]:
    """Open the media export folder, resolved here rather than sent by the browser."""
    case = get_case(case_id)
    try:
        folder = exportdir.destination("media", case.path)
        reveal_engine.reveal(folder, workspace_only=False)
    except (exportdir.ExportDirError, reveal_engine.RevealError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"path": str(folder)}


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
    if body.source_url is not None:
        patch["source_url"] = stated_source(body.source_url)
    try:
        return media_engine.update_media(case, body.path, patch)
    except (ValueError, CaseError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
