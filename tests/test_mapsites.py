"""Map-site URL parsers (engine/mapsites.py).

Server-side on purpose: URL formats race sites that change without notice and
the extension can't be updated remotely — so every rule is here, where an app
update fixes it. The contract: a recognized map site always returns its site
id (coordinates/title/imagery date when the URL carries them, None when it
doesn't), anything else returns None, and nothing ever raises.
"""

import json
import math
from pathlib import Path

import pytest

from azimut.engine.mapsites import _mercator_y, parse_map_url

_RECORDED = json.loads(
    (Path(__file__).parent / "fixtures" / "map-sites.json").read_text(encoding="utf-8")
)
RECORDINGS = _RECORDED["recordings"]
ROUNDING = _RECORDED["rounding"]

LAT, LON, Z = 45.197652, 11.777344, 6

#: How closely the parse has to predict how far Earth's picture moved. Earth's
#: own drawing agrees with its formula to about a thousandth at a 35° field of
#: view, and a few thousandths at 60°, which nobody opens by hand.
EARTH_SCALE_TOLERANCE = 0.004

#: What Earth writes after ``/data=``: its 2D map, as an analyst's own URL had
#: it, and a view after pressing Earth's "3D" button.
EARTH_2D = "CgRCAggCMikKJwolCiExa01obVdjV2t6UmJfTFhSbDFjQ3JPZEJla1p4TWJGVksgAToDCgEwQgIIAEoICI7Vld4EEAE"
EARTH_3D = "CgRCAggBKAJCAggASg0I____________ARAA"


# Mirrors frontend/src/lib/maplinks.js exactly: whatever Azimut can send the
# user out to, the backend must be able to read back.
OPEN_IN_LINKS = [
    (f"https://www.google.com/maps/@{LAT},{LON},{Z}z", "google-maps", Z),
    (f"https://www.google.com/maps/@{LAT},{LON},{Z}z/data=!3m1!1e3", "google-maps", Z),
    # a link has no ground in it, so Earth's scale waits for the map to move
    (f"https://earth.google.com/web/@{LAT},{LON},0a,2733274d,35y,0h,0t,0r", "google-earth", None),
    (f"https://maps.apple.com/?ll={LAT},{LON}&z={Z}&map=satellite", "apple-maps", Z),
    (f"https://www.bing.com/maps?cp={LAT}~{LON}&lvl={Z}&style=h", "bing-maps", Z),
    (f"https://yandex.com/maps/?ll={LON},{LAT}&z={Z}&l=sat", "yandex-maps", Z),
    (f"https://browser.dataspace.copernicus.eu/?zoom={Z}&lat={LAT}&lng={LON}",
     "copernicus-browser", Z),
    (f"https://zoom.earth/maps/satellite/#view={LAT},{LON},{Z}z", "zoom-earth", Z),
    (f"https://satellites.pro/#{LAT},{LON},{Z}", "satellites-pro", Z),
]


@pytest.mark.parametrize("url,site,zoom", OPEN_IN_LINKS)
def test_every_open_in_link_round_trips(url, site, zoom):
    p = parse_map_url(url)
    assert p["site"] == site
    assert p["lat"] == LAT and p["lon"] == LON
    assert p["zoom"] == zoom


def test_satellites_pro_redirects_to_a_country_path():
    # the bare link is what the app sends; the site answers it with a country
    # path of its own and keeps the fragment, which is where the view lives
    for url in (
        f"https://satellites.pro/#{LAT},{LON},{Z}",
        f"https://satellites.pro/plan/France_map#{LAT},{LON},{Z}",
        f"https://satellites.pro/France_map#{LAT},{LON},{Z}",
    ):
        p = parse_map_url(url)
        assert (p["site"], p["lat"], p["lon"], p["zoom"]) == ("satellites-pro", LAT, LON, Z)


def test_explicit_satellite_urls_are_classified():
    urls = [
        f"https://www.google.com/maps/@{LAT},{LON},2000m/data=!3m1!1e3",
        f"https://earth.google.com/web/@{LAT},{LON},0a,1000d,35y,0h,0t,0r",
        f"https://maps.apple.com/?ll={LAT},{LON}&z={Z}&t=k",
        f"https://maps.apple.com/?ll={LAT},{LON}&z={Z}&map=satellite",
        f"https://maps.apple.com/?ll={LAT},{LON}&z={Z}&map=hybrid",
        f"https://www.bing.com/maps?cp={LAT}~{LON}&lvl={Z}&style=h",
        f"https://yandex.com/maps/?ll={LON},{LAT}&z={Z}&l=sat",
        f"https://zoom.earth/#view={LAT},{LON},{Z}z",
        f"https://satellites.pro/#{LAT},{LON},{Z}",
        f"https://browser.dataspace.copernicus.eu/?zoom={Z}&lat={LAT}&lng={LON}",
    ]

    assert all(parse_map_url(url)["imagery_mode"] == "satellite" for url in urls)


