"""Thumbnail cache and its durable job model (doc "Thumbnail and background-job
model").

Thumbnails are disposable pixels: a broken or missing one must never block access
to the original file. This module owns their whole lifecycle.

- **Cache identity** is content-addressed: the file name folds in the original's
  SHA-256 and the generator version (`THUMB_GEN`). A changed original or a bumped
  generator therefore lands a *new* file rather than serving stale pixels, and
  old ones fall out as orphans that `repair` sweeps.
- **Generation is atomic**: pixels are rendered to a unique temp file, validated,
  then renamed into `.thumbs/` — a reader never sees a half-written thumbnail, and
  the Windows rename rules are respected.
- **Cheap image thumbnails run inline** for instant feedback; the **CPU-heavy
  path (ffmpeg video frames) goes through the durable per-case `jobs` queue** and
  is drained by a single worker, so several imports never spawn several ffmpegs at
  once. A failed inline render is enqueued for the worker to retry.
- **Recovery**: a job left `running` by a crashed process is reclaimed on case
  open (`Case.recover_jobs`), so work resumes instead of stalling.
- **Budget**: `prune_cache` evicts least-recently-used thumbnails past a size
  budget; it only ever touches the cache, never originals or database rows.
"""

from __future__ import annotations

import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from PIL import Image

from ..workspace import ensure_dir
from . import ffmpeg as ffmpeg_engine

if TYPE_CHECKING:
    from ..workspace import Case as CaseType

THUMB_DIR = ".thumbs"
THUMB_MAX = 512
# Bump when the render changes (size, format, quality) so every case's cached
# thumbnails are superseded by a differently-named file on next generation, and
# the stale ones become orphans `repair` removes.
THUMB_GEN = 1
# Job kind for the durable queue. One worker drains these one at a time, so
# ffmpeg (the CPU-heavy path) never runs several instances at once.
THUMB_KIND = "thumbnail"
# Only these media kinds get a raster thumbnail; audio and generic files show a
# type icon instead.
THUMBNAILED_KINDS = frozenset({"image", "video"})
# Default cache budget (bytes). Eviction is LRU by mtime and never touches
# originals. Generous for a local single-user app; a preference can lower it.
DEFAULT_BUDGET_BYTES = 512 * 1024 * 1024


class ThumbnailError(Exception):
    """A thumbnail could not be produced (unreadable image, ffmpeg failure or
    absence). The original file is untouched; the caller queues a retry."""


def thumb_relpath(sha256: str, kind: str) -> str | None:
    """The case-relative path a ``kind`` thumbnail with this ``sha256`` lives at,
    or None for a kind we don't thumbnail. Content- and generator-addressed, so a
    new original or a bumped generator maps to a new file."""
    if kind not in THUMBNAILED_KINDS or not sha256:
        return None
    return f"media/{THUMB_DIR}/{sha256[:24]}-g{THUMB_GEN}.jpg"


def _render(media_path: Path, out_path: Path, kind: str) -> bool:
    """Render a thumbnail for ``media_path`` into ``out_path``. Images go through
    Pillow (under the process-wide decode-pixel clamp); video frames through
    ffmpeg with a bounded run time. Returns whether a file was produced."""
    if kind == "image":
        with Image.open(media_path) as img:
            rgb = img.convert("RGB")
            rgb.thumbnail((THUMB_MAX, THUMB_MAX))
            rgb.save(out_path, "JPEG", quality=82)
        return True
    if kind == "video":
        if not ffmpeg_engine.ffmpeg_available():
            return False
        subprocess.run(
            [
                ffmpeg_engine.ffmpeg_exe(), "-y", "-loglevel", "error",
                "-ss", "1", "-i", str(media_path),
                "-frames:v", "1", "-vf", f"scale={THUMB_MAX}:-2",
                str(out_path),
            ],
            check=True,
            timeout=30,
            capture_output=True,
        )
        return out_path.exists()
    return False


def generate(case: "CaseType", rel_media: str, sha256: str, kind: str) -> str | None:
    """Produce the thumbnail for one media file, atomically, and return its
    case-relative path (or None for a non-thumbnailed kind).

    A cache hit (the content-addressed file already exists) returns immediately.
    Otherwise pixels are rendered to a unique temp file and renamed into
    ``.thumbs/`` so a reader never sees a partial file. A render that yields
    nothing (e.g. video with no ffmpeg) raises `ThumbnailError`; a partial temp is
    always cleaned up.
    """
    thumb_rel = thumb_relpath(sha256, kind)
    if thumb_rel is None:
        return None
    thumb_path = case.resolve_inside(thumb_rel)
    if thumb_path.exists():
        return thumb_rel
    media_path = case.resolve_inside(rel_media)
    if not media_path.exists():
        raise ThumbnailError(f"media file missing: {rel_media}")
    ensure_dir(thumb_path.parent)
    tmp = thumb_path.with_name(f".{uuid.uuid4().hex}.tmp.jpg")
    try:
        produced = _render(media_path, tmp, kind)
    except Exception as exc:  # unreadable image, ffmpeg error, decode-bomb clamp
        tmp.unlink(missing_ok=True)
        raise ThumbnailError(str(exc)) from exc
    if not produced or not tmp.exists():
        tmp.unlink(missing_ok=True)
        raise ThumbnailError(f"no thumbnail produced for {rel_media}")
    from ..workspace import _replace_with_retry

    _replace_with_retry(tmp, thumb_path)
    return thumb_rel


def enqueue(case: "CaseType", rel_media: str) -> dict[str, Any]:
    """Queue a thumbnail job for one media file and wake the worker. Keyed on the
    media path, so re-enqueue (a retry or a regenerate) never stacks duplicates."""
    job = case.enqueue_job(THUMB_KIND, key=rel_media, payload={"path": rel_media})
    wake(case)
    return job


