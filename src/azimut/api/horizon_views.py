"""Saved Horizon views: a named view of the case, kept to be opened again.

A view stores the reading, not its pixels: where the eye stood and how high,
which way it looked through which lens, how the picture was drawn (the ground,
its imagery or the Wayback release, the ridge lines, the air, the hour), the
point marked, and the photo or the video laid over it with what was done to
match it (how much of it shows, its lens curve and corners, the skyline traced
on it, the pins of a video). It lives under ``.horizon/``, beside the small
preview the saved work lists show.

What the terrain was when the view was saved is kept beside the reading
(`made`): who the heights came from, the finest ground they were read at, the
refraction, and where the eye stood above the sea. A view opened again is drawn
from today's tiles; this is what it was claimed on.

A saved view stands on the map as saved work, at its eye, facing its heading,
and is listed with the captures and the comparisons in the Saved panel
(`engine/horizon_views.py`).

A picture exported from a view can be kept in the case: a media file stamped
with the view it shows, never replaced, and listed under the view's row. The
browser draws it (lib/horizon/viewExport.js); finished copies go to the export
folder through the plates route and the GIF route, and are not case state.

A capture is the view as it shows, or an area of it, filed in the case in one
press, saved view or not: a media file that says where the eye stood and what
the picture faces.
"""

from __future__ import annotations

import io
import json
import re
import warnings
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel, Field, field_validator, model_validator

from .. import __version__, errors, layout
from ..engine import artifacts as artifact_engine
from ..engine import comparisons, horizon_views, inspectwork, tiles
from ..engine import media as media_engine
from ..engine.sheets import replace_atomic
from ..workspace import Case, CaseError
from .cases import delete_by_path, get_case
from ..engine import horizon
from .horizon import HEIGHT_LIMITS, SKYLINE_CUTS
from .naming import case_only, holders, read_created_at, slugify
from .satellite import locate_on_save, saved_changed

router = APIRouter(prefix="/api", tags=["horizon"])

#: What a view is called when its title says nothing a file can be named by.
FALLBACK = "View"
_DAY = r"^(|\d{4}-\d{2}-\d{2})$"
#: A source of imagery for the ground: a provider, or a dated release of one (`esri-wayback~N`).
_IMAGERY = re.compile(r"^[a-z0-9-]{1,60}(~\d{1,12})?$")
#: A trace is a few strokes of a few hundred points; a found skyline is one long one.
MAX_STROKES = 400
MAX_STROKE_POINTS = 20_000
MAX_TRACE_POINTS = 60_000
MAX_PINS = 500
#: The ground a view took in: a ring of points round the eye, a few per degree of lens.
MAX_FOOTPRINT = 2_000
#: A kept picture: the photo and the terrain side by side at twice a wide screen,
#: or the whole turn, is a few megabytes and well under this many pixels.
MAX_KEPT_BYTES = 30_000_000
MAX_KEPT_PIXELS = 40_000_000


class Eye(BaseModel):
    lat: float = Field(ge=-85, le=85)
    lon: float = Field(ge=-180, le=180)
    mode: Literal["ground", "drone", "aircraft"] = "ground"
    height: float = Field(ge=0, le=15_000)

    @model_validator(mode="after")
    def _sane(self) -> Eye:
        low, high = HEIGHT_LIMITS[self.mode]
        if not low <= self.height <= high:
            raise ValueError(f"a {self.mode} eye is {low:g} to {high:g} m high")
        return self


class Look(BaseModel):
    heading: float = Field(ge=0, lt=360)
    tilt: float = Field(default=0, ge=-90, le=90)
    roll: float = Field(default=0, ge=-180, le=180)
    fov: float = Field(gt=0, le=360)
    projection: Literal["camera", "panorama"] = "camera"

    @model_validator(mode="after")
    def _lens(self) -> Look:
        if self.projection == "camera" and self.fov > 150:
            raise ValueError("a lens takes in 150° at most; the whole turn is a panorama")
        return self


class Sentinel(BaseModel):
    """Sentinel-2 laid near the eye: how far, and the pass picked, if one was."""

    reach: int = Field(ge=500, le=30_000)
    date: str = Field(default="", pattern=_DAY)