def test_generic_map_urls_are_not_guessed_as_satellite():
    urls = [
        f"https://www.google.com/maps/@{LAT},{LON},{Z}z",
        f"https://www.bing.com/maps?cp={LAT}~{LON}&lvl={Z}&style=r",
        f"https://yandex.com/maps/?ll={LON},{LAT}&z={Z}&l=map",
        f"https://maps.apple.com/?ll={LAT},{LON}&z={Z}&t=m",
        f"https://maps.apple.com/?ll={LAT},{LON}&z={Z}&map=explore",
        f"https://www.openstreetmap.org/#map={Z}/{LAT}/{LON}",
    ]

    assert all(parse_map_url(url)["imagery_mode"] is None for url in urls)


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


# -- what kind of camera the URL describes --------------------------------------
#
# The rule the overlay hangs on: geometry the app *computes* (a search grid, a
# sun arc, a measured line) is Web Mercator arithmetic, so it is only honest on
# a straight-down 2D view. A media pin the analyst places by hand is computed
# from nothing and stays allowed everywhere — which is why this field says what
# the camera *is*, and never what may be drawn.


@pytest.mark.parametrize(
    "url,kind",
    [
        # Street View: the 3a camera block, whatever else rides on it
        (f"https://www.google.com/maps/@{LAT},{LON},3a,75y,90h,90t", "streetview"),
        (
            f"https://www.google.com/maps/place/Tour+Eiffel/@{LAT},{LON},3a,15y,180h,80t/data=x",
            "streetview",
        ),
        # a pitched 3D camera on Google Maps
        (f"https://www.google.com/maps/@{LAT},{LON},1000m,45t", "tilted"),
        # …and 0t is not pitched at all
        (f"https://www.google.com/maps/@{LAT},{LON},{Z}z,0t", "map"),
        (f"https://www.google.com/maps/@{LAT},{LON},{Z}z", "map"),
        # Earth's 2D map is a map, and pitched (its 3D button) it is not
        (f"https://earth.google.com/web/@{LAT},{LON},0a,1000d,35y,0h,0t,0r", "map"),
        (f"https://earth.google.com/web/@{LAT},{LON},0a,600d,35y,20h,60t,0r", "tilted"),
        # flat-map renderers with no other mode to be in
        (f"https://www.openstreetmap.org/#map={Z}/{LAT}/{LON}", "map"),
        (f"https://zoom.earth/#view={LAT},{LON},{Z}z", "map"),
        (f"https://www.bing.com/maps?cp={LAT}~{LON}&lvl={Z}", "map"),
        (f"https://maps.apple.com/?ll={LAT},{LON}&z={Z}", "map"),
    ],
)
def test_view_kind_reads_the_camera_out_of_the_url(url, kind):
    assert parse_map_url(url)["view_kind"] == kind


def test_satellite_is_still_a_straight_down_map():
    """Google drops the zoom in satellite view and quotes a viewport height in
    metres instead. The camera did not move — only the way the URL describes it
    — so the view is a map, and the overlay's tools are not thrown off a whole
    imagery mode by a change of notation.

    The camera and the flattening are both fine, so ``geometry`` says yes. What
    is missing without a window height is the *scale*: no zoom, no
    ``scale_source``, and the drawing waits for one (`maptools.js`'s verdict).
    """
    parsed = parse_map_url(f"https://www.google.com/maps/@{LAT},{LON},1053m/data=!3m1!1e3")
    assert parsed["view_kind"] == "map"
    assert (parsed["lat"], parsed["lon"]) == (LAT, LON)
    assert parsed["zoom"] is None
    assert parsed["scale_source"] is None
    assert parsed["geometry"] is True


def test_earths_2d_map_is_web_mercator_with_its_scale_in_the_url():
    """Earth, and Maps in Earth mode, with the camera level.

    Earth's 2D map was registered screenshot against screenshot
    (``tests/fixtures/earth-scale.json``): Web Mercator, drawn about the middle
    of the window, ``2·d·tan(y/2)`` metres from top to bottom. So it is a map
    like any other, with a projection and a scale read out of its URL.

    Maps in Earth mode keeps its flattening and states no scale: Maps rewrites a
    level ``a`` camera into ``,3231m`` as soon as it lands, so the view waits
    for that instead.
    """
    earth = parse_map_url(
        f"https://earth.google.com/web/@{LAT},{LON},146.5a,666.25d,35y,0h,0t,0r", height_px=1000
    )
    assert earth["view_kind"] == "map"
    assert earth["projection"] == "webmercator"
    assert earth["geometry"] is True
    assert earth["scale_source"] == "distance"
    assert earth["far"] is False

    maps = parse_map_url(f"https://www.google.com/maps/@{LAT},{LON},336a,35y,0t/data=!3m1!1e3")
    assert maps["view_kind"] == "map"
    assert maps["geometry"] is True
    assert maps["scale_source"] is None
    assert (maps["lat"], maps["lon"]) == (LAT, LON)


