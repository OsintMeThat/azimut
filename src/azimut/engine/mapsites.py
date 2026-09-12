"""Map-site URL parsing — coordinates, place name and imagery date from a URL.

This lives in the backend ON PURPOSE (owner decision, same logic as the
unbounded yt-dlp/gallery-dl ranges): URL formats race sites that change
without notice, and the capture extension is the hardest component to update
(installed by hand, no store, no auto-update). So the extension stays dumb —
screenshot + send the URL — and every format rule lives here, where a normal
app update fixes it.

Deliberately URL-only (legal rails): the page DOM is never read, so a
capture's coordinates are exactly what the address bar says the view is —
verifiable by anyone with the recorded source URL.

``parse_map_url(url)`` returns None for a non-map URL (the extension refuses
to capture there — maps only), else a dict with ``site``/``label`` always set
and ``lat``/``lon``/``zoom``/``bearing``/``title``/``imagery_date``/
``imagery_mode``/``view_kind``/``projection``/``globe_below`` set to values when
the URL carries them, None when it doesn't, plus ``geometry`` — whether the map
overlay may draw over the page at all — and ``far``, whether it is far enough
out that what it draws drifts away from the middle of the screen. A malformed URL on a
known host degrades to "known site, nothing parsed" — parsers never raise.

``height_px`` is the one fact the caller has and this module cannot: how tall
the map is drawn in the window it is looking at. Given it, the two sites that
state their scale as a size rather than as a zoom — Apple's ``span``, Google's
satellite ``,3231m`` — come back with a real ``zoom`` like everyone else, and
``scale_source`` says which of the three routes the number arrived by. Every
one of them is measured, not assumed: see ``docs/MAP_SITES.md``, where each
site's URL is recorded next to what a browser was actually observed doing with
it.
"""

from __future__ import annotations

import math
import re
from datetime import date
from typing import Any, Callable
from urllib.parse import parse_qs, unquote, urlsplit

_NUM = r"-?\d+(?:\.\d+)?"


def _num(s: str | None) -> float | None:
    try:
        v = float(s)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return v if v == v and abs(v) != float("inf") else None


def _in_world(lat: float | None, lon: float | None) -> bool:
    return lat is not None and lon is not None and abs(lat) <= 90 and abs(lon) <= 180


def _no_view() -> dict[str, Any]:
    return {"lat": None, "lon": None, "zoom": None, "bearing": None,
            "title": None, "imagery_date": None, "span_lat": None, "span_lon": None}


def _view(lat, lon, zoom=None, bearing=None) -> dict[str, Any]:
    if not _in_world(lat, lon):
        return _no_view()
    if bearing is not None:
        bearing = bearing % 360
    return {"lat": lat, "lon": lon, "zoom": zoom, "bearing": bearing,
            "title": None, "imagery_date": None, "span_lat": None, "span_lon": None}


def _place_name(raw: str | None) -> str | None:
    """A place name lifted from a path segment or query param — the capture's
    suggested title. Sites encode spaces as + or %20; both come back out."""
    if not raw:
        return None
    s = unquote(str(raw).replace("+", " "), errors="replace")
    s = re.sub(r"\s+", " ", s).strip()[:120]
    return s or None


def _iso_date(raw: str | None) -> str | None:
    """Normalize a date-ish fragment to YYYY-MM-DD, or None. Zoom Earth writes
    single-digit parts (2025-7-4); anything that isn't a real calendar date is
    dropped — a wrong imagery date on a proof is worse than none."""
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", str(raw or ""))
    if not m:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None


def _param(u, name: str) -> str | None:
    values = parse_qs(u.query).get(name)
    return values[0] if values else None


#: What kind of camera the URL describes, which decides what may be drawn over
#: the page. Geometry the app *computes* — a search grid, a sun arc, a measured
#: line — is only honest on ``map``: it is worked out through Web Mercator, and
#: on a pitched or panoramic camera that arithmetic is wrong before occlusion
#: even gets a say (a cell would land on the wall of the building hiding it).
#: What the analyst *places* by hand, a media pin, is never computed and stays
#: allowed everywhere.
VIEW_MAP = "map"  # straight-down 2D — geometry is sound
VIEW_TILTED = "tilted"  # a pitched 3D camera
VIEW_STREET = "streetview"  # a ground-level panorama
VIEW_GLOBE = "globe"  # level, but far enough out that the Earth is visibly round

