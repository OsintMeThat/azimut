"""Settings API: API keys management, key tests, usage counters (all offline)."""

import httpx

from azimut import config
from azimut.engine import google_tiles, scrapers, sentinel


def test_get_settings_defaults(client):
    body = client.get("/api/settings").json()
    assert body["api_keys"] == {}
    assert body["usage"] == {}
    assert body["month"] == config.month_key()


def test_ffmpeg_info_reports_bundled_copy(client, monkeypatch):
    from azimut.engine import ffmpeg

    monkeypatch.setattr(ffmpeg, "ffmpeg_path", lambda: "/opt/azimut/ffmpeg")
    monkeypatch.setattr(ffmpeg, "_bundled", lambda name: "/opt/azimut/ffmpeg")
    monkeypatch.setattr(ffmpeg, "_version", lambda exe: "n7.1")

    body = client.get("/api/settings/ffmpeg").json()
    assert body == {
        "available": True,
        "path": "/opt/azimut/ffmpeg",
        "source": "bundled",
        "version": "n7.1",
    }


def test_ffmpeg_info_reports_missing(client, monkeypatch):
    from azimut.engine import ffmpeg

    monkeypatch.setattr(ffmpeg, "ffmpeg_path", lambda: None)
    body = client.get("/api/settings/ffmpeg").json()
    assert body == {"available": False, "path": None, "source": None, "version": None}


def test_put_keys_lights_up_keyed_providers(client):
    saved = client.put("/api/settings/keys", json={"mapbox": "pk.abc"}).json()
    assert saved["api_keys"] == {"mapbox": "pk.abc"}
    ids = {p["id"] for p in client.get("/api/satellite/providers").json()}
    assert "mapbox-satellite" in ids
    assert "google-satellite" not in ids  # no google key yet

    client.put("/api/settings/keys", json={"google": "AIza.x"})
    providers = {p["id"]: p for p in client.get("/api/satellite/providers").json()}
    assert "mapbox-satellite" in providers  # untouched key survives a partial PUT
    google = providers["google-satellite"]
    assert google["capturable"] is True
    assert google["cacheable"] is False
    assert google["session"] == "google"
    assert google["meter"] == "google"


def test_put_empty_key_removes_it(client):
    client.put("/api/settings/keys", json={"mapbox": "pk.abc"})
    saved = client.put("/api/settings/keys", json={"mapbox": "  "}).json()
    assert saved["api_keys"] == {}
    ids = {p["id"] for p in client.get("/api/satellite/providers").json()}
    assert "mapbox-satellite" not in ids


def test_keys_never_reach_a_case_folder(client, monkeypatch):
    """Principle 7: keys live in settings.json only — nothing under cases/."""
    from PIL import Image

    from azimut.engine import tiles

    monkeypatch.setattr(
        tiles, "_default_fetch", lambda c, u: Image.new("RGB", (256, 256), (9, 9, 9))
    )
    client.put("/api/settings/keys", json={"mapbox": "pk.SECRET"})
    cid = client.post("/api/cases", json={"name": "K"}).json()["id"]
    client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 48.85, "lon": 2.29, "zoom": 15, "width": 512, "height": 512,
              "provider": "mapbox-satellite"},
    )
    case_dir = config.cases_dir() / cid
    hits = [
        p for p in case_dir.rglob("*")
        if p.is_file() and p.suffix in (".json", ".md") and "pk.SECRET" in p.read_text()
    ]
    assert hits == []


def _upstream(status=200, content=b"JPEGDATA", headers=None):
    def get(url, **kwargs):
        get.urls.append(url)
        return httpx.Response(
            status, content=content,
            headers={"content-type": "image/jpeg", **(headers or {})},
            request=httpx.Request("GET", url),
        )

    get.urls = []
    return get


def _use_tile_upstream(monkeypatch, handler):
    """Route the tile proxy's pooled client through *handler* (``url -> Response``).

    The proxy reuses one shared httpx.Client, so patching module-level
    ``httpx.get`` no longer intercepts it — swap in a client with a mock
    transport that calls the same handler the old tests used.
    """
    from azimut.api import satellite

    monkeypatch.setattr(
        satellite,
        "_tile_client",
        httpx.Client(transport=httpx.MockTransport(lambda request: handler(str(request.url)))),
    )


def _png_bytes(size=512, colour=(10, 120, 10)):
    """A real encoded tile — the overzoom path decodes what it magnifies."""
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (size, size), colour).save(buf, format="PNG")
    return buf.getvalue()


