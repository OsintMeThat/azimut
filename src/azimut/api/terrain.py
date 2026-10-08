"""Terrain heights: the relief tiles the 3D map draws, and heights at points.

The tiles are proxied for the same reasons imagery is (docs/IMAGERY_PROVIDERS.md):
one shared disk cache, and the fallback source chosen here rather than in the
browser. Nothing is asked of the network until a view needs relief.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

from ..engine import horizon, terrain

router = APIRouter(prefix="/api/terrain", tags=["terrain"])

# Terrain does not change between visits, so the browser may keep a tile a week.
TILE_CACHE_CONTROL = "private, max-age=604800"
MAX_PROFILE_POINTS = 100
MAX_PROFILE_SAMPLES = 2048


def _unavailable(exc: terrain.TerrainUnavailable) -> HTTPException:
    return HTTPException(status_code=502, detail=f"Terrain could not be loaded: {exc}")


@router.get("/sources")
def sources() -> dict[str, Any]:
    """What the map needs to draw relief, and who to credit for it."""
    return {
        "tiles": "/api/terrain/tiles/{z}/{x}/{y}",
        "tile_size": terrain.TILE,
        "max_zoom": terrain.PLANET_ZOOM,
        "encoding": "terrarium",
        "sources": [
            {"id": s.id, "label": s.label, "attribution": s.attribution, "link": s.link}
            for s in terrain.SOURCES
        ],
    }


@router.get("/tiles/{z}/{x}/{y}")
def terrain_tile(z: int, x: int, y: int) -> Response:
    """One relief tile for MapLibre. The sea comes back as a flat tile, not a hole."""
    if not 0 <= z <= terrain.PLANET_ZOOM:
        raise HTTPException(status_code=422, detail="terrain zoom out of range")
    if not (0 <= x < (1 << z) and 0 <= y < (1 << z)):
        raise HTTPException(status_code=422, detail="tile coordinates out of range")
    try:
        fetched = terrain.tile(z, x, y)
    except terrain.TerrainUnavailable as exc:
        raise _unavailable(exc) from exc
    content, media_type = (fetched[0], fetched[1]) if fetched else (terrain.sea_tile(), "image/png")
    return Response(
        content=content, media_type=media_type, headers={"Cache-Control": TILE_CACHE_CONTROL}
    )


@router.get("/elevation")
def elevation(
    lat: float = Query(ge=-terrain.MAX_LAT, le=terrain.MAX_LAT),
    lon: float = Query(ge=-180, le=180),
) -> dict[str, Any]:
    """Height of one point, for the readout under the cursor."""
    try:
        height, sampler = terrain.elevation_at(lat, lon)
    except terrain.TerrainUnavailable as exc:
        raise _unavailable(exc) from exc
    return {
        "lat": lat,
        "lon": lon,
        "elevation": round(height, 1),
        "resolution_m": sampler.resolution(lat),
        "credits": sampler.credits(),
    }


class ProfileIn(BaseModel):
    points: list[tuple[float, float]] = Field(min_length=2, max_length=MAX_PROFILE_POINTS)
    samples: int = Field(default=256, ge=2, le=MAX_PROFILE_SAMPLES)
    # Whether the last point can be seen from the first, an eye this high above
    # the first and a target this high above the last.
    sight: bool = False
    eye_height: float = Field(default=horizon.EYE_HEIGHT, ge=0, le=20_000)
    target_height: float = Field(default=0.0, ge=0, le=20_000)

    @field_validator("points")
    @classmethod
    def _on_the_map(cls, points: list[tuple[float, float]]) -> list[tuple[float, float]]:
        for lat, lon in points:
            if not (-terrain.MAX_LAT <= lat <= terrain.MAX_LAT and -180 <= lon <= 180):
                raise ValueError("a point is off the map")
        return points


@router.post("/profile")
def profile(body: ProfileIn) -> dict[str, Any]:
    """Heights along a drawn line, evenly spaced."""
    try:
        along, lat, lon, heights, sampler = terrain.profile(body.points, body.samples)
    except terrain.TerrainUnavailable as exc:
        raise _unavailable(exc) from exc
    mid_lat = float(lat.mean())
    answer: dict[str, Any] = {
        "distance_m": [round(float(d), 1) for d in along],
        "lat": [round(float(v), 6) for v in lat],
        "lon": [round(float(v), 6) for v in lon],
        "elevation": [round(float(h), 1) for h in heights],
        "resolution_m": sampler.resolution(mid_lat),
        "credits": sampler.credits(),
    }
    if body.sight:
        answer["sight"] = _sight(along, heights, body.eye_height, body.target_height)
    return answer


def _sight(
    along: np.ndarray, heights: np.ndarray, eye_height: float, target_height: float
) -> dict[str, Any]:
    """Whether the end of a profile is in sight from its start.

    Read on the same refraction-enlarged sphere as every horizon, from the
    profile's own samples. `bulge` is how far the Earth rises between the two
    ends at each sample, which is what a chart adds to the ground so the line
    of sight can be drawn straight.
    """
    eye = float(heights[0]) + eye_height
    span = float(along[-1])
    target = float(heights[-1]) + target_height
    aim = float(horizon.elevation_angle(span, target, eye))
    between = slice(1, -1)
    angles = horizon.elevation_angle(along[between], heights[between], eye)
    worst = int(np.argmax(angles)) if angles.size else -1
    margin = aim - float(angles[worst]) if angles.size else math.pi / 2
    radius = horizon.effective_radius()
    bulge = along * (span - along) / (2 * radius)
    return {
        "visible": margin >= 0,
        "margin_deg": round(math.degrees(margin), 4),
        "blocked_at_m": None if margin >= 0 else round(float(along[between][worst]), 1),
        "eye_m": round(eye, 1),
        "target_m": round(target, 1),
        "bulge_m": [round(float(b), 1) for b in bulge],
    }