#: How high a level camera may sit before the ground under it stops being flat
#: enough to measure on, in metres.
#:
#: A camera pointed straight down at a plane is a plain uniform scaling — the
#: perspective cancels exactly — so a level 3D view *is* measurable, even though
#: nothing about it is Web Mercator. What ends that is the Earth's own
#: curvature: over a span of D the ground drops about D²/8R below the plane, so
#: at 150 km across it is a couple of hundred metres, a quarter of a percent.
#: Past this the view is a globe and says so.
#:
#: What this cannot account for is relief. A level camera still displaces a
#: hilltop outward from the centre by its own height times the tangent of the
#: off-axis angle, and no URL says how tall the ground is. Flat country is
#: exact; mountains are not (extension/README.md says so where the analyst
#: reads it).
LEVEL_CEILING_M = 150_000


#: How far off straight down a camera may point and still be read as level, in
#: degrees.
#:
#: Not a courtesy. These viewers write the camera they are actually holding, at
#: full precision, and they do not come back to a clean zero: turning Google
#: Earth leaves a fraction of a degree of pitch behind it, and read as "tilted"
#: that is a tool which switches itself off whenever the compass is touched.
#: Which is what it did.
#:
#: The number is what the drawing can absorb. A pitched camera stretches the
#: ground away from the centre, and across half of Earth's own 35° field that
#: comes to roughly ``0.6 · tan θ`` — a percent at one degree, two at two,
#: eleven at ten. Two sits with the approximations already admitted here (a
#: measured scale's latitude axis is out by about as much), and a camera anyone
#: has deliberately pitched is past it by an order of magnitude.
LEVEL_TILT_DEG = 2.0


def _camera_number(camera: str, letter: str) -> float | None:
    """One of the free camera's `,<number><letter>` parts, or None."""
    m = re.search(rf",({_NUM}){letter}(?:,|$)", camera)
    return _num(m[1]) if m else None


def _pitch(camera: str) -> float | None:
    """How far off straight down a free camera points, in degrees — or None
    where the URL states neither angle.

    Pitch and roll answer together: either one tips the ground plane, and what
    the drawing has to live with is the worse of the two.
    """
    stated = [_camera_number(camera, letter) for letter in ("t", "r")]
    angles = [abs(angle) for angle in stated if angle is not None]
    return max(angles) if angles else None


def _pitched(camera: str) -> bool:
    """Whether that pitch is one the geometry cannot carry."""
    angle = _pitch(camera)
    return angle is not None and angle > LEVEL_TILT_DEG


def _free_camera(camera: str, height: float | None) -> str:
    """What a free 3D camera is looking at: a map, a pitched view, or a globe.

    Pitch and roll are what break the geometry outright — a cell would land on
    the wall of the building hiding it. Level and low, the view is a plain
    scaling of the ground and a caller that measures its own scale can work on
    it; level and far out, it is a globe (``LEVEL_CEILING_M``). "Level" carries
    a tolerance, and ``LEVEL_TILT_DEG`` says why it has to.
    """
    if _pitched(camera):
        return VIEW_TILTED
    if height is None or height > LEVEL_CEILING_M:
        return VIEW_GLOBE
    return VIEW_MAP


def camera_pitch(site_id: str, u) -> float | None:
    """The pitch this site's URL states, in degrees, or None where it states
    none.

    Carried out to the caller so a refusal can name the angle. "This view is
    tilted" and "this view is tilted by 14°" are different sentences to be
    given: one is a verdict, the other is the thing to go and undo — and on a
    viewer that leaves half a degree behind after every turn, the number is also
    how an analyst tells a camera they pitched from one they did not.
    """
    if site_id not in ("google-earth", "google-maps"):
        return None
    block = re.search(r"@[^/]*", u.path)
    return _pitch(block[0]) if block else None