def test_only_earths_3d_camera_turns_into_a_globe_far_out():
    """Earth's 2D map stays a flat Mercator however far out it goes (all of
    Europe on screen, and 400 km out measured). Its 3D mode is a perspective
    camera on a sphere, and past ``LEVEL_CEILING_M`` that is a globe. The address
    bar says which one it is in its ``data=`` blob."""
    far = f"https://earth.google.com/web/@{LAT},{LON},-0a,202330.09623202d,35y,0h,0t,0r"
    flat = parse_map_url(f"{far}/data={EARTH_2D}?authuser=0", height_px=934)
    assert (flat["view_kind"], flat["geometry"], flat["far"]) == ("map", True, False)
    assert flat["scale_source"] == "distance"
    globe = parse_map_url(f"{far}/data={EARTH_3D}", height_px=934)
    assert (globe["view_kind"], globe["geometry"], globe["far"]) == ("globe", False, True)
    # in close, the 3D camera is still a map
    near = f"https://earth.google.com/web/@{LAT},{LON},146.5a,666.25d,35y,0h,0t,0r/data={EARTH_3D}"
    assert parse_map_url(near)["view_kind"] == "map"
    # a bare link opens the 2D map, and a blob nobody can read is taken as 3D,
    # whose rules are the stricter ones
    assert parse_map_url(far)["view_kind"] == "map"
    assert parse_map_url(f"{far}/data=AAAA")["view_kind"] == "globe"


def test_earth_states_no_scale_for_a_camera_it_has_not_placed():
    """``d`` is a distance to the ground only once Earth has put the camera
    there, which it does by writing the ground's height into ``a``."""

    def scale(camera: str) -> str | None:
        url = f"https://earth.google.com/web/@{LAT},{LON},{camera}"
        return parse_map_url(url, height_px=1000)["scale_source"]

    # Earth's own writing, over land and over the sea
    assert scale("198.8634048a,2196.68868628d,35y,0h,0t,0r") == "distance"
    assert scale("-0a,202330.09623202d,35y,0h,0t,0r") == "distance"
    # a link, written as 0a with a whole d: over 200 m of ground it is drawn 7%
    # nearer than it says, so it waits for the map to move
    assert scale("0a,3000d,35y,0h,0t,0r") is None
    # closer than Earth's map lets a camera come: loading a link, Earth once
    # wrote this for a camera 1528 m up, where a was not the ground at all
    assert scale("1518.44008742a,10.0137594d,35y,0h,0t,0r") is None
    # a height no ground has, and a field of view that is missing or not one
    assert scale("-7546.56236661a,8346.46045906d,35y,0h,0t,0r") is None
    assert scale("198.86a,2196.69d,0y,0h,0t,0r") is None
    assert scale("198.86a,2196.69d,0h,0t,0r") is None


def _earth_cases() -> list[dict]:
    path = Path(__file__).parent / "fixtures" / "earth-scale.json"
    return json.loads(path.read_text(encoding="utf-8"))["cases"]


def test_earths_scale_is_what_its_screenshots_measured():
    """Every case in ``tests/fixtures/earth-scale.json``, predicted from its URL.

    Each one is a camera Earth placed, opened again a known step east and north,
    and the screenshots registered to a hundredth of a pixel. The parse of the
    base URL, through Web Mercator, has to say how far the picture moved — at
    three window shapes, two fields of view, three latitudes, over mountains and
    400 km out.
    """
    cases = _earth_cases()
    assert len(cases) >= 6
    for case in cases:
        parsed = parse_map_url(case["base"], height_px=case["window"]["h"])
        assert parsed["scale_source"] == "distance", case["id"]
        world = 256 * 2 ** parsed["zoom"]
        east = -case["east"]["d_lon"] / 360 * world
        step = case["north"]["d_lat"]
        north = (_mercator_y(parsed["lat"]) - _mercator_y(parsed["lat"] + step)) / 256 * world
        tolerance = EARTH_SCALE_TOLERANCE
        assert case["east"]["moved_px"] == pytest.approx(east, rel=tolerance), case["id"]
        assert case["north"]["moved_px"] == pytest.approx(north, rel=tolerance), case["id"]
        assert abs(case["east"]["across_px"]) < 0.5, case["id"]
        assert abs(case["north"]["across_px"]) < 0.5, case["id"]


def test_earth_draws_its_camera_at_the_middle_of_the_window():
    """No table entry for Earth, and this is why: halving the distance draws the
    ground twice as big about the camera's own pixel, and in every window that
    pixel was the middle."""
    for case in _earth_cases():
        offset = case["camera_offset_px"]
        assert abs(offset["x"]) < 1.5 and abs(offset["y"]) < 1.5, case["id"]


