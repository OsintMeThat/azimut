"""The map of places on Azimut's default home: a pin for each listed article that stands somewhere.

**The land** is `data/site_atlas.svg`, one path of Natural Earth's countries at 1:110 million (public
domain), the outline the map plate already ships (`frontend/src/lib/plate/world.json`), in the Equal
Earth projection and simplified to a few tens of KB. `scripts/make_site_atlas.py` makes it once, with
`project` below, so the pins land where the land was drawn. The home carries it as a file of its own
(`sitehome.ATLAS`), written once and cached by the reader's browser: no tile, no request elsewhere.
The same land is read back as rings (`rings`, `unproject`) for the cover of a web map with no
ground picture (`notes_web.map_cover`), drawn where the outline is fine enough for the map.

**The pins** are drawn in the page itself, an inline SVG whose `viewBox` frames them: the box around
the pins, a margin on each side, never closer than a region (`MIN_SPAN`) nor wider than the world.
Articles at the same spot (within `GROUP` of the frame's width) make one pin. Each article is a link
with its title, date and place, the dot drawn at a fixed size on any screen
(`vector-effect: non-scaling-stroke`), so the map reads and works with no script; the home's script
adds a card on hover, focus or tap (`sitehome.TABS_JS`). A home lists at most `MAX_PINS` placed
articles on its map, the newest.
"""

from __future__ import annotations

import html
import math
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

#: The atlas's width in its own units, and the projection that fills it.
WIDTH = 2000
_A1, _A2, _A3, _A4 = 1.340264, -0.081106, 0.000893, 0.003796
_M = math.sqrt(3) / 2
#: Equal Earth's half width and half height on a sphere of radius 1.
_X_MAX = math.pi / (_M * _A1)
_T_MAX = math.asin(_M)
_Y_MAX = _T_MAX * (_A1 + _A2 * _T_MAX ** 2 + _T_MAX ** 6 * (_A3 + _A4 * _T_MAX ** 2))
SCALE = WIDTH / (2 * _X_MAX)
HEIGHT = round(2 * _Y_MAX * SCALE)
#: The file the land is drawn in, beside this module.
LAND = Path(__file__).parent / "data" / "site_atlas.svg"
#: The shape of the map on the home, width over height, and how much of it the pins may take.
ASPECT = 2.4
FILL = 0.72
#: The narrowest the map frames, in atlas units: a region, so one pin shows where it is.
MIN_SPAN = WIDTH * 0.17
#: How close two pins are, in parts of the frame's width, to make one.
GROUP = 0.025
MAX_PINS = 100


def project(lon: float, lat: float) -> tuple[float, float]:
    """A point in degrees as the atlas draws it: x from the left, y from the top, in atlas units."""
    lam, phi = math.radians(lon), math.radians(lat)
    theta = math.asin(_M * math.sin(phi))
    t2 = theta * theta
    t6 = t2 * t2 * t2
    x = lam * math.cos(theta) / (_M * (_A1 + 3 * _A2 * t2 + t6 * (7 * _A3 + 9 * _A4 * t2)))
    y = theta * (_A1 + _A2 * t2 + t6 * (_A3 + _A4 * t2))
    return WIDTH / 2 + SCALE * x, HEIGHT / 2 - SCALE * y


def unproject(x: float, y: float) -> tuple[float, float]:
    """A point of the atlas back in degrees, ``(lon, lat)``: `project` undone, its latitude found by
    Newton's steps."""
    across = (x - WIDTH / 2) / SCALE
    up = (HEIGHT / 2 - y) / SCALE
    theta = up / _A1
    for _ in range(12):
        t2 = theta * theta
        t6 = t2 * t2 * t2
        step = (theta * (_A1 + _A2 * t2 + t6 * (_A3 + _A4 * t2)) - up) / (_A1 + 3 * _A2 * t2 + t6 * (7 * _A3 + 9 * _A4 * t2))
        theta -= step
        if abs(step) < 1e-12:
            break
    t2 = theta * theta
    t6 = t2 * t2 * t2
    lam = _M * across * (_A1 + 3 * _A2 * t2 + t6 * (7 * _A3 + 9 * _A4 * t2)) / math.cos(theta)
    return math.degrees(lam), math.degrees(math.asin(max(-1.0, min(1.0, math.sin(theta) / _M))))


def land() -> bytes:
    """The atlas as the home carries it."""
    return LAND.read_bytes()


#: One ring of the atlas's path: its first corner, then relative steps, closed.
_RING = re.compile(r"M(-?\d+) (-?\d+)l([^Mz]*)z?")
_NUMBER = re.compile(r"-?\d+")