def _view_kind(site_id: str, u) -> str | None:
    """Which camera the address bar describes, or None when it does not say.

    Read from the URL only, like everything else here, and unclassified rather
    than guessed — the same rule ``_imagery_mode`` follows.

    A known limit, stated rather than papered over: Bing's 3D mode and Apple's
    Flyover leave no mark in their URLs, so both report ``map``. The drawing
    side needs a zoom as well, which those views do not carry, so the geometry
    still declines — but it declines for the second reason, not the first.
    """
    if site_id == "google-earth":
        block = re.search(r"@[^/]*", u.path)
        if not block:
            return None
        return _free_camera(block[0], _camera_number(block[0], "d"))
    if site_id == "google-maps":
        block = re.search(r"@[^/]*", u.path)
        if not block:
            return None
        camera = block[0]
        if ",3a," in camera:  # the Street View pano camera
            return VIEW_STREET
        if re.search(rf",{_NUM}a", camera):
            # Earth mode: a free camera, quoting its own height rather than a
            # zoom. Level, it is as measurable as the satellite view above.
            return _free_camera(camera, _camera_number(camera, "a"))
        if _pitched(camera):
            return VIEW_TILTED
        if re.search(rf",{_NUM}z", camera):
            return VIEW_MAP
        # Satellite drops the zoom for a viewport height in metres
        # (``@lat,lon,1053m``), and it is still a straight-down map — the camera
        # did not move, only the way the URL describes it. Said so here, even
        # though ``geometry`` below still declines for want of a zoom: a caller
        # that measures its own scale (the extension's map tools) needs to know
        # this is a map, and one that does not is refused either way.
        return VIEW_MAP if re.search(rf",{_NUM}m(?:$|[,/])", camera) else None
    if site_id == "copernicus-browser":
        # Its 3D terrain viewer writes its camera into the address bar as
        # ``terrainViewerSettings`` and reads it back to re-enter 3D, which is
        # the mark this needs: without it, the view is the flat Leaflet map.
        return VIEW_TILTED if _param(u, "terrainViewerSettings") else VIEW_MAP
    if site_id in {"openstreetmap", "zoom-earth", "satellites-pro"}:
        return VIEW_MAP  # flat-map renderers, with no other mode to be in
    if site_id in {"bing-maps", "yandex-maps", "apple-maps"}:
        return VIEW_MAP
    return None


#: How a site lays the world out flat. Geometry is drawn by inverting this.
#:
#: The overlay anchors on the view centre, so the two Mercators agree there and
#: disagree by a growing scale error across the viewport rather than by a fixed
#: offset: measured, that is some tens of metres at z12 and under a metre by
#: z17. Small — but a search grid's cells are metres, so it is worth being right
#: about, and it is free once the site says which one it draws in.
PROJ_SPHERICAL = "webmercator"  # EPSG:3857 — nearly everyone
PROJ_ELLIPSOIDAL = "ellipsoidal"  # EPSG:3395 — Yandex, on the WGS84 ellipsoid

#: Where a site stops drawing a flat map and starts drawing a globe. The URL
#: goes on quoting a zoom either way, so the zoom is the only warning there is.
#: Conservative on purpose: what this now decides is whether the drawing is
#: marked as drifting at the edges, not whether it appears at all.
_GLOBE_BELOW = {"google-maps": 8, "bing-maps": 8}

_PROJECTIONS = {
    "google-maps": PROJ_SPHERICAL,
    "bing-maps": PROJ_SPHERICAL,
    "openstreetmap": PROJ_SPHERICAL,
    "apple-maps": PROJ_SPHERICAL,
    "zoom-earth": PROJ_SPHERICAL,
    "satellites-pro": PROJ_SPHERICAL,
    # Copernicus Browser draws its 2D map on Leaflet, whose default CRS is
    # EPSG:3857. Checked twice over: its own package.json depends on leaflet,
    # and two zooms about two different pixels solved for the same camera
    # centre through spherical Mercator, to half a pixel. Its 3D terrain viewer
    # is a different camera and says so in the URL (``_view_kind``).
    "copernicus-browser": PROJ_SPHERICAL,
    "yandex-maps": PROJ_ELLIPSOIDAL,
    # google-earth is a globe: a free camera names no flattening, so it is not
    # named at all and the tools measure it instead.
}


