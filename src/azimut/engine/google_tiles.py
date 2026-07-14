"""Google Map Tiles API session-token adapter (docs/KEYED_PROVIDERS.md §3).

Google satellite tiles are not a static XYZ URL: a client first mints a
short-lived *session token* (createSession), then requests standard slippy
tiles with ``session`` + ``key`` query params. This module mints and caches
that token in memory — the token only, never tiles: Google's Map Tiles API
policies forbid caching/storing tiles — and hands the rest of the pipeline a
plain XYZ template.

Attribution is dynamic: the viewport endpoint returns the exact copyright line
for the mapped area (e.g. "Map data ©2026 Google, Maxar Technologies"), which
every capture must carry unmodified, burned into its footer.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit

import httpx

CREATE_SESSION_URL = "https://tile.googleapis.com/v1/createSession"
VIEWPORT_URL = "https://tile.googleapis.com/tile/v1/viewport"
# mapType is part of the token's identity — a satellite session only serves
# satellite tiles. Only this one kind is minted today.
SESSION_BODY = {"mapType": "satellite", "language": "en-US", "region": "US"}
EXPIRY_SLACK = 60  # refresh this many seconds before the reported expiry

_lock = threading.Lock()
_sessions: dict[str, dict[str, Any]] = {}  # api key → {"session", "expiry"}


class GoogleSessionError(Exception):
    pass


def _mint(key: str, post: Callable[..., Any] | None) -> dict[str, Any]:
    response = (post or httpx.post)(
        CREATE_SESSION_URL, params={"key": key}, json=SESSION_BODY, timeout=15
    )
    response.raise_for_status()
    data = response.json()
    if not data.get("session"):
        raise GoogleSessionError("createSession response carried no session token")
    return {"session": data["session"], "expiry": int(data.get("expiry") or 0)}


def session_token(
    key: str,
    *,
    post: Callable[..., Any] | None = None,
    now: Callable[[], float] | None = None,
) -> str:
    """Current session token for this key — minted once, refreshed near expiry."""
    clock = now or time.time
    with _lock:
        cached = _sessions.get(key)
        if cached and cached["expiry"] - EXPIRY_SLACK > clock():
            return cached["session"]
        fresh = _mint(key, post)
        _sessions[key] = fresh
        return fresh["session"]


def invalidate(key: str) -> None:
    """Drop the cached token (e.g. after a 401/403) so the next call re-mints."""
    with _lock:
        _sessions.pop(key, None)


def key_from_url(url: str) -> str:
    """The ``key=`` query param of a Google tile URL template."""
    values = parse_qs(urlsplit(url).query).get("key")
    if not values or not values[0]:
        raise GoogleSessionError("no key= in Google tile URL template")
    return values[0]


def resolve_template(
    url_template: str,
    *,
    post: Callable[..., Any] | None = None,
    now: Callable[[], float] | None = None,
) -> str:
    """Replace ``{session}`` in a Google tile URL template with a live token."""
    token = session_token(key_from_url(url_template), post=post, now=now)
    return url_template.replace("{session}", token)


def viewport_copyright(
    key: str,
    zoom: int,
    north: float,
    south: float,
    east: float,
    west: float,
    *,
    get: Callable[..., Any] | None = None,
    post: Callable[..., Any] | None = None,
) -> str | None:
    """The exact copyright line for a viewport, or None if unavailable.

    Never raises: attribution falls back to the provider's static string when
    the endpoint can't be reached — the capture still carries attribution.
    """
    try:
        token = session_token(key, post=post)
        response = (get or httpx.get)(
            VIEWPORT_URL,
            params={
                "session": token,
                "key": key,
                "zoom": int(zoom),
                "north": north,
                "south": south,
                "east": east,
                "west": west,
            },
            timeout=8,
        )
        response.raise_for_status()
        return response.json().get("copyright") or None
    except Exception:
        return None
