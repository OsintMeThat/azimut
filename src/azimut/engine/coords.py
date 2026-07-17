"""Latitude/longitude presentation — the server-side mirror of
``frontend/src/lib/coords.js``.

The app stores decimal degrees everywhere (case.json, sidecars, proof specs).
This module only decides how a pair is *written out* in a human-facing label,
following the user's ``coord_format`` preference (Settings → Preferences).

Both implementations must agree: a title minted here has to read exactly like
the same point rendered in the browser, so they are tested against the same
reference vectors (tests/test_coords.py, frontend/src/lib/coords.test.js).
"""

from __future__ import annotations

import math
import re

from .. import config

# WGS84 / UTM constants
_A = 6378137.0  # semi-major axis (m)
_F = 1 / 298.257223563  # flattening
_K0 = 0.9996  # UTM scale factor on the central meridian
_E2 = _F * (2 - _F)  # first eccentricity squared
_EP2 = _E2 / (1 - _E2)  # second eccentricity squared

# Latitude bands, 8° each from 80°S; I and O are skipped so they can't read as
# 1 and 0. The last band (X) is 12° tall and runs to the 84°N UTM limit.
_BANDS = "CDEFGHJKLMNPQRSTUVWX"
# 100 km square identifiers: the column letter cycles through three alphabet
# sets by zone, the row letter through 20 letters offset by half the alphabet
# on even zones (the standard AA lettering scheme).
_COL_SETS = ("ABCDEFGH", "JKLMNPQR", "STUVWXYZ")
_ROW_LETTERS = "ABCDEFGHJKLMNPQRSTUV"


def format_dd(lat: float, lon: float) -> str:
    """Decimal degrees, 6 dp (~0.11 m) — the app's native precision."""
    return f"{lat:.6f}, {lon:.6f}"


def _dms_part(value: float, positive: str, negative: str) -> str:
    hemi = positive if value >= 0 else negative
    value = abs(value)
    deg = int(value)
    minutes = int((value - deg) * 60)
    sec = (value - deg - minutes / 60) * 3600
    # rounding the seconds for display can carry into the minute (and the degree)
    if round(sec, 2) >= 60:
        sec = 0.0
        minutes += 1
    if minutes >= 60:
        minutes = 0
        deg += 1
    return f"{deg}°{minutes:02d}'{sec:05.2f}\"{hemi}"


def format_dms(lat: float, lon: float) -> str:
    """Degrees/minutes/seconds, 2 dp on the seconds (~0.3 m)."""
    return f"{_dms_part(lat, 'N', 'S')} {_dms_part(lon, 'E', 'W')}"


def utm_zone(lat: float, lon: float) -> int:
    """The UTM zone for a point, including the two irregularities every MGRS
    implementation carries: zone 32 is widened over south-west Norway, and band
    X over Svalbard uses only the odd zones 31/33/35/37."""
    if 56 <= lat < 64 and 3 <= lon < 12:
        return 32
    if 72 <= lat < 84 and 0 <= lon < 42:
        if lon < 9:
            return 31
        if lon < 21:
            return 33
        if lon < 33:
            return 35
        return 37
    return int((lon + 180) // 6) + 1


def lat_band(lat: float) -> str | None:
    """The MGRS latitude band letter, or None outside the UTM domain."""
    if lat < -80 or lat > 84:
        return None
    if lat >= 72:
        return "X"
    return _BANDS[int((lat + 80) // 8)]


def to_utm(lat: float, lon: float) -> tuple[int, float, float]:
    """Project to UTM: (zone, easting, northing) in metres."""
    zone = utm_zone(lat, lon)
    lon0 = math.radians((zone - 1) * 6 - 180 + 3)  # central meridian of the zone
    phi = math.radians(lat)
    lam = math.radians(lon)

    sin_phi = math.sin(phi)
    cos_phi = math.cos(phi)
    tan_phi = math.tan(phi)

    n = _A / math.sqrt(1 - _E2 * sin_phi * sin_phi)
    t = tan_phi * tan_phi
    c = _EP2 * cos_phi * cos_phi
    # keep the longitude difference in (-180, 180] so a zone straddling the
    # antimeridian doesn't blow the series up
    d_lon = lam - lon0
    if d_lon > math.pi:
        d_lon -= 2 * math.pi
    if d_lon < -math.pi:
        d_lon += 2 * math.pi
    a = d_lon * cos_phi

    # meridional arc
    m = _A * (
        (1 - _E2 / 4 - 3 * _E2**2 / 64 - 5 * _E2**3 / 256) * phi
        - (3 * _E2 / 8 + 3 * _E2**2 / 32 + 45 * _E2**3 / 1024) * math.sin(2 * phi)
        + (15 * _E2**2 / 256 + 45 * _E2**3 / 1024) * math.sin(4 * phi)
        - (35 * _E2**3 / 3072) * math.sin(6 * phi)
    )

    easting = (
        _K0
        * n
        * (
            a
            + (1 - t + c) * a**3 / 6
            + (5 - 18 * t + t * t + 72 * c - 58 * _EP2) * a**5 / 120
        )
        + 500000
    )
    northing = _K0 * (
        m
        + n
        * tan_phi
        * (
            a * a / 2
            + (5 - t + 9 * c + 4 * c * c) * a**4 / 24
            + (61 - 58 * t + t * t + 600 * c - 330 * _EP2) * a**6 / 720
        )
    )
    if lat < 0:
        northing += 10000000  # southern hemisphere false northing
    return zone, easting, northing


def from_utm(zone: int, easting: float, northing: float, southern: bool) -> tuple[float, float]:
    """Inverse UTM projection: (lat, lon) for a zone/easting/northing triple."""
    x = easting - 500000
    y = northing - (10000000 if southern else 0)

    m = y / _K0
    mu = m / (_A * (1 - _E2 / 4 - 3 * _E2**2 / 64 - 5 * _E2**3 / 256))
    e1 = (1 - math.sqrt(1 - _E2)) / (1 + math.sqrt(1 - _E2))
    phi1 = (
        mu
        + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu)
        + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
        + (151 * e1**3 / 96) * math.sin(6 * mu)
        + (1097 * e1**4 / 512) * math.sin(8 * mu)
    )

    sin1 = math.sin(phi1)
    cos1 = math.cos(phi1)
    tan1 = math.tan(phi1)
    c1 = _EP2 * cos1 * cos1
    t1 = tan1 * tan1
    n1 = _A / math.sqrt(1 - _E2 * sin1 * sin1)
    r1 = _A * (1 - _E2) / (1 - _E2 * sin1 * sin1) ** 1.5
    d = x / (n1 * _K0)

    lat = phi1 - (n1 * tan1 / r1) * (
        d * d / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * _EP2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * _EP2 - 3 * c1 * c1) * d**6 / 720
    )
    lon0 = math.radians((zone - 1) * 6 - 180 + 3)
    lon = lon0 + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * _EP2 + 24 * t1 * t1) * d**5 / 120
    ) / cos1
    return math.degrees(lat), math.degrees(lon)


