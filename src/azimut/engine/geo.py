"""Coordinate utilities: parsing, formats (decimal/DMS/plus code), reverse geocoding."""

from __future__ import annotations

import math
import re
from typing import Any

import httpx

from .tiles import USER_AGENT

# -- parsing -------------------------------------------------------------------

_DEC = r"[-+]?\d{1,3}(?:\.\d+)?"
_DMS = (
    r"(?P<deg>\d{1,3})\s*[°d]\s*(?:(?P<min>\d{1,2})\s*[’'m]\s*)?"
    r"(?:(?P<sec>\d{1,2}(?:\.\d+)?)\s*[”\"s]\s*)?(?P<hemi>[NSEW])"
)


def parse_coords(text: str) -> tuple[float, float] | None:
    """Parse 'lat, lon' in decimal or DMS. Returns (lat, lon) or None."""
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
        lat = next((v for v, h in values if h in "NS"), None)
        lon = next((v for v, h in values if h in "EW"), None)
        if lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180:
            return lat, lon
    return None


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


# -- map links (quick-open, spec Coordinates tool preview) --------------------------


def map_links(lat: float, lon: float, zoom: int = 17) -> dict[str, str]:
    return {
        "google": f"https://www.google.com/maps/@{lat},{lon},{zoom}z",
        "google_sat": f"https://www.google.com/maps/@{lat},{lon},2000m/data=!3m1!1e3",
        "google_earth": f"https://earth.google.com/web/@{lat},{lon},0a,1000d,35y,0h,0t,0r",
        "osm": f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map={zoom}/{lat}/{lon}",
        "bing": f"https://www.bing.com/maps?cp={lat}~{lon}&lvl={zoom}&style=h",
        "yandex": f"https://yandex.com/maps/?ll={lon},{lat}&z={zoom}&l=sat",
        "sentinel": f"https://browser.dataspace.copernicus.eu/?zoom={zoom}&lat={lat}&lng={lon}",
        "zoom_earth": f"https://zoom.earth/#view={lat},{lon},{zoom}z",
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
