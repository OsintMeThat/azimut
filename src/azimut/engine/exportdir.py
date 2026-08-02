"""Where an export lands, and the folder browser that lets the analyst say so.

Every export used to write into the case's own `exports/` folder. That is still
the default, but a finished PDF or a media file is usually wanted somewhere the
case is not — a shared drive, a report folder, the desktop. So each kind of
export (notes, media, proofs) remembers one destination app-wide, and the analyst
changes it by browsing the filesystem from here.

Two rules shape this module:

* **The browser never sends a path Azimut has not shown it.** A destination is
  reached by walking `roots()` and `listing()`, both of which only ever return
  directory names. Nothing here reads a file, and nothing lists one.
* **An export may leave the workspace, but never lands in the machinery.** That
  is the point of choosing a folder. What it must not do is drop files in the
  hidden directories the app keeps its own state in, so those are refused.

The saved destinations live in settings under `export_dirs`, one entry per kind.
An empty entry means the case's own `exports/` folder, which is what a fresh
install exports to.
"""

from __future__ import annotations

import os
import shutil
import string
import sys
import tempfile
from pathlib import Path
from typing import Any, BinaryIO, Iterator

from .. import config, layout

#: The exports that remember a destination of their own. Notes and proofs are
#: documents the analyst files somewhere; media is the original coming back out.
KINDS = ("notes", "media", "proofs")

#: The case subdir an export falls back to when its kind has no folder saved.
CASE_EXPORTS = "exports"

#: Bound on one listing. A folder holding more subfolders than this is a
#: machine's, not an analyst's, and the picker is not a file manager.
MAX_ENTRIES = 500

#: A directory full of files should not make a folder-only picker walk millions
#: of entries just to discover that none can be shown. The useful result stays
#: capped at ``MAX_ENTRIES`` and the underlying scan has its own hard stop.
MAX_SCANNED_ENTRIES = 5_000

#: Longest folder name "New folder" will make.
MAX_NEW_NAME = 60


class ExportDirError(Exception):
    """A folder that can't be browsed or written to, said in a way fit for a user."""


# -- the saved destinations --------------------------------------------------


def saved_dirs(settings: dict[str, Any] | None = None) -> dict[str, str]:
    """The remembered destination per kind, empty string meaning the case folder."""
    stored = (settings or config.load_settings()).get("export_dirs") or {}
    return {kind: str(stored.get(kind) or "") for kind in KINDS}


def destination(kind: str, case_path: Path) -> Path:
    """The folder ``kind`` exports to for this case, created if it isn't there.

    The saved destination, and without one the case's own `exports/`. A saved
    folder that has since gone away (an unplugged drive, a folder deleted from
    under us) falls back to the case rather than failing the export: the analyst
    gets their file, in the place that always exists.

    The browser never names a destination. It picks one, which is saved, and
    every export after that reads it from here — so a request cannot write to a
    folder the analyst has not chosen.
    """
    if kind not in KINDS:
        raise ExportDirError(f"unknown export kind '{kind}'")
    saved = saved_dirs().get(kind, "")
    if saved:
        try:
            return resolve(saved)
        except ExportDirError:
            pass
    fallback = layout.subdir(case_path, CASE_EXPORTS)
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def resolve(raw: str) -> Path:
    """Validate a folder the analyst chose, and hand back the real path.

    Raises :class:`ExportDirError` for a folder that isn't there, isn't a folder,
    isn't writable, or is one of Azimut's own hidden directories.
    """
    text = str(raw or "").strip()
    if not text:
        raise ExportDirError("no folder given")
    try:
        target = Path(text).expanduser().resolve()
    except OSError as exc:  # a path the OS refuses to even normalise
        raise ExportDirError("that is not a usable folder") from exc
    if not target.exists():
        raise ExportDirError("that folder does not exist")
    if not target.is_dir():
        raise ExportDirError("that is a file, not a folder")
    if _is_machinery(target):
        raise ExportDirError("that folder belongs to Azimut — pick another one")
    if not _writable(target):
        raise ExportDirError("that folder is not writable")
    return target


def _is_machinery(target: Path) -> bool:
    """Whether ``target`` is inside state Azimut manages rather than user files.

    The workspace itself is fair game (the default destination is inside a case),
    but the hidden directories under it — the app's own `.azimut/`, a case's
    `.data/`, a case's `.trash/`, a media folder's `.meta/` — are not somewhere a
    finished document belongs.
    """
    try:
        root = config.workspace_root().expanduser().resolve()
    except OSError:
        return False
    try:
        relative = target.relative_to(root)
    except ValueError:
        return False  # outside the workspace entirely: the analyst's own folders
    return any(part.startswith(".") for part in relative.parts)


def _writable(directory: Path) -> bool:
    """Whether a file can actually be created here, asked by trying."""
    try:
        with tempfile.NamedTemporaryFile(prefix=".azimut-write-", dir=directory):
            pass
    except OSError:
        return False
    return True


# -- browsing ----------------------------------------------------------------


