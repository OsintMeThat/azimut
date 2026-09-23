"""Portable recipes and geographic inputs for Compare's Detect mode.

Detect reads Copernicus only: Sentinel-2's reflectance for the optical methods
and Sentinel-1's radar backscatter for the radar ones. Both are measurements,
which a rendered picture has already stretched away, so a source that serves
pictures has nothing to offer it. Models describe capabilities by stable ids,
and a saved run keeps meaning what it meant when it ran.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    FiniteFloat,
    SerializerFunctionWrapHandler,
    model_serializer,
    model_validator,
)

Method = Literal["vessels", "hotspots", "structure", "spots", "surface", "index",
                 "sar-vessels", "sar-change"]
Index = Literal["ndvi", "ndwi", "mndwi", "nbr", "ndbi", "bsi"]
ShortId = Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]{1,48}$")]
Colour = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]

# Methods that read one image instead of a pair. A vessel or a fire is a thing
# present on a date, not a difference between two of them.
SINGLE_METHODS = frozenset({"vessels", "hotspots", "sar-vessels"})

# Methods that read Sentinel-1's radar rather than Sentinel-2. Radar sees
# through cloud and at night, which is why they exist beside the optical ones.
RADAR_METHODS = frozenset({"sar-vessels", "sar-change"})

# The band product each method measures, fetched beside the picture the analyst
# reviews. `index` reads the one its parameters name.
PRODUCT_METHODS: dict[str, str] = {
    "vessels": "vessel", "hotspots": "fire",
    "structure": "surface", "spots": "surface", "surface": "surface",
    "sar-vessels": "sar", "sar-change": "sar",
}

# Where the cloud and shadow switches mean something. The fire test rejects
# cloud through its own band ratios, and a mask would also take the smoke a
# fire burns under.
CLOUD_METHODS = frozenset({"vessels", "structure", "spots", "surface", "index"})

# What a recipe saved before Detect went Copernicus-only asked for. The picture
# methods measured colour on a rendered image; reflectance change is what they
# were reaching for.
LEGACY_METHODS = {"colour": "surface", "brightness": "surface", "smoke": "surface",
                  "water_objects": "vessels"}
LEGACY_PARAMETERS = ("min_score", "normalize", "guess_clouds")


def product_for(method: str, index: str) -> str:
    return f"index-{index}" if method == "index" else PRODUCT_METHODS[method]


def sensor_for(method: str) -> str:
    """The Copernicus collection a method reads."""
    return "sentinel1" if method in RADAR_METHODS else "sentinel2"


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class DetectPrefs(Model):
    collapsed: bool = False
    basemap: str = Field(default="esri-world-imagery", max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    overlays: list[Literal["boundaries", "labels", "roads", "railway", "power", "seamarks", "gpstraces"]] = Field(
        default=["boundaries"], max_length=7)
    saved: bool = True


class Parameters(Model):
    # Moves each method's threshold inside the range it was calibrated over
    # (engine/analyzers.py), so the same number means "about as picky" everywhere.
    sensitivity: int = Field(default=60, ge=0, le=100)
    min_area: FiniteFloat = Field(default=0, ge=0, le=100_000_000)
    # 0 is no ceiling. A cloud bank or an island is far bigger than any hull,
    # and a ceiling is what stops it being offered as one.
    max_area: FiniteFloat = Field(default=0, ge=0, le=100_000_000)
    cleanup: int = Field(default=0, ge=0, le=3)
    smoothing: int = Field(default=0, ge=0, le=3)
    index: Index = "ndvi"
    direction: Literal["both", "gain", "loss"] = "both"
    # Where a radar change counts: anywhere, on ground bright enough to be
    # built-up or metal on the side that has it, or where open water came or went.
    sar_ground: Literal["any", "bright", "water"] = "any"
    ignore_clouds: bool = True
    ignore_shadows: bool = True
    # Metres are what a reader thinks in, but the mask is grown on the grid, and
    # a pixel there is 9.55 m at the equator: 5 takes the soft rim a scene
    # classification calls ground.
    cloud_margin: int = Field(default=5, ge=0, le=10)
    merge_metres: FiniteFloat = Field(default=0, ge=0, le=500)

    @model_validator(mode="before")
    @classmethod
    def legacy(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {key: value for key, value in data.items() if key not in LEGACY_PARAMETERS}
        return data


# What Small, Medium, Large and All set, per method. A size is a coherent set of
# numbers rather than one: a smaller target needs a smaller floor *and* no
# morphological cleanup, which would erase it, and a larger one wants nearby
# pieces grouped. The panel applies these; nothing stores which size was picked.
_SIZE_KEYS = ("min_area", "max_area", "cleanup", "smoothing", "merge_metres")
#: No floor and no ceiling, so nothing is dropped for its size. A mark that
#: falls between two sizes is the one an analyst hunts for and never sees.
_ALL = dict(zip(_SIZE_KEYS, (0.0, 0.0, 0, 0, 0.0)))


def _sizes(*rows: tuple[float, float, int, int, float]) -> dict[str, dict[str, float]]:
    named = {name: dict(zip(_SIZE_KEYS, row))
             for name, row in zip(("small", "medium", "large"), rows)}
    return {**named, "all": dict(_ALL)}


_CHANGE_SIZES = _sizes((300, 0, 0, 0, 0), (2000, 0, 1, 0, 30), (20000, 0, 1, 1, 100))
SIZES: dict[str, dict[str, dict[str, float]]] = {
    "vessels": _sizes((0, 150_000, 0, 0, 30), (250, 150_000, 0, 0, 50), (2500, 400_000, 0, 0, 100)),
    "hotspots": _sizes((0, 0, 0, 0, 30), (250, 0, 0, 0, 60), (3000, 0, 0, 0, 200)),
    "structure": _sizes((100, 3000, 0, 0, 0), (600, 200_000, 0, 0, 20), (8000, 0, 1, 1, 60)),
    "spots": _sizes((0, 800, 0, 0, 0), (100, 2500, 0, 0, 0), (400, 8000, 0, 0, 20)),
    "surface": _CHANGE_SIZES,
    "index": _CHANGE_SIZES,
    # Radar pixels are 10 m like Sentinel-2's, and speckle is what smoothing
    # works against: a small target keeps the finest window.
    "sar-vessels": _sizes((0, 150_000, 0, 0, 30), (250, 150_000, 0, 0, 50), (2500, 400_000, 0, 0, 100)),
    "sar-change": _sizes((300, 0, 0, 1, 0), (2000, 0, 1, 2, 30), (20000, 0, 1, 3, 100)),
}


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
    method: Method = "surface"
    parameters: Parameters = Field(default_factory=Parameters)
    colour: Colour = "#f6a81a"
    style: Literal["pins", "outlines", "both"] = "both"

    @model_validator(mode="before")
    @classmethod
    def legacy(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        # Areas belong to a saved detection, not to what it looks for. An
        # analyzer saved with areas of its own still loads, without them.
        data = {key: value for key, value in data.items() if key not in ("providers", "zones")}
        if data.get("method") in LEGACY_METHODS:
            data["method"] = LEGACY_METHODS[data["method"]]
        return data


class Source(Model):
    provider: Literal["sentinel2", "sentinel1"] = "sentinel2"
    date: str = Field(default="", max_length=10)
    layer: str = Field(default="TRUE_COLOR", pattern=r"^[A-Z0-9_]{1,40}$")
    maxcc: int = Field(default=30, ge=0, le=100)
    #: A Sentinel-1 pass's UTC time of day. The radar can see a place twice on
    #: one day, from opposite directions, and only the time says which look.
    time: str = Field(default="", pattern=r"^$|^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$")

    @model_validator(mode="before")
    @classmethod
    def legacy(cls, data: Any) -> Any:
        # A Wayback release names no Sentinel-2 day, so a watch saved against
        # one comes back undated and asks for a date rather than failing to load.
        if isinstance(data, dict) and data.get("provider") == "esri-wayback":
            data = {key: value for key, value in data.items() if key not in ("provider", "release")}
        return data

    @model_validator(mode="after")
    def dated(self) -> Source:
        if self.date:
            try:
                date.fromisoformat(self.date)
            except ValueError as exc:
                raise ValueError("choose a dated Copernicus acquisition") from exc
        return self

    @model_serializer(mode="wrap")
    def compact(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        # An optical source says what it always said, so the frame keys, the
        # repeat check and every run saved before radar keep matching.
        data: dict[str, Any] = handler(self)
        if not data.get("time"):
            data.pop("time", None)
        return data


class ZoneSet(Model):
    title: str = Field(min_length=1, max_length=120)
    zones: list[Zone] = Field(min_length=1, max_length=32)


class AreaGeometry(Model):
    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[tuple[FiniteFloat, FiniteFloat]]] = Field(min_length=1, max_length=1)

    @model_validator(mode="after")
    def polygon(self) -> AreaGeometry:
        ring = self.coordinates[0]
        if len(ring) < 4 or ring[0] != ring[-1]:
            raise ValueError("a polygon must have a closed ring")
        Zone(id="area", kind="polygon", points=ring[:-1])
        return self


class Area(Model):
    name: str = Field(min_length=1, max_length=120)
    colour: Colour = "#38bdf8"
    geometry: AreaGeometry


class AreaDates(Model):
    area_id: ShortId
    a: Source = Field(default_factory=Source)
    b: Source = Field(default_factory=Source)
    date_rule: Literal["manual", "latest_reference", "latest_previous"] = "latest_reference"


class RunInput(Model):
    title: str = Field(min_length=1, max_length=120)
    zones: list[Zone] = Field(default_factory=list, max_length=32)
    area_dates: list[AreaDates] = Field(default_factory=list, max_length=32)
    #: What this detection is for, in the analyst's own words. It travels with
    #: the run, so a sweep opened months later still says why it was made.
    note: str = Field(default="", max_length=500)
    recipe: Recipe
    a: Source = Field(default_factory=Source)
    b: Source = Field(default_factory=Source)
    offline: bool = False
    run_anyway: bool = False
    followup_id: ShortId | None = None
    date_rule: Literal["manual", "latest_reference", "latest_previous"] = "manual"

    @model_validator(mode="after")
    def pair(self) -> RunInput:
        if len({zone.id for zone in self.zones}) != len(self.zones):
            raise ValueError("area ids must be unique")
        if self.area_dates:
            ids = [pair.area_id for pair in self.area_dates]
            if len(set(ids)) != len(ids):
                raise ValueError("area ids must be unique")
            if self.zones and set(ids) != {zone.id for zone in self.zones}:
                raise ValueError("each area needs its own dates")
            for pair in self.area_dates:
                if pair.date_rule == "manual" and not pair.b.date:
                    raise ValueError("choose a pass date for each area")
                if self.recipe.method not in SINGLE_METHODS and not pair.a.date and not (
                    pair.date_rule == "latest_previous" and self.followup_id
                ):
                    raise ValueError("choose a reference date for each area")
            return self
        if not self.zones:
            raise ValueError("choose at least one area")
        required = []
        if self.date_rule == "manual":
            required.append(self.b)
        if self.recipe.method not in SINGLE_METHODS and (
            self.date_rule != "latest_previous" or not self.followup_id
        ):
            required.append(self.a)
        if any(not source.date for source in required):
            raise ValueError("choose a dated Copernicus acquisition")
        return self


def _recipe(size: str = "medium", **fields: Any) -> Recipe:
    parameters = {**SIZES[fields["method"]][size], **fields.pop("parameters", {})}
    return Recipe(parameters=Parameters(**parameters), **fields)


# Names say what an analyst is looking for; descriptions say what is measured
# and where that stops. None of these recognise an object: each one flags a
# reading, and the review is where it becomes a finding.
BUILTINS = [
    _recipe(id="boats", name="Vessels", method="vessels", phenomenon="Vessel candidate",
            description="Brighter than the water around it in near and short-wave infrared, "
            "which breaking waves and glint are not. Boats under about 20 m rarely show.",
            parameters={"sensitivity": 70}, colour="#38bdf8"),
    _recipe(id="anomaly", name="Fires and gas flares", method="hotspots",
            phenomenon="Hotspot candidate",
            description="Short-wave infrared well above the bands beside it, the published "
            "active-fire test. It sees flame through smoke, not what is burning.",
            parameters={"sensitivity": 60}, colour="#fb7185"),
    _recipe(id="structures", name="Construction and earthworks", method="structure",
            phenomenon="Possible structure or disturbed ground",
            description="Ground that turned brighter or darker in every band while its "
            "vegetation held. Crops are left out; wet soil and new shadows are not.",
            parameters={"sensitivity": 78}, colour="#a78bfa"),
    _recipe(id="impacts", name="Small spots: impacts, burns, vehicles", method="spots",
            phenomenon="Small change",
            description="A few pixels that changed while everything around them held still. "
            "A vehicle is smaller than a pixel, so look for the mark it left.",
            parameters={"sensitivity": 67}, colour="#f97316"),
    _recipe(id="large-change", name="Any surface change", method="surface",
            phenomenon="Surface change",
            description="Reflectance that moved in red, near or short-wave infrared, "
            "whatever moved it. Harvests and seasons show too.",
            parameters={"sensitivity": 67}),
    _recipe(id="burn-scars", name="Burn scars", method="index", phenomenon="Burn scar",
            description="The burn ratio dropped on ground that had vegetation. The default "
            "sits at 0.27, the published mark for moderate severity.",
            parameters={"sensitivity": 51, "index": "nbr", "direction": "loss"},
            colour="#ef4444"),
    _recipe(id="vegetation-loss", name="Vegetation loss", method="index",
            phenomenon="Vegetation loss",
            description="NDVI dropped by a quarter or more from green cover: clearing, "
            "harvest, fire or drought.",
            parameters={"sensitivity": 56, "index": "ndvi", "direction": "loss"},
            colour="#84cc16"),
    _recipe(id="new-water", name="Flooding and new water", method="index",
            phenomenon="New water",
            description="Ground that now reads as open water in the modified water index.",
            parameters={"sensitivity": 56, "index": "mndwi", "direction": "gain"},
            colour="#0ea5e9"),
    # Sentinel-1. The radar sees through cloud and at night, and a metal hull
    # or a standing wall answers it far louder than water or open ground.
    _recipe(id="radar-vessels", name="Vessels by radar", method="sar-vessels",
            phenomenon="Vessel candidate (radar)",
            description="A strong radar return from open water, through cloud and at night. "
            "Platforms, turbines, bridges and harbour walls answer too.",
            parameters={"sensitivity": 60}, colour="#22d3ee"),
    _recipe(id="radar-change", name="Radar change", method="sar-change",
            phenomenon="Radar change",
            description="Backscatter that moved between two passes of the same track, whatever "
            "moved it. Fields change weekly in the growing season, so expect them.",
            parameters={"sensitivity": 50}, colour="#c084fc"),
    _recipe(id="radar-razed", name="Damaged or razed buildings (radar)", method="sar-change",
            phenomenon="Loss of built-up return",
            description="Ground that answered the radar like standing walls and went quiet. "
            "Two passes only flag where to look; confirm on imagery before calling it damage.",
            parameters={"sensitivity": 60, "direction": "loss", "sar_ground": "bright"},
            colour="#f43f5e"),
    _recipe(id="radar-new-objects", name="New structures and vehicles (radar)",
            method="sar-change", phenomenon="New strong return",
            description="Ground that now answers like metal or walls: new buildings, parked "
            "vehicles, containers, moored ships.",
            parameters={"sensitivity": 60, "direction": "gain", "sar_ground": "bright"},
            colour="#eab308"),
    _recipe("large", id="radar-flood", name="Flooding by radar", method="sar-change",
            phenomenon="New open water (radar)",
            description="Ground that went as radar-dark as calm water, under the cloud a flood "
            "usually comes with. Wind on the water and flooded streets can hide it.",
            parameters={"sensitivity": 60, "direction": "loss", "sar_ground": "water"},
            colour="#3b82f6"),
]

# How the built-ins are offered: by what an analyst is looking for, radar
# first where it reads the same thing better. Every built-in is in one group.
GROUPS: list[tuple[str, str, list[str]]] = [
    ("vessels", "Vessels", ["radar-vessels", "boats"]),
    ("fire", "Fires and burns", ["anomaly", "burn-scars"]),
    ("water", "Water and floods", ["radar-flood", "new-water"]),
    ("built", "Buildings and earthworks", ["structures", "radar-new-objects", "radar-razed"]),
    ("ground", "Vegetation and small marks", ["vegetation-loss", "impacts"]),
    ("any", "Any change", ["radar-change", "large-change"]),
]

# How far a built-in's reading can be trusted, from what calibration showed.
# Reliable: the published test or a contrast few false hits survive. Approximate:
# right more often than not, with known look-alikes. Rough: a lead to check.
# Radar vessels beat optical ones because a hull answers the radar through cloud
# and glint alike; two radar passes read damage roughly, where a year of them
# would not (docs/SPEC.md §7).
RELIABILITY: dict[str, Literal["reliable", "approximate", "rough"]] = {
    "radar-vessels": "reliable", "boats": "approximate",
    "anomaly": "reliable", "burn-scars": "reliable",
    "radar-flood": "reliable", "new-water": "approximate",
    "structures": "approximate", "radar-new-objects": "approximate", "radar-razed": "rough",
    "vegetation-loss": "reliable", "impacts": "rough",
    "radar-change": "rough", "large-change": "rough",
}


def frames_per_tile(method: str) -> int:
    """Requests one tile costs: the picture and the product for each date, and
    for radar vessels the Sentinel-2 water classification beside them."""
    return (2 if method in SINGLE_METHODS else 4) + (1 if method == "sar-vessels" else 0)


# What the panel reads so it never has to know a method by name: `single` stops
# it asking for a reference image, `clouds` says whether the cloud switch means
# anything, `sensor` which collection its passes come from, `frames` what a
# tile costs, `sizes` fills Small/Medium/Large and `measure` words a candidate's
# reading ({value}, {signed}, {before}, {after} and {index} are filled in).
METHODS = [
    {"id": method, "label": label, "single": method in SINGLE_METHODS,
     "clouds": method in CLOUD_METHODS, "sensor": sensor_for(method),
     "frames": frames_per_tile(method), "sizes": SIZES[method], "measure": measure}
    for method, label, measure in [
        ("vessels", "Vessels: infrared contrast over water",
         "{value}× brighter than the water around it"),
        ("hotspots", "Hotspots: short-wave infrared ratios",
         "Short-wave infrared {value}× the bands beside it"),
        ("structure", "Ground change in every band", "Reflectance {signed}% in every band"),
        ("spots", "Isolated small change", "Reflectance {signed}% against its surroundings"),
        ("surface", "Any reflectance change", "Reflectance moved by {value}%"),
        ("index", "Spectral index change", "{index} {before} → {after}"),
        ("sar-vessels", "Radar: strong return over water",
         "{value} dB brighter than the sea around it"),
        ("sar-change", "Radar: backscatter change", "Backscatter {signed} dB, {before} → {after} dB"),
    ]
]
