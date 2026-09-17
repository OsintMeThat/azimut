"""Compare recipes, saved areas, follow-ups and immutable analysis runs."""

from __future__ import annotations

import io
import secrets
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from PIL import Image, ImageDraw, ImageFont
from pydantic import Field

from .. import config
from ..engine import analyzers as engine
from ..engine import media, workqueue
from ..engine.analysis_models import BUILTINS, METHODS, Model, Recipe, RunInput, ZoneSet
from .cases import delete_by_path, delete_entity_deep, get_case

router = APIRouter(prefix="/api", tags=["analyzers"])


@router.get("/compare/analyzers")
def recipes() -> dict[str, Any]:
    custom = []
    for raw in config.load_settings().get("analyzers", []):
        try:
            custom.append(Recipe.model_validate(raw).model_dump())
        except ValueError:
            continue
    return {"builtins": [r.model_dump() for r in BUILTINS], "custom": custom, "methods": METHODS,
            "max_tiles": engine.MAX_TILES, "max_results": engine.MAX_RESULTS,
            "grid": list(engine.GRID)}


@router.post("/compare/analyzers")
def save_recipe(body: Recipe) -> dict[str, Any]:
    if body.id in {r.id for r in BUILTINS} or body.id == "custom":
        body = body.model_copy(update={"id": f"custom-{secrets.token_hex(6)}"})

    def update(settings: dict[str, Any]) -> None:
        saved = [r for r in settings.get("analyzers", []) if r.get("id") != body.id]
        if len(saved) >= 100:
            raise HTTPException(409, "the analyzer library is full; remove an unused recipe")
        settings["analyzers"] = [*saved, body.model_dump()]

    config.update_settings(update)
    return body.model_dump()


@router.delete("/compare/analyzers/{ident}")
def delete_recipe(ident: str) -> dict[str, bool]:
    def update(settings: dict[str, Any]) -> None:
        settings["analyzers"] = [r for r in settings.get("analyzers", []) if r.get("id") != ident]
    config.update_settings(update)
    return {"deleted": True}


Kind = Literal["zones", "followups", "runs"]


def read(case: Any, kind: str, ident: str) -> dict[str, Any]:
    try:
        return engine.read(case, kind, ident)
    except FileNotFoundError as exc:
        raise HTTPException(404, "analysis item not found") from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(422, "analysis item is unreadable") from exc


@router.get("/cases/{case_id}/analysis/{kind}")
def list_items(case_id: str, kind: Kind) -> list[dict[str, Any]]:
    return engine.listing(get_case(case_id), kind)


@router.get("/cases/{case_id}/analysis/{kind}/{ident}")
def load_item(case_id: str, kind: Kind, ident: str) -> dict[str, Any]:
    return read(get_case(case_id), kind, ident)


@router.post("/cases/{case_id}/analysis/zones")
def save_zones(case_id: str, body: ZoneSet) -> dict[str, Any]:
    return engine.save(get_case(case_id), "zones", body.model_dump())


@router.put("/cases/{case_id}/analysis/zones/{ident}")
def update_zones(case_id: str, ident: str, body: ZoneSet) -> dict[str, Any]:
    case = get_case(case_id)
    read(case, "zones", ident)
    return engine.save(case, "zones", body.model_dump(), ident)


@router.post("/cases/{case_id}/analysis/followups")
def save_followup(case_id: str, body: RunInput) -> dict[str, Any]:
    data = body.model_dump()
    data["followup_id"] = None
    return engine.save(get_case(case_id), "followups", data)


@router.put("/cases/{case_id}/analysis/followups/{ident}")
def update_followup(case_id: str, ident: str, body: RunInput) -> dict[str, Any]:
    case = get_case(case_id)
    read(case, "followups", ident)
    return engine.save(case, "followups", body.model_dump(), ident)


@router.post("/cases/{case_id}/analysis/runs")
def start_run(case_id: str, body: RunInput) -> dict[str, Any]:
    case = get_case(case_id)
    with engine.LOCK, case._lock:
        if any(row.get("status") in engine.ACTIVE for row in engine.listing(case, "runs")):
            raise HTTPException(409, "an analysis is already queued or running in this case")
        if body.followup_id:
            read(case, "followups", body.followup_id)
        try:
            planned = engine.plan(body)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        saved = engine.save(case, "runs", {"title": body.title, "input": body.model_dump(),
                            "status": "queued", "progress": 0, "total": len(planned),
                            "results": [], "frames": {}, "count": 0, "message": ""})
        workqueue.enqueue(case, engine.JOB, key=saved["id"], payload={"run_id": saved["id"]})
        return saved


@router.post("/cases/{case_id}/analysis/runs/{ident}/cancel")
def cancel_run(case_id: str, ident: str) -> dict[str, Any]:
    case = get_case(case_id)
    with engine.LOCK, case._lock:
        saved = read(case, "runs", ident)
        if saved["status"] in engine.ACTIVE:
            saved.update(status="cancelled", updated_at=engine.now())
            media.write_json_atomic(case.resolve_inside(engine.relpath("runs", ident)), saved)
        return saved


