"""Where the sea and the lakes are, read off OpenFreeMap's map tiles (their `water` layer).

Find rules a point out when the photo shows the sea, or the sea or a lake, and none lies within reach of it
(engine/ruleout.py). The heights alone cannot say a lake from a plain: past the planet's own level their tiles
round heights to a couple of metres, so a plain reads as flat as water. The map knows: its `water` layer
holds the sea (`ocean`) and the lakes (`lake`, reservoirs with them) as polygons, and the rivers wide enough
to be drawn as water rather than as a line (`river`): in a photo such a river reads as a lake (a real case's
Little Zab), so it counts with them. A stream drawn as a line is not in this layer, nor is a swimming pool.

Each tile is read at `ZOOM`, from the same build the summit names come from (engine/peaks.py), and laid as a
`SIDE`-pixel square of two masks, the sea and the lakes (wide rivers with them), kept on the disk for
`TTL_DAYS` in a folder named for what the masks hold (`KIND`). A tile that cannot
be read answers None, and the caller reads the terrain's flat ground instead (engine/ruleout.py), where the
sea and the lakes lie flat too.
"""

from __future__ import annotations

import functools
import os
import threading
import time
from pathlib import Path

import numpy as np

from .. import config
from . import mvt, peaks

LAYER = "water"
SEA = frozenset({"ocean"})
LAKES = frozenset({"lake", "river"})
# What the masks kept on the disk hold: a change to SEA or LAKES names a new folder, so none is read stale.
KIND = "2"
# A tile about 39 km wide at the equator, laid 256 pixels a side: one pixel about 150 m.
ZOOM = 10
SIDE = 256
TTL_DAYS = 90

Key = tuple[int, int, int]


def cache_dir() -> Path:
    return config.internal_dir() / "cache" / "water" / KIND


def _path(key: Key) -> Path:
    z, x, y = key
    return cache_dir() / str(z) / str(x) / f"{y}.npz"


def fill(rings: list[list[tuple[float, float]]], side: int = SIDE) -> np.ndarray:
    """The pixels of a `side`-square tile whose middles lie inside the rings (points as fractions of the tile),
    even-odd, so a hole is left out: one row at a time, between the crossings of its edges."""
    out = np.zeros((side, side), dtype=bool)
    edges = []
    for ring in rings:
        if len(ring) < 3:
            continue
        points = np.asarray(ring, dtype=np.float64) * side
        edges.append(np.concatenate([points, np.roll(points, -1, axis=0)], axis=1))
    if not edges:
        return out
    x0, y0, x1, y1 = np.concatenate(edges).T
    middles = np.arange(side) + 0.5
    for row, y in enumerate(middles):
        crossing = (y0 <= y) != (y1 <= y)
        if not crossing.any():
            continue
        xs = np.sort(x0[crossing] + (y - y0[crossing]) * (x1[crossing] - x0[crossing]) / (y1[crossing] - y0[crossing]))
        for start, end in zip(xs[0::2], xs[1::2]):
            lo, hi = int(np.ceil(start - 0.5)), int(np.floor(end - 0.5))
            if hi >= lo:
                out[row, max(0, lo):min(side, hi + 1)] = True
    return out


def _read(key: Key) -> tuple[np.ndarray, np.ndarray] | None:
    path = _path(key)
    try:
        if time.time() - path.stat().st_mtime > TTL_DAYS * 86400:
            return None
        with np.load(path) as kept:
            return np.unpackbits(kept["sea"])[: SIDE * SIDE].reshape(SIDE, SIDE).astype(bool), \
                np.unpackbits(kept["lakes"])[: SIDE * SIDE].reshape(SIDE, SIDE).astype(bool)
    except (OSError, ValueError, KeyError):
        return None


def _write(key: Key, sea: np.ndarray, lakes: np.ndarray) -> None:
    """Written aside then moved in, so a reader meanwhile never sees half of it."""
    path = _path(key)
    part = path.with_name(f"{path.stem}.{threading.get_ident()}.part.npz")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(part, sea=np.packbits(sea), lakes=np.packbits(lakes))
        os.replace(part, path)
    except OSError:
        part.unlink(missing_ok=True)


@functools.lru_cache(maxsize=64)
def masks(z: int, x: int, y: int) -> tuple[np.ndarray, np.ndarray] | None:
    """The sea and the lakes on one tile, `SIDE` pixels a side from its top-left corner, or None when the
    map could not be read."""
    key = (z, x, y)
    kept = _read(key)
    if kept is not None:
        return kept
    try:
        body, _ = peaks.fetch_vector_tile(z, x, y)
        # a tile the build does not hold says nothing of the water there
        if body is None:
            return None
        polygons = mvt.read_polygons(body, LAYER)
    except (peaks.PeaksUnavailable, ValueError):
        return None
    sea = np.zeros((SIDE, SIDE), dtype=bool)
    lakes = np.zeros((SIDE, SIDE), dtype=bool)
    for rings, properties in polygons:
        kind = properties.get("class")
        if kind in SEA:
            sea |= fill(rings)
        elif kind in LAKES:
            lakes |= fill(rings)
    _write(key, sea, lakes)
    return sea, lakes


def forget() -> None:
    """Drop the tiles held in memory (tests)."""
    masks.cache_clear()
