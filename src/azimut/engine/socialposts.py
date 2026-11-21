"""Someone's post on X or Bluesky, kept in the case and drawn in a note by Azimut itself.

A note quotes a post with `/post`: the analyst pastes its link and the post is read
**once, on that press**, then kept in the case, so the note still draws it after the
post is deleted. Nothing of X's or Bluesky's runs in the reader's browser: no widget, no
script, no picture loaded from their servers. Every document draws the post from what
the case holds (`card`), in the note's own look.

**Where it lives.** A post is a ``social-post`` entity whose record is
``.posts/<name>.json`` (`layout.social_post_rel`): its words, who posted it, when, and
where. Its pictures and videos are media of the case, filed by the downloader's own
registration (`media._register_downloaded_item`), so they are in the Media Library, can
be geolocated, and a file the case already held is not filed twice. Beside the record a
folder (`layout.social_post_files_rel`) holds what only the post needs: its author's
profile picture and a still of each video the platform gives one for.

**How it is read.**

- X through gallery-dl (`gallerydl.post`), which X answers for a guest and, behind a
  wall, with the session Settings holds, as the downloads do (`media.fetch_url`): tried
  without cookies first, then once with the stored session, else ``NeedsLogin``.
  A post with no picture is still a post: gallery-dl says its words when asked
  (`text-tweets`).
- Bluesky through its public, keyless API (``app.bsky.feed.getPostThread`` on
  ``public.api.bsky.app``), whose answer holds the words, the author, the pictures and a
  video's still. The video itself comes through the downloader (`media.download_url`).
- One of the analyst's own posts, published from Post with its link, is read from its
  draft: no network at all. A file the case downloaded from a post makes one too, from
  what the download recorded (`from_media`).

**How a note names it.** A ``::: post`` block of ``key: value`` lines (`parse_block`):
``post: <entity id>`` for each post, a thread when there are several, each followed by
the analyst's own lines for it (``highlight:``, the exact passage that matters, and
``translation:``); then ``form:`` (``card``, ``quote`` or ``compact``), ``avatar: hidden``
and ``qr: on`` for the whole block. A ``link:`` line is a post not kept yet: the block
holds it until the press that reads it, or after a read that failed.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import unicodedata
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

import httpx
from PIL import Image, ImageOps

from .. import USER_AGENT, config, layout
from ..workspace import CaseError, ensure_dir
from . import gallerydl, urltitles
from . import media as media_engine

if TYPE_CHECKING:
    from ..workspace import Case

#: The entity type, and what filed it.
TYPE = "social-post"
BY = "post-card"
VERSION = 1

#: The two sites, and how a reader is told which.
SITES = {"x": "X", "bluesky": "Bluesky"}
#: X's own hosts and the mirrors people paste (each answers the same post by its number).
X_HOSTS = frozenset({
    "x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com", "vxtwitter.com", "fxtwitter.com",
    "fixupx.com", "fixvx.com", "d.fxtwitter.com",
})
BLUESKY_HOSTS = frozenset({"bsky.app", "staging.bsky.app"})
#: An X handle and a post's number, as X writes them.
X_HANDLE = re.compile(r"^[A-Za-z0-9_]{1,15}$")
X_ID = re.compile(r"^\d{1,25}$")
#: A Bluesky handle (a domain) or a DID, and a record key.
BLUESKY_ACTOR = re.compile(r"^(?:did:[a-z]+:[A-Za-z0-9._:%-]{1,200}|[A-Za-z0-9.-]{1,253})$")
BLUESKY_KEY = re.compile(r"^[A-Za-z0-9._:~-]{1,64}$")

#: Bluesky's public view of a post, which needs no account.
BLUESKY_API = "https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread"
#: The hosts a post's pictures, videos and profile picture are fetched from, and nothing else.
MEDIA_HOSTS = ("twimg.com", "bsky.app", "bsky.network")

#: How long a read may take.
TIMEOUT = httpx.Timeout(30.0, connect=10.0)
#: The most a picture, a profile picture and a video may weigh on their way in.
MAX_PICTURE_BYTES = 30 * 1024 * 1024
MAX_AVATAR_BYTES = 5 * 1024 * 1024
MAX_VIDEO_BYTES = 400 * 1024 * 1024
#: How many pictures one post shows (both sites take four).
MAX_PICTURES = 4
#: How many posts one block holds: a thread longer than this is several blocks.
MAX_THREAD = 12
#: The longest words, translation and highlight kept, in characters.
MAX_TEXT = 6000
MAX_SAID = 2000
#: The side the profile picture is kept at, in pixels.
AVATAR_SIDE = 400
#: How many highlights one post keeps.
MAX_HIGHLIGHTS = 6

#: The forms a block draws in. A thread is a card with several posts.
FORMS = ("card", "quote", "compact")
#: The colours a profile picture's stand-in is drawn in, two per pair, picked by the handle.
TINTS = (
    ("#3c5a6e", "#20323e"), ("#2f6fb0", "#1a3d66"), ("#7a5230", "#4a2f19"), ("#4b6b3b", "#2b4120"),
    ("#6b3f66", "#3f223b"), ("#8a5a1c", "#57380e"), ("#2f6b68", "#1a4240"), ("#6e3b3b", "#432121"),
)
#: A `::: post` block, as every renderer finds it.
BLOCK = re.compile(r"^:::[ \t]*post[ \t]*\n(.*?)^:::[ \t]*$", re.S | re.M)
ENTITY_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class PostError(RuntimeError):
    """A post that could not be read, said plainly for the block that asked for it."""


class NotAPost(PostError):
    """The address is not a post on X or Bluesky."""


class NeedsLogin(PostError):
    """The site wants a signed-in session to show this post."""

    def __init__(self, message: str, *, refused: bool = False) -> None:
        super().__init__(message)
        #: True when a session was tried and still refused.
        self.refused = refused


# -- addresses -------------------------------------------------------------------------


@dataclass(frozen=True)
class Link:
    """A post's address, read: its site, who posted it, its own key on that site."""

    site: str
    handle: str
    ident: str

    @property
    def url(self) -> str:
        if self.site == "x":
            return f"https://x.com/{self.handle or 'i'}/status/{self.ident}"
        return f"https://bsky.app/profile/{self.handle}/post/{self.ident}"

    @property
    def key(self) -> str:
        """What two links to the same post share: X's number, Bluesky's account and key."""
        return f"x:{self.ident}" if self.site == "x" else f"bluesky:{self.handle.lower()}/{self.ident}"

    @property
    def name(self) -> str:
        """The name its record is filed under: the site and the post's own key."""
        if self.site == "x":
            return f"x-{self.ident}"
        safe = re.sub(r"[^A-Za-z0-9_-]", "-", self.ident)[:40]
        digest = hashlib.sha256(self.key.encode("utf-8")).hexdigest()[:8]
        return f"bluesky-{safe}-{digest}"


