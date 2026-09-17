"""Saved Compare sessions, their rendered image and animated exports.

A session stores the reading, not its pixels: the two providers and their
variants, independent reference layers, the shared camera, the comparison mode,
Difference settings and ground-anchored annotations. It lives under
``.compare/``.

Its rendered image is a media working file, filed through the media pipeline
with ``source.type = "compare"`` so the Media Library holds it back with the
other files the app produced. Saving the session again replaces that one file
instead of adding another, unless something was already derived from it: a
proof built on a comparison must keep the pixels it was built on, so the new
render then becomes a new file and the session points at it.

Finished copies go to the configured export destination and are not case state.
"""

from __future__ import annotations

import io
import json
import warnings
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel, Field, model_validator

from .. import config, layout
from ..engine import artifacts as artifact_engine
from ..engine import exportdir, sentinel, tiles
from ..engine import links as link_engine
from ..engine import media as media_engine
from ..workspace import Case, CaseError
from .cases import delete_by_path, get_case
from .naming import read_created_at, slugify

router = APIRouter(prefix="/api", tags=["compare"])

OVERLAYS = frozenset({
    "labels", "boundaries", "roads", "railway", "power", "seamarks", "gpstraces",
    "firms", "nightlights", "saved",
})
MAX_FRAME_BYTES = 24_000_000
MAX_GIF_PIXELS = 16_000_000
MAX_GIF_EDGE = 1280
#: Two PNGs plus multipart framing, enforced before uploads are materialised.
MAX_GIF_BODY_BYTES = MAX_FRAME_BYTES * 2 + 1_000_000
#: What a saved comparison's media sidecar records as its producer.
SOURCE_TYPE = "compare"

_DAY = r"^(|\d{4}-\d{2}-\d{2})$"


