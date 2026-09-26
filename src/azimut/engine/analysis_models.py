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
from typing import Annotated, Any, Literal, TypeVar

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    FiniteFloat,
    SerializerFunctionWrapHandler,
    ValidationError,
    ValidationInfo,
    field_validator,
    model_serializer,
    model_validator,
)

Method = Literal["vessels", "hotspots", "structure", "spots", "surface", "index",
                 "sar-vessels", "sar-change", "rules"]
Index = Literal["ndvi", "ndwi", "mndwi", "nbr", "ndbi", "bsi"]
#: Sentinel-2 Level-2A's bands, as an analyzer of your own may name them.
#: `sentinel.L2A_BANDS` is the list the evalscripts accept, in this order.
Band = Literal["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B8A", "B09", "B11", "B12"]
#: Ground as Sentinel-2's scene classification names it.
SceneClass = Literal["vegetation", "bare", "water", "snow", "cloud", "shadow", "dark"]
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


#: Validation context for data Azimut wrote itself and reads back (`stored`).
STORED = {"stored": True}


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    @model_validator(mode="before")
    @classmethod
    def _known_fields(cls, data: Any, info: ValidationInfo) -> Any:
        """Drop the fields this version does not know, when the data is Azimut's own.

        A request naming an unknown field is a bug in its caller and is refused.
        A saved run, routine or analyzer is history instead: a field an earlier
        version wrote and a later one dropped must not make it unreadable, and
        one such run once turned every launch in its case into a server error.
        """
        if isinstance(data, dict) and isinstance(info.context, dict) and info.context.get("stored"):
            return {key: value for key, value in data.items() if key in cls.model_fields}
        return data


M = TypeVar("M", bound=Model)


def stored(model: type[M], data: Any) -> M:
    """Read back something Azimut saved, ignoring the fields it no longer has."""
    return model.model_validate(data, context=STORED)


#: Map layers that no longer exist. A saved preference or a settings backup that
#: still names one drops it rather than being refused: CARTO's labels went when
#: their tiles began asking for a key, and the borders already name places.
RETIRED_OVERLAYS = frozenset({"labels"})