def test_tile_proxy_serves_and_counts_exactly(client, monkeypatch):
    client.put("/api/settings/keys", json={"mapbox": "pk.abc"})
    upstream = _upstream(headers={"cache-control": "max-age=43200"})
    _use_tile_upstream(monkeypatch, upstream)

    r = client.get("/api/tiles/mapbox-satellite/14/8298/5639")
    assert r.status_code == 200
    assert r.content == b"JPEGDATA"
    assert r.headers["content-type"] == "image/jpeg"
    # provider cache policy passed through so the browser caches (and a cached
    # tile never re-hits the proxy — the counter can't over-count)
    assert r.headers["cache-control"] == "max-age=43200"
    assert "access_token=pk.abc" in upstream.urls[0]
    assert "/tiles/512/14/8298/5639" in upstream.urls[0]

    client.get("/api/tiles/mapbox-satellite/14/8298/5640")
    body = client.get("/api/settings").json()
    assert body["usage"]["mapbox"][body["month"]] == 2  # one bump per served tile


def test_tile_proxy_does_not_count_errors(client, monkeypatch):
    client.put("/api/settings/keys", json={"mapbox": "pk.abc"})
    _use_tile_upstream(monkeypatch, _upstream(status=404, content=b""))
    r = client.get("/api/tiles/mapbox-satellite/14/0/0")
    assert r.status_code == 404
    assert client.get("/api/settings").json()["usage"] == {}


def test_tile_proxy_unknown_provider_404(client):
    assert client.get("/api/tiles/nope/14/0/0").status_code == 404


def test_tile_proxy_google_remints_session_on_403(client, monkeypatch):
    client.put("/api/settings/keys", json={"google": "AIza.x"})
    tokens = iter(["tok-stale", "tok-fresh"])
    monkeypatch.setattr(
        google_tiles, "resolve_template", lambda url, **kw: url.replace("{session}", next(tokens))
    )
    invalidated = []
    monkeypatch.setattr(google_tiles, "invalidate", invalidated.append)

    def get(url, **kwargs):
        status = 403 if "session=tok-stale" in url else 200
        return httpx.Response(
            status, content=b"TILE", headers={"content-type": "image/jpeg"},
            request=httpx.Request("GET", url),
        )

    _use_tile_upstream(monkeypatch, get)
    r = client.get("/api/tiles/google-satellite/15/16597/11278")
    assert r.status_code == 200
    assert r.content == b"TILE"
    assert invalidated == ["AIza.x"]
    body = client.get("/api/settings").json()
    assert body["usage"]["google"][body["month"]] == 1  # the retry isn't double-counted


def test_get_settings_exposes_prefs_and_free_tier(client):
    body = client.get("/api/settings").json()
    assert body["free_tier"] == config.FREE_TIER
    assert body["block_share"] == config.BLOCK_SHARE
    assert body["eco_max_zoom"] == config.ECO_MAX_ZOOM
    assert body["eco_zoom_fallback"] is True
    assert body["providers_enabled"] == {}
    assert body["usage_overrides"] == {}
    assert body["signature_handle"] == ""
    # startup update pop-up: on by default, nothing muted yet
    assert body["update_check_on_start"] is True
    assert body["update_dismissed_version"] == ""


def test_put_prefs_roundtrips_update_popup_prefs(client):
    saved = client.put(
        "/api/settings/prefs",
        json={"update_check_on_start": False, "update_dismissed_version": "v0.2.0"},
    ).json()
    assert saved["update_check_on_start"] is False
    assert saved["update_dismissed_version"] == "v0.2.0"
    # partial PUT leaves the other one untouched
    saved = client.put("/api/settings/prefs", json={"update_check_on_start": True}).json()
    assert saved["update_check_on_start"] is True
    assert saved["update_dismissed_version"] == "v0.2.0"


def test_put_prefs_roundtrips_signature_handle(client):
    saved = client.put("/api/settings/prefs", json={"signature_handle": "  @example  "}).json()
    assert saved["signature_handle"] == "@example"
    assert client.get("/api/settings").json()["signature_handle"] == "@example"


def test_put_prefs_roundtrips_and_filters_unknown_providers(client):
    saved = client.put(
        "/api/settings/prefs",
        json={
            "providers_enabled": {"mapbox": False, "bogus": False},
            "usage_overrides": {"google": True},
            "eco_zoom_fallback": False,
        },
    ).json()
    assert saved["providers_enabled"] == {"mapbox": False}  # unknown ids dropped
    assert saved["usage_overrides"] == {"google": True}
    assert saved["eco_zoom_fallback"] is False
    # partial PUT leaves other prefs untouched
    saved = client.put("/api/settings/prefs", json={"eco_zoom_fallback": True}).json()
    assert saved["providers_enabled"] == {"mapbox": False}
    assert saved["eco_zoom_fallback"] is True


