"""Naming rules shared by everything the analyst saves under a name.

Inspect sessions, proofs, post drafts and satellite grids all turn a free-text
title into the filename that holds it. They must agree: a session and a proof
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

__all__ = ["MAX_SLUG", "slugify", "read_created_at"]


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
