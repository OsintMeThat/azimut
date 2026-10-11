"""One tile's merged buildings as the bytes Horizon reads.

Little-endian throughout, read in the browser with a DataView:

    b"AZB1"
    u32  length of a JSON header, then the header: {"strings": [...]}
    u32  number of buildings, then for each:
         u8  kind (0 measured, 1 estimated, 2 range, 3 unknown)
         u8  footprint source, u8 height source, u8 date, u8 height date
             (indices into the header's strings; 255 for none)
         u8  0, u16 number of rings
         f32 height in metres (NaN when unknown), f32 the height a part starts at
         u16 points in each ring
         f32 pairs: each point as fractions of the tile from its top-left corner,
             x to the east and y to the south, the same frame the map's tiles use

A building that crosses the tile's edge keeps its points past 0 or 1: the view
draws, over each tile, only what stands on it.
"""

from __future__ import annotations

import json
import math
import struct

import numpy as np

from .. import tiles
from .model import KINDS, Building

MAGIC = b"AZB1"
NONE = 255


def encode(z: int, x: int, y: int, buildings: list[Building]) -> bytes:
    strings: list[str] = []
    index: dict[str, int] = {}

    def code(text: str) -> int:
        if not text:
            return NONE
        if text not in index:
            if len(strings) >= NONE:
                return NONE
            index[text] = len(strings)
            strings.append(text)
        return index[text]

    parts: list[bytes] = []
    for b in buildings:
        sizes = [len(ring) for ring in b.rings]
        points = np.array([p for ring in b.rings for p in ring], dtype=np.float64).reshape(-1, 2)
        # map units, then fractions of this tile
        lon, lat = points[:, 0], points[:, 1]
        fx = (lon + 180.0) / 360.0 * (1 << z) - x
        s = np.sin(np.radians(np.clip(lat, -85.05112878, 85.05112878)))
        fy = (0.5 - np.log((1 + s) / (1 - s)) / (4 * math.pi)) * (1 << z) - y
        parts.append(struct.pack(
            "<BBBBBBHff", KINDS.index(b.kind), code(b.source), code(b.height_source), code(b.date),
            code(b.height_date), 0, len(sizes), math.nan if b.height is None else b.height, b.min_height,
        ))
        parts.append(struct.pack(f"<{len(sizes)}H", *sizes))
        parts.append(np.column_stack((fx, fy)).astype("<f4").tobytes())
    header = json.dumps({"strings": strings}, separators=(",", ":")).encode("utf-8")
    return b"".join([MAGIC, struct.pack("<I", len(header)), header, struct.pack("<I", len(buildings)), *parts])


def decode(body: bytes, z: int, x: int, y: int) -> list[Building]:
    """The reverse of `encode`, for tests: buildings back in (lon, lat)."""
    if body[:4] != MAGIC:
        raise ValueError("not a buildings tile")
    (size,) = struct.unpack_from("<I", body, 4)
    strings = json.loads(body[8:8 + size])["strings"]
    at = 8 + size
    (count,) = struct.unpack_from("<I", body, at)
    at += 4

    def text(i: int) -> str:
        return "" if i == NONE else strings[i]

    out = []
    for _ in range(count):
        kind, source, height_source, date, height_date, _pad, nrings, height, min_height = struct.unpack_from(
            "<BBBBBBHff", body, at)
        at += struct.calcsize("<BBBBBBHff")
        sizes = struct.unpack_from(f"<{nrings}H", body, at)
        at += 2 * nrings
        rings = []
        for n in sizes:
            xy = np.frombuffer(body, dtype="<f4", count=2 * n, offset=at).reshape(-1, 2)
            at += 8 * n
            rings.append(tuple(
                (lon, lat) for lat, lon in (tiles.unproject(x + float(px), y + float(py), z) for px, py in xy)
            ))
        out.append(Building(
            rings=tuple(rings), height=None if math.isnan(height) else float(height), kind=KINDS[kind],
            source=text(source), date=text(date), min_height=float(min_height),
            height_source=text(height_source), height_date=text(height_date),
        ))
    return out
