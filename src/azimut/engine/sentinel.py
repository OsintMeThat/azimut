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
from datetime import date, datetime, timedelta
from typing import Any, Callable
from urllib.parse import quote

import httpx
from PIL import Image, UnidentifiedImageError

BASE = "https://sh.dataspace.copernicus.eu/ogc"
USER_AGENT = "Azimut/0.1 (+local OSINT workbench; single-user)"

# Sentinel-2 L2A in Sentinel Hub's WFS type vocabulary (DSS1 = L1C, DSS3 = S1).
# The basemap renders L2A, so date discovery must ask about L2A: L1C passes the
# same orbit but a date list from the wrong collection would be a plausible lie.
WFS_TYPENAME = "DSS2"
# Sentinel-1 GRD, which Detect's radar methods read. An instance only answers
# for the collections its own layers use, so this type exists once the user has
# added a Sentinel-1 layer to the configuration (docs/IMAGERY_PROVIDERS.md).
S1_TYPENAME = "DSS3"
COLLECTIONS = {"sentinel2": WFS_TYPENAME, "sentinel1": S1_TYPENAME}


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


PRODUCT_MAX_EDGE = 2048
_PRODUCT_MAX_BYTES = 24_000_000
_WEB_MERCATOR_LIMIT = 20_037_508.342789244


# Detect's band products. Each one is what a single detector measures, rounded
# into the four bytes of a PNG so one metered request carries all of it.
#
# The first channel is never zero where the sensor saw something, which is how
# the engine tells a dark reading from no reading. The fourth carries
# Sentinel-2's own view of the sky: the scene class in the low four bits, and a
# flag for pixels dark enough in the near-infrared to be in a cloud's shadow.
# The engine turns those into a mask, with the sun's direction for the shadows
# the classification misses (engine/analyzers.py).
#
# Reflectance is stretched by a gain before rounding. Sea under sun glint sits
# near 9% in the near-infrared, so a gain that spends the byte on the bottom few
# percent saturates hulls and wave crests alike; at 2 the byte spans 0-50% in
# steps of 0.2%, which still resolves calm water and leaves a hull its contrast.
# Short-wave infrared over desert reaches 50%, so the change product gives it
# a little more room.
BAND_GAIN = 2.0
SWIR_GAIN = 1.6
# Band ratios are stretched the same way, and 64 puts the useful 1-4 range
# across the byte.
RATIO_GAIN = 64.0
DARK_FLAG = 16
DARK_REFLECTANCE = 0.15

# The spectral indices both modes read, as sums of bands over sums of bands so
# the bare soil index fits beside the normalised differences. Each lands in -1…1
# whatever the light that day, which is what makes two dates comparable where
# two true-colour renders are not. Only these expressions reach an evalscript:
# a request names a key.
SPECTRAL_INDEX: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "ndvi": (("B08",), ("B04",)),          # green vegetation
    "ndwi": (("B03",), ("B08",)),          # open water
    "mndwi": (("B03",), ("B11",)),         # open water, fewer false hits on built-up land
    "nbr": (("B08",), ("B12",)),           # burn scars
    "ndbi": (("B11",), ("B08",)),          # built-up surfaces
    "bsi": (("B11", "B04"), ("B08", "B02")),  # bare soil
}


def _byte(expression: str, gain: float, floor: int = 0) -> str:
    return f"Math.max({floor}, Math.min(255, Math.round(({expression}) * {255 * gain:g})))"


def _detect_script(bands: list[str], values: list[str], dark: str = "B08") -> str:
    wanted = list(dict.fromkeys([*bands, dark, "SCL", "dataMask"]))
    listed = ", ".join(f'"{band}"' for band in wanted)
    script = f"""//VERSION=3
function setup() {{
  return {{ input: [{{ bands: [{listed}] }}], output: {{ bands: 4, sampleType: "UINT8" }} }};
}}
function evaluatePixel(p) {{
  if (!p.dataMask) return [0, 0, 0, 0];
  return [{", ".join(values)}, p.SCL + (p.{dark} < {DARK_REFLECTANCE} ? {DARK_FLAG} : 0)];
}}
"""
    return base64.b64encode(script.encode("ascii")).decode("ascii")


