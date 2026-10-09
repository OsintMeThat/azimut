"""Turns of skyline and traces drawn on them, for the skyline-matching tests.

`skyturn` builds a whole turn from bumps, `trace_on` draws the trace a camera
would see of it on the picture plane (engine/skymatch.py): shared by the
engine's tests and the route's, which run in different CI shards.
"""

import numpy as np

from azimut.engine import skymatch

HALF = 500.0  # half the frame's width on screen, pixels
STEP = 0.1


def skyturn(bumps, base=1.0, nan_between=None):
    """A skyline all round: `bumps` are (azimuth, height, width) in degrees."""
    az = np.arange(0.0, 360.0, STEP)
    angles = np.full(az.size, base)
    for at, height, width in bumps:
        away = (az - at + 180.0) % 360.0 - 180.0
        angles += height * np.exp(-(away**2) / (2 * width**2))
    if nan_between:
        low, high = nan_between
        angles[(az >= low) & (az < high)] = np.nan
    return skymatch.Turn(0.0, STEP, angles)


RANGE = skyturn([(40, 6, 3), (52, 3.5, 1.5), (61, 4.5, 4), (150, 2, 8), (230, 5, 2), (300, 3, 6)])


def trace_on(turn, heading, fov, tilt=0.0, roll=0.0, count=200, reach=0.95):
    """Picture-plane points along the skyline a camera sees: for each x, the y where the
    ray's elevation meets the terrain's skyline under it."""
    x = np.linspace(-reach, reach, count)
    low, high = np.full(count, -3.0), np.full(count, 3.0)
    for _ in range(60):
        y = (low + high) / 2
        azimuth, elevation = skymatch.directions(x, y, fov=fov, tilt=tilt, roll=roll)
        above = elevation > turn.at(heading + azimuth)
        high = np.where(above, y, high)
        low = np.where(above, low, y)
    return x, (low + high) / 2
