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
  path (ffmpeg video frames) goes through the durable per-case `jobs` queue**
  drained by the shared single worker (`engine/workqueue.py`), so several imports
  never spawn several ffmpegs at once. A failed inline render is enqueued for the
  worker to retry.
- **Recovery**: a job left `running` by a crashed process is reclaimed on case
  open (`Case.recover_jobs`), so work resumes instead of stalling.
- **Budget**: `prune_cache` evicts least-recently-used thumbnails past a size
  budget; it only ever touches the cache, never originals or database rows.
"""

from __future__ import annotations

import json
import subprocess
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from PIL import Image

from ..workspace import ensure_dir
from . import ffmpeg as ffmpeg_engine
from . import workqueue
from .. import layout

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
    # Create .thumbs before resolving into it: several threads can race to render
    # distinct thumbnails for the same case at once, and Path.resolve() walking a
    # not-yet-fully-created directory concurrently with its own mkdir is exactly
    # the Windows CreateDirectory race ensure_dir works around elsewhere, except
    # here it surfaces as a bogus "path escapes the case directory" instead of a
    # retryable PermissionError.
    ensure_dir(_thumb_dir(case))
    thumb_path = case.resolve_inside(thumb_rel)
    if thumb_path.exists():
        return thumb_rel
    media_path = case.resolve_inside(rel_media)
    if not media_path.exists():
        raise ThumbnailError(f"media file missing: {rel_media}")
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
    return workqueue.enqueue(case, THUMB_KIND, key=rel_media, payload={"path": rel_media})


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


# -- the enqueued (CPU-heavy) path -----------------------------------------
#
# Video frames go through the shared durable queue (engine/workqueue.py) so
# ffmpeg never runs several instances at once. This module supplies the handler;
# the queue owns the thread and the settlement.


def _handle(case: "CaseType", job: dict[str, Any]) -> None:
    """Run one thumbnail job: render the file and record it on the sidecar.

    A missing media file cancels the job (nothing to render); a render failure is
    retried by the queue until the attempt budget is spent.
    """
    from . import media as media_engine

    rel = job["payload"].get("path")
    item = media_engine.read_item(case, rel) if rel else None
    if item is None:  # the media (or its sidecar) is gone — nothing to do
        raise workqueue.JobCancelled(f"media gone: {rel}")
    try:
        thumb_rel = generate(case, rel, item.get("sha256", ""), item.get("kind", ""))
    except ThumbnailError as exc:
        raise workqueue.JobFailed(str(exc)) from exc
    media_engine.set_thumbnail(case, rel, thumb_rel)


workqueue.register(THUMB_KIND, _handle)


# -- cache maintenance -----------------------------------------------------


def _thumb_dir(case: "CaseType") -> Path:
    return case.subdir("media") / THUMB_DIR


def cache_size(case: "CaseType") -> int:
    """Total bytes held by the thumbnail cache."""
    thumbs = _thumb_dir(case)
    if not thumbs.is_dir():
        return 0
    return sum(p.stat().st_size for p in thumbs.iterdir() if p.is_file())


def _proof_thumbs(case: "CaseType") -> set[str]:
    """Thumbnails the saved proofs point at. Proofs are not media items, but
    their exports share this cache, so the sweep below has to count them as
    referenced or it would delete every one of them."""
    names = set()
    for spec_path in case.subdir("proofs").joinpath(layout.META_DIR).glob("*.json"):
        try:
            spec = json.loads(spec_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        thumb = spec.get("thumb")
        if isinstance(thumb, str) and thumb:
            names.add(thumb.rsplit("/", 1)[-1])
    return names


def repair(case: "CaseType") -> int:
    """Sweep the cache: delete abandoned temp files and thumbnails nothing live
    references any more (orphans left by a generator bump or a delete).
    Returns how many files were removed. Never touches originals."""
    from . import media as media_engine

    thumbs = _thumb_dir(case)
    if not thumbs.is_dir():
        return 0
    referenced = {
        item["thumbnail"].rsplit("/", 1)[-1]
        for item in media_engine.list_media(case)
        if item.get("thumbnail")
    } | _proof_thumbs(case)
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
