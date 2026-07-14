"""Tile math and crop stitching (offline: injected fake tile fetcher)."""

import dataclasses
import math

import httpx
import pytest
from PIL import Image

from azimut import config
from azimut.engine import geo, tiles


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
        48.8584, 2.2945, 17, 640, 480, provider, fetch_tile=fake_fetch
    )
    assert img.size == (640, 480)
    assert prov["provider"] == "esri-world-imagery"
    assert prov["attribution"]
    assert prov["tiles"] == len(fetched_urls)
    assert prov["tiles_missing"] == 0
    assert prov["meters_per_pixel"] > 0
    # crosshair drew white pixels at center
    assert img.getpixel((320 - 10, 240)) == (255, 255, 255)


def test_fetch_crop_marker_offset_moves_crosshair_and_records_pin():
    provider = tiles.BUILTIN_PROVIDERS[0]

    def fake(client, url):
        return Image.new("RGB", (256, 256), (10, 120, 10))

    img, prov = tiles.fetch_crop(
        48.8584, 2.2945, 17, 640, 480, provider,
        marker_x=120, marker_y=-60, marker_lat=48.86, marker_lon=2.30,
        fetch_tile=fake,
    )
    # crosshair arm sits at the offset point, not the center
    assert img.getpixel((320 + 120 - 10, 240 - 60)) == (255, 255, 255)
    assert img.getpixel((320 - 10, 240)) == (10, 120, 10)  # center untouched
    # recorded coords are the pin; center is remembered separately
    assert (prov["lat"], prov["lon"]) == (48.86, 2.30)
    assert (prov["center_lat"], prov["center_lon"]) == (48.8584, 2.2945)
    assert prov["marker_style"] == "crosshair"


def test_fetch_crop_none_marker_leaves_center_clean():
    provider = tiles.BUILTIN_PROVIDERS[0]
    img, prov = tiles.fetch_crop(
        48.8584, 2.2945, 17, 256, 256, provider, marker_style="none",
        fetch_tile=lambda c, u: Image.new("RGB", (256, 256), (10, 120, 10)),
    )
    assert img.getpixel((128, 128)) == (10, 120, 10)
    assert prov["marker_style"] == "none"
    assert prov["crosshair"] is False


def test_fetch_crop_missing_tiles_dont_fail():
    provider = tiles.BUILTIN_PROVIDERS[0]

    img, prov = tiles.fetch_crop(
        10.0, 10.0, 15, 512, 512, provider, marker_style="none",
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
        48.8584, 2.2945, 17, 640, 480, provider, marker_style="none",
        fetch_tile=count("north"),
    )
    img, prov = tiles.fetch_crop(
        48.8584, 2.2945, 17, 640, 480, provider, marker_style="none", bearing=45,
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
        48.8584, 2.2945, 17, 640, 480, provider, marker_style="none", bearing=0,
        fetch_tile=fetch,
    )
    assert img.size == (640, 480)
    assert prov["bearing"] == 0.0
    assert prov["tiles"] == len(fetched)


def test_fetch_crop_tile_cap():
    provider = tiles.BUILTIN_PROVIDERS[0]
    try:
        tiles.fetch_crop(
            0, 0, 19, tiles.SIZE_MAX, tiles.SIZE_MAX, provider,
            fetch_tile=lambda c, u: None,
        )
    except tiles.TileFetchError as exc:
        assert "tiles" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected TileFetchError for oversized crop")


