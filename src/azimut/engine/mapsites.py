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
the map is drawn in the window it is looking at. Given it, the three sites that
state their scale as a size rather than as a zoom — Apple's ``span``, Google's
satellite ``,3231m``, Earth's ``d`` and ``y`` — come back with a real ``zoom``
like everyone else, and ``scale_source`` says which of the four routes the
number arrived by. Every
one of them is measured, not assumed: see ``docs/MAP_SITES.md``, where each
site's URL is recorded next to what a browser was actually observed doing with
it.
"""

from __future__ import annotations

import base64
import binascii
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

#: How high a level 3D camera may sit before the ground under it stops being
#: flat enough to draw on, in metres.
#:
#: A camera pointed straight down at a plane is a plain uniform scaling — the
#: perspective cancels exactly — so a level 3D view is drawable near the middle
#: of the screen. What ends that is the Earth's own curvature: over a span of D
#: the ground drops about D²/8R below the plane, so at 150 km across it is a
#: couple of hundred metres, a quarter of a percent. Past this the view is a
#: globe and says so.
#:
#: This is about 3D cameras only: Earth's 3D mode and Maps' Earth mode. Earth's
#: default 2D mode is a flat Web Mercator map at every distance (measured, and
#: seen flat with all of Europe on screen), so it has no ceiling.
#:
#: What this cannot account for is relief. A level 3D camera still displaces a
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


def _protobuf_fields(blob: bytes) -> dict[int, int | bytes] | None:
    """The top-level fields of a protobuf message, or None if it is not one.

    Only what reading Earth's ``data=`` needs: varints and length-delimited
    fields kept, fixed-width ones skipped, anything else refused.
    """
    fields: dict[int, int | bytes] = {}
    at = 0

    def varint() -> int:
        nonlocal at
        value = shift = 0
        while at < len(blob) and shift < 64:
            byte = blob[at]
            at += 1
            value |= (byte & 0x7F) << shift
            if byte < 0x80:
                return value
            shift += 7
        raise ValueError("truncated varint")

    try:
        while at < len(blob):
            key = varint()
            number, wire = key >> 3, key & 7
            if wire == 0:
                fields[number] = varint()
            elif wire == 2:
                size = varint()
                if at + size > len(blob):
                    return None
                fields[number] = blob[at:at + size]
                at += size
            elif wire in (1, 5):
                at += 8 if wire == 1 else 4
            else:
                return None
    except ValueError:
        return None
    return fields if at == len(blob) else None


def _earth_in_3d(u) -> bool:
    """Whether Earth is showing its 3D globe rather than its flat 2D map.

    The address bar says so in the base64 protobuf after ``/data=``: pressing
    Earth's "3D" button adds field 5 = 2 and pitches the camera, pressing it
    again takes both away. A link with no ``data=`` opens the 2D map. Anything
    that cannot be read is taken as 3D, whose rules are the stricter ones.
    """
    m = re.search(r"/data=([A-Za-z0-9_-]+)", u.path)
    if not m:
        return False
    try:
        blob = base64.urlsafe_b64decode(m[1] + "=" * (-len(m[1]) % 4))
    except (binascii.Error, ValueError):
        return True
    fields = _protobuf_fields(blob)
    if fields is None:
        return True
    return 5 in fields


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
        if _earth_in_3d(u):
            return _free_camera(block[0], _camera_number(block[0], "d"))
        # The 2D map is flat at any distance, so only a pitch stops it being one.
        return VIEW_TILTED if _pitched(block[0]) else VIEW_MAP
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
    # Earth's 2D map, measured by loading URLs a known step apart and
    # registering the screenshots: pixels per degree north over pixels per
    # degree east came out at 1/cos(lat) to 0.03% at 47° and 52°, which is
    # spherical Mercator and not the ground's own ratio (0.3% away). Its 3D
    # mode is refused past LEVEL_CEILING_M and is near enough to it below.
    "google-earth": PROJ_SPHERICAL,
}


#: Where each site draws the coordinate its address bar names, as an offset in
#: CSS pixels from the middle of the window — the starting answer the extension
#: places its drawing with until it has measured one of its own.
#:
#: The middle of the window is not a neutral default, it is a table entry, and
#: the wrong one on four of these sites: they keep a results panel or a header
#: and centre the map in what is left. Yandex's camera sits 210 px right of the
#: middle, Copernicus's 225, Bing's 40 px down. Until one is measured that is
#: the whole drawing's error, and at level 3 Bing's 40 px is 450 km of ground.
#:
#: Every number came out of a browser (``docs/MAP_SITES.md``), and the two sites
#: recorded at two window shapes measured the same offset in both — which is
#: what makes a pixel count portable at all: a panel's width is the site's own
#: CSS, not the analyst's screen. Sites that measured to the middle are absent
#: because the middle is the default. ``apple-maps`` is absent for the opposite
#: reason: its sidebar folds away below some width it never states, so its
#: offset is 67 px in a wide window and nothing in a narrow one. That one is
#: measured on the machine it is drawn on or not at all.
#:
#: The third number is what keeps the sideways half of this honest, and Apple is
#: why. A **header** takes height, and its height is the same in a narrow window
#: as in a wide one — so the vertical offset is claimed at any size. A **side
#: panel** takes width, and a side panel is exactly the thing that folds away
#: when the window gets narrow: that is the whole of Apple's 67 px becoming
#: nothing. So a sideways offset is claimed only at or above the narrowest
#: window it was actually recorded in, and below that the site starts centred
#: horizontally and is measured like Apple. Yandex was driven at 1200 and 1600
#: and measured 210 px in both; Copernicus has been driven at 1600 only, and
#: says no more than that.
#:
#: This is a hint and never an answer. The extension measures the offset off the
#: first zoom and keeps its own (``extension/mapoverlay.js``, ``seedFrame``),
#: which is what covers a site that redecorates between two releases;
#: ``tests/test_mapsites.py`` re-checks every entry here against the recording.
#: (x, y, the narrowest window x has been measured in — 0 where x is 0)
_CAMERA_CENTRE = {
    "bing-maps": (0.0, 40.5, 0),
    "openstreetmap": (0.0, 27.4, 0),
    "yandex-maps": (210.0, 10.0, 1200),
    "copernicus-browser": (225.0, 0.0, 1600),
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

#: Which of the four things the URL said, for the ``zoom`` that came back.
#: Each is a number the site itself wrote about the view it is showing; ``None``
#: means the URL stated nothing a scale can be read out of, and nothing is
#: drawn until it does.
SCALE_ZOOM = "zoom"  # a tile level, the usual case
SCALE_HEIGHT_M = "height_m"  # Google's satellite view: the viewport, in metres
SCALE_SPAN = "span"  # Apple: the degrees the region covers
SCALE_DISTANCE = "distance"  # Earth: the camera's distance to the ground, and its field of view

#: The closest Earth's 2D map lets its camera come to the ground, in metres.
#: Zoomed in until it stopped, it wrote ``25.00163587d``. A smaller ``d`` is not
#: a camera Earth placed: loading one link, it once wrote ``1518a,10d`` for a
#: camera 1528 m up, where ``a`` was not the ground at all.
EARTH_CLOSEST_M = 24.9

#: Lowest and highest ground there is, in metres (the Dead Sea shore, Everest).
#: An ``a`` outside it is not the ground, so ``d`` is not a distance to it.
_GROUND_M = (-450.0, 8900.0)


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


def _earth_height_m(camera: str) -> float | None:
    """How tall Earth's view is on the ground, in metres, or None when its URL
    does not say.

    Measured rather than assumed (``docs/MAP_SITES.md``). Earth draws its map
    as a camera ``d`` metres above the ground under the middle of the screen,
    with ``y`` degrees of field of view across the window's height, so the
    window covers ``2·d·tan(y/2)`` metres top to bottom: screenshots of URLs a
    known step apart agreed to 0.06% from 2 km to 400 km out, at three window
    shapes, and at ``y`` of 35 and 60.

    ``d`` is that distance only once Earth has placed the camera itself, which
    it does on every gesture by writing the ground's height into ``a``. A link
    typed as ``0a`` with a whole ``d`` has not been placed, and over land 200 m
    up it is drawn 7% nearer than it says, so it waits for the map to move.
    """
    distance = _camera_number(camera, "d")
    fov = _camera_number(camera, "y")
    ground = _camera_number(camera, "a")
    if distance is None or fov is None or ground is None:
        return None
    if not 0 < fov < 180 or distance < EARTH_CLOSEST_M:
        return None
    if not _GROUND_M[0] <= ground <= _GROUND_M[1]:
        return None
    if ground == 0 and re.search(r",-?\d+d(?:,|$)", camera):
        return None
    return 2 * distance * math.tan(math.radians(fov) / 2)


def _scale(
    site_id: str, parsed: dict[str, Any], u, height_px: float | None,
) -> tuple[float | None, str | None]:
    """The zoom this view is at, and which of the four routes it came by.

    The order is the order of authority. A tile level is what most of these
    sites state and it is exact. Failing that, a size — Google's metres, Apple's
    degrees, Earth's distance — is exact too, but only to a caller that knows
    how tall its window is, so it needs ``height_px`` and is otherwise left
    alone. What is never done is inventing one: no ``height_px``, no zoom.
    """
    zoom = parsed.get("zoom")
    if zoom is not None and site_id in _ZOOM_IS_TILES:
        return zoom, SCALE_ZOOM
    lat = parsed.get("lat")
    if lat is None or not height_px:
        return zoom, None
    block = re.search(r"@[^/]*", u.path)
    camera = block[0] if block else ""
    if site_id == "google-earth":
        from_distance = _zoom_from_height_m(_earth_height_m(camera), height_px, lat)
        return (from_distance, SCALE_DISTANCE) if from_distance is not None else (None, None)
    if site_id == "google-maps" and ",3a," not in camera:  # Street View's radius is not a height
        from_height = _zoom_from_height_m(_camera_number(camera, "m"), height_px, lat)
        if from_height is not None:
            return from_height, SCALE_HEIGHT_M
    span_lat = parsed.get("span_lat")
    if span_lat:
        from_span = _zoom_from_span(span_lat, height_px, lat)
        if from_span is not None:
            return from_span, SCALE_SPAN
    return zoom, None


def _centre_hint(site_id: str) -> dict[str, float] | None:
    """The starting offset for this site's camera centre, or None for the middle."""
    at = _CAMERA_CENTRE.get(site_id)
    return {"x": at[0], "y": at[1], "min_w": at[2]} if at else None


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