class CompareCamera(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    zoom: float = Field(ge=0, le=24)
    bearing: float = Field(default=0, ge=0, lt=360)


class CompareSentinel(BaseModel):
    layer: str = Field(default="TRUE_COLOR", min_length=1, max_length=100)
    date: str = Field(default="", pattern=_DAY)
    maxcc: int = Field(default=100, ge=0, le=100)


class CompareFirms(BaseModel):
    sensor: str = Field(default="viirs", min_length=1, max_length=50)
    window: str = Field(default="24h", min_length=1, max_length=20)
    first: str = Field(default="", pattern=_DAY)
    last: str = Field(default="", pattern=_DAY)


class CompareNightlights(BaseModel):
    source: Literal["noaa20", "snpp", "composite"] = "noaa20"
    day: str = Field(default="", pattern=_DAY)


class CompareSide(BaseModel):
    present: bool = False
    provider: str = Field(default="esri-world-imagery", min_length=1, max_length=500)
    overlays: list[str] = Field(default_factory=list, max_length=len(OVERLAYS))
    sentinel: CompareSentinel = Field(default_factory=CompareSentinel)
    wayback_release: int | None = Field(default=None, ge=1)
    firms: CompareFirms = Field(default_factory=CompareFirms)
    nightlights: CompareNightlights = Field(default_factory=CompareNightlights)


ChangeClass = Literal["gain", "loss", "changed"]


def _change_classes() -> list[ChangeClass]:
    return ["gain", "loss", "changed"]


class CompareChangeAssist(BaseModel):
    method: Literal["colour", "structure", "brightness", "index"] = "colour"
    index: Literal["ndvi", "ndwi", "mndwi", "nbr", "ndbi", "bsi"] = "ndvi"
    threshold: Literal["auto", "manual"] = "auto"
    sensitivity: int = Field(default=55, ge=0, le=100)
    # "auto" is nothing on Sentinel-2, whose passes are already corrected, and a
    # histogram on Esri releases, which carry two renderings.
    normalize: Literal["auto", "none", "mean", "histogram"] = "auto"
    smoothing: int = Field(default=1, ge=0, le=4)
    alignment: int = Field(default=4, ge=0, le=8)
    cleanup: int = Field(default=1, ge=0, le=3)
    min_area: float = Field(default=0, ge=0, le=1_000_000)
    ignore_clouds: bool = False
    ignore_shadows: bool = False
    # How far to grow the cloud and shadow mask, in ground metres: the reading
    # follows the camera, so a count of pixels would mean a different distance
    # at every zoom.
    cloud_margin: int = Field(default=50, ge=0, le=200)
    classes: list[ChangeClass] = Field(
        default_factory=_change_classes, max_length=3
    )
    display: Literal["heat", "classes", "outline"] = "classes"
    palette: Literal["directional", "colourblind", "thermal"] = "directional"
    zones: bool = True
    opacity: int = Field(default=70, ge=0, le=100)
    # "side" lays the same reading over both images instead of one of them.
    base: Literal["a", "b", "side"] = "b"
    visible: bool = True
    # Flashing the overlay on and off, which is easier to catch than a still one.
    blink: bool = False


AnnotationKind = Literal[
    "text", "arrow", "line", "rect", "ellipse", "freehand", "measure", "polygon"
]
#: How many ground points each kind holds: an exact count, or (minimum, maximum).
_POINT_COUNTS: dict[str, tuple[int, int]] = {
    "text": (1, 1),
    "arrow": (2, 2),
    "line": (2, 2),
    "measure": (2, 2),
    "rect": (2, 2),
    "ellipse": (2, 2),
    "freehand": (2, 400),
    "polygon": (3, 200),
}


class CompareAnnotation(BaseModel):
    """One mark pinned to the ground, so it follows the imagery under it."""

    id: str = Field(min_length=1, max_length=80)
    kind: AnnotationKind
    side: Literal["both", "a", "b"] = "both"
    colour: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    #: ``[lon, lat]`` pairs.
    points: list[tuple[float, float]] = Field(min_length=1, max_length=400)
    stroke_width: int = Field(default=3, ge=1, le=24)
    fill_opacity: float = Field(default=0, ge=0, le=1)
    font_size: int = Field(default=16, ge=8, le=72)
    text: str = Field(default="", max_length=240)

    @model_validator(mode="after")
    def _shape(self) -> "CompareAnnotation":
        low, high = _POINT_COUNTS[self.kind]
        if not low <= len(self.points) <= high:
            raise ValueError(f"a {self.kind} annotation holds {low} to {high} points")
        for lon, lat in self.points:
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError("annotation points must be WGS84 longitude and latitude")
        if self.kind == "text" and not self.text.strip():
            raise ValueError("a text annotation needs text")
        return self


class CompareBlink(BaseModel):
    interval: int = Field(default=800, ge=200, le=4000)


class CompareSpec(BaseModel):
    version: Literal[2] = 2
    camera: CompareCamera
    mode: Literal["side", "swipe", "opacity", "blink", "change"] = "side"
    divider: int = Field(default=50, ge=0, le=100)
    opacity: int = Field(default=50, ge=0, le=100)
    blink: CompareBlink = Field(default_factory=CompareBlink)
    change_assist: CompareChangeAssist = Field(default_factory=CompareChangeAssist)
    annotations: list[CompareAnnotation] = Field(default_factory=list, max_length=200)
    a: CompareSide
    b: CompareSide


class SessionIn(BaseModel):
    rename_from: str | None = None
    overwrite: bool = False
    title: str = Field(min_length=1, max_length=200)
    spec: CompareSpec


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _validated_spec(spec: CompareSpec) -> dict[str, Any]:
    cleaned = spec.model_dump()
    for key in ("a", "b"):
        side = cleaned[key]
        try:
            tiles.get_provider(side["provider"])
        except KeyError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        unknown = set(side["overlays"]) - OVERLAYS
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=f"unknown comparison layer '{sorted(unknown)[0]}'",
            )
        # Repeating a layer has no visual meaning and makes session diffs noisy.
        side["overlays"] = list(dict.fromkeys(side["overlays"]))
    assist = cleaned["change_assist"]
    assist["classes"] = list(dict.fromkeys(assist["classes"]))
    for mark in cleaned["annotations"]:
        mark["points"] = [list(point) for point in mark["points"]]
    if cleaned["mode"] == "change":
        reason = change_refusal(cleaned["a"], cleaned["b"], assist["method"])
        if reason:
            raise HTTPException(status_code=422, detail=reason)
    return cleaned