def _ratio(high: str, low: str) -> str:
    return f"Math.min(255, Math.round((p.{low} <= 0 ? 0 : p.{high} / p.{low}) * {RATIO_GAIN:g}))"


def _detect_evalscript(product: str) -> str:
    if product == "vessel":
        # Water absorbs near-infrared, so a hull is an outlier against a dark
        # sea; short-wave infrared is what tells it from a breaking wave, which
        # is bright in the one and not the other. NDWI says which pixels are sea.
        ndwi = "(p.B03 + p.B08 === 0 ? 0 : (p.B03 - p.B08) / (p.B03 + p.B08))"
        return _detect_script(["B03", "B08", "B11"], [
            _byte("p.B08", BAND_GAIN, 1), _byte("p.B11", BAND_GAIN),
            f"Math.round((Math.max(-1, Math.min(1, {ndwi})) + 1) * 127.5)",
        ])
    if product == "fire":
        # The published active-fire test: B12 high in absolute terms and against
        # both B11 and B8A. B8A rather than B08 because it shares B12's 20 m
        # grid, so a sharp roof edge cannot fake a ratio.
        return _detect_script(["B8A", "B11", "B12"], [
            _byte("p.B12", BAND_GAIN, 1), _ratio("B12", "B11"), _ratio("B12", "B8A"),
        ], dark="B8A")
    if product == "surface":
        # Red, near and short-wave infrared: enough to see soil, vegetation and
        # water move, and to tell a field that greened from ground that was dug.
        return _detect_script(["B04", "B08", "B11"], [
            _byte("p.B04", BAND_GAIN, 1), _byte("p.B08", BAND_GAIN), _byte("p.B11", SWIR_GAIN),
        ])
    high, low = SPECTRAL_INDEX[product.removeprefix("index-")]
    return _detect_script([*high, *low], [
        f"Math.max(1, Math.round((Math.max(-1, Math.min(1, {_index(high, low)})) + 1) * 127.5))", "0", "0",
    ])


def _index(high: tuple[str, ...], low: tuple[str, ...]) -> str:
    top = " + ".join(f"p.{band}" for band in high)
    bottom = " + ".join(f"p.{band}" for band in low)
    return f"(({top}) + ({bottom}) === 0 ? 0 : (({top}) - ({bottom})) / (({top}) + ({bottom})))"


def _change_evalscript(product: str) -> str:
    # Difference mode draws its frames into a canvas and decodes them there
    # (lib/map/changeDetect.js). A canvas premultiplies alpha, so alpha stays
    # the data mask and the sky byte rides in green: the same byte Detect's
    # products carry fourth, so the two modes read one sky. `change-sky` is that
    # byte alone, for a cloud filter over the picture methods.
    name = product.removeprefix("change-")
    if name == "sky":
        bands: list[str] = []
        value = "0"
    else:
        high, low = SPECTRAL_INDEX[name]
        bands = [*high, *low]
        value = f"Math.round((Math.max(-1, Math.min(1, {_index(high, low)})) + 1) * 127.5)"
    wanted = list(dict.fromkeys([*bands, "B08", "SCL", "dataMask"]))
    listed = ", ".join(f'"{band}"' for band in wanted)
    script = f"""//VERSION=3
function setup() {{
  return {{ input: [{{ bands: [{listed}] }}], output: {{ bands: 4, sampleType: "UINT8" }} }};
}}
function evaluatePixel(p) {{
  if (!p.dataMask) return [0, 0, 0, 0];
  return [{value}, p.SCL + (p.B08 < {DARK_REFLECTANCE} ? {DARK_FLAG} : 0), 0, 255];
}}
"""
    return base64.b64encode(script.encode("ascii")).decode("ascii")


# Sentinel-1 backscatter, as Detect's radar methods measure it. The layer the
# user added decides the processing (orthorectification, backscatter
# coefficient); ours only decides how the power is rounded into bytes.
#
# Power is carried in decibels, a fifth of one per step from -35 dB: calm sea
# sits near -25 dB in VV and -32 dB in VH, a ship or a roof above 0 dB, and a
# byte that spans -35 to +16 dB keeps both ends. As with the optical products
# the first channel is never zero where the radar saw something.
SAR_DB_FLOOR = -35.0
SAR_DB_STEP = 0.2
# The review picture is the usual dual-polarisation composite: co-pol red,
# cross-pol green, their difference blue. Water goes dark blue, vegetation
# grey-green, built-up land and hulls white.
_SAR_COMPOSITE = ((-22.0, 2.0), (-30.0, -6.0), (0.0, 15.0))


