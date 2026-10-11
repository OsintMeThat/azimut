"""Buildings round Horizon's eye: what the area holds so far, its tiles, and the yes to a download.

The view asks for the area (`GET /api/horizon/buildings`) only while its
Buildings row is on, and again every second or so while tiles are still coming
in; then for the tiles that are ready, in batches, as engine/buildings/wire.py
writes them. 3D-GloBFP's grids are downloaded only after `POST .../allow`, which
the view sends when the analyst says yes to the size it showed them.
"""

from __future__ import annotations

import struct

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..engine.buildings import model, service
from .horizon import TILES_MAX, _tile_keys

router = APIRouter(prefix="/api/horizon/buildings", tags=["horizon"])


def _sources(sources: str | None) -> list[str] | None:
    """The sources asked for, checked at the edge; None means every one."""
    if sources is None:
        return None
    asked = [part for part in sources.split(",") if part]
    unknown = [part for part in asked if part not in model.SOURCES]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown building source: {', '.join(unknown)}")
    return asked


@router.get("")
def area(
    lat: float = Query(ge=-85.0, le=85.0),
    lon: float = Query(ge=-180.0, le=180.0),
    radius: float = Query(ge=service.RADIUS_MIN, le=service.RADIUS_MAX),
    sources: str | None = Query(default=None, max_length=60),
) -> dict:
    """What the tiles round the eye hold so far, what they wait for, and whose buildings they are."""
    return service.status(lat, lon, radius, _sources(sources))


@router.get("/tiles")
def tiles(t: str = Query(max_length=TILES_MAX * 24), sources: str | None = Query(default=None, max_length=60)) -> Response:
    """Ready tiles' buildings in one answer: for each key in order, a u32 length (0: not ready) and the bytes."""
    keys = _tile_keys(t, model.ZOOM)
    if any(z != model.ZOOM for z, _x, _y in keys):
        raise HTTPException(status_code=422, detail=f"Buildings are served as zoom {model.ZOOM} tiles")
    found = service.tile_bytes(keys, _sources(sources))
    body = b"".join(struct.pack("<I", len(found[key] or b"")) + (found[key] or b"") for key in keys)
    return Response(content=body, media_type="application/octet-stream")


class AllowIn(BaseModel):
    grids: list[str] = Field(min_length=1, max_length=40)


@router.post("/allow")
def allow(body: AllowIn) -> dict:
    """The analyst agreed to these 3D-GloBFP grids' sizes: they download, one after another."""
    return {"started": service.allow(body.grids)}


@router.get("/at")
def at(
    lat: float = Query(ge=-85.0, le=85.0),
    lon: float = Query(ge=-180.0, le=180.0),
    sources: str | None = Query(default=None, max_length=60),
) -> dict:
    """The building drawn at a point: its height, and whose footprint and height they are."""
    found = service.building_at(lat, lon, _sources(sources))
    if found is None:
        raise HTTPException(status_code=404, detail="No building is drawn here")
    return found


@router.delete("/cache")
def clear() -> dict:
    """Forget every building kept on this machine; the next view reads them again."""
    return {"freed": service.clear()}
