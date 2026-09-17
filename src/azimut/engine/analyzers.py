"""Bounded, explicit, local analysis runs over fixed geographic tile grids.

Source frames are owned evidence, not an expiring map cache. Completed runs
never change when their recipe, area, camera or provider catalogue changes.

Every detector here reads Copernicus Sentinel-2 band products. Their thresholds
were set against real scenes, not synthetic ones: sea under glint and in rough
weather (Bab-el-Mandeb), a dense anchorage under cumulus (Singapore Strait),
wakes (Gibraltar), empty calm sea (Dover Strait), flares and an oil fire
(Rumaila), active wildfires (California, Cerrado), bright industrial roofs
(Jebel Ali), a construction site across seven months (Egypt's new capital),
dry-season clearing (Rondônia) and irrigated desert. The numbers below say what
each of them taught.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import secrets
import threading
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from PIL import Image

from .. import config, layout
from ..workspace import Case
from . import media, sentinel, tilecache, tiles, workqueue
from .analysis_models import (
    CLOUD_METHODS,
    SINGLE_METHODS,
    Parameters,
    RunInput,
    Source,
    Zone,
    product_for,
)

# What one run may sweep. The ceiling is not memory — tiles are read one at a
# time — it is the permanent copy of every tile read, which `prune_frames`
# drops for tiles that found nothing. What is left to bound is the provider's
# own metering and the analyst's patience, and both of those the panel states
# before the run starts and the cancel button ends after.
#
# At Sentinel's 4.89 km tile that is 313 km on a side.
MAX_TILES = 4096
MAX_RESULTS = 2000
MAX_FRAME_BYTES = 8_000_000
# Sentinel's 512px WMTS tiles use grid level 13 (view level 14), which lands on
# 9.55 m/px at the equator: the sensor's own resolution. The panel reads this to
# say what a run will cost before it starts, so it is published, not copied.
GRID = (13, 512)
# Band products are read with this much of the neighbouring tiles around them.
# Without it a ship's background ring, a coastline and a cloud's edge all stop
# at the tile's border, and whatever lies on it is judged on half the evidence.
# 32 px is 306 m, which covers the ring. It costs 27% more pixels per product.
PAD = 32
# Bumped when a product's layout changes, so a frame kept from an older run is
# never decoded as a newer one.
PRODUCT_VERSION = 2
ENGINE_VERSION = 2
LOCK = threading.RLock()
KINDS = {"zones": "analysis-zones", "followups": "analysis-follow-up", "runs": "analysis-run"}
ACTIVE = {"queued", "running"}
JOB = "compare-analyzer"
WORLD = 40_075_016.68557849
# How far back an automatic date rule looks for its latest usable pass.
LOOKBACK_DAYS = 90
# Coverage at or above this counts as covering the whole area. It is not 1.0
# because coverage is measured by sampling, and a ring's own edge lands a point
# or two outside the granule that in truth reaches it.
FULL_COVER = 0.98

# --- Sky ------------------------------------------------------------------
# Sentinel-2's scene classes, as the products carry them.
SCL_DEFECTIVE, SCL_SHADOW, SCL_WATER, SCL_SNOW = 1, 3, 6, 11
CLOUD_CORE = (8, 9, 10)
# "Unclassified or low-probability cloud". Alone it is too timid to trust; next
# to a real cloud it is that cloud's thin edge or the veil around it.
CLOUD_EDGE = (7, 8, 9, 10)
# A classified cloud smaller than this is not one. Sen2Cor calls white hulls
# and bright roofs cloud all the time — in the Singapore anchorage it masked
# the very tankers the sweep was for — and no cumulus worth masking is under 5 ha.
MIN_CLOUD_M2 = 50_000
# Shadows the classification misses are found where they must be: the cloud's
# own outline moved away from the sun by its height times the tangent of the
# sun's zenith, on pixels dark enough to be shaded. Heights span low cumulus to
# mid-level cloud.
CLOUD_HEIGHTS = (200.0, 5000.0)
MAX_SHADOW_M = 4000.0
# Sen2Cor reads a deep cloud shadow as water: under the cumulus over the
# Kakhovka reservoir bed it called a fifth of the land water, and the cast
# shadow, which spares water, found none of it. Where a second date is there to
# ask, water is only water when both dates say so.
# The largest global shift between two dates still read as light rather than
# change. Atmospheric correction leaves 2-3% between passes over the same
# desert; a burn that covers most of a tile moves the median by 10%, and
# subtracting that would erase it.
MAX_SHIFT = 0.03

# --- Vessels ---------------------------------------------------------------
# A pixel on the analysis grid is 9.55 m across, so the ring the background is
# measured over spans 583 m of sea, and the hole punched in its middle is 105 m —
# wider than all but the largest hulls, which is what stops a ship from quietly
# raising its own background.
VESSEL_RING = 61
VESSEL_GUARD = 11
# The ring has to be mostly sea for its statistics to mean anything.
VESSEL_WATER_SHARE = 0.5
# A target has to beat its sea by this much reflectance in both bands as well as
# in deviations: over glassy water one deviation is a rounding step.
VESSEL_EXCESS = 0.01
# Non-water this big is land, and a candidate touching it is a coastline or an
# island. The largest ship in the calibration scenes was 1.3 ha of non-water.
LAND_M2 = 50_000

# --- Hotspots ----------------------------------------------------------------
# Below this short-wave reflectance there is no fire to discuss, whatever the
# band ratios say. It is the floor of the published test (Murphy et al. 2016).
HOTSPOT_FLOOR = 0.15

# --- Change -------------------------------------------------------------------
# Construction is ground that brightened or darkened in every band; a field
# that greened moved red and near-infrared in opposite directions. Past this
# NDVI change it is vegetation, and not what this method is for.
STRUCTURE_NDVI = 0.1
# A spot is isolated when at most this share of a neighbourhood four times its
# largest size changed. A spot that size fills a sixteenth of it; the corner of
# a field that changed fills a quarter, and its edge half.
SPOT_SHARE = 0.15
# The background around a spot is read from a ring this many times the target's
# width, with a hole of its own punched in the middle: wide enough that the
# target cannot sit in its own background, narrow enough to stay local.
SPOT_GUARD = 4.0
SPOT_RING = 8.0
# Where each index reads "absent" and "present". A loss has to cross from one to
# the other, and so does a gain the other way: a drop that stays green is a
# dry season, not a clearing. Rondônia's pastures fall from 0.52 to 0.09 in
# burn ratio between June and September without a fire, and a burn ends below
# zero. The water indices cross zero; vegetation crosses from 0.4 to 0.3.
INDEX_STATES = {"ndvi": (0.3, 0.4), "ndwi": (0.0, 0.1), "mndwi": (0.0, 0.1),
                "nbr": (0.0, 0.05), "ndbi": (-0.05, 0.0), "bsi": (-0.05, 0.0)}
# A region grows from its strongest pixels out to this share of the threshold.
# Half joined whole neighbourhoods across a season's change in light.
GROW = 0.7
# Dry soil has a negative burn ratio too. What it does not have is char's
# darkness: burns in California and the Cerrado ended at 12% near-infrared, the
# dried pastures and bare lots at 21% or more. So a burn has to end dark.
DARK_ABSENT = frozenset({"nbr"})


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def relpath(kind: str, ident: str) -> str:
    if kind not in KINDS or not ident or any(c not in "0123456789abcdef" for c in ident):
        raise ValueError("unknown analysis item")
    if len(ident) != 12:
        raise ValueError("unknown analysis item")
    return f"{layout.ANALYSIS_DIR}/{kind}-{ident}.json"


def read(case: Case, kind: str, ident: str) -> dict[str, Any]:
    path = case.resolve_inside(relpath(kind, ident))
    if path.stat().st_size > 16_000_000:
        raise ValueError("analysis record is too large")
    return json.loads(path.read_text(encoding="utf-8"))


def listing(case: Case, kind: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in case.subdir(layout.ANALYSIS_DIR).glob(f"{kind}-*.json"):
        try:
            saved = read(case, kind, path.stem.split("-", 1)[1])
            rows.append({key: saved[key] for key in
                         ("id", "title", "created_at", "updated_at", "status", "progress", "count")
                         if key in saved})
        except (OSError, ValueError, KeyError):
            continue
    return sorted(rows, key=lambda row: row["created_at"], reverse=True)


def save(case: Case, kind: str, data: dict[str, Any], ident: str | None = None) -> dict[str, Any]:
    with LOCK, case._lock:
        if ident:
            old = read(case, kind, ident)
        else:
            ident = secrets.token_hex(6)
            old = {}
        rel = relpath(kind, ident)
        saved = {**data, "id": ident, "created_at": old.get("created_at", now()),
                 "updated_at": now(), "version": 1}
        path = case.resolve_inside(rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        media.write_json_atomic(path, saved)
        entity = case.find_entity(attr="spec", value=rel)
        if entity:
            case.update_entity(entity["id"], {"label": saved["title"]})
        else:
            case.add_entity(KINDS[kind], saved["title"], attrs={"spec": rel}, by="compare")
        return saved


def persist_run(case: Case, saved: dict[str, Any]) -> None:
    # The worker holds the same case lock as deletion: a removed entity cannot
    # be resurrected by a late progress write or a late network response.
    with LOCK, case._lock:
        rel = relpath("runs", saved["id"])
        if not case.find_entity(attr="spec", value=rel):
            raise workqueue.JobCancelled()
        current = read(case, "runs", saved["id"])
        if current["status"] == "cancelled":
            raise workqueue.JobCancelled()
        saved["updated_at"] = now()
        media.write_json_atomic(case.resolve_inside(rel), saved)


def mercator(lon: float, lat: float) -> tuple[float, float]:
    return ((lon + 180) / 360, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2)


def geographic(x: float, y: float) -> tuple[float, float]:
    return (x * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y)))))


def plan(body: RunInput) -> list[tuple[int, int]]:
    import cv2
    import numpy as np

    z, size = GRID
    count = 1 << z
    found: set[tuple[int, int]] = set()
    # One scratch mask for the whole plan: a large area visits tens of
    # thousands of boxes, and allocating a fresh one per box is the difference
    # between planning in a second and planning in a minute.
    mask = np.zeros((size, size), np.uint8)
    for zone in body.zones:
        ring = [mercator(*point) for point in zone.ring()]
        xs, ys = zip(*ring)
        left, right = math.floor(min(xs) * count), math.ceil(max(xs) * count) - 1
        top, bottom = math.floor(min(ys) * count), math.ceil(max(ys) * count) - 1
        # Bound even a thin polygon's enumeration before visiting its boxes.
        if (right - left + 1) * (bottom - top + 1) > MAX_TILES * 8:
            raise ValueError("area too large at native resolution; split it into smaller runs")
        for y in range(max(0, top), min(count - 1, bottom) + 1):
            for x in range(max(0, left), min(count - 1, right) + 1):
                pixels = np.array([[(px * count - x) * size, (py * count - y) * size]
                                   for px, py in ring], dtype=np.int32)
                mask[:] = 0
                cv2.fillPoly(mask, [pixels], 1)
                if mask.any():
                    found.add((x, y))
                if len(found) > MAX_TILES:
                    raise ValueError(f"area needs more than {MAX_TILES} tiles; use smaller zones")
    if not found:
        raise ValueError("the areas contain no pixels at this resolution")
    return sorted(found, key=lambda pair: (pair[1], pair[0]))


def check_active(case: Case, ident: str) -> None:
    try:
        if read(case, "runs", ident)["status"] not in ACTIVE:
            raise workqueue.JobCancelled()
    except FileNotFoundError as exc:
        raise workqueue.JobCancelled() from exc


def _key(source: Source, z: int, x: int, y: int, product: str | None) -> str:
    parts: list[Any] = [source.model_dump(), z, x, y, product]
    if product:
        parts.append(PRODUCT_VERSION)
    return hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest()[:32]


def product_cache_id(source: Source, product: str) -> str:
    """The tile-cache folder a band product lives in, beside its picture's."""
    variant = sentinel.variant_id("sentinel2", source.layer, source.date, source.date, source.maxcc)
    return f"{variant}~{product}~v{PRODUCT_VERSION}"


