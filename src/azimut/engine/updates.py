"""Is a newer Azimut out? — a self-check for the binary, which has no package
manager behind it (a ``pip``/``pipx`` user runs ``pipx upgrade`` instead).

The frontend calls this once on startup by default so binary users hear about
new releases. Settings can disable that call; the manual button uses the same
``?check=true`` route, and failures are always returned inline rather than
breaking the app.
"""

from __future__ import annotations

import re

import httpx

# The public releases feed. Latest *published, non-draft, non-prerelease* tag —
# exactly the assets the README's download table points at.
LATEST_RELEASE_URL = "https://api.github.com/repos/OsintMeThat/azimut/releases/latest"
RELEASES_PAGE_URL = "https://github.com/OsintMeThat/azimut/releases/latest"

# How much of the release body the pop-up carries. Enough for a changelog,
# short enough that a runaway release note never bloats the response.
NOTES_LIMIT = 4000


def _parse(version: str) -> tuple[int, ...]:
    """A tag like ``v0.1.2`` (or a bare ``0.1.2``) as a comparable tuple.

    Only the leading integer of each dotted part counts, so a ``0.2.0rc1``
    sorts as ``(0, 2, 0)`` — good enough to answer "is the release newer than
    what I'm running", which is all this decides."""
    parts = []
    for chunk in version.strip().lstrip("vV").split("."):
        match = re.match(r"\d+", chunk)
        parts.append(int(match.group()) if match else 0)
    return tuple(parts) or (0,)


def is_newer(latest: str, current: str) -> bool:
    return _parse(latest) > _parse(current)


def check(current: str, *, timeout: float = 6.0) -> dict[str, object]:
    """Ask GitHub for the latest release and compare it to ``current``.

    Never raises — a failed check is reported inline (``error``), like the
    scraper and API-key checks, so a flaky network never breaks Settings.
    """
    result: dict[str, object] = {
        "current": current,
        "latest": None,
        "update_available": False,
        "url": RELEASES_PAGE_URL,
        "notes": "",
    }
    try:
        resp = httpx.get(
            LATEST_RELEASE_URL,
            timeout=timeout,
            headers={"Accept": "application/vnd.github+json", "User-Agent": "azimut"},
        )
        resp.raise_for_status()
        body = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        result["error"] = str(exc)
        return result
    latest = str(body.get("tag_name") or "").strip()
    if latest:
        result["latest"] = latest
        result["update_available"] = is_newer(latest, current)
        if body.get("html_url"):
            result["url"] = str(body["html_url"])
        # The release body, shown in the startup pop-up. Markdown from our own
        # releases; the UI renders it as plain text (no HTML injection), so we
        # just cap the length to keep the payload sane.
        result["notes"] = str(body.get("body") or "").strip()[:NOTES_LIMIT]
    return result
