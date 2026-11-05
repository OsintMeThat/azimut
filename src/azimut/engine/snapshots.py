"""A view filed once: the state a tool's picture was taken in, kept as one key.

A map view or a comparison put in a note is filed as an ordinary case picture.
Putting the same view in twice, or in two notes, must cite the picture already
filed rather than file a second copy of the same pixels, so each picture records
the state it was made from as ``view_key`` (in its sidecar's ``source`` and on its
entity, where the lookup reads it). Only the state that decides the pixels goes
in: what is shown, where, how big, and what is burned onto it.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from ..workspace import Case, CaseError

#: The attribute a filed picture carries its state under, on its entity and in its sidecar.
VIEW_KEY = "view_key"

#: Decimal places a number is compared at: a centre to about a decimetre, a zoom
#: and an angle well inside what changes a pixel.
_PLACES = {"lat": 6, "lon": 6, "marker_lat": 6, "marker_lon": 6, "zoom": 2, "bearing": 1, "pitch": 1}


def _settled(value: Any, places: int | None) -> Any:
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, float) or (places is not None and isinstance(value, int)):
        number = round(float(value), places if places is not None else 4)
        # -0.0 and 0.0 are one view
        return number + 0.0
    if isinstance(value, dict):
        return {key: _settled(inner, _PLACES.get(key)) for key, inner in value.items()}
    if isinstance(value, (list, tuple)):
        return [_settled(inner, None) for inner in value]
    return value


def view_key(kind: str, **state: Any) -> str:
    """One key for one state of one tool: equal states give equal keys."""
    settled = {key: _settled(value, _PLACES.get(key)) for key, value in state.items()}
    text = json.dumps({"kind": kind, **settled}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]


def filed_view(case: Case, key: str) -> dict[str, Any] | None:
    """The picture already filed for this state, while its file is still there."""
    entity = case.find_entity(attr=VIEW_KEY, value=key)
    if entity is None:
        return None
    path = (entity.get("attrs") or {}).get("path")
    if not path:
        return None
    try:
        if not case.resolve_inside(path).is_file():
            return None
    except CaseError:
        return None
    return entity
