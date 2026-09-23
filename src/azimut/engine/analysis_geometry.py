"""Pixel-edge footprints. Only post-processing; the detector mask stays intact."""

from __future__ import annotations

from collections import defaultdict
from typing import Any


def contains(ring: list, point: tuple[float, float]) -> bool:
    x, y = point
    inside = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        cross = (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0])
        if abs(cross) < 1e-12 and min(a[0], b[0]) <= x <= max(a[0], b[0]) and min(a[1], b[1]) <= y <= max(a[1], b[1]):
            return True
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            inside = not inside
    return inside


def outlines(mask: Any) -> list[list[list[tuple[int, int]]]]:
    """Trace cell boundaries, preserving holes and diagonal-only components.

    Collinear vertices are removed without moving any edge or closing a gap.
    At a corner shared by two pixels the right turn keeps their rings separate.
    """
    import numpy as np

    cells = np.pad(np.asarray(mask, dtype=bool), 1)
    core = cells[1:-1, 1:-1]
    edges: dict[tuple[int, int], set[tuple[int, int]]] = defaultdict(set)
    for exposed, start, end in (
        (core & ~cells[:-2, 1:-1], (0, 0), (1, 0)),
        (core & ~cells[1:-1, 2:], (1, 0), (1, 1)),
        (core & ~cells[2:, 1:-1], (1, 1), (0, 1)),
        (core & ~cells[1:-1, :-2], (0, 1), (0, 0)),
    ):
        ys, xs = np.nonzero(exposed)
        for x, y in zip(xs.tolist(), ys.tolist()):
            edges[(x + start[0], y + start[1])].add((x + end[0], y + end[1]))
    directions = {(1, 0): 0, (0, 1): 1, (-1, 0): 2, (0, -1): 3}
    rings = []
    while edges:
        start = next(iter(edges))
        ring = [start]
        current = start
        direction = None
        while True:
            options = edges[current]
            def priority(end: tuple[int, int]) -> int:
                heading = directions[(end[0] - current[0], end[1] - current[1])]
                return {1: 0, 0: 1, 3: 2, 2: 3}[(heading - direction) % 4] if direction is not None else heading
            following = min(options, key=priority)
            options.remove(following)
            if not options:
                del edges[current]
            direction = directions[(following[0] - current[0], following[1] - current[1])]
            current = following
            if current == start:
                break
            ring.append(current)
        simplified = []
        for i, point in enumerate(ring):
            a, b = ring[i - 1], ring[(i + 1) % len(ring)]
            if (point[0] - a[0]) * (b[1] - point[1]) != (point[1] - a[1]) * (b[0] - point[0]):
                simplified.append(point)
        if simplified:
            simplified.append(simplified[0])
            rings.append(simplified)
    def signed(ring: list) -> float:
        return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:]))
    polygons = [[ring] for ring in rings if signed(ring) > 0]
    for hole in (ring for ring in rings if signed(ring) < 0):
        owners = [polygon for polygon in polygons if contains(polygon[0], hole[0])]
        if owners:
            min(owners, key=lambda polygon: abs(signed(polygon[0]))).append(hole)
    return polygons


def footprint(mask: Any, x: int, y: int, z: int, size: int, offset=(0, 0)) -> dict[str, Any]:
    from .analyzers import geographic

    polygons = [[[
        list(geographic((x + (px + offset[0]) / size) / (1 << z),
                        (y + (py + offset[1]) / size) / (1 << z)))
        for px, py in reversed(ring)] for ring in polygon] for polygon in outlines(mask)]
    return {"type": "Polygon", "coordinates": polygons[0]} if len(polygons) == 1 else {
        "type": "MultiPolygon", "coordinates": polygons}


def joined(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    def parts(shape: dict[str, Any]) -> list:
        return [shape["coordinates"]] if shape["type"] == "Polygon" else shape["coordinates"]
    return {"type": "MultiPolygon", "coordinates": parts(a) + parts(b)}


def interior(geometry: dict[str, Any], preferred: tuple[float, float]) -> tuple[float, float]:
    """Choose a point inside a footprint, including a concave or merged one."""
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    for polygon in polygons:
        if contains(polygon[0], preferred) and not any(contains(hole, preferred) for hole in polygon[1:]):
            return preferred
    for polygon in polygons:
        ys = sorted({p[1] for ring in polygon for p in ring})
        for low, high in zip(ys, ys[1:]):
            y = (low + high) / 2
            xs = sorted(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
                        for ring in polygon for a, b in zip(ring, ring[1:])
                        if (a[1] > y) != (b[1] > y))
            for left, right in zip(xs[::2], xs[1::2]):
                if right > left:
                    return ((left + right) / 2, y)
    raise ValueError("the footprint has no interior")
