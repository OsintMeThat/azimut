"""FIRMS detections as the vector tiles the map draws, and the points behind them.

Far out, and for a dated range, a tile's marks are read off FIRMS's own
picture of it (``picture_tile``): a continent's week is more points than a
laptop should hold, and the WMS draws it in one picture a tile. From
``MIN_ZOOM`` in, a rolling window comes from the area API, which hands over the
points of a whole cell of ground at once, and every tile over that cell, at
every zoom, is cut from memory (``tile``). Measured 2026-09-27:

- **The allowance.** The area API counts 2 transactions per day and satellite,
  whatever the size of the box. A week of the combined VIIRS layer over one
  cell is 48, about two WMS tiles, and every zoom under it is then free, where
  the WMS counts every tile of every zoom again.
- **The map draws them.** The app's map gets vector tiles (``tile``) and draws
  each mark itself, every frame, so a square keeps its size through a zoom. A
  picture's squares grow with its pixels until the next picture lands.
- **Each square its own.** A picture holds pixels, so an outline could only go
  round a whole cluster. Drawn from points, every footprint keeps its own edge.

The extension lays one picture over somebody else's map, so it gets the same
marks drawn into a PNG (``render``).

The windows are FIRMS's own, by UTC day and not by the hour: "24 h" is
yesterday and today, "7 days" today and the seven before (matched pixel for
pixel against the WMS, 2026-09-27). Counted by the hour, the day's main pass
fell out of "24 h" before the next one was filed, and squares vanished at the
zoom where the WMS hands over.

Only a rolling window comes from the points. A dated range may reach back past
the near-real-time files into the archive's other files, and a long one is many
more points, so its marks are read off the WMS at every zoom. Nothing here
touches the network: the route fetches (``api/satellite.py``), this module
plans, reads and draws.
"""

from __future__ import annotations

import csv
import io
import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import numpy as np
from PIL import Image, ImageDraw

from . import firms, mvt

AREA_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
#: From this zoom in, a tile is drawn here. Out from it a screen covers enough
#: ground that a burning season is hundreds of thousands of points.
MIN_ZOOM = 8
#: Metres of Web Mercator per pixel at ``MIN_ZOOM`` on a 512 px tile. The
#: extension's picture has no zoom, only this, so both routes ask it.
COARSEST_M_PER_PX = 2 * firms.WORLD / ((1 << MIN_ZOOM) * firms.TILE_SIZE)
#: The ground one fetch covers, in degrees. The API costs the same for any box,
#: so a cell is as big as a dense week can be without weighing megabytes.
CELL_DEG = 4
#: A picture over more cells than this is too far out for points.
MAX_CELLS = 12
#: The area API answers at most this many days a request (``[1..5]``).
MAX_DAY_RANGE = 5
#: The deepest vector tile. Past it the map draws the z13 tile bigger, which a
#: vector tile allows without losing an edge: its marks are drawn, not stretched.
MAX_ZOOM = firms.MAX_ZOOM
#: From this zoom a tile carries each detection's footprint as well as its mark:
#: the map crosses from one to the other where a mark reaches footprint size.
FOOTPRINT_ZOOM = 11
#: How far past its border a tile keeps a footprint, in tile units: enough for
#: the edge drawn along the border to join the next tile's.
BUFFER = 16
#: The side a mark's size is rounded to, in Mercator metres. Marks of one size
#: and one colour are one feature of the tile, however many there are.
SIZE_STEP_M = 25
#: A picture's pixels are thinned to one mark per square of this many: 7 px
#: marks three pixels apart already overlap, so the rest would be drawn under
#: them, and a burning continent stays thousands of marks, not tens of thousands.
THIN_PX = 3
#: How opaque a pixel of FIRMS's 1 px squares has to be to count: it spreads
#: each detection over the pixels it straddles.
PAINTED_ALPHA = 96
#: The rolling windows, as the UTC days before today they reach back, the way
#: FIRMS's layers count them.
DAYS_BACK: dict[str, int] = {"24h": 1, "48h": 2, "72h": 3, "7d": 7}
#: The window whose detections are drawn red over the rest.
RECENT = "24h"
#: The near-real-time files behind each sensor. The combined VIIRS layer is the
#: three satellites (checked pixel for pixel against the WMS, 2026-09).
SOURCES: dict[str, tuple[str, ...]] = {
    "viirs": ("VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"),
    "viirs_snpp": ("VIIRS_SNPP_NRT",),
    "viirs_noaa20": ("VIIRS_NOAA20_NRT",),
    "modis": ("MODIS_NRT",),
}
#: How far past a tile's edge a detection can still reach into it: half the
#: widest MODIS pixel at the edge of its swath, 4.8 km.
REACH_M = 2500


