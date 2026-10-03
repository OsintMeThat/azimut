"""REST API for the Satellite tool: providers, tile proxy, capture crops."""

from __future__ import annotations

import json
import math
import os
import re
import tempfile
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
# Aliased: this module already imports the ``time`` module for tile timing, and
# the sky routes need the datetime classes of the same names.
from datetime import date as calendar_date, datetime, time as wall_clock, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel, Field

from .. import config, errors
from ..engine.analysis_models import Zone
from ..engine import (
    cities,
    firms,
    firmspoints,
    geo,
    google_tiles,
    localtime,
    media as media_engine,
    satellite as satellite_engine,
    sentinel,
    sky,
    tilecache,
    tiles,
    wayback,
)
from ..workspace import Case, CaseError
from . import events
from .cases import delete_by_path, get_case
from .limits import MAX_IMAGE_BYTES
from .naming import slugify
from .media import with_thumb_state
from .. import layout

router = APIRouter(prefix="/api", tags=["satellite"])

# How many layers a search for the Sentinel-1 one may ask about, each a request.
MAX_RADAR_PROBES = 6


# A live map pans through dozens of tiles at once, all proxied through here. A
# fresh connection per tile means a TCP + TLS handshake per tile — the dominant
# cost, and worst on Windows, where the loopback hop and Defender's per-request
# scan pile on. One pooled client keeps connections alive across tiles instead.
# httpx.Client is safe to share across the threadpool the sync routes run in.
_tile_client: httpx.Client | None = None


def _client() -> httpx.Client:
    global _tile_client
    if _tile_client is None:
        _tile_client = httpx.Client(
            follow_redirects=True,
            timeout=20,
            limits=httpx.Limits(max_keepalive_connections=16, max_connections=32),
            headers={"User-Agent": tiles.USER_AGENT},
        )
    return _tile_client


class CaptureIn(BaseModel):
    lat: float = Field(ge=-90, le=90)  # crop frame center
    lon: float = Field(ge=-180, le=180)
    zoom: int = Field(ge=1, le=22)
    width: int = Field(default=1000, ge=256, le=tiles.SIZE_MAX)
    height: int = Field(default=700, ge=256, le=tiles.SIZE_MAX)
    provider: str = "esri-world-imagery"
    bearing: float = Field(default=0.0, ge=0, le=360)
    # acquisition date of the underlying imagery (Esri best-effort), resolved
    # client-side and recorded next to the capture timestamp (fetched_at)
    imagery_date: str | None = None
    # false when that date is a provider's estimate rather than a named pass
    imagery_exact: bool = True
    # marker (recorded point of interest): style + optional offset from center
    marker_style: str = Field(default="crosshair", pattern="^(crosshair|pin|none)$")
    marker_x: int = Field(default=0, ge=-tiles.SIZE_MAX, le=tiles.SIZE_MAX)
    marker_y: int = Field(default=0, ge=-tiles.SIZE_MAX, le=tiles.SIZE_MAX)
    marker_lat: float | None = Field(default=None, ge=-90, le=90)
    marker_lon: float | None = Field(default=None, ge=-180, le=180)
    # burn a scale bar and a north arrow into the crop (capture menu)
    scale_north: bool = False


class PlaceIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    zoom: int = Field(default=16, ge=1, le=22)
    bearing: float = Field(default=0.0, ge=0, le=360)
    title: str | None = None
    notes: str | None = None
    folder: str | None = None


class ParseIn(BaseModel):
    #: One coordinate, however it is spelled. Bounded on the field rather than through
    #: `server.BulkBodyLimit`: the middleware is for bodies too big to parse, and a
    #: position never is — what this stops is a paste into the box arriving as a document.
    text: str = Field(max_length=2000)


class SatelliteUpdateIn(BaseModel):
    path: str
    notes: str | None = None
    title: str | None = None
    folder: str | None = None


class GridSaveIn(BaseModel):
    # The whole grid spec, built and owned by the client (lib/gridSearch.js).
    # Stored under search/, one file per grid; the server only stamps +
    # sanity-checks it. A human title rides alongside for the picker.
    spec: dict[str, Any]
    title: str | None = None
    #: Which revision of the file this spec was built from, when the client is
    #: replacing a grid rather than creating one. A sweep is worked from the app
    #: and from the capture extension against one file, so a whole-spec save
    #: arriving from an older copy is refused instead of putting back the marks
    #: the other side has since made.
    #:
    #: A counter rather than ``updated_at``: timestamps here are second
    #: resolution, and two writes inside one second carry the same string — which
    #: is exactly the case this guard exists for. Omitted means "I am not
    #: claiming to know" and the save goes through.
    base_revision: int | None = None


# Search grids are saved sweeps a case can hold several of (spec §5 "Grid
# Search"): JSON specs under search/, each a working aid, not a filed entity.
GRID_STATUSES = {"cleared", "flagged"}
GRID_MAX_STATUSES = 50000


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _units() -> str:
    """The analyst's measurement system, for anything drawn with a number on it.

    Presentation only, as every display preference is: the capture's own
    provenance keeps metres whatever the bar says.
    """
    return config.load_settings().get("units", "metric")


def saved_changed(case: Case) -> None:
    """Say that this case's saved work moved (``api/events.py``).

    The Saved panel is drawn in two places at once — the app's own map, and every
    map panel the extension has open — and only one of them made the request that
    got here. The other hears this and re-reads the index; the one that wrote it
    re-reads a list it already has, which costs a few KB over loopback and is the
    price of not having to tell each surface which of them was the author.
    """
    events.publish({"type": "saved", "case_id": case.id})


# A save waits this long for a country, and no longer. Online, the answer is
# there in a few hundred milliseconds and the item lands in the Saved panel
# already grouped; offline, the save is a fraction of a second slower and the
# item lands under Unlocated for the Locate pass to pick up.
SAVE_LOOKUP_TIMEOUT = 4


def locate_on_save(case: Case, entity_id: str, lat: Any, lon: Any) -> None:
    """Resolve a freshly saved item's country, so it is filed where it belongs
    the moment it appears in the Saved panel.

    The entity is written *before* this runs and this never raises, so saving
    cannot fail because of Nominatim — the worst case is a bounded wait and a
    ``failed`` verdict the Locate pass retries. An item with no position is
    settled on the spot: there is nothing to look up.
    """
    satellite_engine.resolve_geo(case, entity_id, lat, lon, SAVE_LOOKUP_TIMEOUT)


@router.get("/satellite/providers")
def providers() -> list[dict[str, Any]]:
    # the user's per-provider eco threshold (Settings) beats the provider's
    # own default; the frontend falls back to the global one when both absent
    eco_overrides = config.load_settings().get("eco_max_zooms", {})
    return [
        {
            "id": p.id,
            "label": p.label,
            "url": p.url,
            "attribution": p.attribution,
            "max_zoom": p.max_zoom,
            # deepest zoom with real pixels; null = same as max_zoom. The live
            # map stops its requests there and magnifies the last native tile
            # instead of asking for one that doesn't exist.
            "max_native_zoom": p.max_native_zoom,
            "needs_key": p.needs_key,
            "imagery": p.imagery,
            "capturable": p.capturable,
            "cacheable": p.cacheable,
            "session": p.session,
            "meter": p.meter,
            "tile_size": p.tile_size,
            "oversample": p.oversample,
            "widget": p.widget,
            "eco_max_zoom": (
                p.eco_max_zoom
                if p.widget  # the widget's pinned 0 is not user-tunable
                else eco_overrides.get(p.meter, p.eco_max_zoom)
            ),
        }
        for p in tiles.all_providers()
    ]


def _sentinel_instance() -> str:
    key = (config.load_settings().get("api_keys") or {}).get("sentinelhub")
    if not key:
        raise HTTPException(status_code=404, detail="no Sentinel Hub key saved")
    return key


@router.get("/satellite/sentinel/layers")
def sentinel_layers(check: bool = False) -> dict[str, Any]:
    """The Sentinel-2 layers on offer.

    Without ``check`` this is the built-in catalogue and touches nothing —
    opening the Satellite tab must never phone out (local-first). ``check=true``
    asks the user's own instance what it really serves (GetCapabilities), which
    is the only authority: a configuration can rename or drop any of them.
    """
    if not check:
        return {
            "layers": [{"id": e.id, "label": e.label, "hint": e.hint} for e in sentinel.LAYERS],
            "source": "catalogue",
        }
    try:
        found = sentinel.capabilities_layers(_sentinel_instance())
    except HTTPException:
        raise
    except Exception as exc:
        # the catalogue still works — say why the real list is missing, don't fail
        return {
            "layers": [{"id": e.id, "label": e.label, "hint": e.hint} for e in sentinel.LAYERS],
            "source": "catalogue",
            "detail": f"could not read the instance's layers: {tiles.upstream_failure(exc)}",
        }
    if not found:
        return {
            "layers": [{"id": e.id, "label": e.label, "hint": e.hint} for e in sentinel.LAYERS],
            "source": "catalogue",
            "detail": "the instance listed no layers",
        }
    return {"layers": found, "source": "instance"}


