"""What can be seen from a point, and the tiles the Horizon tab's mesh is built from.

The panorama is computed here, by the same march every relief tool reads
(engine/horizon.py), and sent as rasters over azimuth and elevation: the
distance to the ground at each pixel, and the ground's slope there. The tab
reads its skyline, the summit names and the strip from them; moving the eye
asks for a new sweep. `/peaks`, `/target`, `/sky`, `/match` and `/photo`
answer the smaller questions around it: named summits, whether a point is
hidden, the sun and the moon against the ridges, where on the turn a skyline
traced on a photo lies, and what a photo says about its lens.

The rasters travel deflated and base64-encoded inside the JSON: one request,
nothing to keep in step, and the browser inflates them with its own
DecompressionStream. Distances go as 16-bit codes on a log scale (`DEPTH_*`),
which keeps one part in five thousand at every range, a fifth of a metre a
kilometre out, in half the bytes of a float and far fewer once deflated.

The ground itself is drawn in the browser, as a mesh on the GPU, from tiles it
reads in batches here (`/tiles/terrain`, `/tiles/imagery`): a browser opens six
connections to one host, so hundreds of small images would queue where one
answer per few dozen tiles does not. Imagery goes through the map's own cache
and proxy (api/satellite.py), so the meter, the native ceiling and the overzoom
over gaps are the map's. `/tiles/estimate` says what Sentinel-2 laid near the
eye would ask of Sentinel Hub, before anything is fetched.
"""

from __future__ import annotations

import base64
import io
import math
import re
import struct
import zlib
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator

from .. import config
from ..engine import horizon, peaks, sentinel as sentinel_engine, skymatch, terrain

router = APIRouter(prefix="/api/horizon", tags=["horizon"])

# Heights each eye can be given, in metres: above the ground for a person or a
# drone, above the sea for an aircraft.
HEIGHT_LIMITS: dict[str, tuple[float, float]] = {
    "ground": (0.0, 100.0),
    "drone": (1.0, 3000.0),
    "aircraft": (1.0, 15000.0),
}
# How far down the picture reaches by default: a walker rarely looks at their
# feet, a drone and an aircraft mostly do.
DEFAULT_BOTTOM: dict[str, float] = {"ground": -25.0, "drone": -75.0, "aircraft": -90.0}
# Above the highest ridge, so the sky over it is in the picture.
SKY_MARGIN = 3.0
# Pixels one picture may hold: bounds the memory and the wait.
MAX_PIXELS = 8_000_000
# The quick turn that sizes the picture before the real one.
PROBE_STEP = 1.0
# A picture this small is drawn once over the whole sky and cut down to the
# band over the highest ridge afterwards, rather than sized by a probe first:
# the extra rows cost less than the probe's turn.
UNPROBED_CELLS = 400_000
# Distance codes: frontend lib/horizon/panorama.js decodes them.
DEPTH_MIN = 1.0
DEPTH_MAX = 1_000_000.0
DEPTH_CODES = 65534


def depth_codes(depth: np.ndarray) -> np.ndarray:
    """Distances in metres (NaN for sky) as 16-bit log codes: 0 is sky, 1..65535 run
    from DEPTH_MIN to DEPTH_MAX."""
    span = math.log(DEPTH_MAX / DEPTH_MIN)
    clipped = np.clip(np.nan_to_num(depth, nan=DEPTH_MIN), DEPTH_MIN, DEPTH_MAX)
    codes = 1 + np.rint(np.log(clipped / DEPTH_MIN) / span * DEPTH_CODES)
    codes[np.isnan(depth)] = 0
    return codes.astype(np.uint16)


def normal_bytes(normal: np.ndarray) -> np.ndarray:
    """A component of the ground's unit normal as a signed byte."""
    return (np.clip(normal, -1, 1) * 127).round().astype(np.int8)


class ViewIn(BaseModel):
    """Where the eye stands, and what its picture is drawn through."""

    lat: float = Field(ge=-terrain.MAX_LAT, le=terrain.MAX_LAT)
    lon: float = Field(ge=-180, le=180)
    mode: Literal["ground", "drone", "aircraft"] = "ground"
    height: float = Field(default=horizon.EYE_HEIGHT, ge=0, le=15000)
    far: float | None = Field(default=None, ge=1000, le=horizon.FAR_MAX)
    # Rays start this far out: the ground in front taken away.
    near: float = Field(default=0.0, ge=0, le=horizon.FAR_MAX)
    refraction: float = Field(default=horizon.REFRACTION_K, ge=0, le=0.3)

    @model_validator(mode="after")
    def _sane_eye(self) -> ViewIn:
        low, high = HEIGHT_LIMITS[self.mode]
        if not low <= self.height <= high:
            raise ValueError(
                f"a {self.mode} eye is {low:g} to {high:g} m high"
            )
        if self.far is not None and self.near >= self.far:
            raise ValueError("the near limit must be closer than the far one")
        return self


