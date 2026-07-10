"""Satellite captures on disk and their one-to-one sync with ``place`` entities.

A capture is an image plus a JSON sidecar under ``<case>/satellite/``:

    satellite/sat_<stamp>_z<zoom>_<provider>.png
    satellite/sat_<stamp>_z<zoom>_<provider>.png.json   # provenance (lat/lon/…)

Every capture is mirrored by exactly one ``capture`` entity in ``case.json``
(spec §3.5): one capture == one entity on the right. They are tied by the
capture's relative ``path``, stored on the entity as ``attrs.path`` — not by
coordinates, so two captures of the same point stay two independent entities.
The entity ``label`` is the capture title (coordinates by default, editable).
A capture is an *image* (its marker coordinates are recorded as info); saving a
bare ``place`` — a navigable point with no image — is a separate act.

Deleting in one place must delete in the other, so all delete paths funnel here:

* delete a capture        → drop the one ``capture`` entity that points at it;
* delete a ``capture`` row → drop the one capture file it points at (handled by
  the entities API via :func:`unlink_capture`).
"""

from __future__ import annotations

import json
from typing import Any

from ..workspace import Case


def coords_label(lat: float, lon: float) -> str:
    """Default capture title / place label: the point's coordinates."""
    return f"{lat:.6f}, {lon:.6f}"


def _read_sidecar(case: Case, rel_path: str) -> dict[str, Any] | None:
    image = case.resolve_inside(rel_path)
    sidecar = image.with_name(image.name + ".json")
    if not sidecar.exists():
        return None
    return json.loads(sidecar.read_text(encoding="utf-8"))


def list_captures(case: Case) -> list[dict[str, Any]]:
    sat_dir = case.subdir("satellite")
    captures: list[dict[str, Any]] = []
    for sidecar in sorted(sat_dir.glob("*.png.json")):
        image_name = sidecar.name[: -len(".json")]
        if not (sat_dir / image_name).exists():
            continue
        data = json.loads(sidecar.read_text(encoding="utf-8"))
        data["path"] = f"satellite/{image_name}"
        lat, lon = data.get("lat"), data.get("lon")
        if not data.get("title") and lat is not None and lon is not None:
            data["title"] = coords_label(lat, lon)
        captures.append(data)
    captures.sort(key=lambda d: d.get("fetched_at") or "", reverse=True)
    return captures


def unlink_capture(case: Case, rel_path: str) -> None:
    """Remove a capture's image + sidecar from disk (leaves entities alone)."""
    image = case.resolve_inside(rel_path)
    image.unlink(missing_ok=True)
    image.with_name(image.name + ".json").unlink(missing_ok=True)


def delete_capture(case: Case, rel_path: str) -> None:
    """Delete one capture and the single ``place`` entity mirroring it."""
    unlink_capture(case, rel_path)
    entity = case.find_entity(attr="path", value=rel_path)
    if entity:
        case.remove_entity(entity["id"])
