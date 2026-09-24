"""Bounded, explicit, local analysis runs over fixed geographic tile grids.

Source frames are owned evidence, not an expiring map cache. Completed runs
never change when their recipe, area, camera or provider catalogue changes.

Every optical detector here reads Copernicus Sentinel-2 band products. Their
thresholds were set against real scenes, not synthetic ones: sea under glint and
in rough weather (Bab-el-Mandeb), a dense anchorage under cumulus (Singapore
Strait), wakes (Gibraltar), empty calm sea (Dover Strait), flares and an oil fire
(Rumaila), active wildfires (California, Cerrado), bright industrial roofs
(Jebel Ali), a construction site across seven months (Egypt's new capital),
dry-season clearing (Rondônia) and irrigated desert. The radar detectors read
Sentinel-1 backscatter, and the scenes behind their numbers are listed with
them. The numbers below say what each of them taught.
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
from . import analysis_geometry, media, sentinel, tilecache, tiles, workqueue
from .analysis_models import (
    CLOUD_METHODS,
    RADAR_METHODS,
    SINGLE_METHODS,
    SMOOTHING_M,
    Area,
    AreaDates,
    AreaGeometry,
    Parameters,
    RunInput,
    Source,
    Zone,
    is_radar,
    is_single,
    recipe_products,
    recipe_sensor,
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
ENGINE_VERSION = 4
LOCK = threading.RLock()
KINDS = {"areas": "analysis-area", "zones": "analysis-zones", "followups": "analysis-follow-up", "runs": "analysis-run"}
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
# How far below zero the water index may sit and the classification still be
# believed when it says water, as the byte the product carries. Glint drags the
# index onto zero without crossing this: over the Bab-el-Mandeb 99% of the sea
# stayed above it. Dry ground is well under — bare sand reads about -0.2 and
# vegetation -0.8 — so ground the classification mistakes for water stays land.
WATER_INDEX_FLOOR = 108   # NDWI -0.15

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


# --- Radar -------------------------------------------------------------------
# Sentinel-1 speckle: every pixel of a single look is the sum of many random
# echoes, so a lone pixel can read several decibels off its neighbours. Levels
# are therefore averaged as power, never as decibels, whose mean is biased low.
# The numbers below were read off real scenes: the Singapore Strait anchorage,
# the Dover Strait and its harbour, the North Sea in the October 2023 storms,
# the Belgian offshore wind farms, the Bosphorus, Port Sudan's desert coast,
# the May 2023 Emilia-Romagna floods, and Gaza City before and after late 2023.
#
# What is sea. Windy sea rose to -11 dB in VV in the North Sea storm, above
# farmland's -10, so VV alone called it land; cross-pol stayed below -24 dB on
# every sea and between -12 and -18 on vegetated land. Dry desert is as dark as
# calm sea in both, and at Port Sudan the radar alone put 72 candidates on the
# town and the sand around it. So the sea is first what Sentinel-2's own scene
# classification calls water on the clearest pass of the past year, and only
# where that pass saw cloud is the radar asked. That classification takes dark
# container stacks and coal yards for water: at Rotterdam it gave a dozen
# candidates on terminals, and overruling it wherever the radar was bright, even
# only over blocks a hundred metres wide, dropped as many ships at berth. It is
# left as it is.
SEA_WINDOW = 31      # a median over 300 m ignores a hull and its sidelobes
SEA_VV_DB = -9.0
SEA_VH_DB = -21.0
# A hull answers in both polarisations; the ghosts a strong target leaves in
# azimuth, the streaks turning blades smear, and sea spikes answer in VV alone.
# In the Singapore anchorage every hull cleared VH by 8 dB, those ghosts 4 to 7.
VH_GAP = 2.0
# The sea is never measured as quieter than the radar's own noise. Sentinel-1's
# noise floor in this mode is specified at -22 dB at worst and sits a few dB
# lower mid-swath. Below it the processing takes the noise out, and calm water,
# like cross-pol on most seas, reads as low as the product's -35 dB floor.
# Measured against that, a return at -25 dB, which is noise, cleared the line:
# off Fujairah, on a calm morning with a hundred tankers at anchor, the faint
# copies each hull leaves along the track came back as 29 vessels. With the
# background held at -24 dB they went, as did the pale streaks off Dover,
# Singapore and Port Sudan's reefs, and no hull was lost there, in the Bandar
# Abbas anchorage or among the Belgian turbines. At -22 dB small ships began
# to go; at -26 dB a streak came back.
SAR_NOISE_DB = -24.0
# A weak return within 400 m of one 6 dB stronger is that one's sidelobe or
# ghost: it cut the Belgian wind farms from 1,043 candidates to about one a
# turbine, and cost the anchorage no hull.
GHOST_DB = 6.0
GHOST_M = 400.0
# Ground that answers like walls or metal, measured on the side that has it. At
# -4 dB in VV a drop picked ten times more of Gaza's built-up area after late
# 2023 than across the same fortnight before, and growing crops rarely reach it.
BRIGHT_DB = -4.0
# Radar-dark like calm water: the usual threshold for flood mapping in VV.
WATER_DB = -18.0
# The largest overall shift between two passes of one track still read as the
# sensor rather than the ground; calibration holds a pair within a few tenths.
MAX_SAR_SHIFT = 1.0
# How much ground one step of smoothing averages radar power over before two
# passes are compared. The grid's pixel is 7 m at 45° and a radar sample about
# 20 m, so a window counted in pixels held too few independent samples: over
# land that did not change, 5% of pixels still moved by 2.2 to 2.5 dB between
# passes six days apart, and a pair of Istanbul, one of farmland and a Gaza pair
# before October 2023 each came back as one connected region of 3 to 5 km².
# Averaged over 90 m, the medium size, Istanbul's false "razed" fell from 111
# to 25 and Gaza's control from 82 to 38, while the area flagged across the
# war's first weeks stayed at 1.2 km²; the May 2023 flood at Conselice was
# still read as 6 km² of new water, with none on the control pairs.
SAR_WINDOW_M = SMOOTHING_M["sar-change"]


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
    saved = json.loads(path.read_text(encoding="utf-8"))
    if kind == "followups":
        with LOCK, case._lock:
            if not saved.get("area_dates"):
                saved = share_areas(case, saved, ident)
                media.write_json_atomic(path, saved)
            saved["zones"] = [area_zone(read(case, "areas", pair["area_id"])).model_dump()
                              for pair in saved["area_dates"]]
    return saved


def area_zone(area: dict[str, Any]) -> Zone:
    return Zone(id=area["id"], name=area["name"], kind="polygon",
                points=area["geometry"]["coordinates"][0][:-1])


def share_areas(case: Case, data: dict[str, Any], ident: str) -> dict[str, Any]:
    """Promote routine zones once; stable ids make interrupted migration resumable."""
    result = dict(data)
    pairs = {pair["area_id"]: pair for pair in data.get("area_dates", [])}
    linked = []
    zones = data.get("zones") or data.get("recipe", {}).get("zones") or []
    for raw in zones:
        zone = Zone.model_validate(raw)
        try:
            read(case, "areas", zone.id)
            area_id = zone.id
        except (ValueError, FileNotFoundError):
            area_id = hashlib.sha256(f"{ident}:{zone.id}".encode()).hexdigest()[:12]
            ring = zone.ring()
            area = Area(name=zone.name, colour=data.get("recipe", {}).get("colour", "#38bdf8"),
                        geometry=AreaGeometry(coordinates=[ring + [ring[0]]]))
            if not case.resolve_inside(relpath("areas", area_id)).exists():
                save(case, "areas", area.model_dump(), new_id=area_id)
        pair = pairs.get(zone.id) or {"a": data.get("a", {}),
            "b": {**data.get("b", {}), **({"date": ""} if data.get("date_rule", "manual") != "manual" else {})},
            "date_rule": data.get("date_rule", "manual")}
        linked.append({**pair, "area_id": area_id})
    result["area_dates"] = linked or list(pairs.values())
    result.pop("zones", None)
    if "zones" in result.get("recipe", {}):
        result["recipe"] = {k: v for k, v in result["recipe"].items() if k != "zones"}
    return result


def hydrate(case: Case, body: RunInput) -> RunInput:
    """Freeze shared geometry into a run; its dates remain owned by that run."""
    if body.zones:
        return body
    return body.model_copy(update={"zones": [area_zone(read(case, "areas", p.area_id))
                                            for p in body.area_dates]})


def summary(kind: str, saved: dict[str, Any]) -> dict[str, Any]:
    """What a list shows of one saved item, without the item itself.

    Detect's home list is a row per saved detection with its latest run under
    it, so a run says which detection it belongs to and how much of it is still
    waiting for a verdict, and both say what they look for.
    """
    if kind == "areas":
        return dict(saved)
    row: dict[str, Any] = {key: saved[key] for key in
                           ("id", "title", "created_at", "updated_at", "status", "progress",
                            "total", "count", "message", "completed_at") if key in saved}
    body = saved.get("input", saved)
    row["areas"] = len(body.get("zones") or [])
    if kind == "zones":
        return row
    recipe = body.get("recipe") or {}
    row.update(analyzer=recipe.get("name", ""), colour=recipe.get("colour", ""),
               method=recipe.get("method", ""), date_rule=body.get("date_rule", "manual"))
    # An analyzer of your own reads one date or two depending on its rules, so
    # the row says which rather than leaving the list to guess from the method.
    try:
        row["single"] = is_single(recipe)
    except ValueError:
        row["single"] = False
    row["note"] = body.get("note", "")
    if kind == "followups":
        # The list draws every watched area on the map, so the shapes travel
        # with the row rather than costing one read per routine.
        row["zones"] = body.get("zones") or []
    if kind == "runs":
        results = saved.get("results") or []
        row.update(followup_id=body.get("followup_id"),
                   dates=[(body.get(side) or {}).get("date", "") for side in ("a", "b")],
                   to_review=sum(1 for r in results if r.get("review") == "new"),
                   marked=sum(1 for r in results if r.get("review") in KEPT))
        row["area_runs"] = saved.get("area_runs", [])
    return row


def listing(case: Case, kind: str) -> list[dict[str, Any]]:
    if kind == "areas":
        listing(case, "followups")  # migrate embedded areas before exposing the shared list
    rows: list[dict[str, Any]] = []
    for path in case.subdir(layout.ANALYSIS_DIR).glob(f"{kind}-*.json"):
        try:
            rows.append(summary(kind, read(case, kind, path.stem.split("-", 1)[1])))
        except (OSError, ValueError, KeyError):
            continue
    return sorted(rows, key=lambda row: row["created_at"], reverse=True)


#: Verdicts that keep a candidate. "kept" is a pin in the case, written by
#: promotion; "noted" keeps it in the detection's own view and nowhere else.
KEPT = ("kept", "noted")


def findings(case: Case, followup_id: str) -> list[dict[str, Any]]:
    """What a routine has found and nobody has dismissed, newest run first.

    A routine is worth coming back to only if it remembers: its runs are
    separate sweeps, but what they found is one growing list, and this is it.
    """
    rows: list[dict[str, Any]] = []
    for summary in listing(case, "runs"):
        if summary.get("followup_id") != followup_id or summary.get("status") != "ready":
            continue
        run = read(case, "runs", summary["id"])
        day = (run["input"].get("b") or {}).get("date", "")
        for result in run.get("results", []):
            if result.get("review") not in KEPT:
                continue
            rows.append({**result, "run_id": run["id"], "run_title": run["title"],
                         "date": result.get("sources", {}).get("b", {}).get("date", day)})
    return rows


def save(case: Case, kind: str, data: dict[str, Any], ident: str | None = None,
         *, new_id: str | None = None) -> dict[str, Any]:
    with LOCK, case._lock:
        if ident:
            old = read(case, kind, ident)
        else:
            ident = new_id or secrets.token_hex(6)
            old = {}
        if kind == "followups":
            data = share_areas(case, data, ident)
        rel = relpath(kind, ident)
        saved = {**data, "id": ident, "created_at": old.get("created_at", now()),
                 "updated_at": now(), "version": 1}
        path = case.resolve_inside(rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        media.write_json_atomic(path, saved)
        entity = case.find_entity(attr="spec", value=rel)
        title = saved.get("title", saved.get("name", "Area"))
        if entity:
            case.update_entity(entity["id"], {"label": title})
        else:
            case.add_entity(KINDS[kind], title, attrs={"spec": rel}, by="compare")
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


def picture_cache_id(source: Source) -> str:
    """The tile-cache folder a source's review picture lives in.

    Sentinel-2's is the basemap's own variant, so a picture read for a sweep is
    a tile the map can reuse. Sentinel-1's is rendered by us for one pass, and
    its time rides in the name without the colons Windows refuses in a folder.
    """
    if source.provider == "sentinel1":
        return (f"sentinel1~{source.layer}~{source.date}~{source.time.replace(':', '') or 'day'}"
                f"~picture~v{PRODUCT_VERSION}")
    return sentinel.variant_id("sentinel2", source.layer, source.date, source.date, source.maxcc)


def product_cache_id(source: Source, product: str) -> str:
    """The tile-cache folder a band product lives in, beside its picture's."""
    if source.provider == "sentinel1":
        return (f"sentinel1~{source.layer}~{source.date}~{source.time.replace(':', '') or 'day'}"
                f"~{product}~v{PRODUCT_VERSION}")
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


