"""Analyzers made of the analyst's own rules, and the checks that tune them.

A built-in detector is a method calibrated on real scenes (engine/analyzers.py).
An analyzer of your own is a list of rules instead: a quantity read from
Sentinel-2's bands or Sentinel-1's backscatter, on one date or as the change
between two, and the line it has to cross. Nothing here is calibrated. The
line the analyst sets is the line that runs.

A check is a pair of passes and the pins laid on them, and testing it runs
`evaluate` on the tiles under the pins and the ones beside them. That is the
frames a sweep of the same ground would read, so what the test shows there is
what a run returns: the same rules, cleanup, sizes, shape and grouping. It
hands back what each rule kept, the candidates, whether one came out on each
pin and what every rule read there. Testing reads the tile cache, and
fetching the frames it lacks is a separate act, which the analyst asks for and
which is metered like any other.
"""

from __future__ import annotations

import base64
import io
import math
import threading
from collections import OrderedDict
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from PIL import Image

from .. import config
from . import analysis_geometry, analyzers, sentinel, tilecache
from .analysis_models import (
    SCENE_CLASSES,
    VISIBLE_BANDS,
    Check,
    Recipe,
    Rule,
    Source,
    is_radar,
    is_single,
    recipe_products,
    recipe_sensor,
    uses_clouds,
)

#: What one unit past a rule's line is worth to a candidate's strength. Two of
#: them past it is Strong, as a built-in's reading at three times its threshold
#: is: 0.2 of an index, 4% reflectance, 4 dB of radar.
UNITS = {"index": 0.1, "nd": 0.1, "band": 0.02, "brightness": 0.02, "colour": 0.02, "radar": 2.0}
#: Quantities in reflectance, which a change reads with the passes' overall
#: shift in light taken out, as the built-in change methods do.
REFLECTANCE = frozenset({"band", "brightness", "colour"})
#: How many grid tiles one check may read, the ones beside a pin near an edge
#: included. Past that the frames to fetch stop being a figure an analyst can
#: weigh before pressing Test.
MAX_CHECK_TILES = 20
#: How near to its tile's edge a pin may come, in pixels, before the tile across
#: the edge is read as well. The examples keep their marks at least 64 pixels
#: inside, so each of them reads one tile.
EDGE_PX = 48
TEST_CANDIDATES = 300
#: Bits of a tile's mask. Rules take the low ones in order.
MEASURED_BIT = 6
KEPT_BIT = 7

# Decoded frames a test has read lately, so testing again after a change to a
# rule re-reads nothing from disk. A frame is 2.6 MB decoded; this holds a check
# of a few tiles on two dates with room to spare.
_DECODED: OrderedDict[tuple[str, int, int], Any] = OrderedDict()
_DECODED_MAX = 40
_DECODED_LOCK = threading.Lock()


@dataclass
class Evaluation:
    """One tile judged by an analyzer's rules, cropped back to the tile.

    `reading` is what a sweep turns into candidates. The rest is for the
    builder: what each rule kept, the value it read, and where the sensor saw.
    """

    reading: analyzers.Reading
    passes: list[Any]
    values: list[Any]
    before: list[Any]
    after: list[Any]
    measured: Any
    imaged: Any


# -- reading quantities ------------------------------------------------------------


def _odd(value: float, low: int, high: int) -> int:
    return int(min(high, max(low, round(value) | 1)))


