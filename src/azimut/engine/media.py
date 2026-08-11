"""Import, download, hash and thumbnail case media.

Each item has a sidecar recording its source, timestamps and hashes, plus a
media entity in the case graph.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import re
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO

from PIL import Image

from .. import config, layout
from ..workspace import Case, CaseError, ensure_dir
from . import enrich as enrich_engine
from . import ffmpeg as ffmpeg_engine
from . import links as link_engine
from . import thumbnails as thumbnail_engine

# The thumbnail cache lives here; content-addressed generation, the durable job
# model and cache budgeting are owned by `thumbnails.py`. Re-exported for the
# test fixtures that build a case's `.thumbs/` directly.
THUMB_DIR = thumbnail_engine.THUMB_DIR
# Attachment collections fit under this limit. Larger collections use the
# playlist path and select the first item.
MAX_PICKER_ITEMS = 20

# Chromium cookie stores are OS-encrypted and locked while the browser runs.
# Windows app-bound encryption routes these browsers to cookies.txt.
_CHROMIUM_BROWSERS = {"chrome", "chromium", "edge", "brave", "vivaldi", "opera", "whale"}

# Best-effort phrases that identify an authentication failure.
_AUTH_FAILURE_PHRASES = (
    "log in",
    "login",
    "sign in",
    "signin",
    "private",
    "authenticat",
    "age-restrict",
    "age restrict",
    "confirm your age",
    "members-only",
    "members only",
    "requires cookies",
    "cookies-from-browser",
    "http error 403",
    "forbidden",
    "nsfw",
    "account",
)


def _looks_like_auth_failure(message: str) -> bool:
    low = message.lower()
    return any(phrase in low for phrase in _AUTH_FAILURE_PHRASES)


def _is_gallery_auth_error(exc: BaseException) -> bool:
    """gallery-dl raises typed ``AuthenticationError`` / ``AuthorizationError``
    from ``gallery_dl.exception`` when a link needs a login."""
    return type(exc).__name__ in {"AuthenticationError", "AuthorizationError"}


def _resolve_cookie_file(file: str) -> Path:
    """Resolve the stored cookie filename to its protected settings location.

    Absolute paths remain supported for direct engine callers, but the Settings
    API stores only ``cookies.txt`` and that name must follow the workspace
    migration rather than resolving back to the now-empty visible root.
    """
    path = Path(file)
    if path.is_absolute():
        return path
    if path == Path(config.cookies_file_path().name):
        return config.cookies_file_path()
    return config.workspace_root() / path


def _cookie_ydl_opts(cookies: dict[str, Any] | None) -> dict[str, Any]:
    """Translate a cookie source into yt-dlp options; empty means cookie-less."""
    if not cookies:
        return {}
    if cookies.get("browser"):
        return {"cookiesfrombrowser": (cookies["browser"],)}
    if cookies.get("file"):
        return {"cookiefile": str(_resolve_cookie_file(cookies["file"]))}
    return {}


def cookies_from_preference(pref: dict[str, Any] | None) -> dict[str, Any] | None:
    """Map the stored ``download_cookies`` setting to a ``download_url`` cookie
    argument. ``None`` for the off state (and any incomplete record), so a
    half-configured source never gets half-applied."""
    if not pref:
        return None
    source = pref.get("source")
    if source == "browser" and pref.get("browser"):
        return {"browser": pref["browser"]}
    if source == "file" and pref.get("file"):
        return {"file": pref["file"]}
    return None


def _apply_gallery_cookies(cookies: dict[str, Any] | None) -> None:
    """Thread a cookie source into gallery-dl via its global config: a browser
    as a ``[name]`` list, a file as a path string."""
    if not cookies:
        return
    import gallery_dl.config as gdl_config

    if cookies.get("browser"):
        gdl_config.set(("extractor",), "cookies", [cookies["browser"]])
    elif cookies.get("file"):
        gdl_config.set(("extractor",), "cookies", str(_resolve_cookie_file(cookies["file"])))


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
    """Safe imported filename whose stem is also its visible Azimut name."""
    leaf = Path(name).name
    return layout.visible_filename(Path(leaf).stem, Path(leaf).suffix)


def unique_path(directory: Path, filename: str, *, taken_by: Path | None = None) -> Path:
    """Return a case-insensitively non-colliding path in ``directory``.

    Linux would allow ``Clip.mp4`` beside ``clip.mp4``; Windows and the default
    macOS filesystem would merge them. Cases travel between all three, so the
    stricter rule is the portable one. ``taken_by`` is the file being renamed.
    """
    stem, suffix = Path(filename).stem, Path(filename).suffix
    occupied = {
        path.name.casefold() for path in directory.iterdir() if taken_by is None or path != taken_by
    }
    candidate = directory / filename
    counter = 1
    while candidate.name.casefold() in occupied:
        candidate = directory / f"{stem}-{counter}{suffix}"
        counter += 1
    return candidate


def ffmpeg_available() -> bool:
    return ffmpeg_engine.ffmpeg_available()


def _sidecar_path(media_path: Path) -> Path:
    return media_path.parent / layout.META_DIR / (media_path.name + ".json")


#: Prefix and suffix of the scratch file a sidecar write goes through. Named so
#: it can be recognised again: `finally` clears it on any failure this process
#: sees, but a power cut between the write and the rename leaves one behind, and
#: whatever walks a case's files has to know it is debris rather than content
#: (`Case._holds_content`).
SIDECAR_TMP_PREFIX = "."
SIDECAR_TMP_SUFFIX = ".tmp"


def _write_sidecar(media_path: Path, data: dict[str, Any]) -> None:
    sidecar = _sidecar_path(media_path)
    ensure_dir(sidecar.parent)
    temporary = sidecar.with_name(
        f"{SIDECAR_TMP_PREFIX}{sidecar.name}.{uuid.uuid4().hex}{SIDECAR_TMP_SUFFIX}"
    )
    try:
        temporary.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        temporary.replace(sidecar)
    finally:
        temporary.unlink(missing_ok=True)


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
    merged onto that entity (coordinates, zoom, …) and ``title`` chooses the
    canonical filename before registration. ``dedupe=False`` keeps every registration a distinct
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
            return {
                "duplicate": True,
                "entity": existing,
                "item": read_item(case, existing["attrs"]["path"]),
            }

    rel_path = f"media/{media_path.name}"
    kind = media_kind(media_path.name)
    # Cheap image thumbnails render inline for instant feedback; a failed image
    # render and every (CPU-heavy) video are queued to the single worker, which
    # fills the sidecar in later via `set_thumbnail`.
    thumb_rel = thumbnail_engine.on_register(case, rel_path, digest, kind)

    display_name = media_path.stem
    sidecar = {
        "filename": media_path.name,
        "title": display_name,
        "kind": kind,
        "sha256": digest,
        "size": media_path.stat().st_size,
        "added_at": _now(),
        "source": source,
        "thumbnail": thumb_rel,
    }
    _write_sidecar(media_path, sidecar)

    entity = case.add_entity(
        entity_type,
        display_name,
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
    indexed = {**sidecar, "path": rel_path}
    case.upsert_media_item(indexed, entity_id=entity["id"])
    # Enrichment runs after the sidecar and index row exist: the handler reads
    # the item back, and the worker can claim the job the moment it is queued.
    enrich_engine.on_register(case, rel_path, kind, entity["id"])
    # Every media derivative is filed through here, so the derivation chain is
    # wired once for every tool that produces imagery — present and future.
    link_engine.link_all(case, entity["id"], link_engine.DERIVED_FROM, _source_paths(source), by=by)
    return {"duplicate": False, "entity": entity, "item": indexed}


def import_stream(case: Case, filename: str, stream: BinaryIO) -> dict[str, Any]:
    """Import an uploaded file into the case."""
    media_dir = case.subdir("media")
    dest = unique_path(media_dir, safe_filename(filename))
    with dest.open("wb") as out:
        shutil.copyfileobj(stream, out)
    return _register(case, dest, {"type": "upload", "original_name": filename})


def import_paste(
    case: Case,
    filename: str,
    stream: BinaryIO,
    *,
    source_url: str = "",
    title: str = "",
) -> dict[str, Any]:
    """File an image the analyst pasted out of the clipboard.

    Its own entry rather than ``import_stream``'s: a paste has no file behind it to
    be named after, and no origin the bytes can be read for. So the name comes from
    the title typed in the dialog (a stamped one when nothing was typed — every
    clipboard image is called ``image.png``), and the origin is whatever address was
    typed beside it, which is the only chance to state one.

    Recorded as ``clipboard`` and never as an upload: a screenshot with no stated
    source must not read like a file somebody chose off a disk. Deduped like any
    upload, so pasting the same crop twice is one file.
    """
    media_dir = case.subdir("media")
    suffix = Path(safe_filename(filename)).suffix or ".png"
    stamped = f"paste-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    dest = unique_path(media_dir, layout.visible_filename(title.strip() or stamped, suffix))
    with dest.open("wb") as out:
        shutil.copyfileobj(stream, out)
    source: dict[str, Any] = {"type": "clipboard", "original_name": filename}
    if source_url:
        source["url"] = source_url
    return _register(case, dest, source, by="paste")


def register_existing(case: Case, rel_path: str, *, by: str = "case-doctor") -> dict[str, Any]:
    """Adopt a file that was placed directly in this case's media directory.

    The Doctor calls this only after showing the file as unknown and receiving
    an explicit import action. Keeping the registration in the regular media
    chokepoint gives the adopted file the same hash, sidecar, thumbnail,
    enrichment and provenance as an upload.
    """
    raw_path = case.tool_root / rel_path
    media_path = case.resolve_inside(rel_path)
    if (
        raw_path.is_symlink()
        or media_path.parent.resolve() != case.media_dir.resolve()
        or not media_path.is_file()
    ):
        raise CaseError("the file must be directly inside this case's media folder")
    if case.find_entity(attr="path", value=rel_path) is not None:
        raise CaseError(f"media '{rel_path}' is already registered")
    return _register(
        case,
        media_path,
        {"type": "manual", "original_name": media_path.name},
        by=by,
    )


def relink_existing(
    case: Case,
    entity_id: str,
    rel_path: str,
) -> dict[str, Any]:
    """Point a missing media entity at an unregistered replacement file.

    The entity and its relations survive. Only an existing file directly under
    ``media/`` is accepted, so the browser cannot turn this repair into an
    arbitrary filesystem read.
    """
    with case.lock:
        entity = case.get_entity(entity_id)
        if entity is None or entity.get("type") not in {"media", "capture"}:
            raise CaseError(f"media entity '{entity_id}' not found")
        old_rel = str((entity.get("attrs") or {}).get("path") or "")
        if not old_rel:
            raise CaseError(f"media entity '{entity_id}' has no path")
        if case.resolve_inside(old_rel).is_file():
            raise CaseError(f"media '{old_rel}' is not missing")

        raw_path = case.tool_root / rel_path
        media_path = case.resolve_inside(rel_path)
        if (
            raw_path.is_symlink()
            or media_path.parent.resolve() != case.media_dir.resolve()
            or not media_path.is_file()
        ):
            raise CaseError("the replacement must be directly inside this case's media folder")
        claimed = case.find_entity(attr="path", value=rel_path)
        if claimed is not None and claimed.get("id") != entity_id:
            raise CaseError(f"media '{rel_path}' is already registered")

        replacement_item = read_item(case, rel_path)
        old_item = read_item(case, old_rel)
        previous = replacement_item or old_item or {}
        source = previous.get("source")
        if not isinstance(source, dict):
            source = {"type": "manual", "original_name": media_path.name}

        digest = sha256_file(media_path)
        kind = media_kind(media_path.name)
        thumbnail = previous.get("thumbnail")
        if not thumbnail or not case.resolve_inside(str(thumbnail)).is_file():
            thumbnail = thumbnail_engine.on_register(case, rel_path, digest, kind)
        sidecar = {
            **previous,
            "filename": media_path.name,
            "title": media_path.stem,
            "kind": kind,
            "sha256": digest,
            "size": media_path.stat().st_size,
            "added_at": previous.get("added_at") or _now(),
            "source": source,
            "thumbnail": thumbnail,
        }
        sidecar.pop("path", None)
        _write_sidecar(media_path, sidecar)

        case.replace_path_references(old_rel, rel_path)
        updated = case.update_entity(
            entity_id,
            {
                "label": media_path.stem,
                "attrs": {"path": rel_path, "sha256": digest, "kind": kind},
            },
        )
        case.remove_media_item(old_rel)
        indexed = {**sidecar, "path": rel_path}
        case.upsert_media_item(indexed, entity_id=entity_id)
        old_sidecar = _sidecar_path(case.resolve_inside(old_rel))
        if old_sidecar != _sidecar_path(media_path):
            old_sidecar.unlink(missing_ok=True)
        enrich_engine.on_register(case, rel_path, kind, entity_id)
        return {"entity": updated, "item": indexed}


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
    name = (
        layout.visible_filename(title, ".png")
        if title
        else layout.visible_filename(Path(safe_filename(filename)).stem, ".png")
    )
    dest = unique_path(media_dir, name)
    # Preserve an alpha channel (e.g. a transparent collage canvas); everything
    # else is flattened to RGB. The thumbnail stage composites alpha over black.
    image.save(dest, "PNG") if image.mode == "RGBA" else image.convert("RGB").save(dest, "PNG")
    return _register(
        case,
        dest,
        source,
        by=by,
        entity_type=entity_type,
        extra_attrs=extra_attrs,
        title=title,
        dedupe=dedupe,
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
    tmp_dir = media_dir / ".dl" / uuid.uuid4().hex[: layout.DOWNLOAD_ID_LENGTH]
    ensure_dir(tmp_dir)
    display_title = (title or "").strip() or source_extra.get("title")
    try:
        original = safe_filename(filename)
        fname = (
            layout.visible_filename(str(display_title), Path(original).suffix)
            if display_title
            else original
        )
        tmp_path = tmp_dir / fname
        tmp_path.write_bytes(content)
        dest = unique_path(media_dir, fname)
        shutil.move(str(tmp_path), str(dest))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    source = {"type": "download", "url": post_url, "webpage_url": post_url, **source_extra}
    result = _register(case, dest, source)
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
        "upload_date": date.strftime("%Y%m%d")
        if date is not None and hasattr(date, "strftime")
        else None,
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
    case: Case,
    url: str,
    *,
    index: int | None = None,
    title: str | None = None,
    cookies: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Fallback for links yt-dlp can't extract at all.

    yt-dlp's extractors are video-first — X/Twitter, for one, explicitly
    drops photos from what it reports. gallery-dl covers standalone images
    instead: photo tweets, direct image links, Instagram posts, Facebook
    photos. Used when yt-dlp raises (e.g. "No video could be found").
    """
    import gallery_dl.extractor as gdl_extractor

    _apply_gallery_cookies(cookies)
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
    ext = (
        mimetypes.guess_extension((resp.headers.get("content-type") or "").split(";")[0]) or ".jpg"
    )
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


