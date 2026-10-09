"""Named summits from OpenFreeMap's tiles: the rings, the cache, the waits, the route."""

import json
import os
import re
import threading
import time

import numpy as np
import pytest

from azimut.engine import mvt, peaks, terrain, tiles
from fakerelief import Relief, offset

EYE = (46.55, 7.9)
TEMPLATE = "https://tiles.openfreemap.org/planet/20261004_test/{z}/{x}/{y}.pbf"
_TILE = re.compile(r"/(\d+)/(\d+)/(\d+)\.pbf$")


@pytest.fixture(autouse=True)
def fresh_tiles():
    """No test inherits another's tiles in flight, failures or build address."""
    peaks.wait_idle()
    peaks.forget()
    yield
    peaks.wait_idle()
    peaks.forget()


def _summit(name, lat, lon, ele=None, kind="peak", **tags):
    return {"name": name, "class": kind, "lat": lat, "lon": lon,
            **({"ele": ele} if ele is not None else {}), **tags}


def _tile(z, x, y, summits):
    """A tile as OpenFreeMap writes one: a layer to step over, then the summits,
    with those just past its edge in its buffer as a tile server keeps them."""
    place = mvt.Layer("place")
    place.points(np.array([10]), np.array([10]), {"name": "Grindelwald", "class": "village"})
    layer = mvt.Layer(peaks.LAYER)
    for summit in summits:
        fx, fy = tiles.project(summit["lat"], summit["lon"], z)
        px, py = round((fx - x) * mvt.EXTENT), round((fy - y) * mvt.EXTENT)
        if -64 <= px < mvt.EXTENT + 64 and -64 <= py < mvt.EXTENT + 64:
            tags = {k: v for k, v in summit.items() if k not in ("lat", "lon")}
            layer.points(np.array([px]), np.array([py]), tags)
    return mvt.encode([place, layer])


def _source(monkeypatch, summits, template=TEMPLATE, tile_status=200, refuse=False):
    """Answer the TileJSON and every tile from these summits, listing what was asked."""
    asked = []

    def get(url):
        asked.append(url)
        if url == peaks.TILEJSON:
            return 200, json.dumps({"tiles": [template]}).encode()
        if refuse:
            raise peaks.PeaksUnavailable("offline")
        if tile_status != 200:
            return tile_status, b""
        z, x, y = (int(part) for part in _TILE.search(url).groups())
        return 200, _tile(z, x, y, summits)

    monkeypatch.setattr(peaks, "_get", get)
    return asked


def _tiles_asked(asked):
    return [url for url in asked if url != peaks.TILEJSON]


def _settled(lat, lon, radius, **kwargs):
    """What a view reads once every tile asked for has come in."""
    peaks.known_around(lat, lon, radius, **kwargs)
    assert peaks.wait_idle()
    return peaks.known_around(lat, lon, radius)


def test_tiles_are_read_deeper_near_the_eye_and_nearest_first():
    plan = peaks.tiles_around(*EYE, 150_000)
    zooms = [key[0] for key, _inner, _outer in plan]
    assert set(zooms) == {12, 11, 10, 9}
    first = plan[0][0]
    assert first == (12, *(int(c) for c in tiles.project(*EYE, 12)))
    # the bands meet end to end, out to the radius
    bands = sorted({(inner, outer) for _key, inner, outer in plan})
    assert bands == [(0.0, 15_000.0), (15_000.0, 40_000.0), (40_000.0, 100_000.0), (100_000.0, 150_000.0)]
    # each band is read at its own zoom
    assert {key[0]: (inner, outer) for key, inner, outer in plan} == {
        12: bands[0], 11: bands[1], 10: bands[2], 9: bands[3],
    }


def test_a_view_across_the_date_line_reads_tiles_on_both_sides():
    keys = {key for key, _inner, _outer in peaks.tiles_around(10.0, 179.99, 20_000)}
    xs = {x for z, x, _y in keys if z == 12}
    assert 0 in xs and (1 << 12) - 1 in xs


def test_the_widest_view_stops_at_the_nearer_tiles(monkeypatch):
    monkeypatch.setattr(peaks, "MAX_TILES", 40)
    peaks.tiles_around.cache_clear()
    plan = peaks.tiles_around(69.6, 20.2, 200_000)
    assert len(plan) == 40
    assert {key[0] for key, _inner, _outer in plan} <= {12, 11}


def test_each_summit_is_named_once_by_the_ring_it_stands_in(tmp_workspace, monkeypatch):
    spots = {"Near": 5_000.0, "Middle": 30_000.0, "Far": 70_000.0, "Farthest": 130_000.0}
    summits = [_summit(name, *offset(*EYE, 45.0, metres), 2000) for name, metres in spots.items()]
    _source(monkeypatch, summits)
    known = _settled(*EYE, 150_000)
    assert known.pending == known.failed == 0
    # every ring's tiles hold all four, yet each is named once
    assert sorted(p.name for p in known.peaks) == sorted(spots)
    for peak in known.peaks:
        assert terrain.distance(*EYE, peak.lat, peak.lon) == pytest.approx(spots[peak.name], abs=40)


