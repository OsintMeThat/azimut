"""NASA FIRMS active fire detections, as a layer over the map.

FIRMS publishes thermal anomalies from the VIIRS and MODIS instruments: what
was burning, where, and when it was seen. Two things make it worth wiring in
rather than sending the analyst to the FIRMS site — it answers *both* halves of
the question a case asks. **Live** ("is this burning now") is the last 24, 48 or
72 hours, or the last week, which FIRMS serves as its own layers. **History**
("was this burning on the day of the strike") is any date range back through the
archive, which is the same layers asked with a ``TIME``.

Three decisions are recorded here because none is obvious from the URLs:

- **WMS far out, the points close in.** A bbox of detections is unbounded in a
  way a tile is not: a continent's burning week is hundreds of thousands of
  points, where the WMS is one picture per tile whatever is burning. So out
  from z8, and for a dated range, this module asks the WMS, and the squares
  of its picture are read back into points. From z8 in, a rolling window
  comes from the area API's points, one fetch per cell for every zoom under
  it. Either way the map draws the marks itself (``engine/firmspoints.py``).
- **The key never reaches the browser.** FIRMS puts the MAP_KEY *in the path*,
  so a direct tile URL would publish it in the page source, in the network log,
  and in any screenshot of either. It is proxied like every other keyed
  provider (``api/satellite.py``'s tile proxy is the same argument).
- **A tile is a GetMap.** WMS speaks bounding boxes, the map speaks z/x/y, so
  this module converts one to the other. FIRMS serves EPSG:3857 natively, which
  is the projection the tile grid is already in — no reprojection, just the
  four numbers of the tile's own square.

Rate limit, from FIRMS: 5000 transactions per 10 minutes, and every day a
picture covers is counted, per satellite in the layer (measured 2026-09). One tile
of the last 24 hours on the combined VIIRS layer is three, one tile of a 31-day
range is ninety-three, so one screen of a long range spends more than a quarter
of the allowance. Three things keep a session inside it: tiles of 512 px, a
quarter of the requests 256 px would be; a past range the browser may keep for
hours (``cache_seconds``); and a refusal read for what it is (``allowance``),
so a spent allowance pauses the layer rather than filing the key as dead.
Nothing here polls, and it must not grow a refresh timer.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import re
from dataclasses import dataclass
from datetime import date, timedelta

from PIL import Image, ImageFilter

WMS_BASE = "https://firms.modaps.eosdis.nasa.gov/mapserver/wms/fires"
# The whole of Web Mercator, in metres: the tile grid's own square.
WORLD = 20037508.342789244
# A tile a quarter the count of 256 px ones for the same screen, and FIRMS
# counts requests: the same ground, a quarter of the allowance.
TILE_SIZE = 512
# FIRMS serves detections from the last seven days as its own layers, and
# anything older through the archive. Asking the archive for a range longer
# than this is refused upstream, so it is refused here with a reason.
MAX_RANGE_DAYS = 31
# Past this a tile would hold the same detections, which the map draws at any
# deeper zoom from the deepest one. At 13 a VIIRS square is already 20 px or more.
MAX_ZOOM = 13


@dataclass(frozen=True)
class Sensor:
    """One instrument, under the name FIRMS files it by.

    The rolling layers are this name with the window appended (``…_24``,
    ``…_7``); the same name alone is the WMS-Time layer, addressed by date. One
    name, two ways of asking — which is why only the sensors that have both are
    offered here. NOAA-21 has the rolling layers and no dated one, and a sensor
    that could answer "now" but not "that day" would be a trap in a tool whose
    whole point is the second question.
    """

    id: str
    label: str
    layer: str
    #: The ground one detection stands for, which is what its square is drawn as.
    footprint_m: float


SENSORS: tuple[Sensor, ...] = (
    # The default, and the reason to prefer it: VIIRS resolves 375 m where MODIS
    # resolves 1 km, so a single burning building is a mark rather than a blur.
    Sensor(id="viirs", label="VIIRS (S-NPP, NOAA-20, NOAA-21)", layer="fires_viirs", footprint_m=375),
    Sensor(id="viirs_snpp", label="VIIRS Suomi-NPP", layer="fires_viirs_snpp", footprint_m=375),
    Sensor(id="viirs_noaa20", label="VIIRS NOAA-20", layer="fires_viirs_noaa20", footprint_m=375),
    # 1 km, and on orbit since 1999: the only one that can answer a question
    # about a fire older than VIIRS itself.
    Sensor(id="modis", label="MODIS (Terra + Aqua)", layer="fires_modis", footprint_m=1000),
)

# The rolling windows FIRMS serves as layers of their own, by the suffix it
# files them under.
WINDOWS: dict[str, str] = {"24h": "24", "48h": "48", "72h": "72", "7d": "7"}

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

#: Where a MAP_KEY is asked about rather than used. It answers 200 for a key
#: that works and 403 with a sentence for one that does not, which is the only
#: honest test there is: the WMS answers a *picture* either way (below).
STATUS_URL = "https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/"

#: The placard FIRMS serves instead of refusing.
#:
#: A GetMap with a key it will not accept comes back **200, `image/png`, and a
#: 28 KB picture saying so** — the same bytes for every bad key (verified
#: 2026-09). Nothing in the HTTP answer says anything is wrong, so a map would
#: happily tile that placard across the ground and a key test would call it a
#: success. It is recognised by its own digest, exactly as the imagery
#: providers' "no tile here" placards are (``engine/tiles.py``).
PLACARD_SHA256 = "75d876f3c684a2021a356553a08257dc2d57cb13ff9d24c147476490c499cea4"


def is_placard(content: bytes) -> bool:
    """Is this FIRMS's "that key is no good" picture rather than a map?"""
    return hashlib.sha256(content).hexdigest() == PLACARD_SHA256


