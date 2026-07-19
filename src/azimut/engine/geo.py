"""Coordinate utilities: parsing, formats (decimal/DMS/plus code), reverse geocoding."""

from __future__ import annotations

import re
from typing import Any

import httpx

from . import coords
from .tiles import USER_AGENT

# -- parsing -------------------------------------------------------------------

_DEC = r"[-+]?\d{1,3}(?:\.\d+)?"
# Degrees, then minutes (decimal allowed, so degrees-decimal-minutes reads back),
# then optional seconds, then a hemisphere letter.
_DMS = (
    r"(?P<deg>\d{1,3})\s*[°d]\s*(?:(?P<min>\d{1,2}(?:\.\d+)?)\s*[’'m]\s*)?"
    r"(?:(?P<sec>\d{1,2}(?:\.\d+)?)\s*[”\"s]\s*)?(?P<hemi>[NSEW])"
)
# UTM: "31U 448251 5411932" (zone, band, easting, northing; spacing loose).
_UTM = (
    r"(?P<zone>\d{1,2})\s*(?P<band>[C-HJ-NP-X])\s+"
    r"(?P<easting>\d{1,7}(?:\.\d+)?)\s+(?P<northing>\d{1,8}(?:\.\d+)?)"
)


def parse_coords(text: str) -> tuple[float, float] | None:
    """Parse coordinates in decimal, DMS, MGRS or plus-code form.

    Every format the app can display is accepted back — a reference copied out
    of Azimut must always paste back in. Returns (lat, lon) or None.
    """
    text = text.strip()

    # decimal: "50.4501, 30.5234" / "50.4501 30.5234"
    m = re.fullmatch(rf"\s*({_DEC})\s*[,;\s]\s*({_DEC})\s*", text)
    if m:
        lat, lon = float(m.group(1)), float(m.group(2))
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            return lat, lon
        return None

    # DMS pair: 50°27'0.4"N 30°31'24.2"E
    parts = re.findall(_DMS, text, flags=re.IGNORECASE)
    if len(parts) == 2:
        values = []
        for deg, minute, sec, hemi in parts:
            value = float(deg) + float(minute or 0) / 60 + float(sec or 0) / 3600
            if hemi.upper() in "SW":
                value = -value
            values.append((value, hemi.upper()))
        dms_lat = next((v for v, h in values if h in "NS"), None)
        dms_lon = next((v for v, h in values if h in "EW"), None)
        if (
            dms_lat is not None and dms_lon is not None
            and -90 <= dms_lat <= 90 and -180 <= dms_lon <= 180
        ):
            return dms_lat, dms_lon

    # MGRS: "31U DQ 48250 11951" (spacing optional)
    mgrs = coords.parse_mgrs(text)
    if mgrs:
        return mgrs

    # UTM: "31U 448251 5411932" — bands C-M are the southern hemisphere.
    m = re.fullmatch(_UTM, text, flags=re.IGNORECASE)
    if m:
        zone = int(m.group("zone"))
        southern = m.group("band").upper() < "N"
        lat, lon = coords.from_utm(
            zone, float(m.group("easting")), float(m.group("northing")), southern
        )
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            return lat, lon
        return None

    # full plus code: "8FW4V75V+8Q"
    plus = parse_plus_code(text)
    if plus:
        return plus

    # geohash: "u09tvw0f" — tried last, it is the most permissive shape
    return parse_geohash(text)


def parse_plus_code(text: str) -> tuple[float, float] | None:
    """Decode a full Open Location Code to its cell centre. None otherwise.

    Only full codes (the 8+2 form the app generates) — a short code needs a
    reference location to resolve, which a paste doesn't carry.
    """
    code = text.strip().upper()
    if not re.fullmatch(rf"[{_OLC_ALPHABET}]{{8}}\+[{_OLC_ALPHABET}]{{2}}", code):
        return None
    digits = code.replace("+", "")
    lat, lon = 0.0, 0.0
    res = 20.0
    for i in range(0, 10, 2):
        lat += _OLC_ALPHABET.index(digits[i]) * res
        lon += _OLC_ALPHABET.index(digits[i + 1]) * res
        res /= 20
    res *= 20  # the last pair's cell size
    return lat - 90 + res / 2, lon - 180 + res / 2


