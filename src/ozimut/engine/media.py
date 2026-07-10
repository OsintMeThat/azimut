"""Media engine: import local files, download by URL (yt-dlp), hash, thumbnail.

Every media item gets a *sidecar* JSON (``<name>.ozimut.json``) recording how it
entered the case — source, timestamps, hashes (spec §3.6 honest output) — and a
``media`` entity in ``case.json``.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO

from PIL import Image

from ..workspace import Case

THUMB_DIR = ".thumbs"
THUMB_MAX = 512
SIDECAR_SUFFIX = ".ozimut.json"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def media_kind(filename: str) -> str:
    mime = mimetypes.guess_type(filename)[0] or ""
    for kind in ("image", "video", "audio"):
        if mime.startswith(kind):
            return kind
    return "file"


def safe_filename(name: str) -> str:
    name = Path(name).name  # strip any path component
    name = re.sub(r"[^\w.\- ]+", "_", name).strip(" .") or "file"
    return name[:150]


def unique_path(directory: Path, filename: str) -> Path:
    """Return a non-colliding path in directory for filename."""
    stem, suffix = Path(filename).stem, Path(filename).suffix
    candidate = directory / filename
    counter = 1
    while candidate.exists():
        candidate = directory / f"{stem}-{counter}{suffix}"
        counter += 1
    return candidate


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def make_thumbnail(media_path: Path, thumb_path: Path) -> bool:
    """Best-effort thumbnail. Images via Pillow, videos via ffmpeg if present."""
    thumb_path.parent.mkdir(exist_ok=True)
    kind = media_kind(media_path.name)
    try:
        if kind == "image":
            with Image.open(media_path) as img:
                img = img.convert("RGB")
                img.thumbnail((THUMB_MAX, THUMB_MAX))
                img.save(thumb_path, "JPEG", quality=82)
            return True
        if kind == "video" and ffmpeg_available():
            subprocess.run(
                [
                    "ffmpeg", "-y", "-loglevel", "error",
                    "-ss", "1", "-i", str(media_path),
                    "-frames:v", "1", "-vf", f"scale={THUMB_MAX}:-2",
                    str(thumb_path),
                ],
                check=True,
                timeout=30,
                capture_output=True,
            )
            return thumb_path.exists()
    except Exception:
        thumb_path.unlink(missing_ok=True)
    return False


def _sidecar_path(media_path: Path) -> Path:
    return media_path.with_name(media_path.name + SIDECAR_SUFFIX)


def _write_sidecar(media_path: Path, data: dict[str, Any]) -> None:
    _sidecar_path(media_path).write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def _register(
    case: Case, media_path: Path, source: dict[str, Any], *, by: str = "media-library"
) -> dict[str, Any]:
    """Hash + sidecar + thumbnail + media entity. Dedupes on sha256.

    ``by`` records which tool produced the item (media-library import, inspect
    derivative, …) on the media entity's provenance (spec §6 honest output).
    """
    digest = sha256_file(media_path)

    existing = case.find_entity(attr="sha256", value=digest)
    if existing:
        media_path.unlink()  # identical bytes already in the case
        return {"duplicate": True, "entity": existing, "item": read_item(case, existing["attrs"]["path"])}

    rel_path = f"media/{media_path.name}"
    thumb = case.subdir("media") / THUMB_DIR / (media_path.name + ".jpg")
    has_thumb = make_thumbnail(media_path, thumb)

    sidecar = {
        "filename": media_path.name,
        "kind": media_kind(media_path.name),
        "sha256": digest,
        "size": media_path.stat().st_size,
        "added_at": _now(),
        "source": source,
        "thumbnail": f"media/{THUMB_DIR}/{media_path.name}.jpg" if has_thumb else None,
    }
    _write_sidecar(media_path, sidecar)

    entity = case.add_entity(
        "media",
        media_path.name,
        attrs={"path": rel_path, "sha256": digest, **({"source_url": source["url"]} if source.get("url") else {})},
        by=by,
        source=source.get("url"),
    )
    return {"duplicate": False, "entity": entity, "item": {**sidecar, "path": rel_path}}


def import_stream(case: Case, filename: str, stream: BinaryIO) -> dict[str, Any]:
    """Import an uploaded file into the case."""
    media_dir = case.subdir("media")
    dest = unique_path(media_dir, safe_filename(filename))
    with dest.open("wb") as out:
        shutil.copyfileobj(stream, out)
    return _register(case, dest, {"type": "upload", "original_name": filename})


def import_image(
    case: Case, image: Image.Image, filename: str, source: dict[str, Any], *, by: str = "inspect"
) -> dict[str, Any]:
    """File a freshly rendered PIL image into the case as a media derivative.

    Used by tools that produce new imagery from existing media (frame capture,
    adjustments, collages). The ``source`` dict records the derivation so the
    output stays auditable back to its origin (spec §6).
    """
    media_dir = case.subdir("media")
    name = safe_filename(filename)
    if not name.lower().endswith(".png"):
        name = f"{Path(name).stem}.png"
    dest = unique_path(media_dir, name)
    # Preserve an alpha channel (e.g. a transparent collage canvas); everything
    # else is flattened to RGB. The thumbnail stage composites alpha over black.
    image.save(dest, "PNG") if image.mode == "RGBA" else image.convert("RGB").save(dest, "PNG")
    return _register(case, dest, source, by=by)


def import_produced_file(
    case: Case, src_path: Path, filename: str, source: dict[str, Any], *, by: str = "inspect"
) -> dict[str, Any]:
    """File a tool-produced file (e.g. an ffmpeg-enhanced video) into the case.

    Unlike ``import_image`` (PNG only) this keeps the produced container/codec and,
    unlike ``import_stream``, records a derivation ``source`` so the output stays
    auditable back to its origin (spec §6). The source file is moved into ``media/``.
    """
    media_dir = case.subdir("media")
    dest = unique_path(media_dir, safe_filename(filename))
    shutil.move(str(src_path), str(dest))
    return _register(case, dest, source, by=by)


def download_url(case: Case, url: str, progress_hook=None) -> dict[str, Any]:
    """Download a URL via yt-dlp into the case. Blocking — run in a worker."""
    import yt_dlp

    media_dir = case.subdir("media")
    tmp_dir = media_dir / ".dl"
    tmp_dir.mkdir(exist_ok=True)

    ydl_opts = {
        "outtmpl": str(tmp_dir / "%(title).120B [%(id)s].%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": False,
    }
    if not ffmpeg_available():
        # without ffmpeg yt-dlp cannot merge separate audio+video streams
        ydl_opts["format"] = "best[acodec!=none][vcodec!=none]/best"
    if progress_hook:
        ydl_opts["progress_hooks"] = [progress_hook]

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        downloaded = Path(ydl.prepare_filename(info))

    if not downloaded.exists():  # extension may differ after post-processing
        candidates = sorted(tmp_dir.glob(f"*[{info['id']}]*"), key=lambda p: p.stat().st_mtime)
        if not candidates:
            raise RuntimeError("yt-dlp reported success but no file was produced")
        downloaded = candidates[-1]

    dest = unique_path(media_dir, safe_filename(downloaded.name))
    shutil.move(str(downloaded), str(dest))
    shutil.rmtree(tmp_dir, ignore_errors=True)

    source = {
        "type": "download",
        "url": url,
        "downloader": f"yt-dlp",
        "title": info.get("title"),
        "description": info.get("description"),
        "uploader": info.get("uploader") or info.get("channel"),
        "upload_date": info.get("upload_date"),
        "webpage_url": info.get("webpage_url", url),
        "extractor": info.get("extractor"),
        "duration": info.get("duration"),
    }
    return _register(case, dest, source)


def read_item(case: Case, rel_path: str) -> dict[str, Any] | None:
    media_path = case.resolve_inside(rel_path)
    sidecar = _sidecar_path(media_path)
    if not sidecar.exists():
        return None
    data = json.loads(sidecar.read_text(encoding="utf-8"))
    data["path"] = rel_path
    return data


def list_media(case: Case) -> list[dict[str, Any]]:
    media_dir = case.subdir("media")
    items = []
    for sidecar in sorted(media_dir.glob(f"*{SIDECAR_SUFFIX}")):
        media_name = sidecar.name[: -len(SIDECAR_SUFFIX)]
        if not (media_dir / media_name).exists():
            continue
        data = json.loads(sidecar.read_text(encoding="utf-8"))
        data["path"] = f"media/{media_name}"
        items.append(data)
    items.sort(key=lambda d: d.get("added_at") or "", reverse=True)
    return items


def update_media(case: Case, rel_path: str, patch: dict[str, Any]) -> dict[str, Any]:
    """Update mutable sidecar fields (notes, folder, label) and mirror them onto
    the media entity so the case sidebar stays in sync."""
    media_path = case.resolve_inside(rel_path)
    sidecar = _sidecar_path(media_path)
    if not sidecar.exists():
        raise ValueError(f"no sidecar found for {rel_path!r}")

    data = json.loads(sidecar.read_text(encoding="utf-8"))
    for key in ("notes", "folder", "title"):
        if key in patch:
            val = patch[key]
            if val is None or val == "":
                data.pop(key, None)
            else:
                data[key] = str(val)

    _write_sidecar(media_path, data)

    # mirror onto the media entity (label mirrors the title; folder/notes attrs)
    entity = case.find_entity(attr="path", value=rel_path)
    if entity:
        entity_patch: dict[str, Any] = {}
        if patch.get("title"):
            entity_patch["label"] = patch["title"]
        attrs: dict[str, Any] = {}
        if "folder" in patch:
            attrs["folder"] = patch["folder"] or ""
        if "notes" in patch:
            attrs["notes"] = patch["notes"] or ""
        if attrs:
            entity_patch["attrs"] = attrs
        if entity_patch:
            case.update_entity(entity["id"], entity_patch)

    return {**data, "path": rel_path}


def delete_media(case: Case, rel_path: str) -> None:
    media_path = case.resolve_inside(rel_path)
    sidecar = _sidecar_path(media_path)
    data = None
    if sidecar.exists():
        data = json.loads(sidecar.read_text(encoding="utf-8"))
    media_path.unlink(missing_ok=True)
    sidecar.unlink(missing_ok=True)
    if data and data.get("thumbnail"):
        case.resolve_inside(data["thumbnail"]).unlink(missing_ok=True)
    # remove the matching media entity (matched by case-relative path)
    entity = case.find_entity(attr="path", value=rel_path)
    if entity:
        case.remove_entity(entity["id"])