#: How long a spent allowance pauses the layer before it asks again. The count
#: fell back to zero in one go after ten quiet minutes (measured 2026-09), so
#: the allowance returns within ten minutes, and a minute between tries spares
#: each screen its dozen refusals.
PAUSE_SECONDS = 60


#: How near the limit a count has to be for a refusal to mean it was spent: a
#: little over two of the dearest pictures, 31 days of the combined VIIRS layer
#: at 93. FIRMS refuses a picture whose cost would carry the count past it.
SPENT_MARGIN = 200


def spent(used: int, limit: int) -> bool:
    """Whether a count this close to its limit explains a refusal."""
    return used + SPENT_MARGIN >= limit


def allowance(body: str) -> tuple[int, int] | None:
    """``(used, limit)`` from the key-status answer, or None when it is not one.

    The placard says "invalid key *or* spent allowance" in one picture, the
    same bytes either way (verified 2026-09). The status endpoint tells them
    apart: a key it knows gets JSON with its count, even mid-refusal, and a key
    it does not gets a 403 and a sentence.
    """
    try:
        data = json.loads(body or "")
        used, limit = data["current_transactions"], data["transaction_limit"]
    except (ValueError, KeyError, TypeError):
        return None
    if not all(isinstance(n, int) and not isinstance(n, bool) for n in (used, limit)):
        return None
    return used, limit


def sensor(sensor_id: str) -> Sensor:
    """The sensor asked for, or a ``KeyError`` naming what is on offer."""
    for entry in SENSORS:
        if entry.id == sensor_id:
            return entry
    raise KeyError(f"unknown FIRMS sensor '{sensor_id}'")


def parse_day(value: str) -> date:
    """A ``YYYY-MM-DD`` from an address, or a ``ValueError``.

    Strict rather than lenient: the dates reach a public service in a URL, and
    `date.fromisoformat` would otherwise accept a whole grammar of forms that
    FIRMS does not.
    """
    if not _DATE.match(value or ""):
        raise ValueError(f"'{value}' is not a YYYY-MM-DD date")
    return date.fromisoformat(value)


def window_range(first: str, last: str) -> tuple[date, date]:
    """The archive window, checked the way FIRMS checks it.

    Ordered, and no longer than ``MAX_RANGE_DAYS`` — upstream answers a longer
    range with an error, and counts a long one as several transactions.
    """
    start = parse_day(first)
    end = parse_day(last or first)
    if end < start:
        start, end = end, start
    if end - start > timedelta(days=MAX_RANGE_DAYS - 1):
        raise ValueError(f"a FIRMS date range covers at most {MAX_RANGE_DAYS} days")
    return start, end


def layer_name(sensor_id: str, window: str) -> str:
    """Which FIRMS layer answers this question.

    A rolling window names the layer that already holds it; anything else is
    the archive layer, which is dated by the ``TIME`` beside it.
    """
    entry = sensor(sensor_id)
    suffix = WINDOWS.get(window)
    return f"{entry.layer}_{suffix}" if suffix else entry.layer


#: Web Mercator stops short of the poles, and a bbox that runs past it is a
#: bbox the projection cannot express.
LAT_LIMIT = 85.05112878


def mercator(lat: float, lon: float) -> tuple[float, float]:
    """One coordinate in EPSG:3857 metres.

    The extension works in degrees — it reads them off somebody else's map —
    and FIRMS is asked in metres, so the conversion happens on this side rather
    than being a second copy of the projection in a content script.
    """
    clamped = max(-LAT_LIMIT, min(LAT_LIMIT, lat))
    x = WORLD * lon / 180
    y = WORLD * math.log(math.tan(math.radians(45 + clamped / 2))) / math.pi
    return x, y


