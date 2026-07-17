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


def test_opentopomap_is_a_keyless_builtin(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    otm = next(p for p in tiles.all_providers() if p.id == "opentopomap")
    assert otm.needs_key is False  # core features never require a key
    assert otm.meter is None  # free: no billing counter to keep
    # CC-BY-SA makes the attribution a condition of the licence, not a courtesy
    assert "OpenTopoMap" in otm.attribution and "CC-BY-SA" in otm.attribution
    assert "OpenStreetMap" in otm.attribution and "SRTM" in otm.attribution
    # a topographic base map, not imagery: the labels overlay would double its labels
    assert otm.imagery is False
    # the server itself answers deeper zooms with a "max zoom layer = 17" placard
    assert otm.max_zoom == 17
    # no {s}: the capture path formats only x/y/z and would raise on a subdomain
    assert "{s}" not in otm.url


def test_fetch_crop_never_requests_past_opentopomap_max_zoom(monkeypatch, tmp_path):
    """A capture must never ask OpenTopoMap for z >= 18.

    Deeper zooms come back as a constant "max zoom layer = 17" placard, so
    stitching one would put that placard into a proof. fetch_crop clamps to the
    provider max instead — and records the honest zoom in provenance.
    """
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    otm = next(p for p in tiles.all_providers() if p.id == "opentopomap")
    seen: list[int] = []

    def fake_fetch(client, url):
        seen.append(int(url.split("/")[-3]))
        return Image.new("RGB", (256, 256), (200, 180, 140))

    _, prov = tiles.fetch_crop(45.92, 6.87, 19, 512, 512, otm, fetch_tile=fake_fetch)
    assert seen and max(seen) == 17
    assert prov["zoom"] == 17
    # m/px must describe the zoom actually captured, not the one asked for
    assert prov["meters_per_pixel"] == round(tiles.meters_per_pixel(45.92, 17), 3)


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
    assert google.tile_size == 1024  # hi-DPI 4x session (1/16th the billed requests)


def test_all_providers_adds_sentinelhub_when_keyed(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings({**config.DEFAULT_SETTINGS, "api_keys": {"sentinelhub": "inst-uuid"}})
    s2 = next(p for p in tiles.all_providers() if p.id == "sentinel2")
    assert "inst-uuid" in s2.url
    assert "{key}" not in s2.url  # the instance id is the whole credential
    assert "TIME=" not in s2.url  # omitted: the layer's own default window applies
    assert s2.capturable is True
    assert s2.cacheable is True  # open data — no anti-cache clause to respect
    assert s2.attribution_burn is False
    assert s2.session is None
    assert s2.tile_size == 512  # one 512px tile == exactly 1 processing unit
    # 10 m/px native: requests stop at z14 (deeper is upsampling we'd pay for),
    # the view runs to z18 on magnified native tiles — free, since nothing new
    # is fetched
    assert s2.max_native_zoom == 14
    assert s2.max_zoom == 18
    # its own eco threshold: the global z15 sits above its native ceiling, so
    # sharing it would swap Sentinel-2 away at most zooms it can actually serve
    assert s2.eco_max_zoom == 11


def test_sentinelhub_names_its_zoom_level_by_resolution(monkeypatch, tmp_path):
    """WMTS numbers 512px levels by resolution where Mapbox numbers them by grid
    width: tile indices valid at grid level 13 belong to TILEMATRIX=14."""
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings({**config.DEFAULT_SETTINGS, "api_keys": {"sentinelhub": "inst-uuid"}})
    s2 = next(p for p in tiles.all_providers() if p.id == "sentinel2")
    url = tiles.tile_url(s2.url, 13, 4151, 2818, s2.zoom_offset)
    assert "TILEMATRIX=14" in url
    assert "TILECOL=4151" in url and "TILEROW=2818" in url


def _sentinel(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings({**config.DEFAULT_SETTINGS, "api_keys": {"sentinelhub": "inst-uuid"}})
    return next(p for p in tiles.all_providers() if p.id == "sentinel2")


def test_get_provider_resolves_a_sentinel_variant(monkeypatch, tmp_path):
    _sentinel(monkeypatch, tmp_path)
    p = tiles.get_provider("sentinel2~SWIR~2026-05-01~2026-05-31")
    assert "LAYER=SWIR" in p.url
    assert "TIME=2026-05-01/2026-05-31" in p.url
    assert "inst-uuid" in p.url  # the credential survives the rebuild
    assert "{key}" not in p.url
    # the id is the variant, so the disk cache keys on it: two windows can never
    # collide in the cache, which is the trap docs/IMAGERY_PROVIDERS.md names
    assert p.id == "sentinel2~SWIR~2026-05-01~2026-05-31"
    assert p.meter == "sentinelhub"  # still the same quota
    assert p.max_native_zoom == 14 and p.max_zoom == 18
    assert "SWIR" in p.label and "2026-05-01" in p.label


def test_get_provider_variant_without_a_window_keeps_the_default_time(monkeypatch, tmp_path):
    _sentinel(monkeypatch, tmp_path)
    p = tiles.get_provider("sentinel2~FALSE_COLOR")
    assert "LAYER=FALSE_COLOR" in p.url
    assert "TIME=" not in p.url


def test_get_provider_refuses_a_malformed_variant(monkeypatch, tmp_path):
    _sentinel(monkeypatch, tmp_path)
    for bad in ("sentinel2~../etc", "sentinel2~SWIR~2026-99-01~2026-05-31", "sentinel2~a b"):
        with pytest.raises(KeyError):
            tiles.get_provider(bad)


def test_get_provider_refuses_variants_on_providers_that_have_none(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings(config.DEFAULT_SETTINGS)
    with pytest.raises(KeyError):
        tiles.get_provider("esri-world-imagery~SWIR")


def test_fetch_crop_past_native_zoom_magnifies_instead_of_paying(monkeypatch, tmp_path):
    """Sentinel-2 views run to z18 but its pixels stop at z14: the deepest real
    tiles are fetched and magnified. Asking Sentinel Hub for z18 would buy its
    upsampling of the same pixels, 16× the tiles, every one billed."""
    provider = _sentinel(monkeypatch, tmp_path)
    urls = []

    def fetch(client, url):
        urls.append(url)
        return Image.new("RGB", (512, 512), (10, 120, 10))

    img, prov = tiles.fetch_crop(
        48.8584, 2.2945, 18, 512, 512, provider, marker_style="none", fetch_tile=fetch
    )
    # every request is at the native level (grid 13 → TILEMATRIX 14), none deeper
    assert urls and all("TILEMATRIX=14" in u for u in urls)
    # one native tile now covers 16× the canvas, so a 512px crop needs 1–4 of
    # them — not the 16× more a real z18 grid would have cost
    assert len(urls) <= 4
    assert config.load_settings()["usage"]["sentinelhub"][config.month_key()] == len(urls)
    assert img.size == (512, 512)
    # the canvas is fully covered — the magnified grid must still tile seamlessly
    for xy in ((0, 0), (511, 0), (0, 511), (511, 511), (256, 256)):
        assert img.getpixel(xy) == (10, 120, 10)
    # provenance tells the truth twice: the view is z18, the pixels are z14
    assert prov["zoom"] == 18
    assert prov["native_zoom"] == 14
    assert prov["upscaled"] is True
    assert prov["native_meters_per_pixel"] > prov["meters_per_pixel"]


def test_fetch_crop_at_native_zoom_is_not_marked_upscaled(monkeypatch, tmp_path):
    provider = _sentinel(monkeypatch, tmp_path)

    def fetch(client, url):
        return Image.new("RGB", (512, 512), (10, 120, 10))

    _, prov = tiles.fetch_crop(
        48.8584, 2.2945, 14, 512, 512, provider, marker_style="none", fetch_tile=fetch
    )
    assert prov["zoom"] == 14 and prov["native_zoom"] == 14
    assert prov["upscaled"] is False
    assert prov["native_meters_per_pixel"] == prov["meters_per_pixel"]


def test_fetch_crop_of_a_variant_requests_that_layer_and_window(monkeypatch, tmp_path):
    _sentinel(monkeypatch, tmp_path)
    provider = tiles.get_provider("sentinel2~SWIR~2026-05-01~2026-05-31")
    urls = []

    def fetch(client, url):
        urls.append(url)
        return Image.new("RGB", (512, 512), (10, 120, 10))

    _, prov = tiles.fetch_crop(
        48.8584, 2.2945, 14, 512, 512, provider, marker_style="none", fetch_tile=fetch
    )
    assert all("LAYER=SWIR" in u and "TIME=2026-05-01/2026-05-31" in u for u in urls)
    # a reader of this capture can tell which layer and which window it is
    assert prov["provider"] == "sentinel2~SWIR~2026-05-01~2026-05-31"
    assert "SWIR" in prov["provider_label"]


def test_tile_url_leaves_zoom_alone_without_an_offset():
    url = tiles.tile_url("https://x/{z}/{x}/{y}.png", 7, 1, 2)
    assert url == "https://x/7/1/2.png"


def test_all_providers_adds_google_js_widget_when_keyed(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings({**config.DEFAULT_SETTINGS, "api_keys": {"google_js": "AIza.js"}})
    widget = next(p for p in tiles.all_providers() if p.id == "google-js")
    assert "AIza.js" in widget.url  # the JS loader URL — client-side by design
    assert widget.widget == "google-maps-js"
    assert widget.capturable is False  # nothing to stitch — screenshots only
    assert widget.cacheable is False
    assert widget.meter == "google_js"  # counts map loads, not tiles
    assert widget.eco_max_zoom == 0  # eco would re-bill a load per swap


def test_all_providers_benches_a_key_that_failed_auth(monkeypatch, tmp_path):
    """A basemap whose key was last seen failing (EEA block, revoked key) is
    withheld from the selector until the key changes or a test passes."""
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings({
        **config.DEFAULT_SETTINGS,
        "api_keys": {"google": "AIza.x", "mapbox": "pk.y"},
        "provider_status": {"google": {"ok": False, "detail": "EEA policy", "at": "now"}},
    })
    ids = {p.id for p in tiles.all_providers()}
    assert "google-satellite" not in ids  # benched
    assert "mapbox-satellite" in ids  # untouched
    # a passing verdict puts it back
    config.record_provider_status("google", True, "session token created")
    assert "google-satellite" in {p.id for p in tiles.all_providers()}


def test_all_providers_respects_enable_toggles(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings({
        **config.DEFAULT_SETTINGS,
        "api_keys": {"mapbox": "pk.test", "google": "AIza.test"},
        "providers_enabled": {"mapbox": False},
    })
    ids = {p.id for p in tiles.all_providers()}
    # mapbox switched off (key kept), google untouched by an absent entry
    assert "mapbox-satellite" not in ids
    assert "google-satellite" in ids


def test_fetch_crop_blocked_at_soft_limit(monkeypatch, tmp_path):
    provider = _keyed_provider(monkeypatch, tmp_path, "mapbox", "pk.test")
    config.record_usage("mapbox", int(config.FREE_TIER["mapbox"] * config.BLOCK_SHARE))
    with pytest.raises(tiles.TileFetchError, match="free tier"):
        tiles.fetch_crop(48.8584, 2.2945, 15, 512, 512, provider, fetch_tile=_green_tile)


def test_fetch_crop_override_lifts_the_block(monkeypatch, tmp_path):
    provider = _keyed_provider(monkeypatch, tmp_path, "mapbox", "pk.test")
    config.record_usage("mapbox", config.FREE_TIER["mapbox"])  # 100% used
    settings = config.load_settings()
    settings["usage_overrides"] = {"mapbox": True}
    config.save_settings(settings)

    def fetch(client, url):
        return Image.new("RGB", (512, 512), (10, 120, 10))

    img, prov = tiles.fetch_crop(48.8584, 2.2945, 15, 512, 512, provider, fetch_tile=fetch)
    assert prov["tiles_missing"] == 0


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
        if "/tiles/512/14/" not in url:
            return None  # overzoom parents: nothing there either
        calls["n"] += 1
        return None if calls["n"] == 1 else Image.new("RGB", (512, 512), (10, 120, 10))

    img, prov = tiles.fetch_crop(48.8584, 2.2945, 15, 900, 900, provider, fetch_tile=fetch)
    assert prov["tiles_missing"] == 1
    assert prov["tiles_upscaled"] == 0
    # only tiles the provider actually served count toward the meter
    usage = config.load_settings()["usage"]["mapbox"][config.month_key()]
    assert usage == prov["tiles"] - 1


def test_fetch_crop_overzoom_fills_gaps_from_parent(monkeypatch, tmp_path):
    provider = _keyed_provider(monkeypatch, tmp_path, "mapbox", "pk.test")
    calls = {"n": 0, "parents": []}

    def fetch(client, url):
        if "/tiles/512/14/" in url:  # the crop's own zoom level
            calls["n"] += 1
            return None if calls["n"] == 1 else Image.new("RGB", (512, 512), (10, 120, 10))
        calls["parents"].append(url)  # one level up: imagery exists
        return Image.new("RGB", (512, 512), (200, 50, 50))

    img, prov = tiles.fetch_crop(
        48.8584, 2.2945, 15, 900, 900, provider, marker_style="none", fetch_tile=fetch
    )
    # the gap was filled from the parent level, once, and recorded as upscaled
    assert prov["tiles_missing"] == 0
    assert prov["tiles_upscaled"] == 1
    assert len(calls["parents"]) == 1
    assert "/tiles/512/13/" in calls["parents"][0]
    # the parent tile the provider served is billed alongside the direct ones
    usage = config.load_settings()["usage"]["mapbox"][config.month_key()]
    assert usage == (prov["tiles"] - 1) + 1


def test_default_fetch_treats_placeholder_tile_as_missing(monkeypatch):
    import hashlib

    body = b"esri-not-yet-available"
    monkeypatch.setattr(
        tiles, "PLACEHOLDER_TILE_SHA256", frozenset({hashlib.sha256(body).hexdigest()})
    )

    class FakeClient:
        def get(self, url):
            return httpx.Response(200, content=body, request=httpx.Request("GET", url))

    assert tiles._default_fetch(FakeClient(), "http://tiles.example/1/2/3") is None
    assert tiles.is_placeholder_tile(b"real imagery") is False


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
        return Image.new("RGB", (1024, 1024), (10, 120, 10))

    img, prov = tiles.fetch_crop(48.8584, 2.2945, 15, 512, 512, provider, fetch_tile=fetch)
    assert all("session=tok-live" in u and "key=AIza.test" in u for u in urls)
    # 1024px hi-DPI tiles: same m/px, requested two zooms lower — 16× fewer requests
    assert all("/2dtiles/13/" in u for u in urls)
    assert prov["zoom"] == 15  # provenance keeps the visual zoom
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
        return Image.new("RGB", (1024, 1024), (10, 120, 10))

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