def test_a_level_3d_camera_far_enough_out_is_a_globe():
    """Level is not enough on its own for a 3D camera: past ``LEVEL_CEILING_M``
    the ground under it is visibly round, and a flat scale would be wrong by
    more than the tools are worth."""
    high = f"https://earth.google.com/web/@{LAT},{LON},146a,900000d,35y,0h,0t,0r/data={EARTH_3D}"
    assert parse_map_url(high)["view_kind"] == "globe"
    # …and a 3D camera whose height the URL never states is not assumed to be low
    bare = f"https://earth.google.com/web/@{LAT},{LON}/data={EARTH_3D}"
    assert parse_map_url(bare)["view_kind"] == "globe"


def test_a_pitched_camera_is_not_a_map_however_it_is_written():
    """The metres are a red herring on their own: the same block carries the
    tilt, and a tilt is what decides."""
    assert parse_map_url(f"https://www.google.com/maps/@{LAT},{LON},1000m,45t")["view_kind"] == "tilted"
    assert (
        parse_map_url(f"https://www.google.com/maps/@{LAT},{LON},336a,35y,45.5t/data=!3m1!1e3")[
            "view_kind"
        ]
        == "tilted"
    )
    # roll counts as well: a level camera turned on its axis is still level, but
    # one that is not is not a map
    assert (
        parse_map_url(f"https://earth.google.com/web/@{LAT},{LON},1a,600d,35y,0h,0t,30r")[
            "view_kind"
        ]
        == "tilted"
    )


def test_only_a_documented_tile_zoom_is_named_as_one():
    """Which sites' ``zoom`` can be turned into a scale without asking the map.

    OpenStreetMap's slippy-map spec and Bing's tile system state the same thing
    — 256-pixel tiles, one tile of the world at zoom 0 — Google's matches both,
    and Copernicus Browser draws on Leaflet, which is that spec with a library
    round it. Apple's documentation says only that ``z`` "defines the area
    around the center point", but a browser dragged and zoomed at two window
    sizes drew tile level 15 both times, so it is recorded on the measurement.
    Earth quotes a camera distance and no level at all.
    """
    for url, site in (
        (f"https://www.google.com/maps/@{LAT},{LON},{Z}z", "google-maps"),
        (f"https://www.bing.com/maps?cp={LAT}~{LON}&lvl={Z}", "bing-maps"),
        (f"https://www.openstreetmap.org/#map={Z}/{LAT}/{LON}", "openstreetmap"),
        (f"https://maps.apple.com/?ll={LAT},{LON}&z={Z}", "apple-maps"),
        (f"https://browser.dataspace.copernicus.eu/?zoom={Z}&lat={LAT}&lng={LON}",
         "copernicus-browser"),
    ):
        parsed = parse_map_url(url)
        assert parsed["site"] == site
        assert parsed["scale_source"] == "zoom", site
        assert parsed["zoom"] == Z, site

    earth = parse_map_url(f"https://earth.google.com/web/@{LAT},{LON},1a,600d,35y,0h,0t,0r")
    assert earth["site"] == "google-earth"
    assert earth["scale_source"] is None
    assert earth["zoom"] is None


def test_apples_stale_zoom_is_dropped_once_it_states_a_span():
    """Apple carries the ``z`` its opening link had and never rewrites it.

    Measured: opened at 15, zoomed twice, the address bar still said 15 while
    the span had quartered. A view that states a span therefore states no zoom
    at all here, and the span is what a caller reads.
    """
    opened = parse_map_url(f"https://maps.apple.com/?ll={LAT},{LON}&z=15&map=satellite")
    assert opened["zoom"] == 15 and opened["scale_source"] == "zoom"
    assert opened["span_lat"] is None

    moved = parse_map_url(
        "https://maps.apple.com/frame?z=15&map=satellite"
        "&center=47.388462%2C2.352785&span=0.029055%2C0.056434"
    )
    assert (moved["lat"], moved["lon"]) == (47.388462, 2.352785)
    assert (moved["span_lat"], moved["span_lon"]) == (0.029055, 0.056434)
    assert moved["zoom"] is None and moved["scale_source"] is None