def test_summits_are_read_once_then_from_the_workspace(tmp_workspace, monkeypatch):
    asked = _source(monkeypatch, [_summit("Eiger", 46.5776, 8.0053, 3967)])
    first = _settled(*EYE, 20_000)
    count = len(_tiles_asked(asked))
    second = peaks.known_around(*EYE, 20_000)
    assert count == len(peaks.tiles_around(*EYE, 20_000))
    assert len(_tiles_asked(asked)) == count
    assert asked.count(peaks.TILEJSON) == 1
    assert first.pending == second.pending == 0
    assert [p.name for p in second.peaks] == ["Eiger"]
    key = (12, *(int(c) for c in tiles.project(46.5776, 8.0053, 12)))
    kept = json.loads(peaks._tile_path(key).read_text(encoding="utf-8"))
    assert kept[0]["name"] == "Eiger" and kept[0]["ele"] == 3967


def test_only_named_summits_and_volcanoes_are_kept(tmp_workspace, monkeypatch):
    lat, lon = offset(*EYE, 120.0, 4_000)
    _source(monkeypatch, [
        _summit("Jabal Ahmam", lat, lon, 2400, **{"name:en": "Ahmam"}),
        _summit("Etna", *offset(*EYE, 200.0, 6_000), 3357, kind="volcano"),
        _summit("Hahnenmoospass", *offset(*EYE, 300.0, 3_000), 1950, kind="saddle"),
        _summit("", *offset(*EYE, 10.0, 2_000), 1500),
        _summit("Too high", *offset(*EYE, 60.0, 7_000), 12_000),
    ])
    named = {p.name: p for p in _settled(*EYE, 10_000).peaks}
    assert sorted(named) == ["Etna", "Jabal Ahmam", "Too high"]
    assert named["Jabal Ahmam"].name_en == "Ahmam"
    assert named["Etna"].name_en is None
    assert named["Too high"].ele is None  # the terrain gives it one
    assert named["Jabal Ahmam"].lat == pytest.approx(lat, abs=1e-4)


def test_the_view_never_waits_on_the_tiles(tmp_workspace, monkeypatch):
    gate = threading.Event()

    def slow(url):
        if url == peaks.TILEJSON:
            return 200, json.dumps({"tiles": [TEMPLATE]}).encode()
        gate.wait(5)
        return 200, b""

    monkeypatch.setattr(peaks, "_get", slow)
    known = peaks.known_around(*EYE, 60_000)
    assert known.peaks == [] and known.pending == len(peaks.tiles_around(*EYE, 60_000))
    # asked again while the first are out: nothing is asked twice
    again = peaks.known_around(*EYE, 60_000)
    assert again.pending == known.pending
    gate.set()
    # the tiles come in before the workspace goes, or a thread writes into a
    # folder being torn down
    assert peaks.wait_idle()


def test_the_eye_s_own_tile_is_asked_first(tmp_workspace, monkeypatch):
    asked = _source(monkeypatch, [])
    monkeypatch.setattr(peaks, "PARALLEL", 1)
    monkeypatch.setattr(peaks, "_pool", None)
    _settled(46.9, 7.1, 80_000)
    x, y = (int(c) for c in tiles.project(46.9, 7.1, 12))
    assert _tiles_asked(asked)[0] == TEMPLATE.format(z=12, x=x, y=y)


def test_a_build_that_is_gone_sends_the_view_to_the_new_one(tmp_workspace, monkeypatch):
    newer = TEMPLATE.replace("20261004_test", "20261011_test")
    asked = []

    def get(url):
        asked.append(url)
        if url == peaks.TILEJSON:
            return 200, json.dumps({"tiles": [newer if peaks._template else TEMPLATE]}).encode()
        if "20261004_test" in url:
            return 404, b""
        z, x, y = (int(part) for part in _TILE.search(url).groups())
        return 200, _tile(z, x, y, [_summit("Eiger", 46.5776, 8.0053, 3967)])

    monkeypatch.setattr(peaks, "_get", get)
    monkeypatch.setattr(peaks, "TEMPLATE_FRESH", 0.0)
    known = _settled(*EYE, 20_000)
    assert [p.name for p in known.peaks] == ["Eiger"]
    assert asked.count(peaks.TILEJSON) >= 2
    assert peaks._template[0] == newer


def test_a_tile_the_current_build_lacks_is_an_empty_one(tmp_workspace, monkeypatch):
    asked = _source(monkeypatch, [], tile_status=404)
    known = _settled(*EYE, 1_000)
    assert known.failed == 0 and known.peaks == []
    # the build was read a moment ago, so it is not read again for each tile
    assert asked.count(peaks.TILEJSON) == 1


def test_an_unreachable_host_fails_every_tile_at_once(tmp_workspace, monkeypatch):
    asked = []

    def get(url):
        asked.append(url)
        raise peaks.PeaksUnavailable("offline")

    monkeypatch.setattr(peaks, "_get", get)
    known = _settled(*EYE, 20_000)
    assert known.failed == len(peaks.tiles_around(*EYE, 20_000)) > 1
    assert asked == [peaks.TILEJSON]


