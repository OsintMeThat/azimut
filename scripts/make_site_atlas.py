"""Make the land of the default home's map: src/azimut/engine/data/site_atlas.svg.

The map of places on Azimut's default home (`engine/siteatlas.py`) draws its pins over the world's land,
which the home carries as one small SVG file. The land is Natural Earth's countries at 1:110 million
(naturalearthdata.com, public domain), the outline the map plate already ships in
`frontend/src/lib/plate/world.json`, so nothing is downloaded. Each ring is projected with the engine's
own Equal Earth (`siteatlas.project`), so the pins land where the land is drawn, simplified, turned the
same way round so the countries fill as one land with no seam between them, and written as one path in
whole units with relative steps.

Run it from the repo root when the land or the projection changes:

    python scripts/make_site_atlas.py

It writes the file and prints its size.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from azimut.engine import siteatlas  # noqa: E402

WORLD = ROOT / "frontend" / "src" / "lib" / "plate" / "world.json"
#: How far a point may stray from the simplified line, and the smallest island kept, in atlas units.
TOLERANCE = 0.6
MIN_AREA = 1.5
#: The colours of the land and of its coast; the sea is the page's own.
LAND = "#fbfaf7"
COAST = "#c9d3dc"


def _simplified(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Douglas and Peucker's simplification of an open line, its two ends kept."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        (ax, ay), (bx, by) = points[first], points[last]
        length = math.hypot(bx - ax, by - ay)
        far, at = 0.0, -1
        for index in range(first + 1, last):
            px, py = points[index]
            gap = (abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length) if length else math.hypot(px - ax, py - ay)
            if gap > far:
                far, at = gap, index
        if far > tolerance and at > 0:
            keep[at] = True
            stack += [(first, at), (at, last)]
    return [point for point, kept in zip(points, keep) if kept]


def _area(ring: list[tuple[int, int]]) -> float:
    return sum(ax * by - bx * ay for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1])) / 2


def ring_path(flat: list[int], scale: float) -> str:
    """One ring of world.json as a closed path: projected, simplified, rounded, clockwise on the page."""
    points = [siteatlas.project(flat[index] / scale, flat[index + 1] / scale) for index in range(0, len(flat) - 1, 2)]
    if points[0] != points[-1]:
        points.append(points[0])
    simple = _simplified(points, TOLERANCE)
    ring: list[tuple[int, int]] = []
    for x, y in simple:
        point = (round(x), round(y))
        if not ring or ring[-1] != point:
            ring.append(point)
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring.pop()
    area = _area(ring)
    if len(ring) < 3 or abs(area) < MIN_AREA:
        return ""
    # y grows downward on the page: a positive area is clockwise there
    if area < 0:
        ring.reverse()
    (px, py), steps = ring[0], []
    for x, y in ring[1:]:
        steps.append(f"{x - px} {y - py}")
        px, py = x, y
    return (f"M{ring[0][0]} {ring[0][1]}l" + " ".join(steps) + "z").replace(" -", "-")


def make() -> str:
    """The atlas as the file holds it."""
    world = json.loads(WORLD.read_text(encoding="utf-8"))
    scale = float(world["scale"])
    path = "".join(ring_path(ring, scale) for country in world["countries"] for ring in country["r"])
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {siteatlas.WIDTH} {siteatlas.HEIGHT}" '
            f'width="{siteatlas.WIDTH}" height="{siteatlas.HEIGHT}">\n'
            "<!-- Land: Natural Earth 1:110m countries, public domain. Equal Earth. Made by scripts/make_site_atlas.py. -->\n"
            f'<path fill="{LAND}" stroke="{COAST}" stroke-width="1.2" stroke-linejoin="round" d="{path}"/>\n</svg>\n')


def main() -> None:
    svg = make()
    siteatlas.LAND.write_text(svg, encoding="utf-8", newline="\n")
    print(f"{siteatlas.LAND.relative_to(ROOT)}: {len(svg.encode()) / 1024:.1f} KB, {siteatlas.WIDTH} x {siteatlas.HEIGHT}")


if __name__ == "__main__":
    main()
