"""Choosing where the workspace lives, and moving it there.

Two operations, and the difference between them is the whole feature:

*Adopt* points Azimut at a folder that is already where the analyst wants it.
Nothing is copied. It is the likely path — someone who moved the folder by hand
while the app was closed, or who wants a fresh workspace somewhere else — so it
is the cheap one.

*Move* copies the current workspace to a new location, verifies the copy, and
only then writes the pointer. The old folder is never deleted: it is renamed
aside and the analyst decides. Every failure mode below therefore ends with at
least one complete workspace on disk, and usually two.

Nothing inside a workspace records where it is (media are stored as
`media/photo.png`, settings hold keys and preferences), so a move is a directory
copy with no rewriting inside it. What cannot travel is the answer to "where is
the workspace" — that is `config`'s pointer file, and writing it is the switch.
"""

from __future__ import annotations

import logging
import os
import shutil
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from .. import config, layout
from .bundles import disk_reserve

logger = logging.getLogger(__name__)


class MoveError(Exception):
    """A workspace operation refused, with a reason fit to put in front of a user."""


#: Suffix of the directory a move copies into. It sits beside the destination
#: rather than inside it so the final step is a rename on the same volume, and
#: so a killed copy is obvious rather than mistaken for a workspace.
STAGING_SUFFIX = ".azimut-incoming"

#: Folder names that mean the destination is inside a sync client's tree. Each
#: case carries a SQLite database, and a sync client writing underneath one can
#: corrupt it. Worth saying out loud; not worth refusing, since plenty of people
#: deliberately keep their work there.
CLOUD_MARKERS = (
    "onedrive",
    "dropbox",
    "google drive",
    "googledrive",
    "grive",
    "icloud drive",
    "com~apple~clouddocs",
    "nextcloud",
    "owncloud",
    "pcloud",
    "mega",
    "yandex.disk",
    "yandexdisk",
)

#: Not copied, because it is a cache: `tile_cache_dir()` is disposable by
#: contract (STORAGE_AND_PERFORMANCE), and it is also the largest thing in a
#: workspace that nobody would miss. Rebuilt by browsing the map.
SKIPPED_DIRS = ("cache",)


# -- comparing two paths on three operating systems ---------------------------


def _normal(path: Path) -> str:
    """A path in the form this filesystem would compare it in.

    `os.path.normcase` lowercases and unifies separators on Windows and does
    nothing on POSIX, which is right for Linux and wrong for macOS: HFS+ and
    APFS are case-insensitive by default, so `~/Azimut` and `~/azimut` are one
    folder there and refusing to notice would let a move copy a workspace onto
    itself.
    """
    text = os.path.normcase(str(path))
    return text.casefold() if sys.platform == "darwin" else text


def _same_folder(left: Path, right: Path) -> bool:
    """Whether two paths name one directory, asked the strongest way available."""
    if left == right:
        return True
    try:
        if left.exists() and right.exists() and left.samefile(right):
            return True
    except OSError:
        pass
    return _normal(left) == _normal(right)


def _inside(child: Path, parent: Path) -> bool:
    """Whether *child* sits under *parent*, in the same spelling of both.

    Resolved first, because a candidate folder always arrives resolved
    (`_resolve`) while the current root is whatever the pointer says. One symlink
    above the workspace makes those two spellings of one path — `/var` and
    `/private/var` on macOS, a linked or synced folder anywhere — and the string
    comparison would then answer "not inside" about a folder that is, which is
    how a workspace ends up nested in itself.
    """
    inner, outer = _normal(child.resolve()), _normal(parent.resolve())
    return inner == outer or inner.startswith(outer.rstrip(os.sep) + os.sep)


def _resolve(raw: str) -> Path:
    """What the analyst typed, as a path this machine can act on."""
    text = (raw or "").strip().strip('"')
    if not text:
        raise MoveError("name a folder")
    path = Path(text).expanduser()
    try:
        resolved = path.resolve()
    except OSError as exc:  # a broken mount point, mostly
        raise MoveError(f"that path can't be read: {exc}") from exc
    if not resolved.is_absolute():
        raise MoveError("give a full path, starting from the drive or from ~")
    return resolved


# -- reading a candidate folder ------------------------------------------------