# -- formatting ------------------------------------------------------------------


def to_dms(lat: float, lon: float) -> str:
    def fmt(value: float, pos: str, neg: str) -> str:
        hemi = pos if value >= 0 else neg
        value = abs(value)
        deg = int(value)
        minutes = (value - deg) * 60
        mins = int(minutes)
        secs = (minutes - mins) * 60
        return f"{deg}°{mins:02d}'{secs:04.1f}\"{hemi}"

    return f"{fmt(lat, 'N', 'S')} {fmt(lon, 'E', 'W')}"


def to_ddm(lat: float, lon: float) -> str:
    """Degrees decimal minutes, e.g. "48°51.502'N 2°17.669'E" (~0.06 m on lat)."""

    def fmt(value: float, pos: str, neg: str) -> str:
        hemi = pos if value >= 0 else neg
        value = abs(value)
        deg = int(value)
        minutes = (value - deg) * 60
        return f"{deg}°{minutes:06.3f}'{hemi}"

    return f"{fmt(lat, 'N', 'S')} {fmt(lon, 'E', 'W')}"


def to_utm(lat: float, lon: float) -> str | None:
    """UTM grid reference, e.g. "31U 448251 5411932". None outside its domain."""
    band = coords.lat_band(lat)
    if band is None:
        return None
    zone, easting, northing = coords.to_utm(lat, lon)
    return f"{zone}{band} {round(easting)} {round(northing)}"


# -- geohash ------------------------------------------------------------------------
# Standard base32 geohash (public-domain algorithm), used by many OSINT sites.

_GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def geohash(lat: float, lon: float, precision: int = 9) -> str:
    lat_lo, lat_hi = -90.0, 90.0
    lon_lo, lon_hi = -180.0, 180.0
    out: list[str] = []
    bit = 0
    ch = 0
    even = True  # even bits refine longitude
    while len(out) < precision:
        if even:
            mid = (lon_lo + lon_hi) / 2
            if lon >= mid:
                ch = (ch << 1) | 1
                lon_lo = mid
            else:
                ch <<= 1
                lon_hi = mid
        else:
            mid = (lat_lo + lat_hi) / 2
            if lat >= mid:
                ch = (ch << 1) | 1
                lat_lo = mid
            else:
                ch <<= 1
                lat_hi = mid
        even = not even
        if bit < 4:
            bit += 1
        else:
            out.append(_GEOHASH_BASE32[ch])
            bit = 0
            ch = 0
    return "".join(out)


def parse_geohash(text: str) -> tuple[float, float] | None:
    """Decode a geohash to its cell centre. None if it holds a non-base32 char."""
    code = text.strip().lower()
    if not code or len(code) < 4:  # too short to be an unambiguous paste
        return None
    lat_lo, lat_hi = -90.0, 90.0
    lon_lo, lon_hi = -180.0, 180.0
    even = True
    for c in code:
        idx = _GEOHASH_BASE32.find(c)
        if idx < 0:
            return None
        for mask in (16, 8, 4, 2, 1):
            if even:
                mid = (lon_lo + lon_hi) / 2
                if idx & mask:
                    lon_lo = mid
                else:
                    lon_hi = mid
            else:
                mid = (lat_lo + lat_hi) / 2
                if idx & mask:
                    lat_lo = mid
                else:
                    lat_hi = mid
            even = not even
    return (lat_lo + lat_hi) / 2, (lon_lo + lon_hi) / 2


# -- Open Location Code (plus codes) ----------------------------------------------
# Standard encoding, full 10-character code + '+'. Public-domain algorithm.

_OLC_ALPHABET = "23456789CFGHJMPQRVWX"


