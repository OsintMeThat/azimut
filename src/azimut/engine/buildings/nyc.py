"""New York City's buildings from the city's own footprints, read tile by tile from NYC Open Data.

The city keeps a footprint for every building of the five boroughs, each with the
height of its roof above the ground (`height_roof`) measured off its aerial
surveys, and the day the record was last edited. The dataset (`5zhs-2jue`) is
served key-less by the city's Socrata portal, so a tile is one query for the
footprints that touch its box. Heights are in feet; zero or none means the
survey has none.

Like the IGN's, footprints across the tile edge come back for both tiles and are
not clipped: the view draws, over each tile, only the part on it.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any

import httpx

from .. import tiles
from . import model
from .ign import polygons, rings_of
from .model import Building, BuildingsUnavailable

SOURCE = "nyc"
LABEL = "NYC Building Footprints"
LICENCE = "NYC Open Data terms of use"
LINK = "https://data.cityofnewyork.us/d/5zhs-2jue"

URL = "https://data.cityofnewyork.us/resource/5zhs-2jue.geojson"
TIMEOUT = 60.0
PAGE = 50_000
FOOT = 0.3048
# The five boroughs, a little generous
BOUNDS = (-74.27, 40.49, -73.69, 40.92)

_client_lock = threading.Lock()
_client_instance: httpx.Client | None = None


def covers(z: int, x: int, y: int) -> bool:
    west, south, east, north = model.tile_bounds(z, x, y)
    return west < BOUNDS[2] and east > BOUNDS[0] and south < BOUNDS[3] and north > BOUNDS[1]


def fetch_tile(z: int, x: int, y: int) -> list[Building]:
    """Every footprint the city keeps that touches one z14 tile, with its measured height."""
    if z != model.ZOOM:
        raise ValueError(f"New York's buildings are read at zoom {model.ZOOM}, not {z}")
    west, south, east, north = model.tile_bounds(z, x, y)
    buildings: list[Building] = []
    offset = 0
    while True:
        features = _page(west, south, east, north, offset)
        for feature in features:
            buildings.extend(_buildings(feature))
        if len(features) < PAGE:
            return buildings
        offset += len(features)


def _page(west: float, south: float, east: float, north: float, offset: int) -> list[Any]:
    query = {
        # the box from its north-west corner to its south-east one
        "$where": f"within_box(the_geom, {north}, {west}, {south}, {east})",
        "$select": "the_geom,height_roof,last_edited_date",
        "$order": "bin",
        "$limit": str(PAGE),
        "$offset": str(offset),
    }
    for attempt in range(1, tiles.MAX_TILE_TRIES + 1):
        last = attempt == tiles.MAX_TILE_TRIES
        try:
            response = _client().get(URL, params=query)
        except httpx.HTTPError as exc:
            if last:
                raise _unavailable(tiles.upstream_failure(exc)) from exc
            continue
        if response.status_code in tiles.TRANSIENT_STATUSES and not last:
            time.sleep(tiles.RETRY_PAUSE)
            continue
        if response.status_code != 200:
            raise _unavailable(f"the city answered {response.status_code}")
        try:
            data = json.loads(response.content)
        except ValueError as exc:
            raise _unavailable("the city sent something other than GeoJSON") from exc
        if not isinstance(data, dict) or not isinstance(data.get("features"), list):
            raise _unavailable("the city sent a GeoJSON without features")
        return data["features"]
    raise AssertionError("unreachable")  # the loop returns or raises on its last turn


def _client() -> httpx.Client:
    global _client_instance
    with _client_lock:
        if _client_instance is None:
            _client_instance = httpx.Client(
                follow_redirects=True, timeout=TIMEOUT, headers={"User-Agent": tiles.USER_AGENT},
            )
        return _client_instance


def _unavailable(reason: str) -> BuildingsUnavailable:
    return BuildingsUnavailable(f"New York's buildings could not be read just now ({reason})")


def _buildings(feature: object) -> list[Building]:
    if not isinstance(feature, dict):
        return []
    props = feature.get("properties")
    if not isinstance(props, dict):
        return []
    try:
        height = model.clean_height(float(props.get("height_roof")) * FOOT)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        height = None
    edited = props.get("last_edited_date")
    date = edited[:10] if isinstance(edited, str) else ""
    out = []
    for polygon in polygons(feature.get("geometry")):
        rings = rings_of(polygon)
        if rings is None:
            continue
        building = Building(
            rings=rings, height=height, kind="measured" if height is not None else "unknown",
            source=SOURCE, date=date,
        )
        if model.footprint_area(building) >= model.MIN_AREA:
            out.append(building)
    return out
