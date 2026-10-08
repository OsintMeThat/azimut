"""Reading a tilted map's turn ahead: tiles fetched into the disk caches first."""

import io
import threading

import httpx
import numpy as np
import pytest
from PIL import Image

from azimut import config
from azimut.api import satellite
from azimut.engine import terrain, tilecache, tiles, tilewarm


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (256, 256), (40, 90, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def upstream(monkeypatch):
    """Every imagery and terrain request answered locally, and listed."""
    asked: list[str] = []
    lock = threading.Lock()

    def handler(request: httpx.Request) -> httpx.Response:
        with lock:
            asked.append(str(request.url))
        if "mapterhorn" in request.url.host:
            content = terrain.encode(np.full((terrain.TILE, terrain.TILE), 120.0, dtype=np.float32))
            return httpx.Response(200, content=content, headers={"content-type": "image/png"})
        return httpx.Response(200, content=_png(), headers={"content-type": "image/png"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(satellite, "_tile_client", httpx.Client(transport=transport))
    monkeypatch.setattr(terrain, "_client_instance", httpx.Client(transport=transport))
    terrain.forget_decoded()
    yield asked
    terrain.forget_decoded()


def test_a_newer_list_drops_what_the_older_one_had_left():
    gate = threading.Event()
    ran: list[str] = []
    warmer = tilewarm.Warmer(workers=1)
    # the one worker is held on the first job while both lists are queued
    warmer.replace([gate.wait, *[lambda n=n: ran.append(f"old{n}") for n in range(5)]])
    warmer.replace([lambda n=n: ran.append(f"new{n}") for n in range(3)])
    gate.set()
    assert warmer.wait(timeout=5)
    assert ran == ["new0", "new1", "new2"]


def test_a_failing_job_does_not_stop_the_rest():
    ran: list[int] = []

    def boom():
        raise RuntimeError("upstream refused")

    warmer = tilewarm.Warmer(workers=1)
    warmer.replace([boom, lambda: ran.append(1)])
    assert warmer.wait(timeout=5)
    assert ran == [1]


def test_warm_fills_the_imagery_and_terrain_caches(client, upstream):
    answer = client.post("/api/tiles/warm", json={
        "provider": "esri-world-imagery",
        "tiles": [[14, 10200, 7300], [14, 10201, 7300]],
        "terrain": [[10, 650, 450]],
    })
    assert answer.status_code == 200
    assert answer.json() == {"queued": 3}
    assert satellite._warmer.wait(timeout=10)
    assert tilecache.get("esri-world-imagery", 14, 10200, 7300) is not None
    assert tilecache.get("esri-world-imagery", 14, 10201, 7300) is not None
    assert (config.terrain_cache_dir() / "mapterhorn" / "10" / "650_450.webp").is_file()
    # the map's own request for the tile is now a disk read
    before = len(upstream)
    assert client.get("/api/tiles/esri-world-imagery/14/10200/7300").status_code == 200
    assert len(upstream) == before


def test_a_tile_already_on_disk_is_not_fetched_again(client, upstream):
    tilecache.put("esri-world-imagery", 14, 10200, 7300, _png(), "image/png")
    client.post("/api/tiles/warm", json={
        "provider": "esri-world-imagery", "tiles": [[14, 10200, 7300]],
    })
    assert satellite._warmer.wait(timeout=10)
    assert upstream == []


def test_a_billed_provider_is_never_read_ahead(client, upstream):
    client.put("/api/settings/keys", json={"mapbox": "pk.test"})
    provider = tiles.get_provider("mapbox-satellite")
    assert provider.meter  # the premise: a provider that counts tiles
    answer = client.post("/api/tiles/warm", json={
        "provider": "mapbox-satellite", "tiles": [[14, 10200, 7300]],
    })
    assert answer.json() == {"queued": 0}
    assert satellite._warmer.wait(timeout=10)
    assert upstream == []


def test_tiles_off_the_grid_are_dropped_not_fetched(client, upstream):
    answer = client.post("/api/tiles/warm", json={
        "provider": "esri-world-imagery",
        "tiles": [[3, 8, 0], [3, 0, -1], [40, 0, 0]],
        "terrain": [[13, 0, 0], [2, 4, 0]],
    })
    assert answer.json() == {"queued": 0}
    assert upstream == []


def test_a_list_is_bounded(client):
    too_many = [[14, 10200, 7300]] * (satellite.WARM_MAX_TILES + 1)
    answer = client.post("/api/tiles/warm", json={"provider": "esri-world-imagery", "tiles": too_many})
    assert answer.status_code == 422


def test_an_unknown_provider_is_a_404(client, upstream):
    answer = client.post("/api/tiles/warm", json={"provider": "nope", "tiles": [[1, 0, 0]]})
    assert answer.status_code == 404


def test_nothing_is_warmed_without_being_asked(client, upstream):
    # the map's own start reaches no tile server: warming is a reply to a view
    client.get("/api/satellite/providers")
    client.get("/api/terrain/sources")
    assert upstream == []


def test_a_known_terrain_tile_is_not_fetched_again(client, upstream):
    client.post("/api/tiles/warm", json={"terrain": [[10, 650, 450]]})
    assert satellite._warmer.wait(timeout=10)
    first = len(upstream)
    assert first == 1
    terrain.forget_decoded()
    client.post("/api/tiles/warm", json={"terrain": [[10, 650, 450]]})
    assert satellite._warmer.wait(timeout=10)
    assert len(upstream) == first


def test_the_cache_answers_whether_it_holds_a_tile_without_reading_it():
    assert not tilecache.has("esri-world-imagery", 3, 1, 1)
    tilecache.put("esri-world-imagery", 3, 1, 1, _png(), "image/png")
    assert tilecache.has("esri-world-imagery", 3, 1, 1)