def decode_product(raw: bytes, size: int, product: str | None) -> Any:
    """A frame as the engine reads it: 16 bits a channel for a ``bands-…``
    product, which Pillow would cut to 8, and bytes for everything else."""
    import cv2
    import numpy as np

    if not product or not sentinel.product_bands(product):
        return _decode(raw, size)
    if len(raw) > MAX_FRAME_BYTES:
        raise ValueError("imagery frame exceeds the byte limit")
    pixels = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_UNCHANGED)
    if pixels is None or pixels.dtype != np.uint16 or pixels.shape != (size, size, 4):
        raise ValueError("provider returned an unexpected band frame")
    return np.ascontiguousarray(pixels[:, :, [2, 1, 0, 3]])  # OpenCV reads BGRA


def _instance() -> str:
    instance = (config.load_settings().get("api_keys") or {}).get("sentinelhub")
    if not instance:
        raise ValueError("configure Copernicus Sentinel Hub in Settings")
    return str(instance)


def radar_layer() -> str:
    """The Sentinel-1 layer the user added to their Copernicus configuration."""
    layer = str(config.load_settings().get("sentinel1_layer") or "")
    if not layer:
        raise ValueError("choose the Sentinel-1 layer in Settings → Imagery before a radar run")
    return layer


def water_source(source: Source) -> Source:
    """The Sentinel-2 source a radar pass's water classification is read from.

    It is named by the first day of the pass's month, so every pass of a month
    shares one classification and one cache entry.
    """
    return Source(provider="sentinel2", date=f"{source.date[:7]}-01",
                  layer=sentinel.DEFAULT_LAYER, maxcc=100)


