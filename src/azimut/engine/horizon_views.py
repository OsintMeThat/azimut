"""A saved Horizon view as saved work: where it stands, what it faces, and the images kept from it.

A view is an eye standing on a point and looking one way through one lens, with
the picture it was read with and, often, a photo or a video laid over it and
matched. It says where a picture was taken from, so the Saved panel lists it
beside the captures and the comparisons, and the map draws it as its eye and
the cone of its lens.

**Where it stands** is the eye; the cone is its heading and its lens. The
ground the view took in, out to the skyline, is kept as a footprint the browser
read off the turn it marched, and the map draws it when the view is picked.

**An image kept in the case** is a media file stamped with the view it shows and
never replaced, as a comparison's is (`engine/comparisons.py`): it points at its
view through `horizon_view` on the entity and `view` in the sidecar. The view's
own picture in the lists is a small preview beside its spec
(`layout.horizon_thumb_rel`), which the browser draws at each save.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .. import layout
from . import comparisons

if TYPE_CHECKING:
    from ..workspace import Case


TYPE = "horizon-view"
#: What an image made from a view records as its producer.
SOURCE_TYPE = "horizon"
#: The entity attribute, and the sidecar key, that name the view an image was made from.
VIEW_ATTR = "horizon_view"
VIEW_KEY = "view"
#: How close the map comes to a view it opens: the eye and the near ground of its cone.
ZOOM = 13


def placement(spec: dict[str, Any], footprint: list[list[float]] | None) -> dict[str, Any]:
    """Where a view stands on the map, and what it faces, from the view it saved.

    `footprint` is None when the browser had no turn to read it off, so a view
    saved again without one is drawn as its cone alone.
    """
    eye = spec["eye"]
    look = spec["look"]
    ring = [list(point) for point in footprint] if footprint else None
    if ring and ring[0] != ring[-1]:
        ring.append(list(ring[0]))
    return {
        "lat": eye["lat"],
        "lon": eye["lon"],
        "zoom": ZOOM,
        # the map opens a view facing the way it looked: the app turns a map
        # clockwise, so a heading is up at the same turn counted the other way
        "bearing": (360 - look["heading"]) % 360,
        "heading": look["heading"],
        "fov": look["fov"],
        "projection": look["projection"],
        "footprint": {"type": "Polygon", "coordinates": [ring]} if ring else None,
    }


def follow_rename(case: Case, old_rel: str, new_rel: str) -> None:
    """Point every image kept from a renamed view at its new name."""
    comparisons.follow_rename(case, old_rel, new_rel, attr=VIEW_ATTR, key=VIEW_KEY)


def grouped(items: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """The images kept from the case's views, by view, in the order they were kept."""
    return comparisons.grouped(items, SOURCE_TYPE, key=VIEW_KEY)[1]


def view_name(spec_rel: str) -> str:
    """The name Horizon opens a view by, from where its spec is kept."""
    prefix = f"{layout.HORIZON_DIR}/"
    stem = spec_rel[len(prefix):] if spec_rel.startswith(prefix) else spec_rel
    return stem.removesuffix(".json")