def _decode(raw: bytes, size: int) -> Any:
    import numpy as np

    if len(raw) > MAX_FRAME_BYTES:
        raise ValueError("imagery frame exceeds the byte limit")
    with Image.open(io.BytesIO(raw)) as image:
        if image.size != (size, size):
            raise ValueError("provider returned an unexpected image size")
        return np.array(image.convert("RGBA"))


def _instance() -> str:
    instance = (config.load_settings().get("api_keys") or {}).get("sentinelhub")
    if not instance:
        raise ValueError("configure Copernicus Sentinel Hub in Settings")
    return str(instance)


def frame(case: Case, run: dict[str, Any], source: Source, x: int, y: int,
          product: str | None = None) -> Any:
    """One tile's picture, or its band product with PAD pixels of context."""
    z, size = GRID
    edge = size + 2 * PAD if product else size
    key = _key(source, z, x, y, product)
    name = f"{key}.png"
    assets_rel = layout.analysis_assets_rel(f"runs-{run['id']}")
    destination = case.resolve_inside(f"{assets_rel}/{name}")
    raw = None
    # Reuse permanent evidence from this case, including after a bundle import.
    for folder in case.subdir(layout.ANALYSIS_DIR).glob("runs-*.assets"):
        cached = folder / name
        if cached.is_file() and cached.stat().st_size <= MAX_FRAME_BYTES:
            raw = cached.read_bytes()
            break
    cache_id = (product_cache_id(source, product) if product else
                sentinel.variant_id("sentinel2", source.layer, source.date, source.date,
                                    source.maxcc))
    if raw is None:
        cached_tile = tilecache.get(cache_id, z, x, y)
        if cached_tile:
            raw = cached_tile[0]
    if raw is None:
        if run["input"].get("offline"):
            raise ValueError("some required images are unavailable offline; no request was sent")
        check_active(case, run["id"])
        if config.usage_blocked("sentinelhub"):
            raise ValueError("Sentinel Hub usage limit reached; review Settings")
        instance = _instance()
        if product:
            pixel = WORLD / ((1 << z) * size)
            box = (x / (1 << z) * WORLD - WORLD / 2 - PAD * pixel,
                   WORLD / 2 - (y + 1) / (1 << z) * WORLD - PAD * pixel,
                   (x + 1) / (1 << z) * WORLD - WORLD / 2 + PAD * pixel,
                   WORLD / 2 - y / (1 << z) * WORLD + PAD * pixel)
            try:
                raw = sentinel.band_frame(instance, box, edge, edge, source.date, product,
                                          source.maxcc, layer=source.layer)
            finally:
                config.record_usage("sentinelhub", 1)
        else:
            url = sentinel.wmts_url(source.layer, source.date, source.date, source.maxcc)
            url = url.replace("{key}", instance)
            with httpx.stream("GET", tiles.tile_url(url, z, x, y, 1), timeout=30) as response:
                if response.status_code == 404:
                    raise ValueError("imagery is missing at the requested resolution or date")
                response.raise_for_status()
                config.record_usage("sentinelhub", 1)
                chunks = bytearray()
                for chunk in response.iter_bytes():
                    check_active(case, run["id"])
                    chunks.extend(chunk)
                    if len(chunks) > MAX_FRAME_BYTES:
                        raise ValueError("imagery frame exceeds the byte limit")
                raw = bytes(chunks)
            if tiles.is_placeholder_tile(raw):
                raise ValueError("provider has no imagery here at native resolution")
        tilecache.put(cache_id, z, x, y, raw, "image/png")
    pixels = _decode(raw, edge)
    # Canonical PNGs preserve the exact decoded input, independently of cache TTL.
    with LOCK, case._lock:
        check_active(case, run["id"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            Image.fromarray(pixels).save(destination, "PNG")
        run["frames"][key] = {"path": f"{assets_rel}/{name}", "source": source.model_dump(),
                              "tile": [z, x, y], "index": product,
                              "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()}
    return pixels


def mask_for(zones: list[Zone], z: int, size: int, x: int, y: int) -> Any:
    import cv2
    import numpy as np

    mask = np.zeros((size, size), np.uint8)
    for zone in zones:
        points = np.array([[(px * (1 << z) - x) * size, (py * (1 << z) - y) * size]
                           for px, py in map(lambda point: mercator(*point), zone.ring())],
                          dtype=np.int32)
        cv2.fillPoly(mask, [points], 1)
    return mask


def ring_statistics(values: Any, water: Any, outer: int, guard: int) -> tuple[Any, Any, Any]:
    """Mean, deviation and water share of the ring around every pixel.

    The ring is a square window with its middle punched out, so a large hull
    cannot raise the background it is then measured against. Only water
    contributes; the share says whether a pixel is at sea at all, because the
    target itself reflects infrared and so is never classed as water.
    """
    import cv2
    import numpy as np

    weight = water.astype(np.float64)
    signal = values * weight

    def ring(source: Any) -> Any:
        return (cv2.boxFilter(source, cv2.CV_64F, (outer, outer), normalize=False,
                              borderType=cv2.BORDER_REFLECT)
                - cv2.boxFilter(source, cv2.CV_64F, (guard, guard), normalize=False,
                                borderType=cv2.BORDER_REFLECT))

    count = ring(weight)
    safe = np.maximum(count, 1)
    mean = ring(signal) / safe
    deviation = np.sqrt(np.maximum(ring(signal * values) / safe - mean * mean, 0))
    return mean, deviation, count / float(outer * outer - guard * guard)


def local_contrast(values: Any, water: Any, outer: int, guard: int) -> tuple[Any, Any]:
    """How far each pixel stands above the water around it, in deviations.

    A vessel is not bright, it is brighter than its own patch of sea — which is
    what lets one threshold work over a calm lagoon and a sunlit swell alike.
    """
    import numpy as np

    mean, deviation, share = ring_statistics(values, water, outer, guard)
    # A flat patch of water has no deviation to divide by, and one quantisation
    # step would then read as a hundred-sigma detection. One digital number is
    # the floor because one digital number is the smallest difference there is.
    contrast = (values - mean) / np.maximum(deviation, 1.0)
    return np.where(share > 0, contrast, 0.0), share


def sun_position(day: str, lat: float) -> tuple[float, float]:
    """Solar azimuth and zenith, in degrees, when Sentinel-2 flies over.

    The satellite crosses the equator at 10:30 local solar time and reaches
    the northern latitudes a little later. Against the angle bands of scenes
    from 10°S to 51°N this lands within a few degrees, which is plenty for a
    search that sweeps every cloud height anyway, and it spends no band.
    """
    local = 10.5 + lat / 72
    when = date.fromisoformat(day)
    g = math.tau / 365 * (when.timetuple().tm_yday - 1 + (local - 12) / 24)
    declination = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g)
                   - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g)
                   - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    minutes = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                        - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    hour = math.radians((local * 60 + minutes) / 4 - 180)
    phi = math.radians(lat)
    cosine = (math.sin(phi) * math.sin(declination)
              + math.cos(phi) * math.cos(declination) * math.cos(hour))
    zenith = math.degrees(math.acos(max(-1.0, min(1.0, cosine))))
    azimuth = math.degrees(math.atan2(
        math.sin(hour), math.cos(hour) * math.sin(phi) - math.tan(declination) * math.cos(phi)
    )) + 180
    return azimuth % 360, zenith


def smear(mask: Any, dx: float, dy: float, start: int, length: int) -> Any:
    """The mask moved every distance from `start` to `start + length` along (dx, dy).

    Doubling: each pass ORs the result with itself shifted by what it already
    covers, so a reach of 400 pixels takes nine warps rather than 400.
    """
    import cv2
    import numpy as np

    height, width = mask.shape
    if length <= 0 or not mask.any():
        return np.zeros_like(mask)

    def shift(source: Any, distance: float) -> Any:
        matrix = np.array([[1, 0, dx * distance], [0, 1, dy * distance]], np.float32)
        return cv2.warpAffine(source, matrix, (width, height), flags=cv2.INTER_NEAREST)

    covered, span = shift(mask, start), 1
    while span < length:
        step = min(span, length - span)
        covered = np.maximum(covered, shift(covered, step))
        span += step
    return covered


def components_over(binary: Any, pixels_m2: float, minimum_m2: float) -> Any:
    """The parts of `binary` whose connected area reaches `minimum_m2`."""
    import cv2
    import numpy as np

    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary.astype(np.uint8),
                                                               connectivity=8)
    keep = np.zeros(count, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] * pixels_m2 >= minimum_m2
    return keep[labels]


