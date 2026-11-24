"""Where the pieces Azimut stitched meet on a collage.

Where two stitched frames overlap, the one drawn on top used to show right up to
its own edge, where its lens bends most, so ridges and skies stepped there. Among
the stitched pieces a point now shows the one whose middle is nearest: each owns
its Voronoi cell among their middles, convex, the seam halfway between two of them.

- A piece is stitched when its recipe holds the rotation model's ``remap`` op. A
  planar stitch leaves the pixels alone and only places the quad, so nothing tells
  its pieces from ones laid by hand: they keep stack order with them.
- A piece's middle is the mean of its four corners on the canvas. Two middles at
  one place: the piece drawn later owns the cell.
- A piece is hidden only where the owner of the cell, drawn below it, is fully
  opaque. Where the owner has no pixel (the curved corners of its warp) the pieces
  show as they stack, so nothing goes blank.
- Pieces laid by hand keep their place in the stack, above or below.

The compositor (`engine/inspect.py`), the canvas and the list's preview
(`lib/seams.js`) follow this one rule; `tests/fixtures/collage-seams.json` holds what
both languages agree on. Find's reading of a collage (`engine/frames.py`) still
takes the piece drawn on top: on real pans the two frames of an overlap can point
a degree or more apart there, and a trace must not move by moving a seam.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any


Point = tuple[float, float]


def stitched(ops: Any) -> bool:
    """Whether a piece's recipe holds the rotation model's warp: a piece Azimut stitched."""
    for op in ops or []:
        params = op.get("params") if isinstance(op, dict) and op.get("op") == "remap" else None
        if isinstance(params, dict) and len(params.get("r") or []) == 9:
            return True
    return False


def middle(quad: Sequence[Sequence[float]]) -> Point:
    """A piece's middle on the canvas: the mean of its four corners."""
    return (sum(float(p[0]) for p in quad) / 4, sum(float(p[1]) for p in quad) / 4)


def _clip(poly: list[Point], a: float, b: float, c: float) -> list[Point]:
    """The part of a polygon where ``a·x + b·y <= c`` (Sutherland–Hodgman, one edge)."""
    out: list[Point] = []
    for i, p in enumerate(poly):
        q = poly[(i + 1) % len(poly)]
        fp = a * p[0] + b * p[1] - c
        fq = a * q[0] + b * q[1] - c
        if fp <= 0:
            out.append(p)
        if (fp <= 0) != (fq <= 0):
            t = fp / (fp - fq)
            out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    return out


def cells(middles: Sequence[Point], box: tuple[float, float, float, float]) -> list[list[Point]]:
    """Each middle's Voronoi cell among the others, within ``box`` (left, top, right,
    bottom): a convex polygon, empty for a middle another later one sits on."""
    left, top, right, bottom = box
    out: list[list[Point]] = []
    for i, (xi, yi) in enumerate(middles):
        cell: list[Point] = [(left, top), (right, top), (right, bottom), (left, bottom)]
        for j, (xj, yj) in enumerate(middles):
            if j == i:
                continue
            if math.isclose(xi, xj, abs_tol=1e-9) and math.isclose(yi, yj, abs_tol=1e-9):
                if j > i:
                    cell = []
                    break
                continue
            # nearer to i than to j: 2 (cj - ci) · p <= |cj|² - |ci|²
            cell = _clip(cell, 2 * (xj - xi), 2 * (yj - yi), xj * xj + yj * yj - xi * xi - yi * yi)
            if not cell:
                break
        out.append(cell)
    return out

