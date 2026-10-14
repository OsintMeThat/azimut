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

**Exports** are written by the browser and filed here in the folder saved for
views, as the analysis plates are: a PNG, a PDF of the paper size holding the
page at print resolution, or the page played through its days as a GIF or an
MP4 (the bundled ffmpeg).
"""

from __future__ import annotations

import io
import subprocess
import tempfile
import warnings
from pathlib import Path
from typing import Annotated, Any, Literal

from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator, model_validator

from . import ffmpeg

TYPE = "map-plate"
PRODUCER = "map-plate"
VERSION = 1
#: What a plate is called when its title gives a file nothing to be named by.
FALLBACK = "Map plate"

#: Paper in millimetres, portrait. `screen` is a 16:9 slide, 1280 by 720 at 96 dpi.
PAPERS: dict[str, tuple[float, float]] = {
    "a5": (148.0, 210.0),
    "a4": (210.0, 297.0),
    "a3": (297.0, 420.0),
    "letter": (215.9, 279.4),
    "screen": (190.5, 338.67),
    "square": (200.0, 200.0),
}
#: The fonts shipped with the app, so a plate reads the same on every machine.
FONTS = ("inter", "barlow", "oxanium", "plexmono")
KINDS = ("map", "inset", "legend", "text", "scale", "north", "image", "label", "arrow", "credits")
#: The kinds that read one map of the plate, named by `of`.
OF_A_MAP = ("inset", "legend", "scale", "north", "label", "arrow", "credits")

MAX_ELEMENTS = 160
MAX_LAYERS = 40
MAX_TEXT = 4000
#: A plate's layout is a few kilobytes; the bound keeps a doctored one from being stored.
MAX_SPEC_CHARS = 400_000
#: The largest page edge, in millimetres: an A0 sheet's long side.
MAX_EDGE_MM = 1200.0

Hex = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
Mm = Annotated[FiniteFloat, Field(ge=-MAX_EDGE_MM, le=MAX_EDGE_MM)]
Size = Annotated[FiniteFloat, Field(gt=0, le=MAX_EDGE_MM)]
Name = Annotated[str, Field(min_length=1, max_length=120)]
Ident = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")]
#: A moment on a tracked layer's clock (`engine/layerediting.instant`).
Moment = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$")]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Page(Strict):
    paper: Literal["a5", "a4", "a3", "letter", "screen", "square"] = "a4"
    orientation: Literal["portrait", "landscape"] = "landscape"


class Theme(Strict):
    paper: Hex = "#ffffff"
    ink: Hex = "#15181e"
    accent: Hex = "#c8102e"
    font: Literal["inter", "barlow", "oxanium", "plexmono"] = "inter"


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
    #: Lines and marks drawn this many times their layer's weight.
    stroke: FiniteFloat = Field(default=1.0, ge=0.25, le=4)
    opacity: FiniteFloat = Field(default=1.0, ge=0.1, le=1)


class Time(Strict):
    """The day a plate is drawn on, for its tracked layers, and what of the past it shows."""

    at: Moment | None = None
    trail: bool = True
    #: "previous", or a moment: hatch an area's gains and losses since then.
    since: Literal["previous"] | Moment | None = None
    #: How many days an event stays on the map after its own, fading.
    window: int = Field(default=7, ge=0, le=365)


class Element(Strict):
    id: Ident
    kind: Literal["map", "inset", "legend", "text", "scale", "north", "image", "label", "arrow", "credits"]
    #: Left, top, width and height on the page, in millimetres.
    box: tuple[Mm, Mm, Size, Size]
    #: The map an element reads, by its id.
    of: Ident | None = None
    # a map
    view: View | None = None
    basemap: Annotated[str, Field(max_length=80)] = "plain"
    overlays: list[Annotated[str, Field(max_length=40)]] = Field(default_factory=list, max_length=12)
    layers: list[FrameLayer] = Field(default_factory=list, max_length=MAX_LAYERS)
    grid: Literal["none", "latlon"] = "none"
    # writing
    text: str = Field(default="", max_length=MAX_TEXT)
    size: FiniteFloat = Field(default=10, ge=4, le=200)
    weight: Literal[400, 600, 700] = 400
    align: Literal["left", "center", "right"] = "left"
    colour: Hex | None = None
    fill: Hex | None = None
    border: bool = False
    # a picture of the case, by its path
    src: Annotated[str, Field(max_length=500)] = ""
    # on the ground: where a label points, where an arrow goes from and to
    at: tuple[FiniteFloat, FiniteFloat] | None = None
    to: tuple[FiniteFloat, FiniteFloat] | None = None
    style: Literal["plain", "bubble", "box"] = "plain"
    width: FiniteFloat = Field(default=1.0, ge=0.2, le=12)
    #: An inset's zoom, or a legend's columns.
    zoom: FiniteFloat | None = Field(default=None, ge=0, le=22)
    columns: int = Field(default=1, ge=1, le=4)
    #: A legend's own names for its rows, by `layer/group`.
    names: dict[Annotated[str, Field(max_length=330)], Annotated[str, Field(max_length=200)]] = Field(
        default_factory=dict, max_length=400)

    @field_validator("src")
    @classmethod
    def _inside(cls, value: str) -> str:
        if value and (value.startswith(("/", "\\")) or ".." in Path(value).parts or ":" in value):
            raise ValueError("a picture is a file of the case")
        return value

    @model_validator(mode="after")
    def _whole(self) -> Element:
        if self.kind in OF_A_MAP and not self.of:
            raise ValueError(f"a {self.kind} reads one of the plate's maps")
        if self.kind in ("label", "arrow") and self.at is None:
            raise ValueError(f"a {self.kind} stands on the ground")
        if self.kind == "arrow" and self.to is None:
            raise ValueError("an arrow goes somewhere")
        for point in (self.at, self.to):
            if point is not None and not (-180 <= point[0] <= 180 and -85 <= point[1] <= 85):
                raise ValueError("a point on the ground is a longitude and a latitude")
        return self


class PlateSpec(Strict):
    page: Page = Field(default_factory=Page)
    theme: Theme = Field(default_factory=Theme)
    time: Time = Field(default_factory=Time)
    elements: list[Element] = Field(default_factory=list, max_length=MAX_ELEMENTS)

    @model_validator(mode="after")
    def _linked(self) -> PlateSpec:
        ids = [element.id for element in self.elements]
        if len(set(ids)) != len(ids):
            raise ValueError("each element of a plate has its own id")
        maps = {element.id for element in self.elements if element.kind == "map"}
        for element in self.elements:
            if element.of and element.of not in maps:
                raise ValueError(f"the {element.kind} reads a map the plate does not hold")
        return self


class TemplateData(PlateSpec):
    """A plate with its data taken out, as a template keeps it."""

    @model_validator(mode="after")
    def _no_data(self) -> TemplateData:
        for element in self.elements:
            if element.kind == "map" and element.layers:
                raise ValueError("a template keeps no layers of a case")
            if element.kind == "image" and element.src:
                raise ValueError("a template keeps no picture of a case")
        return self


def paper_mm(page: dict[str, Any]) -> tuple[float, float]:
    """The page's width and height in millimetres, turned as it is set."""
    width, height = PAPERS[page.get("paper", "a4")]
    return (height, width) if page.get("orientation", "landscape") == "landscape" else (width, height)