def hysteresis(seed: Any, grow: Any) -> Any:
    """Regions of `grow` that contain at least one `seed` pixel.

    A strict threshold finds a target; a looser one then takes all of it, so its
    measured size is the object's and not just its brightest pixels'.
    """
    import cv2
    import numpy as np

    count, labels = cv2.connectedComponents((grow | seed).astype(np.uint8), connectivity=8)
    keep = np.zeros(count, bool)
    keep[np.unique(labels[seed])] = True
    keep[0] = False
    return keep[labels]


def sky(product: Any, day: str, lat: float, metres: float,
        other: Any = None) -> tuple[Any, Any]:
    """Cloud and cloud shadow in one band product, before any margin.

    Cloud starts from the scene classification's cloud classes, drops what is
    too small to be cloud, and then takes every unsure pixel touching what is
    left: that is the edge and the veil a classification calls ground. Shadow
    is the classified shadow plus the cloud's outline cast away from the sun,
    wherever the ground under it is dark and not water. `other` is the pass on
    the other side of a pair, which settles whether that dark is water.
    """
    import numpy as np

    classes = product[:, :, 3] & 15
    dark = (product[:, :, 3] & sentinel.DARK_FLAG) > 0
    core = components_over(np.isin(classes, CLOUD_CORE), metres * metres, MIN_CLOUD_M2)
    cloud = hysteresis(core, np.isin(classes, CLOUD_EDGE))
    cloud |= np.isin(classes, (SCL_DEFECTIVE, SCL_SNOW))
    shadow = classes == SCL_SHADOW
    if cloud.any():
        azimuth, zenith = sun_position(day, lat)
        tangent = math.tan(math.radians(zenith))
        start = int(CLOUD_HEIGHTS[0] * tangent / metres)
        length = int(min(CLOUD_HEIGHTS[1] * tangent, MAX_SHADOW_M) / metres) - start
        water = classes == SCL_WATER
        if other is not None:
            water &= (other[:, :, 3] & 15) == SCL_WATER
        # Image rows run south, so the shadow's step is (-sin, +cos) of the azimuth.
        cast = smear(cloud.astype(np.uint8), -math.sin(math.radians(azimuth)),
                     math.cos(math.radians(azimuth)), start, length).astype(bool)
        shadow |= cast & dark & ~water & ~cloud
    return cloud, shadow


