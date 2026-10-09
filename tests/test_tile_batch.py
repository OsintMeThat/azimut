"""Many map tiles in one answer: what a tilted map asks of the app (api/tile_batch.py)."""

import struct
import threading
import time

import pytest
from fastapi import HTTPException
from fastapi.responses import Response

from azimut.api import satellite, tile_batch
from azimut.engine import terrain


def _frames(body):
    """`{index: (status, bytes)}` from a batch answer, and the order they came in."""
    out, order, at = {}, [], 0
    while at < len(body):
        index, status, size = struct.unpack_from("<HHI", body, at)
        at += 8
        out[index] = (status, body[at:at + size])
        order.append(index)
        at += size
    return out, order


class _Served:
    """Stands for the map's own tile route: what each tile answers, and what was asked."""

    def __init__(self, held):
        self.held, self.calls = held, []

    def __call__(self, provider, z, x, y):
        self.calls.append((provider.id, z, x, y))
        if (z, x, y) not in self.held:
            raise HTTPException(status_code=404, detail="no imagery at this location/zoom")
        status, body = self.held[(z, x, y)]
        return Response(content=body, status_code=status, media_type="image/png")


def test_imagery_tiles_come_in_one_answer_each_as_its_own_route_would_serve_it(client, monkeypatch):
    served = _Served({(5, 3, 4): (200, b"second!"), (5, 1, 2): (200, b"first"), (5, 2, 2): (429, b"paused")})
    monkeypatch.setattr(satellite, "serve_tile", served)
    answer = client.get("/api/tiles/batch/esri-world-imagery", params={"t": "5/3/4,5/9/9,5/1/2,5/2/2"})
    assert answer.status_code == 200
    assert answer.headers["content-type"] == "application/octet-stream"
    assert answer.headers["cache-control"] == "no-store"
    tiles, _ = _frames(answer.content)
    assert tiles == {
        0: (200, b"second!"),
        1: (404, b"no imagery at this location/zoom"),
        2: (200, b"first"),
        3: (429, b"paused"),
    }
    assert sorted(served.calls) == sorted(
        ("esri-world-imagery", *key) for key in [(5, 3, 4), (5, 9, 9), (5, 1, 2), (5, 2, 2)]
    )


def test_a_slow_tile_holds_up_none_of_the_others(client, monkeypatch):
    fast_done = threading.Event()

    def serve(provider, z, x, y):
        if x == 0:
            # the slow one finishes well after the fast one
            fast_done.wait(timeout=5)
            time.sleep(0.2)
            return Response(content=b"slow")
        fast_done.set()
        return Response(content=b"fast")

    monkeypatch.setattr(satellite, "serve_tile", serve)
    answer = client.get("/api/tiles/batch/esri-world-imagery", params={"t": "4/0/0,4/1/0"})
    tiles, order = _frames(answer.content)
    assert order == [1, 0]
    assert tiles == {0: (200, b"slow"), 1: (200, b"fast")}


def test_terrain_tiles_come_in_one_answer_the_sea_as_a_flat_tile(client, monkeypatch):
    def tile(z, x, y):
        if x == 1:
            raise terrain.TerrainUnavailable("offline")
        if x == 2:
            return None
        return b"relief", "image/webp", ""

    monkeypatch.setattr(terrain, "tile", tile)
    answer = client.get("/api/terrain/batch", params={"t": "6/0/1,6/1/1,6/2/1"})
    assert answer.status_code == 200
    tiles, _ = _frames(answer.content)
    assert tiles[0] == (200, b"relief")
    assert tiles[1][0] == 502
    assert b"Terrain could not be loaded" in tiles[1][1]
    assert tiles[2] == (200, terrain.sea_tile())


def test_a_tile_that_breaks_is_a_failed_tile_not_a_failed_answer(client, monkeypatch):
    def serve(provider, z, x, y):
        if x == 1:
            raise RuntimeError("boom")
        return Response(content=b"ok")

    monkeypatch.setattr(satellite, "serve_tile", serve)
    answer = client.get("/api/tiles/batch/esri-world-imagery", params={"t": "3/0/0,3/1/0"})
    tiles, _ = _frames(answer.content)
    assert tiles[0] == (200, b"ok")
    assert tiles[1][0] == 500
    # the reason says what happened to the tile, never the exception's own text
    assert b"boom" not in tiles[1][1]


@pytest.mark.parametrize("t", [
    "", "5/1", "a/b/c", "5/1/2,", "5/-1/2", "3/8/0", "3/0/8", "5/1/2 ", "123/0/0",
])
def test_a_bad_batch_is_refused_at_the_edge(client, monkeypatch, t):
    monkeypatch.setattr(satellite, "serve_tile", lambda *a: pytest.fail("nothing is fetched"))
    monkeypatch.setattr(terrain, "tile", lambda *a: pytest.fail("nothing is fetched"))
    assert client.get("/api/tiles/batch/esri-world-imagery", params={"t": t}).status_code == 422
    assert client.get("/api/terrain/batch", params={"t": t}).status_code == 422


def test_a_batch_stops_at_the_provider_and_relief_ceilings(client, monkeypatch):
    monkeypatch.setattr(satellite, "serve_tile", lambda *a: pytest.fail("nothing is fetched"))
    monkeypatch.setattr(terrain, "tile", lambda *a: pytest.fail("nothing is fetched"))
    deep = f"{terrain.PLANET_ZOOM + 1}/0/0"
    assert client.get("/api/terrain/batch", params={"t": deep}).status_code == 422
    assert client.get("/api/tiles/batch/esri-world-imagery", params={"t": "23/0/0"}).status_code == 422


def test_a_batch_has_a_size_limit_and_names_a_real_provider(client, monkeypatch):
    monkeypatch.setattr(satellite, "serve_tile", lambda *a: Response(content=b"x"))
    ok = ",".join(f"8/{i}/0" for i in range(tile_batch.BATCH_MAX))
    assert len(ok) <= tile_batch.QUERY_MAX
    assert client.get("/api/tiles/batch/esri-world-imagery", params={"t": ok}).status_code == 200
    too_many = ok + ",8/99/0"
    assert client.get("/api/tiles/batch/esri-world-imagery", params={"t": too_many}).status_code == 422
    assert client.get("/api/tiles/batch/no-such-provider", params={"t": "1/0/0"}).status_code == 404


def test_the_tiles_not_started_are_dropped_when_the_map_stops_reading():
    release = threading.Event()
    started = []
    lock = threading.Lock()

    def one(z, x, y):
        with lock:
            started.append(x)
        if x:
            release.wait(timeout=5)
        return 200, b"t"

    keys = [(10, x, 0) for x in range(tile_batch.BATCH_MAX)]
    written = tile_batch.frames(keys, one)
    try:
        # the first tile is written; the pool's other workers are busy and the
        # rest of the batch is queued behind them when the map moves on
        assert struct.unpack_from("<H", next(written))[0] == 0
        written.close()
        dropped_at = len(started)
    finally:
        release.set()
    time.sleep(0.3)
    assert dropped_at < len(keys)
    assert len(started) == dropped_at
