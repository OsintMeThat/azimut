"""France's buildings from the IGN's BD TOPO, read tile by tile through the Géoplateforme.

BD TOPO is the national topographic database, and its `batiment` layer carries
what the other sources only guess at: a height the IGN measured for most of the
footprints it draws (`hauteur`, in metres), and the date each one was last
checked (`date_modification`, `date_creation`). The data is served by the
Géoplateforme's WFS, key-less, under the Licence Ouverte 2.0, so a tile is one
GetFeature request for the box it covers, read a page of 5000 at a time.

Footprints that cross the tile edge come back for both neighbouring tiles. That
is expected and not clipped: the view draws, over each tile, only the part of a
building that stands on it.
Planned buildings (`En projet`) are skipped; ruins and buildings under
construction are kept, since they still stand or are being raised.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from .. import tiles
from . import model
from .model import Building, BuildingsUnavailable, Point, Ring

SOURCE = "ign"
LABEL = "BD TOPO® (IGN)"
LICENCE = "Licence Ouverte 2.0"
LINK = "https://geoservices.ign.fr/bdtopo"

WFS = "https://data.geopf.fr/wfs/ows"
TYPENAME = "BDTOPO_V3:batiment"
# The Géoplateforme answers a whole page in a few seconds; a dense city tile
# (about 4000 footprints) is the slow end of that.
TIMEOUT = 60.0
PAGE = 5000
PROPERTIES = ("hauteur", "date_modification", "date_creation", "etat_de_l_objet", "geometrie")
PLANNED = "En projet"

# Where BD TOPO has buildings, as (west, south, east, north) boxes. Coarse on
# purpose: a box that misses a few kilometres of French ground would hide its
# buildings, so each is a little generous, and one that also takes in a slice of
# a neighbour (Spain, Belgium, Italy, Switzerland, Germany) answers True for that
# tile too. The WFS then answers with nothing there, which costs one request.
# Mainland France is split in several overlapping boxes so the Atlantic, the
# Channel and the Mediterranean are not all inside one box; together they leave
# no French ground out (tests/test_buildings_ign.py walks a city in each region).
_COVERAGE: tuple[tuple[float, float, float, float], ...] = (
    (-5.3, 46.2, 0.1, 49.0),  # Brittany, the Pays de la Loire, the Vendée
    (-2.1, 42.2, 3.4, 46.6),  # Atlantic coast to the Pyrenees and the Massif central
    (0.0, 45.9, 8.3, 49.0),  # the Centre, Burgundy, Champagne, Franche-Comté, southern Alsace
    (-2.1, 48.5, 8.3, 51.2),  # Normandy, Paris, the north, Lorraine, northern Alsace
    (3.0, 42.2, 7.9, 46.6),  # the Rhône valley, the Alps, Provence, the Côte d'Azur
    (8.5, 41.3, 9.6, 43.1),  # Corsica
    (-61.9, 15.8, -60.9, 16.6),  # Guadeloupe
    (-63.2, 17.8, -62.7, 18.2),  # Saint-Martin and Saint-Barthélemy
    (-61.3, 14.3, -60.7, 14.95),  # Martinique
    (-54.7, 1.9, -51.5, 5.9),  # Guyane
    (55.1, -21.5, 55.9, -20.8),  # La Réunion
    (44.9, -13.2, 45.4, -12.5),  # Mayotte
)

_client_lock = threading.Lock()
_client_instance: httpx.Client | None = None


def covers(z: int, x: int, y: int) -> bool:
    """True when the tile intersects France, overseas departments included."""
    west, south, east, north = model.tile_bounds(z, x, y)
    return any(
        west <= box_east and east >= box_west and south <= box_north and north >= box_south
        for box_west, box_south, box_east, box_north in _COVERAGE
    )


def fetch_tile(z: int, x: int, y: int) -> list[Building]:
    """Every BD TOPO building in one z14 tile that is standing, built, or being built."""
    if z != model.ZOOM:
        raise ValueError(f"the IGN's buildings are read at zoom {model.ZOOM}, not {z}")
    bounds = model.tile_bounds(z, x, y)
    buildings: list[Building] = []
    start = 0
    while True:
        status, body = _get(_url(bounds, start))
        if status != 200:
            raise _unavailable(f"the IGN answered {status}")
        data = _json(body)
        features = data["features"]
        for feature in features:
            buildings.extend(_buildings(feature))
        start += len(features)
        matched = data.get("numberMatched")
        # Stop at the count the service gives when it gives one (a server may cap a
        # page below what was asked); otherwise a short page is the last one.
        if isinstance(matched, int):
            if start >= matched or not features:
                break
        elif len(features) < PAGE:
            break
    return buildings


# -- the request --------------------------------------------------------------------


def _url(bounds: tuple[float, float, float, float], start: int) -> str:
    west, south, east, north = bounds
    query = urlencode({
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": TYPENAME,
        "OUTPUTFORMAT": "application/json",
        "SORTBY": "cleabs",
        "COUNT": PAGE,
        "STARTINDEX": start,
        # The WFS takes the box as south,west,north,east: latitude first.
        "BBOX": f"{south},{west},{north},{east},urn:ogc:def:crs:EPSG::4326",
        "PROPERTYNAME": ",".join(PROPERTIES),
    }, safe=",:")
    return f"{WFS}?{query}"


def _client() -> httpx.Client:
    global _client_instance
    with _client_lock:
        if _client_instance is None:
            _client_instance = httpx.Client(
                follow_redirects=True,
                timeout=TIMEOUT,
                headers={"User-Agent": tiles.USER_AGENT},
            )
        return _client_instance


def _get(url: str) -> tuple[int, bytes]:
    """Status and body of one GET, asked again on a transient failure."""
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
        return response.status_code, response.content
    raise AssertionError("unreachable")  # the loop returns or raises on its last turn


def _unavailable(reason: str) -> BuildingsUnavailable:
    return BuildingsUnavailable(f"The IGN's buildings could not be read just now ({reason})")


def _json(body: bytes) -> dict[str, Any]:
    try:
        data = json.loads(body)
    except ValueError as exc:
        raise _unavailable("the IGN sent something other than GeoJSON") from exc
    if not isinstance(data, dict) or not isinstance(data.get("features"), list):
        raise _unavailable("the IGN sent a GeoJSON without features")
    return data


# -- one feature -------------------------------------------------------------------


def _buildings(feature: object) -> list[Building]:
    """The buildings one feature stands for: a MultiPolygon is one per part."""
    if not isinstance(feature, dict):
        return []
    props = feature.get("properties")
    if not isinstance(props, dict) or _state(props) == PLANNED:
        return []
    height = model.clean_height(props.get("hauteur"))
    date = _date(props)
    out = []
    for polygon in polygons(feature.get("geometry")):
        rings = rings_of(polygon)
        if rings is None:
            continue
        building = Building(
            rings=rings,
            height=height,
            kind="measured" if height is not None else "unknown",
            source=SOURCE,
            date=date,
        )
        if model.footprint_area(building) >= model.MIN_AREA:
            out.append(building)
    return out


def _state(props: dict[str, Any]) -> str:
    return str(props.get("etat_de_l_objet") or "").strip()


def _date(props: dict[str, Any]) -> str:
    """The last time the IGN touched it, as a day: the modification, else the creation."""
    for key in ("date_modification", "date_creation"):
        value = props.get(key)
        if isinstance(value, str) and value:
            return value[:10]
    return ""


def polygons(geometry: object) -> list[Any]:
    """The polygons of a feature's geometry, each a list of rings (outer first)."""
    if not isinstance(geometry, dict):
        return []
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        return []
    if geometry.get("type") == "MultiPolygon":
        return coordinates
    if geometry.get("type") == "Polygon":
        return [coordinates]
    return []


def rings_of(polygon: object) -> tuple[Ring, ...] | None:
    """A polygon's outer ring and holes, or None when it has no usable outer ring."""
    if not isinstance(polygon, list):
        return None
    rings = [_ring(raw) for raw in polygon]
    if not rings or rings[0] is None:
        return None
    return (rings[0], *(hole for hole in rings[1:] if hole is not None))


def _ring(raw: object) -> Ring | None:
    """One ring as open (lon, lat) points, its height dropped; None when it is not a ring."""
    if not isinstance(raw, list):
        return None
    points: list[Point] = []
    for position in raw:
        try:
            points.append((float(position[0]), float(position[1])))
        except (TypeError, ValueError, IndexError):
            return None
    if len(points) > 1 and points[0] == points[-1]:
        points.pop()  # GeoJSON closes a ring with its first point; the model does not
    if len(set(points)) < 3:
        return None
    return tuple(points)
