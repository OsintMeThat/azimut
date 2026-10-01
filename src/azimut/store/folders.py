"""The case's folder list, kept whole whichever door a folder came in by.

A folder used to exist only when `POST /folders` wrote it. Filing an item into a
name typed in a save dialog set `attrs.folder` and nothing else, so the folder
showed in Files (which builds its tree from the items it loaded) and nowhere a
folder is picked (which reads this list). Every entity write now registers the
folder it carries, and the list also reads the folders items already sit in, so
a case filed before this rule shows them too.
"""

from __future__ import annotations

import sqlite3


def ancestors(path: str) -> list[str]:
    """The path and every folder above it, outermost first."""
    segments = [segment for segment in path.split("/") if segment]
    return ["/".join(segments[: i + 1]) for i in range(len(segments))]


def register(conn: sqlite3.Connection, folder: str | None) -> None:
    """Make sure the folder an entity is filed under, and its parents, are listed."""
    if not folder:
        return
    for path in ancestors(folder):
        conn.execute("INSERT OR IGNORE INTO folders(path) VALUES(?)", (path,))


def listed(conn: sqlite3.Connection) -> list[str]:
    """Every folder: the registered ones, plus any an entity is filed under."""
    paths = {row["path"] for row in conn.execute("SELECT path FROM folders")}
    for row in conn.execute("SELECT DISTINCT folder FROM entities WHERE folder IS NOT NULL"):
        paths.update(ancestors(row["folder"]))
    return sorted(paths, key=str.casefold)


def in_subtree(folder: str | None, root: str) -> bool:
    """Whether `folder` is `root` or sits somewhere under it."""
    return bool(folder) and (folder == root or str(folder).startswith(root + "/"))


def moved(folder: str, old: str, new: str) -> str:
    """Where `folder` lands when `old` is renamed to `new`."""
    return new + folder[len(old):]
