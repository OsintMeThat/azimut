"""OpenStreetMap's building footprints, read from OpenFreeMap's vector tiles.

OpenFreeMap rebuilds OpenMapTiles every week from OpenStreetMap, and the
`building` layer of each z14 tile carries the footprints and the heights their
mappers gave. It is the host the summit names already come from (`peaks.py`), so
one tile fetch and one build's date serve both.

Two things are read with care. OpenMapTiles fills `render_height` with 5 metres
when a building has neither a height nor a levels tag, and levels become
`ceil(levels * 3.66)`, so 5 is almost always "no answer" rather than a real
5 m shed: it is taken as unknown. And a tile carries its neighbours' buildings
in its buffer, so every footprint is clipped to the tile's own square and the
neighbour returns the rest of its own. A building across a tile edge therefore
comes back as two parts, one from each tile.

A feature with `hide_3d` is an outline whose parts are drawn on their own, so it
is skipped.
"""

from __future__ import annotations

from .. import mvt, peaks, tiles
from . import model

SOURCE = "osm"
LABEL = "OpenStreetMap (OpenFreeMap)"
LICENCE = "ODbL"
LINK = "https://www.openstreetmap.org/copyright"
LAYER = "building"
# OpenMapTiles' fill for a building with no height and no levels tag
NO_HEIGHT = 5

Ring = list[tuple[float, float]]  # fractions of the tile, (x, y) from its top-left


def fetch_tile(z: int, x: int, y: int) -> list[model.Building]:
    """The buildings of one z14 tile, each part inside the tile."""
    if z != model.ZOOM:
        raise ValueError(f"OpenStreetMap buildings are read at zoom {model.ZOOM}, not {z}")
    try:
        body, template = peaks.fetch_vector_tile(z, x, y)
    except peaks.PeaksUnavailable as exc:
        raise model.BuildingsUnavailable(f"OpenStreetMap buildings could not be read just now ({exc})") from exc
    if body is None:
        return []
    try:
        polygons = mvt.read_polygons(body, LAYER)
    except ValueError as exc:
        raise model.BuildingsUnavailable("OpenStreetMap sent a tile that could not be read") from exc
    date = peaks.build_date(template)
    buildings = []
    for rings, properties in polygons:
        if properties.get("hide_3d") in (True, 1):
            continue
        clipped = _clip_rings(rings)
        if not clipped:
            continue
        height, kind = _height(properties.get("render_height"))
        building = model.Building(
            rings=tuple(_lonlat(ring, x, y, z) for ring in clipped),
            height=height,
            kind=kind,
            source=SOURCE,
            date=date,
            min_height=_min_height(properties.get("render_min_height"), height),
        )
        if model.footprint_area(building) >= model.MIN_AREA:
            buildings.append(building)
    return buildings


def _height(raw: object) -> tuple[float | None, model.Kind]:
    """The height a tile gives and how sure it is: the 5 m fill is no answer at all."""
    if raw is None or raw == NO_HEIGHT:
        return None, "unknown"
    height = model.clean_height(raw)
    return height, "measured" if height is not None else "unknown"


def _min_height(raw: object, height: float | None) -> float:
    """The level a part starts at, when it is above the ground and below the top."""
    if height is None or isinstance(raw, bool) or not isinstance(raw, int | float):
        return 0.0
    return float(raw) if 0 < raw < height else 0.0


# -- clipping to the tile -----------------------------------------------------------


def _inside(point: tuple[float, float], axis: int, value: float, above: bool) -> bool:
    return point[axis] >= value if above else point[axis] <= value


def _cut(a: tuple[float, float], b: tuple[float, float], axis: int, value: float) -> tuple[float, float]:
    """Where the edge a-b crosses the line `axis == value`."""
    t = (value - a[axis]) / (b[axis] - a[axis])
    other = 1 - axis
    along = a[other] + t * (b[other] - a[other])
    return (value, along) if axis == 0 else (along, value)


def _clip_edge(points: Ring, axis: int, value: float, above: bool) -> Ring:
    """One pass of Sutherland-Hodgman: keep the side of one tile edge."""
    out: Ring = []
    if not points:
        return out
    prev = points[-1]
    for cur in points:
        if _inside(cur, axis, value, above):
            if not _inside(prev, axis, value, above):
                out.append(_cut(prev, cur, axis, value))
            out.append(cur)
        elif _inside(prev, axis, value, above):
            out.append(_cut(prev, cur, axis, value))
        prev = cur
    return out


def _clip(ring: Ring) -> Ring:
    """A ring cut to the tile's square, [0, 1] on both axes."""
    if all(0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 for x, y in ring):
        return ring
    points = ring
    for axis, value, above in ((0, 0.0, True), (0, 1.0, False), (1, 0.0, True), (1, 1.0, False)):
        points = _clip_edge(points, axis, value, above)
        if not points:
            break
    return points


def _clip_rings(rings: list[Ring]) -> list[Ring]:
    """The polygon's rings cut to the tile, each kept with at least three points.

    Nothing is kept when the exterior ring is gone: its holes have nothing to sit in.
    """
    exterior = _clip(rings[0])
    if len(exterior) < 3:
        return []
    holes = [part for part in (_clip(ring) for ring in rings[1:]) if len(part) >= 3]
    return [exterior, *holes]


def _lonlat(ring: Ring, x: int, y: int, z: int) -> tuple[model.Point, ...]:
    """A ring of tile fractions as (lon, lat) points of the map."""
    points = []
    for fx, fy in ring:
        lat, lon = tiles.unproject(x + fx, y + fy, z)
        points.append((lon, lat))
    return tuple(points)
