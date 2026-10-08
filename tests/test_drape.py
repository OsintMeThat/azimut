"""The ground's imagery laid over a panorama, level by level."""

import base64
import io

import numpy as np
import pytest
from PIL import Image

from azimut.engine import drape, terrain
from fakerelief import Peak, Relief, offset

EYE = (45.0, 6.0)
PEAK = Peak(*offset(*EYE, 90.0, 15_000.0), height=2500.0, radius=1500.0)


def _tile_of_level(level):
    """Every pixel of a tile says the level it came from, in its red channel."""
    tile = np.zeros((drape.TILE, drape.TILE, 3), dtype=np.uint8)
    tile[..., 0] = level * 10
    return tile


def test_near_ground_reads_a_finer_level_than_far_ground():
    asked = []

    def fetch(z, x, y):
        asked.append(z)
        return _tile_of_level(z)

    lat = np.array([45.0, 45.0, 45.0])
    lon = np.array([6.001, 6.1, 7.0])
    footprint = np.array([1.0, 30.0, 300.0])
    colours, used = drape.drape(lat, lon, footprint, fetch, ceiling=19)
    levels = colours[:, 0] // 10
    assert levels[0] > levels[1] > levels[2]
    assert used == set(int(v) for v in levels)


def test_a_level_with_no_picture_hands_its_pixels_up():
    def fetch(z, x, y):
        return None if z > 12 else _tile_of_level(z)

    colours, used = drape.drape(np.array([45.0]), np.array([6.0]), np.array([0.5]), fetch, ceiling=19)
    assert colours[0, 0] == 120
    assert used == {12}


def test_nothing_anywhere_is_rock_grey_not_a_hole():
    colours, used = drape.drape(np.array([45.0]), np.array([6.0]), np.array([5.0]), lambda z, x, y: None, 19)
    assert tuple(colours[0]) == drape.NO_IMAGE
    assert used == set()


def test_a_wide_view_is_coarsened_rather_than_reading_too_many_tiles(monkeypatch):
    monkeypatch.setattr(drape, "MAX_TILES", 20)
    asked = set()

    def fetch(z, x, y):
        asked.add((z, x, y))
        return _tile_of_level(z)

    rng = np.random.default_rng(1)
    lat, lon = terrain.destination(45.0, 6.0, rng.uniform(0, 360, 3000), rng.uniform(100, 20000, 3000))
    footprint = np.full(3000, 2.0)
    drape.drape(np.asarray(lat), np.asarray(lon), footprint, fetch, 19)
    assert len(asked) <= 20


@pytest.fixture
def synthetic_relief(monkeypatch):
    terrain.forget_decoded()
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(PEAK,)))
    yield
    terrain.forget_decoded()


def _green_tiles(monkeypatch):
    from azimut.api import satellite

    asked = []
    buffer = io.BytesIO()
    Image.new("RGB", (256, 256), (30, 160, 40)).save(buffer, format="PNG")

    def serve(provider, z, x, y):
        asked.append((provider.id, z, x, y))
        return buffer.getvalue(), "image/png", {}

    monkeypatch.setattr(satellite, "_serve_tile", serve)
    return asked


def test_the_drape_lies_on_the_picture_just_drawn(client, synthetic_relief, monkeypatch):
    from azimut.engine import horizon

    asked = _green_tiles(monkeypatch)
    grid = {"lat": EYE[0], "lon": EYE[1], "step": 1.0, "far": 30_000, "top": 12, "bottom": -10}
    picture = client.post("/api/horizon/panorama", json=grid).json()
    sweeps = []
    real = horizon.sweep
    monkeypatch.setattr(horizon, "sweep", lambda *a, **k: sweeps.append(1) or real(*a, **k))
    answer = client.post("/api/horizon/drape", json={**grid, "provider": "esri-world-imagery"})
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert sweeps == []  # the distances were the picture's own
    assert (body["width"], body["height"]) == (picture["azimuth"]["count"], picture["elevation"]["count"])
    image = np.asarray(Image.open(io.BytesIO(base64.b64decode(body["image"]))).convert("RGB"))
    assert image.shape == (body["height"], body["width"], 3)
    # the ground is green, and so is the sky over it, which the view never draws
    # but a blend across the skyline would otherwise darken
    assert image[-1].mean(axis=0)[1] > 120
    assert image[0].mean(axis=0)[1] > 120
    assert asked and all(provider == "esri-world-imagery" for provider, *_ in asked)
    assert body["credits"][0]["label"] == "Esri World Imagery"


