"""Forward geocoding (/api/geo/geocode): Nominatim behind a mock, never the network."""

import pytest

from azimut.engine import geo


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _fake_get(payload):
    calls = {}

    def fake(url, params=None, headers=None, timeout=None):
        calls["url"] = url
        calls["params"] = params
        calls["headers"] = headers
        return _FakeResponse(payload)

    return fake, calls


def test_geocode_returns_top_match(client, monkeypatch):
    fake, calls = _fake_get(
        [{"lat": "48.8584", "lon": "2.2945", "display_name": "Tour Eiffel, Paris, France"}]
    )
    monkeypatch.setattr(geo.httpx, "get", fake)

    result = client.get("/api/geo/geocode", params={"q": "tour eiffel"}).json()
    assert result["lat"] == 48.8584
    assert result["lon"] == 2.2945
    assert result["display_name"] == "Tour Eiffel, Paris, France"
    assert "OpenStreetMap" in result["attribution"]
    # polite Nominatim usage: identified UA, single result requested
    assert calls["params"]["q"] == "tour eiffel"
    assert calls["params"]["limit"] == 1
    assert calls["headers"]["User-Agent"]


def test_geocode_no_match_is_404(client, monkeypatch):
    fake, _ = _fake_get([])
    monkeypatch.setattr(geo.httpx, "get", fake)
    response = client.get("/api/geo/geocode", params={"q": "zzzz nowhere zzzz"})
    assert response.status_code == 404


def test_geocode_empty_query_is_422(client):
    response = client.get("/api/geo/geocode", params={"q": "   "})
    assert response.status_code == 422


def test_geocode_network_failure_is_404(client, monkeypatch):
    def boom(*args, **kwargs):
        raise OSError("network down")

    monkeypatch.setattr(geo.httpx, "get", boom)
    # engine swallows the error (best-effort) → API reports no match
    response = client.get("/api/geo/geocode", params={"q": "paris"})
    assert response.status_code == 404


# -- /api/geo/parse: pure offline conversion, no network -------------------------------


def test_parse_returns_every_format_and_the_map_links(client):
    result = client.post("/api/geo/parse", json={"text": "48.8583701, 2.2944813"}).json()
    assert result["lat"] == pytest.approx(48.8583701)
    assert result["lon"] == pytest.approx(2.2944813)
    # flat keys the Post Composer reads by name stay in place
    assert result["dms"].endswith('E')
    assert "+" in result["plus_code"]
    # the ordered list the Coordinates tool renders
    assert [f["id"] for f in result["formats"]] == [
        "dd", "ddm", "dms", "utm", "mgrs", "plus_code", "geohash",
    ]
    # all nine external maps, keyed by site
    assert set(result["links"]) >= {"google", "yandex", "bing", "sentinel"}


def test_parse_accepts_the_formats_it_emits(client):
    for text in ("31U 448251 5411952", "u09tunqu9", "48°51.502'N 2°17.669'E"):
        response = client.post("/api/geo/parse", json={"text": text})
        assert response.status_code == 200, text
        body = response.json()
        assert body["lat"] == pytest.approx(48.858, abs=1e-2)
        assert body["lon"] == pytest.approx(2.294, abs=1e-2)


def test_parse_rejects_gibberish_with_422(client):
    assert client.post("/api/geo/parse", json={"text": "hello world"}).status_code == 422
