"""A map in a note: the `::: map` block, what it shows, and how it is drawn.

A note holds a map as a block of `key: value` lines, which the Notebook writes when a
map is put in it (`/` › Interactive map, My layers, a Map plate) and the analyst can
read and edit as text:

    ::: map
    title: Front line, 1 Sep to 15 Nov
    layer: Front line
    layer: Vehicles and route
    proofs: 2026-09-01..2026-11-15
    ground: e_3f2a9c01
    view: 12.82, 43.478, 10.65
    :::

- ``layer`` names a layer of the case by its name, one a line (a name may hold a comma);
  ``layers`` is read the same way.
- ``plate`` names a Map plate instead, which brings its layers as it draws them, its
  days, its steps and how each step frames the map.
- ``proofs`` adds the case's proofs: ``all``, a period ``2026-09-01..2026-11-15`` (either
  end may be left open), or one day.
- ``ground`` is the picture under the map, a capture filed when the map was put in
  (the way Add › This view files one): its bounds and its credit are the capture's.
  ``detail`` (one a line) is a sharper capture of a smaller part, filed for each step
  that frames the map closer than its ground holds, and laid over it in place.
  Exporting never fetches a tile.
- ``view`` is where the map looks, ``lat, lon, zoom[, bearing]``, the zoom as the map
  engine counts it (a 512-pixel world at zoom 0, one less than a tile's XYZ zoom).

**How it is shown.** The map's settings card (`editor/mapBlock.js`) writes each choice as
one more line, and a block without them reads and draws as it always did:

- ``base``: ``satellite`` (the ground as filed, the default), ``map``, ``topographic`` or
  ``dark``. Each other base is a ground of its own, filed once on the press that picks it
  (OpenStreetMap, OpenTopoMap, and OpenStreetMap again drawn dark), so the page still
  fetches nothing; a live map draws ``map`` and ``dark`` from OpenFreeMap's own styles.
- ``imagery``: ``sentinel`` (EOX's Sentinel-2 cloudless, its newest year, free with its
  credit) or ``esri`` (Esri World Imagery, sharper, under Esri's terms), where a satellite
  map's ground is filed from; a web folder's live map streams it in the reader's browser.
  Left out, the ground is filed from Esri and the live map draws it as filed. A map put
  in a note takes ``sentinel`` unless the put names Esri.
- ``hide`` takes a layer the map names (by a line or its plate) off it, one a line;
  ``colour: Front line = #d55e00`` paints every feature of a layer in one colour.
- ``proof points``: ``filmed`` shows a proof only where it was filmed from, ``every``
  (the default) each of its points.
- ``labels``: ``on`` writes every mark's name, ``off`` none; left out, as each layer says.
  ``crowds``: a crowd of marks past this many is a count to press (``off``, or a number;
  12 by default).
- ``north: on`` draws a north arrow; ``scale: off`` takes the scale away, ``scale: on``
  also prints it on the PDF's picture.
- ``frame: west, south, east, north`` is the part of the world the map shows, by default
  its ground's; ``bounds: ground`` keeps a live map's reader inside it. A ``view`` closer
  than the frame (Draw › *Open here*) is where the page opens the map.
- ``timeline: off`` hides the days' slider; ``opens on`` is the day the map opens on
  (its last by default); ``speed`` is Play's pace, ``slow``, ``normal`` or ``fast``.
- ``step: day | label | lat, lon, zoom | proof | words``, one a line, are the map's own
  steps, in order, in place of its plate's or its proofs'; any part may be left empty,
  ``proof`` naming the proof whose card the step opens.
- ``card`` lists what a feature's card shows: ``picture, sentence, source, verify``.
- ``size``: ``half``, ``wide`` (the default) or ``full`` (the screen's height);
  ``legend``: ``shown``, ``folded`` or ``hidden``.

What the analyst draws on the card (an area to highlight with its words, a point, a
line) is a feature of a personal layer of the case the block names by a ``layer`` line,
never kept in the block itself.

**What it shows** (`derive`) is one shape every reader of the map shares, the HTML
report's offline map, the PDF's picture of it and, later, a live map on a web page:
features in GeoJSON order (longitude first), each with the days it is there
(``from``/``until``, both included, read off the layer's dated edits so a slider can
show any day), its style as the layer draws it, and the card a click opens. A feature
that moved over time is one feature per state, so the front moves on the slider. A
plate gives its steps, a period of proofs one step per proof in date order.

**A stale name never breaks a page.** A layer, a plate or a ground no longer in the
case is said by the check before export, and the map draws what is left, or a frame
that says it has nothing to show.

**How it is drawn.** `svg` writes the features over the ground as the page shows them
with no script and in print, in the layer's own colours and pictograms (the map's own
drawings, `notes_html_assets/markers.json`, kept equal to `lib/map/markerGlyphs.js`
by a test). `picture` paints the same with Pillow, for the PDF (`render_png`) and a map
page's cover (`notes_web.map_cover`).
"""

from __future__ import annotations

import base64
import copy
import json
import math
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterable, Iterator, Mapping

from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps

from .. import layout
from . import cloudless, notesources, tiles, urltitles

if TYPE_CHECKING:
    from ..workspace import Case

#: The block's name, and the token the Markdown reading hands each renderer for it.
BLOCK = "map"
TOKEN = "az_map"
#: The keys a block reads; anything else is said by the check.
KEYS = ("title", "layer", "layers", "plate", "proofs", "ground", "detail", "view",
        "base", "imagery", "hide", "colour", "proof points", "labels", "crowds", "north", "scale", "frame",
        "bounds", "timeline", "opens on", "speed", "step", "card", "size", "legend")
#: The bases a map is drawn on, the first the default.
BASES = ("satellite", "map", "topographic", "dark")
#: The imagery a satellite map's ground is filed from (`imagery:`), by its word: EOX's newest
#: Sentinel-2 cloudless year, or Esri World Imagery. A block that names none is filed from Esri.
IMAGERY_PROVIDERS = {"sentinel": cloudless.variant_id(cloudless.NEWEST), "esri": "esri-world-imagery"}
#: What the check before a public export says of a map on Esri imagery, word for word as the
#: map's card says it (`ESRI_TERMS` in `editor/mapText.js`). It never stops the export.
ESRI_TERMS = "Esri’s terms limit reuse, so publishing it is your responsibility."
#: What a feature's card may show, in its order.
CARD_PARTS = ("picture", "sentence", "source", "verify")
SIZES = ("half", "wide", "full")
LEGENDS = ("shown", "folded", "hidden")
#: How long Play stays on a day, in milliseconds, by its pace.
SPEEDS = {"slow": 2200, "normal": 1100, "fast": 550}
#: A crowd larger than this is a count to press (`BUBBLE_FROM` in reader.map.js).
CROWDS = 12
#: The map's own steps one block holds.
MAX_STEPS = 60
MAX_STEP_WORDS = 300
MAX_TITLE = 200
#: Layers one map names, features it draws, proofs it shows and icons it carries.
MAX_LAYERS = 12
MAX_FEATURES = 4000
MAX_PROOFS = 300
MAX_ICONS = 64
#: Sharper pictures one map lays over its ground, for the steps that look closer.
MAX_DETAILS = 8
#: The longest side of a detail picture in a page: a part of the map, seen close.
DETAIL_SIDE = 1600
#: Corners one line or area keeps: past it the shape is thinned, never cut.
MAX_CORNERS = 4000
#: Days one slider steps through.
MAX_DAYS = 500
#: What one map aims to weigh in a page, its ground, its pictures and its data together.
MAP_BYTES = 8 * 1024 * 1024
#: The width of the drawing's own units: every map is drawn on a frame this wide.
FRAME = 1600.0
#: How wide a map is read at in a page without script, for the size of its marks.
READ_WIDTH = 1100.0
#: A marker's side on the page, in CSS pixels, before its own size is applied.
MARKER_PX = 26.0
#: The colour of the proofs a map shows, and of the frame a map with no ground draws on.
PROOF_COLOUR = "#ffd640"
PLAIN_GROUND = "#e9e6df"
#: The words of the check, by what went wrong.
NO_GROUND = "has no ground picture, so it is drawn on a plain background"
#: How far a step about one proof moves in, in zoom levels past the map's own, and the
#: deepest it goes, as the map engine counts zoom.
PROOF_CLOSER = 2.0
PROOF_ZOOM = 15.0

DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PERIOD = re.compile(r"^(\d{4}-\d{2}-\d{2})?\s*\.\.\s*(\d{4}-\d{2}-\d{2})?$")
ENTITY_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
#: A name the case gives a layer or a plate: a file's stem, never a path.
NAME = re.compile(r"^[^/\\\x00-\x1f]{1,120}$")


# -- the block ---------------------------------------------------------------------------


@dataclass
class Step:
    """One of the map's own steps (`step:`): its day, its short name, where it looks
    (``lat, lon, zoom``), the proof whose card it opens and its words, each may be empty."""

    day: str = ""
    label: str = ""
    view: tuple[float, float, float] | None = None
    proof: str = ""
    words: str = ""


@dataclass
class MapBlock:
    """One `::: map` block as written."""

    title: str = ""
    layers: list[str] = field(default_factory=list)
    plate: str = ""
    proofs: str = ""
    ground: str = ""
    details: list[str] = field(default_factory=list)
    #: ``(lat, lon, zoom, bearing)``, the zoom as the map engine counts it.
    view: tuple[float, float, float, float] | None = None
    # -- how it is shown, each "" (or empty) for the default --
    base: str = ""
    #: ``sentinel`` or ``esri`` (`IMAGERY_PROVIDERS`), "" for the ground as filed.
    imagery: str = ""
    hidden: list[str] = field(default_factory=list)
    #: A layer's one colour, by its name.
    colours: dict[str, str] = field(default_factory=dict)
    proof_points: str = ""
    labels: str = ""
    #: "off", or how many marks make a crowd.
    crowds: str = ""
    north: str = ""
    scale: str = ""
    #: ``(west, south, east, north)``.
    frame: tuple[float, float, float, float] | None = None
    #: ``ground``: a live map's reader is kept inside the map's frame.
    bounds: str = ""
    timeline: str = ""
    opens_on: str = ""
    speed: str = ""
    steps: list[Step] = field(default_factory=list)
    #: What a card shows, None for all of it.
    card: list[str] | None = None
    size: str = ""
    legend: str = ""
    #: The lines the block could not read, as written.
    unread: list[str] = field(default_factory=list)
    #: Where in the block each name was written, by what it names (`layer:Front`, `ground`…),
    #: so the check points at its line.
    where: dict[str, int] = field(default_factory=dict)

    def period(self) -> tuple[str, str] | None:
        """The proofs' first and last day ("" for open), or None for no proofs."""
        return proof_period(self.proofs)

    def empty(self) -> bool:
        return not (self.layers or self.plate or self.proofs)

    def shown_base(self) -> str:
        """The base the map is drawn on: ``satellite`` unless it says another."""
        return self.base or BASES[0]

    def card_shows(self, part: str) -> bool:
        return self.card is None or part in self.card


def proof_period(written: str) -> tuple[str, str] | None:
    text = " ".join(str(written or "").split()).lower()
    if not text:
        return None
    if text == "all":
        return "", ""
    if DAY.match(text):
        return text, text
    match = PERIOD.match(text)
    if match is None or not (match.group(1) or match.group(2)):
        return None
    start, end = match.group(1) or "", match.group(2) or ""
    if start and end and end < start:
        start, end = end, start
    return start, end


#: The words each one-word setting takes, by its key.
CHOICES: dict[str, tuple[str, ...]] = {
    "base": BASES, "imagery": tuple(IMAGERY_PROVIDERS), "proof points": ("filmed", "every"), "labels": ("on", "off"),
    "north": ("on", "off"), "scale": ("on", "off"), "bounds": ("ground",), "timeline": ("on", "off"),
    "speed": tuple(SPEEDS), "size": SIZES, "legend": LEGENDS,
}
#: Where each setting of a block reads, as the attribute it fills.
FIELDS = {"base": "base", "imagery": "imagery", "proof points": "proof_points", "labels": "labels", "north": "north",
          "scale": "scale", "bounds": "bounds", "timeline": "timeline", "speed": "speed", "size": "size",
          "legend": "legend", "crowds": "crowds", "opens on": "opens_on"}


def parse_block(body: str) -> MapBlock:
    """A block's lines, read: the first `title`, `plate`, `proofs`, `ground` and `view`
    each, every `layer` in order, and how it is shown (the first of each setting, every
    `hide`, `colour` and `step` in order). A line it cannot read is kept to be said."""
    block = MapBlock()
    for offset, raw in enumerate(str(body or "").split("\n")):
        line = raw.strip()
        if not line or line.startswith("<!--"):
            continue
        key, colon, value = line.partition(":")
        key = " ".join(key.split()).lower()
        value = " ".join(value.split())
        if not colon or key not in KEYS:
            block.where.setdefault("unread", offset)
            block.unread.append(line[:120])
            continue
        block.where.setdefault(f"layer:{value[:120]}" if key in ("layer", "layers") else
                               f"detail:{value}" if key == "detail" else
                               f"hide:{value[:120]}" if key == "hide" else key, offset)
        if key in KEYS[KEYS.index("base"):]:
            if not _setting(block, key, value):
                block.where.setdefault("unread", offset)
                block.unread.append(line[:120])
            continue
        if key in ("layer", "layers"):
            if value and value not in block.layers and len(block.layers) < MAX_LAYERS:
                block.layers.append(value[:120])
        elif key == "title":
            block.title = block.title or value[:MAX_TITLE]
        elif key == "plate":
            block.plate = block.plate or value[:120]
        elif key == "proofs":
            if block.proofs:
                continue
            if proof_period(value) is None:
                block.unread.append(line[:120])
            else:
                block.proofs = value
        elif key == "ground":
            block.ground = block.ground or value
        elif key == "detail":
            if value and value not in block.details and len(block.details) < MAX_DETAILS:
                block.details.append(value)
        elif key == "view" and block.view is None:
            view = _view_of(value)
            if view is None:
                block.unread.append(line[:120])
            else:
                block.view = view
    return block


def _setting(block: MapBlock, key: str, value: str) -> bool:
    """Read one line of how the map is shown into ``block``; False when it says nothing
    the block can read. A second line of a one-line setting is left as the first said."""
    word = value.lower()
    if key in CHOICES:
        if word not in CHOICES[key]:
            return False
        if not getattr(block, FIELDS[key]):
            setattr(block, FIELDS[key], word)
        return True
    if key == "crowds":
        if word != "off" and not (word.isdecimal() and 2 <= int(word) <= 99):
            return False
        block.crowds = block.crowds or word
        return True
    if key == "opens on":
        if not DAY.match(word):
            return False
        block.opens_on = block.opens_on or word
        return True
    if key == "hide":
        if not NAME.match(value):
            return False
        if value not in block.hidden and len(block.hidden) < MAX_LAYERS * 2:
            block.hidden.append(value[:120])
        return True
    if key == "colour":
        name, equals, colour = value.rpartition("=")
        name = name.strip()
        if not equals or not NAME.match(name) or not _hex(colour):
            return False
        block.colours.setdefault(name[:120], _hex(colour))
        return True
    if key == "frame":
        frame = frame_of_text(value)
        if frame is None:
            return False
        block.frame = block.frame or frame
        return True
    if key == "card":
        parts = [part.strip().lower() for part in value.split(",") if part.strip()]
        if parts == ["none"]:
            parts = []
        if any(part not in CARD_PARTS for part in parts):
            return False
        if block.card is None:
            block.card = [part for part in CARD_PARTS if part in parts]
        return True
    if key == "step":
        step = step_of_text(value)
        if step is None:
            return False
        if len(block.steps) < MAX_STEPS:
            block.steps.append(step)
        return True
    return False


def frame_of_text(text: str) -> tuple[float, float, float, float] | None:
    """``west, south, east, north`` read, or None when it is no part of the world."""
    try:
        numbers = [float(part) for part in text.replace(";", ",").split(",") if part.strip()]
    except ValueError:
        return None
    if len(numbers) != 4 or not all(math.isfinite(number) for number in numbers):
        return None
    west, south, east, north = numbers
    if not (-180 <= west < east <= 180 and -85 <= south < north <= 85):
        return None
    return west, south, east, north


