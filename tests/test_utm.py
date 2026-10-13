"""UTM from latitude and longitude, against PROJ's own figures."""

from __future__ import annotations

import pytest

from azimut.engine import utm


@pytest.mark.parametrize(
    ("lat", "lon", "zone", "south", "x", "y"),
    [
        # on a zone's central meridian at the equator: the false easting and nothing else
        (0.0, 3.0, 31, False, 500000.0, 0.0),
        (0.0, 3.0, 31, True, 500000.0, 10000000.0),
        # the reference figures below are PROJ's (pyproj, EPSG:4326 to the zone's EPSG code)
        (48.8583701, 2.2944813, 31, False, 448250.599, 5411951.599),
        (-22.951916, -43.2104872, 23, True, 683477.800, 7460685.520),
        (10.4880, -66.8150, 19, False, 739154.754, 1160198.671),
        (13.578, 44.018, 38, False, 393757.746, 1501269.765),
    ],
)
def test_points_land_where_their_published_coordinates_say(lat, lon, zone, south, x, y):
    got_x, got_y = utm.forward(lat, lon, zone, south)
    assert float(got_x) == pytest.approx(x, abs=0.01)
    assert float(got_y) == pytest.approx(y, abs=0.01)


def test_the_zone_and_its_code():
    assert utm.zone_of(48.85, 2.29) == (31, False)
    assert utm.zone_of(-22.95, -43.21) == (23, True)
    assert utm.zone_of(10.49, -66.81) == (19, False)
    assert utm.epsg_of(19, False) == 32619 and utm.epsg_of(23, True) == 32723