@lru_cache(maxsize=1)
def rings() -> tuple[tuple[tuple[float, float, float, float], tuple[tuple[float, float], ...]], ...]:
    """The land as rings of corners in atlas units, each with its box ``(left, top, right, bottom)``:
    the file's one path read back as `scripts/make_site_atlas.py` wrote it."""
    found = re.search(r' d="([^"]+)"', LAND.read_text(encoding="utf-8"))
    out = []
    for match in _RING.finditer(found.group(1) if found else ""):
        x, y = float(match.group(1)), float(match.group(2))
        corners = [(x, y)]
        steps = [float(value) for value in _NUMBER.findall(match.group(3))]
        for dx, dy in zip(steps[::2], steps[1::2]):
            x, y = x + dx, y + dy
            corners.append((x, y))
        xs, ys = [one[0] for one in corners], [one[1] for one in corners]
        out.append(((min(xs), min(ys), max(xs), max(ys)), tuple(corners)))
    return tuple(out)


@dataclass
class Pin:
    """Where one or more articles stand on the map, in atlas units, and the lines that do."""

    x: float
    y: float
    lines: list[dict[str, Any]] = field(default_factory=list)


def placed(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The lines of the list that stand somewhere, newest first, at most `MAX_PINS`."""
    return [line for line in lines if isinstance(line.get("place"), dict)][:MAX_PINS]


def frame(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    """The box the map shows, `(x, y, width, height)` in atlas units: the points in the middle
    `FILL` of it, at least `MIN_SPAN` wide, at most the world, and inside the atlas where it fits."""
    xs, ys = [x for x, _ in points], [y for _, y in points]
    middle_x, middle_y = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    wide = max((max(xs) - min(xs)) / FILL, (max(ys) - min(ys)) / FILL * ASPECT, MIN_SPAN)
    wide = min(wide, WIDTH)
    high = wide / ASPECT
    left = min(max(middle_x - wide / 2, 0), WIDTH - wide)
    top = min(max(middle_y - high / 2, 0), HEIGHT - high) if high <= HEIGHT else (HEIGHT - high) / 2
    return left, top, wide, high


def pins(lines: list[dict[str, Any]], wide: float) -> list[Pin]:
    """The pins of the placed lines, those within `GROUP` of the frame's width of one another together,
    in the order of the list."""
    made: list[Pin] = []
    near = GROUP * wide
    for line in lines:
        x, y = project(float(line["place"]["lon"]), float(line["place"]["lat"]))
        pin = next((one for one in made if math.hypot(one.x - x, one.y - y) <= near), None)
        if pin is None:
            made.append(pin := Pin(x, y))
        pin.lines.append(line)
    return made


def _n(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".")


def figure(lines: list[dict[str, Any]], atlas: str, at: Any, by: Any) -> str:
    """The map of the placed lines as the home shows it, "" when none stands anywhere. ``atlas`` is the
    land's address from the home; ``at`` gives a line's address as the home links it, ``by`` its author
    as the home names it ("" for the site's own)."""
    chosen = placed(lines)
    if not chosen:
        return ""
    left, top, wide, high = frame([project(float(line["place"]["lon"]), float(line["place"]["lat"])) for line in chosen])
    e = html.escape
    out = ['<section class="site-map" aria-label="Where the articles stand">',
           f'<svg class="az-atlas" viewBox="{_n(left)} {_n(top)} {_n(wide)} {_n(high)}" preserveAspectRatio="xMidYMid meet" '
           f'width="{round(wide)}" height="{round(high)}" role="group" aria-label="Map of the articles">',
           f'<image href="{e(atlas)}" x="0" y="0" width="{WIDTH}" height="{HEIGHT}"/>']
    for number, pin in enumerate(pins(chosen, wide)):
        many = " az-many" if len(pin.lines) > 1 else ""
        dot = f'M{_n(pin.x)} {_n(pin.y)}l.01 0'
        for line in pin.lines:
            name = str(line["place"].get("name") or "")
            author = by(line)
            said = " · ".join(part for part in (line["title"], line["date_label"], author, name) if part)
            named_by = f' data-by="{e(author)}"' if author else ""
            out.append(f'<a class="az-pin{many}" href="{e(at(line["address"]))}" data-pin="{number}" '
                       f'data-title="{e(line["title"])}" data-date="{e(line["date_label"])}" data-place="{e(name)}"{named_by}>'
                       f'<title>{e(said)}</title><path class="ring" d="{dot}"/><path class="halo" d="{dot}"/>'
                       f'<path class="dot" d="{dot}"/></a>')
    out.append("</svg></section>")
    return "\n".join(out)