def test_disabled_provider_hidden_but_key_kept(client):
    client.put("/api/settings/keys", json={"mapbox": "pk.abc"})
    client.put("/api/settings/prefs", json={"providers_enabled": {"mapbox": False}})
    ids = {p["id"] for p in client.get("/api/satellite/providers").json()}
    assert "mapbox-satellite" not in ids
    assert client.get("/api/settings").json()["api_keys"] == {"mapbox": "pk.abc"}
    client.put("/api/settings/prefs", json={"providers_enabled": {"mapbox": True}})
    ids = {p["id"] for p in client.get("/api/satellite/providers").json()}
    assert "mapbox-satellite" in ids


def test_tile_proxy_blocks_at_soft_limit_and_override_lifts(client, monkeypatch):
    client.put("/api/settings/keys", json={"mapbox": "pk.abc"})
    _use_tile_upstream(monkeypatch, _upstream())
    config.record_usage("mapbox", int(config.FREE_TIER["mapbox"] * config.BLOCK_SHARE))

    r = client.get("/api/tiles/mapbox-satellite/14/8298/5639")
    assert r.status_code == 429
    assert "Settings" in r.json()["detail"]

    client.put("/api/settings/prefs", json={"usage_overrides": {"mapbox": True}})
    assert client.get("/api/tiles/mapbox-satellite/14/8298/5639").status_code == 200


def test_tile_proxy_disk_cache_serves_repeats_without_rebilling(client, monkeypatch):
    client.put("/api/settings/keys", json={"mapbox": "pk.abc"})
    upstream = _upstream()
    _use_tile_upstream(monkeypatch, upstream)

    assert client.get("/api/tiles/mapbox-satellite/14/8298/5639").status_code == 200
    r = client.get("/api/tiles/mapbox-satellite/14/8298/5639")
    assert r.status_code == 200
    assert r.content == b"JPEGDATA"
    assert len(upstream.urls) == 1  # second hit came from the disk cache
    body = client.get("/api/settings").json()
    assert body["usage"]["mapbox"][body["month"]] == 1  # cache hits aren't billed


def test_tile_proxy_never_caches_google(client, monkeypatch):
    client.put("/api/settings/keys", json={"google": "AIza.x"})
    monkeypatch.setattr(
        google_tiles, "resolve_template", lambda url, **kw: url.replace("{session}", "tok")
    )
    upstream = _upstream()
    _use_tile_upstream(monkeypatch, upstream)

    client.get("/api/tiles/google-satellite/15/16597/11278")
    client.get("/api/tiles/google-satellite/15/16597/11278")
    assert len(upstream.urls) == 2  # terms forbid a disk cache — always upstream
    assert not (config.workspace_root() / "tile-cache" / "google-satellite").exists()
    body = client.get("/api/settings").json()
    assert body["usage"]["google"][body["month"]] == 2


def _png_tile(size=256, colour=(30, 90, 200)):
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (size, size), colour).save(buf, format="PNG")
    return buf.getvalue()


def test_tile_proxy_overzoom_fills_coverage_gaps(client, monkeypatch):
    parent_png = _png_tile()

    def get(url, **kwargs):
        get.urls.append(url)
        # imagery ends at z18: deeper levels 404, the parent level serves
        if "/tile/19/" in url:
            return httpx.Response(404, content=b"", request=httpx.Request("GET", url))
        return httpx.Response(
            200, content=parent_png, headers={"content-type": "image/png"},
            request=httpx.Request("GET", url),
        )

    get.urls = []
    _use_tile_upstream(monkeypatch, get)

    r = client.get("/api/tiles/esri-world-imagery/19/155000/400000")
    assert r.status_code == 200
    assert r.headers["x-azimut-overzoom"] == "1"
    assert r.headers["content-type"] == "image/png"
    # served tile is a full-size upscale of the parent quadrant
    import io

    from PIL import Image

    img = Image.open(io.BytesIO(r.content))
    assert img.size == (256, 256)


def test_tile_proxy_placeholder_tile_triggers_overzoom(client, monkeypatch):
    import hashlib

    from azimut.engine import tiles

    placeholder = b"esri-map-data-not-yet-available"
    monkeypatch.setattr(
        tiles, "PLACEHOLDER_TILE_SHA256", frozenset({hashlib.sha256(placeholder).hexdigest()})
    )
    parent_png = _png_tile(colour=(120, 40, 40))

    def get(url, **kwargs):
        body, ctype = (
            (placeholder, "image/jpeg") if "/tile/19/" in url else (parent_png, "image/png")
        )
        return httpx.Response(
            200, content=body, headers={"content-type": ctype},
            request=httpx.Request("GET", url),
        )

    _use_tile_upstream(monkeypatch, get)
    r = client.get("/api/tiles/esri-world-imagery/19/155000/400000")
    assert r.status_code == 200
    assert r.headers["x-azimut-overzoom"] == "1"