def test_a_stated_size_becomes_a_zoom_once_the_window_height_is_known():
    """The two views that state a size rather than a level.

    Both numbers are the map's own, and both were checked against a browser:
    a 1000 px window opened at 15z came back as ``,3231m`` from Google and as
    ``span=0.029055,…`` from Apple. Fed those back with the height they were
    drawn at, this returns the level they were drawn at.
    """
    satellite = parse_map_url(
        "https://www.google.com/maps/@47.388462,2.352785,3231m/data=!3m1!1e3", height_px=1000
    )
    assert satellite["scale_source"] == "height_m"
    assert satellite["zoom"] == pytest.approx(15, abs=0.01)

    # Earth's view covers the same ground in a shorter window, so it is further out
    earth = (
        "https://earth.google.com/web/@47.38914743,2.35481038,"
        "198.8634048a,2196.68868628d,35y,0h,0t,0r"
    )
    tall = parse_map_url(earth, height_px=1000)
    assert tall["scale_source"] == "distance"
    assert tall["zoom"] == pytest.approx(16.2234, abs=0.001)  # registered: 16.22341
    shorter = parse_map_url(earth, height_px=760)["zoom"]
    assert shorter == pytest.approx(tall["zoom"] + math.log2(0.76))

    apple = parse_map_url(
        "https://maps.apple.com/frame?map=satellite"
        "&center=47.388462%2C2.352785&span=0.029055%2C0.056434",
        height_px=1000,
    )
    assert apple["scale_source"] == "span"
    assert apple["zoom"] == pytest.approx(15, abs=0.01)

    # the same view in a shorter window is the same map drawn smaller: Apple
    # states the span it actually covers, so the level comes back unchanged
    shorter = parse_map_url(
        "https://maps.apple.com/frame?map=satellite"
        "&center=47.388462%2C2.352785&span=0.022082%2C0.039268",
        height_px=760,
    )
    assert shorter["zoom"] == pytest.approx(15, abs=0.01)


def test_without_a_window_height_a_stated_size_is_left_alone():
    """No height, no zoom — never a guessed one."""
    satellite = parse_map_url("https://www.google.com/maps/@47.388462,2.352785,3231m/data=!3m1!1e3")
    assert satellite["zoom"] is None and satellite["scale_source"] is None
    earth = parse_map_url("https://earth.google.com/web/@47.38,2.35,198.86a,2196.69d,35y,0h,0t,0r")
    assert earth["zoom"] is None and earth["scale_source"] is None


def test_every_recognized_site_answers_the_scale_question():
    for url, _site, _zoom in OPEN_IN_LINKS:
        assert parse_map_url(url)["scale_source"] in {"zoom", "height_m", "span", "distance", None}


def test_view_kind_is_unclassified_rather_than_guessed():
    """A Google Maps URL with no camera block says nothing about its camera, and
    saying nothing is the answer — the same rule imagery_mode follows."""
    parsed = parse_map_url("https://www.google.com/maps/place/Tour+Eiffel")
    assert parsed["site"] == "google-maps"
    assert parsed["view_kind"] is None


def test_a_street_view_url_carries_its_point_but_no_zoom():
    """Which is the second, independent reason the overlay declines geometry
    there: the projection needs a zoom, and a pano camera has none."""
    parsed = parse_map_url(f"https://www.google.com/maps/@{LAT},{LON},3a,75y,90h,90t")
    assert (parsed["lat"], parsed["lon"]) == (LAT, LON)
    assert parsed["zoom"] is None
    # the point is still real, read from the address bar — a pin can be filed on it
    assert parsed["view_kind"] == "streetview"


def test_every_recognized_site_answers_the_question():
    """Every parse carries the key, so a caller never has to tell "no camera in
    this URL" from "this build predates the field"."""
    for url, _site, _zoom in OPEN_IN_LINKS:
        assert "view_kind" in parse_map_url(url)


# -- what may be drawn over the view --------------------------------------------
#
# Three independent ways the projection can be wrong, and the overlay has to
# decline on any one of them: a camera Mercator says nothing about, a
# flattening we cannot invert, and a zoom where the site draws a globe while
# its URL goes on quoting a zoom.


def test_geometry_needs_a_flat_camera_a_known_projection_and_a_flat_zoom():
    ok = parse_map_url(f"https://www.google.com/maps/@{LAT},{LON},17z")
    assert ok["geometry"] is True
    assert ok["projection"] == "webmercator"


def test_copernicus_2d_map_is_leaflet_and_drawable():
    """Its flat map is Leaflet's default CRS, which is EPSG:3857.

    Two ways round: the browser's own package.json depends on leaflet, and two
    zooms about two different pixels solved for the same camera centre through
    spherical Mercator to half a pixel (tests/fixtures/map-sites.json).
    """
    flat = parse_map_url(f"https://browser.dataspace.copernicus.eu/?zoom=15&lat={LAT}&lng={LON}")
    assert flat["projection"] == "webmercator"
    assert flat["view_kind"] == "map"
    assert flat["geometry"] is True


@pytest.mark.parametrize(
    "url,why",
    [
        # a pano camera
        (f"https://www.google.com/maps/@{LAT},{LON},3a,75y,90h,90t", "streetview"),
        # a pitched one
        (f"https://www.google.com/maps/@{LAT},{LON},1000m,45t", "tilted"),
        # Earth's 3D camera far enough out to be a globe
        (f"https://earth.google.com/web/@{LAT},{LON},0a,900000d,35y,0h,0t,0r/data={EARTH_3D}", "globe"),
        # Copernicus Browser in its 3D terrain viewer, which it says in the URL
        (f"https://browser.dataspace.copernicus.eu/?zoom=17&lat={LAT}&lng={LON}"
         '&terrainViewerSettings=%7B%22settings%22%3A%7B%22x%22%3A1%7D%7D', "terrain viewer"),
    ],
)
def test_geometry_declines_wherever_the_projection_would_be_a_guess(url, why):
    assert parse_map_url(url)["geometry"] is False, why