class PanoramaIn(ViewIn):
    step: float = Field(default=0.1, ge=0.005, le=1.0)
    top: float | None = Field(default=None, ge=-90, le=90)
    bottom: float | None = Field(default=None, ge=-90, le=90)
    # A window of the turn, from this azimuth clockwise over this many degrees.
    azimuth_start: float = Field(default=0.0, ge=0, lt=360)
    azimuth_span: float = Field(default=360.0, gt=0, le=360)

    @model_validator(mode="after")
    def _sane(self) -> PanoramaIn:
        if self.top is not None and self.bottom is not None and self.top <= self.bottom:
            raise ValueError("the top of the view must be above its bottom")
        return self


# The reaches a panorama's skyline is also kept at, metres: the skyline haze
# would leave if the air stopped there. Left to itself a Fit tries those up to
# 50 km (frontend lib/horizon/hints.js), since the skyline a photo shows is
# often a nearer one than the turn's outermost; farther only when asked.
SKYLINE_CUTS = (5_000.0, 10_000.0, 20_000.0, 50_000.0, 100_000.0)


def _pack(array: np.ndarray) -> str:
    """Little-endian bytes, deflated, in base64."""
    raw = np.ascontiguousarray(array).astype(array.dtype.newbyteorder("<"), copy=False).tobytes()
    return base64.b64encode(zlib.compress(raw, 6)).decode("ascii")


def _rows(top: float, bottom: float, step: float) -> np.ndarray:
    count = int(math.floor((top - bottom) / step)) + 1
    return top - step * np.arange(count)


@router.post("/panorama")
def panorama(body: PanoramaIn) -> dict[str, Any]:
    """The full turn from one eye: skyline, ridges, and the picture."""
    found, rows, azimuths, sampler = _draw(body)
    assert found.depth is not None and found.normal_east is not None
    assert found.normal_north is not None
    return {
        "observer": {
            "lat": body.lat, "lon": body.lon, "mode": body.mode, "height": body.height,
            "ground": round(found.ground, 1), "altitude": round(found.altitude, 1),
        },
        "far": found.far,
        "near": body.near,
        "refraction": found.k,
        "azimuth": {
            "start": body.azimuth_start, "step": body.step, "count": int(azimuths.size),
            "full": body.azimuth_span >= 360.0,
        },
        "elevation": {"top": float(rows[0]), "step": body.step, "count": int(rows.size)},
        "skyline": [round(float(v), 3) for v in found.skyline],
        "skyline_distance": [round(float(v), 1) for v in found.skyline_distance],
        # one row of float32 angles per reach, as `depth` is packed
        "skyline_cuts": {
            "reach": [round(float(v), 1) for v in found.cuts],
            "skylines": _pack(found.skyline_cuts.astype(np.float32)) if found.cuts.size else "",
        },
        "depth": _pack(depth_codes(found.depth)),
        "depth_scale": {"min": DEPTH_MIN, "max": DEPTH_MAX, "codes": DEPTH_CODES},
        "normal_east": _pack(normal_bytes(found.normal_east)),
        "normal_north": _pack(normal_bytes(found.normal_north)),
        "resolution_m": sampler.resolution(body.lat),
        "credits": sampler.credits(),
    }


def _draw(body: PanoramaIn) -> tuple[horizon.Horizon, np.ndarray, np.ndarray, terrain.Sampler]:
    """March the picture a body asks for: the sweep, its rows and its columns."""
    observer = horizon.Observer(body.lat, body.lon, body.mode, body.height)
    sampler = terrain.Sampler()
    try:
        bottom = body.bottom if body.bottom is not None else DEFAULT_BOTTOM[body.mode]
        count = max(1, int(round(body.azimuth_span / body.step)))
        azimuths = (body.azimuth_start + body.step * np.arange(count)) % 360.0
        top = body.top
        crop = top is None and count * _rows(90.0, bottom, body.step).size <= UNPROBED_CELLS
        if crop:
            top = 90.0
        elif top is None:
            probe = horizon.sweep(
                observer, azimuths=np.arange(0.0, 360.0, PROBE_STEP), far=body.far,
                k=body.refraction, sampler=sampler, near=body.near,
            )
            top = min(90.0, math.ceil(float(probe.skyline.max()) + SKY_MARGIN))
        if top <= bottom:
            top = bottom + 10.0
        rows = _rows(top, bottom, body.step)
        if azimuths.size * rows.size > MAX_PIXELS:
            raise HTTPException(
                status_code=422,
                detail="That picture is too large. Use a coarser step or a narrower band",
            )
        far = body.far if body.far is not None else horizon.default_far(observer)
        found = horizon.sweep(
            observer, azimuths=azimuths, rows=rows, far=body.far, k=body.refraction,
            sampler=sampler, near=body.near, cuts=[c for c in SKYLINE_CUTS if body.near < c < far],
        )
    except horizon.BelowGround as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except terrain.TerrainUnavailable as exc:
        raise HTTPException(status_code=502, detail=f"Terrain could not be loaded: {exc}") from exc

    assert found.depth is not None and found.normal_east is not None
    assert found.normal_north is not None
    if crop:
        # the band over the highest ridge, as a probe would have sized it
        wanted = min(90.0, math.ceil(float(found.skyline.max()) + SKY_MARGIN))
        first = int(np.searchsorted(-rows, -wanted, side="left"))
        first = min(first, rows.size - 1)
        rows = rows[first:]
        found.depth = found.depth[first:]
        found.normal_east = found.normal_east[first:]
        found.normal_north = found.normal_north[first:]
    return found, rows, azimuths, sampler


