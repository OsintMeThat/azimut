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
from typing import Any, Literal

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


# -- the map's settings card ---------------------------------------------------------------
#
# The card on a map in the drawn note (`editor/mapBlock.js`) writes each choice as a line
# of the block itself, one Undo step a choice. These answer what it asks of the case: what
# the map shows now, drawn as the page draws it, so the card can be drawn on; the ground of
# another base or frame, filed on the press that picks it; a map started from nothing; and
# the points, lines and areas drawn on it, which are features of a personal layer the block
# names, never lines of the block.

#: The imagery each base takes its ground from, filed once on the press that picks it; a
#: satellite base keeps the imagery the put picked unless the press names another.
BASE_PROVIDERS = {"map": "osm", "topographic": "opentopomap", "dark": "osm"}
#: What a highlighted area looks like: its outline dashed over a light fill, its words on it.
HIGHLIGHT = {"line_dash": "dashed", "fill_opacity": 0.16, "line_width": 2.5, "label": "on"}
#: What the card names each kind of feature drawn on it.
KINDS = {"point": "Point", "line": "LineString", "area": "Polygon"}
#: How a personal layer made for a map's drawings says so (its spec's `origin`), so the card
#: draws into it and lists what it holds, and never into a layer the analyst made elsewhere.
OWN_LAYER = {"kind": "note-map"}


def own_layer(case: Case, title: str) -> dict[str, Any]:
    """A personal layer, empty, made for what is drawn on a map: its row, as My layers lists it."""
    from ..engine import layerediting

    return layerediting._create(case, title=title, features=[], original=b'{"type":"FeatureCollection","features":[]}',
                                origin=dict(OWN_LAYER), description="Drawn on a map in a note.")


class BlockIn(BaseModel):
    #: The block's lines, its fences left out or not.
    text: str = Field(max_length=200_000)


def _block_of(text: str) -> notes_maps.MapBlock:
    lines = [line for line in text.split("\n") if not line.strip().startswith(":::")]
    return notes_maps.parse_block("\n".join(lines))


@router.post("/cases/{case_id}/notes/maps/describe")
def describe_map(case_id: str, body: BlockIn) -> dict[str, Any]:
    """What a map shows now, for its settings card: the drawing the page shows over its
    ground, the layers it names (and those it could), its days, its steps with the proof
    each is about, what the analyst drew in its personal layers, and the case's colours.
    Reads the case only, never the network."""
    from ..engine import layerediting

    case = get_case(case_id)
    block = _block_of(body.text)
    derived = notes_maps.derive(case, block)
    data = derived.data
    width, height = notes_maps.frame_of(data["bounds"])
    plate = notes_maps._plate(case, block.plate) if block.plate else None
    named = [(name, "plate") for name, _ in (plate or {}).get("layers", [])]
    named += [(name, "line") for name in block.layers if all(name != other for other, _ in named)]
    rows = {row["name"]: row for row in maplayers.listing(case)}
    layers = []
    drawings = []
    for name, origin in named:
        row = rows.get(name)
        editable = own = False
        if row is not None:
            try:
                spec = maplayers._read_spec(case, name)
                editable = layerediting.editable(spec)
                own = editable and (spec.get("origin") or {}).get("kind") == OWN_LAYER["kind"]
            except Exception:
                spec = {}
            if own and origin == "line":
                drawings.extend(_drawn(name, spec))
        layers.append({"name": name, "title": (row or {}).get("title") or name, "from": origin,
                       "on": name not in block.hidden, "colour": block.colours.get(name, ""),
                       "colours": sorted((row or {}).get("colours") or {}, key=lambda colour: -row["colours"][colour])[:6]
                       if row else [], "features": (row or {}).get("features", 0), "editable": editable,
                       "own": own, "missing": row is None})
    others = [{"name": row["name"], "title": row["title"], "features": row["features"]}
              for row in rows.values() if row["name"] not in {name for name, _ in named}]
    ground = None
    if block.ground and data.get("ground"):
        record = case.get_entity(block.ground) if notes_maps.ENTITY_ID.match(block.ground) else None
        path = str(((record or {}).get("attrs") or {}).get("path") or "")
        if path:
            ground = {"id": block.ground, "path": path, "bounds": data["ground"]["bounds"]}
    steps = []
    for step in data.get("steps") or []:
        view = step.get("view") or {}
        center = view.get("center") or [None, None]
        steps.append({"label": step.get("label") or "", "day": step.get("day") or "", "text": step.get("text") or "",
                      "name": step.get("name") or "", "proof": derived.step_proofs.get(str(step.get("id")), ""),
                      "view": [center[1], center[0], view.get("zoom")] if center[0] is not None else None})
    days = _proof_days(case)
    return {
        "title": block.title, "base": block.shown_base(), "bounds": data["bounds"], "frame": [width, height],
        "extent": notes_maps._features_bounds(data["features"], None) if data["features"] else None,
        "view": data["view"], "ground": ground, "svg": notes_maps.svg(derived, ident="cm-map"),
        "layers": layers, "others": others, "drawings": drawings,
        "proofs": {"count": len(days), "first": min(days) if days else "", "last": max(days) if days else ""},
        "days": data.get("days") or [], "day": data.get("day") or "", "steps": steps, "own_steps": bool(block.steps),
        "palette": layerediting.palette(case),
        "providers": [{"id": provider.id, "label": provider.label} for provider in tiles.all_providers()
                      if provider.capturable and not provider.widget and not provider.needs_key],
        "warnings": [message for message, _, _ in derived.warnings],
    }