def step_of_text(text: str) -> Step | None:
    """A ``step:`` line's parts, ``day | label | lat, lon, zoom | proof | words``: any
    may be empty, the words may hold a ``|`` of their own."""
    parts = [part.strip() for part in text.split("|", 4)]
    parts += [""] * (5 - len(parts))
    day, label, where, proof, words = parts
    if day and not DAY.match(day):
        return None
    if proof and not ENTITY_ID.match(proof):
        return None
    view = None
    if where:
        read = _view_of(where)
        if read is None:
            return None
        view = read[:3]
    if not (day or label or view or proof or words):
        return None
    return Step(day=day, label=label[:80], view=view, proof=proof, words=words[:MAX_STEP_WORDS])


def step_text(step: Step) -> str:
    """A step as its line writes it, its empty tail left off."""
    where = ""
    if step.view is not None:
        lat, lon, zoom = step.view
        where = f"{lat:.5f}, {lon:.5f}, {_num(zoom, 2)}"
    parts = [step.day, " ".join(step.label.split()), where, step.proof, " ".join(step.words.split())]
    while parts and not parts[-1]:
        parts.pop()
    return " | ".join(parts)


def _view_of(text: str) -> tuple[float, float, float, float] | None:
    try:
        numbers = [float(part) for part in text.replace(";", ",").split(",") if part.strip()]
    except ValueError:
        return None
    if len(numbers) not in (3, 4) or not all(math.isfinite(number) for number in numbers):
        return None
    lat, lon, zoom = numbers[:3]
    bearing = numbers[3] if len(numbers) == 4 else 0.0
    if not (-85 <= lat <= 85 and -180 <= lon <= 180 and 0 <= zoom <= 22):
        return None
    return lat, lon, zoom, bearing % 360


def block_text(block: MapBlock) -> str:
    """The block as the Notebook writes it."""
    lines = ["::: map"]
    if block.title:
        lines.append(f"title: {' '.join(block.title.split())[:MAX_TITLE]}")
    if block.plate:
        lines.append(f"plate: {block.plate}")
    lines.extend(f"layer: {name}" for name in block.layers)
    if block.proofs:
        lines.append(f"proofs: {block.proofs}")
    if block.ground:
        lines.append(f"ground: {block.ground}")
    lines.extend(f"detail: {detail}" for detail in block.details)
    if block.view is not None:
        lat, lon, zoom, bearing = block.view
        tail = f", {_num(bearing, 1)}" if round(bearing, 1) % 360 else ""
        lines.append(f"view: {lat:.5f}, {lon:.5f}, {_num(zoom, 2)}{tail}")
    lines.extend(settings_lines(block))
    lines.append(":::")
    return "\n".join(lines)


def settings_lines(block: MapBlock) -> list[str]:
    """How the map is shown, as the lines the Notebook writes after its `view`, in the
    order the settings card writes them (`MAP_ORDER` in `editor/mapText.js`)."""
    lines: list[str] = []
    if block.base and block.base != BASES[0]:
        lines.append(f"base: {block.base}")
    if block.imagery:
        lines.append(f"imagery: {block.imagery}")
    lines.extend(f"hide: {name}" for name in block.hidden)
    lines.extend(f"colour: {name} = {colour}" for name, colour in block.colours.items())
    for key in ("proof points", "labels", "crowds"):
        if getattr(block, FIELDS[key]):
            lines.append(f"{key}: {getattr(block, FIELDS[key])}")
    if block.north:
        lines.append(f"north: {block.north}")
    if block.scale:
        lines.append(f"scale: {block.scale}")
    if block.frame is not None:
        lines.append("frame: " + ", ".join(f"{value:.5f}" for value in block.frame))
    if block.bounds:
        lines.append(f"bounds: {block.bounds}")
    for key in ("timeline", "opens on", "speed"):
        if getattr(block, FIELDS[key]):
            lines.append(f"{key}: {getattr(block, FIELDS[key])}")
    if block.card is not None:
        lines.append(f"card: {', '.join(block.card) or 'none'}")
    for key in ("size", "legend"):
        if getattr(block, FIELDS[key]):
            lines.append(f"{key}: {getattr(block, FIELDS[key])}")
    lines.extend(step_line(step) for step in block.steps)
    return lines


def step_line(step: Step) -> str:
    """A step's whole line, `step:` and its parts."""
    text = step_text(step)
    return f"step:{text}" if text.startswith(" ") else f"step: {text}"


def blocks_in(text: str) -> list[MapBlock]:
    """Every map block a note's text holds, outside code fences."""
    found: list[MapBlock] = []
    lines = str(text or "").split("\n")
    fenced = False
    index = 0
    while index < len(lines):
        line = lines[index]
        if re.match(r"^\s*(```|~~~)", line):
            fenced = not fenced
        elif not fenced and re.match(r"^:::[ \t]*map[ \t]*$", line):
            end = index + 1
            while end < len(lines) and not re.match(r"^:::[ \t]*$", lines[end]):
                end += 1
            if end < len(lines):
                found.append(parse_block("\n".join(lines[index + 1:end])))
                index = end
        index += 1
    return found


# -- the projection ------------------------------------------------------------------------


def mercator(lon: float, lat: float) -> tuple[float, float]:
    """A point on the Web Mercator square, both 0 to 1, y downwards."""
    lat = max(-85.05112878, min(85.05112878, lat))
    sine = math.sin(math.radians(lat))
    return (lon + 180.0) / 360.0, 0.5 - math.log((1 + sine) / (1 - sine)) / (4 * math.pi)


def unmercator(x: float, y: float) -> tuple[float, float]:
    lon = x * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y))))
    return lon, lat


def bounds_of_view(lat: float, lon: float, zoom: float, width: float, height: float) -> list[float]:
    """The ``[w, s, e, n]`` a view of ``width`` × ``height`` pixels shows, the zoom as the
    map engine counts it (a 512-pixel world at zoom 0)."""
    world = 512.0 * 2 ** zoom
    x, y = mercator(lon, lat)
    west, north = unmercator(x - width / 2 / world, y - height / 2 / world)
    east, south = unmercator(x + width / 2 / world, y + height / 2 / world)
    return [_round(west), _round(south), _round(east), _round(north)]


def fit_view(bounds: list[float], width: float, height: float, *, pad: float = 0.08,
             most: float = 16.0) -> tuple[float, float, float]:
    """``(lat, lon, zoom)`` showing ``bounds`` whole in a frame of ``width`` × ``height``."""
    west, south, east, north = bounds
    x0, y0 = mercator(west, north)
    x1, y1 = mercator(east, south)
    span_x, span_y = max(x1 - x0, 1e-9), max(y1 - y0, 1e-9)
    zoom = math.log2(min(width * (1 - 2 * pad) / span_x, height * (1 - 2 * pad) / span_y) / 512.0)
    lon, lat = unmercator((x0 + x1) / 2, (y0 + y1) / 2)
    return lat, lon, max(1.0, min(most, zoom))


def frame_of(bounds: list[float]) -> tuple[float, float]:
    """The drawing's frame for these bounds: `FRAME` wide, as tall as the bounds are."""
    west, south, east, north = bounds
    x0, y0 = mercator(west, north)
    x1, y1 = mercator(east, south)
    ratio = max(y1 - y0, 1e-9) / max(x1 - x0, 1e-9)
    return FRAME, round(FRAME * max(0.2, min(ratio, 3.0)), 1)


class _Projector:
    """Longitude and latitude to the drawing's units."""

    def __init__(self, bounds: list[float]) -> None:
        west, south, east, north = bounds
        self.x0, self.y0 = mercator(west, north)
        x1, y1 = mercator(east, south)
        self.width, self.height = frame_of(bounds)
        self.sx = self.width / max(x1 - self.x0, 1e-12)
        self.sy = self.height / max(y1 - self.y0, 1e-12)

    def __call__(self, lon: float, lat: float) -> tuple[float, float]:
        x, y = mercator(lon, lat)
        return (x - self.x0) * self.sx, (y - self.y0) * self.sy


# -- what a map shows --------------------------------------------------------------------------

#: A case picture made ready for a page: its address and its size, or None.
Encode = Callable[[Path, int], "tuple[str, tuple[int, int]] | None"]


@dataclass
class Derived:
    """A map read from the case: the data every reader of it shares, and what the
    check before export should say about it."""

    data: dict[str, Any]
    #: (message, kind, line), kind as `notes_markdown.WARNING_KINDS` names them and line
    #: the block's own line it is about (0 for its first), or None for the whole block.
    warnings: list[tuple[str, str, int | None]] = field(default_factory=list)
    #: The ground's file, for a renderer that draws it from the disk.
    ground: Path | None = None
    #: The points of view the map shows, named, for the check.
    pov: list[str] = field(default_factory=list)
    #: The legend's rows: ``{label, layer, kind, style, count}``.
    legend: list[dict[str, Any]] = field(default_factory=list)
    #: The pictograms its markers wear, by their key: a symbol, or a layer's own icon.
    icons: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: What it adds to a page, in bytes, as encoded.
    weight: int = 0
    #: The proof each of its steps is about, by the step's id, for the settings card.
    step_proofs: dict[str, str] = field(default_factory=dict)
    #: Each proof shown, by its id: the features it is and its name.
    proofs: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: How the figure is laid out in a page: its ``size`` and ``legend``, when set.
    display: dict[str, str] = field(default_factory=dict)


def derive(
    case: "Case | None",
    block: MapBlock,
    *,
    encode: Encode | None = None,
    anchors: Mapping[str, str] | None = None,
    round_pov: bool = False,
    ground_side: int = 2400,
    card_side: int = 640,
) -> Derived:
    """The map ``block`` names, read from the case.

    ``encode`` makes a case picture ready for a page (the ground at ``ground_side``,
    a card's at ``card_side``); without it the map carries no picture. ``anchors``
    names the figure each proof is shown in on the page (`#fig-3`), which its card
    links to. ``round_pov`` moves each point of view to a grid about 150 m wide,
    as the export does when asked.
    """
    anchors = anchors or {}
    title = block.title or "Map"
    said = f'The map "{_cut(title, 60)}"'
    out = Derived(data={})

    def warn(message: str, kind: str, key: str | None = None) -> None:
        out.warnings.append((message, kind, block.where.get(key) if key else None))

    features: list[dict[str, Any]] = []
    steps: list[dict[str, Any]] = []
    extra_days: set[str] = set()
    credits: list[str] = []
    view = block.view
    first_day = ""
    hidden = set(block.hidden)
    pictured = block.card_shows("picture")
    if block.unread:
        warn(f'{said} reads no line "{_cut(block.unread[0], 60)}".', "other", "unread")
    if block.empty():
        warn(f"{said} names no layer, plate or proofs.", "missing")
    if case is not None:
        sources: list[tuple[str, dict[str, Any] | None]] = [(name, None) for name in block.layers]
        if block.plate:
            plate = _plate(case, block.plate)
            if plate is None:
                warn(f'{said} names a plate no longer in the case: "{_cut(block.plate, 60)}".', "missing", "plate")
            else:
                sources = [*plate["layers"], *sources]
                steps.extend(plate["steps"])
                extra_days.update(plate["days"])
                first_day = plate["at"]
                if view is None and plate["view"] is not None:
                    view = plate["view"]
        icons = _Icons(case)
        for index, (name, frame) in enumerate(sources):
            if name in hidden:
                continue
            read = _layer_features(case, name, index, frame, icons, colour=block.colours.get(name, ""),
                                   labels=block.labels)
            if read is None:
                warn(f'{said} names a layer no longer in the case: "{_cut(name, 60)}".', "missing",
                     f"layer:{name}" if f"layer:{name}" in block.where else "plate")
                continue
            layer_features, legend, credit = read
            features.extend(layer_features)
            out.legend.extend(legend)
            if credit and credit not in credits:
                credits.append(credit)
        period = block.period()
        if period is not None:
            shown, proof_steps = _proofs(case, period, encode=encode if pictured else None, anchors=anchors,
                                         round_pov=round_pov, card_side=card_side, out=out,
                                         filmed=block.proof_points == "filmed", labels=block.labels)
            features.extend(shown)
            if not steps:
                steps.extend(proof_steps)
            if not shown:
                warn(f"{said} finds no proof dated in its period.", "other", "proofs")
        out.icons = icons.used
        if len(features) > MAX_FEATURES:
            warn(f"{said} draws its first {MAX_FEATURES} features of {len(features)}.", "other")
            features = features[:MAX_FEATURES]
        _cards_proofs(case, features, anchors=anchors)
        _cards_media(case, features, encode=encode if pictured else None, card_side=card_side, out=out)
        if block.steps:
            steps = _own_steps(block.steps, out)
    ground = _ground(case, block.ground, encode=encode, side=ground_side) if case is not None and block.ground else None
    if block.ground and ground is None and case is not None:
        warn(f"{said}: its ground picture is no longer in the case.", "missing", "ground")
    elif not block.ground:
        warn(f"{said} {NO_GROUND}.", "other")
    if ground is not None:
        out.ground = ground["path"]
        if block.shown_base() != BASES[0] and ground["credit"].startswith("Imagery: "):
            # a street or a topographic map under the marks is a map, and its credit says so
            ground["credit"] = "Map: " + ground["credit"][len("Imagery: "):]
        if ground["credit"] and ground["credit"] not in credits:
            credits.insert(0, ground["credit"])
        out.weight += len(ground["src"])
    details: list[dict[str, Any]] = []
    for entity_id in block.details:
        detail = _ground(case, entity_id, encode=encode, side=min(ground_side, DETAIL_SIDE)) if case is not None else None
        if detail is None:
            warn(f"{said}: a detail picture of it is no longer in the case.", "missing", f"detail:{entity_id}")
            continue
        out.weight += len(detail["src"])
        details.append({"src": detail["src"], "bounds": detail["bounds"], "size": list(detail["size"]), "id": entity_id})
        if block.shown_base() != BASES[0] and detail["credit"].startswith("Imagery: "):
            detail["credit"] = "Map: " + detail["credit"][len("Imagery: "):]
        if detail["credit"] and detail["credit"] not in credits:
            credits.append(detail["credit"])
    bounds = ground["bounds"] if ground is not None else _features_bounds(features, view)
    if block.frame is not None:
        bounds = [_round(value) for value in block.frame]
    if view is None or block.frame is not None:
        width, height = 1200.0, 1200.0 * frame_of(bounds)[1] / FRAME
        lat, lon, zoom = fit_view(bounds, width, height, pad=0)
        view = (lat, lon, zoom, 0.0)
    if block.opens_on:
        extra_days.add(block.opens_on)
    days = _days(features, extra_days)
    day = first_day if first_day in days else (days[-1] if days else "")
    if block.opens_on in days:
        day = block.opens_on
    if block.card is not None:
        _cards_trimmed(features, block.card)
    for feature in features:
        # a line's or an area's name is written where it reads best: where the analyst put it, else its middle
        if feature["kind"] != "point" and feature["style"].get("label") and feature.get("label"):
            spot = label_anchor(feature)
            if spot is not None:
                feature["at"] = spot
        feature.pop("label_at", None)
    for step in steps:
        # a step about one proof moves in on it, as far as the ground stays sharp
        if isinstance(step.get("view"), dict) and step["view"].get("zoom") is None:
            step["view"]["zoom"] = _num(min(PROOF_ZOOM, view[2] + PROOF_CLOSER), 2)
        if step.get("view") is None:
            step["view"] = {"center": [_round(view[1]), _round(view[0])], "zoom": _num(view[2], 2),
                            "bearing": _num(view[3], 1), "pitch": 0}
    data: dict[str, Any] = {
        "version": 1,
        "title": block.title,
        "view": {"center": [_round(view[1]), _round(view[0])], "zoom": _num(view[2], 2), "bearing": _num(view[3], 1)},
        "bounds": bounds,
        "ground": None if ground is None else {
            "src": ground["src"], "bounds": ground["bounds"], "credit": ground["credit"],
            "size": list(ground["size"]),
        },
        "details": [{key: value for key, value in detail.items() if key != "id"} for detail in details],
        "days": days,
        "day": day,
        "features": features,
        "steps": steps,
        "credits": credits,
    }
    data.update(_shown(block))
    streamed = live_imagery(block)
    if streamed is not None:
        data["imagery"] = streamed
    opens = _opening(block.view, bounds)
    if opens is not None:
        data["opens"] = opens
    out.display = {key: value for key, value in (("size", block.size), ("legend", block.legend)) if value}
    out.data = data
    out.weight += len(json.dumps(data, separators=(",", ":"), ensure_ascii=False)) - (len(ground["src"]) if ground else 0)
    if out.weight > MAP_BYTES:
        warn(f"{said} weighs {out.weight / 1048576:.1f} MB, past the {MAP_BYTES // 1048576} MB a map aims for.",
             "other")
    return out