@router.get("/satellite/sentinel/dates")
def sentinel_dates(
    lat: float, lon: float, start: str, end: str,
    collection: Literal["sentinel2", "sentinel1"] = "sentinel2",
) -> dict[str, Any]:
    """Sentinel-2 acquisition dates over a point, newest first, or Sentinel-1 passes.

    User-triggered only (a date picker being opened/moved) — never on mount.
    Billed as one request on the sentinelhub meter: a WFS query is ~0.01 PU
    against a tile's 1 PU, but it is one request against the request quota, and
    the meter's job is to count what the account is charged for.
    """
    instance = _sentinel_instance()
    if config.usage_blocked("sentinelhub"):
        raise HTTPException(
            status_code=429,
            detail=f"Sentinel Hub is paused: {int(config.BLOCK_SHARE * 100)}% of the monthly "
            "free tier is used; enable the override in Settings to keep going",
        )
    try:
        found = sentinel.dates(instance, lat, lon, start, end, collection=collection,
                               on_request=_count_sentinel_request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"date lookup failed: {tiles.upstream_failure(exc)}") from exc
    return {"dates": found, "start": start, "end": end}


def _count_sentinel_request() -> None:
    """One catalogue page asked of Sentinel Hub, on its meter."""
    config.record_usage("sentinelhub", 1)


class AcquisitionQuery(BaseModel):
    """The drawn areas a sweep would cover, and the window to look in."""

    zones: list[Zone] = Field(min_length=1, max_length=32)
    start: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    end: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    # Radar methods sweep Sentinel-1 passes, which come with a time and a direction.
    collection: Literal["sentinel2", "sentinel1"] = "sentinel2"


@router.post("/satellite/sentinel/acquisitions")
def sentinel_acquisitions(body: AcquisitionQuery) -> dict[str, Any]:
    """Sentinel-2 passes over drawn areas, each with the share of them it covers.

    The question a crosshair lookup cannot answer. An analysis sweep fixes an
    area, and Sentinel-2's swath does not care where that area's centre is: a
    day can reach two thirds of it and leave the rest nodata. Asked before the
    run, that is a number on a row; discovered after it, it is a sweep paid for
    in tiles that found nothing.

    User-triggered only. Billed as one request a catalogue page on the
    sentinelhub meter, which is one for most windows.
    """
    instance = _sentinel_instance()
    if config.usage_blocked("sentinelhub"):
        raise HTTPException(
            status_code=429,
            detail=f"Sentinel Hub is paused: {int(config.BLOCK_SHARE * 100)}% of the monthly "
            "free tier is used; enable the override in Settings to keep going",
        )
    try:
        found = sentinel.acquisitions(
            instance, [list(zone.ring()) for zone in body.zones], body.start, body.end,
            collection=body.collection, on_request=_count_sentinel_request,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"pass lookup failed: {tiles.upstream_failure(exc)}") from exc
    return {**found, "start": body.start, "end": body.end}


class RadarLayerQuery(BaseModel):
    """A layer to check, or none to look for one."""

    layer: str = Field(default="", pattern=r"^$|^[A-Z0-9_]{1,40}$")


@router.post("/satellite/sentinel1/layer")
def sentinel1_layer(body: RadarLayerQuery) -> dict[str, Any]:
    """Find or check the Sentinel-1 layer Detect's radar methods read, and keep it.

    Copernicus says which collections an instance's layers read (WFS, free) but
    not which layer reads which, so each candidate is asked with one tiny render
    that only a Sentinel-1 layer with VV and VH can answer. Looking skips the
    layers the Sentinel-2 templates ship and stops at the first that answers.
    User-triggered only; every probe is one request on the meter.
    """
    instance = _sentinel_instance()
    if config.usage_blocked("sentinelhub"):
        raise HTTPException(
            status_code=429,
            detail=f"Sentinel Hub is paused: {int(config.BLOCK_SHARE * 100)}% of the monthly "
            "free tier is used; enable the override in Settings to keep going",
        )
    try:
        if body.layer:
            candidates = [body.layer]
        else:
            if not sentinel.serves_sentinel1(instance):
                return {"ok": False, "layer": "", "serves": False, "tried": [],
                        "detail": "this instance has no Sentinel-1 layer yet"}
            candidates = [entry["id"] for entry in sentinel.capabilities_layers(instance)
                          if entry["id"] not in sentinel.TEMPLATE_LAYERS][:MAX_RADAR_PROBES]
        tried: list[dict[str, Any]] = []
        for layer in candidates:
            try:
                answer = sentinel.probe_sar_layer(instance, layer)
            finally:
                config.record_usage("sentinelhub", 1)
            tried.append(answer)
            if answer["ok"]:
                config.update_settings(lambda settings: settings.update(sentinel1_layer=layer))
                return {**answer, "serves": True, "tried": tried}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"layer check failed: {tiles.upstream_failure(exc)}") from exc
    detail = (tried[-1]["detail"] if body.layer and tried else
              "no layer of this instance reads Sentinel-1 VV and VH")
    return {"ok": False, "layer": body.layer, "serves": None if body.layer else True,
            "tried": tried, "detail": detail}


@router.get("/satellite/sentinel/coverage")
def sentinel_coverage(
    lat: float, lon: float, layer: str, date: str, maxcc: int = sentinel.DEFAULT_MAXCC
) -> dict[str, Any]:
    """Verify a candidate date against the configured layer at the crosshair.

    ``maxcc`` is the cloud ceiling the map will render with: above it Sentinel
    Hub returns nothing, so a probe run at a different ceiling would answer a
    question the user didn't ask.
    """
    instance = _sentinel_instance()
    if config.usage_blocked("sentinelhub"):
        raise HTTPException(
            status_code=429,
            detail=f"Sentinel Hub is paused: {int(config.BLOCK_SHARE * 100)}% of the monthly "
            "free tier is used; enable the override in Settings to keep going",
        )
    try:
        result = sentinel.coverage(instance, lat, lon, layer, date, maxcc)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"coverage check failed: {tiles.upstream_failure(exc)}") from exc
    config.record_usage("sentinelhub", 1)
    return result


@router.get("/satellite/wayback/releases")
def wayback_releases() -> dict[str, Any]:
    """Every World Imagery Wayback release, newest first.

    Asked when the analyst shows the Wayback basemap, never on mount: it is a
    request to Esri. Key-less and unmetered.
    """
    try:
        listed = wayback.releases()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"could not read the release list: {tiles.upstream_failure(exc)}") from exc
    return {"releases": [{"release": r.number, "date": r.date} for r in listed]}


@router.get("/satellite/wayback/changes")
def wayback_changes(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    zoom: int = Query(ge=1, le=22),
) -> dict[str, Any]:
    """The distinct pictures of a point, newest first, each with the release
    that first published it, that release's date, and when it was taken.

    A few small requests per picture found, so it is asked only when the
    analyst asks for the changes, and answered from memory for the same tile
    afterwards. The release dates come from the list the walk has just read.
    """
    try:
        found = wayback.local_changes(lat, lon, zoom)
        listed = wayback.releases()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"could not read this point's history: {tiles.upstream_failure(exc)}") from exc
    published = {release.number: release.date for release in listed}
    return {
        "changes": [
            {
                "release": c.release,
                "date": published.get(c.release),
                "acquired": c.acquired,
                "source": c.source,
            }
            for c in found
        ],
        "zoom": min(zoom, wayback.MAX_ZOOM),
    }


@router.post("/satellite/usage/{meter}")
def record_widget_usage(meter: str) -> dict[str, Any]:
    """Count one billed *map load* for a widget basemap.

    Tile meters are counted server-side by the proxy, but a widget (Maps JS)
    instantiates in the browser — the frontend reports each instantiation
    here so the Settings counter stays a faithful mirror of Google's billing.
    """
    known = {p.meter for p in tiles.all_providers() if p.widget}
    if meter not in known:
        raise HTTPException(status_code=404, detail=f"no widget meter '{meter}'")
    return {"count": config.record_usage(meter, 1)}


def _serve_tile(
    provider: tiles.Provider, z: int, x: int, y: int
) -> tuple[bytes, str, dict[str, str]] | Response | None:
    """One tile: disk cache first (cacheable providers), then upstream.

    Returns ``(content, media_type, headers)`` for a served tile, ``None`` when
    the provider has no imagery there (404 or a known placeholder tile), or a
    passthrough ``Response`` for any other upstream error. The meter counts
    exactly what the provider billed: every upstream 2xx/3xx, never a cache hit.
    """
    if provider.cacheable:
        cached = tilecache.get(provider.id, z, x, y)
        if cached:
            return cached[0], cached[1], {"Cache-Control": "private, max-age=86400"}

    upstream: httpx.Response | None = None
    for attempt in (1, 2):
        try:
            url = tiles.tile_url(tiles.resolve_url(provider), z, x, y, provider.zoom_offset)
        except tiles.TileFetchError as exc:
            # a session mint that the provider *refused* (not a network hiccup)
            # is an auth verdict — Google's EEA policy block lands here with
            # its own sentence. Bench the basemap so it isn't offered dead.
            if provider.meter and isinstance(
                exc.__cause__, google_tiles.GoogleSessionError
            ):
                config.record_provider_status(provider.meter, False, str(exc.__cause__))
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        try:
            upstream = _client().get(url)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"tile fetch failed: {tiles.upstream_failure(exc)}") from exc
        # a stale Google session token answers 401/403 — re-mint once, transparently
        if attempt == 1 and provider.session and upstream.status_code in (401, 403):
            google_tiles.invalidate(google_tiles.key_from_url(provider.url))
            continue
        break

    assert upstream is not None  # the loop always assigns it before breaking
    if upstream.status_code == 404:
        return None
    if upstream.status_code >= 400:
        # a 401/403 that survived the re-mint retry names the key, not the
        # tile: record it (with the provider's own sentence when it sent one)
        # so the basemap stops being offered until the key changes or re-tests
        if provider.meter and upstream.status_code in (401, 403):
            config.record_provider_status(
                provider.meter, False, google_tiles.error_message(upstream)
            )
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type", "image/png"),
        )
    if provider.meter:
        config.record_usage(provider.meter, 1)
    if tiles.is_placeholder_tile(upstream.content):
        return None  # billed above (the provider did serve it), but not imagery
    media_type = upstream.headers.get("content-type", "image/png")
    if provider.cacheable:
        tilecache.put(provider.id, z, x, y, upstream.content, media_type)
    headers = {}
    if upstream.headers.get("cache-control"):
        headers["Cache-Control"] = upstream.headers["cache-control"]
    return upstream.content, media_type, headers


