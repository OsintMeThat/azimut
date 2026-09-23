"""Compare recipes, saved areas, follow-ups and immutable analysis runs."""

from __future__ import annotations

import io
import math
import secrets
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from PIL import Image, ImageDraw, ImageFont
from pydantic import Field, ValidationError

from .. import config
from ..engine import analyzers as engine
from ..engine import analysis_export, analysis_geometry, media, workqueue
from ..engine.analysis_models import (
    BUILTINS, GROUPS, METHODS, RELIABILITY, SINGLE_METHODS, Area, AreaDates, AreaGeometry, Model, Recipe,
    RunInput, ShortId, Source, Zone, ZoneSet,
)
from .cases import delete_by_path, delete_entity_deep, get_case

router = APIRouter(prefix="/api", tags=["analyzers"])


@router.get("/compare/analyzers")
def recipes() -> dict[str, Any]:
    settings = config.load_settings()
    custom = []
    for raw in settings.get("analyzers", []):
        try:
            custom.append(Recipe.model_validate(raw).model_dump())
        except ValueError:
            continue
    return {"builtins": [r.model_dump() for r in BUILTINS], "custom": custom, "methods": METHODS,
            "max_tiles": engine.MAX_TILES, "max_results": engine.MAX_RESULTS,
            "grid": list(engine.GRID),
            # what is locked: every analyzer without a Copernicus key, the
            # radar ones until Settings has found their layer
            "copernicus_key": bool((settings.get("api_keys") or {}).get("sentinelhub")),
            "radar_layer": str(settings.get("sentinel1_layer") or ""),
            "groups": [{"id": ident, "label": label, "recipes": members}
                       for ident, label, members in GROUPS],
            "reliability": RELIABILITY}


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


Kind = Literal["areas", "zones", "followups", "runs"]


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


@router.post("/cases/{case_id}/analysis/areas")
def save_area(case_id: str, body: Area) -> dict[str, Any]:
    return engine.save(get_case(case_id), "areas", body.model_dump())


@router.put("/cases/{case_id}/analysis/areas/{ident}")
def update_area(case_id: str, ident: str, body: Area) -> dict[str, Any]:
    case = get_case(case_id)
    read(case, "areas", ident)
    return engine.save(case, "areas", body.model_dump(), ident)


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


def start(case: Any, body: RunInput) -> dict[str, Any]:
    """Queue one run. Runs of a case wait their turn behind each other, so a
    whole list of saved detections can be started at once; only the same
    detection twice is refused, since the second would sweep what the first
    is already sweeping."""
    with engine.LOCK, case._lock:
        body = engine.hydrate(case, body)
        if body.followup_id:
            read(case, "followups", body.followup_id)
            if any(row.get("status") in engine.ACTIVE and row.get("followup_id") == body.followup_id
                   for row in engine.listing(case, "runs")):
                raise HTTPException(409, "this detection is already queued or running")
        try:
            plans = [engine.plan(engine.for_area(body, zone)) for zone in body.zones]
            if sum(map(len, plans)) > engine.MAX_TILES:
                raise ValueError("areas exceed the tile limit; split them into smaller runs")
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        prepared, area_runs = engine.prepare_areas(case, body)
        duplicates = engine.duplicates(case, prepared, area_runs)
        if duplicates and not body.run_anyway:
            return {"duplicates": duplicates, "input": prepared.model_dump()}
        # Store the resolved pairs, not the launch request or its confirmation flag.
        prepared = prepared.model_copy(update={"run_anyway": False})
        saved = engine.save(case, "runs", {"title": body.title, "input": prepared.model_dump(),
                            "area_runs": area_runs,
                            "status": "queued", "progress": 0, "total": sum(map(len, plans)),
                            "results": [], "frames": {}, "count": 0, "message": ""})
        workqueue.enqueue(case, engine.JOB, key=saved["id"], payload={"run_id": saved["id"]})
        return saved