def bounds_of(south: float, west: float, north: float, east: float) -> tuple[float, float, float, float]:
    """A geographic rectangle as the square of metres WMS wants."""
    left, bottom = mercator(south, west)
    right, top = mercator(north, east)
    return (left, bottom, right, top)


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """One tile's square in EPSG:3857 metres, as WMS wants it.

    The grid is the map's; the numbers are the projection's. Row 0 is at the
    top in the tile grid and at the north in the projection, which is the only
    sign flip in here.
    """
    span = 2 * WORLD / (1 << z)
    left = -WORLD + x * span
    top = WORLD - y * span
    return (left, top - span, left + span, top)


# How a detection is drawn. FIRMS's default is a 5 px square in a dull red,
# which reads on a plain map and sinks into imagery; its WMS takes a symbol, a
# size and a colour per layer in the path, and `dress` adds the dark ring.
SYMBOL = "square"
#: The last 24 hours, and the rest of a longer window under them. FIRMS's own
#: KML draws the newest red and the older toward yellow, so this keeps its
#: convention: a fire still burning reads apart from what burned days ago.
RECENT_RGB = (255, 48, 0)
EARLIER_RGB = (255, 186, 0)
#: The smallest square a detection is drawn as: far out a 375 m pixel is a
#: speck, and a detection still has to be seen.
MARK_MIN_PX = 7
MARK_MAX_PX = 1000  # FIRMS's own ceiling for SIZE


def drawn_layers(sensor_id: str, window: str) -> list[tuple[str, tuple[int, int, int]]]:
    """The layers one picture is drawn from, lowest first, with their colours.

    A window longer than a day adds the last 24 hours over it, which FIRMS
    counts as one more day. A dated range is one colour: "the newest" of an
    archive question is not a thing the question asked.
    """
    layer = layer_name(sensor_id, window)
    if window in WINDOWS and window != "24h":
        return [(layer, EARLIER_RGB), (layer_name(sensor_id, "24h"), RECENT_RGB)]
    return [(layer, RECENT_RGB)]


def mark_px(sensor_id: str, bounds: tuple[float, float, float, float], width: int) -> int:
    """How many pixels one detection's square covers in this picture.

    Its footprint on the ground, as far as the zoom shows it, and never smaller
    than a mark still seen far out. Mercator stretches the ground by 1/cos of
    the latitude, and the imagery under the squares with it, so they stretch too.
    """
    left, bottom, right, top = bounds
    per_px = (right - left) / max(1, width)
    middle = (bottom + top) / 2
    lat = math.degrees(2 * math.atan(math.exp(middle * math.pi / WORLD)) - math.pi / 2)
    ground = sensor(sensor_id).footprint_m / max(0.01, math.cos(math.radians(lat)))
    return max(MARK_MIN_PX, min(MARK_MAX_PX, round(ground / per_px)))


def image_url(
    key: str,
    *,
    bounds: tuple[float, float, float, float],
    width: int,
    height: int,
    sensor_id: str = "viirs",
    window: str = "24h",
    first: str = "",
    last: str = "",
    mark: int | None = None,
) -> str:
    """A GetMap for one square of ground, with the key where FIRMS puts it.

    Pure, so the shape of the request is read off a test rather than off a
    fire: `test_firms.py` asserts the bbox, the projection and the date range
    without asking NASA anything. The drawing rides in the path, after the key:
    layers, symbols, sizes and colours, one entry per layer. ``mark`` sets the
    square's size in pixels instead of the footprint's: the map's own marks are
    read off a picture of 1 px squares (``firmspoints.picture_tile``).
    """
    left, bottom, right, top = bounds
    layers = drawn_layers(sensor_id, window)
    size = mark or mark_px(sensor_id, bounds, width)
    names = ",".join(name for name, _ in layers)
    style = "/".join([
        names,
        ",".join(SYMBOL for _ in layers),
        ",".join(str(size) for _ in layers),
        ",".join("+".join(str(c) for c in rgb) for _, rgb in layers),
    ])
    query = [
        "SERVICE=WMS",
        "VERSION=1.3.0",
        "REQUEST=GetMap",
        f"LAYERS={names}",
        "FORMAT=image/png",
        "TRANSPARENT=TRUE",
        "CRS=EPSG:3857",
        f"WIDTH={width}",
        f"HEIGHT={height}",
        f"BBOX={left:.6f},{bottom:.6f},{right:.6f},{top:.6f}",
    ]
    if window not in WINDOWS:
        start, end = window_range(first, last)
        query.append(f"TIME={start.isoformat()}/{end.isoformat()}")
    return f"{WMS_BASE}/{key}/{style}/?{'&'.join(query)}"