def _native_grid_zoom(provider: tiles.Provider) -> int | None:
    """The provider's native ceiling in *tile-grid* levels, or None if it has
    pixels everywhere it can be viewed.

    ``max_native_zoom`` is a view zoom, like ``max_zoom``; the proxy speaks the
    grid, which a big tile shifts down (512px → one level).
    """
    if provider.max_native_zoom is None:
        return None
    import math

    z_shift = int(math.log2(provider.tile_size // tiles.TILE_SIZE))
    return provider.max_native_zoom - z_shift


@router.get("/tiles/{provider_id}/{z}/{x}/{y}")
def tile_proxy(provider_id: str, z: int, x: int, y: int) -> Response:
    """Live-map tiles for every provider, proxied through the app.

    Why a proxy (docs/IMAGERY_PROVIDERS.md): API keys and the Google
    session token never reach the browser; the meter counts *exactly* what a
    billed provider serves (a browser cache hit never reaches this endpoint);
    cacheable providers get the shared disk tile cache; and coverage gaps
    (404s / "not yet available" placeholders) are overzoomed — the parent
    tile's quadrant upscaled — instead of breaking the map.
    """
    try:
        provider = tiles.get_provider(provider_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if z < 0 or z > provider.max_zoom:
        raise HTTPException(status_code=422, detail="tile zoom out of range")
    grid_size = 1 << z
    if not (0 <= x < grid_size) or not (0 <= y < grid_size):
        raise HTTPException(status_code=422, detail="tile coordinates out of range")
    if provider.meter and config.usage_blocked(provider.meter):
        raise HTTPException(
            status_code=429,
            detail=f"{provider.label} is paused: {int(config.BLOCK_SHARE * 100)}% of the "
            "monthly free tier is used; enable the override in Settings to keep going",
        )

    # Past the provider's native ceiling there is nothing new upstream: Sentinel
    # Hub would upsample its own z14 pixels and bill every tile of it. Skip the
    # fetch and let the climb below magnify the native tile instead — same
    # pixels, no quota. The live map already stops asking at that level, so this
    # is the guard for anything that doesn't.
    native_z = _native_grid_zoom(provider)
    beyond_native = max(0, z - native_z) if native_z is not None else 0
    served = None if beyond_native else _serve_tile(provider, z, x, y)
    if isinstance(served, Response):
        return served
    if served is not None:
        content, media_type, headers = served
        return Response(content=content, media_type=media_type, headers=headers)

    # no imagery at this zoom — climb parents and upscale the matching quadrant
    import io

    first = max(1, beyond_native)
    for up in range(first, first + tiles.OVERZOOM_LEVELS):
        if z - up < 0:
            break
        parent = _serve_tile(provider, z - up, x >> up, y >> up)
        if parent is None or isinstance(parent, Response):
            continue
        try:
            image = Image.open(io.BytesIO(parent[0])).convert("RGB")
        except OSError:
            # A provider can answer 200 with something that is not an image — an
            # error document, an empty body. That parent is no use, and the next
            # level up may well be: climbing on is the same answer as a missing
            # tile, where a 500 would break the map over a gap it is here to fill.
            continue
        sub = image.width >> up
        if sub < 1:
            break
        mask = (1 << up) - 1
        qx, qy = (x & mask) * sub, (y & mask) * sub
        tile = image.crop((qx, qy, qx + sub, qy + sub)).resize(
            (image.width, image.width), Image.Resampling.LANCZOS
        )
        buf = io.BytesIO()
        tile.save(buf, format="PNG")
        return Response(
            content=buf.getvalue(),
            media_type="image/png",
            # derived, cheap to rebuild from the cached parent — short-lived
            headers={"Cache-Control": "private, max-age=3600", "X-Azimut-Overzoom": str(up)},
        )
    raise HTTPException(status_code=404, detail="no imagery at this location/zoom")


#: The three things a placard can turn out to mean, once the key-status
#: endpoint has said which (``firms.allowance``).
FIRMS_SPENT = "FIRMS allowance used up (5,000 per 10 minutes); it refills within ten minutes"
FIRMS_REFUSED = "FIRMS does not know this key"
FIRMS_UNSURE = "FIRMS turned this picture down without saying why; try again in a moment"
#: How long one answer from the key-status endpoint stands for the tiles of a
#: burst: a screen that hits the placard hits it a dozen times at once.
FIRMS_VERDICT_SECONDS = 15

_firms_lock = threading.Lock()
#: One status question at a time, held apart from ``_firms_lock`` so a tile
#: checking the pause never waits on NASA's answer to somebody else's placard.
_firms_asking = threading.Lock()
#: ``(monotonic, verdict)`` of the last status question.
_firms_verdict: tuple[float, str] | None = None
#: While a spent allowance pauses the layer: when it ends, on both clocks, and
#: the count FIRMS gave. Memory only: a restart forgets it, and FIRMS's own
#: ten minutes will have passed by then or be about to.
_firms_pause: dict[str, Any] = {}


def firms_paused() -> dict[str, Any] | None:
    """The pause a spent allowance put on the layer, while it lasts."""
    with _firms_lock:
        if _firms_pause and _firms_pause["until"] > time.monotonic():
            return {"until": _firms_pause["until_utc"], "used": _firms_pause["used"],
                    "of": _firms_pause["of"]}
        _firms_pause.clear()
        return None


def _firms_ask(key: str) -> str:
    """'spent', 'refused' or 'unsure', from the key-status endpoint."""
    try:
        answer = _client().get(firms.STATUS_URL, params={"MAP_KEY": key}, timeout=10)
    except Exception:
        return "unsure"
    if answer.status_code in (401, 403):
        config.record_provider_status("firms", False, firms.status_error(answer.text))
        return "refused"
    count = firms.allowance(answer.text) if answer.status_code == 200 else None
    if not count or not firms.spent(*count):
        # a count far from the limit means the window turned over meanwhile,
        # or the refusal was something else: nothing to pause for
        return "unsure"
    with _firms_lock:
        _firms_pause.update(
            until=time.monotonic() + firms.PAUSE_SECONDS,
            until_utc=(datetime.now(timezone.utc) + timedelta(seconds=firms.PAUSE_SECONDS))
            .isoformat(timespec="seconds"),
            used=count[0], of=count[1],
        )
    return "spent"


def _firms_refusal(key: str) -> HTTPException:
    """What a refusal meant, asked of the one endpoint that can say.

    The WMS's placard reads "invalid key *or* spent allowance" and is the same
    bytes either way, and the area API's refusals are a sentence nobody
    promised to keep. The key-status endpoint costs no transaction and answers a key
    it knows with its count, so a spent allowance pauses the layer instead of
    filing a good key as dead. Only a key it says it does not know is
    benched; a failure to ask says nothing about the key and benches nothing.
    """
    global _firms_verdict
    with _firms_asking:
        memo = _firms_verdict
        if memo and time.monotonic() - memo[0] < FIRMS_VERDICT_SECONDS:
            verdict = memo[1]
        else:
            verdict = _firms_ask(key)
            _firms_verdict = (time.monotonic(), verdict)
    if verdict == "spent":
        return HTTPException(status_code=429, detail=FIRMS_SPENT)
    if verdict == "refused":
        return HTTPException(status_code=502, detail=FIRMS_REFUSED)
    return HTTPException(status_code=502, detail=FIRMS_UNSURE)


def firms_key() -> str | None:
    """The FIRMS key, if the layer is usable at all.

    Same three questions a keyed basemap answers (``tiles.all_providers``): is
    there a key, has it been switched off in Settings, and was it last seen
    failing. A key known to be dead withholds the layer until it changes or a
    test passes, rather than drawing an empty map over a real one.
    """
    settings = config.load_settings()
    if not settings.get("providers_enabled", {}).get("firms", True):
        return None
    if config.provider_key_bad("firms", settings):
        return None
    return (settings.get("api_keys") or {}).get("firms")


def firms_state() -> str:
    """Why the layer can or cannot be asked, as the Layers row says it.

    ``keyed`` alone read "no key" for three different things: no key, a key
    switched off in Settings, and a key FIRMS refused. Each wants a different
    word and a different way out. FIRMS's own sentence stays with the verdict
    in Settings, where the key is.
    """
    settings = config.load_settings()
    if not (settings.get("api_keys") or {}).get("firms"):
        return "missing"
    if not settings.get("providers_enabled", {}).get("firms", True):
        return "off"
    if config.provider_key_bad("firms", settings):
        return "refused"
    return "ready"


@router.get("/firms/sensors")
def firms_sensors() -> dict[str, Any]:
    """What the fire layer can be asked, and whether it can be asked at all.

    Read on mount by the Layers panel, and again when a tile fails, so it
    touches no network: the sensors and the windows are a catalogue, the state
    is a look at settings.json, and ``paused`` is what the last refusal said.
    A layer nobody can use says so with the reason rather than failing on the
    first tile.
    """
    return {
        "keyed": bool(firms_key()),
        "state": firms_state(),
        "paused": firms_paused(),
        "sensors": [{"id": s.id, "label": s.label} for s in firms.SENSORS],
        "windows": list(firms.WINDOWS),
        "max_zoom": firms.MAX_ZOOM,
        "max_range_days": firms.MAX_RANGE_DAYS,
    }


@router.get("/firms/points/{z}/{x}/{y}")
def firms_points(
    z: int,
    x: int,
    y: int,
    sensor: str = "viirs",
    window: str = "24h",
    first: str = "",
    last: str = "",
) -> Response:
    """One vector tile of active fire detections, which the map draws itself.

    The map draws every mark, at every zoom, so a square keeps its size through
    a zoom and never waits blown up or hidden for the next level. From
    ``firmspoints.MIN_ZOOM`` in, a rolling window is cut from the points
    fetched for its cell once, footprints and all. Farther out, and for a dated
    range, the marks are read off FIRMS's own picture of the tile, one request
    a tile as before (``firmspoints.picture_tile``).

    FIRMS puts the MAP_KEY in the *path*, so a URL the browser could build would
    publish it in the page, in the network log and in a screenshot of either:
    the key stays here. Never cached to disk: the live layers are what is
    burning now, and a cached fire is a lie with a timestamp.
    """
    if not 0 <= z <= firmspoints.MAX_ZOOM:
        raise HTTPException(status_code=422, detail=f"FIRMS tiles come in zooms 0 through {firmspoints.MAX_ZOOM}")
    grid = 1 << z
    if not (0 <= x < grid) or not (0 <= y < grid):
        raise HTTPException(status_code=422, detail="tile coordinates out of range")
    try:
        firms.sensor(sensor)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    key = firms_key()
    if not key:
        raise HTTPException(status_code=404, detail="no FIRMS key saved")
    exact = window in firmspoints.DAYS_BACK and z >= firmspoints.MIN_ZOOM
    try:
        url = "" if exact else firms.tile_url(
            key, sensor_id=sensor, window=window, z=z, x=x, y=y, first=first, last=last, mark=1)
        max_age = firms.cache_seconds(window, first, last, today=datetime.now(timezone.utc).date())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if firms_paused():
        raise HTTPException(status_code=429, detail=FIRMS_SPENT)
    if exact:
        points = _firms_points_for(key, sensor, window, firms.tile_bounds(z, x, y))
        body = firmspoints.tile(points, z, x, y, window=window, now=datetime.now(timezone.utc))
    else:
        try:
            body = firmspoints.picture_tile(firms_picture(key, url), z, x, y, sensor_id=sensor)
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=502, detail="FIRMS sent a picture that could not be read") from exc
    # The browser may hold a live tile for a few minutes, long enough for a pan
    # back and short of FIRMS's own fifteen, and a past range for hours.
    return Response(
        content=body,
        media_type="application/vnd.mapbox-vector-tile",
        headers={"Cache-Control": f"private, max-age={max_age}"},
    )


def firms_picture(key: str, url: str) -> bytes:
    """One FIRMS picture, or what FIRMS said instead.

    Shared by the map's far tiles and the extension's picture (``api/ingest.py``):
    they ask for different rectangles and want exactly the same handling of a
    refusal, and FIRMS refuses by answering 200 with an XML report in the body.
    While a spent allowance pauses the layer nothing is asked at all: each
    refused picture would only add to the count that refused it.
    """
    if firms_paused():
        raise HTTPException(status_code=429, detail=FIRMS_SPENT)
    try:
        response = _client().get(url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FIRMS unreachable: {tiles.upstream_failure(exc)}") from exc
    if response.status_code >= 400 or "xml" in response.headers.get("content-type", ""):
        raise HTTPException(
            status_code=502, detail=firms.service_error(response.text) or "FIRMS refused the request"
        )
    # A key FIRMS will not accept, and an allowance spent, both come back as 200
    # and the same picture saying so. Nothing in the answer is an error, so
    # without this the map would draw that placard's pixels as fires.
    if firms.is_placard(response.content):
        raise _firms_refusal(key)
    return response.content


def firms_answer(key: str, url: str, *, mark: int, max_age: int) -> Response:
    """The extension's picture far out: FIRMS's own, dressed to read over imagery."""
    content = firms_picture(key, url)
    try:
        picture = firms.dress(content, mark)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="FIRMS sent a picture that could not be read") from exc
    return Response(
        content=picture,
        media_type="image/png",
        headers={"Cache-Control": f"private, max-age={max_age}"},
    )


#: The points behind the drawn tiles (``engine/firmspoints.py``) by source, cell
#: and day: when they stop being true, and the points. Least recently drawn
#: first, and never more than ``FIRMS_POINTS_CAP`` rows in all, about 24 MB,
#: where a week over a burning region is a few hundred thousand. Memory only:
#: a restart asks again, which a live window would soon do anyway.
FIRMS_POINTS_CAP = 1_000_000
_firms_points: OrderedDict[tuple[str, tuple[int, int], calendar_date], tuple[float, firmspoints.Points]] = OrderedDict()
_firms_rows = 0
_firms_points_lock = threading.Lock()
#: One fetch of the same days of the same cell at a time. The tiles of a screen
#: want the same cells at once, and each would otherwise pay for them.
_firms_flights: dict[tuple[str, tuple[int, int], calendar_date, int], Future[None]] = {}
#: The satellites, cells and stretches of days of a screen fetched side by
#: side, and no more at once than the connection pool keeps warm.
_firms_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="firms")


def _firms_missing(source: str, cell: tuple[int, int], days: list[calendar_date]) -> list[calendar_date]:
    """The days of a cell not held, or held past their time."""
    clock = time.monotonic()
    with _firms_points_lock:
        return [day for day in days
                if (held := _firms_points.get((source, cell, day))) is None or held[0] <= clock]


def _firms_store(source: str, cell: tuple[int, int], found: dict[calendar_date, firmspoints.Points]) -> None:
    global _firms_rows
    now = datetime.now(timezone.utc)
    clock = time.monotonic()
    with _firms_points_lock:
        for day, points in found.items():
            old = _firms_points.pop((source, cell, day), None)
            if old:
                _firms_rows -= len(old[1])
            _firms_points[(source, cell, day)] = (clock + firmspoints.fresh_seconds(day, now), points)
            _firms_rows += len(points)
        while _firms_rows > FIRMS_POINTS_CAP and len(_firms_points) > 1:
            _, (_, gone) = _firms_points.popitem(last=False)
            _firms_rows -= len(gone)


def _firms_fetch(key: str, source: str, cell: tuple[int, int], start: calendar_date, count: int) -> None:
    """Ask the area API for ``count`` days of a cell from ``start``."""
    try:
        response = _client().get(firmspoints.area_url(key, source, cell, start, count), timeout=30)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FIRMS unreachable: {tiles.upstream_failure(exc)}") from exc
    if response.status_code != 200 or not firmspoints.is_table(response.text):
        raise _firms_refusal(key)
    _firms_store(source, cell, firmspoints.parse(
        response.text, [start + timedelta(days=n) for n in range(count)]))


def _firms_flights_for(key: str, source: str, cell: tuple[int, int], days: list[calendar_date]) -> list[Future[None]]:
    """The fetches that bring a cell these days: those under way, and new ones."""
    flights = []
    with _firms_points_lock:
        for start, count in firmspoints.runs(days):
            flight = _firms_flights.get((source, cell, start, count))
            if flight is None or flight.done():
                flight = _firms_pool.submit(_firms_fetch, key, source, cell, start, count)
                _firms_flights[(source, cell, start, count)] = flight
            flights.append(flight)
        for done in [name for name, flight in _firms_flights.items() if flight.done()]:
            del _firms_flights[done]
    return flights


def _firms_points_for(
    key: str, sensor_id: str, window: str, bounds: tuple[float, float, float, float]
) -> firmspoints.Points:
    """Every point a picture may draw, fetched once for all the pictures after it.

    Every source, cell and stretch of days missing is asked at once, and a
    picture waits for them all: a picture short of one satellite would look
    whole and not be.
    """
    days = firmspoints.days_for(window, datetime.now(timezone.utc))
    wanted = [(source, cell) for source in firmspoints.SOURCES[sensor_id] for cell in firmspoints.cells_for(bounds)]
    flights = [flight for source, cell in wanted if (missing := _firms_missing(source, cell, days))
               for flight in _firms_flights_for(key, source, cell, missing)]
    for flight in flights:
        flight.result()
    parts = []
    with _firms_points_lock:
        for source, cell in wanted:
            for day in days:
                held = _firms_points.get((source, cell, day))
                if held:
                    _firms_points.move_to_end((source, cell, day))
                    parts.append(held[1])
    return firmspoints.Points.join(parts)


def firms_drawn(
    key: str, *, sensor_id: str, window: str, bounds: tuple[float, float, float, float], width: int, height: int
) -> Response:
    """The extension's picture close in, drawn here from the same points the map's tiles are cut from.

    The pause holds here as it does for the WMS: a spent allowance asks nothing.
    """
    if firms_paused():
        raise HTTPException(status_code=429, detail=FIRMS_SPENT)
    points = _firms_points_for(key, sensor_id, window, bounds)
    picture = firmspoints.render(points, bounds, width, height, sensor_id=sensor_id, window=window,
                                 now=datetime.now(timezone.utc))
    return Response(
        content=picture,
        media_type="image/png",
        headers={"Cache-Control": f"private, max-age={firms.LIVE_CACHE_SECONDS}"},
    )


@router.get("/satellite/imagery-date")
def imagery_date(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    zoom: int = Query(ge=1, le=22),
    provider: str = "esri-world-imagery",
) -> dict[str, Any]:
    """Best-effort acquisition date of the imagery under a point.

    Only Esri World Imagery exposes per-scene capture dates; for any other
    provider we report ``supported: false`` so the UI can hide the readout.
    A Wayback release answers from that release's own metadata, since the
    pixels under a point differ from one release to the next.
    """
    base_id, sep, spec = provider.partition(wayback.VARIANT_SEP)
    if base_id == wayback.BASE_ID:
        try:
            number = wayback.parse_variant(spec) if sep else wayback.releases()[0].number
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except Exception:
            return {"supported": True, "date": None, "source": None}
        found = wayback.capture_date(lat, lon, int(zoom), number)
        if found is None:
            return {"supported": True, "date": None, "source": None}
        return {"supported": True, **found}
    if provider != "esri-world-imagery":
        return {"supported": False, "date": None, "source": None}
    result = tiles.esri_capture_date(lat, lon, int(zoom))
    if result is None:  # metadata service unreachable
        return {"supported": True, "date": None, "source": None}
    return {"supported": True, **result}


@router.post("/geo/parse")
def parse_coordinates(body: ParseIn) -> dict[str, Any]:
    coords = geo.parse_coords(body.text)
    if not coords:
        raise HTTPException(status_code=422, detail="could not parse coordinates")
    lat, lon = coords
    return {
        "lat": lat,
        "lon": lon,
        # flat keys the Post Composer reads by name
        "dms": geo.to_dms(lat, lon),
        "plus_code": geo.plus_code(lat, lon),
        # the Coordinates tool renders this ordered list wholesale
        "formats": geo.all_formats(lat, lon),
    }


@router.get("/geo/geocode")
def geocode(q: str) -> dict[str, Any]:
    query = q.strip()
    if not query:
        raise HTTPException(status_code=422, detail="empty query")
    # Already a point (a Sheet cell holding coordinates, say): read here, never sent.
    parsed = geo.parse_coords(query)
    if parsed:
        return {"lat": parsed[0], "lon": parsed[1], "display_name": None, "attribution": None}
    result = geo.geocode(query)
    if not result:
        raise HTTPException(status_code=404, detail="no match for that place name")
    return result


@router.get("/geo/suggest")
def suggest_offline(
    q: str, limit: int = Query(default=8, ge=1, le=20)
) -> dict[str, Any]:
    """What the search bar can offer on a keystroke, without touching the network.

    Two things: the coordinates the text parses to, if it parses, and cities from
    the bundled gazetteer. The geocoder is deliberately not consulted here — see
    `/geo/places`, which the UI only calls once typing stops.
    """
    query = q.strip()
    parsed = geo.parse_coords(query) if query else None
    found = cities.search(query, limit) if query else []
    return {
        "coords": {"lat": parsed[0], "lon": parsed[1]} if parsed else None,
        "cities": found,
        "attribution": cities.ATTRIBUTION if found else None,
    }


@router.get("/geo/places")
def suggest_places(q: str, limit: int = Query(default=5, ge=1, le=10)) -> dict[str, Any]:
    """Geocoder matches for a partial place name: the slow layer under `/geo/suggest`.

    Never called on a keystroke. `busy` says the request was dropped rather than
    queued, which is not the same as the geocoder having nothing.
    """
    query = q.strip()
    if not query:
        raise HTTPException(status_code=422, detail="empty query")
    # A coordinate is nobody's place name, and sending the analyst's point to an
    # outside geocoder is a leak with nothing to gain: `/geo/suggest` reads it.
    if geo.parse_coords(query):
        return {"places": [], "busy": False, "throttled": False, "attribution": None}
    found = geo.suggest(query, limit)
    if found is None:
        return {"places": [], "busy": True, "throttled": geo.throttled(), "attribution": None}
    return {
        "places": found,
        "busy": False,
        "throttled": False,
        "attribution": "© OpenStreetMap contributors (Nominatim)" if found else None,
    }


@router.get("/geo/reverse")
def reverse(lat: float, lon: float) -> dict[str, Any]:
    result = geo.reverse_geocode(lat, lon)
    if not result:
        raise HTTPException(status_code=502, detail="reverse geocoding unavailable")
    return result


def _dated(moment: datetime | None, zone: str) -> dict[str, Any] | None:
    return localtime.both(moment, zone)


@router.get("/geo/sky")
def sky_for_point(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    day: str | None = Query(default=None, alias="date"),
    at: str | None = Query(default=None, alias="time"),
    zone: str | None = None,
) -> dict[str, Any]:
    """Sun and moon for a point on one local day, plus the track of that day.

    Pure computation, unlike the reverse geocode two routes up: nothing here goes
    to the network, so the panel works offline.

    ``date`` and ``time`` are read as local wall-clock readings in the point's own
    zone, since that is how the analyst writes them. Every instant comes back in
    both civil local time and UTC, and polar day, polar night and a day without a
    moonrise arrive as a ``state`` rather than as an error.
    """
    # A zone resolved from the coordinate always loads. One the caller named is
    # checked here rather than falling back to UTC, which would answer in UTC
    # under the name that was asked for — every time in the response wrong, and
    # nothing saying so.
    if zone and not localtime.known_zone(zone):
        raise HTTPException(status_code=422, detail="zone must be an IANA zone name")
    zone_name = zone or localtime.zone_for(lat, lon)
    tz = localtime.zone_info(zone_name)
    try:
        target = calendar_date.fromisoformat(day) if day else datetime.now(tz=tz).date()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD") from exc
    if at:
        try:
            clock = wall_clock.fromisoformat(at)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="time must be HH:MM") from exc
        moment = localtime.at_local(target, clock, zone_name)
    else:
        # No time asked for: read the sky at local midday, a neutral instant that
        # is inside the day the caller named whatever the zone does.
        moment = localtime.local_noon(target, zone_name)

    start, end = localtime.day_bounds(target, zone_name)
    events = sky.day_events(lat, lon, start, end)
    now = sky.position_at(lat, lon, moment)
    curve = sky.day_curve(lat, lon, start, end, step_minutes=10)
    # The offset is the one in force at the moment asked about, not the zone's
    # standard one, so the local column can be labelled CEST rather than CET.
    stamped = localtime.both(moment, zone_name) or {}

    return {
        "lat": lat,
        "lon": lon,
        "date": target.isoformat(),
        "zone": {
            "name": zone_name,
            "abbreviation": stamped.get("abbreviation"),
            "offset": stamped.get("offset"),
            "offset_minutes": stamped.get("offset_minutes"),
        },
        "moment": _dated(moment, zone_name),
        "sun": {
            "rise": _dated(events["sun"]["rise"], zone_name),
            "rise_azimuth": events["sun"]["rise_azimuth"],
            "set": _dated(events["sun"]["set"], zone_name),
            "set_azimuth": events["sun"]["set_azimuth"],
            "transit": _dated(events["sun"]["transit"], zone_name),
            "transit_altitude": events["sun"]["transit_altitude"],
            "state": events["sun"]["state"],
            "azimuth": round(now["sun_azimuth"], 1),
            "altitude": round(now["sun_altitude"], 1),
            "apparent_altitude": round(now["sun_apparent_altitude"], 1),
        },
        "twilight": {
            name: {
                "dawn": _dated(phase["dawn"], zone_name),
                "dusk": _dated(phase["dusk"], zone_name),
                "state": phase["state"],
            }
            for name, phase in events["twilight"].items()
        },
        "moon": {
            "rises": [_dated(m, zone_name) for m in events["moon"]["rises"]],
            "rise_azimuths": events["moon"]["rise_azimuths"],
            "sets": [_dated(m, zone_name) for m in events["moon"]["sets"]],
            "set_azimuths": events["moon"]["set_azimuths"],
            "transit": _dated(events["moon"]["transit"], zone_name),
            "transit_altitude": events["moon"]["transit_altitude"],
            "state": events["moon"]["state"],
            "azimuth": round(now["moon_azimuth"], 1),
            "altitude": round(now["moon_altitude"], 1),
            "apparent_altitude": round(now["moon_apparent_altitude"], 1),
            "illuminated": round(now["moon_illuminated"], 4),
            "phase": now["moon_phase"],
            "phase_angle": round(now["moon_phase_angle"], 1),
            "waxing": now["moon_waxing"],
            "limb_angle": round(now["moon_limb_angle"], 1),
            "limb_from_vertical": round(now["moon_limb_from_vertical"], 1),
            "distance_km": round(now["moon_distance_km"]),
        },
        "curve": {
            # Minutes from local midnight: the x axis of the chart, which has to
            # stay right on the 23- and 25-hour days.
            "minutes": [
                round((point - start).total_seconds() / 60) for point in curve["times"]
            ],
            # …and the wall clock at each of those samples, which is not derivable
            # from the minute: on the spring-forward day, 120 minutes after local
            # midnight reads 03:00, not 02:00. Whatever labels a time to the reader
            # takes it from here rather than dividing by 60.
            "clock": [
                point.astimezone(tz).strftime("%H:%M") for point in curve["times"]
            ],
            "sun_altitude": curve["sun_altitude"],
            "sun_azimuth": curve["sun_azimuth"],
            "moon_altitude": curve["moon_altitude"],
            "moon_azimuth": curve["moon_azimuth"],
            "moon_illuminated": curve["moon_illuminated"],
        },
    }


