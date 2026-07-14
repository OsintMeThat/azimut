"""XYZ tile engine: Web Mercator math, provider registry, crop stitching.

Legal-only policy (spec §6 v1 notes): built-in presets are exclusively
providers whose terms permit this use. More imagery comes from official APIs
with the user's own key, or custom XYZ templates for legitimate sources,
configured in settings.json — never from unofficial endpoints of keyed
services.
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

import httpx
from PIL import Image, ImageDraw, ImageFont

from .. import config
from . import google_tiles

TILE_SIZE = 256
SIZE_MAX = 4096  # hard cap on a capture's width/height, in px
# hard cap: bounded requests per capture, polite to providers. Kept at the
# same ratio to SIZE_MAX as the original 2048px/64-tile cap, so an exact
# SIZE_MAX×SIZE_MAX crop still gets rejected (as 2048×2048 did before) while
# realistic preset/resolution combinations stay comfortably under it.
MAX_TILES_PER_CROP = (SIZE_MAX // TILE_SIZE) ** 2
USER_AGENT = "Azimut/0.1 (+local OSINT workbench; single-user)"


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    url: str  # template with {x} {y} {z}, optionally {key}
    attribution: str
    max_zoom: int = 19
    needs_key: bool = False
    subdomains: tuple[str, ...] = field(default_factory=tuple)  # for {s} templates
    # True for satellite/aerial imagery, False for street/base maps. Drives the UI:
    # the OSM labels overlay is only useful over imagery (§ Satellite item 1).
    imagery: bool = True
    capturable: bool = True  # may a saved capture be filed from it?
    cacheable: bool = True  # may its tiles be written to a disk cache?
    attribution_burn: bool = False  # force attribution stamped into the image
    session: str | None = None  # provider kind needing a live token, e.g. "google"
    # usage-counter bucket in settings.json (docs/KEYED_PROVIDERS.md §6);
    # None = unmetered. Billed keyed providers count every tile request.
    meter: str | None = None
    # px per tile edge. Mapbox bills 256px tiles 4× vs 512px ones (same imagery
    # resolution: one 512 tile at z-1 = four 256 tiles at z), so keyed Mapbox
    # uses 512. The visual zoom stays the caller's; the URL z is offset down.
    tile_size: int = 256


# Built-in keyed providers (docs/KEYED_PROVIDERS.md §2): only surfaced from
# all_providers() once the matching api_keys entry is set. Mapbox's token is a
# static credential baked straight into the URL; Google needs a live session
# token minted per docs/KEYED_PROVIDERS.md §3, so {session} stays unresolved
# here and is substituted at fetch time (engine/google_tiles.py).
MAPBOX_SATELLITE_URL = (
    "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}?access_token={key}"
)
GOOGLE_SATELLITE_URL = "https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}&key={key}"

BUILTIN_PROVIDERS: tuple[Provider, ...] = (
    Provider(
        id="esri-world-imagery",
        label="Esri World Imagery",
        url="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attribution="Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        max_zoom=19,
    ),
    Provider(
        id="osm",
        label="OpenStreetMap (street context)",
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution="© OpenStreetMap contributors",
        max_zoom=19,
        imagery=False,
    ),
)


def all_providers() -> list[Provider]:
    providers = list(BUILTIN_PROVIDERS)
    settings = config.load_settings()
    keys = settings.get("api_keys", {})

    mapbox_key = keys.get("mapbox")
    if mapbox_key:
        providers.append(
            Provider(
                id="mapbox-satellite",
                label="Mapbox Satellite",
                url=MAPBOX_SATELLITE_URL.replace("{key}", mapbox_key),
                attribution="© Mapbox © OpenStreetMap",
                max_zoom=22,
                imagery=True,
                capturable=True,
                cacheable=True,
                meter="mapbox",
                tile_size=512,
            )
        )

    google_key = keys.get("google")
    if google_key:
        providers.append(
            Provider(
                id="google-satellite",
                label="Google Satellite",
                url=GOOGLE_SATELLITE_URL.replace("{key}", google_key),
                # fallback only — captures resolve the real per-viewport
                # copyright line at fetch time (engine/google_tiles.py)
                attribution="Google",
                max_zoom=22,
                imagery=True,
                capturable=True,
                cacheable=False,
                attribution_burn=True,
                session="google",
                meter="google",
            )
        )

    for entry in settings.get("tile_providers", []):
        try:
            url = entry["url"]
            needs_key = "{key}" in url
            if needs_key and entry["id"] in keys:
                url = url.replace("{key}", keys[entry["id"]])
                needs_key = False
            providers.append(
                Provider(
                    id=entry["id"],
                    label=entry.get("label", entry["id"]),
                    url=url,
                    attribution=entry.get("attribution", entry["id"]),
                    max_zoom=int(entry.get("max_zoom", 19)),
                    needs_key=needs_key,
                    imagery=bool(entry.get("imagery", True)),
                    # only the two real-world sizes; anything else falls back
                    tile_size=(
                        512 if int(entry.get("tile_size", TILE_SIZE)) == 512 else TILE_SIZE
                    ),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue  # malformed user entry: skip rather than break the app
    return providers


def get_provider(provider_id: str) -> Provider:
    for provider in all_providers():
        if provider.id == provider_id:
            return provider
    raise KeyError(f"unknown tile provider '{provider_id}'")


# -- Web Mercator ------------------------------------------------------------


def project(lat: float, lon: float, zoom: int) -> tuple[float, float]:
    """(lat, lon) → fractional tile coordinates at zoom."""
    lat = min(max(lat, -85.05112878), 85.05112878)
    scale = 1 << zoom
    x = (lon + 180.0) / 360.0 * scale
    siny = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + siny) / (1 - siny)) / (4 * math.pi)) * scale
    return x, y


def unproject(x: float, y: float, zoom: int) -> tuple[float, float]:
    """Fractional tile coordinates at zoom → (lat, lon)."""
    scale = 1 << zoom
    lon = x / scale * 360.0 - 180.0
    n = math.pi - 2.0 * math.pi * y / scale
    lat = math.degrees(math.atan(math.sinh(n)))
    return lat, lon


def meters_per_pixel(lat: float, zoom: int) -> float:
    return 156543.03392 * math.cos(math.radians(lat)) / (1 << zoom)


# -- crop fetching -------------------------------------------------------------


class TileFetchError(Exception):
    pass


def resolve_url(provider: Provider) -> str:
    """The provider's live XYZ template — session token substituted if needed."""
    if provider.session != "google":
        return provider.url
    try:
        return google_tiles.resolve_template(provider.url)
    except Exception as exc:
        raise TileFetchError(f"Google session token: {exc}") from exc


