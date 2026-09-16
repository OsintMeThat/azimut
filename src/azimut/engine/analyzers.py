"""Bounded, explicit, local analysis runs over fixed geographic tile grids.

Source frames are owned evidence, not an expiring map cache. Completed runs
never change when their recipe, area, camera or provider catalogue changes.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import secrets
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from PIL import Image

from .. import config, layout
from ..workspace import Case
from . import media, sentinel, tilecache, tiles, wayback, workqueue
from .analysis_models import (
    CLOUD_FILTERS,
    PRODUCT_METHODS,
    SINGLE_METHODS,
    Parameters,
    RunInput,
    Source,
    Zone,
)

# What one run may sweep. The ceiling is not memory — tiles are read one at a
# time — it is the permanent copy of every tile read, which `prune_frames`
# now drops for tiles that found nothing. What is left to bound is the
# provider's own metering and the analyst's patience, and both of those the
# panel states before the run starts and the cancel button ends after.
#
# At Sentinel's 4.89 km tile that is 313 km on a side; at Wayback's 76 m one,
# 4.9 km.
MAX_TILES = 4096
MAX_RESULTS = 2000
MAX_FRAME_BYTES = 8_000_000
# Sentinel-2's own scene classification, as the classes worth excluding.
CLOUD_CLASSES = (0, 1, 8, 9, 10, 11)
SHADOW_CLASSES = (2, 3)
# What cloud looks like with no classification to ask: bright and colourless,
# its shadow near-black. Deliberately tight — a guess this filter makes on a
# rendered picture also eats a white roof, a sand flat and fresh snow, so it
# waits for cloud-like rather than merely pale.
PICTURE_CLOUD_LEVEL = 205
PICTURE_CLOUD_SPREAD = 28
PICTURE_SHADOW_LEVEL = 28
# A pixel on the Sentinel analysis grid is 9.55 m across, so the ring the
# vessel detector measures its background over spans 583 m of sea, and the hole
# punched in its middle is 105 m — wider than all but the largest hulls, which
# is what stops a ship from quietly raising its own background.
VESSEL_RING = 61
VESSEL_GUARD = 11
# The ring has to be mostly sea for its statistics to mean anything; below this
# fraction the pixel is a shoreline or an island, not a place a ship can be.
VESSEL_WATER_SHARE = 0.5
# Below this short-wave reflectance there is no fire to discuss, whatever the
# band ratios say. It is the floor the published Sentinel-2 test uses.
HOTSPOT_FLOOR = 0.15
# How far back an automatic date rule looks for its latest usable pass.
LOOKBACK_DAYS = 90
# Coverage at or above this counts as covering the whole area. It is not 1.0
# because coverage is measured by sampling, and a ring's own edge lands a point
# or two outside the granule that in truth reaches it.
FULL_COVER = 0.98
WORLD = 40_075_016.68557849
LOCK = threading.RLock()
KINDS = {"zones": "analysis-zones", "followups": "analysis-follow-up", "runs": "analysis-run"}
ACTIVE = {"queued", "running"}
JOB = "compare-analyzer"


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


# Same native grids as the tile proxy. Sentinel's 512px WMTS tiles use grid
# level 13 (view level 14), which lands on 9.55 m/px — the sensor's own
# resolution; Wayback uses 256px at level 19. The panel reads these to say what
# a run will cost before it starts, so they are published rather than copied.
GRIDS: dict[str, tuple[int, int]] = {"sentinel2": (13, 512), "esri-wayback": (19, 256)}


def grid(body: RunInput) -> tuple[int, int]:
    return GRIDS.get(body.b.provider, GRIDS["esri-wayback"])


def plan(body: RunInput) -> list[tuple[int, int]]:
    import cv2
    import numpy as np

    z, size = grid(body)
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


def _key(source: Source, z: int, x: int, y: int, index: str | None) -> str:
    encoded = json.dumps([source.model_dump(), z, x, y, index], sort_keys=True).encode()
    return hashlib.sha256(encoded).hexdigest()[:32]


def _decode(raw: bytes, size: int) -> Any:
    import numpy as np

    if len(raw) > MAX_FRAME_BYTES:
        raise ValueError("imagery frame exceeds the byte limit")
    with Image.open(io.BytesIO(raw)) as image:
        if image.size != (size, size):
            raise ValueError("provider returned an unexpected image size")
        return np.array(image.convert("RGBA"))


def frame(case: Case, run: dict[str, Any], source: Source, x: int, y: int,
          index: str | None = None) -> Any:
    body = RunInput.model_validate(run["input"])
    z, size = grid(body)
    key = _key(source, z, x, y, index)
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
    provider_id = (f"esri-wayback~{source.release}" if source.provider == "esri-wayback" else
                   sentinel.variant_id("sentinel2", source.layer, source.date, source.date,
                                       source.maxcc))
    if raw is None and index is None:
        cached_tile = tilecache.get(provider_id, z, x, y)
        if cached_tile:
            raw = cached_tile[0]
    if raw is None:
        if body.offline:
            raise ValueError("some required images are unavailable offline; no request was sent")
        check_active(case, run["id"])
        if source.provider == "sentinel2" and config.usage_blocked("sentinelhub"):
            raise ValueError("Sentinel Hub usage limit reached; review Settings")
        if index:
            instance = (config.load_settings().get("api_keys") or {}).get("sentinelhub")
            if not instance:
                raise ValueError("configure Copernicus Sentinel Hub in Settings")
            box = (x / (1 << z) * WORLD - WORLD / 2,
                   WORLD / 2 - (y + 1) / (1 << z) * WORLD,
                   (x + 1) / (1 << z) * WORLD - WORLD / 2,
                   WORLD / 2 - y / (1 << z) * WORLD)
            try:
                raw = sentinel.band_frame(instance, box, size, size, source.date, index,
                                           source.maxcc, layer=source.layer)
            finally:
                config.record_usage("sentinelhub", 1)
        else:
            # A named Wayback release never needs a catalogue lookup to fetch
            # its tiles. In particular, cached runs can work without network.
            if source.provider == "esri-wayback":
                assert source.release is not None
                url = wayback.tile_url(source.release)
                offset = 0
            else:
                instance = (config.load_settings().get("api_keys") or {}).get("sentinelhub")
                if not instance:
                    raise ValueError("configure Copernicus Sentinel Hub in Settings")
                url = sentinel.wmts_url(source.layer, source.date, source.date, source.maxcc)
                url = url.replace("{key}", instance)
                offset = 1
            with httpx.stream("GET", tiles.tile_url(url, z, x, y, offset), timeout=30) as response:
                if response.status_code == 404:
                    raise ValueError("imagery is missing at the requested resolution or date")
                response.raise_for_status()
                if source.provider == "sentinel2":
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
    pixels = _decode(raw, size)
    # Canonical PNGs preserve the exact decoded input, independently of cache TTL.
    with LOCK, case._lock:
        check_active(case, run["id"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            Image.fromarray(pixels).save(destination, "PNG")
        run["frames"][key] = {"path": f"{assets_rel}/{name}", "source": source.model_dump(),
                              "tile": [z, x, y], "index": index,
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


def local_contrast(values: Any, water: Any, outer: int, guard: int) -> tuple[Any, Any]:
    """How far each pixel stands above the water around it, in deviations.

    A vessel is not bright, it is brighter than its own patch of sea — which is
    what lets one threshold work over a calm lagoon and a sunlit swell alike,
    where an absolute cut-off would have to be retuned for every scene. The
    statistics come from a ring, a square window with its middle punched out,
    so a large hull cannot raise the background it is then measured against.

    Only water contributes. The second value returned is the ring's water
    share, which is how a pixel says whether it is at sea at all: the target
    itself reflects infrared and so is never classed as water.
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
    total = ring(signal)
    squares = ring(signal * values)
    safe = np.maximum(count, 1)
    mean = total / safe
    deviation = np.sqrt(np.maximum(squares / safe - mean * mean, 0))
    # A flat patch of water has no deviation to divide by, and one quantisation
    # step would then read as a hundred-sigma detection. One digital number is
    # the floor because one digital number is the smallest difference there is.
    contrast = (values - mean) / np.maximum(deviation, 1.0)
    share = count / float(outer * outer - guard * guard)
    # Too little water in the ring and the background is somebody else's.
    return np.where(share > 0, contrast, 0.0), share


