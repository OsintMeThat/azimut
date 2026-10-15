"""Map plates: a page laid out round one or more maps, saved to be exported again.

A plate is a layout, not a picture. It says what paper it is set on, which maps
stand where on it and what each shows (the ground under it, the case's layers and
how they are styled there), and what is written round them: a title, a legend, a
scale, the north, labels put by hand on the ground, arrows, pictures. The browser
draws it, live, and draws it again at print resolution to export it
(`frontend/src/lib/plate/`); what this module keeps is the layout, checked and
bounded, under `.mapplates/`, beside the small preview the saved work lists show.

**The plate keeps the case's layers by name, never a copy of them.** A plate
opened next week draws the layers as they are next week, and a tracked layer is
drawn as it stood on the plate's own day, when it has one.

**A template is a plate with its data taken out** (`template_of`): the paper,
the theme and every element where it stands, without the ground a map looks at
or the layers it shows. Templates are app-wide and live with the proof and post
ones in `templates.json` (`api/templates.py`, kind ``map``).

**A day can hold steps**, played after it in order: what is added on a step is
shown on that step only (or carried to the steps after it), over what the day
shows. A video only stands on a step: it names a file of the case and the part
of it the clip runs, and the step lasts as long as its longest clip.

**Exports** are written by the browser and filed here in the folder saved for
views, as the analysis plates are: a PNG, a PDF of the paper size holding the
page at print resolution, or the page played through its days and steps as a
GIF or an MP4 (the bundled ffmpeg). In an MP4, each step's clips run in their
boxes over the page's picture, with their sound when it is asked for.
"""

from __future__ import annotations

import io
import json
import subprocess
import tempfile
import warnings
from pathlib import Path
from typing import Annotated, Any, Literal

from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator, model_validator

from . import ffmpeg

TYPE = "map-plate"
#: A picture's `src` naming the app's own signature badge (Settings), which a template may keep.
SIGNATURE = "@signature"
PRODUCER = "map-plate"
VERSION = 1
#: What a plate is called when its title gives a file nothing to be named by.
FALLBACK = "Map plate"

#: Paper in millimetres, portrait. `screen` is a 16:9 slide, 1280 by 720 at 96 dpi, and
#: a 9:16 story turned; `social` is the 4:5 of a feed post. `custom` takes the page's `size`.
PAPERS: dict[str, tuple[float, float]] = {
    "a5": (148.0, 210.0),
    "a4": (210.0, 297.0),
    "a3": (297.0, 420.0),
    "letter": (215.9, 279.4),
    "screen": (190.5, 338.67),
    "square": (200.0, 200.0),
    "social": (216.0, 270.0),
}
#: The fonts shipped with the app, so a plate reads the same on every machine.
FONTS = ("inter", "barlow", "oxanium", "plexmono", "serif", "condensed")
KINDS = ("map", "inset", "legend", "text", "scale", "north", "image", "label", "arrow", "credits",
         "shape", "ring", "cone", "zone", "measure", "key", "table", "qr", "timeline", "signature", "brand", "video")
#: The kinds that read one map of the plate, named by `of`.
OF_A_MAP = ("inset", "legend", "scale", "north", "label", "arrow", "credits", "ring", "cone", "zone", "measure")
#: The kinds that stand on a map's ground, so a template, which keeps no ground, leaves them out.
ON_THE_GROUND = ("label", "arrow", "ring", "cone", "zone", "measure")

MAX_ELEMENTS = 160
#: At most this many steps on one day, and this many days holding steps.
MAX_STEPS = 30
MAX_STEP_DAYS = 120
#: A clip runs at most ten minutes.
MAX_CLIP_SECONDS = 600.0
MAX_LAYERS = 40
MAX_TEXT = 4000
#: A plate's layout is a few kilobytes, a few hundred with the pictures it keeps inside it;
#: the bound keeps a doctored one from being stored.
MAX_SPEC_CHARS = 1_400_000
#: The largest page edge, in millimetres: an A0 sheet's long side.
MAX_EDGE_MM = 1200.0

