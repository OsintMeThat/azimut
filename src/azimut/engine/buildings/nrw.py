"""North Rhine-Westphalia's buildings from the state's LoD2 model, read tile by tile.

Geobasis NRW models every building of the state from airborne lidar and the
cadastre (LoD2: walls, roof faces, the ground face), each part with the height
it measured (`measuredHeight`, ground to the top of the roof) and the day it was
made. The state serves it key-less as an OGC API in CityJSON, under the
Datenlizenz Deutschland Zero 2.0, so a tile is one bounding-box query read a
page of a thousand at a time, following the server's `next` link.

A footprint is a part's ground face (`GroundSurface`). Footprints across the
tile edge come back for both tiles and are not clipped, as with the IGN's.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any

import httpx

from .. import tiles
from . import model
from .model import Building, BuildingsUnavailable, Point, Ring

SOURCE = "nrw"
LABEL = "LoD2 (NRW, Germany)"
LICENCE = "Datenlizenz Deutschland Zero 2.0"
LINK = "https://ogc-api.nrw.de/3dg/v1/"

ITEMS = "https://ogc-api.nrw.de/3dg/v1/collections/building/items"
# A page of a thousand buildings takes the state's server about five seconds.
TIMEOUT = 90.0
PAGE = 1000
# A dense city tile holds a few thousand: more pages than this is a server looping.
MAX_PAGES = 40
# The state's own extent, a little generous; the neighbours' tiles it takes in answer nothing.
BOUNDS = (5.75, 50.30, 9.47, 52.54)

_client_lock = threading.Lock()
_client_instance: httpx.Client | None = None


def covers(z: int, x: int, y: int) -> bool:
    west, south, east, north = model.tile_bounds(z, x, y)
    return west < BOUNDS[2] and east > BOUNDS[0] and south < BOUNDS[3] and north > BOUNDS[1]


def fetch_tile(z: int, x: int, y: int) -> list[Building]:
    """Every building part of the state's model that touches one z14 tile, with its measured height.

    Pages are read as CityJSON text sequences, a building a line. The server
    cannot write a few buildings: partway through a page it stops before one,
    the same way every time, and a page that would start with it is refused
    (400) or comes back empty, as a page past the last building does. So a page
    shorter than asked is read on from the building it stopped before, stepping
    over that one if its own page fails; a second failure in a row is the end.
    """
    if z != model.ZOOM:
        raise ValueError(f"NRW's buildings are read at zoom {model.ZOOM}, not {z}")
    west, south, east, north = model.tile_bounds(z, x, y)
    box = f"{west},{south},{east},{north}"
    buildings: list[Building] = []
    offset = 0
    short = stepped = False
    for _ in range(MAX_PAGES):
        documents = _page(f"{ITEMS}?bbox={box}&limit={PAGE}&offset={offset}&f=cityjsonseq", past_end_ok=short)
        if not documents:
            if short and not stepped:
                offset, stepped = offset + 1, True
                continue
            return buildings
        for document in documents:
            buildings.extend(read_cityjson(document))
        short, stepped = len(documents) < PAGE, False
        offset += len(documents)
    raise _unavailable("the state's server kept sending more pages")


def _page(url: str, past_end_ok: bool = False) -> list[dict[str, Any]] | None:
    """One page's buildings, each a CityJSON document of its own; None for a page past the
    last building when `past_end_ok` (the server refuses it with a 400)."""
    for attempt in range(1, tiles.MAX_TILE_TRIES + 1):
        last = attempt == tiles.MAX_TILE_TRIES
        try:
            response = _client().get(url)
        except httpx.HTTPError as exc:
            if last:
                raise _unavailable(tiles.upstream_failure(exc)) from exc
            continue
        if response.status_code in tiles.TRANSIENT_STATUSES and not last:
            time.sleep(tiles.RETRY_PAUSE)
            continue
        if response.status_code == 400 and past_end_ok:
            return None
        if response.status_code != 200:
            raise _unavailable(f"the state's server answered {response.status_code}")
        return read_sequence(response.content)
    raise AssertionError("unreachable")  # the loop returns or raises on its last turn


def read_sequence(body: bytes) -> list[dict[str, Any]]:
    """A CityJSON text sequence as one document per building, each with the header's transform.

    A line cut short ends the sequence there."""
    lines = iter(body.splitlines())
    try:
        header = json.loads(next(lines))
    except (StopIteration, ValueError) as exc:
        raise _unavailable("the state's server sent something other than CityJSON") from exc
    if not isinstance(header, dict) or header.get("type") != "CityJSON":
        raise _unavailable("the state's server sent something other than CityJSON")
    documents = []
    for line in lines:
        if not line.strip():
            continue
        try:
            feature = json.loads(line)
        except ValueError:
            break
        if isinstance(feature, dict) and feature.get("type") == "CityJSONFeature":
            documents.append({**feature, "transform": header.get("transform")})
    return documents


def _client() -> httpx.Client:
    global _client_instance
    with _client_lock:
        if _client_instance is None:
            _client_instance = httpx.Client(
                follow_redirects=True, timeout=TIMEOUT, headers={"User-Agent": tiles.USER_AGENT},
            )
        return _client_instance


def _unavailable(reason: str) -> BuildingsUnavailable:
    return BuildingsUnavailable(f"NRW's buildings could not be read just now ({reason})")


# -- one CityJSON page ----------------------------------------------------------------


def read_cityjson(document: dict[str, Any]) -> list[Building]:
    """The footprints of a CityJSON document's buildings: each part's ground faces, with its height."""
    objects = document.get("CityObjects")
    vertices = document.get("vertices")
    if not isinstance(objects, dict) or not isinstance(vertices, list):
        return []
    transform = document.get("transform") or {}
    scale = transform.get("scale") or [1.0, 1.0, 1.0]
    shift = transform.get("translate") or [0.0, 0.0, 0.0]

    def point(index: int) -> tuple[float, float, float]:
        v = vertices[index]
        return v[0] * scale[0] + shift[0], v[1] * scale[1] + shift[1], v[2] * scale[2] + shift[2]

    out = []
    for item in objects.values():
        if not isinstance(item, dict) or item.get("type") not in ("Building", "BuildingPart"):
            continue
        attributes = item.get("attributes") or {}
        date = attributes.get("creationDate")
        date = date[:10] if isinstance(date, str) else ""
        for geometry in item.get("geometry") or ():
            try:
                grounds, top = _ground_faces(geometry, point)
            except (IndexError, KeyError, TypeError, ValueError):
                continue
            if not grounds:
                continue
            floor = min(z for face in grounds for ring in face for _x, _y, z in ring)
            height = model.clean_height(attributes.get("measuredHeight")) or model.clean_height(top - floor)
            for face in grounds:
                rings = tuple(r for r in (_flat(ring) for ring in face) if r is not None)
                if not rings or len(rings[0]) < 3:
                    continue
                building = Building(
                    rings=rings, height=height, kind="measured" if height is not None else "unknown",
                    source=SOURCE, date=date,
                )
                if model.footprint_area(building) >= model.MIN_AREA:
                    out.append(building)
            break  # one geometry per part: the first that has a ground face
    return out


def _ground_faces(geometry: dict[str, Any], point: Any) -> tuple[list[list[list[tuple[float, float, float]]]], float]:
    """A geometry's ground faces as rings of (lon, lat, height), and its highest point."""
    kind = geometry.get("type")
    boundaries = geometry["boundaries"]
    values = (geometry.get("semantics") or {}).get("values")
    surfaces = (geometry.get("semantics") or {}).get("surfaces") or []
    if kind == "Solid":
        faces = boundaries[0]  # the outer shell
        labels = values[0] if values else None
    elif kind in ("MultiSurface", "CompositeSurface"):
        faces, labels = boundaries, values
    else:
        return [], 0.0
    top = max(point(i)[2] for face in faces for ring in face for i in ring)
    grounds = []
    for n, face in enumerate(faces):
        label = labels[n] if labels is not None and n < len(labels) else None
        if label is None or surfaces[label].get("type") != "GroundSurface":
            continue
        grounds.append([[point(i) for i in ring] for ring in face])
    return grounds, top


def _flat(ring: list[tuple[float, float, float]]) -> Ring | None:
    points: list[Point] = [(x, y) for x, y, _z in ring]
    if len(points) > 1 and points[0] == points[-1]:
        points.pop()
    return tuple(points) if len(set(points)) >= 3 else None
