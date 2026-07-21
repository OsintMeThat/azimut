"""REST API for the capture browser extension (extension/ at the repo root).

The extension screenshots a map the user is looking at — an external site
(Google Earth, Google Maps, Bing, Yandex, OSM) or this app's own Maps JS
widget basemap — and files it here as a ``capture`` entity, riding the same
media pipeline as a satellite crop so it lists, opens and exports like one.

Trust model: the server already binds localhost only, so the pairing token
(``config.ingest_token``, shown in Settings, pasted once into the extension)
exists to stop *other* local pages and processes from filing images into
cases — CSRF-by-token, not network security. CORS is opened for these routes
only, and only to browser-extension origins: no web page origin is ever
allowed, whatever token it presents.

Legal rails (docs/IMAGERY_PROVIDERS.md §0): every capture is one user-initiated
screenshot of what was already on screen — the extension never crawls,
repeats, or touches tile servers — and provenance always records the source
URL, site and timestamp. Attribution is burned into a footer band, the same
treatment the widget screenshot endpoint applies.
"""

from __future__ import annotations

import io
import json
import secrets
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Form, Header, HTTPException, Request, Response, UploadFile
from PIL import Image

from .. import __version__, config
from ..engine import geo, mapsites, media as media_engine, satellite as satellite_engine, tiles
from ..workspace import Case
from . import events
from .cases import get_case
from .limits import MAX_IMAGE_BYTES

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

# Browser extensions are the only cross-origin callers these routes accept.
EXTENSION_ORIGIN_SCHEMES = ("chrome-extension://", "moz-extension://", "safari-web-extension://")

# Attribution burned under an ingested screenshot, by parsed site id. The
# source site's own on-screen credits ride along inside the pixels; this band
# restates the operator so a cropped capture can never shed it.
ATTRIBUTIONS = {
    "google-maps": "Map data © Google",
    "google-earth": "Google Earth",
    "bing-maps": "© Microsoft — Bing Maps",
    "yandex-maps": "© Yandex Maps",
    "openstreetmap": "© OpenStreetMap contributors",
    "apple-maps": "© Apple Maps",
    "zoom-earth": "© Zoom Earth",
    "satellites-pro": "© Satellites.pro",
    "copernicus-browser": "© Copernicus Sentinel data",
}


def require_token(x_azimut_token: str = Header(default="")) -> None:
    """401 unless the request carries the pairing token. Constant-time compare;
    an unminted token ("") matches nothing."""
    expected = config.load_settings().get("ingest_token") or ""
    if not expected or not secrets.compare_digest(x_azimut_token, expected):
        raise HTTPException(status_code=401, detail="missing or invalid pairing token")


def install_cors(app) -> None:
    """CORS for /api/ingest/* only, and only for extension origins.

    Deliberately not Starlette's CORSMiddleware: that is app-wide, and opening
    the whole API to extension origins would let any installed extension call
    every route. Here the allowance is scoped twice — path prefix and origin
    scheme — and everything else keeps the browser's same-origin default.
    """
    allow_headers = {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "X-Azimut-Token, Content-Type",
        "Access-Control-Max-Age": "600",
    }

    @app.middleware("http")
    async def ingest_cors(request: Request, call_next):
        origin = request.headers.get("origin", "")
        allowed = request.url.path.startswith("/api/ingest/") and origin.startswith(
            EXTENSION_ORIGIN_SCHEMES
        )
        if allowed and request.method == "OPTIONS":
            # the custom token header makes every extension call preflight
            return Response(
                status_code=204,
                headers={"Access-Control-Allow-Origin": origin, "Vary": "Origin", **allow_headers},
            )
        response = await call_next(request)
        if allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
        return response


@router.get("/ping", dependencies=[Depends(require_token)])
def ping() -> dict[str, Any]:
    """Pairing check: the extension options page proves URL + token in one call."""
    return {"app": "azimut", "version": __version__}


@router.get("/cases", dependencies=[Depends(require_token)])
def cases() -> list[dict[str, Any]]:
    """The case picker for the extension popup — ids and names, nothing more."""
    return [
        {"id": c["id"], "name": c["name"], "scratch": bool(c.get("scratch"))}
        for c in Case.list_all()
    ]