def on_register(case: "CaseType", rel_media: str, sha256: str, kind: str) -> str | None:
    """Decide a freshly-registered media file's thumbnail. Cheap image thumbnails
    render inline (instant feedback); a failed image render and every video are
    handed to the durable queue. Returns the thumbnail path if produced inline,
    else None (the worker fills it in and updates the sidecar)."""
    if kind == "image":
        try:
            return generate(case, rel_media, sha256, kind)
        except ThumbnailError:
            enqueue(case, rel_media)
            return None
    if kind == "video":
        enqueue(case, rel_media)
        return None
    return None


# -- durable worker --------------------------------------------------------
#
# One background worker across all cases: a single daemon thread drains queued
# thumbnail jobs one at a time, so ffmpeg (CPU-heavy) never runs several at once
# — the doc's "default to one CPU-heavy worker". Work only ever starts from a
# user action (an import, a regenerate) or crash recovery, never from merely
# opening a case or tab.

_worker_lock = threading.Lock()
_pending: dict[str, "CaseType"] = {}
_worker_running = False

# When False, `wake` does not start the background thread — the queue is drained
# explicitly instead (tests, and any caller that wants deterministic draining).
start_workers = True


def _process_one(case: "CaseType", job: dict[str, Any]) -> None:
    """Run one claimed thumbnail job: render the file, update its sidecar, and
    settle the job. A missing media file cancels the job (nothing to render); any
    other failure is recorded and retried until the attempt budget is spent."""
    from . import media as media_engine

    rel = job["payload"].get("path")
    item = media_engine.read_item(case, rel) if rel else None
    if item is None:  # the media (or its sidecar) is gone — nothing to do
        case.cancel_job(job["id"])
        return
    try:
        thumb_rel = generate(case, rel, item.get("sha256", ""), item.get("kind", ""))
    except ThumbnailError as exc:
        case.fail_job(job["id"], str(exc))
        return
    media_engine.set_thumbnail(case, rel, thumb_rel)
    case.complete_job(job["id"])


def drain(case: "CaseType") -> int:
    """Process every queued thumbnail job for one case, one at a time, in the
    calling thread. Returns how many jobs were handled. Synchronous and
    deterministic — the worker loop and the tests both call it."""
    handled = 0
    while True:
        job = case.claim_job(kinds=[THUMB_KIND])
        if job is None:
            return handled
        _process_one(case, job)
        handled += 1


def _run_loop() -> None:
    global _worker_running
    while True:
        with _worker_lock:
            if not _pending:
                _worker_running = False
                return
            case_id, case = next(iter(_pending.items()))
        try:
            drain(case)
        except Exception:  # a worker must never die on one case's failure
            pass
        with _worker_lock:
            _pending.pop(case_id, None)


def wake(case: "CaseType") -> None:
    """Ensure the single background worker is draining ``case``'s queue. Registers
    the case and starts the worker thread if it isn't already running; a no-op if
    the case is already pending."""
    global _worker_running
    if not start_workers:
        return
    with _worker_lock:
        _pending[case.id] = case
        if _worker_running:
            return
        _worker_running = True
    threading.Thread(target=_run_loop, name="thumbnail-worker", daemon=True).start()


def wait_until_idle(timeout: float = 5.0) -> bool:
    """Wait for the shared worker to finish its current queue, if any.

    This is mainly useful for orderly shutdown and deterministic callers that
    need to remove a case directory after queuing work. It never interrupts an
    active render; ``False`` means the caller's timeout elapsed first.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with _worker_lock:
            if not _worker_running:
                return True
        time.sleep(0.01)
    with _worker_lock:
        return not _worker_running


# -- cache maintenance -----------------------------------------------------


def _thumb_dir(case: "CaseType") -> Path:
    return case.subdir("media") / THUMB_DIR


def cache_size(case: "CaseType") -> int:
    """Total bytes held by the thumbnail cache."""
    thumbs = _thumb_dir(case)
    if not thumbs.is_dir():
        return 0
    return sum(p.stat().st_size for p in thumbs.iterdir() if p.is_file())


def repair(case: "CaseType") -> int:
    """Sweep the cache: delete abandoned temp files and thumbnails no live media
    sidecar references any more (orphans left by a generator bump or a delete).
    Returns how many files were removed. Never touches originals."""
    from . import media as media_engine

    thumbs = _thumb_dir(case)
    if not thumbs.is_dir():
        return 0
    referenced = {
        item["thumbnail"].rsplit("/", 1)[-1]
        for item in media_engine.list_media(case)
        if item.get("thumbnail")
    }
    removed = 0
    for path in thumbs.iterdir():
        if not path.is_file():
            continue
        if path.name.endswith(".tmp.jpg") or path.name not in referenced:
            path.unlink(missing_ok=True)
            removed += 1
    return removed


def prune_cache(case: "CaseType", budget_bytes: int = DEFAULT_BUDGET_BYTES) -> int:
    """Evict least-recently-used thumbnails until the cache fits ``budget_bytes``.

    LRU by file mtime (the cache carries no other access record, and thumbnails
    are safe to lose — they regenerate on demand). Returns how many were evicted.
    Originals and database rows are never touched.
    """
    thumbs = _thumb_dir(case)
    if not thumbs.is_dir():
        return 0
    files = sorted(
        (p for p in thumbs.iterdir() if p.is_file() and not p.name.endswith(".tmp.jpg")),
        key=lambda p: p.stat().st_mtime,
    )
    total = sum(p.stat().st_size for p in files)
    evicted = 0
    for path in files:
        if total <= budget_bytes:
            break
        size = path.stat().st_size
        path.unlink(missing_ok=True)
        total -= size
        evicted += 1
    return evicted
