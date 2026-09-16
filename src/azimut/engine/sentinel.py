"""Sentinel Hub specifics: layers, the mosaicking window, and date discovery.

Everything here is about one basemap (``sentinel2`` in engine/tiles.py) but is
kept out of it because Sentinel Hub is the only provider with *choices* in it:
what to render (a layer) and when (a mosaicking window). Both ride on the
provider id as a **variant** — ``sentinel2~SWIR~2026-05-01~2026-05-31`` — so the
existing machinery keeps working untouched: the tile proxy resolves it through
``tiles.get_provider``, the disk cache keys on it (a window in the id is a
window in the cache key, which is the trap docs/IMAGERY_PROVIDERS.md warns
about), and a capture's provenance records exactly which layer and window the
pixels came from.

The layer catalogue below mirrors the "Simple Sentinel-2 L2A template" every
setup guide points at, but it is a *default*, not a fact: the layers an instance
serves are whatever its configuration says. ``capabilities_layers`` asks the
instance itself, which is the only authority (user-triggered — local-first).
"""

from __future__ import annotations

import base64
import io
import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable

import httpx
from PIL import Image, UnidentifiedImageError

BASE = "https://sh.dataspace.copernicus.eu/ogc"
USER_AGENT = "Azimut/0.1 (+local OSINT workbench; single-user)"

# Sentinel-2 L2A in Sentinel Hub's WFS type vocabulary (DSS1 = L1C, DSS3 = S1).
# The basemap renders L2A, so date discovery must ask about L2A: L1C passes the
# same orbit but a date list from the wrong collection would be a plausible lie.
WFS_TYPENAME = "DSS2"


@dataclass(frozen=True)
class Layer:
    id: str
    label: str
    hint: str


# The layers the standard template is relied on to ship, and only those. This
# list is a *fallback*, used when the instance can't be asked — so it holds the
# four that are near-universal rather than everything a configuration might
# have. Offering a layer the instance doesn't serve buys nothing: it 400s on
# selection, and a dropdown of entries that may or may not work is worse than a
# short one that does. Anything else a user configured arrives through
# capabilities_layers, which is the authority.
#
# `hint` is the reason to pick one — this is a workbench, and "SWIR" tells a
# user nothing about why they'd want it.
LAYERS: tuple[Layer, ...] = (
    Layer("TRUE_COLOR", "True colour", "Natural colour (B04/B03/B02), close to what the eye would see."),
    Layer(
        "FALSE_COLOR",
        "False colour (infrared)",
        "Near-infrared (B08/B04/B03): water goes near-black, so vessels, wakes and "
        "structures on water stand out. Vegetation reads red.",
    ),
    Layer(
        "SWIR",
        "SWIR (short-wave infrared)",
        "B12/B8A/B04: water is darkest of all, giving the strongest contrast for vessels at "
        "sea, and the band that sees through thin haze and smoke to fires and flares.",
    ),
    Layer("NDVI", "NDVI (vegetation index)", "Vegetation vigour for crops, clearing and seasonal change."),
)

# Hints for layers we know but don't offer by default — a configuration that
# ships them gets the explanation, not a bare identifier.
KNOWN_HINTS: dict[str, str] = {
    "HIGHLIGHT_OPTIMIZED": "Natural colour with highlights pulled back. Bright objects on "
    "dark water keep their shape instead of blowing out.",
    "NDWI": "Water/land boundary as an index. Shows shorelines, flooding and what is water at "
    "all on a given date.",
    "SCENE_CLASSIFICATION": "The scene's own per-pixel classes (cloud, shadow, water, "
    "vegetation). Use it to decide whether a date is worth opening.",
    "MOISTURE_INDEX": "Surface and vegetation water content for irrigation, drought and burn scars.",
    "FALSE_COLOR_URBAN": "B12/B11/B04: built-up surfaces separate from bare ground and vegetation.",
    "NDSI": "Snow index that separates snow and ice from similar-looking cloud.",
}
DEFAULT_LAYER = LAYERS[0].id

