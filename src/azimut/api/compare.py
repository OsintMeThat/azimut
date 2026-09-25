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

The image records the date of each picture it shows (`imagery_a`, `imagery_b`),
the same fact a capture keeps as its imagery date: two instants, never a range,
because a comparison does not say that anything happened between them. A date a
provider only estimated is kept with `exact: false` beside it.

Finished copies go to the configured export destination and are not case state.
They are named by those dates, so two comparisons of one pair would share a name,
and none ever overwrites another. An export may also be kept in the case: it is then
a media file of its own, stamped with the reading it shows and never replaced
(`engine/comparisons.py`). An evolution, the dated pictures of one archive played
in order, is only ever a finished copy.

A saved comparison stands on the map as saved work, at its frame's centre or its
view's, and is listed with the captures in the Saved panel.
"""

from __future__ import annotations

import io
import json
import warnings
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel, Field, field_validator, model_validator

from .. import config, layout
from ..engine import artifacts as artifact_engine
from ..engine import comparisons, exportdir, sentinel, tiles
from ..engine import links as link_engine
from ..engine.analysis_models import RETIRED_OVERLAYS
from ..engine import media as media_engine
from ..workspace import Case, CaseError
from .cases import delete_by_path, get_case
from .naming import case_only, holders, read_created_at, slugify
from .satellite import locate_on_save, saved_changed

router = APIRouter(prefix="/api", tags=["compare"])

OVERLAYS = frozenset({
    "boundaries", "roads", "railway", "power", "seamarks", "gpstraces",
    "firms", "nightlights", "saved",
})
MAX_FRAME_BYTES = 24_000_000
MAX_GIF_PIXELS = 16_000_000
MAX_GIF_EDGE = 1280
#: Two PNGs plus multipart framing, enforced before uploads are materialised.
MAX_GIF_BODY_BYTES = MAX_FRAME_BYTES * 2 + 1_000_000
#: An evolution: the pictures of one point, one after another. The browser draws
#: each at most `MAX_GIF_EDGE` across plus its header band, so a frame is a few
#: megabytes at most and its pixel count is checked before it is decoded.
MAX_SEQUENCE_FRAMES = 40
MAX_SEQUENCE_FRAME_BYTES = 8_000_000
MAX_SEQUENCE_FRAME_PIXELS = MAX_GIF_EDGE * MAX_GIF_EDGE * 2
MAX_SEQUENCE_BODY_BYTES = MAX_SEQUENCE_FRAMES * MAX_SEQUENCE_FRAME_BYTES + 1_000_000
#: How many intervals the last picture stays up, so the loop reads as an ending.
SEQUENCE_HOLD = 3
#: What a saved comparison's media sidecar records as its producer.
SOURCE_TYPE = "compare"
#: The reading a kept image carries, as JSON. A session holds at most 200
#: annotations, each a handful of points and a short text.
MAX_SPEC_CHARS = 400_000

_DAY = r"^(|\d{4}-\d{2}-\d{2})$"
#: A picture's date as the browser states it: a day, or a radar pass's UTC instant.
_PICTURE_DATE = r"^(|\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ)?)$"
#: The colours a GIF keeps exactly, comma-separated: the marks drawn on the
#: pictures and the export's own inks. Median cut spends a palette on the
#: imagery, so a thin red outline over fields came out a dull brown and a green
#: and a blue mark came out one teal.
GIF_COLOURS = 192
MAX_KEPT_COLOURS = 32
_KEPT_COLOURS = r"^(#[0-9a-fA-F]{6}(,#[0-9a-fA-F]{6}){0,31})?$"


class CompareCamera(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    zoom: float = Field(ge=0, le=24)
    bearing: float = Field(default=0, ge=0, lt=360)


class CompareSentinel(BaseModel):
    layer: str = Field(default="TRUE_COLOR", min_length=1, max_length=100)
    date: str = Field(default="", pattern=_DAY)
    maxcc: int = Field(default=100, ge=0, le=100)


class CompareRadar(BaseModel):
    """A Sentinel-1 pass: its day and its UTC time, which says which look."""

    date: str = Field(default="", pattern=_DAY)
    time: str = Field(default="", pattern=r"^$|^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$")


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
    # Room for a retired layer too: it is dropped after, not refused here.
    overlays: list[str] = Field(default_factory=list, max_length=len(OVERLAYS) + len(RETIRED_OVERLAYS))
    sentinel: CompareSentinel = Field(default_factory=CompareSentinel)
    wayback_release: int | None = Field(default=None, ge=1)
    radar: CompareRadar = Field(default_factory=CompareRadar)
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
    # Which images carry the highlights, in whatever view mode the pair is read.
    base: Literal["a", "b", "both"] = "both"
    # Flashing the overlay on and off, which is easier to catch than a still one.
    blink: bool = False


AnnotationKind = Literal[
    "text", "arrow", "line", "rect", "ellipse", "freehand", "measure", "polygon",
    # Stamped whole on one point: a numbered disc, and a symbol from the drawing
    # set the Proof Maker stamps onto a panel.
    "number", "icon",
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
    "number": (1, 1),
    "icon": (1, 1),
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
    #: Also the side of a stamp, which has no letters to size and no line to widen.
    font_size: int = Field(default=16, ge=8, le=72)
    text: str = Field(default="", max_length=240)
    #: What a numbered marker counts to. Its series is its colour's, and the
    #: browser assigns it; the ceiling is what one picture can carry legibly.
    number: int = Field(default=1, ge=1, le=999)
    #: Which symbol a stamp draws, by name. Not checked against the drawing set:
    #: that set lives in the browser and grows there, and a name this build does
    #: not know is drawn as the first symbol rather than refused on the way in.
    glyph: str = Field(default="", max_length=40)
    #: The compass direction that was up on the screen a box or an ellipse was
    #: drawn on, in degrees: its sides run along that screen, not along north.
    angle: float = Field(default=0, allow_inf_nan=False)

    @field_validator("angle")
    @classmethod
    def _fold(cls, value: float) -> float:
        return value % 360

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


class CompareFrame(BaseModel):
    """What an export is cut to: two opposite corners of a ground rectangle.

    Held on the ground like an annotation, so a comparison reopened on another
    screen still exports the same roofs rather than the same pixels.
    """

    #: ``[lon, lat]`` pairs, in the order they were drawn.
    points: list[tuple[float, float]] = Field(min_length=2, max_length=2)
    #: The compass direction that was up when the frame was drawn, which is
    #: the way up it is exported at.
    angle: float = Field(default=0, allow_inf_nan=False)

    @field_validator("angle")
    @classmethod
    def _fold(cls, value: float) -> float:
        return value % 360

    @model_validator(mode="after")
    def _ground(self) -> "CompareFrame":
        for lon, lat in self.points:
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError("frame corners must be WGS84 longitude and latitude")
        if self.points[0] == self.points[1]:
            raise ValueError("an export frame needs two distinct corners")
        return self


class CompareSpec(BaseModel):
    version: Literal[2] = 2
    camera: CompareCamera
    mode: Literal["side", "swipe", "opacity", "blink"] = "side"
    #: Highlights laid over the view mode, not a mode of their own.
    difference: bool = False
    divider: int = Field(default=50, ge=0, le=100)
    opacity: int = Field(default=50, ge=0, le=100)
    blink: CompareBlink = Field(default_factory=CompareBlink)
    change_assist: CompareChangeAssist = Field(default_factory=CompareChangeAssist)
    annotations: list[CompareAnnotation] = Field(default_factory=list, max_length=200)
    #: Absent or null when the export takes the whole view.
    frame: CompareFrame | None = None
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
        # A layer that was retired drops out of a session saved with it.
        side["overlays"] = [entry for entry in side["overlays"] if entry not in RETIRED_OVERLAYS]
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
    if cleaned["frame"]:
        cleaned["frame"]["points"] = [list(point) for point in cleaned["frame"]["points"]]
    if cleaned["difference"]:
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
    if a["provider"] == b["provider"] == sentinel.RADAR_ID:
        radar_a, radar_b = a.get("radar") or {}, b.get("radar") or {}
        if not radar_a.get("date") or not radar_b.get("date"):
            return "Choose a dated Sentinel-1 pass on both sides"
        if (radar_a["date"], radar_a.get("time")) == (radar_b["date"], radar_b.get("time")):
            return "Choose two different Sentinel-1 passes"
        if not sentinel.same_track(radar_a.get("time", ""), radar_b.get("time", "")):
            return "Radar compares two passes of one track, at the same time of day"
        if not _same_layers(a, b):
            return "Match the reference layers on A and B"
        return None
    if {a["provider"], b["provider"]} <= _ESRI_CHAIN:
        same_picture = (
            a["provider"] == b["provider"]
            and a["wayback_release"] == b["wayback_release"]
        )
        if same_picture:
            return (
                "Both sides show the same picture. Pick another Esri release, "
                "or two dated Sentinel-2 passes"
            )
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
    return ("Difference reads Sentinel-2, Sentinel-1 on one track, Esri imagery releases or "
            "VIIRS night-light pairs")


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
    with case.lock:
        saved, located = _save_session(case, body)
    # Outside the lock: locating the point may ask a geocoder for its country.
    if located:
        locate_on_save(case, *located)
    saved_changed(case)
    return saved


def _save_session(
    case: Case, body: SessionIn
) -> tuple[dict[str, Any], tuple[str, float, float] | None]:
    """Names answer to Windows and macOS, and to the Trash.

    A name is taken by another comparison whatever its case, since two that differ
    only by case are one file on two of the three systems. A name in the Trash is
    not free either: the kept images of the deleted comparison still point at it,
    and would attach themselves to a new one standing somewhere else.
    """
    folder = case.subdir(layout.COMPARE_DIR)
    name = slugify(body.title, "Comparison")
    old = slugify(body.rename_from, "Comparison") if body.rename_from else None
    old_rel = layout.compare_session_rel(old) if old and old != name else None
    trashed = case.trashed_stems(layout.COMPARE_DIR)
    if old_rel:
        if holders(folder, name, source=old):
            raise HTTPException(status_code=409, detail="another comparison already uses that name")
        if name.casefold() in trashed and not case_only(old, name):
            raise HTTPException(
                status_code=409, detail="a comparison in the Trash uses that name"
            )
    elif body.rename_from is None:
        if holders(folder, name, source=name if body.overwrite else None):
            raise HTTPException(status_code=409, detail="a comparison already uses that name")
        if name.casefold() in trashed:
            taken = {p.stem.casefold() for p in folder.glob("*.json")} | trashed
            name = layout.free_stem(taken, name, "Comparison")
    rel = layout.compare_session_rel(name)
    path = case.resolve_inside(rel)
    if old_rel and case_only(old, name):
        source = case.resolve_inside(old_rel)
        # The name asked for, not `path`'s: Windows resolves a path to the case
        # already on disk.
        if source.is_file():
            path = source.with_name(PurePosixPath(rel).name)
            media_engine.rename_path(source, path)

    previous = path if old_rel and case_only(old, name) else case.resolve_inside(
        layout.compare_session_rel(old or name)
    )
    reading = _validated_spec(body.spec)
    saved = {
        "azimut_compare": 1,
        "title": name,
        "created_at": read_created_at(previous) or _now(),
        "updated_at": _now(),
        "spec": reading,
    }
    media_engine.write_json_atomic(path, saved)

    # The comparison stands where its reading is: saved work, beside the captures.
    placed = comparisons.placement(reading)
    existing = case.find_entity(attr="spec", value=old_rel or rel)
    if existing:
        stale = comparisons.moved(existing.get("attrs") or {}, placed)
        case.update_entity(existing["id"], {"label": name, "attrs": {"spec": rel, **placed}})
        entity_id = existing["id"]
    else:
        stale = True
        entity_id = case.add_entity("compare-session", name, attrs={"spec": rel, **placed},
                                    by="compare")["id"]
    if old_rel:
        comparisons.follow_rename(case, old_rel, rel)
        if not case_only(old, name):
            case.resolve_inside(old_rel).unlink(missing_ok=True)
    located = (entity_id, placed["lat"], placed["lon"]) if stale else None
    return {"name": name, "title": name, "spec_path": rel}, located


def _kept_colours(text: str) -> list[tuple[int, int, int]]:
    """The validated `keep` field as RGB triples, each once, in order."""
    kept: list[tuple[int, int, int]] = []
    for entry in filter(None, text.split(",")):
        rgb = (int(entry[1:3], 16), int(entry[3:5], 16), int(entry[5:7], 16))
        if rgb not in kept:
            kept.append(rgb)
    return kept[:MAX_KEPT_COLOURS]


def _quantize(frame: Image.Image, kept: list[tuple[int, int, int]]) -> Image.Image:
    """One frame in 192 colours, the kept ones among them exactly.

    The rest of the palette is median cut's answer for the imagery. Mapping onto a
    fixed palette dithers by default, which would speckle the marks' edges and change
    how the imagery has always looked, so it maps to the nearest entry instead.
    """
    if not kept:
        return frame.quantize(colors=GIF_COLOURS, method=Image.Quantize.MEDIANCUT)
    base = frame.quantize(colors=GIF_COLOURS - len(kept), method=Image.Quantize.MEDIANCUT)
    ground = (base.getpalette() or [])[: 3 * (GIF_COLOURS - len(kept))]
    entries = [channel for rgb in kept for channel in rgb] + ground
    # A palette image holds 256 entries; the spare ones repeat the first kept colour.
    entries += list(kept[0]) * ((768 - len(entries)) // 3)
    palette = Image.new("P", (1, 1))
    palette.putpalette(entries)
    return frame.quantize(palette=palette, dither=Image.Dither.NONE)


def _gif_bytes(
    a: Image.Image,
    b: Image.Image,
    animation: str,
    interval: int = 700,
    kept: list[tuple[int, int, int]] | None = None,
) -> bytes:
    frames = _gif_frames(a, b, animation)
    palette = [_quantize(frame, kept or []) for frame in frames]
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
    keep: str = Form(default="", pattern=_KEPT_COLOURS),
    imagery_a: str = Form(default="", pattern=_PICTURE_DATE),
    imagery_b: str = Form(default="", pattern=_PICTURE_DATE),
    imagery_a_exact: bool = Form(default=True),
    imagery_b_exact: bool = Form(default=True),
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
        data = _gif_bytes(a, b, "blink", interval, _kept_colours(keep))
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
    for key, value, exact in (("imagery_a", imagery_a, imagery_a_exact),
                              ("imagery_b", imagery_b, imagery_b_exact)):
        if value:
            source[key] = value
            if not exact:
                source[f"{key}_exact"] = False
    attrs = {"lat": camera["lat"], "lon": camera["lon"], comparisons.SESSION_ATTR: spec_rel}

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
    # the preview is the comparison's picture in the Saved panel
    saved_changed(case)
    return {"path": rel, "format": format_, "replaced": replaced}


@router.post("/cases/{case_id}/compare/sessions/{name}/images")
async def keep_image(
    case_id: str,
    name: str,
    image_a: UploadFile = File(),
    image_b: UploadFile | None = File(default=None),
    format_: Literal["png", "blink", "slide"] = Form(alias="format"),
    interval: int = Form(default=800, ge=200, le=4000),
    keep: str = Form(default="", pattern=_KEPT_COLOURS),
    filename: str = Form(min_length=1, max_length=120),
    spec: str = Form(min_length=2, max_length=MAX_SPEC_CHARS),
    imagery_a: str = Form(default="", pattern=_PICTURE_DATE),
    imagery_b: str = Form(default="", pattern=_PICTURE_DATE),
    imagery_a_exact: bool = Form(default=True),
    imagery_b_exact: bool = Form(default=True),
) -> dict[str, Any]:
    """Keep one export in the case, as an image nothing replaces.

    The session's preview is redrawn by every save; this is the copy somebody chose
    to keep, so it carries the reading it was made from rather than the session's,
    which may have moved on since. It is named like the finished copy and never
    written over another file.
    """
    case = get_case(case_id)
    canonical = slugify(name, "Comparison")
    spec_rel = layout.compare_session_rel(canonical)
    if _read_session(case, canonical) is None or case.find_entity(attr="spec", value=spec_rel) is None:
        raise HTTPException(status_code=404, detail="save the comparison before keeping its images")
    try:
        reading = _validated_spec(CompareSpec.model_validate_json(spec))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="that is not a comparison this image could show") from exc

    a = await _read_png(image_a, "A")
    if format_ == "png":
        out = io.BytesIO()
        a.save(out, "PNG", optimize=True)
        data, suffix = out.getvalue(), ".png"
    else:
        if image_b is None:
            raise HTTPException(status_code=422, detail="an animated image needs image B")
        b = await _read_png(image_b, "B")
        data, suffix = _gif_bytes(a, b, format_, interval, _kept_colours(keep)), ".gif"

    placed = comparisons.placement(reading)
    source: dict[str, Any] = {
        "type": SOURCE_TYPE,
        "session": spec_rel,
        "kept": True,
        "mode": reading["mode"],
        "animation": None if format_ == "png" else format_,
        "providers": {"a": reading["a"]["provider"], "b": reading["b"]["provider"]},
        "lat": placed["lat"],
        "lon": placed["lon"],
        "zoom": placed["zoom"],
        "bearing": placed["bearing"],
        "frame": reading.get("frame"),
        "rendered_at": _now(),
        "attribution_burned": True,
    }
    for key, value, exact in (("imagery_a", imagery_a, imagery_a_exact),
                              ("imagery_b", imagery_b, imagery_b_exact)):
        if value:
            source[key] = value
            if not exact:
                source[f"{key}_exact"] = False
    attrs = {"lat": placed["lat"], "lon": placed["lon"], comparisons.SESSION_ATTR: spec_rel}
    try:
        filed = media_engine.import_rendered_bytes(
            case, data, filename, suffix, source, by="compare", extra_attrs=attrs
        )
    except (OSError, ValueError, CaseError) as exc:
        raise HTTPException(status_code=409, detail=f"could not keep the image: {exc}") from exc
    saved_changed(case)
    return {"path": filed["item"]["path"], "entity": filed["entity"]["id"]}


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


async def _read_png(
    upload: UploadFile,
    side: str,
    *,
    max_bytes: int = MAX_FRAME_BYTES,
    max_pixels: int = MAX_GIF_PIXELS,
) -> Image.Image:
    raw = await upload.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"comparison frame {side} is too large")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            opened = Image.open(io.BytesIO(raw))
            if opened.format != "PNG":
                raise ValueError("not a PNG")
            # The header states the size, so an oversized frame is refused
            # before its pixels are decoded.
            if opened.width * opened.height > max_pixels:
                raise _TooManyPixels
            frame = opened.convert("RGB")
    except _TooManyPixels as exc:
        raise HTTPException(status_code=413, detail=f"comparison frame {side} has too many pixels") from exc
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=413, detail=f"comparison frame {side} is too large") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"comparison frame {side} is unreadable") from exc
    return frame


class _TooManyPixels(Exception):
    """A frame whose header states more pixels than the route accepts."""


def _fit_edge(frame: Image.Image, edge: int = MAX_GIF_EDGE) -> Image.Image:
    if max(frame.size) <= edge:
        return frame
    scale = edge / max(frame.size)
    return frame.resize(
        (max(1, round(frame.width * scale)), max(1, round(frame.height * scale))),
        Image.Resampling.LANCZOS,
    )


def _gif_frames(a: Image.Image, b: Image.Image, animation: str) -> list[Image.Image]:
    a = _fit_edge(a)
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
    keep: str = Form(default="", pattern=_KEPT_COLOURS),
    filename: str = Form(default="comparison", min_length=1, max_length=120),
) -> dict[str, str]:
    """Write a bounded animation to the configured export destination."""
    case = get_case(case_id)
    a = await _read_png(image_a, "A")
    b = await _read_png(image_b, "B")
    data = _gif_bytes(a, b, animation, interval, _kept_colours(keep))
    name = f"{layout.slugify(filename, 'comparison')}-{animation}.gif"
    try:
        export_destination = exportdir.destination("views", case.path)
        path = exportdir.write_out(data, export_destination, name)
    except (OSError, exportdir.ExportDirError) as exc:
        raise HTTPException(status_code=409, detail=f"could not write the GIF: {exc}") from exc
    return {"file": path.name, "path": str(export_destination), "animation": animation}


def _sequence_bytes(frames: list[Image.Image], interval: int) -> bytes:
    """One looping GIF of already-quantized frames, the last held longer."""
    durations = [interval] * (len(frames) - 1) + [interval * SEQUENCE_HOLD]
    buf = io.BytesIO()
    frames[0].save(
        buf,
        "GIF",
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )
    return buf.getvalue()


@router.post("/cases/{case_id}/compare/sequence")
async def export_sequence(
    case_id: str,
    frames: list[UploadFile] = File(),
    interval: int = Form(default=800, ge=200, le=4000),
    keep: str = Form(default="", pattern=_KEPT_COLOURS),
    filename: str = Form(default="comparison", min_length=1, max_length=120),
) -> dict[str, Any]:
    """Write an evolution, several dated pictures of one point in order, as a GIF.

    Each frame is quantized as soon as it is read, so the pictures wait at one byte
    a pixel rather than three. Every frame takes the first one's size.
    """
    case = get_case(case_id)
    if not 2 <= len(frames) <= MAX_SEQUENCE_FRAMES:
        raise HTTPException(
            status_code=422,
            detail=f"an evolution holds 2 to {MAX_SEQUENCE_FRAMES} pictures",
        )
    kept = _kept_colours(keep)
    shown: list[Image.Image] = []
    size: tuple[int, int] | None = None
    for index, upload in enumerate(frames, start=1):
        frame = await _read_png(
            upload,
            str(index),
            max_bytes=MAX_SEQUENCE_FRAME_BYTES,
            max_pixels=MAX_SEQUENCE_FRAME_PIXELS,
        )
        frame = _fit_edge(frame) if size is None else frame
        if size is not None and frame.size != size:
            frame = frame.resize(size, Image.Resampling.LANCZOS)
        size = frame.size
        shown.append(_quantize(frame, kept))
    data = _sequence_bytes(shown, interval)
    name = f"{layout.slugify(filename, 'comparison')}-evolution.gif"
    try:
        export_destination = exportdir.destination("views", case.path)
        path = exportdir.write_out(data, export_destination, name)
    except (OSError, exportdir.ExportDirError) as exc:
        raise HTTPException(status_code=409, detail=f"could not write the GIF: {exc}") from exc
    return {"file": path.name, "path": str(export_destination), "frames": len(shown)}


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
        raise HTTPException(status_code=502, detail=f"band request failed: {tiles.upstream_failure(exc)}") from exc
    config.record_usage("sentinelhub", 1)
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "no-store"})
