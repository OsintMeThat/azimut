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
from PIL import Image, ImageDraw

from .. import config

TILE_SIZE = 256
MAX_TILES_PER_CROP = 64  # hard cap: bounded requests per capture, polite to providers
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
    ),
)


def all_providers() -> list[Provider]:
    providers = list(BUILTIN_PROVIDERS)
    settings = config.load_settings()
    keys = settings.get("api_keys", {})
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
    zoom = min(zoom, provider.max_zoom)
    width, height = min(width, 2048), min(height, 2048)
    bearing = bearing % 360.0

    # A rotated crop needs a bigger north-up source so its corners stay covered
    # after rotation; the diagonal is the smallest square that always fits.
    if bearing:
        fetch_w = fetch_h = min(math.ceil(math.hypot(width, height)) + 2, 2048)
    else:
        fetch_w, fetch_h = width, height

    center_x, center_y = project(lat, lon, zoom)
    center_px, center_py = center_x * TILE_SIZE, center_y * TILE_SIZE
    left, top = center_px - fetch_w / 2, center_py - fetch_h / 2

    tile_x0, tile_y0 = int(left // TILE_SIZE), int(top // TILE_SIZE)
    tile_x1, tile_y1 = int((left + fetch_w) // TILE_SIZE), int((top + fetch_h) // TILE_SIZE)
    n_tiles = (tile_x1 - tile_x0 + 1) * (tile_y1 - tile_y0 + 1)
    if n_tiles > MAX_TILES_PER_CROP:
        raise TileFetchError(
            f"crop needs {n_tiles} tiles (max {MAX_TILES_PER_CROP}) — reduce size or zoom"
        )

    max_index = (1 << zoom) - 1
    fetch = fetch_tile or _default_fetch
    canvas = Image.new("RGB", (fetch_w, fetch_h), (24, 28, 38))
    missing = 0

    def grab(tx: int, ty: int) -> tuple[int, int, Image.Image | None]:
        if not (0 <= tx <= max_index and 0 <= ty <= max_index):
            return tx, ty, None
        url = provider.url.format(x=tx, y=ty, z=zoom)
        return tx, ty, fetch(client, url)

    with httpx.Client(
        headers={"User-Agent": USER_AGENT}, timeout=20, follow_redirects=True
    ) as client:
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(
                pool.map(
                    lambda xy: grab(*xy),
                    [
                        (tx, ty)
                        for ty in range(tile_y0, tile_y1 + 1)
                        for tx in range(tile_x0, tile_x1 + 1)
                    ],
                )
            )

    for tx, ty, tile in results:
        px, py = int(tx * TILE_SIZE - left), int(ty * TILE_SIZE - top)
        if tile is None:
            missing += 1
            continue
        canvas.paste(tile, (px, py))

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

    provenance = {
        "provider": provider.id,
        "provider_label": provider.label,
        "attribution": provider.attribution,
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
