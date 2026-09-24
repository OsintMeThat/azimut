"""Analyzers made of the analyst's own rules, and the preview that tunes them.

A built-in detector is a method calibrated on real scenes (engine/analyzers.py).
An analyzer of your own is a list of rules instead: a quantity read from
Sentinel-2's bands or Sentinel-1's backscatter, on one date or as the change
between two, and the line it has to cross. Nothing here is calibrated. The
line the analyst sets is the line that runs.

The preview runs `evaluate` on the frames a sweep would read, over the ground
on screen, and hands back what each rule kept, so the builder shows what a run
of the same analyzer returns there: the same rules, cleanup, sizes, shape and
grouping. A check reruns the same evaluation on a place the analyst saved,
and says whether a candidate came out on each point they marked. Both read the
tile cache only. Fetching the frames they lack is a separate act, which the
analyst asks for and which is metered like any other.
"""

from __future__ import annotations

import base64
import io
import math
import threading
from collections import OrderedDict
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
#: The preview's reach: three tiles by three around the view, about 15 km on a
#: side at the equator and 10 at 45°. Past that the frames it needs to read
#: stop being a figure an analyst glances at.
PREVIEW_SPAN = 3
PREVIEW_CANDIDATES = 300
#: Bits of the preview mask. Rules take the low ones in order.
MEASURED_BIT = 6
KEPT_BIT = 7

# Decoded frames the preview has read lately, so moving a slider re-reads
# nothing from disk. A frame is 2.6 MB decoded; this holds a full preview of two
# dates with room to spare.
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


def signal(recipe: Recipe) -> int | None:
    """The rule that ranks candidates: the first one that measures something."""
    return next((i for i, rule in enumerate(recipe.rules) if rule.measure != "class"), None)


def evaluate(products: dict[str, tuple[Any, Any]], mask: Any, recipe: Recipe,
             days: tuple[str, str], lat: float) -> Evaluation:
    """One tile, judged by every rule of the recipe.

    `products` names each band product with its (A, B) frames, padded by
    `analyzers.PAD`; an analyzer that reads one date passes B twice. `mask`
    is the tile's own ground to judge, unpadded.
    """
    import cv2
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

    if recipe.match == "all":
        combined = np.logical_and.reduce(passes)
    else:
        combined = np.logical_or.reduce(passes)
    binary = measured & combined
    if options.cleanup:
        kernel = np.ones((2 * options.cleanup + 1,) * 2, np.uint8)
        cleaned = cv2.morphologyEx(binary.astype(np.uint8), cv2.MORPH_OPEN, kernel,
                                   borderType=cv2.BORDER_REPLICATE)
        cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8),
                                   borderType=cv2.BORDER_REPLICATE)
        binary = cleaned.astype(bool) & measured

    # A candidate's margin is how far past the line it got: the signal's, or
    # under "any" the best of whichever rules it passed. 1 is on the line.
    ranked = signal(recipe)
    if recipe.match == "all":
        past = distances[ranked] if ranked is not None else np.zeros(shape)
    else:
        past = np.fmax.reduce(np.stack(distances), axis=0)
    stat = np.where(binary, 1.0 + np.clip(np.nan_to_num(past, nan=0.0), 0.0, 20.0), 0.0).astype(np.float32)

    measures: dict[str, tuple[Any, str]] = {}
    if ranked is not None:
        rule = recipe.rules[ranked]
        clean = lambda array: np.nan_to_num(array, nan=0.0)  # noqa: E731
        if rule.on == "change" and rule.measure != "colour":
            measures = {"before": (clean(befores[ranked]), "mean"), "after": (clean(afters[ranked]), "mean"),
                        "signed": (clean(values[ranked]), "mean")}
        else:
            measures = {"value": (clean(values[ranked]), "mean")}

    crop = lambda array: None if array is None else array[core]  # noqa: E731
    reading = analyzers.Reading(binary=binary[core].astype(np.uint8), stat=stat[core], threshold=1.0,
                                measures={name: (array[core], how) for name, (array, how) in measures.items()})
    return Evaluation(reading=reading, passes=[crop(p) for p in passes], values=[crop(v) for v in values],
                      before=[crop(b) for b in befores], after=[crop(a) for a in afters],
                      measured=measured[core], imaged=imaged[core])


class _Classes(dict[tuple[str, ...], tuple[int, ...]]):
    """Scene codes for a set of class names, worked out once per set."""

    def __missing__(self, names: tuple[str, ...]) -> tuple[int, ...]:
        codes = tuple(code for name in names for code in SCENE_CLASSES[name])
        self[names] = codes
        return codes


SCENE_CLASSES_FLAT = _Classes()


# -- the preview ---------------------------------------------------------------------