#: How wide a window the daylight ribbon answers for.
#:
#: Both a cost bound and a legibility one, and they land in the same place. The search
#: is linear in the window and this route walks it twice, once per threshold: measured
#: at 65 ms for a week and 170 ms for a month, per run. And a ribbon drawn over more
#: than a month is stripes a few pixels wide, which is moiré rather than a reading —
#: while the axis it sits under is panned, so the request repeats. Past this the answer
#: is empty and says it was cut, the way every other bounded read here does.
MAX_DAYLIGHT_DAYS = 31


def _instant(value: str, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail=f"{field} must be an ISO 8601 instant"
        ) from exc
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


@router.get("/geo/zone")
def zone_at(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
) -> dict[str, str]:
    """The civil zone at a point, for a time typed as the local time there.

    Only the name: the offset depends on the instant, daylight saving included, and
    the browser that holds the instant computes it.
    """
    return {"name": localtime.zone_for(lat, lon)}


@router.get("/geo/daylight")
def daylight_for_window(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    start: str = Query(alias="from"),
    end: str = Query(alias="to"),
) -> dict[str, Any]:
    """When it was light at a point, over a window, plus that point's civil zone.

    Pure computation like ``/geo/sky``: nothing here reaches the network, and the
    zone comes from the bundled boundaries (``engine.localtime``) rather than from a
    lookup service.

    Two runs of spans, because dusk is not a line: ``day`` is the sun above the
    horizon and ``civil`` is it above −6°, so a caller can draw the hour in between
    as what it is. Instants are UTC — the axis they land on is UTC underneath
    whatever clock it is labelled with.
    """
    first = _instant(start, "from")
    last = _instant(end, "to")
    if last <= first:
        raise HTTPException(status_code=422, detail="to must come after from")
    zone_name = localtime.zone_for(lat, lon)
    stamped = localtime.both(first, zone_name) or {}
    zone = {
        "name": zone_name,
        "abbreviation": stamped.get("abbreviation"),
        "offset": stamped.get("offset"),
        "offset_minutes": stamped.get("offset_minutes"),
    }
    if (last - first).total_seconds() > MAX_DAYLIGHT_DAYS * 86_400:
        return {"lat": lat, "lon": lon, "zone": zone, "day": [], "civil": [], "truncated": True}

    def spans(threshold: float) -> list[dict[str, str]]:
        return [
            {
                "from": span["from"].isoformat().replace("+00:00", "Z"),
                "to": span["to"].isoformat().replace("+00:00", "Z"),
            }
            for span in sky.daylight_spans(lat, lon, first, last, threshold)
        ]

    return {
        "lat": lat,
        "lon": lon,
        "zone": zone,
        "day": spans(sky.SUN_HORIZON_DEG),
        "civil": spans(sky.TWILIGHTS["civil"]),
        "truncated": False,
    }