def test_test_key_without_saved_key_is_404(client):
    assert client.post("/api/settings/keys/mapbox/test").status_code == 404
    assert client.post("/api/settings/keys/unknown/test").status_code == 404


def test_test_key_mapbox_ok_and_failure(client, monkeypatch):
    client.put("/api/settings/keys", json={"mapbox": "pk.abc"})

    def ok(url, **kwargs):
        assert "access_token=pk.abc" in url
        return httpx.Response(200, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", ok)
    assert client.post("/api/settings/keys/mapbox/test").json()["ok"] is True

    def unauthorized(url, **kwargs):
        return httpx.Response(401, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", unauthorized)
    result = client.post("/api/settings/keys/mapbox/test").json()
    assert result["ok"] is False
    assert result["detail"]


def test_test_key_google_mints_a_session(client, monkeypatch):
    client.put("/api/settings/keys", json={"google": "AIza.x"})
    minted = []

    def fake_token(key, **kwargs):
        minted.append(key)
        return "tok"

    monkeypatch.setattr(google_tiles, "session_token", fake_token)
    assert client.post("/api/settings/keys/google/test").json()["ok"] is True
    assert minted == ["AIza.x"]


def test_test_key_sentinelhub_reports_the_services_own_words(client, monkeypatch):
    """A bad instance id (or an instance without a TRUE_COLOR layer) comes back
    as a 400 ExceptionReport — the analyst gets Sentinel Hub's sentence, not
    "400 Bad Request"."""
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})

    def ok(url, **kwargs):
        assert "/ogc/wmts/inst-uuid?" in url
        assert "TILEMATRIX=14" in url  # the zoom_offset applies here too
        return httpx.Response(200, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", ok)
    assert client.post("/api/settings/keys/sentinelhub/test").json()["ok"] is True

    body = (
        "<?xml version='1.0'?><ows:ExceptionReport "
        'xmlns:ows="http://www.opengis.net/ows/1.1"><ows:Exception>'
        "<ows:ExceptionText>Invalid instance id: inst-uuid</ows:ExceptionText>"
        "</ows:Exception></ows:ExceptionReport>"
    )

    def bad(url, **kwargs):
        return httpx.Response(400, content=body.encode(), request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", bad)
    result = client.post("/api/settings/keys/sentinelhub/test").json()
    assert result["ok"] is False
    assert result["detail"] == "Invalid instance id: inst-uuid"


def test_sentinel2_tile_proxy_offsets_the_matrix_and_counts_tiles(client, monkeypatch):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    upstream = _upstream()
    _use_tile_upstream(monkeypatch, upstream)

    # the frontend asks in grid levels; WMTS wants that level named one higher
    assert client.get("/api/tiles/sentinel2/13/4151/2818").status_code == 200
    assert "TILEMATRIX=14" in upstream.urls[0]
    assert "TILECOL=4151" in upstream.urls[0] and "TILEROW=2818" in upstream.urls[0]
    body = client.get("/api/settings").json()
    assert body["usage"]["sentinelhub"][body["month"]] == 1  # 1 tile == 1 PU


def test_sentinel2_proxy_never_asks_upstream_past_the_native_ceiling(client, monkeypatch):
    """A grid level deeper than z14 exists only as Sentinel Hub's own upsampling
    of pixels we already have — and every tile of it is billed. Serve the native
    tile magnified instead."""
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    upstream = _upstream(content=_png_bytes(), headers={"content-type": "image/png"})
    _use_tile_upstream(monkeypatch, upstream)

    # grid 17 == view z18 for a 512px provider; native is grid 13 (TILEMATRIX 14)
    r = client.get("/api/tiles/sentinel2/17/66424/45097")
    assert r.status_code == 200
    assert r.headers["x-azimut-overzoom"] == "4"  # magnified, not fetched
    assert len(upstream.urls) == 1
    assert "TILEMATRIX=14" in upstream.urls[0]  # the native level, nothing deeper
    body = client.get("/api/settings").json()
    assert body["usage"]["sentinelhub"][body["month"]] == 1  # one tile, not sixteen


def test_sentinel_layers_does_not_touch_the_network_without_check(client, monkeypatch):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})

    def explode(*a, **k):
        raise AssertionError("opening the layer list must never phone out")

    monkeypatch.setattr(httpx, "get", explode)
    body = client.get("/api/satellite/sentinel/layers").json()
    assert body["source"] == "catalogue"
    ids = [entry["id"] for entry in body["layers"]]
    assert "TRUE_COLOR" in ids and "FALSE_COLOR" in ids and "SWIR" in ids
    assert all(entry["label"] for entry in body["layers"])