_MGRS_RE = (
    r"(?P<zone>\d{1,2})\s*(?P<band>[C-HJ-NP-X])\s*"
    r"(?P<col>[A-HJ-NP-Z])(?P<row>[A-HJ-NP-V])\s*(?P<digits>\d[\d ]*)?"
)


def parse_mgrs(text: str) -> tuple[float, float] | None:
    """Parse an MGRS reference ("31U DQ 48250 11951", spacing optional) to the
    centre of its cell. None when the text isn't MGRS or the square is invalid.
    """
    m = re.fullmatch(_MGRS_RE, text.strip().upper())
    if not m:
        return None
    zone = int(m.group("zone"))
    band = m.group("band")
    if not 1 <= zone <= 60:
        return None
    groups = (m.group("digits") or "").split()
    if len(groups) == 2 and len(groups[0]) != len(groups[1]):
        return None  # "482 11951" is a typo, not a 10 m reference
    digits = "".join(groups)
    if len(digits) % 2 or len(digits) > 10:
        return None
    half = len(digits) // 2
    unit = 10 ** (5 - half)  # metres per least-significant digit
    e_in = (int(digits[:half]) if half else 0) * unit + unit / 2
    n_in = (int(digits[half:]) if half else 0) * unit + unit / 2

    col_set = _COL_SETS[(zone - 1) % 3]
    if m.group("col") not in col_set:
        return None
    e100k = (col_set.index(m.group("col")) + 1) * 100000
    row_index = _ROW_LETTERS.index(m.group("row"))
    if zone % 2 == 0:
        row_index = (row_index - 5) % 20
    n100k = row_index * 100000

    # The 100 km row letters repeat every 2,000 km; the band letter picks which
    # repeat. Try each candidate and keep the one that lands inside the band.
    southern = band < "N"
    band_bottom = -80 + _BANDS.index(band) * 8
    band_top = 84 if band == "X" else band_bottom + 8
    for k in range(0, 10):
        northing = n100k + n_in + k * 2000000
        lat, lon = from_utm(zone, e100k + e_in, northing, southern)
        # half a degree of slack: points near a band edge round across it
        if band_bottom - 0.5 <= lat <= band_top + 0.5:
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return lat, lon
    return None


def format_mgrs(lat: float, lon: float) -> str | None:
    """Military Grid Reference System, 1 m precision — e.g. "31U DQ 48250 11951".

    None outside the UTM domain (the poles use UPS, which the tools never need).
    """
    band = lat_band(lat)
    if band is None:
        return None
    zone, easting, northing = to_utm(lat, lon)
    col = _COL_SETS[(zone - 1) % 3][int(easting // 100000) - 1]
    row_index = int(northing // 100000) % 20
    if zone % 2 == 0:
        row_index = (row_index + 5) % 20
    row = _ROW_LETTERS[row_index]
    return f"{zone}{band} {col}{row} {int(easting % 100000):05d} {int(northing % 100000):05d}"


def format_coords(lat: float, lon: float, fmt: str | None = None) -> str:
    """Render a pair in `fmt`, defaulting to the user's saved preference.

    Unknown formats — and points MGRS can't express — fall back to decimal
    degrees, so a label is never blank.
    """
    if fmt is None:
        fmt = config.load_settings().get("coord_format", "dd")
    if fmt == "dms":
        return format_dms(lat, lon)
    if fmt == "mgrs":
        return format_mgrs(lat, lon) or format_dd(lat, lon)
    return format_dd(lat, lon)