# Sentinel-2 is laid no farther than this from the eye: a whole turn within it is a
# few tens of 512 px tiles at 10 m, and past it Sentinel-2's pixel is the size of a
# field anyway.
NEAR_REACH_MAX = 30_000.0


def _ceiling(provider: Any) -> int:
    """The deepest grid level a provider has its own pixels at."""
    from . import satellite as satellite_api

    native = satellite_api._native_grid_zoom(provider)
    return int(min(provider.max_zoom, native if native is not None else provider.max_zoom))


def _free_imagery(provider_id: str) -> Any:
    """A free imagery provider, the only kind laid over the whole turn."""
    from . import satellite as satellite_api

    from ..engine import tiles

    try:
        provider = tiles.get_provider(provider_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not satellite_api.warmable(provider) or not provider.imagery:
        raise HTTPException(
            status_code=422, detail=f"{provider.label} cannot be laid over a view: use a free imagery basemap"
        )
    return provider


def _near_imagery(provider_id: str, *, check_quota: bool = True) -> Any:
    """A Sentinel-2 rendering for the ground near the eye: the one billed picture allowed."""
    from ..engine import tiles

    if provider_id.partition(sentinel_engine.VARIANT_SEP)[0] != "sentinel2":
        raise HTTPException(status_code=422, detail="Only Sentinel-2 can be laid on the near ground")
    try:
        provider = tiles.get_provider(provider_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=404, detail="Sentinel-2 needs a Copernicus key: Settings, Imagery"
        ) from exc
    if check_quota and provider.meter and config.usage_blocked(provider.meter):
        raise HTTPException(
            status_code=429,
            detail=f"Sentinel Hub is paused: {int(config.BLOCK_SHARE * 100)}% of the monthly "
            "free tier is used; enable the override in Settings to keep going",
        )
    return provider


# -- tile batches ---------------------------------------------------------------

# Tiles one batch may ask for.
TILES_MAX = 64
_TILE_KEY = re.compile(r"^\d+/\d+/\d+$")
# Bounded: the laptop this runs on has other things to do.
_TILE_WORKERS = 12
_tile_pool = ThreadPoolExecutor(max_workers=_TILE_WORKERS, thread_name_prefix="horizon-tiles")


def _tile_keys(t: str, max_zoom: int) -> list[tuple[int, int, int]]:
    """The `z/x/y` keys of a batch, checked at the edge."""
    keys = []
    for part in t.split(","):
        if not _TILE_KEY.match(part):
            raise HTTPException(status_code=422, detail="Tiles are listed as z/x/y, comma-separated")
        z, x, y = (int(v) for v in part.split("/"))
        if z > max_zoom:
            raise HTTPException(status_code=422, detail=f"Tile zoom goes up to {max_zoom}")
        if x >= 1 << z or y >= 1 << z:
            raise HTTPException(status_code=422, detail="A tile lies outside the grid of its zoom")
        keys.append((z, x, y))
    if not keys:
        raise HTTPException(status_code=422, detail="Ask for at least one tile")
    if len(keys) > TILES_MAX:
        raise HTTPException(status_code=422, detail=f"At most {TILES_MAX} tiles in one request")
    return keys


def _batch(keys: list[tuple[int, int, int]], one: Any) -> Response:
    """For each key in order, a little-endian u32 length (0: no tile) and the bytes."""
    parts = list(_tile_pool.map(lambda key: one(*key), keys))
    body = b"".join(struct.pack("<I", len(part)) + part for part in parts)
    return Response(content=body, media_type="application/octet-stream")


def _terrain_tile(z: int, x: int, y: int) -> bytes:
    try:
        fetched = terrain.tile(z, x, y)
    except terrain.TerrainUnavailable:
        return b""
    return fetched[0] if fetched else b""


@router.get("/tiles/terrain")
def tiles_terrain(t: str = Query(max_length=TILES_MAX * 24)) -> Response:
    """Terrain tiles in one answer, as `terrain.tile` returns them (engine/terrain.py)."""
    return _batch(_tile_keys(t, terrain.MAX_ZOOM), _terrain_tile)


@router.get("/tiles/imagery")
def tiles_imagery(
    t: str = Query(max_length=TILES_MAX * 24), provider: str = Query(min_length=1, max_length=120),
) -> Response:
    """Imagery tiles in one answer, each served as the map's tile proxy serves it.

    A free imagery provider, or a Sentinel-2 rendering (billed per tile, refused
    whole while the monthly free tier is paused).
    """
    from . import satellite as satellite_api

    source = _imagery_source(provider)
    keys = _tile_keys(t, source.max_zoom)

    def one(z: int, x: int, y: int) -> bytes:
        try:
            answer = satellite_api.serve_tile(source, z, x, y)
        except HTTPException:
            return b""
        return bytes(answer.body) if answer.status_code == 200 else b""

    return _batch(keys, one)


def _imagery_source(provider_id: str) -> Any:
    if provider_id.partition(sentinel_engine.VARIANT_SEP)[0] == "sentinel2":
        return _near_imagery(provider_id)
    return _free_imagery(provider_id)


class EstimateIn(BaseModel):
    lat: float = Field(ge=-terrain.MAX_LAT, le=terrain.MAX_LAT)
    lon: float = Field(ge=-180, le=180)
    near_provider: str = Field(min_length=1, max_length=120)
    near_reach: float = Field(default=5_000.0, ge=500.0, le=NEAR_REACH_MAX)


def _tiles_within(lat: float, lon: float, reach: float, zoom: int) -> list[tuple[int, int, int]]:
    """The Web Mercator tiles of a zoom that touch the disc of `reach` metres round a point."""
    n = 1 << zoom
    dlat = math.degrees(reach / terrain.EARTH_RADIUS)
    dlon = dlat / max(math.cos(math.radians(lat)), 0.01)

    def row(v: float) -> float:
        v = max(-terrain.MAX_LAT, min(terrain.MAX_LAT, v))
        return (1 - math.asinh(math.tan(math.radians(v))) / math.pi) / 2 * n

    def latitude(r: float) -> float:
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * r / n))))

    y0 = max(0, int(math.floor(row(lat + dlat))))
    y1 = min(n - 1, int(math.floor(row(lat - dlat))))
    x0 = int(math.floor((lon - dlon + 180) / 360 * n))
    x1 = int(math.floor((lon + dlon + 180) / 360 * n))
    found = []
    for y in range(y0, y1 + 1):
        low, high = latitude(y + 1), latitude(y)
        near_lat = min(max(lat, low), high)
        for x in range(x0, x1 + 1):
            west, east = x / n * 360 - 180, (x + 1) / n * 360 - 180
            near_lon = min(max(lon, west), east)
            if terrain.distance(lat, lon, near_lat, near_lon) <= reach:
                found.append((zoom, x % n, y))
    return sorted(set(found))


