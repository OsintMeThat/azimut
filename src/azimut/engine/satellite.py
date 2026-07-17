"""Satellite captures and their one-to-one ``capture`` entities.

A capture is a satellite imagery crop. It is filed through the *media* pipeline
(:mod:`azimut.engine.media`) so it lives in ``<case>/media/`` alongside every
other image — hashed, thumbnailed, listed in the Media Library and openable in
Inspect — but it is registered under a ``capture`` entity (not ``media``) that
carries the crop's coordinates/zoom/bearing. Its media sidecar's ``source`` dict
holds the full capture provenance (provider, attribution, acquisition, …) with
``type == "satellite"``, which is how a capture is told apart from an ordinary
media item both here and in the Media Library facet.

Because a capture *is* a media item, all of its lifecycle (list/patch/delete)
funnels through the media engine; this module only adds the satellite-flavoured
listing view the Satellite tool's "Saved › Captures" panel consumes.
"""

from __future__ import annotations

from typing import Any

from ..workspace import Case
from . import coords as coords_engine
from . import media as media_engine


def coords_label(lat: float, lon: float, fmt: str | None = None) -> str:
    """Default capture title / place label: the point's coordinates, written in
    the user's coordinate format (Settings → Preferences).

    Only *new* labels are minted here — a title already stored keeps whatever it
    was named, so switching format never rewrites the case's existing titles.
    Machine-readable fields (``lat``/``lon``, the ``coords`` attribute) stay in
    decimal degrees regardless.
    """
    return coords_engine.format_coords(lat, lon, fmt)


def is_capture(item: dict[str, Any]) -> bool:
    """True if a media listing item is a capture: a satellite crop, or an
    external-map screenshot filed by the capture extension (api/ingest.py) —
    the latter rides the same panel so its coordinates stay one click away."""
    return (item.get("source") or {}).get("type") in ("satellite", "screenshot")


def list_captures(case: Case) -> list[dict[str, Any]]:
    """The case's satellite captures, newest first, flattened for the UI.

    Each item merges the capture provenance (from the media sidecar's
    ``source``: provider, zoom, bearing, coordinates, acquisition date, …) with
    the media item's own fields (path, title, notes, thumbnail), so the Satellite
    panel keeps rendering exactly the fields it did when captures had their own
    store.
    """
    captures: list[dict[str, Any]] = []
    for item in media_engine.list_media(case):
        if not is_capture(item):
            continue
        source = item.get("source") or {}
        merged = {**source, **item}  # media fields (title/notes/path) win
        lat, lon = merged.get("lat"), merged.get("lon")
        if not merged.get("title") and lat is not None and lon is not None:
            merged["title"] = coords_label(lat, lon)
        captures.append(merged)
    captures.sort(key=lambda d: d.get("fetched_at") or d.get("added_at") or "", reverse=True)
    return captures