@router.delete("/cases/{case_id}/analysis/{kind}/{ident}")
def delete_item(case_id: str, kind: Kind, ident: str) -> dict[str, Any]:
    case = get_case(case_id)
    with engine.LOCK, case._lock:
        saved = read(case, kind, ident)
        if saved.get("status") in engine.ACTIVE:
            raise HTTPException(409, "cancel the analysis before deleting it")
        return delete_by_path(case, engine.relpath(kind, ident))


class Review(Model):
    # A candidate is "new" until an analyst looks at it. "kept" is set by
    # promotion, which is the act of keeping: nothing reaches the case without
    # it, so the two cannot drift apart.
    review: Literal["dismissed", "new"]


def result_of(saved: dict[str, Any], result_id: str) -> dict[str, Any]:
    if saved.get("status") != "ready":
        raise HTTPException(409, "results are available after the complete analysis")
    found = next((r for r in saved["results"] if r["id"] == result_id), None)
    if found is None:
        raise HTTPException(404, "candidate not found")
    return found


@router.patch("/cases/{case_id}/analysis/runs/{ident}/results/{result_id}")
def review_result(case_id: str, ident: str, result_id: str, body: Review) -> dict[str, Any]:
    case = get_case(case_id)
    with engine.LOCK, case._lock:
        saved = read(case, "runs", ident)
        result = result_of(saved, result_id)
        if kept_entity(case, result):
            raise HTTPException(409, "this candidate is a pin in the case; remove the pin first")
        result.update(review=body.review, reviewed_at=engine.now(), entity_id=None)
        engine.persist_run(case, saved)
        return result


# A candidate is a handful of pixels: a 30 m vessel is three of them. Blowing
# the crop up on the server, by a whole number and with no interpolation, is
# what makes it legible — the browser would otherwise stretch a 40 px thumbnail
# across the column and smear it. Nearest neighbour keeps every pixel square and
# invents nothing, so what is on screen is still the sensor's own reading.
PREVIEW_EDGE = 320
PREVIEW_MARGIN = 20
# The most of the sweep one preview shows, in source pixels. A burn scar can be
# kilometres across; past this the crop is centred on the candidate.
PREVIEW_SPAN = 1024


def source_label(source: dict[str, Any]) -> str:
    if source.get("provider") == "esri-wayback":
        return f"Release {source.get('release')}"
    return str(source.get("date") or "Sentinel-2")


def kept_entity(case: Any, result: dict[str, Any]) -> dict[str, Any] | None:
    """The pin a kept candidate put in the case, if it is still there."""
    ident = result.get("entity_id")
    return case.get_entity(ident) if ident else None


def _tile_image(case: Any, saved: dict[str, Any], source: dict[str, Any],
                tile: tuple[int, int, int]) -> Image.Image | None:
    for record in saved["frames"].values():
        if record.get("index") is None and tuple(record["tile"]) == tile and \
                record["source"] == source:
            path = case.resolve_inside(record["path"])
            if path.is_file():
                with Image.open(path) as image:
                    if max(image.size) > 512:
                        raise HTTPException(422, "evidence frame has an unexpected size")
                    return image.convert("RGB")
    return None