def _fallback_or_needs_auth(
    case: Case,
    url: str,
    *,
    index: int | None,
    title: str | None,
    cookies: dict[str, Any] | None,
    yt_auth: bool,
) -> dict[str, Any]:
    """yt-dlp found nothing — try gallery-dl, but turn a login wall into a
    ``needs_auth`` signal instead of an error, so the UI can offer cookies.

    Only on a cookie-less attempt (``cookies is None``): a wall hit *with*
    cookies already supplied is a real failure (bad/expired session), surfaced
    as the underlying error rather than an endless re-prompt.
    """
    try:
        return _download_via_gallery_dl(case, url, index=index, title=title, cookies=cookies)
    except Exception as exc:
        if cookies is None and (yt_auth or _is_gallery_auth_error(exc)):
            return {"needs_auth": True, "platform": sys.platform}
        raise


def download_url(
    case: Case,
    url: str,
    progress_hook=None,
    *,
    index: int | None = None,
    title: str | None = None,
    cookies: dict[str, Any] | None = None,
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

    ``cookies`` is a login session for gated media (``{"browser": name}`` or
    ``{"file": path}``); ``None`` (the default) downloads cookie-less, so public
    media never touches the session. A gated link tried cookie-less comes back
    as ``{"needs_auth": True, ...}`` for the caller to retry with a source. A
    Chromium pick on Windows can't be read (locked/app-bound store), so it
    returns ``{"needs_auth": True, "guidance": "windows-chromium"}`` untried.
    """
    import yt_dlp

    if cookies and cookies.get("browser") in _CHROMIUM_BROWSERS and sys.platform == "win32":
        return {"needs_auth": True, "guidance": "windows-chromium"}

    media_dir = case.subdir("media")
    # a unique subdir per call — concurrent downloads (the multi-item picker
    # fires one per selected item) must not share a scratch dir, or the first
    # one to finish rmtree()s it out from under the others still writing to it
    tmp_dir = media_dir / ".dl" / uuid.uuid4().hex[: layout.DOWNLOAD_ID_LENGTH]
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
    ydl_opts.update(_cookie_ydl_opts(cookies))

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        yt_auth = False
        try:
            info = ydl.extract_info(url, download=False)
            entries = [e for e in (info.get("entries") or []) if e]
        except yt_dlp.utils.DownloadError as exc:
            yt_auth = _looks_like_auth_failure(str(exc))
            info = None
            entries = []

        if narrowed:
            if info is None and not entries:
                shutil.rmtree(tmp_dir, ignore_errors=True)
                return _fallback_or_needs_auth(
                    case, url, index=index, title=title, cookies=cookies, yt_auth=yt_auth
                )
            target_info = entries[0] if entries else info
        else:
            yt_count = len(entries) if entries else (1 if info is not None else 0)
            total = yt_count + len(extra_photos)

            if total == 0:
                shutil.rmtree(tmp_dir, ignore_errors=True)
                return _fallback_or_needs_auth(
                    case, url, index=index, title=title, cookies=cookies, yt_auth=yt_auth
                )

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
                    {
                        "index": yt_count + i,
                        "title": "Telegram photo",
                        "thumbnail": p["url"],
                        "kind": "image",
                    }
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

    extracted_title = info.get("title")
    display_title = (title or "").strip() or extracted_title
    original = safe_filename(downloaded.name)
    filename = (
        layout.visible_filename(str(display_title), Path(original).suffix)
        if display_title
        else original
    )
    dest = unique_path(media_dir, filename)
    shutil.move(str(downloaded), str(dest))
    shutil.rmtree(tmp_dir, ignore_errors=True)

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
    result["multi"] = False
    return result


def _replace_exact(value: Any, old: str, new: str) -> Any:
    """Recursively replace strings equal to ``old``; never edit prose."""
    if isinstance(value, str):
        return new if value == old else value
    if isinstance(value, list):
        return [_replace_exact(item, old, new) for item in value]
    if isinstance(value, dict):
        return {key: _replace_exact(item, old, new) for key, item in value.items()}
    return value


def write_json_atomic(path: Path, data: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def rename_path(source: Path, destination: Path) -> None:
    """Rename one file, including a case-only rename on Windows/macOS."""
    if source == destination:
        return
    ensure_dir(destination.parent)
    if (
        source.name.casefold() == destination.name.casefold()
        and source.parent == destination.parent
    ):
        temporary = source.with_name(f".azimut-rename-{uuid.uuid4().hex}.tmp")
        source.rename(temporary)
        try:
            temporary.rename(destination)
        except Exception:
            temporary.rename(source)
            raise
        return
    if destination.exists():
        raise CaseError(f"a file named '{destination.name}' already exists")
    source.rename(destination)


def _rename_journal(case: Case) -> Path:
    return case.resolve_inside(f"{layout.DATA_DIR}/rename.json")


def _structured_record_paths(case: Case) -> list[Path]:
    tool = case.tool_root
    roots = (
        layout.subdir(case.path, "proofs") / layout.META_DIR,
        tool / layout.INSPECT_DIR,
        tool / layout.DRAFTS_DIR,
        tool / layout.SEARCH_DIR,
    )
    return [path for root in roots if root.is_dir() for path in sorted(root.glob("*.json"))]


def rewrite_file_references(case: Case, old: str, new: str) -> None:
    """Rewrite exact paths in sidecars and tool specs after a media move."""
    media_dir = case.subdir("media")
    sidecars = media_dir / layout.META_DIR
    if sidecars.is_dir():
        for sidecar in sorted(sidecars.glob("*.json")):
            try:
                data = json.loads(sidecar.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            replaced = _replace_exact(data, old, new)
            if replaced == data:
                continue
            write_json_atomic(sidecar, replaced)
            media_name = sidecar.name.removesuffix(".json")
            entity = case.find_entity(attr="path", value=f"media/{media_name}")
            case.upsert_media_item(
                {**replaced, "path": f"media/{media_name}"},
                entity_id=entity["id"] if entity else None,
            )

    for path in _structured_record_paths(case):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        replaced = _replace_exact(data, old, new)
        if replaced != data:
            write_json_atomic(path, replaced)


def _finish_media_rename(case: Case, record: dict[str, str]) -> dict[str, Any]:
    """Complete one journalled media rename. Safe to call repeatedly."""
    old = record["old"]
    new = record["new"]
    title = record["title"]
    old_path = case.resolve_inside(old)
    new_path = case.resolve_inside(new)
    old_sidecar = _sidecar_path(old_path)
    new_sidecar = _sidecar_path(new_path)

    if old != new:
        if old_path.exists():
            rename_path(old_path, new_path)
        elif not new_path.exists():
            raise CaseError(f"media rename lost both '{old}' and '{new}'")
        if old_sidecar.exists():
            rename_path(old_sidecar, new_sidecar)
        elif not new_sidecar.exists():
            raise CaseError(f"media rename lost the sidecar for '{old}'")

    if not new_path.exists() or not new_sidecar.exists():
        raise CaseError(f"media rename is incomplete for '{new}'")

    data = json.loads(new_sidecar.read_text(encoding="utf-8"))
    data["filename"] = new_path.name
    data["title"] = title
    _write_sidecar(new_path, data)

    owner = case.find_entity(attr="path", value=old) or case.find_entity(attr="path", value=new)
    owner_id = owner["id"] if owner else None
    case.remove_media_item(old)
    case.replace_path_references(old, new)
    if owner_id:
        case.update_entity(owner_id, {"label": title})
    indexed = {**data, "path": new}
    case.upsert_media_item(indexed, entity_id=owner_id)
    rewrite_file_references(case, old, new)
    _rename_journal(case).unlink(missing_ok=True)
    return indexed


def recover_media_rename(case: Case) -> None:
    """Finish a rename interrupted between filesystem and database updates."""
    journal = _rename_journal(case)
    if not journal.exists():
        return
    try:
        record = json.loads(journal.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CaseError("the media rename journal is unreadable") from exc
    if not all(isinstance(record.get(key), str) for key in ("old", "new", "title")):
        raise CaseError("the media rename journal is invalid")
    _finish_media_rename(case, record)


#: How long a rename waits for the background worker to put the file down.
#:
#: The wait itself is required: a thumbnail or enrichment job holds the media
#: open, and Windows cannot move a file another handle has open. What the number
#: has to cover is a slow machine — `wait_until_idle`'s own default is 5 seconds,
#: which is right for the shutdown it was written for and too short here. An
#: import queues enrichment, and the Save gate names the item it just filed, so
#: the two meet on every single save; 5 seconds turned that into "try the rename
#: again" on a name the analyst had already committed to, and the same
#: contention surfaced as a locked database in the write that followed. Matches
#: the workspace move's settle step, which waits for the worker for the same
#: reason.
RENAME_SETTLE_SECONDS = 30.0


def rename_media(
    case: Case,
    rel_path: str,
    requested_title: str | None,
    *,
    settle_worker: bool = True,
) -> dict[str, Any]:
    """Rename a media file and every stored reference to its canonical stem."""
    from . import workqueue

    if settle_worker and not workqueue.wait_until_idle(timeout=RENAME_SETTLE_SECONDS):
        raise CaseError("background media work is still running; try the rename again")
    with case.lock:
        recover_media_rename(case)
        media_path = case.resolve_inside(rel_path)
        if not media_path.exists():
            raise ValueError(f"no media found for {rel_path!r}")
        requested = (requested_title or "").strip() or media_path.stem
        filename = layout.visible_filename(requested, media_path.suffix)
        destination = unique_path(media_path.parent, filename, taken_by=media_path)
        record = {
            "old": rel_path,
            "new": f"media/{destination.name}",
            "title": destination.stem,
        }
        write_json_atomic(_rename_journal(case), record)
        return _finish_media_rename(case, record)


def merge_item(case: Case, rel_path: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    """Merge ``patch`` into a media item's sidecar and mirror it onto the index
    row. Returns the merged item, or None when the sidecar is gone.

    Held under the case lock: several background handlers patch different fields
    of the same sidecar (a thumbnail path, then enrichment facts), and an
    unguarded read-modify-write would drop whichever landed first.
    """
    with case.lock:
        media_path = case.resolve_inside(rel_path)
        sidecar = _sidecar_path(media_path)
        if not sidecar.exists():
            return None
        data = json.loads(sidecar.read_text(encoding="utf-8"))
        data.update(patch)
        _write_sidecar(media_path, data)
        indexed = {**data, "path": rel_path}
        case.upsert_media_item(indexed)
        return indexed


def set_thumbnail(case: Case, rel_path: str, thumb_rel: str | None) -> None:
    """Record (or clear) a media item's thumbnail path in its sidecar. The
    thumbnail worker calls this once it finishes a queued (e.g. video) render, so
    the next media listing reports the thumbnail as ready."""
    merge_item(case, rel_path, {"thumbnail": thumb_rel})


def read_item(case: Case, rel_path: str) -> dict[str, Any] | None:
    with case.lock:
        media_path = case.resolve_inside(rel_path)
        sidecar = _sidecar_path(media_path)
        if not sidecar.exists():
            return None
        data = json.loads(sidecar.read_text(encoding="utf-8"))
        data["path"] = rel_path
        return data


def list_media(case: Case) -> list[dict[str, Any]]:
    return case.list_media_items()


def update_media(case: Case, rel_path: str, patch: dict[str, Any]) -> dict[str, Any]:
    """Update mutable sidecar fields and mirror them onto the media entity.

    Under the case lock, like every other sidecar write: the Save gate names an
    item immediately after filing it, while the enrichment job queued by that
    same filing may already be writing the file's own facts to the same sidecar.
    Unguarded, whichever finished second dropped the other's fields — and the one
    users noticed was the name they had just typed.
    """
    if "title" in patch:
        renamed = rename_media(case, rel_path, patch["title"])
        rel_path = renamed["path"]
        patch = {key: value for key, value in patch.items() if key != "title"}
        if not patch:
            return renamed

    with case.lock:
        recover_media_rename(case)
        media_path = case.resolve_inside(rel_path)
        sidecar = _sidecar_path(media_path)
        if not sidecar.exists():
            raise ValueError(f"no sidecar found for {rel_path!r}")

        data = json.loads(sidecar.read_text(encoding="utf-8"))
        for key in ("notes", "folder"):
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
            attrs: dict[str, Any] = {}
            if "folder" in patch:
                attrs["folder"] = patch["folder"] or ""
            if "notes" in patch:
                attrs["notes"] = patch["notes"] or ""
            if attrs:
                entity_patch["attrs"] = attrs
            if entity_patch:
                case.update_entity(entity["id"], entity_patch)

        indexed = {**data, "path": rel_path}
        case.upsert_media_item(indexed, entity_id=entity["id"] if entity else None)
        return indexed


def delete_media_files(case: Case, rel_path: str) -> None:
    """Drop a media's file, sidecar and thumbnail, leaving its entity alone.

    For a media the case never filed as an entity — the caller found no graph to
    honour and drops the files itself. What those files are is the artifact
    registry's answer, not this module's, so the two paths cannot drift; the
    entity side is the delete chokepoint's business (``api.cases``), which has to
    tombstone the dependents before anything is removed.
    """
    from . import artifacts

    artifacts.delete(case, {"type": "media", "attrs": {"path": rel_path}})
