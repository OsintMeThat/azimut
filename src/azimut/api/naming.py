"""Naming rules shared by everything the analyst saves under a name.

Inspect sessions, proofs, post drafts and satellite grids all turn a free-text
title into the filename that holds it. They must agree: a session and a proof
called "Rooftop angle" land on the same stem, and the frontend mirrors this in
``lib/naming.js`` so it can predict a collision before it posts.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

# Long enough to stay readable, short enough that the path survives Windows'
# 260-character limit under a deep workspace root.
MAX_SLUG = 80


def slugify(text: str | None, fallback: str) -> str:
    """URL- and filesystem-safe stem from free text.

    Everything outside ``[a-z0-9]`` collapses to a single dash, so accents and
    punctuation drop out rather than reaching the filesystem. Text that leaves
    nothing behind ("!!!", "") falls back to the caller's word.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug[:MAX_SLUG] or fallback


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