def _same_layers(a: dict[str, Any], b: dict[str, Any], *, skip: str | None = None) -> bool:
    left = set(a["overlays"])
    right = set(b["overlays"])
    if skip:
        left.discard(skip)
        right.discard(skip)
    if left != right:
        return False
    if "firms" in left and a["firms"] != b["firms"]:
        return False
    if "nightlights" in left and a["nightlights"] != b["nightlights"]:
        return False
    return True


_ESRI_CHAIN = frozenset({"esri-world-imagery", "esri-wayback"})


def change_refusal(a: dict[str, Any], b: dict[str, Any], method: str = "colour") -> str | None:
    """Why a raw pixel reading of this pair would mislead, or None when it is fair.

    Mirrors ``changeCompatibility`` in ``lib/map/changeAssist.js``, which also
    grades a fair pair as matched or indicative. The server only refuses; the
    grade is explanation, and the browser shows it.
    """
    if not a["present"] or not b["present"]:
        return "Difference needs imagery A and B"
    if method == "index":
        if a["provider"] != "sentinel2" or b["provider"] != "sentinel2":
            return "Spectral indices need Sentinel-2 on both sides"
        if not a["sentinel"]["date"] or not b["sentinel"]["date"]:
            return "Spectral indices need a dated pass on both sides"
        if a["sentinel"]["date"] == b["sentinel"]["date"]:
            return "Choose two different Sentinel-2 passes"
        return None
    if a["provider"] == b["provider"] == "sentinel2":
        if not a["sentinel"]["date"] or not b["sentinel"]["date"]:
            return "Choose a dated Sentinel-2 pass on both sides"
        if a["sentinel"]["date"] == b["sentinel"]["date"]:
            return "Choose two different Sentinel-2 passes"
        if a["sentinel"]["layer"] != b["sentinel"]["layer"]:
            return "Sentinel-2 needs the same layer on both sides"
        if not _same_layers(a, b):
            return "Match the reference layers on A and B"
        return None
    if {a["provider"], b["provider"]} <= _ESRI_CHAIN:
        same_picture = (
            a["provider"] == b["provider"]
            and a["wayback_release"] == b["wayback_release"]
        )
        if same_picture:
            return "Choose two different Esri releases"
        if not _same_layers(a, b):
            return "Match the reference layers on A and B"
        return None
    night_a = "nightlights" in a["overlays"]
    night_b = "nightlights" in b["overlays"]
    if night_a and night_b:
        if a["provider"] != b["provider"]:
            return "Night lights need the same background imagery on A and B"
        if a["nightlights"]["source"] != b["nightlights"]["source"]:
            return "Night lights need the same VIIRS product on A and B"
        if a["nightlights"]["source"] == "composite":
            return "The night-light composite has one date only"
        if (
            not a["nightlights"]["day"]
            or not b["nightlights"]["day"]
            or a["nightlights"]["day"] == b["nightlights"]["day"]
        ):
            return "Choose two different nights"
        if a["sentinel"] != b["sentinel"] or a["wayback_release"] != b["wayback_release"]:
            return "Match the background imagery on A and B"
        if not _same_layers(a, b, skip="nightlights"):
            return "Match every other layer on A and B"
        return None
    return "Difference reads Sentinel-2, Esri imagery releases or VIIRS night-light pairs"


def _read_session(case: Case, name: str) -> dict[str, Any] | None:
    try:
        path = case.resolve_inside(layout.compare_session_rel(name))
    except CaseError:
        return None
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return saved if saved.get("azimut_compare") == 1 else None


def _preview_of(case: Case, spec_rel: str) -> str | None:
    """The media working file a session renders into, if it still exists."""
    entity = case.find_entity(attr="spec", value=spec_rel)
    preview = (entity.get("attrs") or {}).get("preview") if entity else None
    if not isinstance(preview, str) or not preview:
        return None
    try:
        return preview if case.resolve_inside(preview).is_file() else None
    except CaseError:
        return None