class _Reader:
    """The quantities a recipe's rules read, computed once per tile and date."""

    def __init__(self, products: dict[str, tuple[Any, Any]], recipe: Recipe,
                 metres: float, measured: Any) -> None:
        self.products = products
        self.options = recipe.parameters
        self.metres = metres
        self.measured = measured
        self.where = {band: (name, channel) for name in products
                      for channel, band in enumerate(sentinel.product_bands(name))}
        self.cache: dict[tuple[Any, ...], Any] = {}

    def band(self, band: str, side: int) -> Any:
        import numpy as np

        name, channel = self.where[band]
        return self.products[name][side][:, :, channel].astype(np.float32) / sentinel.BANDS_SCALE

    def scene(self, side: int) -> Any:
        first = self.products[next(iter(self.products))][side]
        return first[:, :, 3] & 15

    def _normalised(self, high: tuple[str, ...], low: tuple[str, ...], side: int) -> Any:
        import numpy as np

        top = sum(self.band(band, side) for band in high)
        bottom = sum(self.band(band, side) for band in low)
        total = top + bottom
        with np.errstate(divide="ignore", invalid="ignore"):
            return np.where(total > 0, (top - bottom) / total, np.nan).astype(np.float32)

    def raw(self, rule: Rule, side: int) -> Any:
        """The quantity itself on one date, before smoothing."""
        import numpy as np

        if rule.measure == "index":
            high, low = sentinel.SPECTRAL_INDEX[rule.index]
            return self._normalised(high, low, side)
        if rule.measure == "nd":
            return self._normalised((rule.bands[0],), (rule.bands[1],), side)
        if rule.measure == "band":
            return self.band(rule.band, side)
        if rule.measure == "brightness":
            return sum(self.band(band, side) for band in VISIBLE_BANDS) / len(VISIBLE_BANDS)
        if rule.measure == "radar":
            # Speckle is averaged as power over the window radar change uses,
            # never as decibels, whose mean runs low (engine/analyzers.py).
            level = self.products["sar"][side]
            seen = self.measured & (level[:, :, 0] > 0)
            window = analyzers.sar_window(self.options.smoothing, self.metres)
            vv = analyzers._power_mean(level[:, :, 0], seen, window)
            if rule.polarisation == "vv":
                return vv.astype(np.float32)
            vh = analyzers._power_mean(level[:, :, 1], seen, window)
            return (vh if rule.polarisation == "vh" else vv - vh).astype(np.float32)
        raise ValueError(f"no quantity for {rule.measure}")

    def quantity(self, rule: Rule, side: int) -> Any:
        key = (rule.measure, rule.index, rule.bands, rule.band, rule.polarisation, side)
        if key not in self.cache:
            value = self.raw(rule, side)
            self.cache[key] = value if rule.measure == "radar" else self.smooth(value)
        return self.cache[key]

    def smooth(self, values: Any) -> Any:
        """A blur that only averages what was measured, so a cloud's edge or a
        swath's end does not bleed into the ground beside it."""
        import cv2
        import numpy as np

        steps = self.options.smoothing
        if not steps:
            return values
        weight = (self.measured & np.isfinite(values)).astype(np.float32)
        kernel = (steps * 2 + 1,) * 2
        total = cv2.GaussianBlur(np.where(weight > 0, values, 0).astype(np.float32), kernel, 0)
        count = cv2.GaussianBlur(weight, kernel, 0)
        with np.errstate(divide="ignore", invalid="ignore"):
            return np.where(count > 1e-3, total / count, np.nan).astype(np.float32)

    def shifted(self, delta: Any, limit: float) -> Any:
        """A change with the passes' overall shift taken out, up to `limit`."""
        import numpy as np

        usable = self.measured & np.isfinite(delta)
        shift = float(np.median(delta[usable])) if usable.any() else 0.0
        return delta - max(-limit, min(limit, shift))

    def colour(self) -> Any:
        """How far the visible bands moved together, in reflectance."""
        import numpy as np

        moved = [self.shifted(self.band(band, 1) - self.band(band, 0), analyzers.MAX_SHIFT)
                 for band in VISIBLE_BANDS]
        return self.smooth(np.sqrt(np.mean(np.stack(moved, -1) ** 2, -1)).astype(np.float32))

    def around(self, values: Any, metres: int) -> Any:
        """A quantity against the ground within `metres` of it, the ring with a
        hole punched in the middle that the vessel detectors read, so a target
        cannot raise its own background."""
        import numpy as np

        outer = _odd(2 * metres / self.metres + 1, 5, 2 * analyzers.PAD + 1)
        guard = _odd(outer / 3, 3, outer - 2)
        weight = self.measured & np.isfinite(values)
        mean, _, share = analyzers.ring_statistics(np.where(weight, values, 0.0).astype(np.float64),
                                                   weight, outer, guard)
        return np.where(share > 0, values - mean, np.nan).astype(np.float32)

    def value(self, rule: Rule) -> tuple[Any, Any, Any]:
        """What a rule compares with its line, and the two dates behind a change."""
        before = after = None
        if rule.on in ("a", "b"):
            value = self.quantity(rule, 0 if rule.on == "a" else 1)
        elif rule.measure == "colour":
            value = self.colour()
        else:
            before, after = self.quantity(rule, 0), self.quantity(rule, 1)
            value = after - before
            if rule.measure in REFLECTANCE:
                value = self.shifted(value, analyzers.MAX_SHIFT)
            elif rule.measure == "radar":
                value = self.shifted(value, analyzers.MAX_SAR_SHIFT)
        if rule.around:
            value = self.around(value, rule.around)
        return value, before, after


