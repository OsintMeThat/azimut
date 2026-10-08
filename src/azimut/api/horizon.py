"""What can be seen from a point, as the picture the Horizon tab looks through.

The panorama is computed here, by the same march every relief tool reads
(engine/horizon.py), and sent as rasters over azimuth and elevation: the
distance to the ground at each pixel, and the ground's slope there. The browser
only reprojects them to a camera and colours them, so turning, zooming, tilting
or relighting the view never asks for a new sweep; moving the eye does.

The rasters travel deflated and base64-encoded inside the JSON: one request,
nothing to keep in step, and the browser inflates them with its own
DecompressionStream. Distances go as 16-bit codes on a log scale (`DEPTH_*`),
which keeps one part in five thousand at every range, a fifth of a metre a
kilometre out, in half the bytes of a float and far fewer once deflated.

A picture covers the whole turn, or a window of it: a narrow lens looking
through a telephoto wants cells finer than a full turn can afford, so the tab
asks for the few degrees it shows at the step its pixels need.
"""

from __future__ import annotations

import base64
import io
import math
import threading
import zlib
from collections import OrderedDict
from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from PIL import Image
from pydantic import BaseModel, Field, model_validator

from .. import config
from ..engine import drape as drape_engine, horizon, peaks, sentinel as sentinel_engine, shadow as shadow_engine, terrain

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
# Distance codes: 0 is sky, 1..65535 run from DEPTH_MIN to DEPTH_MAX metres on a
# log scale (frontend lib/horizon/panorama.js decodes them).
DEPTH_MIN = 1.0
DEPTH_MAX = 1_000_000.0
DEPTH_CODES = 65534


class PanoramaIn(BaseModel):
    lat: float = Field(ge=-terrain.MAX_LAT, le=terrain.MAX_LAT)
    lon: float = Field(ge=-180, le=180)
    mode: Literal["ground", "drone", "aircraft"] = "ground"
    height: float = Field(default=horizon.EYE_HEIGHT, ge=0, le=15000)
    far: float | None = Field(default=None, ge=1000, le=horizon.FAR_MAX)
    # Rays start this far out: the ground in front taken away.
    near: float = Field(default=0.0, ge=0, le=horizon.FAR_MAX)
    refraction: float = Field(default=horizon.REFRACTION_K, ge=0, le=0.3)
    step: float = Field(default=0.1, ge=0.005, le=1.0)
    top: float | None = Field(default=None, ge=-90, le=90)
    bottom: float | None = Field(default=None, ge=-90, le=90)
    # A window of the turn, from this azimuth clockwise over this many degrees.
    azimuth_start: float = Field(default=0.0, ge=0, lt=360)
    azimuth_span: float = Field(default=360.0, gt=0, le=360)
    # The finest terrain all round out to engine/horizon.py FULL_DETAIL_REACH.
    full_detail: bool = False

    @model_validator(mode="after")
    def _sane(self) -> PanoramaIn:
        low, high = HEIGHT_LIMITS[self.mode]
        if not low <= self.height <= high:
            raise ValueError(
                f"a {self.mode} eye is {low:g} to {high:g} m high"
            )
        if self.top is not None and self.bottom is not None and self.top <= self.bottom:
            raise ValueError("the top of the view must be above its bottom")
        if self.far is not None and self.near >= self.far:
            raise ValueError("the near limit must be closer than the far one")
        return self


def _pack(array: np.ndarray) -> str:
    """Little-endian bytes, deflated, in base64."""
    raw = np.ascontiguousarray(array).astype(array.dtype.newbyteorder("<"), copy=False).tobytes()
    return base64.b64encode(zlib.compress(raw, 6)).decode("ascii")


# The last few pictures drawn, so the imagery laid over one (`/drape`) reads its
# distances rather than marching the same rays again.
_PICTURES_KEPT = 4
_pictures: OrderedDict[str, tuple[np.ndarray, np.ndarray, np.ndarray]] = OrderedDict()
_pictures_lock = threading.Lock()


def _picture_key(body: PanoramaIn) -> str:
    return body.model_dump_json()


def _keep_picture(key: str, azimuths: np.ndarray, rows: np.ndarray, depth: np.ndarray) -> None:
    with _pictures_lock:
        _pictures[key] = (azimuths, rows, depth)
        _pictures.move_to_end(key)
        while len(_pictures) > _PICTURES_KEPT:
            _pictures.popitem(last=False)


def _kept_picture(key: str) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    with _pictures_lock:
        found = _pictures.get(key)
        if found is not None:
            _pictures.move_to_end(key)
        return found