@router.post("/cases/{case_id}/satellite/capture")
def capture(case_id: str, body: CaptureIn) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        provider = tiles.get_provider(body.provider)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        image, provenance = tiles.fetch_crop(
            body.lat, body.lon, body.zoom, body.width, body.height,
            provider, bearing=body.bearing, marker_style=body.marker_style,
            marker_x=body.marker_x, marker_y=body.marker_y,
            marker_lat=body.marker_lat, marker_lon=body.marker_lon,
            scale_north=body.scale_north, units=_units(),
        )
    except tiles.TileFetchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # network / provider failure
        raise HTTPException(status_code=502, detail=f"tile fetch failed: {tiles.upstream_failure(exc)}") from exc

    # the recorded point is the marker (== center unless it was moved off-center)
    marker_lat, marker_lon = provenance["lat"], provenance["lon"]
    label = satellite_engine.coords_label(marker_lat, marker_lon)  # user's format
    coords_dd = satellite_engine.coords_label(marker_lat, marker_lon, "dd")
    plus_code = geo.plus_code(marker_lat, marker_lon)
    provenance["plus_code"] = plus_code
    provenance["dms"] = geo.to_dms(marker_lat, marker_lon)
    # two dates ride with a capture: fetched_at (when it was captured, set by
    # fetch_crop) and imagery_date (when the satellite scene was shot, if known)
    provenance["imagery_date"] = (body.imagery_date or "").strip() or None
    if provenance["imagery_date"] and not body.imagery_exact:
        provenance["imagery_exact"] = False

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"sat_{stamp}_z{provenance['zoom']}_{provider.id}.png"

    # A capture is filed through the media pipeline so it lands in media/ (hashed,
    # thumbnailed, shown in the Media Library, openable in Inspect), but under a
    # ``capture`` entity carrying its coordinates (spec §3.5). The full capture
    # provenance rides on the media sidecar's ``source`` (type "satellite").
    result = media_engine.import_image(
        case,
        image,
        filename,
        {"type": "satellite", **provenance},
        by="satellite",
        entity_type="capture",
        extra_attrs={
            "coords": coords_dd, "lat": marker_lat, "lon": marker_lon,
            "plus_code": plus_code, "zoom": provenance["zoom"], "bearing": body.bearing,
            "provider": provenance["provider"],
        },
        title=label,
        dedupe=False,  # a capture is 1:1 with its entity — never collapse re-captures
    )
    locate_on_save(case, result["entity"]["id"], marker_lat, marker_lon)
    saved_changed(case)

    return {"path": result["item"]["path"], "title": label, **provenance}


