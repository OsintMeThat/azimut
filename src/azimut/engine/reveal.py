"""Show a folder in the system's own file manager.

Azimut is a local server plus a browser tab, and a browser cannot open a file
manager. The backend can, the same way ``launcher.py`` already opens the browser
tab, so "where are my files" is answered by the OS's own window instead of by a
path the analyst has to copy out of Settings by hand.

Two kinds of caller reach this, and each has its own guard. Most routes name
*what* to show — a case, the workspace, the notes export folder — and resolve the
path themselves, so there is nothing to traverse out of. One route takes a path
the analyst pointed at (`POST /cases/{id}/media/reveal`); there the path is bounded
and run through `Case.resolve_inside`, which resolves it and refuses anything
landing outside the case, before it ever arrives here. The containment check below
is the belt on top of both.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from .. import config


class RevealError(Exception):
    """The folder can't be shown, with a reason fit to put in front of a user."""


def _has_desktop_session() -> bool:
    """Whether this Linux/BSD process has a graphical session to open into.

    Azimut over SSH or as a service has none, and `xdg-open` there fails quietly.
    Windows and macOS always have one, so this is only asked of the rest.
    """
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def _within_workspace(target: Path) -> bool:
    try:
        target.relative_to(config.workspace_root().expanduser().resolve())
    except ValueError:
        return False
    return True


def reveal(path: Path, *, workspace_only: bool = True) -> None:
    """Open ``path`` in Explorer, Finder or the Linux desktop's file manager.

    Raises :class:`RevealError` for a folder outside the workspace, a folder that
    isn't there, or a Linux box with no ``xdg-open`` — a headless server being the
    one place this genuinely cannot work.

    ``workspace_only=False`` is for the one folder that is legitimately elsewhere:
    an export destination the analyst browsed to and Azimut saved. The caller
    resolves it from settings, never from the request, so opening it still shows
    a folder the app chose.
    """
    target = Path(path).expanduser().resolve()
    if workspace_only and not _within_workspace(target):
        raise RevealError("that folder is outside the workspace")
    if not target.is_dir():
        raise RevealError("that folder no longer exists")

    if sys.platform == "win32":
        try:
            # The stdlib shell-open: no command line is built, so a folder name
            # holding spaces or an ampersand needs no quoting.
            os.startfile(target)
        except OSError as exc:
            raise RevealError(f"Windows could not open that folder ({exc})") from None
        return

    if sys.platform != "darwin" and not _has_desktop_session():
        # xdg-open on a headless box exits without opening anything, and with
        # stderr silenced the UI would report success that never happened.
        raise RevealError("no desktop session to open a file manager in")

    opener = "open" if sys.platform == "darwin" else "xdg-open"
    try:
        # A fixed argv, never a shell. Detached and silenced: the file manager
        # outlives the request, and its chatter goes nowhere anyone reads.
        subprocess.Popen(
            [opener, str(target)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except FileNotFoundError:
        raise RevealError(f"no file manager found ({opener} is missing)") from None