@router.get("/cases/{case_id}/compare/sessions")
def list_sessions(case_id: str) -> list[dict[str, Any]]:
    case = get_case(case_id)
    out = []
    folder = case.subdir(layout.COMPARE_DIR)
    for path in sorted(folder.glob("*.json")):
        saved = _read_session(case, path.stem)
        if saved is None:
            continue
        spec = saved.get("spec") or {}
        out.append({
            "name": path.stem,
            "title": saved.get("title", path.stem),
            "updated_at": saved.get("updated_at"),
            "provider_a": (spec.get("a") or {}).get("provider"),
            "provider_b": (spec.get("b") or {}).get("provider"),
            "mode": spec.get("mode", "side"),
            "preview": _preview_of(case, layout.compare_session_rel(path.stem)),
        })
    out.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return out


@router.get("/cases/{case_id}/compare/sessions/{name}")
def load_session(case_id: str, name: str) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        path = case.resolve_inside(layout.compare_session_rel(name))
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="comparison session not found")
    saved = _read_session(case, name)
    if saved is None:
        raise HTTPException(status_code=422, detail="that is not a readable comparison session")
    return {**saved, "preview": _preview_of(case, layout.compare_session_rel(name))}


@router.post("/cases/{case_id}/compare/sessions")
def save_session(case_id: str, body: SessionIn) -> dict[str, Any]:
    case = get_case(case_id)
    case.subdir(layout.COMPARE_DIR).mkdir(parents=True, exist_ok=True)
    name = slugify(body.title, "Comparison")
    rel = layout.compare_session_rel(name)
    path = case.resolve_inside(rel)
    old = slugify(body.rename_from, "Comparison") if body.rename_from else None
    old_rel = layout.compare_session_rel(old) if old and old != name else None
    if old_rel and path.exists():
        raise HTTPException(status_code=409, detail="another comparison already uses that name")
    if body.rename_from is None and path.exists() and not body.overwrite:
        raise HTTPException(status_code=409, detail="a comparison already uses that name")

    previous = case.resolve_inside(layout.compare_session_rel(old or name))
    saved = {
        "azimut_compare": 1,
        "title": name,
        "created_at": read_created_at(previous) or _now(),
        "updated_at": _now(),
        "spec": _validated_spec(body.spec),
    }
    media_engine.write_json_atomic(path, saved)

    existing = case.find_entity(attr="spec", value=old_rel or rel)
    if existing:
        patch: dict[str, Any] = {"label": name}
        if old_rel:
            patch["attrs"] = {"spec": rel}
        case.update_entity(existing["id"], patch)
    else:
        case.add_entity("compare-session", name, attrs={"spec": rel}, by="compare")
    if old_rel:
        case.resolve_inside(old_rel).unlink(missing_ok=True)
    return {"name": name, "title": name, "spec_path": rel}


def _gif_bytes(a: Image.Image, b: Image.Image, animation: str, interval: int = 700) -> bytes:
    frames = _gif_frames(a, b, animation)
    palette = [
        frame.quantize(colors=192, method=Image.Quantize.MEDIANCUT)
        for frame in frames
    ]
    buf = io.BytesIO()
    palette[0].save(
        buf,
        "GIF",
        save_all=True,
        append_images=palette[1:],
        duration=interval if animation == "blink" else 90,
        loop=0,
        optimize=True,
        disposal=2,
    )
    return buf.getvalue()


def _in_use(case: Case, entity_id: str) -> bool:
    """Whether anything in the case was derived from, or depends on, this file."""
    for link in case.links_touching(
        [entity_id], types=[link_engine.DERIVED_FROM, link_engine.DEPENDS_ON]
    ):
        if link.get("to") == entity_id:
            return True
    return False


