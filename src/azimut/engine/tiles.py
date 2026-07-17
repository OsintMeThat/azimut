"""XYZ tile engine: Web Mercator math, provider registry, crop stitching.

Legal-only policy (spec §6 v1 notes): built-in presets are exclusively
providers whose terms permit this use. More imagery comes from official APIs
with the user's own key, or custom XYZ templates for legitimate sources,
configured in settings.json — never from unofficial endpoints of keyed
services.
"""

from __future__ import annotations

import hashlib
import math
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Callable

import httpx
from PIL import Image, ImageDraw, ImageFont

from .. import config
from . import google_tiles, sentinel

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
    # Deepest zoom the provider has *pixels* for, when that is shallower than
    # the deepest zoom worth showing. None = they're the same (the usual case).
    # Sentinel-2 resolves 10 m/px and stops at z14, but a z14 ceiling makes the
    # basemap unusable for its actual job — you cannot look at a ship at 10 m/px
    # from three levels out. So the view runs to z18 while requests stop at 14
    # and the last native tile is upscaled: identical pixels, magnified, for
    # zero extra requests. Asking Sentinel Hub for z18 instead would buy their
    # upsampling of the same pixels at 256× the quota (16× the tiles, each
    # billed) — the same image, paid for.
    max_native_zoom: int | None = None
    needs_key: bool = False
    subdomains: tuple[str, ...] = field(default_factory=tuple)  # for {s} templates
    # True for satellite/aerial imagery, False for street/base maps. Drives the UI:
    # the OSM labels overlay is only useful over imagery (§ Satellite item 1).
    imagery: bool = True
    capturable: bool = True  # may a saved capture be filed from it?
    cacheable: bool = True  # may its tiles be written to a disk cache?
    attribution_burn: bool = False  # force attribution stamped into the image
    session: str | None = None  # provider kind needing a live token, e.g. "google"
    # usage-counter bucket in settings.json (docs/IMAGERY_PROVIDERS.md);
    # None = unmetered. Billed keyed providers count every tile request.
    meter: str | None = None
    # px per tile edge. Providers billing per request regardless of tile size
    # get the biggest tile that keeps full imagery detail: Mapbox 512 (its @2x
    # 1024 variant is upsampled — verified softer, not used), Google 1024
    # (hi-DPI 4x, verified pixel-identical). The visual zoom stays the
    # caller's; the URL z is offset down (512 → z-1, 1024 → z-2).
    tile_size: int = 256
    # Live-map display oversampling: 2 = the map shows tiles from one zoom
    # deeper, downscaled 2× in CSS. Google's mid-zoom mosaics are genuinely
    # softer than its deep ones (verified 2026-07: z18-detail downscaled to a
    # z16 footprint beats the native z16 tile), so the layer trades 4× the
    # requests (still ¼ of plain 256px tiles) for crisp imagery. Captures are
    # unaffected: they stay 1:1 provider pixels for evidential integrity.
    oversample: int = 1
    # Levels to re-add to the URL z after tile_size shifted it down. WMTS
    # services number their 512px levels by *resolution* where Mapbox numbers
    # them by *grid width*: Sentinel Hub's TILEMATRIX=14 and Mapbox's z13 are
    # both 9.55 m/px on an 8192-wide grid. The tile indices stay at tile_z
    # either way — only the level's name differs.
    zoom_offset: int = 0
    # Non-XYZ basemap rendered by a frontend widget (e.g. "google-maps-js"):
    # no tiles, no proxy, no fetch_crop — `url` is the widget's script loader
    # and the frontend does the rest. Backend still owns key storage + meter.
    widget: str | None = None
    # Eco-mode threshold for *this* provider: the visual zoom at or below which
    # free imagery replaces it. None = the user's global eco_max_zoom, which is
    # tuned for providers that run to z22. A shallow provider needs its own: at
    # Sentinel-2's z14 ceiling the global z15 rule would fire everywhere and the
    # basemap could never be seen at all. Its threshold is instead set where its
    # imagery stops earning the quota — the swap costs a known date for an
    # unknown one, which is only worth it where 10 m/px adds nothing anyway.
    eco_max_zoom: int | None = None