@router.post("/tiles/estimate")
def tiles_estimate(body: EstimateIn) -> dict[str, int]:
    """How many billed tiles laying Sentinel-2 near the eye would ask Sentinel Hub for.

    The tiles at the provider's ceiling that touch the disc round the eye, and
    those of them not already on disk. Worked out here, nothing fetched: what
    the analyst is told before Sentinel-2 is laid.
    """
    from ..engine import tilecache

    provider = _near_imagery(body.near_provider, check_quota=False)
    wanted = _tiles_within(body.lat, body.lon, body.near_reach, _ceiling(provider))
    missing = [key for key in wanted if not tilecache.has(provider.id, *key)]
    return {"requests": len(missing), "tiles": len(wanted)}


# Summit names reach no farther than this: past it they crowd the skyline
# rather than name it, and the tiles read grow with the square of it.
PEAK_RADIUS_MAX = 200_000.0
PEAKS_MAX = 3000
PEAKS_CREDIT = {
    "label": "OpenFreeMap",
    "attribution": "OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors",
    "link": "https://www.openstreetmap.org/copyright",
}


@router.get("/peaks")
def peaks_around(
    lat: float = Query(ge=-terrain.MAX_LAT, le=terrain.MAX_LAT),
    lon: float = Query(ge=-180, le=180),
    altitude: float = Query(ge=-500, le=20_000),
    far: float = Query(default=150_000.0, ge=1000, le=horizon.FAR_MAX),
    refraction: float = Query(default=horizon.REFRACTION_K, ge=0, le=0.3),
    retry: bool = False,
) -> dict[str, Any]:
    """The named summits around an eye, placed where it sees them.

    Each comes with its bearing, its distance and the elevation angle its top
    stands at from `altitude`, on the same refracting sphere as the panorama.
    Whether a summit is in sight is the panorama's to say, so every one is
    sent and the picture decides.

    Answers at once with the names known so far: `pending` counts the tiles
    still being read, and the view asks again until none are left; `failed`
    counts those that could not be read just now, asked again by themselves
    after `retry_in` seconds, or at once with `retry`.
    """
    radius = min(far, PEAK_RADIUS_MAX)
    known = peaks.known_around(lat, lon, radius, retry=retry)
    found = known.peaks
    near = []
    for peak in found:
        span = terrain.distance(lat, lon, peak.lat, peak.lon)
        if 30.0 <= span <= radius:
            near.append((span, peak))
    near.sort(key=lambda pair: pair[0])
    near = near[:PEAKS_MAX]
    # a summit OSM gives no height is read off the terrain, at the planet level
    unknown = [i for i, (_span, peak) in enumerate(near) if peak.ele is None]
    heights: dict[int, float] = {}
    if unknown:
        sampler = terrain.Sampler()
        try:
            read = sampler.heights(
                np.array([near[i][1].lat for i in unknown]),
                np.array([near[i][1].lon for i in unknown]),
                terrain.PLANET_ZOOM,
            )
            heights = {i: float(h) for i, h in zip(unknown, read)}
        except terrain.TerrainUnavailable:
            heights = {}
    rows = []
    for i, (span, peak) in enumerate(near):
        ele = peak.ele if peak.ele is not None else heights.get(i)
        if ele is None:
            continue
        rows.append({
            "name": peak.name,
            "name_en": peak.name_en,
            "lat": peak.lat,
            "lon": peak.lon,
            "ele": round(ele, 1),
            "ele_from_osm": peak.ele is not None,
            "distance": round(span, 1),
            "azimuth": round(terrain.bearing(lat, lon, peak.lat, peak.lon), 3) % 360,
            "angle": round(math.degrees(float(
                horizon.elevation_angle(span, ele, altitude, refraction)
            )), 4),
        })
    return {
        "peaks": rows, "pending": known.pending, "failed": known.failed,
        "retry_in": math.ceil(known.retry_in), "credits": [PEAKS_CREDIT],
    }