def test_a_drape_with_no_picture_kept_draws_one(client, synthetic_relief, monkeypatch):
    _green_tiles(monkeypatch)
    answer = client.post("/api/horizon/drape", json={
        "lat": EYE[0], "lon": EYE[1], "step": 1.0, "far": 20_000, "top": 8, "bottom": -5,
        "provider": "esri-world-imagery",
    })
    assert answer.status_code == 200


def test_a_billed_provider_is_never_laid_over_a_view(client, synthetic_relief, monkeypatch):
    asked = _green_tiles(monkeypatch)
    client.put("/api/settings/keys", json={"mapbox": "pk.test"})
    answer = client.post("/api/horizon/drape", json={
        "lat": EYE[0], "lon": EYE[1], "step": 1.0, "provider": "mapbox-satellite",
    })
    assert answer.status_code == 422
    assert asked == []
    street = client.post("/api/horizon/drape", json={
        "lat": EYE[0], "lon": EYE[1], "step": 1.0, "provider": "osm",
    })
    assert street.status_code == 422


def test_ground_close_to_the_eye_is_blended_not_blocky():
    # a tile whose left half is black and right half white: a point on the seam is grey
    tile = np.zeros((drape.TILE, drape.TILE, 3), dtype=np.uint8)
    tile[:, 128:] = 255
    seam = drape._blend(tile.astype(np.float32), np.array([127.5]), np.array([10.0]))
    assert 100 < int(seam[0, 0]) < 160
    inside = drape._blend(tile.astype(np.float32), np.array([200.0, 20.0]), np.array([10.0, 10.0]))
    assert inside[0, 0] == 255 and inside[1, 0] == 0


def test_a_dated_wayback_release_is_laid_over_a_view(client, synthetic_relief, monkeypatch):
    from azimut.engine import wayback

    monkeypatch.setattr(wayback, "releases", lambda **_: [wayback.Release(64776, "2021-06-30", None)])
    asked = _green_tiles(monkeypatch)
    answer = client.post("/api/horizon/drape", json={
        "lat": EYE[0], "lon": EYE[1], "step": 1.0, "far": 20_000, "top": 8, "bottom": -5,
        "provider": "esri-wayback~64776",
    })
    assert answer.status_code == 200, answer.text
    assert {provider for provider, *_ in asked} == {"esri-wayback~64776"}
    assert "2021-06-30" in answer.json()["credits"][0]["label"]


# -- Sentinel-2 on the near ground -------------------------------------------------

S2 = "sentinel2~TRUE_COLOR~2026-09-01~2026-09-01~CC30"
NEAR_GRID = {"lat": EYE[0], "lon": EYE[1], "step": 1.0, "far": 30_000, "top": 12, "bottom": -10}


def _two_providers(monkeypatch):
    """Sentinel-2 answers red 512 px tiles, everything else green 256 px ones."""
    from azimut.api import satellite

    asked = []

    def png(size, colour):
        buffer = io.BytesIO()
        Image.new("RGB", (size, size), colour).save(buffer, format="PNG")
        return buffer.getvalue()

    red, green = png(512, (200, 30, 30)), png(256, (30, 160, 40))

    def serve(provider, z, x, y):
        asked.append((provider.id, z, x, y))
        return (red if provider.id.startswith("sentinel2") else green), "image/png", {}

    monkeypatch.setattr(satellite, "_serve_tile", serve)
    return asked