def weather_mask(products: list[Any], days: list[str], lat: float, metres: float,
                 options: Parameters) -> Any:
    """Pixels to drop as cloud or shadow on any of the dates, grown by the margin.

    Cloud on *either* date invalidates a pixel: a difference is only a
    measurement when both sides of it are ground.
    """
    import cv2
    import numpy as np

    if not (options.ignore_clouds or options.ignore_shadows):
        return None
    blocked = np.zeros(products[0].shape[:2], bool)
    for side, (product, when) in enumerate(zip(products, days)):
        other = products[1 - side] if len(products) == 2 else None
        cloud, shadow = sky(product, when, lat, metres, other)
        if options.ignore_clouds:
            blocked |= cloud
        if options.ignore_shadows:
            blocked |= shadow
    if options.cloud_margin and blocked.any():
        kernel = np.ones((options.cloud_margin * 2 + 1,) * 2, np.uint8)
        blocked = cv2.dilate(blocked.astype(np.uint8), kernel).astype(bool)
    return blocked


@dataclass
class Reading:
    """One tile's verdict, cropped back to the tile.

    `stat` is the method's own detection statistic and `threshold` the value it
    had to reach, so a candidate's margin is how far past the line it got.
    `measures` are what the candidate says in words: arrays reduced over its
    pixels by `max` or `mean`.
    """

    binary: Any
    stat: Any
    threshold: float
    measures: dict[str, tuple[Any, str]] = field(default_factory=dict)


