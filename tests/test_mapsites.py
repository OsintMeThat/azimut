"""Map-site URL parsers (engine/mapsites.py).

Server-side on purpose: URL formats race sites that change without notice and
the extension can't be updated remotely — so every rule is here, where an app
update fixes it. The contract: a recognized map site always returns its site
id (coordinates/title/imagery date when the URL carries them, None when it
doesn't), anything else returns None, and nothing ever raises.
"""

import pytest

from azimut.engine.mapsites import parse_map_url

LAT, LON, Z = 45.197652, 11.777344, 6


# Mirrors frontend/src/lib/maplinks.js exactly: whatever Azimut can send the
# user out to, the backend must be able to read back.
OPEN_IN_LINKS = [
    (f"https://www.google.com/maps/@{LAT},{LON},{Z}z", "google-maps", Z),
    (f"https://www.google.com/maps/@{LAT},{LON},2000m/data=!3m1!1e3", "google-maps", None),
    (f"https://earth.google.com/web/@{LAT},{LON},0a,1000d,35y,0h,0t,0r", "google-earth", None),
    (f"https://maps.apple.com/?ll={LAT},{LON}&z={Z}&t=k", "apple-maps", Z),
    (f"https://www.bing.com/maps?cp={LAT}~{LON}&lvl={Z}&style=h", "bing-maps", Z),
    (f"https://yandex.com/maps/?ll={LON},{LAT}&z={Z}&l=sat", "yandex-maps", Z),
    (f"https://browser.dataspace.copernicus.eu/?zoom={Z}&lat={LAT}&lng={LON}",
     "copernicus-browser", Z),
    (f"https://zoom.earth/#view={LAT},{LON},{Z}z", "zoom-earth", Z),
]


@pytest.mark.parametrize("url,site,zoom", OPEN_IN_LINKS)
def test_every_open_in_link_round_trips(url, site, zoom):
    p = parse_map_url(url)
    assert p["site"] == site
    assert p["lat"] == LAT and p["lon"] == LON
    assert p["zoom"] == zoom


def test_satellites_pro_still_parses():
    # dropped from the app's quick links (its basemaps duplicate the others),
    # but a user browsing there themselves still gets their capture read back
    p = parse_map_url(f"https://satellites.pro/#{LAT},{LON},{Z}")
    assert (p["site"], p["lat"], p["lon"], p["zoom"]) == ("satellites-pro", LAT, LON, Z)


def test_google_maps_forms():
    p = parse_map_url(
        "https://www.google.com/maps/place/Tour+Eiffel/@48.8583701,2.2944813,17z/data=!3m1!4b1"
    )
    assert (p["site"], p["lat"], p["zoom"], p["title"]) == (
        "google-maps", 48.8583701, 17, "Tour Eiffel")
    # a pinned place without an @ viewport — !3d/!4d
    p = parse_map_url("https://www.google.com/maps/place/x/data=!8m2!3d48.85!4d2.29")
    assert (p["lat"], p["lon"]) == (48.85, 2.29)
    # a share short-link: recognized, no coordinates
    assert parse_map_url("https://maps.app.goo.gl/AbCdEf123")["lat"] is None
    # google search is not a map
    assert parse_map_url("https://www.google.com/search?q=eiffel+tower") is None


def test_google_earth_heading_and_search_name():
    p = parse_map_url(
        "https://earth.google.com/web/search/Palais%20de%20l%27%C3%89lys%C3%A9e/"
        "@48.8704156,2.3167542,79a,684d,35y,41.12345h,45.18471069t,0r"
    )
    assert p["title"] == "Palais de l'Élysée"
    assert p["bearing"] == pytest.approx(41.12345)
    assert p["zoom"] is None  # Earth encodes camera distance, not web zoom


@pytest.mark.parametrize("url,title", [
    ("https://www.bing.com/maps?q=tour+eiffel&cp=48.85~2.29&lvl=17", "tour eiffel"),
    ("https://yandex.com/maps/?text=tour%20eiffel&ll=2.29,48.85&z=17", "tour eiffel"),
    ("https://maps.apple.com/?q=Tour+Eiffel&ll=48.85,2.29&z=17", "Tour Eiffel"),
    ("https://www.openstreetmap.org/search?query=tour+eiffel#map=17/48.85/2.29", "tour eiffel"),
    # nothing named in the URL → the app titles by coordinates instead
    ("https://www.google.com/maps/@48.85,2.29,17z", None),
    ("https://satellites.pro/#48.85,2.29,17", None),
])
def test_place_names_become_the_suggested_title(url, title):
    assert parse_map_url(url)["title"] == title


def test_imagery_dates_only_where_urls_honestly_carry_them():
    p = parse_map_url(
        "https://browser.dataspace.copernicus.eu/?zoom=12&lat=45.19&lng=11.77"
        "&fromTime=2024-07-01T00%3A00%3A00.000Z&toTime=2024-07-01T23%3A59%3A59.999Z"
    )
    assert p["imagery_date"] == "2024-07-01"
    # zoom earth daily date, single-digit parts normalized
    p = parse_map_url("https://zoom.earth/maps/daily/#view=45.19,11.77,8z/date=2025-7-4")
    assert p["imagery_date"] == "2025-07-04"
    # junk dates are dropped, not passed through
    assert parse_map_url("https://zoom.earth/#view=45.19,11.77,8z/date=2025-99-99")[
        "imagery_date"] is None
    # sites whose URLs carry no date — never invented
    assert parse_map_url("https://www.google.com/maps/@48.85,2.29,17z")["imagery_date"] is None


def test_refusals_and_malformed_input():
    # non-map sites: the extension stays out
    assert parse_map_url("https://twitter.com/somebody/status/1") is None
    assert parse_map_url("https://en.wikipedia.org/wiki/Eiffel_Tower") is None
    # non-web protocols
    assert parse_map_url("chrome://settings") is None
    assert parse_map_url("about:blank") is None
    assert parse_map_url("file:///home/user/map.html") is None
    # garbage never raises
    for junk in ("", "not a url", "https://", "https://www.google.com/maps/@nope",
                 "https://www.google.com/maps/place/%E0%A4%A/@48.85,2.29,17z"):
        parse_map_url(junk)
    # out-of-world coordinates are rejected, not filed
    assert parse_map_url("https://www.openstreetmap.org/#map=17/98.0/2.29")["lat"] is None
    # malformed bing cp degrades to "known site, nothing parsed"
    assert parse_map_url("https://www.bing.com/maps?cp=garbage&lvl=9")["lat"] is None