class TargetIn(BaseModel):
    lat: float = Field(ge=-terrain.MAX_LAT, le=terrain.MAX_LAT)
    lon: float = Field(ge=-180, le=180)
    mode: Literal["ground", "drone", "aircraft"] = "ground"
    height: float = Field(default=horizon.EYE_HEIGHT, ge=0, le=15000)
    refraction: float = Field(default=horizon.REFRACTION_K, ge=0, le=0.3)
    # the point looked at, and how high something stands on it (a mast, a roof)
    target_lat: float = Field(ge=-terrain.MAX_LAT, le=terrain.MAX_LAT)
    target_lon: float = Field(ge=-180, le=180)
    target_height: float = Field(default=0.0, ge=0, le=20_000)

    @model_validator(mode="after")
    def _sane(self) -> TargetIn:
        low, high = HEIGHT_LIMITS[self.mode]
        if not low <= self.height <= high:
            raise ValueError(f"a {self.mode} eye is {low:g} to {high:g} m high")
        if terrain.distance(self.lat, self.lon, self.target_lat, self.target_lon) > horizon.FAR_MAX:
            raise ValueError("the point is farther than any view reaches")
        return self


@router.post("/target")
def target(body: TargetIn) -> dict[str, Any]:
    """Where a point on the map stands in the view, and whether ground hides it.

    The same line of sight as the profile's and the panorama's, from the same
    eye: its direction and elevation angle place a mark on the picture, and the
    margin says by how much it clears the ground between, or misses it.
    """
    observer = horizon.Observer(body.lat, body.lon, body.mode, body.height)
    sampler = terrain.Sampler()
    try:
        visible, angle, margin = horizon.line_of_sight(
            observer, body.target_lat, body.target_lon, body.target_height,
            k=body.refraction, sampler=sampler,
        )
        ground = float(sampler.heights(body.target_lat, body.target_lon, terrain.MAX_ZOOM))
    except horizon.BelowGround as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except terrain.TerrainUnavailable as exc:
        raise HTTPException(status_code=502, detail=f"Terrain could not be loaded: {exc}") from exc
    return {
        "azimuth": round(terrain.bearing(body.lat, body.lon, body.target_lat, body.target_lon), 4),
        "angle": round(angle, 4),
        "distance": round(terrain.distance(body.lat, body.lon, body.target_lat, body.target_lon), 1),
        "visible": visible,
        "margin_deg": round(margin, 4),
        "ground": round(ground, 1),
    }


# A traced skyline sent to /match: twice the browser's most samples, and a
# whole turn as fine as a panorama is ever marched, cut at a few reaches.
MATCH_POINTS_MAX = 2000
MATCH_SKYLINE_MAX = 72_000
MATCH_CUTS_MAX = 8
# Picture-plane points this far out, in half widths, are off any frame a photo lies in.
MATCH_PLANE_MAX = 20.0