def _scale(sensitivity: int, loosest: float, strictest: float) -> float:
    return loosest + (strictest - loosest) * (1 - sensitivity / 100)


def _reflectance(product: Any) -> list[Any]:
    import numpy as np

    return [product[:, :, 0].astype(np.float32) / (255 * sentinel.BAND_GAIN),
            product[:, :, 1].astype(np.float32) / (255 * sentinel.BAND_GAIN),
            product[:, :, 2].astype(np.float32) / (255 * sentinel.SWIR_GAIN)]


def _vessels(product: Any, inside: Any, blocked: Any, metres: float,
             options: Parameters) -> tuple[Any, Any, float, dict[str, tuple[Any, str]]]:
    import cv2
    import numpy as np

    nir = product[:, :, 0].astype(np.float64)
    swir = product[:, :, 1].astype(np.float64)
    data = product[:, :, 0] > 0
    wet = product[:, :, 2] > 127
    water = wet & data & ~blocked
    # Land is non-water in bulk. A hull is non-water too, but a small one.
    land = components_over(data & ~wet, metres * metres, LAND_M2)
    land = cv2.dilate(land.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    mean8, deviation8, share = ring_statistics(nir, water, VESSEL_RING, VESSEL_GUARD)
    mean11, deviation11, _ = ring_statistics(swir, water, VESSEL_RING, VESSEL_GUARD)
    near = np.where(share > 0, (nir - mean8) / np.maximum(deviation8, 1.0), 0.0)
    short = np.where(share > 0, (swir - mean11) / np.maximum(deviation11, 1.0), 0.0)
    unit = 255 * sentinel.BAND_GAIN
    ok = inside & data & ~blocked & ~land & (share > VESSEL_WATER_SHARE)
    # Calibrated between 3 deviations, where small boats start to show among
    # wave crests, and 12, past every false hit in rough sea under glint.
    threshold = _scale(options.sensitivity, 3.0, 12.0)
    seed = ok & (near >= threshold) & ((nir - mean8) / unit >= VESSEL_EXCESS)
    grown = hysteresis(seed, ok & (near >= max(2.5, threshold / 2)))
    # Near-infrared finds bright things on water; short-wave infrared keeps the
    # ones that are not a breaking wave. It is 20 m data, so it is asked of the
    # whole object rather than of each pixel.
    count, labels = cv2.connectedComponents(grown.astype(np.uint8), connectivity=8)
    flat = labels.ravel()
    best_short = np.full(count, -np.inf)
    np.maximum.at(best_short, flat, short.ravel())
    best_excess = np.full(count, -np.inf)
    np.maximum.at(best_excess, flat, ((swir - mean11) / unit).ravel())
    accepted = (best_short >= threshold) & (best_excess >= VESSEL_EXCESS)
    accepted[0] = False
    binary = accepted[labels]
    ratio = nir / np.maximum(mean8, 1.0)
    return binary, near, threshold, {"value": (ratio, "max")}


def _hotspots(product: Any, inside: Any,
              options: Parameters) -> tuple[Any, Any, float, dict[str, tuple[Any, str]]]:
    import numpy as np

    b12 = product[:, :, 0].astype(np.float32) / (255 * sentinel.BAND_GAIN)
    ratio = np.minimum(product[:, :, 1], product[:, :, 2]).astype(np.float32) / sentinel.RATIO_GAIN
    # 1.4 at the default is the published ratio; the loosest end is the
    # normalised hotspot indices' "any positive difference", the strictest is
    # well into unambiguous flame.
    threshold = _scale(options.sensitivity, 1.0, 2.0)
    binary = inside & (product[:, :, 0] > 0) & (b12 >= HOTSPOT_FLOOR) & (ratio >= threshold)
    return binary, ratio, threshold, {"value": (ratio, "max")}


def _changes(before: Any, after: Any, valid: Any) -> tuple[Any, Any]:
    """Per-band change with the passes' overall shift in light taken out."""
    import numpy as np

    deltas = []
    for old, new in zip(_reflectance(before), _reflectance(after)):
        delta = new - old
        shift = float(np.median(delta[valid])) if valid.any() else 0.0
        deltas.append(delta - max(-MAX_SHIFT, min(MAX_SHIFT, shift)))
    stacked = np.stack(deltas, -1)
    return stacked, stacked.mean(-1)


def _spots(before: Any, after: Any, metres: float, threshold: float,
           options: Parameters) -> tuple[Any, Any, Any]:
    """Change against the change around it, and whether the surroundings held.

    The background is read from a ring with a hole punched in its middle, the
    hole wide enough to hold the target: a median box the size of the target
    takes the target itself for background, and a 90 m mark in the Yemeni desert
    then measured 3.5% where it had really moved 7%.
    """
    import cv2
    import numpy as np

    largest = math.sqrt(options.max_area or 2500) / metres
    odd = lambda value, low, high: int(min(high, max(low, round(value) | 1)))  # noqa: E731
    guard = odd(SPOT_GUARD * largest, 5, 41)
    ring = odd(SPOT_RING * largest, guard + 4, 81)
    wide = odd(4 * largest, 15, 61)
    everywhere = np.ones(before.shape[:2], bool)
    residual, moved = [], []
    for old, new in zip(_reflectance(before), _reflectance(after)):
        delta = (new - old).astype(np.float64)
        mean, _, share = ring_statistics(delta, everywhere, ring, guard)
        residual.append(np.where(share > 0, delta - mean, 0.0))
        # The passes' overall shift in light is not the neighbourhood changing.
        shift = float(np.median(delta))
        moved.append(delta - max(-MAX_SHIFT, min(MAX_SHIFT, shift)))
    spot = np.stack(residual, -1)
    changed = (np.sqrt((np.stack(moved, -1) ** 2).mean(-1)) >= threshold * GROW).astype(np.float32)
    share = cv2.blur(changed, (wide, wide))
    return np.sqrt((spot ** 2).mean(-1)), spot.mean(-1), share < SPOT_SHARE


def detect(pictures: tuple[Any, Any], products: tuple[Any, Any], mask: Any, body: RunInput,
           lat: float) -> Reading:
    """One deterministic tile. Products carry PAD pixels of context on every side."""
    import cv2
    import numpy as np

    options = body.recipe.parameters
    method = body.recipe.method
    single = method in SINGLE_METHODS
    z, size = GRID
    metres = WORLD * math.cos(math.radians(lat)) / ((1 << z) * size)
    inside = np.zeros(products[1].shape[:2], bool)
    core = (slice(PAD, PAD + size), slice(PAD, PAD + size))
    inside[core] = mask.astype(bool) & (pictures[1][:, :, 3] > 0)
    if not single:
        inside[core] &= pictures[0][:, :, 3] > 0
    blocked = None
    if method in CLOUD_METHODS:
        dated = [products[1]] if single else list(products)
        days = [body.b.date] if single else [body.a.date, body.b.date]
        blocked = weather_mask(dated, days, lat, metres, options)
    if blocked is None:
        blocked = np.zeros(inside.shape, bool)
    measures: dict[str, tuple[Any, str]]

    if method == "vessels":
        binary, stat, threshold, measures = _vessels(products[1], inside, blocked, metres, options)
    elif method == "hotspots":
        binary, stat, threshold, measures = _hotspots(products[1], inside, options)
    else:
        before, after = products
        valid = inside & ~blocked
        if method == "index":
            old = before[:, :, 0].astype(np.float32) / 127.5 - 1
            new = after[:, :, 0].astype(np.float32) / 127.5 - 1
            valid &= (before[:, :, 0] > 0) & (after[:, :, 0] > 0)
            delta = new - old
            absent, present = INDEX_STATES[options.index]
            gone, came = new < absent, old < absent
            if options.index in DARK_ABSENT:
                gone &= (after[:, :, 3] & sentinel.DARK_FLAG) > 0
                came &= (before[:, :, 3] & sentinel.DARK_FLAG) > 0
            state = np.where(delta < 0, (old >= present) & gone, (new >= present) & came)
            # 0.27 burn ratio, 0.25 NDVI: the published marks sit mid-range.
            threshold = _scale(options.sensitivity, 0.05, 0.5)
            stat = np.abs(delta)
            signed = delta
            measures = {"before": (old, "mean"), "after": (new, "mean")}
        else:
            valid &= (before[:, :, 0] > 0) & (after[:, :, 0] > 0)
            state = np.ones(valid.shape, bool)
            # In reflectance: 2% is noise over bright desert in a week, 20% is
            # a new roof on sand.
            threshold = _scale(options.sensitivity, 0.02, 0.2)
            if method == "spots":
                stat, signed, state = _spots(before, after, metres, threshold, options)
                measures = {"signed": (signed * 100, "mean")}
            else:
                deltas, signed = _changes(before, after, valid)
                if method == "structure":
                    old_red, old_nir, _ = _reflectance(before)
                    new_red, new_nir, _ = _reflectance(after)
                    ndvi = ((new_nir - new_red) / np.maximum(new_nir + new_red, 1e-6)
                            - (old_nir - old_red) / np.maximum(old_nir + old_red, 1e-6))
                    # Every band the same way: the weakest of them, signed.
                    stat = np.where(signed > 0, deltas.min(-1), -deltas.max(-1))
                    state = np.abs(ndvi) < STRUCTURE_NDVI
                    measures = {"signed": (signed * 100, "mean")}
                else:
                    stat = np.sqrt((deltas ** 2).mean(-1))
                    measures = {"value": (stat * 100, "max")}
        if options.direction != "both":
            valid &= signed > 0 if options.direction == "gain" else signed < 0
        stat = np.clip(stat, -10, 10).astype(np.float32)
        if options.smoothing:
            stat = cv2.GaussianBlur(stat, (options.smoothing * 2 + 1,) * 2, 0)
        grow = valid & (np.abs(signed if method == "structure" else stat) >= threshold * GROW)
        binary = hysteresis(valid & state & (stat >= threshold), grow & state)
        if options.cleanup:
            kernel = np.ones((2 * options.cleanup + 1,) * 2, np.uint8)
            cleaned = cv2.morphologyEx(binary.astype(np.uint8), cv2.MORPH_OPEN, kernel,
                                       borderType=cv2.BORDER_REPLICATE)
            cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8),
                                       borderType=cv2.BORDER_REPLICATE)
            binary = cleaned.astype(bool) & valid

    return Reading(binary=binary[core].astype(np.uint8), stat=stat[core], threshold=threshold,
                   measures={name: (values[core], how) for name, (values, how) in measures.items()})


