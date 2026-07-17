"""REST API for app-wide settings: API keys, usage counters, and the signature.

Keys are the user's own billing identity (docs/IMAGERY_PROVIDERS.md): stored
locally in settings.json, app-wide (never per-case), never written into a case
folder or export bundle. Usage counters are local bookkeeping only. The
signature (the analyst's logo) follows the same rule — one file beside
settings.json, reaching a case only as pixels in a rendered proof PNG.
"""

from __future__ import annotations

import re
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import __version__, config
from ..engine import google_tiles, scrapers, sentinel, tiles

router = APIRouter(prefix="/api", tags=["settings"])

# the keyed providers the settings tab manages — matching api_keys entries
# light up the built-in basemaps (engine/tiles.py all_providers)
KEYED_PROVIDERS = ("mapbox", "google", "google_js", "sentinelhub")
# tile APIs whose eco threshold the user may tune per provider; the Maps JS
# widget is deliberately absent (eco re-bills a map load per swap — never worth it)
ECO_TUNABLE = ("mapbox", "google", "sentinelhub")

DEFAULT_HOME_VIEW = config.DEFAULT_SETTINGS["home_view"]
DEFAULT_POST_MENTION = config.DEFAULT_SETTINGS["post_mention"]


class KeysIn(BaseModel):
    # None = leave untouched; "" (or whitespace) = remove the stored key
    mapbox: str | None = None
    google: str | None = None
    # Maps JavaScript API key — the EEA-viable Google route (widget basemap)
    google_js: str | None = None
    # Sentinel Hub's "key" is a configuration-instance UUID, not a secret token
    sentinelhub: str | None = None


class HomeView(BaseModel):
    """The map view the Satellite tab opens on. Rejected outside the world."""

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    zoom: int = Field(ge=1, le=21)


class PrefsIn(BaseModel):
    """Keyed-provider and display preferences — None leaves a field untouched."""

    # {"mapbox": bool, "google": bool}: basemap on/off without touching the key
    providers_enabled: dict[str, bool] | None = None
    # {"mapbox": bool, ...}: keep serving past the 90% soft block (billed)
    usage_overrides: dict[str, bool] | None = None
    # swap billed basemaps for free imagery at low zoom (≤ eco_max_zoom)
    eco_zoom_fallback: bool | None = None
    eco_max_zoom: int | None = None  # clamped to a sane zoom range
    # per-provider eco thresholds: {"mapbox": 15, "sentinelhub": 0, ...} —
    # value None removes the override (back to provider default / global)
    eco_max_zooms: dict[str, int | None] | None = None
    # per-meter monthly free allowance: {"sentinelhub": 30000} — value None
    # restores the documented default (config.FREE_TIER)
    free_tiers: dict[str, int | None] | None = None
    # display preferences — presentation only, never touches stored artifacts
    coord_format: str | None = None  # one of config.COORD_FORMATS
    units: str | None = None  # one of config.UNIT_SYSTEMS
    home_view: HomeView | None = None  # where the Satellite tab opens
    post_mention: str | None = None  # handle a new post draft is addressed to


def _prefs(settings: dict[str, Any]) -> dict[str, Any]:
    """The preference block shared by GET /settings and PUT /settings/prefs."""
    return {
        "providers_enabled": settings.get("providers_enabled", {}),
        "usage_overrides": settings.get("usage_overrides", {}),
        "eco_zoom_fallback": bool(settings.get("eco_zoom_fallback", True)),
        "eco_max_zoom": int(settings.get("eco_max_zoom", config.ECO_MAX_ZOOM)),
        "eco_max_zooms": settings.get("eco_max_zooms", {}),
        # the user's corrections only; `free_tier` below is the resolved figure
        "free_tiers": settings.get("free_tiers", {}),
        "coord_format": settings.get("coord_format", "dd"),
        "units": settings.get("units", "metric"),
        "home_view": settings.get("home_view", DEFAULT_HOME_VIEW),
        "post_mention": settings.get("post_mention", DEFAULT_POST_MENTION),
    }


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    settings = config.load_settings()
    return {
        "api_keys": settings.get("api_keys", {}),
        "usage": settings.get("usage", {}),
        "month": config.month_key(),
        # last known health per keyed credential — Settings shows a stored
        # failure inline, and a failing key withholds its basemap (tiles.py)
        "provider_status": settings.get("provider_status", {}),
        # whether a logo is on disk — the proof composer's signature control is
        # dead until one is, so it needs to know without fetching the pixels
        "signature": config.signature_path().is_file(),
        **_prefs(settings),
        # what the soft block actually measures against: the documented default
        # per meter, or the user's own figure where they corrected it
        "free_tier": config.free_tiers(settings),
        # the shipped defaults, so Settings can show what it's departing from
        "free_tier_default": config.FREE_TIER,
        "block_share": config.BLOCK_SHARE,
        # About tab: what this build is, and where it keeps its files
        "version": __version__,
        "workspace_root": str(config.workspace_root()),
        # capture-extension pairing token (api/ingest.py) — minted on first read
        "ingest_token": config.ingest_token(),
    }