def test_a_tile_address_off_openfreemap_is_never_asked(tmp_workspace, monkeypatch):
    asked = _source(monkeypatch, [], template="https://example.com/{z}/{x}/{y}.pbf")
    known = _settled(*EYE, 1_000)
    assert known.failed == len(peaks.tiles_around(*EYE, 1_000))
    assert _tiles_asked(asked) == []


def test_a_tile_that_could_not_be_read_is_left_longer_each_time(tmp_workspace, monkeypatch):
    asked = _source(monkeypatch, [], refuse=True)
    known = _settled(0.5, -30.5, 1_000)
    count = len(peaks.tiles_around(0.5, -30.5, 1_000))
    assert known.failed == count and known.pending == 0 and known.peaks == []
    assert known.retry_in == pytest.approx(peaks.RETRY_AFTER, abs=1)
    tried = len(_tiles_asked(asked))
    assert peaks.known_around(0.5, -30.5, 1_000).failed == count
    assert len(_tiles_asked(asked)) == tried  # not asked again so soon
    # once the wait is over the view's next question asks again, and a second
    # failure waits twice as long
    for key in list(peaks._failed):
        peaks._failed[key] = (time.monotonic() - 1, peaks._failed[key][1])
    again = _settled(0.5, -30.5, 1_000)
    assert len(_tiles_asked(asked)) == 2 * tried
    assert again.retry_in == pytest.approx(2 * peaks.RETRY_AFTER, abs=1)
    assert all(wait == 2 * peaks.RETRY_AFTER for _due, wait in peaks._failed.values())


def test_trying_again_asks_at_once(tmp_workspace, monkeypatch):
    _source(monkeypatch, [], refuse=True)
    assert _settled(0.5, -30.5, 1_000).failed
    asked = _source(monkeypatch, [_summit("Seamount", *offset(0.5, -30.5, 0.0, 500), 10)])
    assert peaks.known_around(0.5, -30.5, 1_000).failed  # still waiting
    assert _tiles_asked(asked) == []
    known = _settled(0.5, -30.5, 1_000, retry=True)
    assert known.failed == 0 and [p.name for p in known.peaks] == ["Seamount"]


def test_a_stale_tile_is_asked_again(tmp_workspace, monkeypatch):
    asked = _source(monkeypatch, [])
    _settled(0.5, -30.5, 1_000)
    _settled(0.5, -30.5, 1_000)
    tried = len(_tiles_asked(asked))
    assert tried == len(peaks.tiles_around(0.5, -30.5, 1_000))
    old = time.time() - (peaks.TTL_DAYS + 1) * 86400
    for path in peaks.cache_dir().rglob("*.json"):
        os.utime(path, (old, old))
    _settled(0.5, -30.5, 1_000)
    assert len(_tiles_asked(asked)) == 2 * tried


def test_the_route_places_each_summit_where_the_eye_sees_it(client, monkeypatch):
    north = offset(*EYE, 0.0, 10_000.0)
    east = offset(*EYE, 90.0, 20_000.0)
    _source(monkeypatch, [_summit("North top", *north, 2500), _summit("East top", *east)])
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(), plain=1200.0))
    terrain.forget_decoded()
    params = {"lat": EYE[0], "lon": EYE[1], "altitude": 1000, "far": 50_000}
    early = client.get("/api/horizon/peaks", params=params).json()
    assert early["pending"] > 0  # answered at once, with what is known so far
    assert peaks.wait_idle()
    body = client.get("/api/horizon/peaks", params=params).json()
    assert body["pending"] == 0 and body["failed"] == 0 and body["retry_in"] == 0
    named = {row["name"]: row for row in body["peaks"]}
    assert named["North top"]["azimuth"] == pytest.approx(0.0, abs=0.01)
    assert named["North top"]["distance"] == pytest.approx(10_000, rel=1e-3)
    # 1500 m above the eye at 10 km, less the Earth's drop: just under 8.5°
    assert 8.3 < named["North top"]["angle"] < 8.55
    # the tile gave the east summit no height, so the terrain did
    assert named["East top"]["ele"] == pytest.approx(1200.0, abs=0.5)
    assert named["East top"]["ele_from_osm"] is False
    assert "OpenFreeMap" in body["credits"][0]["attribution"]
    assert "© OpenStreetMap contributors" in body["credits"][0]["attribution"]


def test_the_route_says_what_could_not_be_read_and_tries_again_when_told(client, monkeypatch):
    _source(monkeypatch, [], refuse=True)
    params = {"lat": EYE[0], "lon": EYE[1], "altitude": 1000, "far": 20_000}
    client.get("/api/horizon/peaks", params=params)
    assert peaks.wait_idle()
    body = client.get("/api/horizon/peaks", params=params).json()
    assert body["peaks"] == []
    assert body["failed"] == len(peaks.tiles_around(*EYE, 20_000))
    assert 0 < body["retry_in"] <= peaks.RETRY_AFTER
    _source(monkeypatch, [])
    again = client.get("/api/horizon/peaks", params={**params, "retry": "true"}).json()
    assert again["failed"] == 0 and again["pending"] == body["failed"]
    assert peaks.wait_idle()