def _shown(block: MapBlock) -> dict[str, Any]:
    """What a reader of the map does differently from its defaults, as its data says it:
    nothing for a block that sets nothing, so an old map's data is what it was."""
    shown: dict[str, Any] = {}
    if block.base and block.base != BASES[0]:
        shown["base"] = block.base
    if block.crowds:
        shown["crowds"] = 0 if block.crowds == "off" else int(block.crowds)
    if block.north == "on":
        shown["north"] = True
    if block.scale:
        shown["scale"] = block.scale
    if block.bounds == "ground":
        shown["inside"] = True
    if block.timeline == "off":
        shown["timeline"] = False
    if block.speed and block.speed != "normal":
        shown["speed"] = SPEEDS[block.speed]
    return shown


def live_imagery(block: MapBlock) -> dict[str, Any] | None:
    """The imagery a web folder's live map streams in the reader's browser for a satellite map
    that names one (`imagery:`): its tiles, the level its own pixels stop at, its credit and
    where the credit links; None keeps the ground as filed. Azimut fetches none of it."""
    if not block.imagery or block.shown_base() != BASES[0]:
        return None
    provider = tiles.get_provider(IMAGERY_PROVIDERS[block.imagery])
    if block.imagery == "sentinel":
        return {"tiles": provider.url, "native": cloudless.MAX_NATIVE_ZOOM, "name": f"Sentinel-2, {cloudless.MOSAIC}",
                "credit": f"Imagery: {provider.attribution}, {cloudless.MOSAIC}", "link": cloudless.SITE}
    return {"tiles": provider.url, "native": provider.max_zoom, "name": provider.label,
            "credit": f"Imagery: {provider.attribution}"}


#: Where a view frames the world (`view:`), as the card's Draw tab and a put measure it.
VIEW_FRAME = (1200.0, 750.0)


def _opening(view: tuple[float, float, float, float] | None, bounds: list[float]) -> list[float] | None:
    """Where the page opens the map: the part of its frame its ``view`` shows (Draw › *Open
    here*), or None for the whole map, which a view that frames all of it, as a put writes
    it, always is."""
    if view is None:
        return None
    west, south, east, north = bounds_of_view(view[0], view[1], view[2], *VIEW_FRAME)
    west, south = max(west, bounds[0]), max(south, bounds[1])
    east, north = min(east, bounds[2]), min(north, bounds[3])
    if east <= west or north <= south:
        return None
    if east - west > (bounds[2] - bounds[0]) * 0.9 and north - south > (bounds[3] - bounds[1]) * 0.9:
        return None
    return [_round(value) for value in (west, south, east, north)]


def _own_steps(written: list[Step], out: Derived) -> list[dict[str, Any]]:
    """The map's own steps, in their order: each flies where it says (the map's own view
    when it says nothing) on its day, a proof's step opening its card."""
    steps: list[dict[str, Any]] = []
    out.step_proofs = {}
    for number, step in enumerate(written):
        ident = f"s{number}"
        proof = out.proofs.get(step.proof) if step.proof else None
        view: dict[str, Any] | None = None
        if step.view is not None:
            lat, lon, zoom = step.view
            view = {"center": [_round(lon), _round(lat)], "zoom": _num(zoom, 2), "bearing": 0, "pitch": 0}
        elif proof is not None:
            view = {"center": list(proof["center"]), "zoom": None, "bearing": 0, "pitch": 0}
        made: dict[str, Any] = {"id": ident, "label": _cut(step.label, 80), "day": step.day or None, "view": view,
                                "focus": list(proof["ids"]) if proof is not None else []}
        if step.words:
            made["text"] = _cut(step.words, MAX_STEP_WORDS)
        if proof is not None:
            made["name"] = proof["name"]
        if step.proof:
            out.step_proofs[ident] = step.proof
        steps.append(made)
    return steps


def _cards_trimmed(features: list[dict[str, Any]], shown: list[str]) -> None:
    """Each card says only what the block asks: its picture, its sentence, its source
    and the links that check it."""
    dropped = {"picture": ("media",), "sentence": ("text", "rows", "history"), "source": ("source", "links"),
               "verify": ("verify",)}
    for feature in features:
        card = feature.get("card")
        if not isinstance(card, dict):
            continue
        for part, keys in dropped.items():
            if part not in shown:
                for key in keys:
                    card.pop(key, None)


def _features_bounds(features: list[dict[str, Any]], view: tuple[float, float, float, float] | None) -> list[float]:
    points = list(_all_points(features))
    if view is not None:
        lat, lon, zoom, _ = view
        return bounds_of_view(lat, lon, zoom, 1200, 750)
    if not points:
        return [-10.0, -10.0, 10.0, 10.0]
    west = min(point[0] for point in points)
    east = max(point[0] for point in points)
    south = min(point[1] for point in points)
    north = max(point[1] for point in points)
    pad_x = max((east - west) * 0.08, 0.004)
    pad_y = max((north - south) * 0.08, 0.004)
    return [_round(west - pad_x), _round(south - pad_y), _round(east + pad_x), _round(north + pad_y)]


def _all_points(features: Iterable[dict[str, Any]]) -> Iterator[tuple[float, float]]:
    for feature in features:
        coords: Any = feature.get("coords") or []
        if feature.get("kind") == "point":
            yield coords[0], coords[1]
        elif feature.get("kind") == "line":
            yield from ((point[0], point[1]) for part in coords for point in part)
        else:
            yield from ((point[0], point[1]) for polygon in coords for ring in polygon for point in ring)


def label_anchor(feature: Mapping[str, Any]) -> list[float] | None:
    """Where a line's or an area's name is written: where the analyst put it on the map
    (`label_at`), else halfway along its longest part, or the middle of its largest area
    (its centroid, as the map's own square reads it)."""
    from .layerediting import label_place_of

    placed = label_place_of(feature.get("label_at"))
    if placed is not None:
        return [_round(placed[0]), _round(placed[1])]
    coords: Any = feature.get("coords") or []
    try:
        if feature.get("kind") == "line":
            parts = [part for part in coords if len(part) >= 2]
            if not parts:
                return None
            longest = max(parts, key=_length)
            half, walked = _length(longest) / 2, 0.0
            for (x0, y0), (x1, y1) in zip((mercator(*point) for point in longest), (mercator(*point) for point in longest[1:])):
                step = math.hypot(x1 - x0, y1 - y0)
                if walked + step >= half and step > 0:
                    t = (half - walked) / step
                    lon, lat = unmercator(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
                    return [_round(lon), _round(lat)]
                walked += step
            return [_round(longest[-1][0]), _round(longest[-1][1])]
        if feature.get("kind") == "area":
            rings = [polygon[0] for polygon in coords if polygon and len(polygon[0]) >= 3]
            if not rings:
                return None
            ring = [mercator(*point) for point in max(rings, key=lambda one: abs(_area([mercator(*p) for p in one])))]
            twice = _area(ring) * 2
            if abs(twice) < 1e-18:
                x = sum(point[0] for point in ring) / len(ring)
                y = sum(point[1] for point in ring) / len(ring)
            else:
                x = sum((a[0] + b[0]) * (a[0] * b[1] - b[0] * a[1]) for a, b in zip(ring, ring[1:] + ring[:1])) / (3 * twice)
                y = sum((a[1] + b[1]) * (a[0] * b[1] - b[0] * a[1]) for a, b in zip(ring, ring[1:] + ring[:1])) / (3 * twice)
            lon, lat = unmercator(x, y)
            return [_round(lon), _round(lat)]
    except (TypeError, ValueError, IndexError):
        return None
    return None


def _length(points: list[list[float]]) -> float:
    corners = [mercator(*point) for point in points]
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(corners, corners[1:]))


def _area(ring: list[tuple[float, float]]) -> float:
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1])) / 2


def _days(features: list[dict[str, Any]], extra: Iterable[str]) -> list[str]:
    """The days a slider stops on: each day something appears or goes, and the
    plate's own."""
    days: set[str] = {day for day in extra if DAY.match(day or "")}
    for feature in features:
        if feature.get("from"):
            days.add(feature["from"])
        if feature.get("until"):
            days.add(_next_day(feature["until"]))
    ordered = sorted(days)
    return ordered[-MAX_DAYS:]


def _next_day(day: str) -> str:
    try:
        return (date.fromisoformat(day) + timedelta(days=1)).isoformat()
    except ValueError:
        return day


def traces(features: Iterable[Mapping[str, Any]], day: str) -> set[str]:
    """The lines and areas no longer there on ``day`` whose last place is drawn faint:
    each one's latest state gone by then, whether it moved on or left the map."""
    latest: dict[str, Mapping[str, Any]] = {}
    for feature in features:
        until = feature.get("until")
        if feature.get("kind") == "point" or not day or not until or until >= day or not feature.get("of"):
            continue
        held = latest.get(feature["of"])
        if held is None or str(held.get("until")) < until:
            latest[feature["of"]] = feature
    return {str(feature["id"]) for feature in latest.values()}


def shows_on(feature: Mapping[str, Any], day: str) -> bool:
    """Whether a feature is on the map on ``day`` ("" for every feature)."""
    if not day:
        return True
    start, end = feature.get("from"), feature.get("until")
    return (not start or start <= day) and (not end or day <= end)


# -- layers ---------------------------------------------------------------------------------


def _layer_features(case: "Case", name: str, index: int, frame: dict[str, Any] | None,
                    icons: "_Icons", *, colour: str = "", labels: str = ""
                    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str] | None:
    """One layer's features as a map shows them, its legend rows and its credit; None
    when the case holds no such layer. ``frame`` is how a plate draws it, ``colour`` the
    one colour the block paints it in, ``labels`` whether every name is written."""
    from . import layerediting, maplayers

    if not NAME.match(name or ""):
        return None
    try:
        spec = maplayers._read_spec(case, name)
    except Exception:
        return None
    title = str(spec.get("title") or name)
    editable = layerediting.editable(spec) and isinstance((spec.get("document") or {}).get("features"), list)
    try:
        if editable:
            drawn = layerediting.drawing(spec, case)["geojson"]
        else:
            drawn = json.loads(maplayers.drawing(case, name).read_text(encoding="utf-8"))
    except Exception:
        return None
    window = None
    if editable:
        track = layerediting.track(spec)
        window = track.get("window") if track else None
    hidden = set(spec.get("hidden") or []) if frame is None else set(frame.get("hidden") or [])
    hidden_features = set(frame.get("hidden_features") or []) if frame else set()
    start = (frame or {}).get("start") or ""
    end = (frame or {}).get("end") or ""
    has_icons = bool((spec.get("snapshot") or {}).get("icons")) or editable
    features: list[dict[str, Any]] = []
    legend: dict[tuple[str, str], dict[str, Any]] = {}
    raw = drawn.get("features") if isinstance(drawn, dict) else None
    for number, feature in enumerate(raw if isinstance(raw, list) else []):
        if not isinstance(feature, dict) or not isinstance(feature.get("properties"), dict):
            continue
        properties = feature["properties"]
        category = str(properties.get("category") or "")
        key = str(properties.get("key") or number)
        if category in hidden or key in hidden_features:
            continue
        style = _style(properties, frame)
        style.pop("status", None)
        if colour:
            style["color"] = colour
        if labels == "on" and str(properties.get("name") or "").strip():
            style["label"] = True
        elif labels == "off":
            style.pop("label", None)
        icon = str(properties.get("icon") or "")
        symbol = str(properties.get("symbol") or "pin")
        # a line's or an area's name the analyst put somewhere by hand, written once, there
        placed = layerediting.label_place_of(properties.get("label_at")) if editable else None
        states = list(_states(properties, feature.get("geometry"), window))
        history = _history(states)
        for state, (geometry, status, first, last) in enumerate(states):
            if start and first and first < start:
                continue
            if end and first and first > end:
                continue
            for part, (kind, coords) in enumerate(_shapes(geometry)):
                shaped = dict(style)
                if status in ("damaged", "destroyed"):
                    shaped["status"] = status
                if kind == "point":
                    marks = {"status": shaped.get("status", ""), "external": bool(shaped.get("external"))}
                    own = icons.layer_icon(name, icon, properties, **marks) if icon and has_icons else ""
                    shaped["icon"] = own or icons.symbol(symbol, shaped["color"], **marks)
                    # a plain marker stands on its tip, as the map anchors it; a badge or an icon on its middle
                    if not own and shaped["icon"].startswith("s-") and not icons.badge(symbol):
                        shaped["tip"] = True
                else:
                    shaped.pop("bearing", None)
                    if placed and part:
                        shaped.pop("label", None)
                card = _layer_card(properties, title, first, last, status=status, kind=kind, coords=coords,
                                   columns=not editable)
                if history:
                    card["history"] = history
                ident = f"l{index}f{number}" + (f"s{state}" if state else "") + (f"p{part}" if part else "")
                features.append({
                    "id": ident,
                    "kind": kind,
                    "coords": coords,
                    "from": first or None,
                    "until": last or None,
                    "label": _cut(" ".join(str(properties.get("name") or "").split()), 120),
                    "style": shaped,
                    "card": card,
                    "of": f"l{index}f{number}",
                    "layer": title,
                    "group": category,
                    "entity": str(properties.get("entity_id") or "") or None,
                    "picture": str(properties.get("picture") or "") or None,
                    # read once by `label_anchor`, never kept in the map's data
                    **({"label_at": placed} if placed and kind != "point" and not part else {}),
                })
                row = legend.setdefault((category, kind), {
                    "label": category if category and category != layerediting.DEFAULT_GROUP else "",
                    "layer": title, "kind": kind, "style": shaped, "count": 0, "names": [], "group": category,
                })
                if not state and len(row["names"]) < 2:
                    row["names"].append(_cut(" ".join(str(properties.get("name") or "").split()), 60))
                row["count"] += 1 if not state else 0
    for row in legend.values():
        # a group with no name of its own says what its one feature is, else whose layer it is
        names = row.pop("names")
        row["label"] = row["label"] or (names[0] if row["count"] == 1 and names and names[0] else title)
    credit = ""
    source = spec.get("source") or {}
    if source.get("kind") in ("url", maplayers.GEOCONFIRMED) and source.get("url"):
        credit = f"Layer: {title}, {notesources.host(str(source['url']))}"
    return features, list(legend.values()), credit


def _style(properties: Mapping[str, Any], frame: Mapping[str, Any] | None) -> dict[str, Any]:
    colour = _hex(properties.get("colour")) or "#0072b2"
    if frame and _hex(frame.get("colour")):
        colour = _hex(frame.get("colour"))
    style: dict[str, Any] = {"color": colour}
    width = _number(properties.get("stroke_width"), 2.0) * _number((frame or {}).get("stroke"), 1.0)
    style["width"] = round(max(0.5, min(width, 12.0)), 2)
    dash = (frame or {}).get("dash") or properties.get("line_dash") or ""
    if dash in ("dashed", "dotted"):
        style["dash"] = dash
    fill = (frame or {}).get("fill") or properties.get("area_fill") or ""
    if fill in ("none", "hatch", "solid"):
        style["fill"] = fill
    opacity = properties.get("fill_opacity")
    if isinstance(opacity, (int, float)) and 0 <= opacity <= 1:
        style["opacity"] = round(float(opacity), 2)
    if (frame or {}).get("opacity") not in (None, 1, 1.0):
        style["alpha"] = round(float(frame["opacity"]), 2)  # type: ignore[index]
    size = _number(properties.get("icon_scale"), 1.0) * _number((frame or {}).get("icons"), 1.0)
    style["size"] = round(max(0.4, min(size, 3.0)), 2)
    if properties.get("status") in ("damaged", "destroyed"):
        style["status"] = properties["status"]
    if properties.get("show_label"):
        style["label"] = True
    if properties.get("line_arrow") in ("end", "both"):
        style["arrow"] = properties["line_arrow"]
    if properties.get("confidence") in ("probable", "claimed"):
        style["confidence"] = properties["confidence"]
    # which way a marker looks, a point somebody else geolocated, and how large its name is written
    bearing = properties.get("bearing")
    if isinstance(bearing, (int, float)) and not isinstance(bearing, bool) and math.isfinite(bearing):
        style["bearing"] = round(float(bearing) % 360, 1)
    if properties.get("provenance") == "external":
        style["external"] = True
    label_size = properties.get("label_size")
    if isinstance(label_size, (int, float)) and not isinstance(label_size, bool) and 6 <= label_size <= 32:
        style["label_size"] = round(float(label_size), 1)
    return style


