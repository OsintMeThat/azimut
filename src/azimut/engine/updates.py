"""Is a newer Azimut out? — a self-check for the binary, which has no package
manager behind it (a ``pip``/``pipx`` user runs ``pipx upgrade`` instead).

The frontend calls this once on startup by default so binary users hear about
new releases. Settings can disable that call; the manual button uses the same
``?check=true`` route, and failures are always returned inline rather than
breaking the app.
"""

from __future__ import annotations

import platform
import re
import sys
from pathlib import Path
from urllib.parse import quote

import httpx

# The public releases feed. Latest *published, non-draft, non-prerelease* tag —
# exactly the assets the README's download table points at.
LATEST_RELEASE_URL = "https://api.github.com/repos/OsintMeThat/azimut/releases/latest"
RELEASES_PAGE_URL = "https://github.com/OsintMeThat/azimut/releases/latest"
DOWNLOAD_URL = "https://github.com/OsintMeThat/azimut/releases/download/{tag}/{asset}"

# The binary each release attaches per system and machine (release.yml names
# them). A pair missing here has no binary: macOS on Intel and Linux on ARM
# install with pipx, so they only get the release page.
ASSETS = {
    ("linux", "x86_64"): "azimut-linux-x86_64",
    ("windows", "x86_64"): "azimut-windows-x86_64.exe",
    ("macos", "arm64"): "azimut-macos-arm64",
}

_SYSTEMS = {"linux": "linux", "win32": "windows", "darwin": "macos"}
_MACHINES = {"x86_64": "x86_64", "amd64": "x86_64", "arm64": "arm64", "aarch64": "arm64"}

# How much of the release body the pop-up carries. Enough for a changelog,
# short enough that a runaway release note never bloats the response.
NOTES_LIMIT = 4000


def _clip(notes: str) -> str:
    """Cap the release body so a runaway note never bloats the response.

    Cutting mid-line would leave the pop-up rendering half a heading or an
    unclosed code fence, so an over-long note is trimmed back to its last
    complete line."""
    if len(notes) <= NOTES_LIMIT:
        return notes
    clipped = notes[:NOTES_LIMIT]
    head, newline, _ = clipped.rpartition("\n")
    return (head if newline else clipped).rstrip()


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


def system() -> str:
    """This machine's system as the release names it: linux, windows or macos."""
    return _SYSTEMS.get(sys.platform, sys.platform)


def asset_name(system_name: str | None = None, machine: str | None = None) -> str | None:
    """The release binary for this system and machine, or None when none is built."""
    system_name = system_name or system()
    machine = (machine or platform.machine()).lower()
    return ASSETS.get((system_name, _MACHINES.get(machine, machine)))


def install() -> dict[str, object]:
    """How this copy was installed, so the pop-up says how to update it.

    A frozen binary is replaced by hand, and ``program`` is the file to replace.
    Anything else came from pip, which updates with its own command. Reads no
    network and no disk beyond the interpreter's own path."""
    frozen = bool(getattr(sys, "frozen", False))
    return {
        "kind": "binary" if frozen else "package",
        "system": system(),
        "program": str(Path(sys.executable).resolve()) if frozen else None,
    }


def _download_url(body: dict[str, object], tag: str, asset: str | None) -> str | None:
    """The direct link to ``asset`` in this release, when the release lists it.

    Built from our own URL pattern rather than taken from the response, so the
    button can only ever point at a file of this repository's release."""
    if not asset:
        return None
    listed = body.get("assets")
    if not isinstance(listed, list) or asset not in {
        str(a.get("name")) for a in listed if isinstance(a, dict)
    }:
        return None
    return DOWNLOAD_URL.format(tag=quote(tag, safe=""), asset=quote(asset, safe=""))


def check(current: str, *, asset: str | None = None, timeout: float = 6.0) -> dict[str, object]:
    """Ask GitHub for the latest release and compare it to ``current``.

    ``asset`` names the binary to link straight to (``asset_name()``), and stays
    None for a pip install, which has nothing to download.

    Never raises — a failed check is reported inline (``error``), like the
    scraper and API-key checks, so a flaky network never breaks Settings.
    """
    result: dict[str, object] = {
        "current": current,
        "latest": None,
        "update_available": False,
        "url": RELEASES_PAGE_URL,
        "notes": "",
        "asset": None,
        "download_url": None,
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
        # releases, rendered by the UI through the same sanitizing renderer as
        # the Notebook.
        result["notes"] = _clip(str(body.get("body") or "").strip())
        download = _download_url(body, latest, asset)
        if download:
            result["asset"] = asset
            result["download_url"] = download
    return result
