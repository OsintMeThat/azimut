"""The work on Horizon's bench, kept in the case as it is made.

What the tab holds and nothing has saved yet: where the eye stands and how the
view is drawn, the photo laid over it with its trace and what is known about it,
Find's area, alignments and settings, the mode, and which saved view or search
is open. The browser writes it a moment after each change and reads it back when
the tab opens on a case: the tab opens on the map, and work no save keeps is
offered back with Resume.

It is one file per case, `.horizon/.work.json`, and not a document: no list
shows it, it is overwritten as the analyst works, and it is cleared when the
bench is empty. A bundle carries it with the rest of `.horizon/`. Saving a view
or running a search stays the analyst's act; this only keeps the bench.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from .. import layout
from .media import write_json_atomic

if TYPE_CHECKING:
    from ..workspace import Case

VERSION = 1


def read(case: Case) -> dict[str, Any] | None:
    """The bench as the case keeps it, or None."""
    from ..workspace import CaseError

    try:
        path = case.resolve_inside(layout.horizon_work_rel())
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (CaseError, OSError, ValueError):
        return None
    return saved if isinstance(saved, dict) and saved.get("azimut_horizon_work") == VERSION else None


def write(case: Case, work: dict[str, Any]) -> None:
    path = case.resolve_inside(layout.horizon_work_rel())
    path.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    write_json_atomic(path, {"azimut_horizon_work": VERSION, "updated_at": stamp, **work})


def clear(case: Case) -> bool:
    """Empty the bench; whether there was anything on it."""
    path = case.resolve_inside(layout.horizon_work_rel())
    try:
        path.unlink()
    except FileNotFoundError:
        return False
    return True