def test_all_providers_omits_keyed_providers_without_keys(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    ids = {p.id for p in tiles.all_providers()}
    assert "mapbox-satellite" not in ids
    assert "google-satellite" not in ids


def test_all_providers_adds_mapbox_when_keyed(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings({**config.DEFAULT_SETTINGS, "api_keys": {"mapbox": "pk.test123"}})
    mapbox = next(p for p in tiles.all_providers() if p.id == "mapbox-satellite")
    assert "pk.test123" in mapbox.url
    assert "{key}" not in mapbox.url
    assert mapbox.capturable is True
    assert mapbox.cacheable is True
    assert mapbox.attribution_burn is False
    assert mapbox.session is None
    assert mapbox.max_zoom == 22


def test_all_providers_adds_google_when_keyed(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings({**config.DEFAULT_SETTINGS, "api_keys": {"google": "AIza.test123"}})
    google = next(p for p in tiles.all_providers() if p.id == "google-satellite")
    assert "AIza.test123" in google.url
    assert "{session}" in google.url  # resolved at fetch time (§3), not here
    assert google.capturable is True
    assert google.cacheable is False
    assert google.attribution_burn is True
    assert google.session == "google"


def test_fetch_crop_rejects_non_capturable_provider():
    provider = dataclasses.replace(tiles.BUILTIN_PROVIDERS[0], capturable=False)
    with pytest.raises(tiles.TileFetchError, match="view-only"):
        tiles.fetch_crop(0, 0, 10, 256, 256, provider, fetch_tile=lambda c, u: None)


def _green_tile(client, url):
    return Image.new("RGB", (256, 256), (10, 120, 10))


def _keyed_provider(monkeypatch, tmp_path, name, key):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings({**config.DEFAULT_SETTINGS, "api_keys": {name: key}})
    return next(p for p in tiles.all_providers() if p.id == f"{name}-satellite")


def test_fetch_crop_mapbox_uses_512_tiles_and_meters_served(monkeypatch, tmp_path):
    provider = _keyed_provider(monkeypatch, tmp_path, "mapbox", "pk.test")
    assert provider.tile_size == 512
    urls = []

    def fetch(client, url):
        urls.append(url)
        return Image.new("RGB", (512, 512), (10, 120, 10))

    img, prov = tiles.fetch_crop(48.8584, 2.2945, 15, 512, 512, provider, fetch_tile=fetch)
    assert all("access_token=pk.test" in u for u in urls)
    # 512px tiles: same m/px, but requested one zoom lower — 4× fewer billed tiles
    assert all("/tiles/512/14/" in u for u in urls)
    assert prov["zoom"] == 15  # provenance keeps the visual zoom
    assert len(urls) <= 4  # a 512px crop needs at most 2×2 512px tiles, not 3×3 256s
    assert prov["attribution"] == "© Mapbox © OpenStreetMap"
    assert prov["attribution_burned"] is False
    assert img.size == (512, 512)  # no footer band for Mapbox
    # exactly the tiles the provider served land in the monthly counter (§6)
    assert config.load_settings()["usage"]["mapbox"][config.month_key()] == len(urls)


def test_fetch_crop_512_grid_covers_the_canvas(monkeypatch, tmp_path):
    provider = _keyed_provider(monkeypatch, tmp_path, "mapbox", "pk.test")

    def fetch(client, url):
        return Image.new("RGB", (512, 512), (10, 120, 10))

    img, prov = tiles.fetch_crop(
        48.8584, 2.2945, 17, 900, 700, provider, marker_style="none", fetch_tile=fetch
    )
    assert prov["tiles_missing"] == 0
    # no background showing through anywhere — the 512 grid must tile seamlessly
    for xy in ((0, 0), (899, 0), (0, 699), (899, 699), (450, 350)):
        assert img.getpixel(xy) == (10, 120, 10)


def test_fetch_crop_missing_tiles_are_not_billed(monkeypatch, tmp_path):
    provider = _keyed_provider(monkeypatch, tmp_path, "mapbox", "pk.test")
    calls = {"n": 0}

    def fetch(client, url):
        calls["n"] += 1
        return None if calls["n"] == 1 else Image.new("RGB", (512, 512), (10, 120, 10))

    img, prov = tiles.fetch_crop(48.8584, 2.2945, 15, 900, 900, provider, fetch_tile=fetch)
    assert prov["tiles_missing"] == 1
    # only tiles the provider actually served count toward the meter
    usage = config.load_settings()["usage"]["mapbox"][config.month_key()]
    assert usage == prov["tiles"] - 1


def test_fetch_crop_unmetered_provider_records_nothing(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    tiles.fetch_crop(
        48.8584, 2.2945, 15, 512, 512, tiles.BUILTIN_PROVIDERS[0], fetch_tile=_green_tile
    )
    assert config.load_settings()["usage"] == {}


def test_fetch_crop_google_resolves_session_and_burns_attribution(monkeypatch, tmp_path):
    provider = _keyed_provider(monkeypatch, tmp_path, "google", "AIza.test")
    monkeypatch.setattr(
        tiles.google_tiles,
        "resolve_template",
        lambda url, **kw: url.replace("{session}", "tok-live"),
    )
    monkeypatch.setattr(
        tiles.google_tiles,
        "viewport_copyright",
        lambda *a, **kw: "Map data ©2026 Google, Maxar Technologies",
    )
    urls = []

    def fetch(client, url):
        urls.append(url)
        return _green_tile(client, url)

    img, prov = tiles.fetch_crop(48.8584, 2.2945, 15, 512, 512, provider, fetch_tile=fetch)
    assert all("session=tok-live" in u and "key=AIza.test" in u for u in urls)
    # dynamic viewport copyright recorded, not just "Google"
    assert prov["attribution"] == "Map data ©2026 Google, Maxar Technologies"
    assert prov["attribution_burned"] is True
    # the footer band is appended below the imagery, never covering it
    assert img.size == (512, 512 + tiles.ATTRIBUTION_BAND)
    assert img.getpixel((0, 512 + tiles.ATTRIBUTION_BAND - 1)) == (16, 18, 24)
    assert img.getpixel((0, 511)) == (10, 120, 10)  # imagery intact
    assert config.load_settings()["usage"]["google"][config.month_key()] == prov["tiles"]


def test_fetch_crop_google_remints_session_on_403(monkeypatch, tmp_path):
    provider = _keyed_provider(monkeypatch, tmp_path, "google", "AIza.test")
    tokens = iter(["tok-stale", "tok-fresh"])
    monkeypatch.setattr(
        tiles.google_tiles,
        "resolve_template",
        lambda url, **kw: url.replace("{session}", next(tokens)),
    )
    invalidated = []
    monkeypatch.setattr(tiles.google_tiles, "invalidate", invalidated.append)
    monkeypatch.setattr(tiles.google_tiles, "viewport_copyright", lambda *a, **kw: None)

    def fetch(client, url):
        if "session=tok-stale" in url:
            request = httpx.Request("GET", url)
            raise httpx.HTTPStatusError(
                "expired", request=request, response=httpx.Response(403, request=request)
            )
        assert "session=tok-fresh" in url
        return _green_tile(client, url)

    img, prov = tiles.fetch_crop(48.8584, 2.2945, 15, 512, 512, provider, fetch_tile=fetch)
    assert invalidated == ["AIza.test"]
    assert prov["tiles_missing"] == 0
    # no viewport copyright reachable — static fallback still carried & burned
    assert prov["attribution"] == "Google"


def test_record_usage_rolls_months(monkeypatch, tmp_path):
    from datetime import datetime, timezone

    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    july = datetime(2026, 7, 20, tzinfo=timezone.utc)
    august = datetime(2026, 8, 2, tzinfo=timezone.utc)
    assert config.record_usage("google", 5, when=july) == 5
    assert config.record_usage("google", 3, when=july) == 8
    assert config.record_usage("google", 2, when=august) == 2  # fresh bucket
    usage = config.load_settings()["usage"]["google"]
    assert usage == {"2026-07": 8, "2026-08": 2}


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


def test_map_links_cover_external_maps():
    links = geo.map_links(48.8584, 2.2945, 16)
    for key in ("google", "google_earth", "bing", "yandex", "sentinel", "zoom_earth"):
        assert key in links and links[key].startswith("https://")
    # Yandex takes lon,lat order
    assert "ll=2.2945,48.8584" in links["yandex"]


class _FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def test_esri_capture_date_parses_yyyymmdd():
    payload = {"results": [{"attributes": {"NICE_NAME": "Maxar", "SRC_DATE2": "20210514"}}]}
    out = tiles.esri_capture_date(48.8584, 2.2945, 17, get=lambda *a, **k: _FakeResp(payload))
    assert out == {"date": "2021-05-14", "source": "Maxar"}


def test_esri_capture_date_full_date_beats_year():
    payload = {"results": [{"attributes": {"SRC_DATE": "2019", "SRC_DATE2": "20200103"}}]}
    out = tiles.esri_capture_date(0, 0, 17, get=lambda *a, **k: _FakeResp(payload))
    assert out["date"] == "2020-01-03"


def test_esri_capture_date_empty_results():
    out = tiles.esri_capture_date(0, 0, 17, get=lambda *a, **k: _FakeResp({"results": []}))
    assert out == {"date": None, "source": None}


def test_esri_capture_date_network_failure_returns_none():
    def boom(*a, **k):
        raise OSError("down")

    assert tiles.esri_capture_date(0, 0, 17, get=boom) is None