def _box(z: int, x: int, y: int, pad: int) -> tuple[float, float, float, float]:
    """One grid tile in Web Mercator metres, grown by `pad` pixels on every side."""
    _, size = GRID
    pixel = WORLD / ((1 << z) * size)
    return (x / (1 << z) * WORLD - WORLD / 2 - pad * pixel,
            WORLD / 2 - (y + 1) / (1 << z) * WORLD - pad * pixel,
            (x + 1) / (1 << z) * WORLD - WORLD / 2 + pad * pixel,
            WORLD / 2 - y / (1 << z) * WORLD + pad * pixel)


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
    cache_id = product_cache_id(source, product) if product else picture_cache_id(source)
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
        radar = source.provider == "sentinel1"
        if product or radar:
            # A radar picture is ours too: there is no true colour to borrow,
            # so the review composite is rendered like a product, unpadded.
            try:
                raw = sentinel.band_frame(instance, _box(z, x, y, PAD if product else 0), edge, edge,
                                          source.date, product or "sar-picture",
                                          100 if radar else source.maxcc, layer=source.layer,
                                          time=source.time)
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
    pixels = decode_product(raw, edge, product)
    # Canonical PNGs preserve the exact decoded input, independently of cache TTL.
    # A 16-bit product is kept as it came: it is already a checked PNG, and
    # Pillow cannot write one back.
    with LOCK, case._lock:
        check_active(case, run["id"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            if pixels.dtype == "uint16":
                destination.write_bytes(raw)
            else:
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
    # NDWI alone cannot be asked what is sea. Sun glint adds the same
    # reflectance to every band, so over the Bab-el-Mandeb in September it put
    # near-infrared at 0.075 and left the index sitting on zero: two thirds of
    # open water read as dry, the sea became one component of "land", and the
    # sweep returned nothing. The classification is the second opinion, and it
    # called that whole strait water. It is believed where the index is merely
    # weak, never where the index plainly says dry ground: Sen2Cor calls deep
    # shadow and dark ground water, and taking its word there would put vessel
    # candidates on land.
    index = product[:, :, 2]
    wet = (index > 127) | (((product[:, :, 3] & 15) == SCL_WATER)
                           & (index > WATER_INDEX_FLOOR))
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


def _spots(before: Any, after: Any, valid: Any, metres: float, threshold: float,
           options: Parameters) -> tuple[Any, Any, Any]:
    """Change against the change around it, and whether the surroundings held.

    The background is read from a ring with a hole punched in its middle, the
    hole wide enough to hold the target: a median box the size of the target
    takes the target itself for background, and a 90 m mark in the Yemeni desert
    then measured 3.5% where it had really moved 7%.

    Only pixels the sweep can measure feed that ring. Where a granule ends or a
    cloud sits, one date has ground and the other has nothing, and letting that
    difference into the background raised every neighbour it reached: a quiet
    tile cut in half by a granule edge produced a candidate the size of the cut.
    """
    import cv2
    import numpy as np

    largest = math.sqrt(options.max_area or 2500) / metres
    odd = lambda value, low, high: int(min(high, max(low, round(value) | 1)))  # noqa: E731
    guard = odd(SPOT_GUARD * largest, 5, 41)
    ring = odd(SPOT_RING * largest, guard + 4, 81)
    wide = odd(4 * largest, 15, 61)
    residual, moved = [], []
    for old, new in zip(_reflectance(before), _reflectance(after)):
        delta = (new - old).astype(np.float64)
        mean, _, share = ring_statistics(delta, valid, ring, guard)
        residual.append(np.where(share > 0, delta - mean, 0.0))
        # The passes' overall shift in light is not the neighbourhood changing.
        shift = float(np.median(delta[valid])) if valid.any() else 0.0
        moved.append(delta - max(-MAX_SHIFT, min(MAX_SHIFT, shift)))
    spot = np.stack(residual, -1)
    changed = ((np.sqrt((np.stack(moved, -1) ** 2).mean(-1)) >= threshold * GROW)
               & valid).astype(np.float32)
    share = cv2.blur(changed, (wide, wide))
    return np.sqrt((spot ** 2).mean(-1)), spot.mean(-1), share < SPOT_SHARE


def _power_mean(level: Any, valid: Any, window: int) -> Any:
    """Backscatter averaged as power over a square window, back in decibels.

    Only pixels the radar measured count, so an area's edge or a swath's end
    does not pull its neighbours down.
    """
    import cv2
    import numpy as np

    power = np.where(valid, 10.0 ** (sentinel.sar_decibels(level.astype(np.float64)) / 10.0), 0.0)
    total = cv2.boxFilter(power, cv2.CV_64F, (window, window), normalize=False,
                          borderType=cv2.BORDER_REFLECT)
    count = cv2.boxFilter(valid.astype(np.float64), cv2.CV_64F, (window, window),
                          normalize=False, borderType=cv2.BORDER_REFLECT)
    return 10.0 * np.log10(np.maximum(total / np.maximum(count, 1e-9), 1e-6))


def _sar_vessels(product: Any, water: Any, inside: Any, metres: float,
                 options: Parameters) -> tuple[Any, Any, float, dict[str, tuple[Any, str]]]:
    """Hulls: a strong return standing out of the sea around it.

    Each pixel is measured against a ring of sea with a hole in the middle, the
    ring the optical detector uses, in decibels above the ring's mean power or
    the radar's noise floor, whichever is louder. It has to clear the line in VV
    and come close in VH, and not sit in the shadow of a much stronger return.
    `water` is Sentinel-2's classification, or None where the sweep could not
    read it.
    """
    import cv2
    import numpy as np

    data = product[:, :, 0] > 0
    median_vv = sentinel.sar_decibels(cv2.medianBlur(product[:, :, 0], SEA_WINDOW).astype(np.float64))
    median_vh = sentinel.sar_decibels(cv2.medianBlur(product[:, :, 1], SEA_WINDOW).astype(np.float64))
    radar_sea = (median_vv < SEA_VV_DB) & (median_vh < SEA_VH_DB)
    classed = (water[:, :, 0] if water is not None else
               np.full(data.shape, sentinel.WATER_UNKNOWN, np.uint8))
    sea = data & np.where(classed == sentinel.WATER_WATER, True,
                          np.where(classed == sentinel.WATER_LAND, False, radar_sea))
    land = components_over(data & ~sea, metres * metres, LAND_M2)
    land = cv2.dilate(land.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)

    def contrast(level: Any) -> tuple[Any, Any]:
        decibels = sentinel.sar_decibels(level.astype(np.float64))
        power = np.where(data, 10.0 ** (decibels / 10.0), 0.0)
        mean, _, share = ring_statistics(power, sea, VESSEL_RING, VESSEL_GUARD)
        background = np.maximum(mean, 10.0 ** (SAR_NOISE_DB / 10.0))
        return np.where(share > 0, decibels - 10.0 * np.log10(background), 0.0), share

    vv, share = contrast(product[:, :, 0])
    vh, _ = contrast(product[:, :, 1])
    ok = inside & data & ~land & (share > VESSEL_WATER_SHARE)
    threshold = _scale(options.sensitivity, 6.0, 14.0)
    seed = ok & (vv >= threshold) & (vh >= threshold - VH_GAP)
    binary = hysteresis(seed, ok & (vv >= threshold / 2))
    return _without_ghosts(binary, vv, metres), vv, threshold, {"value": (vv, "max")}


def _without_ghosts(binary: Any, strength: Any, metres: float) -> Any:
    """Drop a return within GHOST_M of one GHOST_DB stronger."""
    import cv2
    import numpy as np

    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary.astype(np.uint8), connectivity=8)
    if count <= 2:
        return binary
    peaks = np.full(count, -np.inf)
    np.maximum.at(peaks, labels.ravel(), strength.ravel())
    reach = GHOST_M / metres
    left, top = stats[:, cv2.CC_STAT_LEFT].astype(float), stats[:, cv2.CC_STAT_TOP].astype(float)
    right = left + stats[:, cv2.CC_STAT_WIDTH]
    bottom = top + stats[:, cv2.CC_STAT_HEIGHT]
    keep = np.ones(count, bool)
    keep[0] = False
    for label in range(1, count):
        stronger = peaks >= peaks[label] + GHOST_DB
        stronger[0] = False
        if not stronger.any():
            continue
        gap_x = np.maximum(0, np.maximum(left - right[label], left[label] - right))
        gap_y = np.maximum(0, np.maximum(top - bottom[label], top[label] - bottom))
        if (stronger & (np.hypot(gap_x, gap_y) <= reach)).any():
            keep[label] = False
    return keep[labels]


def sar_window(smoothing: int, metres: float) -> int:
    """The radar change window in pixels for `smoothing` steps of SAR_WINDOW_M: odd, at least 3."""
    return max(3, round(SAR_WINDOW_M * max(1, smoothing) / metres) | 1)


def _sar_change(before: Any, after: Any, valid: Any, metres: float,
                options: Parameters) -> tuple[Any, Any, Any, float, dict[str, tuple[Any, str]]]:
    """Backscatter that moved between two passes of one track, in decibels.

    Both passes are averaged as power over the same ground before they are
    compared, so speckle does not read as change. What the recipe's ground
    setting asks for then gates it: bright ground on the side that has it, or
    water coming or going.
    """
    import numpy as np

    window = sar_window(options.smoothing, metres)
    old = _power_mean(before[:, :, 0], valid, window)
    new = _power_mean(after[:, :, 0], valid, window)
    # Both polarisations vote: a building that falls or a field that floods
    # darkens in each, while speckle in one is not speckle in the other.
    delta = (new - old + _power_mean(after[:, :, 1], valid, window)
             - _power_mean(before[:, :, 1], valid, window)) / 2
    shift = float(np.median(delta[valid])) if valid.any() else 0.0
    delta = delta - max(-MAX_SAR_SHIFT, min(MAX_SAR_SHIFT, shift))
    ground = options.sar_ground
    if ground == "bright":
        state = np.where(delta < 0, old >= BRIGHT_DB, new >= BRIGHT_DB)
    elif ground == "water":
        state = np.where(delta < 0, (new < WATER_DB) & (old >= WATER_DB),
                         (old < WATER_DB) & (new >= WATER_DB))
    else:
        state = np.ones(valid.shape, bool)
    threshold = _scale(options.sensitivity, 1.0, 5.0)
    measures = {"signed": (delta, "mean"), "before": (old, "mean"), "after": (new, "mean")}
    return np.abs(delta), delta, state, threshold, measures


def detect(pictures: tuple[Any, Any], products: tuple[Any, Any], mask: Any, body: RunInput,
           lat: float, water: Any = None) -> Reading:
    """One deterministic tile. Products carry PAD pixels of context on every side.

    `water` is Sentinel-2's water classification over the same padded tile,
    which only the radar vessel method reads.
    """
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
    elif method == "sar-vessels":
        binary, stat, threshold, measures = _sar_vessels(products[1], water, inside, metres, options)
    else:
        before, after = products
        valid = inside & ~blocked
        if method == "sar-change":
            valid &= (before[:, :, 0] > 0) & (after[:, :, 0] > 0)
            stat, signed, state, threshold, measures = _sar_change(before, after, valid, metres, options)
        elif method == "index":
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
                stat, signed, state = _spots(before, after, valid, metres, threshold, options)
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
        # Radar change was already averaged as power over this window.
        if options.smoothing and method not in RADAR_METHODS:
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


def _candidates(reading: Reading, phenomenon: str, x: int, y: int,
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
                     "geometry": analysis_geometry.footprint(
                         labels[py:py + height, px:px + width] == label, x, y, z, size, (px, py)),
                     "coordinates": [lon, lat], "area": pixels * mpp * mpp,
                     "margin": round(margin, 3), "strength": strength(margin),
                     "measure": {name: round(float(values[label]), 3)
                                 for name, values in reduced.items()},
                     "phenomenon": phenomenon, "review": "new",
                     "parts": [{"frames": frame_keys, "box": [px, py, width, height]}]})
    return rows