class DetectPrefs(Model):
    collapsed: bool = False
    basemap: str = Field(default="esri-world-imagery", max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    overlays: list[Literal["boundaries", "roads", "railway", "power", "seamarks", "gpstraces"]] = Field(
        default=["boundaries"], max_length=6)
    saved: bool = True

    @field_validator("overlays", mode="before")
    @classmethod
    def _drop_retired(cls, value: Any) -> Any:
        if isinstance(value, list):
            return [entry for entry in value if entry not in RETIRED_OVERLAYS]
        return value


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
    # Kept after sizing: a roof or a crater is compact, a road, a track or a
    # trench is long and thin. "any" keeps both, as every built-in does.
    shape: Literal["any", "compact", "elongated"] = "any"

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
#: falls between two sizes is the one an analyst hunts for and never sees, so
#: this is where every built-in starts.
_ALL = dict(zip(_SIZE_KEYS, (0.0, 0.0, 0, 0, 0.0)))


def _sizes(*rows: tuple[float, float, int, int, float], averaging: int = 0) -> dict[str, dict[str, float]]:
    named = {name: dict(zip(_SIZE_KEYS, row))
             for name, row in zip(("small", "medium", "large"), rows)}
    return {**named, "all": {**_ALL, "smoothing": averaging}}


_CHANGE_SIZES = _sizes((300, 0, 0, 0, 0), (2000, 0, 1, 0, 30), (20000, 0, 1, 1, 100))
SIZES: dict[str, dict[str, dict[str, float]]] = {
    "vessels": _sizes((0, 150_000, 0, 0, 30), (250, 150_000, 0, 0, 50), (2500, 400_000, 0, 0, 100)),
    "hotspots": _sizes((0, 0, 0, 0, 30), (250, 0, 0, 0, 60), (3000, 0, 0, 0, 200)),
    "structure": _sizes((100, 3000, 0, 0, 0), (600, 200_000, 0, 0, 20), (8000, 0, 1, 1, 60)),
    "spots": _sizes((0, 800, 0, 0, 0), (100, 2500, 0, 0, 0), (400, 8000, 0, 0, 20)),
    "surface": _CHANGE_SIZES,
    "index": _CHANGE_SIZES,
    # Radar pixels are 10 m like Sentinel-2's, and speckle is what smoothing
    # works against: for radar change a step of it is 45 m of ground
    # (`SAR_WINDOW_M`), and a small target keeps the finest window.
    "sar-vessels": _sizes((0, 150_000, 0, 0, 30), (250, 150_000, 0, 0, 50), (2500, 400_000, 0, 0, 100)),
    # All keeps Medium's 90 m of averaging: it is what took Istanbul's false
    # "razed" from 111 to 25 (`analyzers.SAR_WINDOW_M`), and All is the size a
    # detection starts at, so it drops the size limits and not that.
    "sar-change": _sizes((300, 0, 0, 1, 0), (2000, 0, 1, 2, 30), (20000, 0, 1, 3, 100), averaging=2),
    # Your own rules measure change like the index methods do. Radar rules
    # take radar change's sizes instead (`METHODS`, the panel picks them).
    "rules": _CHANGE_SIZES,
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


# Scene classes, as Sen2Cor numbers them, behind the names a rule uses.
SCENE_CLASSES: dict[str, tuple[int, ...]] = {
    "vegetation": (4,), "bare": (5,), "water": (6,), "snow": (11,),
    "cloud": (8, 9, 10), "shadow": (3,), "dark": (2,),
}
#: The bands each measure reads beyond the ones a rule names itself.
VISIBLE_BANDS = ("B02", "B03", "B04")
#: How many rules one analyzer holds, and how many bands they may read between
#: them. Every three bands are one more request per date and tile.
MAX_RULES = 6
MAX_BANDS = 6
#: How far "against its surroundings" may look, in metres: the context a band
#: product carries around its tile (`analyzers.PAD`, 306 m at the equator).
MAX_AROUND = 300


class Rule(Model):
    """One line of an analyzer of your own: a quantity, the date it is read on,
    and the line it has to cross.

    `on` is a date (A or B) or the change between them. A change is B minus A,
    so a loss is a negative value; `moved` takes either way. `around` reads the
    quantity against the ground around it, in metres, so "brighter than its
    surroundings" is the same rule on a dark sea and a bright desert.
    """

    measure: Literal["index", "nd", "band", "brightness", "colour", "class", "radar"] = "index"
    index: Index = "ndvi"
    #: A normalised difference of two bands: (first − second) / (first + second).
    bands: tuple[Band, Band] = ("B08", "B04")
    band: Band = "B08"
    polarisation: Literal["vv", "vh", "ratio"] = "vv"
    classes: list[SceneClass] = Field(default_factory=list, max_length=7)
    on: Literal["a", "b", "change"] = "b"
    op: Literal["ge", "le", "between", "moved", "is", "not"] = "ge"
    value: FiniteFloat = Field(default=0, ge=-100, le=100)
    upper: FiniteFloat = Field(default=0, ge=-100, le=100)
    around: int = Field(default=0, ge=0, le=MAX_AROUND)

    @model_validator(mode="after")
    def coherent(self) -> Rule:
        if self.measure == "class":
            if self.op not in ("is", "not"):
                raise ValueError("a ground class rule says is or is not")
            if self.on == "change":
                raise ValueError("a ground class is read on one date; use two rules to compare them")
            if not self.classes:
                raise ValueError("choose at least one ground class")
            if self.around:
                raise ValueError("a ground class has no surroundings to compare with")
            return self
        if self.op in ("is", "not"):
            raise ValueError("is and is not are for ground classes")
        if self.op == "moved" and self.on != "change":
            raise ValueError("moved by compares two dates")
        if self.measure == "colour" and self.on != "change":
            raise ValueError("a colour distance compares two dates")
        if self.op == "between" and self.upper <= self.value:
            raise ValueError("the upper bound must be above the lower one")
        if self.measure == "nd" and self.bands[0] == self.bands[1]:
            raise ValueError("a normalised difference needs two different bands")
        return self

    def bands_read(self) -> list[str]:
        """The Sentinel-2 bands this rule needs, radar and ground classes none."""
        from .sentinel import SPECTRAL_INDEX

        if self.measure == "index":
            high, low = SPECTRAL_INDEX[self.index]
            return [*high, *low]
        if self.measure == "nd":
            return list(self.bands)
        if self.measure == "band":
            return [self.band]
        if self.measure in ("brightness", "colour"):
            return list(VISIBLE_BANDS)
        return []


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


#: How many checks one analyzer keeps, and how many marks one check holds.
MAX_CHECKS = 12
MAX_MARKS = 20
Longitude = Annotated[float, Field(ge=-180, le=180)]
Latitude = Annotated[float, Field(ge=-85, le=85)]


class Bounds(Model):
    west: Longitude
    south: Latitude
    east: Longitude
    north: Latitude


class Mark(Model):
    """A point of a check, and what a run of the analyzer should make of it."""

    point: tuple[Longitude, Latitude]
    expect: Literal["found", "empty"]


class CheckResult(Model):
    """How a check last came out, and which reading of the analyzer gave it.

    `signature` is the panel's digest of the rules, `match` and parameters,
    so a result read against rules that have changed since shows as stale.
    `covered` says, mark by mark, whether a candidate came out on it.
    """

    signature: str = Field(pattern=r"^[0-9a-z]{1,32}$")
    count: int = Field(ge=0, le=100_000)
    covered: list[bool] = Field(default_factory=list, max_length=MAX_MARKS)


class Check(Model):
    """A place the analyst trusts, rerun after each change to the rules.

    It keeps the exact pair of passes it was saved on, so a rerun reads the
    same images. Marks say where a candidate must come out and where none may;
    a check without marks still says how many candidates its view gave.
    """

    id: ShortId
    name: str = Field(min_length=1, max_length=120)
    a: Source = Field(default_factory=Source)
    b: Source
    bounds: Bounds
    marks: list[Mark] = Field(default_factory=list, max_length=MAX_MARKS)
    result: CheckResult | None = None

    @model_validator(mode="after")
    def placed(self) -> Check:
        if not self.b.date:
            raise ValueError("a check is read on a dated pass B")
        if self.bounds.west >= self.bounds.east or self.bounds.south >= self.bounds.north:
            raise ValueError("a check's view must not cross the antimeridian")
        if self.result and self.result.covered and len(self.result.covered) != len(self.marks):
            raise ValueError("a check's last result must match its marks")
        return self


class Recipe(Model):
    id: ShortId = "custom"
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    phenomenon: str = Field(default="Surface change", min_length=1, max_length=120)
    method: Method = "surface"
    parameters: Parameters = Field(default_factory=Parameters)
    colour: Colour = "#f6a81a"
    style: Literal["pins", "outlines", "both"] = "both"
    #: The analyst's own rules, for `method="rules"` and nothing else. The
    #: first measured one ranks candidates; `match` says whether a pixel has
    #: to pass all of them or any one.
    rules: list[Rule] = Field(default_factory=list, max_length=MAX_RULES)
    match: Literal["all", "any"] = "all"
    #: Places the analyst trusts, rerun after each change (`Check`).
    checks: list[Check] = Field(default_factory=list, max_length=MAX_CHECKS)

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

    @model_validator(mode="after")
    def own_rules(self) -> Recipe:
        if self.method != "rules":
            if self.rules or self.checks:
                raise ValueError("only an analyzer of your own rules carries rules and checks")
            return self
        if not self.rules:
            raise ValueError("add at least one rule")
        radar = {rule.measure == "radar" for rule in self.rules if rule.measure != "class"}
        if len(radar) > 1:
            raise ValueError("radar and optical rules read two satellites; keep them in two analyzers")
        if True in radar and any(rule.measure == "class" for rule in self.rules):
            raise ValueError("ground classes come from Sentinel-2, which a radar analyzer does not read")
        if len({check.id for check in self.checks}) != len(self.checks):
            raise ValueError("check ids must be unique")
        if len(rule_bands(self)) > MAX_BANDS:
            raise ValueError(f"an analyzer reads at most {MAX_BANDS} bands")
        return self


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
                if not is_single(self.recipe) and not pair.a.date and not (
                    pair.date_rule == "latest_previous" and self.followup_id
                ):
                    raise ValueError("choose a reference date for each area")
            return self
        if not self.zones:
            raise ValueError("choose at least one area")
        required = []
        if self.date_rule == "manual":
            required.append(self.b)
        if not is_single(self.recipe) and (
            self.date_rule != "latest_previous" or not self.followup_id
        ):
            required.append(self.a)
        if any(not source.date for source in required):
            raise ValueError("choose a dated Copernicus acquisition")
        return self


def _as_recipe(recipe: Recipe | dict[str, Any]) -> Recipe:
    # A request's recipe is already a model; a dict is one read off disk.
    return recipe if isinstance(recipe, Recipe) else stored(Recipe, recipe)


def unreadable(exc: ValidationError) -> str:
    """The first thing a saved detection fails on, in one line an analyst can act on."""
    error = exc.errors()[0]
    where = " › ".join(str(part) for part in error.get("loc", ()) if part != "body")
    reason = str(error.get("msg", "")).removeprefix("Value error, ")
    return f"{where}: {reason}" if where and error.get("type") != "value_error" else reason


def is_radar(recipe: Recipe | dict[str, Any]) -> bool:
    """Whether the recipe reads Sentinel-1."""
    recipe = _as_recipe(recipe)
    if recipe.method == "rules":
        return any(rule.measure == "radar" for rule in recipe.rules)
    return recipe.method in RADAR_METHODS


def is_single(recipe: Recipe | dict[str, Any]) -> bool:
    """Whether the recipe reads one date: a thing present, not a change.

    Rules that only ever read B need no reference, like a vessel or a fire.
    """
    recipe = _as_recipe(recipe)
    if recipe.method == "rules":
        return all(rule.on == "b" for rule in recipe.rules)
    return recipe.method in SINGLE_METHODS


def uses_clouds(recipe: Recipe | dict[str, Any]) -> bool:
    """Whether the cloud and shadow switches mean anything for this recipe."""
    recipe = _as_recipe(recipe)
    if recipe.method == "rules":
        return not is_radar(recipe)
    return recipe.method in CLOUD_METHODS


def recipe_sensor(recipe: Recipe | dict[str, Any]) -> str:
    return "sentinel1" if is_radar(recipe) else "sentinel2"


def rule_bands(recipe: Recipe) -> list[str]:
    """Every Sentinel-2 band the recipe's rules read, in the collection's order."""
    from .sentinel import L2A_BANDS

    wanted = {band for rule in recipe.rules for band in rule.bands_read()}
    return [band for band in L2A_BANDS if band in wanted]


def recipe_products(recipe: Recipe | dict[str, Any]) -> list[str]:
    """The band products one tile of this recipe reads, per date."""
    from .sentinel import band_product

    recipe = _as_recipe(recipe)
    if recipe.method != "rules":
        return [product_for(recipe.method, recipe.parameters.index)]
    if is_radar(recipe):
        return ["sar"]
    bands = rule_bands(recipe)
    # Ground classes and the cloud mask ride in every product, so a recipe of
    # ground classes alone still reads one.
    groups = [bands[i:i + 3] for i in range(0, len(bands), 3)] or [["B08"]]
    return [band_product(group) for group in groups]


def frames_for(recipe: Recipe | dict[str, Any]) -> int:
    """Requests one tile costs: for each date read, the picture and every product."""
    recipe = _as_recipe(recipe)
    if recipe.method != "rules":
        return frames_per_tile(recipe.method)
    return (1 if is_single(recipe) else 2) * (1 + len(recipe_products(recipe)))


def _recipe(size: str = "all", **fields: Any) -> Recipe:
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
    # Construction's reading, darkening only and at a firmer line: a 9% drop in
    # every band. On pairs from Planetary Computer it took Hodeidah's burned tank
    # farm (July 2024) whole, an Isfahan depot and its soot with a hangar beside
    # it (spring 2026), and Beirut's blasted port warehouses (August 2020).
    # Hodeidah, Saky and Isfahan days apart with nothing happening gave one to
    # three. A Dubai pair after April 2024's rain gave two hundred, which is why
    # it says so.
    _recipe(id="burned-buildings", name="Burned or destroyed buildings", method="structure",
            phenomenon="Burn or blast mark",
            description="Ground and roofs that went darker in every band: soot, char and "
            "wreckage. Rain-wet ground darkens too, and a roof that fell without burning "
            "rarely shows.",
            parameters={"sensitivity": 60, "direction": "loss"}, colour="#b45309"),
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
    # A flood is fields wide: without a floor it comes back in hundreds of pieces.
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
    ("built", "Buildings and earthworks", ["structures", "radar-new-objects", "radar-razed",
                                           "burned-buildings"]),
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
    "burned-buildings": "rough",
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
#: Ground one step of smoothing averages over, where a method counts it in
#: metres rather than pixels (`engine/analyzers.py` says why for radar).
SMOOTHING_M = {"sar-change": 45.0}

# `rules` is the one method whose answers depend on the recipe: which dates,
# which satellite and how many frames follow from the rules it holds, and the
# panel works them out from those (lib/map/analyzerRules.js). What it states
# here is the answer for a change in Sentinel-2 bands.
METHODS = [
    {"id": method, "label": label, "single": method in SINGLE_METHODS,
     "clouds": method in CLOUD_METHODS or method == "rules", "sensor": sensor_for(method),
     "frames": frames_per_tile(method), "sizes": SIZES[method], "measure": measure,
     "smoothing_m": SMOOTHING_M.get(method), "rules": method == "rules"}
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
        ("rules", "Your own rules", ""),
    ]
]
