"""Media engine: import local files, download by URL (yt-dlp), hash, thumbnail.

Every media item gets a *sidecar* JSON (``<name>.azimut.json``) recording how it
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
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO

from PIL import Image

from ..workspace import Case, ensure_dir
from . import ffmpeg as ffmpeg_engine
from . import links as link_engine

THUMB_DIR = ".thumbs"
THUMB_MAX = 512
SIDECAR_SUFFIX = ".azimut.json"
# a post's attachments (photos on a tweet, an album, …) fit comfortably under
# this; above it, treat the link as a real playlist and just grab its first
# item, same as the old noplaylist behavior — no picker with hundreds of rows
MAX_PICKER_ITEMS = 20


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
    return ffmpeg_engine.ffmpeg_available()


def make_thumbnail(media_path: Path, thumb_path: Path) -> bool:
    """Best-effort thumbnail. Images via Pillow, videos via ffmpeg if present."""
    ensure_dir(thumb_path.parent)
    kind = media_kind(media_path.name)
    try:
        if kind == "image":
            with Image.open(media_path) as img:
                rgb = img.convert("RGB")
                rgb.thumbnail((THUMB_MAX, THUMB_MAX))
                rgb.save(thumb_path, "JPEG", quality=82)
            return True
        if kind == "video" and ffmpeg_available():
            subprocess.run(
                [
                    ffmpeg_engine.ffmpeg_exe(), "-y", "-loglevel", "error",
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


def _source_paths(source: dict[str, Any]) -> list[str]:
    """The case files a derivative was produced from, as its producer recorded them.

    ``from`` is the single-source op (a frame's video), ``sources`` the
    multi-source one (a collage's pieces). An import, a download or a satellite
    capture has neither: its origin is a URL or a provider, which provenance
    already carries, and there is nothing in the case to point at.
    """
    paths = [source["from"]] if source.get("from") else []
    paths += [p for p in source.get("sources") or [] if p]
    return paths


def _register(
    case: Case,
    media_path: Path,
    source: dict[str, Any],
    *,
    by: str = "media-library",
    entity_type: str = "media",
    extra_attrs: dict[str, Any] | None = None,
    title: str | None = None,
    dedupe: bool = True,
) -> dict[str, Any]:
    """Hash + sidecar + thumbnail + entity. Dedupes on sha256 by default.

    ``by`` records which tool produced the item (media-library import, inspect
    derivative, satellite capture, …) on the entity's provenance (spec §6 honest
    output). ``entity_type`` lets a producer file the item under a more specific
    type than the generic ``media`` (e.g. a satellite ``capture``) while it still
    lives in ``media/`` and shows up in the Media Library; ``extra_attrs`` are
    merged onto that entity (coordinates, zoom, …) and ``title`` seeds the display
    label/sidecar title. ``dedupe=False`` keeps every registration a distinct
    item even when the bytes match an existing one — satellite captures are 1:1
    with their entity (spec §3.5), so re-capturing the same view is two captures.
    """
    digest = sha256_file(media_path)

    if dedupe:
        existing = case.find_entity(attr="sha256", value=digest)
        if existing:
            media_path.unlink()  # identical bytes already in the case
            # the bytes were already here, but this derivation is news: the same
            # frame really can come out of two videos, and the entity keeps both.
            link_engine.link_all(
                case, existing["id"], link_engine.DERIVED_FROM, _source_paths(source), by=by
            )
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
    if title:
        sidecar["title"] = title
    _write_sidecar(media_path, sidecar)

    entity = case.add_entity(
        entity_type,
        title or media_path.name,
        attrs={
            "path": rel_path,
            "sha256": digest,
            "kind": sidecar["kind"],
            **({"source_url": source["url"]} if source.get("url") else {}),
            **(extra_attrs or {}),
        },
        by=by,
        source=source.get("url"),
    )
    # Every media derivative is filed through here, so the derivation chain is
    # wired once for every tool that produces imagery — present and future.
    link_engine.link_all(
        case, entity["id"], link_engine.DERIVED_FROM, _source_paths(source), by=by
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
    case: Case,
    image: Image.Image,
    filename: str,
    source: dict[str, Any],
    *,
    by: str = "inspect",
    entity_type: str = "media",
    extra_attrs: dict[str, Any] | None = None,
    title: str | None = None,
    dedupe: bool = True,
) -> dict[str, Any]:
    """File a freshly rendered PIL image into the case as a media derivative.

    Used by tools that produce new imagery from existing media (frame capture,
    adjustments, collages, satellite crops). The ``source`` dict records the
    derivation so the output stays auditable back to its origin (spec §6).
    ``entity_type``/``extra_attrs``/``title``/``dedupe`` are forwarded to
    :func:`_register` so e.g. a satellite crop files under a ``capture`` entity
    carrying its coordinates while still landing in ``media/``.
    """
    media_dir = case.subdir("media")
    name = safe_filename(filename)
    if not name.lower().endswith(".png"):
        name = f"{Path(name).stem}.png"
    dest = unique_path(media_dir, name)
    # Preserve an alpha channel (e.g. a transparent collage canvas); everything
    # else is flattened to RGB. The thumbnail stage composites alpha over black.
    image.save(dest, "PNG") if image.mode == "RGBA" else image.convert("RGB").save(dest, "PNG")
    return _register(
        case, dest, source, by=by, entity_type=entity_type,
        extra_attrs=extra_attrs, title=title, dedupe=dedupe,
    )


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


def _picker_items(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = []
    for i, entry in enumerate(entries, start=1):
        thumb = entry.get("thumbnail")
        if not thumb and entry.get("thumbnails"):
            thumb = entry["thumbnails"][-1].get("url")
        items.append(
            {
                "index": i,
                "title": entry.get("title") or entry.get("id") or f"item {i}",
                "thumbnail": thumb,
                "kind": media_kind(f"file.{entry['ext']}") if entry.get("ext") else "file",
            }
        )
    return items


def _register_downloaded_item(
    case: Case,
    post_url: str,
    filename: str,
    content: bytes,
    *,
    title: str | None,
    source_extra: dict[str, Any],
) -> dict[str, Any]:
    """Shared tail for the non-yt-dlp download paths (gallery-dl, the Telegram
    photo scraper): write ``content`` into the case's media dir, register it,
    and apply the display title — same bookkeeping ``download_url`` does for
    its own yt-dlp path, minus the yt-dlp-specific extraction bits."""
    media_dir = case.subdir("media")
    tmp_dir = media_dir / ".dl" / uuid.uuid4().hex
    ensure_dir(tmp_dir)
    try:
        fname = safe_filename(filename)
        tmp_path = tmp_dir / fname
        tmp_path.write_bytes(content)
        dest = unique_path(media_dir, fname)
        shutil.move(str(tmp_path), str(dest))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    source = {"type": "download", "url": post_url, "webpage_url": post_url, **source_extra}
    result = _register(case, dest, source)
    display_title = (title or "").strip() or source_extra.get("title")
    if not result["duplicate"] and display_title:
        result["item"] = update_media(case, result["item"]["path"], {"title": display_title})
    result["multi"] = False
    return result


def _gallery_dl_item(file_url: str, kwdict: dict[str, Any]) -> dict[str, Any]:
    content = (kwdict.get("content") or kwdict.get("description") or "").strip()
    first_line = content.splitlines()[0][:120] if content else None
    filename = kwdict.get("filename") or "file"
    ext = kwdict.get("extension") or ""
    date = kwdict.get("date")
    author = kwdict.get("author") or kwdict.get("user") or {}
    return {
        "url": file_url,
        "filename": filename,
        "extension": ext,
        "kind": media_kind(f"file.{ext}") if ext else "file",
        "title": first_line or filename,
        "description": content or None,
        "uploader": author.get("nick") or author.get("name"),
        "upload_date": date.strftime("%Y%m%d") if date is not None and hasattr(date, "strftime") else None,
    }


def _register_gallery_dl_item(
    case: Case, extractor, post_url: str, item: dict[str, Any], *, title: str | None = None
) -> dict[str, Any]:
    resp = extractor.request(item["url"])
    fname = f"{item['filename']}.{item['extension']}" if item["extension"] else item["filename"]
    return _register_downloaded_item(
        case,
        post_url,
        fname,
        resp.content,
        title=title,
        source_extra={
            "downloader": "gallery-dl",
            "title": item["title"],
            "description": item.get("description"),
            "uploader": item.get("uploader"),
            "upload_date": item.get("upload_date"),
            "extractor": "gallery-dl",
        },
    )


def _download_via_gallery_dl(
    case: Case, url: str, *, index: int | None = None, title: str | None = None
) -> dict[str, Any]:
    """Fallback for links yt-dlp can't extract at all.

    yt-dlp's extractors are video-first — X/Twitter, for one, explicitly
    drops photos from what it reports. gallery-dl covers standalone images
    instead: photo tweets, direct image links, Instagram posts, Facebook
    photos. Used when yt-dlp raises (e.g. "No video could be found").
    """
    import gallery_dl.extractor as gdl_extractor

    extractor = gdl_extractor.find(url)
    if extractor is None:
        raise RuntimeError(f"no extractor (yt-dlp or gallery-dl) recognizes this link: {url}")

    items = [_gallery_dl_item(msg[1], msg[2]) for msg in extractor if msg[0] == 3]  # Message.Url
    if not items:
        raise RuntimeError("gallery-dl found no downloadable media at this link")

    if index is None and 1 < len(items) <= MAX_PICKER_ITEMS:
        return {
            "multi": True,
            "items": [
                {"index": i, "title": it["title"], "thumbnail": it["url"], "kind": it["kind"]}
                for i, it in enumerate(items, start=1)
            ],
        }

    picked = items[(index or 1) - 1]
    return _register_gallery_dl_item(case, extractor, url, picked, title=title)


_TELEGRAM_POST_RE = re.compile(r"^https?://(www\.)?(t|telegram)\.me/[^/]+/\d+")


def _telegram_extra_photos(url: str) -> list[dict[str, Any]]:
    """yt-dlp's Telegram extractor only regex-matches ``<video>`` players in
    the public embed page — it has no notion of photos at all, so a mixed
    video+photo album silently loses its photos (verified against a real
    post: 2 videos + 2 photos in the HTML, yt-dlp reports only the 2 videos).
    gallery-dl has no Telegram extractor either. Scrape the same embed page
    ourselves for photo attachments to fill that gap. Best-effort: any
    failure (markup change, non-Telegram URL, network hiccup) yields ``[]``
    rather than breaking the main download flow.
    """
    if not _TELEGRAM_POST_RE.match(url):
        return []
    import requests

    try:
        embed_url = url.split("?")[0] + "?embed=1&single"
        resp = requests.get(embed_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
        resp.raise_for_status()
        html = resp.text
    except Exception:
        return []

    urls = re.findall(
        r"tgme_widget_message_photo_wrap[^\"]*\"[^>]*background-image:url\('([^']+)'\)", html
    )
    return [{"url": u} for u in dict.fromkeys(urls)]  # de-dup, keep order


def _register_telegram_photo(
    case: Case, post_url: str, photo: dict[str, Any], *, title: str | None = None
) -> dict[str, Any]:
    import requests

    resp = requests.get(photo["url"], headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    resp.raise_for_status()
    ext = mimetypes.guess_extension((resp.headers.get("content-type") or "").split(";")[0]) or ".jpg"
    return _register_downloaded_item(
        case,
        post_url,
        f"{uuid.uuid4().hex[:10]}{ext}",
        resp.content,
        title=title,
        source_extra={
            "downloader": "telegram-scrape",
            "title": photo.get("title") or "Telegram photo",
            "extractor": "telegram-scrape",
        },
    )


def download_url(
    case: Case, url: str, progress_hook=None, *, index: int | None = None, title: str | None = None
) -> dict[str, Any]:
    """Resolve and download a URL via yt-dlp. Blocking — run in a worker.

    One extraction total (plus, for Telegram links, one lightweight extra
    fetch — see ``_telegram_extra_photos``). Without ``index``, a post with
    several attachments (a tweet with several photos, a mixed Telegram
    album, …) is *not* downloaded — ``{"multi": True, "items": [...]}`` is
    returned instead so the caller can show a picker and call back with the
    chosen ``index`` (1-based, in picker order). ``title`` overrides the
    sidecar's display title; it defaults to the extracted one.

    Falls back to gallery-dl (see ``_download_via_gallery_dl``) for links
    yt-dlp can't extract at all — most commonly image-only posts.
    """
    import yt_dlp

    media_dir = case.subdir("media")
    # a unique subdir per call — concurrent downloads (the multi-item picker
    # fires one per selected item) must not share a scratch dir, or the first
    # one to finish rmtree()s it out from under the others still writing to it
    tmp_dir = media_dir / ".dl" / uuid.uuid4().hex
    ensure_dir(tmp_dir)

    extra_photos = _telegram_extra_photos(url)  # [] — and free — for non-Telegram links

    ydl_opts = {
        "outtmpl": str(tmp_dir / "%(title).120B [%(id)s].%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": False,
    }
    # Narrow yt-dlp to the one picked entry, as an optimization, ONLY when
    # we're sure the index refers to one of its own entries (i.e. there are
    # no extra Telegram photos whose indices would otherwise collide with it).
    # When narrowed, yt-dlp itself filters `entries` down to that one item, so
    # it must be addressed as entries[0] below, not by the original index.
    narrowed = index is not None and not extra_photos
    if narrowed:
        ydl_opts["playlist_items"] = str(index)
    if ffmpeg_available():
        # a bundled ffmpeg is not on PATH, so yt-dlp can't find it by itself;
        # point it at the directory (None when ffmpeg is a system PATH copy).
        location = ffmpeg_engine.location_for_ytdlp()
        if location:
            ydl_opts["ffmpeg_location"] = location
    else:
        # without ffmpeg yt-dlp cannot merge separate audio+video streams
        ydl_opts["format"] = "best[acodec!=none][vcodec!=none]/best"
    if progress_hook:
        ydl_opts["progress_hooks"] = [progress_hook]

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
            entries = [e for e in (info.get("entries") or []) if e]
        except yt_dlp.utils.DownloadError:
            info = None
            entries = []

        if narrowed:
            if info is None and not entries:
                shutil.rmtree(tmp_dir, ignore_errors=True)
                return _download_via_gallery_dl(case, url, index=index, title=title)
            target_info = entries[0] if entries else info
        else:
            yt_count = len(entries) if entries else (1 if info is not None else 0)
            total = yt_count + len(extra_photos)

            if total == 0:
                shutil.rmtree(tmp_dir, ignore_errors=True)
                return _download_via_gallery_dl(case, url, index=index, title=title)

            if index is None and 1 < total <= MAX_PICKER_ITEMS:
                # several attachments and the caller hasn't picked one yet —
                # report the candidates without downloading anything
                shutil.rmtree(tmp_dir, ignore_errors=True)
                if entries:
                    yt_items = _picker_items(entries)
                elif info is not None:
                    yt_items = [
                        {
                            "index": 1,
                            "title": info.get("title") or info.get("id") or "item 1",
                            "thumbnail": info.get("thumbnail"),
                            "kind": "video",
                        }
                    ]
                else:
                    yt_items = []
                photo_items = [
                    {"index": yt_count + i, "title": "Telegram photo", "thumbnail": p["url"], "kind": "image"}
                    for i, p in enumerate(extra_photos, start=1)
                ]
                return {"multi": True, "items": yt_items + photo_items}

            pick = index or 1
            if pick > yt_count:
                # not a yt-dlp entry — one of the extra Telegram photos
                shutil.rmtree(tmp_dir, ignore_errors=True)
                photo = extra_photos[pick - yt_count - 1]
                return _register_telegram_photo(case, url, photo, title=title)

            target_info = entries[pick - 1] if entries else info

        # download from the info we already extracted — no second extraction
        info = ydl.process_ie_result(target_info, download=True)
        downloaded = Path(ydl.prepare_filename(info))

    if not downloaded.exists():  # extension may differ after post-processing
        # literal substring match — glob would treat "[id]" as a character class
        candidates = sorted(
            (p for p in tmp_dir.iterdir() if f"[{info['id']}]" in p.name),
            key=lambda p: p.stat().st_mtime,
        )
        if not candidates:
            raise RuntimeError("yt-dlp reported success but no file was produced")
        downloaded = candidates[-1]

    dest = unique_path(media_dir, safe_filename(downloaded.name))
    shutil.move(str(downloaded), str(dest))
    shutil.rmtree(tmp_dir, ignore_errors=True)

    extracted_title = info.get("title")
    source = {
        "type": "download",
        "url": url,
        "downloader": "yt-dlp",
        "title": extracted_title,
        "description": info.get("description"),
        "uploader": info.get("uploader") or info.get("channel"),
        "upload_date": info.get("upload_date"),
        "webpage_url": info.get("webpage_url", url),
        "extractor": info.get("extractor"),
        "duration": info.get("duration"),
    }
    result = _register(case, dest, source)

    display_title = (title or "").strip() or extracted_title
    if not result["duplicate"] and display_title:
        result["item"] = update_media(case, result["item"]["path"], {"title": display_title})
    result["multi"] = False
    return result


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
    """Update mutable sidecar fields (notes, folder, title) and mirror them onto
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
        if "title" in patch:
            # a cleared title falls back to the filename, like a fresh import —
            # the sidebar label must never freeze on a title that no longer exists
            entity_patch["label"] = str(patch["title"] or "") or media_path.name
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


def delete_media_files(case: Case, rel_path: str) -> None:
    """Drop a media's file, sidecar and thumbnail, leaving its entity alone.

    The entity side is the delete chokepoint's business (``api.cases``), which
    has to tombstone the dependents before anything is removed.
    """
    media_path = case.resolve_inside(rel_path)
    sidecar = _sidecar_path(media_path)
    data = None
    if sidecar.exists():
        data = json.loads(sidecar.read_text(encoding="utf-8"))
    media_path.unlink(missing_ok=True)
    sidecar.unlink(missing_ok=True)
    if data and data.get("thumbnail"):
        case.resolve_inside(data["thumbnail"]).unlink(missing_ok=True)