@pytest.fixture
def copernicus_key(client):
    client.put("/api/settings/keys", json={"sentinelhub": "11111111-2222-3333-4444-555555555555"})


def test_sentinel_2_is_laid_on_the_near_ground_only_and_esri_beyond(client, synthetic_relief, copernicus_key, monkeypatch):
    asked = _two_providers(monkeypatch)
    client.post("/api/horizon/panorama", json=NEAR_GRID)
    answer = client.post("/api/horizon/drape", json={
        **NEAR_GRID, "provider": "esri-world-imagery", "near_provider": S2, "near_reach": 5_000,
    })
    assert answer.status_code == 200, answer.text
    body = answer.json()
    image = np.asarray(Image.open(io.BytesIO(base64.b64decode(body["image"]))).convert("RGB")).astype(int)
    # the bottom row looks at the ground a few hundred metres off: Sentinel-2's red
    assert image[-1].mean(axis=0)[0] > 150
    # the peak 15 km east is Esri's green
    column = image[:, 90]
    peak_rows = [row for row in column if row.sum() > 0]
    assert any(row[1] > 120 and row[0] < 80 for row in peak_rows)
    s2 = [entry for entry in asked if entry[0].startswith("sentinel2")]
    assert s2 and len(s2) < 40  # a few tiles near the eye, never the turn's hundreds
    assert body["near_provider"] == S2
    labels = [credit["label"] for credit in body["credits"]]
    # the near picture is credited first, with the very rendering and day it was laid from
    assert labels[0].startswith("Sentinel-2 (Copernicus)") and "2026-09-01" in labels[0]
    assert labels[1] == "Esri World Imagery"


def test_the_estimate_counts_the_sentinel_tiles_not_on_disk_and_fetches_none(client, synthetic_relief, copernicus_key, monkeypatch):
    from azimut.engine import tilecache

    asked = _two_providers(monkeypatch)
    client.post("/api/horizon/panorama", json=NEAR_GRID)
    ask = {**NEAR_GRID, "provider": "esri-world-imagery", "near_provider": S2}
    near = client.post("/api/horizon/drape/estimate", json={**ask, "near_reach": 2_000}).json()
    far = client.post("/api/horizon/drape/estimate", json={**ask, "near_reach": 20_000}).json()
    assert 0 < near["requests"] <= far["requests"]
    assert asked == []
    monkeypatch.setattr(tilecache, "has", lambda *_args: True)
    cached = client.post("/api/horizon/drape/estimate", json={**ask, "near_reach": 20_000}).json()
    assert cached == {"requests": 0, "tiles": far["tiles"]}
    assert client.post("/api/horizon/drape/estimate", json={**NEAR_GRID}).json() == {"requests": 0, "tiles": 0}


def test_only_sentinel_2_within_reach_and_with_a_key_is_laid_near(client, synthetic_relief, monkeypatch):
    from azimut import config

    asked = _two_providers(monkeypatch)
    base = {**NEAR_GRID, "provider": "esri-world-imagery"}
    # no key: said, with where to set it
    missing = client.post("/api/horizon/drape", json={**base, "near_provider": S2})
    assert missing.status_code == 404
    assert "Copernicus" in missing.json()["detail"]
    client.put("/api/settings/keys", json={"sentinelhub": "11111111-2222-3333-4444-555555555555"})
    assert client.post("/api/horizon/drape", json={**base, "near_provider": "mapbox-satellite"}).status_code == 422
    assert client.post("/api/horizon/drape", json={**base, "near_provider": S2, "near_reach": 80_000}).status_code == 422
    monkeypatch.setattr(config, "usage_blocked", lambda *_args, **_kw: True)
    paused = client.post("/api/horizon/drape", json={**base, "near_provider": S2})
    assert paused.status_code == 429
    assert asked == []