@router.put("/settings/prefs")
def put_prefs(body: PrefsIn) -> dict[str, Any]:
    settings = config.load_settings()
    if body.providers_enabled is not None:
        merged = dict(settings.get("providers_enabled", {}))
        merged.update({k: bool(v) for k, v in body.providers_enabled.items() if k in KEYED_PROVIDERS})
        settings["providers_enabled"] = merged
    if body.usage_overrides is not None:
        merged = dict(settings.get("usage_overrides", {}))
        merged.update({k: bool(v) for k, v in body.usage_overrides.items() if k in KEYED_PROVIDERS})
        settings["usage_overrides"] = merged
    if body.eco_zoom_fallback is not None:
        settings["eco_zoom_fallback"] = bool(body.eco_zoom_fallback)
    if body.eco_max_zoom is not None:
        settings["eco_max_zoom"] = max(1, min(21, int(body.eco_max_zoom)))
    if body.eco_max_zooms is not None:
        merged = dict(settings.get("eco_max_zooms", {}))
        for name, value in body.eco_max_zooms.items():
            if name not in ECO_TUNABLE:
                continue
            if value is None:
                merged.pop(name, None)  # back to provider default / global
            else:
                merged[name] = max(0, min(21, int(value)))  # 0 = eco off for it
        settings["eco_max_zooms"] = merged
    if body.free_tiers is not None:
        merged = dict(settings.get("free_tiers", {}))
        for name, value in body.free_tiers.items():
            if name not in config.FREE_TIER:
                continue
            if value is None:
                merged.pop(name, None)  # back to the documented default
            else:
                # a free tier is a positive count of requests; the ceiling is
                # only there to keep a typo from disabling the guard entirely
                merged[name] = max(1, min(10_000_000, int(value)))
        settings["free_tiers"] = merged
    if body.coord_format is not None:
        if body.coord_format not in config.COORD_FORMATS:
            raise HTTPException(status_code=422, detail=f"unknown coord_format '{body.coord_format}'")
        settings["coord_format"] = body.coord_format
    if body.units is not None:
        if body.units not in config.UNIT_SYSTEMS:
            raise HTTPException(status_code=422, detail=f"unknown units '{body.units}'")
        settings["units"] = body.units
    if body.home_view is not None:
        settings["home_view"] = body.home_view.model_dump()
    if body.post_mention is not None:
        settings["post_mention"] = body.post_mention.strip()[:64]
    config.save_settings(settings)
    return _prefs(settings)


@router.put("/settings/keys")
def put_keys(body: KeysIn) -> dict[str, Any]:
    settings = config.load_settings()
    keys = settings.setdefault("api_keys", {})
    status = settings.setdefault("provider_status", {})
    for name in KEYED_PROVIDERS:
        value = getattr(body, name)
        if value is None:
            continue
        value = value.strip()
        if value != keys.get(name):
            # a different credential gets a clean slate: the old verdict was
            # about the old key, and a stale failure would keep the basemap
            # benched (tiles.key_for) with no way back but a manual re-test
            status.pop(name, None)
        if value:
            keys[name] = value
        else:
            keys.pop(name, None)
    config.save_settings(settings)
    return {"api_keys": keys}


class StatusIn(BaseModel):
    """A browser-side key verdict (Maps JS API keys can only fail in the
    browser — `gm_authFailure` has no server-side equivalent)."""

    ok: bool
    detail: str = ""


@router.post("/settings/ingest-token/rotate")
def rotate_ingest_token() -> dict[str, Any]:
    """Mint a fresh capture-extension pairing token, orphaning every extension
    paired with the old one (each must paste the new token to reconnect)."""
    return {"ingest_token": config.ingest_token(rotate=True)}


@router.post("/settings/keys/{provider}/status")
def report_key_status(provider: str, body: StatusIn) -> dict[str, Any]:
    """Persist a key verdict the frontend established itself.

    Two callers: the Settings Test button for the Maps JS key (loads the real
    widget and listens for gm_authFailure), and the live map when a widget
    fails auth mid-session — both make tiles.all_providers withhold the dead
    basemap until the key changes or a later test passes.
    """
    if provider not in KEYED_PROVIDERS:
        raise HTTPException(status_code=404, detail=f"unknown keyed provider '{provider}'")
    config.record_provider_status(provider, body.ok, body.detail)
    return {"ok": body.ok, "detail": body.detail}


