"""The kinds of chart past bars and columns: parts of a whole, glyphs, figures and time.

`notes_charts` holds the block, the reading, the frame and the two painters; each kind
here is one `plot` it registers at its foot, called with the block's `Reading`, the look
and the box the frame leaves, and returning marks. No painter knows a kind.

| Kind | Made from | Reads |
|---|---|---|
| Pie, Donut | parts of one whole: past six, the smallest fold into *Others* | ``centre`` (donut) |
| Segments | one bar of the parts, across or (``bars: up``) standing | |
| Pictograms | one glyph per unit, in rows of ten, coloured by the part | ``icon``, ``per glyph`` |
| Silhouette rows | one row of glyphs per category, its flag or icon first | ``icon``, ``flag``, ``per glyph`` |
| Waffle | a grid of a whole, ``1 square = 1/100`` or ``1/10,000`` | ``of``, ``squares`` |
| Key figures | rows of *Figure · Words*, two to four tiles across | |
| Timeline | rows of *Day · What · Until*: points, and bands for periods | |
| Line | numbers over days or numbers, one line per colour value | |
| Circles | two or three amounts as circles, areas to scale | |

**Parts.** A kind of parts (`Kind.parts`) reads the colour column's values as its parts,
or the ``by`` column's when no colour column is written, so a part wears the case's
colour by its name, a grade its step of the ramp. With a highlight, the other parts
take a ramp of greys, so neighbours stay apart.

**Glyphs** come from the app's own badges (`notes_html_assets/markers.json`, the map's
drawings), a plain shape (``dot``, ``square``, ``star``) or an icon of the analyst's
library (``own:<key>``): an icon kept as a silhouette takes the part's colour, one kept
in its own colours (a flag) is drawn as it is. A glyph stands for one unit until the
units pass `MAX_GLYPHS`; then one stands for a round number of them, the chart says so,
and a part of a glyph is drawn cut, not rounded.

**Never cut text.** Every name and label wraps to as many lines as it needs; a number
too wide for its tile is set smaller. Labels that would meet (a timeline's, a line's
ends, a segment too narrow for its number) move apart and keep a leader to their mark.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, replace
from datetime import date, timedelta
from functools import lru_cache
from io import BytesIO
from typing import TYPE_CHECKING, Any, Callable, Sequence

from PIL import Image

if TYPE_CHECKING:
    from .notes_charts import Box, ChartTheme, Check, Mark, Paint, Plot, Reading, Swatch, Table

#: Parts a pie or a donut draws; past it, the smallest are one part, `OTHERS`.
MAX_SLICES = 6
OTHERS = "Others"
#: Glyphs a block of pictograms draws, and rows of silhouettes, before one glyph stands
#: for several units: past them a glyph is too small to count.
MAX_GLYPHS = 120
MAX_ROW_GLYPHS = 200
#: Round numbers of units a glyph may stand for.
GLYPH_UNITS = (1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000)
DEFAULT_GLYPH = "dot"
#: Tiles a row of key figures holds, and the most a block shows.
TILES_ACROSS = 4
MAX_TILES = 8
#: Circles one comparison draws.
MAX_CIRCLES = 3
#: The grids a waffle is drawn on.
SQUARES = (100, 10_000)
#: Labels a line names at its ends before a legend says them instead.
MAX_DIRECT_LABELS = 4
#: Events a timeline lays across before it lists them down the page.
MAX_ACROSS_EVENTS = 14
#: A segmented bar's thickness, across.
SEGMENT_THICKNESS = 28.0

_PLAIN_SHAPES = {
    "dot": "M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z",
    "square": "M5 5h14v14H5Z",
    "star": "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z",
}
_PLAIN_WORDS = {"dot": "dot", "circle": "dot", "disc": "dot", "square": "square", "star": "star"}
_SPELLINGS = (("armored", "armoured"), ("defense", "defence"), ("harbor", "harbour"))
OWN = re.compile(r"^own:\s*([0-9a-f]{16})$", re.I)


# -- glyphs --------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Glyph:
    """A unit's drawing: a badge's or a plain shape's layers on the map's 24-unit grid, or
    an icon's picture; ``box`` is where its ink lies, so glyphs sit side by side."""

    key: str
    layers: tuple[tuple[str, str, float], ...] = ()
    box: tuple[float, float, float, float] = (0.0, 0.0, 24.0, 24.0)
    png: bytes = b""
    #: An icon kept as a silhouette: drawn in the part's colour, not its own.
    tint: bool = False

    @property
    def aspect(self) -> float:
        x0, y0, x1, y1 = self.box
        return max(0.2, (x1 - x0) / max(y1 - y0, 0.01))


def glyph_key(word: str) -> str:
    """The glyph a cell or an ``icon`` line names, as one key: ``own:<key>``, a badge of the
    map (``pickup`` reads as ``badge-pickup``), or a plain shape; empty when it names none."""
    from .notes_maps import drawings

    text = " ".join(str(word or "").split())
    own = OWN.match(text)
    if own:
        return f"own:{own.group(1).lower()}"
    name = re.sub(r"[\s_]+", "-", text.casefold())
    for us, uk in _SPELLINGS:
        name = name.replace(us, uk)
    if name in _PLAIN_WORDS:
        return _PLAIN_WORDS[name]
    badges = drawings().get("badges", {})
    for candidate in (name, f"badge-{name}"):
        if candidate in badges:
            return candidate
    return ""


def glyph(key: str) -> Glyph:
    """The drawing a key names; the dot for a key that names nothing or an icon gone from
    the library."""
    if key.startswith("own:"):
        found = own_icon(key[4:])
        if found is not None:
            return found
        key = DEFAULT_GLYPH
    return _vector_glyph(key if key else DEFAULT_GLYPH)


@lru_cache(maxsize=96)
def _vector_glyph(key: str) -> Glyph:
    from .notes_maps import drawings, path_points

    layers: list[tuple[str, str, float]] = []
    if key in _PLAIN_SHAPES:
        layers.append(("fill", _PLAIN_SHAPES[key], 0.0))
    else:
        for layer in drawings().get("badges", {}).get(key) or ():
            options = layer[2] if len(layer) > 2 and isinstance(layer[2], dict) else {}
            mode = str(layer[0])
            width = float(options.get("width", 2.2 if mode == "line" else 1.3))
            layers.append((mode, str(layer[1]), width))
    if not layers:
        return _vector_glyph(DEFAULT_GLYPH)
    xs: list[float] = []
    ys: list[float] = []
    for mode, d, width in layers:
        reach = width / 2 if mode == "line" else 0.0
        for points, _closed in path_points(d):
            for x, y in points:
                xs.extend((x - reach, x + reach))
                ys.extend((y - reach, y + reach))
    box = (min(xs), min(ys), max(xs), max(ys)) if xs else (0.0, 0.0, 24.0, 24.0)
    return Glyph(key, tuple(layers), box)


def own_icon(key: str) -> Glyph | None:
    """An icon of the analyst's library (`iconlibrary`), trimmed to its ink; None when the
    library no longer holds it. Its key is the hash of its picture, so the same key draws
    the same picture on every machine that holds it."""
    from . import iconlibrary

    if not iconlibrary.is_key(key):
        return None
    try:
        data = iconlibrary.png(key)
        entry = iconlibrary.entry(key) or {}
    except Exception:  # an icon gone from the library falls back to the dot, said by the check
        return None
    trimmed = _trimmed_png(data)
    if trimmed is None:
        return None
    png, width, height = trimmed
    return Glyph(f"own:{key}", (), (0.0, 0.0, float(width), float(height)), png, entry.get("mode") == "disc")


@lru_cache(maxsize=32)
def _trimmed_png(data: bytes) -> tuple[bytes, int, int] | None:
    try:
        with Image.open(BytesIO(data)) as opened:
            if opened.width * opened.height > 4_000_000:
                return None
            picture = opened.convert("RGBA")
    except Exception:
        return None
    box = picture.getchannel("A").getbbox()
    if box is None:
        return None
    picture = picture.crop(box)
    out = BytesIO()
    picture.save(out, "PNG")
    return out.getvalue(), picture.width, picture.height


@lru_cache(maxsize=128)
def _own_picture(png: bytes, colour: str, start: float, end: float) -> bytes:
    """An icon's picture tinted ``colour`` (a silhouette) or as it is (empty ``colour``),
    keeping only its part from ``start`` to ``end`` of its width."""
    with Image.open(BytesIO(png)) as opened:
        picture = opened.convert("RGBA")
    if colour:
        solid = Image.new("RGBA", picture.size, nc._rgb(colour) + (255,))
        solid.putalpha(picture.getchannel("A"))
        picture = solid
    if start > 0 or end < 1:
        left = round(picture.width * start)
        right = max(left + 1, round(picture.width * end))
        clear = Image.new("RGBA", picture.size, (0, 0, 0, 0))
        clear.paste(picture.crop((left, 0, right, picture.height)), (left, 0))
        picture = clear
    out = BytesIO()
    picture.save(out, "PNG")
    return out.getvalue()


def glyph_marks(drawing: Glyph, paint: "Paint", theme: "ChartTheme", x: float, y: float, height: float,
                clip: tuple[float, float] = (0.0, 1.0)) -> list["Mark"]:
    """One glyph ``height`` tall from ``(x, y)``, its top left, in a part's paint: filled,
    hatched or outlined. ``clip`` keeps a part of its width, for a glyph that stands for
    more units than its part holds."""
    x0, y0, x1, y1 = drawing.box
    scale = height / max(y1 - y0, 0.01)
    width = (x1 - x0) * scale
    start, end = max(0.0, clip[0]), min(1.0, clip[1])
    if end - start <= 0:
        return []
    if drawing.png:
        colour = paint.colour if drawing.tint else ""
        data = _own_picture(drawing.png, colour, round(start, 4), round(end, 4))
        return [nc.Picture(x, y, width, height, data)]
    cut = start > 0 or end < 1
    left, right = x0 + (x1 - x0) * start, x0 + (x1 - x0) * end
    ox, oy = x - x0 * scale, y - y0 * scale
    marks: list[Mark] = []
    for mode, d, line in drawing.layers:
        if cut:
            d = clipped_path(d, left, right, closed=mode in ("fill", "cut"))
            if not d:
                continue
        if mode == "fill":
            if paint.outline:
                marks.append(nc.Shape(d, theme.paper, ox, oy, scale, stroke=paint.colour,
                                      stroke_width=round(1.4 / scale, 3)))
            else:
                marks.append(nc.Shape(d, paint.colour, ox, oy, scale, hatch=paint.hatch))
        elif paint.outline:
            continue
        elif mode == "cut":
            marks.append(nc.Shape(d, theme.paper, ox, oy, scale))
        elif mode == "line":
            marks.append(nc.Shape(d, "none", ox, oy, scale, stroke=paint.colour, stroke_width=line))
        elif mode == "cutline":
            marks.append(nc.Shape(d, "none", ox, oy, scale, stroke=theme.paper, stroke_width=line))
    return marks


def clipped_path(d: str, left: float, right: float, *, closed: bool) -> str:
    """A path cut to the band ``left ≤ x ≤ right``: shapes as polygons, strokes as lines."""
    from .notes_maps import path_points

    parts: list[str] = []
    for points, is_closed in path_points(d):
        if closed or is_closed:
            polygon = _clip_polygon(_clip_polygon(points, left, keep_above=True), right, keep_above=False)
            if len(polygon) >= 3:
                parts.append("M" + "L".join(f"{nc._n(px)} {nc._n(py)}" for px, py in polygon) + "Z")
        else:
            for run in _clip_polyline(points, left, right):
                if len(run) >= 2:
                    parts.append("M" + "L".join(f"{nc._n(px)} {nc._n(py)}" for px, py in run))
    return "".join(parts)


def _clip_polygon(points: Sequence[tuple[float, float]], edge: float, *,
                  keep_above: bool) -> list[tuple[float, float]]:
    """Sutherland and Hodgman's cut of a polygon by the line ``x = edge``."""
    def inside(point: tuple[float, float]) -> bool:
        return point[0] >= edge if keep_above else point[0] <= edge

    out: list[tuple[float, float]] = []
    if not points:
        return out
    previous = points[-1]
    for point in points:
        if inside(point):
            if not inside(previous):
                out.append(_cross(previous, point, edge))
            out.append(point)
        elif inside(previous):
            out.append(_cross(previous, point, edge))
        previous = point
    return out


def _cross(a: tuple[float, float], b: tuple[float, float], edge: float) -> tuple[float, float]:
    if b[0] == a[0]:
        return (edge, a[1])
    t = (edge - a[0]) / (b[0] - a[0])
    return (edge, a[1] + (b[1] - a[1]) * t)


def _clip_polyline(points: Sequence[tuple[float, float]], left: float,
                   right: float) -> list[list[tuple[float, float]]]:
    runs: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    for a, b in zip(points, points[1:]):
        lo, hi = (a, b) if a[0] <= b[0] else (b, a)
        if hi[0] < left or lo[0] > right:
            if current:
                runs.append(current)
                current = []
            continue
        start = _cross(a, b, left) if min(a[0], b[0]) < left <= max(a[0], b[0]) and a[0] < left else a
        start = _cross(a, b, right) if a[0] > right else start
        end = _cross(a, b, left) if b[0] < left else (_cross(a, b, right) if b[0] > right else b)
        if not current or current[-1] != start:
            if current:
                runs.append(current)
            current = [start]
        current.append(end)
    if current:
        runs.append(current)
    return runs


def glyph_unit(units: float, written: str, *, most: int = MAX_GLYPHS) -> float:
    """How many units one glyph stands for: what the block says (``per glyph: 10``), else
    the smallest round number that keeps the glyphs to ``most``."""
    number = nc.read_number(written) if written else "empty"
    if isinstance(number, nc.Number) and number.value > 0:
        return number.value
    for unit in GLYPH_UNITS:
        if units / unit <= most:
            return float(unit)
    return float(math.ceil(units / most))


# -- reading parts, numbers and days -------------------------------------------------------------


@dataclass(frozen=True)
class Part:
    """One part of a whole: its name as printed, its amount, its paint, and the value of
    the colour column it is (empty for a chart with no colour column)."""

    name: str
    amount: float
    paint: "Paint"
    value: str = ""