def _default_fetch(client: httpx.Client, url: str) -> Image.Image | None:
    """Fetch one tile; None for 'no imagery here' (404), raise on other errors."""
    response = client.get(url)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    import io

    return Image.open(io.BytesIO(response.content)).convert("RGB")


def fetch_crop(
    lat: float,
    lon: float,
    zoom: int,
    width: int,
    height: int,
    provider: Provider,
    *,
    marker_style: str = "crosshair",
    marker_x: int = 0,
    marker_y: int = 0,
    marker_lat: float | None = None,
    marker_lon: float | None = None,
    bearing: float = 0.0,
    fetch_tile: Callable[[httpx.Client, str], Image.Image | None] | None = None,
) -> tuple[Image.Image, dict[str, Any]]:
    """Stitch a width×height crop framed on (lat, lon). Returns (image, provenance).

    ``lat``/``lon`` frame the crop (its center). The marker — the recorded point
    of interest — defaults to that same center, but can be offset: ``marker_x``/
    ``marker_y`` place it that many pixels from the crop center (WYSIWYG offset
    computed on the client, already accounting for rotation), and ``marker_lat``/
    ``marker_lon`` are its geographic coordinates, recorded as the capture's
    ``lat``/``lon``. ``marker_style`` is ``"crosshair"``, ``"pin"`` or ``"none"``.

    Missing tiles become labeled gray placeholders instead of failing the crop.
    ``bearing`` (degrees clockwise from north) rotates the crop: a larger
    north-up canvas is stitched, rotated, then center-cropped to width×height so
    the result matches a map turned to that heading.
    """
    if provider.needs_key:
        raise TileFetchError(f"provider '{provider.id}' requires an API key (settings.json)")
    if not provider.capturable:
        raise TileFetchError(f"provider '{provider.id}' is view-only and cannot be captured")
    # Bigger tiles keep the caller's visual zoom (same m/px) but request a
    # lower URL z: one 512px tile at z-1 covers four 256px tiles at z.
    z_shift = int(math.log2(provider.tile_size // TILE_SIZE))
    zoom = max(min(zoom, provider.max_zoom), z_shift)
    tile_z = zoom - z_shift
    ts = provider.tile_size
    width, height = min(width, SIZE_MAX), min(height, SIZE_MAX)
    bearing = bearing % 360.0

    # A rotated crop needs a bigger north-up source so its corners stay covered
    # after rotation; the diagonal is the smallest square that always fits.
    if bearing:
        fetch_w = fetch_h = min(math.ceil(math.hypot(width, height)) + 2, SIZE_MAX)
    else:
        fetch_w, fetch_h = width, height

    # world-pixel space at the visual zoom (256·2^zoom px across); the tile
    # grid divides it in `ts`-px steps, with tile indices valid at `tile_z`
    center_x, center_y = project(lat, lon, zoom)
    center_px, center_py = center_x * TILE_SIZE, center_y * TILE_SIZE
    left, top = center_px - fetch_w / 2, center_py - fetch_h / 2

    tile_x0, tile_y0 = int(left // ts), int(top // ts)
    tile_x1, tile_y1 = int((left + fetch_w) // ts), int((top + fetch_h) // ts)
    n_tiles = (tile_x1 - tile_x0 + 1) * (tile_y1 - tile_y0 + 1)
    if n_tiles > MAX_TILES_PER_CROP:
        raise TileFetchError(
            f"crop needs {n_tiles} tiles (max {MAX_TILES_PER_CROP}) — reduce size or zoom"
        )

    max_index = (1 << tile_z) - 1
    fetch = fetch_tile or _default_fetch
    canvas = Image.new("RGB", (fetch_w, fetch_h), (24, 28, 38))
    missing = 0

    coords = [
        (tx, ty)
        for ty in range(tile_y0, tile_y1 + 1)
        for tx in range(tile_x0, tile_x1 + 1)
    ]

    def fetch_all(url_template: str) -> list[tuple[int, int, Image.Image | None]]:
        def grab(tx: int, ty: int) -> tuple[int, int, Image.Image | None]:
            if not (0 <= tx <= max_index and 0 <= ty <= max_index):
                return tx, ty, None
            return tx, ty, fetch(client, url_template.format(x=tx, y=ty, z=tile_z))

        with httpx.Client(
            headers={"User-Agent": USER_AGENT}, timeout=20, follow_redirects=True
        ) as client:
            with ThreadPoolExecutor(max_workers=6) as pool:
                return list(pool.map(lambda xy: grab(*xy), coords))

    for attempt in (1, 2):
        try:
            results = fetch_all(resolve_url(provider))
            break
        except httpx.HTTPStatusError as exc:
            # a stale Google session token answers 401/403 — re-mint once, transparently
            if attempt == 1 and provider.session and exc.response.status_code in (401, 403):
                google_tiles.invalidate(google_tiles.key_from_url(provider.url))
            else:
                raise

    served = 0  # tiles the provider actually returned — what a billed meter counts
    for tx, ty, tile in results:
        px, py = int(tx * ts - left), int(ty * ts - top)
        if tile is None:
            missing += 1
            continue
        served += 1
        canvas.paste(tile, (px, py))
    if provider.meter and served:
        config.record_usage(provider.meter, served)

    if bearing:
        # CSS rotates the map clockwise; PIL rotates counter-clockwise, hence -bearing.
        canvas = canvas.rotate(
            -bearing, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=(24, 28, 38)
        )
        off_x, off_y = (fetch_w - width) // 2, (fetch_h - height) // 2
        canvas = canvas.crop((off_x, off_y, off_x + width, off_y + height))

    marker_lat = lat if marker_lat is None else marker_lat
    marker_lon = lon if marker_lon is None else marker_lon
    mx = width // 2 + int(marker_x)
    my = height // 2 + int(marker_y)
    if marker_style == "pin":
        _draw_pin(canvas, mx, my)
    elif marker_style != "none":
        marker_style = "crosshair"
        _draw_crosshair(canvas, mx, my)

    attribution = provider.attribution
    if provider.session == "google":
        # the exact copyright line for this viewport (e.g. "Map data ©2026
        # Google, Maxar Technologies"); static fallback if unreachable
        north, west = unproject(left / TILE_SIZE, top / TILE_SIZE, zoom)
        south, east = unproject((left + fetch_w) / TILE_SIZE, (top + fetch_h) / TILE_SIZE, zoom)
        attribution = (
            google_tiles.viewport_copyright(
                google_tiles.key_from_url(provider.url), zoom, north, south, east, west
            )
            or attribution
        )

    if provider.attribution_burn:
        canvas = _burn_attribution(canvas, attribution)

    provenance = {
        "provider": provider.id,
        "provider_label": provider.label,
        "attribution": attribution,
        "attribution_burned": bool(provider.attribution_burn),
        # lat/lon are the marker (point of interest); center frames the crop
        "lat": marker_lat,
        "lon": marker_lon,
        "center_lat": lat,
        "center_lon": lon,
        "zoom": zoom,
        "width": width,
        "height": height,
        "bearing": round(bearing, 1),
        "meters_per_pixel": round(meters_per_pixel(lat, zoom), 3),
        "tiles": n_tiles,
        "tiles_missing": missing,
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "marker_style": marker_style,
        "marker_x": int(marker_x),
        "marker_y": int(marker_y),
        # kept for backward-compatible readers of older captures
        "crosshair": marker_style != "none",
    }
    return canvas, provenance


# -- Esri imagery capture date (best-effort) ----------------------------------

# Esri publishes per-scene acquisition metadata for World Imagery through the
# MapServer "identify" endpoint. Only this provider exposes a capture date; for
# everything else we simply have nothing to show.
ESRI_METADATA_URL = (
    "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify"
)


def _extract_capture_date(attrs: dict[str, Any]) -> str | None:
    """Pull a human date out of an Esri identify attribute bag.

    Esri's date field varies by scene (``SRC_DATE2`` as YYYYMMDD, a plain year,
    or an already-formatted string), so scan every date-ish attribute and take
    the most precise value we can recognise.
    """
    best: str | None = None
    for key, value in attrs.items():
        if "DATE" not in key.upper() or value in (None, "", 0):
            continue
        text = str(value).strip()
        digits = text.replace("-", "").replace("/", "")
        if len(digits) == 8 and digits.isdigit():  # YYYYMMDD → full date wins outright
            return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
        if len(text) == 4 and text.isdigit():  # bare year — keep unless a full date turns up
            best = best or text
        elif len(text) >= 8:  # already looks like a formatted date
            best = best or text
    return best


def esri_capture_date(
    lat: float,
    lon: float,
    zoom: int,
    *,
    get: Callable[..., Any] | None = None,
) -> dict[str, Any] | None:
    """Best-effort acquisition date of the Esri World Imagery scene at a point.

    Returns ``{"date": str|None, "source": str|None}`` on a successful query
    (``date`` may still be ``None`` if the scene carries no date), or ``None``
    when the metadata service can't be reached. Never raises.
    """
    tx, ty = project(lat, lon, zoom)
    tl_lat, tl_lon = unproject(int(tx), int(ty), zoom)
    br_lat, br_lon = unproject(int(tx) + 1, int(ty) + 1, zoom)
    params = {
        "f": "json",
        "geometry": f"{lon},{lat}",
        "geometryType": "esriGeometryPoint",
        "sr": "4326",
        "layers": "all",
        "tolerance": "0",
        "returnGeometry": "false",
        "mapExtent": f"{tl_lon},{br_lat},{br_lon},{tl_lat}",
        "imageDisplay": "256,256,96",
    }
    fetch = get or httpx.get
    try:
        response = fetch(
            ESRI_METADATA_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=8
        )
        response.raise_for_status()
        results = response.json().get("results") or []
    except Exception:
        return None
    if not results:
        return {"date": None, "source": None}
    attrs = results[0].get("attributes", {})
    return {
        "date": _extract_capture_date(attrs),
        "source": attrs.get("NICE_NAME") or attrs.get("SRC_DESC") or None,
    }


ATTRIBUTION_BAND = 20  # px footer appended below the imagery


def _burn_attribution(img: Image.Image, text: str) -> Image.Image:
    """Append a footer band carrying the attribution line.

    For providers whose terms make attribution a condition of the allowed use
    (Google), the capture must never exist without it — burned in, not optional.
    The band is added *below* the imagery so nothing is covered.
    """
    out = Image.new("RGB", (img.width, img.height + ATTRIBUTION_BAND), (16, 18, 24))
    out.paste(img, (0, 0))
    draw = ImageDraw.Draw(out)
    font = ImageFont.load_default()
    draw.text((6, img.height + 4), text, fill=(203, 208, 218), font=font)
    return out


def _draw_crosshair(img: Image.Image, cx: int, cy: int) -> None:
    """Marker at (cx, cy): thin cross with an open middle, white with dark outline."""
    draw = ImageDraw.Draw(img)
    arm, gap = 22, 7
    for dx, dy, colour in ((1, 1, (0, 0, 0)), (0, 0, (255, 255, 255))):
        for (x0, y0, x1, y1) in (
            (cx - arm, cy, cx - gap, cy),
            (cx + gap, cy, cx + arm, cy),
            (cx, cy - arm, cx, cy - gap),
            (cx, cy + gap, cx, cy + arm),
        ):
            draw.line((x0 + dx, y0 + dy, x1 + dx, y1 + dy), fill=colour, width=2)
        draw.ellipse((cx - 2 + dx, cy - 2 + dy, cx + 2 + dx, cy + 2 + dy), outline=colour, width=1)


def _draw_pin(img: Image.Image, x: int, y: int) -> None:
    """Google-Maps-style teardrop pin whose tip points at (x, y).

    Rendered on a transparent layer at 4× and downsampled, so the curved body
    and its outline come out smooth instead of jagged (PIL has no anti-aliasing).
    """
    head_r, tip_len, stroke, pad = 12, 28, 1.6, 3
    red, dark, white = (229, 72, 77, 255), (58, 12, 14, 255), (255, 255, 255, 255)

    s = 4  # supersample factor
    w = (head_r + pad) * 2
    h = head_r + tip_len + pad * 2
    layer = Image.new("RGBA", (w * s, h * s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    cx = (head_r + pad) * s  # head center within the (supersampled) layer
    cy = (head_r + pad) * s
    tip_y = cy + tip_len * s

    def body(radius: float, tip_offset: float, fill: tuple[int, int, int, int]) -> None:
        # circle head at (cx, cy) unioned with a triangle down to the tip; the
        # triangle sides are tangent to the circle, so the join is seamless
        ty = tip_y - tip_offset
        theta = math.asin(min(1.0, radius / (ty - cy)))
        lx = cx - radius * math.cos(theta)
        rx = cx + radius * math.cos(theta)
        ly = cy + radius * math.sin(theta)
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=fill)
        draw.polygon([(lx, ly), (cx, ty), (rx, ly)], fill=fill)

    sw = stroke * s
    body(head_r * s, 0, dark)  # dark silhouette = the outline
    body(head_r * s - sw, sw * 1.7, red)  # red body inset by the stroke width
    hole = 4.4 * s  # inner white dot with a thin dark ring
    draw.ellipse((cx - hole - sw * 0.6, cy - hole - sw * 0.6,
                  cx + hole + sw * 0.6, cy + hole + sw * 0.6), fill=dark)
    draw.ellipse((cx - hole, cy - hole, cx + hole, cy + hole), fill=white)

    layer = layer.resize((w, h), Image.Resampling.LANCZOS)
    img.paste(layer, (round(x - (head_r + pad)), round(y - (head_r + pad + tip_len))), layer)
