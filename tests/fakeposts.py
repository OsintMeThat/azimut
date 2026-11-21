"""X and Bluesky stood in for, so a test reads a post without the network.

Bluesky is answered behind `httpx.MockTransport`, as its public API answers
`app.bsky.feed.getPostThread` (docs.bsky.app), with its CDN's pictures; X is answered
as gallery-dl's `-j` listing prints a post (`gallerydl.post`), with X's CDN behind the
same transport. Every account and post here is made up.

X's embed read (`xwords`), asked only when gallery-dl gives a post no words, answers
what `x_embed` plants, or a 404 when nothing is planted.

`Sites.install(monkeypatch)` puts both in place and keeps every request, so a test can
also say that nothing went out.
"""

from __future__ import annotations

import io
import json
from dataclasses import dataclass, field
from typing import Any

import httpx
from PIL import Image

from azimut.engine import gallerydl, socialposts, xwords

BLUESKY_URL = "https://bsky.app/profile/redseadesk.bsky.social/post/3m7kfakepost"
X_URL = "https://x.com/coast_monitor/status/1990000000000000001"
X_TEXT_URL = "https://x.com/coast_monitor/status/1990000000000000002"
AVATAR = "https://cdn.bsky.app/img/avatar/plain/did:plc:fake/avatar@jpeg"
PICTURE = "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:fake/pic1@jpeg"
X_AVATAR = "https://pbs.twimg.com/profile_images/1/fake.jpg"
X_PICTURE = "https://pbs.twimg.com/media/FakeOne?format=jpg&name=orig"
X_VIDEO = "https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/fake.mp4"


def jpeg(colour: tuple[int, int, int] = (120, 140, 160), size: tuple[int, int] = (64, 48)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, "JPEG")
    return buffer.getvalue()


def bluesky_thread(text: str = "Satellite pass this morning: no vehicles left at the airport road checkpoint.",
                   *, pictures: int = 1, handle: str = "redseadesk.bsky.social",
                   created: str = "2026-11-16T09:40:00.000Z") -> dict[str, Any]:
    embed: dict[str, Any] | None = None
    if pictures:
        embed = {"$type": "app.bsky.embed.images#view",
                 "images": [{"thumb": PICTURE, "fullsize": PICTURE.replace("pic1", f"pic{n}"), "alt": f"Checkpoint {n}"}
                            for n in range(1, pictures + 1)]}
    post: dict[str, Any] = {
        "uri": f"at://did:plc:fake/app.bsky.feed.post/{BLUESKY_URL.rsplit('/', 1)[-1]}",
        "author": {"did": "did:plc:fake", "handle": handle, "displayName": "Red Sea Desk", "avatar": AVATAR},
        "record": {"$type": "app.bsky.feed.post", "createdAt": created, "langs": ["en"], "text": text},
        "indexedAt": created,
    }
    if embed:
        post["embed"] = embed
    return {"thread": {"$type": "app.bsky.feed.defs#threadViewPost", "post": post}}


def x_embed(text: str, tweet: str = "1990000000000000001", *, urls: dict[str, str] | None = None,
            picture: str = "") -> dict[str, Any]:
    """A post as X's embed read answers it: its words with short links, what they stand for."""
    entities: dict[str, Any] = {"urls": [{"url": short, "expanded_url": full} for short, full in (urls or {}).items()]}
    if picture:
        entities["media"] = [{"url": picture}]
    return {"__typename": "Tweet", "id_str": tweet, "lang": "en", "text": text, "entities": entities,
            "user": {"name": "Coast Monitor", "screen_name": "coast_monitor"}}


def x_listing(text: str = "رتل من المركبات يتجه جنوبًا على الطريق الساحلي هذا الصباح", *, media: bool = True,
              tweet: str = "1990000000000000001", video: bool = False) -> list[Any]:
    author = {"name": "coast_monitor", "nick": "Coast Monitor", "profile_image": X_AVATAR, "id": 7}
    meta = {"category": "twitter", "subcategory": "tweet", "tweet_id": int(tweet), "content": text, "lang": "ar",
            "date": "2026-11-15 05:12:00", "author": author, "user": author, "favorite_count": 900, "count": 0}
    messages: list[Any] = [[2, meta]]
    if media:
        messages.append([3, X_PICTURE, {**meta, "num": 1, "count": 2, "type": "photo", "extension": "jpg",
                                        "filename": "FakeOne", "width": 64, "height": 48}])
    if video:
        messages.append([3, X_VIDEO, {**meta, "num": 2, "count": 2, "type": "video", "extension": "mp4",
                                      "filename": "fake", "duration": 42.0}])
    return messages


@dataclass
class Sites:
    """Both sites, answering what each test planted, and every request they were asked."""

    bluesky: dict[str, Any] = field(default_factory=bluesky_thread)
    x: list[Any] | None = field(default_factory=x_listing)
    #: What gallery-dl says when X wants a session: its stderr and exit status.
    x_wall: bool = False
    x_wall_with_session: bool = True
    #: What X's embed read answers for a post, as `cdn.syndication.twimg.com` does.
    x_embed: dict[str, Any] | None = None
    offline: bool = False
    requests: list[httpx.Request] = field(default_factory=list)
    runs: list[list[str]] = field(default_factory=list)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.offline:
            raise httpx.ConnectError("no connection", request=request)
        if request.url.host == "public.api.bsky.app":
            return httpx.Response(200, json=self.bluesky)
        if request.url.host == "cdn.syndication.twimg.com":
            return httpx.Response(200, json=self.x_embed) if self.x_embed else httpx.Response(404, text="<!DOCTYPE html>")
        if request.url.path.endswith(".mp4"):
            return httpx.Response(200, content=b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64)
        if "avatar" in str(request.url) or "profile_images" in str(request.url):
            return httpx.Response(200, content=jpeg((180, 60, 50), (96, 96)))
        return httpx.Response(200, content=jpeg((90, 120, 150), (120, 90)))

    def gallery(self, args: list[str]) -> gallerydl.Finished:
        self.runs.append(list(args))
        if self.offline:
            return gallerydl.Finished(4, "", "[twitter][error] HttpError: ConnectionError: no connection\n")
        session = any("extractor.cookies" in one for one in args)
        if self.x_wall and (not session or self.x_wall_with_session):
            return gallerydl.Finished(16, "", "[twitter][error] AuthorizationError: Login required\n")
        return gallerydl.Finished(0, json.dumps(self.x), "")

    def install(self, monkeypatch) -> "Sites":
        real = socialposts.client
        monkeypatch.setattr(socialposts, "client", lambda transport=None: real(httpx.MockTransport(self.handle)))
        monkeypatch.setattr(gallerydl, "run", self.gallery)
        monkeypatch.setattr(xwords, "client", lambda transport=None: real(httpx.MockTransport(self.handle)))
        monkeypatch.setattr(xwords, "_said", {})
        return self

    @property
    def outside(self) -> int:
        """How many times anything reached for X or Bluesky."""
        return len(self.requests) + len(self.runs)