def _turn_angles(skyline: list[float | None]) -> np.ndarray:
    """A skyline as the search reads it: degrees, NaN where no ground stands."""
    return np.asarray([np.nan if v is None else v for v in skyline], dtype=np.float64)


def _sane_skyline(skyline: list[float | None]) -> None:
    # None is a column without ground; a NaN sent by hand is not a number at all
    angles = np.asarray([v for v in skyline if v is not None], dtype=np.float64)
    if angles.size < skymatch.MIN_POINTS:
        raise ValueError("the skyline holds no angles")
    if not np.isfinite(angles).all() or np.abs(angles).max() > 90:
        raise ValueError("the skyline holds angles no view has")


class CutIn(BaseModel):
    """The same turn's skyline as it stands if the air stops `reach` metres out."""

    reach: float = Field(gt=0, le=horizon.FAR_MAX)
    skyline: list[float | None] = Field(min_length=36, max_length=MATCH_SKYLINE_MAX)


class MatchIn(BaseModel):
    """A traced skyline and the turn of terrain to look for it on.

    The turn is the one the tab already marched (`/panorama`'s skyline, or one
    of its `skyline_cuts` with that cut's `reach`, and nearer cuts as `cuts`),
    so the search reads what the analyst sees. The
    trace is points on the picture plane, right and up from the lens's middle
    in half widths of the frame (engine/skymatch.py), and `half_width` is that
    half width on screen. What the analyst knows narrows the search: `within`
    bounds an unknown lens (degrees, low and high), `facing` the heading (the
    sector's middle and half its width), and `level` holds the roll.
    """

    skyline: list[float | None] = Field(min_length=36, max_length=MATCH_SKYLINE_MAX)
    # how far out `skyline` was cut, metres; None when it is the whole turn
    reach: float | None = Field(default=None, gt=0, le=horizon.FAR_MAX)
    cuts: list[CutIn] = Field(default_factory=list, max_length=MATCH_CUTS_MAX)
    start: float = Field(default=0.0, ge=0, lt=360)
    step: float = Field(gt=0, le=10)
    x: list[float] = Field(min_length=skymatch.MIN_POINTS, max_length=MATCH_POINTS_MAX)
    y: list[float] = Field(min_length=skymatch.MIN_POINTS, max_length=MATCH_POINTS_MAX)
    half_width: float = Field(gt=0, le=20_000)
    fov: float = Field(ge=skymatch.FOV_MIN, le=skymatch.FOV_MAX)
    # the photo says its lens: no other is tried
    known: bool = False
    tilt: float = Field(default=0.0, ge=-89, le=89)
    roll: float = Field(default=0.0, ge=-180, le=180)
    within: list[float] | None = Field(default=None, min_length=2, max_length=2)
    facing: list[float] | None = Field(default=None, min_length=2, max_length=2)
    level: bool = False

    @model_validator(mode="after")
    def _sane(self) -> MatchIn:
        if len(self.x) != len(self.y):
            raise ValueError("the trace needs as many x as y")
        if abs(len(self.skyline) * self.step - 360.0) > self.step / 2:
            raise ValueError("the skyline must cover the whole turn")
        points = np.asarray(self.x + self.y, dtype=np.float64)
        if not np.isfinite(points).all() or np.abs(points).max() > MATCH_PLANE_MAX:
            raise ValueError("the trace lies off the picture")
        _sane_skyline(self.skyline)
        for cut in self.cuts:
            if len(cut.skyline) != len(self.skyline):
                raise ValueError("a cut of the turn must have the turn's columns")
            _sane_skyline(cut.skyline)
        if self.within is not None:
            low, high = sorted(self.within)
            if not (skymatch.FOV_MIN <= low and high <= skymatch.FOV_MAX):
                raise ValueError(f"lenses run from {skymatch.FOV_MIN:g}° to {skymatch.FOV_MAX:g}°")
        if self.facing is not None:
            centre, half = self.facing
            if not (0 <= centre < 360 and 0 < half <= 180):
                raise ValueError("a sector is its middle (0 to 360°) and half its width (up to 180°)")
        return self