@router.post("/settings/keys/{provider}/test")
def test_key(provider: str) -> dict[str, Any]:
    """Exercise the saved key against the real service — never raises on a bad
    key, so the settings tab can show the provider's error message inline.
    Every verdict is persisted (record_provider_status): a failing key benches
    its basemap, a passing test puts it back."""
    key = (config.load_settings().get("api_keys") or {}).get(provider)
    if not key:
        raise HTTPException(status_code=404, detail=f"no {provider} key saved")

    def verdict(ok: bool, detail: str) -> dict[str, Any]:
        config.record_provider_status(provider, ok, detail)
        return {"ok": ok, "detail": detail}

    if provider == "google":
        try:
            google_tiles.invalidate(key)  # force a fresh mint — that's the test
            google_tiles.session_token(key)
            return verdict(True, "session token created")
        except Exception as exc:
            return verdict(False, str(exc))
    if provider == "google_js":
        # A JS-API key only proves itself in a browser (gm_authFailure); the
        # Settings tab runs that test and reports through /status above.
        return {"ok": None, "detail": "tested in the browser"}
    if provider == "mapbox":
        url = tiles.MAPBOX_SATELLITE_URL.replace("{key}", key).format(z=0, x=0, y=0)
        try:
            response = httpx.get(url, headers={"User-Agent": tiles.USER_AGENT}, timeout=10)
            response.raise_for_status()
            return verdict(True, "tile fetched")
        except Exception as exc:
            return verdict(False, str(exc))
    if provider == "sentinelhub":
        # One real tile over Paris (grid level 13 → TILEMATRIX 14). This checks
        # the instance id *and* that the instance actually has a TRUE_COLOR
        # layer — the wrong template answers 400 rather than a blank tile, so
        # the two mistakes a user can make here are both caught.
        url = tiles.tile_url(
            sentinel.wmts_url().replace("{key}", key), 13, 4151, 2818, zoom_offset=1
        )
        try:
            response = httpx.get(url, headers={"User-Agent": tiles.USER_AGENT}, timeout=10)
            if response.status_code == 400:
                return verdict(False, _wmts_error(response.text))
            response.raise_for_status()
            return verdict(True, "tile fetched")
        except Exception as exc:
            return verdict(False, str(exc))
    raise HTTPException(status_code=404, detail=f"unknown keyed provider '{provider}'")


def _wmts_error(body: str) -> str:
    """The human half of an OGC ExceptionReport ("Invalid instance id: …").

    Sentinel Hub says exactly what is wrong; showing that beats "400 Bad
    Request". Falls back to the raw body if it isn't the XML we expect.
    """
    match = re.search(r"<ows:ExceptionText>(.*?)</ows:ExceptionText>", body, re.S)
    return match.group(1).strip() if match else body.strip()[:200]


# ---- signature: the analyst's logo, stamped onto proofs they choose to sign ---


@router.get("/settings/signature.png")
def get_signature() -> FileResponse:
    path = config.signature_path()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no signature saved")
    return FileResponse(path, media_type="image/png")


@router.post("/settings/signature")
async def put_signature(file: UploadFile) -> dict[str, Any]:
    """Replace the stored logo. PNG only, and small — see config.PNG_MAGIC."""
    data = await file.read(config.SIGNATURE_MAX_BYTES + 1)
    if len(data) > config.SIGNATURE_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"signature must be under {config.SIGNATURE_MAX_BYTES // 1024 // 1024} MB",
        )
    # sniff the bytes rather than trust the filename or the browser's content-type
    if not data.startswith(config.PNG_MAGIC):
        raise HTTPException(status_code=422, detail="signature must be a PNG image")
    path = config.signature_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {"signature": True}


@router.delete("/settings/signature")
def delete_signature() -> dict[str, Any]:
    config.signature_path().unlink(missing_ok=True)
    return {"signature": False}


# ---- scrapers: the two dependencies that rot on someone else's schedule -------


@router.get("/settings/scrapers")
def get_scrapers(check: bool = False) -> dict[str, Any]:
    """Versions of yt-dlp/gallery-dl in use. ``check=true`` asks PyPI what's newer.

    The check is opt-in and user-triggered: Azimut is local-first, so merely
    opening Settings must never reach the network (engine/scrapers.py status()).
    """
    return {"scrapers": scrapers.status(check_pypi=check)}


@router.post("/settings/scrapers/{dist}/update")
def update_scraper(dist: str) -> dict[str, Any]:
    """Fetch the latest wheel for one scraper into the workspace.

    Never raises on a failed download — the settings tab shows the reason
    inline, the same way the API-key test does. The previous copy stays live.
    """
    if dist not in scrapers.SCRAPERS:
        raise HTTPException(status_code=404, detail=f"unknown scraper '{dist}'")
    try:
        return {"ok": True, **scrapers.update(dist)}
    except Exception as exc:
        return {"ok": False, "dist": dist, "detail": str(exc)}


@router.delete("/settings/scrapers/{dist}")
def reset_scraper(dist: str) -> dict[str, Any]:
    """Discard the updated copy and go back to the version this build shipped."""
    if dist not in scrapers.SCRAPERS:
        raise HTTPException(status_code=404, detail=f"unknown scraper '{dist}'")
    return {"ok": True, **scrapers.reset(dist)}
