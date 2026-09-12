"""The capture extension: what this build ships, and the copy the app can rewrite.

An unpacked extension cannot write to itself, cannot read its own filesystem
path, and cannot be handed one by a page. So for as long as the analyst chose
where to unzip it, nobody but them knew the address and the only actor able to
rewrite those bytes was the one without them — which is why an update used to be
a manual reinstall.

Inverted here. The app extracts the shipped extension into
``config.extension_dir()``, the analyst points the browser at that folder once,
and from then on Settings can rewrite it and ask the extension to restart
(``extension/background.js``, ``ext-reload``).

Three things make that safe:

* **The folder never moves.** Chrome derives the extension id from the directory
  path, so a rename would orphan the install and lose its pairing. Files are
  swapped one at a time inside it (engine/dirswap.py).
* **``manifest.json`` is written last**, and ``install.json`` after it. A kill
  mid-install leaves a manifest still describing the old version, which is the
  safe direction: no browser ever loads a new manifest over old code.
* **A refused write is reported, never forced.** Windows can hold a file open,
  so a pass that can't finish leaves its staging directory behind and says
  ``staged``; the next pass finishes the job.

What identifies the folder is ``install.json`` — an id minted once and kept, plus
the digest of the bytes that were written. The digest is what the update button
compares, because the manifest version deliberately doesn't move within a
development cycle (``tests/test_updates.py``).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
from pathlib import Path, PurePosixPath
from typing import Any

from .. import config
from . import dirswap

# Repo checkout first (development), then the copy hatchling ships inside the
# wheel (azimut/extension) — same dual-home pattern as the built frontend.
_SOURCE_DIRS = (
    Path(__file__).parents[3] / "extension",
    Path(__file__).parents[1] / "extension",
)
# Runtime files only: the extension's own dev harness (vitest, package.json,
# lockfile) has no business in an installed browser.
_EXCLUDE_DIRS = {"node_modules", "tests", ".git"}
_EXCLUDE_FILES = {"package.json", "package-lock.json", "vitest.config.js", ".gitignore"}

#: Written by the app into the folder it owns, read back by the extension
#: through ``runtime.getURL()``. Never part of the payload: it is per-install,
#: so shipping it would make every install differ from every other.
STAMP_NAME = "install.json"

#: Where a pass assembles the new copy before swapping it in — inside the target
#: folder, so every move is a same-filesystem rename.
_STAGING_PREFIX = ".staging-"

#: Text is digested by its line content: a Windows checkout can carry CRLF, and
#: the digest has to reach the same verdict on the three release platforms.
_TEXT_SUFFIXES = {".js", ".json", ".css", ".html", ".md", ".txt"}

_lock = threading.Lock()  # one pass at a time over a shared directory


# ---- what this build ships --------------------------------------------------


def source_dir() -> Path | None:
    """The read-only copy of the extension this build carries, or None.

    Not to be confused with ``config.extension_dir()``, which is the writable
    copy the browser loads. Nothing in this module ever writes here: in a
    checkout it resolves to the repo's ``extension/``, which
    ``scripts/devext.py`` loads straight into the dev browsers.
    """
    for candidate in _SOURCE_DIRS:
        if (candidate / "manifest.json").is_file():
            return candidate
    return None


def shipped_files(src: Path) -> list[tuple[str, Path]]:
    """Every file the extension ships, as ``(posix relative name, path)`` sorted
    by name. Paths are posix so the listing is identical on the three release
    platforms.

    The version gate in ``tests/test_updates.py`` digests exactly this list, so
    "what the manifest version claims" and "what the user downloads" cannot
    drift: a change to a shipped file fails the gate until the version moves.

    Ordered by that posix name rather than by ``Path``, which is the whole point:
    comparing paths is case-insensitive on Windows and case-sensitive everywhere
    else, so ``README.md`` sorts first on Linux and mid-list on Windows. The gate
    digests names in order, so sorting by the object would hand the three release
    platforms three verdicts about one unchanged extension.
    """
    shipped: list[tuple[str, Path]] = []
    for path in src.rglob("*"):
        rel = path.relative_to(src)
        if not path.is_file() or path.name in _EXCLUDE_FILES or path.name == STAMP_NAME:
            continue
        if any(part in _EXCLUDE_DIRS or part.endswith(".test.js") for part in rel.parts):
            continue
        shipped.append((rel.as_posix(), path))
    return sorted(shipped, key=lambda entry: entry[0])


def bundled_version() -> str | None:
    """The ``version`` of the extension this Azimut build ships. Settings
    compares it to the version stamped by the *installed* extension
    (lib/extBridge.js). None if no extension is bundled (unusual builds).

    This tracks the extension, not the app: it is the Azimut version whose
    release last changed a shipped file, so it stays put across releases that
    leave the extension alone. Bumping it in lock-step with ``__version__``
    would tell every user to reinstall an identical zip."""
    src = source_dir()
    if src is None:
        return None
    try:
        manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    version = manifest.get("version")
    return str(version) if version else None


def payload_digest() -> str | None:
    """Digest of everything the extension ships, minus the manifest's own
    ``version``. None if this build bundles no extension.

    Leaving the version out is what lets one number serve two jobs. As the
    version gate in ``tests/test_updates.py``, it cuts both ways: a shipped file
    that moved without a version bump, and a bump with nothing behind it. As the
    update trigger here, it moves whenever the bytes move — including inside a
    development cycle, where the bundled version is already the app's own and so
    cannot go up.

    Recomputed on every call, deliberately. It is a few dozen small files, and a
    cache would mean an edit under ``extension/`` no longer shows up as an
    available update until the app restarts.
    """
    src = source_dir()
    if src is None:
        return None
    digest = hashlib.sha256()
    for name, path in shipped_files(src):
        if name == "manifest.json":
            manifest = json.loads(path.read_text(encoding="utf-8"))
            manifest.pop("version", None)
            data = json.dumps(manifest, sort_keys=True).encode("utf-8")
        else:
            data = path.read_bytes()
            if PurePosixPath(name).suffix in _TEXT_SUFFIXES:
                data = data.replace(b"\r\n", b"\n")
        digest.update(f"{name}\0".encode() + data + b"\0")
    return digest.hexdigest()


# ---- the folder the app owns -------------------------------------------------


def _read_stamp(folder: Path) -> dict[str, Any] | None:
    try:
        stamp = json.loads((folder / STAMP_NAME).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return stamp if isinstance(stamp, dict) else None


def _staging_dirs(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    return [p for p in folder.iterdir() if p.is_dir() and p.name.startswith(_STAGING_PREFIX)]


def state() -> dict[str, Any]:
    """What the app ships, what its folder holds, and where that folder is.

    Reads disk only, and sweeps the litter a refused swap left behind — whatever
    was holding those files has usually let go by the time anyone opens Settings.
    A surviving staging directory is the one thing that means "the last pass
    didn't finish", so it is left alone here and cleared by the next pass.
    """
    folder = config.extension_dir()
    with _lock:
        dirswap.sweep_leftovers(folder)
        staged = bool(_staging_dirs(folder))
        stamp = _read_stamp(folder)
    return {
        "path": str(folder),
        "bundled": {"version": bundled_version(), "payload": payload_digest()},
        "folder": stamp,
        "staged": staged,
    }


def install() -> dict[str, Any]:
    """Write the shipped extension into the folder the app owns, and stamp it.

    Idempotent: a second pass over an unchanged payload rewrites the same bytes
    and keeps ``install_id``, so the browser keeps its extension identity and the
    analyst keeps their pairing.

    Returns the same shape as ``state()``. ``staged`` true means the payload is
    assembled but something is holding a file open — press again, or close the
    browser first.
    """
    src = source_dir()
    if src is None:
        raise LookupError("no extension bundled with this build")
    folder = config.extension_dir()
    with _lock:
        folder.mkdir(parents=True, exist_ok=True)
        dirswap.sweep_leftovers(folder)
        # Whatever an earlier pass left staged has no value: this one re-copies
        # every file from source. Clearing them first is also what keeps
        # "staged" honest — exactly one staging directory can exist, and its
        # presence means this pass is the one that didn't finish.
        for stale in _staging_dirs(folder):
            shutil.rmtree(stale, ignore_errors=True)
        # An id belongs to the folder, not to a payload: preserved across every
        # update, so "is this the copy I control" keeps its answer.
        previous = _read_stamp(folder)
        install_id = str(previous.get("install_id") or "") if previous else ""
        if not install_id:
            install_id = os.urandom(16).hex()

        shipped = shipped_files(src)
        staging = folder / f"{_STAGING_PREFIX}{os.urandom(4).hex()}"
        staged = False
        try:
            for name, path in shipped:
                target = staging / PurePosixPath(name)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
            # The manifest last, and the stamp after it. Anything interrupted
            # before the manifest lands leaves a folder describing the old
            # version, which is the only half-state a browser can load safely.
            ordered = [entry for entry in shipped if entry[0] != "manifest.json"]
            ordered += [entry for entry in shipped if entry[0] == "manifest.json"]
            for name, _ in ordered:
                relative = PurePosixPath(name)
                destination = folder / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                try:
                    dirswap.replace_file(staging / relative, destination)
                except OSError:
                    staged = True
                    break
            if not staged:
                _write_stamp(folder, install_id)
                _remove_unshipped(folder, {name for name, _ in shipped})
        finally:
            if not staged:
                shutil.rmtree(staging, ignore_errors=True)
    return state()


def _write_stamp(folder: Path, install_id: str) -> None:
    """Record what this folder holds. Written straight rather than swapped: it is
    the last step, and a folder whose stamp is missing reads as "not mine", which
    is a state the UI already handles."""
    stamp = {
        "install_id": install_id,
        "version": bundled_version(),
        "payload": payload_digest(),
    }
    (folder / STAMP_NAME).write_text(json.dumps(stamp, indent=2) + "\n", encoding="utf-8")


def _remove_unshipped(folder: Path, shipped: set[str]) -> None:
    """Delete what the payload no longer carries.

    A leftover file nothing references is litter; one a stale manifest still
    references is a bug. Best-effort per entry: a file that can't be deleted is
    swept by the next pass. Deepest first, so a directory the payload emptied is
    reached after its contents are gone.
    """
    keep = shipped | {STAMP_NAME}
    for path in sorted(folder.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        relative = path.relative_to(folder)
        if relative.parts[0].startswith((_STAGING_PREFIX, ".old-", ".trash-")):
            continue
        if path.is_dir():
            try:
                path.rmdir()  # only if the payload left it empty
            except OSError:
                pass
            continue
        if relative.as_posix() in keep:
            continue
        try:
            path.unlink()
        except OSError:
            pass
