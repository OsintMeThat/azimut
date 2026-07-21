"""Read the full case graph in-process, for test assertions.

The case-open HTTP response no longer ships the entity/link arrays (Step 5 of
docs/STORAGE_AND_PERFORMANCE.md): production reads them through the bounded
catalog endpoints (`/catalog/entities`, `/entities/lookup`, `/entities/{id}/chain`
and `/derivation`). Tests that assert on the whole graph inspect the store
directly here rather than the open payload — allowed, since tests may inspect
fixtures and internal state, and it keeps a links-list route (which no UI would
call) out of the product surface.
"""

from __future__ import annotations

from typing import Any

from azimut.workspace import Case


def entities(cid: str, **attrs: Any) -> list[dict[str, Any]]:
    """Every entity in the case, or those whose ``attrs`` match all ``attrs``."""
    rows = Case.open(cid).snapshot()["entities"]
    if not attrs:
        return rows
    return [e for e in rows if all(e.get("attrs", {}).get(k) == v for k, v in attrs.items())]


def entity(cid: str, **attrs: Any) -> dict[str, Any] | None:
    """The first entity whose ``attrs`` match, e.g. ``entity(cid, path='media/a.png')``."""
    matches = entities(cid, **attrs)
    return matches[0] if matches else None


def links(cid: str, type_: str | None = None) -> list[dict[str, Any]]:
    """Every link in the case, optionally filtered to one type."""
    rows = Case.open(cid).snapshot()["links"]
    return [lk for lk in rows if type_ is None or lk["type"] == type_]