def parts_of(reading: "Reading", theme: "ChartTheme", *, leave: Sequence[str] = ()) -> list[Part]:
    """The parts a whole is made of: the colour column's values and their totals, in the
    order a grade or a written order gives, else largest first; ``leave`` names parts that
    are not parts (a waffle's whole). Under a highlight the other parts take greys."""
    left = {name.casefold() for name in leave}
    found = [(value, reading.totals.get(value, 0.0)) for value in reading.values
             if value.casefold() not in left]
    how = reading.block.sort or ("as written" if reading.graded or reading.block.order else reading.kind.sort)
    if how == "largest first":
        found.sort(key=lambda pair: (pair[0] == nc.OTHER, -pair[1]))
    elif how == "smallest first":
        found.sort(key=lambda pair: (pair[0] == nc.OTHER, pair[1]))
    elif how == "a to z":
        found.sort(key=lambda pair: (pair[0] == nc.OTHER, pair[0].casefold()))
    paints = [reading.paint(value) for value, _ in found]
    greys = [index for index, paint in enumerate(paints) if paint.origin == "highlight" and paint.colour == theme.others]
    for rank, index in enumerate(greys):
        paints[index] = replace(paints[index], colour=grey_step(theme, rank, len(greys)))
    return [Part(name or reading.count_label, amount, paint, name) for (name, amount), paint in zip(found, paints)]


def grey_step(theme: "ChartTheme", rank: int, count: int) -> str:
    """One of ``count`` greys from dark to light on the paper: the parts a highlight leaves."""
    darkest = nc._mix(theme.others, theme.ink, 0.38)
    lightest = nc._mix(theme.others, theme.paper, 0.55)
    if count <= 1:
        return nc._mix(darkest, lightest, 0.35)
    return nc._mix(darkest, lightest, rank / (count - 1))


def folded(parts: list[Part], theme: "ChartTheme", most: int = MAX_SLICES) -> tuple[list[Part], list[Part]]:
    """The parts drawn and those folded into one `OTHERS` part, the smallest first folded."""
    if len(parts) <= most:
        return parts, []
    ranked = sorted(range(len(parts)), key=lambda index: (parts[index].name == nc.OTHER, -parts[index].amount))
    keep = set(ranked[:most - 1])
    kept = [part for index, part in enumerate(parts) if index in keep]
    gone = [part for index, part in enumerate(parts) if index not in keep]
    kept.append(Part(OTHERS, sum(part.amount for part in gone), nc.Paint(theme.others, origin="other")))
    return kept, gone


def folded_note(gone: list[Part], amount: Callable[[float], str], hidden: int = 0) -> str:
    """What `OTHERS` holds: its parts by name and number, or the first names and how many
    more when they are many (``hidden`` counts values the colour column folded already)."""
    if not gone:
        return ""
    named = [part for part in gone if part.value != nc.OTHER]
    total = amount(sum(part.amount for part in gone))
    if not hidden and len(named) <= 5:
        names = [f"{part.name} {amount(part.amount)}" for part in named]
        listed = ", ".join(names[:-1]) + f" and {names[-1]}" if len(names) > 1 else names[0]
        return f"{OTHERS}: {listed}."
    shown = [part.name for part in named[:3]]
    more = len(named) - len(shown) + hidden
    if not shown:
        return f"{OTHERS}: {more} parts, {total} together."
    return f"{OTHERS}: {', '.join(shown)} and {more} more, {total} together."


def hidden_values(reading: "Reading") -> int:
    """How many of the colour column's values its reading folded into one `notes_charts.OTHER`."""
    if nc.OTHER not in reading.values or reading.table is None or reading.colour is None:
        return 0
    seen = {row[reading.colour].casefold() for row in reading.table.rows if row[reading.colour]}
    return max(0, len(seen) - (len(reading.values) - 1))


@dataclass(frozen=True)
class Written:
    """How a column writes its amounts, so a chart prints them back the same way."""

    prefix: str = ""
    suffix: str = ""
    compact: bool = False
    billions: str = "bn"
    thousands: str = "k"

    def text(self, value: float) -> str:
        if self.compact:
            for size, unit in ((1e9, self.billions), (1e6, "M"), (1e3, self.thousands)):
                if abs(value) >= size:
                    shown = value / size
                    digits = 0 if shown >= 100 or abs(shown - round(shown)) < 0.05 else 1
                    return f"{self.prefix}{shown:,.{digits}f}{unit}{self.suffix}"
        return f"{self.prefix}{nc.number_text(value)}{self.suffix}"


def written(reading: "Reading", column: int | None = None) -> Written:
    """How the count column (or ``column``) writes its numbers: ``$8.4M`` prints back so."""
    table = reading.table
    column = reading.count if column is None else column
    if table is None or column is None:
        return Written()
    prefix = suffix = ""
    compact = False
    billions, thousands = "bn", "k"
    for row in table.rows:
        cell = row[column] if column < len(row) else ""
        match = re.search(r"([$€£])", cell)
        if match and not prefix:
            prefix = match.group(1)
        if cell.rstrip().endswith("%"):
            suffix = "%"
        magnitude = re.search(r"\d\s*(bn|B|M|k|K)\b", cell)
        if magnitude:
            compact = True
            if magnitude.group(1) == "B":
                billions = "B"
            if magnitude.group(1) == "K":
                thousands = "K"
    return Written(prefix, suffix, compact, billions, thousands)


_MONTH_WORDS = (("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"), ("may",),
                ("jun", "june"), ("jul", "july"), ("aug", "august"), ("sep", "sept", "september"),
                ("oct", "october"), ("nov", "november"), ("dec", "december"))
MONTHS = {word: index for index, words in enumerate(_MONTH_WORDS, start=1) for word in words}
MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_ISO = re.compile(r"^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$")
_DAY_MONTH = re.compile(r"^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?(?:\s+(\d{4}))?$")
_MONTH_DAY = re.compile(r"^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?$")
_MONTH_YEAR = re.compile(r"^([A-Za-z]{3,9})\.?\s+(\d{4})$")
_YEAR = re.compile(r"^(\d{4})$")
#: The year a day written without one is placed in, when no cell says one: a leap year,
#: never printed.
NO_YEAR = 2000


@dataclass(frozen=True)
class Day:
    """A day a cell names, how precisely (``day``, ``month``, ``year``) and whether it said its year."""

    day: date
    precision: str = "day"
    year: bool = True


def read_day(cell: str, year: int | None = None) -> Day | None:
    """A cell's day: ``2026-10-05``, ``5 Oct 2026``, ``Oct 5, 2026``, ``5 Oct``, ``Oct 2026``
    or ``2026``. A day with no year takes ``year``, else `NO_YEAR`, and says it had none."""
    text = " ".join(nc.plain_cell(cell).split()).strip().rstrip(".")
    if not text:
        return None
    try:
        match = _ISO.match(text)
        if match:
            if match.group(3):
                return Day(date(int(match.group(1)), int(match.group(2)), int(match.group(3))))
            return Day(date(int(match.group(1)), int(match.group(2)), 1), "month")
        match = _MONTH_YEAR.match(text)
        if match and match.group(1).casefold() in MONTHS:
            return Day(date(int(match.group(2)), MONTHS[match.group(1).casefold()], 1), "month")
        match = _YEAR.match(text)
        if match and 1000 <= int(match.group(1)) <= 2999:
            return Day(date(int(match.group(1)), 1, 1), "year")
        for pattern, day_at, month_at in ((_DAY_MONTH, 1, 2), (_MONTH_DAY, 2, 1)):
            match = pattern.match(text)
            if match and match.group(month_at).casefold() in MONTHS:
                said = match.group(3)
                return Day(date(int(said) if said else (year or NO_YEAR), MONTHS[match.group(month_at).casefold()],
                                int(match.group(day_at))), year=bool(said or year))
    except ValueError:
        return None
    return None


def day_column(rows: list[list[str]], column: int) -> bool:
    """Whether a column holds days: at least two, and half its filled cells or more."""
    cells = [row[column] for row in rows if column < len(row) and row[column]]
    found = sum(1 for cell in cells if read_day(cell) is not None)
    return found >= 2 and found * 2 >= len(cells)


def column_year(rows: list[list[str]], columns: Sequence[int]) -> int | None:
    """The first year any of these columns says, for the days written without one."""
    for row in rows:
        for column in columns:
            if column < len(row):
                found = read_day(row[column])
                if found is not None and found.year and found.day.year != NO_YEAR:
                    return found.day.year
    return None


def day_text(day: Day | date, *, year: bool = False) -> str:
    """``5 Oct``, ``5 Oct 2026``, ``Oct 2026`` or ``2026``."""
    found = day if isinstance(day, Day) else Day(day)
    value = found.day
    if found.precision == "year":
        return str(value.year)
    if found.precision == "month":
        return f"{MONTH_NAMES[value.month - 1]} {value.year}" if found.year else MONTH_NAMES[value.month - 1]
    shown = f"{value.day} {MONTH_NAMES[value.month - 1]}"
    return f"{shown} {value.year}" if year and found.year else shown