@router.get("/parse", dependencies=[Depends(require_token)])
def parse(url: str) -> dict[str, Any]:
    """Parse a map URL for the popup's prefill (engine/mapsites.py).

    The extension deliberately contains no URL knowledge — formats race sites
    that change without notice, and an app update is easy where an extension
    update is manual. ``{"site": null}`` means "not a map: don't capture here".
    """
    return mapsites.parse_map_url(url) or {"site": None}


@router.post("/screenshot", dependencies=[Depends(require_token)])
async def ingest_screenshot(
    image: UploadFile,
    url: str = Form(min_length=1, max_length=4000),
    case_id: str = Form(default=""),
    lat: float | None = Form(default=None, ge=-90, le=90),
    lon: float | None = Form(default=None, ge=-180, le=180),
    zoom: float | None = Form(default=None, ge=0, le=23),
    bearing: float | None = Form(default=None, ge=0, lt=360),
    captured_at: str = Form(default=""),
    title: str = Form(default="", max_length=200),
    # which extension build took the shot — provenance, nothing else keys on it
    extension: str = Form(default="", max_length=32),
) -> dict[str, Any]:
    """File one user-initiated screenshot of an external map as a capture.

    The URL is the source of truth: site, coordinates, place name and imagery
    date are parsed HERE (engine/mapsites.py), never in the extension — URL
    formats race sites that change without notice, and a changed format must
    be an app update, not a manual extension reinstall. The optional form
    fields are the user's popup corrections and win over the parse; anything
    the client doesn't send, the URL fills. Coordinates stay optional as a
    pair — a URL with no position still files, fixable later in the sidebar.
    A URL that isn't a recognized map site is refused: captures are for maps
    only (legal rails). An empty ``case_id`` files into a fresh scratch
    session, the same place the app's own tools start.
    """
    parsed = mapsites.parse_map_url(url)
    if parsed is None:
        raise HTTPException(
            status_code=422, detail="not a recognized map site; captures are for maps only"
        )

    # popup corrections win; the URL fills whatever the client didn't send
    lat = lat if lat is not None else parsed["lat"]
    lon = lon if lon is not None else parsed["lon"]
    zoom = zoom if zoom is not None else parsed["zoom"]
    bearing = bearing if bearing is not None else parsed["bearing"]
    title = title.strip() or (parsed["title"] or "")
    if (lat is None) != (lon is None):
        raise HTTPException(status_code=422, detail="lat and lon come as a pair")

    raw = await image.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"screenshot must be under {MAX_IMAGE_BYTES // 1024 // 1024} MB",
        )
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"not a readable image: {exc}") from exc

    site = parsed["site"]
    attribution = ATTRIBUTIONS.get(site, f"© {urlsplit(url).netloc.lower()}")
    img = tiles.burn_attribution(img, attribution)

    case = get_case(case_id) if case_id else Case.create("Scratch session", scratch=True)

    # the client's clock is honest context, not truth — recorded alongside
    # fetched_at (the server's), never instead of it
    try:
        captured = datetime.fromisoformat(captured_at).astimezone(timezone.utc)
    except ValueError:
        captured = None

    has_coords = lat is not None and lon is not None
    label = title or (
        satellite_engine.coords_label(lat, lon) if has_coords else parsed["label"]
    )

    provenance: dict[str, Any] = {
        "method": "screenshot",  # user-taken screen pixels of an external map
        "framed": False,  # URL-derived view coords, not a registered crop
        "source_url": url,
        "site": site,
        "extension": extension.strip() or None,
        # the same slots a satellite capture fills, so every panel renders an
        # ingested screenshot identically (provider chip, imagery date)
        "provider": site,
        "provider_label": parsed["label"],
        "imagery_date": parsed["imagery_date"],
        "lat": lat,
        "lon": lon,
        "zoom": zoom,
        "bearing": bearing,
        "captured_at": captured.isoformat(timespec="seconds") if captured else None,
        "attribution": attribution,
        "attribution_burned": True,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "width": img.width,
        "height": img.height,
    }
    if has_coords:
        provenance["plus_code"] = geo.plus_code(lat, lon)
        provenance["dms"] = geo.to_dms(lat, lon)

    extra_attrs: dict[str, Any] = {"site": site, "source_url": url}
    if has_coords:
        extra_attrs.update(
            {
                "coords": satellite_engine.coords_label(lat, lon, "dd"),
                "lat": lat,
                "lon": lon,
                "plus_code": provenance["plus_code"],
            }
        )
        if zoom is not None:
            extra_attrs["zoom"] = zoom
        if bearing is not None:
            extra_attrs["bearing"] = bearing

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    result = media_engine.import_image(
        case,
        img,
        f"ingest_{stamp}_{site.replace('/', '_')}.png",
        {"type": "screenshot", **provenance},
        by="ingest",
        entity_type="capture",
        extra_attrs=extra_attrs,
        title=label,
        dedupe=False,
    )
    # nudge any open app tab so the capture shows up without a reload
    events.publish(
        {"type": "capture", "case_id": case.id, "path": result["item"]["path"],
         "title": label, "site": site}
    )
    return {
        "path": result["item"]["path"],
        "case_id": case.id,
        "title": label,
        **provenance,
    }