@router.post("/cases/{case_id}/analysis/runs")
def start_run(case_id: str, body: RunInput) -> dict[str, Any]:
    return start(get_case(case_id), body)


class RunAgain(Model):
    """Which pass this run of a routine reads, when the analyst picked one.

    A routine is relaunched against a day, not a rule: leaving this empty falls
    back to the rule it was saved with, which looks the newest pass up itself.
    """
    date: str = Field(default="", max_length=10)
    reference: str = Field(default="", max_length=10)
    area_dates: list[AreaDates] | None = Field(default=None, max_length=32)
    run_anyway: bool = False


@router.post("/cases/{case_id}/analysis/followups/{ident}/run")
def run_followup(case_id: str, ident: str, body: RunAgain | None = None) -> dict[str, Any]:
    """Run a saved detection, on the pass asked for or on the rule it carries."""
    case = get_case(case_id)
    saved = read(case, "followups", ident)
    fields = {key: saved[key] for key in RunInput.model_fields if key in saved}
    chosen = body or RunAgain()
    try:
        run = RunInput.model_validate({**fields, "followup_id": ident})
        if chosen.area_dates is not None:
            run = RunInput.model_validate({**run.model_dump(), "area_dates": chosen.area_dates})
        if chosen.date:
            # A pass named here is this run's pass, so the rule has nothing left
            # to look up: the reference it would have found is settled now, and
            # the run records two fixed dates.
            run = RunInput.model_validate({**run.model_dump(),
                                           "b": {**run.b.model_dump(), "date": chosen.date},
                                           "area_dates": [{**pair.model_dump(),
                                               "date_rule": "manual" if chosen.reference or pair.date_rule != "latest_previous" else "latest_previous",
                                               "a": {**pair.a.model_dump(), "date": chosen.reference or pair.a.date},
                                               "b": {**pair.b.model_dump(), "date": chosen.date}}
                                               for pair in run.area_dates]})
    except ValidationError as exc:
        reason = str(exc.errors()[0].get("msg", "")).removeprefix("Value error, ")
        raise HTTPException(422, reason or "this detection needs editing before it can run") from exc
    return start(case, run.model_copy(update={"run_anyway": chosen.run_anyway}))


@router.get("/cases/{case_id}/analysis/followups/{ident}/findings")
def followup_findings(case_id: str, ident: str) -> list[dict[str, Any]]:
    """Everything this routine has found and nobody has dismissed."""
    case = get_case(case_id)
    read(case, "followups", ident)
    return engine.findings(case, ident)


@router.post("/cases/{case_id}/analysis/{kind}/{ident}/export")
def export_layer(case_id: str, kind: Literal["runs", "followups"], ident: str) -> dict[str, Any]:
    case = get_case(case_id)
    read(case, kind, ident)
    try:
        return analysis_export.export(case, kind, ident)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


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
        if kind == "areas":
            used = [row["title"] for row in engine.listing(case, "followups")
                    if any(zone["id"] == ident for zone in row.get("zones", []))]
            if used:
                raise HTTPException(409, "Remove this area from these routines first: " + ", ".join(used))
        if saved.get("status") in engine.ACTIVE:
            raise HTTPException(409, "cancel the analysis before deleting it")
        return delete_by_path(case, engine.relpath(kind, ident))


class Review(Model):
    # A candidate is "new" until an analyst looks at it. "noted" keeps it in the
    # detection's own findings and writes nothing to the case; "kept" is set by
    # promotion, which is the act of keeping, so the two cannot drift apart.
    review: Literal["dismissed", "new", "noted"]


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
        if body.review == "dismissed":
            saved["results"] = [row for row in saved["results"] if row["id"] != result_id]
            saved["count"] = len(saved["results"])
        engine.persist_run(case, saved)
        return result


class ManualPoint(Model):
    type: Literal["Point"]
    coordinates: tuple[float, float]


class ManualCandidate(Model):
    area_id: ShortId
    geometry: ManualPoint | AreaGeometry