def _states(properties: Mapping[str, Any], geometry: Any, window: int | None
            ) -> Iterator[tuple[Any, str, str, str]]:
    """Each shape a feature had, its status and its first and last day ("" for open):
    one for a feature with no history, one a state for one followed over time."""
    states = properties.get("states")
    if isinstance(states, list) and states:
        ordered = [state for state in states if isinstance(state, dict) and isinstance(state.get("at"), str)]
        ordered.sort(key=lambda state: state["at"])
        for position, state in enumerate(ordered):
            if state.get("gone") or not isinstance(state.get("geometry"), dict):
                continue
            first = state["at"][:10]
            following = ordered[position + 1]["at"][:10] if position + 1 < len(ordered) else ""
            last = ""
            if following:
                try:
                    last = (date.fromisoformat(following) - timedelta(days=1)).isoformat()
                except ValueError:
                    last = ""
                # a state that gave way the same day is never what a day ends on
                if first and last < first:
                    continue
            yield state["geometry"], str(state.get("status") or ""), first, last
        return
    first = str(properties.get("date") or "")[:10]
    last = str(properties.get("date_end") or "")[:10]
    first = first if DAY.match(first) else ""
    last = last if DAY.match(last) else ""
    if properties.get("event") and first and window is not None and not last:
        try:
            last = (date.fromisoformat(first) + timedelta(days=int(window))).isoformat()
        except (TypeError, ValueError):
            last = ""
    yield geometry, str(properties.get("status") or ""), first, last


def _shapes(geometry: Any) -> Iterator[tuple[str, Any]]:
    """A GeoJSON geometry as the shapes a map draws: points, lines and areas, each a part."""
    if not isinstance(geometry, dict):
        return
    kind = geometry.get("type")
    coords: Any = geometry.get("coordinates")
    try:
        if kind == "Point":
            yield "point", _pair(coords)
        elif kind == "MultiPoint":
            for point in coords:
                yield "point", _pair(point)
        elif kind == "LineString":
            yield "line", [_thin([_pair(point) for point in coords])]
        elif kind == "MultiLineString":
            yield "line", [_thin([_pair(point) for point in line]) for line in coords]
        elif kind == "Polygon":
            yield "area", [[_thin([_pair(point) for point in ring]) for ring in coords]]
        elif kind == "MultiPolygon":
            yield "area", [[_thin([_pair(point) for point in ring]) for ring in polygon] for polygon in coords]
        elif kind == "GeometryCollection":
            for inner in geometry.get("geometries") or []:
                yield from _shapes(inner)
    except (TypeError, ValueError, IndexError):
        return