def parse_link(text: Any) -> Link | None:
    """A post on X (or a mirror of it) or Bluesky, from an address pasted as it was found."""
    value = str(text or "").strip().strip("<>")
    if not value or len(value) > 2000 or any(ch.isspace() for ch in value):
        return None
    if "://" not in value:
        value = f"https://{value}"
    try:
        parts = urlsplit(value)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https"):
        return None
    host = (parts.hostname or "").lower().rstrip(".")
    if host.startswith("www."):
        host = host[4:]
    segs = [seg for seg in parts.path.split("/") if seg]
    if host in X_HOSTS:
        for at, seg in enumerate(segs):
            if seg in ("status", "statuses") and at + 1 < len(segs) and X_ID.match(segs[at + 1]):
                handle = segs[at - 1] if at >= 1 else ""
                if handle == "web" and at >= 2:
                    handle = segs[at - 2]
                handle = handle if X_HANDLE.match(handle) and handle.lower() != "i" else ""
                return Link("x", handle, segs[at + 1])
        return None
    if host in BLUESKY_HOSTS and len(segs) >= 4 and segs[0] == "profile" and segs[2] == "post":
        actor, key = segs[1], segs[3]
        if BLUESKY_ACTOR.match(actor) and BLUESKY_KEY.match(key):
            return Link("bluesky", actor, key)
    return None


# -- what a read brings back -----------------------------------------------------------


@dataclass
class Shown:
    """One picture or video of a post, as the site gave it."""

    kind: str  # "image" or "video"
    url: str = ""
    poster_url: str = ""
    duration: float | None = None
    alt: str = ""
    ext: str = ""


@dataclass
class Read:
    """What a site says of one post."""

    link: Link
    name: str
    handle: str
    text: str
    posted_at: str = ""
    lang: str = ""
    avatar_url: str = ""
    shown: list[Shown] = field(default_factory=list)
    links: list[str] = field(default_factory=list)

    @property
    def url(self) -> str:
        return Link(self.link.site, self.handle or self.link.handle, self.link.ident).url