def _sar_script(values: str) -> str:
    script = f"""//VERSION=3
function setup() {{
  return {{ input: [{{ bands: ["VV", "VH", "dataMask"] }}], output: {{ bands: 4, sampleType: "UINT8" }} }};
}}
function db(v) {{ return v > 0 ? 10 * Math.log(v) / Math.LN10 : -99; }}
function level(v) {{ return Math.max(1, Math.min(255, Math.round((db(v) - ({SAR_DB_FLOOR:g})) / {SAR_DB_STEP:g}))); }}
function stretch(v, low, high) {{ return Math.max(0, Math.min(255, Math.round((v - low) / (high - low) * 255))); }}
function evaluatePixel(p) {{
  if (!p.dataMask) return [0, 0, 0, 0];
  return {values};
}}
"""
    return base64.b64encode(script.encode("ascii")).decode("ascii")


def _sar_evalscript(product: str) -> str:
    if product == "sar":
        return _sar_script("[level(p.VV), level(p.VH), 0, 255]")
    (r_low, r_high), (g_low, g_high), (b_low, b_high) = _SAR_COMPOSITE
    return _sar_script(
        f"[stretch(db(p.VV), {r_low:g}, {r_high:g}), stretch(db(p.VH), {g_low:g}, {g_high:g}), "
        f"stretch(db(p.VV) - db(p.VH), {b_low:g}, {b_high:g}), 255]"
    )


# Where the water is, for the radar vessel method: Sentinel-2's own scene
# classification, one byte a pixel, read from the clearest pass of the year
# before (`band_frame` sets that window). Cloud, shadow, snow and defective
# pixels say nothing either way, and the radar decides there.
WATER_LAND, WATER_WATER, WATER_UNKNOWN = 1, 2, 3
WATER_LOOKBACK_DAYS = 365
_WATER_SCRIPT = base64.b64encode(
    f"""//VERSION=3
function setup() {{
  return {{ input: [{{ bands: ["SCL", "dataMask"] }}], output: {{ bands: 4, sampleType: "UINT8" }} }};
}}
function evaluatePixel(p) {{
  if (!p.dataMask) return [0, 0, 0, 0];
  if (p.SCL === 6) return [{WATER_WATER}, 0, 0, 255];
  if ([0, 1, 3, 8, 9, 10, 11].indexOf(p.SCL) >= 0) return [{WATER_UNKNOWN}, 0, 0, 255];
  return [{WATER_LAND}, 0, 0, 255];
}}
""".encode("ascii")
).decode("ascii")


# Everything a caller may ask `band_frame` for: Detect's products, measured on
# the server, and Difference's frames, decoded in the browser.
DETECT_PRODUCTS: frozenset[str] = frozenset(
    {"vessel", "fire", "surface", *(f"index-{name}" for name in SPECTRAL_INDEX)}
)
CHANGE_PRODUCTS: frozenset[str] = frozenset(
    {"change-sky", *(f"change-{name}" for name in SPECTRAL_INDEX)}
)
# Radar: the measured product, and the picture a candidate is reviewed on,
# which for Sentinel-1 is rendered by us rather than by a layer's own style.
SAR_PRODUCTS: frozenset[str] = frozenset({"sar", "sar-picture"})
PRODUCTS: frozenset[str] = frozenset({*CHANGE_PRODUCTS, *DETECT_PRODUCTS, *SAR_PRODUCTS, "water"})


def _evalscript(product: str) -> str:
    if product == "water":
        return _WATER_SCRIPT
    if product in CHANGE_PRODUCTS:
        return _change_evalscript(product)
    if product in SAR_PRODUCTS:
        return _sar_evalscript(product)
    return _detect_evalscript(product)


# -- the Sentinel-1 basemap -------------------------------------------------------