def roots() -> list[dict[str, str]]:
    """The places the picker offers to start from.

    The analyst's own folders first, because that is where an export goes, then
    the workspace. On Windows the drive letters come last, so a second disk is
    reachable without typing a path.
    """
    home = Path.home()
    found: list[dict[str, str]] = []

    def offer(label: str, path: Path) -> None:
        try:
            resolved = path.expanduser().resolve()
        except OSError:
            return
        if not resolved.is_dir():
            return
        if any(entry["path"] == str(resolved) for entry in found):
            return
        found.append({"label": label, "path": str(resolved)})

    offer("Home", home)
    offer("Desktop", home / "Desktop")
    offer("Documents", home / "Documents")
    offer("Downloads", home / "Downloads")
    offer("Workspace", config.workspace_root())
    if sys.platform == "win32":
        for letter in string.ascii_uppercase:
            offer(f"{letter}:", Path(f"{letter}:/"))
    return found


def listing(raw: str) -> dict[str, Any]:
    """The subfolders of one folder, with the crumbs that lead back out.

    Only directories are returned: the picker chooses a destination, so the files
    already in it are none of its business — and not listing them keeps this from
    becoming a way to read the disk from a browser tab.
    """
    text = str(raw or "").strip()
    if not text:
        raise ExportDirError("no folder given")
    try:
        target = Path(text).expanduser().resolve()
    except OSError as exc:
        raise ExportDirError("that is not a usable folder") from exc
    if not target.is_dir():
        raise ExportDirError("that folder does not exist")

    folders: list[dict[str, str]] = []
    truncated = False
    try:
        with os.scandir(target) as entries:
            for scanned, entry in enumerate(entries, start=1):
                if scanned > MAX_SCANNED_ENTRIES:
                    truncated = True
                    break
                if entry.name.startswith("."):
                    continue
                try:
                    is_dir = entry.is_dir()
                except OSError:
                    continue
                if not is_dir:
                    continue
                if len(folders) >= MAX_ENTRIES:
                    truncated = True
                    break
                folders.append({"name": entry.name, "path": str(target / entry.name)})
    except OSError as exc:
        raise ExportDirError("that folder can't be read") from exc

    folders.sort(key=lambda entry: entry["name"].casefold())

    return {
        "path": str(target),
        "name": target.name or str(target),
        "parent": str(target.parent) if target.parent != target else "",
        "crumbs": _crumbs(target),
        "folders": folders,
        "truncated": truncated,
        "writable": _writable(target) and not _is_machinery(target),
    }


def _crumbs(target: Path) -> list[dict[str, str]]:
    """Every folder on the way to ``target``, outermost first."""
    parts = list(reversed([target, *target.parents]))
    return [{"name": part.name or str(part), "path": str(part)} for part in parts]


def create_folder(parent_raw: str, name: str) -> dict[str, str]:
    """Make one subfolder inside a browsed folder, so an export can go somewhere new."""
    parent = resolve(parent_raw)
    clean = layout.slugify(name, "", limit=MAX_NEW_NAME)
    if not clean:
        raise ExportDirError("that folder name can't be used")
    target = parent / clean
    if target.exists():
        raise ExportDirError("a folder by that name is already there")
    try:
        target.mkdir()
    except OSError as exc:
        raise ExportDirError("that folder could not be created") from exc
    return {"name": target.name, "path": str(target)}


# -- writing an export out ---------------------------------------------------


def _candidate_paths(folder: Path, filename: str) -> Iterator[Path]:
    candidate = folder / filename
    yield candidate
    for index in range(2, 1000):
        yield folder / f"{candidate.stem} ({index}){candidate.suffix}"


def _reserve_path(folder: Path, filename: str) -> tuple[Path, BinaryIO]:
    """Atomically reserve a new file without overwriting an existing one."""
    for candidate in _candidate_paths(folder, filename):
        try:
            return candidate, candidate.open("xb")
        except FileExistsError:
            continue
        except OSError as exc:
            raise ExportDirError(f"could not write to that folder: {exc}") from exc
    raise ExportDirError("too many files by that name are already there")


def _discard_failed(target: Path) -> None:
    try:
        target.unlink(missing_ok=True)
    except OSError:
        pass


def copy_out(source: Path, folder: Path, filename: str) -> Path:
    """Copy one file into ``folder`` under an atomically reserved name."""
    if not source.is_file():
        raise ExportDirError("that file is no longer on disk")
    target, handle = _reserve_path(folder, filename)
    try:
        with handle, source.open("rb") as source_handle:
            shutil.copyfileobj(source_handle, handle)
        shutil.copystat(source, target)
    except OSError as exc:
        handle.close()
        _discard_failed(target)
        raise ExportDirError(f"could not write to that folder: {exc}") from exc
    return target


def write_out(data: bytes, folder: Path, filename: str) -> Path:
    """Write generated bytes under an atomically reserved external name."""
    target, handle = _reserve_path(folder, filename)
    try:
        with handle:
            handle.write(data)
    except OSError as exc:
        handle.close()
        _discard_failed(target)
        raise ExportDirError(f"could not write to that folder: {exc}") from exc
    return target