@router.post("/cases/{case_id}/compare/sessions/{name}/preview")
async def save_session_preview(
    case_id: str,
    name: str,
    image_a: UploadFile = File(),
    image_b: UploadFile | None = File(default=None),
    format_: Literal["png", "blink"] = Form(alias="format"),
    interval: int = Form(default=800, ge=200, le=4000),
) -> dict[str, Any]:
    """File the rendered comparison as the session's media working file.

    One file per session: a later save replaces its bytes in place, unless the
    format changed or something was derived from it, in which case the render
    becomes a new file (see the module docstring).
    """
    case = get_case(case_id)
    canonical = slugify(name, "Comparison")
    spec_rel = layout.compare_session_rel(canonical)
    session = _read_session(case, canonical)
    entity = case.find_entity(attr="spec", value=spec_rel)
    if session is None or entity is None:
        raise HTTPException(status_code=404, detail="comparison session not found")

    a = await _read_png(image_a, "A")
    if format_ == "blink":
        if image_b is None:
            raise HTTPException(status_code=422, detail="a blink preview needs image B")
        b = await _read_png(image_b, "B")
        data = _gif_bytes(a, b, "blink", interval)
        suffix = ".gif"
    else:
        out = io.BytesIO()
        a.save(out, "PNG", optimize=True)
        data = out.getvalue()
        suffix = ".png"

    spec = session["spec"]
    camera = spec["camera"]
    source = {
        "type": SOURCE_TYPE,
        "session": spec_rel,
        "mode": spec["mode"],
        "providers": {"a": spec["a"]["provider"], "b": spec["b"]["provider"]},
        "lat": camera["lat"],
        "lon": camera["lon"],
        "zoom": camera["zoom"],
        "bearing": camera["bearing"],
        "rendered_at": _now(),
        # The composer writes both provider credits into the image footer.
        "attribution_burned": True,
    }
    attrs = {"lat": camera["lat"], "lon": camera["lon"], "compare_session": spec_rel}

    current = _preview_of(case, spec_rel)
    current_entity = case.find_entity(attr="path", value=current) if current else None
    replaced = False
    try:
        if (
            current
            and current_entity
            and current.endswith(suffix)
            and not _in_use(case, current_entity["id"])
        ):
            media_engine.replace_rendered_bytes(case, current, data, source, extra_attrs=attrs)
            rel = current
            if case.resolve_inside(current).stem != canonical:
                rel = media_engine.rename_media(case, current, canonical)["path"]
            replaced = True
        else:
            filed = media_engine.import_rendered_bytes(
                case, data, canonical, suffix, source, by="compare", extra_attrs=attrs
            )
            rel = filed["item"]["path"]
            # A render nothing was built on is the session's alone: the old
            # format goes to the Trash rather than lingering beside the new one.
            if current and current_entity and not _in_use(case, current_entity["id"]):
                delete_by_path(case, current)
        case.update_entity(entity["id"], {"attrs": {"preview": rel}})
    except (OSError, ValueError, CaseError) as exc:
        raise HTTPException(status_code=409, detail=f"could not save the image: {exc}") from exc
    return {"path": rel, "format": format_, "replaced": replaced}


@router.delete("/cases/{case_id}/compare/sessions/{name}")
def delete_session(case_id: str, name: str) -> dict[str, Any]:
    """Delete the editable session. Its rendered image stays in Media."""
    case = get_case(case_id)
    rel = layout.compare_session_rel(slugify(name, "Comparison"))
    try:
        case.resolve_inside(rel)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    result = delete_by_path(case, rel)
    if not result["deleted"]:
        artifact_engine.delete(case, {"type": "compare-session", "attrs": {"spec": rel}})
    return result


async def _read_png(upload: UploadFile, side: str) -> Image.Image:
    raw = await upload.read(MAX_FRAME_BYTES + 1)
    if len(raw) > MAX_FRAME_BYTES:
        raise HTTPException(status_code=413, detail=f"comparison frame {side} is too large")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            opened = Image.open(io.BytesIO(raw))
            if opened.format != "PNG":
                raise ValueError("not a PNG")
            frame = opened.convert("RGB")
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=413, detail=f"comparison frame {side} is too large") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"comparison frame {side} is unreadable") from exc
    if frame.width * frame.height > MAX_GIF_PIXELS:
        raise HTTPException(status_code=413, detail=f"comparison frame {side} has too many pixels")
    return frame