def tile_url(
    key: str,
    *,
    sensor_id: str = "viirs",
    window: str = "24h",
    z: int,
    x: int,
    y: int,
    first: str = "",
    last: str = "",
    size: int = TILE_SIZE,
    mark: int | None = None,
) -> str:
    """…and the one a map tile is: the same request over the tile's own square.

    The app's map is a grid of these, turned into its own marks. The extension
    asks for one image over the whole of somebody else's map instead, because it
    has no tile grid to hang them on — one screen, one request.
    """
    return image_url(
        key,
        bounds=tile_bounds(z, x, y),
        width=size,
        height=size,
        sensor_id=sensor_id,
        window=window,
        first=first,
        last=last,
        mark=mark,
    )


#: The ring laid around every mark, so a red square reads on red soil and a
#: yellow one on sand.
RING_RGBA = (24, 12, 6, 220)
RING_PX = 2
#: From this size a square is a footprint more than a mark, and a solid one
#: would hide the ground it is about: its edge stays solid, its inside shows
#: the ground through this much colour.
FOOTPRINT_PX = 16
FOOTPRINT_FILL = 0.35
EDGE_PX = 2


def dress(content: bytes, mark: int) -> bytes:
    """A FIRMS picture made to read over imagery, as a PNG.

    A picture with nothing in it goes back as it came.
    """
    with Image.open(io.BytesIO(content)) as source:
        image = source.convert("RGBA")
    if not image.getchannel("A").getbbox():
        return content
    buffer = io.BytesIO()
    dressed(image, mark).save(buffer, "PNG")
    return buffer.getvalue()


def dressed(image: Image.Image, mark: int) -> Image.Image:
    """Marks in an RGBA picture, each patch of them ringed dark.

    A mark ``FOOTPRINT_PX`` or bigger, which is a footprint seen close, keeps a
    solid edge and lets the ground show inside, the way FIRMS's own footprints
    are drawn. The picture holds no more than pixels, so the ring and the edge
    go round a patch, not each square in it: the points drawn here
    (``engine/firmspoints.py``) give every square its own from the zoom where
    that shows.
    """
    import numpy as np

    alpha = image.getchannel("A")
    pixels = np.asarray(image, dtype=np.float32) / 255
    colour, cover = pixels[..., :3], pixels[..., 3]
    ring = np.asarray(alpha.filter(ImageFilter.MaxFilter(2 * RING_PX + 1)), dtype=np.float32) / 255
    if mark >= FOOTPRINT_PX:
        inside = np.asarray(alpha.filter(ImageFilter.MinFilter(2 * EDGE_PX + 1)), dtype=np.float32) / 255
        cover = cover - inside * (1 - FOOTPRINT_FILL)
    outline = np.clip(ring - pixels[..., 3], 0, 1) * (RING_RGBA[3] / 255)
    shade = np.array(RING_RGBA[:3], dtype=np.float32) / 255
    total = cover + outline * (1 - cover)
    mixed = (colour * cover[..., None] + shade * (outline * (1 - cover))[..., None]) / np.maximum(
        total, 1e-6
    )[..., None]
    out = np.dstack([mixed, total])
    return Image.fromarray(np.round(out * 255).astype(np.uint8))


#: How long the browser may keep a picture. A live window is what is burning
#: now, and FIRMS refreshes it every fifteen minutes. A range that ended before
#: yesterday is history: a detection filed late has landed by then.
LIVE_CACHE_SECONDS = 300
PAST_CACHE_SECONDS = 6 * 3600


def cache_seconds(window: str, first: str = "", last: str = "", *, today: date) -> int:
    """How long a picture of this window stays true."""
    if window in WINDOWS:
        return LIVE_CACHE_SECONDS
    _, end = window_range(first, last)
    return PAST_CACHE_SECONDS if end < today - timedelta(days=1) else LIVE_CACHE_SECONDS


def service_error(body: str) -> str:
    """The human half of an OGC ExceptionReport, when FIRMS refuses.

    Same reasoning as Sentinel Hub's: the service says exactly what is wrong
    with the key or the layer, and "400 Bad Request" throws that away.
    """
    # The space matters: the report element `<ServiceExceptionReport>` starts
    # with this element's own name, and a looser pattern reads the wrapper as
    # the message and hands back the tag it was supposed to strip.
    match = re.search(r"<ServiceException(?:\s[^>]*)?>(.*?)</ServiceException>", body, re.S)
    if match:
        return match.group(1).strip()[:200]
    return (body or "").strip()[:200]


def status_error(body: str) -> str:
    """What the key-status endpoint said, when it refused.

    It answers in plain text — sometimes wrapped in a scrap of HTML — and its
    own sentence is better than "403": it names the two things that put a key
    here, an id the service does not know and an account over its limit.
    """
    text = re.sub(r"<[^>]+>", " ", body or "")
    text = " ".join(text.split())
    return text[:200] or "FIRMS would not accept this key"