def test_yandex_is_elliptical_and_says_so():
    """EPSG:3395, not 3857. Drawing it as spherical Mercator is wrong by
    kilometres at Moscow's latitude — and wrong with total confidence."""
    parsed = parse_map_url(f"https://yandex.com/maps/?ll={LON},{LAT}&z={Z}&l=sat")
    assert parsed["projection"] == "ellipsoidal"
    assert parsed["geometry"] is True  # known, therefore drawable


def test_the_globe_floor_is_a_warning_rather_than_a_floor():
    """A *flat map drawn far out* is warned about, not refused.

    A site becoming a globe on the way out does not change its URL shape, so the
    zoom is the only warning there is — and out there the drawing still appears:
    the middle of the screen is right and the edges drift, which is the trade for
    seeing a whole region's worth of work at once. ``far`` is what says so, and
    the panel dims what it draws.

    The other globe is refused outright — see the test below, and the two are
    not the same thing.
    """
    low = parse_map_url(f"https://www.google.com/maps/@{LAT},{LON},7z")
    high = parse_map_url(f"https://www.google.com/maps/@{LAT},{LON},8z")
    assert (low["geometry"], high["geometry"]) == (True, True)
    assert (low["far"], high["far"]) == (True, False)
    assert low["globe_below"] == 8

    # Earth's own 3D globe is the same verdict reached from a camera height
    earth = parse_map_url(
        f"https://earth.google.com/web/@{LAT},{LON},0a,900000d,35y,0h,0t,0r/data={EARTH_3D}"
    )
    assert earth["view_kind"] == "globe" and earth["far"] is True

    # OpenStreetMap has no globe to fall into, so it has no floor
    flat = parse_map_url(f"https://www.openstreetmap.org/#map=3/{LAT}/{LON}")
    assert flat["globe_below"] is None
    assert (flat["geometry"], flat["far"]) == (True, False)


def test_a_globe_camera_is_refused_where_a_flat_map_drawn_far_out_is_not():
    """The other globe: a perspective camera on a sphere, which is not a map.

    Google's Earth mode is the case that separates the two, because it is the
    one view that is a globe camera *and* has a named flattening. Mercator is
    not approximately right out there, it is wrong — so ``geometry`` declines
    even though the projection is known, and the extension says to zoom in
    rather than dimming a drawing nobody can judge (`maptools.js`, ``REFUSALS``).
    """
    globe = parse_map_url(f"https://www.google.com/maps/@{LAT},{LON},900000a,35y,0h,0t,0r")
    assert globe["view_kind"] == "globe"
    assert globe["projection"] == "webmercator"  # known, and still not enough
    assert globe["geometry"] is False
    # `far` stays true out there, because it has a second job: it is what stops
    # the extension measuring a site's layout off a view that far out
    assert globe["far"] is True

    # …and the same camera in close is a map, which is the whole point of
    # measuring the height rather than refusing the site
    near = parse_map_url(f"https://www.google.com/maps/@{LAT},{LON},1000a,35y,0h,0t,0r")
    assert (near["view_kind"], near["geometry"], near["far"]) == ("map", True, False)


def test_a_pin_is_never_gated_by_any_of_this():
    """Whatever the camera is, the URL still names a point — which is the one a
    pin files on. The verdict only says the *pixel* clicked cannot be trusted."""
    for url in (
        f"https://www.google.com/maps/@{LAT},{LON},3a,75y,90h,90t",
        f"https://earth.google.com/web/@{LAT},{LON},0a,600d,35y,20h,60t,0r",
    ):
        parsed = parse_map_url(url)
        assert parsed["geometry"] is False
        assert (parsed["lat"], parsed["lon"]) == (LAT, LON)


# --- against the real thing ----------------------------------------------------
#
# `tests/fixtures/map-sites.json` is nine map sites driven in a browser: opened
# at a known level, dragged a known number of pixels, zoomed about a known
# pixel, and read back out of the address bar after every step. Fifty-odd URLs
# that sites wrote about themselves, rather than a table written to suit this
# parser.
#
# The frontend suite replays the same file through the extension's arithmetic
# (`extensionMapFrame.test.js`) and checks that it puts each view back where the
# browser had it. What is checked here is the other half: that the parse still
# hands it those views.