def _passes(rule: Rule, value: Any) -> Any:
    import numpy as np

    with np.errstate(invalid="ignore"):
        if rule.op == "ge":
            return value >= rule.value
        if rule.op == "le":
            return value <= rule.value
        if rule.op == "between":
            return (value >= rule.value) & (value <= rule.upper)
        return np.abs(value) >= rule.value


def _past(rule: Rule, value: Any) -> Any:
    """How far past its line a reading got, in the rule's own units."""
    import numpy as np

    if rule.op == "ge":
        return value - rule.value
    if rule.op == "le":
        return rule.value - value
    if rule.op == "between":
        return np.minimum(value - rule.value, rule.upper - value)
    return np.abs(value) - rule.value


@dataclass
class Measured:
    """One tile with every rule of the recipe read on it, before they are put together.

    Kept apart from the verdict so that a question about the rules (what do the
    pins make of them without this one?) is answered from the same reading
    instead of measuring the tile again.
    """

    recipe: Recipe
    shape: tuple[int, int]
    core: tuple[slice, slice]
    measured: Any
    imaged: Any
    passes: list[Any]
    values: list[Any]
    before: list[Any]
    after: list[Any]
    distances: list[Any]


def measure(products: dict[str, tuple[Any, Any]], mask: Any, recipe: Recipe,
            days: tuple[str, str], lat: float) -> Measured:
    """Read every rule of the recipe on one tile.

    `products` names each band product with its (A, B) frames, padded by
    `analyzers.PAD`; an analyzer that reads one date passes B twice. `mask`
    is the tile's own ground to judge, unpadded.
    """
    import numpy as np

    options = recipe.parameters
    single = is_single(recipe)
    z, size = analyzers.GRID
    pad = analyzers.PAD
    metres = analyzers.WORLD * math.cos(math.radians(lat)) / ((1 << z) * size)
    sides = (1,) if single else (0, 1)
    first = products[next(iter(products))]
    shape = first[1].shape[:2]
    core = (slice(pad, pad + size), slice(pad, pad + size))
    inside = np.zeros(shape, bool)
    inside[core] = mask.astype(bool)
    imaged = np.ones(shape, bool)
    for pair in products.values():
        for side in sides:
            imaged &= pair[side][:, :, 0] > 0
    measured = inside & imaged
    if uses_clouds(recipe):
        blocked = analyzers.weather_mask([first[side] for side in sides], [days[side] for side in sides],
                                         lat, metres, options)
        if blocked is not None:
            measured &= ~blocked
    reader = _Reader(products, recipe, metres, measured)

    passes, values, befores, afters, distances = [], [], [], [], []
    for rule in recipe.rules:
        if rule.measure == "class":
            ground = np.isin(reader.scene(0 if rule.on == "a" else 1), SCENE_CLASSES_FLAT[tuple(rule.classes)])
            passed = measured & (ground if rule.op == "is" else ~ground)
            value = before = after = None
            distance = np.where(passed, 0.0, np.nan)
        else:
            value, before, after = reader.value(rule)
            passed = measured & _passes(rule, value)
            with np.errstate(invalid="ignore"):
                distance = np.where(passed, _past(rule, value) / UNITS[rule.measure], np.nan)
        passes.append(passed)
        values.append(value)
        befores.append(before)
        afters.append(after)
        distances.append(distance)
    return Measured(recipe=recipe, shape=shape, core=core, measured=measured, imaged=imaged, passes=passes,
                    values=values, before=befores, after=afters, distances=distances)