def strength(margin: float) -> str:
    return "strong" if margin >= 3 else "clear" if margin >= 1.5 else "weak"


def _candidates(reading: Reading, body: RunInput, x: int, y: int,
                part: int, frame_keys: list[str]) -> list[dict[str, Any]]:
    import cv2
    import numpy as np

    z, size = GRID
    n, labels, stats, centres = cv2.connectedComponentsWithStats(reading.binary, connectivity=8)
    if n > MAX_RESULTS * 4:
        raise ValueError("too many fragments; lower the sensitivity or pick a larger size")
    flat = labels.ravel()
    peaks = np.full(n, -np.inf)
    np.maximum.at(peaks, flat, reading.stat.ravel().astype(np.float64))
    counts = np.maximum(np.bincount(flat, minlength=n), 1)
    reduced = {}
    for name, (values, how) in reading.measures.items():
        values = values.ravel().astype(np.float64)
        if how == "max":
            best = np.full(n, -np.inf)
            np.maximum.at(best, flat, values)
            reduced[name] = best
        else:
            reduced[name] = np.bincount(flat, weights=values, minlength=n) / counts
    rows = []
    for label in range(1, n):
        px, py, width, height, pixels = map(int, stats[label])
        cx, cy = centres[label]
        lon, lat = geographic((x + (cx + .5) / size) / (1 << z),
                              (y + (cy + .5) / size) / (1 << z))
        mpp = WORLD * math.cos(math.radians(lat)) / ((1 << z) * size)
        west, north = geographic((x + px / size) / (1 << z), (y + py / size) / (1 << z))
        east, south = geographic((x + (px + width) / size) / (1 << z),
                                (y + (py + height) / size) / (1 << z))
        margin = float(peaks[label]) / reading.threshold if reading.threshold else 0.0
        rows.append({"id": f"{part}-{label}", "bbox": [west, south, east, north],
                     "coordinates": [lon, lat], "area": pixels * mpp * mpp,
                     "width": width * mpp, "height": height * mpp,
                     "margin": round(margin, 3), "strength": strength(margin),
                     "measure": {name: round(float(values[label]), 3)
                                 for name, values in reduced.items()},
                     "phenomenon": body.recipe.phenomenon, "review": "new",
                     "parts": [{"frames": frame_keys, "box": [px, py, width, height]}]})
    return rows


