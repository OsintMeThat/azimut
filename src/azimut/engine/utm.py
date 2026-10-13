"""Latitude and longitude to UTM metres, for rasters published in UTM.

The transverse Mercator projection on WGS84 by Krüger's series to the third
order (the form the USGS gives), which keeps well under a millimetre
inside a zone: enough to find a building's pixels in a raster at half a metre.
Vectorised over numpy arrays, since a footprint is many points.
"""

from __future__ import annotations

import math

import numpy as np

_A = 6378137.0
_F = 1 / 298.257223563
_K0 = 0.9996
_N = _F / (2 - _F)
_RECT = _A / (1 + _N) * (1 + _N**2 / 4 + _N**4 / 64)
_ALPHA = (
    _N / 2 - 2 * _N**2 / 3 + 5 * _N**3 / 16,
    13 * _N**2 / 48 - 3 * _N**3 / 5,
    61 * _N**3 / 240,
)


def zone_of(lat: float, lon: float) -> tuple[int, bool]:
    """The UTM zone a point falls in, and whether it is south of the equator.

    The Norway and Svalbard exceptions are left out: no raster this reads is there.
    """
    zone = int((lon + 180) // 6) + 1
    return min(max(zone, 1), 60), lat < 0


def epsg_of(zone: int, south: bool) -> int:
    return (32700 if south else 32600) + zone


def forward(
    lat: np.ndarray | float, lon: np.ndarray | float, zone: int, south: bool,
) -> tuple[np.ndarray, np.ndarray]:
    """Easting and northing in metres of points in a given zone (they may lie a little outside it)."""
    phi = np.radians(np.asarray(lat, dtype=np.float64))
    lam = np.radians(np.asarray(lon, dtype=np.float64)) - math.radians(zone * 6 - 183)
    e = math.sqrt(_F * (2 - _F))
    t = np.sinh(np.arctanh(np.sin(phi)) - e * np.arctanh(e * np.sin(phi)))
    xi = np.arctan2(t, np.cos(lam))
    eta = np.arctanh(np.sin(lam) / np.sqrt(1 + t * t))
    easting = eta.copy()
    northing = xi.copy()
    for j, alpha in enumerate(_ALPHA, start=1):
        easting += alpha * np.cos(2 * j * xi) * np.sinh(2 * j * eta)
        northing += alpha * np.sin(2 * j * xi) * np.cosh(2 * j * eta)
    x = 500000.0 + _K0 * _RECT * easting
    y = _K0 * _RECT * northing + (10000000.0 if south else 0.0)
    return x, y
