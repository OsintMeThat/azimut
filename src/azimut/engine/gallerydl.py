"""Run gallery-dl as a program of its own.

gallery-dl is GPL-2.0-only and Azimut is AGPL-3.0-only, two licences that cannot
be combined into one program. So Azimut never imports it: every read goes through
gallery-dl's own command line in a child process, the way ffmpeg is run, and the
two talk through its JSON output, the files it writes and its exit status.

A pip install runs ``python -m gallery_dl``. The release binary has no separate
Python, so it starts itself again with :data:`FROZEN_FLAG`, and
``packaging/entry.py`` hands that child to :func:`run_frozen`, which does what
``python -m`` would.

A newer copy fetched from Settings (``engine/scrapers.py``) wins in the child
exactly as it used to win in-process: through ``PYTHONPATH`` for a pip install,
through the runtime finder in the binary, whose own importer answers before any
path entry. Each read is a fresh process, so an update never waits for a restart.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import scrapers

#: What the release binary is started with to act as gallery-dl.
FROZEN_FLAG = "--run-gallery-dl"

#: Said on every run. The analyst's own gallery-dl config, if they keep one, is not
#: Azimut's to inherit: a filename format or a post-processor in it would change
#: what lands in the case. Bluesky's facets are asked for always, since a post keeps
#: its links beside its words and prints them cut off at an ellipsis.
_BASE_ARGS = ["--config-ignore", "--no-colors", "-o", "extractor.bluesky.metadata=facets"]

#: gallery-dl's exit status is a set of bits. 16 is a login or a permission refused
#: (AuthenticationError, AuthorizationError), 64 an address no extractor knows.
_AUTH_BITS = 16
_UNSUPPORTED_BITS = 64

#: One line of gallery-dl's log, in its default ``[name][level] message`` form.
_LOG_LINE = re.compile(r"^\[(?P<name>[^\]]+)\]\[(?P<level>\w+)\] (?P<message>.*)$")
#: How an error it raised is logged: its class name, then what it said.
_NAMED = re.compile(r"^(?P<name>[A-Z]\w*(?:Error|Required)): (?P<message>.*)$")

#: The fixed name the picked file is written under. Its real name comes from the
#: metadata beside it, so nothing gallery-dl makes of a title reaches the disk here.
_FILE_STEM = "media"
_META_DIR = ".meta"


class UnsupportedURL(RuntimeError):
    """No gallery-dl extractor knows this address."""


class GalleryError(RuntimeError):
    """gallery-dl read the address and stopped.

    ``name`` is the class gallery-dl raised when it says so, and stands in for the
    exception the in-process reader used to see, so a wall is still told apart from
    a dead link by what it is called as much as by what it says.
    """

    def __init__(self, message: str, name: str = "") -> None:
        super().__init__(message)
        self.name = name


@dataclass
class Finished:
    returncode: int
    stdout: str
    stderr: str


def command() -> list[str]:
    """Argv for one gallery-dl run, without its arguments."""
    if getattr(sys, "frozen", False):
        return [sys.executable, FROZEN_FLAG]
    # -P keeps the working directory off the child's path, so a folder named
    # gallery_dl beside wherever Azimut was started cannot stand in for it.
    return [sys.executable, "-P", "-m", "gallery_dl"]


def _env() -> dict[str, str]:
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    if not getattr(sys, "frozen", False) and scrapers.live_runtime_version("gallery-dl"):
        shadow = str(scrapers.dist_dir("gallery-dl"))
        env["PYTHONPATH"] = os.pathsep.join(p for p in (shadow, env.get("PYTHONPATH")) if p)
    return env


def run(args: list[str]) -> Finished:
    """Run gallery-dl once and wait for it. The one place a process is started."""
    proc = subprocess.run(
        [*command(), *args],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        env=_env(),
        check=False,
    )
    return Finished(
        proc.returncode,
        proc.stdout.decode("utf-8", errors="replace"),
        proc.stderr.decode("utf-8", errors="replace"),
    )


def option(key: str, value: Any) -> list[str]:
    """``-o key=value``, the value written as JSON so a path is never read as a number."""
    return ["-o", f"{key}={json.dumps(value)}"]


def _failure(finished: Finished) -> Exception:
    """What a run that did not deliver said, as the exception the caller reads."""
    if finished.returncode & _UNSUPPORTED_BITS:
        return UnsupportedURL("gallery-dl has no extractor for this address")
    errors: list[str] = []
    http: list[str] = []
    for line in finished.stderr.splitlines():
        found = _LOG_LINE.match(line.strip())
        if found is None:
            continue
        if found["level"] == "error":
            errors.append(found["message"])
        elif found["level"] == "warning" and found["name"].startswith("downloader"):
            # A file the site refused: "'403 Forbidden' for '<url>'", the words the
            # in-process download raised, where the error line only says it failed.
            http.append(found["message"])
    name = ""
    message = http[-1] if http else (errors[0] if errors else "")
    for line in errors:
        named = _NAMED.match(line)
        if named:
            name = named["name"]
            if not http:
                message = named["message"]
            break
    if not name and finished.returncode & _AUTH_BITS:
        name = "AuthorizationError"
    return GalleryError(message or "gallery-dl stopped without saying why", name)


def listing(url: str, extra: list[str]) -> list[tuple[str, dict[str, Any]]]:
    """Every file the address holds, as ``(url, metadata)``, without downloading any."""
    finished = run([*_BASE_ARGS, *extra, "-j", url])
    try:
        messages = json.loads(finished.stdout)
    except ValueError:
        raise _failure(finished) from None
    files: list[tuple[str, dict[str, Any]]] = []
    for message in messages:
        if message[0] == -1:  # what it raised, written into the listing
            raise GalleryError(str(message[1].get("message") or ""), message[1].get("error", ""))
        if message[0] == 3:  # Message.Url, a downloadable file
            files.append((message[1], message[2]))
    return files


def download(
    url: str, index: int, into: Path, extra: list[str]
) -> tuple[Path, dict[str, Any]] | None:
    """The ``index``-th file of the address (1-based), with its metadata, or None.

    ``--child-filter False`` keeps it to the address's own files: the listing does not
    follow the other addresses a post points at, so the count must not either.
    """
    finished = run(
        [
            *_BASE_ARGS, *extra,
            "--range", str(index), "--child-filter", "False",
            "-D", str(into), "-f", _FILE_STEM,
            "--write-metadata", "-O", f"directory={_META_DIR}",
            url,
        ]
    )
    path = into / _FILE_STEM
    meta = into / _META_DIR / f"{_FILE_STEM}.json"
    if not path.is_file():
        # Checked before the status: a file that arrived is the answer even when the
        # run stumbled on something after it.
        if finished.returncode:
            raise _failure(finished)
        return None
    try:
        kwdict = json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        kwdict = {}
    return path, kwdict if isinstance(kwdict, dict) else {}


def run_frozen(argv: list[str]) -> int:
    """The release binary acting as gallery-dl, in the child :func:`command` starts.

    What ``python -m gallery_dl`` does, after pointing imports at a newer copy from
    Settings when there is one. This runs in that child only, never in the app.
    """
    scrapers.activate()
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
    import gallery_dl

    sys.argv = ["gallery-dl", *argv]
    return int(gallery_dl.main() or 0)
