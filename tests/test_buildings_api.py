"""The buildings routes: checked at the edge, and nothing read until a view asks."""

from __future__ import annotations

import struct

import pytest

from azimut.engine.buildings import model, service, wire

LAT, LON = 45.7578, 4.8320
KEY = model.tile_of(LAT, LON)


@pytest.fixture
def stubbed(monkeypatch):
    """The service answering from one tile with one IGN building, no network."""
    ring = ((LON - 0.0001, LAT - 0.0001), (LON + 0.0001, LAT - 0.0001), (LON + 0.0001, LAT + 0.0001))
    building = model.Building(rings=(ring,), height=12.0, kind="measured", source="ign", date="2024-01-02")
    asked = []

    def status(lat, lon, radius, sources):
        asked.append(("status", lat, lon, radius, sources))
        return {"tiles": [{"key": "14/1/2", "ready": True, "version": "v"}], "pending": 0}

    def tile_bytes(keys, sources):
        asked.append(("tiles", keys, sources))
        return {key: (wire.encode(*key, [building]) if key == KEY else None) for key in keys}

    monkeypatch.setattr(service, "status", status)
    monkeypatch.setattr(service, "tile_bytes", tile_bytes)
    monkeypatch.setattr(service, "allow", lambda names: [n for n in names if n.endswith(".zip")])
    monkeypatch.setattr(service, "building_at", lambda lat, lon, sources: {"height": 12.0} if lat == LAT else None)
    monkeypatch.setattr(service, "clear", lambda: 1234)
    return asked


def test_the_area_is_asked_with_its_sources_checked(client, stubbed):
    response = client.get("/api/horizon/buildings", params={"lat": LAT, "lon": LON, "radius": 2000, "sources": "ign,osm"})
    assert response.status_code == 200
    assert stubbed == [("status", LAT, LON, 2000.0, ["ign", "osm"])]
    assert client.get("/api/horizon/buildings", params={"lat": LAT, "lon": LON, "radius": 2000, "sources": "obm"}).status_code == 422


@pytest.mark.parametrize("radius", [50, 20_000])
def test_the_radius_is_bounded(client, stubbed, radius):
    assert client.get("/api/horizon/buildings", params={"lat": LAT, "lon": LON, "radius": radius}).status_code == 422


def test_tiles_come_length_first_with_nothing_for_one_not_ready(client, stubbed):
    other = (14, KEY[1] + 1, KEY[2])
    t = f"{'/'.join(map(str, KEY))},{'/'.join(map(str, other))}"
    body = client.get("/api/horizon/buildings/tiles", params={"t": t}).content
    (first,) = struct.unpack_from("<I", body, 0)
    assert wire.decode(body[4:4 + first], *KEY)[0].height == 12.0
    assert struct.unpack_from("<I", body, 4 + first) == (0,)


def test_only_zoom_fourteen_tiles_are_served(client, stubbed):
    assert client.get("/api/horizon/buildings/tiles", params={"t": "13/1/2"}).status_code == 422


def test_a_download_starts_only_when_asked_for(client, stubbed):
    response = client.post("/api/horizon/buildings/allow", json={"grids": ["1_a.zip", "nonsense"]})
    assert response.json() == {"started": ["1_a.zip"]}
    assert client.post("/api/horizon/buildings/allow", json={"grids": []}).status_code == 422


def test_the_building_under_a_point_or_a_plain_not_found(client, stubbed):
    assert client.get("/api/horizon/buildings/at", params={"lat": LAT, "lon": LON}).json() == {"height": 12.0}
    missing = client.get("/api/horizon/buildings/at", params={"lat": 10.0, "lon": LON})
    assert missing.status_code == 404 and missing.json()["detail"] == "No building is drawn here"


def test_the_cache_can_be_cleared(client, stubbed):
    assert client.delete("/api/horizon/buildings/cache").json() == {"freed": 1234}