@router.post("/cases/{case_id}/satellite/screenshot")
async def capture_screenshot(
    case_id: str,
    image: UploadFile,
    lat: float = Form(ge=-90, le=90),
    lon: float = Form(ge=-180, le=180),
    zoom: int = Form(ge=1, le=22),
    provider: str = Form(),
    bearing: float = Form(default=0.0, ge=0, le=360),
    framed: bool = Form(default=False),
    scale_north: bool = Form(default=False),
    # How many image pixels the crop holds per CSS pixel. A zoom describes CSS
    # pixels, so a 2× screen puts two of the file's pixels inside every one of
    # them — without this the bar would state twice the ground it covers.
    device_scale: float = Form(default=1.0, gt=0, le=8),
) -> dict[str, Any]:
    """File a user-made screenshot of a widget basemap as a capture.

    Widget providers (Google Maps JS) have no tiles to stitch, and the only
    image Google's terms allow out of the widget is a screenshot the user took
    themselves (Geo Guidelines: permitted with attribution). So the frontend
    grabs the screen and this endpoint files it like any capture — attribution
    burned into a footer band (never optional for Google), provenance marked
    ``method: "screenshot"``.

    ``framed`` is what keeps that provenance honest, and the two paths differ:
    a screen crop taken through the capture frame is registered, so ``lat``/
    ``lon`` are the *centre of the crop*; a pasted or dropped screenshot is
    not, so they only describe the *map view when it was filed*. Readers of the
    provenance must be able to tell which they are holding.
    """
    case = get_case(case_id)
    try:
        prov = tiles.get_provider(provider)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not prov.widget:
        # tile providers have the real capture path — a screenshot would only
        # launder away its provenance
        raise HTTPException(status_code=422, detail="screenshot captures are for widget basemaps")

    import io

    raw = await image.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"screenshot must be under {MAX_IMAGE_BYTES // 1024 // 1024} MB",
        )
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"not a readable image: {errors.explain(exc)}") from exc

    # Only onto a registered crop. A pasted screenshot's coordinates describe
    # the map view at filing time rather than the picture itself, so nothing
    # here knows what a pixel of it is worth — and a bar drawn over that would
    # be the one mark on the capture that cannot be checked.
    marks = (
        tiles.burn_scale_north(
            img,
            meters_per_pixel=tiles.meters_per_pixel(lat, zoom) / device_scale,
            bearing=bearing,
            units=_units(),
        )
        if scale_north and framed
        else None
    )

    year = datetime.now(timezone.utc).year
    attribution = f"Map data ©{year} Google"
    img = tiles.burn_attribution(img, attribution)

    label = satellite_engine.coords_label(lat, lon)
    coords_dd = satellite_engine.coords_label(lat, lon, "dd")
    plus_code = geo.plus_code(lat, lon)
    provenance: dict[str, Any] = {
        "provider": prov.id,
        "provider_label": prov.label,
        "method": "screenshot",  # user-taken screen pixels, not a stitched crop
        # True: lat/lon are the centre of a registered crop frame.
        # False: they are only the map view at filing time (pasted image).
        "framed": framed,
        "lat": lat,
        "lon": lon,
        "zoom": zoom,
        "bearing": bearing,
        "attribution": attribution,
        "attribution_burned": True,
        "marks": marks,
        "plus_code": plus_code,
        "dms": geo.to_dms(lat, lon),
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "width": img.width,
        "height": img.height,
    }

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"sat_{stamp}_z{zoom}_{prov.id}_screenshot.png"
    result = media_engine.import_image(
        case,
        img,
        filename,
        {"type": "satellite", **provenance},
        by="satellite",
        entity_type="capture",
        extra_attrs={
            "coords": coords_dd, "lat": lat, "lon": lon,
            "plus_code": plus_code, "zoom": zoom, "bearing": bearing,
            "provider": prov.id,
        },
        title=label,
        dedupe=False,
    )
    locate_on_save(case, result["entity"]["id"], lat, lon)
    saved_changed(case)
    return {"path": result["item"]["path"], "title": label, **provenance}