def _drawn(layer: str, spec: dict[str, Any]) -> list[dict[str, Any]]:
    """What a personal layer holds, as the card lists what was drawn on a map."""
    found = []
    kinds = {value: key for key, value in KINDS.items()}
    for feature in (spec.get("document") or {}).get("features") or []:
        properties = feature.get("properties") or {}
        kind = kinds.get(str((feature.get("geometry") or {}).get("type") or ""))
        if kind is None or not properties.get("key"):
            continue
        found.append({"layer": layer, "key": properties["key"], "kind": kind, "name": str(properties.get("name") or ""),
                      "colour": str(properties.get("colour") or "#0072b2"), "from": str(properties.get("date") or ""),
                      "until": str(properties.get("date_end") or ""), "label": properties.get("label") == "on",
                      "highlight": kind == "area" and properties.get("line_dash") == "dashed"})
    return found


class GroundIn(BlockIn):
    base: Literal["satellite", "map", "topographic", "dark"] = "satellite"
    #: The imagery a satellite base is taken from; the others take their own.
    provider: str = Field(default=DEFAULT_PROVIDER, max_length=200)


@router.post("/cases/{case_id}/notes/maps/ground")
def file_ground(case_id: str, body: GroundIn) -> dict[str, Any]:
    """The ground of ``base`` under the map as it is framed now, filed on this press the
    way a put files one (a view already filed is cited again, nothing fetched), with a
    sharper picture for each step that looks closer. Answers the `ground` and `detail`
    lines to write and what was filed fresh, for Undo; refuses when the imagery cannot be
    fetched, the map keeping the ground it has."""
    case = get_case(case_id)
    block = _block_of(body.text)
    derived = notes_maps.derive(case, block)
    if block.frame is not None:
        lat, lon, zoom = notes_maps.fit_view(list(block.frame), FRAME_W, FRAME_H, pad=0.0, most=16.0)
    elif block.view is not None:
        lat, lon, zoom = block.view[:3]
    else:
        lon, lat = derived.data["view"]["center"]
        zoom = float(derived.data["view"]["zoom"])
    provider = BASE_PROVIDERS.get(body.base, body.provider or DEFAULT_PROVIDER)
    filed: list[str] = []
    details: list[str] = []
    try:
        ground, fresh = _file_ground(case_id, lat, lon, zoom, provider)
        if fresh:
            filed.append(str(ground["id"]))
        for step in _close_steps(derived.data.get("steps") or [], zoom):
            detail, made = _file_ground(case_id, step[0], step[1], step[2], provider, gain=DETAIL_GAIN)
            if str(detail["id"]) not in details:
                details.append(str(detail["id"]))
                if made:
                    filed.append(str(detail["id"]))
    except HTTPException as exc:
        if exc.status_code in (404, 422):
            raise
        word = {"map": "street map", "topographic": "topographic map", "dark": "street map"}.get(body.base, "imagery")
        raise HTTPException(status_code=503, detail=f"The {word} could not be fetched, so the map keeps its ground. "
                                                    "Try again once online.") from exc
    view = f"{lat:.5f}, {lon:.5f}, {notes_maps._num(zoom, 2)}"
    return {"ground": str(ground["id"]), "details": details, "view": view, "filed": filed,
            "base": "" if body.base == "satellite" else body.base}