# Built-in keyed providers (docs/IMAGERY_PROVIDERS.md): only surfaced from
# all_providers() once the matching api_keys entry is set. Mapbox's token is a
# static credential baked straight into the URL; Google needs a live session
# token minted per docs/IMAGERY_PROVIDERS.md, so {session} stays unresolved
# here and is substituted at fetch time (engine/google_tiles.py).
MAPBOX_SATELLITE_URL = (
    "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}?access_token={key}"
)
GOOGLE_SATELLITE_URL = "https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}&key={key}"
# Maps JavaScript API loader (docs/IMAGERY_PROVIDERS.md § Google in the EEA):
# the official Google satellite route left to EEA billing accounts since
# 2025-07-08 (Map Tiles + Static satellite are policy-blocked there). A JS-API
# key is client-side by design (referrer-restricted, not secret), so shipping
# it to the browser in this loader URL is the intended use, unlike tile keys.
GOOGLE_JS_LOADER_URL = "https://maps.googleapis.com/maps/api/js?key={key}&v=weekly"
# Sentinel Hub OGC WMTS (docs/IMAGERY_PROVIDERS.md): {key} is the user's
# configuration-instance UUID, which is the whole credential — no token to mint.
# The layer and the mosaicking window are choices, not constants, so the
# template is built per variant in engine/sentinel.py; this is the plain one
# (TRUE_COLOR, the layer's own default window = most recent).
SENTINELHUB_WMTS_URL = sentinel.wmts_url()

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
    # Topographic base map: SRTM contour lines + hillshade, the Garmin-style
    # look for reading relief. CC-BY-SA, key-less, free for any use provided
    # the attribution below stays visible — the tile policy's only real limit
    # is "no mass downloads", which a single-user workbench never approaches.
    # Stops at z17: deeper zooms come back as a constant "max zoom layer = 17"
    # placard (its hash is registered below, so a stray request reads as a
    # coverage gap rather than being stitched into a proof). The live map caps
    # its zoom here and fetch_crop clamps to it, so neither ever asks.
    Provider(
        id="opentopomap",
        label="OpenTopoMap (topographic · contour lines)",
        url="https://tile.opentopomap.org/{z}/{x}/{y}.png",
        attribution="Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)",
        max_zoom=17,
        imagery=False,
    ),
)