def template_of(spec: dict[str, Any]) -> dict[str, Any]:
    """A plate's layout with its data taken out: no ground, no layers, no pictures, no day.

    Labels and arrows stand on a plate's ground, so they stay with the plate.
    """
    elements = []
    for element in spec.get("elements", []):
        if element.get("kind") in ("label", "arrow"):
            continue
        kept = {key: value for key, value in element.items() if key not in ("view", "layers", "src", "names")}
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
#: How long ffmpeg may take over one video.
VIDEO_TIMEOUT = 300


class ExportError(ValueError):
    """An export that cannot be made, said in one sentence the dialog can show."""


def picture(raw: bytes, *, max_bytes: int, max_pixels: int) -> Image.Image:
    """A PNG or a JPEG the browser drew, checked by its header before a pixel is decoded."""
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
            return opened.convert("RGB")
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


def gif_bytes(frames: list[Image.Image], interval: int) -> bytes:
    """A looping GIF, the last frame held three times as long."""
    size = frames[0].size
    shown = [(frame if frame.size == size else frame.resize(size, Image.Resampling.LANCZOS))
             .convert("P", palette=Image.Palette.ADAPTIVE, colors=255) for frame in frames]
    buf = io.BytesIO()
    shown[0].save(buf, "GIF", save_all=True, append_images=shown[1:],
                  duration=[interval] * (len(shown) - 1) + [interval * 3], loop=0, optimize=True, disposal=2)
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


def png_bytes(image: Image.Image) -> bytes:
    """The page re-encoded here, whatever the browser sent."""
    buf = io.BytesIO()
    image.save(buf, "PNG", optimize=True)
    return buf.getvalue()
