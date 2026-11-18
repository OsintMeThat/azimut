"""Maps put in a note: what can be mapped, and the block a put writes (`engine/notes_maps.py`).

A put names layers, a plate or a period of proofs. The server reads what they show,
frames the map on it (the plate's own view for a plate) and files the ground under it
the way Add › This view files a capture: tiles fetched once, on the press, stitched at
twice the frame's resolution, filed with its provider's credit, and cited again rather
than filed twice for the same view. The answer is the `::: map` block the note takes.

A plate's steps that frame the map closer than that ground holds each get a sharper
picture of their own frame (a ``detail``), so a step lands on ground as sharp as the
plate showed it; the answer lists every capture filed fresh, for Undo to take back.

When the imagery cannot be fetched (offline, a provider refusing), the block is still
written, with no ground, and the answer says so: the map draws on a plain background
until it is put in again.
"""

from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import layout
from ..engine import maplayers, notes_maps, tiles
from ..workspace import Case
from .cases import get_case

router = APIRouter(prefix="/api", tags=["notes"])

#: The frame a map is laid out in, in pixels at its view: an article's wide column.
FRAME_W, FRAME_H = 1200, 750
#: How much sharper than the frame the ground is filed, so a reader can zoom in, and a detail.
GROUND_GAIN = 2
DETAIL_GAIN = 1.5
#: How many zoom levels past the map's own a step looks before it gets a detail.
DETAIL_FROM = 1.2
#: The basemap a map's ground is taken from unless the put names another.
DEFAULT_PROVIDER = "esri-world-imagery"


class MapIn(BaseModel):
    title: str = Field(default="", max_length=notes_maps.MAX_TITLE)
    layers: list[str] = Field(default_factory=list, max_length=notes_maps.MAX_LAYERS)
    plate: str = Field(default="", max_length=120)
    #: `all`, a period `2026-09-01..2026-11-15` (either end open) or one day; "" for none.
    proofs: str = Field(default="", max_length=40)
    provider: str = Field(default=DEFAULT_PROVIDER, max_length=200)


@router.get("/cases/{case_id}/notes/maps/sources")
def map_sources(case_id: str) -> dict[str, Any]:
    """What a map can show: the case's layers, its plates, its proofs' days, and the
    imagery its ground can be taken from."""
    case = get_case(case_id)
    layers = []
    for row in maplayers.listing(case):
        layers.append({"name": row["name"], "title": row["title"], "features": row["features"],
                       "tracked": bool((row.get("track") or {}).get("on")), "bbox": row.get("bbox")})
    plates = []
    folder = case.tool_root / layout.MAPPLATE_DIR
    for path in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        plate = notes_maps._plate(case, path.stem)
        if plate is None:
            continue
        plates.append({"name": path.stem, "title": path.stem, "layers": len(plate["layers"]),
                       "steps": len(plate["steps"]), "days": len(plate["days"])})
    days = _proof_days(case)
    providers = [{"id": provider.id, "label": provider.label} for provider in tiles.all_providers()
                 if provider.capturable and not provider.widget and not provider.needs_key]
    return {"layers": layers, "plates": plates,
            "proofs": {"count": len(days), "first": min(days) if days else "", "last": max(days) if days else ""},
            "providers": providers, "provider": DEFAULT_PROVIDER}


def _proof_days(case: Case) -> list[str]:
    days: list[str] = []
    cursor: str | None = None
    while True:
        page = case.page_entities(types=["proof"], limit=500, cursor=cursor)
        for record in page.get("items", []):
            when = str(notes_maps._proof_spec(case, record).get("when") or "").rstrip("~")[:10]
            if notes_maps.DAY.match(when):
                days.append(when)
        cursor = page.get("next_cursor")
        if not cursor or len(days) > notes_maps.MAX_PROOFS:
            return days