def all_providers() -> list[Provider]:
    providers = list(BUILTIN_PROVIDERS)
    settings = config.load_settings()
    keys = settings.get("api_keys", {})
    # a keyed basemap can be switched off in Settings without deleting the key
    enabled = settings.get("providers_enabled", {})

    def key_for(key_id: str) -> str | None:
        """The credential, unless switched off or last seen failing auth — a
        basemap whose key is known-dead is withheld from the selector until
        the key changes or a test passes (Settings shows why)."""
        if not enabled.get(key_id, True):
            return None
        if config.provider_key_bad(key_id, settings):
            return None
        return keys.get(key_id)

    mapbox_key = key_for("mapbox")
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

    google_key = key_for("google")
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
                tile_size=1024,  # hi-DPI 4x session (engine/google_tiles.py)
                oversample=2,  # mid-zoom mosaics are soft — show z+1 detail
            )
        )

    # Google Satellite via the Maps JavaScript widget — the only official
    # Google satellite route for EEA billing accounts (2025-07-08 policy).
    # No tiles: the frontend embeds a real google.maps.Map under Leaflet, so
    # capturable=False (fetch_crop has nothing to stitch — captures are the
    # user's own screenshots, filed with attribution burned in), cacheable is
    # moot, and the meter counts *map loads*, not tiles. eco_max_zoom=0 turns
    # eco off for it: swapping the widget out and back re-instantiates the
    # Google map, and every instantiation is a billed load — eco would cost
    # money here, not save it.
    google_js_key = key_for("google_js")
    if google_js_key:
        providers.append(
            Provider(
                id="google-js",
                label="Google Satellite (Maps JS)",
                url=GOOGLE_JS_LOADER_URL.replace("{key}", google_js_key),
                attribution="Map data © Google",
                max_zoom=21,
                imagery=True,
                capturable=False,
                cacheable=False,
                widget="google-maps-js",
                meter="google_js",
                eco_max_zoom=0,
            )
        )

    # Sentinel-2: open data (attribution only — no capture or cache limit), but
    # a small quota. 512px tiles are what make the tile meter honest: one
    # 512×512 3-band 8-bit tile is exactly 1 processing unit, so counting tiles
    # counts PU. Requests stop at z14 — 10 m/px is Sentinel-2's native ground
    # resolution and anything deeper is Sentinel Hub upsampling we would pay
    # full price for — while the *view* runs to z18 on upscaled native tiles.
    sentinelhub_key = key_for("sentinelhub")
    if sentinelhub_key:
        providers.append(
            Provider(
                id="sentinel2",
                label="Sentinel-2 (Copernicus)",
                url=SENTINELHUB_WMTS_URL.replace("{key}", sentinelhub_key),
                attribution="© Copernicus Sentinel data / Sentinel Hub",
                max_zoom=18,
                max_native_zoom=14,
                imagery=True,
                capturable=True,
                cacheable=True,
                meter="sentinelhub",
                tile_size=512,
                zoom_offset=1,  # WMTS names this level 14 where z_shift says 13
                # Its own eco threshold, three levels under its z14 ceiling: at
                # z11 and out a Sentinel-2 pixel is ~40 m of ground and Esri
                # shows the same scene for free, so the quota buys nothing.
                # z12-14 is where the dated mosaic is the reason you're here.
                eco_max_zoom=11,
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
    """A provider by id, including a Sentinel-2 *variant* id.

    ``sentinel2~SWIR~2026-05-01~2026-05-31`` resolves to the sentinel2 basemap
    rendering that layer over that mosaicking window (engine/sentinel.py). The
    variant is carried on the id rather than passed alongside it so that every
    consumer inherits it for free and none can forget it: the tile proxy and
    fetch_crop only ever hold a Provider, the disk cache keys on ``provider.id``
    (so a window is in the cache key — tiles from two dates can never collide),
    and a capture's provenance records the id it was actually rendered from.
    """
    base_id, sep, spec = provider_id.partition(sentinel.VARIANT_SEP)
    for provider in all_providers():
        if provider.id == base_id:
            if not sep:
                return provider
            if provider.id != "sentinel2":
                raise KeyError(f"provider '{base_id}' has no variants")
            try:
                layer, start, end = sentinel.parse_variant(spec)
            except ValueError as exc:
                raise KeyError(str(exc)) from exc
            return replace(
                provider,
                id=provider_id,
                label=f"{provider.label} · {sentinel.variant_label(layer, start, end)}",
                url=sentinel.wmts_url(layer, start, end).replace(
                    "{key}", _sentinel_key_from(provider.url)
                ),
            )
    raise KeyError(f"unknown tile provider '{provider_id}'")


def _sentinel_key_from(url: str) -> str:
    """The instance UUID out of a built Sentinel Hub URL — rebuilding the
    template for a variant needs the credential back, and the resolved provider
    is the only place it exists at this point."""
    match = re.search(r"/ogc/wmts/([^/?]+)", url)
    if not match:
        raise KeyError("Sentinel Hub provider URL carries no instance id")
    return match.group(1)


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


# Some providers answer in-coverage-gap requests with a real HTTP-200 tile that
# just says "no imagery": Esri World Imagery's constant "Map data not yet
# available" JPEG (byte-identical everywhere, verified 2026-07). Matching by
# content hash turns those into missing tiles, so the overzoom fallback can
# fill them from the parent level instead of showing the gray placard.
PLACEHOLDER_TILE_SHA256 = frozenset(
    {
        "9eafd300d61393184a4abc1d458564cfd1cd9b6f9c4e9c74687045c0a0e5b858",  # Esri
        # OpenTopoMap's "max zoom layer = 17" placard, served for any z >= 18
        # (byte-identical everywhere, verified 2026-07)
        "4b7e1df83d745a752fc357dc6e15f9783838fdbb29ee4189dbcf8ae1fc05874c",
    }
)
# How many parent zoom levels the overzoom fallback may climb. Three levels
# means an 8× upscale at worst — soft, but it keeps the map usable where a
# provider's coverage ends a level or two short.
OVERZOOM_LEVELS = 3


def is_placeholder_tile(content: bytes) -> bool:
    return hashlib.sha256(content).hexdigest() in PLACEHOLDER_TILE_SHA256


def resolve_url(provider: Provider) -> str:
    """The provider's live XYZ template — session token substituted if needed."""
    if provider.session != "google":
        return provider.url
    try:
        return google_tiles.resolve_template(provider.url)
    except Exception as exc:
        raise TileFetchError(f"Google session token: {exc}") from exc


def tile_url(url_template: str, z: int, x: int, y: int, zoom_offset: int = 0) -> str:
    """Fill an XYZ template for one tile.

    ``z`` is always a tile-grid level (indices are valid at ``1 << z``);
    ``zoom_offset`` only renames it for providers whose levels are numbered by
    resolution rather than by grid width (Provider.zoom_offset). Every caller
    goes through here so that correction can never be applied in one code path
    and forgotten in another.
    """
    return url_template.format(x=x, y=y, z=z + zoom_offset)


def _default_fetch(client: httpx.Client, url: str) -> Image.Image | None:
    """Fetch one tile; None for 'no imagery here' (404 or a known placeholder
    tile), raise on other errors."""
    response = client.get(url)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    if is_placeholder_tile(response.content):
        return None
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
    if provider.meter and config.usage_blocked(provider.meter):
        raise TileFetchError(
            f"{provider.label} is paused: {int(config.BLOCK_SHARE * 100)}% of the monthly "
            "free tier is used — enable the override in Settings to keep going (billed)"
        )
    # Bigger tiles keep the caller's visual zoom (same m/px) but request a
    # lower URL z: one 512px tile at z-1 covers four 256px tiles at z.
    z_shift = int(math.log2(provider.tile_size // TILE_SIZE))
    zoom = max(min(zoom, provider.max_zoom), z_shift)
    # Past a provider's native ceiling nothing new exists to fetch (Sentinel-2:
    # native z14, view z18), so the deepest real tiles are fetched and magnified
    # to the requested zoom. `ts` becomes one native tile's *footprint at the
    # view zoom*, which is all the grid math below cares about; the fetched
    # image is still tile_size px and gets resized up to it.
    native_max = provider.max_native_zoom
    native_max = provider.max_zoom if native_max is None else native_max
    upscale = max(0, zoom - max(native_max, z_shift))
    tile_z = zoom - z_shift - upscale
    native_ts = provider.tile_size
    ts = native_ts << upscale
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
            url = tile_url(url_template, tile_z, tx, ty, provider.zoom_offset)
            return tx, ty, fetch(client, url)

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
    gaps: list[tuple[int, int]] = []  # in-range tiles the provider had nothing for
    for tx, ty, tile in results:
        px, py = int(tx * ts - left), int(ty * ts - top)
        if tile is None:
            missing += 1
            if 0 <= tx <= max_index and 0 <= ty <= max_index:
                gaps.append((tx, ty))
            continue
        served += 1
        if upscale:
            tile = tile.resize((ts, ts), Image.Resampling.LANCZOS)
        canvas.paste(tile, (px, py))

    # overzoom fallback: fill coverage gaps from parent-level imagery, upscaled —
    # soft beats a gray placeholder, and provenance records how many were faked up
    upscaled = 0
    if gaps:
        try:
            filled, parent_served = _overzoom_fill(
                resolve_url(provider), gaps, tile_z, native_ts, fetch,
                provider.zoom_offset, out_size=ts,
            )
        except TileFetchError:
            filled, parent_served = {}, 0
        served += parent_served
        for (tx, ty), tile in filled.items():
            canvas.paste(tile, (int(tx * ts - left), int(ty * ts - top)))
        upscaled = len(filled)
        missing -= upscaled
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
        canvas = burn_attribution(canvas, attribution)

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
        # The zoom the pixels are actually from. Below `zoom` when the view ran
        # past the provider's native ceiling (Sentinel-2 at z18 is magnified z14
        # imagery): the image is real, its resolution is not what the zoom
        # implies, and a reader of this capture has to be able to tell.
        "native_zoom": zoom - upscale,
        "upscaled": bool(upscale),
        "width": width,
        "height": height,
        "bearing": round(bearing, 1),
        "meters_per_pixel": round(meters_per_pixel(lat, zoom), 3),
        # ground sample distance of the source imagery — unlike meters_per_pixel
        # this doesn't improve by magnifying, so it's the honest resolution
        "native_meters_per_pixel": round(meters_per_pixel(lat, zoom - upscale), 3),
        "tiles": n_tiles,
        "tiles_missing": missing,
        "tiles_upscaled": upscaled,
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "marker_style": marker_style,
        "marker_x": int(marker_x),
        "marker_y": int(marker_y),
        # kept for backward-compatible readers of older captures
        "crosshair": marker_style != "none",
    }
    return canvas, provenance


def _overzoom_fill(
    url_template: str,
    gaps: list[tuple[int, int]],
    tile_z: int,
    ts: int,
    fetch: Callable[[httpx.Client, str], Image.Image | None],
    zoom_offset: int = 0,
    out_size: int | None = None,
) -> tuple[dict[tuple[int, int], Image.Image], int]:
    """Best-effort fill for missing tiles from parent-level imagery.

    Climbs up to OVERZOOM_LEVELS levels; each needed parent is fetched exactly
    once (adjacent gaps share parents — one billed request, not four) and every
    child crops + upscales its own quadrant. Returns (filled tiles, number of
    parent tiles the provider served — what a billed meter must count).
    Individual fetch errors just leave tiles unfilled; never raises.

    ``ts`` is the provider's real tile size (the parent's pixels — what the crop
    math measures); ``out_size`` is the footprint the caller pastes at, which is
    larger when the caller is already magnifying past a native ceiling.
    """
    out_size = ts if out_size is None else out_size
    filled: dict[tuple[int, int], Image.Image] = {}
    unresolved = list(gaps)
    served = 0
    with httpx.Client(
        headers={"User-Agent": USER_AGENT}, timeout=20, follow_redirects=True
    ) as client:
        for up in range(1, OVERZOOM_LEVELS + 1):
            sub = ts >> up  # the child's footprint inside its parent, in px
            if not unresolved or tile_z - up < 0 or sub < 1:
                break

            def grab(pxy: tuple[int, int]) -> tuple[tuple[int, int], Image.Image | None]:
                try:
                    url = tile_url(url_template, tile_z - up, pxy[0], pxy[1], zoom_offset)
                    return pxy, fetch(client, url)
                except Exception:
                    return pxy, None

            wanted = list({(tx >> up, ty >> up) for tx, ty in unresolved})
            with ThreadPoolExecutor(max_workers=6) as pool:
                parents = dict(pool.map(grab, wanted))
            served += sum(1 for img in parents.values() if img is not None)

            still: list[tuple[int, int]] = []
            mask = (1 << up) - 1
            for tx, ty in unresolved:
                parent = parents.get((tx >> up, ty >> up))
                if parent is None:
                    still.append((tx, ty))
                    continue
                qx, qy = (tx & mask) * sub, (ty & mask) * sub
                filled[(tx, ty)] = parent.crop((qx, qy, qx + sub, qy + sub)).resize(
                    (out_size, out_size), Image.Resampling.LANCZOS
                )
            unresolved = still
    return filled, served


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


def burn_attribution(img: Image.Image, text: str) -> Image.Image:
    """Append a footer band carrying the attribution line.

    For providers whose terms make attribution a condition of the allowed use
    (Google), the capture must never exist without it — burned in, not optional.
    The band is added *below* the imagery so nothing is covered. Public: the
    screenshot-capture endpoint stamps user screenshots through the same band.
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
