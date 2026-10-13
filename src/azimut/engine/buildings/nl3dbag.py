"""The Netherlands' buildings from the 3D BAG, read tile by tile from one PMTiles archive.

The 3D BAG (TU Delft and 3DGI) raises every building of the Kadaster's BAG
register on the AHN airborne lidar: about 10.8 million, each part with its
height above the ground (`height`). In LoD 1.3 every part stands on the ground:
the archive's `base_height` sits a few centimetres under `height` for most of
them (the low edge of a roof, not a part's floor), so it is not read. Its parts
are published as a
PMTiles archive of vector tiles (1.2 GB), of which a view reads only its own
z14 tiles over HTTP ranges (`engine/pmtiles.py`), a few hundred kilobytes each.
Licence CC BY 4.0.

Like OpenStreetMap's tiles, each tile carries its neighbours' parts in its
buffer, so every footprint is clipped to the tile's own square (osm.py).
"""

from __future__ import annotations

import threading

from .. import mvt, pmtiles
from . import model
from .osm import clip_rings, to_lonlat

SOURCE = "nl3dbag"
LABEL = "3D BAG (Netherlands)"
LICENCE = "CC BY 4.0"
LINK = "https://3dbag.nl"
ARCHIVE = "https://data.source.coop/cholmes/portolan-nl/tudelft/3dbag/3dbag-lod13.pmtiles"
LAYER = "buildings"
# the archive's own bounds, a little generous: elsewhere it is not asked at all
BOUNDS = (3.2, 50.7, 7.3, 53.6)

_lock = threading.Lock()
_archive: pmtiles.Archive | None = None


def _open() -> pmtiles.Archive:
    global _archive
    with _lock:
        if _archive is None:
            _archive = pmtiles.Archive(ARCHIVE)
        return _archive


def covers(z: int, x: int, y: int) -> bool:
    west, south, east, north = model.tile_bounds(z, x, y)
    return west < BOUNDS[2] and east > BOUNDS[0] and south < BOUNDS[3] and north > BOUNDS[1]


def fetch_tile(z: int, x: int, y: int) -> list[model.Building]:
    """The 3D BAG's building parts in one z14 tile, each clipped to it, with their measured heights."""
    if z != model.ZOOM:
        raise ValueError(f"the 3D BAG is read at zoom {model.ZOOM}, not {z}")
    try:
        body = _open().tile(z, x, y)
    except pmtiles.PMTilesUnavailable as exc:
        raise model.BuildingsUnavailable(f"The 3D BAG could not be read just now ({exc})") from exc
    if body is None:
        return []
    try:
        polygons = mvt.read_polygons(body, LAYER)
    except ValueError as exc:
        raise model.BuildingsUnavailable("The 3D BAG sent a tile that could not be read") from exc
    buildings = []
    for rings, properties in polygons:
        clipped = clip_rings(rings)
        if not clipped:
            continue
        height = model.clean_height(properties.get("height"))
        building = model.Building(
            rings=tuple(to_lonlat(ring, x, y, z) for ring in clipped),
            height=height,
            kind="measured" if height is not None else "unknown",
            source=SOURCE,
        )
        if model.footprint_area(building) >= model.MIN_AREA:
            buildings.append(building)
    return buildings