@router.post("/cases/{case_id}/notes/maps")
def put_map(case_id: str, body: MapIn) -> dict[str, Any]:
    """The `::: map` block for what ``body`` names, its ground filed in the case."""
    case = get_case(case_id)
    if notes_maps.proof_period(body.proofs) is None and body.proofs.strip():
        raise HTTPException(status_code=422, detail="Write the proofs' period as 2026-09-01..2026-11-15, or all")
    block = notes_maps.MapBlock(title=" ".join(body.title.split()), layers=list(dict.fromkeys(body.layers)),
                                plate=body.plate.strip(), proofs=" ".join(body.proofs.split()))
    if block.empty():
        raise HTTPException(status_code=422, detail="Pick a layer, a plate or the proofs to map")
    derived = notes_maps.derive(case, block)
    gone = [message for message, kind, _ in derived.warnings if kind == "missing" and "no longer" in message]
    if gone:
        raise HTTPException(status_code=422, detail=gone[0])
    features = derived.data["features"]
    if not features and not block.plate:
        raise HTTPException(status_code=422, detail="There is nothing to draw: no feature or proof to map")
    if block.plate and derived.data.get("view"):
        lon, lat = derived.data["view"]["center"]
        zoom = float(derived.data["view"]["zoom"])
    else:
        lat, lon, zoom = _fit(features)
    block.view = (lat, lon, zoom, 0.0)
    warnings: list[str] = []
    ground, fresh = None, False
    filed: list[str] = []
    try:
        ground, fresh = _file_ground(case_id, lat, lon, zoom, body.provider)
        for step in _close_steps(derived.data.get("steps") or [], zoom):
            detail, made = _file_ground(case_id, step[0], step[1], step[2], body.provider, gain=DETAIL_GAIN)
            if str(detail["id"]) not in block.details:
                block.details.append(str(detail["id"]))
                if made:
                    filed.append(str(detail["id"]))
    except HTTPException as exc:
        if exc.status_code in (404, 422):
            raise
        warnings.append("The imagery could not be fetched, so the map has no ground. Put it in again once online."
                        if ground is None else "Some close-ups could not be fetched; those steps show the map's ground.")
    if ground is not None:
        block.ground = str(ground["id"])
        if fresh:
            filed.insert(0, str(ground["id"]))
    return {"text": notes_maps.block_text(block), "ground": ground, "fresh": fresh, "filed": filed,
            "view": {"lat": lat, "lon": lon, "zoom": round(zoom, 2)}, "features": len(features),
            "warnings": warnings}


def _close_steps(steps: list[dict[str, Any]], zoom: float) -> list[tuple[float, float, float]]:
    """The frames of the steps that look closer than the map's ground holds, one each
    however many steps share it, at most `notes_maps.MAX_DETAILS`."""
    frames: list[tuple[float, float, float]] = []
    for step in steps:
        view = step.get("view") or {}
        try:
            lon, lat = (float(value) for value in view["center"])
            close = float(view["zoom"])
        except (KeyError, TypeError, ValueError):
            continue
        if close < zoom + DETAIL_FROM:
            continue
        inside = any(abs(close - other[2]) < 0.6 and _within(lat, lon, other) for other in frames)
        if not inside:
            frames.append((lat, lon, close))
        if len(frames) >= notes_maps.MAX_DETAILS:
            break
    return frames


def _within(lat: float, lon: float, frame: tuple[float, float, float]) -> bool:
    west, south, east, north = notes_maps.bounds_of_view(frame[0], frame[1], frame[2], FRAME_W * 0.3, FRAME_H * 0.3)
    return west <= lon <= east and south <= lat <= north


def _fit(features: list[dict[str, Any]]) -> tuple[float, float, float]:
    points = list(notes_maps._all_points(features))
    west, east = min(point[0] for point in points), max(point[0] for point in points)
    south, north = min(point[1] for point in points), max(point[1] for point in points)
    if east - west < 1e-4 and north - south < 1e-4:
        return (south + north) / 2, (west + east) / 2, 15.0
    return notes_maps.fit_view([west, south, east, north], FRAME_W, FRAME_H, pad=0.07, most=16.0)


def _file_ground(case_id: str, lat: float, lon: float, zoom: float, provider_id: str,
                 gain: float = GROUND_GAIN) -> tuple[dict[str, Any], bool]:
    """The ground under a frame at ``zoom`` (the map engine's), filed as a capture: at a
    whole XYZ zoom deep enough to hold the frame `GROUND_GAIN` times as sharp."""
    from . import satellite

    try:
        provider = tiles.get_provider(provider_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not provider.capturable or provider.widget:
        raise HTTPException(status_code=422, detail=f"{provider.label} cannot be the ground of a map")
    xyz = zoom + 1
    level = min(provider.max_zoom, max(1, math.ceil(xyz + math.log2(gain))))
    while True:
        gain = 2 ** (level - xyz)
        width, height = round(FRAME_W * gain), round(FRAME_H * gain)
        if (width <= tiles.SIZE_MAX and height <= tiles.SIZE_MAX) or level <= 1:
            break
        level -= 1
    width = max(256, min(width, tiles.SIZE_MAX))
    height = max(256, min(height, tiles.SIZE_MAX))
    answer = satellite.capture(case_id, satellite.CaptureIn(
        lat=lat, lon=lon, zoom=level, width=width, height=height, provider=provider.id,
        marker_style="none", reuse=True,
    ))
    return answer["entity"], not answer.get("reused")
