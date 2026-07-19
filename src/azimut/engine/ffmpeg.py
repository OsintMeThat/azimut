"""Locate the ffmpeg / ffprobe binaries the media and inspect engines shell out to.

ffmpeg is a native program, not a Python package, so a plain ``pip install
azimut`` relies on a system copy on ``PATH``. The release binaries instead
bundle a static ffmpeg + ffprobe alongside the executable — PyInstaller drops
them at the root of ``sys._MEIPASS`` (see packaging/azimut.spec) — so the app
works out of the box with no separate install.

Everything that runs ffmpeg resolves through here, so the bundled copy is
preferred and a system copy on ``PATH`` is the fallback. yt-dlp, which finds
ffmpeg on ``PATH`` by itself, is pointed at the bundled directory via
``location_for_ytdlp()`` when there is one.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


def _bundled(name: str) -> str | None:
    """Path to *name* bundled beside the frozen executable, or None.

    Only a frozen build has ``sys._MEIPASS``; a source/pip run never does, so
    this is a no-op there and resolution falls straight through to ``PATH``.
    """
    base = getattr(sys, "_MEIPASS", None)
    if base is None:
        return None
    exe = name + (".exe" if sys.platform == "win32" else "")
    candidate = Path(base) / exe
    return str(candidate) if candidate.is_file() else None


def _resolve(name: str) -> str | None:
    return _bundled(name) or shutil.which(name)


def ffmpeg_path() -> str | None:
    """Full path to a usable ffmpeg, or None if neither bundled nor on PATH."""
    return _resolve("ffmpeg")


def ffprobe_path() -> str | None:
    """Full path to a usable ffprobe, or None if neither bundled nor on PATH."""
    return _resolve("ffprobe")


def ffmpeg_exe() -> str:
    """Argv[0] for an ffmpeg subprocess: the resolved path, else the bare name
    so a system copy on PATH is still tried."""
    return ffmpeg_path() or "ffmpeg"


def ffprobe_exe() -> str:
    """Argv[0] for an ffprobe subprocess (see :func:`ffmpeg_exe`)."""
    return ffprobe_path() or "ffprobe"


def ffmpeg_available() -> bool:
    return ffmpeg_path() is not None


def ffprobe_available() -> bool:
    return ffprobe_path() is not None


def _version(exe: str) -> str | None:
    """The version token from ``<exe> -version``, e.g. ``n7.1`` or ``6.1.1``."""
    try:
        proc = subprocess.run([exe, "-version"], capture_output=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    lines = (proc.stdout or b"").decode("utf-8", "replace").splitlines()
    if not lines:
        return None
    # first line: "ffmpeg version n7.1 Copyright (c) ..."
    parts = lines[0].split()
    if len(parts) >= 3 and parts[1] == "version":
        return parts[2]
    return lines[0].strip() or None


def info() -> dict[str, str | bool | None]:
    """About-tab readout: is ffmpeg present, from where, which version.

    ``source`` is ``"bundled"`` (shipped in the binary), ``"path"`` (a system
    copy), or ``None`` (missing). Runs ``ffmpeg -version`` once — the caller is
    a dedicated endpoint, not the hot settings poll.
    """
    path = ffmpeg_path()
    if path is None:
        return {"available": False, "path": None, "source": None, "version": None}
    return {
        "available": True,
        "path": path,
        "source": "bundled" if path == _bundled("ffmpeg") else "path",
        "version": _version(path),
    }


def location_for_ytdlp() -> str | None:
    """Directory to hand yt-dlp as ``ffmpeg_location``, or None to let it search
    PATH itself.

    Returned only for a *bundled* ffmpeg: it lives in a directory that is not on
    PATH, so yt-dlp would otherwise miss it and be unable to merge separate
    audio+video streams. A PATH copy needs no hint.
    """
    base = getattr(sys, "_MEIPASS", None)
    if base is None:
        return None
    return str(Path(base)) if _bundled("ffmpeg") else None
