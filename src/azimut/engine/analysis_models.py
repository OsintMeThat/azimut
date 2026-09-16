"""Portable recipes and geographic inputs for Compare analyzers.

Models describe capabilities by stable ids. A later model adapter can join the
method registry without changing saved runs or accepting executable recipes.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

Provider = Literal["esri-wayback", "sentinel2"]
Method = Literal["colour", "structure", "brightness", "index", "water_objects", "smoke",
                 "vessels", "hotspots"]
ShortId = Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]{1,48}$")]
Colour = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]

# Methods that read one image instead of a pair. A vessel or a fire is a thing
# present on a date, not a difference between two of them, so asking for a
# reference image would be asking for something the method cannot use.
SINGLE_METHODS = frozenset({"water_objects", "vessels", "hotspots"})

# Methods that measure reflectance, which a rendered picture has already
# stretched away. Each needs the band product named here, fetched beside the
# picture the analyst reviews. `index` picks its product from the recipe's
# parameters instead, so it is not in this table.
PRODUCT_METHODS: dict[str, str] = {"vessels": "vessel", "hotspots": "fire"}

# Reflectance is Copernicus only: Wayback serves pictures, not bands.
SENTINEL_ONLY = frozenset({"index", *PRODUCT_METHODS})

# How each method can exclude cloud and the shadow it casts.
#
# ``classes`` reads Sentinel-2's own per-pixel scene classification, which is
# the real answer. ``picture`` has only the rendered image, so it goes on what
# cloud looks like — bright and colourless, its shadow near-black — which is a
# guess, and the UI says so rather than dressing it up.
#
# Three methods are absent on purpose. The fire test rejects cloud by its band
# ratios and spends its fourth channel on the data mask instead. Smoke and
# bright shapes on water *are* bright and colourless: there, the picture test
# would mask the very thing the method looks for.
CLOUD_FILTERS: dict[str, str] = {
    "index": "classes", "vessels": "classes",
    "colour": "picture", "structure": "picture", "brightness": "picture",
}


def both_providers() -> list[Provider]:
    return ["esri-wayback", "sentinel2"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Parameters(Model):
    sensitivity: int = Field(default=55, ge=0, le=100)
    min_area: FiniteFloat = Field(default=20, ge=0, le=100_000_000)
    min_score: FiniteFloat = Field(default=0, ge=0, le=1)
    cleanup: int = Field(default=1, ge=0, le=3)
    smoothing: int = Field(default=0, ge=0, le=3)
    normalize: bool = False
    index: Literal["ndvi", "ndwi", "nbr", "ndbi"] = "ndvi"
    direction: Literal["both", "gain", "loss"] = "both"
    # Sentinel-2's own scene classification: the sensor says which pixels are
    # cloud, so this is on by default.
    ignore_clouds: bool = True
    ignore_shadows: bool = True
    # The same exclusion where there is no classification to ask, read off the
    # rendered picture instead. Off by default, and it stays off by default:
    # bright and colourless is what a white roof, a gravel pad and fresh snow
    # look like too, and those are things analysts come here to find. A guess
    # this broad is the analyst's to make, never one made for them.
    guess_clouds: bool = False
    # A cloud fades out at its edges and its shadow has no edge at all, so both
    # masks stop short of what a reader would call the cloud. Growing them by a
    # couple of pixels takes the fringe that otherwise survives as a ring of
    # candidates around every mask.
    cloud_margin: int = Field(default=2, ge=0, le=10)
    merge_metres: FiniteFloat = Field(default=0, ge=0, le=500)


class Zone(Model):
    id: ShortId
    name: str = Field(default="Area", min_length=1, max_length=120)
    kind: Literal["rect", "polygon", "ellipse"] = "rect"
    points: list[tuple[FiniteFloat, FiniteFloat]] = Field(min_length=2, max_length=100)

    @model_validator(mode="after")
    def geometry(self) -> Zone:
        if self.kind == "polygon":
            if len(self.points) < 3:
                raise ValueError("a polygon needs at least three corners")
        elif len(self.points) != 2:
            raise ValueError("a rectangle or ellipse needs two opposite corners")
        if any(abs(x) > 180 or abs(y) > 85 for x, y in self.points):
            raise ValueError("areas must be within longitude ±180 and latitude ±85")
        xs, ys = zip(*self.points)
        if max(xs) - min(xs) > 180:
            raise ValueError("split areas crossing the antimeridian into separate zones")
        if max(xs) == min(xs) or max(ys) == min(ys):
            raise ValueError("an area must have width and height")
        if self.kind == "polygon":
            edges = list(zip(self.points, self.points[1:] + self.points[:1]))
            area = sum(a[0] * b[1] - b[0] * a[1] for a, b in edges)
            if abs(area) < 1e-14:
                raise ValueError("a polygon must enclose an area")
        return self

    def ring(self) -> list[tuple[float, float]]:
        if self.kind == "polygon":
            return list(self.points)
        (x1, y1), (x2, y2) = self.points
        if self.kind == "rect":
            return [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
        return [((x1 + x2) / 2 + abs(x2 - x1) / 2 * math.cos(i * math.tau / 64),
                 (y1 + y2) / 2 + abs(y2 - y1) / 2 * math.sin(i * math.tau / 64))
                for i in range(64)]


class Recipe(Model):
    id: ShortId = "custom"
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    phenomenon: str = Field(default="Surface change", min_length=1, max_length=120)
    method: Method = "colour"
    providers: list[Provider] = Field(
        default_factory=both_providers, min_length=1, max_length=2
    )
    parameters: Parameters = Field(default_factory=Parameters)
    colour: Colour = "#f6a81a"
    style: Literal["pins", "outlines", "both"] = "both"
    zones: list[Zone] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def compatible(self) -> Recipe:
        if self.method in SENTINEL_ONLY and self.providers != ["sentinel2"]:
            raise ValueError("this method reads Copernicus Sentinel-2 bands, so it is "
                             "compatible with that source only")
        return self


class Source(Model):
    provider: Provider = "esri-wayback"
    date: str = Field(default="", max_length=10)
    release: int | None = Field(default=None, ge=1, le=999999999)
    layer: str = Field(default="TRUE_COLOR", pattern=r"^[A-Z0-9_]{1,40}$")
    maxcc: int = Field(default=30, ge=0, le=100)

    @model_validator(mode="after")
    def dated(self) -> Source:
        if self.provider == "sentinel2" and self.date:
            try:
                date.fromisoformat(self.date)
            except ValueError as exc:
                raise ValueError("choose a dated Sentinel-2 acquisition") from exc
        return self


class ZoneSet(Model):
    title: str = Field(min_length=1, max_length=120)
    zones: list[Zone] = Field(min_length=1, max_length=32)


class RunInput(ZoneSet):
    recipe: Recipe
    a: Source
    b: Source
    offline: bool = False
    followup_id: ShortId | None = None
    date_rule: Literal["manual", "latest_reference", "latest_previous"] = "manual"

    @model_validator(mode="after")
    def pair(self) -> RunInput:
        if self.a.provider != self.b.provider or self.b.provider not in self.recipe.providers:
            raise ValueError("use one compatible provider for both images")
        if self.recipe.method != "index" and self.a.layer != self.b.layer:
            raise ValueError("use the same rendering layer for both images")
        if len({zone.id for zone in self.zones}) != len(self.zones):
            raise ValueError("area ids must be unique")
        single = self.recipe.method in SINGLE_METHODS
        required = []
        if self.date_rule == "manual":
            required.append(self.b)
        if not single and (self.date_rule != "latest_previous" or not self.followup_id):
            required.append(self.a)
        for source in required:
            if source.provider == "sentinel2" and not source.date:
                raise ValueError("choose a dated Sentinel-2 acquisition")
            if source.provider == "esri-wayback" and source.release is None:
                raise ValueError("choose a named Wayback release")
        return self


# The names say what is measured, never what it means. "Vessels on water" is a
# claim about infrared contrast over sea, and the description is where the
# limits of that claim live — a preset called "Boats" would promise recognition
# no method here performs.
BUILTINS = [
    Recipe(id="large-change", name="Large surface change",
           description="Broad changes in colour between two dated images. New construction, "
           "clearing, earthworks and flooding all read as change; so does a different season.",
           parameters=Parameters(min_area=500)),
    Recipe(id="boats", name="Vessels on water (Sentinel-2)", method="vessels",
           phenomenon="Vessel candidate",
           providers=["sentinel2"],
           description="Targets brighter than the sea around them in the near-infrared, which "
           "water absorbs almost completely. Ships, rigs, buoys and breaking waves all qualify; "
           "at 10 m a pixel, anything under about 20 m is unlikely to appear at all.",
           parameters=Parameters(min_area=200, min_score=0.2, cleanup=0), colour="#38bdf8"),
    Recipe(id="structures", name="New structures or ground disturbance", method="structure",
           phenomenon="Possible structure or disturbed ground",
           description="New or lost edges; buildings, roads and bare ground need visual review.",
           parameters=Parameters(min_area=80), colour="#a78bfa"),
    Recipe(id="anomaly", name="Active fire or hotspot (Sentinel-2)", method="hotspots",
           phenomenon="Hotspot candidate",
           providers=["sentinel2"],
           description="Short-wave infrared high in absolute terms and high against the bands "
           "either side of it, which is the published active-fire test. It sees flame through "
           "smoke, and says nothing about what is burning or why.",
           parameters=Parameters(min_area=100, cleanup=0), colour="#fb7185"),
]

# What the panel reads so it never has to know a method by name: `single` stops
# it asking for a reference image, `sentinel_only` stops it offering Wayback,
# and `classes` decides whether the cloud and shadow switches mean anything.
METHODS = [
    {"id": method, "label": label, "single": method in SINGLE_METHODS,
     "sentinel_only": method in SENTINEL_ONLY, "cloud_filter": CLOUD_FILTERS.get(method, "")}
    for method, label in [
        ("colour", "Colour change"),
        ("structure", "Edge change"),
        ("brightness", "Brightness change"),
        ("index", "Spectral index change (Sentinel-2)"),
        ("vessels", "Infrared contrast over water (Sentinel-2)"),
        ("hotspots", "Short-wave infrared hotspot (Sentinel-2)"),
        ("water_objects", "Bright shapes on water (picture only)"),
        ("smoke", "Smoke-like visual change (picture only)"),
    ]
]
