"""A saved comparison as saved work: where it stands, and the images kept from it.

A comparison is imagery of one point at two dates, which is what a capture is at
one, so the Saved panel lists it beside the captures. Its row is the comparison
and not each image made from it: five exports of one pair are five files on one
metre, and five marks there would bury the rest of the map.

**Where it stands** is read off the reading the session saved: the export frame's
centre when one was drawn, since that is the ground it was about, else the centre
of the view. The frame itself is kept as a footprint, so the map draws the ground
the images show. It is written on the `compare-session` entity at every save, and
on sessions saved before once, when a case opens at schema 11.

**An image kept in the case** is a media file stamped with the reading it shows
and never replaced, unlike the session's preview, which each save redraws. Both
point at their session through `compare_session` on the entity and `session` in
the sidecar; a kept one also says `kept`, and the row lists those.
"""

from __future__ import annotations

import json
import math
from typing import TYPE_CHECKING, Any

from .. import layout
from . import media as media_engine

if TYPE_CHECKING:
    from ..workspace import Case


EARTH_RADIUS = 6378137.0
MAX_LAT = 85.0511287798066

#: The entity attribute that names the comparison an image was made from.
SESSION_ATTR = "compare_session"


def _to_mercator(lon: float, lat: float) -> tuple[float, float]:
    clamped = max(-MAX_LAT, min(MAX_LAT, lat))
    return (EARTH_RADIUS * math.radians(lon),
            EARTH_RADIUS * math.log(math.tan(math.pi / 4 + math.radians(clamped) / 2)))


def _from_mercator(x: float, y: float) -> tuple[float, float]:
    return (math.degrees(x / EARTH_RADIUS),
            math.degrees(2 * math.atan(math.exp(y / EARTH_RADIUS)) - math.pi / 2))


def frame_ring(frame: dict[str, Any]) -> tuple[tuple[float, float], list[list[float]]]:
    """The centre and closed corner ring of an export frame, as `[lon, lat]`.

    The frame is two opposite ground corners and the compass direction that was up
    when it was drawn; its sides run along that turned screen. The same arithmetic
    as `turnedBox` in `lib/map/groundFrame.js`, in Web Mercator.
    """
    (lon1, lat1), (lon2, lat2) = frame["points"]
    px, py = _to_mercator(lon1, lat1)
    qx, qy = _to_mercator(lon2, lat2)
    turn = math.radians(float(frame.get("angle") or 0))
    right = (math.cos(turn), -math.sin(turn))
    down = (-math.sin(turn), -math.cos(turn))
    cx, cy = (px + qx) / 2, (py + qy) / 2
    dx, dy = qx - px, qy - py
    width = dx * right[0] + dy * right[1]
    height = dx * down[0] + dy * down[1]
    ring = []
    for s, t in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5), (-0.5, -0.5)):
        lon, lat = _from_mercator(cx + s * width * right[0] + t * height * down[0],
                                  cy + s * width * right[1] + t * height * down[1])
        ring.append([round(lon, 7), round(lat, 7)])
    centre = _from_mercator(cx, cy)
    return (round(centre[0], 7), round(centre[1], 7)), ring


def placement(spec: dict[str, Any]) -> dict[str, Any]:
    """Where a comparison stands on the map, from the reading it saved.

    `footprint` is None when no frame was drawn, so a frame taken off by a later
    save is taken off the map too.
    """
    camera = spec.get("camera") or {}
    frame = spec.get("frame")
    footprint: dict[str, Any] | None = None
    if isinstance(frame, dict) and frame.get("points"):
        (lon, lat), ring = frame_ring(frame)
        footprint = {"type": "Polygon", "coordinates": [ring]}
    else:
        lon, lat = float(camera.get("lon", 0)), float(camera.get("lat", 0))
    return {"lat": lat, "lon": lon, "zoom": camera.get("zoom"),
            "bearing": camera.get("bearing", 0), "footprint": footprint}


def moved(attrs: dict[str, Any], placed: dict[str, Any]) -> bool:
    """Whether a save put the comparison somewhere its geography no longer covers.

    Panning is part of reading a pair, so nearly every save moves the camera a
    little. A country lookup is paced and costs a second of the save, so it is
    asked again only past about a kilometre.
    """
    if not isinstance(attrs.get("geo"), dict) or attrs.get("lat") is None:
        return True
    return (abs(float(attrs["lat"]) - placed["lat"]) > 0.01
            or abs(float(attrs["lon"]) - placed["lon"]) > 0.01)


def follow_rename(case: Case, old_rel: str, new_rel: str) -> None:
    """Point every image made from a renamed comparison at its new name, on its
    entity and in its sidecar, which is what the Saved panel groups by."""
    found: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        page = case.page_entities(limit=200, cursor=cursor, types=["media"],
                                  attr=SESSION_ATTR, attr_value=old_rel)
        found.extend(page["items"])
        cursor = page.get("next_cursor")
        if not cursor:
            break
    for entity in found:
        case.update_entity(entity["id"], {"attrs": {SESSION_ATTR: new_rel}})
        path = str((entity.get("attrs") or {}).get("path") or "")
        item = media_engine.read_item(case, path) if path else None
        if item and isinstance(item.get("source"), dict):
            media_engine.merge_item(case, path, {"source": {**item["source"], "session": new_rel}})


def grouped(items: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """The case's comparison images, read off one media listing: every one by its
    path (a session's preview is found there), and the kept ones by session, in
    the order they were kept."""
    by_path: dict[str, dict[str, Any]] = {}
    kept: dict[str, list[dict[str, Any]]] = {}
    for item in sorted(items, key=lambda entry: (str(entry.get("added_at") or ""), entry["path"])):
        source = item.get("source") or {}
        if source.get("type") != "compare":
            continue
        by_path[item["path"]] = item
        if source.get("kept") and source.get("session"):
            kept.setdefault(source["session"], []).append(
                {"path": item["path"], "title": item.get("title") or "",
                 "thumbnail": item.get("thumbnail")})
    return by_path, kept


def backfill(case: Case) -> int:
    """Place every comparison saved before comparisons stood on the map.

    Their geography is left for the Locate pass, which works through whatever has
    none: a migration must not wait on a geocoder.
    """
    placed = 0
    for entity in case.list_entities():
        if entity.get("type") != "compare-session":
            continue
        attrs = entity.get("attrs") or {}
        if attrs.get("lat") is not None:
            continue
        rel = str(attrs.get("spec") or "")
        try:
            saved = json.loads(case.resolve_inside(rel).read_text(encoding="utf-8"))
            point = placement(saved.get("spec") or {})
        except (OSError, ValueError, KeyError, TypeError):
            continue
        case.update_entity(entity["id"], {"attrs": point})
        placed += 1
    return placed


def session_name(spec_rel: str) -> str:
    """The name Compare opens a session by, from where its spec is kept."""
    prefix = f"{layout.COMPARE_DIR}/"
    stem = spec_rel[len(prefix):] if spec_rel.startswith(prefix) else spec_rel
    return stem.removesuffix(".json")