RADAR_ID = "sentinel1"
_PASS_TIME_RE = re.compile(r"^([01]\d|2[0-3])([0-5]\d)([0-5]\d)$")


def radar_variant_id(day: str | None = None, time: str = "") -> str:
    """The radar basemap's id for one pass: ``sentinel1~2026-05-14~054210``.

    A day alone mosaics every pass of that day, and no day at all is the most
    recent pass, which is the layer's own default. The time rides without its
    colons, because the id is also a folder name in the tile cache.
    """
    if not day:
        return RADAR_ID
    parts = [RADAR_ID, day]
    if time:
        parts.append(time.replace(":", ""))
    return VARIANT_SEP.join(parts)


def parse_radar_variant(spec: str) -> tuple[str, str]:
    """``"2026-05-14~054210"`` → ``("2026-05-14", "05:42:10")``; the time may be absent."""
    parts = spec.split(VARIANT_SEP)
    if not 1 <= len(parts) <= 2:
        raise ValueError(f"malformed Sentinel-1 variant '{spec}'")
    day = parts[0]
    _window(day, day)
    if len(parts) == 1:
        return day, ""
    found = _PASS_TIME_RE.match(parts[1])
    if not found:
        raise ValueError(f"malformed pass time '{parts[1]}' (expected HHMMSS)")
    return day, ":".join(found.groups())


def radar_wmts_url(layer: str, day: str = "", time: str = "") -> str:
    """The WMTS GetTile template for the radar basemap, drawn in our composite.

    The layer is the user's Sentinel-1 layer; its own style is replaced by the
    picture Detect reviews radar candidates on, so the map and the evidence
    read alike. JPEG like the optical basemap: speckle costs PNG a fortune.
    """
    if not _LAYER_RE.match(layer or ""):
        raise ValueError(f"malformed layer '{layer}'")
    url = (
        f"{BASE}/wmts/{{key}}"
        "?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
        f"&LAYER={layer}&TILEMATRIXSET=PopularWebMercator512"
        "&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&FORMAT=image/jpeg"
        f"&EVALSCRIPT={quote(_sar_evalscript('sar-picture'), safe='')}"
    )
    if day:
        url += f"&TIME={pass_window(day, time)}"
    return url


def radar_label(day: str, time: str) -> str:
    """How a radar variant reads: "2026-05-14 05:42 UTC", a day, or the latest."""
    if not day:
        return "most recent pass"
    return f"{day} {time[:5]} UTC" if time else day


def sar_decibels(level: Any) -> Any:
    """The byte a radar product carries, back in decibels."""
    return level * SAR_DB_STEP + SAR_DB_FLOOR


# How far either side of a Sentinel-1 pass the request window reaches. A pass
# crosses an area in seconds; the other direction comes twelve hours later and
# the next orbit a hundred minutes later over ground 2,700 km away, so twenty
# minutes holds one pass and nothing else.
PASS_WINDOW_MINUTES = 20
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$")