def time_ticks(start: date, end: date, width: float, *, years: bool = True) -> list[tuple[date, str]]:
    """Ticks between two days that fit ``width``: days, weeks, the 1st and 15th, months,
    quarters or years, the finest whose labels stand side by side. A year is printed on
    the first tick and where it changes."""
    span = max(1, (end - start).days)
    room = max(2, int(width // 58))
    steps: list[tuple[str, int]] = [("day", 1), ("day", 2), *([("day", 7)] if span <= 45 else []), ("half", 1),
                                    ("month", 1), ("month", 3), ("month", 6), ("year", 1), ("year", 5), ("year", 10)]
    for kind, step in steps:
        ticks = _ticks(start, end, kind, step)
        if len(ticks) <= room and (len(ticks) >= 2 or kind == "year" and step == 10 or span < 2):
            break
    out: list[tuple[date, str]] = []
    last_year: int | None = None
    for tick in ticks:
        if kind == "year":
            label = str(tick.year)
        elif kind == "month":
            label = MONTH_NAMES[tick.month - 1]
            if years and tick.year != last_year:
                label = f"{label} {tick.year}"
        else:
            label = f"{tick.day} {MONTH_NAMES[tick.month - 1]}"
            if years and tick.year != last_year and last_year is not None:
                label = f"{label} {tick.year}"
        last_year = tick.year
        out.append((tick, label))
    return out


def _ticks(start: date, end: date, kind: str, step: int) -> list[date]:
    out: list[date] = []
    if kind == "day":
        current = start
        while current <= end:
            out.append(current)
            current += timedelta(days=step)
    elif kind == "half":
        current = date(start.year, start.month, 1)
        while current <= end:
            for day in (1, 15):
                tick = current.replace(day=day)
                if start <= tick <= end:
                    out.append(tick)
            current = _add_months(current, 1)
    elif kind == "month":
        current = date(start.year, start.month, 1)
        while current < start or (current.month - 1) % step:
            current = _add_months(current, 1)
        while current <= end:
            out.append(current)
            current = _add_months(current, step)
    else:
        first = start.year if start == date(start.year, 1, 1) else start.year + 1
        first += (-first) % step
        out = [date(year, 1, 1) for year in range(first, end.year + 1, step) if date(year, 1, 1) <= end]
    return out


def _add_months(day: date, months: int) -> date:
    index = day.year * 12 + day.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


# -- small layout helpers ------------------------------------------------------------------------


def shifted(mark: "Mark", dx: float, dy: float) -> "Mark":
    """A mark moved by ``(dx, dy)``."""
    if isinstance(mark, nc.Group):
        return nc.Group(tuple(shifted(inner, dx, dy) for inner in mark.marks), mark.title)
    if isinstance(mark, nc.Line):
        return replace(mark, points=tuple((x + dx, y + dy) for x, y in mark.points))
    if isinstance(mark, nc.Circle):
        return replace(mark, cx=mark.cx + dx, cy=mark.cy + dy)
    if isinstance(mark, (nc.Rect, nc.Shape, nc.Text, nc.Picture)):
        return replace(mark, x=mark.x + dx, y=mark.y + dy)
    return mark


def centred(marks: list["Mark"], height: float, box: "Box") -> tuple[list["Mark"], float]:
    """Marks laid ``height`` tall, moved down to the middle of a fixed box that is taller."""
    if box.height is None or box.height <= height + 1:
        return marks, height
    dy = (box.height - height) / 2
    return [shifted(mark, 0, dy) for mark in marks], box.height


def lines_of(text: str, width: float, size: float, face: Any, *, bold: bool = False) -> list[str]:
    """``text`` wrapped to ``width``, as many lines as it takes: nothing is ever cut. A word
    longer than the width stands on a line of its own."""
    lines, _ = nc.wrap(text, max(width, 8.0), size, face, bold=bold, lines=10_000)
    if any(nc.text_width(line, size, face, bold) > width + 0.5 for line in lines):
        lines = _hard_wrap(text, width, size, face, bold)
    return lines or [""]


def _hard_wrap(text: str, width: float, size: float, face: Any, bold: bool) -> list[str]:
    out: list[str] = []
    current = ""
    for word in text.split():
        trial = f"{current} {word}".strip()
        if nc.text_width(trial, size, face, bold) <= width or not current:
            current = trial
        else:
            out.append(current)
            current = word
        while nc.text_width(current, size, face, bold) > width and len(current) > 1:
            cut = len(current) - 1
            while cut > 1 and nc.text_width(current[:cut], size, face, bold) > width:
                cut -= 1
            out.append(current[:cut])
            current = current[cut:]
    if current:
        out.append(current)
    return out


def names_legend(swatches: list["Swatch"], theme: "ChartTheme", x0: float, y0: float, width: float, *,
                 numbers: bool | set[str] = True, amount: Callable[[float], str] | None = None
                 ) -> tuple[list["Mark"], float]:
    """A legend in rows like `notes_charts.legend_marks`, a value's number printed only
    when ``numbers`` says (True, or the set of values that need one: a part too small to
    print its own)."""
    amount = amount or nc.number_text
    marks: list[Mark] = []
    size = theme.label_size - 0.5
    x, row = x0, 0
    line_height = size * 1.7
    for swatch in swatches:
        label_width = nc.text_width(swatch.value, size, theme.head)
        shown = numbers is True or (isinstance(numbers, set) and swatch.value in numbers)
        total = amount(swatch.total) if shown else ""
        total_width = nc.text_width(total, size, theme.head, bold=True) + 5 if total else 0.0
        item = 17 + label_width + total_width
        if x > x0 and x + item > x0 + width:
            x, row = x0, row + 1
        base = y0 + row * line_height + size
        group: list[Mark] = [nc.swatch_rect(swatch.paint, x, base - 10, 11, 11, theme),
                             nc.Text(x + 17, base, swatch.value, size, theme.ink2)]
        if total:
            group.append(nc.Text(x + 17 + label_width + 5, base, total, size, theme.ink, bold=True))
        marks.append(nc.Group(tuple(group), f"{swatch.value}: {amount(swatch.total)}"))
        x += item + 16
    return marks, (row + 1) * line_height - size * 0.4


def _noun(reading: "Reading") -> str:
    """What one unit is (``vehicles``), from the title or the count column; empty when
    neither says (a count column named "At least" names nothing)."""
    found = nc.noun_of(reading)
    if found or reading.count is None:
        return found
    label = " ".join(nc.FLOOR_WORDS.sub("", reading.count_label).split())
    return "" if not label or label.casefold() in nc.NOT_A_NOUN else nc._lower(label)


def _check(reading: "Reading", message: str, key: str | None = None, kind: str = "other") -> "Check":
    return nc.Check(f"{reading.said()} {message}" if not message[:1].isupper() else message, kind,
                    reading.block.where.get(key) if key else None)


# -- pie and donut -------------------------------------------------------------------------------------


def _point(cx: float, cy: float, radius: float, angle: float) -> tuple[float, float]:
    """A point ``angle`` degrees clockwise from twelve o'clock."""
    turn = math.radians(angle)
    return cx + radius * math.sin(turn), cy - radius * math.cos(turn)


def wedge_path(cx: float, cy: float, outer: float, inner: float, start: float, end: float,
               gap: float = 2.0) -> str:
    """A slice of a pie (``inner`` 0) or of a ring from ``start`` to ``end`` degrees, its two
    straight edges drawn ``gap / 2`` in from the cut, so neighbours keep a gap of paper."""
    sweep = end - start
    if sweep >= 359.999:
        if inner > 0:
            return (_arc_ring(cx, cy, outer, 1) + _arc_ring(cx, cy, inner, 0))
        return _arc_ring(cx, cy, outer, 1)
    half = gap / 2
    outer_cut = math.degrees(math.asin(min(1.0, half / outer))) if outer > half else sweep / 2
    if sweep - 2 * outer_cut < 0.25:
        outer_cut = max(0.0, (sweep - 0.25) / 2)
    a0, a1 = start + outer_cut, end - outer_cut
    large = 1 if a1 - a0 > 180 else 0
    ox0, oy0 = _point(cx, cy, outer, a0)
    ox1, oy1 = _point(cx, cy, outer, a1)
    path = f"M{nc._n(ox0)} {nc._n(oy0)}A{nc._n(outer)} {nc._n(outer)} 0 {large} 1 {nc._n(ox1)} {nc._n(oy1)}"
    if inner > half:
        inner_cut = math.degrees(math.asin(min(1.0, half / inner)))
        b0, b1 = start + inner_cut, end - inner_cut
        if b1 - b0 < 0.1:
            middle = (start + end) / 2
            b0 = b1 = middle
        ix1, iy1 = _point(cx, cy, inner, b1)
        ix0, iy0 = _point(cx, cy, inner, b0)
        small = 1 if b1 - b0 > 180 else 0
        path += (f"L{nc._n(ix1)} {nc._n(iy1)}A{nc._n(inner)} {nc._n(inner)} 0 {small} 0 "
                 f"{nc._n(ix0)} {nc._n(iy0)}Z")
    else:
        # the two cut edges meet on the bisector, a little off the centre
        middle = math.radians((start + end) / 2)
        reach = min(half / max(math.sin(math.radians(sweep / 2)), 1e-6), outer * 0.4) if sweep < 180 else 0.0
        path += f"L{nc._n(cx + reach * math.sin(middle))} {nc._n(cy - reach * math.cos(middle))}Z"
    return path


def _arc_ring(cx: float, cy: float, radius: float, sweep: int) -> str:
    top, bottom = cy - radius, cy + radius
    r = nc._n(radius)
    return (f"M{nc._n(cx)} {nc._n(top)}A{r} {r} 0 1 {sweep} {nc._n(cx)} {nc._n(bottom)}"
            f"A{r} {r} 0 1 {sweep} {nc._n(cx)} {nc._n(top)}Z")


def plot_pie(reading: "Reading", theme: "ChartTheme", box: "Box") -> "Plot":
    return _plot_round(reading, theme, box, hole=0.0)


def plot_donut(reading: "Reading", theme: "ChartTheme", box: "Box") -> "Plot":
    return _plot_round(reading, theme, box, hole=0.6)


def _plot_round(reading: "Reading", theme: "ChartTheme", box: "Box", *, hole: float) -> "Plot":
    """A pie or a donut beside its legend (under it when the box is narrow); a donut's
    middle says the total or one part."""
    shown = written(reading)
    every = parts_of(reading, theme)
    parts, gone = folded([part for part in every if part.amount > 0], theme)
    zeros = [part for part in every if part.amount <= 0]
    total = sum(part.amount for part in parts)
    if total <= 0:
        return nc.Plot([], 0.0, desc="A chart with nothing to draw.")
    size = theme.label_size
    legend_rows = parts + zeros
    name_width = max(nc.text_width(part.name, size, theme.head) for part in legend_rows)
    value_width = max(nc.text_width(shown.text(part.amount), size, theme.head, bold=True) for part in legend_rows)
    # beside its legend, or over it in a narrow box or a tall frame (4:5), where it can grow
    tall = box.height is not None and box.height > box.width * 0.85
    beside = box.width >= 400 and not tall
    available_height = box.height if box.height is not None else None
    if beside:
        legend_width = min(name_width + value_width + 50, box.width * 0.48)
        diameter = min(250.0, box.width - legend_width - 32)
    else:
        legend_width = box.width
        diameter = min(340.0 if tall else 250.0, box.width * 0.8)
    if available_height is not None:
        legend_height = len(legend_rows) * 28.0 if not beside else 0.0
        diameter = min(diameter, max(80.0, available_height - legend_height - 12))
    diameter = max(80.0, diameter)
    radius = diameter / 2
    cx, cy = (box.x + radius if beside else box.x + box.width / 2), box.y + radius
    wedges: list[Mark] = []
    angles: list[float] = []
    lines: list[str] = []
    at = 0.0
    for part in parts:
        sweep = part.amount / total * 360
        angles.append(sweep)
        path = wedge_path(cx, cy, radius, radius * hole, at, at + sweep)
        share = part.amount / total * 100
        said = f"{part.name}: {shown.text(part.amount)}, {_share(share)}"
        if part.paint.outline:
            body = nc.Shape(path, theme.paper, stroke=part.paint.colour, stroke_width=1.5)
        else:
            body = nc.Shape(path, part.paint.colour, hatch=part.paint.hatch)
        wedges.append(nc.Group((body,), said))
        lines.append(said)
        at += sweep
    for part in zeros:
        lines.append(f"{part.name}: 0")
    if hole:
        wedges.extend(_donut_middle(reading, theme, every, total, cx, cy, radius * hole, shown))
    # the legend: a swatch, the name (wrapped, never cut), the number at the right
    legend: list[Mark] = []
    if beside:
        lx = box.x + diameter + 32
        ly = box.y + max(0.0, radius - len(legend_rows) * 14.5)
        text_width = legend_width - value_width - 30
    else:
        # under the pie, as wide as its words need and centred on it
        legend_width = min(box.width, name_width + value_width + 90)
        lx, ly = max(box.x, cx - legend_width / 2), box.y + diameter + 16
        text_width = legend_width - value_width - 30
    y = ly
    for part in legend_rows:
        names = lines_of(part.name, text_width, size, theme.head)
        group: list[Mark] = [nc.swatch_rect(part.paint, lx, y + 2, 12, 12, theme)]
        for number, line in enumerate(names):
            group.append(nc.Text(lx + 20, y + 12 + number * size * 1.25, line, size, theme.ink2))
        group.append(nc.Text(lx + 20 + text_width + 10 + value_width, y + 12, shown.text(part.amount), size,
                             theme.ink, bold=True, anchor="end"))
        legend.append(nc.Group(tuple(group), f"{part.name}: {shown.text(part.amount)}"))
        y += max(28.0, len(names) * size * 1.25 + 12)
    legend_height = y - box.y - 16
    height = max(diameter, legend_height) if beside else y - box.y
    if beside and legend_height > diameter:
        # a long legend: the pie sits in its middle
        wedges = [shifted(mark, 0, (legend_height - diameter) / 2) for mark in wedges]
    marks = [*wedges, *legend]
    notes = [note for note in [folded_note(gone, shown.text, hidden_values(reading))] if note]
    marks, height = centred(marks, height, box)
    swatches = [nc.Swatch(part.name, part.paint, part.amount) for part in legend_rows]
    return nc.Plot(marks, height, lines=lines, legend=swatches, notes=notes,
                   facts={"angles": angles, "parts": [(part.name, part.amount) for part in parts],
                          "folded": [part.name for part in gone], "radius": radius, "hole": radius * hole})


def _share(percent: float) -> str:
    if percent >= 10 or abs(percent - round(percent)) < 0.05:
        return f"{round(percent):d}%"
    return f"{percent:.1f}%" if percent >= 0.1 else "under 0.1%"


def _donut_middle(reading: "Reading", theme: "ChartTheme", every: list[Part], total: float,
                  cx: float, cy: float, hole: float, shown: Written) -> list["Mark"]:
    """The number in a donut's hole: a part's (``centre: UAE``, or the one highlighted), or
    the total (``centre: total``); ``centre: none`` leaves it empty."""
    wanted = (reading.block.extra.get("centre") or reading.block.extra.get("center") or "").strip()
    part = None
    if wanted.casefold() in ("none", "nothing", "empty"):
        return []
    if wanted and wanted.casefold() not in ("total", "all", "the total"):
        part = next((one for one in every if one.name.casefold() == wanted.casefold()), None)
    elif not wanted and reading.block.highlight:
        lit = {value.casefold() for value in reading.block.highlight}
        matches = [one for one in every if one.name.casefold() in lit]
        part = matches[0] if len(matches) == 1 else None
    room = hole * 1.6
    small = max(10.0, min(13.0, hole * 0.2))
    lines: list[tuple[str, float, bool, str]] = []
    if part is not None:
        lines.append((shown.text(part.amount), 0.0, True, theme.ink))
        lines.append((f"of {shown.text(total)}", small, False, theme.ink2))
        lines.extend((line, small, False, theme.ink2) for line in lines_of(part.name, room, small, theme.head))
    else:
        if reading.floor:
            lines.append(("at least", small, False, theme.ink2))
        lines.append((shown.text(total), 0.0, True, theme.ink))
        noun = _noun(reading)
        lines.extend((line, small, False, theme.ink2) for line in lines_of(noun or "in all", room, small, theme.head))
    big = min(40.0, hole * 0.62)
    widest = max(nc.text_width(text, 1.0, theme.head, bold=True) for text, size, bold, _ in lines if not size)
    big = max(14.0, min(big, room / max(widest, 0.01)))
    heights = [(big if not size else size) * (1.05 if not size else 1.3) for text, size, bold, _ in lines]
    y = cy - sum(heights) / 2
    marks: list[Mark] = []
    for (text, size, bold, colour), height in zip(lines, heights):
        y += height
        marks.append(nc.Text(cx, y - height * 0.22, text, big if not size else size, colour, bold=bold,
                             anchor="middle"))
    return marks


# -- segments ------------------------------------------------------------------------------------------


def plot_segments(reading: "Reading", theme: "ChartTheme", box: "Box") -> "Plot":
    """One bar of the parts: across, each part's number inside it when it fits and under it
    on a leader when it does not, the names in a legend under; or standing (``bars: up``),
    each part named beside it."""
    shown = written(reading)
    every = parts_of(reading, theme)
    parts = [part for part in every if part.amount > 0]
    total = sum(part.amount for part in parts)
    if total <= 0:
        return nc.Plot([], 0.0, desc="A chart with nothing to draw.")
    if reading.block.bars == nc.UP:
        return _segments_up(reading, theme, box, every, parts, total, shown)
    size = theme.inside_size + 1
    gap = 2.0
    length = box.width
    usable = length - gap * (len(parts) - 1)
    thickness = SEGMENT_THICKNESS
    top = box.y
    marks: list[Mark] = []
    outside: list[tuple[float, str, Part]] = []
    x = box.x
    spans: list[tuple[str, float, float]] = []
    for part in parts:
        width = max(usable * part.amount / total, 1.0)
        label = shown.text(part.amount)
        rect = nc.fill_rect(part.paint, x, top, width, thickness, theme.radius + 1 if theme.radius else 0.0,
                            "all", theme)
        group: list[Mark] = [rect]
        need = nc.text_width(label, size, theme.head, bold=True) + 14
        if width >= need:
            ink = nc.ink_on(part.paint, theme)
            if part.paint.hatch:
                # a hatched part prints its number on a chip of paper, so the stripes never cross it
                chip_w = need - 6
                group.append(nc.Rect(x + 4, top + thickness / 2 - size * 0.75, chip_w, size * 1.5, theme.paper, 2.0,
                                     "all"))
                ink = theme.ink
            group.append(nc.Text(x + 7, top + thickness / 2 + size * 0.36, label, size, ink, bold=True))
        else:
            outside.append((x + width / 2, label, part))
        marks.append(nc.Group(tuple(group), f"{part.name}: {label}, {_share(part.amount / total * 100)}"))
        spans.append((part.name, x - box.x, width))
        x += width + gap
    y = top + thickness
    if outside:
        y += 8
        placed = _spread([(centre, nc.text_width(label, size, theme.head, bold=True)) for centre, label, _ in outside],
                         box.x, box.x + box.width, 8.0)
        row_y = y + 12 + size
        for (centre, label, part), left in zip(outside, placed):
            width = nc.text_width(label, size, theme.head, bold=True)
            middle = left + width / 2
            marks.append(nc.Line(((centre, top + thickness + 2), (centre, y + 4), (middle, row_y - size - 2)),
                                 theme.muted, 1.0))
            marks.append(nc.Text(left, row_y, label, size, theme.ink, bold=True))
        y = row_y + 4
    zeros = {part.name for part in every if part.amount <= 0}
    swatches = [nc.Swatch(part.name, part.paint, part.amount) for part in every]
    legend, used = names_legend(swatches, theme, box.x, y + 12, box.width, numbers=zeros, amount=shown.text)
    marks.extend(legend)
    height = y + 12 + used - box.y
    marks, height = centred(marks, height, box)
    lines = [f"{part.name}: {shown.text(part.amount)}, {_share(part.amount / total * 100)}" for part in every]
    return nc.Plot(marks, height, lines=lines, legend=swatches,
                   facts={"spans": spans, "outside": [part.name for _, _, part in outside], "length": length})


def _segments_up(reading: "Reading", theme: "ChartTheme", box: "Box", every: list[Part], parts: list[Part],
                 total: float, shown: Written) -> "Plot":
    size = theme.label_size
    gap = 2.0
    width = 44.0
    natural = max(220.0, 30.0 * len(every) + 40)
    height = max(120.0, (box.height - 4) if box.height is not None else natural)
    usable = height - gap * (len(parts) - 1)
    marks: list[Mark] = []
    centres: list[float] = []
    y = box.y
    spans: list[tuple[str, float, float]] = []
    for part in parts:
        extent = max(usable * part.amount / total, 1.0)
        rect = nc.fill_rect(part.paint, box.x, y, width, extent, theme.radius + 1 if theme.radius else 0.0, "all",
                            theme)
        marks.append(nc.Group((rect,), f"{part.name}: {shown.text(part.amount)}"))
        centres.append(y + extent / 2)
        spans.append((part.name, y - box.y, extent))
        y += extent + gap
    # every part named beside its block, moved apart where blocks are thin, joined by a leader
    label_x = box.x + width + 26
    room = box.x + box.width - label_x
    blocks: list[list[str]] = []
    for part in parts:
        value_width = nc.text_width(shown.text(part.amount), size, theme.head, bold=True) + 8
        blocks.append(lines_of(part.name, max(room - value_width, 40.0), size, theme.head))
    heights = [len(found) * size * 1.25 + 4 for found in blocks]
    tops = _stack([centre - h / 2 for centre, h in zip(centres, heights)], heights, box.y, box.y + height)
    for part, found, top, h, centre in zip(parts, blocks, tops, heights, centres):
        middle = top + h / 2
        marks.append(nc.Line(((box.x + width + 3, centre), (box.x + width + 12, centre), (label_x - 4, middle)),
                             theme.muted, 1.0))
        for number, line in enumerate(found):
            marks.append(nc.Text(label_x, top + size + number * size * 1.25, line, size, theme.ink2))
        last = top + size + (len(found) - 1) * size * 1.25
        marks.append(nc.Text(label_x + nc.text_width(found[-1], size, theme.head) + 8, last, shown.text(part.amount),
                             size, theme.ink, bold=True))
    end = max([box.y + height, *(top + h for top, h in zip(tops, heights))])
    zeros = [part for part in every if part.amount <= 0]
    if zeros:
        swatches = [nc.Swatch(part.name, part.paint, 0.0) for part in zeros]
        legend, used = names_legend(swatches, theme, box.x, end + 12, box.width, amount=shown.text)
        marks.extend(legend)
        end += 12 + used
    swatches = [nc.Swatch(part.name, part.paint, part.amount) for part in every]
    lines = [f"{part.name}: {shown.text(part.amount)}, {_share(part.amount / total * 100)}" for part in every]
    return nc.Plot(marks, end - box.y, lines=lines, legend=swatches,
                   facts={"spans": spans, "outside": [], "length": height})


def _spread(items: list[tuple[float, float]], left: float, right: float, gap: float) -> list[float]:
    """Where labels centred on ``items[i][0]``, ``items[i][1]`` wide, start on one line so
    none meets the next and all stay between ``left`` and ``right``."""
    starts = [max(left, centre - width / 2) for centre, width in items]
    for index in range(1, len(starts)):
        starts[index] = max(starts[index], starts[index - 1] + items[index - 1][1] + gap)
    overflow = starts[-1] + items[-1][1] - right if starts else 0.0
    if overflow > 0:
        starts[-1] -= overflow
        for index in range(len(starts) - 2, -1, -1):
            starts[index] = min(starts[index], starts[index + 1] - items[index][1] - gap)
        shift = left - starts[0]
        if shift > 0:
            starts = [start + shift for start in starts]
    return starts


def _stack(tops: list[float], heights: list[float], low: float, high: float) -> list[float]:
    """Blocks wanted at ``tops``, moved down then up so none overlaps the next."""
    out = list(tops)
    for index in range(len(out)):
        if index:
            out[index] = max(out[index], out[index - 1] + heights[index - 1])
        out[index] = max(out[index], low)
    over = (out[-1] + heights[-1] - high) if out else 0.0
    if over > 0:
        out[-1] -= over
        for index in range(len(out) - 2, -1, -1):
            out[index] = min(out[index], out[index + 1] - heights[index])
    return out


# -- pictograms and silhouette rows -------------------------------------------------------------------


@dataclass
class Unit:
    """A run of units of one part drawn with one glyph: ``count`` glyphs' worth of them."""

    value: str
    count: float
    key: str
    rows: list[int]


def _icon_column(reading: "Reading", key: str) -> int | None:
    written_icon = (reading.block.extra.get(key) or "").strip()
    if not written_icon or reading.table is None:
        return None
    return reading.table.column(written_icon)


def _icon_for(reading: "Reading", row: int | None, column: int | None) -> str:
    """The glyph a unit wears: its row's icon cell, else the block's ``icon``, else the dot."""
    if column is not None and row is not None and reading.table is not None:
        found = glyph_key(reading.table.rows[row][column])
        if found:
            return found
    written_icon = (reading.block.extra.get("icon") or "").strip()
    if column is None and written_icon:
        found = glyph_key(written_icon)
        if found:
            return found
    return DEFAULT_GLYPH


def _runs(reading: "Reading", segment_rows: list[int], value: str, unit: float, column: int | None) -> list[Unit]:
    """A part's units in runs of one glyph, in row order, as glyphs' worth (``unit`` units one glyph)."""
    runs: list[Unit] = []
    for row in segment_rows:
        key = _icon_for(reading, row, column)
        count = reading.amounts.get(row, 0.0) / unit
        if runs and runs[-1].key == key:
            runs[-1].count += count
            runs[-1].rows.append(row)
        else:
            runs.append(Unit(value, count, key, [row]))
    return runs


def _glyph_cells(units: list[Unit]) -> list[list[tuple[Unit, float, float]]]:
    """Units laid glyph by glyph: each glyph's runs and the share of its width each takes."""
    cells: list[list[tuple[Unit, float, float]]] = []
    filled = 0.0
    for run in units:
        left = run.count
        while left > 1e-9:
            if not cells or filled >= 1 - 1e-9:
                cells.append([])
                filled = 0.0
            take = min(left, 1 - filled)
            cells[-1].append((run, filled, filled + take))
            filled += take
            left -= take
    return cells


def cut_note(unit: float, reading: "Reading") -> str:
    """Said under glyphs that stand for several units when one of them is drawn cut."""
    if unit <= 1:
        return ""
    return f"A cut glyph stands for fewer than {nc.number_text(unit)} {_noun(reading)}".rstrip() + "."


def scale_key(drawing: Glyph, unit: float, reading: "Reading", theme: "ChartTheme", x: float, y: float,
              height: float) -> tuple[list["Mark"], float]:
    """``▮ = 10 vehicles`` above glyphs that stand for several units; its marks and height."""
    if unit <= 1:
        return [], 0.0
    marks = glyph_marks(drawing, nc.Paint(theme.ink2), theme, x, y, height)
    marks.append(nc.Text(x + height * drawing.aspect + 8, y + height * 0.8,
                         f"= {nc.number_text(unit)} {_noun(reading)}".rstrip(), theme.label_size, theme.ink2))
    return marks, height + 14


def _cut_last(cells: list[list[tuple[Unit, float, float]]]) -> bool:
    """Whether the last glyph is drawn in part: its units fill less than its width."""
    return bool(cells) and sum(end - start for _, start, end in cells[-1]) < 1 - 1e-9


def plot_pictograms(reading: "Reading", theme: "ChartTheme", box: "Box") -> "Plot":
    """One glyph per unit in rows of ten (twenty past sixty), part after part, each in its
    part's paint; past `MAX_GLYPHS` one glyph stands for a round number and says so."""
    column = _icon_column(reading, "icon")
    parts = [part for part in parts_of(reading, theme) if part.amount > 0]
    total = sum(part.amount for part in parts)
    if total <= 0:
        return nc.Plot([], 0.0, desc="A chart with nothing to draw.")
    unit = glyph_unit(total, reading.block.extra.get("per glyph", ""))
    rows_of: dict[str, list[int]] = {}
    for category in reading.categories:
        for segment in category.segments:
            rows_of.setdefault(segment.value, []).extend(segment.rows)
    units: list[Unit] = []
    names = {part.value: part for part in parts}
    for part in parts:
        units.extend(_runs(reading, sorted(rows_of.get(part.value, [])), part.value, unit, column))
    cells = _glyph_cells(units)
    glyphs = len(cells)
    across = 10 if glyphs <= 60 else 20
    drawings = {run.key: glyph(run.key) for run in units}
    aspect = max(drawing.aspect for drawing in drawings.values())
    pitch = box.width / across
    glyph_height = min(24.0 if box.height is None else 40.0, pitch / aspect * 0.8)
    if box.height is not None:
        rows_needed = math.ceil(glyphs / across)
        key_room = 30.0 if unit > 1 else 0.0
        glyph_height = min(glyph_height, max(8.0, (box.height - key_room) / max(rows_needed, 1) / 1.3))
    step_x = glyph_height * aspect * 1.25
    step_y = glyph_height * 1.3
    marks: list[Mark] = []
    y0 = box.y
    key_marks, used = scale_key(drawings[units[0].key], unit, reading, theme, box.x, y0, min(glyph_height, 18.0))
    marks.extend(key_marks)
    y0 += used
    counted: dict[str, float] = {}
    shown_names = {part.value: part.name for part in parts}
    for index, cell in enumerate(cells):
        x = box.x + (index % across) * step_x
        y = y0 + (index // across) * step_y
        for run, start, end in cell:
            paint = names[run.value].paint if run.value in names else nc.Paint(theme.series)
            said = f"{names[run.value].name}: {nc.number_text(names[run.value].amount)}" \
                if run.value in names else run.value
            marks.append(nc.Group(tuple(glyph_marks(drawings[run.key], paint, theme, x, y, glyph_height,
                                                     (start, end))), said))
            name = shown_names.get(run.value, run.value)
            counted[name] = counted.get(name, 0.0) + (end - start)
    height = y0 - box.y + math.ceil(glyphs / across) * step_y - (step_y - glyph_height)
    marks, height = centred(marks, height, box)
    notes = [cut_note(unit, reading)] if unit > 1 and _cut_last(cells) else []
    lines = [f"{part.name}: {nc.number_text(part.amount)}" for part in parts]
    return nc.Plot(marks, height, lines=lines, notes=notes,
                   facts={"unit": unit, "glyphs": glyphs, "across": across,
                          "per_part": {value: round(amount, 6) for value, amount in counted.items()}})


def _row_paint(reading: "Reading", theme: "ChartTheme", category: str, value: str) -> "Paint":
    """A glyph's paint: its colour value's; with no colour column, the accent for a row the
    block highlights and grey for the others, else the colour the block's ``colours``
    gives the row's name, else the one series colour."""
    if reading.colour is not None:
        return reading.paint(value)
    lit = {one.casefold() for one in reading.block.highlight}
    if lit:
        return nc.Paint(theme.accent if category.casefold() in lit else theme.others, origin="highlight")
    own = {name.casefold(): colour for name, colour in reading.block.colours.items()}
    if category.casefold() in own:
        return nc.Paint(own[category.casefold()], origin="chart")
    return reading.paint(value)


def plot_silhouettes(reading: "Reading", theme: "ChartTheme", box: "Box") -> "Plot":
    """One row per category: its flag or icon, its name, its count, then a glyph per unit
    in the colour of its part, wrapping onto more lines when the row is long."""
    categories = [category for category in reading.categories if category.total > 0 or category.rows]
    if not categories:
        return nc.Plot([], 0.0, desc="A chart with nothing to draw.")
    column = _icon_column(reading, "icon")
    flags = _icon_column(reading, "flag")
    total = sum(category.total for category in categories)
    unit = glyph_unit(total, reading.block.extra.get("per glyph", ""), most=MAX_ROW_GLYPHS)
    size = theme.label_size + 0.5
    value_size = theme.value_size + 1.5
    counts = [nc.number_text(category.total) for category in categories]
    count_width = max(nc.text_width(text, value_size, theme.head, bold=True) for text in counts)
    flag_width = 26.0 if flags is not None else 0.0
    names_width = min(max(nc.text_width(category.name, size, theme.head) for category in categories),
                      box.width * 0.34)
    glyph_left = box.x + flag_width + names_width + 12 + count_width + 14
    room = box.x + box.width - glyph_left
    glyph_height = 15.0 if box.width < 520 else 17.0
    all_units: dict[int, list[Unit]] = {}
    keys: set[str] = set()
    for index, category in enumerate(categories):
        units: list[Unit] = []
        for segment in category.segments:
            if segment.amount > 0:
                units.extend(_runs(reading, sorted(segment.rows), segment.value, unit, column))
        all_units[index] = units
        keys.update(run.key for run in units)
    drawings = {key: glyph(key) for key in keys} or {DEFAULT_GLYPH: glyph(DEFAULT_GLYPH)}
    aspect = max(drawing.aspect for drawing in drawings.values())
    step_x = glyph_height * aspect + 4
    across = max(1, int((room + 4) // step_x))
    line_step = glyph_height + 6
    marks, used = scale_key(next(iter(drawings.values())), unit, reading, theme, glyph_left, box.y, glyph_height)
    lines_out: list[str] = []
    per_row: list[int] = []
    y = box.y + used
    separated = False
    cut = False
    for index, category in enumerate(categories):
        if category.last and not separated and index:
            marks.append(nc.Line(((box.x, y + 2), (box.x + box.width, y + 2)), theme.grid, 1.0))
            y += 10
            separated = True
        names = lines_of(category.name, names_width, size, theme.head)
        cells = _glyph_cells(all_units[index])
        glyph_lines = max(1, math.ceil(len(cells) / across))
        name_height = len(names) * size * 1.25
        row_height = max(name_height, glyph_lines * line_step - 6, glyph_height)
        first = y + glyph_height / 2 + size * 0.36 if len(names) == 1 else y + size
        if flags is not None:
            flag_key = next((glyph_key(reading.table.rows[row][flags]) for row in category.rows
                             if reading.table is not None and glyph_key(reading.table.rows[row][flags])), "")
            if flag_key:
                flag = glyph(flag_key)
                flag_height = min(16.0, 22.0 / flag.aspect)
                marks.extend(glyph_marks(flag, nc.Paint(theme.ink2), theme, box.x,
                                         y + (glyph_height - flag_height) / 2, flag_height))
        for number, line in enumerate(names):
            marks.append(nc.Text(box.x + flag_width, first + number * size * 1.25, line, size, theme.ink))
        marks.append(nc.Text(glyph_left - 14, first, counts[index], value_size, theme.ink, bold=True, anchor="end"))
        for cell_index, cell in enumerate(cells):
            gx = glyph_left + (cell_index % across) * step_x
            gy = y + (cell_index // across) * line_step
            for run, start, end in cell:
                paint = _row_paint(reading, theme, category.name, run.value)
                said = f"{category.name}, {run.value}: " if run.value else f"{category.name}: "
                amount = next((segment.amount for segment in category.segments if segment.value == run.value), 0.0)
                marks.append(nc.Group(tuple(glyph_marks(drawings[run.key], paint, theme, gx, gy, glyph_height,
                                                         (start, end))), said + nc.number_text(amount)))
        per_row.append(len(cells))
        cut = cut or _cut_last(cells)
        lines_out.append(nc._bar_line(reading, category))
        y += row_height + 12
    height = y - 12 - box.y
    notes = [cut_note(unit, reading)] if cut and unit > 1 else []
    marks, height = centred(marks, height, box)
    return nc.Plot(marks, height, lines=lines_out, notes=notes,
                   facts={"unit": unit, "glyphs": per_row, "across": across})


# -- waffle ----------------------------------------------------------------------------------------------


def _whole(reading: "Reading", parts: list[Part]) -> tuple[float, str, str]:
    """A waffle's whole: the row its ``of`` names, a number, or the parts' sum; with its
    name and how the check should read it ("row", "number", "sum", "unread")."""
    said = (reading.block.extra.get("of") or "").strip()
    if not said:
        return sum(part.amount for part in parts), "", "sum"
    for category in reading.categories:
        if category.name.casefold() == said.casefold():
            return category.total, category.name, "row"
    number = nc.read_number(said)
    if isinstance(number, nc.Number) and number.value > 0:
        return number.value, "", "number"
    return sum(part.amount for part in parts), "", "unread"


def plot_waffle(reading: "Reading", theme: "ChartTheme", box: "Box") -> "Plot":
    """A grid of a whole, ``squares: 100`` (10 by 10) or ``squares: 10000`` (100 by 100,
    its top-left corner drawn enlarged beside it); each part fills its share of squares
    in turn from the top left, a square it only partly holds filled in part."""
    shown = written(reading)
    whole_name_written = (reading.block.extra.get("of") or "").strip()
    every = parts_of(reading, theme, leave=[whole_name_written] if whole_name_written else [])
    parts = [part for part in every if part.amount > 0]
    whole, whole_name, how = _whole(reading, parts)
    if how in ("row", "number") and len(every) <= 3 and all(part.paint.origin == "order" for part in every):
        # a few parts of a far larger whole read as one thing in steps: the accent, then lighter
        every = [replace(part, paint=nc.Paint(nc._mix(theme.accent, theme.paper, step), origin="order"))
                 for part, step in zip(every, (0.0, 0.45, 0.7))]
        parts = [part for part in every if part.amount > 0]
    squares = _squares(reading)
    if whole <= 0 or not parts:
        return nc.Plot([], 0.0, desc="A chart with nothing to draw.")
    each = whole / squares
    spans: list[tuple[Part, float, float]] = []
    at = 0.0
    for part in parts:
        size = min(part.amount / each, squares - at)
        spans.append((part, at, at + size))
        at += size
    empty = nc._mix(theme.grid, theme.ink, 0.06) if not theme.dark else nc._mix(theme.grid, theme.ink, 0.1)
    marks: list[Mark] = []
    legend_x: float
    if squares == 100:
        cell = min(24.0, (box.width * (0.5 if box.width >= 420 else 1.0)) / 10 - 3)
        if box.height is not None:
            cell = min(cell, (box.height - 4) / 10 - 3)
        cell = max(8.0, cell)
        marks.extend(_waffle_cells(spans, 0, 100, 10, box.x, box.y, cell, 3.0, empty, theme))
        side = cell * 10 + 3.0 * 9
        grid_height = side
        legend_x = box.x + side + 24 if box.width >= 420 else box.x
        legend_y = box.y if box.width >= 420 else box.y + side + 16
    else:
        wide = box.width >= 520
        side = min(300.0, box.width * (0.42 if wide else 0.9))
        if box.height is not None:
            side = min(side, box.height - 24 if wide else (box.height - 40) / 2)
        side = max(100.0, side)
        pitch = side / 100
        gap = pitch * 0.2
        marks.append(nc.Rect(box.x, box.y, side, side, empty))
        for part, start, end in spans:
            marks.extend(_runs_fill(part, start, end, box.x, box.y, pitch, theme))
        for index in range(1, 100):
            offset = index * pitch - gap / 2
            marks.append(nc.Rect(box.x + offset, box.y, gap, side, theme.paper))
            marks.append(nc.Rect(box.x, box.y + offset, side, gap, theme.paper))
        corner = pitch * 10
        marks.append(nc.Rect(box.x - 1.5, box.y - 1.5, corner + 3, corner + 3, "none", stroke=theme.ink,
                             stroke_width=1.2))
        inset_cell = min(22.0, (box.width - side - 70) / 10 - 3 if wide else (box.width * 0.6) / 10 - 3)
        inset_cell = max(9.0, inset_cell)
        inset_side = inset_cell * 10 + 3 * 9
        ix = box.x + side + 56 if wide else box.x + side * 0.25
        iy = box.y if wide else box.y + side + 36
        marks.append(nc.Line(((box.x + corner + 1.5, box.y - 1.5), (ix, iy)), theme.ink2, 1.0))
        marks.append(nc.Line(((box.x + corner + 1.5, box.y + corner + 1.5), (ix, iy + inset_side)) if wide else
                             ((box.x - 1.5, box.y + corner + 1.5), (ix, iy)), theme.ink2, 1.0))
        marks.extend(_waffle_cells(spans, 0, 100, 10, ix, iy, inset_cell, 3.0, empty, theme))
        marks.append(nc.Text(ix, iy + inset_side + 16, "The top-left corner, enlarged", theme.note_size, theme.ink2,
                             body=True))
        grid_height = max(side, (iy - box.y) + inset_side + 22)
        legend_x = ix + inset_side + 22 if wide and box.width - (ix + inset_side + 22 - box.x) >= 150 else box.x
        legend_y = box.y if legend_x != box.x else box.y + grid_height + 14
    # the legend: each part and its amount, then what one square is
    legend_width = box.x + box.width - legend_x
    size = theme.label_size
    y = legend_y
    for part in every:
        names = lines_of(part.name, legend_width - 22 - nc.text_width(shown.text(part.amount), size, theme.head,
                                                                         bold=True) - 8, size, theme.head)
        group: list[Mark] = [nc.swatch_rect(part.paint, legend_x, y + 2, 12, 12, theme)]
        for number, line in enumerate(names):
            group.append(nc.Text(legend_x + 20, y + 12 + number * size * 1.25, line, size, theme.ink2))
        last = names[-1]
        group.append(nc.Text(legend_x + 20 + nc.text_width(last, size, theme.head) + 6,
                             y + 12 + (len(names) - 1) * size * 1.25, shown.text(part.amount), size, theme.ink,
                             bold=True))
        marks.append(nc.Group(tuple(group), f"{part.name}: {shown.text(part.amount)}"))
        y += len(names) * size * 1.25 + 10
    y += 6
    scale = "1/100" if squares == 100 else "1/10,000"
    if how == "row":
        said_scale = f"1 square = {scale} of {whole_name}, ≈ {shown.text(each)}"
    elif how == "number":
        said_scale = f"1 square = {scale} of {shown.text(whole)}, ≈ {shown.text(each)}"
    else:
        noun = _noun(reading)
        said_scale = f"1 square = {scale} of the {shown.text(whole)} {noun}" if noun else \
            f"1 square = {scale} of all {shown.text(whole)}"
    for line in lines_of(said_scale, legend_width, theme.note_size, theme.body):
        y += theme.note_size * 1.35
        marks.append(nc.Text(legend_x, y, line, theme.note_size, theme.ink2, body=True))
    if how in ("row", "number"):
        whole_text = f"{whole_name}: {shown.text(whole)}" if whole_name else f"The whole: {shown.text(whole)}"
        for line in lines_of(whole_text, legend_width, theme.note_size, theme.body):
            y += theme.note_size * 1.35
            marks.append(nc.Text(legend_x, y, line, theme.note_size, theme.ink2, body=True))
    height = max(grid_height, y - box.y + 4) if legend_x != box.x else y - box.y + 4
    marks, height = centred(marks, height, box)
    lines = [f"{part.name}: {shown.text(part.amount)}, {_share(part.amount / whole * 100)} of "
             f"{whole_name or 'the whole'}" for part in every]
    return nc.Plot(marks, height, lines=lines, legend=[nc.Swatch(part.name, part.paint, part.amount) for part in every],
                   facts={"squares": squares, "each": each, "whole": whole,
                          "filled": {part.name: round(end - start, 6) for part, start, end in spans}})


def _squares(reading: "Reading") -> int:
    number = nc.read_number(reading.block.extra.get("squares", "") or "100")
    value = int(number.value) if isinstance(number, nc.Number) else 100
    return value if value in SQUARES else 100


def _waffle_cells(spans: list[tuple[Part, float, float]], first: int, last: int, across: int, x0: float, y0: float,
                  cell: float, gap: float, empty: str, theme: "ChartTheme") -> list["Mark"]:
    """Squares ``first`` to ``last`` as a grid ``across`` wide, each filled by the parts
    that hold it, a part it only partly holds filling that share of its width."""
    marks: list[Mark] = []
    radius = 2.0 if theme.radius else 0.0
    for index in range(first, last):
        x = x0 + ((index - first) % across) * (cell + gap)
        y = y0 + ((index - first) // across) * (cell + gap)
        pieces: list[Mark] = [nc.Rect(x, y, cell, cell, empty, radius, "all" if radius else "")]
        title = ""
        for part, start, end in spans:
            low, high = max(start, index), min(end, index + 1)
            if high - low <= 1e-9:
                continue
            width = max(cell * (high - low), 1.2)
            left = x + cell * (low - index)
            pieces.append(nc.fill_rect(part.paint, left, y, width, cell, radius if high - low > 0.98 else 0.0,
                                       "all", theme))
            title = title or part.name
        marks.append(nc.Group(tuple(pieces), title) if title else pieces[0])
    return marks


def _runs_fill(part: Part, start: float, end: float, x0: float, y0: float, pitch: float,
               theme: "ChartTheme") -> list["Mark"]:
    """A part's squares on the 100-by-100 grid as a few boxes: its part of a first row,
    its whole rows, its part of a last row (the paper grid is drawn over them after)."""
    marks: list[Mark] = []
    at = start
    while at < end - 1e-9:
        row = int(at // 100)
        row_end = min(end, (row + 1) * 100)
        whole_rows = int((end - at) // 100) if at % 100 < 1e-9 else 0
        if whole_rows:
            marks.append(nc.fill_rect(part.paint, x0, y0 + row * pitch, 100 * pitch, whole_rows * pitch, 0.0, "",
                                      theme))
            at += whole_rows * 100
            continue
        column = at - row * 100
        marks.append(nc.fill_rect(part.paint, x0 + column * pitch, y0 + row * pitch,
                                  max((row_end - at) * pitch, 0.6), pitch, 0.0, "", theme))
        at = row_end
    return [nc.Group(tuple(marks), part.name)] if marks else []


# -- key figures -----------------------------------------------------------------------------------------


_FLOOR_START = re.compile(r"^\s*(?:at least|no fewer than|minimum|≥|>=)\s*", re.I)
_FLOOR_END = re.compile(r"\s*(?:\+|or more)\s*$", re.I)


def plot_figures(reading: "Reading", theme: "ChartTheme", box: "Box") -> "Plot":
    """Two to four tiles across: a rule, *at least* over a figure that is a floor, the
    figure, the words under it. A figure too wide for its tile is set smaller."""
    table = reading.table
    if table is None or not table.headers:
        return nc.Plot([], 0.0)
    rows = table.rows
    figure_column = 0
    words_column = 1 if len(table.headers) > 1 else None
    header_floor = bool(nc.FLOOR_WORDS.search(table.headers[figure_column]))
    tiles: list[tuple[str, str, bool]] = []
    for index in reading.rows[:MAX_TILES]:
        figure = rows[index][figure_column]
        words = rows[index][words_column] if words_column is not None else ""
        floor = header_floor
        if _FLOOR_START.search(figure) or _FLOOR_END.search(figure):
            floor = True
            figure = _FLOOR_END.sub("", _FLOOR_START.sub("", figure)).strip()
        if figure or words:
            tiles.append((figure, words, floor))
    if not tiles:
        return nc.Plot([], 0.0, desc="Key figures, none written.")
    across = min(len(tiles), TILES_ACROSS)
    while across > 1 and (box.width - 20 * (across - 1)) / across < 130:
        across -= 1
    if across == 3 and len(tiles) == 4 and box.width >= 4 * 130 + 60:
        across = 4
    gap = 20.0
    tile_width = (box.width - gap * (across - 1)) / across
    big = 34.0 if tile_width >= 200 else 28.0
    widest = max(nc.text_width(figure, 1.0, theme.head, bold=True) for figure, _, _ in tiles)
    big = max(18.0, min(big, (tile_width - 2) / max(widest, 0.01)))
    words_size = theme.caption_size + 0.5
    kicker = theme.tick_size
    any_floor = any(floor for _, _, floor in tiles)
    marks: list[Mark] = []
    y = box.y
    lines: list[str] = []
    for start in range(0, len(tiles), across):
        row = tiles[start:start + across]
        heights = []
        for column, (figure, words, floor) in enumerate(row):
            x = box.x + column * (tile_width + gap)
            group: list[Mark] = [nc.Rect(x, y, tile_width, 3.0 if not theme.radius == 0 else 2.0, theme.ink)]
            top = y + 14
            if any_floor:
                if floor:
                    group.append(nc.Text(x, top + kicker, "AT LEAST", kicker, theme.muted, bold=True))
                top += kicker + 6
            figure_lines = lines_of(figure, tile_width, big, theme.head, bold=True)
            for line in figure_lines:
                top += big * 1.02
                group.append(nc.Text(x, top, line, big, theme.ink, bold=True))
                top += big * 0.12
            top += 6
            for line in lines_of(words, tile_width, words_size, theme.body):
                top += words_size * 1.3
                group.append(nc.Text(x, top, line, words_size, theme.ink2, body=True))
            said = f"At least {figure}" if floor else figure
            marks.append(nc.Group(tuple(group), f"{said}: {words}" if words else said))
            lines.append(f"{said}: {words}" if words else said)
            heights.append(top - y + 4)
        y += max(heights) + 22
    height = y - 22 - box.y
    marks, height = centred(marks, height, box)
    head = [table.headers[figure_column], table.headers[words_column] if words_column is not None else ""]
    table_rows = [[f"at least {figure}" if floor else figure, words] for figure, words, floor in tiles]
    notes = [f"{len(reading.rows) - MAX_TILES} more figures are not shown: a block holds {MAX_TILES}."] \
        if len(reading.rows) > MAX_TILES else []
    return nc.Plot(marks, height, lines=lines, notes=notes, desc=f"Key figures: {len(tiles)}.",
                   table=([cell for cell in head if cell] or ["Figure"], table_rows),
                   facts={"tiles": tiles, "across": across, "size": big})


# -- timeline ----------------------------------------------------------------------------------------------


@dataclass
class Event:
    start: Day
    end: Day | None
    what: str
    row: int
    paint: "Paint"

    @property
    def period(self) -> bool:
        return self.end is not None and self.end.day > self.start.day


def _timeline_columns(reading: "Reading") -> tuple[int | None, int | None, int | None]:
    table = reading.table
    if table is None:
        return None, None, None
    rows = table.rows
    days = [index for index in range(len(table.headers)) if day_column(rows, index)]
    start = days[0] if days else None
    until = next((index for index in days[1:] if re.search(r"until|end|to\b|till", table.headers[index], re.I)),
                 days[1] if len(days) > 1 else None)
    what = None
    if reading.block.by:
        found = table.column(reading.block.by)
        if found is not None and found not in days:
            what = found
    if what is None:
        what = next((index for index in range(len(table.headers)) if index not in days
                     and not nc._numeric(rows, index) and not nc.ROW_NUMBER.match(table.headers[index])
                     and index != reading.colour), None)
    return start, until, what


def _events(reading: "Reading", theme: "ChartTheme") -> tuple[list[Event], int, bool]:
    """Every row read as a point or a period, by its day; with the rows whose day could not
    be read, and whether any day said its year."""
    table = reading.table
    start, until, what = _timeline_columns(reading)
    if table is None or start is None:
        return [], 0, False
    rows = table.rows
    year = column_year(rows, [column for column in (start, until) if column is not None])
    events: list[Event] = []
    unread = 0
    had_year = False
    band = nc._mix(theme.others, theme.paper, 0.18 if theme.dark else 0.5)
    for index in reading.rows:
        first = read_day(rows[index][start], year)
        if first is None:
            unread += 1
            continue
        had_year = had_year or first.year
        end = read_day(rows[index][until], first.day.year) if until is not None and rows[index][until] else None
        if end is not None and end.day < first.day:
            end = None
        words = rows[index][what] if what is not None else ""
        if reading.colour is not None and reading.colour != start:
            paint = reading.paint(rows[index][reading.colour])
        else:
            paint = nc.Paint(band if end is not None and end.day > first.day else theme.ink)
        events.append(Event(first, end, words, index, paint))
    events.sort(key=lambda event: (event.start.day, event.row))
    return events, unread, had_year


def plot_timeline(reading: "Reading", theme: "ChartTheme", box: "Box") -> "Plot":
    """Points and periods on one line of days, every label set above the line in the
    lowest lane where it meets no other label and no other stem; listed down the page
    when there are many or the box is narrow."""
    events, unread, years = _events(reading, theme)
    notes = [f"{unread} row{'s' if unread > 1 else ''} with no day it can read {'are' if unread > 1 else 'is'} "
             f"not drawn."] if unread else []
    start, until, what = _timeline_columns(reading)
    head = [reading.table.headers[column] for column in (start, what, until)
            if column is not None and reading.table is not None]
    table_rows = [[day_text(event.start, year=years), event.what] + ([day_text(event.end, year=years)
                  if event.end else ""] if until is not None else []) for event in events]
    if not events:
        return nc.Plot([], 0.0, notes=notes, desc="A timeline with no day to draw.", table=(head, table_rows))
    lines = [_event_said(event, years) for event in events]
    if box.width < 420 or len(events) > MAX_ACROSS_EVENTS:
        plot = _timeline_down(events, theme, box, years)
    else:
        plot = _timeline_across(events, theme, box, years)
    plot.notes = [*notes, *plot.notes]
    plot.lines = lines
    plot.desc = f"Timeline: {len(events)} rows, from {day_text(events[0].start, year=years)} to " \
                f"{day_text(max((event.end or event.start for event in events), key=lambda day: day.day), year=years)}."
    plot.table = (head, table_rows)
    return plot


def _event_said(event: Event, years: bool) -> str:
    when = day_text(event.start, year=years)
    if event.period and event.end is not None:
        when = f"{when} to {day_text(event.end, year=years)}"
    return f"{when}: {event.what}" if event.what else when


@dataclass
class _Label:
    x: float
    lines: list[str]
    when: str
    width: float
    height: float
    anchor: str = "start"
    lane: int = 0

    @property
    def text(self) -> tuple[float, float]:
        """Where its words lie across: right of its stem, or left of it near the right edge."""
        if self.anchor == "start":
            return self.x + 5, self.x + 5 + self.width
        return self.x - 5 - self.width, self.x - 5

    @property
    def extent(self) -> tuple[float, float]:
        a, b = self.text
        return min(a, self.x - 1), max(b, self.x + 1)


def lanes(labels: list[_Label], gap: float = 10.0) -> int:
    """Each label in the lowest lane where it meets no label of its lane, its words sit
    above every stem they span, and its stem passes under no label's words. Labels whose
    words run right are placed from the right, those near the right edge whose words run
    left from the left, so a label that spans a stem always has a lane above it to climb
    to (`_timeline_across` keeps the first from spanning the second's stems). Returns how
    many lanes it took."""
    placed: list[_Label] = []
    for label in sorted(labels, key=lambda one: (one.anchor == "end", one.x if one.anchor == "end" else -one.x)):
        a, b = label.extent
        words_a, words_b = label.text
        chosen: int | None = None
        fallback: int | None = None
        for lane in range(len(labels) + 1):
            if any(other.lane == lane and a - gap < other.extent[1] and other.extent[0] < b + gap
                   for other in placed):
                continue
            if any(other.lane >= lane and words_a - 1 <= other.x <= words_b + 1 for other in placed):
                continue
            if fallback is None:
                fallback = lane
            if any(other.lane <= lane and other.text[0] - 1 <= label.x <= other.text[1] + 1 for other in placed):
                continue
            chosen = lane
            break
        label.lane = chosen if chosen is not None else (fallback if fallback is not None else len(labels))
        placed.append(label)
    return max((label.lane for label in labels), default=-1) + 1


def _timeline_across(events: list[Event], theme: "ChartTheme", box: "Box", years: bool) -> "Plot":
    """Points on the line of days, their labels in lanes above it; periods in tracks under
    the scale, each band's words inside it, else beside it."""
    first = min(event.start.day for event in events)
    last = max((event.end or event.start).day for event in events)
    left, right = box.x + 4, box.x + box.width - 4
    d0, d1, ticks = time_domain(first, last, right - left, years=years)
    total = max(1, (d1 - d0).days + 1)

    def at(day: date, middle: bool = True) -> float:
        return left + ((day - d0).days + (0.5 if middle else 0.0)) / total * (right - left)

    size = theme.label_size
    date_size = theme.label_size - 1
    band_height = 22.0
    points = [event for event in events if not event.period]
    periods = [event for event in events if event.period]
    # the points' labels: as wide as the room before the next day's stem allows
    xs = [at(event.start.day) for event in points]
    # words run right of their stem, or left of it near the right edge; a label running
    # right stops short of the next stem whose label runs left, so `lanes` can always stack
    anchors = ["end" if right - x < 150 and x - left > right - x else "start" for x in xs]
    labels: list[_Label] = []
    for index, (event, x) in enumerate(zip(points, xs)):
        when = day_text(event.start, year=False)
        if anchors[index] == "start":
            cap = min(210.0, right - x - 5)
            ends = [other for other, anchor in zip(xs[index + 1:], anchors[index + 1:]) if anchor == "end"]
            if ends:
                cap = min(cap, ends[0] - x - 14)
        else:
            cap = min(210.0, x - left - 5)
        anchor = anchors[index]
        cap = max(cap, 60.0)
        found = lines_of(event.what, cap, size, theme.head) if event.what else []
        width = max([nc.text_width(when, date_size, theme.head, bold=True),
                     *(nc.text_width(line, size, theme.head) for line in found)])
        labels.append(_Label(x, found, when, width, date_size * 1.3 + len(found) * size * 1.25, anchor))
    count = lanes(labels)
    lane_height = max((label.height for label in labels), default=0.0) + 12
    axis = box.y + count * lane_height + 8
    marks: list[Mark] = [nc.Line(((left, axis), (right, axis)), theme.axis, 1.0)]
    for day, text in ticks:
        x = at(day, False)
        marks.append(nc.Line(((x, axis), (x, axis + 5)), theme.axis, 1.0))
        marks.append(nc.Text(x, axis + 9 + theme.tick_size, text, theme.tick_size, theme.muted, anchor="middle"))
    y = axis + 9 + theme.tick_size + 12
    # the periods: a band, its words inside when they fit, else right of it, else left
    items: list[tuple[Event, float, float, list[str], str, float, float]] = []
    for event in periods:
        assert event.end is not None
        x0, x1 = at(event.start.day, False), at(event.end.day + timedelta(days=1), False)
        when = f"{day_text(event.start, year=False)} – {day_text(event.end, year=False)}"
        text = f"{event.what}, {when}" if event.what else when
        if nc.text_width(text, size - 0.5, theme.head) + 16 <= x1 - x0:
            items.append((event, x0, x1, [text], "inside", x0, x1))
            continue
        room_right, room_left = right - x1 - 8, x0 - left - 8
        side = "right" if room_right >= min(160.0, room_left) else "left"
        room = max(room_right if side == "right" else room_left, 80.0)
        found = [when, *lines_of(event.what, room, size, theme.head)] if event.what else [when]
        width = max(nc.text_width(line, size, theme.head, bold=number == 0) for number, line in enumerate(found))
        a, b = (x0, x1 + 8 + width) if side == "right" else (x0 - 8 - width, x1)
        items.append((event, x0, x1, found, side, a, b))
    tracks: list[list[tuple[float, float]]] = []
    placed: list[tuple[int, tuple[Event, float, float, list[str], str, float, float]]] = []
    for item in sorted(items, key=lambda one: one[1]):
        a, b = item[5], item[6]
        track = next((index for index, spans in enumerate(tracks)
                      if all(b + 10 <= c or d + 10 <= a for c, d in spans)), len(tracks))
        if track == len(tracks):
            tracks.append([])
        tracks[track].append((a, b))
        placed.append((track, item))
    heights = [band_height] * len(tracks)
    for track, (_, _, _, found, side, _, _) in placed:
        if side != "inside":
            heights[track] = max(heights[track], band_height + (len(found) - 1) * size * 1.25)
    tops = []
    for height in heights:
        tops.append(y)
        y += height + 8
    for track, (event, x0, x1, found, side, _, _) in placed:
        top = tops[track]
        pieces: list[Mark] = [nc.fill_rect(event.paint, x0, top, max(x1 - x0, 2.0), band_height,
                                           4.0 if theme.radius else 0.0, "all", theme)]
        middle = top + band_height / 2 + (size - 0.5) * 0.36
        if side == "inside":
            pieces.append(nc.Text((x0 + x1) / 2, middle, found[0], size - 0.5, nc.ink_on(event.paint, theme),
                                  anchor="middle"))
        else:
            tx, anchor = (x1 + 8, "start") if side == "right" else (x0 - 8, "end")
            for number, line in enumerate(found):
                pieces.append(nc.Text(tx, middle + number * size * 1.25, line, size if number else size - 0.5,
                                      theme.ink if not number else theme.ink2, bold=not number, anchor=anchor))
        marks.append(nc.Group(tuple(pieces), _event_said(event, years)))
    for label, event in zip(labels, points):
        label_bottom = axis - 10 - label.lane * lane_height
        label_top = label_bottom - label.height
        group: list[Mark] = [nc.Line(((label.x, axis), (label.x, label_top + 2)), theme.ink2, 1.0)]
        tx = label.x + 5 if label.anchor == "start" else label.x - 5
        line_y = label_top + date_size
        group.append(nc.Text(tx, line_y, label.when, date_size, theme.ink, bold=True, anchor=label.anchor))
        for line in label.lines:
            line_y += size * 1.25
            group.append(nc.Text(tx, line_y, line, size, theme.ink2, anchor=label.anchor))
        group.append(nc.Circle(label.x, axis, 5.0, event.paint.colour, stroke=theme.paper, stroke_width=2.0))
        marks.append(nc.Group(tuple(group), _event_said(event, years)))
    height = (y - 8 if tracks else axis + 9 + theme.tick_size + 4) - box.y
    marks, height = centred(marks, height, box)
    return nc.Plot(marks, height, facts={"lanes": count, "labels": [(label.lane, label.extent) for label in labels],
                                         "tracks": len(tracks),
                                         "inside": [item[0].what for _, item in placed if item[4] == "inside"]})


def time_domain(first: date, last: date, width: float, *, years: bool) -> tuple[date, date, list[tuple[date, str]]]:
    """The days a time axis runs over and its ticks: the data padded a little, then
    widened to a tick on either side when one lies close."""
    span = max(1, (last - first).days)
    pad = max(1, round(span * 0.04))
    d0, d1 = first - timedelta(days=pad), last + timedelta(days=pad)
    ticks = time_ticks(d0, d1, width, years=years)
    if len(ticks) >= 2:
        step = (ticks[1][0] - ticks[0][0]).days
        before = [tick for tick in time_ticks(d0 - timedelta(days=step), d1, width, years=years)
                  if tick[0] < ticks[0][0]]
        if before and (ticks[0][0] - before[-1][0]).days and (d0 - before[-1][0]).days <= span * 0.12:
            d0 = before[-1][0]
            ticks = time_ticks(d0, d1, width, years=years)
    return d0, d1, ticks


def _timeline_down(events: list[Event], theme: "ChartTheme", box: "Box", years: bool) -> "Plot":
    size = theme.label_size
    whens = [day_text(event.start, year=years) + (f" – {day_text(event.end, year=years)}"
                                                    if event.period and event.end is not None else "")
             for event in events]
    date_width = min(max(nc.text_width(when, size, theme.head, bold=True) for when in whens), box.width * 0.34)
    rule_x = box.x + date_width + 16
    text_x = rule_x + 16
    room = box.x + box.width - text_x
    marks: list[Mark] = []
    y = box.y
    rows: list[tuple[float, float]] = []
    for event, when in zip(events, whens):
        date_lines = lines_of(when, date_width, size, theme.head, bold=True)
        found = lines_of(event.what, room, size, theme.body) if event.what else [""]
        height = max(len(date_lines), len(found)) * size * 1.3
        group: list[Mark] = []
        for number, line in enumerate(date_lines):
            group.append(nc.Text(rule_x - 16, y + size + number * size * 1.3, line, size, theme.ink, bold=True,
                                 anchor="end"))
        for number, line in enumerate(found):
            group.append(nc.Text(text_x, y + size + number * size * 1.3, line, size, theme.ink2, body=True))
        if event.period:
            group.append(nc.fill_rect(event.paint, rule_x - 3.5, y + 2, 7.0, max(height - 2, 8.0),
                                      3.5 if theme.radius else 0.0, "all", theme))
        else:
            group.append(nc.Circle(rule_x, y + size * 0.62, 5.0, event.paint.colour, stroke=theme.paper,
                                   stroke_width=2.0))
        rows.append((y, height))
        marks.append(nc.Group(tuple(group), _event_said(event, years)))
        y += height + 12
    end = y - 12
    marks.insert(0, nc.Line(((rule_x, box.y + size * 0.62), (rule_x, rows[-1][0] + size * 0.62)), theme.axis, 1.0))
    height = end - box.y
    marks, height = centred(marks, height, box)
    return nc.Plot(marks, height, facts={"down": True, "rows": rows})


# -- line --------------------------------------------------------------------------------------------------


def _line_columns(reading: "Reading") -> tuple[int | None, int | None, bool]:
    """The x column (days or numbers), the y column, and whether x holds days."""
    table = reading.table
    if table is None:
        return None, None, False
    rows = table.rows
    numeric = [index for index in range(len(table.headers))
               if nc._numeric(rows, index, most=True) and not nc.ROW_NUMBER.match(table.headers[index])]
    x: int | None = None
    if reading.block.by:
        x = table.column(reading.block.by)
    if x is None:
        x = next((index for index in range(len(table.headers)) if day_column(rows, index)), None)
    if x is None:
        x = next((index for index in numeric if _years_or_steps(rows, index)), None)
    days = x is not None and day_column(rows, x)
    y: int | None = None
    if reading.block.count and reading.block.count != nc.ROWS:
        y = table.column(reading.block.count)
    if y is None:
        y = next((index for index in reversed(numeric) if index != x), None)
    return x, y, days


def _years_or_steps(rows: list[list[str]], column: int) -> bool:
    values = [nc.read_number(row[column]) for row in rows if column < len(row) and row[column]]
    numbers = [value.value for value in values if isinstance(value, nc.Number)]
    return len(set(numbers)) >= 2


def plot_line(reading: "Reading", theme: "ChartTheme", box: "Box") -> "Plot":
    """One 2 px line per colour value over days or numbers, an axis from zero, a dot ringed
    with paper at each end (at every point when there are few), the ends named beside the
    last point (a legend above past `MAX_DIRECT_LABELS`)."""
    table = reading.table
    x_column, y_column, days = _line_columns(reading)
    if table is None or x_column is None or y_column is None:
        return nc.Plot([], 0.0, desc="A line with no column of numbers to draw.")
    rows = table.rows
    if days and all(found.precision == "year" for found in (read_day(row[x_column]) for row in rows)
                    if found is not None):
        days = False  # years along: numbers, so the ticks are years and nothing finer
    year = column_year(rows, [x_column]) if days else None
    floor = bool(nc.FLOOR_WORDS.search(table.headers[y_column]))
    series: dict[str, dict[float, float]] = {}
    order: list[str] = []
    unread = 0
    for index in reading.rows:
        if days:
            found = read_day(rows[index][x_column], year)
            x_value = float(found.day.toordinal()) if found else None
        else:
            number = nc.read_number(rows[index][x_column])
            x_value = number.value if isinstance(number, nc.Number) else None
        y_number = nc.read_number(table.cells[index][y_column])
        if x_value is None or not isinstance(y_number, nc.Number):
            unread += 1
            continue
        floor = floor or y_number.floor
        name = rows[index][reading.colour] if reading.colour is not None and reading.colour != x_column else ""
        if name not in series:
            series[name] = {}
            order.append(name)
        series[name][x_value] = series[name].get(x_value, 0.0) + y_number.value
    if not series:
        return nc.Plot([], 0.0, desc="A line with no point to draw.",
                       notes=[f"{unread} rows with no number are not drawn."] if unread else [])
    if reading.colour is not None and reading.values:
        order = [value for value in reading.values if value in series] + [name for name in order
                                                                          if name not in reading.values]
    shown = written(reading, y_column)
    xs = sorted({x for points in series.values() for x in points})
    largest = max(max(points.values()) for points in series.values())
    whole = all(abs(value - round(value)) < 1e-9 for points in series.values() for value in points.values())
    scale = nc.nice_scale(largest, most=5, whole=whole)
    direct = len(order) <= MAX_DIRECT_LABELS
    size = theme.label_size - 0.5
    paints = {name: reading.paint(name) if name else nc.Paint(theme.series) for name in order}
    marks: list[Mark] = []
    legend: list[Swatch] = [nc.Swatch(name, paints[name], max(series[name].values())) for name in order if name]
    top = box.y
    if not direct and legend:
        legend_marks, used = names_legend(legend, theme, box.x, top, box.width, numbers=False)
        marks.extend(legend_marks)
        top += used + 12
    y_name = table.headers[y_column] if not floor or nc.FLOOR_WORDS.search(table.headers[y_column]) else \
        f"{table.headers[y_column]}, at least"
    marks.append(nc.Text(box.x, top + theme.tick_size, y_name, theme.tick_size, theme.muted))
    tick_width = max(nc.text_width(nc.tick_text(tick, scale.top), theme.tick_size, theme.head) for tick in scale.ticks)
    x0 = box.x + tick_width + 8
    label_texts = {name: (f"{name}  " if name else "") + shown.text(series[name][max(series[name])])
                   for name in order}
    gutter = 0.0
    if direct:
        gutter = min(max(nc.text_width(text, size, theme.head, bold=True) for text in label_texts.values()) + 18,
                     box.width * 0.36)
    x1 = box.x + box.width - max(gutter, 10.0)
    plot_top = top + theme.tick_size + 12
    plot_height = (box.height - (plot_top - box.y) - 34) if box.height is not None else 220.0
    plot_height = max(80.0, plot_height)
    base = plot_top + plot_height
    lo, hi = xs[0], xs[-1]
    if hi == lo:
        lo, hi = lo - 1, hi + 1

    def px(value: float) -> float:
        return x0 + 6 + (value - lo) / (hi - lo) * (x1 - x0 - 12)

    def py(value: float) -> float:
        return base - scale.at(value, plot_height)

    for tick in scale.ticks:
        y = py(tick)
        marks.append(nc.Line(((x0 - 4, round(y, 2)), (x1, round(y, 2))), theme.axis if tick == 0 else theme.grid, 1.0))
        marks.append(nc.Text(x0 - 8, y + theme.tick_size * 0.36, nc.tick_text(tick, scale.top), theme.tick_size,
                             theme.muted, anchor="end"))
    if days:
        start, end = date.fromordinal(int(lo)), date.fromordinal(int(hi))
        for day, text in time_ticks(start, end, x1 - x0, years=year is not None):
            x = px(float(day.toordinal()))
            marks.append(nc.Line(((x, base), (x, base + 4)), theme.axis, 1.0))
            marks.append(nc.Text(x, base + 6 + theme.tick_size, text, theme.tick_size, theme.muted, anchor="middle"))
    else:
        integral = all(abs(value - round(value)) < 1e-9 for value in xs)
        yearly = integral and all(1000 <= value <= 2999 for value in xs)
        for value in _range_ticks(lo, hi, (x1 - x0) / 60, whole=integral):
            x = px(value)
            text = str(int(round(value))) if yearly else nc.number_text(value)
            marks.append(nc.Line(((x, base), (x, base + 4)), theme.axis, 1.0))
            marks.append(nc.Text(x, base + 6 + theme.tick_size, text, theme.tick_size, theme.muted, anchor="middle"))
    few = max(len(points) for points in series.values()) <= 12
    ends: list[tuple[str, float, float]] = []
    lines_out: list[str] = []
    for name in order:
        points = sorted(series[name].items())
        paint = paints[name]
        coordinates = tuple((round(px(x), 2), round(py(y), 2)) for x, y in points)
        group: list[Mark] = []
        if len(coordinates) > 1:
            group.append(nc.Line(coordinates, paint.colour, 2.0))
        if few:
            for cx, cy in coordinates[:-1]:
                group.append(nc.Circle(cx, cy, 3.2, paint.colour, stroke=theme.paper, stroke_width=2.0))
        cx, cy = coordinates[-1]
        group.append(nc.Circle(cx, cy, 4.5, paint.colour, stroke=theme.paper, stroke_width=2.0))
        last_x, last_y = points[-1]
        said = f"{name}: " if name else ""
        marks.append(nc.Group(tuple(group), f"{said}{shown.text(last_y)} at the end"))
        ends.append((name, cx, cy))
        span = ", ".join(f"{_x_text(x, days, year)} {shown.text(y)}" for x, y in points)
        lines_out.append(f"{name}: {span}" if name else span)
    if direct:
        heights = [size * 1.3 for _ in ends]
        order_by_y = sorted(range(len(ends)), key=lambda index: ends[index][2])
        wanted = [ends[index][2] - size * 0.65 for index in order_by_y]
        placed = _stack(wanted, [heights[index] for index in order_by_y], plot_top - 6, base + 6)
        for index, top_y in zip(order_by_y, placed):
            name, cx, cy = ends[index]
            label_x = x1 + 10
            middle = top_y + size * 0.65
            if abs(middle - cy) > 2 or cx < x1 - 2:
                marks.append(nc.Line(((cx + 6, cy), (label_x - 3, middle)), theme.muted, 1.0))
            last = shown.text(series[name][max(series[name])])
            baseline = top_y + size * 1.0
            if name:
                marks.append(nc.Text(label_x, baseline, name, size, theme.ink2))
                marks.append(nc.Text(label_x + nc.text_width(name + "  ", size, theme.head), baseline, last, size,
                                     theme.ink, bold=True))
            else:
                marks.append(nc.Text(label_x, baseline, last, size, theme.ink, bold=True))
    height = base + 8 + theme.tick_size + 4 - box.y
    notes = [f"{unread} row{'s' if unread > 1 else ''} with no number {'are' if unread > 1 else 'is'} not drawn."] \
        if unread else []
    head = [table.headers[x_column], *(name or table.headers[y_column] for name in order)]
    table_rows = [[_x_text(x, days, year), *(shown.text(series[name][x]) if x in series[name] else "" for name in order)]
                  for x in xs]
    return nc.Plot(marks, height, scale, lines=lines_out, legend=legend, notes=notes,
                   desc=f"Line: {y_name} by {nc._lower(table.headers[x_column])}, {len(order)} "
                        f"line{'s' if len(order) > 1 else ''}, {len(xs)} points.",
                   table=(head, table_rows),
                   facts={"series": {name: sorted(points.items()) for name, points in series.items()},
                          "direct": direct, "floor": floor})


def _x_text(value: float, days: bool, year: int | None) -> str:
    if days:
        return day_text(Day(date.fromordinal(int(value)), year=year is not None), year=year is not None)
    if abs(value - round(value)) < 1e-9 and 1000 <= value <= 2999:
        return str(int(round(value)))
    return nc.number_text(value)


def _range_ticks(lo: float, hi: float, most: float, *, whole: bool = False) -> list[float]:
    """Round ticks from ``lo`` to ``hi``, about ``most`` of them; whole steps for whole numbers."""
    span = hi - lo
    if span <= 0:
        return [lo]
    most = max(2.0, most)
    raw = span / most
    power = 10 ** math.floor(math.log10(raw))
    step = next(multiple * power for multiple in (1, 2, 2.5, 5, 10) if multiple * power >= raw)
    if whole:
        step = max(1.0, round(step)) if step >= 1 else 1.0
    first = math.ceil(lo / step - 1e-9) * step
    out: list[float] = []
    value = first
    while value <= hi + 1e-9:
        out.append(round(value, 10))
        value += step
    return out


# -- circles ------------------------------------------------------------------------------------------------


def plot_circles(reading: "Reading", theme: "ChartTheme", box: "Box") -> "Plot":
    """Two or three amounts as circles whose areas are to scale, side by side on one middle
    line; a figure that fits is set inside its circle, else beside it on a leader, and a
    circle too small to see is ringed so the eye finds it."""
    shown = written(reading)
    parts = sorted([part for part in parts_of(reading, theme) if part.amount > 0], key=lambda part: -part.amount)
    left_out = parts[MAX_CIRCLES:]
    parts = parts[:MAX_CIRCLES]
    if not parts:
        return nc.Plot([], 0.0, desc="A chart with nothing to draw.")
    largest = parts[0].amount
    ratios = [math.sqrt(part.amount / largest) for part in parts]
    size = theme.label_size
    label_width = min(170.0, box.width * 0.3)
    # the largest radius the box allows: circles, their gaps, and room for labels set beside
    natural = 110.0
    radius = natural
    if box.height is not None:
        radius = min(radius, max(30.0, (box.height - 20) / 2))
    for _ in range(3):
        outside = [ratio * radius < 38 for ratio in ratios]
        need = sum(2 * ratio * radius for ratio in ratios) + sum(label_width + 22 for out in outside if out) + \
            28 * (len(parts) - 1)
        if need <= box.width:
            break
        fixed = sum(label_width + 22 for out in outside if out) + 28 * (len(parts) - 1)
        radius = max(24.0, (box.width - fixed) / max(sum(2 * ratio for ratio in ratios), 0.01))
    marks: list[Mark] = []
    cy = box.y + radius + 4
    x = box.x
    radii: list[float] = []
    lines: list[str] = []
    label_bottoms: list[float] = []
    for part, ratio in zip(parts, ratios):
        r = ratio * radius
        radii.append(r)
        drawn = max(r, 0.6)
        cx = x + max(r, 3.0)
        value = shown.text(part.amount)
        group: list[Mark] = []
        if part.paint.outline:
            group.append(nc.Circle(cx, cy, drawn, theme.paper, stroke=part.paint.colour, stroke_width=1.5))
        else:
            group.append(nc.Circle(cx, cy, drawn, part.paint.colour))
        big = max(14.0, min(30.0, r * 0.36))
        names = lines_of(part.name, r * 1.45, size - 0.5, theme.head)
        fits_inside = (r >= 38 and nc.text_width(value, big, theme.head, bold=True) <= r * 1.6
                       and len(names) <= 3)
        if fits_inside:
            ink = nc.ink_on(part.paint, theme)
            total_height = big + len(names) * (size - 0.5) * 1.25 + 4
            y = cy - total_height / 2 + big * 0.85
            group.append(nc.Text(cx, y, value, big, ink, bold=True, anchor="middle"))
            y += 6
            for line in names:
                y += (size - 0.5) * 1.25
                group.append(nc.Text(cx, y, line, size - 0.5, ink, anchor="middle"))
            x = cx + max(r, 3.0) + 28
            label_bottoms.append(cy + r)
        else:
            if r < 6:
                group.append(nc.Circle(cx, cy, r + 6, "none", stroke=part.paint.colour if not part.paint.hatch
                                       else theme.ink2, stroke_width=1.0))
            reach = max(r, 3.0) + (6 if r < 6 else 0)
            lx = cx + reach + 16
            group.append(nc.Line(((cx + reach, cy), (lx - 4, cy)), theme.ink2, 1.0))
            label_lines = lines_of(part.name, label_width, size, theme.head)
            share = lines_of(f"{_ratio_text(part.amount, largest)} of {parts[0].name}", label_width,
                             theme.note_size, theme.head) if part is not parts[0] else []
            block = size * 1.25 * len(label_lines) + theme.note_size * 1.3 * len(share) + theme.value_size + 4
            ty = cy - block / 2 + theme.value_size
            group.append(nc.Text(lx, ty, value, theme.value_size + 2, theme.ink, bold=True))
            for line in label_lines:
                ty += size * 1.25
                group.append(nc.Text(lx, ty, line, size, theme.ink2))
            for line in share:
                ty += theme.note_size * 1.3
                group.append(nc.Text(lx, ty, line, theme.note_size, theme.muted))
            width = max([nc.text_width(value, theme.value_size + 2, theme.head, bold=True),
                         *(nc.text_width(line, size, theme.head) for line in label_lines),
                         *(nc.text_width(line, theme.note_size, theme.head) for line in share)])
            x = lx + width + 28
            label_bottoms.append(max(cy + r, ty + 4))
        said = f"{part.name}: {value}"
        if part is not parts[0]:
            said += f", {_ratio_text(part.amount, largest)} of {parts[0].name}"
        marks.append(nc.Group(tuple(group), said))
        lines.append(said)
    height = max(label_bottoms + [cy + radius]) - box.y + 4
    marks, height = centred(marks, height, box)
    notes = ["Areas to scale."]
    if left_out:
        notes.append(f"{len(left_out)} more row{'s' if len(left_out) > 1 else ''} not drawn: "
                     f"a comparison shows {MAX_CIRCLES} circles.")
    return nc.Plot(marks, height, lines=lines, notes=notes,
                   legend=[nc.Swatch(part.name, part.paint, part.amount) for part in parts],
                   facts={"radii": radii, "areas": [math.pi * r * r for r in radii]})


def _ratio_text(amount: float, whole: float) -> str:
    """A share as a reader says it: ``42%``, ``0.03%``, ``under 0.01%``."""
    share = amount / whole * 100
    if share >= 1:
        return f"{share:.0f}%"
    if share >= 0.01:
        return f"{share:.2f}".rstrip("0").rstrip(".") + "%"
    return "under 0.01%"


# -- the picker's rules -------------------------------------------------------------------------------------


def _shape(table: "Table") -> tuple[list[list[str]], list[int], list[int]]:
    """A table's rows (totals left out), its text columns and its number columns."""
    rows = [row for row in table.rows if row and not nc.TOTAL_ROW.match(row[0])]
    numbers = [index for index in range(len(table.headers))
               if nc._numeric(rows, index) and not nc.ROW_NUMBER.match(table.headers[index])]
    texts = [index for index in range(len(table.headers)) if index not in numbers
             and any(index < len(row) and row[index] for row in rows)
             and not nc.ROW_NUMBER.match(table.headers[index])]
    return rows, texts, numbers


def _distinct(rows: list[list[str]], column: int) -> int:
    return len({row[column].casefold() for row in rows if column < len(row) and row[column]})


def _parts_fit(table: "Table", low: int, high: int, *, whole: bool = False) -> bool:
    """A column of a few values, as rows counted (the values repeat) or with one number
    column beside it; ``whole`` asks for whole counts (one glyph per unit)."""
    rows, texts, numbers = _shape(table)
    if not rows:
        return False
    for column in texts:
        distinct = _distinct(rows, column)
        if not low <= distinct <= high:
            continue
        if distinct < len(rows):
            return True
        if len(numbers) == 1:
            values = [nc.read_number(row[numbers[0]]) for row in rows]
            amounts = [value.value for value in values if isinstance(value, nc.Number)]
            if not amounts or sum(amounts) <= 0:
                continue
            if whole and any(abs(amount - round(amount)) > 1e-9 for amount in amounts):
                continue
            return True
    return False


def fits_pie(table: "Table") -> bool:
    """Three to twelve parts: two is a figure, not a pie; past six the smallest fold."""
    return _parts_fit(table, 3, 12)


def fits_segments(table: "Table") -> bool:
    return _parts_fit(table, 2, 8)


def fits_pictograms(table: "Table") -> bool:
    return _parts_fit(table, 1, 8, whole=True)


def fits_waffle(table: "Table") -> bool:
    return _parts_fit(table, 1, 6)


def fits_silhouettes(table: "Table") -> bool:
    return _parts_fit(table, 2, 30, whole=True)


def fits_figures(table: "Table") -> bool:
    """One to eight rows of a short figure with a digit in it, then words."""
    rows = [row for row in table.rows if row and any(row)]
    if len(table.headers) < 2 or not 1 <= len(rows) <= MAX_TILES:
        return False
    figures_ok = all(row[0] and len(row[0]) <= 32 and re.search(r"\d", row[0]) for row in rows) and \
        not day_column(rows, 0)
    words = [row[1] for row in rows if len(row) > 1 and row[1]]
    worded = len(words) * 2 >= len(rows) and all(not isinstance(nc.read_number(word), nc.Number) for word in words)
    return bool(figures_ok and worded)


def fits_timeline(table: "Table") -> bool:
    rows = table.rows
    days = [index for index in range(len(table.headers)) if day_column(rows, index)]
    if not days:
        return False
    return any(index not in days and not nc._numeric(rows, index) and any(row[index] for row in rows)
               for index in range(len(table.headers)))


def fits_line(table: "Table") -> bool:
    rows, _, numbers = _shape(table)
    if len(rows) < 2 or not numbers:
        return False
    for index in range(len(table.headers)):
        if day_column(rows, index) and any(number != index for number in numbers):
            return True
    return len(numbers) >= 2 and _years_or_steps(rows, numbers[0])


def fits_circles(table: "Table") -> bool:
    rows, texts, numbers = _shape(table)
    if len(numbers) != 1 or not texts or not 2 <= len(rows) <= MAX_CIRCLES:
        return False
    values = [nc.read_number(row[numbers[0]]) for row in rows]
    return all(isinstance(value, nc.Number) and value.value > 0 for value in values)


# -- the kinds' own checks --------------------------------------------------------------------------------


def check_parts(reading: "Reading") -> list["Check"]:
    """A pie of more parts than it draws says which it folds; a donut's middle names a part."""
    out: list[Check] = []
    parts = [value for value in reading.values if reading.totals.get(value, 0) > 0 and value != nc.OTHER]
    count = len(parts) + hidden_values(reading)
    if reading.kind.name in ("pie", "donut") and count > MAX_SLICES:
        # the colour column's own folding past eight is this one, said once
        folding = f'the rest are drawn as "{nc.OTHER}".'
        reading.checks[:] = [check for check in reading.checks if not check.message.endswith(folding)]
        out.append(_check(reading, f"has {count} parts: past {MAX_SLICES - 1}, the smallest are drawn as "
                                   f'one, "{OTHERS}".', "kind"))
    wanted = (reading.block.extra.get("centre") or reading.block.extra.get("center") or "").strip()
    if wanted and wanted.casefold() not in ("total", "all", "the total", "none", "nothing", "empty") and \
            wanted.casefold() not in {value.casefold() for value in reading.values}:
        out.append(_check(reading, f'puts "{nc._cut(wanted, 40)}" in its middle, which no part holds: '
                                   f"it shows the total.", "centre" if "centre" in reading.block.extra else "center"))
    return out


def check_glyphs(reading: "Reading") -> list["Check"]:
    """An ``icon`` or a cell that names no glyph, or an icon gone from the library."""
    out: list[Check] = []
    for key in ("icon", "flag"):
        said = (reading.block.extra.get(key) or "").strip()
        if not said:
            continue
        column = reading.table.column(said) if reading.table is not None else None
        if column is not None:
            missing = sorted({reading.table.rows[row][column] for row in reading.rows
                              if reading.table is not None and reading.table.rows[row][column]
                              and not _drawn(glyph_key(reading.table.rows[row][column]))})
            if missing:
                out.append(_check(reading, f'cannot draw "{nc._cut(missing[0], 40)}" in "{said}": '
                                           f"name a badge of the map or an icon of your library.", key))
        elif key == "icon" and not _drawn(glyph_key(said)):
            out.append(_check(reading, f'cannot draw "{nc._cut(said, 40)}": name a badge of the map or an icon '
                                       f"of your library; it shows dots.", key))
        elif key == "flag":
            out.append(_check(reading, f'reads its flags in "{nc._cut(said, 40)}", a column its table does not '
                                       f"have.", key, "missing"))
    unit = (reading.block.extra.get("per glyph") or "").strip()
    if unit:
        number = nc.read_number(unit)
        if not isinstance(number, nc.Number) or number.value <= 0:
            out.append(_check(reading, f'cannot read "per glyph: {nc._cut(unit, 30)}": write a number.', "per glyph"))
    return out


def _drawn(key: str) -> bool:
    if not key:
        return False
    if key.startswith("own:"):
        return own_icon(key[4:]) is not None
    return True


def check_waffle(reading: "Reading") -> list["Check"]:
    out: list[Check] = []
    said = (reading.block.extra.get("of") or "").strip()
    whole_name = [said] if said else []
    parts = [Part(value, reading.totals.get(value, 0.0), reading.paint(value)) for value in reading.values
             if value.casefold() not in {name.casefold() for name in whole_name}]
    whole, _, how = _whole(reading, parts)
    if how == "unread":
        out.append(_check(reading, f'cannot read its whole, "{nc._cut(said, 40)}": name a row or write a number.',
                          "of", "missing"))
    elif sum(part.amount for part in parts) > whole + 1e-9:
        out.append(_check(reading, "has parts that come to more than its whole: the grid stops at its last square.",
                          "of"))
    squares = (reading.block.extra.get("squares") or "").strip()
    if squares:
        number = nc.read_number(squares)
        if not isinstance(number, nc.Number) or int(number.value) not in SQUARES:
            out.append(_check(reading, f'draws 100 or 10,000 squares, not "{nc._cut(squares, 20)}".', "squares"))
    return out


def check_timeline(reading: "Reading") -> list["Check"]:
    start, _, _ = _timeline_columns(reading)
    if start is None:
        return [_check(reading, "has no column of days: write them as 5 Oct 2026 or 2026-10-05.", None, "missing")]
    return []


def check_line(reading: "Reading") -> list["Check"]:
    out: list[Check] = []
    x, y, _ = _line_columns(reading)
    if x is None or y is None:
        out.append(_check(reading, "needs a column of days or numbers along, and one of numbers up.", None, "missing"))
        return out
    table = reading.table
    if table is not None:
        floor = bool(nc.FLOOR_WORDS.search(table.headers[y])) or any(
            isinstance(number := nc.read_number(table.cells[row][y]), nc.Number) and number.floor
            for row in reading.rows)
        if floor and not nc.TITLE_FLOOR.search(reading.block.title or ""):
            title = reading.block.title
            message = (f'"{nc._cut(title, 60)}" counts at least: say so in its title.' if title
                       else "A chart counts at least: give it a title that says so.")
            out.append(nc.Check(message, nc.OTHER_KIND, reading.block.where.get("title")))
    return out


def check_circles(reading: "Reading") -> list["Check"]:
    parts = [value for value in reading.values if reading.totals.get(value, 0) > 0]
    if len(parts) > MAX_CIRCLES:
        return [_check(reading, f"compares {len(parts)} rows: it draws the {MAX_CIRCLES} largest.", "kind")]
    return []


from . import notes_charts as nc  # noqa: E402  (the kinds use its marks; it registers them at its foot)