class ScratchIn(BaseModel):
    title: str = Field(default="", max_length=notes_maps.MAX_TITLE)
    west: float = Field(ge=-180, le=180, allow_inf_nan=False)
    south: float = Field(ge=-85, le=85, allow_inf_nan=False)
    east: float = Field(ge=-180, le=180, allow_inf_nan=False)
    north: float = Field(ge=-85, le=85, allow_inf_nan=False)
    base: Literal["satellite", "map", "topographic", "dark"] = "satellite"
    provider: str = Field(default=DEFAULT_PROVIDER, max_length=200)


@router.post("/cases/{case_id}/notes/maps/scratch")
def start_map(case_id: str, body: ScratchIn) -> dict[str, Any]:
    """A map started from nothing: a personal layer of its own, empty, for what the
    analyst draws on it, and the ground of the place framed, filed on this press. Answers
    the block, which names both, and what was filed for it (the layer included), so an
    Undo of the put sends them to the Trash."""

    case = get_case(case_id)
    if not (body.west < body.east and body.south < body.north):
        raise HTTPException(status_code=422, detail="Frame a place on the map first")
    title = " ".join(body.title.split()) or "My map"
    lat, lon, zoom = notes_maps.fit_view([body.west, body.south, body.east, body.north], FRAME_W, FRAME_H,
                                         pad=0.0, most=17.0)
    provider = BASE_PROVIDERS.get(body.base, body.provider or DEFAULT_PROVIDER)
    try:
        ground, fresh = _file_ground(case_id, lat, lon, zoom, provider)
    except HTTPException as exc:
        if exc.status_code in (404, 422):
            raise
        raise HTTPException(status_code=503, detail="The imagery of this place could not be fetched. "
                                                    "Start the map again once online.") from exc
    row = own_layer(case, title)
    entity = case.find_entity(attr="spec", value=layout.layer_spec_rel(row["name"]))
    block = notes_maps.MapBlock(title=title, layers=[row["name"]], ground=str(ground["id"]), view=(lat, lon, zoom, 0.0),
                                base="" if body.base == "satellite" else body.base)
    filed = ([str(ground["id"])] if fresh else []) + ([str(entity["id"])] if entity else [])
    return {"text": notes_maps.block_text(block), "filed": filed, "layer": row["name"], "ground": ground,
            "warnings": []}


class LayerIn(BaseModel):
    title: str = Field(default="", max_length=200)


@router.post("/cases/{case_id}/notes/maps/layer")
def make_own_layer(case_id: str, body: LayerIn) -> dict[str, Any]:
    """The personal layer a map's first drawing goes into, made for it and named by its block."""
    case = get_case(case_id)
    row = own_layer(case, " ".join(body.title.split()) or "Drawn on a map")
    return {"name": row["name"], "title": row["title"]}


class FeatureIn(BaseModel):
    layer: str = Field(min_length=1, max_length=120)
    kind: Literal["point", "line", "area"]
    #: ``[lon, lat]`` for a point, a list of them for a line or an area's outline.
    coords: list[Any] = Field(min_length=2, max_length=notes_maps.MAX_CORNERS)
    name: str = Field(default="", max_length=200)
    colour: str = Field(default="#0072b2", pattern=r"^#[0-9a-fA-F]{6}$")
    #: Its first day and its last, either "".
    start: str = Field(default="", max_length=10)
    end: str = Field(default="", max_length=10)
    #: Its name written on the map.
    label: bool = False
    #: An area to highlight: its outline dashed over a light fill, its name on it.
    highlight: bool = False


class FeatureEditIn(BaseModel):
    layer: str = Field(min_length=1, max_length=120)
    name: str | None = Field(default=None, max_length=200)
    colour: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    start: str | None = Field(default=None, max_length=10)
    end: str | None = Field(default=None, max_length=10)
    label: bool | None = None


def _days_of(start: str, end: str) -> tuple[str, str]:
    for day in (start, end):
        if day and not notes_maps.DAY.match(day):
            raise HTTPException(status_code=422, detail="Write a day as YYYY-MM-DD")
    if start and end and end < start:
        start, end = end, start
    return start, end


