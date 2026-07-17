"""REST API for the Satellite tool: providers, tile proxy, capture crops."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel, Field

from .. import config
from ..engine import (
    geo,
    google_tiles,
    media as media_engine,
    satellite as satellite_engine,
    sentinel,
    tilecache,
    tiles,
)
from ..workspace import CaseError
from .cases import delete_by_path, get_case

router = APIRouter(prefix="/api", tags=["satellite"])


class CaptureIn(BaseModel):
    lat: float = Field(ge=-90, le=90)  # crop frame center
    lon: float = Field(ge=-180, le=180)
    zoom: int = Field(ge=1, le=22)
    width: int = Field(default=1000, ge=256, le=tiles.SIZE_MAX)
    height: int = Field(default=700, ge=256, le=tiles.SIZE_MAX)
    provider: str = "esri-world-imagery"
    bearing: float = Field(default=0.0, ge=0, le=360)
    # acquisition date of the underlying imagery (Esri best-effort), resolved
    # client-side and recorded next to the capture timestamp (fetched_at)
    imagery_date: str | None = None
    # marker (recorded point of interest): style + optional offset from center
    marker_style: str = Field(default="crosshair", pattern="^(crosshair|pin|none)$")
    marker_x: int = Field(default=0, ge=-tiles.SIZE_MAX, le=tiles.SIZE_MAX)
    marker_y: int = Field(default=0, ge=-tiles.SIZE_MAX, le=tiles.SIZE_MAX)
    marker_lat: float | None = Field(default=None, ge=-90, le=90)
    marker_lon: float | None = Field(default=None, ge=-180, le=180)


class PlaceIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    zoom: int = Field(default=16, ge=1, le=22)
    bearing: float = Field(default=0.0, ge=0, le=360)
    title: str | None = None
    notes: str | None = None


class ParseIn(BaseModel):
    text: str


class SatelliteUpdateIn(BaseModel):
    path: str
    notes: str | None = None
    title: str | None = None


@router.get("/satellite/providers")
def providers() -> list[dict[str, Any]]:
    # the user's per-provider eco threshold (Settings) beats the provider's
    # own default; the frontend falls back to the global one when both absent
    eco_overrides = config.load_settings().get("eco_max_zooms", {})
    return [
        {
            "id": p.id,
            "label": p.label,
            "url": p.url,
            "attribution": p.attribution,
            "max_zoom": p.max_zoom,
            # deepest zoom with real pixels; null = same as max_zoom. The live
            # map hands it to Leaflet's maxNativeZoom, which magnifies the last
            # native tile instead of requesting one that doesn't exist.
            "max_native_zoom": p.max_native_zoom,
            "needs_key": p.needs_key,
            "imagery": p.imagery,
            "capturable": p.capturable,
            "cacheable": p.cacheable,
            "session": p.session,
            "meter": p.meter,
            "tile_size": p.tile_size,
            "oversample": p.oversample,
            "widget": p.widget,
            "eco_max_zoom": (
                p.eco_max_zoom
                if p.widget  # the widget's pinned 0 is not user-tunable
                else eco_overrides.get(p.meter, p.eco_max_zoom)
            ),
        }
        for p in tiles.all_providers()
    ]


def _sentinel_instance() -> str:
    key = (config.load_settings().get("api_keys") or {}).get("sentinelhub")
    if not key:
        raise HTTPException(status_code=404, detail="no Sentinel Hub key saved")
    return key


@router.get("/satellite/sentinel/layers")
def sentinel_layers(check: bool = False) -> dict[str, Any]:
    """The Sentinel-2 layers on offer.

    Without ``check`` this is the built-in catalogue and touches nothing —
    opening the Satellite tab must never phone out (local-first). ``check=true``
    asks the user's own instance what it really serves (GetCapabilities), which
    is the only authority: a configuration can rename or drop any of them.
    """
    if not check:
        return {
            "layers": [{"id": e.id, "label": e.label, "hint": e.hint} for e in sentinel.LAYERS],
            "source": "catalogue",
        }
    try:
        found = sentinel.capabilities_layers(_sentinel_instance())
    except HTTPException:
        raise
    except Exception as exc:
        # the catalogue still works — say why the real list is missing, don't fail
        return {
            "layers": [{"id": e.id, "label": e.label, "hint": e.hint} for e in sentinel.LAYERS],
            "source": "catalogue",
            "detail": f"could not read the instance's layers: {exc}",
        }
    if not found:
        return {
            "layers": [{"id": e.id, "label": e.label, "hint": e.hint} for e in sentinel.LAYERS],
            "source": "catalogue",
            "detail": "the instance listed no layers",
        }
    return {"layers": found, "source": "instance"}


@router.get("/satellite/sentinel/dates")
def sentinel_dates(lat: float, lon: float, start: str, end: str) -> dict[str, Any]:
    """Sentinel-2 acquisition dates over a point, newest first.

    User-triggered only (a date picker being opened/moved) — never on mount.
    Billed as one request on the sentinelhub meter: a WFS query is ~0.01 PU
    against a tile's 1 PU, but it is one request against the request quota, and
    the meter's job is to count what the account is charged for.
    """
    instance = _sentinel_instance()
    if config.usage_blocked("sentinelhub"):
        raise HTTPException(
            status_code=429,
            detail=f"Sentinel Hub is paused: {int(config.BLOCK_SHARE * 100)}% of the monthly "
            "free tier is used — enable the override in Settings to keep going",
        )
    try:
        found = sentinel.dates(instance, lat, lon, start, end)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"date lookup failed: {exc}") from exc
    config.record_usage("sentinelhub", 1)
    return {"dates": found, "start": start, "end": end}


@router.post("/satellite/usage/{meter}")
def record_widget_usage(meter: str) -> dict[str, Any]:
    """Count one billed *map load* for a widget basemap.

    Tile meters are counted server-side by the proxy, but a widget (Maps JS)
    instantiates in the browser — the frontend reports each instantiation
    here so the Settings counter stays a faithful mirror of Google's billing.
    """
    known = {p.meter for p in tiles.all_providers() if p.widget}
    if meter not in known:
        raise HTTPException(status_code=404, detail=f"no widget meter '{meter}'")
    return {"count": config.record_usage(meter, 1)}


def _serve_tile(
    provider: tiles.Provider, z: int, x: int, y: int
) -> tuple[bytes, str, dict[str, str]] | Response | None:
    """One tile: disk cache first (cacheable providers), then upstream.

    Returns ``(content, media_type, headers)`` for a served tile, ``None`` when
    the provider has no imagery there (404 or a known placeholder tile), or a
    passthrough ``Response`` for any other upstream error. The meter counts
    exactly what the provider billed: every upstream 2xx/3xx, never a cache hit.
    """
    if provider.cacheable:
        cached = tilecache.get(provider.id, z, x, y)
        if cached:
            return cached[0], cached[1], {"Cache-Control": "private, max-age=86400"}

    upstream: httpx.Response | None = None
    for attempt in (1, 2):
        try:
            url = tiles.tile_url(tiles.resolve_url(provider), z, x, y, provider.zoom_offset)
        except tiles.TileFetchError as exc:
            # a session mint that the provider *refused* (not a network hiccup)
            # is an auth verdict — Google's EEA policy block lands here with
            # its own sentence. Bench the basemap so it isn't offered dead.
            if provider.meter and isinstance(
                exc.__cause__, google_tiles.GoogleSessionError
            ):
                config.record_provider_status(provider.meter, False, str(exc.__cause__))
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        try:
            upstream = httpx.get(
                url, headers={"User-Agent": tiles.USER_AGENT}, timeout=20,
                follow_redirects=True,
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"tile fetch failed: {exc}") from exc
        # a stale Google session token answers 401/403 — re-mint once, transparently
        if attempt == 1 and provider.session and upstream.status_code in (401, 403):
            google_tiles.invalidate(google_tiles.key_from_url(provider.url))
            continue
        break

    if upstream.status_code == 404:
        return None
    if upstream.status_code >= 400:
        # a 401/403 that survived the re-mint retry names the key, not the
        # tile: record it (with the provider's own sentence when it sent one)
        # so the basemap stops being offered until the key changes or re-tests
        if provider.meter and upstream.status_code in (401, 403):
            config.record_provider_status(
                provider.meter, False, google_tiles.error_message(upstream)
            )
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type", "image/png"),
        )
    if provider.meter:
        config.record_usage(provider.meter, 1)
    if tiles.is_placeholder_tile(upstream.content):
        return None  # billed above (the provider did serve it), but not imagery
    media_type = upstream.headers.get("content-type", "image/png")
    if provider.cacheable:
        tilecache.put(provider.id, z, x, y, upstream.content, media_type)
    headers = {}
    if upstream.headers.get("cache-control"):
        headers["Cache-Control"] = upstream.headers["cache-control"]
    return upstream.content, media_type, headers


def _native_grid_zoom(provider: tiles.Provider) -> int | None:
    """The provider's native ceiling in *tile-grid* levels, or None if it has
    pixels everywhere it can be viewed.

    ``max_native_zoom`` is a view zoom, like ``max_zoom``; the proxy speaks the
    grid, which a big tile shifts down (512px → one level).
    """
    if provider.max_native_zoom is None:
        return None
    import math

    z_shift = int(math.log2(provider.tile_size // tiles.TILE_SIZE))
    return provider.max_native_zoom - z_shift


@router.get("/tiles/{provider_id}/{z}/{x}/{y}")
def tile_proxy(provider_id: str, z: int, x: int, y: int) -> Response:
    """Live-map tiles for every provider, proxied through the app.

    Why a proxy (docs/IMAGERY_PROVIDERS.md): API keys and the Google
    session token never reach the browser; the meter counts *exactly* what a
    billed provider serves (a browser cache hit never reaches this endpoint);
    cacheable providers get the shared disk tile cache; and coverage gaps
    (404s / "not yet available" placeholders) are overzoomed — the parent
    tile's quadrant upscaled — instead of breaking the map.
    """
    try:
        provider = tiles.get_provider(provider_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if provider.meter and config.usage_blocked(provider.meter):
        raise HTTPException(
            status_code=429,
            detail=f"{provider.label} is paused: {int(config.BLOCK_SHARE * 100)}% of the "
            "monthly free tier is used — enable the override in Settings to keep going",
        )

    # Past the provider's native ceiling there is nothing new upstream: Sentinel
    # Hub would upsample its own z14 pixels and bill every tile of it. Skip the
    # fetch and let the climb below magnify the native tile instead — same
    # pixels, no quota. The live map already stops asking (Leaflet's
    # maxNativeZoom), so this is the guard for anything that doesn't.
    native_z = _native_grid_zoom(provider)
    beyond_native = max(0, z - native_z) if native_z is not None else 0
    served = None if beyond_native else _serve_tile(provider, z, x, y)
    if isinstance(served, Response):
        return served
    if served is not None:
        content, media_type, headers = served
        return Response(content=content, media_type=media_type, headers=headers)

    # no imagery at this zoom — climb parents and upscale the matching quadrant
    import io

    first = max(1, beyond_native)
    for up in range(first, first + tiles.OVERZOOM_LEVELS):
        if z - up < 0:
            break
        parent = _serve_tile(provider, z - up, x >> up, y >> up)
        if parent is None or isinstance(parent, Response):
            continue
        image = Image.open(io.BytesIO(parent[0])).convert("RGB")
        sub = image.width >> up
        if sub < 1:
            break
        mask = (1 << up) - 1
        qx, qy = (x & mask) * sub, (y & mask) * sub
        tile = image.crop((qx, qy, qx + sub, qy + sub)).resize(
            (image.width, image.width), Image.Resampling.LANCZOS
        )
        buf = io.BytesIO()
        tile.save(buf, format="PNG")
        return Response(
            content=buf.getvalue(),
            media_type="image/png",
            # derived, cheap to rebuild from the cached parent — short-lived
            headers={"Cache-Control": "private, max-age=3600", "X-Azimut-Overzoom": str(up)},
        )
    raise HTTPException(status_code=404, detail="no imagery at this location/zoom")


@router.get("/satellite/imagery-date")
def imagery_date(lat: float, lon: float, zoom: int, provider: str = "esri-world-imagery") -> dict[str, Any]:
    """Best-effort acquisition date of the imagery under a point.

    Only Esri World Imagery exposes per-scene capture dates; for any other
    provider we report ``supported: false`` so the UI can hide the readout.
    """
    if provider != "esri-world-imagery":
        return {"supported": False, "date": None, "source": None}
    result = tiles.esri_capture_date(lat, lon, int(zoom))
    if result is None:  # metadata service unreachable
        return {"supported": True, "date": None, "source": None}
    return {"supported": True, **result}


@router.post("/geo/parse")
def parse_coordinates(body: ParseIn) -> dict[str, Any]:
    coords = geo.parse_coords(body.text)
    if not coords:
        raise HTTPException(status_code=422, detail="could not parse coordinates")
    lat, lon = coords
    return {
        "lat": lat,
        "lon": lon,
        "dms": geo.to_dms(lat, lon),
        "plus_code": geo.plus_code(lat, lon),
        "links": geo.map_links(lat, lon),
    }


@router.get("/geo/geocode")
def geocode(q: str) -> dict[str, Any]:
    query = q.strip()
    if not query:
        raise HTTPException(status_code=422, detail="empty query")
    result = geo.geocode(query)
    if not result:
        raise HTTPException(status_code=404, detail="no match for that place name")
    return result


@router.get("/geo/reverse")
def reverse(lat: float, lon: float) -> dict[str, Any]:
    result = geo.reverse_geocode(lat, lon)
    if not result:
        raise HTTPException(status_code=502, detail="reverse geocoding unavailable")
    return result


@router.post("/cases/{case_id}/satellite/capture")
def capture(case_id: str, body: CaptureIn) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        provider = tiles.get_provider(body.provider)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        image, provenance = tiles.fetch_crop(
            body.lat, body.lon, body.zoom, body.width, body.height,
            provider, bearing=body.bearing, marker_style=body.marker_style,
            marker_x=body.marker_x, marker_y=body.marker_y,
            marker_lat=body.marker_lat, marker_lon=body.marker_lon,
        )
    except tiles.TileFetchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # network / provider failure
        raise HTTPException(status_code=502, detail=f"tile fetch failed: {exc}") from exc

    # the recorded point is the marker (== center unless it was moved off-center)
    marker_lat, marker_lon = provenance["lat"], provenance["lon"]
    label = satellite_engine.coords_label(marker_lat, marker_lon)  # user's format
    coords_dd = satellite_engine.coords_label(marker_lat, marker_lon, "dd")
    plus_code = geo.plus_code(marker_lat, marker_lon)
    provenance["plus_code"] = plus_code
    provenance["dms"] = geo.to_dms(marker_lat, marker_lon)
    # two dates ride with a capture: fetched_at (when it was captured, set by
    # fetch_crop) and imagery_date (when the satellite scene was shot, if known)
    provenance["imagery_date"] = (body.imagery_date or "").strip() or None

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"sat_{stamp}_z{provenance['zoom']}_{provider.id}.png"

    # A capture is filed through the media pipeline so it lands in media/ (hashed,
    # thumbnailed, shown in the Media Library, openable in Inspect), but under a
    # ``capture`` entity carrying its coordinates (spec §3.5). The full capture
    # provenance rides on the media sidecar's ``source`` (type "satellite").
    result = media_engine.import_image(
        case,
        image,
        filename,
        {"type": "satellite", **provenance},
        by="satellite",
        entity_type="capture",
        extra_attrs={
            "coords": coords_dd, "lat": marker_lat, "lon": marker_lon,
            "plus_code": plus_code, "zoom": provenance["zoom"], "bearing": body.bearing,
        },
        title=label,
        dedupe=False,  # a capture is 1:1 with its entity — never collapse re-captures
    )

    return {"path": result["item"]["path"], "title": label, **provenance}


@router.post("/cases/{case_id}/satellite/screenshot")
async def capture_screenshot(
    case_id: str,
    image: UploadFile,
    lat: float = Form(ge=-90, le=90),
    lon: float = Form(ge=-180, le=180),
    zoom: int = Form(ge=1, le=22),
    provider: str = Form(),
    bearing: float = Form(default=0.0, ge=0, le=360),
    framed: bool = Form(default=False),
) -> dict[str, Any]:
    """File a user-made screenshot of a widget basemap as a capture.

    Widget providers (Google Maps JS) have no tiles to stitch, and the only
    image Google's terms allow out of the widget is a screenshot the user took
    themselves (Geo Guidelines: permitted with attribution). So the frontend
    grabs the screen and this endpoint files it like any capture — attribution
    burned into a footer band (never optional for Google), provenance marked
    ``method: "screenshot"``.

    ``framed`` is what keeps that provenance honest, and the two paths differ:
    a screen crop taken through the capture frame is registered, so ``lat``/
    ``lon`` are the *centre of the crop*; a pasted or dropped screenshot is
    not, so they only describe the *map view when it was filed*. Readers of the
    provenance must be able to tell which they are holding.
    """
    case = get_case(case_id)
    try:
        prov = tiles.get_provider(provider)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not prov.widget:
        # tile providers have the real capture path — a screenshot would only
        # launder away its provenance
        raise HTTPException(status_code=422, detail="screenshot captures are for widget basemaps")

    import io

    raw = await image.read()
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"not a readable image: {exc}") from exc

    year = datetime.now(timezone.utc).year
    attribution = f"Map data ©{year} Google"
    img = tiles.burn_attribution(img, attribution)

    label = satellite_engine.coords_label(lat, lon)
    coords_dd = satellite_engine.coords_label(lat, lon, "dd")
    plus_code = geo.plus_code(lat, lon)
    provenance: dict[str, Any] = {
        "provider": prov.id,
        "provider_label": prov.label,
        "method": "screenshot",  # user-taken screen pixels, not a stitched crop
        # True: lat/lon are the centre of a registered crop frame.
        # False: they are only the map view at filing time (pasted image).
        "framed": framed,
        "lat": lat,
        "lon": lon,
        "zoom": zoom,
        "bearing": bearing,
        "attribution": attribution,
        "attribution_burned": True,
        "plus_code": plus_code,
        "dms": geo.to_dms(lat, lon),
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "width": img.width,
        "height": img.height,
    }

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"sat_{stamp}_z{zoom}_{prov.id}_screenshot.png"
    result = media_engine.import_image(
        case,
        img,
        filename,
        {"type": "satellite", **provenance},
        by="satellite",
        entity_type="capture",
        extra_attrs={
            "coords": coords_dd, "lat": lat, "lon": lon,
            "plus_code": plus_code, "zoom": zoom, "bearing": bearing,
        },
        title=label,
        dedupe=False,
    )
    return {"path": result["item"]["path"], "title": label, **provenance}


@router.post("/cases/{case_id}/satellite/place")
def save_place(case_id: str, body: PlaceIn) -> dict[str, Any]:
    """Save just a point (the pin, or the crop center) as a navigable ``place`` —
    no image. Clicking it in the sidebar flies the map back to it."""
    case = get_case(case_id)
    label = (body.title or "").strip() or satellite_engine.coords_label(body.lat, body.lon)
    attrs = {"coords": satellite_engine.coords_label(body.lat, body.lon, "dd"),
             "lat": body.lat, "lon": body.lon,
             "plus_code": geo.plus_code(body.lat, body.lon),
             "zoom": body.zoom, "bearing": body.bearing}
    if body.notes and body.notes.strip():
        attrs["notes"] = body.notes.strip()
    return case.add_entity("place", label, attrs=attrs, by="satellite", status="confirmed")


@router.get("/cases/{case_id}/satellite")
def list_captures(case_id: str) -> list[dict[str, Any]]:
    return satellite_engine.list_captures(get_case(case_id))


@router.delete("/cases/{case_id}/satellite")
def delete_capture(case_id: str, path: str) -> dict[str, Any]:
    # a capture is a media item: the chokepoint drops the file + thumbnail +
    # sidecar + entity, and honours whatever derives from or depends on it.
    case = get_case(case_id)
    try:
        result = delete_by_path(case, path)
        if not result["deleted"]:  # never filed as an entity: drop the files anyway
            media_engine.delete_media_files(case, path)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@router.patch("/cases/{case_id}/satellite")
def update_capture(case_id: str, body: SatelliteUpdateIn) -> dict[str, Any]:
    case = get_case(case_id)
    item = media_engine.read_item(case, body.path)
    if item is None:
        raise HTTPException(status_code=404, detail="capture not found")
    patch: dict[str, Any] = {}
    if body.notes is not None:
        patch["notes"] = body.notes
    # empty title falls back to the coordinates (mirrored onto the entity label)
    if body.title is not None:
        source = item.get("source") or {}
        patch["title"] = body.title.strip() or satellite_engine.coords_label(
            source.get("lat"), source.get("lon")
        )
    try:
        updated = media_engine.update_media(case, body.path, patch)
    except (ValueError, CaseError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # flatten the capture provenance up, like the listing does, so the client
    # gets the same shape back as GET /satellite
    return {**(updated.get("source") or {}), **updated}
