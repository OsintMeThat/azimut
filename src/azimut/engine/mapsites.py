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
and ``lat``/``lon``/``zoom``/``bearing``/``title``/``imagery_date`` set to
values when the URL carries them, None when it doesn't. A malformed URL on a
known host degrades to "known site, nothing parsed" — parsers never raise.
"""

from __future__ import annotations

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
            "title": None, "imagery_date": None}


def _view(lat, lon, zoom=None, bearing=None) -> dict[str, Any]:
    if not _in_world(lat, lon):
        return _no_view()
    if bearing is not None:
        bearing = bearing % 360
    return {"lat": lat, "lon": lon, "zoom": zoom, "bearing": bearing,
            "title": None, "imagery_date": None}


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
    # ?ll=48.8584,2.2945&z=17&q=Tour+Eiffel (also &center= on some share links)
    title = _place_name(_param(u, "q") or _param(u, "name"))
    ll = _param(u, "ll") or _param(u, "center") or ""
    m = re.fullmatch(rf"({_NUM}),({_NUM})", ll)
    if m:
        return {**_view(_num(m[1]), _num(m[2]), _num(_param(u, "z"))), "title": title}
    return {**_no_view(), "title": title}


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


def parse_map_url(url: str) -> dict[str, Any] | None:
    """Parse a page URL. None = not a map site (the extension stays out)."""
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
        return {"site": site_id, "label": label, **parsed}
    return None