def _drawable(
    site_id: str, parsed: dict[str, Any], kind: str | None, scale_source: str | None
) -> dict[str, Any]:
    """What may be drawn over this view, and the facts behind the verdict.

    Decided here, because every input to it is site knowledge and that is what
    this module is for. ``geometry`` gates what the app *computes* — a search
    grid, a measured line, a sun arc — and it needs two things:

    * a camera looking straight down at a flat map (``view_kind``), since
      Mercator says nothing about a pitched, panoramic or globe camera;
    * a projection we can actually invert, named rather than assumed.

    ``far`` is the third fact, and it is a warning rather than a refusal — but
    only for the one kind of far it describes. A **flat map drawn far out**
    (Google and Bing below ``_GLOBE_BELOW``) goes on quoting a tile level while
    its renderer curves, and out there the middle of the screen is still right
    while the edges drift: a sweep of a whole region is worth seeing roughly, so
    the drawing stays and says so (`maptools.js`, the verdict; `mapoverlay.js`
    dims it). A **globe camera** — Earth's 3D mode past ``LEVEL_CEILING_M``, and
    Google's Earth mode with it — is a perspective view of a sphere, where this
    arithmetic is not approximately right but wrong, and ``VIEW_GLOBE`` is
    refused rather than dimmed. ``far`` stays true there, because it has a
    second job: it is what stops the extension measuring a site's layout off a
    view that far out.

    A pin is not gated at all: the analyst places it, and where it files is a
    coordinate the address bar already carried. What changes when ``geometry``
    is false is only *which* coordinate it may claim — the view centre or the
    camera point, never the pixel that was clicked.
    """
    projection = _projection(site_id)
    globe_below = _GLOBE_BELOW.get(site_id)
    zoom = parsed.get("zoom")
    level = kind == VIEW_MAP
    return {
        "view_kind": kind,
        "projection": projection,
        "centre_hint": _centre_hint(site_id),
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
    what turns Apple's span, Google's satellite metres and Earth's camera
    distance into a zoom. All three views were measured to fill the window's
    full height, which is why one number is enough; a caller that does not know
    it simply gets no zoom for them, never a guessed one.
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
        parsed["zoom"], source = _scale(site_id, parsed, u, height_px)
        return {
            "site": site_id,
            "label": label,
            **parsed,
            "imagery_mode": _imagery_mode(site_id, u),
            "tilt": camera_pitch(site_id, u),
            **_drawable(site_id, parsed, _view_kind(site_id, u), source),
        }
    return None
