"""An area, or a group of them, as a file one analyst hands to another.

Deliberately **not** a map file. GeoJSON and KML already have a road in and out
of the app (`maplayers` reads them, a detection snapshots to one), and that road
answers a different question: bringing a stranger's map in. This one answers
"take my ground, as I filed it" — the names, the colours and the folder they sit
in — and those survive no generic format. Since both ends are Azimut, nothing
arrives that the models would refuse: no triage screen, no "12 of 20 shapes
became areas", no vertex cap to explain.

Like `analyzershare`, the file is read as history rather than as a request, so a
build that wrote a field this one does not know still lands.
"""

from __future__ import annotations

import re
from typing import Any

from .. import __version__
from .analysis_models import Area, AreaGroup
from .analyzershare import free_name

#: What a shared area file says it is, so an import can tell one from an
#: analyzer, a settings backup or a case bundle and name what it was handed.
KIND = "azimut-areas"

#: The envelope's shape, not the areas'. They are read through their own models,
#: which is what lets two analysts on two builds trade ground.
VERSION = 1


def envelope(areas: list[dict[str, Any]], group: dict[str, Any] | None = None) -> dict[str, Any]:
    """The ground as it leaves this case.

    `id` travels only to join a group to its areas inside the file; the case
    that receives them mints its own. Order is the list's order, so no position
    is carried, and a group's `pending_review` stays behind: it is this case's
    bookkeeping about shapes that were redrawn here.
    """
    kept = [{"id": area["id"], "name": area["name"], "colour": area["colour"], "geometry": area["geometry"]}
            for area in areas]
    shared: dict[str, Any] = {"azimut": KIND, "version": VERSION, "app": __version__, "areas": kept, "groups": []}
    if group is not None:
        shared["groups"] = [{"title": group["title"], "area_ids": [area["id"] for area in kept]}]
    return shared


def filename(label: str) -> str:
    """A download name taken from the area or group's own, safe as a header value."""
    slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")[:60]
    return f"azimut-areas-{slug or 'ground'}.json"


def unknown_fields(raw: dict[str, Any]) -> list[str]:
    """Field names in a shared file that this version does not know.

    Dropping them in silence is right for the app's own history and wrong for a
    file from another machine, where a field a newer build wrote may be part of
    what the ground means.
    """
    known = set(Area.model_fields) | {"id"}
    found: set[str] = set()
    for area in raw.get("areas") or []:
        if isinstance(area, dict):
            found |= set(area) - known
    for group in raw.get("groups") or []:
        if isinstance(group, dict):
            found |= set(group) - set(AreaGroup.model_fields)
    return sorted(found)


__all__ = ["KIND", "VERSION", "envelope", "filename", "free_name", "unknown_fields"]
