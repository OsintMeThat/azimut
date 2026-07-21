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

VARIANT_SEP = "~"


def wmts_url(layer: str = DEFAULT_LAYER, start: str | None = None, end: str | None = None) -> str:
    """The WMTS GetTile template for one layer and window: ``{key}``/``{z}``/``{x}``/``{y}``.

    ``start``/``end`` (YYYY-MM-DD) become the ``TIME`` mosaicking window, which
    is inclusive of both days. Omitted, no TIME is sent and the layer's own
    default applies — "most recent", the honest default for "just show me it".
    """
    url = (
        f"{BASE}/wmts/{{key}}"
        "?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
        f"&LAYER={layer}&TILEMATRIXSET=PopularWebMercator512"
        "&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&FORMAT=image/jpeg"
    )
    if start and end:
        url += f"&TIME={start}/{end}"
    return url


def variant_id(base_id: str, layer: str | None = None, start: str | None = None,
               end: str | None = None) -> str:
    """Pack a layer + window into a provider id. Mirror of ``parse_variant``.

    The default layer with no window is just the base id: the plain basemap must
    not get a second name, or it would cache twice and read as two providers in
    provenance.
    """
    layer = layer or DEFAULT_LAYER
    if layer == DEFAULT_LAYER and not (start and end):
        return base_id
    parts = [base_id, layer]
    if start and end:
        parts += [start, end]
    return VARIANT_SEP.join(parts)


def parse_variant(spec: str) -> tuple[str, str | None, str | None]:
    """``"SWIR~2026-05-01~2026-05-31"`` → ``("SWIR", "2026-05-01", "2026-05-31")``.

    Raises ValueError on anything that isn't a layer-shaped name and a pair of
    ISO dates in order. This is the validation boundary for a string that
    arrives from a URL path and ends up as a directory name, so the *shape* is
    an allowlist: no separators, no traversal, no free-form text, no reversed
    windows. Membership of LAYERS deliberately isn't checked — an instance
    serves whatever its configuration says (capabilities_layers), and a layer
    the catalogue never heard of is the user's to ask for. A wrong one comes
    back as Sentinel Hub's own 400, which says more than we could.
    """
    parts = spec.split(VARIANT_SEP)
    if len(parts) not in (1, 3):
        raise ValueError(f"malformed Sentinel-2 variant '{spec}'")
    layer = parts[0]
    if not _LAYER_RE.match(layer):
        raise ValueError(f"malformed Sentinel-2 layer '{layer}'")
    if len(parts) == 1:
        return layer, None, None
    start, end = parts[1], parts[2]
    for value in (start, end):
        if not _DATE_RE.match(value):
            raise ValueError(f"malformed date '{value}' (expected YYYY-MM-DD)")
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError(f"impossible date '{value}'") from exc
    if start > end:
        raise ValueError(f"window ends before it starts ({start} → {end})")
    return layer, start, end


def variant_label(layer: str, start: str | None, end: str | None) -> str:
    """How a variant reads to a human: "SWIR · 2026-05-01 → 2026-05-31"."""
    known = next((entry.label for entry in LAYERS if entry.id == layer), layer)
    if start and end:
        window = start if start == end else f"{start} → {end}"
        return f"{known} · {window}"
    return f"{known} · most recent"


# -- date discovery (WFS) ------------------------------------------------------

# How wide a box around the point to ask about, in degrees (~1 km): big enough
# that a point near a granule edge still finds the granule, small enough that
# the answer is about *here* and not the next province.
_BBOX_PAD = 0.005
# WFS caps MAXFEATURES at 100, and one date can return several granules, so this
# is "up to 100 granules" rather than "100 dates" — the caller sees how many
# dates that collapsed to.
_MAX_FEATURES = 100

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


def _covers(lat: float, lon: float, geometry: dict[str, Any] | None) -> bool:
    """Does this granule's footprint actually contain the point?

    Why it matters: a granule's *bounding box* is a square, but its data is the
    slice of orbit swath inside it — the rest is nodata. WFS answers on the box,
    so a day can be listed while the pixels over your point are black. Pinned to
    that day the map has nothing to show and goes dark, which is the "why is
    this date black?" a date list exists to prevent.

    GeoJSON says longitude first, but an OGC service asked for EPSG:4326 may
    honour the CRS's latitude-first axis order instead, and getting it backwards
    would reject every granule on Earth. So a granule counts as covering the
    point if it does under *either* reading: a footprint genuinely 100 km away
    contains it under neither, which is the case worth acting on. Unparseable
    geometry keeps the granule — never drop a real pass over a guess.
    """
    rings = _rings(geometry)
    if not rings:
        return True
    return any(_in_ring(lon, lat, ring) or _in_ring(lat, lon, ring) for ring in rings)


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
    pays a tile, and finds out it was cloud or a gap. A WFS query is billed as
    one request (~0.01 PU, versus a tile's 1 PU), so the caller counts it on the
    meter — cheap, but not free, and the meter never lies by omission.

    Raises httpx.HTTPError / ValueError upward: a date list that failed must not
    read as "no imagery here".
    """
    fetch = get or httpx.get
    params = {
        "SERVICE": "WFS",
        "REQUEST": "GetFeature",
        "VERSION": "2.0.0",
        "TYPENAMES": WFS_TYPENAME,
        "OUTPUTFORMAT": "application/json",
        # EPSG:4326 puts latitude first — the axis order the CRS declares, not
        # the lon/lat habit. Swapped, the box lands in the ocean off Somalia.
        "SRSNAME": "EPSG:4326",
        "BBOX": f"{lat - _BBOX_PAD},{lon - _BBOX_PAD},{lat + _BBOX_PAD},{lon + _BBOX_PAD}",
        "TIME": f"{start}/{end}",
        "MAXFEATURES": str(_MAX_FEATURES),
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
        # the granule's box may reach the point while its imagery doesn't
        if not _covers(lat, lon, feature.get("geometry")):
            continue
        cloud = _cloud(props)
        entry = by_date.setdefault(day, {"date": day, "cloud": cloud, "granules": 0})
        entry["granules"] += 1
        # the granule that actually covers the point may be the clearer of two
        if cloud is not None and (entry["cloud"] is None or cloud < entry["cloud"]):
            entry["cloud"] = cloud
    return sorted(by_date.values(), key=lambda entry: entry["date"], reverse=True)


def coverage(
    instance: str,
    lat: float,
    lon: float,
    layer: str,
    day: str,
    *,
    get: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Check whether ``layer`` has source pixels near a point on ``day``.

    WFS supplies candidate acquisition dates. This WMS dataMask probe is the
    final authority before the UI replaces a working map with a dated layer.
    It uses the configured layer, so a custom layer is checked against its own
    collection rather than the date catalogue's L2A assumption.
    """
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("coordinates are outside WGS84 bounds")
    # Reuse the variant parser as the validation boundary for both URL values.
    checked_layer, checked_day, _ = parse_variant(
        f"{layer}{VARIANT_SEP}{day}{VARIANT_SEP}{day}"
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