def client(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    """The one client a post and its pictures are read with (tests hand it a transport)."""
    return httpx.Client(timeout=TIMEOUT, follow_redirects=True, transport=transport,
                        headers={"User-Agent": USER_AGENT})


def _iso(value: Any) -> str:
    """A moment as `2026-11-15T05:12:00Z`, from gallery-dl's `2026-11-15 05:12:00` or an
    ISO stamp with an offset; "" when it says none."""
    if isinstance(value, datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    else:
        said = str(value or "").strip()
        if not said:
            return ""
        try:
            moment = datetime.fromisoformat(said.replace("Z", "+00:00").replace(" ", "T", 1))
        except ValueError:
            return ""
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _x_read(link: Link, meta: dict[str, Any], files: list[tuple[str, dict[str, Any]]]) -> Read:
    author = meta.get("author") or meta.get("user") or {}
    author = author if isinstance(author, dict) else {}
    # gallery-dl names X's handle `name` and the name shown `nick`
    handle = str(author.get("name") or link.handle or "").strip()
    shown: list[Shown] = []
    for url, kwdict in files[:MAX_PICTURES]:
        ext = str(kwdict.get("extension") or "").lower()
        kind = "video" if (kwdict.get("type") in ("video", "animated_gif") or ext in ("mp4", "mov", "webm")) else "image"
        duration = kwdict.get("duration")
        shown.append(Shown(kind=kind, url=url, ext=ext,
                           duration=float(duration) if isinstance(duration, (int, float)) and duration > 0 else None,
                           alt=str(kwdict.get("description") or "").strip()[:MAX_SAID]))
    return Read(
        link=Link("x", handle if X_HANDLE.match(handle) else link.handle, link.ident),
        name=str(author.get("nick") or handle or "").strip()[:200],
        handle=handle if X_HANDLE.match(handle) else link.handle,
        text=str(meta.get("content") or "").strip()[:MAX_TEXT],
        posted_at=_iso(meta.get("date")),
        lang=str(meta.get("lang") or "")[:12],
        avatar_url=str(author.get("profile_image") or ""),
        shown=shown,
    )


def read_x(link: Link, cookies: dict[str, Any] | None = None) -> Read:
    """An X post through gallery-dl, as the downloads read X (`engine/gallerydl.py`)."""
    try:
        meta, files = gallerydl.post(link.url, media_engine._gallery_args(cookies))
    except gallerydl.UnsupportedURL as exc:
        raise NotAPost("gallery-dl does not read this address") from exc
    except gallerydl.GalleryError as exc:
        if media_engine._is_gallery_auth_error(exc):
            raise NeedsLogin("X wants a signed-in session to show this post", refused=cookies is not None) from exc
        raise PostError(f"X did not show the post: {exc}") from exc
    except OSError as exc:
        raise PostError(f"gallery-dl could not run: {exc}") from exc
    if not meta:
        raise PostError("X showed nothing at this address")
    return _x_read(link, meta, files)


def _bluesky_shown(embed: Any) -> list[Shown]:
    """The pictures or video a Bluesky post's view holds, its own or beside a quoted post."""
    if not isinstance(embed, dict):
        return []
    kind = str(embed.get("$type") or "")
    if kind.startswith("app.bsky.embed.recordWithMedia"):
        return _bluesky_shown(embed.get("media"))
    if kind.startswith("app.bsky.embed.images"):
        out = []
        for image in embed.get("images") or []:
            if isinstance(image, dict) and image.get("fullsize"):
                out.append(Shown(kind="image", url=str(image["fullsize"]), alt=str(image.get("alt") or "")[:MAX_SAID]))
        return out[:MAX_PICTURES]
    if kind.startswith("app.bsky.embed.video"):
        return [Shown(kind="video", poster_url=str(embed.get("thumbnail") or ""), alt=str(embed.get("alt") or "")[:MAX_SAID])]
    return []


def read_bluesky(link: Link, http: httpx.Client) -> Read:
    """A Bluesky post through the public API, which needs no account."""
    uri = f"at://{link.handle}/app.bsky.feed.post/{link.ident}"
    try:
        answer = http.get(BLUESKY_API, params={"uri": uri, "depth": 0, "parentHeight": 0})
    except httpx.HTTPError as exc:
        raise PostError(f"Bluesky could not be reached: {_reason(exc)}") from exc
    if answer.status_code in (400, 404):
        raise PostError("Bluesky has no post at this address")
    if answer.status_code >= 400:
        raise PostError(f"Bluesky answered {answer.status_code}")
    try:
        thread = answer.json().get("thread") or {}
    except ValueError as exc:
        raise PostError("Bluesky's answer could not be read") from exc
    kind = str(thread.get("$type") or "")
    if kind.endswith("#notFoundPost"):
        raise PostError("Bluesky has no post at this address")
    if kind.endswith("#blockedPost"):
        raise PostError("Bluesky does not show this post")
    post = thread.get("post") if isinstance(thread, dict) else None
    if not isinstance(post, dict):
        raise PostError("Bluesky's answer holds no post")
    author = post.get("author") or {}
    record = post.get("record") or {}
    handle = str(author.get("handle") or link.handle)
    links: list[str] = []
    for facet in record.get("facets") or []:
        for feature in (facet.get("features") or []) if isinstance(facet, dict) else []:
            if isinstance(feature, dict) and str(feature.get("$type", "")).endswith("#link") and feature.get("uri"):
                links.append(str(feature["uri"]))
    langs = record.get("langs") or []
    return Read(
        link=Link("bluesky", handle if BLUESKY_ACTOR.match(handle) else link.handle, link.ident),
        name=str(author.get("displayName") or handle).strip()[:200],
        handle=handle,
        text=str(record.get("text") or "").strip()[:MAX_TEXT],
        posted_at=_iso(record.get("createdAt") or post.get("indexedAt")),
        lang=str(langs[0])[:12] if isinstance(langs, list) and langs else "",
        avatar_url=str(author.get("avatar") or ""),
        shown=_bluesky_shown(post.get("embed")),
        links=links[:20],
    )


def _reason(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "it took too long to answer"
    if isinstance(exc, httpx.ConnectError):
        return "no connection"
    return str(exc) or type(exc).__name__


# -- filing ----------------------------------------------------------------------------


def _media_host(url: str) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and any(host == one or host.endswith(f".{one}") for one in MEDIA_HOSTS)


def _fetch_bytes(http: httpx.Client, url: str, limit: int) -> bytes | None:
    """A file from one of the sites' own hosts, or None when it is elsewhere, too big or gone."""
    if not _media_host(url):
        return None
    try:
        with http.stream("GET", url) as answer:
            if answer.status_code >= 400:
                return None
            buffer = bytearray()
            for chunk in answer.iter_bytes():
                buffer.extend(chunk)
                if len(buffer) > limit:
                    return None
            return bytes(buffer)
    except httpx.HTTPError:
        return None


def _fetch_file(http: httpx.Client, url: str, into: Path, limit: int) -> bool:
    """A large file streamed to ``into``, kept only when it arrived whole under ``limit``."""
    if not _media_host(url):
        return False
    try:
        with http.stream("GET", url) as answer, into.open("wb") as out:
            if answer.status_code >= 400:
                return False
            written = 0
            for chunk in answer.iter_bytes():
                written += len(chunk)
                if written > limit:
                    return False
                out.write(chunk)
        return True
    except (httpx.HTTPError, OSError):
        return False


def _still(data: bytes, side: int) -> bytes | None:
    """A picture made again as a JPEG no larger than ``side``, its metadata left behind."""
    try:
        with Image.open(BytesIO(data)) as opened:
            if opened.width * opened.height > 100_000_000:
                return None
            picture = ImageOps.exif_transpose(opened).convert("RGB")
    except (OSError, ValueError, Image.DecompressionBombError):
        return None
    picture.thumbnail((side, side), Image.Resampling.LANCZOS)
    buffer = BytesIO()
    picture.save(buffer, "JPEG", quality=88, optimize=True)
    return buffer.getvalue()


def _source_extra(read: Read) -> dict[str, Any]:
    day = read.posted_at[:10].replace("-", "") if read.posted_at else None
    return {
        "downloader": "post-card",
        "title": (read.text.splitlines()[0][:120] if read.text else None) or f"Post by @{read.handle}",
        "description": read.text or None,
        "uploader": read.name or read.handle or None,
        "upload_date": day,
        "links": read.links or None,
    }


def _file_picture(case: "Case", read: Read, data: bytes, ext: str, number: int) -> dict[str, Any] | None:
    """A picture of the post filed as media, through the downloader's own registration."""
    stem = f"@{read.handle} {read.link.ident} {number}" if read.handle else f"post {read.link.ident} {number}"
    try:
        filed = media_engine._register_downloaded_item(
            case, read.url, f"{stem}.{ext or 'jpg'}", data, title=stem, source_extra=_source_extra(read))
    except (CaseError, OSError, ValueError):
        return None
    entity = filed.get("entity") or {}
    return entity if entity.get("attrs", {}).get("path") else None


def _file_video(case: "Case", read: Read, http: httpx.Client, url: str, ext: str, number: int) -> dict[str, Any] | None:
    """A video of the post streamed into the case and filed as media, as a download is."""
    media_dir = case.subdir("media")
    scratch = media_dir / ".dl" / uuid.uuid4().hex[: layout.DOWNLOAD_ID_LENGTH]
    ensure_dir(scratch)
    try:
        stem = f"@{read.handle} {read.link.ident} {number}" if read.handle else f"post {read.link.ident} {number}"
        held = scratch / f"video.{ext or 'mp4'}"
        if not _fetch_file(http, url, held, MAX_VIDEO_BYTES):
            return None
        name = layout.visible_filename(stem, held.suffix)
        dest = media_engine.unique_path(media_dir, name)
        shutil.move(str(held), str(dest))
        source = {"type": "download", "url": read.url, "webpage_url": read.url, **_source_extra(read)}
        filed = media_engine._deliver(case, dest, source)
    except (CaseError, OSError, ValueError):
        return None
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    entity = filed.get("entity") or {}
    return entity if entity.get("attrs", {}).get("path") else None


def _download_video(case: "Case", read: Read, cookies: dict[str, Any] | None) -> dict[str, Any] | None:
    """A video the site gives as a stream (Bluesky's), through the downloader Media uses."""
    try:
        filed = media_engine.download_url(case, read.url, cookies=cookies)
    except Exception:  # a video the downloader could not take leaves its still
        return None
    entity = filed.get("entity") if isinstance(filed, dict) else None
    return entity if isinstance(entity, dict) and entity.get("attrs", {}).get("path") else None


def _own_file(case: "Case", name: str, file: str, data: bytes) -> str | None:
    """A file the post owns, in its folder; its case-relative path."""
    rel = f"{layout.social_post_files_rel(name)}/{file}"
    try:
        path = case.resolve_inside(rel)
        ensure_dir(path.parent)
        path.write_bytes(data)
    except (CaseError, OSError):
        return None
    return rel


def _write_spec(case: "Case", name: str, spec: dict[str, Any]) -> str:
    rel = layout.social_post_rel(name)
    path = case.resolve_inside(rel)
    ensure_dir(path.parent)
    media_engine.write_json_atomic(path, spec)
    return rel


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _label(name: str, handle: str, text: str) -> str:
    who = f"@{handle}" if handle else (name or "Post")
    words = " ".join(text.split())
    if len(words) > 70:
        words = words[:70].rsplit(" ", 1)[0] + "…"
    return f"{who}: {words}" if words else who


def file_post(case: "Case", read: Read, *, cookies: dict[str, Any] | None = None,
              http: httpx.Client | None = None) -> dict[str, Any]:
    """Keep a read post in the case: its profile picture, its pictures and videos, its
    record and its entity. Answers the entity."""
    link = read.link
    name = link.name
    own = http or client()
    try:
        avatar = None
        if read.avatar_url:
            data = _fetch_bytes(own, read.avatar_url, MAX_AVATAR_BYTES)
            still = _still(data, AVATAR_SIDE) if data else None
            avatar = _own_file(case, name, "avatar.jpg", still) if still else None
        pictures: list[dict[str, Any]] = []
        for number, shown in enumerate(read.shown[:MAX_PICTURES], 1):
            entry: dict[str, Any] = {"kind": shown.kind}
            if shown.alt:
                entry["alt"] = shown.alt
            if shown.duration:
                entry["duration"] = round(shown.duration, 1)
            if shown.kind == "image":
                data = _fetch_bytes(own, shown.url, MAX_PICTURE_BYTES)
                entity = _file_picture(case, read, data, shown.ext or _ext_of(shown.url), number) if data else None
                if entity is None:
                    continue
                entry["media"] = entity["attrs"]["path"]
            else:
                if shown.poster_url:
                    data = _fetch_bytes(own, shown.poster_url, MAX_PICTURE_BYTES)
                    still = _still(data, 1600) if data else None
                    poster = _own_file(case, name, f"poster-{number}.jpg", still) if still else None
                    if poster:
                        entry["poster"] = poster
                entity = (_file_video(case, read, own, shown.url, shown.ext, number) if shown.url
                          else _download_video(case, read, cookies))
                if entity is not None:
                    entry["media"] = entity["attrs"]["path"]
                if "media" not in entry and "poster" not in entry:
                    continue
            pictures.append(entry)
    finally:
        if http is None:
            own.close()
        _tidy_scratch(case)
    spec = {
        "azimut_post": VERSION,
        "site": link.site,
        "url": read.url,
        "key": link.key,
        "handle": read.handle,
        "name": read.name,
        "text": read.text,
        "lang": read.lang,
        "posted_at": read.posted_at,
        "captured_at": _now(),
        "avatar": avatar,
        "pictures": pictures,
        "links": read.links,
        "from": "fetch",
    }
    return _keep(case, name, spec)


def _tidy_scratch(case: "Case") -> None:
    """The downloads' scratch folder taken away once nothing is in it, as a case is born
    without one: a download running beside this one keeps it, since it is not empty."""
    try:
        (case.subdir("media") / ".dl").rmdir()
    except OSError:
        pass


def _ext_of(url: str) -> str:
    """An extension a picture's address says, X's `?format=jpg` included."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return "jpg"
    said = re.search(r"(?:^|&)format=(\w{2,5})", parts.query or "")
    if said:
        return said.group(1).lower()
    suffix = PurePosixPath(parts.path).suffix.lstrip(".").lower()
    return suffix if suffix in ("jpg", "jpeg", "png", "webp", "gif") else "jpg"


def _keep(case: "Case", name: str, spec: dict[str, Any]) -> dict[str, Any]:
    """The record written and its entity filed, or the entity it already had updated."""
    rel = _write_spec(case, name, spec)
    attrs = {
        "spec": rel,
        "url": spec["url"],
        "post_key": spec["key"],
        "site": spec["site"],
        "handle": spec.get("handle") or "",
        "author": spec.get("name") or "",
        "posted_at": spec.get("posted_at") or "",
    }
    label = _label(spec.get("name") or "", spec.get("handle") or "", spec.get("text") or "")
    held = held_post(case, spec["key"])
    if held is not None:
        return case.update_entity(held["id"], {"label": label, "attrs": attrs})
    return case.add_entity(TYPE, label, attrs=attrs, by=BY, source=spec["url"])


def held_post(case: "Case", key: str) -> dict[str, Any] | None:
    """The post the case keeps under this key (`Link.key`), or None."""
    page = case.page_entities(limit=1, types=[TYPE], attr="post_key", attr_value=key)
    items = page.get("items") or []
    return items[0] if items else None


def fetch(case: "Case", text: str) -> dict[str, Any]:
    """The post a pasted link names, kept in the case, read on the analyst's press.

    A post the case keeps already answers at once, and so does one of the analyst's own
    published posts, read from its draft. Anything else is read from its site: X without
    a session first, then once with the session Settings holds; Bluesky with no account.
    Raises `NotAPost`, `NeedsLogin` or `PostError`.
    """
    link = parse_link(text)
    if link is None:
        raise NotAPost("This is not the address of a post on X or Bluesky")
    held = held_post(case, link.key)
    if held is not None:
        return held
    mine = _own_draft(case, link)
    if mine is not None:
        return mine
    if link.site == "bluesky":
        with client() as http:
            return file_post(case, read_bluesky(link, http), http=http)
    try:
        read = read_x(link)
        session = None
    except NeedsLogin:
        session = media_engine.cookies_from_preference(config.load_settings().get("download_cookies"))
        if session is None:
            raise
        read = read_x(link, session)
    return file_post(case, read, cookies=session)


# -- made from what the case holds -----------------------------------------------------


def _own_draft(case: "Case", link: Link) -> dict[str, Any] | None:
    """One of the analyst's own posts, published from Post with this link: kept from its
    draft, with no network."""
    for name, state in _published_drafts(case):
        url = ((state.get("publish") or {}).get("url") or "")
        found = parse_link(url)
        if found is not None and found.key == link.key:
            return from_draft(case, name)
    return None


def _published_drafts(case: "Case") -> Iterable[tuple[str, dict[str, Any]]]:
    folder = case.tool_root / layout.DRAFTS_DIR
    if not folder.is_dir():
        return
    for path in sorted(folder.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        state = data.get("state") if isinstance(data, dict) else None
        if not isinstance(state, dict):
            continue
        publish = state.get("publish")
        if isinstance(publish, dict) and parse_link(publish.get("url")) is not None:
            yield path.stem, state


def _draft_pictures(state: dict[str, Any]) -> list[str]:
    paths = [state.get("proofPng")]
    for key in ("firstMedia", "mediaPaths"):
        held = state.get(key)
        paths.extend(held if isinstance(held, list) else [])
    return list(dict.fromkeys(one for one in paths if isinstance(one, str) and one))[:MAX_PICTURES]


def from_draft(case: "Case", name: str) -> dict[str, Any]:
    """One of the analyst's own posts, from the Post draft that went out with its link."""
    if not name or any(mark in name for mark in "/\\\x00") or name.startswith("."):
        raise PostError("That post is no longer in the case")
    try:
        path = case.resolve_inside(layout.draft_rel(name))
        data = json.loads(path.read_text(encoding="utf-8"))
    except (CaseError, OSError, ValueError) as exc:
        raise PostError("That post is no longer in the case") from exc
    state = data.get("state") if isinstance(data, dict) else None
    publish = state.get("publish") if isinstance(state, dict) else None
    link = parse_link((publish or {}).get("url"))
    if not isinstance(state, dict) or link is None:
        raise PostError("That post has no link to where it went out")
    words = str(state.get("tweet1") or "").strip()[:MAX_TEXT]
    pictures = []
    for rel in _draft_pictures(state):
        kind = media_engine.media_kind(rel)
        if kind in ("image", "video"):
            pictures.append({"kind": kind, "media": rel})
    identity = config.load_settings()
    spec = {
        "azimut_post": VERSION,
        "site": link.site,
        "url": link.url,
        "key": link.key,
        "handle": link.handle,
        "name": str(identity.get("report_name") or "").strip()[:200] or link.handle,
        "text": words,
        "lang": "",
        "posted_at": _iso(publish.get("posted_at")) if isinstance(publish, dict) else "",
        "captured_at": _now(),
        "avatar": None,
        "pictures": pictures,
        "links": [],
        "from": "draft",
        "draft": name,
    }
    return _keep(case, link.name, spec)


def from_media(case: "Case", rel: str) -> dict[str, Any]:
    """A post the case downloaded a file from, made from what the download recorded:
    its words, who posted it and the day, and every file the case holds from it."""
    if not rel.startswith("media/") or ".." in PurePosixPath(rel).parts:
        raise PostError("That file is not one of the case's media")
    item = media_engine.read_item(case, rel)
    source = (item or {}).get("source") if isinstance(item, dict) else None
    if not isinstance(source, dict):
        raise PostError("That file was not downloaded from a post")
    url = str(source.get("webpage_url") or source.get("url") or "")
    link = parse_link(url)
    if link is None:
        raise PostError("That file was not downloaded from a post on X or Bluesky")
    held = held_post(case, link.key)
    if held is not None:
        return held
    shown: list[dict[str, Any]] = []
    for row in _media_from(case, link):
        kind = str(row.get("kind") or media_engine.media_kind(row["path"]))
        if kind in ("image", "video"):
            shown.append({"kind": kind, "media": row["path"]})
    day = str(source.get("upload_date") or "")
    posted = f"{day[:4]}-{day[4:6]}-{day[6:8]}" if re.fullmatch(r"\d{8}", day) else ""
    spec = {
        "azimut_post": VERSION,
        "site": link.site,
        "url": link.url,
        "key": link.key,
        "handle": link.handle,
        "name": str(source.get("uploader") or link.handle or "").strip()[:200],
        "text": str(source.get("description") or "").strip()[:MAX_TEXT],
        "lang": "",
        "posted_at": posted,
        "captured_at": str(item.get("added_at") or _now()) if isinstance(item, dict) else _now(),
        "avatar": None,
        "pictures": shown[:MAX_PICTURES],
        "links": [one for one in source.get("links") or [] if isinstance(one, str)][:20],
        "from": "media",
    }
    return _keep(case, link.name, spec)


def _media_from(case: "Case", link: Link) -> list[dict[str, Any]]:
    """The case's media downloaded from this post, oldest first."""
    found = []
    for item in case.list_media_items():
        source = item.get("source")
        if not isinstance(source, dict):
            continue
        url = source.get("webpage_url") or source.get("url")
        other = parse_link(url)
        if other is not None and other.key == link.key:
            found.append(item)
    return sorted(found, key=lambda one: str(one.get("added_at") or ""))


def offers(case: "Case") -> dict[str, list[dict[str, Any]]]:
    """What `/post` offers beside a pasted link: the posts the case keeps, the files it
    downloaded from a post not kept yet, and the analyst's own published posts. Read from
    the case alone."""
    kept: list[dict[str, Any]] = []
    keys: set[str] = set()
    cursor: str | None = None
    while True:
        page = case.page_entities(limit=500, cursor=cursor, types=[TYPE])
        for entity in page.get("items") or []:
            attrs = entity.get("attrs") or {}
            keys.add(str(attrs.get("post_key") or ""))
            kept.append({"id": entity["id"], "label": entity.get("label") or "", "url": attrs.get("url") or "",
                         "site": attrs.get("site") or "", "posted_at": attrs.get("posted_at") or ""})
        cursor = page.get("next_cursor")
        if not cursor:
            break
    downloaded: list[dict[str, Any]] = []
    for item in case.list_media_items():
        source = item.get("source")
        if not isinstance(source, dict) or source.get("type") != "download":
            continue
        link = parse_link(source.get("webpage_url") or source.get("url"))
        if link is None or link.key in keys:
            continue
        keys.add(link.key)
        words = " ".join(str(source.get("description") or "").split())
        downloaded.append({"path": item["path"], "url": link.url, "site": link.site,
                           "label": _label(str(source.get("uploader") or ""), link.handle, words)})
    mine: list[dict[str, Any]] = []
    for name, state in _published_drafts(case):
        link = parse_link((state.get("publish") or {}).get("url"))
        if link is None or link.key in keys:
            continue
        keys.add(link.key)
        mine.append({"draft": name, "url": link.url, "site": link.site,
                     "label": _label("", link.handle, str(state.get("tweet1") or ""))})
    kept.sort(key=lambda row: row["label"].casefold())
    return {"kept": kept, "downloaded": downloaded[:200], "mine": mine[:200]}


# -- a note's block --------------------------------------------------------------------


@dataclass
class Entry:
    """One post a block names: by its record (`post`) or by an address not kept yet
    (`link`), with the analyst's own lines for it."""

    kind: str
    value: str
    highlights: list[str] = field(default_factory=list)
    translation: str = ""


@dataclass
class Block:
    entries: list[Entry] = field(default_factory=list)
    form: str = "card"
    avatar: bool = True
    qr: bool = False

    @property
    def ids(self) -> list[str]:
        return [one.value for one in self.entries if one.kind == "post"]


LINE = re.compile(r"^\s*([A-Za-z]+)\s*:\s?(.*)$")


def parse_block(body: str) -> Block:
    """A `::: post` block's lines, read as the editor writes them (`editor/postText.js`)."""
    block = Block()
    for raw in str(body or "").splitlines():
        found = LINE.match(raw)
        if not found:
            continue
        key, value = found.group(1).lower(), found.group(2).strip()
        if key in ("post", "link") and value and len(block.entries) < MAX_THREAD:
            if key == "post" and not ENTITY_ID.match(value):
                continue
            block.entries.append(Entry(key, value[:2000]))
        elif key == "highlight" and value and block.entries:
            entry = block.entries[-1]
            if len(entry.highlights) < MAX_HIGHLIGHTS:
                entry.highlights.append(value[:MAX_SAID])
        elif key == "translation" and block.entries:
            block.entries[-1].translation = value.replace("\\n", "\n")[:MAX_SAID]
        elif key == "form" and value.lower() in FORMS:
            block.form = value.lower()
        elif key == "avatar":
            block.avatar = value.lower() not in ("hidden", "hide", "off", "no")
        elif key == "qr":
            block.qr = value.lower() in ("on", "yes", "true", "shown")
    return block


def blocks_in(text: str) -> list[Block]:
    """Every `::: post` block of a note's text."""
    if "post" not in text:
        return []
    return [parse_block(match.group(1)) for match in BLOCK.finditer(text)]


# -- what a document draws -------------------------------------------------------------


@dataclass
class Picture:
    kind: str
    path: Path | None = None
    media: str = ""
    duration: float | None = None
    alt: str = ""


@dataclass
class Proof:
    """The proof of the case that geolocates this post: its name, record and where it was published."""

    label: str
    entity_id: str
    posted: str = ""


@dataclass
class Post:
    """One post as every document draws it."""

    id: str
    site: str
    url: str
    name: str
    handle: str
    text: str
    lang: str = ""
    posted_at: str = ""
    captured_at: str = ""
    avatar: Path | None = None
    pictures: list[Picture] = field(default_factory=list)
    highlights: list[str] = field(default_factory=list)
    translation: str = ""
    proof: Proof | None = None
    archive: str = ""
    #: Where the block names it, among its posts and links (`Block.entries`).
    at: int = 0

    @property
    def site_label(self) -> str:
        return SITES.get(self.site, self.site)

    @property
    def initials(self) -> str:
        return initials(self.name, self.handle)

    @property
    def tint(self) -> tuple[str, str]:
        return tint(self.handle or self.name)

    @property
    def rtl(self) -> bool:
        return is_rtl(self.text)

    @property
    def when(self) -> str:
        return said_when(self.posted_at)

    @property
    def segments(self) -> list[tuple[str, bool]]:
        return marked(self.text, self.highlights)

    @property
    def paragraphs(self) -> list[tuple[bool, list[tuple[str, bool]]]]:
        return paragraphs(self.text, self.highlights)


@dataclass
class Card:
    """A block as every document draws it: its posts, its form and its choices."""

    posts: list[Post] = field(default_factory=list)
    form: str = "card"
    avatar: bool = True
    qr: bool = False
    #: What the block names that the case does not keep: an address not read yet, a
    #: post deleted from the case.
    missing: list[str] = field(default_factory=list)

    @property
    def thread(self) -> bool:
        return len(self.posts) > 1

    @property
    def span(self) -> str:
        """When a thread's posts went out, `15 Nov 2026 · 05:12 to 06:03 UTC`."""
        times = [post.posted_at for post in self.posts if post.posted_at]
        if not times:
            return ""
        first, last = min(times), max(times)
        if first == last or len(first) < 16 or len(last) < 16:
            return said_when(first)
        if first[:10] == last[:10]:
            return f"{said_day(first)} · {first[11:16]} to {last[11:16]} UTC"
        return f"{said_when(first)} to {said_when(last)}"


def card(case: "Case | None", body: str) -> Card:
    """A `::: post` block read against the case: what every document draws."""
    block = parse_block(body)
    out = Card(form=block.form, avatar=block.avatar, qr=block.qr)
    if case is None:
        out.missing = [entry.value for entry in block.entries]
        return out
    proofs: _Proofs | None = None
    for at, entry in enumerate(block.entries):
        record = case.get_entity(entry.value) if entry.kind == "post" else None
        if record is None and entry.kind == "link":
            link = parse_link(entry.value)
            record = held_post(case, link.key) if link is not None else None
        if record is None or record.get("type") != TYPE:
            out.missing.append(entry.value)
            continue
        spec = read_spec(case, record)
        if spec is None:
            out.missing.append(entry.value)
            continue
        post = _post(case, record, spec)
        post.highlights = [one for one in entry.highlights if one in post.text]
        post.translation = entry.translation
        post.at = at
        proofs = proofs or _Proofs(case)
        post.proof = proofs.of(post.url)
        out.posts.append(post)
    return out


def read_spec(case: "Case", record: dict[str, Any]) -> dict[str, Any] | None:
    rel = (record.get("attrs") or {}).get("spec")
    if not isinstance(rel, str) or not rel:
        return None
    try:
        path = case.resolve_inside(rel)
        if path.stat().st_size > 2 * 1024 * 1024:
            return None
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (CaseError, OSError, ValueError):
        return None
    return spec if isinstance(spec, dict) and spec.get("azimut_post") else None


def _inside(case: "Case", rel: Any) -> Path | None:
    if not isinstance(rel, str) or not rel:
        return None
    try:
        path = case.resolve_inside(rel)
    except CaseError:
        return None
    return path if path.is_file() else None


def _post(case: "Case", record: dict[str, Any], spec: dict[str, Any]) -> Post:
    from . import thumbnails

    pictures: list[Picture] = []
    for one in spec.get("pictures") or []:
        if not isinstance(one, dict):
            continue
        kind = "video" if one.get("kind") == "video" else "image"
        media = str(one.get("media") or "")
        shown = _inside(case, one.get("poster")) if kind == "video" else _inside(case, media)
        if kind == "video" and shown is None and media:
            item = media_engine.read_item(case, media) or {}
            sha = str(item.get("sha256") or "")
            still = thumbnails.thumb_relpath(sha, "video") if sha else None
            shown = _inside(case, still)
        duration = one.get("duration")
        if kind == "video" and not duration and media:
            duration = ((media_engine.read_item(case, media) or {}).get("source") or {}).get("duration")
        pictures.append(Picture(kind=kind, path=shown, media=media if _inside(case, media) else "",
                                duration=float(duration) if isinstance(duration, (int, float)) and duration > 0 else None,
                                alt=str(one.get("alt") or "")))
    attrs = record.get("attrs") or {}
    return Post(
        id=str(record.get("id") or ""),
        site=str(spec.get("site") or ""),
        url=str(spec.get("url") or ""),
        name=str(spec.get("name") or "").strip(),
        handle=str(spec.get("handle") or "").strip(),
        text=str(spec.get("text") or ""),
        lang=str(spec.get("lang") or ""),
        posted_at=str(spec.get("posted_at") or ""),
        captured_at=str(spec.get("captured_at") or ""),
        avatar=_inside(case, spec.get("avatar")),
        pictures=pictures,
        archive=str(attrs.get("archive_url") or ""),
    )


class _Proofs:
    """The case's proofs, by the posts each comes from, read once for a document."""

    def __init__(self, case: "Case") -> None:
        from . import layerlinks

        self.by_key: dict[str, Proof] = {}
        cursor: str | None = None
        while True:
            page = case.page_entities(limit=500, cursor=cursor, types=["proof"])
            for entity in page.get("items") or []:
                attrs = entity.get("attrs") or {}
                spec = _proof_spec(case, attrs)
                footage = [str((row.get("attrs") or {}).get("source_url") or "")
                           for row in layerlinks.source_media(case, entity["id"])]
                urls = [*layerlinks.proof_sources(spec, footage), *urltitles.own_posts(attrs),
                        str(attrs.get("published_url") or "")]
                posted = next(iter(urltitles.own_posts(attrs)), "")
                proof = Proof(label=str(entity.get("label") or "Proof"), entity_id=str(entity["id"]), posted=posted)
                for url in urls:
                    key = urltitles.url_key(url)
                    if key:
                        self.by_key.setdefault(key, proof)
            cursor = page.get("next_cursor")
            if not cursor:
                break

    def of(self, url: str) -> Proof | None:
        key = urltitles.url_key(url)
        return self.by_key.get(key) if key else None


def _proof_spec(case: "Case", attrs: dict[str, Any]) -> dict[str, Any]:
    path = _inside(case, attrs.get("spec"))
    if path is None:
        return {}
    try:
        if path.stat().st_size > 4 * 1024 * 1024:
            return {}
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return spec if isinstance(spec, dict) else {}


# -- how it reads ----------------------------------------------------------------------


def initials(name: str, handle: str = "") -> str:
    """Two letters for a profile picture's stand-in: the name's first two words', its own
    first two letters for one word, the handle's else."""
    words = [word for word in re.split(r"[\s_.\-]+", name or "") if word and word[0].isalnum()]
    if len(words) >= 2:
        return (words[0][0] + words[1][0]).upper()
    if words:
        return words[0][:2].upper()
    bare = re.sub(r"[^A-Za-z0-9]", "", handle or "")
    return bare[:2].upper() or "?"


def tint(seed: str) -> tuple[str, str]:
    """The pair of colours a profile picture's stand-in is drawn in, always the same for one account."""
    digest = hashlib.sha256(str(seed or "").lower().encode("utf-8")).digest()
    return TINTS[digest[0] % len(TINTS)]


def is_rtl(text: str) -> bool:
    """Whether a post's words read right to left: their first strong letter's direction."""
    for char in str(text or ""):
        direction = unicodedata.bidirectional(char)
        if direction in ("R", "AL"):
            return True
        if direction == "L":
            return False
    return False


def marked(text: str, highlights: Iterable[str]) -> list[tuple[str, bool]]:
    """The words as stretches, each highlighted or not: every passage the analyst kept,
    found where it first stands, overlaps joined."""
    spans: list[tuple[int, int]] = []
    for passage in highlights:
        if not passage:
            continue
        at = text.find(passage)
        if at >= 0:
            spans.append((at, at + len(passage)))
    spans.sort()
    joined: list[tuple[int, int]] = []
    for start, end in spans:
        if joined and start <= joined[-1][1]:
            joined[-1] = (joined[-1][0], max(end, joined[-1][1]))
        else:
            joined.append((start, end))
    out: list[tuple[str, bool]] = []
    position = 0
    for start, end in joined:
        if start > position:
            out.append((text[position:start], False))
        out.append((text[start:end], True))
        position = end
    if position < len(text) or not out:
        out.append((text[position:], False))
    return [one for one in out if one[0]] or [("", False)]


#: What parts a post's words into paragraphs: a blank line.
PARAGRAPH = re.compile(r"\n[ \t\u00a0]*\n\s*")


def paragraphs(text: str, highlights: Iterable[str]) -> list[tuple[bool, list[tuple[str, bool]]]]:
    """The words as paragraphs, each with its own direction (whether it reads right to
    left, by its first strong letter) and its stretches, highlighted or not. A post that
    names an Arabic place, then speaks English, sets each part its own way."""
    out: list[tuple[bool, list[tuple[str, bool]]]] = []
    position = 0
    stretches = marked(text, highlights)
    bounds: list[tuple[int, int]] = []
    for found in PARAGRAPH.finditer(text):
        bounds.append((position, found.start()))
        position = found.end()
    bounds.append((position, len(text)))
    for start, end in bounds:
        part: list[tuple[str, bool]] = []
        at = 0
        for words, lit in stretches:
            low, high = max(start, at), min(end, at + len(words))
            if low < high:
                part.append((text[low:high], lit))
            at += len(words)
        said = "".join(words for words, _ in part)
        if said.strip():
            out.append((is_rtl(said), part))
    return out


MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def said_day(stamp: str) -> str:
    """`15 Nov 2026`, from a day or a moment."""
    found = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(stamp or ""))
    if not found:
        return ""
    year, month, day = int(found.group(1)), int(found.group(2)), int(found.group(3))
    if not 1 <= month <= 12:
        return ""
    return f"{day} {MONTHS[month - 1]} {year}"


def said_when(stamp: str) -> str:
    """`15 Nov 2026 · 05:12 UTC`, or the day alone when only the day is known."""
    day = said_day(stamp)
    if not day:
        return ""
    clock = re.match(r"\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})", str(stamp or ""))
    return f"{day} · {clock.group(1)} UTC" if clock else day


def said_duration(seconds: float | None) -> str:
    """`0:42`, `1:03:05`."""
    if seconds is None or not math.isfinite(seconds) or seconds <= 0:
        return ""
    whole = int(round(seconds))
    hours, rest = divmod(whole, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def short_address(url: str) -> str:
    """`x.com/coast_monitor/…`: the address under a QR code."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    host = (parts.hostname or "").removeprefix("www.")
    first = next((seg for seg in parts.path.split("/") if seg and seg != "profile"), "")
    return f"{host}/{first}/…" if first else host


def describe(case: "Case", body: str) -> dict[str, Any]:
    """A block as the editor draws it: the same reading every document draws, as JSON.
    Each file is named by its case path, which the editor shows through `/files`."""
    drawn = card(case, body)

    def rel(path: Path | None) -> str:
        if path is None:
            return ""
        try:
            return path.relative_to(case.tool_root).as_posix()
        except ValueError:
            return ""

    return {
        "form": drawn.form,
        "avatar": drawn.avatar,
        "qr": drawn.qr,
        "span": drawn.span,
        "missing": drawn.missing,
        "posts": [
            {
                "id": post.id, "at": post.at, "site": post.site, "site_label": post.site_label, "url": post.url,
                "name": post.name, "handle": post.handle, "text": post.text, "lang": post.lang,
                "rtl": post.rtl, "when": post.when, "posted_at": post.posted_at,
                "captured": said_day(post.captured_at), "avatar": rel(post.avatar),
                "initials": post.initials, "tint": list(post.tint),
                "highlights": post.highlights, "translation": post.translation,
                "archive": post.archive,
                "pictures": [{"kind": one.kind, "path": rel(one.path), "media": one.media,
                              "duration": said_duration(one.duration), "alt": one.alt} for one in post.pictures],
                "proof": ({"label": post.proof.label, "badge": proof_said(post.proof), "id": post.proof.entity_id,
                           "posted": post.proof.posted} if post.proof else None),
            }
            for post in drawn.posts
        ],
    }


#: What a gone record or an unread link leaves in a document, said once in its place.
MISSING_SAID = "A post this note shows is not kept in the case yet."


def words(drawn: Card) -> list[str]:
    """What a block prints, for the fonts a document carries."""
    said: list[str] = []
    for post in drawn.posts:
        said.extend((post.name, post.handle, post.text, post.translation, post.when, post.site_label,
                     post.proof.label if post.proof else "", "Translation", "View on", "Archived copy",
                     "Geolocated", "captured on"))
    return said


#: The longest proof name a badge says whole; a longer one is cut at a word, its whole name in its title.
BADGE_NAME = 28


def proof_said(proof: Proof) -> str:
    """`Geolocated · Proof 12`: the proof's name, cut at a word when it is long."""
    name = " ".join(proof.label.split()) or "Proof"
    if len(name) > BADGE_NAME:
        name = name[:BADGE_NAME].rsplit(" ", 1)[0].rstrip(",;:·-") + "…"
    return f"Geolocated · {name}"
