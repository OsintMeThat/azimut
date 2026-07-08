"""Satellite capture API: bearing is honored and persisted with provenance."""

from PIL import Image

from ozimut.engine import tiles


def _fake_tile(client, url):  # offline: every tile is a solid green square
    return Image.new("RGB", (256, 256), (10, 120, 10))


def test_capture_persists_bearing(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]

    result = client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 48.8584, "lon": 2.2945, "zoom": 16,
              "width": 640, "height": 480, "bearing": 90},
    ).json()
    assert result["bearing"] == 90.0

    listed = client.get(f"/api/cases/{cid}/satellite").json()
    assert len(listed) == 1
    assert listed[0]["bearing"] == 90.0


def test_capture_defaults_to_north(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "Sat"}).json()["id"]

    result = client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 48.8584, "lon": 2.2945, "zoom": 16, "width": 512, "height": 512},
    ).json()
    assert result["bearing"] == 0.0