@pytest.mark.parametrize(
    "recording", RECORDINGS, ids=[r["label"] for r in RECORDINGS]
)
def test_recorded_browser_sessions_still_parse_the_same_way(recording):
    # The map's height, not the window's. A site with a header above its map
    # draws it in fewer pixels than the window has, and the two views that state
    # a size rather than a level — Apple's span, Google satellite's metres — are
    # only a scale next to the number of pixels they were drawn in. The
    # extension hands over the same number (`mapoverlay.js`, `mapHeight`).
    height = recording["map_height"]
    for step in recording["steps"]:
        parsed = parse_map_url(step["url"], height_px=height)
        assert parsed is not None, step["url"]
        assert parsed["site"] == step["site"]
        assert parsed["scale_source"] == step["scale_source"]
        for key, want in step["view"].items():
            got = parsed[key] if key != "bearing" else (parsed["bearing"] or 0)
            if isinstance(want, float) and isinstance(got, float):
                assert got == pytest.approx(want, abs=1e-9), (key, step["url"])
            else:
                assert got == want, (key, step["url"])


def test_every_site_this_parser_knows_has_been_driven_in_a_browser():
    """A site nobody has driven a browser through is a site we are guessing at.

    Keyed on this module's own table rather than on the links the app hands out,
    because the extension draws on every site here — OpenStreetMap included,
    which the app never links to because it is already a tile provider inside it.
    `frontend/calibration/protocol.mjs` drives exactly this list.
    """
    from azimut.engine.mapsites import SITES

    recorded = {r["site"] for r in RECORDINGS}
    known = {site_id for site_id, *_rest in SITES}
    assert known == recorded
    assert {site for _url, site, _zoom in OPEN_IN_LINKS} <= known


def test_the_recordings_cover_more_than_one_window():
    """A fixed side panel keeps its pixel offset when the window changes and a
    proportional one does not, which is the whole reason for a second size.

    Stated as a floor rather than as a list: `npm run calibrate:maps` records a
    matrix of windows, browsers and browser zooms, and a re-run that covers more
    of it must not have to come and edit this. What it may not do is cover less.
    """
    sizes = {(r["window"]["w"], r["window"]["h"]) for r in RECORDINGS}
    assert len(sizes) >= 2, sizes
    assert min(w for w, _h in sizes) <= 1200, "a window no narrower than 1200 px is one window"
    # every site is recorded at the widest window, whatever else was recorded
    widest = max(sizes)
    at_widest = {r["site"] for r in RECORDINGS if (r["window"]["w"], r["window"]["h"]) == widest}
    assert at_widest == {r["site"] for r in RECORDINGS}


def test_the_map_is_the_window_minus_whatever_the_site_puts_above_it():
    """How tall the map was drawn, and where that number comes from.

    A map centred in what its chrome leaves is centred by exactly half of what
    the chrome took, so the camera offset the recording solved for *is* the
    measurement of the header. `extension/mapoverlay.js` reads it the same way
    and hands the result to this parser; the fixture is where the two meet.
    """
    for recording in RECORDINGS:
        window = recording["window"]["h"]
        chrome = 2 * abs(recording["centre"]["y"] - window / 2)
        # under a couple of pixels is the solve's own noise, not a header
        want = round(window - chrome) if chrome >= 4 else window
        assert recording["map_height"] == want, recording["label"]
        assert 0 < recording["map_height"] <= window


def test_bings_rounded_zoom_is_reported_as_written():
    """The one site that rounds the zoom it writes.

    Bing's wheel moves a third of a level and its URL carries one decimal, so
    a view at 15.334 is written 15.3 — recorded in the fixture, six notches of
    it. Nothing here tries to undo that: this side reports what the address bar
    says, and the extension works the difference out from the pixel the zoom
    held still, which is the only place the answer exists.
    """
    written = [parse_map_url(step["url"])["zoom"] for step in ROUNDING["steps"]]
    assert written == [15, 15.3, 15.7, 16, 16.3, 16.7, 17]
    assert all(round(zoom, 1) == zoom for zoom in written), "one decimal, as Bing writes it"

    for step in ROUNDING["steps"]:
        parsed = parse_map_url(step["url"])
        assert parsed["site"] == ROUNDING["site"]
        assert parsed["scale_source"] == "zoom"
        assert (parsed["lat"], parsed["lon"]) == (step["view"]["lat"], step["view"]["lon"])


# --- a camera that never quite comes back to zero -------------------------------


def test_a_camera_a_hair_off_level_is_still_a_map():
    """The bug that turned the tools off on Google Earth.

    These viewers write the camera they are holding, at full precision, and a
    turn of the compass leaves a fraction of a degree of pitch behind it. Read as
    "tilted", that is a tool which stops working the moment the view is turned —
    and the analyst is told to level a view that looks level to them.
    """
    for angle in ("0.0001", "0.4", "1.9"):
        url = f"https://earth.google.com/web/@{LAT},{LON},146a,666d,35y,12h,{angle}t,0r"
        assert parse_map_url(url)["view_kind"] == "map", angle
    # the same forgiveness on the other viewer with a free camera
    assert (
        parse_map_url(f"https://www.google.com/maps/@{LAT},{LON},336a,35y,0.5t/data=!3m1!1e3")[
            "view_kind"
        ]
        == "map"
    )


