"""Coordinate notations for the Coordinates tool: DDM, UTM, geohash + round-trips.

Every notation the app can *display* must parse back in (the geo.py contract),
so these vectors check the formatter and the parser against each other.
"""

import pytest

from azimut.engine import geo

# A spread of points, including a southern/western one and Null Island.
POINTS = [
    (48.8583701, 2.2944813),  # Eiffel Tower
    (-33.8568, 151.2153),  # Sydney Opera House
    (-54.8019, -68.303),  # Ushuaia (southern + western)
    (0.0, 0.0),  # Null Island
    (64.1466, -21.9426),  # Reykjavík
]


def test_ddm_format_and_hemispheres():
    assert geo.to_ddm(48.8583701, 2.2944813) == "48°51.502'N 2°17.669'E"
    assert geo.to_ddm(-33.8568, -70.6693) == "33°51.408'S 70°40.158'W"


def test_utm_format_and_domain():
    assert geo.to_utm(48.8583701, 2.2944813) == "31U 448251 5411952"
    # UTM/MGRS don't cover the poles → no string rather than a wrong one
    assert geo.to_utm(89.5, 10.0) is None


def test_geohash_known_vector():
    # Eiffel Tower, precision 9 (matches the geohash.org reference)
    assert geo.geohash(48.8583701, 2.2944813) == "u09tunqu9"


@pytest.mark.parametrize("lat,lon", POINTS)
def test_ddm_round_trips(lat, lon):
    parsed = geo.parse_coords(geo.to_ddm(lat, lon))
    assert parsed is not None
    assert parsed[0] == pytest.approx(lat, abs=1e-3)
    assert parsed[1] == pytest.approx(lon, abs=1e-3)


@pytest.mark.parametrize("lat,lon", POINTS)
def test_utm_round_trips(lat, lon):
    utm = geo.to_utm(lat, lon)
    assert utm is not None
    parsed = geo.parse_coords(utm)
    assert parsed is not None
    assert parsed[0] == pytest.approx(lat, abs=1e-4)
    assert parsed[1] == pytest.approx(lon, abs=1e-4)


@pytest.mark.parametrize("lat,lon", POINTS)
def test_geohash_round_trips(lat, lon):
    parsed = geo.parse_coords(geo.geohash(lat, lon))
    assert parsed is not None
    assert parsed[0] == pytest.approx(lat, abs=1e-4)
    assert parsed[1] == pytest.approx(lon, abs=1e-4)


def test_geohash_rejects_non_base32_and_short_strings():
    # a, i, l, o are absent from the geohash alphabet
    assert geo.parse_geohash("aiou") is None
    # too short to be an unambiguous paste
    assert geo.parse_geohash("u0") is None


def test_all_formats_is_ordered_and_labelled():
    rows = geo.all_formats(48.8583701, 2.2944813)
    assert [r["id"] for r in rows] == ["dd", "ddm", "dms", "utm", "mgrs", "plus_code", "geohash"]
    assert all(r["label"] and r["value"] for r in rows)


def test_all_formats_drops_utm_mgrs_at_the_poles():
    rows = geo.all_formats(89.9, 10.0)
    ids = [r["id"] for r in rows]
    assert "utm" not in ids and "mgrs" not in ids
    # the global notations still render
    assert {"dd", "ddm", "dms", "plus_code", "geohash"} <= set(ids)