def _pair(point: Any) -> list[float]:
    lon, lat = float(point[0]), float(point[1])
    if not (math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
        raise ValueError("not a place")
    return [_round(lon), _round(lat)]


def _thin(points: list[list[float]]) -> list[list[float]]:
    if len(points) <= MAX_CORNERS:
        return points
    step = len(points) / MAX_CORNERS
    kept = [points[int(index * step)] for index in range(MAX_CORNERS - 1)]
    return [*kept, points[-1]]


#: What a feature's state and confidence are said as on its card, as the map's card says them.
STATUS_WORDS = {"damaged": "Damaged", "destroyed": "Destroyed"}
CONFIDENCE_WORDS = {"confirmed": "Confirmed", "probable": "Probable", "claimed": "Claimed"}
#: A line of a description written `label: value`, as the map's card reads one (`lib/map/layerCard.js`).
CARD_FIELD = re.compile(r"^([^\s:][^:]{0,46}?)\s*:[ \t]+(\S.*)$")
#: What a card lists of a feature's own fields, and how long each value runs.
MAX_CARD_ROWS = 30
MAX_CARD_VALUE = 600
#: The fields a layer's feature carries for Azimut itself, never one of its own columns.
OWN_FIELDS = frozenset({
    "name", "description", "category", "colour", "icon", "key", "symbol", "group", "date", "date_end", "status",
    "bearing", "links", "provenance", "confidence", "credit", "picture", "index", "line_width", "line_dash",
    "line_arrow", "area_fill", "fill_opacity", "marker_size", "label", "label_size", "label_at", "icon_scale", "stroke_width",
    "show_label", "event", "icon_mode", "icon_name", "colour_name", "icon_meaning", "states", "entity_id",
    "follows", "followed", "proof_id", "media_id", "sheet_row", "entity_type", "entity_label", "entity_picture",
    "media", "proof", "picture_label", "picture_type", "picture_path", "synced",
})


def _layer_card(properties: Mapping[str, Any], layer: str, first: str, last: str, *, status: str = "",
                kind: str = "", coords: Any = None, columns: bool = False) -> dict[str, Any]:
    """A feature's card as the map's own shows it: its name, its day, its state and who placed
    it, its words with each `label: value` line a row, its links, where it is or how long and
    large, and its credit. ``columns``, for a layer made elsewhere, adds every other column its
    source gave the feature; a personal layer's own fields are Azimut's, its columns its words."""
    card: dict[str, Any] = {"title": _cut(" ".join(str(properties.get("name") or layer).split()), 160)}
    card["day"] = _span(first, last)
    words, rows = _card_words(properties.get("description"))
    if words:
        card["text"] = _cut(words, 700)
    if columns:
        rows.extend(_own_columns(properties))
    if rows:
        card["rows"] = rows[:MAX_CARD_ROWS]
    facts = [STATUS_WORDS.get(status or str(properties.get("status") or ""), ""),
             "Geolocated by someone else" if properties.get("provenance") == "external" else "",
             CONFIDENCE_WORDS.get(str(properties.get("confidence") or ""), ""),
             _cut(" ".join(str(properties.get("colour_name") or "").split()), 40),
             _cut(" ".join(str(properties.get("icon_meaning") or "").split()), 40)]
    if any(facts):
        card["facts"] = " · ".join(fact for fact in facts if fact)
    links = [str(link) for link in properties.get("links") or [] if notesources.web(str(link))]
    if links:
        card["source"] = {"label": notesources.host(links[0]) or "Source", "url": links[0]}
        if len(links) > 1:
            card["links"] = [{"label": notesources.host(link) or "Source", "url": link} for link in links[1:10]]
    if kind == "point" and isinstance(coords, list) and len(coords) == 2:
        card["at"] = [round(float(coords[1]), 5), round(float(coords[0]), 5)]
    elif kind in ("line", "area"):
        size = _card_size(kind, coords)
        if size:
            card["size"] = size
    credit = " ".join(str(properties.get("credit") or "").split())
    if credit:
        card["credit"] = _cut(credit, 200)
    named = str(properties.get("category") or "")
    # a layer's first group, named for nobody, says nothing more than the layer does
    card["kicker"] = f"{layer} · {named}" if named and named not in (layer, "Features") else layer
    return card


def _card_words(value: Any) -> tuple[str, list[dict[str, str]]]:
    """A description as its prose and its `label: value` rows, line by line in its order."""
    prose: list[str] = []
    rows: list[dict[str, str]] = []
    for line in _plain_text(value).split("\n"):
        found = CARD_FIELD.match(line.strip())
        if found and len(found.group(1)) <= 48:
            rows.append({"label": found.group(1).strip(), "value": _cut(found.group(2).strip(), MAX_CARD_VALUE)})
        elif line.strip():
            prose.append(line)
    return "\n".join(prose), rows


def _own_columns(properties: Mapping[str, Any]) -> list[dict[str, str]]:
    """Every column a feature carries beyond what Azimut keeps for itself, as a row each:
    an imported map's own fields, said as the source named them."""
    rows: list[dict[str, str]] = []
    for key, value in properties.items():
        if not isinstance(key, str) or key in OWN_FIELDS or key.startswith(("$", "_")) or "path" in key.lower():
            continue
        if isinstance(value, bool) or value is None or isinstance(value, (dict, list)):
            continue
        text = " ".join(_plain_text(value).split())
        label = " ".join(key.split())
        if text and label and len(label) <= 48:
            rows.append({"label": label, "value": _cut(text, MAX_CARD_VALUE)})
    return rows


def _card_size(kind: str, coords: Any) -> str:
    """How long a line runs, how much ground an area covers, as the map's card says it."""
    try:
        if kind == "line":
            metres = sum(_metres(part) for part in coords)
            return f"Length {_distance(metres)}" if metres > 0 else ""
        area = perimeter = 0.0
        for polygon in coords:
            outer, *holes = polygon
            area += max(0.0, _ground_area(outer) - sum(_ground_area(hole) for hole in holes))
            perimeter += _metres(outer)
    except (TypeError, ValueError, IndexError):
        return ""
    if area <= 0:
        return ""
    said = f"{area / 1e6:.2f} km²" if area >= 1e5 else f"{round(area):,} m²"
    return f"Area {said} · Perimeter {_distance(perimeter)}"


def _metres(points: list[list[float]]) -> float:
    """A line's length along the ground, in metres."""
    total = 0.0
    for (lon1, lat1), (lon2, lat2) in zip(points, points[1:]):
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp, dl = p2 - p1, math.radians(lon2 - lon1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        total += 2 * 6371008.8 * math.asin(min(1.0, math.sqrt(a)))
    return total


def _ground_area(ring: list[list[float]]) -> float:
    """A ring's area on the ground in square metres, flat about its own latitude."""
    if len(ring) < 3:
        return 0.0
    middle = math.radians(sum(point[1] for point in ring) / len(ring))
    flat = [(point[0] * 111320.0 * math.cos(middle), point[1] * 110540.0) for point in ring]
    return abs(_area(flat))


def _distance(metres: float) -> str:
    return f"{metres / 1000:.1f} km" if metres >= 1000 else f"{round(metres)} m"


def _history(states: list[tuple[Any, str, str, str]]) -> list[dict[str, str]]:
    """What a feature followed over time was, day by day: none for one with a single state."""
    if len(states) < 2:
        return []
    return [{"day": _span(first, last), "status": STATUS_WORDS.get(status, "")} for _, status, first, last in states
            if first or last][:20]


def _span(first: str, last: str) -> str:
    if first and last and last != first:
        return f"{notesources.spoken_day(first)} to {notesources.spoken_day(last)}"
    if first:
        return notesources.spoken_day(first)
    if last:
        return f"until {notesources.spoken_day(last)}"
    return ""


def _plain_text(value: Any) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return "\n".join(" ".join(line.split()) for line in text.split("\n") if line.strip())


def _cards_proofs(case: "Case", features: list[dict[str, Any]], *, anchors: Mapping[str, str]) -> None:
    """A marker showing a proof of the case, as its own picture or as the item it follows, links
    to that proof as the proof's own point does: its figure when the page holds it, else where
    the analyst posted it."""
    made: dict[str, dict[str, str] | None] = {}
    for feature in features:
        card = feature.get("card")
        if not isinstance(card, dict) or "proof" in card:
            continue
        for wanted in (feature.get("picture"), feature.get("entity")):
            if not wanted:
                continue
            if wanted not in made:
                made[wanted] = _proof_link(case, str(wanted), anchors)
            if made[wanted] is not None:
                card["proof"] = dict(made[wanted] or {})
                break


def _proof_link(case: "Case", entity_id: str, anchors: Mapping[str, str]) -> dict[str, str] | None:
    """Where a card sends its reader to see a proof, or None for anything but a proof that the
    page holds or that was posted."""
    record = case.get_entity(entity_id) if ENTITY_ID.match(entity_id) else None
    if not record or record.get("type") != "proof":
        return None
    said = {"name": _cut(str(record.get("label") or "Proof"), 120)}
    anchor = anchors.get(entity_id)
    if anchor:
        return {**said, "figure": f"#{anchor}"}
    posted = next(iter(urltitles.own_posts(record.get("attrs"))), "")
    return {**said, "posted": posted} if posted else None


def _cards_media(case: "Case", features: list[dict[str, Any]], *, encode: Encode | None, card_side: int,
                 out: Derived) -> None:
    """A marker following a picture or a proof of the case shows it in its card, and a
    feature naming a picture of its own (`picture`, `engine/layerlinks.py`) shows that
    one instead, its marker staying where it is."""
    if encode is None:
        return
    made: dict[str, dict[str, Any] | None] = {}
    for feature in features:
        entity_id = feature.pop("entity", None)
        picture = feature.pop("picture", None)
        if "media" in feature["card"]:
            continue
        for wanted in (picture, entity_id):
            if not wanted:
                continue
            if wanted not in made:
                made[wanted] = _entity_picture(case, wanted, encode, card_side, out)
            if made[wanted] is not None:
                feature["card"]["media"] = made[wanted]
                break
    for feature in features:
        feature.pop("entity", None)
        feature.pop("picture", None)


def _entity_picture(case: "Case", entity_id: str, encode: Encode, side: int, out: Derived) -> dict[str, Any] | None:
    from . import thumbnails

    record = case.get_entity(entity_id) if ENTITY_ID.match(entity_id) else None
    attrs = (record or {}).get("attrs") or {}
    if not record or record.get("type") not in ("media", "capture", "proof") or not attrs.get("path"):
        return None
    try:
        path = case.resolve_inside(str(attrs["path"]))
    except Exception:
        return None
    video = attrs.get("kind") == "video"
    if video:
        still = thumbnails.thumb_relpath(str(attrs.get("sha256") or ""), "video")
        try:
            path = case.resolve_inside(still) if still else path
        except Exception:
            return None
    if not path.is_file():
        return None
    encoded = encode(path, side)
    if encoded is None:
        return None
    out.weight += len(encoded[0])
    return {"src": encoded[0], "type": "video" if video else "image", "size": list(encoded[1]),
            "alt": _cut(str(record.get("label") or ""), 160)}


# -- a plate ------------------------------------------------------------------------------------


def _plate(case: "Case", name: str) -> dict[str, Any] | None:
    """A plate's first map as a map in a note shows it: its layers and how it draws them,
    its days, its steps with their framing, the day it is on and its view."""
    from . import mapplates

    if not NAME.match(name or ""):
        return None
    try:
        path = case.resolve_inside(layout.map_plate_rel(name))
        saved = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    spec = mapplates.as_periods(copy.deepcopy(saved.get("spec") or {})) if isinstance(saved, dict) else {}
    elements = [element for element in spec.get("elements") or [] if isinstance(element, dict)]
    the_map = next((element for element in elements if element.get("kind") == "map"), None)
    if the_map is None:
        return {"layers": [], "steps": [], "days": [], "at": "", "view": None}
    map_id = str(the_map.get("id") or "map")
    layers = [(str(layer.get("name") or ""), layer) for layer in the_map.get("layers") or [] if isinstance(layer, dict)]
    view = _plate_view(the_map.get("view"))
    framing: dict[str, Any] = spec["framing"] if isinstance(spec.get("framing"), dict) else {}
    steps_by_day: dict[str, Any] = spec["steps"] if isinstance(spec.get("steps"), dict) else {}
    plate_days = [day for day in spec.get("days") or [] if isinstance(day, str)]
    skipped = set(spec.get("skipped") or [])
    days = sorted({*(day[:10] for day in steps_by_day if DAY.match(day[:10])),
                   *(day[:10] for day in plate_days if DAY.match(day[:10]))} - skipped)
    at = str((spec.get("time") or {}).get("at") or "")[:10]
    steps: list[dict[str, Any]] = []
    current = view
    beats: list[tuple[str, dict[str, Any] | None]] = []
    for day in sorted(set(steps_by_day) | set(plate_days), key=lambda key: (key == "now", key)):
        beats.append((day, None))
        for step in steps_by_day.get(day) or []:
            if isinstance(step, dict) and step.get("id"):
                beats.append((day, step))
    for day, step in beats:
        key = str(step["id"]) if step is not None else day
        framed = _plate_view(((framing.get(key) or {}) if isinstance(framing.get(key), dict) else {}).get(map_id))
        if framed is not None:
            current = framed
        if step is None:
            if day in plate_days and day != "now":
                steps.append({"id": f"d{len(steps)}", "label": notesources.spoken_day(day[:10]),
                              "day": day[:10] if DAY.match(day[:10]) else None, "view": _view_json(current),
                              "focus": []})
            continue
        steps.append({"id": _safe_id(str(step["id"])), "label": _cut(str(step.get("name") or ""), 80) or
                      f"Step {len(steps) + 1}", "day": day[:10] if DAY.match(day[:10]) else None,
                      "view": _view_json(current), "focus": []})
    return {"layers": layers, "steps": steps, "days": days, "at": at,
            "view": None if view is None else (view["lat"], view["lon"], view["zoom"], view.get("bearing", 0.0))}


def _plate_view(view: Any) -> dict[str, Any] | None:
    if not isinstance(view, dict):
        return None
    try:
        lat, lon, zoom = float(view["lat"]), float(view["lon"]), float(view["zoom"])
    except (KeyError, TypeError, ValueError):
        return None
    return {"lat": lat, "lon": lon, "zoom": zoom, "bearing": float(view.get("bearing") or 0.0),
            "pitch": float(view.get("pitch") or 0.0)}


def _view_json(view: dict[str, Any] | None) -> dict[str, Any] | None:
    if view is None:
        return None
    return {"center": [_round(view["lon"]), _round(view["lat"])], "zoom": _num(view["zoom"], 2),
            "bearing": _num(view.get("bearing", 0.0), 1), "pitch": _num(view.get("pitch", 0.0), 1)}


# -- proofs --------------------------------------------------------------------------------------


def _proofs(case: "Case", period: tuple[str, str], *, encode: Encode | None, anchors: Mapping[str, str],
            round_pov: bool, card_side: int, out: Derived, filmed: bool = False,
            labels: str = "") -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """One point a proof point, for each proof dated in ``period`` (any proof for an
    open one), and one step a proof, in date order. ``filmed`` keeps only where each
    was filmed from; ``labels: on`` writes each one's name."""
    from . import satellite

    start, end = period
    reader = notesources.Reader(case)
    found: list[tuple[str, dict[str, Any], dict[str, Any], bool]] = []
    cursor: str | None = None
    while True:
        page = case.page_entities(types=["proof"], limit=500, cursor=cursor)
        for record in page.get("items", []):
            spec = _proof_spec(case, record)
            when = str(spec.get("when") or "").strip()
            about = when.endswith("~")
            day = when.rstrip("~")[:10]
            day = day if DAY.match(day) else ""
            if (start or end) and not day:
                continue
            if (start and day < start) or (end and day > end):
                continue
            found.append((day, record, spec, about))
        cursor = page.get("next_cursor")
        if not cursor or len(found) > MAX_PROOFS:
            break
    found.sort(key=lambda row: (row[0] or "9999", str(row[1].get("label") or "")))
    features: list[dict[str, Any]] = []
    steps: list[dict[str, Any]] = []
    for number, (day, record, spec, about) in enumerate(found[:MAX_PROOFS]):
        try:
            points = [point for point in satellite.spec_points(spec) if not point.get("proposed")]
        except Exception:
            points = []
        if filmed:
            points = [point for point in points if point.get("pov")]
        if not points:
            continue
        name = str(record.get("label") or spec.get("title") or "Proof")
        card = _proof_card(case, record, spec, day, about, reader=reader, encode=encode, anchors=anchors,
                           side=card_side, out=out)
        focus: list[str] = []
        for index, point in enumerate(points):
            lat, lon = float(point["lat"]), float(point["lon"])
            pov = bool(point.get("pov"))
            if pov and round_pov:
                lat, lon = rounded(lat, lon)
            if pov:
                out.pov.append(f"{name}: {lat:.4f}, {lon:.4f}" if round_pov else f"{name}: {lat:.6f}, {lon:.6f}")
            ident = f"p{number}" + (f"q{index}" if index else "")
            focus.append(ident)
            label = " ".join(str(point.get("label") or "").split())
            features.append({
                "id": ident,
                "kind": "point",
                "coords": [_round(lon), _round(lat)],
                "from": day or None,
                "until": None,
                "label": _cut(f"{name}, {label}" if label else name, 120),
                "style": {"color": PROOF_COLOUR, "icon": "", "width": 2, "size": 1.0, "proof": True,
                          **({"pov": True} if pov else {}), **({"label": True} if labels == "on" else {})},
                "card": card,
                "of": f"p{number}",
                "layer": "Proofs",
                "group": "Where it was filmed" if pov else "Proofs",
            })
        lead = points[0]
        said = " ".join(str(spec.get("description") or "").split())
        out.proofs[str(record.get("id") or "")] = {
            "ids": focus, "name": _cut(name, 120), "day": day,
            "center": [_round(float(lead["lon"])), _round(float(lead["lat"]))]}
        out.step_proofs[f"p{number}"] = str(record.get("id") or "")
        # a proof's step has no short name of its own: its day says it, its sentence comes with it
        steps.append({"id": f"p{number}", "label": "", "text": _cut(said, 300), "name": _cut(name, 120),
                      "day": day or None,
                      "view": {"center": [_round(float(lead["lon"])), _round(float(lead["lat"]))],
                               "zoom": None, "bearing": 0, "pitch": 0},
                      "focus": focus})
    if features:
        rows: dict[str, dict[str, Any]] = {}
        for feature in features:
            row = rows.setdefault(feature["group"], {"label": feature["group"], "layer": "Proofs", "kind": "point",
                                                    "style": feature["style"], "count": 0})
            row["count"] += 1
        out.legend.extend(rows.values())
    return features, steps


def _proof_spec(case: "Case", record: Mapping[str, Any]) -> dict[str, Any]:
    rel = (record.get("attrs") or {}).get("spec")
    if not isinstance(rel, str) or not rel:
        return {}
    try:
        path = case.resolve_inside(rel)
        if path.stat().st_size > 4 * 1024 * 1024:
            return {}
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _proof_card(case: "Case", record: Mapping[str, Any], spec: Mapping[str, Any], day: str, about: bool, *,
                reader: notesources.Reader, encode: Encode | None, anchors: Mapping[str, str], side: int,
                out: Derived) -> dict[str, Any]:
    name = str(record.get("label") or spec.get("title") or "Proof")
    card: dict[str, Any] = {"title": _cut(name, 160), "kicker": "Proof",
                            "day": notesources.spoken_day(f"{day}~" if about else day) if day else ""}
    sentence = " ".join(str(spec.get("description") or "").split())
    if sentence:
        card["text"] = _cut(sentence, 700)
    source = reader.entity(str(record.get("id") or ""))
    footage = ""
    verify: list[dict[str, str]] = []
    posted = ""
    if source is not None:
        posted = source.posted
        for one in source.lineage():
            if not footage and one.address and one.kind != notesources.IMAGERY:
                footage = one.address
            for site, address in one.verify:
                if all(link["url"] != address for link in verify):
                    verify.append({"label": f"Check on {site}", "url": address})
        footage = footage or source.traced_address
    if footage:
        card["source"] = {"label": notesources.host(footage) or "Source", "url": footage}
    if verify:
        card["verify"] = verify[:6]
    anchor = anchors.get(str(record.get("id") or ""))
    proof: dict[str, Any] = {"name": _cut(name, 120)}
    if anchor:
        proof["figure"] = f"#{anchor}"
    elif posted:
        proof["posted"] = posted
    card["proof"] = proof
    path = str((record.get("attrs") or {}).get("path") or "")
    if encode is not None and path:
        try:
            file = case.resolve_inside(path)
        except Exception:
            file = None
        encoded = encode(file, side) if file is not None and file.is_file() else None
        if encoded is not None:
            out.weight += len(encoded[0])
            card["media"] = {"src": encoded[0], "type": "image", "size": list(encoded[1]), "alt": _cut(name, 160)}
    return card


def rounded(lat: float, lon: float, metres: float = 150.0) -> tuple[float, float]:
    """A point moved to a grid about ``metres`` wide, as the export rounds a point of view."""
    step_lat = metres / 111_320
    step_lon = metres / (111_320 * max(0.01, math.cos(math.radians(lat))))
    return round(lat / step_lat) * step_lat, round(lon / step_lon) * step_lon


# -- the ground --------------------------------------------------------------------------------


def _ground(case: "Case", entity_id: str, *, encode: Encode | None, side: int) -> dict[str, Any] | None:
    """The ground picture a block names: its file, address, bounds, credit and size."""
    if not ENTITY_ID.match(entity_id or ""):
        return None
    record = case.get_entity(entity_id)
    attrs = (record or {}).get("attrs") or {}
    if not record or not attrs.get("path"):
        return None
    try:
        path = case.resolve_inside(str(attrs["path"]))
    except Exception:
        return None
    if not path.is_file():
        return None
    try:
        found = case.media_items_by_paths([str(attrs["path"])])
    except Exception:
        found = []
    sidecar = (found[0].get("source") if found and isinstance(found[0], dict) else None) or {}
    bounds = ground_bounds(sidecar)
    if bounds is None:
        return None
    encoded = encode(path, side) if encode is not None else None
    with Image.open(path) as image:
        size = image.size
    return {
        "path": path,
        "src": encoded[0] if encoded else "",
        "size": encoded[1] if encoded else size,
        "bounds": bounds,
        "credit": ground_credit(sidecar),
    }


def ground_bounds(sidecar: Mapping[str, Any]) -> list[float] | None:
    """The ``[w, s, e, n]`` a north-up capture covers, read off its provenance."""
    try:
        lat = float(sidecar.get("center_lat", sidecar.get("lat")))  # type: ignore[arg-type]
        lon = float(sidecar.get("center_lon", sidecar.get("lon")))  # type: ignore[arg-type]
        zoom = float(sidecar["zoom"])
        width, height = float(sidecar["width"]), float(sidecar["height"])
    except (KeyError, TypeError, ValueError):
        return None
    if float(sidecar.get("bearing") or 0) % 360:
        return None
    # a capture's zoom is the tiles' XYZ one: a 256-pixel world at zoom 0
    return bounds_of_view(lat, lon, zoom - 1, width, height)


def ground_credit(sidecar: Mapping[str, Any]) -> str:
    words = " ".join(str(sidecar.get("attribution") or sidecar.get("provider_label") or "").split())
    if words and str(sidecar.get("provider") or "").partition(cloudless.VARIANT_SEP)[0] == cloudless.BASE_ID:
        words = f"{words}, {cloudless.MOSAIC}"
    day = str(sidecar.get("imagery_date") or "")
    if day and DAY.match(day[:10]):
        spoken = notesources.spoken_day(day[:10] + ("~" if sidecar.get("imagery_exact") is False else ""))
        words = f"{words}, imagery of {spoken}" if words else f"Imagery of {spoken}"
    return f"Imagery: {words}" if words and not words.startswith("Imagery") else words


# -- pictograms ---------------------------------------------------------------------------------


@lru_cache(maxsize=1)
def drawings() -> dict[str, Any]:
    """The map's own marker drawings, as `lib/map/markerGlyphs.js` holds them."""
    path = Path(__file__).resolve().parent / "notes_html_assets" / "markers.json"
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"badges": {}, "plain": {}}
    return loaded if isinstance(loaded, dict) else {"badges": {}, "plain": {}}


class _Icons:
    """The pictograms a map's markers wear, each drawn once: a symbol of the app's in a
    colour and a status, or a layer's own icon."""

    def __init__(self, case: "Case") -> None:
        self.case = case
        self.used: dict[str, dict[str, Any]] = {}

    def symbol(self, symbol: str, colour: str, status: str = "", external: bool = False) -> str:
        known = drawings()
        if symbol not in known.get("badges", {}) and symbol not in known.get("plain", {}):
            symbol = "pin"
        key = f"s-{symbol}-{colour.lstrip('#')}" + (f"-{status}" if status else "") + ("-x" if external else "")
        icon: dict[str, Any] = {"symbol": symbol, "colour": colour, "status": status}
        if external:
            icon["external"] = True
        self.used.setdefault(key, icon)
        return key

    @staticmethod
    def badge(symbol: str) -> bool:
        return symbol in drawings().get("badges", {})

    def layer_icon(self, layer: str, icon: str, properties: Mapping[str, Any], *, status: str = "",
                   external: bool = False) -> str:
        """One of the analyst's icons a layer wears: as it is, or its silhouette in a disc of the
        feature's colour (`icon_mode`), with its status strokes and an external point's dashed rim."""
        from . import maplayers

        colour = _hex(properties.get("colour")) or "#0072b2"
        disc = properties.get("icon_mode") == "disc"
        base = f"i-{maplayers.digest(f'{layer}/{icon}'.encode())[:12]}"
        key = base + (f"-d{colour.lstrip('#')}" if disc else "") + (f"-{status}" if status else "") + \
            ("-x" if external else "")
        if key in self.used:
            return key
        if sum(1 for one in self.used.values() if "png" in one) >= MAX_ICONS:
            return ""
        try:
            data = maplayers.icon(self.case, layer, icon)
        except Exception:
            return ""
        look: dict[str, Any] = {"png": data, "colour": colour}
        try:
            with Image.open(BytesIO(data)) as opened:
                picture = opened.convert("RGBA")
        except Exception:
            picture = None
        if picture is not None:
            look["size"] = list(picture.size)
            if disc:
                box = picture.getchannel("A").getbbox()
                if box:
                    cropped = BytesIO()
                    picture.crop(box).save(cropped, "PNG")
                    look["png"] = cropped.getvalue()
                    look["size"] = [box[2] - box[0], box[3] - box[1]]
        if disc:
            look["mode"] = "disc"
        if status:
            look["status"] = status
        if external:
            look["external"] = True
        self.used[key] = look
        return key


#: The marker's square, its disc and the boxes its glyph and plain shapes are drawn in,
#: as `lib/map/markerGlyphs.js` sets them.
MARKER = 64
_CENTRE = 32.0
_DISC = 28.0
_GLYPH = (1.85, 32 - 12 * 1.85)
_PLAIN = (2.7, -0.4)
_HALO = "rgba(0,0,0,0.35)"


def _ring(x: float, y: float, r: float) -> str:
    def short(value: float) -> str:
        return f"{round(value * 100) / 100:g}"

    return (f"M{short(x)} {short(y - r)}a{short(r)} {short(r)} 0 1 1 0 {short(2 * r)} "
            f"{short(r)} {short(r)} 0 0 1 0-{short(2 * r)}Z")


def glyph_ink(colour: str) -> str:
    """White on a strong disc, dark on a pale one, as the map draws its badges."""
    if not re.match(r"^#[0-9a-fA-F]{6}$", colour or ""):
        return "#ffffff"
    r, g, b = (int(colour[index:index + 2], 16) for index in (1, 3, 5))
    return "#14161a" if (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 else "#ffffff"


def marker_parts(symbol: str, colour: str, status: str = "", *, proof: bool = False,
                 pov: bool = False, external: bool = False) -> list[dict[str, Any]]:
    """Every shape a marker is made of, in drawing order (`markerParts` in the map): a point
    somebody else geolocated (``external``) wears a dashed rim instead of a solid one."""
    known = drawings()
    layers = known.get("badges", {}).get(symbol)
    plain = known.get("plain", {})
    across = (32.0, 32.0, 15.0)
    parts: list[dict[str, Any]] = []
    if proof:
        # a proof: a disc of its own colour, ringed dark, a lens for where it was filmed
        parts.append({"d": _ring(32, 32, _DISC + 1.6), "fill": "rgba(0,0,0,0.45)", "scale": 1, "offset": 0})
        parts.append({"d": _ring(32, 32, _DISC - 6), "fill": colour, "stroke": "#14161a", "width": 3,
                      "scale": 1, "offset": 0})
        parts.append({"d": _ring(32, 32, 6.5 if not pov else 9.5), "fill": "#14161a", "scale": 1, "offset": 0})
        if pov:
            parts.append({"d": _ring(32, 32, 4.2), "fill": colour, "scale": 1, "offset": 0})
        return parts
    if layers is None:
        shape = plain.get(symbol) or plain.get("pin", "")
        filled = symbol in ("circle", "star", "flag")
        parts.append({"d": shape, "stroke": "#fff", "width": 4, "scale": _PLAIN[0], "offset": _PLAIN[1],
                      **({"dash": "2.2 1.5"} if external else {})})
        parts.append({"d": shape, "fill": colour if filled else None, "stroke": colour, "width": 2.4,
                      "scale": _PLAIN[0], "offset": _PLAIN[1]})
        across = (32.0, 26.6, 13.0)
    else:
        ink = glyph_ink(colour)
        parts.append({"d": _ring(_CENTRE, _CENTRE, _DISC + 1.6), "fill": _HALO, "scale": 1, "offset": 0})
        parts.append({"d": _ring(_CENTRE, _CENTRE, _DISC), "fill": colour, "stroke": "#fff", "width": 2.5,
                      "scale": 1, "offset": 0, **({"dash": "6 4"} if external else {})})
        for layer in layers:
            mode, d = layer[0], layer[1]
            options = layer[2] if len(layer) > 2 and isinstance(layer[2], dict) else {}
            paint = ink if mode in ("fill", "line") else colour
            solid = mode in ("fill", "cut")
            parts.append({"d": d, "fill": paint if solid else None, "stroke": None if solid else paint,
                          "width": options.get("width", 2.2 if mode == "line" else 1.3),
                          "rotate": options.get("rotate", 0), "scale": _GLYPH[0], "offset": _GLYPH[1]})
    parts.extend(_status_parts(status, across))
    return parts


def _status_parts(status: str, across: tuple[float, float, float]) -> list[dict[str, Any]]:
    """The stroke a damaged marker wears, two for a destroyed one, each on a dark bed."""
    parts: list[dict[str, Any]] = []
    x, y, reach = across
    strokes = []
    if status == "destroyed":
        strokes = [f"M{x - reach:g} {y + reach:g}L{x + reach:g} {y - reach:g}",
                   f"M{x - reach:g} {y - reach:g}L{x + reach:g} {y + reach:g}"]
    elif status == "damaged":
        strokes = [f"M{x - reach:g} {y + reach:g}L{x + reach:g} {y - reach:g}"]
    for d in strokes:
        parts.append({"d": d, "stroke": "rgba(0,0,0,0.55)", "width": 7.5, "scale": 1, "offset": 0})
        parts.append({"d": d, "stroke": "#fff", "width": 4.2, "scale": 1, "offset": 0})
    return parts


def symbol_svg(key: str, icon: Mapping[str, Any], prefix: str = "az-map") -> str:
    """One pictogram as an SVG `symbol` a marker `use`s, 64 units square, its id
    ``{prefix}-mk-{key}`` so two maps of a page never share one."""
    if "png" in icon:
        return _own_symbol(key, icon, prefix)
    parts = marker_parts(icon.get("symbol", "pin"), icon.get("colour", "#0072b2"), icon.get("status", ""),
                         proof=bool(icon.get("proof")), pov=bool(icon.get("pov")), external=bool(icon.get("external")))
    return f'<symbol id="{prefix}-mk-{key}" viewBox="0 0 64 64">{"".join(_part_svg(part) for part in parts)}</symbol>'


#: Where an own icon's silhouette sits in a disc, and the share of its own pixels a picture
#: drawn as it is takes (`OWN_GLYPH`, `OWN_IMAGE_RATIO` in lib/map/markerGlyphs.js).
OWN_GLYPH = 36.0
OWN_IMAGE_RATIO = 0.7


def _own_symbol(key: str, icon: Mapping[str, Any], prefix: str) -> str:
    """One of the analyst's icons as a marker: as it is, centred at the share of its pixels the
    map draws it at (past the marker's square when it is large), or its silhouette inked in a
    disc of its colour; its status strokes and dashed rim over it, as the map draws them."""
    data = base64.b64encode(icon["png"]).decode("ascii")
    colour = str(icon.get("colour") or "#0072b2")
    width, height = (icon.get("size") or [48 / OWN_IMAGE_RATIO, 48 / OWN_IMAGE_RATIO])[:2]
    status, external = str(icon.get("status") or ""), bool(icon.get("external"))
    if icon.get("mode") == "disc":
        ink = glyph_ink(colour)
        fit = OWN_GLYPH / max(float(width), float(height), 1.0)
        w, h = float(width) * fit, float(height) * fit
        under = [_part_svg({"d": _ring(_CENTRE, _CENTRE, _DISC + 1.6), "fill": _HALO, "scale": 1, "offset": 0}),
                 _part_svg({"d": _ring(_CENTRE, _CENTRE, _DISC), "fill": colour, "stroke": "#fff", "width": 2.5,
                            "scale": 1, "offset": 0, **({"dash": "6 4"} if external else {})})]
        filter_id = f"{prefix}-ink-{ink.lstrip('#')}"
        picture = (f'<image href="data:image/png;base64,{data}" x="{32 - w / 2:g}" y="{32 - h / 2:g}" '
                   f'width="{w:g}" height="{h:g}" data-ink="{ink}" filter="url(#{filter_id})"/>')
        ink_filter = (f'<filter id="{filter_id}" x="0" y="0" width="1" height="1"><feFlood flood-color="{ink}"/>'
                      f'<feComposite in2="SourceAlpha" operator="in"/></filter>')
        over = [_part_svg(part) for part in _status_parts(status, (32.0, 32.0, 15.0))]
        return (f'{ink_filter}<symbol id="{prefix}-mk-{key}" viewBox="0 0 64 64">{"".join(under)}{picture}'
                f'{"".join(over)}</symbol>')
    w, h = float(width) * OWN_IMAGE_RATIO, float(height) * OWN_IMAGE_RATIO
    side = max(64.0, math.ceil(max(w, h) / 2) * 2)
    rim = [_part_svg({"d": _ring(_CENTRE, _CENTRE, _DISC), "stroke": "#fff", "width": 2.5, "dash": "6 4",
                      "scale": 1, "offset": 0})] if external else []
    over = rim + [_part_svg(part) for part in _status_parts(status, (32.0, 32.0, 15.0))]
    large = f' overflow="visible" data-side="{side:g}"' if side > 64 else ""
    return (f'<symbol id="{prefix}-mk-{key}" viewBox="0 0 64 64"{large}><image href="data:image/png;base64,{data}" '
            f'x="{32 - w / 2:g}" y="{32 - h / 2:g}" width="{w:g}" height="{h:g}"/>{"".join(over)}</symbol>')


def _part_svg(part: Mapping[str, Any]) -> str:
    """One shape of a marker as an SVG path, in the box it is drawn in."""
    transform = ""
    if part.get("scale", 1) != 1 or part.get("offset", 0):
        transform = f' transform="translate({part["offset"]:g} {part["offset"]:g}) scale({part["scale"]:g})'
        if part.get("rotate"):
            transform += f' rotate({part["rotate"]:g} 12 12)'
        transform += '"'
    fill = f'fill="{_paint(part["fill"])}"' if part.get("fill") else 'fill="none"'
    stroke = ""
    if part.get("stroke"):
        width = float(part.get("width") or 1)
        stroke = f' stroke="{_paint(part["stroke"])}" stroke-width="{width:g}" stroke-linecap="round" stroke-linejoin="round"'
    if part.get("dash"):
        stroke += f' stroke-dasharray="{part["dash"]}"'
    return f'<path d="{part["d"]}" {fill}{stroke}{transform}/>'


def _paint(colour: str) -> str:
    return colour.replace(" ", "")


# -- marks kept apart -----------------------------------------------------------------------------

#: Two marks closer than this, in pixels of the page, are read as one place and spread.
NEAR_PX = 19.0
#: How far apart spread marks stand, centre to centre, in pixels.
SPREAD_PX = 27.0


def arrange(points: list[tuple[str, float, float]], *, near: float = NEAR_PX,
            gap: float = SPREAD_PX, crowds: list[tuple[list[str], float, float]] | None = None,
            crowd_from: float = CROWDS) -> dict[str, tuple[float, float]]:
    """Where each mark stands once marks that would cover one another are spread round
    the place they share: a ring for a few, a sunflower for more, the nearest to the
    middle. ``points`` are ``(id, x, y)`` in pixels; a mark that stands alone keeps
    its place. The reader's script spreads them the same way at every zoom
    (`arrange` in `reader.map.js`); the data never moves. Given a ``crowds`` list, a crowd
    of more than ``crowd_from`` marks is left out and added to it as ``(ids, x, y)``, the
    count the page draws there."""
    cell = max(near, 1.0)
    grid: dict[tuple[int, int], list[int]] = {}
    for index, (_, x, y) in enumerate(points):
        grid.setdefault((int(x // cell), int(y // cell)), []).append(index)

    def around(index: int) -> list[int]:
        _, x, y = points[index]
        gx, gy = int(x // cell), int(y // cell)
        found = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for other in grid.get((gx + dx, gy + dy), []):
                    if other != index and math.hypot(points[other][1] - x, points[other][2] - y) < near:
                        found.append(other)
        return found

    crowd = {index: around(index) for index in range(len(points))}
    taken: set[int] = set()
    out: dict[str, tuple[float, float]] = {}
    order = sorted(range(len(points)), key=lambda index: (-len(crowd[index]), points[index][2], points[index][1]))
    for index in order:
        if index in taken:
            continue
        group = [index, *(other for other in crowd[index] if other not in taken)]
        taken.update(group)
        if len(group) == 1:
            continue
        cx = sum(points[one][1] for one in group) / len(group)
        cy = sum(points[one][2] for one in group) / len(group)
        if crowds is not None and len(group) > crowd_from:
            crowds.append(([points[one][0] for one in group], cx, cy))
            continue
        for one, (x, y) in zip(_by_angle(group, points, cx, cy), _slots(len(group), gap)):
            out[points[one][0]] = (cx + x, cy + y)
    return out


def _by_angle(group: list[int], points: list[tuple[str, float, float]], cx: float, cy: float) -> list[int]:
    if len(group) <= 6:
        return sorted(group, key=lambda one: (math.atan2(points[one][2] - cy, points[one][1] - cx), points[one][0]))
    return sorted(group, key=lambda one: (math.hypot(points[one][1] - cx, points[one][2] - cy), points[one][0]))


def _slots(count: int, gap: float) -> list[tuple[float, float]]:
    """Where ``count`` spread marks stand round their middle: a ring up to six, beyond
    it a sunflower whose neighbours stay ``gap`` apart."""
    if count <= 6:
        radius = gap / (2 * math.sin(math.pi / count)) if count > 1 else 0.0
        start = -math.pi / 2 if count != 2 else math.pi
        return [(radius * math.cos(start + 2 * math.pi * slot / count), radius * math.sin(start + 2 * math.pi * slot / count))
                for slot in range(count)]
    golden = math.pi * (3 - math.sqrt(5))
    step = gap / math.sqrt(math.pi) * 1.05
    return [(step * math.sqrt(slot + 0.5) * math.cos(slot * golden), step * math.sqrt(slot + 0.5) * math.sin(slot * golden))
            for slot in range(count)]


# -- the drawing ---------------------------------------------------------------------------------


def svg(derived: Derived, *, day: str | None = None, ident: str = "az-map") -> str:
    """The features over the ground, as the page shows them with no script and in print:
    every feature in place (those not there on ``day`` marked off), a marker's size set
    for a map read about `READ_WIDTH` pixels wide."""
    data = derived.data
    shown_day = data.get("day", "") if day is None else day
    project = _Projector(data["bounds"])
    width, height = project.width, project.height
    unit = width / READ_WIDTH
    defs: list[str] = []
    for key, icon in derived.icons.items():
        defs.append(symbol_svg(key, icon, ident))
    proofs_used: set[str] = set()
    hatch_colours: dict[str, str] = {}
    areas: list[str] = []
    lines: list[str] = []
    placed: list[dict[str, Any]] = []
    labels: list[tuple[float, float, str, str, str]] = []
    named: list[tuple[float, float, str, str, str]] = []
    faint = traces(data["features"], shown_day)
    for feature in data["features"]:
        kind, style = feature["kind"], feature["style"]
        off = "" if shows_on(feature, shown_day) else " az-off az-past" if feature["id"] in faint else " az-off"
        attrs = (f'class="az-f az-{kind}{off}" data-id="{_attr(feature["id"])}" data-of="{_attr(feature.get("of", ""))}"'
                 f'{_day_attr("from", feature.get("from"))}{_day_attr("until", feature.get("until"))} '
                 f'aria-label="{_attr(_said(feature))}"')
        colour = style.get("color", "#0072b2")
        alpha = f' opacity="{style["alpha"]:g}"' if style.get("alpha") else ""
        if kind == "point":
            x, y = project(*feature["coords"])
            if style.get("proof"):
                key = "proof-pov" if style.get("pov") else "proof"
                if key not in proofs_used:
                    proofs_used.add(key)
                    defs.append(symbol_svg(key, {"proof": True, "pov": key == "proof-pov", "colour": colour}, ident))
                    derived.icons.setdefault(key, {"proof": True, "pov": key == "proof-pov", "colour": colour})
                mark = key
            else:
                mark = str(style.get("icon") or "")
            placed.append({"id": feature["id"], "x": x, "y": y, "attrs": attrs, "icon": mark, "alpha": alpha, "off": off,
                           "size": float(style.get("size") or 1), "label": feature["label"] if style.get("label") else "",
                           "colour": colour, "marks": _marks(style)})
            continue
        d = _path(feature, project)
        if not d:
            continue
        if feature.get("at") and style.get("label") and feature.get("label"):
            spot_x, spot_y = project(*feature["at"])
            named.append((spot_x, spot_y, str(feature["label"]), feature["id"], off))
        dash = ""
        if style.get("dash") == "dashed":
            dash = ' stroke-dasharray="7 5"'
        elif style.get("dash") == "dotted":
            dash = ' stroke-dasharray="1 4"'
        elif style.get("confidence") == "claimed":
            dash = ' stroke-dasharray="2 4"'
        elif style.get("confidence") == "probable":
            dash = ' stroke-dasharray="8 4"'
        stroke_width = float(style.get("width") or 2)
        if kind == "line":
            marker = ""
            if style.get("arrow"):
                arrow_id = f"{ident}-ar-{colour.lstrip('#')}"
                if arrow_id not in "".join(defs):
                    defs.append(f'<marker id="{arrow_id}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" '
                                f'markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" '
                                f'fill="{colour}"/></marker>')
                marker = f' marker-end="url(#{arrow_id})"'
                if style["arrow"] == "both":
                    marker += f' marker-start="url(#{arrow_id})"'
            lines.append(f'<g {attrs}{alpha}><path class="az-halo" d="{d}" stroke-width="{stroke_width + 3:g}"/>'
                         f'<path class="az-stroke" d="{d}" stroke="{colour}" stroke-width="{stroke_width:g}"'
                         f'{dash}{marker}/></g>')
        else:
            fill_mode = style.get("fill", "")
            opacity = style.get("opacity", 0.18)
            if fill_mode == "none":
                fill = 'fill="none"'
            elif fill_mode == "hatch":
                pattern = hatch_colours.setdefault(colour, f"{ident}-hatch-{colour.lstrip('#')}")
                fill = f'fill="url(#{pattern})"'
            else:
                fill = f'fill="{colour}" fill-opacity="{float(opacity):g}"'
            areas.append(f'<g {attrs}{alpha}><path class="az-area-fill" d="{d}" {fill} fill-rule="evenodd"/>'
                         f'<path class="az-stroke" d="{d}" stroke="{colour}" stroke-width="{stroke_width:g}"'
                         f' fill="none"{dash}/></g>')
    for colour, pattern in hatch_colours.items():
        defs.append(f'<pattern id="{pattern}" width="10" height="10" patternUnits="userSpaceOnUse" '
                    f'patternTransform="rotate(45)"><rect width="10" height="10" fill="{colour}" fill-opacity=".12"/>'
                    f'<line x1="0" y1="0" x2="0" y2="10" stroke="{colour}" stroke-width="3" stroke-opacity=".6"/>'
                    f'</pattern>')
    # marks that would sit on one another are spread round where they stand, a leader to each true spot
    spread = arrange([(one["id"], one["x"] / unit, one["y"] / unit) for one in placed if not one["off"]])
    points: list[tuple[float, str]] = []
    leaders: list[str] = []
    for one in placed:
        x, y = one["x"], one["y"]
        sx, sy = spread.get(one["id"], (x / unit, y / unit))
        at_x, at_y = sx * unit, sy * unit
        if (round(at_x, 1), round(at_y, 1)) != (round(x, 1), round(y, 1)):
            leaders.append(f'<g class="az-leader" data-for="{_attr(one["id"])}"><line x1="{x:.1f}" y1="{y:.1f}" '
                           f'x2="{at_x:.1f}" y2="{at_y:.1f}"/><circle cx="{x:.1f}" cy="{y:.1f}" r="{2.6 * unit:.2f}" '
                           f'fill="{one["colour"]}"/></g>')
        scale = MARKER_PX * one["size"] * unit / MARKER
        wedge, top, faint = one["marks"]
        points.append((y, f'<g {one["attrs"]} data-x="{x:.1f}" data-y="{y:.1f}" data-s="{one["size"]:g}" '
                          f'data-colour="{_attr(one["colour"])}"'
                          f' transform="translate({at_x:.1f} {at_y:.1f}) scale({scale:.4f})"{one["alpha"]}>'
                          f'{wedge}<use href="#{ident}-mk-{one["icon"]}" x="-32" y="{top}" width="64" height="64"{faint}/></g>'))
        if one["label"]:
            labels.append((at_x, at_y, one["label"], one["id"], one["off"]))
    points.sort(key=lambda row: row[0])
    written = _labels(named, unit, width, height, centred=True) + _labels(labels, unit, width, height)
    ground = data.get("ground")
    plain = "" if ground else f'<rect class="az-plain" width="{width:g}" height="{height:g}" fill="{PLAIN_GROUND}"/>'
    return (f'<svg class="az-map-svg" id="{ident}-svg" viewBox="0 0 {width:g} {height:g}" '
            f'preserveAspectRatio="none" aria-hidden="false" focusable="false">'
            f'<defs>{"".join(defs)}</defs>{plain}'
            f'<g class="az-areas">{"".join(areas)}</g><g class="az-lines">{"".join(lines)}</g>'
            f'<g class="az-leaders" aria-hidden="true">{"".join(leaders)}</g>'
            f'<g class="az-points">{"".join(row[1] for row in points)}</g>'
            f'<g class="az-labels" aria-hidden="true">{written}</g></svg>')


#: The wedge a marker looking one way wears just outside its rim, in its 64 units about its middle,
#: as the map draws it (`bearingImage` in lib/map/addedLayer.js); and where a plain marker's square
#: stands so its tip is on its point (the map's bottom anchor, 7.7 of its 64 units below the tip).
BEARING_WEDGE = "M0 -45L9 -32H-9Z"
TIP_TOP = -56.3
#: How strongly a point of each confidence is drawn (`CONFIDENCE_OPACITY` in the map).
CONFIDENCE_OPACITY = {"probable": 0.8, "claimed": 0.55}


def _marks(style: Mapping[str, Any]) -> tuple[str, str, str]:
    """What a point's marker wears beyond its pictogram, as the map draws it: the wedge saying
    which way it looks, its square raised to stand on its tip, and how faint its confidence is."""
    bearing = style.get("bearing")
    wedge = (f'<path class="az-bearing" d="{BEARING_WEDGE}" transform="rotate({float(bearing):g})" fill="#fff" '
             f'stroke="rgba(0,0,0,.6)" stroke-width="3" stroke-linejoin="round"/>'
             if isinstance(bearing, (int, float)) and not isinstance(bearing, bool) else "")
    top = f"{TIP_TOP:g}" if style.get("tip") else "-32"
    faint = CONFIDENCE_OPACITY.get(str(style.get("confidence") or ""))
    return wedge, top, f' opacity="{faint:g}"' if faint else ""


def _labels(labels: list[tuple[float, float, str, str, str]], unit: float, width: float, height: float, *,
            centred: bool = False) -> str:
    """The names written beside their marks, each kept off the ones already written;
    ``centred``, a line's or an area's name written on its middle, which stays there."""
    size = 12.5 * unit
    taken: list[tuple[float, float, float, float]] = []
    out: list[str] = []
    for x, y, words, ident, off in sorted(labels, key=lambda row: (row[4] != "", row[1])):
        text = _cut(words, 34)
        span = len(text) * size * 0.56
        left = x - span / 2 if centred else x + 15 * unit
        box = (left, y - size * 0.7, left + span, y + size * 0.5)
        clash = not off and any(box[0] < other[2] and other[0] < box[2] and box[1] < other[3] and other[1] < box[3]
                                for other in taken)
        if not off and not clash:
            taken.append(box)
        if centred:
            out.append(f'<text class="az-label{off}{" az-clash" if clash else ""}" data-for="{_attr(ident)}" '
                       f'data-x="{x:.1f}" data-y="{y:.1f}" x="{x:.1f}" y="{y + size * 0.35:.1f}" '
                       f'font-size="{size:.2f}" text-anchor="middle">{_text(text)}</text>')
            continue
        out.append(f'<text class="az-label{off}{" az-clash" if clash else ""}" data-for="{_attr(ident)}" '
                   f'x="{left:.1f}" y="{y + size * 0.35:.1f}" font-size="{size:.2f}">{_text(text)}</text>')
    return "".join(out)


def _path(feature: Mapping[str, Any], project: _Projector) -> str:
    parts: list[str] = []
    if feature["kind"] == "line":
        for line in feature["coords"]:
            parts.append(_polyline(line, project, close=False))
    else:
        for polygon in feature["coords"]:
            for ring in polygon:
                parts.append(_polyline(ring, project, close=True))
    return "".join(part for part in parts if part)


def _polyline(points: list[list[float]], project: _Projector, *, close: bool) -> str:
    if len(points) < 2:
        return ""
    drawn: list[str] = []
    last = None
    for lon, lat in points:
        x, y = project(lon, lat)
        here = (round(x, 1), round(y, 1))
        if here == last:
            continue
        drawn.append(f"{'M' if not drawn else 'L'}{here[0]:g} {here[1]:g}")
        last = here
    return "".join(drawn) + ("Z" if close else "")


def _said(feature: Mapping[str, Any]) -> str:
    card = feature.get("card") or {}
    words = [feature.get("label") or card.get("title") or "Feature"]
    if card.get("day"):
        words.append(card["day"])
    return ", ".join(str(word) for word in words if word)


def _day_attr(name: str, value: Any) -> str:
    return f' data-{name}="{value}"' if isinstance(value, str) and DAY.match(value) else ""


# -- the picture, for a PDF ------------------------------------------------------------------------


def render_png(data: Mapping[str, Any], width: int, *, ground: "Image.Image | Path | bytes | None" = None,
               day: str | None = None, icons: Mapping[str, Mapping[str, Any]] | None = None,
               fmt: str = "PNG") -> bytes:
    """The map as one picture ``width`` pixels wide (`picture`), encoded as ``fmt``."""
    out = picture(data, width, ground=ground, day=day, icons=icons)
    buffer = BytesIO()
    if fmt.upper() == "JPEG":
        out.save(buffer, "JPEG", quality=86, optimize=True, progressive=True)
    else:
        out.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


#: A crowd's count, as the page draws it (`bubble` in reader.map.js), in its pixels: its radius
#: before its share of the marks, its ring, and the size of its number.
BUBBLE_RADIUS = 15.0
BUBBLE_RING = 3.5
BUBBLE_TEXT = 13


def marker_key(style: Mapping[str, Any]) -> str:
    """The pictogram a point wears, by its key in a map's icons: a proof's own, else its layer's."""
    if style.get("proof"):
        return "proof-pov" if style.get("pov") else "proof"
    return str(style.get("icon") or "")


def marker(key: str, style: Mapping[str, Any], icons: Mapping[str, Mapping[str, Any]] | None, side: int) -> Image.Image:
    """One point's marker painted ``side`` pixels square, from the map's ``icons`` (a layer's own
    included), else from what its key and style say."""
    icon = dict((icons or {}).get(key) or {}) or _icon_from_key(key, style)
    return _marker_image(icon, side)


def picture(data: Mapping[str, Any], width: int, *, ground: "Image.Image | Path | bytes | None" = None,
            day: str | None = None, icons: Mapping[str, Mapping[str, Any]] | None = None,
            read_width: float = READ_WIDTH, as_page: bool = False, plain: Image.Image | None = None) -> Image.Image:
    """The map as one picture ``width`` pixels wide: its ground, then its areas, lines
    and markers as they stand on ``day`` (the map's own day by default), their names
    kept off one another. ``ground`` is the picture under it when the caller holds it;
    else ``data.ground.src`` is read when it is a `data:` address. ``icons`` are the
    pictograms `derive` found, so a layer's own icons are drawn too. Its marks are sized
    for a map read ``read_width`` pixels wide. ``as_page`` draws them as the page opens on
    them, where a picture with no zoom spreads every mark and names it beside it: a crowd
    past the map's own count (`crowds`, `CROWDS` by default) as that count in a ring of its
    colours, a mark's name under it. ``plain`` is what a map with no ground is drawn on in
    place of its plain background."""
    width = max(200, min(int(width), 4096))
    bounds = list(data.get("bounds") or [-10, -10, 10, 10])
    project = _Projector(bounds)
    height = max(100, round(width * project.height / project.width))
    supersample = 2
    big = (width * supersample, height * supersample)
    canvas = _ground_image(data, ground, big, project)
    if plain is not None and not data.get("ground") and ground is None:
        canvas = plain.convert("RGBA").resize(big, Image.Resampling.LANCZOS)
    elif data.get("ground") or ground is not None:
        # the ground muted under the marks, as the page shows it; a dark base is its street map turned dark
        if data.get("base") == "dark":
            canvas = dark_ground(canvas)
        else:
            canvas = ImageEnhance.Brightness(ImageEnhance.Color(canvas.convert("RGB")).enhance(0.62)).enhance(0.86).convert("RGBA")
    scale_x = big[0] / project.width
    scale_y = big[1] / project.height
    overlay = Image.new("RGBA", big, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    shown_day = data.get("day", "") if day is None else day
    every = list(data.get("features") or [])
    faint = traces(every, shown_day)
    features = [feature for feature in every if shows_on(feature, shown_day) or feature["id"] in faint]
    pixel = big[0] / read_width  # a CSS pixel of a map read at read_width, in canvas pixels

    def at(lon: float, lat: float) -> tuple[float, float]:
        x, y = project(lon, lat)
        return x * scale_x, y * scale_y

    for feature in features:
        if feature["kind"] != "area":
            continue
        style = feature["style"]
        colour = _rgb(style.get("color"))
        gone = feature["id"] in faint
        alpha = int(255 * float(style.get("opacity", 0.22)) * float(style.get("alpha", 1)) * (0.35 if gone else 1))
        for polygon in feature["coords"]:
            rings = [[at(*point) for point in ring] for ring in polygon]
            if rings and len(rings[0]) >= 3:
                if style.get("fill") != "none":
                    draw.polygon(rings[0], fill=(*colour, alpha if style.get("fill") != "hatch" else 60))
                for ring in rings:
                    _stroke(draw, ring + ring[:1], colour, float(style.get("width") or 2) * pixel,
                            {"dash": "dashed"} if gone else style, alpha=110 if gone else 255)
    for feature in features:
        if feature["kind"] != "line":
            continue
        style = feature["style"]
        colour = _rgb(style.get("color"))
        gone = feature["id"] in faint
        for line in feature["coords"]:
            drawn = [at(*point) for point in line]
            if len(drawn) < 2:
                continue
            if gone:
                _stroke(draw, drawn, colour, float(style.get("width") or 2) * pixel, {"dash": "dashed"}, alpha=110)
                continue
            _stroke(draw, drawn, (255, 255, 255), (float(style.get("width") or 2) + 3) * pixel, {}, alpha=150)
            _stroke(draw, drawn, colour, float(style.get("width") or 2) * pixel, style)
    canvas = Image.alpha_composite(canvas.convert("RGBA"), overlay)
    points = sorted((feature for feature in features if feature["kind"] == "point"), key=lambda one: -one["coords"][1])
    kept: dict[str, Image.Image] = {}
    true = {feature["id"]: at(*feature["coords"]) for feature in points}
    crowded: list[tuple[list[str], float, float]] | None = [] if as_page else None
    spread = arrange([(ident, x / pixel, y / pixel) for ident, (x, y) in true.items()], crowds=crowded,
                     crowd_from=math.inf if data.get("crowds") == 0 else float(data.get("crowds") or CROWDS))
    grouped = {ident for ids, _, _ in crowded or [] for ident in ids}
    points = [feature for feature in points if feature["id"] not in grouped]
    where = {ident: (spread[ident][0] * pixel, spread[ident][1] * pixel) if ident in spread else spot
             for ident, spot in true.items()}
    leaders = ImageDraw.Draw(canvas)
    for feature in points:
        if feature["id"] in spread:
            (x0, y0), (x1, y1) = true[feature["id"]], where[feature["id"]]
            leaders.line([(x0, y0), (x1, y1)], fill=(16, 18, 22, 170), width=max(2, round(2.6 * pixel)))
            leaders.line([(x0, y0), (x1, y1)], fill=(255, 255, 255, 235), width=max(1, round(1.2 * pixel)))
            dot = 2.8 * pixel
            leaders.ellipse((x0 - dot, y0 - dot, x0 + dot, y0 + dot), fill=(*_rgb(feature["style"].get("color")), 255),
                            outline=(255, 255, 255, 255), width=max(1, round(pixel)))
    for feature in points:
        style = feature["style"]
        side = max(8, round(MARKER_PX * float(style.get("size") or 1) * pixel))
        key = marker_key(style)
        painted = kept.get(f"{key}/{side}")
        if painted is None:
            painted = kept[f"{key}/{side}"] = marker(key, style, icons, side)
        x, y = where[feature["id"]]
        canvas.alpha_composite(painted, (round(x - side / 2), round(y - side / 2)))
    colours = {feature["id"]: _rgb(feature["style"].get("color")) for feature in features if feature["id"] in grouped}
    for ids, x, y in crowded or []:
        _draw_bubble(canvas, [colours[ident] for ident in ids], x * pixel, y * pixel, pixel)
    named = [feature for feature in features if feature["kind"] != "point" and feature.get("at")
             and feature["style"].get("label") and feature["id"] not in faint]
    _draw_labels(canvas, named, lambda feature: at(*feature["at"]), pixel, centred=True)
    _draw_labels(canvas, [feature for feature in points if feature["style"].get("label")],
                 lambda feature: where[feature["id"]], pixel, under=as_page)
    if data.get("north"):
        _draw_north(canvas, pixel)
    if data.get("scale") == "on":
        _draw_scale(canvas, bounds, project, pixel)
    return canvas.convert("RGB").resize((width, height), Image.Resampling.LANCZOS)


def _draw_bubble(canvas: Image.Image, colours: list[tuple[int, int, int]], x: float, y: float, pixel: float) -> None:
    """A crowd's count where it stands, as the page draws it: a dark disc ringed white, a ring of
    its marks' colours in their shares, its number in the middle."""
    count = len(colours)
    radius = (BUBBLE_RADIUS + min(9.0, count / 5)) * pixel
    draw = ImageDraw.Draw(canvas)
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(16, 18, 22, 230), outline=(255, 255, 255, 255),
                 width=max(1, round(1.5 * pixel)))
    shares: dict[tuple[int, int, int], int] = {}
    for colour in colours:
        shares[colour] = shares.get(colour, 0) + 1
    ring = radius - 2.5 * pixel
    wide = max(1, round(BUBBLE_RING * pixel))
    turn = -90.0
    for colour, share in shares.items():
        sweep = share / count * 360
        end = turn + max(0.1, sweep - (4.6 if len(shares) > 1 else 0.0))
        outer = ring + wide / 2
        draw.arc((x - outer, y - outer, x + outer, y + outer), turn, end, fill=(*colour, 255), width=wide)
        for angle in ((turn, end) if len(shares) > 1 else ()):
            # the page rounds each arc's ends
            cx, cy = x + ring * math.cos(math.radians(angle)), y + ring * math.sin(math.radians(angle))
            draw.ellipse((cx - wide / 2, cy - wide / 2, cx + wide / 2, cy + wide / 2), fill=(*colour, 255))
        turn += sweep
    draw.text((x, y), str(count), font=_font(max(8, round(BUBBLE_TEXT * pixel))), anchor="mm", fill=(255, 255, 255, 255))


def dark_ground(picture: Image.Image) -> Image.Image:
    """A street map turned dark, as a dark base draws its ground: its greys inverted,
    lit a little less (`.az-base-dark` in reader.mapset.css)."""
    grey = ImageOps.invert(ImageOps.grayscale(picture.convert("RGB")))
    toned = ImageEnhance.Contrast(ImageEnhance.Brightness(grey).enhance(0.82)).enhance(1.1)
    return Image.merge("RGB", (toned, toned, toned)).convert("RGBA")


def _ground_image(data: Mapping[str, Any], ground: Any, size: tuple[int, int],
                  project: "_Projector | None" = None) -> Image.Image:
    """The ground under a picture of ``size``: laid at its own bounds when the map is
    framed on another part of the world, the rest the plain background."""
    picture: Image.Image | None = None
    try:
        if isinstance(ground, Image.Image):
            picture = ground.copy()
        elif isinstance(ground, Path):
            with Image.open(ground) as opened:
                picture = opened.convert("RGB")
        elif isinstance(ground, (bytes, bytearray)):
            with Image.open(BytesIO(ground)) as opened:
                picture = opened.convert("RGB")
        else:
            src = str(((data.get("ground") or {}) if isinstance(data.get("ground"), dict) else {}).get("src") or "")
            if src.startswith("data:image/") and ";base64," in src:
                raw = base64.b64decode(src.split(",", 1)[1])
                with Image.open(BytesIO(raw)) as opened:
                    picture = opened.convert("RGB")
    except (OSError, ValueError, Image.DecompressionBombError):
        picture = None
    if picture is None:
        return Image.new("RGBA", size, (*_rgb(PLAIN_GROUND), 255))
    placed = (data.get("ground") or {}).get("bounds") if isinstance(data.get("ground"), dict) else None
    if project is not None and placed and list(placed) != list(data.get("bounds") or []):
        west, south, east, north = placed
        x0, y0 = project(west, north)
        x1, y1 = project(east, south)
        scale_x, scale_y = size[0] / project.width, size[1] / project.height
        box = (round(x0 * scale_x), round(y0 * scale_y), round(x1 * scale_x), round(y1 * scale_y))
        canvas = Image.new("RGBA", size, (*_rgb(PLAIN_GROUND), 255))
        width, height = max(1, box[2] - box[0]), max(1, box[3] - box[1])
        # only what shows is drawn: a ground far larger than the frame is cut first
        left, top = max(0, -box[0]), max(0, -box[1])
        right, bottom = min(width, size[0] - box[0]), min(height, size[1] - box[1])
        if right <= left or bottom <= top:
            return canvas
        fx, fy = picture.width / width, picture.height / height
        part = picture.crop((round(left * fx), round(top * fy), round(right * fx), round(bottom * fy)))
        part = part.convert("RGBA").resize((right - left, bottom - top), Image.Resampling.LANCZOS)
        canvas.alpha_composite(part, (box[0] + left, box[1] + top))
        return canvas
    return picture.convert("RGBA").resize(size, Image.Resampling.LANCZOS)


def _icon_from_key(key: str, style: Mapping[str, Any]) -> dict[str, Any]:
    if key.startswith("proof"):
        return {"proof": True, "pov": key == "proof-pov", "colour": style.get("color", PROOF_COLOUR)}
    match = re.match(r"^s-(.+?)-([0-9a-fA-F]{6})(?:-(damaged|destroyed))?(-x)?$", key)
    if match:
        return {"symbol": match.group(1), "colour": f"#{match.group(2)}", "status": match.group(3) or "",
                "external": bool(match.group(4))}
    return {"symbol": "pin", "colour": style.get("color", "#0072b2"), "status": style.get("status", "")}


def _marker_image(icon: Mapping[str, Any], side: int) -> Image.Image:
    """One marker painted at ``side`` pixels square."""
    if "png" in icon:
        try:
            with Image.open(BytesIO(icon["png"])) as opened:
                picture = opened.convert("RGBA")
            picture.thumbnail((round(side * 0.75), round(side * 0.75)), Image.Resampling.LANCZOS)
            square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            square.alpha_composite(picture, ((side - picture.width) // 2, (side - picture.height) // 2))
            return square
        except (OSError, ValueError):
            pass
    zoom = 4
    big = side * zoom
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    unit = big / MARKER
    for part in marker_parts(str(icon.get("symbol") or "pin"), str(icon.get("colour") or "#0072b2"),
                             str(icon.get("status") or ""), proof=bool(icon.get("proof")), pov=bool(icon.get("pov")),
                             external=bool(icon.get("external"))):
        scale, offset = float(part.get("scale") or 1), float(part.get("offset") or 0)
        turn = math.radians(float(part.get("rotate") or 0))

        def place(x: float, y: float, scale: float = scale, offset: float = offset, turn: float = turn) -> tuple[float, float]:
            if turn:
                x, y = 12 + (x - 12) * math.cos(turn) - (y - 12) * math.sin(turn), \
                    12 + (x - 12) * math.sin(turn) + (y - 12) * math.cos(turn)
            return (offset + x * scale) * unit, (offset + y * scale) * unit

        subpaths = [[place(x, y) for x, y in points] for points, _closed in path_points(part["d"])]
        if part.get("fill"):
            fill = _rgba(part["fill"])
            for points in subpaths:
                if len(points) >= 3:
                    draw.polygon(points, fill=fill)
        if part.get("stroke"):
            stroke = _rgba(part["stroke"])
            line_width = max(1, round(float(part.get("width") or 1) * scale * unit))
            for points, (_, closed) in zip(subpaths, path_points(part["d"])):
                if len(points) >= 2:
                    drawn = points + points[:1] if closed else points
                    draw.line(drawn, fill=stroke, width=line_width, joint="curve")
                    radius = line_width / 2
                    for x, y in (drawn[0], drawn[-1]):
                        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=stroke)
    return image.resize((side, side), Image.Resampling.LANCZOS)


def _stroke(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], colour: tuple[int, int, int], width: float,
            style: Mapping[str, Any], alpha: int = 255) -> None:
    width = max(1, round(width))
    dash = style.get("dash") or {"claimed": "dotted", "probable": "dashed"}.get(str(style.get("confidence") or ""), "")
    if not dash:
        draw.line(points, fill=(*colour, alpha), width=width, joint="curve")
        return
    on, off = (width * 3.5, width * 2.5) if dash == "dashed" else (width * 0.6, width * 2.2)
    for segment in _dashes(points, on, off):
        draw.line(segment, fill=(*colour, alpha), width=width)


def _dashes(points: list[tuple[float, float]], on: float, off: float) -> Iterator[list[tuple[float, float]]]:
    drawing, left = True, on
    current: list[tuple[float, float]] = [points[0]]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        length = math.hypot(x1 - x0, y1 - y0)
        at = 0.0
        while length - at > left:
            at += left
            point = (x0 + (x1 - x0) * at / length, y0 + (y1 - y0) * at / length)
            if drawing:
                current.append(point)
                yield current
            current = [point]
            drawing = not drawing
            left = on if drawing else off
        left -= length - at
        if drawing:
            current.append((x1, y1))
        else:
            current = [(x1, y1)]
    if drawing and len(current) >= 2:
        yield current


#: A mark's name as the page writes it under the mark (`LABEL_PX` in reader.map.js), its baseline
#: this many of its sizes under the mark's middle.
LABEL_PX = 11.0
LABEL_UNDER = 1.75


def _draw_labels(canvas: Image.Image, features: list[dict[str, Any]],
                 at: Callable[[dict[str, Any]], tuple[float, float]], pixel: float, *, centred: bool = False,
                 under: bool = False) -> None:
    """The names, each kept off those already written: a line's or an area's on its middle
    (``centred``), a mark's beside it, or ``under`` it as the page writes it."""
    if not features:
        return
    size = max(10, round((LABEL_PX if under and not centred else 12.5) * pixel))
    font = _font(size)
    draw = ImageDraw.Draw(canvas)
    taken: list[tuple[float, float, float, float]] = []
    for feature in sorted(features, key=lambda one: at(one)[1] if centred else -one["coords"][1]):
        text = _cut(str(feature.get("label") or ""), 34)
        if not text:
            continue
        x, y = at(feature)
        left = x if centred or under else x + 15 * pixel
        anchor = "mm" if centred else "ms" if under else "lm"
        if under and not centred:
            y += LABEL_UNDER * size
        box = draw.textbbox((left, y), text, font=font, anchor=anchor)
        if any(box[0] < other[2] and other[0] < box[2] and box[1] < other[3] and other[1] < box[3] for other in taken):
            continue
        taken.append(box)
        draw.text((left, y), text, font=font, anchor=anchor, fill=(255, 255, 255, 255),
                  stroke_width=max(2, round(size / 6)), stroke_fill=(16, 18, 22, 230))


def _draw_north(canvas: Image.Image, pixel: float) -> None:
    """A north arrow in the top right corner, as the page draws it (`.az-map-north`)."""
    draw = ImageDraw.Draw(canvas)
    side = 34 * pixel
    x, y = canvas.width - side * 0.9 - 14 * pixel, 14 * pixel
    cx, top, bottom = x + side / 2, y + side * 0.12, y + side * 0.9
    draw.ellipse((x, y, x + side, y + side), fill=(16, 18, 22, 200))
    draw.polygon([(cx, top), (cx + side * 0.2, y + side * 0.62), (cx, y + side * 0.52)], fill=(255, 255, 255, 255))
    draw.polygon([(cx, top), (cx - side * 0.2, y + side * 0.62), (cx, y + side * 0.52)], fill=(190, 194, 200, 255))
    font = _font(max(8, round(9 * pixel)))
    draw.text((cx, bottom), "N", font=font, anchor="ms", fill=(255, 255, 255, 255))


def _draw_scale(canvas: Image.Image, bounds: list[float], project: "_Projector", pixel: float) -> None:
    """A scale bar in the bottom left corner: a round distance about a hundred page pixels
    long at the map's middle, as the page's ruler is."""
    west, south, east, north = bounds
    middle = (south + north) / 2
    metres_across = 40075016.7 * math.cos(math.radians(middle)) * (mercator(east, middle)[0] - mercator(west, middle)[0])
    per_pixel = metres_across / canvas.width
    if per_pixel <= 0:
        return
    length = 1.0
    for step in (1, 2, 5):
        for power in range(8):
            value = step * 10 ** power
            if value / per_pixel <= 110 * pixel and value > length:
                length = value
    span = length / per_pixel
    draw = ImageDraw.Draw(canvas)
    x, y = 14 * pixel, canvas.height - 14 * pixel
    for colour, wide in (((16, 18, 22, 200), 4.2), ((255, 255, 255, 255), 2.0)):
        stroke = max(1, round(wide * pixel / 2))
        draw.line([(x, y - 8 * pixel), (x, y), (x + span, y), (x + span, y - 8 * pixel)], fill=colour, width=stroke,
                  joint="curve")
    words = f"{length / 1000:g} km" if length >= 1000 else f"{length:g} m"
    draw.text((x + 4 * pixel, y - 4 * pixel), words, font=_font(max(8, round(10 * pixel))), anchor="ls",
              fill=(255, 255, 255, 255), stroke_width=max(1, round(pixel * 1.4)), stroke_fill=(16, 18, 22, 220))


@lru_cache(maxsize=8)
def _font(size: int) -> "ImageFont.FreeTypeFont | ImageFont.ImageFont":
    from . import pdffonts

    try:
        return ImageFont.truetype(str(pdffonts.FONT_DIR / "NotoSans-Bold.ttf"), size)
    except OSError:
        return ImageFont.load_default()


# -- SVG paths, read for Pillow ---------------------------------------------------------------------

_TOKENS = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


def path_points(d: str, steps: int = 10) -> list[tuple[list[tuple[float, float]], bool]]:
    """An SVG path as its subpaths' corners, curves and arcs broken into short lines,
    each with whether it is closed."""
    tokens = _TOKENS.findall(d or "")
    out: list[tuple[list[tuple[float, float]], bool]] = []
    current: list[tuple[float, float]] = []
    x = y = start_x = start_y = 0.0
    control: tuple[float, float] | None = None
    command = ""
    index = 0

    def number() -> float:
        nonlocal index
        value = float(tokens[index])
        index += 1
        return value

    def flags() -> float:
        # a flag may be written run on with what follows it (`a1 1 0 1 1 0 2`): one digit
        nonlocal index
        token = tokens[index]
        if len(token) > 1 and token[0] in "01" and not token.startswith(("0.", "1.")):
            tokens[index] = token[1:]
            return float(token[0])
        index += 1
        return float(token)

    while index < len(tokens):
        token = tokens[index]
        if token.isalpha():
            command = token
            index += 1
            if command in "Zz":
                if current:
                    out.append((current, True))
                current = []
                x, y = start_x, start_y
                control = None
                continue
        elif not command:
            index += 1
            continue
        relative = command.islower()
        kind = command.upper()
        base_x, base_y = (x, y) if relative else (0.0, 0.0)
        if kind == "M":
            if current:
                out.append((current, False))
            x, y = base_x + number(), base_y + number()
            start_x, start_y = x, y
            current = [(x, y)]
            command = "l" if relative else "L"
            control = None
        elif kind == "L":
            x, y = base_x + number(), base_y + number()
            current.append((x, y))
            control = None
        elif kind == "H":
            x = (x if relative else 0.0) + number()
            current.append((x, y))
            control = None
        elif kind == "V":
            y = (y if relative else 0.0) + number()
            current.append((x, y))
            control = None
        elif kind in ("C", "S"):
            if kind == "C":
                x1, y1 = base_x + number(), base_y + number()
            else:
                x1, y1 = (2 * x - control[0], 2 * y - control[1]) if control else (x, y)
            x2, y2 = base_x + number(), base_y + number()
            x3, y3 = base_x + number(), base_y + number()
            for step in range(1, steps + 1):
                t = step / steps
                u = 1 - t
                current.append((u ** 3 * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3,
                                u ** 3 * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3))
            control = (x2, y2)
            x, y = x3, y3
        elif kind in ("Q", "T"):
            if kind == "Q":
                x1, y1 = base_x + number(), base_y + number()
            else:
                x1, y1 = (2 * x - control[0], 2 * y - control[1]) if control else (x, y)
            x2, y2 = base_x + number(), base_y + number()
            for step in range(1, steps + 1):
                t = step / steps
                u = 1 - t
                current.append((u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2))
            control = (x1, y1)
            x, y = x2, y2
        elif kind == "A":
            rx, ry, turn = abs(number()), abs(number()), number()
            large, sweep = flags(), flags()
            end_x, end_y = base_x + number(), base_y + number()
            current.extend(_arc(x, y, rx, ry, turn, bool(large), bool(sweep), end_x, end_y, steps * 2))
            x, y = end_x, end_y
            control = None
        else:
            index += 1
    if current:
        out.append((current, False))
    return out


def _arc(x0: float, y0: float, rx: float, ry: float, turn: float, large: bool, sweep: bool, x1: float, y1: float,
         steps: int) -> list[tuple[float, float]]:
    """An elliptical arc as points, by the endpoint-to-centre reading of SVG's own notes."""
    if rx == 0 or ry == 0 or (x0 == x1 and y0 == y1):
        return [(x1, y1)]
    phi = math.radians(turn)
    cos, sin = math.cos(phi), math.sin(phi)
    dx, dy = (x0 - x1) / 2, (y0 - y1) / 2
    px, py = cos * dx + sin * dy, -sin * dx + cos * dy
    grow = px * px / (rx * rx) + py * py / (ry * ry)
    if grow > 1:
        rx, ry = rx * math.sqrt(grow), ry * math.sqrt(grow)
    top = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px
    bottom = rx * rx * py * py + ry * ry * px * px
    factor = math.sqrt(max(0.0, top / bottom)) if bottom else 0.0
    if large == sweep:
        factor = -factor
    cx_, cy_ = factor * rx * py / ry, -factor * ry * px / rx
    cx = cos * cx_ - sin * cy_ + (x0 + x1) / 2
    cy = sin * cx_ + cos * cy_ + (y0 + y1) / 2

    def angle(ux: float, uy: float, vx: float, vy: float) -> float:
        return math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)

    start = angle(1, 0, (px - cx_) / rx, (py - cy_) / ry)
    delta = angle((px - cx_) / rx, (py - cy_) / ry, (-px - cx_) / rx, (-py - cy_) / ry)
    if not sweep and delta > 0:
        delta -= 2 * math.pi
    elif sweep and delta < 0:
        delta += 2 * math.pi
    points = []
    count = max(2, int(steps * abs(delta) / math.pi) + 1)
    for step in range(1, count + 1):
        theta = start + delta * step / count
        ex, ey = rx * math.cos(theta), ry * math.sin(theta)
        points.append((cos * ex - sin * ey + cx, sin * ex + cos * ey + cy))
    return points


# -- small readings --------------------------------------------------------------------------------


def _hex(value: Any) -> str:
    text = str(value or "").strip().lower()
    if re.match(r"^#[0-9a-f]{6}$", text):
        return text
    if re.match(r"^#[0-9a-f]{3}$", text):
        return "#" + "".join(char * 2 for char in text[1:])
    return ""


def _rgb(value: Any) -> tuple[int, int, int]:
    text = _hex(value) or "#0072b2"
    return int(text[1:3], 16), int(text[3:5], 16), int(text[5:7], 16)


def _rgba(value: str) -> tuple[int, int, int, int]:
    match = re.match(r"^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$", value.replace(" ", ""))
    if match:
        return int(match.group(1)), int(match.group(2)), int(match.group(3)), round(float(match.group(4)) * 255)
    return (*_rgb(value), 255)


def _number(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _round(value: float) -> float:
    return round(float(value), 6)


def _num(value: float, places: int) -> float:
    rounded_value = round(float(value), places)
    return int(rounded_value) if rounded_value == int(rounded_value) else rounded_value  # type: ignore[return-value]


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else f"{text[: limit - 1].rstrip()}…"


def _safe_id(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "-", text)[:40] or "step"


def _attr(value: str) -> str:
    return (str(value).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;"))


def _text(value: str) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


__all__ = [
    "BASES", "BLOCK", "CARD_PARTS", "Derived", "MapBlock", "Step", "TOKEN", "block_text", "blocks_in", "derive",
    "fit_view", "ground_bounds", "label_anchor", "marker", "marker_key", "parse_block", "picture", "render_png",
    "settings_lines", "step_text", "svg",
]