# How long against how wide a candidate's footprint may be and still be
# compact, and how long it has to be to count as elongated. A roof, a crater or
# a burnt vehicle sits near 1; a road, a track or a trench runs past 3.
COMPACT_MAX = 2.0
ELONGATED_MIN = 3.0


def keeps(row: dict[str, Any], options: Parameters) -> bool:
    """Whether a merged candidate survives the recipe's size and shape filters."""
    if row["area"] < options.min_area or (options.max_area and row["area"] > options.max_area):
        return False
    if options.shape == "any" or "geometry" not in row:
        return True
    ratio = analysis_geometry.elongation(row["geometry"])
    return ratio <= COMPACT_MAX if options.shape == "compact" else ratio >= ELONGATED_MIN


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
                if "geometry" in row and "geometry" in other:
                    row["geometry"] = analysis_geometry.joined(row["geometry"], other["geometry"])
                a = row["bbox"]
                row["coordinates"] = [(a[0] + a[2]) / 2, (a[1] + a[3]) / 2]
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
            if record.get("index") is None or tuple(record["tile"]) in tiles:
                continue
            case.resolve_inside(record["path"]).unlink(missing_ok=True)
            del run["frames"][key]


def previous_pass(case: Case, body: RunInput) -> Source:
    """The pass this routine's last finished run swept, which the next one
    compares against. Falls back to the reference the routine was saved with."""
    if not body.followup_id:
        return body.a
    best: tuple[tuple[str, str], Source] | None = None
    for summary in listing(case, "runs"):
        if summary.get("followup_id") != body.followup_id or summary.get("status") != "ready":
            continue
        previous = read(case, "runs", summary["id"])
        area_id = body.zones[0].id
        if previous.get("area_runs"):
            area = next((p for p in previous["area_runs"] if p["area_id"] == area_id
                         and p["status"] == "ready"), None)
            if not area:
                continue
            candidate = Source.model_validate(area["b"])
        else:
            if not any(z["id"] == area_id or hashlib.sha256(
                    f"{body.followup_id}:{z['id']}".encode()).hexdigest()[:12] == area_id
                    for z in previous["input"].get("zones", [])):
                continue
            candidate = Source.model_validate(previous["input"]["b"])
        if candidate.layer != body.b.layer or not candidate.date:
            continue
        if body.b.date and candidate.date >= body.b.date:
            continue
        # Radar compares like with like: a pass from another track sees the
        # same ground at another angle, and that difference is not change.
        if candidate.provider == "sentinel1" and body.b.time and not sentinel.same_track(
                candidate.time, body.b.time):
            continue
        # Runs of one routine can share a timestamp, which is only seconds deep,
        # so the pass they swept settles the order between them.
        key = (str(summary.get("created_at", "")), candidate.date)
        if best is None or key > best[0]:
            best = (key, candidate)
    return best[1] if best else body.a


