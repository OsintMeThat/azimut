"""Overture Maps' buildings, read tile by tile from the newest release's PMTiles archive.

Overture merges OpenStreetMap's footprints with the ones Google and Microsoft
traced off imagery by machine (Open Buildings, ML Buildings), so it draws the
houses OpenStreetMap has not mapped yet: 7,500 Microsoft footprints in a tile of
Taiz where OpenStreetMap has 27, 3,300 of Google's in a tile of Petare. Its
heights are OpenStreetMap's only, so most of those houses come without one and
take an estimate from the merge (Google's 2.5D, 3D-GloBFP).

Each monthly release is a new archive (`tiles.overturemaps.org/<release>/
buildings.pmtiles`) and old ones are taken down after a few months, so the
newest release is looked up in Overture's catalog, again every day, and again
at once when its archive stops answering. A z14 tile weighs 0.5 to 5 MB, more
than a view should fetch unasked, so the analyst says yes once per run of the
app (`service.allow`). Like OpenStreetMap's, each tile carries its neighbours'
footprints in its buffer, so every footprint is clipped to the tile's square.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Mapping

import httpx

from .. import mvt, pmtiles, tiles
from . import model
from .osm import clip_rings, to_lonlat

SOURCE = "overture"
LABEL = "Overture Maps"
LICENCE = "ODbL, CDLA Permissive 2.0"
LINK = "https://docs.overturemaps.org/attribution/"

CATALOG = "https://stac.overturemaps.org/catalog.json"
ARCHIVE = "https://tiles.overturemaps.org/{release}/buildings.pmtiles"
LAYER = "building"
# A tile's weight said before the yes: the middle of what Taiz, Petare, Amsterdam and Kibera weigh.
TILE_BYTES = 2_500_000
RELEASE_DAYS = 1.0
# A storey, for a building whose source gives a count of floors and no height.
STOREY_M = 3.0
OSM = "OpenStreetMap"

_lock = threading.Lock()
_archive: pmtiles.Archive | None = None
_release_at = 0.0


def latest_release() -> str:
    """The newest release Overture's catalog names."""
    try:
        response = httpx.get(CATALOG, timeout=tiles.TILE_TIMEOUT, headers={"User-Agent": tiles.USER_AGENT})
        response.raise_for_status()
        release = response.json().get("latest")
    except (httpx.HTTPError, ValueError, AttributeError) as exc:
        raise model.BuildingsUnavailable(f"Overture's list of releases could not be read just now ({exc})") from exc
    if not isinstance(release, str) or not release or "/" in release:
        raise model.BuildingsUnavailable("Overture's list of releases names no release")
    return release


def _open() -> pmtiles.Archive:
    global _archive, _release_at
    with _lock:
        if _archive is None or time.monotonic() - _release_at > RELEASE_DAYS * 86400:
            _archive = pmtiles.Archive(ARCHIVE.format(release=latest_release()))
            _release_at = time.monotonic()
        return _archive


def _forget_release() -> None:
    global _archive
    with _lock:
        _archive = None


def fetch_tile(z: int, x: int, y: int) -> list[model.Building]:
    """Overture's footprints in one z14 tile, each clipped to it, with OpenStreetMap's heights where given."""
    if z != model.ZOOM:
        raise ValueError(f"Overture's buildings are read at zoom {model.ZOOM}, not {z}")
    try:
        body = _open().tile(z, x, y)
    except pmtiles.PMTilesUnavailable as exc:
        # a release taken down: the next read looks the newest one up again
        _forget_release()
        raise model.BuildingsUnavailable(f"Overture's buildings could not be read just now ({exc})") from exc
    if body is None:
        return []
    try:
        polygons = mvt.read_polygons(body, LAYER)
    except ValueError as exc:
        raise model.BuildingsUnavailable("Overture sent a tile that could not be read") from exc
    buildings = []
    for rings, properties in polygons:
        if properties.get("is_underground") in (True, 1):
            continue
        clipped = clip_rings(rings)
        if not clipped:
            continue
        height, kind = _height(properties)
        building = model.Building(
            rings=tuple(to_lonlat(ring, x, y, z) for ring in clipped),
            height=height,
            kind=kind,
            source=SOURCE,
            date=_date(properties.get("sources")),
        )
        if model.footprint_area(building) >= model.MIN_AREA:
            buildings.append(building)
    return buildings


def _height(properties: Mapping[str, object]) -> tuple[float | None, model.Kind]:
    """A height OpenStreetMap's mappers gave is as good as OpenStreetMap's own; a count
    of floors, or a height from elsewhere, is an estimate."""
    height = model.clean_height(properties.get("height"))
    if height is not None:
        return height, "measured" if properties.get("@height_source") == OSM else "estimated"
    floors = model.clean_height(properties.get("num_floors"))
    if floors is not None:
        return model.clean_height(floors * STOREY_M), "estimated"
    return None, "unknown"


def _date(raw: object) -> str:
    """When the footprint's source last saw it: its update time, else its dataset's version."""
    try:
        sources = json.loads(raw) if isinstance(raw, str) else None
    except ValueError:
        return ""
    if not isinstance(sources, list) or not sources or not isinstance(sources[0], dict):
        return ""
    for key in ("update_time", "version"):
        value = sources[0].get(key)
        if isinstance(value, str) and len(value) >= 10 and value[:4].isdigit():
            return value[:10]
    return ""