def preview_sources(recipe: Recipe, a: Source, b: Source) -> tuple[Source, Source]:
    """The sources a preview reads, named for the satellite the rules use.

    Every pass is read whatever its cloud cover: the analyst picked it, and
    the cloud switch is what decides what counts under a cloud.
    """
    if is_radar(recipe):
        patch: dict[str, Any] = {"provider": "sentinel1", "layer": analyzers.radar_layer(), "maxcc": 100}
    else:
        patch = {"provider": "sentinel2", "layer": sentinel.DEFAULT_LAYER, "maxcc": 100, "time": ""}
    b = b.model_copy(update=patch)
    if not b.date:
        raise ValueError("choose the pass to preview on")
    if is_single(recipe):
        return b, b
    a = a.model_copy(update=patch)
    if not a.date:
        raise ValueError("these rules read A as well; choose a reference pass")
    if a.provider == "sentinel1" and a.time and b.time and not sentinel.same_track(a.time, b.time):
        raise ValueError("A and B were seen from different radar tracks; choose two passes at the same time of day")
    return a, b


def preview_tiles(bounds: tuple[float, float, float, float]) -> tuple[list[tuple[int, int]], bool]:
    """The grid tiles under a view, at most PREVIEW_SPAN a side around its centre."""
    west, south, east, north = bounds
    if west >= east or south >= north:
        raise ValueError("move the view off the antimeridian to preview it")
    z, _ = analyzers.GRID
    count = 1 << z
    left, top = analyzers.mercator(west, north)
    right, bottom = analyzers.mercator(east, south)

    def span(low: float, high: float) -> tuple[list[int], bool]:
        first = max(0, math.floor(low * count))
        last = min(count - 1, max(first, math.ceil(high * count) - 1))
        if last - first + 1 <= PREVIEW_SPAN:
            return list(range(first, last + 1)), False
        middle = (first + last) // 2
        return list(range(middle - PREVIEW_SPAN // 2, middle - PREVIEW_SPAN // 2 + PREVIEW_SPAN)), True

    columns, wide = span(left, right)
    rows, tall = span(top, bottom)
    return [(x, y) for y in rows for x in columns], wide or tall


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
    """Read the frames a preview lacks from Copernicus into the tile cache.

    Only ever called because the analyst pressed Read. Each frame is one
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


def _tile(recipe: Recipe, a: Source, b: Source, x: int, y: int) -> Evaluation:
    import numpy as np

    z, size = analyzers.GRID
    read: dict[str, tuple[Any, Any]] = {}
    for product in recipe_products(recipe):
        after = held(b, x, y, product)
        before = after if is_single(recipe) else held(a, x, y, product)
        if after is None or before is None:
            raise ValueError("read this view's frames first")
        read[product] = (before, after)
    _, lat = analyzers.geographic((x + .5) / (1 << z), (y + .5) / (1 << z))
    return evaluate(read, np.ones((size, size), np.uint8), recipe, (a.date, b.date), lat)


def _png(mask: Any) -> str:
    out = io.BytesIO()
    Image.fromarray(mask).save(out, "PNG", compress_level=6)
    return base64.b64encode(out.getvalue()).decode("ascii")


def preview(recipe: Recipe, a: Source, b: Source, bounds: tuple[float, float, float, float],
            *, read: bool = False) -> dict[str, Any]:
    """What the recipe keeps over the view, and what each rule kept on the way.

    Every tile whose frames are held is judged, so a view that is half read
    still shows its half; `missing` counts the frames the rest lacks. Without
    `read` nothing reaches the network, and the answer says how many requests
    would fetch them.
    """
    import numpy as np

    a, b = preview_sources(recipe, a, b)
    tiles, clipped = preview_tiles(bounds)
    z, size = analyzers.GRID
    count = 1 << z
    lacking = missing(recipe, a, b, tiles)
    if lacking and read:
        fetch(lacking)
        lacking = missing(recipe, a, b, tiles)
    xs = sorted({x for x, _ in tiles})
    ys = sorted({y for _, y in tiles})
    world = analyzers.WORLD
    answer: dict[str, Any] = {
        "tiles": [list(tile) for tile in tiles], "clipped": clipped, "missing": len(lacking),
        "box": {"west": xs[0] / count * world - world / 2, "east": (xs[-1] + 1) / count * world - world / 2,
                "north": world / 2 - ys[0] / count * world, "south": world / 2 - (ys[-1] + 1) / count * world},
        "size": [len(xs) * size, len(ys) * size], "ready": False,
    }
    unread = {(x, y) for _, x, y, _ in lacking}
    judged = [tile for tile in tiles if tile not in unread]
    if not judged:
        return answer

    options = recipe.parameters
    mosaic = np.zeros((len(ys) * size, len(xs) * size), np.uint8)
    measured_total = 0
    own = [0] * len(recipe.rules)
    running = [0] * len(recipe.rules)
    kept_total = 0
    rows: list[dict[str, Any]] = []
    note = ""
    for part, (x, y) in enumerate(judged):
        evaluation = _tile(recipe, a, b, x, y)
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
        top, left = ys.index(y) * size, xs.index(x) * size
        mosaic[top:top + size, left:left + size] = bits
        if not note:
            try:
                rows.extend(analyzers._candidates(evaluation.reading, recipe.phenomenon, x, y, part, []))
            except ValueError as exc:
                note, rows = str(exc), []
    candidates = [row for row in analyzers.merge(rows, options.merge_metres) if analyzers.keeps(row, options)]
    candidates.sort(key=lambda row: row["margin"], reverse=True)
    share = lambda value: round(value / measured_total, 5) if measured_total else 0.0  # noqa: E731
    return {**answer, "ready": True, "mask": _png(mosaic),
            "measured": round(measured_total / (len(judged) * size * size), 5),
            "rules": [{"share": share(own[i]), "kept": share(running[i])} for i in range(len(recipe.rules))],
            "kept": share(kept_total), "count": len(candidates), "note": note,
            "candidates": [{key: value for key, value in row.items() if key != "parts"}
                           for row in candidates[:PREVIEW_CANDIDATES]]}


def probe(recipe: Recipe, a: Source, b: Source, point: tuple[float, float]) -> dict[str, Any]:
    """What every rule read at one point of the preview, and whether it passed."""
    import numpy as np

    a, b = preview_sources(recipe, a, b)
    z, size = analyzers.GRID
    count = 1 << z
    gx, gy = analyzers.mercator(*point)
    x, y = int(gx * count), int(gy * count)
    if missing(recipe, a, b, [(x, y)]):
        return {"ready": False}
    evaluation = _tile(recipe, a, b, x, y)
    px = min(size - 1, int((gx * count - x) * size))
    py = min(size - 1, int((gy * count - y) * size))

    def number(array: Any) -> float | None:
        if array is None:
            return None
        value = float(array[py, px])
        return round(value, 4) if np.isfinite(value) else None

    return {"ready": True, "imaged": bool(evaluation.imaged[py, px]),
            "measured": bool(evaluation.measured[py, px]),
            "kept": bool(evaluation.reading.binary[py, px]),
            "rules": [{"passes": bool(evaluation.passes[i][py, px]), "value": number(evaluation.values[i]),
                       "before": number(evaluation.before[i]), "after": number(evaluation.after[i])}
                      for i in range(len(recipe.rules))]}


# -- checks --------------------------------------------------------------------------

#: How close a candidate has to come to a mark to be on it: a pixel and a half.
MARK_REACH_M = 15.0


def check_tiles(check: Check) -> list[tuple[int, int]]:
    """The grid tiles a check reads: the ones under its marks, else its view's.

    A mark is read on its own tile, so a candidate cut by that tile's edge is
    judged on the part inside it. Marks are best placed away from an edge.
    """
    if not check.marks:
        bounds = check.bounds
        return preview_tiles((bounds.west, bounds.south, bounds.east, bounds.north))[0]
    z, _ = analyzers.GRID
    count = 1 << z
    tiles: list[tuple[int, int]] = []
    for mark in check.marks:
        gx, gy = analyzers.mercator(*mark.point)
        tile = (int(gx * count), int(gy * count))
        if tile not in tiles:
            tiles.append(tile)
    return tiles


def check(recipe: Recipe, check: Check, *, read: bool = False) -> dict[str, Any]:
    """A check rerun with the recipe as it stands: what came out on each mark.

    It reads the tile cache, as the preview does, and `read` fetches the frames
    it lacks. `covered` says, mark by mark, whether a candidate a run would
    return comes within MARK_REACH_M of it; `count` is how many came out.
    """
    if check.b.provider != recipe_sensor(recipe):
        seen = "radar" if check.b.provider == "sentinel1" else "Sentinel-2"
        raise ValueError(f"this check was saved on {seen} passes; save it again on passes these rules read")
    a, b = preview_sources(recipe, check.a, check.b)
    tiles = check_tiles(check)
    lacking = missing(recipe, a, b, tiles)
    if lacking and read:
        fetch(lacking)
        lacking = missing(recipe, a, b, tiles)
    if lacking:
        return {"ready": False, "missing": len(lacking)}
    rows: list[dict[str, Any]] = []
    for part, (x, y) in enumerate(tiles):
        evaluation = _tile(recipe, a, b, x, y)
        rows.extend(analyzers._candidates(evaluation.reading, recipe.phenomenon, x, y, part, []))
    options = recipe.parameters
    candidates = [row for row in analyzers.merge(rows, options.merge_metres) if analyzers.keeps(row, options)]
    covered = [any(analysis_geometry.near(row["geometry"], mark.point, MARK_REACH_M) for row in candidates)
               for mark in check.marks]
    return {"ready": True, "missing": 0, "count": len(candidates), "covered": covered}


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