def judge(tile: Measured, keep: Sequence[int] | None = None) -> analyzers.Reading:
    """What the rules make of a measured tile: the pixels kept, cleaned, and how far past the line.

    `keep` names the rules to put together, in place of all of them, to ask what
    the tile would have given without one.
    """
    import cv2
    import numpy as np

    recipe = tile.recipe
    options = recipe.parameters
    used = list(range(len(recipe.rules))) if keep is None else list(keep)
    passes = [tile.passes[i] for i in used]
    if recipe.match == "all":
        combined = np.logical_and.reduce(passes)
    else:
        combined = np.logical_or.reduce(passes)
    binary = tile.measured & combined
    if options.cleanup:
        kernel = np.ones((2 * options.cleanup + 1,) * 2, np.uint8)
        cleaned = cv2.morphologyEx(binary.astype(np.uint8), cv2.MORPH_OPEN, kernel,
                                   borderType=cv2.BORDER_REPLICATE)
        cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8),
                                   borderType=cv2.BORDER_REPLICATE)
        binary = cleaned.astype(bool) & tile.measured

    # A candidate's margin is how far past the line it got: the signal's, or
    # under "any" the best of whichever rules it passed. 1 is on the line. The
    # signal is the first rule that measures something.
    ranked = next((i for i in used if recipe.rules[i].measure != "class"), None)
    if recipe.match == "all":
        past = tile.distances[ranked] if ranked is not None else np.zeros(tile.shape)
    else:
        past = np.fmax.reduce(np.stack([tile.distances[i] for i in used]), axis=0)
    stat = np.where(binary, 1.0 + np.clip(np.nan_to_num(past, nan=0.0), 0.0, 20.0), 0.0).astype(np.float32)

    measures: dict[str, tuple[Any, str]] = {}
    if ranked is not None:
        rule = recipe.rules[ranked]
        clean = lambda array: np.nan_to_num(array, nan=0.0)  # noqa: E731
        if rule.on == "change" and rule.measure != "colour":
            measures = {"before": (clean(tile.before[ranked]), "mean"), "after": (clean(tile.after[ranked]), "mean"),
                        "signed": (clean(tile.values[ranked]), "mean")}
        else:
            measures = {"value": (clean(tile.values[ranked]), "mean")}

    core = tile.core
    return analyzers.Reading(binary=binary[core].astype(np.uint8), stat=stat[core], threshold=1.0,
                             measures={name: (array[core], how) for name, (array, how) in measures.items()})


def evaluation(tile: Measured, reading: analyzers.Reading) -> Evaluation:
    """A measured tile with its verdict, cropped back to the tile."""
    core = tile.core
    crop = lambda array: None if array is None else array[core]  # noqa: E731
    return Evaluation(reading=reading, passes=[crop(p) for p in tile.passes], values=[crop(v) for v in tile.values],
                      before=[crop(b) for b in tile.before], after=[crop(a) for a in tile.after],
                      measured=tile.measured[core], imaged=tile.imaged[core])


def evaluate(products: dict[str, tuple[Any, Any]], mask: Any, recipe: Recipe,
             days: tuple[str, str], lat: float) -> Evaluation:
    """One tile, judged by every rule of the recipe."""
    tile = measure(products, mask, recipe, days, lat)
    return evaluation(tile, judge(tile))


class _Classes(dict[tuple[str, ...], tuple[int, ...]]):
    """Scene codes for a set of class names, worked out once per set."""

    def __missing__(self, names: tuple[str, ...]) -> tuple[int, ...]:
        codes = tuple(code for name in names for code in SCENE_CLASSES[name])
        self[names] = codes
        return codes


SCENE_CLASSES_FLAT = _Classes()


# -- the frames a check reads ----------------------------------------------------------


def check_sources(recipe: Recipe, a: Source, b: Source) -> tuple[Source, Source]:
    """The sources a check reads, named for the satellite the rules use.

    Every pass is read whatever its cloud cover: the analyst picked it, and
    the cloud switch is what decides what counts under a cloud.
    """
    if is_radar(recipe):
        patch: dict[str, Any] = {"provider": "sentinel1", "layer": analyzers.radar_layer(), "maxcc": 100}
    else:
        patch = {"provider": "sentinel2", "layer": sentinel.DEFAULT_LAYER, "maxcc": 100, "time": ""}
    b = b.model_copy(update=patch)
    if not b.date:
        raise ValueError("choose the pass this check is read on")
    if is_single(recipe):
        return b, b
    a = a.model_copy(update=patch)
    if not a.date:
        raise ValueError("these rules read the before date as well; choose its pass")
    if a.provider == "sentinel1" and a.time and b.time and not sentinel.same_track(a.time, b.time):
        raise ValueError("the before and after passes were seen from different radar tracks; "
                         "choose two passes at the same time of day")
    return a, b


def tile_box(x: int, y: int) -> dict[str, float]:
    """A grid tile's extent in metres of the Mercator plane, where the map lays its image."""
    z, _ = analyzers.GRID
    count = 1 << z
    world = analyzers.WORLD
    return {"west": x / count * world - world / 2, "east": (x + 1) / count * world - world / 2,
            "north": world / 2 - y / count * world, "south": world / 2 - (y + 1) / count * world}