def _writable(directory: Path) -> bool:
    """Whether Azimut can actually create a file here, asked by trying."""
    try:
        with tempfile.NamedTemporaryFile(dir=directory, prefix=".azimut-probe-"):
            return True
    except OSError:
        return False


def _count_cases(root: Path) -> int:
    """Permanent cases directly under *root*, found by manifest as everywhere else."""
    try:
        children = sorted(root.iterdir())
    except OSError:
        return 0
    return sum(1 for child in children if child.is_dir() and layout.is_case(child))


def _looks_like_workspace(root: Path) -> bool:
    return (root / ".azimut").is_dir() or _count_cases(root) > 0


def _is_empty(directory: Path) -> bool:
    try:
        return not any(directory.iterdir())
    except OSError:
        return False


def _cloud_warning(root: Path) -> str:
    lowered = [part.casefold() for part in root.parts]
    for marker in CLOUD_MARKERS:
        if any(marker in part for part in lowered):
            return (
                "This looks like a synced folder. A sync client writing into a case "
                "can corrupt its database while Azimut has it open."
            )
    return ""


def measure(root: Path) -> tuple[int, int]:
    """Files and bytes Azimut would copy out of *root*."""
    files = 0
    total = 0
    for path in _copyable_files(root):
        files += 1
        try:
            total += path.stat().st_size
        except OSError:
            pass
    return files, total


def _walk(root: Path):
    """The tree a move carries: every directory, and the files inside it.

    Symlinks are skipped rather than followed: a workspace is meant to be a
    self-contained tree, and copying through a link would either duplicate
    something outside it or walk into a loop. Bundles already refuse them for
    the same reason.
    """
    skip = {root / ".azimut" / name for name in SKIPPED_DIRS}
    for directory, subdirs, names in os.walk(root, followlinks=False):
        here = Path(directory)
        subdirs[:] = sorted(
            name
            for name in subdirs
            if not (here / name).is_symlink()
            and not any(_same_folder(here / name, skipped) for skipped in skip)
            and not name.endswith(STAGING_SUFFIX)
        )
        files = []
        for name in sorted(names):
            candidate = here / name
            if not candidate.is_symlink() and candidate.is_file():
                files.append(candidate)
        yield here, files


def _copyable_dirs(root: Path):
    """Every directory a move carries, parents before children.

    Yielded separately because an *empty* one still has to arrive: a case is
    born with `exports/` and the two `.meta/` directories, and a workspace with
    `.azimut/bundles/`. Recreating only the parents of files would quietly
    return a moved case to a shape it was never in.
    """
    for directory, _files in _walk(root):
        yield directory


def _copyable_files(root: Path):
    """Every regular file a move carries, in a stable order."""
    for _directory, files in _walk(root):
        yield from files


def inspect_target(raw: str) -> dict[str, Any]:
    """Everything the dialog needs to decide, in one read-only pass.

    Returns the folder Azimut would actually use, which is not always the one
    that was typed: a destination that already holds someone else's files gets
    an `Azimut` subfolder rather than settling among them.
    """
    current = config.workspace_root().expanduser()
    try:
        target = _resolve(raw)
    except MoveError as exc:
        return _verdict(raw, current, problems=[str(exc)])

    problems: list[str] = []
    warnings: list[str] = []

    if target.exists() and not target.is_dir():
        return _verdict(raw, current, root=target, problems=["that path is a file, not a folder"])

    nested = False
    root = target
    if target.is_dir() and not _is_empty(target) and not _looks_like_workspace(target):
        root = target / "Azimut"
        nested = True

    state = "missing"
    if root.is_dir():
        state = "workspace" if _looks_like_workspace(root) else ("empty" if _is_empty(root) else "occupied")

    if state == "occupied":
        problems.append("that folder already holds other files")

    if state == "workspace":
        from . import workspacelock

        if (busy := workspacelock.holder(root)) is not None:
            problems.append(workspacelock.describe(busy))

    if _same_folder(root, current):
        problems.append("that is already the workspace")
    elif _inside(root, current):
        problems.append("that folder is inside the current workspace")
    elif _inside(current, root):
        problems.append("that folder contains the current workspace")

    overflow = layout.root_overflow(root)
    if overflow:
        message = (
            f"that path is {overflow} characters too long: Windows refuses a file path over "
            f"{layout.WINDOWS_MAX_PATH + 1}, and a case needs {layout.IN_CASE_BUDGET} of them"
        )
        # Refused where it breaks, said out loud everywhere else: a case written
        # under a long root on Linux stops opening the day it is copied to a
        # Windows machine, which is exactly the trip a portable case is for.
        (problems if sys.platform == "win32" else warnings).append(message)

    probe = root if root.is_dir() else _existing_parent(root)
    if probe is None:
        problems.append("none of the folders on that path exist")
    elif not _writable(probe):
        problems.append("that folder can't be written to")

    if cloud := _cloud_warning(root):
        warnings.append(cloud)

    # A staging directory can only outlive its move if the process was killed:
    # a move that merely fails clears it. Saying so is what turns "there is a
    # strange folder next to mine" into a fact the analyst already knew.
    if (root.parent / f"{root.name}{STAGING_SUFFIX}").is_dir():
        warnings.append("a copy from an interrupted move is here, and starting again discards it")

    verdict = _verdict(
        raw,
        current,
        root=root,
        state=state,
        nested=nested,
        problems=problems,
        warnings=warnings,
    )
    if probe is not None and not problems:
        needed = verdict["needed_bytes"]
        free = shutil.disk_usage(probe)
        reserve = disk_reserve(free.total)
        verdict["free_bytes"] = free.free
        if needed + reserve > free.free:
            short = needed + reserve - free.free
            verdict["problems"].append(f"not enough free space: {_size(short)} short")
            verdict["ok"] = False
    return verdict