def weather_mask(frames: tuple[Any, ...], kind: str, options: Parameters) -> Any:
    """Pixels to drop as cloud or the shadow it casts, or None when nothing is.

    ``classes`` reads Sentinel-2's scene classification out of the band frame's
    second channel, and ``ignore_clouds``/``ignore_shadows`` pick which of them
    to drop. ``picture`` has no classification to ask and goes on what cloud
    looks like in a rendered image, so it is one switch — ``guess_clouds`` — and
    it is off until someone asks for it.

    Either mask is then grown by the margin, because both stop short of where a
    reader would put the cloud's edge and the fringe left behind is what turns
    up as a ring of candidates around every mask.

    Cloud on *either* date invalidates the pixel: a difference is only a
    measurement when both sides of it are ground.
    """
    import cv2
    import numpy as np

    if kind == "classes":
        wanted = options.ignore_clouds or options.ignore_shadows
    else:
        wanted = kind == "picture" and options.guess_clouds
    if not wanted:
        return None
    blocked = None
    for image in frames:
        if image is None:
            continue
        if kind == "classes":
            classes = image[:, :, 1]
            hit = np.zeros(classes.shape, dtype=bool)
            if options.ignore_clouds:
                hit |= np.isin(classes, CLOUD_CLASSES)
            if options.ignore_shadows:
                hit |= np.isin(classes, SHADOW_CLASSES)
        else:
            pixels = image[:, :, :3].astype(np.int16)
            level = pixels.mean(axis=2)
            spread = pixels.max(axis=2) - pixels.min(axis=2)
            hit = ((level >= PICTURE_CLOUD_LEVEL) & (spread <= PICTURE_CLOUD_SPREAD)) | (
                level <= PICTURE_SHADOW_LEVEL
            )
        blocked = hit if blocked is None else (blocked | hit)
    if blocked is None or not options.cloud_margin or not blocked.any():
        return blocked
    kernel = np.ones((options.cloud_margin * 2 + 1,) * 2, np.uint8)
    grown = cv2.dilate(blocked.astype(np.uint8), kernel, borderType=cv2.BORDER_REPLICATE)
    return grown.astype(bool)


