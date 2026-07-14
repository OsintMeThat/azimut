"""REST API for the Satellite tool: providers, tile proxy, capture crops."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import config
from ..engine import geo, google_tiles, media as media_engine, satellite as satellite_engine, tiles
from ..workspace import CaseError
from .cases import get_case

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
    return [
        {
            "id": p.id,
            "label": p.label,
            "url": p.url,
            "attribution": p.attribution,
            "max_zoom": p.max_zoom,
            "needs_key": p.needs_key,
            "imagery": p.imagery,
            "capturable": p.capturable,
            "cacheable": p.cacheable,
            "session": p.session,
            "meter": p.meter,
            "tile_size": p.tile_size,
        }
        for p in tiles.all_providers()
    ]


@router.get("/tiles/{provider_id}/{z}/{x}/{y}")
def tile_proxy(provider_id: str, z: int, x: int, y: int) -> Response:
    """Live-map tiles for keyed providers, proxied through the app.

    Two reasons (docs/KEYED_PROVIDERS.md §3/§6): the API key and Google session
    token never reach the browser, and the meter counts *exactly* what the
    provider bills — one bump per tile actually served; a browser cache hit
    never reaches this endpoint, so it never over-counts. Nothing is stored
    server-side: the provider's own Cache-Control is passed through untouched.
    """
    try:
        provider = tiles.get_provider(provider_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    upstream: httpx.Response | None = None
    for attempt in (1, 2):
        try:
            url = tiles.resolve_url(provider).format(x=x, y=y, z=z)
        except tiles.TileFetchError as exc:
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

    if provider.meter and upstream.status_code < 400:
        config.record_usage(provider.meter, 1)
    headers = {}
    if upstream.headers.get("cache-control"):
        headers["Cache-Control"] = upstream.headers["cache-control"]
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "image/png"),
        headers=headers,
    )


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
    label = satellite_engine.coords_label(marker_lat, marker_lon)
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
            "coords": label, "lat": marker_lat, "lon": marker_lon,
            "plus_code": plus_code, "zoom": provenance["zoom"], "bearing": body.bearing,
        },
        title=label,
        dedupe=False,  # a capture is 1:1 with its entity — never collapse re-captures
    )

    return {"path": result["item"]["path"], "title": label, **provenance}


@router.post("/cases/{case_id}/satellite/place")
def save_place(case_id: str, body: PlaceIn) -> dict[str, Any]:
    """Save just a point (the pin, or the crop center) as a navigable ``place`` —
    no image. Clicking it in the sidebar flies the map back to it."""
    case = get_case(case_id)
    coords = satellite_engine.coords_label(body.lat, body.lon)
    label = (body.title or "").strip() or coords
    attrs = {"coords": coords, "lat": body.lat, "lon": body.lon,
             "plus_code": geo.plus_code(body.lat, body.lon),
             "zoom": body.zoom, "bearing": body.bearing}
    if body.notes and body.notes.strip():
        attrs["notes"] = body.notes.strip()
    return case.add_entity("place", label, attrs=attrs, by="satellite", status="confirmed")


@router.get("/cases/{case_id}/satellite")
def list_captures(case_id: str) -> list[dict[str, Any]]:
    return satellite_engine.list_captures(get_case(case_id))


@router.delete("/cases/{case_id}/satellite")
def delete_capture(case_id: str, path: str) -> dict[str, str]:
    # a capture is a media item: this drops the file + thumbnail + sidecar + entity
    case = get_case(case_id)
    try:
        media_engine.delete_media(case, path)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "deleted"}


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