def _existing_parent(path: Path) -> Path | None:
    for candidate in [path, *path.parents]:
        if candidate.is_dir():
            return candidate
    return None


def _verdict(
    raw: str,
    current: Path,
    *,
    root: Path | None = None,
    state: str = "missing",
    nested: bool = False,
    problems: list[str] | None = None,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    problems = problems or []
    files, needed = measure(current) if current.is_dir() else (0, 0)
    return {
        "path": raw,
        "root": str(root) if root else "",
        "state": state,
        "nested": nested,
        "ok": not problems,
        "problems": problems,
        "warnings": warnings or [],
        "cases": _count_cases(root) if root and root.is_dir() else 0,
        "current_root": str(current),
        "current_cases": _count_cases(current),
        "current_files": files,
        "needed_bytes": needed,
        "free_bytes": 0,
    }


def _size(count: int) -> str:
    value = float(count)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GB"


# -- adopting a folder ---------------------------------------------------------


def adopt(raw: str) -> dict[str, Any]:
    """Use *raw* as the workspace from now on, without moving anything.

    Covers both folders that already hold cases and an empty folder someone
    wants to start fresh in. The cases in the *current* workspace stay where
    they are, which is why the caller has to have said so out loud first.
    """
    from . import workspacelock

    verdict = inspect_target(raw)
    if not verdict["ok"]:
        raise MoveError(verdict["problems"][0])
    root = Path(verdict["root"])
    root.mkdir(parents=True, exist_ok=True)
    config.write_pointer(root)
    try:
        _settle_into_new_root()
    except workspacelock.WorkspaceBusy as busy:
        # Lost the race between inspecting the folder and taking it. The pointer
        # already moved, so say so plainly rather than pretending it didn't.
        raise MoveError(str(busy)) from busy
    return status()


def use_default() -> dict[str, Any]:
    """Forget a configured location and go back to ``~/Azimut``."""
    from . import workspacelock

    config.clear_pointer()
    try:
        _settle_into_new_root()
    except workspacelock.WorkspaceBusy as busy:
        raise MoveError(str(busy)) from busy
    return status()


def take_the_lock() -> dict[str, Any]:
    """Open the workspace despite the lock, because the analyst says so.

    The verdict can be wrong in one direction that matters: two machines whose
    clocks disagree, or a sync client leaving a file nobody will ever clear.
    Without a way to overrule it, either would make a workspace unopenable.
    """
    from . import workspacelock

    workspacelock.take_over(_serving_port())
    from ..workspace import open_workspace

    open_workspace()
    return status()


def _settle_into_new_root() -> None:
    """Open the new location as a workspace, with everything startup would do.

    The folder may hold cases this process has never seen, written by an older
    Azimut, so it gets the same treatment as a cold start rather than a bare
    `mkdir`. Local import: `workspace` sits above the engine.
    """
    from ..workspace import open_workspace
    from . import workspacelock

    config.forget_workspace_root()
    # The lock belongs to a folder, not to the process, so it moves with the
    # root and before the migrations — same order as startup, same reason.
    workspacelock.acquire(_serving_port())
    open_workspace()


def _serving_port() -> int | None:
    from .. import server

    return server.SERVE_PORT


# -- moving the workspace ------------------------------------------------------

#: In order, and named as the analyst sees them.
STEPS = ("checking", "settling", "copying", "verifying", "switching", "opening", "tidying")


@dataclass
class Move:
    source: Path
    root: Path
    step: str = STEPS[0]
    files: int = 0
    copied_files: int = 0
    total_bytes: int = 0
    copied_bytes: int = 0
    error: str = ""
    kept_aside: str = ""
    done: bool = False
    started_at: float = field(default_factory=time.monotonic)

    def snapshot(self) -> dict[str, Any]:
        return {
            "step": self.step,
            "files": self.files,
            "copied_files": self.copied_files,
            "total_bytes": self.total_bytes,
            "copied_bytes": self.copied_bytes,
            "error": self.error,
            "kept_aside": self.kept_aside,
            "done": self.done,
            "source": str(self.source),
            "root": str(self.root),
        }


_move: Move | None = None
_move_lock = threading.Lock()


def in_progress() -> bool:
    """Whether a move is running. Case routes refuse while it is."""
    with _move_lock:
        return _move is not None and not _move.done


def status() -> dict[str, Any]:
    """Where the workspace is, and how the last move went."""
    from . import workspacelock

    root = config.workspace_root().expanduser()
    with _move_lock:
        move = _move.snapshot() if _move else None
    busy = workspacelock.holder()
    return {
        "locked_by": busy,
        "locked_detail": workspacelock.describe(busy) if busy else "",
        "root": str(root),
        "default_root": str(config.DEFAULT_ROOT.expanduser()),
        "pointed": config.read_pointer() is not None,
        # An address given on every launch cannot be changed from inside the
        # app, so the UI shows the folder and hides the buttons.
        "environment": bool(os.environ.get("AZIMUT_HOME")),
        "missing": config.workspace_missing(),
        "moving": _move is not None and not _move.done,
        "cases": _count_cases(root),
        "move": move,
    }


def start(raw: str) -> dict[str, Any]:
    """Begin a move to *raw* in the background. Refuses a second one."""
    global _move
    verdict = inspect_target(raw)
    if not verdict["ok"]:
        raise MoveError(verdict["problems"][0])
    if verdict["state"] == "workspace":
        raise MoveError("that folder already holds a workspace; use it as it is instead")
    source = config.workspace_root().expanduser()
    with _move_lock:
        if _move is not None and not _move.done:
            raise MoveError("a move is already running")
        _move = Move(source=source, root=Path(verdict["root"]))
        move = _move
    threading.Thread(target=_run, args=(move,), name="azimut-workspace-move", daemon=True).start()
    return move.snapshot()


def _run(move: Move) -> None:
    from . import workqueue

    resume_workers = workqueue.start_workers
    staging = move.root.parent / f"{move.root.name}{STAGING_SUFFIX}"
    try:
        _step_settle(move, workqueue)
        _step_copy(move, staging)
        _step_verify(move, staging)
        _step_switch(move, staging)
        _step_open(move)
        _step_tidy(move)
        move.done = True
    except Exception as exc:  # one failure surface: the analyst reads `error`
        logger.warning("workspace move failed at %s: %s", move.step, exc)
        move.error = str(exc) or exc.__class__.__name__
        move.done = True
        shutil.rmtree(staging, ignore_errors=True)
    finally:
        workqueue.start_workers = resume_workers


def _step_settle(move: Move, workqueue: Any) -> None:
    """Stop background work before anything is copied.

    Mandatory on Windows, which refuses to move a file another handle has open,
    and worth doing everywhere: a thumbnail written into the source while the
    copy walks past it is a file the verification would then reject.
    """
    move.step = "settling"
    workqueue.start_workers = False
    if not workqueue.wait_until_idle(timeout=30.0):
        raise MoveError("background work is still running; try again in a moment")


def _step_copy(move: Move, staging: Path) -> None:
    move.step = "copying"
    # A leftover from an interrupted attempt is incomplete by definition: the
    # pointer only ever names a folder that passed verification.
    shutil.rmtree(staging, ignore_errors=True)
    move.files, move.total_bytes = measure(move.source)
    staging.mkdir(parents=True)
    for source_dir in _copyable_dirs(move.source):
        (staging / source_dir.relative_to(move.source)).mkdir(parents=True, exist_ok=True)
    for source_file in _copyable_files(move.source):
        destination = staging / source_file.relative_to(move.source)
        shutil.copy2(source_file, destination)
        move.copied_files += 1
        move.copied_bytes += destination.stat().st_size


def _step_verify(move: Move, staging: Path) -> None:
    """Every file, by name and by size. Until this passes the old folder is
    still the workspace, and nothing has been switched."""
    move.step = "verifying"
    for source_dir in _copyable_dirs(move.source):
        if not (staging / source_dir.relative_to(move.source)).is_dir():
            raise MoveError(f"the copy is missing the {source_dir.name} folder")
    for source_file in _copyable_files(move.source):
        copied = staging / source_file.relative_to(move.source)
        try:
            expected = source_file.stat().st_size
            actual = copied.stat().st_size
        except OSError as exc:
            raise MoveError(f"the copy is missing {source_file.name}") from exc
        if expected != actual:
            raise MoveError(f"the copy of {source_file.name} is a different size")


def _step_switch(move: Move, staging: Path) -> None:
    """Put the copy in its final place, then write the pointer.

    The rename comes first so the pointer never names a half-built folder, and
    it is a rename rather than a replace because Windows will not let
    `os.replace` overwrite a directory. Dying between the two leaves the new
    folder complete but unused, and the old one still authoritative.
    """
    move.step = "switching"
    if move.root.is_dir():
        if not _is_empty(move.root):
            raise MoveError("something was written into the destination while the copy ran")
        move.root.rmdir()
    move.root.parent.mkdir(parents=True, exist_ok=True)
    staging.rename(move.root)
    config.write_pointer(move.root)


def _step_open(move: Move) -> None:
    move.step = "opening"
    _settle_into_new_root()
    if not config.settings_path().exists():
        raise MoveError("the new workspace did not open; the old folder is untouched")


def _step_tidy(move: Move) -> None:
    """Keep the old folder, renamed, until the analyst says otherwise."""
    move.step = "tidying"
    stamp = datetime.now().strftime("%Y-%m-%d")
    candidate = move.source.with_name(f"{move.source.name}.old-{stamp}")
    index = 2
    while candidate.exists():
        candidate = move.source.with_name(f"{move.source.name}.old-{stamp}-{index}")
        index += 1
    try:
        move.source.rename(candidate)
        move.kept_aside = str(candidate)
    except OSError as exc:
        # The move itself succeeded; failing to rename the leftovers is a
        # tidiness problem, and saying where they are beats failing here.
        logger.warning("could not set the old workspace aside: %s", exc)
        move.kept_aside = str(move.source)


def discard_old() -> str:
    """Delete the folder the last move set aside, if the analyst asks.

    Only that folder: the path comes from this process's own memory, never from
    the request, so there is no route here that deletes an arbitrary directory.
    After a restart the memory is gone and the folder is theirs to remove.
    """
    with _move_lock:
        move = _move
    if move is None or not move.done or move.error or not move.kept_aside:
        raise MoveError("there is no old workspace to remove")
    old = Path(move.kept_aside)
    if _same_folder(old, config.workspace_root().expanduser()):
        raise MoveError("that folder is the workspace")
    _rmtree(old)
    move.kept_aside = ""
    return str(old)


def _force_remove(func: Callable[..., Any], path: str, _info: Any) -> None:
    """Clear the read-only bit and retry, the one thing Windows needs here."""
    try:
        os.chmod(path, 0o700)
        func(path)
    except OSError:
        pass


def _rmtree(path: Path) -> None:
    # `onexc` replaced `onerror` in 3.12 and we still support 3.11; the hook
    # ignores the third argument, which is all that differs between them. Same
    # shape, and the same reason, as `scrapers._rmtree`.
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=_force_remove)
    else:
        shutil.rmtree(path, onerror=_force_remove)