def detect(a: Any, b: Any, mask: Any, body: RunInput, index_a: Any = None,
           index_b: Any = None) -> tuple[Any, Any]:
    """One deterministic tile. Score is signal strength, never model confidence."""
    import cv2
    import numpy as np

    options = body.recipe.parameters
    left, right = a[:, :, :3].astype(np.float32), b[:, :, :3].astype(np.float32)
    valid = mask.astype(bool) & (a[:, :, 3] > 0) & (b[:, :, 3] > 0)
    kind = CLOUD_FILTERS.get(body.recipe.method, "")
    weather = weather_mask(
        (index_a, index_b) if body.recipe.method == "index"
        else (index_b,) if kind == "classes" else (a, b),
        kind, options,
    )
    if weather is not None:
        valid &= ~weather
    if options.normalize and body.recipe.method != "index":
        # Optional local brightness correction; off by default because it can
        # erase the large changes an analyst came here to find.
        right = np.clip(right + np.median(left - right, axis=(0, 1)), 0, 255)
    method = body.recipe.method
    delta = right.mean(axis=2) - left.mean(axis=2)
    if method == "index":
        delta = (index_b[:, :, 0].astype(np.float32) - index_a[:, :, 0]) / 127.5
        valid &= (index_a[:, :, 3] > 0) & (index_b[:, :, 3] > 0)
        strength = np.abs(delta)
    elif method == "vessels":
        # Near-infrared over water, against the water around it. NDWI rides in
        # the same frame, so deciding what is sea costs no extra request.
        nir = index_b[:, :, 0].astype(np.float64)
        ndwi = (index_b[:, :, 2].astype(np.float32) - 127.5) / 127.5
        valid &= index_b[:, :, 3] > 0
        # Cloud is bright in the near-infrared too, so it has to leave the sea
        # the background is measured over *and* stop being a candidate itself.
        water = ndwi > 0
        if weather is not None:
            water &= ~weather
        contrast, share = local_contrast(nir, water, VESSEL_RING, VESSEL_GUARD)
        valid &= share > VESSEL_WATER_SHARE
        # Two deviations is noise anywhere; twelve is a hull. Sensitivity then
        # moves the cut inside that range rather than across an absolute scale.
        strength = np.clip((contrast - 2) / 10, 0, 1)
    elif method == "hotspots":
        swir = index_b[:, :, 0].astype(np.float32) / (255 * sentinel.SWIR_GAIN)
        over11 = index_b[:, :, 1].astype(np.float32) / sentinel.RATIO_GAIN
        over08 = index_b[:, :, 2].astype(np.float32) / sentinel.RATIO_GAIN
        valid &= (index_b[:, :, 3] > 0) & (swir >= HOTSPOT_FLOOR)
        # Cloud is bright in the short-wave too, but bright in its neighbours
        # as well, so its ratios sit near one. Fire pulls both of them up.
        strength = np.clip((np.minimum(over11, over08) - 1) / 2, 0, 1)
    elif method == "structure":
        def edges(image: Any) -> Any:
            grey = image.mean(axis=2)
            return cv2.magnitude(cv2.Sobel(grey, cv2.CV_32F, 1, 0),
                                 cv2.Sobel(grey, cv2.CV_32F, 0, 1))
        delta = edges(right) - edges(left)
        strength = np.abs(delta) / 255
    elif method == "water_objects":
        grey = right.mean(axis=2).astype(np.uint8)
        background = cv2.medianBlur(grey, 15).astype(np.float32)
        strength = np.maximum(0, grey.astype(np.float32) - background) / 100
        # User draws the water area. Dark local surroundings reject broad land
        # surfaces, but this deliberately remains a visual candidate detector.
        valid &= background < 120
    elif method == "smoke":
        strength = np.maximum(0, delta) / 100
        valid &= (right.max(axis=2) - right.min(axis=2) < 45) & (right.mean(axis=2) > 110)
    elif method == "brightness":
        strength = np.abs(delta) / 255
    else:
        strength = np.linalg.norm(right - left, axis=2) / (255 * math.sqrt(3))
    if options.direction != "both" and method not in SINGLE_METHODS:
        valid &= delta > 0 if options.direction == "gain" else delta < 0
    strength = np.clip(strength, 0, 1).astype(np.float32)
    if options.smoothing:
        strength = cv2.GaussianBlur(strength, (options.smoothing * 2 + 1,) * 2, 0)
    threshold = 0.02 + (1 - options.sensitivity / 100) * 0.48
    binary = ((strength >= threshold) & valid).astype(np.uint8)
    if options.cleanup:
        kernel = np.ones((2 * options.cleanup + 1,) * 2, np.uint8)
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel,
                                 borderType=cv2.BORDER_REPLICATE)
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8),
                                 borderType=cv2.BORDER_REPLICATE)
    binary &= valid.astype(np.uint8)
    return binary, strength