def held(source: Source, x: int, y: int, product: str) -> Any | None:
    """A product frame the tile cache holds, decoded, or None."""
    z, size = analyzers.GRID
    cache_id = analyzers.product_cache_id(source, product)
    key = (cache_id, x, y)
    with _DECODED_LOCK:
        if key in _DECODED:
            _DECODED.move_to_end(key)
            return _DECODED[key]
    cached = tilecache.get(cache_id, z, x, y)
    if not cached:
        return None
    pixels = analyzers.decode_product(cached[0], size + 2 * analyzers.PAD, product)
    with _DECODED_LOCK:
        _DECODED[key] = pixels
        while len(_DECODED) > _DECODED_MAX:
            _DECODED.popitem(last=False)
    return pixels


def missing(recipe: Recipe, a: Source, b: Source,
            tiles: list[tuple[int, int]]) -> list[tuple[Source, int, int, str]]:
    sources = [b] if is_single(recipe) else [a, b]
    z, _ = analyzers.GRID

    def have(source: Source, x: int, y: int, product: str) -> bool:
        cache_id = analyzers.product_cache_id(source, product)
        with _DECODED_LOCK:
            if (cache_id, x, y) in _DECODED:
                return True
        return tilecache.get(cache_id, z, x, y) is not None

    return [(source, x, y, product) for x, y in tiles for product in recipe_products(recipe)
            for source in sources if not have(source, x, y, product)]


def fetch(frames: list[tuple[Source, int, int, str]]) -> None:
    """Read the frames a test lacks from Copernicus into the tile cache.

    Only ever called because the analyst pressed Test. Each frame is one
    request on the Sentinel Hub meter, counted whether it succeeds or not.
    """
    if not frames:
        return
    instance = analyzers._instance()
    if config.usage_blocked("sentinelhub"):
        raise ValueError("Sentinel Hub usage limit reached; review Settings")
    z, size = analyzers.GRID
    edge = size + 2 * analyzers.PAD

    def one(frame: tuple[Source, int, int, str]) -> None:
        source, x, y, product = frame
        try:
            raw = sentinel.band_frame(instance, analyzers._box(z, x, y, analyzers.PAD), edge, edge,
                                      source.date, product, source.maxcc, layer=source.layer,
                                      time=source.time)
        finally:
            config.record_usage("sentinelhub", 1)
        tilecache.put(analyzers.product_cache_id(source, product), z, x, y, raw, "image/png")

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(one, frames))


def _measure_tile(recipe: Recipe, a: Source, b: Source, x: int, y: int) -> Measured:
    import numpy as np

    z, size = analyzers.GRID
    read: dict[str, tuple[Any, Any]] = {}
    for product in recipe_products(recipe):
        after = held(b, x, y, product)
        before = after if is_single(recipe) else held(a, x, y, product)
        if after is None or before is None:
            raise ValueError("test the check to read its frames first")
        read[product] = (before, after)
    _, lat = analyzers.geographic((x + .5) / (1 << z), (y + .5) / (1 << z))
    return measure(read, np.ones((size, size), np.uint8), recipe, (a.date, b.date), lat)


def _tile(recipe: Recipe, a: Source, b: Source, x: int, y: int) -> Evaluation:
    tile = _measure_tile(recipe, a, b, x, y)
    return evaluation(tile, judge(tile))


def _png(mask: Any) -> str:
    out = io.BytesIO()
    Image.fromarray(mask).save(out, "PNG", compress_level=6)
    return base64.b64encode(out.getvalue()).decode("ascii")


# -- checks ---------------------------------------------------------------------------------

#: How close a candidate has to come to a mark to be on it: a pixel and a half.
MARK_REACH_M = 15.0


def pixel_of(point: tuple[float, float]) -> tuple[int, int, int, int]:
    """The grid tile under a point, and the pixel of that tile the point falls on."""
    z, size = analyzers.GRID
    count = 1 << z
    gx, gy = (value * count for value in analyzers.mercator(*point))
    x, y = min(count - 1, int(gx)), min(count - 1, int(gy))
    return x, y, min(size - 1, int((gx - x) * size)), min(size - 1, int((gy - y) * size))


