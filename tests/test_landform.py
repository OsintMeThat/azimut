"""Where an eye stands: a summit, a slope, a valley, a plain or water, read off synthetic relief."""

import numpy as np
import pytest

from azimut.engine import landform, terrain
from fakerelief import Peak, Relief, offset

TOP = (45.0, 6.0)
# a basin: six hills a kilometre round its middle
BASIN = (45.1, 6.2)


@pytest.fixture(autouse=True)
def synthetic_relief(monkeypatch):
    terrain.forget_decoded()
    hills = tuple(Peak(*offset(*BASIN, bearing, 1_000.0), height=300.0, radius=400.0) for bearing in range(0, 360, 60))
    relief = Relief(peaks=(Peak(*TOP, height=400.0, radius=600.0), *hills), plain=200.0, ripple=0.5)
    monkeypatch.setattr(terrain, "tile", relief)
    yield
    terrain.forget_decoded()


def _kind(*point):
    return str(landform.kinds(np.array([point[0]]), np.array([point[1]]))[0])


def test_the_ground_is_read_as_the_tool_says():
    assert _kind(*TOP) == "summit"
    # on the flank, between the top and the plain
    assert _kind(*offset(*TOP, 90.0, 700.0)) == "slope"
    # the bottom of the basin the hills ring
    assert _kind(*BASIN) == "valley"
    # far from any hill, the ground varies by less than the plain's threshold
    assert _kind(*offset(*TOP, 200.0, 12_000.0)) == "plain"


def test_ground_flat_to_the_centimetre_is_water(monkeypatch):
    terrain.forget_decoded()
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(), plain=0.0))
    assert _kind(*TOP) == "water"
    # a lake flattened at its own height is water too
    terrain.forget_decoded()
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(), plain=770.0))
    assert _kind(*TOP) == "water"
    # land a metre above the sea, swelling a little, is not
    terrain.forget_decoded()
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(), plain=1.0, ripple=0.5))
    assert _kind(*TOP) == "plain"


def test_many_points_are_read_at_once_and_none_is_nothing():
    lat = np.array([TOP[0], BASIN[0]])
    lon = np.array([TOP[1], BASIN[1]])
    assert list(landform.kinds(lat, lon)) == ["summit", "valley"]
    assert landform.kinds(np.array([]), np.array([])).size == 0