def test_sentinel_layers_check_asks_the_instance(client, monkeypatch):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    xml = (
        '<?xml version="1.0"?><Capabilities xmlns="http://www.opengis.net/wmts/1.0" '
        'xmlns:ows="http://www.opengis.net/ows/1.1"><Contents>'
        "<Layer><ows:Identifier>TRUE_COLOR</ows:Identifier></Layer>"
        "<Layer><ows:Identifier>VESSELS</ows:Identifier><ows:Title>Vessels</ows:Title></Layer>"
        "</Contents></Capabilities>"
    )

    def get(url, **kwargs):
        return httpx.Response(200, content=xml.encode(), request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", get)
    body = client.get("/api/satellite/sentinel/layers?check=true").json()
    assert body["source"] == "instance"
    assert [entry["id"] for entry in body["layers"]] == ["TRUE_COLOR", "VESSELS"]


def test_sentinel_layers_check_falls_back_to_the_catalogue_and_says_why(client, monkeypatch):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})

    def boom(*a, **k):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(httpx, "get", boom)
    body = client.get("/api/satellite/sentinel/layers?check=true").json()
    # a failed discovery leaves a usable list rather than an empty dropdown
    assert body["source"] == "catalogue"
    assert "offline" in body["detail"]


def test_sentinel_dates_lists_passes_and_counts_the_request(client, monkeypatch):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    payload = (
        '{"features": [{"properties": {"date": "2026-05-11", "cloudCoverPercentage": 4}}]}'
    )

    def get(url, **kwargs):
        assert "/ogc/wfs/inst-uuid" in url
        return httpx.Response(200, content=payload.encode(), request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", get)
    body = client.get(
        "/api/satellite/sentinel/dates"
        "?lat=48.8584&lon=2.2945&start=2026-05-01&end=2026-05-31"
    ).json()
    assert body["dates"] == [{"date": "2026-05-11", "cloud": 4.0, "granules": 1}]
    # a WFS query is ~0.01 PU but one whole request against the request quota —
    # the meter counts what the account is charged for, tile or not
    settings = client.get("/api/settings").json()
    assert settings["usage"]["sentinelhub"][settings["month"]] == 1


def test_sentinel_dates_without_a_key_is_a_404(client):
    assert client.get(
        "/api/satellite/sentinel/dates?lat=1&lon=1&start=2026-05-01&end=2026-05-31"
    ).status_code == 404


def test_sentinel_coverage_checks_the_layer_and_counts_the_request(client, monkeypatch):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    calls = []

    def check(instance, lat, lon, layer, day):
        calls.append((instance, lat, lon, layer, day))
        return {
            "available": False,
            "coverage": 0.0,
            "date": day,
            "layer": layer,
        }

    monkeypatch.setattr(sentinel, "coverage", check)
    body = client.get(
        "/api/satellite/sentinel/coverage"
        "?lat=48.8584&lon=2.2945&layer=SWIR&date=2026-05-11"
    ).json()

    assert body["available"] is False
    assert calls == [("inst-uuid", 48.8584, 2.2945, "SWIR", "2026-05-11")]
    settings = client.get("/api/settings").json()
    assert settings["usage"]["sentinelhub"][settings["month"]] == 1


def test_sentinel_coverage_rejects_bad_input_without_counting(client, monkeypatch):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})

    def reject(*args):
        raise ValueError("malformed Sentinel-2 layer")

    monkeypatch.setattr(sentinel, "coverage", reject)
    response = client.get(
        "/api/satellite/sentinel/coverage"
        "?lat=48.8584&lon=2.2945&layer=bad&date=2026-05-11"
    )
    assert response.status_code == 422
    assert client.get("/api/settings").json()["usage"] == {}


def test_sentinel_coverage_failure_is_upstream_error(client, monkeypatch):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})

    def fail(*args):
        raise sentinel.CoverageError("no readable image")

    monkeypatch.setattr(sentinel, "coverage", fail)
    response = client.get(
        "/api/satellite/sentinel/coverage"
        "?lat=48.8584&lon=2.2945&layer=SWIR&date=2026-05-11"
    )
    assert response.status_code == 502
    assert client.get("/api/settings").json()["usage"] == {}


def test_free_tier_defaults_to_the_provisioned_sentinel_allowance(client):
    body = client.get("/api/settings").json()
    # Copernicus documents 10k but provisions 30k to a General account
    # (observed 2026-07) — the counter measures against what they actually give
    assert body["free_tier"]["sentinelhub"] == 30_000
    assert body["free_tier_default"]["sentinelhub"] == 30_000