def test_a_camera_anyone_pitched_is_still_refused():
    for angle in ("2.1", "15", "45.5"):
        url = f"https://earth.google.com/web/@{LAT},{LON},146a,666d,35y,12h,{angle}t,0r"
        assert parse_map_url(url)["view_kind"] == "tilted", angle


def test_the_pitch_is_reported_so_a_refusal_can_name_it():
    """"Tilted" is a verdict; "tilted 40°" is the thing to go and undo — and on a
    viewer that leaves half a degree behind, the number is how an analyst tells a
    camera they pitched from one they did not."""
    tilted = parse_map_url(f"https://earth.google.com/web/@{LAT},{LON},146a,666d,35y,0h,40t,0r")
    assert tilted["tilt"] == 40
    # roll answers on the same field: whichever tips the ground plane most
    rolled = parse_map_url(f"https://earth.google.com/web/@{LAT},{LON},146a,666d,35y,0h,3t,30r")
    assert rolled["tilt"] == 30
    level = parse_map_url(f"https://earth.google.com/web/@{LAT},{LON},146a,666d,35y,0h,0t,0r")
    assert level["tilt"] == 0
    # a site whose URL states no camera angle says nothing rather than zero
    assert parse_map_url(f"https://www.openstreetmap.org/#map=17/{LAT}/{LON}")["tilt"] is None


#: Sites the extension starts unplaced on, and why each is left out of
#: ``_CAMERA_CENTRE`` rather than measured into it.
UNHINTED_ON_PURPOSE = {
    "apple-maps": "its sidebar folds away below a width the URL never states, so"
    " its offset is 67 px in a wide window and nothing in a narrow one",
}


def test_the_starting_offset_matches_what_the_browser_measured():
    """The offset the extension starts drawing from, against the recording.

    ``_CAMERA_CENTRE`` is the one place this parser states a number about pixels
    rather than about a URL, and it exists because the alternative — starting at
    the middle of the window — is a number too, and the wrong one on four of
    these sites. So it is held to the recording the same way everything else
    here is: every entry within a pixel and a half of where a browser drew the
    camera, in every window the site was recorded in.

    The other half is the drift gate. A site with no entry starts at the middle
    of the window, which is a claim that the middle is right — so a recording
    that says otherwise has to be either measured into the table or named in
    ``UNHINTED_ON_PURPOSE`` with the reason it cannot be.
    """
    from azimut.engine.mapsites import _CAMERA_CENTRE, _centre_hint

    for recording in RECORDINGS:
        offset = (
            recording["centre"]["x"] - recording["window"]["w"] / 2,
            recording["centre"]["y"] - recording["window"]["h"] / 2,
        )
        hint = _centre_hint(recording["site"])
        if hint:
            assert hint["x"] == pytest.approx(offset[0], abs=1.5), recording["label"]
            assert hint["y"] == pytest.approx(offset[1], abs=1.5), recording["label"]
            # and a sideways offset is never claimed below a window it has been
            # measured in, because that is where a side panel folds away
            if hint["x"]:
                assert hint["min_w"] <= recording["window"]["w"], recording["label"]
                assert hint["min_w"] >= min(
                    r["window"]["w"] for r in RECORDINGS if r["site"] == recording["site"]
                ), recording["label"]
        # under a couple of pixels is the solve's own noise, not a layout
        elif max(abs(o) for o in offset) >= 4:
            assert recording["site"] in UNHINTED_ON_PURPOSE, (
                f"{recording['label']} draws its camera {offset} from the middle of the"
                " window and nothing says so: add it to _CAMERA_CENTRE or say why not"
            )
    # and nothing in the table that no browser was ever driven through
    assert set(_CAMERA_CENTRE) <= {r["site"] for r in RECORDINGS}
    assert set(UNHINTED_ON_PURPOSE) <= {r["site"] for r in RECORDINGS}
    assert not set(UNHINTED_ON_PURPOSE) & set(_CAMERA_CENTRE)


def test_the_starting_offset_reaches_the_extension_with_the_view():
    """It travels the one channel the extension reads: the parse of its URL."""
    hinted = parse_map_url("https://www.bing.com/maps?cp=47.388462~2.352785&lvl=15")
    # a header, claimed at any width: its height does not change with one
    assert hinted["centre_hint"] == {"x": 0.0, "y": 40.5, "min_w": 0}
    # and a site that draws dead centre says nothing rather than saying zero
    assert parse_map_url("https://www.google.com/maps/@47.388462,2.352785,15z")["centre_hint"] is None
    # a side panel says how narrow a window it has been seen in, because that is
    # the thing that folds away (`_CAMERA_CENTRE`)
    panelled = parse_map_url("https://yandex.com/maps/?ll=2.352785%2C47.388462&z=15")
    assert panelled["centre_hint"] == {"x": 210.0, "y": 10.0, "min_w": 1200}
    narrowest = {
        r["window"]["w"] for r in RECORDINGS if r["site"] == "yandex-maps"
    }
    assert panelled["centre_hint"]["min_w"] == min(narrowest)