@router.post("/match")
def match_trace(body: MatchIn) -> dict[str, Any]:
    """Where on the turn the traced skyline lies: the best places, and how sure.

    Each place is a camera (heading, tilt, roll, lens) with its median gap to
    the terrain in degrees and the share of the trace's shape it explains;
    `close` marks those explaining about as much as the best, and `reach` the
    cut of the turn it lies on (metres, null for the whole turn). `lenses` is
    the range of fields of view tried, the photo's own alone when it says one.
    """
    turns = [
        skymatch.Turn(body.start, body.step, _turn_angles(cut.skyline), reach=cut.reach)
        for cut in sorted(body.cuts, key=lambda cut: cut.reach)
    ]
    turns.append(skymatch.Turn(body.start, body.step, _turn_angles(body.skyline), reach=body.reach))
    within = (min(body.within), max(body.within)) if body.within else None
    facing = (body.facing[0], body.facing[1]) if body.facing else None
    found = skymatch.match(
        np.asarray(body.x), np.asarray(body.y), turns,
        half_width=body.half_width, fov=body.fov, known=body.known, tilt=body.tilt, roll=body.roll,
        within=within, facing=facing, level=body.level,
    )
    tried = skymatch.lenses(body.fov, known=body.known, within=within)
    best = found.fits[0].explained if found.fits else 0.0
    return {
        "verdict": found.verdict,
        "fits": [
            {
                "heading": round(fit.heading, 3),
                "tilt": round(fit.tilt, 3),
                "roll": round(fit.roll, 3),
                "fov": round(fit.fov, 3),
                "reach": None if fit.reach is None else round(fit.reach, 1),
                "gap": round(fit.gap, 4),
                "explained": round(fit.explained, 3),
                "close": i == 0 or fit.explained >= skymatch.AMBIGUOUS_SHARE * best,
                "points": fit.points,
            }
            for i, fit in enumerate(found.fits)
        ],
        "lenses": [round(tried[0], 1), round(tried[-1], 1)],
    }


# The sun and the moon against the ridges: sampled this often over the local day.
SKY_STEP_MINUTES = 2
# Half the disc, in degrees: a body is in sight while its upper limb clears the
# ridge, which is how an almanac times a rise.
SEMIDIAMETER = {"sun": 0.267, "moon": 0.259}
# A body this far under the sea-level horizon is under every ridge too, even
# from an aircraft (whose horizon dips under 3° below 14 km).
UNDER_EVERY_RIDGE = -4.0


class SkyIn(BaseModel):
    lat: float = Field(ge=-terrain.MAX_LAT, le=terrain.MAX_LAT)
    lon: float = Field(ge=-180, le=180)
    mode: Literal["ground", "drone", "aircraft"] = "ground"
    height: float = Field(default=horizon.EYE_HEIGHT, ge=0, le=15000)
    far: float | None = Field(default=None, ge=1000, le=horizon.FAR_MAX)
    refraction: float = Field(default=horizon.REFRACTION_K, ge=0, le=0.3)
    # the local day, on the clock of the place, and that clock if not its own
    date: str | None = None
    zone: str | None = None

    @model_validator(mode="after")
    def _sane(self) -> SkyIn:
        low, high = HEIGHT_LIMITS[self.mode]
        if not low <= self.height <= high:
            raise ValueError(f"a {self.mode} eye is {low:g} to {high:g} m high")
        return self


def _crossings(
    minutes: np.ndarray, clear: np.ndarray, azimuths: np.ndarray,
) -> list[dict[str, Any]]:
    """When a body comes out over the ridges and when it goes behind them."""
    events = []
    for i in np.flatnonzero(np.diff(clear.astype(np.int8))):
        events.append({
            "kind": "appears" if clear[i + 1] else "hides",
            # the crossing lies between two samples: the later one is the first
            # minute the new state holds
            "minute": int(minutes[i + 1]),
            "azimuth": round(float(azimuths[i + 1]), 2),
        })
    return events