def _lookup(body: RunInput, start: str, end: str) -> list[dict[str, Any]]:
    """The passes over every area of `body` in a window, newest first.

    One lookup over every area at once, answering about the areas rather than
    about their centres: a pass can reach a centre and miss most of the shape
    around it, and picking that date sweeps mostly nodata.
    """
    if body.offline:
        raise ValueError("latest-date lookup needs network; select explicit dates for offline runs")
    instance = (config.load_settings().get("api_keys") or {}).get("sentinelhub")
    if not instance or config.usage_blocked("sentinelhub"):
        raise ValueError("Copernicus is unavailable or its usage limit is reached")
    try:
        found = sentinel.acquisitions(instance, [list(zone.ring()) for zone in body.zones],
                                      start, end, collection=recipe_sensor(body.recipe))
    finally:
        config.record_usage("sentinelhub", 1)
    return list(found["dates"])


def _sensed_by(body: RunInput) -> RunInput:
    """Sources that name the collection the method reads.

    The panel builds Sentinel-2 sources; a radar method reads the user's
    Sentinel-1 layer, whatever the source was saved with, and has no clouds to
    set a ceiling on. An optical source never carries a pass time.
    """
    if is_radar(body.recipe):
        radar: dict[str, Any] = {"provider": "sentinel1", "layer": radar_layer(), "maxcc": 100}
        return body.model_copy(update={"a": body.a.model_copy(update=radar),
                                       "b": body.b.model_copy(update=radar)})

    def optical(source: Source) -> Source:
        # A pass time left over from a radar analyzer would narrow the day to
        # forty minutes around a radar pass, and Sentinel-2 flies at another hour.
        if source.provider == "sentinel2" and not source.time:
            return source
        patch: dict[str, Any] = {"provider": "sentinel2", "time": ""}
        if source.provider != "sentinel2":
            patch["layer"] = sentinel.DEFAULT_LAYER
        return source.model_copy(update=patch)

    return body.model_copy(update={"a": optical(body.a), "b": optical(body.b)})