#: Sites whose ``zoom`` is the tile level of the projection above, so the scale
#: follows from the URL alone: ``256·2^zoom`` pixels around the world.
#:
#: Documented, and then checked. OpenStreetMap's slippy-map spec and Bing's tile
#: system state the same thing in the same words — 256-pixel tiles, one tile of
#: the whole world at zoom 0, ``x = (lon+180)/360 · 256·2^z`` — and Google's
#: matches both. Yandex numbers its levels the same way over the elliptical
#: Mercator it draws in. Copernicus Browser draws on Leaflet, which is that spec
#: with a library around it. Every one of them was then dragged a known number
#: of pixels in a real browser and asked where it had landed: the answer came
#: back within a tenth of a percent of the level the URL quoted, at two window
#: sizes (``docs/MAP_SITES.md``).
#:
#: **Apple's ``z`` is here on the strength of that measurement, not of its
#: documentation**, which calls it "a floating point value between 2 and 21 that
#: defines the area around the center point" and stops. Opened at ``z=15`` in a
#: 1000 px window and again in a 760 px one, Apple drew both at exactly tile
#: level 15. What its ``z`` cannot do is stay true: Apple never rewrites it, so
#: it is dropped the moment the same URL carries a span (``_apple_maps``), and
#: only the opening view is ever read from it.
_ZOOM_IS_TILES = {
    "google-maps",
    "bing-maps",
    "openstreetmap",
    "yandex-maps",
    "zoom-earth",
    "satellites-pro",
    "copernicus-browser",
    "apple-maps",
}


# --- what the URL says about how big the map is drawn --------------------------

#: Metres of ground per pixel at the equator, zoom 0, on the 256-pixel tile
#: every one of these sites is scaled in.
_EQUATOR_M_PER_PX = 2 * math.pi * 6378137 / 256

#: Which of the three things the URL said, for the ``zoom`` that came back.
#: Each is a number the site itself wrote about the view it is showing; ``None``
#: means the URL stated nothing a scale can be read out of, and the caller is on
#: its own (the extension measures the map instead).
SCALE_ZOOM = "zoom"  # a tile level, the usual case
SCALE_HEIGHT_M = "height_m"  # Google's satellite view: the viewport, in metres
SCALE_SPAN = "span"  # Apple: the degrees the region covers


#: Where Mercator is cut, north and south. Every slippy map cuts at this value.
_MAX_LAT = 85.05112877980659


def _mercator_y(lat: float) -> float:
    """Northing on the 256-pixel world at zoom 0, spherical Mercator."""
    phi = math.radians(max(-_MAX_LAT, min(_MAX_LAT, lat)))
    return (1 - math.log(math.tan(phi) + 1 / math.cos(phi)) / math.pi) / 2 * 256


def _zoom_from_height_m(metres: float | None, height_px: float, lat: float) -> float | None:
    """The tile level at which ``height_px`` pixels cover ``metres`` of ground.

    Google's satellite view states that height and no zoom. Its own arithmetic
    is Web Mercator's, so the inverse is exact.
    """
    if not metres or height_px <= 0 or abs(lat) > _MAX_LAT:
        return None
    per_px = metres / height_px
    if per_px <= 0:
        return None
    return math.log2(_EQUATOR_M_PER_PX * math.cos(math.radians(lat)) / per_px)


def _zoom_from_span(span_lat: float, height_px: float, lat: float) -> float | None:
    """The tile level at which ``span_lat`` degrees fill ``height_px`` pixels.

    Apple's ``span``. Taken through the projection rather than through a
    linear degrees-per-pixel, which is only near enough in the middle of the
    screen and is exactly what a drawing that slides at the edges is made of.
    """
    if not span_lat or span_lat <= 0 or height_px <= 0:
        return None
    north, south = lat + span_lat / 2, lat - span_lat / 2
    if abs(north) > _MAX_LAT or abs(south) > _MAX_LAT:
        return None
    tall = _mercator_y(south) - _mercator_y(north)
    return math.log2(height_px / tall) if tall > 0 else None