class Picture(BaseModel):
    ground: Literal["relief", "imagery", "plain"] = "relief"
    lines: bool = False
    ridges: int = Field(default=2, ge=0, le=4)
    #: How far the air lets the eye see, in metres; None for clear air.
    visibility: float | None = Field(default=None, ge=1_000, le=500_000)
    #: Ground nearer than this is taken away, in metres.
    near: float = Field(default=0, ge=0, le=50_000)
    imagery: str = Field(default="esri-world-imagery", max_length=80)
    #: Saved, never switched back on by opening the view: it is billed.
    sentinel: Sentinel | None = None
    names: bool = False
    shadows: float = Field(default=0.5, ge=0, le=1)

    @field_validator("imagery")
    @classmethod
    def _known(cls, value: str) -> str:
        if not _IMAGERY.match(value):
            raise ValueError("that is not an imagery source")
        try:
            tiles.get_provider(value.split("~", 1)[0])
        except KeyError as exc:
            raise ValueError(str(exc)) from exc
        return value


class Sky(BaseModel):
    on: bool = False
    date: str = Field(default="", pattern=_DAY)
    time: str = Field(default="12:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class Target(BaseModel):
    lat: float = Field(ge=-85, le=85)
    lon: float = Field(ge=-180, le=180)
    height: float = Field(default=0, ge=0, le=10_000)


class PhotoPoint(BaseModel):
    """A point of the photo, 0 to 1 across and down; a pulled corner may lie past it."""

    u: float = Field(ge=-1, le=2, allow_inf_nan=False)
    v: float = Field(ge=-1, le=2, allow_inf_nan=False)


class Pin(BaseModel):
    """The view's alignment at a moment of a video."""

    time: float = Field(ge=0, allow_inf_nan=False)
    heading: float = Field(ge=0, lt=360)
    tilt: float = Field(default=0, ge=-90, le=90)
    roll: float = Field(default=0, ge=-180, le=180)
    fov: float = Field(gt=0, le=150)


class Facing(BaseModel):
    """Roughly which way the photo faces: a sector about this heading."""

    heading: float = Field(ge=0, lt=360)


#: The reaches a panorama keeps its skyline at (api/horizon.py SKYLINE_CUTS), metres.
REACHES = tuple(int(reach) for reach in SKYLINE_CUTS)


class Hints(BaseModel):
    """What the analyst knows about the photo, told to Fit (frontend lib/horizon/hints.js)."""

    zoom: Literal["any", "wide", "normal", "zoomed", "telephoto"] = "any"
    facing: Facing | None = None
    #: How far the photo sees: left to Fit, clear air, or one of the reaches.
    reach: Literal["auto", "all"] | int = "auto"

    @field_validator("reach")
    @classmethod
    def _kept_reach(cls, reach: str | int) -> str | int:
        if isinstance(reach, int) and reach not in REACHES:
            raise ValueError("a reach is one the panorama keeps its skyline at")
        return reach


class Photo(BaseModel):
    """The photo or the video laid over the view, and what was done to match it."""

    path: str = Field(min_length=1, max_length=1_000)
    kind: Literal["image", "video"]
    title: str = Field(default="", max_length=300)
    #: The moment of a video on show.
    time: float = Field(default=0, ge=0, allow_inf_nan=False)
    #: How much of the photo shows over the terrain, 0 to 1.
    mix: float = Field(default=1, ge=0, le=1)
    bend: float = Field(default=0, ge=-0.3, le=0.3)
    #: The photo's corners once pulled, clockwise from the top left; None where it lies untouched.
    corners: list[PhotoPoint] | None = Field(default=None, min_length=4, max_length=4)
    strokes: list[list[PhotoPoint]] = Field(default_factory=list, max_length=MAX_STROKES)
    #: The moment of the video the trace was drawn on.
    trace_time: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    #: Held to the terrain, as it opens again.
    locked: bool = False
    pins: list[Pin] = Field(default_factory=list, max_length=MAX_PINS)
    hints: Hints = Field(default_factory=Hints)
    #: The reach Fit found the trace's skyline at, metres; None for the whole turn.
    reach: float | None = Field(default=None, gt=0, le=horizon.FAR_MAX, allow_inf_nan=False)

    @field_validator("strokes")
    @classmethod
    def _bounded(cls, strokes: list[list[PhotoPoint]]) -> list[list[PhotoPoint]]:
        if any(len(stroke) > MAX_STROKE_POINTS for stroke in strokes):
            raise ValueError("a stroke of the trace is too long")
        if sum(len(stroke) for stroke in strokes) > MAX_TRACE_POINTS:
            raise ValueError("the trace is too long to keep")
        return [stroke for stroke in strokes if stroke]


class ViewSpec(BaseModel):
    version: Literal[1] = 1
    eye: Eye
    look: Look
    picture: Picture = Field(default_factory=Picture)
    sky: Sky = Field(default_factory=Sky)
    target: Target | None = None
    photo: Photo | None = None


class Credit(BaseModel):
    label: str = Field(default="", max_length=200)
    attribution: str = Field(default="", max_length=300)


class Made(BaseModel):
    """What the terrain was when the view was saved, as the browser read it off the turn."""

    terrain: list[Credit] = Field(default_factory=list, max_length=8)
    #: The finest ground the heights were read at, in metres.
    resolution_m: float | None = Field(default=None, gt=0, le=10_000)
    refraction: float | None = Field(default=None, ge=0, le=0.3)
    #: The ground under the eye, and the eye, above the sea.
    ground_m: float | None = Field(default=None, ge=-500, le=9_000)
    altitude_m: float | None = Field(default=None, ge=-500, le=25_000)


class ViewIn(BaseModel):
    rename_from: str | None = None
    overwrite: bool = False
    title: str = Field(min_length=1, max_length=200)
    spec: ViewSpec
    made: Made = Field(default_factory=Made)
    #: The ground the view takes in, `[lon, lat]` round the eye.
    footprint: list[tuple[float, float]] | None = Field(default=None, max_length=MAX_FOOTPRINT)

    @field_validator("footprint")
    @classmethod
    def _ground(cls, ring: list[tuple[float, float]] | None) -> list[tuple[float, float]] | None:
        if not ring:
            return None
        if len(ring) < 3:
            raise ValueError("a footprint needs three points at least")
        for lon, lat in ring:
            if not (-180 <= lon <= 180 and -85.06 <= lat <= 85.06):
                raise ValueError("footprint points must be WGS84 longitude and latitude")
        return ring


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_view(case: Case, name: str) -> dict[str, Any] | None:
    try:
        path = case.resolve_inside(layout.horizon_view_rel(name))
    except CaseError:
        return None
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return saved if isinstance(saved, dict) and saved.get("azimut_horizon") == 1 else None


def _thumb_of(case: Case, name: str) -> str | None:
    rel = layout.horizon_thumb_rel(name)
    try:
        return rel if case.resolve_inside(rel).is_file() else None
    except CaseError:
        return None


def _photo_here(case: Case, spec: dict[str, Any]) -> bool | None:
    """Whether the photo a view was matched on is still in the case; None with no photo."""
    photo = spec.get("photo")
    if not isinstance(photo, dict) or not photo.get("path"):
        return None
    try:
        return case.resolve_inside(str(photo["path"])).is_file()
    except CaseError:
        return False


@router.get("/cases/{case_id}/horizon/views")
def list_views(case_id: str) -> list[dict[str, Any]]:
    case = get_case(case_id)
    out = []
    for path in sorted(case.subdir(layout.HORIZON_DIR).glob("*.json")):
        saved = _read_view(case, path.stem)
        if saved is None:
            continue
        spec = saved.get("spec") or {}
        eye = spec.get("eye") or {}
        look = spec.get("look") or {}
        photo = spec.get("photo") or {}
        out.append({
            "name": path.stem,
            "title": saved.get("title", path.stem),
            "updated_at": saved.get("updated_at"),
            "lat": eye.get("lat"),
            "lon": eye.get("lon"),
            "heading": look.get("heading"),
            "fov": look.get("fov"),
            "photo": photo.get("title") or (PurePosixPath(str(photo["path"])).name if photo.get("path") else None),
            "thumb": _thumb_of(case, path.stem),
        })
    out.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return out


@router.get("/cases/{case_id}/horizon/views/{name}")
def load_view(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        path = case.resolve_inside(layout.horizon_view_rel(name))
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="view not found")
    saved = _read_view(case, name)
    if saved is None:
        raise HTTPException(status_code=422, detail="that is not a readable view")
    return {
        **saved,
        "name": name,
        "thumb": _thumb_of(case, name),
        "photo_here": _photo_here(case, saved.get("spec") or {}),
    }


@router.post("/cases/{case_id}/horizon/views")
def save_view(case_id: str, body: ViewIn) -> dict[str, Any]:
    case = get_case(case_id)
    with case.lock:
        saved, located = _save_view(case, body)
    # Outside the lock: locating the point may ask a geocoder for its country.
    if located:
        locate_on_save(case, *located)
    saved_changed(case)
    return saved


def _save_view(case: Case, body: ViewIn) -> tuple[dict[str, Any], tuple[str, float, float] | None]:
    """Names answer to Windows and macOS, and to the Trash, as a comparison's do."""
    folder = case.subdir(layout.HORIZON_DIR)
    name = slugify(body.title, FALLBACK)
    old = slugify(body.rename_from, FALLBACK) if body.rename_from else None
    old_rel = layout.horizon_view_rel(old) if old and old != name else None
    trashed = case.trashed_stems(layout.HORIZON_DIR)
    if old_rel:
        if holders(folder, name, source=old):
            raise HTTPException(status_code=409, detail="another view already uses that name")
        if name.casefold() in trashed and not case_only(old, name):
            raise HTTPException(status_code=409, detail="a view in the Trash uses that name")
    elif body.rename_from is None:
        if holders(folder, name, source=name if body.overwrite else None):
            raise HTTPException(status_code=409, detail="a view already uses that name")
        if name.casefold() in trashed:
            taken = {path.stem.casefold() for path in folder.glob("*.json")} | trashed
            name = layout.free_stem(taken, name, FALLBACK)

    spec = body.spec.model_dump()
    photo = spec.get("photo")
    if photo:
        try:
            here = case.resolve_inside(photo["path"]).is_file()
        except CaseError:
            here = False
        if not here:
            raise HTTPException(status_code=422, detail="the photo laid over the view is not in the case")

    rel = layout.horizon_view_rel(name)
    path = case.resolve_inside(rel)
    if old_rel and case_only(old, name):
        source = case.resolve_inside(old_rel)
        # The name asked for, not `path`'s: Windows resolves a path to the case already on disk.
        if source.is_file():
            path = source.with_name(PurePosixPath(rel).name)
            media_engine.rename_path(source, path)
    previous = path if old_rel and case_only(old, name) else case.resolve_inside(
        layout.horizon_view_rel(old or name)
    )
    saved = {
        "azimut_horizon": 1,
        "title": name,
        "created_at": read_created_at(previous) or _now(),
        "updated_at": _now(),
        "app_version": __version__,
        "spec": spec,
        "made": body.made.model_dump(),
    }
    media_engine.write_json_atomic(path, saved)

    # the preview follows its view, and the images kept from it point at the new name
    thumb: str | None = None
    if old_rel:
        moved = case.resolve_inside(layout.horizon_thumb_rel(old or name))
        if moved.is_file():
            target = layout.horizon_thumb_rel(name)
            media_engine.rename_path(moved, moved.with_name(PurePosixPath(target).name))
            thumb = target
    thumb = thumb or _thumb_of(case, name)

    placed = horizon_views.placement(spec, [list(point) for point in body.footprint] if body.footprint else None)
    attrs: dict[str, Any] = {"spec": rel, **placed}
    if thumb:
        attrs["thumb"] = thumb
    existing = case.find_entity(attr="spec", value=old_rel or rel)
    if existing:
        stale = comparisons.moved(existing.get("attrs") or {}, placed)
        case.update_entity(existing["id"], {"label": name, "attrs": attrs})
        entity_id = existing["id"]
    else:
        stale = True
        entity_id = case.add_entity(horizon_views.TYPE, name, attrs=attrs, by="horizon")["id"]
    if old_rel:
        horizon_views.follow_rename(case, old_rel, rel)
        if not case_only(old, name):
            case.resolve_inside(old_rel).unlink(missing_ok=True)
    located = (entity_id, placed["lat"], placed["lon"]) if stale else None
    return {"name": name, "title": name, "spec_path": rel, "thumb": thumb}, located


@router.put("/cases/{case_id}/horizon/views/{name}/thumb")
async def save_view_thumb(case_id: str, name: str, file: UploadFile = File()) -> dict[str, Any]:
    """The picture the saved work lists show for a view, drawn by the browser at its save."""
    case = get_case(case_id)
    raw = await file.read(inspectwork.MAX_THUMB_BYTES + 1)
    try:
        data = inspectwork.preview_webp(raw)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    stem = slugify(name, FALLBACK)
    rel = layout.horizon_view_rel(stem)
    thumb = layout.horizon_thumb_rel(stem)
    with case.lock:
        if not case.resolve_inside(rel).is_file():
            raise HTTPException(status_code=404, detail="view not found")
        replace_atomic(case.resolve_inside(thumb), data)
        entity = case.find_entity(attr="spec", value=rel)
        if entity and (entity.get("attrs") or {}).get("thumb") != thumb:
            case.update_entity(entity["id"], {"attrs": {"thumb": thumb}})
    saved_changed(case)
    return {"thumb": thumb}


@router.post("/cases/{case_id}/horizon/views/{name}/images")
async def keep_image(
    case_id: str,
    name: str,
    image: UploadFile = File(),
    kind: Literal["view", "turn", "row", "column", "photo", "terrain"] = Form(),
    filename: str = Form(min_length=1, max_length=120),
    attribution: str = Form(default="", max_length=500),
) -> dict[str, Any]:
    """Keep one picture of a saved view in the case, as an image nothing replaces.

    It carries the view it was drawn from as that view stood when it was kept,
    since the view may move on. `photo` and `terrain` are the two halves a Geo
    Proof is made of: the photo with the terrain's ridge lines over it, and the
    terrain alone through the same frame. A picture of a view matched on a photo
    comes from that photo (`from`), which is where a proof finds its source link;
    it stands at the eye, which is where the photo was taken from.
    """
    case = get_case(case_id)
    stem = slugify(name, FALLBACK)
    spec_rel = layout.horizon_view_rel(stem)
    saved = _read_view(case, stem)
    if saved is None or case.find_entity(attr="spec", value=spec_rel) is None:
        raise HTTPException(status_code=404, detail="save the view before keeping its pictures")
    data = _png_bytes(await image.read(MAX_KEPT_BYTES + 1))
    spec = saved.get("spec") or {}
    eye = spec.get("eye") or {}
    look = spec.get("look") or {}
    source: dict[str, Any] = {
        "type": horizon_views.SOURCE_TYPE,
        horizon_views.VIEW_KEY: spec_rel,
        "kept": True,
        "kind": kind,
        "lat": eye.get("lat"),
        "lon": eye.get("lon"),
        "heading": look.get("heading"),
        "fov": look.get("fov"),
        "rendered_at": _now(),
        # the composer writes the terrain's and the imagery's credits into the picture
        "attribution_burned": kind not in ("photo", "terrain"),
    }
    if attribution.strip():
        source["attribution"] = attribution.strip()
    photo = spec.get("photo")
    if isinstance(photo, dict) and photo.get("path"):
        source["photo"] = photo["path"]
        source["from"] = photo["path"]
    attrs = {"lat": eye.get("lat"), "lon": eye.get("lon"), horizon_views.VIEW_ATTR: spec_rel}
    try:
        filed = media_engine.import_rendered_bytes(
            case, data, filename, ".png", source, by="horizon", extra_attrs=attrs
        )
    except (OSError, ValueError, CaseError) as exc:
        raise HTTPException(status_code=409, detail=f"could not keep the picture: {errors.explain(exc)}") from exc
    saved_changed(case)
    return {"path": filed["item"]["path"], "entity": filed["entity"]["id"]}


@router.post("/cases/{case_id}/horizon/captures")
async def capture_view(
    case_id: str,
    image: UploadFile = File(),
    filename: str = Form(min_length=1, max_length=120),
    lat: float = Form(ge=-90, le=90, allow_inf_nan=False),
    lon: float = Form(ge=-180, le=180, allow_inf_nan=False),
    heading: float = Form(ge=0, le=360, allow_inf_nan=False),
    fov: float = Form(gt=0, le=360, allow_inf_nan=False),
    area: bool = Form(default=False),
    view: str = Form(default="", max_length=200),
    photo: str = Form(default="", max_length=1024),
    attribution: str = Form(default="", max_length=500),
) -> dict[str, Any]:
    """File the view as it shows, or an area of it, as a capture nothing replaces.

    Saved or not, the view needs nothing more: the capture says where the eye
    stood and what the picture faces (`heading` and `fov` are the picture's own,
    a loupe or an area narrower than the view's lens). A saved view it was taken
    from is named (`view`), and so is the photo laid over it (`photo`, `from`),
    which stands at the eye too.
    """
    case = get_case(case_id)
    source: dict[str, Any] = {
        "type": horizon_views.SOURCE_TYPE,
        "kind": "capture",
        "area": area,
        "lat": lat,
        "lon": lon,
        "heading": heading % 360,
        "fov": fov,
        "rendered_at": _now(),
        # the composer writes the terrain's and the imagery's credits into the picture
        "attribution_burned": True,
    }
    attrs: dict[str, Any] = {"lat": lat, "lon": lon}
    if view.strip():
        spec_rel = layout.horizon_view_rel(slugify(view, FALLBACK))
        if _read_view(case, slugify(view, FALLBACK)) is None or case.find_entity(attr="spec", value=spec_rel) is None:
            raise HTTPException(status_code=404, detail="that view is not saved in the case")
        # listed under its view with the pictures kept from it, and following its renames
        source["kept"] = True
        source[horizon_views.VIEW_KEY] = spec_rel
        attrs[horizon_views.VIEW_ATTR] = spec_rel
    if photo.strip():
        try:
            laid = case.resolve_inside(photo.strip())
        except CaseError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        if not laid.is_file():
            raise HTTPException(status_code=404, detail="the photo is not in the case")
        source["photo"] = photo.strip()
        source["from"] = photo.strip()
    if attribution.strip():
        source["attribution"] = attribution.strip()
    data = _png_bytes(await image.read(MAX_KEPT_BYTES + 1))
    try:
        filed = media_engine.import_rendered_bytes(case, data, filename, ".png", source, by="horizon", extra_attrs=attrs)
    except (OSError, ValueError, CaseError) as exc:
        raise HTTPException(status_code=409, detail=f"could not file the capture: {errors.explain(exc)}") from exc
    saved_changed(case)
    return {"path": filed["item"]["path"], "entity": filed["entity"]["id"]}


def _png_bytes(raw: bytes) -> bytes:
    """A PNG the browser drew, checked by its header before a pixel is decoded, written again."""
    if len(raw) > MAX_KEPT_BYTES:
        raise HTTPException(status_code=413, detail="that picture is too large")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            opened = Image.open(io.BytesIO(raw))
            if opened.format != "PNG":
                raise ValueError("not a PNG")
            if opened.width * opened.height > MAX_KEPT_PIXELS:
                raise HTTPException(status_code=413, detail="that picture has too many pixels")
            picture = opened.convert("RGB")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="that is not a picture of the view") from exc
    out = io.BytesIO()
    picture.save(out, "PNG", optimize=True)
    return out.getvalue()


@router.delete("/cases/{case_id}/horizon/views/{name}")
def delete_view(case_id: str, name: str) -> dict[str, Any]:
    """Delete the view and its preview. Images kept from it stay in Media."""
    case = get_case(case_id)
    rel = layout.horizon_view_rel(slugify(name, FALLBACK))
    try:
        case.resolve_inside(rel)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    result = delete_by_path(case, rel)
    if not result["deleted"]:
        artifact_engine.delete(case, {"type": horizon_views.TYPE, "attrs": {"spec": rel}})
    return result
