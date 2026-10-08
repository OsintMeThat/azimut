"""Synthetic relief for terrain tests: mountains placed where a test wants them.

`Relief` is a tile fetch a `terrain.Sampler` accepts. Each tile is drawn from
an analytic height field (round Gaussian peaks over a flat plain), encoded the
way Mapterhorn serves it, so a test exercises the whole path from tile to angle
and knows the answer in closed form.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from azimut.engine import terrain


@dataclass(frozen=True)
class Peak:
    lat: float
    lon: float
    height: float  # metres above the plain
    radius: float  # metres, one standard deviation


@dataclass
class Relief:
    peaks: tuple[Peak, ...]
    plain: float = 0.0
    calls: list[tuple[int, int, int]] = field(default_factory=list)

    def height(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        lat, lon = np.broadcast_arrays(np.asarray(lat, float), np.asarray(lon, float))
        out = np.full(lat.shape, self.plain, dtype=np.float64)
        for peak in self.peaks:
            north = (lat - peak.lat) * 111_195.0
            east = (lon - peak.lon) * 111_195.0 * math.cos(math.radians(peak.lat))
            out += peak.height * np.exp(-(north**2 + east**2) / (2 * peak.radius**2))
        return out

    def __call__(self, z: int, x: int, y: int) -> terrain.Fetched:
        self.calls.append((z, x, y))
        world = float(terrain.TILE << z)
        i = np.arange(terrain.TILE) + 0.5
        lon = (x * terrain.TILE + i) / world * 360.0 - 180.0
        merc = math.pi * (1 - 2 * (y * terrain.TILE + i) / world)
        lat = np.degrees(np.arctan(np.sinh(merc)))
        heights = self.height(lat[:, None], lon[None, :])
        return terrain.encode(heights), "image/png", terrain.MAPTERHORN.id


def offset(lat: float, lon: float, bearing: float, metres: float) -> tuple[float, float]:
    """The point `metres` away along `bearing`, as plain floats."""
    la, lo = terrain.destination(lat, lon, bearing, metres)
    return float(la), float(lo)
