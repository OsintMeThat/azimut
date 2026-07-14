"""Settings API: API keys management, key tests, usage counters (all offline)."""

import httpx

from azimut import config
from azimut.engine import google_tiles


def test_get_settings_defaults(client):
    body = client.get("/api/settings").json()
    assert body["api_keys"] == {}
    assert body["usage"] == {}
    assert body["month"] == config.month_key()


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


def test_tile_proxy_serves_and_counts_exactly(client, monkeypatch):
    client.put("/api/settings/keys", json={"mapbox": "pk.abc"})
    upstream = _upstream(headers={"cache-control": "max-age=43200"})
    monkeypatch.setattr(httpx, "get", upstream)

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
    monkeypatch.setattr(httpx, "get", _upstream(status=404, content=b""))
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

    monkeypatch.setattr(httpx, "get", get)
    r = client.get("/api/tiles/google-satellite/15/16597/11278")
    assert r.status_code == 200
    assert r.content == b"TILE"
    assert invalidated == ["AIza.x"]
    body = client.get("/api/settings").json()
    assert body["usage"]["google"][body["month"]] == 1  # the retry isn't double-counted


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


def test_providers_expose_tile_size(client):
    client.put("/api/settings/keys", json={"mapbox": "pk.abc"})
    providers = {p["id"]: p for p in client.get("/api/satellite/providers").json()}
    assert providers["esri-world-imagery"]["tile_size"] == 256
    assert providers["mapbox-satellite"]["tile_size"] == 512  # 4× cheaper, same m/px