@router.post("/cases/{case_id}/satellite/place")
def save_place(case_id: str, body: PlaceIn) -> dict[str, Any]:
    """Save just a point (the pin, or the crop center) as a navigable ``place`` —
    no image. Clicking it in the sidebar flies the map back to it."""
    case = get_case(case_id)
    extra: dict[str, Any] = {}
    if body.notes and body.notes.strip():
        extra["notes"] = body.notes.strip()
    # Sent empty, it is a choice of no folder, so the work folder is not applied.
    if body.folder is not None:
        extra["folder"] = body.folder.strip()
    entity = satellite_engine.save_place(
        case, body.lat, body.lon, body.zoom, body.bearing, body.title, extra_attrs=extra
    )
    locate_on_save(case, entity["id"], body.lat, body.lon)
    saved_changed(case)
    return entity


@router.get("/cases/{case_id}/satellite")
def list_captures(case_id: str) -> list[dict[str, Any]]:
    # tagged like the media listing: the proof pickers render captures in small
    # cells and need the thumbnail, not the full-size crop.
    case = get_case(case_id)
    return with_thumb_state(case, satellite_engine.list_captures(case))


@router.get("/cases/{case_id}/satellite/index")
def saved_index(case_id: str) -> list[dict[str, Any]]:
    """The case's saved work — places, captures, ingested screenshots — as one
    compact list, newest first.

    This is what the Saved panel opens on: the tree, the search modal and the
    map overlay all read it and nothing else, so opening a case costs one
    request of tens of KB instead of every capture row and every image. It
    makes no network call of its own.
    """
    return satellite_engine.saved_index(get_case(case_id))


@router.get("/cases/{case_id}/satellite/media")
def media_index(case_id: str) -> list[dict[str, Any]]:
    """The case's located images and videos, one row per point, newest first.

    Read when the Saved panel's Media position is opened, never on case open:
    placing a file walks its derivation chain, which the saved index must not pay.
    """
    return satellite_engine.media_index(get_case(case_id))


@router.post("/cases/{case_id}/satellite/locate")
def locate_saved(
    case_id: str, limit: int = Query(default=10, ge=1, le=25)
) -> dict[str, Any]:
    """Resolve the country of up to ``limit`` saved items that still have none.

    Progress is the stored geography itself, so the pass resumes after a restart
    and re-running it is a no-op: ``remaining`` is what the client loops on. The
    cap keeps one request comfortably inside a timeout at Nominatim's one-per-
    second pace, which ``engine.geo`` holds in front of every lookup — including
    the second one ``locate_point`` makes for the English region name, which no
    caller can see and which used to double the real pace.

    ``throttled`` says Nominatim answered 429. A batch that resolved nothing
    because the address is in the penalty box is not the same event as a batch of
    genuine lookup failures, and the client must be able to say which.
    """
    case = get_case(case_id)
    located = failed = 0
    for entity in satellite_engine.unlocated_entities(case, limit):
        attrs = entity.get("attrs") or {}
        lat, lon = attrs.get("lat"), attrs.get("lon")
        if lat is None or lon is None:
            # nothing to look up, and nothing will ever change that
            satellite_engine.set_geo(case, entity["id"], {"state": "nocoords"})
            located += 1
            continue
        result = geo.locate_point(float(lat), float(lon))
        satellite_engine.set_geo(case, entity["id"], result)
        if result["state"] == "failed":
            failed += 1
        else:
            located += 1
    return {
        "located": located,
        "failed": failed,
        "remaining": len(satellite_engine.unlocated_entities(case)),
        "throttled": geo.throttled(),
    }


@router.delete("/cases/{case_id}/satellite")
def delete_capture(case_id: str, path: str) -> dict[str, Any]:
    # a capture is a media item: the chokepoint drops the file + thumbnail +
    # sidecar + entity, and honours whatever derives from or depends on it.
    case = get_case(case_id)
    try:
        result = delete_by_path(case, path)
        if not result["deleted"]:  # never filed as an entity: drop the files anyway
            media_engine.delete_media_files(case, path)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    saved_changed(case)
    return result