def merge(rows: list[dict[str, Any]], distance: float) -> list[dict[str, Any]]:
    """Join touching seam components or explicitly requested nearby candidates.

    A joined candidate keeps the reading of its stronger half: the margin is
    how far the best of it got past the line, and that is what it is sorted by.
    """
    kept: list[dict[str, Any]] = []
    for row in rows:
        i = 0
        while i < len(kept):
            other = kept[i]
            a, b = row["bbox"], other["bbox"]
            lat = (a[1] + a[3]) / 2
            dy = distance / 111_320
            dx = dy / max(.08, math.cos(math.radians(lat)))
            if a[0] <= b[2] + dx + 1e-10 and b[0] <= a[2] + dx + 1e-10 and \
                    a[1] <= b[3] + dy + 1e-10 and b[1] <= a[3] + dy + 1e-10:
                kept.pop(i)
                if other["margin"] > row["margin"]:
                    row.update(margin=other["margin"], strength=other["strength"],
                               measure=other["measure"])
                row["area"] += other["area"]
                row["bbox"] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                row["parts"].extend(other["parts"])
                a = row["bbox"]
                row["coordinates"] = [(a[0] + a[2]) / 2, (a[1] + a[3]) / 2]
                row["width"] = (a[2] - a[0]) * 111_320 * math.cos(math.radians(lat))
                row["height"] = (a[3] - a[1]) * 111_320
                i = 0
            else:
                i += 1
        kept.append(row)
        if len(kept) > MAX_RESULTS * 2:
            raise ValueError("too many candidates; reduce the area or pick a larger size")
    return kept


def prune_frames(case: Case, run: dict[str, Any]) -> None:
    """Keep the tiles that back a result, and drop the rest of the sweep.

    Every tile read is written out as a canonical PNG, because a candidate has
    to be able to show the exact pixels it came from — that is the difference
    between evidence and a claim. Over a large area most tiles show nothing,
    and keeping those would tie a case's size to how much sea was swept rather
    than to what was found in it, which is what kept the allowed area small.

    A tile that produced a candidate keeps *all* of its frames, the measured
    bands included, so the run can still say what it read. The tile cache still
    holds the others for a re-run; what goes here is the permanent copy.
    """
    shown = {key for row in run["results"] for part in row["parts"] for key in part["frames"]}
    tiles = {tuple(run["frames"][key]["tile"]) for key in shown if key in run["frames"]}
    with LOCK, case._lock:
        for key, record in list(run["frames"].items()):
            if tuple(record["tile"]) in tiles:
                continue
            case.resolve_inside(record["path"]).unlink(missing_ok=True)
            del run["frames"][key]