@router.post("/cases/{case_id}/analysis/runs/{ident}/results")
def add_manual(case_id: str, ident: str, body: ManualCandidate) -> dict[str, Any]:
    case = get_case(case_id)
    with engine.LOCK, case._lock:
        saved = read(case, "runs", ident)
        if saved.get("status") != "ready":
            raise HTTPException(409, "finish the run before adding a candidate")
        if len(saved["results"]) >= engine.MAX_RESULTS:
            raise HTTPException(409, "this run has reached the candidate limit")
        zone = next((Zone.model_validate(z) for z in saved["input"]["zones"] if z["id"] == body.area_id), None)
        outcome = next((p for p in saved.get("area_runs", []) if p["area_id"] == body.area_id), None)
        if zone is None or (outcome and outcome["status"] != "ready"):
            raise HTTPException(422, "choose an area successfully read by this run")
        shape = body.geometry.model_dump()
        points = [shape["coordinates"]] if shape["type"] == "Point" else shape["coordinates"][0]
        if not all(analysis_geometry.contains(zone.ring(), point) for point in points):
            raise HTTPException(422, "the candidate must be inside its run area")
        z, size = engine.GRID
        grid = [engine.mercator(*point) for point in points]
        left = math.floor(min(p[0] for p in grid) * (1 << z) * size)
        top = math.floor(min(p[1] for p in grid) * (1 << z) * size)
        right = max(left + 1, math.ceil(max(p[0] for p in grid) * (1 << z) * size))
        bottom = max(top + 1, math.ceil(max(p[1] for p in grid) * (1 << z) * size))
        source = outcome or saved["input"]
        sources = [source["b"]] if saved["input"]["recipe"]["method"] in SINGLE_METHODS else [source["a"], source["b"]]
        parts = []
        for ty in range(top // size, (bottom - 1) // size + 1):
            for tx in range(left // size, (right - 1) // size + 1):
                keys = [engine._key(Source.model_validate(s), z, tx, ty, None) for s in sources]
                if not all(key in saved["frames"] for key in keys):
                    continue
                px, py = max(left, tx * size), max(top, ty * size)
                parts.append({"frames": keys, "box": [px - tx * size, py - ty * size,
                    min(right, (tx + 1) * size) - px, min(bottom, (ty + 1) * size) - py]})
        if not parts:
            raise HTTPException(422, "this run has no retained image at that location")
        west, north = engine.geographic(left / ((1 << z) * size), top / ((1 << z) * size))
        east, south = engine.geographic(right / ((1 << z) * size), bottom / ((1 << z) * size))
        centre = list(points[0]) if shape["type"] == "Point" else [(west + east) / 2, (south + north) / 2]
        mpp = engine.WORLD * math.cos(math.radians(centre[1])) / ((1 << z) * size)
        row = {"id": f"manual-{secrets.token_hex(6)}", "origin": "manual", "area_id": zone.id,
               "area_name": zone.name, "geometry": shape, "coordinates": centre,
               "bbox": [west, south, east, north], "parts": parts, "review": "new",
               "phenomenon": "Manual candidate", "margin": 0, "measure": {},
               "area": (right - left) * (bottom - top) * mpp ** 2,
               "width": (right - left) * mpp, "height": (bottom - top) * mpp,
               "sources": {"a": source["a"], "b": source["b"]}}
        saved["results"].append(row)
        saved["count"] = len(saved["results"])
        engine.persist_run(case, saved)
        return row


# A candidate is a handful of pixels: a 30 m vessel is three of them. Blowing
# the crop up on the server, by a whole number and with no interpolation, is
# what makes it legible — the browser would otherwise stretch a 40 px thumbnail
# across the column and smear it. Nearest neighbour keeps every pixel square and
# invents nothing, so what is on screen is still the sensor's own reading.
PREVIEW_EDGE = 320
PREVIEW_MARGIN = 20
#: The two lines under the pictures: the point, then whose imagery it is.
PREVIEW_FOOT = 40
# The most of the sweep one preview shows, in source pixels. A burn scar can be
# kilometres across; past this the crop is centred on the candidate.
PREVIEW_SPAN = 1024


def source_label(source: dict[str, Any]) -> str:
    if source.get("provider") == "esri-wayback":
        return f"Release {source.get('release')}"
    if source.get("provider") == "sentinel1":
        moment = f"{source.get('date') or ''} {str(source.get('time') or '')[:5]}".strip()
        return f"{moment} UTC · radar" if source.get("time") else f"{moment or 'Sentinel-1'} · radar"
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


def preview_captions(saved: dict[str, Any], result: dict[str, Any],
                     sources: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    """What a candidate's picture says on its face: one label per image, and the foot.

    A pinned crop is evidence and outlives the run that made it, so it carries
    when each image was taken and where. A pair is lettered the way the maps
    are; a single image names its own pass. The foot is the point, then whose
    imagery it is.
    """
    labels = ([f"{letter} · {source_label(source)}" for letter, source in zip("AB", sources)]
              if len(sources) > 1 else [source_label(sources[-1])])
    lon, lat = result["coordinates"]
    attribution = ("Esri World Imagery Wayback" if saved["input"]["b"].get("provider") == "esri-wayback"
                   else "Copernicus Sentinel data / Sentinel Hub")
    return labels, [f"{lat:.5f}, {lon:.5f}", attribution]


def preview_bytes(case: Any, saved: dict[str, Any], result: dict[str, Any], *, after_only: bool = False) -> bytes:
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
    if after_only:
        sources = sources[-1:]
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
    labels, foot = preview_captions(saved, result, sources)
    panels = [max(crop.width, math.ceil(font.getlength(label)) + 8) for label, crop in zip(labels, crops)]
    body = max(crop.height for crop in crops)
    width = max(sum(panels) + gap * (len(crops) - 1), max(math.ceil(small.getlength(line)) for line in foot) + 8)
    preview = Image.new("RGB", (width, band + body + PREVIEW_FOOT), (20, 24, 32))
    drawing = ImageDraw.Draw(preview)
    offset = 0
    for label, crop, panel in zip(labels, crops, panels):
        preview.paste(crop, (offset + (panel - crop.width) // 2, band))
        drawing.text((offset + 4, 4), label, fill="white", font=font)
        offset += panel + gap
    for row, line in enumerate(foot):
        drawing.text((4, band + body + 5 + row * 16), line, fill="white" if row == 0 else "#c8ced6", font=small)
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
    description: str = Field(default="", max_length=4000)
    after_only: bool | None = None
    shape: Literal["point", "area"] | None = None


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
        single = saved["input"]["recipe"]["method"] in SINGLE_METHODS
        as_area = body.shape == "area" or (body.shape is None and not single)
        geometry = result["geometry"] if as_area else {"type": "Point", "coordinates": result["coordinates"]}
        if as_area and geometry["type"] == "Point":
            raise HTTPException(422, "this candidate is a point; pin it as a point")
        filed = media.import_rendered_bytes(case, preview_bytes(case, saved, result,
                                            after_only=single if body.after_only is None else body.after_only),
                                            body.title, ".png", source, by="compare")
        lon, lat = result["coordinates"]
        if as_area:
            lon, lat = analysis_geometry.interior(geometry, (lon, lat))
        entity = case.add_entity("place", body.title, attrs={"lat": lat, "lon": lon,
                                 "zoom": 16, "analysis_run": ident, "candidate_id": result_id,
                                 "geometry": geometry, "description": body.description,
                                 **({"footprint": geometry} if as_area else {}),
                                 "evidence": filed["item"]["path"],
                                 "analysis_provenance": source}, by="compare")
        result.update(entity_id=entity["id"], review="kept", reviewed_at=engine.now(),
                      title=body.title, description=body.description, pinned_geometry=geometry)
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