@router.patch("/cases/{case_id}/satellite")
def update_capture(case_id: str, body: SatelliteUpdateIn) -> dict[str, Any]:
    case = get_case(case_id)
    item = media_engine.read_item(case, body.path)
    if item is None:
        raise HTTPException(status_code=404, detail="capture not found")
    patch: dict[str, Any] = {}
    if body.notes is not None:
        patch["notes"] = body.notes
    # the My-work folder lives on the sidecar and is mirrored onto the entity by
    # update_media, so filing a capture stays one request
    if body.folder is not None:
        patch["folder"] = body.folder
    # empty title falls back to the coordinates (mirrored onto the entity label)
    if body.title is not None:
        source = item.get("source") or {}
        lat, lon = source.get("lat"), source.get("lon")
        label = (
            satellite_engine.coords_label(lat, lon)
            if lat is not None and lon is not None
            else ""
        )
        patch["title"] = body.title.strip() or label
    try:
        updated = media_engine.update_media(case, body.path, patch)
    except (ValueError, CaseError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    saved_changed(case)
    # flatten the capture provenance up, like the listing does, so the client
    # gets the same shape back as GET /satellite
    return {**(updated.get("source") or {}), **updated}


def _grid_number(value: Any, name: str, *, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"grid {name} must be a finite number")
    try:
        number = float(value)
    except (OverflowError, ValueError) as exc:
        raise ValueError(f"grid {name} must be a finite number") from exc
    if not math.isfinite(number):
        raise ValueError(f"grid {name} must be a finite number")
    if not low <= number <= high:
        raise ValueError(f"grid {name} is out of range")
    return number


def _validate_grid_spec(value: Any) -> dict[str, Any]:
    """Return a usable saved grid or raise a concise corruption error."""
    if not isinstance(value, dict):
        raise ValueError("grid root must be an object")
    if value.get("azimut_grid") != 1:
        raise ValueError("grid schema is not supported")
    cell_m = _grid_number(value.get("cell_m"), "cell size", low=1, high=1_000_000)
    anchor = value.get("anchor")
    if not isinstance(anchor, dict):
        raise ValueError("grid anchor must be an object")
    _grid_number(anchor.get("lat"), "anchor latitude", low=-90, high=90)
    _grid_number(anchor.get("lon"), "anchor longitude", low=-180, high=180)
    lat_step = _grid_number(value.get("lat_step"), "latitude step", low=0, high=180)
    lon_step = _grid_number(value.get("lon_step"), "longitude step", low=0, high=360)
    if cell_m <= 0 or lat_step <= 0 or lon_step <= 0:
        raise ValueError("grid size and steps must be positive")

    aoi = value.get("aoi")
    if not isinstance(aoi, dict):
        raise ValueError("grid area must be an object")
    if aoi.get("type") == "rect":
        bounds = aoi.get("bounds")
        if not isinstance(bounds, dict):
            raise ValueError("grid rectangle bounds must be an object")
        south = _grid_number(bounds.get("south"), "south bound", low=-90, high=90)
        north = _grid_number(bounds.get("north"), "north bound", low=-90, high=90)
        west = _grid_number(bounds.get("west"), "west bound", low=-180, high=180)
        east = _grid_number(bounds.get("east"), "east bound", low=-180, high=180)
        if south >= north or west >= east:
            raise ValueError("grid rectangle bounds are empty or reversed")
    elif aoi.get("type") == "polygon":
        vertices = aoi.get("vertices")
        if not isinstance(vertices, list) or len(vertices) < 3:
            raise ValueError("grid polygon needs at least three vertices")
        for index, vertex in enumerate(vertices):
            if not isinstance(vertex, (list, tuple)) or len(vertex) != 2:
                raise ValueError(f"grid polygon vertex {index} is invalid")
            _grid_number(vertex[0], f"polygon latitude {index}", low=-90, high=90)
            _grid_number(vertex[1], f"polygon longitude {index}", low=-180, high=180)
    else:
        raise ValueError("grid needs a rect or polygon area")

    statuses = value.get("statuses")
    if not isinstance(statuses, dict):
        raise ValueError("grid statuses must be an object")
    if len(statuses) > GRID_MAX_STATUSES:
        raise ValueError("grid has too many cells")
    for key, status in statuses.items():
        if not isinstance(key, str) or re.fullmatch(r"-?\d+:-?\d+", key) is None:
            raise ValueError("grid contains an invalid cell key")
        if status not in GRID_STATUSES:
            raise ValueError("grid contains an invalid cell status")
    if "title" in value and not isinstance(value["title"], str):
        raise ValueError("grid title must be text")
    return value


def _revision(spec: dict[str, Any]) -> int:
    """How many times this grid has been written. Absent in files saved before
    the counter existed, which read as revision zero."""
    value = spec.get("revision")
    return value if isinstance(value, int) and value >= 0 else 0


def _read_grid(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("grid file is not readable JSON") from exc
    return _validate_grid_spec(value)


def _write_grid_atomic(path: Path, spec: dict[str, Any]) -> None:
    payload = json.dumps(spec, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    tmp_path = path.with_name(os.path.basename(tmp_name))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    finally:
        tmp_path.unlink(missing_ok=True)


def apply_grid_marks(case, name: str, marks: dict[str, Any]) -> dict[str, Any]:
    """Set or clear individual cells on a saved grid, leaving the rest alone.

    A sweep is now worked from two places — the app's own map and, through the
    extension, whatever map the analyst happens to be on — against one file. The
    whole-spec save below cannot serve both: it carries every cell, so a client
    holding a copy from five minutes ago puts back the marks the other one made
    in between, and nothing says so.

    A patch has no such copy in it. `null` clears a cell, so unmarking still
    works, and two sweeps that touched different cells both land. Two that
    touched the same one resolve last-writer-wins, which is what an analyst
    marking the same cell twice would expect anyway.
    """
    spec_path = case.resolve_inside(layout.grid_rel(slugify(name, "grid")))
    # Atomic replacement protects the JSON bytes. The case lock protects the
    # read/merge/write transaction shared by app tabs and the extension.
    with case.lock:
        if not spec_path.exists():
            raise HTTPException(status_code=404, detail="grid not found")
        try:
            spec = _read_grid(spec_path)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"corrupt grid: {exc}") from exc

        revision = _revision(spec)
        statuses = dict(spec.get("statuses") or {})
        for key, value in marks.items():
            if value is None:
                statuses.pop(str(key), None)
            elif value in GRID_STATUSES:
                statuses[str(key)] = value
            else:
                raise HTTPException(status_code=400, detail=f"unknown mark: {value!r}")
        if len(statuses) > GRID_MAX_STATUSES:
            raise HTTPException(status_code=400, detail="grid has too many cells")

        spec["statuses"] = statuses
        spec["updated_at"] = _now()
        # a patch moves the file on too, so a whole-spec save built before it is
        # recognised as behind rather than written over the top
        spec["revision"] = revision + 1
        _write_grid_atomic(spec_path, spec)
        # Publish under the same lock so a later save/delete cannot announce
        # itself before this earlier mutation.
        events.publish({
            "type": "grid-marks",
            "case_id": case.id,
            "name": spec_path.stem,
            "revision": spec["revision"],
        })
    return {
        "name": spec_path.stem,
        "updated_at": spec["updated_at"],
        "revision": spec["revision"],
        "cleared": sum(1 for v in statuses.values() if v == "cleared"),
        "flagged": sum(1 for v in statuses.values() if v == "flagged"),
    }


class GridMarksBody(BaseModel):
    #: ``"i:j" -> "cleared" | "flagged" | null``, null meaning "back to
    #: unchecked". The app's own half of what the extension sends to
    #: ``/api/ingest/grid/marks``; see ``apply_grid_marks`` for why a sweep is
    #: patched rather than saved whole.
    marks: dict[str, Any]


@router.post("/cases/{case_id}/search-grids/{name}/marks")
def mark_search_grid(case_id: str, name: str, body: GridMarksBody) -> dict[str, Any]:
    """Mark cells on a saved grid without writing the rest of it.

    The app used to save a swept cell by putting its whole copy of the spec back,
    which was fine while it was the only thing sweeping. It is not: the same grid
    is worked from the extension's panel over another map, and a whole-spec save
    either loses that panel's marks or is refused as behind — and "reload it and
    redo your last mark" is a poor answer to two people sweeping one area, which
    is what a search grid is for.

    So marks travel as a patch from both sides now, and only the geometry — a
    redrawn area, a rename — still writes a spec.
    """
    return apply_grid_marks(get_case(case_id), name, body.marks)


@router.get("/cases/{case_id}/search-grids")
def list_search_grids(case_id: str) -> list[dict[str, Any]]:
    """Summaries of every saved grid, newest first, for the picker."""
    case = get_case(case_id)
    out = []
    for spec_path in case.subdir(layout.SEARCH_DIR).glob("*.json"):
        try:
            spec = _read_grid(spec_path)
        except ValueError:
            continue
        statuses = spec.get("statuses") or {}
        out.append({
            "name": spec_path.stem,
            "title": spec.get("title", spec_path.stem),
            "updated_at": spec.get("updated_at"),
            "aoi_type": (spec.get("aoi") or {}).get("type"),
            "cleared": sum(1 for v in statuses.values() if v == "cleared"),
            "flagged": sum(1 for v in statuses.values() if v == "flagged"),
        })
    out.sort(key=lambda g: g.get("updated_at") or "", reverse=True)
    return out


@router.get("/cases/{case_id}/search-grids/{name}")
def get_search_grid(case_id: str, name: str) -> dict[str, Any]:
    """One saved grid's full spec."""
    case = get_case(case_id)
    try:
        spec_path = case.resolve_inside(layout.grid_rel(name))
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not spec_path.exists():
        raise HTTPException(status_code=404, detail="grid not found")
    try:
        return _read_grid(spec_path)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"corrupt grid: {exc}") from exc


@router.put("/cases/{case_id}/search-grids/{name}")
def save_search_grid(case_id: str, name: str, body: GridSaveIn) -> dict[str, Any]:
    """Create or replace one grid. The client owns the name (a stable slug).

    This is for the shape: a fresh area, a reshaped one, a rename. A marked cell
    goes to ``/marks`` instead, so that the two surfaces sweeping one grid do not
    write over each other — see ``apply_grid_marks``.
    """
    case = get_case(case_id)
    slug = slugify(name, "grid")
    spec = dict(body.spec)
    aoi = spec.get("aoi")
    if not isinstance(aoi, dict) or aoi.get("type") not in {"rect", "polygon"}:
        raise HTTPException(status_code=400, detail="grid needs a rect or polygon aoi")
    # keep only the two real marks; a corrupt value never reaches disk
    raw = spec.get("statuses")
    statuses = {} if not isinstance(raw, dict) else {
        str(k): v for k, v in raw.items() if v in GRID_STATUSES
    }
    if len(statuses) > GRID_MAX_STATUSES:
        raise HTTPException(status_code=400, detail="grid has too many cells")
    spec["statuses"] = statuses
    spec["azimut_grid"] = 1
    if body.title is not None:
        spec["title"] = body.title
    spec.setdefault("title", slug)
    spec.setdefault("created_at", _now())
    spec["updated_at"] = _now()
    try:
        _validate_grid_spec(spec)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    spec_path = case.resolve_inside(layout.grid_rel(slug))
    with case.lock:
        on_disk = 0
        if spec_path.exists():
            try:
                on_disk = _revision(_read_grid(spec_path))
            except ValueError:
                on_disk = 0  # unreadable: the save is the repair, let it through
            if body.base_revision is not None and body.base_revision != on_disk:
                raise HTTPException(
                    status_code=409,
                    detail="this grid changed elsewhere since this copy of it was built",
                )
        spec["revision"] = on_disk + 1
        _write_grid_atomic(spec_path, spec)
        events.publish({
            "type": "grid",
            "case_id": case.id,
            "name": slug,
            "title": spec["title"],
            "revision": spec["revision"],
        })
    return {
        "name": slug,
        "title": spec["title"],
        "updated_at": spec["updated_at"],
        "revision": spec["revision"],
    }


@router.delete("/cases/{case_id}/search-grids/{name}")
def delete_search_grid(case_id: str, name: str) -> dict[str, Any]:
    """Discard one saved grid.

    The name goes through `slugify` exactly as the save did: the delete has to
    address the file the save wrote, and a raw name is one `\\` away from
    addressing a different one on Windows.
    """
    case = get_case(case_id)
    try:
        spec_path = case.resolve_inside(layout.grid_rel(slugify(name, "grid")))
    except CaseError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    with case.lock:
        existed = spec_path.exists()
        spec_path.unlink(missing_ok=True)
        if existed:
            # a panel holding this sweep open is drawing a file that is gone
            events.publish({"type": "grid-removed", "case_id": case.id, "name": spec_path.stem})
    return {"deleted": existed}