def check_tiles(check: Check) -> list[tuple[int, int]]:
    """The grid tiles a check reads: the ones under its marks, then the ones beside them.

    A mark is read on its own tile, so a candidate cut by the tile's edge is
    judged on the part inside it, and two halves that are each too small to
    keep would both be lost. A mark within EDGE_PX of an edge therefore reads
    the tile across it as well, and the seam is joined the way a sweep joins it.
    """
    if not check.marks:
        raise ValueError("drop a pin on the ground this check should read")
    z, size = analyzers.GRID
    count = 1 << z
    edge = EDGE_PX / size
    under: list[tuple[int, int]] = []
    beside: list[tuple[int, int]] = []
    for mark in check.marks:
        gx, gy = (value * count for value in analyzers.mercator(*mark.point))
        x, y = min(count - 1, int(gx)), min(count - 1, int(gy))
        if (x, y) not in under:
            under.append((x, y))
        dx = -1 if gx - x < edge else 1 if gx - x > 1 - edge else 0
        dy = -1 if gy - y < edge else 1 if gy - y > 1 - edge else 0
        for step in ((dx, 0), (0, dy), (dx, dy)):
            tile = (x + step[0], y + step[1])
            if step != (0, 0) and 0 <= tile[0] < count and 0 <= tile[1] < count and tile not in beside:
                beside.append(tile)
    tiles = under + [tile for tile in beside if tile not in under]
    if len(tiles) > MAX_CHECK_TILES:
        raise ValueError(f"these pins reach {len(tiles)} tiles and a check reads at most {MAX_CHECK_TILES}: "
                         "keep the pins of one place in a check and start another for ground further away")
    return tiles


def _satellite(recipe: Recipe, check: Check) -> None:
    if check.b.provider != recipe_sensor(recipe):
        seen = "radar" if check.b.provider == "sentinel1" else "Sentinel-2"
        raise ValueError(f"this check was saved on {seen} passes; save it again on passes these rules read")


def plan(recipe: Recipe, check: Check) -> dict[str, int]:
    """What testing a check would read: its tiles, and how many frames the cache lacks.

    Each missing frame is one request on the Sentinel Hub meter, so this is
    what the Test button says before it is pressed. Nothing is fetched.
    """
    _satellite(recipe, check)
    a, b = check_sources(recipe, check.a, check.b)
    tiles = check_tiles(check)
    return {"tiles": len(tiles), "missing": len(missing(recipe, a, b, tiles))}


def _reading(recipe: Recipe, evaluation: Evaluation, px: int, py: int) -> dict[str, Any]:
    """What every rule read at one pixel of a tile, and whether it passed."""
    import numpy as np

    def number(array: Any) -> float | None:
        if array is None:
            return None
        value = float(array[py, px])
        return round(value, 4) if np.isfinite(value) else None

    return {"imaged": bool(evaluation.imaged[py, px]), "measured": bool(evaluation.measured[py, px]),
            "kept": bool(evaluation.reading.binary[py, px]),
            "rules": [{"passes": bool(evaluation.passes[i][py, px]), "value": number(evaluation.values[i]),
                       "before": number(evaluation.before[i]), "after": number(evaluation.after[i])}
                      for i in range(len(recipe.rules))]}


#: Steps a rule's value is quantised to on its way to the browser. Sixteen bits
#: across the span actually measured puts the rounding orders of magnitude below
#: any line an analyst can set, so the ground the browser paints while the slider
#: moves is the ground the next test will keep, not an approximation of it.
VALUE_STEPS = 65535


def _value_png(values: Any, seen: Any, low: float, span: float) -> str:
    """One rule's reading over a tile, as a PNG the browser can read exactly.

    Sixteen bits split over two channels, because a canvas hands back eight-bit
    RGBA whatever the file held: a 16-bit greyscale PNG would be truncated on
    the way in and the line would land in the wrong place.
    """
    import numpy as np

    scaled = (np.nan_to_num(values, nan=0.0, posinf=0.0, neginf=0.0) - low) / span
    steps = np.clip(np.rint(scaled * VALUE_STEPS), 0, VALUE_STEPS).astype(np.uint16)
    # Unmeasured ground carries no reading; the browser has the measured bit and
    # leaves it alone, so what sits here only has to be defined.
    steps = np.where(seen, steps, 0).astype(np.uint16)
    rgb = np.dstack([(steps >> 8).astype(np.uint8), (steps & 0xFF).astype(np.uint8),
                     np.zeros(steps.shape, np.uint8)])
    out = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(out, "PNG", compress_level=6)
    return base64.b64encode(out.getvalue()).decode("ascii")


