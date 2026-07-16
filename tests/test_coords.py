"""Coordinate formatting: the server-side mirror of frontend/src/lib/coords.js.

The two implementations must agree exactly — a capture title minted by the API
has to read like the same point rendered in the browser. Both are checked
against the same reference vectors (generated with the NGA GEOTRANS-derived
`mgrs` library, not hand-computed).
"""

import pytest

from azimut import config
from azimut.engine import coords

# lat, lon, expected MGRS — identical to the table in coords.test.js
MGRS_VECTORS = [
    (48.8583701, 2.2944813, "31U DQ 48250 11951"),  # Eiffel Tower
    (40.6892, -74.0445, "18T WL 80735 04695"),  # Statue of Liberty
    (38.8977, -77.0365, "18S UJ 23394 07395"),  # White House
    (-33.8568, 151.2153, "56H LH 34900 52288"),  # Sydney Opera House
    (64.1466, -21.9426, "27W VM 54138 13689"),  # Reykjavík
    (-54.8019, -68.303, "19F EV 44805 27029"),  # Ushuaia
    (1.3521, 103.8198, "48N UG 68700 49479"),  # Singapore
    (78.2232, 15.6469, "33X WG 14738 83360"),  # Longyearbyen (Svalbard)
    (0.0, 0.0, "31N AA 66021 00000"),  # Null Island
    (-33.9249, 18.4241, "34H BH 61881 43182"),  # Cape Town
    (60.5, 5.0, "32V KN 80356 13774"),  # Bergen (Norway exception)
    (59.9, 4.9, "32V KM 70719 47376"),  # North Sea (Norway exception)
    (72.5, 5.0, "31X EA 67115 45822"),  # Svalbard exceptions
    (75.0, 12.0, "33X VD 13362 25798"),
    (78.0, 25.0, "35X MG 53588 59161"),
    (80.0, 35.0, "37X DJ 22516 84250"),
    (-79.9, 120.0, "51C VM 41292 28062"),  # near the southern limit
    (83.5, -40.0, "24X VT 87362 72385"),  # near the northern limit
]


@pytest.mark.parametrize("lat,lon,expected", MGRS_VECTORS)
def test_format_mgrs_matches_the_reference(lat, lon, expected):
    assert coords.format_mgrs(lat, lon) == expected


def test_format_mgrs_is_none_beyond_the_utm_limits():
    assert coords.format_mgrs(85, 10) is None
    assert coords.format_mgrs(-85, 10) is None


def test_utm_zone_exceptions():
    assert coords.utm_zone(48.8583701, 2.2944813) == 31
    assert coords.utm_zone(59.9, 4.9) == 32  # plain formula would say 31
    assert coords.utm_zone(75.0, 12.0) == 33  # Svalbard uses odd zones only


def test_lat_band_skips_i_and_o():
    assert coords.lat_band(48.86) == "U"
    assert coords.lat_band(0) == "N"
    assert coords.lat_band(83.5) == "X"  # band X stretches to the 84°N limit
    assert coords.lat_band(85) is None


def test_format_dd_and_dms():
    assert coords.format_dd(48.8583701, 2.2944813) == "48.858370, 2.294481"
    assert coords.format_dms(48.8583701, 2.2944813) == "48°51'30.13\"N 2°17'40.13\"E"
    assert coords.format_dms(-33.8568, -70.6693) == "33°51'24.48\"S 70°40'09.48\"W"
    # a second that rounds up to 60 carries into the minute
    assert coords.format_dms(1.01666664, 0) == "1°01'00.00\"N 0°00'00.00\"E"


def test_format_coords_dispatches_and_falls_back():
    assert coords.format_coords(48.8583701, 2.2944813, "dd") == "48.858370, 2.294481"
    assert coords.format_coords(48.8583701, 2.2944813, "dms") == "48°51'30.13\"N 2°17'40.13\"E"
    assert coords.format_coords(48.8583701, 2.2944813, "mgrs") == "31U DQ 48250 11951"
    assert coords.format_coords(48.8583701, 2.2944813, "nonsense") == "48.858370, 2.294481"
    # MGRS can't reach the poles — a label is never blank
    assert coords.format_coords(85, 10, "mgrs") == "85.000000, 10.000000"


def test_format_coords_follows_the_saved_preference(tmp_workspace):
    assert coords.format_coords(48.8583701, 2.2944813) == "48.858370, 2.294481"
    settings = config.load_settings()
    settings["coord_format"] = "mgrs"
    config.save_settings(settings)
    assert coords.format_coords(48.8583701, 2.2944813) == "31U DQ 48250 11951"