def pass_window(day: str, time: str = "") -> str:
    """The ``TIME`` value for one pass: a day, or minutes around a known time.

    A day is enough for Sentinel-2, which passes once. Sentinel-1 can pass the
    same day twice, morning and evening in opposite directions, and a window of
    the whole day would mosaic the two looks into one frame.
    """
    if not time:
        return _window(day, day)
    if not _TIME_RE.match(time):
        raise ValueError(f"malformed pass time '{time}' (expected HH:MM:SS)")
    _window(day, day)
    moment = datetime.fromisoformat(f"{day}T{time}+00:00")
    reach = timedelta(minutes=PASS_WINDOW_MINUTES)
    stamp = "%Y-%m-%dT%H:%M:%SZ"
    return f"{(moment - reach).strftime(stamp)}/{(moment + reach).strftime(stamp)}"


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
    time: str = "",
    get: Callable[..., Any] | None = None,
) -> bytes:
    """One band product over a Web Mercator box, rendered for one day.

    ``layer`` only chooses the data collection the instance reads (its
    evalscript is replaced by ours), so the true-colour layer every standard
    configuration has is the default, and a radar product names the user's
    Sentinel-1 layer. ``time`` narrows the day to one pass (``pass_window``).
    The image is validated before it is handed on: a PNG, the size asked for,
    within the byte budget.
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
        "TIME": pass_window(str(checked_day), time),
        "MAXCC": str(checked_maxcc),
        "EVALSCRIPT": _evalscript(product),
    }
    if product == "water":
        # The year before the day, the least cloudy pass first wherever it has
        # pixels: where the shore is does not change with the weather.
        start = date.fromisoformat(str(checked_day)) - timedelta(days=WATER_LOOKBACK_DAYS)
        params.update(TIME=f"{start.isoformat()}/{checked_day}", PRIORITY="leastCC")
    fetch = get or httpx.get
    response = fetch(
        f"{BASE}/wms/{instance}", params=params,
        headers={"User-Agent": USER_AGENT}, timeout=45,
    )
    response.raise_for_status()
    body = response.content
    if len(body) > _PRODUCT_MAX_BYTES:
        raise CoverageError("the band frame is too large")
    try:
        with Image.open(io.BytesIO(body)) as frame:
            if frame.format != "PNG" or frame.size != (width, height):
                raise CoverageError("Sentinel Hub returned an unexpected band frame")
    except (OSError, UnidentifiedImageError) as exc:
        raise CoverageError("Sentinel Hub returned no readable band frame") from exc
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


# A product name carries its sensing start: ``S1A_IW_GRDH_1SDV_20260105T051824_…``.
_SENSED_RE = re.compile(r"_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})_")
# Two looks at one place are the same track when they pass at the same time of
# day. A track repeats to the second every twelve days, whichever Sentinel-1
# flies it, while the neighbouring track that also sees the place passes about
# eight minutes earlier or later, so four minutes tells them apart.
SAME_TRACK_MINUTES = 4


def _sensed(props: dict[str, Any]) -> str:
    """The pass's UTC time of day, ``HH:MM:SS``, or '' when nothing says."""
    value = str(props.get("time") or "")[:8]
    if _TIME_RE.match(value):
        return value
    for name in ("id", "path"):
        found = _SENSED_RE.search(str(props.get(name) or ""))
        if found:
            hour, minute, second = found.groups()[3:]
            candidate = f"{hour}:{minute}:{second}"
            if _TIME_RE.match(candidate):
                return candidate
    return ""


def _minutes(time: str) -> int:
    hour, minute, second = (int(part) for part in time.split(":"))
    return hour * 60 + minute + (1 if second >= 30 else 0)


def same_track(one: str, other: str) -> bool:
    """Whether two pass times are one track: the same look, so comparable."""
    if not (_TIME_RE.match(one or "") and _TIME_RE.match(other or "")):
        return False
    gap = abs(_minutes(one) - _minutes(other)) % 1440
    return min(gap, 1440 - gap) <= SAME_TRACK_MINUTES


def orbit_direction(time: str, lon: float) -> str:
    """Which way Sentinel-1 was flying: descending at dawn, ascending at dusk.

    Its orbit keeps the sun where it is, crossing every latitude near 06:00
    local solar time southbound and 18:00 northbound, so the local hour of the
    pass is enough to say which way it went.
    """
    if not _TIME_RE.match(time or ""):
        return ""
    local = (_minutes(time) / 60 + lon / 15) % 24
    return "descending" if local < 12 else "ascending"


def _pass_key(entries: dict[str, dict[str, Any]], day: str, time: str) -> str:
    """The entry a granule belongs to: its day, and for radar its pass.

    Slices of one pass are sensed seconds apart; a second pass the same day is
    the other direction, hours away, and a separate image.
    """
    if not time:
        return day
    for key, entry in entries.items():
        if entry["date"] == day and same_track(entry["time"], time):
            return key
    return f"{day}T{time}"