def rule_values(recipe: Recipe, check: Check, index: int) -> dict[str, Any]:
    """What one rule read at every pixel of a tested check's ground.

    A test sends a verdict: the ground each rule kept. That answers whether the
    line is crossed, never where it should be. This sends the quantity itself,
    so the line can be moved and the ground repainted without asking again — the
    reading is the same one the test made, and the browser applies the same
    comparison (`_passes`) to it.

    One rule at a time, and only when asked: every rule of every tile at once
    would be tens of megabytes on a press nobody made. Never fetches — a check
    whose frames are not cached is tested first.
    """
    import numpy as np

    _satellite(recipe, check)
    if not 0 <= index < len(recipe.rules):
        raise ValueError("no such rule")
    if recipe.rules[index].measure == "class":
        raise ValueError("a ground class is a classification, not a quantity with a line")
    a, b = check_sources(recipe, check.a, check.b)
    tiles = check_tiles(check)
    lacking = missing(recipe, a, b, tiles)
    if lacking:
        return {"ready": False, "missing": len(lacking)}

    read = {tile: _measure_tile(recipe, a, b, *tile) for tile in tiles}
    cropped = {}
    for tile, measured in read.items():
        core = measured.core
        values = measured.values[index]
        if values is None:
            raise ValueError("that rule reads no quantity")
        cropped[tile] = (values[core], measured.measured[core] & np.isfinite(values[core]))

    # One span over the whole ground, so a value means the same on every tile.
    seen = [values[ok] for values, ok in cropped.values() if ok.any()]
    low = float(min(part.min() for part in seen)) if seen else 0.0
    high = float(max(part.max() for part in seen)) if seen else 0.0
    span = high - low or 1.0

    _, size = analyzers.GRID
    return {"ready": True, "missing": 0, "size": size, "rule": index,
            "low": round(low, 6), "high": round(low + span, 6), "steps": VALUE_STEPS,
            "tiles": [{"x": x, "y": y, "box": tile_box(x, y),
                       "values": _value_png(cropped[(x, y)][0], cropped[(x, y)][1], low, span)}
                      for x, y in tiles]}


def probe(recipe: Recipe, check: Check, point: tuple[float, float]) -> dict[str, Any]:
    """What every rule read at one point of the ground a check was tested on."""
    a, b = check_sources(recipe, check.a, check.b)
    x, y, px, py = pixel_of(point)
    if missing(recipe, a, b, [(x, y)]):
        return {"ready": False}
    return {"ready": True, **_reading(recipe, _tile(recipe, a, b, x, y), px, py)}