# A layer id is a URL parameter *and* a path segment (the variant id reaches the
# tile proxy as one) *and* a directory name (the disk cache). Anything outside
# this shape is refused rather than escaped: no separators, no traversal, no
# surprises on any of the three OSes we ship.
_LAYER_RE = re.compile(r"^[A-Z0-9_]{1,40}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# The cloud ceiling as a variant token: CC0 … CC100, and nothing else.
_MAXCC_RE = re.compile(r"^CC(100|[0-9]{1,2})$")

VARIANT_SEP = "~"

# Every request states its cloud ceiling, and the default states "no ceiling".
# A configuration instance carries a cloud-coverage data filter of its own (the
# standard Sentinel-2 template ships 20%), and a scene above it is dropped
# *before* rendering: the tile comes back empty, not cloudy. Left implicit, that
# reads as the app hiding cloudy days — a date the calendar offered renders
# black, and the coverage probe calls it a gap. So MAXCC is always sent, and
# what filters a date is our number, not the instance's.
DEFAULT_MAXCC = 100


def wmts_url(
    layer: str = DEFAULT_LAYER,
    start: str | None = None,
    end: str | None = None,
    maxcc: int = DEFAULT_MAXCC,
) -> str:
    """The WMTS GetTile template for one layer and window: ``{key}``/``{z}``/``{x}``/``{y}``.

    ``start``/``end`` (YYYY-MM-DD) become the ``TIME`` mosaicking window, which
    is inclusive of both days. Omitted, no TIME is sent and the layer's own
    default applies — "most recent", the honest default for "just show me it".
    ``maxcc`` is the cloud ceiling in percent; scenes above it are not rendered.
    """
    url = (
        f"{BASE}/wmts/{{key}}"
        "?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
        f"&LAYER={layer}&TILEMATRIXSET=PopularWebMercator512"
        "&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&FORMAT=image/jpeg"
        f"&MAXCC={int(maxcc)}"
    )
    if start and end:
        url += f"&TIME={start}/{end}"
    return url


def variant_id(base_id: str, layer: str | None = None, start: str | None = None,
               end: str | None = None, maxcc: int | None = None) -> str:
    """Pack a layer + window + cloud ceiling into a provider id. Mirror of
    ``parse_variant``.

    The default layer with no window and no ceiling is just the base id: the
    plain basemap must not get a second name, or it would cache twice and read
    as two providers in provenance.
    """
    layer = layer or DEFAULT_LAYER
    ceiling = DEFAULT_MAXCC if maxcc is None else int(maxcc)
    windowed = bool(start and end)
    if layer == DEFAULT_LAYER and not windowed and ceiling == DEFAULT_MAXCC:
        return base_id
    parts = [base_id, layer]
    if windowed:
        parts += [str(start), str(end)]
    if ceiling != DEFAULT_MAXCC:
        parts.append(f"CC{ceiling}")
    return VARIANT_SEP.join(parts)


def parse_variant(spec: str) -> tuple[str, str | None, str | None, int]:
    """``"SWIR~2026-05-01~2026-05-31~CC20"`` → ``("SWIR", "2026-05-01", "2026-05-31", 20)``.

    Raises ValueError on anything that isn't a layer-shaped name, an optional
    pair of ISO dates in order and an optional ``CCnn`` ceiling. This is the
    validation boundary for a string that arrives from a URL path and ends up as
    a directory name, so the *shape* is an allowlist: no separators, no
    traversal, no free-form text, no reversed windows. Membership of LAYERS
    deliberately isn't checked — an instance serves whatever its configuration
    says (capabilities_layers), and a layer the catalogue never heard of is the
    user's to ask for. A wrong one comes back as Sentinel Hub's own 400, which
    says more than we could.
    """
    parts = spec.split(VARIANT_SEP)
    if not 1 <= len(parts) <= 4:
        raise ValueError(f"malformed Sentinel-2 variant '{spec}'")
    layer = parts[0]
    if not _LAYER_RE.match(layer):
        raise ValueError(f"malformed Sentinel-2 layer '{layer}'")
    rest = parts[1:]
    maxcc = DEFAULT_MAXCC
    # a ceiling only ever sits last, and no ISO date can be read as one
    if rest and _MAXCC_RE.match(rest[-1]):
        maxcc = int(rest.pop()[2:])
    if not rest:
        return layer, None, None, maxcc
    if len(rest) != 2:
        raise ValueError(f"malformed Sentinel-2 variant '{spec}'")
    start, end = rest
    for value in (start, end):
        if not _DATE_RE.match(value):
            raise ValueError(f"malformed date '{value}' (expected YYYY-MM-DD)")
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError(f"impossible date '{value}'") from exc
    if start > end:
        raise ValueError(f"window ends before it starts ({start} → {end})")
    return layer, start, end, maxcc


def variant_label(
    layer: str, start: str | None, end: str | None, maxcc: int = DEFAULT_MAXCC
) -> str:
    """How a variant reads to a human: "SWIR · 2026-05-01 → 2026-05-31 · ≤20% cloud"."""
    known = next((entry.label for entry in LAYERS if entry.id == layer), layer)
    if start and end:
        window = start if start == end else f"{start} → {end}"
        label = f"{known} · {window}"
    else:
        label = f"{known} · most recent"
    if maxcc != DEFAULT_MAXCC:
        label += f" · ≤{int(maxcc)}% cloud"
    return label


# -- date discovery (WFS) ------------------------------------------------------

# How wide a box around the point to ask about, in degrees (~1 km): big enough
# that a point near a granule edge still finds the granule, small enough that
# the answer is about *here* and not the next province.
_BBOX_PAD = 0.005
# WFS caps MAXFEATURES at 100, and one date can return several granules, so this
# is "up to 100 granules" rather than "100 dates" — the caller sees how many
# dates that collapsed to.
_MAX_FEATURES = 100

# How many points stand in for a drawn area when measuring how much of it a
# day's granules really cover. Sampling keeps this to the geometry already
# here — a ring and a point-in-ring test — instead of a polygon clipper, and a
# few hundred points land the answer within a percent, which is all a "62% of
# the area" badge can honestly claim anyway.
_AREA_SAMPLES = 600
# Even the smallest area in a set gets this many, so a 2 km² zone beside a
# 2000 km² one can never be reported on by a single point.
_AREA_SAMPLES_MIN = 9

# A metadata hit says a scene intersects the search area. It does not prove the
# configured layer has source pixels at the crosshair. This tiny WMS override
# asks the layer's own data source for dataMask only, over an 80 m square. The
# 8x8 response is enough to answer coverage without paying to render a map tile.
_COVERAGE_HALF_METRES = 40.0
_COVERAGE_SIZE = 8
_COVERAGE_MAX_BYTES = 1_000_000
_COVERAGE_MAX_PIXELS = 4096
_COVERAGE_EVALSCRIPT = base64.b64encode(
    b"""//VERSION=3
function setup() {
  return {
    input: ["dataMask"],
    output: { bands: 1, sampleType: "UINT8" }
  };
}
function evaluatePixel(sample) {
  return [sample.dataMask * 255];
}
"""
).decode("ascii")


class CoverageError(RuntimeError):
    """Sentinel Hub did not return a usable dataMask image."""


# Spectral indices Compare's change reading can ask for. Each is a normalised
# difference of two L2A bands, so it lands in -1…1 whatever the light that day,
# which is what makes two dates comparable where two true-colour renders are not.
# Only these expressions ever reach an evalscript: the request names a key.
INDEX_BANDS: dict[str, tuple[str, str]] = {
    "ndvi": ("B08", "B04"),  # vegetation vigour
    "ndwi": ("B03", "B08"),  # open water
    "nbr": ("B08", "B12"),  # burn scars
    "ndbi": ("B11", "B08"),  # built-up and bare surfaces
}
PRODUCT_MAX_EDGE = 2048
_PRODUCT_MAX_BYTES = 24_000_000
_WEB_MERCATOR_LIMIT = 20_037_508.342789244


def _index_evalscript(index: str) -> str:
    high, low = INDEX_BANDS[index]
    # R carries the index scaled to a byte, G the scene classification (cloud,
    # shadow, snow…), A the data mask. The browser decodes all three.
    script = f"""//VERSION=3
function setup() {{
  return {{
    input: [{{ bands: ["{high}", "{low}", "SCL", "dataMask"] }}],
    output: {{ bands: 4, sampleType: "UINT8" }}
  }};
}}
function evaluatePixel(p) {{
  const sum = p.{high} + p.{low};
  const value = sum === 0 ? 0 : (p.{high} - p.{low}) / sum;
  const clamped = Math.max(-1, Math.min(1, value));
  return [Math.round((clamped + 1) * 127.5), p.SCL, 0, p.dataMask * 255];
}}
"""
    return base64.b64encode(script.encode("ascii")).decode("ascii")


# How much a reflectance is stretched before it is rounded into a byte. A
# detector that thresholds against its own local background needs resolution
# where the signal lives, not a scale that reaches 100% reflectance: open water
# in the near-infrared sits under 3%, so at this gain it spans the bottom fifth
# of the byte instead of two or three values. Anything above 1/gain saturates,
# which costs nothing — these are detections, not measurements.
NIR_GAIN = 8.0
SWIR_GAIN = 4.0
# Band ratios are stretched the same way, and 64 puts the useful 1…4 range
# across the byte.
RATIO_GAIN = 64.0


def _vessel_evalscript() -> str:
    """Bands for finding something floating: infrared, water, and the classes.

    Water absorbs near-infrared almost completely, so a hull, a wake or a rig
    is an outlier against a near-black background — which is why this reads
    B08 rather than the rendered picture, where the stretch has already thrown
    the difference away. NDWI rides along in B so the detector can tell which
    pixels are sea without a second request.
    """
    script = """//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B03", "B08", "SCL", "dataMask"] }],
    output: { bands: 4, sampleType: "UINT8" }
  };
}
function evaluatePixel(p) {
  const sum = p.B03 + p.B08;
  const ndwi = sum === 0 ? 0 : (p.B03 - p.B08) / sum;
  return [
    Math.min(255, Math.round(p.B08 * 255 * %(nir)s)),
    p.SCL,
    Math.round((Math.max(-1, Math.min(1, ndwi)) + 1) * 127.5),
    p.dataMask * 255
  ];
}
""" % {"nir": NIR_GAIN}
    return base64.b64encode(script.encode("ascii")).decode("ascii")


def _fire_evalscript() -> str:
    """Bands for the published Sentinel-2 active-fire test.

    Flame radiates in the short-wave infrared, so B12 rises first and hardest
    and does it through smoke. Absolute brightness alone would call every
    cloud a fire; the two ratios are what separate them, because cloud is
    bright in all three bands at once and sits near a ratio of one.

    No scene classification here: the ratios already reject cloud, and the
    fourth channel is worth more as the data mask.
    """
    script = """//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B08", "B11", "B12", "dataMask"] }],
    output: { bands: 4, sampleType: "UINT8" }
  };
}
function evaluatePixel(p) {
  const over11 = p.B11 <= 0 ? 0 : p.B12 / p.B11;
  const over08 = p.B08 <= 0 ? 0 : p.B12 / p.B08;
  return [
    Math.min(255, Math.round(p.B12 * 255 * %(swir)s)),
    Math.min(255, Math.round(over11 * %(ratio)s)),
    Math.min(255, Math.round(over08 * %(ratio)s)),
    p.dataMask * 255
  ];
}
""" % {"swir": SWIR_GAIN, "ratio": RATIO_GAIN}
    return base64.b64encode(script.encode("ascii")).decode("ascii")


# Everything a caller may ask `band_frame` for. Indices are normalised
# differences the change reading compares between two dates; the other two are
# detector inputs, read from one date.
PRODUCTS: frozenset[str] = frozenset({*INDEX_BANDS, "vessel", "fire"})


def _evalscript(product: str) -> str:
    if product in INDEX_BANDS:
        return _index_evalscript(product)
    return _vessel_evalscript() if product == "vessel" else _fire_evalscript()


def band_frame(
    instance: str,
    bbox: tuple[float, float, float, float],
    width: int,
    height: int,
    day: str,
    product: str,
    maxcc: int = DEFAULT_MAXCC,
    *,
    layer: str = DEFAULT_LAYER,
    get: Callable[..., Any] | None = None,
) -> bytes:
    """One band product over a Web Mercator box, rendered for one day.

    ``layer`` only chooses the data collection the instance reads (its
    evalscript is replaced by ours), so the true-colour layer every standard
    configuration has is the default. The image is validated before it is
    handed on: a PNG, the size asked for, within the byte budget.
    """
    if product not in PRODUCTS:
        raise ValueError(f"unknown band product '{product}'")
    west, south, east, north = bbox
    if not all(abs(value) <= _WEB_MERCATOR_LIMIT for value in bbox):
        raise ValueError("the frame is outside Web Mercator bounds")
    if west >= east or south >= north:
        raise ValueError("the frame is empty")
    if not (1 <= width <= PRODUCT_MAX_EDGE and 1 <= height <= PRODUCT_MAX_EDGE):
        raise ValueError(f"the frame must be 1 to {PRODUCT_MAX_EDGE} px on each side")
    checked_layer, checked_day, _, checked_maxcc = parse_variant(
        f"{layer}{VARIANT_SEP}{day}{VARIANT_SEP}{day}{VARIANT_SEP}CC{int(maxcc)}"
    )
    params = {
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "VERSION": "1.3.0",
        "LAYERS": checked_layer,
        "CRS": "EPSG:3857",
        "BBOX": f"{west},{south},{east},{north}",
        "WIDTH": str(width),
        "HEIGHT": str(height),
        "FORMAT": "image/png",
        "TIME": f"{checked_day}/{checked_day}",
        "MAXCC": str(checked_maxcc),
        "EVALSCRIPT": _evalscript(product),
    }
    fetch = get or httpx.get
    response = fetch(
        f"{BASE}/wms/{instance}", params=params,
        headers={"User-Agent": USER_AGENT}, timeout=45,
    )
    response.raise_for_status()
    body = response.content
    if len(body) > _PRODUCT_MAX_BYTES:
        raise CoverageError("the index frame is too large")
    try:
        with Image.open(io.BytesIO(body)) as frame:
            if frame.format != "PNG" or frame.size != (width, height):
                raise CoverageError("Sentinel Hub returned an unexpected index frame")
    except (OSError, UnidentifiedImageError) as exc:
        raise CoverageError("Sentinel Hub returned no readable index frame") from exc
    return body


def _cloud(props: dict[str, Any]) -> float | None:
    for name in ("cloudCoverPercentage", "tileCloudCoverPercentage"):
        value = props.get(name)
        if isinstance(value, (int, float)):
            return round(float(value), 1)
    return None


def _rings(geometry: dict[str, Any] | None) -> list[list[list[float]]]:
    """Outer rings of a (Multi)Polygon, or [] for anything else."""
    if not isinstance(geometry, dict):
        return []
    kind, coords = geometry.get("type"), geometry.get("coordinates")
    if not isinstance(coords, list):
        return []
    try:
        if kind == "Polygon":
            return [coords[0]]
        if kind == "MultiPolygon":
            return [polygon[0] for polygon in coords]
    except (IndexError, TypeError):
        return []
    return []


def _in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    """Ray casting: is (x, y) inside this ring?"""
    inside = False
    count = len(ring)
    for i in range(count):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % count][0], ring[(i + 1) % count][1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            inside = not inside
    return inside


Box = tuple[float, float, float, float]
Ring = list[Any]


def _ring_box(ring: Ring) -> Box:
    """A ring's bounds as ``(left, bottom, right, top)`` in its own axis order."""
    xs = [point[0] for point in ring]
    ys = [point[1] for point in ring]
    return min(xs), min(ys), max(xs), max(ys)


def _boxes_meet(one: Box, other: Box) -> bool:
    return not (one[2] < other[0] or one[0] > other[2] or one[3] < other[1] or one[1] > other[3])


def _oriented(ring: Ring, box: Box) -> Ring:
    """A granule ring as (lon, lat), whichever axis order the service answered in.

    GeoJSON says longitude first, but an OGC service asked for EPSG:4326 may
    honour the CRS's latitude-first order instead, and read backwards every
    footprint on Earth misses. So the reading that lands near the area asked
    about wins; when neither does, the standard one stays and the ring simply
    covers nothing — which is the right answer for a granule a province away.
    """
    if _boxes_meet(_ring_box(ring), box):
        return ring
    swapped = [(point[1], point[0]) for point in ring]
    return swapped if _boxes_meet(_ring_box(swapped), box) else ring


def _covered(feature: dict[str, Any], samples: list[tuple[float, float]], box: Box) -> set[int]:
    """Which of ``samples`` this granule's footprint actually contains.

    Why it matters: a granule's *bounding box* is a square, but its data is the
    slice of orbit swath inside it — the rest is nodata. WFS answers on the box,
    so a day can be listed while the pixels over the area are black. Pinned to
    that day the map has nothing to show and goes dark, which is the "why is
    this date black?" a date list exists to prevent.

    Unparseable geometry counts as covering everything — never drop a real pass
    over a guess.
    """
    rings = _rings(feature.get("geometry"))
    if not rings:
        return set(range(len(samples)))
    hit: set[int] = set()
    for ring in rings:
        oriented = _oriented(ring, box)
        left, bottom, right, top = _ring_box(oriented)
        for position, (x, y) in enumerate(samples):
            if position in hit or not (left <= x <= right and bottom <= y <= top):
                continue
            if _in_ring(x, y, oriented):
                hit.add(position)
    return hit


def _window(start: str, end: str) -> str:
    """The ``TIME`` window, checked before it becomes a request parameter.

    Shape *and* calendar: ``2026-13-01`` is the right shape and not a day, and
    unchecked it would leave as a request and come back as a gateway error
    rather than the plain "that is not a date" it is.
    """
    for value in (start, end):
        if not _DATE_RE.match(value or ""):
            raise ValueError(f"malformed date '{value}' (expected YYYY-MM-DD)")
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError(f"impossible date '{value}'") from exc
    if start > end:
        raise ValueError(f"window ends before it starts ({start} → {end})")
    return f"{start}/{end}"


def _passes(
    instance: str,
    box: Box,
    samples: list[tuple[float, float]],
    start: str,
    end: str,
    *,
    get: Callable[..., Any] | None = None,
) -> tuple[dict[str, dict[str, Any]], int]:
    """One WFS query, collapsed to per-day entries and the samples each covers.

    A WFS query is billed as one request (~0.01 PU, versus a tile's 1 PU), so
    the caller counts it on the meter — cheap, but not free, and the meter never
    lies by omission.

    Raises httpx.HTTPError / ValueError upward: a date list that failed must not
    read as "no imagery here".
    """
    fetch = get or httpx.get
    left, bottom, right, top = box
    params = {
        "SERVICE": "WFS",
        "REQUEST": "GetFeature",
        "VERSION": "2.0.0",
        "TYPENAMES": WFS_TYPENAME,
        "OUTPUTFORMAT": "application/json",
        # EPSG:4326 puts latitude first — the axis order the CRS declares, not
        # the lon/lat habit. Swapped, the box lands in the ocean off Somalia.
        "SRSNAME": "EPSG:4326",
        "BBOX": f"{bottom},{left},{top},{right}",
        "TIME": _window(start, end),
        "MAXFEATURES": str(_MAX_FEATURES),
        # every pass, cloudy ones included: the calendar shows cover per day and
        # the user's own ceiling decides what to grey out. A list already cut by
        # the instance's filter would hide passes we never said we hid.
        "MAXCC": str(DEFAULT_MAXCC),
    }
    response = fetch(
        f"{BASE}/wfs/{instance}", params=params,
        headers={"User-Agent": USER_AGENT}, timeout=15,
    )
    response.raise_for_status()
    features = (response.json() or {}).get("features") or []

    by_date: dict[str, dict[str, Any]] = {}
    for feature in features:
        props = feature.get("properties") or {}
        day = str(props.get("date") or "")[:10]
        if not _DATE_RE.match(day):
            continue
        # the granule's box may reach the area while its imagery doesn't
        hit = _covered(feature, samples, box)
        if not hit:
            continue
        cloud = _cloud(props)
        entry = by_date.setdefault(
            day, {"date": day, "cloud": cloud, "granules": 0, "covered": set()}
        )
        entry["granules"] += 1
        entry["covered"] |= hit
        # the granule that actually covers the area may be the clearer of two
        if cloud is not None and (entry["cloud"] is None or cloud < entry["cloud"]):
            entry["cloud"] = cloud
    return by_date, len(features)


def dates(
    instance: str,
    lat: float,
    lon: float,
    start: str,
    end: str,
    *,
    get: Callable[..., Any] | None = None,
) -> list[dict[str, Any]]:
    """Sentinel-2 acquisition dates over a point, newest first.

    Each entry: ``{"date", "cloud", "granules"}`` — ``cloud`` is the least
    cloudy granule covering the point that day (None when the service didn't
    say), ``granules`` how many covered it.

    This is what makes a date picker honest: without it the user guesses a date,
    pays a tile, and finds out it was cloud or a gap. For a drawn area rather
    than a crosshair, ``acquisitions`` answers the same question with a coverage
    share attached.
    """
    box = (lon - _BBOX_PAD, lat - _BBOX_PAD, lon + _BBOX_PAD, lat + _BBOX_PAD)
    found, _ = _passes(instance, box, [(lon, lat)], start, end, get=get)
    return sorted(
        ({"date": e["date"], "cloud": e["cloud"], "granules": e["granules"]}
         for e in found.values()),
        key=lambda entry: entry["date"], reverse=True,
    )


def _shoelace(ring: Ring) -> float:
    """A ring's area in square degrees, narrowed for the latitude it sits at.

    Only ever compared against other rings in the same set, so a flat local
    approximation is enough — this decides how to share sample points out, not
    what to report.
    """
    middle = sum(point[1] for point in ring) / len(ring)
    scale = math.cos(math.radians(max(-89.0, min(89.0, middle))))
    total = 0.0
    for index, (x1, y1) in enumerate(ring):
        x2, y2 = ring[(index + 1) % len(ring)]
        total += (x1 * scale) * y2 - (x2 * scale) * y1
    return abs(total) / 2


def _ring_samples(ring: Ring, want: int) -> list[tuple[float, float]]:
    """``want``-ish points spread evenly over a ring's interior."""
    left, bottom, right, top = _ring_box(ring)
    # a ring fills roughly π/4 of its own box, so a grid that size lands near
    # the count asked for once the outside points are dropped
    side = max(3, math.ceil(math.sqrt(want * 4 / math.pi)))
    found = []
    for row in range(side):
        y = bottom + (row + 0.5) * (top - bottom) / side
        for column in range(side):
            x = left + (column + 0.5) * (right - left) / side
            if _in_ring(x, y, ring):
                found.append((x, y))
    # a ring too thin for the grid to land in still stands for somewhere
    return found or [((left + right) / 2, (bottom + top) / 2)]


def _area_samples(rings: list[Ring]) -> list[tuple[float, float]]:
    """Points standing in for the drawn areas, at one density across all of them."""
    weights = [_shoelace(ring) for ring in rings]
    total = sum(weights) or 1.0
    samples: list[tuple[float, float]] = []
    for ring, weight in zip(rings, weights):
        samples.extend(_ring_samples(ring, max(_AREA_SAMPLES_MIN, round(_AREA_SAMPLES * weight / total))))
    return samples


def acquisitions(
    instance: str,
    rings: list[Ring],
    start: str,
    end: str,
    *,
    get: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Sentinel-2 acquisitions over drawn areas, newest first.

    Each entry adds ``coverage`` to what ``dates`` reports: the share of the
    areas that day's granules actually reach, 0…1. It is the number a point
    lookup cannot give and an area sweep cannot do without — Sentinel-2 flies
    290 km-wide swaths, so an area wider than one of them has *no* single day
    that covers it, and pinned to one date half the sweep reads nodata.

    ``truncated`` says the WFS hit its feature ceiling, so older passes in the
    window are missing and the window wants narrowing.
    """
    if not rings:
        raise ValueError("no area to look up")
    samples = _area_samples(rings)
    boxes = [_ring_box(ring) for ring in rings]
    box = (
        max(-180.0, min(b[0] for b in boxes) - _BBOX_PAD),
        max(-90.0, min(b[1] for b in boxes) - _BBOX_PAD),
        min(180.0, max(b[2] for b in boxes) + _BBOX_PAD),
        min(90.0, max(b[3] for b in boxes) + _BBOX_PAD),
    )
    found, features = _passes(instance, box, samples, start, end, get=get)
    listed = sorted(
        ({"date": entry["date"], "cloud": entry["cloud"], "granules": entry["granules"],
          "coverage": round(len(entry["covered"]) / len(samples), 3)}
         for entry in found.values()),
        key=lambda entry: entry["date"], reverse=True,
    )
    return {"dates": listed, "truncated": features >= _MAX_FEATURES}


def coverage(
    instance: str,
    lat: float,
    lon: float,
    layer: str,
    day: str,
    maxcc: int = DEFAULT_MAXCC,
    *,
    get: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Check whether ``layer`` has source pixels near a point on ``day``.

    WFS supplies candidate acquisition dates. This WMS dataMask probe is the
    final authority before the UI replaces a working map with a dated layer.
    It uses the configured layer, so a custom layer is checked against its own
    collection rather than the date catalogue's L2A assumption, and the same
    cloud ceiling the tiles will carry — the probe has to be answering the
    question the map is about to ask.
    """
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("coordinates are outside WGS84 bounds")
    # Reuse the variant parser as the validation boundary for all three values.
    checked_layer, checked_day, _, checked_maxcc = parse_variant(
        f"{layer}{VARIANT_SEP}{day}{VARIANT_SEP}{day}{VARIANT_SEP}CC{int(maxcc)}"
    )

    earth_radius = 6_378_137.0
    clamped_lat = min(max(lat, -85.05112878), 85.05112878)
    x = earth_radius * math.radians(lon)
    y = earth_radius * math.log(math.tan(math.pi / 4 + math.radians(clamped_lat) / 2))
    half = _COVERAGE_HALF_METRES
    params = {
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "VERSION": "1.3.0",
        "LAYERS": checked_layer,
        "CRS": "EPSG:3857",
        "BBOX": f"{x - half},{y - half},{x + half},{y + half}",
        "WIDTH": str(_COVERAGE_SIZE),
        "HEIGHT": str(_COVERAGE_SIZE),
        "FORMAT": "image/png",
        "TIME": f"{checked_day}/{checked_day}",
        "MAXCC": str(checked_maxcc),
        "EVALSCRIPT": _COVERAGE_EVALSCRIPT,
    }
    fetch = get or httpx.get
    response = fetch(
        f"{BASE}/wms/{instance}", params=params,
        headers={"User-Agent": USER_AGENT}, timeout=15,
    )
    response.raise_for_status()
    if len(response.content) > _COVERAGE_MAX_BYTES:
        raise CoverageError("coverage probe returned an oversized image")
    try:
        with Image.open(io.BytesIO(response.content)) as source:
            if source.width * source.height > _COVERAGE_MAX_PIXELS:
                raise CoverageError("coverage probe returned an oversized image")
            values = source.convert("L").tobytes()
    except (OSError, UnidentifiedImageError) as exc:
        raise CoverageError("coverage probe returned no readable image") from exc
    if not values:
        raise CoverageError("coverage probe returned an empty image")
    valid = sum(value > 0 for value in values)
    return {
        "available": valid > 0,
        "coverage": round(valid / len(values), 3),
        "date": checked_day,
        "layer": checked_layer,
        "maxcc": checked_maxcc,
    }


# -- layer discovery (GetCapabilities) -----------------------------------------

_WMTS_NS = {"ows": "http://www.opengis.net/ows/1.1", "wmts": "http://www.opengis.net/wmts/1.0"}


def capabilities_layers(
    instance: str, *, get: Callable[..., Any] | None = None
) -> list[dict[str, str]]:
    """The layers this instance actually serves, asked of the instance itself.

    LAYERS above is only the reliable core; a user's configuration can add,
    rename or drop any of it, and only the instance knows. Entries we recognise
    keep their hint, the rest come back with an empty one — an unknown layer is
    still offerable, we just have nothing useful to say about it.

    Raises upward on failure: the caller falls back to the catalogue.
    """
    fetch = get or httpx.get
    response = fetch(
        f"{BASE}/wmts/{instance}",
        params={"SERVICE": "WMTS", "REQUEST": "GetCapabilities", "VERSION": "1.0.0"},
        headers={"User-Agent": USER_AGENT},
        timeout=15,
    )
    response.raise_for_status()
    root = ET.fromstring(response.text)
    known = {entry.id: entry for entry in LAYERS}

    found: list[dict[str, str]] = []
    for node in root.iterfind(".//wmts:Contents/wmts:Layer", _WMTS_NS):
        identifier = (node.findtext("ows:Identifier", default="", namespaces=_WMTS_NS) or "").strip()
        if not identifier or not _LAYER_RE.match(identifier):
            continue  # unrenderable as a variant id — never offer what can't be asked for
        title = (node.findtext("ows:Title", default="", namespaces=_WMTS_NS) or "").strip()
        entry = known.get(identifier)
        found.append(
            {
                "id": identifier,
                "label": entry.label if entry else (title or identifier),
                "hint": entry.hint if entry else KNOWN_HINTS.get(identifier, ""),
            }
        )
    return found