def _scale(
    site_id: str, parsed: dict[str, Any], camera: float | None,
    camera_kind: str | None, height_px: float | None,
) -> tuple[float | None, str | None]:
    """The zoom this view is at, and which of the three routes it came by.

    The order is the order of authority. A tile level is what most of these
    sites state and it is exact. Failing that, a size — Google's metres, Apple's
    degrees — is exact too, but only to a caller that knows how tall its window
    is, so it needs ``height_px`` and is otherwise left alone. What is never
    done is inventing one: no ``height_px``, no zoom.
    """
    zoom = parsed.get("zoom")
    if zoom is not None and site_id in _ZOOM_IS_TILES:
        return zoom, SCALE_ZOOM
    lat = parsed.get("lat")
    if lat is None or not height_px:
        return zoom, None
    if camera_kind == CAMERA_HEIGHT_M:
        from_height = _zoom_from_height_m(camera, height_px, lat)
        if from_height is not None:
            return from_height, SCALE_HEIGHT_M
    span_lat = parsed.get("span_lat")
    if span_lat:
        from_span = _zoom_from_span(span_lat, height_px, lat)
        if from_span is not None:
            return from_span, SCALE_SPAN
    return zoom, None


def _projection(site_id: str) -> str | None:
    """Which flattening a site draws in, or None when we cannot say.

    None is a refusal, not a default. Guessing right most of the time is what
    makes a wrong guess dangerous: the drawing looks exactly as sure of itself
    either way, and nothing on screen says which one it was.
    """
    return _PROJECTIONS.get(site_id)


def _imagery_mode(site_id: str, u) -> str | None:
    """Identify satellite imagery only when the URL makes it explicit.

    The capture extension sees pixels but deliberately does not inspect the
    page DOM. Generic map URLs therefore remain unclassified rather than being
    guessed as satellite imagery. Satellite-only sites and explicit layer
    parameters are safe to classify from the address bar.
    """
    if site_id == "satellites-pro":
        # It answers a bare link with a country path of its own, and that path
        # says which basemap it landed on: /plan/ is an OpenStreetMap road map,
        # not imagery. Measured — a link built for satellite came back as
        # /plan/France_map.
        return None if "/plan/" in u.path.lower() else "satellite"
    if site_id in {"google-earth", "zoom-earth", "copernicus-browser"}:
        return "satellite"
    if site_id == "google-maps":
        return "satellite" if "!1e3" in unquote(u.geturl()) else None
    if site_id == "bing-maps":
        return "satellite" if (_param(u, "style") or "").lower() in {"a", "h"} else None
    if site_id == "yandex-maps":
        layers = {part.strip().lower() for part in (_param(u, "l") or "").split(",")}
        return "satellite" if layers & {"sat", "satellite"} else None
    if site_id == "apple-maps":
        layer = (_param(u, "map") or _param(u, "t") or "").lower()
        return "satellite" if layer in {"satellite", "hybrid", "k", "h"} else None
    return None


# --- per-site parsers (each takes a SplitResult) -------------------------------


def _google_maps(u) -> dict[str, Any]:
    # /maps/place/Tour+Eiffel/@48.8583701,2.2944813,17z/… — the @ block is the
    # viewport; the place/search segment is the name the user looked up.
    # The z suffix is zoom; an m (metres) or a (streetview) suffix is not.
    name = re.search(r"/maps/(?:place|search)/([^/@]+)", u.path)
    title = _place_name(name[1]) if name else None
    m = re.search(rf"@({_NUM}),({_NUM})(?:,(\d+(?:\.\d+)?)z)?", u.path)
    if m:
        return {**_view(_num(m[1]), _num(m[2]), _num(m[3]) if m[3] else None), "title": title}
    # fallback: a pinned place without an @ viewport — !3d<lat>!4d<lon>
    m = re.search(rf"!3d({_NUM})!4d({_NUM})", u.geturl())
    if m:
        return {**_view(_num(m[1]), _num(m[2])), "title": title}
    return {**_no_view(), "title": title}


