"""One building, whatever source told of it, and what every source shares.

Each source (`osm`, `ign`, `globfp`) turns what it reads into these records, one
Web Mercator tile at `ZOOM` at a time, so the merge and Horizon never need to
know where a building came from beyond the two words it carries: its `source`
and the `kind` of its height.

A height is honest about itself. `measured` is a value someone surveyed or
mapped (the IGN's, an OSM `height` or `building:levels`); `estimated` is a
model's guess for that one building (3D-GloBFP); `unknown` is nobody's answer,
and the view says so rather than inventing one. (`range`, a band of stories,
is kept for OpenBuildingMap.)
"""

from __future__ import annotations

import gzip
import json
import math
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from ... import config

# The one tile level every source is read and kept at: about 2.4 km a side at
# the equator, small enough that a view loads only what is round it.
ZOOM = 14
# Whatever a source says, a building is never taller than this (the tallest
# standing is 828 m): a larger value is a typing slip, and is no height at all.
MAX_HEIGHT = 900.0
# A footprint smaller than this, square metres, is a shed or a slip of the pen.
MIN_AREA = 6.0

Kind = Literal["measured", "estimated", "range", "unknown"]
KINDS: tuple[Kind, ...] = ("measured", "estimated", "range", "unknown")
SOURCES = ("ign", "osm", "globfp")

Point = tuple[float, float]  # (lon, lat)
Ring = tuple[Point, ...]
Key = tuple[int, int, int]  # (z, x, y)


class BuildingsUnavailable(Exception):
    """A source could not be read just now: the reason, said to the analyst."""


@dataclass(frozen=True)
class Building:
    """A footprint and how tall it stands.

    `rings` are (lon, lat) points, the outer ring first and any courtyard after
    it, each open (its last point is not its first again). `height` is metres
    above the ground, None when the source has none. `min_height` lifts a part
    that does not reach the ground (an overhang, a tower's upper block).
    `date` is when the source last saw it, as precisely as it says (2020,
    2024-07, 2022-08-10).

    When the merge lends a footprint another source's height, `height_source`
    and `height_date` say whose and how old; empty, the height is the
    footprint's own.
    """

    rings: tuple[Ring, ...]
    height: float | None
    kind: Kind
    source: str
    date: str = ""
    min_height: float = 0.0
    height_source: str = ""
    height_date: str = ""


# -- the tile grid -----------------------------------------------------------------


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """(west, south, east, north) of a tile, in degrees."""
    n = 2**z

    def lat(row: float) -> float:
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * row / n))))

    return x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y)


def tile_of(lat: float, lon: float, z: int = ZOOM) -> Key:
    n = 2**z
    s = math.sin(math.radians(max(-85.05, min(85.05, lat))))
    x = int((lon + 180) / 360 * n)
    y = int((0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n)
    return z, min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def metres_frame(lat0: float) -> tuple[float, float]:
    """Metres per degree of longitude and of latitude near `lat0`: enough for a tile."""
    return 111_320.0 * math.cos(math.radians(lat0)), 110_574.0


def ring_area(ring: Ring, lat0: float) -> float:
    """Signed area in square metres (positive when counter-clockwise, east and north up)."""
    kx, ky = metres_frame(lat0)
    total = 0.0
    for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1]):
        total += (ax * kx) * (by * ky) - (bx * kx) * (ay * ky)
    return total / 2


def footprint_area(building: Building) -> float:
    """The outer ring's area less its courtyards', square metres."""
    lat0 = building.rings[0][0][1]
    outer = abs(ring_area(building.rings[0], lat0))
    return outer - sum(abs(ring_area(hole, lat0)) for hole in building.rings[1:])


def centroid(building: Building) -> Point:
    """The mean of the outer ring's points: inside any footprint a source draws, near enough."""
    ring = building.rings[0]
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def clean_height(value: object) -> float | None:
    """A height a source gave, or None when it gave nothing usable."""
    try:
        height = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if not math.isfinite(height) or height <= 0 or height > MAX_HEIGHT:
        return None
    return height


# -- where the sources keep what they read ---------------------------------------------


def cache_root() -> Path:
    """Disposable, like the map's tiles: outside every case and every backup."""
    return config.internal_dir() / "cache" / "buildings"


def write_json_gz(path: Path, payload: object) -> None:
    """Written aside then moved in, so a reader never sees half a file (and Windows can rename over it)."""
    part = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.part")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        part.write_bytes(gzip.compress(json.dumps(payload, separators=(",", ":")).encode("utf-8"), 6))
        os.replace(part, path)
    finally:
        part.unlink(missing_ok=True)


def read_json_gz(path: Path) -> object | None:
    try:
        return json.loads(gzip.decompress(path.read_bytes()))
    except (OSError, ValueError, EOFError):
        return None


def to_rows(buildings: list[Building]) -> list[list[object]]:
    """Buildings as plain lists, for a cache file: [rings, height, kind, source, date, min_height]."""
    return [
        [[[list(p) for p in ring] for ring in b.rings], b.height, b.kind, b.source, b.date, b.min_height]
        for b in buildings
    ]


def height_source_of(building: Building) -> str:
    """Whose height a building carries: its own source unless the merge lent it another's."""
    return building.height_source or building.source


def from_rows(rows: object) -> list[Building] | None:
    """The reverse of `to_rows`; None for a file that is not one."""
    if not isinstance(rows, list):
        return None
    out = []
    try:
        for rings, height, kind, source, date, min_height in rows:
            if kind not in KINDS:
                return None
            out.append(Building(
                rings=tuple(tuple((float(p[0]), float(p[1])) for p in ring) for ring in rings),
                height=None if height is None else float(height),
                kind=kind, source=str(source), date=str(date), min_height=float(min_height),
            ))
    except (TypeError, ValueError):
        return None
    return out
