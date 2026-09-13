"""NASA FIRMS active fire detections, as a layer over the map.

FIRMS publishes thermal anomalies from the VIIRS and MODIS instruments: what
was burning, where, and when it was seen. Two things make it worth wiring in
rather than sending the analyst to the FIRMS site — it answers *both* halves of
the question a case asks. **Live** ("is this burning now") is the last 24, 48 or
72 hours, or the last week, which FIRMS serves as its own layers. **History**
("was this burning on the day of the strike") is any date range back through the
archive, which is the same layers asked with a ``TIME``.

Three decisions are recorded here because none is obvious from the URLs:

- **WMS, not the CSV API.** FIRMS offers both. The CSV would let the app draw
  its own marks — clickable, styled by confidence — but a bbox of detections is
  unbounded in a way a tile is not, and it would need paging, a zoom floor and a
  cap before it drew anything. The WMS is a raster layer, which the map already
  knows how to stack (``lib/map/basemap.js``), and one screen is one request
  per tile whatever is burning. Drawing our own marks is the upgrade, not the
  starting point.
- **The key never reaches the browser.** FIRMS puts the MAP_KEY *in the path*,
  so a direct tile URL would publish it in the page source, in the network log,
  and in any screenshot of either. It is proxied like every other keyed
  provider (``api/satellite.py``'s tile proxy is the same argument).
- **A tile is a GetMap.** WMS speaks bounding boxes, the map speaks z/x/y, so
  this module converts one to the other. FIRMS serves EPSG:3857 natively, which
  is the projection the tile grid is already in — no reprojection, just the
  four numbers of the tile's own square.

Rate limit, from FIRMS: 5000 transactions per 10 minutes, and a long date range
counts as more than one. Nothing here polls, and a layer that is off asks for
nothing, so a single analyst never approaches it — but it is why this must not
grow a refresh timer without a reason.
"""

from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass
from datetime import date, timedelta

WMS_BASE = "https://firms.modaps.eosdis.nasa.gov/mapserver/wms/fires"
# The whole of Web Mercator, in metres: the tile grid's own square.
WORLD = 20037508.342789244
TILE_SIZE = 256
# FIRMS serves detections from the last seven days as its own layers, and
# anything older through the archive. Asking the archive for a range longer
# than this is refused upstream, so it is refused here with a reason.
MAX_RANGE_DAYS = 31
# Past this the detections are a smear of identical squares: FIRMS draws a
# fixed-size symbol per detection, and VIIRS resolves 375 m. The layer stops
# being asked for rather than drawing a screen of overlapping marks.
MAX_ZOOM = 14


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


SENSORS: tuple[Sensor, ...] = (
    # The default, and the reason to prefer it: VIIRS resolves 375 m where MODIS
    # resolves 1 km, so a single burning building is a mark rather than a blur.
    Sensor(id="viirs", label="VIIRS (S-NPP + NOAA-20)", layer="fires_viirs"),
    Sensor(id="viirs_snpp", label="VIIRS Suomi-NPP", layer="fires_viirs_snpp"),
    Sensor(id="viirs_noaa20", label="VIIRS NOAA-20", layer="fires_viirs_noaa20"),
    # 1 km, and on orbit since 1999: the only one that can answer a question
    # about a fire older than VIIRS itself.
    Sensor(id="modis", label="MODIS (Terra + Aqua)", layer="fires_modis"),
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
) -> str:
    """A GetMap for one square of ground, with the key where FIRMS puts it.

    Pure, so the shape of the request is read off a test rather than off a
    fire: `test_firms.py` asserts the bbox, the projection and the date range
    without asking NASA anything.
    """
    left, bottom, right, top = bounds
    query = [
        "SERVICE=WMS",
        "VERSION=1.3.0",
        "REQUEST=GetMap",
        f"LAYERS={layer_name(sensor_id, window)}",
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
    return f"{WMS_BASE}/{key}/?{'&'.join(query)}"


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
) -> str:
    """…and the one a map tile is: the same request over the tile's own square.

    The app's map is a grid of these. The extension asks for one image over the
    whole of somebody else's map instead, because it has no tile grid to hang
    them on — one screen, one request.
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
    )


def too_deep(zoom: int) -> bool:
    """Past the zoom where a detection mark still means one detection."""
    return zoom > MAX_ZOOM


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