@router.post("/sky")
def sky_over_ridges(body: SkyIn) -> dict[str, Any]:
    """The sun's and the moon's tracks over one local day, against this eye's ridges.

    Each body comes as a track every few minutes (azimuth and apparent
    altitude), whether its upper limb clears the skyline at each step, and the
    moments it comes out over the ridges or goes behind them: the real sunrise
    and sunset of a valley, which the sea-level times beside them are not.
    The skyline is the same march every other reading of this eye uses.
    """
    from datetime import date as calendar_date, datetime as wall, timedelta

    from ..engine import localtime, sky

    if body.zone and not localtime.known_zone(body.zone):
        raise HTTPException(status_code=422, detail="zone must be an IANA zone name")
    zone_name = body.zone or localtime.zone_for(body.lat, body.lon)
    try:
        day = calendar_date.fromisoformat(body.date) if body.date else wall.now(
            localtime.zone_info(zone_name)
        ).date()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD") from exc
    start, end = localtime.day_bounds(day, zone_name)
    count = int((end - start).total_seconds() // (SKY_STEP_MINUTES * 60)) + 1
    times = [start + timedelta(minutes=SKY_STEP_MINUTES * i) for i in range(count)]
    minutes = np.arange(count) * SKY_STEP_MINUTES
    found = sky.positions(body.lat, body.lon, times)

    observer = horizon.Observer(body.lat, body.lon, body.mode, body.height)
    tracks: dict[str, dict[str, np.ndarray]] = {}
    wanted: list[np.ndarray] = []
    for name in ("sun", "moon"):
        azimuth = np.asarray(found[f"{name}_azimuth"], dtype=np.float64) % 360.0
        altitude = np.asarray(found[f"{name}_apparent_altitude"], dtype=np.float64)
        up = altitude > UNDER_EVERY_RIDGE
        tracks[name] = {"azimuth": azimuth, "altitude": altitude, "up": up}
        wanted.append(azimuth[up])
    asked = np.concatenate(wanted) if wanted else np.empty(0)
    skyline = np.empty(0)
    sampler = terrain.Sampler()
    try:
        if asked.size:
            skyline = horizon.sweep(
                observer, azimuths=asked, far=body.far, k=body.refraction, sampler=sampler,
            ).skyline
    except horizon.BelowGround as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except terrain.TerrainUnavailable as exc:
        raise HTTPException(status_code=502, detail=f"Terrain could not be loaded: {exc}") from exc

    events_today = sky.day_events(body.lat, body.lon, start, end)
    stamped = localtime.both(localtime.local_noon(day, zone_name), zone_name) or {}
    answer: dict[str, Any] = {
        "date": day.isoformat(),
        "zone": {"name": zone_name, "abbreviation": stamped.get("abbreviation")},
        "step_minutes": SKY_STEP_MINUTES,
        "start": start.isoformat(),
    }
    offset = 0
    for name, track in tracks.items():
        ridge = np.full(track["azimuth"].size, np.inf)
        taken = int(track["up"].sum())
        ridge[track["up"]] = skyline[offset:offset + taken]
        offset += taken
        clear = track["altitude"] + SEMIDIAMETER[name] > ridge
        answer[name] = {
            "azimuth": [round(float(v), 2) for v in track["azimuth"]],
            "altitude": [round(float(v), 3) for v in track["altitude"]],
            "clear": [bool(v) for v in clear],
            "events": _crossings(minutes, clear, track["azimuth"]),
        }
    answer["sun"]["sea_level"] = {
        "rise": localtime.both(events_today["sun"]["rise"], zone_name),
        "set": localtime.both(events_today["sun"]["set"], zone_name),
        "state": events_today["sun"]["state"],
    }
    answer["moon"]["illuminated"] = round(float(np.mean(found["moon_illuminated"])), 3)
    return answer


# How much of a file on the analyst's computer the browser sends to read its
# lens: the EXIF block sits at the head of a JPEG, under 64 KiB by the format,
# and the frame size soon after it. Base64 makes four characters of three bytes.
PHOTO_HEAD_BYTES = 256 * 1024
PHOTO_HEAD_CHARS = (PHOTO_HEAD_BYTES + 2) // 3 * 4


def _photo_facts(source_for: Any) -> dict[str, Any]:
    """The lens, the place and the time a photo says it was taken with, at, on.

    `source_for()` hands a fresh readable each time (a path, or the bytes the
    browser sent), since each reading opens the file again. Each fact is the
    file's claim, left out where it says nothing: the tab offers them, it never
    applies a place or a time on its own.
    """
    from ..engine import enrich

    facts = enrich.lens_facts(source_for())
    facts.update(enrich.exif_facts(source_for()))
    return facts


@router.get("/photo")
def photo_facts(case: str = Query(min_length=1), path: str = Query(min_length=1)) -> dict[str, Any]:
    """What a case's photo or video says about its lens, place and time, read for
    the overlay laid over the view. A video's place and time come from its
    container; its lens is never written there."""
    from ..engine import enrich, media as media_engine
    from ..workspace import CaseError
    from .cases import get_case

    owner = get_case(case)
    try:
        file = owner.resolve_inside(path)
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not file.is_file():
        raise HTTPException(status_code=404, detail="no such file in the case")
    kind = media_engine.media_kind(file.name)
    if kind == "image":
        return {"kind": kind, **_photo_facts(lambda: file)}
    if kind == "video":
        found = enrich.video_facts(file) or {}
        return {"kind": kind, **{key: found[key] for key in ("gps", "taken_at") if key in found}}
    raise HTTPException(status_code=422, detail="only a photo or a video can be laid over the view")


class PhotoHeadIn(BaseModel):
    # the first bytes of a file on the analyst's computer, base64: nothing is kept
    head: str = Field(min_length=4, max_length=PHOTO_HEAD_CHARS)


@router.post("/photo")
def photo_head_facts(body: PhotoHeadIn) -> dict[str, Any]:
    """The same, from the head of a photo the analyst picked on their computer
    with no case open: read in memory and forgotten."""
    try:
        head = base64.b64decode(body.head, validate=True)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="head must be base64") from exc
    return {"kind": "image", **_photo_facts(lambda: io.BytesIO(head))}