def _detail(recipe: Recipe, check: Check, tiles: list[tuple[int, int]],
            evaluations: dict[tuple[int, int], Evaluation], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    """What the map draws of a test: each tile's mask, the candidates, and every pin's reading."""
    import numpy as np

    _, size = analyzers.GRID
    measured_total = kept_total = 0
    own = [0] * len(recipe.rules)
    running = [0] * len(recipe.rules)
    grid: list[dict[str, Any]] = []
    for x, y in tiles:
        evaluation = evaluations[(x, y)]
        bits = evaluation.measured.astype(np.uint8) << MEASURED_BIT
        bits |= evaluation.reading.binary.astype(np.uint8) << KEPT_BIT
        so_far = None
        for i, passed in enumerate(evaluation.passes):
            bits |= passed.astype(np.uint8) << i
            own[i] += int(passed.sum())
            so_far = passed if so_far is None else (so_far & passed if recipe.match == "all" else so_far | passed)
            running[i] += int(so_far.sum())
        measured_total += int(evaluation.measured.sum())
        kept_total += int(evaluation.reading.binary.sum())
        grid.append({"x": x, "y": y, "box": tile_box(x, y), "mask": _png(bits)})
    share = lambda value: round(value / measured_total, 5) if measured_total else 0.0  # noqa: E731
    readings = []
    for mark in check.marks:
        x, y, px, py = pixel_of(mark.point)
        readings.append(_reading(recipe, evaluations[(x, y)], px, py))
    return {"size": size, "tiles": grid,
            "measured": round(measured_total / (len(tiles) * size * size), 5),
            "rules": [{"share": share(own[i]), "kept": share(running[i])} for i in range(len(recipe.rules))],
            "kept": share(kept_total), "readings": readings,
            "candidates": [{key: value for key, value in row.items() if key != "parts"}
                           for row in candidates[:TEST_CANDIDATES]]}


def _candidates_of(recipe: Recipe, tiles: list[tuple[int, int]],
                   readings: dict[tuple[int, int], analyzers.Reading]) -> list[dict[str, Any]]:
    """What a run of the recipe would return over these tiles: outlined, joined across seams, sized."""
    rows: list[dict[str, Any]] = []
    for part, tile in enumerate(tiles):
        rows.extend(analyzers._candidates(readings[tile], recipe.phenomenon, tile[0], tile[1], part, []))
    options = recipe.parameters
    return [row for row in analyzers.merge(rows, options.merge_metres) if analyzers.keeps(row, options)]


def _covered(check: Check, candidates: list[dict[str, Any]]) -> list[bool]:
    return [any(analysis_geometry.near(row["geometry"], mark.point, MARK_REACH_M) for row in candidates)
            for mark in check.marks]


def _without(recipe: Recipe, check: Check, tiles: list[tuple[int, int]],
             measured: dict[tuple[int, int], Measured], skip: int) -> list[bool]:
    """Whether each mark would be on a candidate if the recipe had not had one rule.

    The rules were read once; only what they make of it is done again.
    """
    keep = [i for i in range(len(recipe.rules)) if i != skip]
    try:
        readings = {tile: judge(measured[tile], keep) for tile in tiles}
        return _covered(check, _candidates_of(recipe, tiles, readings))
    except ValueError:
        # So many fragments that a run would refuse them: without this rule everything is flagged.
        return [True] * len(check.marks)


def check(recipe: Recipe, check: Check, *, read: bool = False, detail: bool = False) -> dict[str, Any]:
    """A check tested with the recipe as it stands: what came out on each mark.

    It reads the tile cache, and `read` fetches the frames it lacks. `covered`
    says, mark by mark, whether a candidate a run would return comes within
    MARK_REACH_M of it; `count` is how many came out. `detail` adds what the
    map draws: each tile's mask, the candidates and what every rule read at
    every mark, and with several rules what the marks would have come to
    without each one (`without`), which is how an analyst sees which rules help.
    """
    _satellite(recipe, check)
    a, b = check_sources(recipe, check.a, check.b)
    tiles = check_tiles(check)
    lacking = missing(recipe, a, b, tiles)
    if lacking and read:
        fetch(lacking)
        lacking = missing(recipe, a, b, tiles)
    if lacking:
        return {"ready": False, "missing": len(lacking)}
    measured = {tile: _measure_tile(recipe, a, b, *tile) for tile in tiles}
    evaluations = {tile: evaluation(measured[tile], judge(measured[tile])) for tile in tiles}
    candidates = _candidates_of(recipe, tiles, {tile: evaluations[tile].reading for tile in tiles})
    answer: dict[str, Any] = {"ready": True, "missing": 0, "count": len(candidates), "covered": _covered(check, candidates)}
    if detail:
        candidates.sort(key=lambda row: row["margin"], reverse=True)
        answer.update(_detail(recipe, check, tiles, evaluations, candidates))
        if len(recipe.rules) > 1:
            answer["without"] = [{"covered": _without(recipe, check, tiles, measured, skip)}
                                 for skip in range(len(recipe.rules))]
    return answer


# -- built-ins as rules --------------------------------------------------------------


def index_as_rules(recipe: Recipe) -> dict[str, Any] | None:
    """A built-in index detector written out as the rules it applies.

    The line is the one its sensitivity sets, and the states either side are
    the ones the engine requires of a loss or a gain (`INDEX_STATES`). The
    copy starts from the same reading; it grows regions pixel by pixel rather
    than from the strongest ones out, so it can outline a little less.
    """
    if recipe.method != "index":
        return None
    parameters = recipe.parameters
    index = parameters.index
    line = round(analyzers._scale(parameters.sensitivity, 0.05, 0.5), 2)
    absent, present = analyzers.INDEX_STATES[index]
    at = lambda on, op, value: Rule(measure="index", index=index, on=on, op=op, value=value)  # noqa: E731
    dark = lambda on: Rule(measure="band", band="B08", on=on, op="le",  # noqa: E731
                           value=sentinel.DARK_REFLECTANCE)
    if parameters.direction == "loss":
        rules = [at("change", "le", -line), at("a", "ge", present), at("b", "le", absent)]
        if index in analyzers.DARK_ABSENT:
            rules.append(dark("b"))
    elif parameters.direction == "gain":
        rules = [at("change", "ge", line), at("b", "ge", present), at("a", "le", absent)]
        if index in analyzers.DARK_ABSENT:
            rules.append(dark("a"))
    else:
        rules = [at("change", "moved", line)]
    return Recipe(name=f"{recipe.name} (rules)", description=recipe.description,
                  phenomenon=recipe.phenomenon, method="rules", colour=recipe.colour,
                  style=recipe.style, parameters=parameters, rules=rules).model_dump()