def preview_bytes(case: Any, saved: dict[str, Any], result: dict[str, Any]) -> bytes:
    """One picture per date, stitched across every tile the candidate touches.

    A candidate that crosses a tile edge is still one thing, so it is shown as
    one: the tiles its parts came from are laid side by side on the sweep's own
    grid, and a neighbour the sweep kept no copy of is left dark rather than
    guessed at.
    """
    first = saved["frames"].get(result["parts"][0]["frames"][0])
    if first is None:
        raise HTTPException(404, "candidate evidence is missing")
    z = first["tile"][0]
    with Image.open(case.resolve_inside(first["path"])) as image:
        size = image.width
    sources = [saved["frames"][key]["source"] for key in result["parts"][0]["frames"]]
    boxes = []
    for part in result["parts"]:
        record = saved["frames"].get(part["frames"][0])
        if record is None:
            continue
        _, tx, ty = record["tile"]
        x, y, width, height = part["box"]
        boxes.append((tx * size + x, ty * size + y, tx * size + x + width, ty * size + y + height))
    if not boxes:
        raise HTTPException(404, "candidate evidence is missing")
    left = min(b[0] for b in boxes) - PREVIEW_MARGIN
    top = min(b[1] for b in boxes) - PREVIEW_MARGIN
    right = max(b[2] for b in boxes) + PREVIEW_MARGIN
    bottom = max(b[3] for b in boxes) + PREVIEW_MARGIN
    if right - left > PREVIEW_SPAN:
        centre = (left + right) // 2
        left, right = centre - PREVIEW_SPAN // 2, centre + PREVIEW_SPAN // 2
    if bottom - top > PREVIEW_SPAN:
        centre = (top + bottom) // 2
        top, bottom = centre - PREVIEW_SPAN // 2, centre + PREVIEW_SPAN // 2

    crops = []
    for source in sources:
        canvas = Image.new("RGB", (right - left, bottom - top), (20, 24, 32))
        for ty in range(top // size, (bottom - 1) // size + 1):
            for tx in range(left // size, (right - 1) // size + 1):
                tile = _tile_image(case, saved, source, (z, tx, ty))
                if tile is not None:
                    canvas.paste(tile, (tx * size - left, ty * size - top))
        crops.append(canvas)
    edge = max(max(crop.size) for crop in crops)
    zoom = max(1, min(12, round(PREVIEW_EDGE / edge))) if edge else 1
    if zoom > 1:
        crops = [crop.resize((crop.width * zoom, crop.height * zoom), Image.Resampling.NEAREST)
                 for crop in crops]
    elif edge > PREVIEW_EDGE:
        for crop in crops:
            crop.thumbnail((PREVIEW_EDGE, PREVIEW_EDGE))

    gap = 8
    band = 24
    font = ImageFont.load_default(size=15)
    small = ImageFont.load_default(size=12)
    # A pair is labelled the way the maps are; a single image has no other half
    # to tell it apart from, so it says which image it is instead.
    labels = ["A", "B"] if len(crops) > 1 else [source_label(saved["input"]["b"])]
    body = max(crop.height for crop in crops)
    preview = Image.new("RGB", (sum(c.width for c in crops) + gap * (len(crops) - 1),
                                body + band * 2), (20, 24, 32))
    drawing = ImageDraw.Draw(preview)
    offset = 0
    for label, crop in zip(labels, crops):
        preview.paste(crop, (offset, band))
        drawing.text((offset + 4, 4), label, fill="white", font=font)
        offset += crop.width + gap
    attribution = ("Esri World Imagery Wayback" if saved["input"]["b"].get("provider") ==
                   "esri-wayback" else "Copernicus Sentinel data / Sentinel Hub")
    drawing.text((4, band + body + 5), attribution, fill="#c8ced6", font=small)
    output = io.BytesIO()
    preview.save(output, "PNG")
    return output.getvalue()


@router.get("/cases/{case_id}/analysis/runs/{ident}/results/{result_id}/preview")
def preview(case_id: str, ident: str, result_id: str) -> Response:
    case = get_case(case_id)
    saved = read(case, "runs", ident)
    result = result_of(saved, result_id)
    return Response(preview_bytes(case, saved, result), media_type="image/png")


class Promotion(Model):
    title: str = Field(min_length=1, max_length=120)


@router.post("/cases/{case_id}/analysis/runs/{ident}/results/{result_id}/promote")
def promote(case_id: str, ident: str, result_id: str, body: Promotion) -> dict[str, Any]:
    """Keep one candidate: the single act that puts it in the case.

    Keeping *is* the review, so it records the verdict itself rather than
    asking for a separate one. A sweep of a hundred candidates leaves nothing
    behind but the ones an analyst chose here, one at a time.
    """
    case = get_case(case_id)
    with engine.LOCK, case._lock:
        saved = read(case, "runs", ident)
        result = result_of(saved, result_id)
        existing = kept_entity(case, result)
        if existing:
            return {"entity": existing, "result": result}
        # The promoted copy carries its own before/after and provenance so
        # deleting the working run cannot remove evidence used by the case.
        source = {"type": "compare", "analysis_run": ident, "candidate_id": result_id,
                  "input": saved["input"], "candidate": result, "engine_version": saved["engine_version"]}
        filed = media.import_rendered_bytes(case, preview_bytes(case, saved, result),
                                            body.title, ".png", source, by="compare")
        lon, lat = result["coordinates"]
        entity = case.add_entity("place", body.title, attrs={"lat": lat, "lon": lon,
                                 "zoom": 16, "analysis_run": ident, "candidate_id": result_id,
                                 "geometry": result["geometry"], "evidence": filed["item"]["path"],
                                 "analysis_provenance": source}, by="compare")
        result.update(entity_id=entity["id"], review="kept", reviewed_at=engine.now())
        engine.persist_run(case, saved)
        return {"entity": entity, "image": filed["item"]["path"], "result": result}


@router.delete("/cases/{case_id}/analysis/runs/{ident}/results/{result_id}/promote")
def unpromote(case_id: str, ident: str, result_id: str) -> dict[str, Any]:
    """Undo keeping: the pin and its evidence go to Trash, the candidate returns."""
    case = get_case(case_id)
    with engine.LOCK, case._lock:
        saved = read(case, "runs", ident)
        result = result_of(saved, result_id)
        entity = kept_entity(case, result)
        removed = delete_entity_deep(case, entity["id"]) if entity else None
        result.update(entity_id=None, review="new", reviewed_at=engine.now())
        engine.persist_run(case, saved)
        return {"result": result, "deleted": removed}