@router.post("/bookmark", dependencies=[Depends(require_token)])
def ingest_bookmark(
    url: str = Form(min_length=1, max_length=4000),
    case_id: str = Form(default=""),
    title: str = Form(default="", max_length=200),
) -> dict[str, Any]:
    """File a web page as a ``bookmark`` entity — a saved link, no screenshot.

    The capture flow is maps-only (legal rails); this is the other half of the
    extension popup, offered when the open page is *not* a recognized map site.
    Nothing is fetched: we store the URL the user is already on, its title and
    the source site — a pointer, not a copy. An empty ``case_id`` opens a fresh
    scratch session, the same as a screenshot ingest.
    """
    split = urlsplit(url)
    if split.scheme not in ("http", "https") or not split.hostname:
        raise HTTPException(status_code=422, detail="bookmark needs an http(s) URL")

    case = get_case(case_id) if case_id else Case.create("Scratch session", scratch=True)
    label = title.strip() or split.hostname
    entity = case.add_entity(
        "bookmark",
        label,
        {"url": url, "site": split.hostname, "folder": ""},
        by="ingest",
    )
    events.publish(
        {"type": "bookmark", "case_id": case.id, "entity_id": entity["id"],
         "title": label, "url": url}
    )
    return {"entity_id": entity["id"], "case_id": case.id, "title": label, "url": url}


# ---- extension download: the packaged source, zipped on request ---------------

# Repo checkout first (development), then the copy hatchling ships inside the
# wheel (azimut/extension) — same dual-home pattern as the built frontend.
_EXTENSION_DIRS = (
    Path(__file__).parents[3] / "extension",
    Path(__file__).parents[1] / "extension",
)
# Runtime files only: the extension's own dev harness (vitest, package.json,
# lockfile) has no business in an installed browser.
_ZIP_EXCLUDE_DIRS = {"node_modules", "tests", ".git"}
_ZIP_EXCLUDE_FILES = {"package.json", "package-lock.json", "vitest.config.js", ".gitignore"}


def _extension_dir() -> Path | None:
    for candidate in _EXTENSION_DIRS:
        if (candidate / "manifest.json").is_file():
            return candidate
    return None


def bundled_extension_version() -> str | None:
    """The ``version`` of the extension this Azimut build ships. Settings
    compares it to the version stamped by the *installed* extension
    (lib/extBridge.js) so it can flag "an update is bundled — re-download and
    reload". None if no extension is bundled (unusual builds)."""
    src = _extension_dir()
    if src is None:
        return None
    try:
        manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    version = manifest.get("version")
    return str(version) if version else None


@router.get("/extension.zip")
def extension_zip() -> Response:
    """The capture extension, zipped for Settings' install flow.

    Unauthenticated on purpose: it is the installer, it contains no secrets
    (the token is pasted in *after* install), and gating it on the token would
    make pairing circular.
    """
    src = _extension_dir()
    if src is None:
        raise HTTPException(status_code=404, detail="extension not bundled with this build")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(src.rglob("*")):
            rel = path.relative_to(src)
            if not path.is_file() or path.name in _ZIP_EXCLUDE_FILES:
                continue
            if any(part in _ZIP_EXCLUDE_DIRS or part.endswith(".test.js") for part in rel.parts):
                continue
            zf.write(path, str(rel))
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="azimut-capture-extension.zip"'},
    )