def _pass_time(body: RunInput, side: Source, track: str,
               found: list[dict[str, Any]] | None = None) -> Source:
    """A dated radar source pinned to one pass of its day.

    A date typed by hand names a day, and Sentinel-1 can pass twice in one,
    from opposite directions. The pass on `track` wins, then the one that
    covers the areas best. Offline there is nothing to ask, and the day is read
    whole from whatever the cache holds.
    """
    if not side.date or side.time or body.offline:
        return side
    passes = [entry for entry in (found if found is not None else _lookup(body, side.date, side.date))
              if entry["date"] == side.date]
    if not passes:
        raise ValueError(f"no Sentinel-1 pass reaches this area on {side.date}")
    passes.sort(key=lambda entry: (not sentinel.same_track(entry["time"], track),
                                   -entry["coverage"], entry["time"]))
    return side.model_copy(update={"time": passes[0]["time"]})


def _timed(body: RunInput) -> RunInput:
    """Radar sources pinned to their passes, and a pair held to one track.

    A pass from another track sees the ground at another angle, and that
    difference is not change. One lookup settles both sides.
    """
    if not is_radar(body.recipe):
        return body
    single = is_single(body.recipe)
    sides = [body.b] if single else [body.a, body.b]
    missing = sorted(side.date for side in sides if side.date and not side.time)
    found = _lookup(body, missing[0], missing[-1]) if missing and not body.offline else None
    b = _pass_time(body, body.b, "" if single else body.a.time, found)
    if single:
        return body.model_copy(update={"a": b, "b": b})
    a = _pass_time(body, body.a, b.time, found)
    if a.time and b.time and not sentinel.same_track(a.time, b.time):
        raise ValueError("the reference and the pass were seen from different tracks; choose "
                         "two passes at the same time of day, which the pass list groups")
    return body.model_copy(update={"a": a, "b": b})