def depth_codes(depth: np.ndarray) -> np.ndarray:
    """Distances in metres (NaN for sky) as 16-bit log codes."""
    span = math.log(DEPTH_MAX / DEPTH_MIN)
    clipped = np.clip(np.nan_to_num(depth, nan=DEPTH_MIN), DEPTH_MIN, DEPTH_MAX)
    codes = 1 + np.rint(np.log(clipped / DEPTH_MIN) / span * DEPTH_CODES)
    codes[np.isnan(depth)] = 0
    return codes.astype(np.uint16)


def _rows(top: float, bottom: float, step: float) -> np.ndarray:
    count = int(math.floor((top - bottom) / step)) + 1
    return top - step * np.arange(count)


@router.post("/panorama")
def panorama(body: PanoramaIn) -> dict[str, Any]:
    """The full turn from one eye: skyline, ridges, and the picture."""
    found, rows, azimuths, sampler = _draw(body)
    assert found.depth is not None and found.normal_east is not None
    assert found.normal_north is not None
    _keep_picture(_picture_key(body), azimuths, rows, found.depth)
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
        "depth": _pack(depth_codes(found.depth)),
        "depth_scale": {"min": DEPTH_MIN, "max": DEPTH_MAX, "codes": DEPTH_CODES},
        "normal_east": _pack((np.clip(found.normal_east, -1, 1) * 127).round().astype(np.int8)),
        "normal_north": _pack((np.clip(found.normal_north, -1, 1) * 127).round().astype(np.int8)),
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
        found = horizon.sweep(
            observer, azimuths=azimuths, rows=rows, far=body.far, k=body.refraction,
            sampler=sampler, near=body.near, full_detail=body.full_detail,
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


class DrapeIn(PanoramaIn):
    """A picture already asked for, and the imagery to lay over it.

    `provider` is a free one, over all the ground. `near_provider`, a Sentinel-2
    rendering (a variant id), is laid on the ground nearer than `near_reach`
    metres only: the one billed picture a view may carry, kept to the few
    tiles near the eye.
    """

    provider: str = "esri-world-imagery"
    near_provider: str | None = Field(default=None, max_length=120)
    near_reach: float = Field(default=5_000.0, ge=500.0, le=NEAR_REACH_MAX)


@router.post("/drape")
def drape(body: DrapeIn) -> dict[str, Any]:
    """The ground's colours over a picture, on the same grid as its distances.

    The picture is read from the ones just drawn when the same eye and grid
    were asked for, and marched again otherwise. Only a free provider whose
    tiles may be cached is laid over a view: a whole turn reads a few hundred
    tiles, which on a billed provider would be quota spent on scenery.
    """
    from . import satellite as satellite_api

    provider = _free_imagery(body.provider)
    near_provider = _near_imagery(body.near_provider) if body.near_provider else None
    azimuths, rows, depth = _picture_for(body)

    def fetch_from(source: Any, tile: int) -> drape_engine.Fetch:
        def fetch(z: int, x: int, y: int) -> np.ndarray | None:
            served = satellite_api._serve_tile(source, z, x, y)
            if served is None or not isinstance(served, tuple):
                return None
            return drape_engine.decode(served[0], tile)

        return fetch

    near = None
    if near_provider is not None:
        near = drape_engine.Near(
            reach=body.near_reach, fetch=fetch_from(near_provider, near_provider.tile_size),
            ceiling=_ceiling(near_provider), tile=near_provider.tile_size,
        )
    picture, used = drape_engine.drape_panorama(
        body.lat, body.lon, azimuths, body.step, depth,
        fetch_from(provider, drape_engine.TILE), _ceiling(provider), near=near,
    )
    buffer = io.BytesIO()
    Image.fromarray(picture, "RGB").save(buffer, format="WEBP", quality=88, method=4)
    return {
        "image": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "width": int(picture.shape[1]),
        "height": int(picture.shape[0]),
        "provider": provider.id,
        "near_provider": near_provider.id if near_provider else None,
        "levels": sorted(used),
        "credits": [
            {"label": source.label, "attribution": source.attribution, "link": ""}
            for source in ([near_provider] if near_provider else []) + [provider]
        ],
    }


@router.post("/drape/estimate")
def drape_estimate(body: DrapeIn) -> dict[str, Any]:
    """How many billed tiles laying `near_provider` over a picture would ask for.

    Worked out here from the picture's own grid, nothing fetched, and only the
    tiles not already on disk counted: what the analyst is told before
    Sentinel-2 is laid over a view.
    """
    from ..engine import tilecache

    if not body.near_provider:
        return {"requests": 0, "tiles": 0}
    near_provider = _near_imagery(body.near_provider, check_quota=False)
    azimuths, _rows, depth = _picture_for(body)
    _cells, lat, lon, distance, footprint = drape_engine.ground_points(
        body.lat, body.lon, azimuths, body.step, depth
    )
    close = distance < body.near_reach
    wanted = drape_engine.tiles_for(
        lat[close], lon[close], footprint[close], _ceiling(near_provider), near_provider.tile_size
    )
    missing = [key for key in wanted if not tilecache.has(near_provider.id, *key)]
    return {"requests": len(missing), "tiles": len(wanted)}


def _picture_for(body: PanoramaIn) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The picture a body names: kept from just now, or drawn again."""
    grid = PanoramaIn(**{key: value for key, value in body.model_dump().items() if key in PanoramaIn.model_fields})
    kept = _kept_picture(_picture_key(grid))
    if kept is not None:
        return kept
    found, rows, azimuths, _sampler = _draw(grid)
    assert found.depth is not None
    return azimuths, rows, found.depth


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


class ShadowIn(PanoramaIn):
    """A picture already asked for, and where the light stands over it."""

    light_azimuth: float = Field(ge=0, lt=360)
    light_altitude: float = Field(ge=-10, le=90)
    # Every this many cells across and down; unset, as few as keep the march
    # to `SHADOW_CELLS` ground cells. A shadow is soft, and the browser blends
    # between them.
    every: int | None = Field(default=None, ge=1, le=8)


# Ground cells a shadow march takes on: about a second and a half of work.
SHADOW_CELLS = 150_000


@router.post("/shadow")
def shadow(body: ShadowIn) -> dict[str, Any]:
    """How much of the sun or the moon each ground cell of a picture sees.

    The ground's own slope is lit in the browser; what it cannot know is that
    a ridge stands between a face and the light, which is a march over the
    terrain from every cell (engine/shadow.py). The picture is read from the
    ones just drawn when the same eye and grid were asked for, and marched
    again otherwise. The answer is a light raster on the picture's grid, one
    cell in `every` each way: 255 lit, 0 in shadow.
    """
    azimuths, rows, depth = _picture_for(body)
    ground = int(np.isfinite(depth).sum())
    every = body.every or max(1, min(8, math.ceil(math.sqrt(ground / SHADOW_CELLS))))
    sampler = terrain.Sampler()
    try:
        light = shadow_engine.shadow_panorama(
            body.lat, body.lon, azimuths[::every], body.step * every, depth[::every, ::every],
            body.light_azimuth, body.light_altitude, sampler, k=body.refraction,
        )
    except terrain.TerrainUnavailable as exc:
        raise HTTPException(status_code=502, detail=f"Terrain could not be loaded: {exc}") from exc
    return {
        "light": _pack(light),
        "azimuth": {
            "start": float(azimuths[0]), "step": body.step * every, "count": int(light.shape[1]),
            "full": body.azimuth_span >= 360.0,
        },
        "elevation": {"top": float(rows[0]), "step": body.step * every, "count": int(light.shape[0])},
        "light_azimuth": body.light_azimuth,
        "light_altitude": body.light_altitude,
    }


# Summit names reach no farther than this: past it they crowd the skyline
# rather than name it, and the Overpass box grows with the square of it.
PEAK_RADIUS_MAX = 200_000.0
PEAKS_MAX = 3000
OSM_CREDIT = {
    "label": "OpenStreetMap",
    "attribution": "© OpenStreetMap contributors",
    "link": "https://www.openstreetmap.org/copyright",
}


@router.get("/peaks")
def peaks_around(
    lat: float = Query(ge=-terrain.MAX_LAT, le=terrain.MAX_LAT),
    lon: float = Query(ge=-180, le=180),
    altitude: float = Query(ge=-500, le=20_000),
    far: float = Query(default=150_000.0, ge=1000, le=horizon.FAR_MAX),
    refraction: float = Query(default=horizon.REFRACTION_K, ge=0, le=0.3),
) -> dict[str, Any]:
    """The named summits around an eye, placed where it sees them.

    Each comes with its bearing, its distance and the elevation angle its top
    stands at from `altitude`, on the same refracting sphere as the panorama.
    Whether a summit is in sight is the panorama's to say, so every one is
    sent and the picture decides.

    Answers at once with the names known so far: `pending` counts the areas
    still being asked of OpenStreetMap, and the view asks again until none are
    left; `failed` counts those no server would answer just now.
    """
    radius = min(far, PEAK_RADIUS_MAX)
    known = peaks.known_around(lat, lon, radius)
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
        "peaks": rows, "pending": known.pending, "failed": known.failed, "credits": [OSM_CREDIT],
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