def _google_earth(u) -> dict[str, Any]:
    # /web/search/Tour+Eiffel/@48.858,2.294,146.7a,666.6d,35y,12.3h,45.1t,0r
    # a=altitude, d=camera distance, y=fov, h=heading, t=tilt, r=roll
    name = re.search(r"/web/search/([^/@]+)", u.path)
    title = _place_name(name[1]) if name else None
    m = re.search(rf"@({_NUM}),({_NUM})(?:,[^/]*?({_NUM})h)?", u.path)
    if m:
        bearing = _num(m[3]) if m[3] else None
        return {**_view(_num(m[1]), _num(m[2]), None, bearing), "title": title}
    return {**_no_view(), "title": title}


def _bing_maps(u) -> dict[str, Any]:
    # ?cp=48.8584~2.2945&lvl=17.0&q=tour+eiffel
    title = _place_name(_param(u, "q") or _param(u, "where1"))
    cp = _param(u, "cp") or ""
    m = re.fullmatch(rf"({_NUM})~({_NUM})", cp)
    if m:
        return {**_view(_num(m[1]), _num(m[2]), _num(_param(u, "lvl"))), "title": title}
    return {**_no_view(), "title": title}


def _yandex_maps(u) -> dict[str, Any]:
    # ?ll=2.2945,48.8584&z=17&text=eiffel — Yandex is longitude-first
    title = _place_name(_param(u, "text"))
    ll = _param(u, "ll") or ""
    m = re.fullmatch(rf"({_NUM}),({_NUM})", ll)
    if m:
        return {**_view(_num(m[2]), _num(m[1]), _num(_param(u, "z"))), "title": title}
    return {**_no_view(), "title": title}


def _openstreetmap(u) -> dict[str, Any]:
    # #map=17/48.8584/2.2945 (zoom first); /search?query=eiffel carries the name
    title = _place_name(_param(u, "query"))
    m = re.search(rf"map=(\d+(?:\.\d+)?)/({_NUM})/({_NUM})", u.fragment)
    if m:
        return {**_view(_num(m[2]), _num(m[3]), _num(m[1])), "title": title}
    return {**_no_view(), "title": title}


def _apple_maps(u) -> dict[str, Any]:
    """Apple, in the two forms it uses: the one a link is written in, and the
    one the page rewrites itself into as soon as it is touched.

        ?ll=48.8584,2.2945&z=17&q=Tour+Eiffel
        /frame?center=48.8584,2.2945&span=0.029055,0.056434&map=satellite

    ``span`` is the region the view covers, latitude delta first, exactly as
    ``MKCoordinateSpan`` defines it, and it is live: pan and it follows the
    centre, zoom and it halves.

    **``z`` is not.** Apple carries whatever ``z`` the link that opened the map
    had and never rewrites it, so after one zoom it names a scale the map left
    behind. Measured in a browser: opened at ``z=15``, zoomed twice, the URL
    still said 15 while the span had quartered. So it is read only where there
    is no span — the opening URL, the one moment it is still true.
    """
    title = _place_name(_param(u, "q") or _param(u, "name"))
    ll = _param(u, "ll") or _param(u, "center") or ""
    m = re.fullmatch(rf"({_NUM}),({_NUM})", ll)
    if not m:
        return {**_no_view(), "title": title}
    span = re.fullmatch(rf"({_NUM}),({_NUM})", _param(u, "span") or "")
    lat_span = _num(span[1]) if span else None
    lon_span = _num(span[2]) if span else None
    live = lat_span is not None and lat_span > 0
    view = _view(_num(m[1]), _num(m[2]), None if live else _num(_param(u, "z")))
    if live and view["lat"] is not None:
        view["span_lat"], view["span_lon"] = lat_span, lon_span
    return {**view, "title": title}


