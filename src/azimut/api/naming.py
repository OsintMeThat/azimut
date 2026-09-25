"""Naming rules shared by everything the analyst saves under a name.

Collages, proofs, post drafts and satellite grids all turn a free-text
title into the filename that holds it. They must agree: a collage and a proof
called "Rooftop angle" land on the same stem, and the frontend mirrors this in
``lib/naming.js`` so it can predict a collision before it posts.

`slugify` and its length cap live in `layout.py` with the rest of the path
budget: how a name becomes a path, and how long it may be, are facts about the
case folder's shape.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..layout import MAX_SLUG, slugify

__all__ = ["MAX_SLUG", "slugify", "read_created_at", "holders", "case_only"]


def holders(folder: Path, name: str, *, source: str | None = None) -> list[str]:
    """The stems in `folder` that Windows and macOS would take for `name`.

    Compared without case: Linux keeps `Harbour` beside `harbour`, the other two
    systems see one file, and a bundle refuses the pair, so the stricter rule is
    the one a name answers to. `source` is the stem the save starts from, which
    never collides with itself, a change of case included.
    """
    if not folder.is_dir():
        return []
    folded = name.casefold()
    return [
        path.stem
        for path in folder.glob("*.json")
        if path.stem.casefold() == folded and path.stem != source
    ]


def case_only(old: str | None, new: str) -> bool:
    """Whether a rename changes only the case, which is one file on Windows and macOS."""
    return old is not None and old != new and old.casefold() == new.casefold()


def read_created_at(path: Path) -> str | None:
    """``created_at`` already on disk at ``path``, or None if it isn't readable.

    A save rewrites the spec from what the client holds, and the client does not
    carry the birth date. Reading it back keeps "created" meaning created —
    including across a rename, where ``path`` is the file about to be moved.
    """
    try:
        data: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    stamp = data.get("created_at") if isinstance(data, dict) else None
    return stamp if isinstance(stamp, str) else None