def _set_end(case: Case, layer: str, key: str, end: str) -> None:
    """A feature's last day, kept beside its first as an imported one's is."""
    from ..engine import layerediting

    with case.lock:
        spec = layerediting._spec(case, layer)
        for feature in spec["document"]["features"]:
            properties = feature["properties"]
            if properties.get("key") != key:
                continue
            if properties.get("states"):
                raise HTTPException(status_code=422, detail="This feature's days are its history; change them in My layers")
            if end and str(properties.get("date") or "") < end:
                properties["date_end"] = end
            else:
                properties.pop("date_end", None)
            layerediting._save(case, layer, spec)
            return
    raise HTTPException(status_code=404, detail="This feature is no longer in the layer")


@router.post("/cases/{case_id}/notes/maps/features")
def draw_feature(case_id: str, body: FeatureIn) -> dict[str, Any]:
    """A point, a line or an area drawn on a map's card, added to the personal layer the
    map names, with its name, its day or its days and its colour."""
    from ..engine import layerediting

    case = get_case(case_id)
    start, end = _days_of(body.start, body.end)
    try:
        if body.kind == "point":
            lon, lat = notes_maps._pair(body.coords)
        else:
            corners = [notes_maps._pair(point) for point in body.coords]
    except (TypeError, ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail="A point is a longitude and a latitude") from exc
    style: dict[str, Any] = dict(HIGHLIGHT) if body.highlight and body.kind == "area" else {}
    if body.label:
        style["label"] = "on"
    stem = layout.existing_stem(body.layer, "Layer")
    try:
        if body.kind == "point":
            made = layerediting.add_marker(case, stem, lat=lat, lon=lon, name=body.name, colour=body.colour.lower(),
                                           symbol="circle", date=start or None, **style)
            key = str(made["marker"]["properties"]["key"])
        else:
            geometry: dict[str, Any]
            if body.kind == "area":
                if len(corners) < 3:
                    raise HTTPException(status_code=422, detail="An area needs three corners at least")
                geometry = {"type": "Polygon", "coordinates": [[*corners, corners[0]]]}
            else:
                geometry = {"type": "LineString", "coordinates": corners}
            made = layerediting.add_shape(case, stem, geometry=geometry, name=body.name, colour=body.colour.lower(),
                                          description="", group=None, date=start or None, **style)
            key = str(made["key"])
        if end:
            _set_end(case, stem, key, end)
    except maplayers.LayerError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"layer": stem, "key": key}


@router.patch("/cases/{case_id}/notes/maps/features/{key}")
def edit_feature(case_id: str, key: str, body: FeatureEditIn) -> dict[str, Any]:
    """A feature drawn on a map's card renamed, recoloured, its days or its words on the map changed."""
    from ..engine import layerediting

    case = get_case(case_id)
    stem = layout.existing_stem(body.layer, "Layer")
    changes: dict[str, Any] = {}
    if body.name is not None:
        changes["name"] = body.name
    if body.colour is not None:
        changes["colour"] = body.colour.lower()
    if body.label is not None:
        changes["label"] = "on" if body.label else None
    start, end = _days_of(body.start or "", body.end or "")
    if body.start is not None:
        changes["date"] = start or None
    try:
        if changes:
            layerediting.update_marker(case, stem, key, changes)
        if body.end is not None or body.start is not None:
            current: dict[str, Any] = next((feature["properties"] for feature in
                                            layerediting._spec(case, stem)["document"]["features"]
                                            if feature["properties"].get("key") == key), {})
            _set_end(case, stem, key, end if body.end is not None else str(current.get("date_end") or ""))
    except maplayers.LayerError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"layer": stem, "key": key}


@router.delete("/cases/{case_id}/notes/maps/features/{key}")
def remove_feature(case_id: str, key: str, layer: str) -> dict[str, Any]:
    """A feature drawn on a map's card taken out; its layer keeps it a while for an Undo."""
    from ..engine import layerediting

    case = get_case(case_id)
    stem = layout.existing_stem(layer, "Layer")
    try:
        layerediting.remove_marker(case, stem, key)
    except maplayers.LayerError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"layer": stem, "removed": key}


@router.post("/cases/{case_id}/notes/maps/features/{key}/restore")
def restore_feature(case_id: str, key: str, layer: str) -> dict[str, Any]:
    """A feature taken out of a map's card put back, as its Undo does."""
    from ..engine import layerediting

    case = get_case(case_id)
    stem = layout.existing_stem(layer, "Layer")
    try:
        layerediting.restore_marker(case, stem, key)
    except maplayers.LayerError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"layer": stem, "key": key}