def _passes(
    instance: str,
    box: Box,
    samples: list[tuple[float, float]],
    start: str,
    end: str,
    *,
    collection: str = "sentinel2",
    get: Callable[..., Any] | None = None,
) -> tuple[dict[str, dict[str, Any]], int]:
    """One WFS query, collapsed to per-pass entries and the samples each covers.

    A Sentinel-2 entry is a day. A Sentinel-1 entry is one pass, so a morning
    and an evening look on the same day stay two, and each carries its time.

    A WFS query is billed as one request (~0.01 PU, versus a tile's 1 PU), so
    the caller counts it on the meter — cheap, but not free, and the meter never
    lies by omission.

    Raises httpx.HTTPError / ValueError upward: a date list that failed must not
    read as "no imagery here".
    """
    if collection not in COLLECTIONS:
        raise ValueError(f"unknown collection '{collection}'")
    radar = collection == "sentinel1"
    fetch = get or httpx.get
    left, bottom, right, top = box
    params = {
        "SERVICE": "WFS",
        "REQUEST": "GetFeature",
        "VERSION": "2.0.0",
        "TYPENAMES": COLLECTIONS[collection],
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
    if response.status_code == 400 and radar and "not found" in response.text.lower():
        raise ValueError(
            "this Copernicus instance has no Sentinel-1 layer; add one in its configuration"
        )
    response.raise_for_status()
    features = (response.json() or {}).get("features") or []

    by_pass: dict[str, dict[str, Any]] = {}
    for feature in features:
        props = feature.get("properties") or {}
        day = str(props.get("date") or "")[:10]
        if not _DATE_RE.match(day):
            continue
        # the granule's box may reach the area while its imagery doesn't
        hit = _covered(feature, samples, box)
        if not hit:
            continue
        cloud = None if radar else _cloud(props)
        time = _sensed(props) if radar else ""
        key = _pass_key(by_pass, day, time)
        entry = by_pass.setdefault(
            key, {"date": day, "time": time, "cloud": cloud, "granules": 0, "covered": set()}
        )
        entry["granules"] += 1
        entry["covered"] |= hit
        # a pass is named by the first of its slices to cross the area
        if time and time < entry["time"] and same_track(time, entry["time"]):
            entry["time"] = time
        # the granule that actually covers the area may be the clearer of two
        if cloud is not None and (entry["cloud"] is None or cloud < entry["cloud"]):
            entry["cloud"] = cloud
    return by_pass, len(features)


def _listed(entry: dict[str, Any], lon: float, collection: str) -> dict[str, Any]:
    row = {"date": entry["date"], "cloud": entry["cloud"], "granules": entry["granules"]}
    if collection == "sentinel1":
        row.update(time=entry["time"], orbit=orbit_direction(entry["time"], lon))
    return row


def dates(
    instance: str,
    lat: float,
    lon: float,
    start: str,
    end: str,
    *,
    collection: str = "sentinel2",
    get: Callable[..., Any] | None = None,
) -> list[dict[str, Any]]:
    """Acquisition dates over a point, newest first.

    Each entry: ``{"date", "cloud", "granules"}`` — ``cloud`` is the least
    cloudy granule covering the point that day (None when the service didn't
    say), ``granules`` how many covered it. A Sentinel-1 entry is one pass and
    adds its ``time`` and ``orbit`` direction.

    This is what makes a date picker honest: without it the user guesses a date,
    pays a tile, and finds out it was cloud or a gap. For a drawn area rather
    than a crosshair, ``acquisitions`` answers the same question with a coverage
    share attached.
    """
    box = (lon - _BBOX_PAD, lat - _BBOX_PAD, lon + _BBOX_PAD, lat + _BBOX_PAD)
    found, _ = _passes(instance, box, [(lon, lat)], start, end, collection=collection, get=get)
    return sorted(
        (_listed(e, lon, collection) for e in found.values()),
        key=lambda entry: (entry["date"], entry.get("time", "")), reverse=True,
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
    collection: str = "sentinel2",
    get: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Acquisitions over drawn areas, newest first.

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
    found, features = _passes(instance, box, samples, start, end, collection=collection, get=get)
    middle = (box[0] + box[2]) / 2
    listed = sorted(
        ({**_listed(entry, middle, collection),
          "coverage": round(len(entry["covered"]) / len(samples), 3)}
         for entry in found.values()),
        key=lambda entry: (entry["date"], entry.get("time", "")), reverse=True,
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


# -- the Sentinel-1 layer --------------------------------------------------------

# Layers the Sentinel-2 templates ship, which are therefore never the Sentinel-1
# layer a user added: looking for theirs need not spend a request on these.
TEMPLATE_LAYERS = frozenset({
    *(entry.id for entry in LAYERS), *KNOWN_HINTS, "AGRICULTURE", "ATMOSPHERIC_PENETRATION",
    "BATHYMETRIC", "COLOR_INFRARED", "COLOR_INFRARED__URBAN_", "GEOLOGY", "VEGETATION_INDEX",
})
# Where a probe looks: the North Sea off Rotterdam, which Sentinel-1 sees from
# several tracks every few days, so a month back always holds a pass.
_PROBE_POINT = (51.95, 4.05)
_PROBE_DAYS = 30
_PROBE_SCRIPT = base64.b64encode(
    b"""//VERSION=3
function setup() {
  return { input: [{ bands: ["VV", "VH", "dataMask"] }], output: { bands: 1, sampleType: "UINT8" } };
}
function evaluatePixel(p) {
  return [p.dataMask && (p.VV > 0 || p.VH > 0) ? 255 : 0];
}
"""
).decode("ascii")
_WFS_NS = {"wfs": "http://www.opengis.net/wfs/2.0"}


def ogc_error(body: str) -> str:
    """The human half of an OGC exception report, or the body itself."""
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return body.strip()[:300]
    texts = [node.text.strip() for node in root.iter() if node.text and node.text.strip()]
    return " ".join(texts)[:300] or body.strip()[:300]


def serves_sentinel1(instance: str, *, get: Callable[..., Any] | None = None) -> bool:
    """Whether any layer of the instance reads Sentinel-1.

    WFS lists a feature type per collection the instance's layers use, which
    is the one place the configuration says what its layers read. Asking costs
    no processing units.
    """
    fetch = get or httpx.get
    response = fetch(
        f"{BASE}/wfs/{instance}",
        params={"SERVICE": "WFS", "REQUEST": "GetCapabilities", "VERSION": "2.0.0"},
        headers={"User-Agent": USER_AGENT}, timeout=15,
    )
    response.raise_for_status()
    root = ET.fromstring(response.text)
    names = {(node.text or "").strip() for node in root.iterfind(".//wfs:FeatureType/wfs:Name", _WFS_NS)}
    return S1_TYPENAME in names


def probe_sar_layer(
    instance: str, layer: str, today: date | None = None, *, get: Callable[..., Any] | None = None
) -> dict[str, Any]:
    """Whether ``layer`` reads Sentinel-1 VV and VH: one tiny render.

    A Sentinel-2 layer refuses the script outright, as does a Sentinel-1 layer
    set to the polar HH/HV polarisations, so a 400 is the answer "not this one"
    and the service's own sentence says why. Billed as one request.
    """
    if not _LAYER_RE.match(layer or ""):
        raise ValueError(f"malformed layer '{layer}'")
    today = today or date.today()
    lat, lon = _PROBE_POINT
    earth_radius = 6_378_137.0
    x = earth_radius * math.radians(lon)
    y = earth_radius * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    half = 2_000.0
    params = {
        "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.3.0", "LAYERS": layer,
        "CRS": "EPSG:3857", "BBOX": f"{x - half},{y - half},{x + half},{y + half}",
        "WIDTH": str(_COVERAGE_SIZE), "HEIGHT": str(_COVERAGE_SIZE), "FORMAT": "image/png",
        "TIME": f"{(today - timedelta(days=_PROBE_DAYS)).isoformat()}/{today.isoformat()}",
        "EVALSCRIPT": _PROBE_SCRIPT,
    }
    fetch = get or httpx.get
    response = fetch(f"{BASE}/wms/{instance}", params=params,
                     headers={"User-Agent": USER_AGENT}, timeout=20)
    if response.status_code == 400:
        return {"ok": False, "layer": layer, "detail": ogc_error(response.text)}
    response.raise_for_status()
    try:
        with Image.open(io.BytesIO(response.content)) as source:
            seen = any(source.convert("L").tobytes())
    except (OSError, UnidentifiedImageError) as exc:
        raise CoverageError("the probe returned no readable image") from exc
    return {"ok": True, "layer": layer, "detail": "reads Sentinel-1 VV and VH" if seen else
            "reads Sentinel-1, though it saw nothing at the probe point this month"}