def test_free_tier_override_moves_the_soft_block(client, monkeypatch):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    r = client.put("/api/settings/prefs", json={"free_tiers": {"sentinelhub": 1000, "bogus": 5}})
    assert r.json()["free_tiers"] == {"sentinelhub": 1000}  # unknown meters ignored
    assert client.get("/api/settings").json()["free_tier"]["sentinelhub"] == 1000

    # the block now measures against the user's figure, not the shipped default
    config.record_usage("sentinelhub", 900)  # 90% of 1000
    _use_tile_upstream(monkeypatch, _upstream())
    assert client.get("/api/tiles/sentinel2/13/4151/2818").status_code == 429

    # ...and clearing it restores the default, which 900 is nowhere near
    client.put("/api/settings/prefs", json={"free_tiers": {"sentinelhub": None}})
    assert client.get("/api/settings").json()["free_tier"]["sentinelhub"] == 30_000
    assert client.get("/api/tiles/sentinel2/13/4151/2818").status_code == 200


def test_key_test_records_status_and_benches_the_basemap(client, monkeypatch):
    """A failing key test benches the basemap; saving a different key clears
    the verdict and the basemap comes back."""
    client.put("/api/settings/keys", json={"mapbox": "pk.bad"})

    def unauthorized(url, **kwargs):
        return httpx.Response(401, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", unauthorized)
    assert client.post("/api/settings/keys/mapbox/test").json()["ok"] is False

    status = client.get("/api/settings").json()["provider_status"]
    assert status["mapbox"]["ok"] is False
    ids = {p["id"] for p in client.get("/api/satellite/providers").json()}
    assert "mapbox-satellite" not in ids

    # a new key wipes the old key's verdict — the basemap is offered again
    client.put("/api/settings/keys", json={"mapbox": "pk.fresh"})
    assert "mapbox" not in client.get("/api/settings").json()["provider_status"]
    ids = {p["id"] for p in client.get("/api/satellite/providers").json()}
    assert "mapbox-satellite" in ids


def test_google_key_test_speaks_googles_own_words(client, monkeypatch):
    """The EEA policy block arrives as a 403 with a full explanation in the
    body — the test verdict must carry that sentence, not '403 Forbidden'."""
    client.put("/api/settings/keys", json={"google": "AIza.eea"})
    eea = (
        '{"error": {"code": 403, "status": "PERMISSION_DENIED", "message": '
        '"Your request cannot be served because satellite tiles and 3D tiles '
        'are not available for your account and region."}}'
    )

    def blocked(url, **kwargs):
        return httpx.Response(
            403, content=eea.encode(),
            headers={"content-type": "application/json"},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(google_tiles.httpx, "post", blocked)
    result = client.post("/api/settings/keys/google/test").json()
    assert result["ok"] is False
    assert "not available for your account and region" in result["detail"]
    # and the dead basemap is no longer offered
    ids = {p["id"] for p in client.get("/api/satellite/providers").json()}
    assert "google-satellite" not in ids


def test_google_js_key_is_tested_in_the_browser(client):
    """No server-side probe exists for a Maps JS key — the backend says so,
    and the browser reports its gm_authFailure verdict through /status."""
    client.put("/api/settings/keys", json={"google_js": "AIza.js"})
    assert client.post("/api/settings/keys/google_js/test").json()["ok"] is None

    r = client.post(
        "/api/settings/keys/google_js/status",
        json={"ok": False, "detail": "gm_authFailure: InvalidKeyMapError"},
    )
    assert r.status_code == 200
    ids = {p["id"] for p in client.get("/api/satellite/providers").json()}
    assert "google-js" not in ids  # benched by the browser's verdict

    assert client.post(
        "/api/settings/keys/nope/status", json={"ok": True, "detail": ""}
    ).status_code == 404


def test_per_provider_eco_thresholds(client):
    """Each tile API gets its own eco threshold; the widget is not tunable
    (an eco swap re-bills a map load) and unknown names are ignored."""
    client.put("/api/settings/keys", json={"mapbox": "pk.x", "sentinelhub": "inst", "google_js": "AIza.js"})
    r = client.put(
        "/api/settings/prefs",
        json={"eco_max_zooms": {"mapbox": 12, "sentinelhub": 0, "google_js": 9, "bogus": 3}},
    ).json()
    assert r["eco_max_zooms"] == {"mapbox": 12, "sentinelhub": 0}

    by_id = {p["id"]: p for p in client.get("/api/satellite/providers").json()}
    assert by_id["mapbox-satellite"]["eco_max_zoom"] == 12  # user override
    assert by_id["sentinel2"]["eco_max_zoom"] == 0  # user turned eco off for it
    assert by_id["google-js"]["eco_max_zoom"] == 0  # pinned, not settable

    # None removes the override: sentinel2 falls back to its own default (11)
    r = client.put("/api/settings/prefs", json={"eco_max_zooms": {"sentinelhub": None}}).json()
    assert r["eco_max_zooms"] == {"mapbox": 12}
    by_id = {p["id"]: p for p in client.get("/api/satellite/providers").json()}
    assert by_id["sentinel2"]["eco_max_zoom"] == 11


def test_providers_expose_tile_size(client):
    client.put("/api/settings/keys", json={"mapbox": "pk.abc", "google": "AIza.x"})
    providers = {p["id"]: p for p in client.get("/api/satellite/providers").json()}
    assert providers["esri-world-imagery"]["tile_size"] == 256
    assert providers["esri-world-imagery"]["oversample"] == 1
    assert providers["mapbox-satellite"]["tile_size"] == 512  # 4× cheaper, same m/px
    assert providers["mapbox-satellite"]["oversample"] == 1  # its @2x is upsampled — no gain
    assert providers["google-satellite"]["tile_size"] == 1024  # hi-DPI 4x session
    # the live map shows Google one zoom deeper (mid-zoom mosaics are soft)
    assert providers["google-satellite"]["oversample"] == 2


def test_put_prefs_eco_max_zoom_clamped(client):
    saved = client.put("/api/settings/prefs", json={"eco_max_zoom": 15}).json()
    assert saved["eco_max_zoom"] == 15
    assert client.get("/api/settings").json()["eco_max_zoom"] == 15
    assert client.put("/api/settings/prefs", json={"eco_max_zoom": 99}).json()["eco_max_zoom"] == 21
    assert client.put("/api/settings/prefs", json={"eco_max_zoom": -3}).json()["eco_max_zoom"] == 1


def test_display_prefs_default_and_round_trip(client):
    body = client.get("/api/settings").json()
    assert body["coord_format"] == "dd"
    assert body["units"] == "metric"
    assert body["post_target"] == "x"

    saved = client.put(
        "/api/settings/prefs",
        json={"coord_format": "mgrs", "units": "imperial", "post_target": "bluesky"},
    )
    assert saved.json()["coord_format"] == "mgrs"
    assert saved.json()["units"] == "imperial"
    assert saved.json()["post_target"] == "bluesky"
    reloaded = client.get("/api/settings").json()
    assert reloaded["coord_format"] == "mgrs"
    assert reloaded["units"] == "imperial"
    assert reloaded["post_target"] == "bluesky"


def test_display_prefs_reject_unknown_values(client):
    assert client.put("/api/settings/prefs", json={"coord_format": "utm"}).status_code == 422
    assert client.put("/api/settings/prefs", json={"units": "furlongs"}).status_code == 422
    assert client.put("/api/settings/prefs", json={"post_target": "threads"}).status_code == 422
    # a rejected value leaves the stored preference alone
    assert client.get("/api/settings").json()["coord_format"] == "dd"


def test_partial_prefs_put_leaves_other_fields_untouched(client):
    client.put("/api/settings/prefs", json={"coord_format": "dms", "units": "imperial"})
    saved = client.put("/api/settings/prefs", json={"eco_max_zoom": 12}).json()
    assert saved["coord_format"] == "dms"  # untouched by an unrelated PUT
    assert saved["units"] == "imperial"


def test_home_view_default_and_round_trip(client):
    assert client.get("/api/settings").json()["home_view"] == config.DEFAULT_SETTINGS["home_view"]

    view = {"lat": -33.8568, "lon": 151.2153, "zoom": 18}
    assert client.put("/api/settings/prefs", json={"home_view": view}).json()["home_view"] == view
    assert client.get("/api/settings").json()["home_view"] == view


def test_home_view_rejects_points_off_the_globe(client):
    bad = [
        {"lat": 91, "lon": 0, "zoom": 16},
        {"lat": 0, "lon": -181, "zoom": 16},
        {"lat": 0, "lon": 0, "zoom": 0},
        {"lat": 0, "lon": 0, "zoom": 30},
    ]
    for view in bad:
        assert client.put("/api/settings/prefs", json={"home_view": view}).status_code == 422
    assert client.get("/api/settings").json()["home_view"] == config.DEFAULT_SETTINGS["home_view"]


def test_about_facts_are_served(client):
    body = client.get("/api/settings").json()
    assert body["version"]
    assert body["workspace_root"] == str(config.workspace_root())


# ---- signature: the analyst's logo, app-wide and never inside a case ---------

# the smallest thing that is genuinely a PNG: the 8-byte magic is what the
# upload sniffs, so a body starting with it is accepted and nothing else is
PNG = config.PNG_MAGIC + b"\x00 fake body, never decoded"


def test_signature_absent_by_default(client):
    assert client.get("/api/settings").json()["signature"] is False
    assert client.get("/api/settings/signature.png").status_code == 404


def test_signature_upload_serve_and_delete(client):
    saved = client.post("/api/settings/signature", files={"file": ("logo.png", PNG, "image/png")})
    assert saved.status_code == 200
    assert saved.json() == {"signature": True}
    assert client.get("/api/settings").json()["signature"] is True

    served = client.get("/api/settings/signature.png")
    assert served.status_code == 200
    assert served.content == PNG
    assert served.headers["content-type"] == "image/png"

    assert client.delete("/api/settings/signature").json() == {"signature": False}
    assert client.get("/api/settings").json()["signature"] is False
    assert client.get("/api/settings/signature.png").status_code == 404


def test_signature_replace_overwrites_in_place(client):
    client.post("/api/settings/signature", files={"file": ("a.png", PNG, "image/png")})
    other = config.PNG_MAGIC + b"\x00 second logo"
    client.post("/api/settings/signature", files={"file": ("b.png", other, "image/png")})
    assert client.get("/api/settings/signature.png").content == other


def test_signature_delete_is_idempotent(client):
    assert client.delete("/api/settings/signature").json() == {"signature": False}


def test_signature_rejects_non_png(client):
    # the bytes are what count, not the name or the content-type the browser sent
    body = client.post("/api/settings/signature", files={"file": ("logo.png", b"GIF89a...", "image/png")})
    assert body.status_code == 422
    assert "PNG" in body.json()["detail"]
    assert client.get("/api/settings").json()["signature"] is False


def test_signature_rejects_oversized(client):
    huge = config.PNG_MAGIC + b"\x00" * config.SIGNATURE_MAX_BYTES
    body = client.post("/api/settings/signature", files={"file": ("logo.png", huge, "image/png")})
    assert body.status_code == 413
    assert client.get("/api/settings").json()["signature"] is False


def test_signature_never_lands_in_a_case(client):
    """It is workspace-level, like the API keys — a case folder never sees it."""
    client.post("/api/settings/signature", files={"file": ("logo.png", PNG, "image/png")})
    assert config.signature_path().is_file()
    assert config.signature_path().parent == config.workspace_root()
    case_id = client.post("/api/cases", json={"name": "Signed"}).json()["id"]
    case_dir = config.cases_dir() / case_id
    assert not list(case_dir.rglob("signature.png"))


# ---- scrapers: version reporting and the update button ----------------------


def test_get_scrapers_reports_both_offline(client, monkeypatch):
    """Opening Settings must not reach the network — local-first."""

    def explode(*a, **k):
        raise AssertionError("GET /settings/scrapers phoned home without check=true")

    monkeypatch.setattr(scrapers.httpx, "get", explode)
    body = client.get("/api/settings/scrapers").json()["scrapers"]
    assert {e["dist"] for e in body} == {"yt-dlp", "gallery-dl"}
    assert all(e["source"] == "bundled" and e["version"] for e in body)


def test_get_scrapers_check_reports_what_is_newer(client, monkeypatch):
    monkeypatch.setattr(scrapers, "latest_version", lambda dist: "9999.1.1")
    body = client.get("/api/settings/scrapers", params={"check": True}).json()["scrapers"]
    assert all(e["latest"] == "9999.1.1" and e["outdated"] is True for e in body)


def test_check_reports_up_to_date_when_it_matches(client, monkeypatch):
    current = scrapers.active_version("yt-dlp")[0]
    monkeypatch.setattr(scrapers, "latest_version", lambda dist: current)
    entry = next(
        e
        for e in client.get("/api/settings/scrapers", params={"check": True}).json()["scrapers"]
        if e["dist"] == "yt-dlp"
    )
    assert entry["outdated"] is False


def test_update_unknown_scraper_is_404(client):
    assert client.post("/api/settings/scrapers/pip/update").status_code == 404
    assert client.delete("/api/settings/scrapers/pip").status_code == 404


def test_update_reports_failure_inline_rather_than_500(client, monkeypatch):
    """A download that fails is a message in the tab, not a broken app."""

    def offline(*a, **k):
        raise OSError("no route to host")

    monkeypatch.setattr(scrapers.httpx, "get", offline)
    body = client.post("/api/settings/scrapers/yt-dlp/update").json()
    assert body["ok"] is False
    assert "no route to host" in body["detail"]


def test_update_then_reset_round_trip(client, monkeypatch):
    monkeypatch.setattr(
        scrapers,
        "update",
        lambda dist: {
            "dist": dist,
            "updated": True,
            "version": "3.2.1",
            "previous": "1.0.0",
            "restart_required": True,
            "detail": "updated to 3.2.1 — restart Azimut to use it",
        },
    )
    body = client.post("/api/settings/scrapers/yt-dlp/update").json()
    assert body["ok"] is True and body["restart_required"] is True

    reset = client.delete("/api/settings/scrapers/yt-dlp").json()
    assert reset["ok"] is True and reset["removed"] is False


def test_scrapers_live_in_the_workspace_not_the_install(client):
    """The runtime dir has to be somewhere writable — the binary's own dir isn't."""
    assert config.runtime_dir().parent == config.workspace_root()