def resolve_dates(case: Case, body: RunInput) -> RunInput:
    if body.date_rule == "manual":
        return body
    if body.offline:
        raise ValueError("latest-date lookup needs network; select explicit dates for offline runs")
    source = body.b.model_copy(deep=True)
    instance = (config.load_settings().get("api_keys") or {}).get("sentinelhub")
    if not instance or config.usage_blocked("sentinelhub"):
        raise ValueError("Copernicus is unavailable or its usage limit is reached")
    # One lookup over every area at once, answering about the areas rather
    # than about their centres: a pass can reach a centre and miss most of
    # the shape around it, and picking that date sweeps mostly nodata.
    try:
        found = sentinel.acquisitions(
            instance, [list(zone.ring()) for zone in body.zones],
            (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat(),
            date.today().isoformat(),
        )
    finally:
        config.record_usage("sentinelhub", 1)
    allowed = [entry for entry in found["dates"]
               if entry.get("cloud") is not None and entry["cloud"] <= source.maxcc]
    whole = [entry for entry in allowed if entry["coverage"] >= FULL_COVER]
    if not whole:
        best = max((entry["coverage"] for entry in allowed), default=0)
        raise ValueError(
            "no recent pass covers the whole area under the cloud limit"
            + (f"; the best reaches {round(best * 100)}% of it, so choose the dates by hand"
               if best else "")
        )
    source.date = whole[0]["date"]  # newest first
    reference = body.a
    if body.date_rule == "latest_previous" and body.followup_id:
        for summary in listing(case, "runs"):
            previous = read(case, "runs", summary["id"])
            if previous.get("status") == "ready" and \
                    previous["input"].get("followup_id") == body.followup_id:
                candidate = Source.model_validate(previous["input"]["b"])
                if candidate.layer == source.layer and candidate.date:
                    reference = candidate
                    break
    if body.recipe.method not in SINGLE_METHODS and not reference.date:
        raise ValueError("choose a reference image for the first execution of this follow-up")
    return body.model_copy(update={"a": reference, "b": source})


def execute(case: Case, job: dict[str, Any]) -> None:
    ident = job["payload"]["run_id"]
    check_active(case, ident)
    run = read(case, "runs", ident)
    try:
        body = resolve_dates(case, RunInput.model_validate(run["input"]))
        single = body.recipe.method in SINGLE_METHODS
        if single:
            body = body.model_copy(update={"a": body.b})
        run["input"] = body.model_dump()
        if not single and body.a.model_dump() == body.b.model_dump():
            run.update(status="no_new_imagery", message="No different dated imagery is available")
            persist_run(case, run)
            return
        planned = plan(body)
        z, size = GRID
        run.update(status="running", total=len(planned), resolution={"grid_zoom": z,
                   "tile_size": size, "pad": PAD}, engine_version=ENGINE_VERSION)
        persist_run(case, run)

        product = product_for(body.recipe.method, body.recipe.parameters.index)
        results: list[dict[str, Any]] = []
        # What the sweep actually read, against what was asked for. A date the
        # granules only half reach comes back half nodata, and without this the
        # run reports "nothing found" over ground it never saw.
        asked = imaged = 0
        for part, (x, y) in enumerate(planned):
            check_active(case, ident)
            picture_b = frame(case, run, body.b, x, y)
            picture_a = picture_b if single else frame(case, run, body.a, x, y)
            # Two frames for one date: the picture the analyst reviews, and the
            # bands the detector measures. Both are metered.
            product_b = frame(case, run, body.b, x, y, product)
            product_a = product_b if single else frame(case, run, body.a, x, y, product)
            mask = mask_for(body.zones, z, size, x, y)
            inside = mask.astype(bool)
            asked += int(inside.sum())
            imaged += int((inside & (picture_a[:, :, 3] > 0) & (picture_b[:, :, 3] > 0)).sum())
            _, lat = geographic((x + .5) / (1 << z), (y + .5) / (1 << z))
            reading = detect((picture_a, picture_b), (product_a, product_b), mask, body, lat)
            # One image analyzed, one frame of evidence: a vessel's "before" and
            # "after" would be the same picture twice.
            sources = [body.b] if single else [body.a, body.b]
            keys = [_key(source, z, x, y, None) for source in sources]
            results.extend(_candidates(reading, body, x, y, part, keys))
            if len(results) > MAX_RESULTS * 4:
                raise ValueError("too many fragments; lower the sensitivity or use smaller areas")
            run["progress"] = part + 1
            persist_run(case, run)
        options = body.recipe.parameters
        joined = merge(results, options.merge_metres)
        kept = [r for r in joined if r["area"] >= options.min_area and
                (not options.max_area or r["area"] <= options.max_area)]
        if len(kept) > MAX_RESULTS:
            raise ValueError("too many results; raise the minimum area or lower the sensitivity")
        kept.sort(key=lambda row: row["margin"], reverse=True)
        for row in kept:
            w, s, e, n = row["bbox"]
            row["geometry"] = {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n],
                                                                      [w, n], [w, s]]]}
        swept = round(imaged / asked, 3) if asked else 0.0
        run.update(results=kept, count=len(kept), status="ready", swept=swept, message="",
                   completed_at=now())
        prune_frames(case, run)
        persist_run(case, run)
    except workqueue.JobCancelled:
        raise
    except Exception as exc:
        # Never persist provider URLs or credentials from network exception text.
        message = str(exc) if isinstance(exc, ValueError) else "Analysis failed; imagery could not be read"
        run.update(status="failed", message=message)
        persist_run(case, run)


workqueue.register(JOB, execute)