def _zoom_earth(u) -> dict[str, Any]:
    # #view=48.8584,2.2945,17z (older: /maps/satellite/@48.8584,2.2945,17z);
    # daily imagery carries its date in the hash: …/date=2025-7-14
    d = re.search(r"date=([\d-]+)", u.fragment)
    imagery = _iso_date(d[1]) if d else None
    m = re.search(rf"view=({_NUM}),({_NUM})(?:,(\d+(?:\.\d+)?)z)?", u.fragment) or re.search(
        rf"@({_NUM}),({_NUM})(?:,(\d+(?:\.\d+)?)z)?", u.path
    )
    if m:
        return {**_view(_num(m[1]), _num(m[2]), _num(m[3]) if m[3] else None),
                "imagery_date": imagery}
    return {**_no_view(), "imagery_date": imagery}


def _satellites_pro(u) -> dict[str, Any]:
    # #48.8584,2.2945,17
    m = re.match(rf"^({_NUM}),({_NUM})(?:,(\d+(?:\.\d+)?))?", u.fragment)
    if m:
        return _view(_num(m[1]), _num(m[2]), _num(m[3]) if m[3] else None)
    return _no_view()


def _copernicus(u) -> dict[str, Any]:
    # ?zoom=17&lat=48.8584&lng=2.2945; a chosen acquisition sets fromTime /
    # toTime — toTime's date IS the imagery date
    imagery = _iso_date(_param(u, "toTime") or _param(u, "fromTime"))
    lat, lon = _num(_param(u, "lat")), _num(_param(u, "lng"))
    if lat is not None and lon is not None:
        return {**_view(lat, lon, _num(_param(u, "zoom"))), "imagery_date": imagery}
    return {**_no_view(), "imagery_date": imagery}


# --- site table ----------------------------------------------------------------

# (id, label, host predicate, extra path gate or None, parser). The gate keeps
# e.g. google.com/search from counting as a map. Attribution lives in
# api/ingest.py next to the burn — this table is purely about reading URLs.
SITES: list[tuple[str, str, Callable, Callable | None, Callable]] = [
    ("google-earth", "Google Earth",
     lambda h: h == "earth.google.com", None, _google_earth),
    ("google-maps", "Google Maps",
     lambda h: re.search(r"(^|\.)google\.[a-z.]+$", h) or h == "maps.app.goo.gl",
     lambda u: u.hostname == "maps.app.goo.gl" or u.path.startswith("/maps"), _google_maps),
    ("bing-maps", "Bing Maps",
     lambda h: re.search(r"(^|\.)bing\.com$", h),
     lambda u: u.path.startswith("/maps"), _bing_maps),
    ("yandex-maps", "Yandex Maps",
     lambda h: re.search(r"(^|\.)yandex\.[a-z.]+$", h),
     lambda u: u.path.startswith("/maps"), _yandex_maps),
    ("openstreetmap", "OpenStreetMap",
     lambda h: re.search(r"(^|\.)openstreetmap\.org$", h), None, _openstreetmap),
    ("apple-maps", "Apple Maps",
     lambda h: h == "maps.apple.com", None, _apple_maps),
    ("zoom-earth", "Zoom Earth",
     lambda h: re.search(r"(^|\.)zoom\.earth$", h), None, _zoom_earth),
    ("satellites-pro", "Satellites.pro",
     lambda h: re.search(r"(^|\.)satellites\.pro$", h), None, _satellites_pro),
    ("copernicus-browser", "Copernicus Browser",
     lambda h: h == "browser.dataspace.copernicus.eu", None, _copernicus),
]


#: What a zoomless Google view quotes instead, and what the number means.
#:
#: ``height_m`` is the viewport's own height on the ground, in metres, and it
#: was checked rather than guessed: a 1000 px window opened at ``15z`` came back
#: as ``,3231m``, and 1000 px of Web Mercator at that latitude and zoom is
#: 3233 m. That makes it a scale, exact to the metre it is rounded to, for a
#: caller that knows how tall its window is.
#:
#: ``distance_d`` is Earth's camera distance from the point it looks at. It is
#: proportional to metres per pixel — halve it and the view zooms by two,
#: measured — but the constant between them is the camera's field of view,
#: which the URL does not state. So it carries a scale through a zoom and
#: nothing more.
CAMERA_HEIGHT_M = "height_m"
CAMERA_DISTANCE_D = "distance_d"


