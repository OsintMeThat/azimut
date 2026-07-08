"""Tile math and crop stitching (offline: injected fake tile fetcher)."""

import math

from PIL import Image

from ozimut.engine import geo, tiles


def test_project_roundtrip():
    lat, lon = 50.4501, 30.5234
    for zoom in (3, 10, 17):
        x, y = tiles.project(lat, lon, zoom)
        lat2, lon2 = tiles.unproject(x, y, zoom)
        assert math.isclose(lat, lat2, abs_tol=1e-6)
        assert math.isclose(lon, lon2, abs_tol=1e-6)


def test_project_known_values():
    # (0,0) is the center of the tile grid
    x, y = tiles.project(0, 0, 1)
    assert (x, y) == (1.0, 1.0)


def test_fetch_crop_stitches_and_records_provenance():
    provider = tiles.BUILTIN_PROVIDERS[0]
    fetched_urls = []

    def fake_fetch(client, url):
        fetched_urls.append(url)
        return Image.new("RGB", (256, 256), (10, 120, 10))

    img, prov = tiles.fetch_crop(
        48.8584, 2.2945, 17, 640, 480, provider, crosshair=True, fetch_tile=fake_fetch
    )
    assert img.size == (640, 480)
    assert prov["provider"] == "esri-world-imagery"
    assert prov["attribution"]
    assert prov["tiles"] == len(fetched_urls)
    assert prov["tiles_missing"] == 0
    assert prov["meters_per_pixel"] > 0
    # crosshair drew white pixels at center
    assert img.getpixel((320 - 10, 240)) == (255, 255, 255)


def test_fetch_crop_missing_tiles_dont_fail():
    provider = tiles.BUILTIN_PROVIDERS[0]

    img, prov = tiles.fetch_crop(
        10.0, 10.0, 15, 512, 512, provider, crosshair=False,
        fetch_tile=lambda client, url: None,
    )
    assert prov["tiles_missing"] == prov["tiles"] > 0
    assert img.size == (512, 512)


def test_fetch_crop_bearing_rotates_and_fills_corners():
    provider = tiles.BUILTIN_PROVIDERS[0]
    tile_colour = (10, 120, 10)

    calls = {"north": 0, "rotated": 0}

    def count(key):
        def fetch(client, url):
            calls[key] += 1
            return Image.new("RGB", (256, 256), tile_colour)

        return fetch

    north, _ = tiles.fetch_crop(
        48.8584, 2.2945, 17, 640, 480, provider, crosshair=False,
        fetch_tile=count("north"),
    )
    img, prov = tiles.fetch_crop(
        48.8584, 2.2945, 17, 640, 480, provider, crosshair=False, bearing=45,
        fetch_tile=count("rotated"),
    )

    assert img.size == (640, 480)
    assert prov["bearing"] == 45.0
    # a rotated crop stitches a bigger north-up source → strictly more tiles
    assert calls["rotated"] > calls["north"]
    # corners stay covered by imagery, not the gray background fill
    for corner in ((1, 1), (638, 1), (1, 478), (638, 478)):
        assert img.getpixel(corner) == tile_colour


def test_fetch_crop_bearing_zero_matches_unrotated():
    provider = tiles.BUILTIN_PROVIDERS[0]
    fetched = []

    def fetch(client, url):
        fetched.append(url)
        return Image.new("RGB", (256, 256), (10, 120, 10))

    img, prov = tiles.fetch_crop(
        48.8584, 2.2945, 17, 640, 480, provider, crosshair=False, bearing=0,
        fetch_tile=fetch,
    )
    assert img.size == (640, 480)
    assert prov["bearing"] == 0.0
    assert prov["tiles"] == len(fetched)


def test_fetch_crop_tile_cap():
    provider = tiles.BUILTIN_PROVIDERS[0]
    try:
        tiles.fetch_crop(0, 0, 19, 2048, 2048, provider, fetch_tile=lambda c, u: None)
    except tiles.TileFetchError as exc:
        assert "tiles" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected TileFetchError for oversized crop")


def test_parse_coords():
    assert geo.parse_coords("50.4501, 30.5234") == (50.4501, 30.5234)
    assert geo.parse_coords("50.4501 30.5234") == (50.4501, 30.5234)
    assert geo.parse_coords("-33.8688, 151.2093") == (-33.8688, 151.2093)
    lat, lon = geo.parse_coords("""48°51'29.6"N 2°17'40.2"E""")
    assert abs(lat - 48.85822) < 1e-4
    assert abs(lon - 2.29450) < 1e-4
    assert geo.parse_coords("hello world") is None
    assert geo.parse_coords("91, 0") is None


def test_plus_code_known_value():
    # Google's OLC reference example: 47.365590, 8.524997 → 8FVC9G8F+6X
    assert geo.plus_code(47.365590, 8.524997) == "8FVC9G8F+6X"


def test_dms_format():
    assert geo.to_dms(48.8584, 2.2945).endswith('E')
    assert "N" in geo.to_dms(48.8584, 2.2945)