def _candidates(binary: Any, strength: Any, body: RunInput, x: int, y: int,
                part: int, frame_keys: list[str]) -> list[dict[str, Any]]:
    import cv2
    import numpy as np

    z, size = grid(body)
    n, labels, stats, centres = cv2.connectedComponentsWithStats(binary, connectivity=8)
    if n > MAX_RESULTS * 4:
        raise ValueError("too many fragments; increase cleanup or reduce sensitivity")
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
        score = float(np.mean(strength[labels == label]))
        rows.append({"id": f"{part}-{label}", "bbox": [west, south, east, north],
                     "coordinates": [lon, lat], "area": pixels * mpp * mpp,
                     "width": width * mpp, "height": height * mpp,
                     "signal_score": round(score, 4), "confidence": None,
                     "phenomenon": body.recipe.phenomenon, "review": "new",
                     "parts": [{"frames": frame_keys, "box": [px, py, width, height]}]})
    return rows


def merge(rows: list[dict[str, Any]], distance: float) -> list[dict[str, Any]]:
    """Join touching seam components or explicitly requested nearby candidates."""
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
                area = row["area"] + other["area"]
                row["signal_score"] = (row["signal_score"] * row["area"] +
                                       other["signal_score"] * other["area"]) / area
                row["area"] = area
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
            raise ValueError("too many candidates; reduce the area or increase cleanup")
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
    if source.provider == "esri-wayback":
        source.release = wayback.releases()[0].number
    else:
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
                if candidate.provider == source.provider and candidate.layer == source.layer:
                    reference = candidate
                    break
    if body.recipe.method not in SINGLE_METHODS and (
        reference.provider == "sentinel2" and not reference.date or
        reference.provider == "esri-wayback" and reference.release is None
    ):
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
        z, size = grid(body)
        run.update(status="running", total=len(planned), resolution={"grid_zoom": z,
                   "tile_size": size}, engine_version=1)
        persist_run(case, run)
        import numpy as np

        results: list[dict[str, Any]] = []
        identical = True
        # What the sweep actually read, against what was asked for. A date the
        # granules only half reach comes back half nodata, and without this the
        # run reports "nothing found" over ground it never saw.
        asked = imaged = 0
        for part, (x, y) in enumerate(planned):
            check_active(case, ident)
            b = frame(case, run, body.b, x, y)
            a = b if single else frame(case, run, body.a, x, y)
            identical &= bool((a == b).all())
            index_a = index_b = None
            product = PRODUCT_METHODS.get(body.recipe.method)
            if body.recipe.method == "index":
                index_a = frame(case, run, body.a, x, y, body.recipe.parameters.index)
                index_b = frame(case, run, body.b, x, y, body.recipe.parameters.index)
                identical &= bool((index_a == index_b).all())
            elif product:
                # Two frames for one tile: the picture the analyst reviews, and
                # the bands the detector measures. Both are metered.
                index_b = frame(case, run, body.b, x, y, product)
            mask = mask_for(body.zones, z, size, x, y)
            inside = mask.astype(bool)
            asked += int(inside.sum())
            imaged += int((inside & (a[:, :, 3] > 0) & (b[:, :, 3] > 0)).sum())
            binary, strength = detect(a, b, mask, body, index_a, index_b)
            # One image analyzed, one frame of evidence: a vessel's "before" and
            # "after" would be the same picture twice.
            sources = [body.b] if single else [body.a, body.b]
            keys = [_key(source, z, x, y, None) for source in sources]
            results.extend(_candidates(binary, strength, body, x, y, part, keys))
            if len(results) > MAX_RESULTS * 4:
                raise ValueError("too many fragments; increase cleanup or use smaller areas")
            run["progress"] = part + 1
            persist_run(case, run)
        joined = merge(results, body.recipe.parameters.merge_metres)
        kept = [r for r in joined if r["area"] >= body.recipe.parameters.min_area and
                r["signal_score"] >= body.recipe.parameters.min_score]
        if len(kept) > MAX_RESULTS:
            raise ValueError("too many results; increase minimum area or signal threshold")
        kept.sort(key=lambda row: row["area"] * row["signal_score"], reverse=True)
        for row in kept:
            w, s, e, n = row["bbox"]
            row["geometry"] = {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n],
                                                                      [w, n], [w, s]]]}
        swept = round(imaged / asked, 3) if asked else 0.0
        run.update(results=kept, count=len(kept), status="ready", swept=swept,
                   message="The imagery pixels are identical" if identical and not single else "",
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