def _camera_span(site_id: str, u) -> tuple[float | None, str | None]:
    """How far out a zoomless view is, and in which of the two senses above."""
    if site_id not in {"google-maps", "google-earth"}:
        return None, None
    block = re.search(r"@[^/]*", u.path)
    if not block:
        return None, None
    camera = block[0]
    if ",3a," in camera:  # Street View's pano radius is not a span
        return None, None
    distance = _camera_number(camera, "d")
    if distance:
        return distance, CAMERA_DISTANCE_D
    height = _camera_number(camera, "m")
    return (height, CAMERA_HEIGHT_M) if height else (None, None)


def _drawable(
    site_id: str, parsed: dict[str, Any], kind: str | None, scale_source: str | None
) -> dict[str, Any]:
    """What may be drawn over this view, and the facts behind the verdict.

    Decided here, because every input to it is site knowledge and that is what
    this module is for. ``geometry`` gates what the app *computes* — a search
    grid, a measured line, a sun arc — and it needs two things:

    * a camera pointed straight down (``view_kind``), near or far, since
      Mercator says nothing about a pitched or panoramic one;
    * a projection we can actually invert, named rather than assumed.

    ``far`` is the third fact, and it is a warning rather than a refusal: these
    maps turn into globes on the way out while their URLs go on quoting a zoom,
    and out there the middle of the screen is still right while the edges drift.
    That is a trade worth offering — a sweep of a whole region is worth seeing
    roughly, and anyone who wants it exact zooms in — so the drawing stays and
    says so (`maptools.js`, the verdict; `mapoverlay.js` dims it).

    A pin is not gated at all: the analyst places it, and where it files is a
    coordinate the address bar already carried. What changes when ``geometry``
    is false is only *which* coordinate it may claim — the view centre or the
    camera point, never the pixel that was clicked.
    """
    projection = _projection(site_id)
    globe_below = _GLOBE_BELOW.get(site_id)
    zoom = parsed.get("zoom")
    level = kind in (VIEW_MAP, VIEW_GLOBE)
    return {
        "view_kind": kind,
        "projection": projection,
        "globe_below": globe_below,
        "scale_source": scale_source,
        "geometry": bool(level and projection),
        "far": bool(
            kind == VIEW_GLOBE
            or (globe_below is not None and zoom is not None and zoom < globe_below)
        ),
    }


def parse_map_url(url: str, height_px: float | None = None) -> dict[str, Any] | None:
    """Parse a page URL. None = not a map site (the extension stays out).

    ``height_px`` is how tall the map is drawn in the caller's window, and it is
    what turns Apple's span and Google's satellite metres into a zoom. Both of
    those views were measured to fill the window's full height, which is why one
    number is enough; a caller that does not know it simply gets no zoom for
    them, never a guessed one.
    """
    try:
        u = urlsplit(url)
    except ValueError:
        return None
    if u.scheme not in ("http", "https") or not u.hostname:
        return None
    host = u.hostname.lower()
    for site_id, label, host_ok, gate, parse in SITES:
        if not host_ok(host):
            continue
        if gate and not gate(u):
            continue
        try:
            parsed = parse(u)
        except Exception:
            parsed = _no_view()  # a weird URL on a known site still captures
        camera, camera_kind = _camera_span(site_id, u)
        parsed["zoom"], source = _scale(site_id, parsed, camera, camera_kind, height_px)
        return {
            "site": site_id,
            "label": label,
            **parsed,
            "imagery_mode": _imagery_mode(site_id, u),
            "camera_m": camera,
            "camera_kind": camera_kind,
            "tilt": camera_pitch(site_id, u),
            **_drawable(site_id, parsed, _view_kind(site_id, u), source),
        }
    return None