def resolve_dates(case: Case, body: RunInput, *, selected: bool = False) -> RunInput:
    body = _sensed_by(body)
    single = is_single(body.recipe)
    radar = is_radar(body.recipe)
    if single:
        body = body.model_copy(update={"a": body.b})
    if body.date_rule == "manual":
        return _timed(body)
    if selected and body.b.date:
        if radar:
            body = body.model_copy(update={"b": _pass_time(body, body.b, body.a.time)})
        reference = (body.b if single else
                     previous_pass(case, body) if body.date_rule == "latest_previous" else body.a)
        if not single and not reference.date:
            raise ValueError("choose a reference image for the first execution of this follow-up")
        return _timed(body.model_copy(update={"a": reference}))
    track = ""
    if radar and not single:
        # The newest pass is looked for on one track: the reference's, or for a
        # routine that compares with its previous pass, the track it has run on.
        anchor = body.a if body.date_rule != "latest_previous" else previous_pass(case, body)
        anchor = _pass_time(body, anchor, "")
        if body.date_rule != "latest_previous":
            body = body.model_copy(update={"a": anchor})
        track = anchor.time
    source = body.b.model_copy(deep=True)
    found = _lookup(body, (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat(),
                    date.today().isoformat())
    allowed = [entry for entry in found if radar or (
        entry.get("cloud") is not None and entry["cloud"] <= source.maxcc)]
    if track:
        allowed = [entry for entry in allowed if sentinel.same_track(entry["time"], track)]
    whole = [entry for entry in allowed if entry["coverage"] >= FULL_COVER]
    if not whole:
        best = max((entry["coverage"] for entry in allowed), default=0)
        raise ValueError(
            (f"no recent Sentinel-1 pass{' on this track' if track else ''} covers the whole area"
             if radar else "no recent pass covers the whole area under the cloud limit")
            + (f"; the best reaches {round(best * 100)}% of it, so choose the dates by hand"
               if best else "")
        )
    source.date = whole[0]["date"]  # newest first
    if radar:
        source.time = whole[0]["time"]
    reference = (source if single else
                 body.a if body.date_rule != "latest_previous" else
                 previous_pass(case, body.model_copy(update={"b": source})))
    if not single and not reference.date:
        raise ValueError("choose a reference image for the first execution of this follow-up")
    return _timed(body.model_copy(update={"a": reference, "b": source}))


def for_area(body: RunInput, zone: Zone) -> RunInput:
    pair = next((pair for pair in body.area_dates if pair.area_id == zone.id), None)
    changes: dict[str, Any] = {"zones": [zone], "area_dates": []}
    if pair:
        changes.update(a=pair.a, b=pair.b, date_rule=pair.date_rule)
    return body.model_copy(update=changes)


def prepare_areas(case: Case, body: RunInput) -> tuple[RunInput, list[dict[str, Any]]]:
    """Resolve each area independently, only as part of an explicit launch."""
    outcomes = []
    pairs = []
    for zone in body.zones:
        local = for_area(body, zone)
        outcome: dict[str, Any] = {"area_id": zone.id, "name": zone.name}
        try:
            local = resolve_dates(case, local, selected=bool(body.area_dates))
            outcome.update(status="pending", a=local.a.model_dump(), b=local.b.model_dump(), message="")
            pairs.append(AreaDates(area_id=zone.id, a=local.a, b=local.b, date_rule="manual"))
        except Exception as exc:
            message = str(exc) if isinstance(exc, ValueError) else "Imagery could not be read"
            outcome.update(status="failed", message=f"{zone.name}: {message}",
                           a=local.a.model_dump(), b=local.b.model_dump())
            pairs.append(AreaDates(area_id=zone.id, a=local.a, b=local.b, date_rule=local.date_rule))
        outcomes.append(outcome)
    return body.model_copy(update={"area_dates": pairs}), outcomes


def duplicates(case: Case, body: RunInput, outcomes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Exact geometry, recipe and source pairs only; overlapping dates do not match."""
    found = []
    for summary in listing(case, "runs"):
        if summary.get("status") != "ready":
            continue
        run = read(case, "runs", summary["id"])
        old = RunInput.model_validate(run["input"])
        if old.recipe.model_dump() != body.recipe.model_dump():
            continue
        for outcome in outcomes:
            if outcome["status"] != "pending":
                continue
            zone = next(z for z in body.zones if z.id == outcome["area_id"])
            old_zone = next((z for z in old.zones if z.id == zone.id), None)
            if old_zone is None or old_zone.ring() != zone.ring():
                continue
            records = run.get("area_runs") or [{"area_id": zone.id, "status": "ready",
                        "a": old.a.model_dump(), "b": old.b.model_dump()}]
            match = next((r for r in records if r["area_id"] == zone.id and r["status"] == "ready"
                          and r["b"] == outcome["b"] and
                          (is_single(body.recipe) or r["a"] == outcome["a"])), None)
            if match:
                found.append({"run_id": run["id"], "title": run["title"], "area_id": zone.id,
                              "area_name": zone.name, "a": outcome["a"], "b": outcome["b"]})
    return found


def execute(case: Case, job: dict[str, Any]) -> None:
    ident = job["payload"]["run_id"]
    check_active(case, ident)
    run = read(case, "runs", ident)
    try:
        original = hydrate(case, RunInput.model_validate(run["input"]))
        outcomes = run.get("area_runs")
        if outcomes is None:
            _, outcomes = prepare_areas(case, original)
        single = is_single(original.recipe)
        z, size = GRID
        run.update(status="running", area_runs=outcomes, resolution={"grid_zoom": z,
                   "tile_size": size, "pad": PAD}, engine_version=ENGINE_VERSION)
        persist_run(case, run)
        asked = imaged = 0
        kept: list[dict[str, Any]] = []
        resolved = []
        for outcome in outcomes:
            check_active(case, ident)
            if outcome["status"] == "failed":
                continue
            zone = next(zone for zone in original.zones if zone.id == outcome["area_id"])
            body = for_area(original, zone).model_copy(update={
                "a": Source.model_validate(outcome["b"] if single else outcome["a"]),
                "b": Source.model_validate(outcome["b"]), "date_rule": "manual"})
            resolved.append(AreaDates(area_id=zone.id, a=body.a, b=body.b, date_rule="manual"))
            if not single and body.a == body.b:
                outcome.update(status="no_new_imagery", message=f"{zone.name}: No different dated imagery is available")
                continue
            try:
                rows, area_asked, area_imaged = sweep_area(case, run, body)
                kept.extend(rows)
                asked += area_asked
                imaged += area_imaged
                outcome.update(status="ready", count=len(rows))
            except (workqueue.JobCancelled, workqueue.JobRemoved):
                raise
            except Exception as exc:
                message = str(exc) if isinstance(exc, ValueError) else "Imagery could not be read"
                outcome.update(status="failed", message=f"{zone.name}: {message}")
            persist_run(case, run)
        if len(kept) > MAX_RESULTS:
            raise ValueError("too many results; raise the minimum area or lower the sensitivity")
        kept.sort(key=lambda row: row["margin"], reverse=True)
        if resolved:
            # Keep the original envelope readable by older clients; each actual
            # pair is recorded beside its area's outcome and on every result.
            original = original.model_copy(update={"a": resolved[0].a, "b": resolved[0].b})
        run["input"] = original.model_dump()
        swept = round(imaged / asked, 3) if asked else 0.0
        status = ("ready" if any(o["status"] == "ready" for o in outcomes) else
                  "failed" if any(o["status"] == "failed" for o in outcomes) else "no_new_imagery")
        run.update(results=kept, count=len(kept), status=status, swept=swept,
                   message=" · ".join(o["message"] for o in outcomes if o.get("message")),
                   completed_at=now())
        prune_frames(case, run)
        persist_run(case, run)
    except (workqueue.JobCancelled, workqueue.JobRemoved):
        raise
    except Exception as exc:
        # Never persist provider URLs or credentials from network exception text.
        message = str(exc) if isinstance(exc, ValueError) else "Analysis failed; imagery could not be read"
        run.update(status="failed", message=message)
        persist_run(case, run)


def sweep_area(case: Case, run: dict[str, Any], body: RunInput) -> tuple[list[dict[str, Any]], int, int]:
    """Apply the unchanged detector to one area's own pair.

    An analyzer of your own rules reads every product its rules need and is
    judged by `detect_rules`, the same evaluation the builder's preview runs.
    """
    from . import detect_rules

    single = is_single(body.recipe)
    rules = body.recipe.method == "rules"
    z, size = GRID
    products = recipe_products(body.recipe)
    product = products[0]
    results: list[dict[str, Any]] = []
    asked = imaged = 0
    for part, (x, y) in enumerate(plan(body)):
        check_active(case, run["id"])
        workqueue.let_others_through(case, JOB)
        picture_b = frame(case, run, body.b, x, y)
        picture_a = picture_b if single else frame(case, run, body.a, x, y)
        mask = mask_for(body.zones, z, size, x, y)
        inside = mask.astype(bool)
        _, lat = geographic((x + .5) / (1 << z), (y + .5) / (1 << z))
        if rules:
            read: dict[str, tuple[Any, Any]] = {}
            for name in products:
                after = frame(case, run, body.b, x, y, name)
                read[name] = (after if single else frame(case, run, body.a, x, y, name), after)
            reading: Reading = detect_rules.evaluate(
                read, mask, body.recipe, (body.a.date, body.b.date), lat).reading
            # Pictures are for review only; the products say where the sensor saw.
            first = read[products[0]]
            seen = (first[1][:, :, 0] > 0) & (first[0][:, :, 0] > 0)
            asked += int(inside.sum())
            imaged += int((inside & seen[PAD:PAD + size, PAD:PAD + size]).sum())
        else:
            reading = _detect_tile(case, run, body, x, y, product, (picture_a, picture_b), mask, lat)
            asked += int(inside.sum())
            imaged += int((inside & (picture_a[:, :, 3] > 0) & (picture_b[:, :, 3] > 0)).sum())
        sources = [body.b] if single else [body.a, body.b]
        keys = [_key(source, z, x, y, None) for source in sources]
        results.extend(_candidates(reading, body.recipe.phenomenon, x, y, part, keys))
        if len(results) > MAX_RESULTS * 4:
            raise ValueError("too many fragments; lower the sensitivity or use smaller areas")
        run["progress"] += 1
        persist_run(case, run)
    options = body.recipe.parameters
    joined = merge(results, options.merge_metres)
    kept = [r for r in joined if keeps(r, options)]
    for row in kept:
        row.update(id=f"{body.zones[0].id}-{row['id']}", area_id=body.zones[0].id,
                   area_name=body.zones[0].name, origin="detector",
                   sources={"a": body.a.model_dump(), "b": body.b.model_dump()})
    return kept, asked, imaged


def _detect_tile(case: Case, run: dict[str, Any], body: RunInput, x: int, y: int, product: str,
                 pictures: tuple[Any, Any], mask: Any, lat: float) -> Reading:
    """One tile of a built-in detector: its product on each date, and the water
    classification radar vessels read beside it."""
    single = is_single(body.recipe)
    product_b = frame(case, run, body.b, x, y, product)
    product_a = product_b if single else frame(case, run, body.a, x, y, product)
    water = None
    if body.recipe.method == "sar-vessels":
        # Without it the radar alone decides what is sea, which it does
        # well enough offshore; a failed read is not a failed tile.
        try:
            water = frame(case, run, water_source(body.b), x, y, "water")
        except (ValueError, sentinel.CoverageError, httpx.HTTPError):
            water = None
    return detect(pictures, (product_a, product_b), mask, body, lat, water)


workqueue.register(JOB, execute)