Hex = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
Mm = Annotated[FiniteFloat, Field(ge=-MAX_EDGE_MM, le=MAX_EDGE_MM)]
Size = Annotated[FiniteFloat, Field(gt=0, le=MAX_EDGE_MM)]
Name = Annotated[str, Field(min_length=1, max_length=120)]
Ident = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")]
#: A moment on a tracked layer's clock (`engine/layerediting.instant`).
Moment = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$")]
#: The day an annotation is shown on: a moment, or "now", the layers as they stand today.
Day = Annotated[str, Field(pattern=r"^(now|\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?)$")]
#: A picture kept inside the plate itself (a logo a template carries), small by bound.
MAX_PICTURE_CHARS = 300_000
Picture = Annotated[str, Field(max_length=MAX_PICTURE_CHARS, pattern=r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$")]
Point = tuple[FiniteFloat, FiniteFloat]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


Font = Literal["inter", "barlow", "oxanium", "plexmono", "serif", "condensed"]


class Background(Strict):
    """What the paper is under everything: one colour, a gradient, or a picture."""

    kind: Literal["solid", "gradient", "image"] = "solid"
    colour: Hex | None = None
    angle: FiniteFloat = Field(default=90, ge=0, le=360)
    data: Picture | None = None


class Page(Strict):
    paper: Literal["a5", "a4", "a3", "letter", "screen", "square", "social", "custom"] = "a4"
    orientation: Literal["portrait", "landscape"] = "landscape"
    #: A custom paper's width and height, in millimetres.
    size: tuple[Size, Size] | None = None
    background: Background = Field(default_factory=Background)
    #: A rule round the page's edge.
    frame: bool = False
    #: The margins and safe areas the editor draws; never printed.
    guides: bool = False
    #: A PNG export leaves the paper see-through.
    transparent: bool = False


class Theme(Strict):
    paper: Hex = "#ffffff"
    ink: Hex = "#15181e"
    accent: Hex = "#c8102e"
    font: Font = "inter"
    #: The preset the theme was last set from, so the inspector can say so.
    preset: Annotated[str, Field(max_length=40)] = ""


class View(Strict):
    """Where a map looks: its centre, the engine's own zoom (fractional), its bearing."""

    lat: FiniteFloat = Field(ge=-85, le=85)
    lon: FiniteFloat = Field(ge=-180, le=180)
    zoom: FiniteFloat = Field(ge=0, le=22)
    bearing: FiniteFloat = Field(default=0, ge=-360, le=360)


class FrameLayer(Strict):
    """One of the case's layers on one map, and how this plate draws it."""

    name: Annotated[str, Field(min_length=1, max_length=120)]
    #: Its groups this plate leaves out, by name.
    hidden: list[Annotated[str, Field(max_length=200)]] = Field(default_factory=list, max_length=200)
    #: Lines drawn this many times their layer's weight.
    stroke: FiniteFloat = Field(default=1.0, ge=0.25, le=4)
    #: Marks drawn this many times their layer's size.
    icons: FiniteFloat = Field(default=1.0, ge=0.25, le=4)
    opacity: FiniteFloat = Field(default=1.0, ge=0.1, le=1)
    #: This plate's own look for the layer, over the layer's: one colour, a dash.
    colour: Hex | None = None
    dash: Literal["", "dashed", "dotted"] = ""


class Tone(Strict):
    """How a map's imagery is shown: faded, greyed, lit, contrasted, tinted."""

    opacity: FiniteFloat = Field(default=1, ge=0, le=1)
    saturation: FiniteFloat = Field(default=0, ge=-1, le=1)
    brightness: FiniteFloat = Field(default=1, ge=0, le=1)
    contrast: FiniteFloat = Field(default=0, ge=-1, le=1)
    hue: FiniteFloat = Field(default=0, ge=0, le=360)


class Plain(Strict):
    """The quiet ground, as this map draws it: its colours, what it shows, its names' language."""

    colours: dict[Literal["ground", "water", "wood", "urban", "road", "border", "name"], Hex] = Field(default_factory=dict)
    roads: bool = True
    buildings: bool = True
    names: bool = True
    lang: Literal["latin", "local", "en", "fr", "ar", "ru", "uk"] = "latin"
    #: How many place names it writes: fewer, as usual, or more.
    density: Literal["low", "normal", "high"] = "normal"


class Grid(Strict):
    step: FiniteFloat | None = Field(default=None, gt=0, le=100_000)
    format: Literal["dms", "dd"] = "dms"
    colour: Hex | None = None
    sides: Literal["two", "four"] = "two"
    ticks: bool = False


class Mask(Strict):
    """A spotlight: the ground outside a shape dimmed."""

    on: bool = False
    darkness: FiniteFloat = Field(default=0.55, ge=0.05, le=0.95)


class LegendRow(Strict):
    """A row of a legend written by hand."""

    label: Annotated[str, Field(min_length=1, max_length=200)]
    kind: Literal["point", "line", "area"] = "point"
    colour: Hex = "#c8102e"
    symbol: Annotated[str, Field(max_length=40)] = "pin"


class FeatureRef(Strict):
    """The feature of a case layer a label names, so it is shown when the feature is."""

    layer: Annotated[str, Field(min_length=1, max_length=120)]
    key: Annotated[str, Field(min_length=1, max_length=80)]


class Time(Strict):
    """The day a plate is drawn on, for its tracked layers, and what of the past it shows."""

    at: Moment | None = None
    #: The step of that day the plate is on; none, the day itself.
    step: Ident | None = None
    trail: bool = True
    #: "previous", or a moment: hatch an area's gains and losses since then.
    since: Literal["previous"] | Moment | None = None
    #: How many days an event stays on the map after its own, fading.
    window: int = Field(default=7, ge=0, le=365)


LegendKey = Annotated[str, Field(max_length=330)]


class Step(Strict):
    """A step of a day, played after it: held its own seconds, or as long as its longest clip."""

    id: Ident
    name: Annotated[str, Field(max_length=80)] = ""
    duration: FiniteFloat = Field(default=3, ge=0.5, le=120)


class Element(Strict):
    id: Ident
    kind: Literal["map", "inset", "legend", "text", "scale", "north", "image", "label", "arrow", "credits",
                  "shape", "ring", "cone", "zone", "measure", "key", "table", "qr", "timeline", "signature", "brand", "video"]
    #: Left, top, width and height on the page, in millimetres.
    box: tuple[Mm, Mm, Size, Size]
    #: The map an element reads, by its id. A map with one is a detail of that map.
    of: Ident | None = None
    #: What the element list calls it, when the analyst named it.
    name: Annotated[str, Field(max_length=80)] = ""
    hidden: bool = False
    locked: bool = False
    #: Elements sharing a group are picked and moved together.
    group: Ident | None = None
    #: The first and the last day an annotation is shown on, when the plate is played,
    #: both kept. No first day runs from the start, no last day up to now; neither, every day.
    onward: Day | None = None
    until: Day | None = None
    #: The step an element belongs to, shown on it only, or on it and the steps after it when carried.
    step: Ident | None = None
    carry: bool = False
    # a map
    view: View | None = None
    basemap: Annotated[str, Field(max_length=80)] = "plain"
    #: A Wayback release, when the map is drawn on one.
    release: int | None = Field(default=None, gt=0, lt=1_000_000_000)
    overlays: list[Annotated[str, Field(max_length=40)]] = Field(default_factory=list, max_length=12)
    layers: list[FrameLayer] = Field(default_factory=list, max_length=MAX_LAYERS)
    grid: Literal["none", "latlon", "utm", "mgrs"] = "none"
    grid_style: Grid = Field(default_factory=Grid)
    tone: Tone = Field(default_factory=Tone)
    plain: Plain = Field(default_factory=Plain)
    relief: FiniteFloat = Field(default=1, ge=0, le=2)
    # writing
    text: str = Field(default="", max_length=MAX_TEXT)
    size: FiniteFloat = Field(default=10, ge=4, le=200)
    weight: Literal[400, 600, 700] = 400
    align: Literal["left", "center", "right"] = "left"
    valign: Literal["top", "middle", "bottom"] = "top"
    font: Font | None = None
    italic: bool = False
    upper: bool = False
    #: Letter spacing, in hundredths of the text's size.
    tracking: FiniteFloat = Field(default=0, ge=-10, le=60)
    leading: FiniteFloat = Field(default=1.25, ge=0.8, le=3)
    halo: bool = False
    rotate: FiniteFloat = Field(default=0, ge=-180, le=180)
    opacity: FiniteFloat = Field(default=1, ge=0.05, le=1)
    colour: Hex | None = None
    fill: Hex | None = None
    border: bool = False
    # a picture: a file of the case by its path, "@signature", or kept inside the plate
    src: Annotated[str, Field(max_length=500)] = ""
    data: Picture | None = None
    fit: Literal["contain", "cover"] = "contain"
    # a video: the part of its file the clip runs, in seconds, its sound, and its source said on it
    clip: tuple[FiniteFloat, FiniteFloat] | None = None
    sound: bool = False
    volume: FiniteFloat = Field(default=1, ge=0, le=2)
    caption: bool = False
    # on the ground: where a label points, where an arrow goes from and to
    at: Point | None = None
    to: Point | None = None
    #: A zone's corners on the ground.
    points: list[Point] = Field(default_factory=list, max_length=400)
    style: Literal["plain", "bubble", "box", "number"] = "plain"
    leader: Literal["straight", "elbow", "curve", "none"] = "straight"
    end: Literal["dot", "arrow", "none"] = "dot"
    ref: FeatureRef | None = None
    width: FiniteFloat = Field(default=1.0, ge=0.2, le=12)
    # an arrow
    bend: FiniteFloat = Field(default=0, ge=-1, le=1)
    heads: Literal["end", "both", "none"] = "end"
    line: Literal["solid", "dashed", "dotted"] = "solid"
    head: FiniteFloat = Field(default=1, ge=0.4, le=4)
    shape: Literal["line", "offensive", "rect", "ellipse"] = "line"
    # a ring, a cone, a zone
    radii: list[Annotated[float, Field(gt=0, le=20_000)]] = Field(default_factory=list, max_length=8)
    bearing: FiniteFloat = Field(default=0, ge=-360, le=360)
    spread: FiniteFloat = Field(default=60, gt=0, le=360)
    #: A cone's reach, in kilometres.
    reach: FiniteFloat = Field(default=1, gt=0, le=20_000)
    look: Literal["fill", "hatch", "glow", "outline"] = "fill"
    mask: Mask = Field(default_factory=Mask)
    #: An inset's zoom.
    zoom: FiniteFloat | None = Field(default=None, ge=0, le=22)
    columns: int = Field(default=1, ge=1, le=4)
    #: A legend's own names for its rows, by `layer/group`.
    names: dict[LegendKey, Annotated[str, Field(max_length=200)]] = Field(default_factory=dict, max_length=400)
    #: A legend: lists what the map draws outside its frame too; rows left out; rows in order; rows by hand.
    offmap: bool = False
    off: list[LegendKey] = Field(default_factory=list, max_length=400)
    order: list[LegendKey] = Field(default_factory=list, max_length=400)
    extra: list[LegendRow] = Field(default_factory=list, max_length=20)
    # a scale, a north arrow
    units: Literal["auto", "metric", "imperial", "both"] = "auto"
    variant: Literal["bar", "line", "ticks", "arrow", "simple", "star", "letter"] | None = None
    # a table: what it lists, from which layer
    source: Literal["events", "sources"] = "events"
    layer: Annotated[str, Field(max_length=120)] = ""
    rows: int = Field(default=12, ge=1, le=60)

    @field_validator("src")
    @classmethod
    def _inside(cls, value: str) -> str:
        if value == SIGNATURE:
            return value
        if value and (value.startswith(("/", "\\")) or ".." in Path(value).parts or ":" in value):
            raise ValueError("a picture is a file of the case")
        return value

    @model_validator(mode="after")
    def _whole(self) -> Element:
        if self.kind in OF_A_MAP and not self.of:
            raise ValueError(f"a {self.kind} reads one of the plate's maps")
        if self.kind in ("label", "arrow", "ring", "cone", "measure") and self.at is None:
            raise ValueError(f"a {self.kind} stands on the ground")
        if self.kind in ("arrow", "measure") and self.to is None:
            raise ValueError(f"a {self.kind} goes somewhere")
        if self.kind == "zone" and len(self.points) < 3:
            raise ValueError("a zone has three corners at least")
        if self.kind == "video" and not self.step:
            raise ValueError("a video stands on a step")
        if self.clip is not None:
            start, end = self.clip
            if start < 0 or end <= start or end - start > MAX_CLIP_SECONDS:
                raise ValueError("a clip runs forward, ten minutes at most")
        for point in (self.at, self.to, *self.points):
            if point is not None and not (-180 <= point[0] <= 180 and -85 <= point[1] <= 85):
                raise ValueError("a point on the ground is a longitude and a latitude")
        return self


class PlateSpec(Strict):
    page: Page = Field(default_factory=Page)
    theme: Theme = Field(default_factory=Theme)
    time: Time = Field(default_factory=Time)
    #: The steps each day holds, in the order they are played.
    steps: dict[Day, Annotated[list[Step], Field(max_length=MAX_STEPS)]] = Field(default_factory=dict, max_length=MAX_STEP_DAYS)
    elements: list[Element] = Field(default_factory=list, max_length=MAX_ELEMENTS)

    @model_validator(mode="after")
    def _linked(self) -> PlateSpec:
        ids = [element.id for element in self.elements]
        if len(set(ids)) != len(ids):
            raise ValueError("each element of a plate has its own id")
        steps = [step.id for day in self.steps.values() for step in day]
        if len(set(steps)) != len(steps):
            raise ValueError("each step of a plate has its own id")
        for element in self.elements:
            if element.step and element.step not in steps:
                raise ValueError(f"the {element.kind} belongs to a step the plate does not hold")
        maps = {element.id for element in self.elements if element.kind == "map"}
        for element in self.elements:
            if element.of and element.of not in maps:
                raise ValueError(f"the {element.kind} reads a map the plate does not hold")
            if element.kind == "map" and element.of == element.id:
                raise ValueError("a map is not a detail of itself")
        return self


class TemplateData(PlateSpec):
    """A plate with its data taken out, as a template keeps it."""

    @model_validator(mode="after")
    def _no_data(self) -> TemplateData:
        for element in self.elements:
            if element.kind == "map" and element.layers:
                raise ValueError("a template keeps no layers of a case")
            if element.kind == "image" and element.src and element.src != SIGNATURE:
                raise ValueError("a template keeps no picture of a case")
            if element.kind in ON_THE_GROUND or element.at is not None or element.points:
                raise ValueError("a template keeps nothing that stands on a case's ground")
        if self.steps:
            raise ValueError("a template keeps no steps")
        return self


def paper_mm(page: dict[str, Any]) -> tuple[float, float]:
    """The page's width and height in millimetres, turned as it is set; a custom paper as given."""
    if page.get("paper") == "custom" and page.get("size"):
        width, height = page["size"]
        return (float(width), float(height))
    width, height = PAPERS[page.get("paper", "a4") if page.get("paper") in PAPERS else "a4"]
    return (height, width) if page.get("orientation", "landscape") == "landscape" else (width, height)


def as_periods(spec: dict[str, Any]) -> dict[str, Any]:
    """A plate whose annotations listed their days, read as the one period each list spans.

    Plates saved before an annotation took a first and a last day kept a list of days
    and a day from which on; the period runs from the earliest to the latest of them.
    """
    for element in spec.get("elements", []):
        if not isinstance(element, dict) or "days" not in element:
            continue
        days = [day for day in element.pop("days") or [] if isinstance(day, str)]
        onward = element.get("onward")
        if not days:
            continue
        spread = sorted([*days, *([onward] if onward else [])], key=lambda day: (day == "now", day))
        element["onward"] = spread[0]
        element["until"] = None if onward or spread[-1] == "now" else spread[-1]
    return spec


def template_of(spec: dict[str, Any]) -> dict[str, Any]:
    """A plate's layout with its data taken out: no ground, no layers, no case pictures, no day.

    What stands on a plate's ground (labels, arrows, rings, zones…) stays with the plate, and
    so do its steps, the videos and everything else made on them. A picture kept inside the
    plate, or the app's signature, is layout and goes with it.
    """
    elements = []
    for element in spec.get("elements", []):
        if element.get("kind") in ON_THE_GROUND or element.get("kind") == "video" or element.get("step"):
            continue
        kept = {key: value for key, value in element.items()
                if key not in ("view", "layers", "names", "release", "onward", "until", "layer", "at", "to", "ref", "points",
                               "step", "carry")}
        if kept.get("src") and kept["src"] != SIGNATURE:
            kept.pop("src")
        elements.append(kept)
    return {"page": spec.get("page", {}), "theme": spec.get("theme", {}), "time": {}, "elements": elements}


# -- exports -------------------------------------------------------------------------

#: An export is the page at print resolution: an A3 at 300 dpi is 17 million pixels.
MAX_PAGE_PIXELS = 40_000_000
MAX_PAGE_BYTES = 60_000_000
#: A played plate: a frame per day, at most this many, each the page at screen size.
MAX_FRAMES = 120
MAX_FRAME_BYTES = 8_000_000
MAX_FRAME_PIXELS = 4096 * 4096
MAX_VIDEO_EDGE = 3840
#: The body of the largest export, enforced before it is read (`server.BulkBodyLimit`).
MAX_EXPORT_BODY_BYTES = max(MAX_PAGE_BYTES, MAX_FRAMES * MAX_FRAME_BYTES) + 2_000_000
#: How long ffmpeg may take over one video, or over one beat of a sequence.
VIDEO_TIMEOUT = 300
#: A played plate with steps runs at most half an hour, its beats at most four clips each.
MAX_SEQUENCE_SECONDS = 1800.0
MAX_CLIPS_PER_BEAT = 4
#: The frame rate a sequence is made at, its clips included.
VIDEO_FPS = 30


class ExportError(ValueError):
    """An export that cannot be made, said in one sentence the dialog can show."""


def picture(raw: bytes, *, max_bytes: int, max_pixels: int, alpha: bool = False) -> Image.Image:
    """A PNG or a JPEG the browser drew, checked by its header before a pixel is decoded.

    With `alpha`, a PNG keeps its see-through paper; anything else is flattened to RGB.
    """
    if not raw:
        raise ExportError("the page arrived empty")
    if len(raw) > max_bytes:
        raise ExportError("the page is too large to write")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            opened = Image.open(io.BytesIO(raw))
            if opened.format not in ("PNG", "JPEG") or opened.width * opened.height > max_pixels:
                raise ExportError("the page is not a picture this export can take")
            return opened.convert("RGBA" if alpha and opened.format == "PNG" else "RGB")
    except ExportError:
        raise
    except Exception as exc:
        raise ExportError("the page is not a picture this export can take") from exc


def pdf_bytes(image: Image.Image, width_mm: float, height_mm: float, title: str) -> bytes:
    """One page of the paper's size, the plate filling it."""
    from fpdf import FPDF

    pdf = FPDF(orientation="L" if width_mm > height_mm else "P", unit="mm", format=(min(width_mm, height_mm), max(width_mm, height_mm)))
    pdf.set_auto_page_break(False)
    pdf.set_margin(0)
    pdf.set_title(title)
    pdf.set_creator("Azimut")
    pdf.add_page()
    buf = io.BytesIO()
    image.save(buf, "JPEG", quality=92, subsampling=0, dpi=_dpi(image, width_mm))
    buf.seek(0)
    pdf.image(buf, x=0, y=0, w=width_mm, h=height_mm)
    return bytes(pdf.output())


def _dpi(image: Image.Image, width_mm: float) -> tuple[int, int]:
    dpi = round(image.width / (width_mm / 25.4))
    return (dpi, dpi)


def gif_bytes(frames: list[Image.Image], interval: int, durations: list[int] | None = None) -> bytes:
    """A looping GIF, each frame shown `interval` ms (or its own of `durations`), the last held three times as long."""
    size = frames[0].size
    shown = [(frame if frame.size == size else frame.resize(size, Image.Resampling.LANCZOS))
             .convert("P", palette=Image.Palette.ADAPTIVE, colors=255) for frame in frames]
    held = list(durations) if durations else [interval] * len(shown)
    held[-1] *= 3
    buf = io.BytesIO()
    shown[0].save(buf, "GIF", save_all=True, append_images=shown[1:], duration=held, loop=0, optimize=True, disposal=2)
    return buf.getvalue()


def mp4_bytes(frames: list[Image.Image], interval: int) -> bytes:
    """An H.264 video a phone and a slide deck both play, each frame shown `interval` ms."""
    exe = ffmpeg.ffmpeg_path()
    if not exe:
        raise ExportError("making a video needs ffmpeg; the release binaries bring it, a pip install needs it on PATH")
    size = frames[0].size
    # Even sides, which H.264 in yuv420p needs.
    width, height = size[0] - size[0] % 2, size[1] - size[1] % 2
    with tempfile.TemporaryDirectory(prefix="azimut-plate-") as folder:
        root = Path(folder)
        for index, frame in enumerate(frames + [frames[-1]] * 2):
            shown = frame if frame.size == size else frame.resize(size, Image.Resampling.LANCZOS)
            shown.crop((0, 0, width, height)).save(root / f"f{index:04d}.png")
        target = root / "plate.mp4"
        command = [exe, "-hide_banner", "-loglevel", "error", "-y", "-framerate", f"1000/{interval}",
                   "-i", str(root / "f%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                   "-r", "30", "-movflags", "+faststart", str(target)]
        try:
            subprocess.run(command, check=True, capture_output=True, timeout=VIDEO_TIMEOUT)
        except subprocess.TimeoutExpired as exc:
            raise ExportError("the video took too long to make") from exc
        except (OSError, subprocess.CalledProcessError) as exc:
            raise ExportError("ffmpeg could not make the video") from exc
        return target.read_bytes()


# -- a sequence: the days and steps of a plate, with their clips ---------------------------


class ClipOut(Strict):
    """A clip as an export runs it: the part of a case's video, and its box on the frame, in pixels."""

    src: Annotated[str, Field(min_length=1, max_length=500)]
    start: FiniteFloat = Field(ge=0)
    end: FiniteFloat = Field(gt=0)
    box: tuple[Annotated[int, Field(ge=0, le=MAX_VIDEO_EDGE)], Annotated[int, Field(ge=0, le=MAX_VIDEO_EDGE)],
               Annotated[int, Field(ge=2, le=MAX_VIDEO_EDGE)], Annotated[int, Field(ge=2, le=MAX_VIDEO_EDGE)]]
    fit: Literal["contain", "cover"] = "contain"
    sound: bool = False
    volume: FiniteFloat = Field(default=1, ge=0, le=2)

    @model_validator(mode="after")
    def _forward(self) -> ClipOut:
        if self.end <= self.start or self.end - self.start > MAX_CLIP_SECONDS:
            raise ValueError("a clip runs forward, ten minutes at most")
        return self


class Beat(Strict):
    """One beat of a sequence: its frame held `seconds`, the clips running over it, and what stands over them."""

    seconds: FiniteFloat = Field(ge=0.2, le=MAX_CLIP_SECONDS)
    clips: list[ClipOut] = Field(default_factory=list, max_length=MAX_CLIPS_PER_BEAT)
    #: Which of the see-through pictures lies over the clips, by its place in the upload.
    over: int | None = Field(default=None, ge=0)


def read_beats(raw: str, frames: int, overs: int) -> list[Beat]:
    """The beats the browser sent, one per frame, checked whole; `ExportError` when they are not."""
    try:
        listed = json.loads(raw)
        if not isinstance(listed, list):
            raise ValueError("not a list")
        beats = [Beat.model_validate(item) for item in listed]
    except ValueError as exc:
        raise ExportError("the sequence is not one this export can play") from exc
    if len(beats) != frames:
        raise ExportError("each beat of the sequence has its picture")
    if any(beat.over is not None and beat.over >= overs for beat in beats):
        raise ExportError("a beat names a picture that did not come")
    if sum(beat.seconds for beat in beats) > MAX_SEQUENCE_SECONDS:
        raise ExportError("a sequence runs half an hour at most")
    return beats


def has_sound(path: Path) -> bool:
    """Whether a video holds a sound track, as ffprobe reads it; no ffprobe, no sound."""
    exe = ffmpeg.ffprobe_path()
    if not exe:
        return False
    try:
        answer = subprocess.run([exe, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
                                check=True, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return False
    return bool(answer.stdout.strip())


def beat_command(exe: str, still: Path, seconds: float, clips: list[tuple[ClipOut, Path, bool]], over: Path | None,
                 target: Path) -> list[str]:
    """The ffmpeg line making one beat: the frame held, each clip run in its box, what stands over them, and sound.

    `clips` are `(clip, file, sounds)`, `sounds` true when the clip's sound is asked for and
    the file has one; every beat carries a stereo track, silent when none sounds, so the
    beats join without a new encode.
    """
    held = f"{seconds:.3f}"
    command = [exe, "-hide_banner", "-loglevel", "error", "-y",
               "-loop", "1", "-framerate", str(VIDEO_FPS), "-t", held, "-i", str(still),
               "-f", "lavfi", "-t", held, "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
    for clip, file, _ in clips:
        command += ["-ss", f"{clip.start:.3f}", "-t", f"{clip.end - clip.start:.3f}", "-i", str(file)]
    if over is not None:
        command += ["-loop", "1", "-framerate", str(VIDEO_FPS), "-t", held, "-i", str(over)]
    graph = ["[0:v]setsar=1[b0]"]
    for index, (clip, _, _) in enumerate(clips):
        x, y, width, height = clip.box
        fitted = (f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}" if clip.fit == "cover"
                  else f"scale={width}:{height}:force_original_aspect_ratio=decrease")
        graph.append(f"[{index + 2}:v]fps={VIDEO_FPS},{fitted},setsar=1[c{index}]")
        graph.append(f"[b{index}][c{index}]overlay=x={x}+({width}-w)/2:y={y}+({height}-h)/2:eof_action=repeat[b{index + 1}]")
    last = len(clips)
    if over is not None:
        graph.append(f"[b{last}][{len(clips) + 2}:v]overlay=0:0[b{last + 1}]")
        last += 1
    graph.append(f"[b{last}]format=yuv420p[v]")
    sounded = [index for index, (_, _, sounds) in enumerate(clips) if sounds]
    for index in sounded:
        graph.append(f"[{index + 2}:a]volume={clips[index][0].volume:.2f},aresample=48000,aformat=channel_layouts=stereo[a{index}]")
    if len(sounded) > 1:
        graph.append("".join(f"[a{index}]" for index in sounded) + f"amix=inputs={len(sounded)}:duration=longest[am]")
        graph.append(f"[am]apad=whole_dur={held}[a]")
    elif sounded:
        graph.append(f"[a{sounded[0]}]apad=whole_dur={held}[a]")
    command += ["-filter_complex", ";".join(graph), "-map", "[v]", "-map", "[a]" if sounded else "1:a", "-t", held,
                "-r", str(VIDEO_FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", str(target)]
    return command


def sequence_mp4(frames: list[Image.Image], beats: list[Beat], overs: list[Image.Image], files: dict[str, Path]) -> bytes:
    """A video of a plate's days and steps: each beat its frame held, its clips running in their boxes.

    `files` are the case's videos the clips name, already found inside the case. Each beat is
    made on its own, then the beats are joined as they are.
    """
    exe = ffmpeg.ffmpeg_path()
    if not exe:
        raise ExportError("making a video needs ffmpeg; the release binaries bring it, a pip install needs it on PATH")
    size = frames[0].size
    width, height = size[0] - size[0] % 2, size[1] - size[1] % 2
    sounds: dict[str, bool] = {}
    with tempfile.TemporaryDirectory(prefix="azimut-plate-") as folder:
        root = Path(folder)
        for index, layer in enumerate(overs):
            shown = layer if layer.size == size else layer.resize(size, Image.Resampling.LANCZOS)
            shown.crop((0, 0, width, height)).save(root / f"o{index:04d}.png")
        listing = []
        for index, (frame, beat) in enumerate(zip(frames, beats, strict=True)):
            still = root / f"f{index:04d}.png"
            (frame if frame.size == size else frame.resize(size, Image.Resampling.LANCZOS)).crop((0, 0, width, height)).save(still)
            clips = []
            for clip in beat.clips:
                file = files[clip.src]
                if clip.sound and clip.src not in sounds:
                    sounds[clip.src] = has_sound(file)
                clips.append((clip, file, clip.sound and sounds.get(clip.src, False)))
            target = root / f"b{index:04d}.mp4"
            over = root / f"o{beat.over:04d}.png" if beat.over is not None and beat.clips else None
            _run(beat_command(exe, still, beat.seconds, clips, over, target), "the video took too long to make", "ffmpeg could not make the video")
            listing.append(f"file '{target.name}'")
        (root / "beats.txt").write_text("\n".join(listing) + "\n", encoding="utf-8")
        result = root / "plate.mp4"
        _run([exe, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(root / "beats.txt"),
              "-c", "copy", "-movflags", "+faststart", str(result)], "the video took too long to join", "ffmpeg could not join the video")
        return result.read_bytes()


def _run(command: list[str], slow: str, failed: str) -> None:
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=VIDEO_TIMEOUT)
    except subprocess.TimeoutExpired as exc:
        raise ExportError(slow) from exc
    except (OSError, subprocess.CalledProcessError) as exc:
        raise ExportError(failed) from exc


def png_bytes(image: Image.Image) -> bytes:
    """The page re-encoded here, whatever the browser sent."""
    buf = io.BytesIO()
    image.save(buf, "PNG", optimize=True)
    return buf.getvalue()
