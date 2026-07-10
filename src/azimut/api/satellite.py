"""REST API for the Satellite tool: providers, capture crops, list captures."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..engine import geo, satellite as satellite_engine, tiles
from .cases import get_case

router = APIRouter(prefix="/api", tags=["satellite"])


class CaptureIn(BaseModel):
    lat: float = Field(ge=-90, le=90)  # crop frame center
    lon: float = Field(ge=-180, le=180)
    zoom: int = Field(ge=1, le=22)
    width: int = Field(default=1000, ge=256, le=2048)
    height: int = Field(default=700, ge=256, le=2048)
    provider: str = "esri-world-imagery"
    bearing: float = Field(default=0.0, ge=0, le=360)
    # marker (recorded point of interest): style + optional offset from center
    marker_style: str = Field(default="crosshair", pattern="^(crosshair|pin|none)$")
    marker_x: int = Field(default=0, ge=-2048, le=2048)
    marker_y: int = Field(default=0, ge=-2048, le=2048)
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
        }
        for p in tiles.all_providers()
    ]


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

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    name = f"sat_{stamp}_z{provenance['zoom']}_{provider.id}.png"
    rel_path = f"satellite/{name}"
    sat_dir = case.subdir("satellite")
    image.save(sat_dir / name, "PNG")
    # the recorded point is the marker (== center unless it was moved off-center)
    marker_lat, marker_lon = provenance["lat"], provenance["lon"]
    label = satellite_engine.coords_label(marker_lat, marker_lon)
    provenance["filename"] = name
    provenance["title"] = label
    provenance["plus_code"] = geo.plus_code(marker_lat, marker_lon)
    provenance["dms"] = geo.to_dms(marker_lat, marker_lon)
    (sat_dir / f"{name}.json").write_text(
        json.dumps(provenance, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    # a capture is an image artifact, mirrored by one ``capture`` entity tied by
    # its path (spec §3.5) — it carries the marker's coordinates as info but is
    # not a navigable point; saving a ``place`` (below) is the separate act for that
    case.add_entity(
        "capture",
        label,
        attrs={"coords": label, "lat": marker_lat, "lon": marker_lon,
               "plus_code": provenance["plus_code"], "path": rel_path,
               "zoom": provenance["zoom"], "bearing": body.bearing},
        by="satellite",
        status="confirmed",
    )

    return {"path": rel_path, **provenance}


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
    # also drops the mirrored place entity when its last capture is gone
    satellite_engine.delete_capture(get_case(case_id), path)
    return {"status": "deleted"}


@router.patch("/cases/{case_id}/satellite")
def update_capture(case_id: str, body: SatelliteUpdateIn) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        image_path = case.resolve_inside(body.path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    sidecar_path = image_path.with_name(image_path.name + ".json")
    if not sidecar_path.exists():
        raise HTTPException(status_code=404, detail="capture not found")

    data = json.loads(sidecar_path.read_text(encoding="utf-8"))
    if body.notes is not None:
        if body.notes == "":
            data.pop("notes", None)
        else:
            data["notes"] = body.notes
    if body.title is not None:
        # empty title falls back to the coordinates; keep entity label in sync
        title = body.title.strip() or satellite_engine.coords_label(
            data["lat"], data["lon"]
        )
        data["title"] = title
        entity = case.find_entity(attr="path", value=body.path)
        if entity:
            case.update_entity(entity["id"], {"label": title})
    sidecar_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    data["path"] = body.path
    return data
