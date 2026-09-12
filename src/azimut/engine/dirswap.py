"""Replacing files and directories on all three platforms, under a program that
may be holding them open.

Windows is the constraint. ``os.replace()`` onto an *existing* directory fails
there (MOVEFILE_REPLACE_EXISTING is file-only), and an open file can't be
deleted at all — but it can usually still be *renamed*. So the destructive step
is always a rename: old copy out of the way first, new copy in second, delete the
leftovers last. Renames are cheap and near-atomic everywhere; deletes are the
part allowed to fail, and by then they can't cost us anything that matters.

Two callers, two granularities:

* ``engine/scrapers.py`` swaps a whole directory. The scraper package is only
  read through a meta-path finder we control, so moving the directory is free.
* ``engine/extinstall.py`` swaps files *inside* a directory it must not move,
  because Chrome derives the extension id from the folder's path and a browser
  is loaded on it right now.
"""

from __future__ import annotations

import os
import shutil
import stat
import sys
import time
from pathlib import Path

#: Attempts per file before a refused replace is reported as refused. A browser
#: reading an extension resource holds it for milliseconds, so a couple of
#: retries covers a collision; anything longer is a real lock and waiting on it
#: only makes the app look hung.
REPLACE_ATTEMPTS = 4
REPLACE_BACKOFF = 0.05


def force_writable(func, path, _exc):
    """rmtree onexc hook: clear the read-only bit Windows refuses to delete through."""
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except OSError:
        pass


def rmtree(path: Path) -> None:
    # onexc replaced onerror in 3.12; we still support 3.11. The hook ignores its
    # third argument, which is the only thing that differs between the two.
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=force_writable)
    else:
        shutil.rmtree(path, onerror=force_writable)


def retire(target: Path) -> Path | None:
    """Rename `target` out of the way, returning where it went (None if absent)."""
    if not target.exists():
        return None
    retired = target.parent / f".trash-{target.name}-{os.urandom(4).hex()}"
    target.replace(retired)
    return retired


def swap_in(staging: Path, target: Path) -> None:
    """Replace `target` with `staging`, restoring the old copy if the move fails."""
    retired = retire(target)
    try:
        staging.replace(target)
    except BaseException:
        if retired is not None:
            retired.replace(target)  # put the working copy back
        raise
    if retired is not None:
        # Best-effort: a locked leftover on Windows is litter, not a failure.
        shutil.rmtree(retired, ignore_errors=True)


def discard(target: Path) -> None:
    """Remove `target`, making sure it's gone even if the delete can't finish —
    the rename is what counts."""
    retired = retire(target)
    if retired is not None:
        shutil.rmtree(retired, ignore_errors=True)


def replace_file(source: Path, target: Path) -> None:
    """Move `source` onto `target`, for a `target` something else may hold open.

    Three moves, weakest assumption last:

    1. ``os.replace``, retried a few times — a reader holds a file for
       milliseconds and the second attempt usually lands.
    2. rename the target aside, then move in. Windows refuses to *delete* an
       open file where it will still let you *rename* one, so this catches the
       case the retry can't.
    3. give up and raise, having changed nothing. The caller decides what a
       refusal means; here it must never mean a half-written file.

    The leftover from step 2 is deleted best-effort. A locked one is litter that
    the next pass sweeps, never a failed update.
    """
    last: OSError | None = None
    for attempt in range(REPLACE_ATTEMPTS):
        try:
            os.replace(source, target)
            return
        except PermissionError as exc:  # Windows: the target is held open
            last = exc
            if attempt < REPLACE_ATTEMPTS - 1:
                time.sleep(REPLACE_BACKOFF)
    aside = target.parent / f".old-{target.name}-{os.urandom(4).hex()}"
    try:
        target.replace(aside)
    except OSError:
        raise last if last is not None else OSError(f"cannot replace {target}")
    try:
        os.replace(source, target)
    except OSError:
        aside.replace(target)  # put the working copy back
        raise
    try:
        aside.unlink()
    except OSError:
        pass


def sweep_leftovers(directory: Path) -> None:
    """Delete the ``.old-*`` and ``.trash-*`` litter earlier passes couldn't.

    Called on the way into a fresh pass, when whatever held those files has had
    a chance to let go. Silent by design: a leftover that still can't be deleted
    is a few kilobytes, not an error worth a user's attention.
    """
    if not directory.is_dir():
        return
    for entry in directory.iterdir():
        if not entry.name.startswith((".old-", ".trash-")):
            continue
        try:
            if entry.is_dir():
                shutil.rmtree(entry, ignore_errors=True)
            else:
                entry.unlink()
        except OSError:
            pass