def plus_code(lat: float, lon: float) -> str:
    lat = min(max(lat + 90, 0), 180 - 1e-12)
    lon = ((lon + 180) % 360 + 360) % 360  # normalize to [0, 360)
    code = []
    lat_res, lon_res = 20.0, 20.0
    for _ in range(5):  # 10 chars in 5 pairs
        lat_digit = int(lat / lat_res)
        lon_digit = int(lon / lon_res)
        code.append(_OLC_ALPHABET[lat_digit])
        code.append(_OLC_ALPHABET[lon_digit])
        lat -= lat_digit * lat_res
        lon -= lon_digit * lon_res
        lat_res /= 20
        lon_res /= 20
    return "".join(code[:8]) + "+" + "".join(code[8:])


def all_formats(lat: float, lon: float) -> list[dict[str, str]]:
    """Every coordinate notation the app can render, ordered for display.

    Notations that don't cover the poles (UTM, MGRS) are simply left out when a
    point falls outside their domain, so the list is always well-formed.
    """
    rows = [
        ("dd", "Decimal", coords.format_dd(lat, lon)),
        ("ddm", "Deg. decimal min.", to_ddm(lat, lon)),
        ("dms", "Deg. min. sec.", to_dms(lat, lon)),
        ("utm", "UTM", to_utm(lat, lon)),
        ("mgrs", "MGRS", coords.format_mgrs(lat, lon)),
        ("plus_code", "Plus code", plus_code(lat, lon)),
        ("geohash", "Geohash", geohash(lat, lon)),
    ]
    return [{"id": i, "label": lb, "value": v} for i, lb, v in rows if v]


# -- map links (quick-open, spec Coordinates tool preview) --------------------------


def map_links(lat: float, lon: float, zoom: int = 17) -> dict[str, str]:
    return {
        "google": f"https://www.google.com/maps/@{lat},{lon},{zoom}z",
        "google_sat": f"https://www.google.com/maps/@{lat},{lon},2000m/data=!3m1!1e3",
        "google_earth": f"https://earth.google.com/web/@{lat},{lon},0a,1000d,35y,0h,0t,0r",
        "apple": f"https://maps.apple.com/?ll={lat},{lon}&z={zoom}&t=k",
        "osm": f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map={zoom}/{lat}/{lon}",
        "bing": f"https://www.bing.com/maps?cp={lat}~{lon}&lvl={zoom}&style=h",
        "yandex": f"https://yandex.com/maps/?ll={lon},{lat}&z={zoom}&l=sat",
        "sentinel": f"https://browser.dataspace.copernicus.eu/?zoom={zoom}&lat={lat}&lng={lon}",
        "zoom_earth": f"https://zoom.earth/#view={lat},{lon},{zoom}z",
        "satellites_pro": f"https://satellites.pro/#{lat},{lon},{zoom}",
    }


# -- reverse geocoding (Nominatim, polite) ------------------------------------------


def geocode(query: str) -> dict[str, Any] | None:
    """Best-effort forward geocoding via Nominatim. Returns None on any failure."""
    try:
        response = httpx.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": query, "format": "jsonv2", "limit": 1},
            headers={"User-Agent": USER_AGENT},
            timeout=8,
        )
        response.raise_for_status()
        results = response.json()
        if not results:
            return None
        top = results[0]
        return {
            "lat": float(top["lat"]),
            "lon": float(top["lon"]),
            "display_name": top.get("display_name"),
            "attribution": "© OpenStreetMap contributors (Nominatim)",
        }
    except Exception:
        return None


def reverse_geocode(lat: float, lon: float) -> dict[str, Any] | None:
    """Best-effort place name via Nominatim. Returns None on any failure."""
    try:
        response = httpx.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 14},
            headers={"User-Agent": USER_AGENT},
            timeout=8,
        )
        response.raise_for_status()
        data = response.json()
        return {
            "display_name": data.get("display_name"),
            "address": data.get("address", {}),
            "attribution": "© OpenStreetMap contributors (Nominatim)",
        }
    except Exception:
        return None
