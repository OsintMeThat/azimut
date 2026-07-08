"""REST API for the Satellite tool: providers, capture crops, list captures."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..engine import geo, tiles
from .cases import get_case

router = APIRouter(prefix="/api", tags=["satellite"])


class CaptureIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    zoom: int = Field(ge=1, le=22)
    width: int = Field(default=1000, ge=256, le=2048)
    height: int = Field(default=700, ge=256, le=2048)
    provider: str = "esri-world-imagery"
    crosshair: bool = True


class ParseIn(BaseModel):
    text: str


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
            provider, crosshair=body.crosshair,
        )
    except tiles.TileFetchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # network / provider failure
        raise HTTPException(status_code=502, detail=f"tile fetch failed: {exc}") from exc

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    name = f"sat_{stamp}_z{provenance['zoom']}_{provider.id}.png"
    sat_dir = case.subdir("satellite")
    image.save(sat_dir / name, "PNG")
    provenance["filename"] = name
    provenance["plus_code"] = geo.plus_code(body.lat, body.lon)
    provenance["dms"] = geo.to_dms(body.lat, body.lon)
    (sat_dir / f"{name}.json").write_text(
        json.dumps(provenance, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    # suggest a place entity — analyst confirms or dismisses (spec §3.5)
    label = f"{body.lat:.5f}, {body.lon:.5f}"
    if not case.find_entity(attr="coords", value=label):
        case.add_entity(
            "place",
            label,
            attrs={"coords": label, "lat": body.lat, "lon": body.lon,
                   "plus_code": provenance["plus_code"]},
            by="satellite",
            status="suggested",
        )

    return {"path": f"satellite/{name}", **provenance}


@router.get("/cases/{case_id}/satellite")
def list_captures(case_id: str) -> list[dict[str, Any]]:
    case = get_case(case_id)
    sat_dir = case.subdir("satellite")
    captures = []
    for sidecar in sorted(sat_dir.glob("*.png.json")):
        image_name = sidecar.name[: -len(".json")]
        if not (sat_dir / image_name).exists():
            continue
        data = json.loads(sidecar.read_text(encoding="utf-8"))
        data["path"] = f"satellite/{image_name}"
        captures.append(data)
    captures.sort(key=lambda d: d.get("fetched_at") or "", reverse=True)
    return captures


@router.delete("/cases/{case_id}/satellite")
def delete_capture(case_id: str, path: str) -> dict[str, str]:
    case = get_case(case_id)
    image = case.resolve_inside(path)
    image.unlink(missing_ok=True)
    image.with_name(image.name + ".json").unlink(missing_ok=True)
    return {"status": "deleted"}