@dataclass(frozen=True)
class Points:
    """Detections as columns: where, how big a pixel, and when (UTC seconds)."""

    lon: np.ndarray
    lat: np.ndarray
    scan: np.ndarray
    track: np.ndarray
    seen: np.ndarray

    def __len__(self) -> int:
        return int(self.lon.size)

    @staticmethod
    def empty() -> Points:
        f = np.zeros(0, dtype=np.float32)
        return Points(f, f, f, f, np.zeros(0, dtype=np.int64))

    @staticmethod
    def join(parts: Iterable[Points]) -> Points:
        parts = [p for p in parts if len(p)]
        if not parts:
            return Points.empty()
        return Points(*(np.concatenate([getattr(p, name) for p in parts])
                        for name in ("lon", "lat", "scan", "track", "seen")))


def drawn_here(window: str, bounds: tuple[float, float, float, float], width: int) -> bool:
    """Is this picture drawn from points rather than asked of the WMS?"""
    left, _, right, _ = bounds
    fine = (right - left) / max(1, width) <= COARSEST_M_PER_PX * (1 + 1e-9)
    return window in DAYS_BACK and fine and len(cells_for(bounds)) <= MAX_CELLS


def _degrees(x: float, y: float) -> tuple[float, float]:
    """``(lon, lat)`` of a point in Web Mercator metres."""
    lon = x / firms.WORLD * 180
    lat = math.degrees(2 * math.atan(math.exp(y * math.pi / firms.WORLD)) - math.pi / 2)
    return lon, lat