def _gif_frames(a: Image.Image, b: Image.Image, animation: str) -> list[Image.Image]:
    if max(a.size) > MAX_GIF_EDGE:
        scale = MAX_GIF_EDGE / max(a.size)
        a = a.resize(
            (max(1, round(a.width * scale)), max(1, round(a.height * scale))),
            Image.Resampling.LANCZOS,
        )
    if b.size != a.size:
        b = b.resize(a.size, Image.Resampling.LANCZOS)
    if animation == "blink":
        return [a, b]
    positions = [0, 13, 25, 38, 50, 63, 75, 88, 100, 88, 75, 63, 50, 38, 25, 13]
    frames = []
    for percent in positions:
        split = round(a.width * percent / 100)
        frame = a.copy()
        if split < a.width:
            frame.paste(b.crop((split, 0, a.width, a.height)), (split, 0))
        frames.append(frame)
    return frames


@router.post("/cases/{case_id}/compare/gif")
async def export_gif(
    case_id: str,
    image_a: UploadFile,
    image_b: UploadFile,
    animation: Literal["blink", "slide"] = Form(),
    interval: int = Form(default=800, ge=200, le=4000),
    filename: str = Form(default="comparison", min_length=1, max_length=120),
) -> dict[str, str]:
    """Write a bounded animation to the configured export destination."""
    case = get_case(case_id)
    a = await _read_png(image_a, "A")
    b = await _read_png(image_b, "B")
    data = _gif_bytes(a, b, animation, interval)
    name = f"{layout.slugify(filename, 'comparison')}-{animation}.gif"
    try:
        export_destination = exportdir.destination("views", case.path)
        in_case = export_destination == layout.subdir(case.path, "exports")
        if in_case:
            path = export_destination / name
            path.write_bytes(data)
        else:
            path = exportdir.write_out(data, export_destination, name)
    except (OSError, exportdir.ExportDirError) as exc:
        raise HTTPException(status_code=409, detail=f"could not write the GIF: {exc}") from exc
    return {"file": path.name, "path": str(export_destination), "animation": animation}


class BandFrameIn(BaseModel):
    """A Web Mercator box, its pixel size, and the pass to read a band frame from."""

    west: float
    south: float
    east: float
    north: float
    width: int = Field(ge=1, le=sentinel.PRODUCT_MAX_EDGE)
    height: int = Field(ge=1, le=sentinel.PRODUCT_MAX_EDGE)
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    # A spectral index, or `sky` alone for a cloud filter over the picture methods.
    product: Literal["ndvi", "ndwi", "mndwi", "nbr", "ndbi", "bsi", "sky"]
    maxcc: int = Field(default=100, ge=0, le=100)
    layer: str = Field(default="TRUE_COLOR", min_length=1, max_length=40)


@router.post("/compare/sentinel-frame")
def sentinel_frame(body: BandFrameIn) -> Response:
    """Render one Sentinel-2 band frame over the compared view.

    Asked only when the analyst runs Difference with a spectral index or with the
    cloud filter over Sentinel-2. One metered Sentinel Hub request per side,
    refused like the tiles once the monthly free tier is nearly spent.
    """
    instance = (config.load_settings().get("api_keys") or {}).get("sentinelhub")
    if not instance:
        raise HTTPException(status_code=404, detail="no Sentinel Hub key saved")
    if config.usage_blocked("sentinelhub"):
        raise HTTPException(
            status_code=429,
            detail=f"Sentinel Hub is paused: {int(config.BLOCK_SHARE * 100)}% of the monthly "
            "free tier is used; enable the override in Settings to keep going",
        )
    try:
        data = sentinel.band_frame(
            instance,
            (body.west, body.south, body.east, body.north),
            body.width,
            body.height,
            body.day,
            f"change-{body.product}",
            body.maxcc,
            layer=body.layer,
        )
    except ValueError as exc:
        # refused before anything was sent, so nothing is metered
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        config.record_usage("sentinelhub", 1)
        raise HTTPException(status_code=502, detail=f"band request failed: {exc}") from exc
    config.record_usage("sentinelhub", 1)
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "no-store"})