def cells_for(bounds: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """The cells a picture draws from, with the reach of a pixel past its edge."""
    left, bottom, right, top = bounds
    west, south = _degrees(left, bottom)
    east, north = _degrees(right, top)
    pad = REACH_M / 111_320
    reach = pad / max(0.05, math.cos(math.radians(max(abs(south), abs(north)))))
    xs = range(math.floor(max(-180.0, west - reach) / CELL_DEG),
               math.floor(min(179.999, east + reach) / CELL_DEG) + 1)
    ys = range(math.floor(max(-90.0, south - pad) / CELL_DEG),
               math.floor(min(89.999, north + pad) / CELL_DEG) + 1)
    return [(cx, cy) for cy in ys for cx in xs]


def cell_box(cell: tuple[int, int]) -> str:
    """One cell as the area API's ``west,south,east,north``."""
    cx, cy = cell
    west, south = cx * CELL_DEG, cy * CELL_DEG
    return f"{west},{south},{min(180, west + CELL_DEG)},{min(90, south + CELL_DEG)}"


def days_for(window: str, now: datetime) -> list[date]:
    """The UTC days a rolling window holds, oldest first."""
    today = now.astimezone(timezone.utc).date()
    return [today - timedelta(days=n) for n in range(DAYS_BACK[window], -1, -1)]


def since(window: str, now: datetime) -> int:
    """The first second of a window, UTC midnight of its first day."""
    first = days_for(window, now)[0]
    return int(datetime(first.year, first.month, first.day, tzinfo=timezone.utc).timestamp())


def runs(days: Iterable[date]) -> list[tuple[date, int]]:
    """Days as the fewest requests: consecutive stretches, five days at most."""
    out: list[tuple[date, int]] = []
    for day in sorted(set(days)):
        if out and out[-1][0] + timedelta(days=out[-1][1]) == day and out[-1][1] < MAX_DAY_RANGE:
            out[-1] = (out[-1][0], out[-1][1] + 1)
        else:
            out.append((day, 1))
    return out


def area_url(key: str, source: str, cell: tuple[int, int], start: date, count: int) -> str:
    """One request: a source's detections over a cell, ``count`` days from ``start``."""
    return f"{AREA_BASE}/{key}/{source}/{cell_box(cell)}/{count}/{start.isoformat()}"


def fresh_seconds(day: date, now: datetime) -> int:
    """How long a day's points stay true: a day still being filed, or history."""
    return firms.LIVE_CACHE_SECONDS if day >= now.date() - timedelta(days=1) else firms.PAST_CACHE_SECONDS


def is_table(text: str) -> bool:
    """Is this the CSV, rather than a sentence saying why not?"""
    return (text or "").lstrip().startswith("latitude,")


def parse(text: str, days: Iterable[date]) -> dict[date, Points]:
    """The rows of one answer, filed by day, with every day asked present.

    A day that answered no rows is a day with no fires, and is kept as that so
    it is not asked again. Rows are read by their header, since MODIS and VIIRS
    name their brightness columns differently.
    """
    if not is_table(text):
        raise ValueError("FIRMS did not answer with a table")
    rows: dict[date, list[tuple[float, float, float, float, int]]] = {day: [] for day in days}
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        try:
            day = date.fromisoformat(row["acq_date"])
            clock = int(row["acq_time"])
            seen = datetime(day.year, day.month, day.day, clock // 100, clock % 100, tzinfo=timezone.utc)
            entry = (float(row["longitude"]), float(row["latitude"]), float(row["scan"]),
                     float(row["track"]), int(seen.timestamp()))
        except (KeyError, TypeError, ValueError):
            continue
        rows.setdefault(day, []).append(entry)
    out: dict[date, Points] = {}
    for day, entries in rows.items():
        if not entries:
            out[day] = Points.empty()
            continue
        table = np.array(entries, dtype=np.float64)
        out[day] = Points(table[:, 0].astype(np.float32), table[:, 1].astype(np.float32),
                          table[:, 2].astype(np.float32), table[:, 3].astype(np.float32),
                          table[:, 4].astype(np.int64))
    return out


def _mercator(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    clamped = np.clip(lat.astype(np.float64), -firms.LAT_LIMIT, firms.LAT_LIMIT)
    x = firms.WORLD * lon.astype(np.float64) / 180
    y = firms.WORLD * np.log(np.tan(np.radians(45 + clamped / 2))) / math.pi
    return x, y


def _grow(mask: np.ndarray, rx: int, ry: int) -> np.ndarray:
    """Every set pixel grown into a (2rx+1) x (2ry+1) rectangle around it."""
    wide = mask.copy()
    for d in range(1, rx + 1):
        wide[:, d:] |= mask[:, :-d]
        wide[:, :-d] |= mask[:, d:]
    tall = wide.copy()
    for d in range(1, ry + 1):
        tall[d:, :] |= wide[:-d, :]
        tall[:-d, :] |= wide[d:, :]
    return tall


def _png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def render(
    points: Points,
    bounds: tuple[float, float, float, float],
    width: int,
    height: int,
    *,
    sensor_id: str,
    window: str,
    now: datetime,
) -> bytes:
    """One picture of the detections in a window, as a PNG, the WMS's look kept.

    FIRMS's "24 h" is red over the rest in amber, as the WMS layers are
    stacked. A mark smaller than ``FOOTPRINT_PX`` is a solid square of the
    zoom's size with a ring round each patch, exactly the WMS picture dressed.
    From there each detection is its own footprint, scan by track as FIRMS
    measured it, drawn oldest first with its own ring and edge, so a square
    under another still shows where it ends.
    """
    left, bottom, right, top = bounds
    across, down = (right - left) / width, (top - bottom) / height
    keep = points.seen >= since(window, now)
    x, y = _mercator(points.lon[keep], points.lat[keep])
    px, py = (x - left) / across, (top - y) / down
    seen = points.seen[keep]
    recent = seen >= since(RECENT, now)
    mark = firms.mark_px(sensor_id, bounds, width)
    if mark < firms.FOOTPRINT_PX:
        return _png(_squares(px, py, recent, mark, width, height))
    stretch = 1 / np.maximum(0.01, np.cos(np.radians(points.lat[keep].astype(np.float64))))
    half_w = np.maximum(firms.MARK_MIN_PX, points.scan[keep] * 1000 * stretch / across) / 2
    half_h = np.maximum(firms.MARK_MIN_PX, points.track[keep] * 1000 * stretch / down) / 2
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ring, edge = firms.RING_PX, firms.EDGE_PX
    fill = round(255 * firms.FOOTPRINT_FILL)
    for i in np.argsort(seen, kind="stable"):
        x0 = math.floor(px[i] - half_w[i]) - ring
        y0 = math.floor(py[i] - half_h[i]) - ring
        x1 = math.ceil(px[i] + half_w[i]) + ring
        y1 = math.ceil(py[i] + half_h[i]) + ring
        if x1 < 0 or y1 < 0 or x0 >= width or y0 >= height:
            continue
        rgb = firms.RECENT_RGB if recent[i] else firms.EARLIER_RGB
        # Each square on its own and laid over the rest: drawn straight onto
        # the picture, its see-through inside would replace the edges under it.
        square = Image.new("RGBA", (x1 - x0 + 1, y1 - y0 + 1), (0, 0, 0, 0))
        draw = ImageDraw.Draw(square)
        draw.rectangle((0, 0, x1 - x0, y1 - y0), outline=firms.RING_RGBA, width=ring)
        draw.rectangle((ring, ring, x1 - x0 - ring, y1 - y0 - ring), fill=(*rgb, fill), outline=(*rgb, 255), width=edge)
        image.alpha_composite(square, dest=(max(0, x0), max(0, y0)), source=(max(0, -x0), max(0, -y0)))
    return _png(image)


def _squares(px: np.ndarray, py: np.ndarray, recent: np.ndarray, mark: int, width: int, height: int) -> Image.Image:
    """Solid squares of one size, ringed as ``firms.dressed`` rings the WMS's.

    Drawn on a margin wider than a square and its ring, then cut back, so a
    square across the tile's edge gets its ring on both tiles.
    """
    pad = mark + 2 * firms.RING_PX + 2
    wide, high = width + 2 * pad, height + 2 * pad
    canvas = np.zeros((high, wide, 4), dtype=np.uint8)
    half = mark // 2
    for chosen, rgb in ((~recent, firms.EARLIER_RGB), (recent, firms.RECENT_RGB)):
        cx = np.floor(px[chosen]).astype(np.int64) + pad
        cy = np.floor(py[chosen]).astype(np.int64) + pad
        inside = (cx >= 0) & (cx < wide) & (cy >= 0) & (cy < high)
        if not inside.any():
            continue
        centres = np.zeros((high, wide), dtype=bool)
        centres[cy[inside], cx[inside]] = True
        canvas[_grow(centres, half, half)] = (*rgb, 255)
    image = Image.fromarray(canvas)
    if canvas[..., 3].any():
        image = firms.dressed(image, mark)
    return image.crop((pad, pad, pad + width, pad + height))


def tile(points: Points, z: int, x: int, y: int, *, window: str, now: datetime) -> bytes:
    """One vector tile of the detections in a window, for the map to draw.

    Layer ``marks`` is a point per detection, grouped by colour (``recent``) and
    by the side of its footprint in Mercator metres (``side``), which the map
    turns into a size on screen at every zoom; ``foot`` says the footprint
    comes too, so close in the mark can give way to it. A point belongs to the
    one tile its centre is in, so no mark is drawn twice. From
    ``FOOTPRINT_ZOOM``, layer ``footprints`` adds the rectangles, scan by track,
    in every tile they reach into: the map cuts a fill and an edge at the
    tile's border.
    """
    left, bottom, right, top = firms.tile_bounds(z, x, y)
    keep = points.seen >= since(window, now)
    lat = points.lat[keep].astype(np.float64)
    mx, my = _mercator(points.lon[keep], lat)
    scale = mvt.EXTENT / (right - left)
    tx, ty = (mx - left) * scale, (top - my) * scale
    recent = points.seen[keep] >= since(RECENT, now)
    stretch = 1 / np.maximum(0.01, np.cos(np.radians(lat)))
    scan = points.scan[keep] * 1000 * stretch
    track = points.track[keep] * 1000 * stretch
    side = np.maximum(1, np.round(np.sqrt(scan * track) / SIZE_STEP_M)).astype(np.int64) * SIZE_STEP_M
    inside = (tx >= 0) & (tx < mvt.EXTENT) & (ty >= 0) & (ty < mvt.EXTENT)
    marks = mvt.Layer("marks")
    for flag in (False, True):
        chosen = inside & (recent == flag)
        for size in np.unique(side[chosen]):
            group = chosen & (side == size)
            marks.points(np.round(tx[group]), np.round(ty[group]),
                         {"recent": int(flag), "side": int(size), "foot": 1})
    layers = [marks]
    if z >= FOOTPRINT_ZOOM:
        half_w, half_h = scan * scale / 2, track * scale / 2
        x0, x1, y0, y1 = tx - half_w, tx + half_w, ty - half_h, ty + half_h
        near = (x1 > -BUFFER) & (x0 < mvt.EXTENT + BUFFER) & (y1 > -BUFFER) & (y0 < mvt.EXTENT + BUFFER)
        footprints = mvt.Layer("footprints")
        for flag in (False, True):
            group = near & (recent == flag)
            left_px, top_px, right_px, bottom_px = (
                np.clip(np.round(v[group]), -mvt.EXTENT, 2 * mvt.EXTENT) for v in (x0, y0, x1, y1))
            footprints.rectangles(left_px, top_px, right_px, bottom_px, {"recent": int(flag)})
        layers.append(footprints)
    return mvt.encode(layers)


def picture_tile(content: bytes, z: int, x: int, y: int, *, sensor_id: str) -> bytes:
    """The marks of one FIRMS picture of 1 px squares, as a vector tile.

    Far out and for a dated range the detections come as FIRMS draws them, one
    picture a tile, and the map still draws the marks itself, so they keep
    their size through a zoom here too. FIRMS spreads a detection over the
    pixels it straddles, so each square of ``THIN_PX`` pixels becomes one mark
    at the opacity-weighted middle of what is painted in it, red if any of it
    is. Its size is the sensor's footprint, since a picture does not say
    FIRMS's measured one. From ``FOOTPRINT_ZOOM`` a square of that size comes
    with each mark (``foot``), so a dated range hands over to see-through
    footprints like a rolling window. A picture knows only its own tile, so a
    footprint across its border is cut there.
    """
    with Image.open(io.BytesIO(content)) as source:
        rgba = np.asarray(source.convert("RGBA"))
    height, width = rgba.shape[:2]
    alpha = rgba[..., 3].astype(np.float64)
    ys, xs = np.nonzero(alpha >= PAINTED_ALPHA)
    if not ys.size:
        return b""
    weight = alpha[ys, xs]
    red = rgba[ys, xs, 1] < (firms.RECENT_RGB[1] + firms.EARLIER_RGB[1]) / 2
    across = -(-width // THIN_PX)
    _, block = np.unique((ys // THIN_PX) * across + xs // THIN_PX, return_inverse=True)
    total = np.bincount(block, weights=weight)
    mark_x = np.bincount(block, weights=weight * (xs + 0.5)) / total * (mvt.EXTENT / width)
    mark_y = np.bincount(block, weights=weight * (ys + 0.5)) / total * (mvt.EXTENT / height)
    recent = np.bincount(block, weights=red.astype(np.float64)) > 0
    left, bottom, right, top = firms.tile_bounds(z, x, y)
    _, lat = _degrees((left + right) / 2, (bottom + top) / 2)
    side = firms.sensor(sensor_id).footprint_m / max(0.01, math.cos(math.radians(lat)))
    side = max(1, round(side / SIZE_STEP_M)) * SIZE_STEP_M
    foot = z >= FOOTPRINT_ZOOM
    mark_x = np.clip(np.floor(mark_x), 0, mvt.EXTENT - 1)
    mark_y = np.clip(np.floor(mark_y), 0, mvt.EXTENT - 1)
    marks = mvt.Layer("marks")
    for flag in (False, True):
        chosen = recent == flag
        marks.points(mark_x[chosen], mark_y[chosen], {"recent": int(flag), "side": int(side), "foot": int(foot)})
    layers = [marks]
    if foot:
        half = side * mvt.EXTENT / (right - left) / 2
        footprints = mvt.Layer("footprints")
        for flag in (False, True):
            chosen = recent == flag
            left_px, top_px, right_px, bottom_px = (
                np.clip(np.round(v[chosen]), -mvt.EXTENT, 2 * mvt.EXTENT)
                for v in (mark_x - half, mark_y - half, mark_x + half, mark_y + half))
            footprints.rectangles(left_px, top_px, right_px, bottom_px, {"recent": int(flag)})
        layers.append(footprints)
    return mvt.encode(layers)
