"""Named summits from OpenStreetMap: the cache, the Overpass question, the route."""

import json
import os
import threading
import time

import httpx
import pytest

from azimut.engine import peaks, terrain
from fakerelief import Relief, offset

EYE = (46.55, 7.9)


@pytest.fixture(autouse=True)
def fresh_cells():
    """No test inherits another's cells in flight or remembered failures."""
    peaks.wait_idle()
    peaks.forget_failures()
    yield
    peaks.wait_idle()
    peaks.forget_failures()


def _overpass(monkeypatch, elements, status=200, refuse=()):
    """Answer every Overpass POST with these nodes, listing (server, query) asked.

    Servers in `refuse` answer 429, as a busy public instance does.
    """
    asked = []

    def post(url, data=None, timeout=None, headers=None):
        asked.append((url, data["data"]))
        request = httpx.Request("POST", url)
        if url in refuse:
            return httpx.Response(429, text="rate limited", request=request)
        return httpx.Response(status, json={"elements": elements}, request=request)

    monkeypatch.setattr(peaks.httpx, "post", post)
    return asked


def _node(name, lat, lon, ele=None, **tags):
    return {"type": "node", "lat": lat, "lon": lon,
            "tags": {"name": name, **({"ele": ele} if ele is not None else {}), **tags}}


def _settled(lat, lon, radius):
    """What a view reads once every cell asked for has come in."""
    peaks.known_around(lat, lon, radius)
    assert peaks.wait_idle()
    return peaks.known_around(lat, lon, radius)


@pytest.mark.parametrize("raw, metres", [
    ("3967", 3967.0), ("4 478 m", 4.0), ("4478m", 4478.0), ("2,5", 2.5),
    ("1000 ft", 304.8), ("", None), (None, None), ("unknown", None), ("12000", None),
])
def test_osm_heights_are_read_as_they_are_written(raw, metres):
    got = peaks.parse_ele(raw)
    assert got == (pytest.approx(metres) if metres is not None else None)


def test_a_circle_touches_the_cells_around_it():
    cells = peaks.cells_around(46.5, 7.9, 60_000)
    assert (46, 7) in cells and (45, 7) in cells and (46, 8) in cells
    assert all(isinstance(lat, int) and isinstance(lon, int) for lat, lon in cells)
    across = peaks.cells_around(10.0, 179.9, 30_000)
    assert (10, 179) in across and (10, -180) in across  # across the date line


def test_summits_are_asked_once_then_read_from_the_workspace(tmp_workspace, monkeypatch):
    asked = _overpass(monkeypatch, [
        _node("Eiger", 46.5776, 8.0053, "3967"), _node("Mönch", 46.5586, 7.9973, "4107"),
        {"type": "node", "lat": 46.6, "lon": 7.95, "tags": {"natural": "peak"}},  # nameless
    ])
    first = _settled(*EYE, 20_000)
    count = len(asked)
    second = peaks.known_around(*EYE, 20_000)
    assert len(asked) == count == len(peaks.cells_around(*EYE, 20_000))
    assert first.pending == second.pending == 0
    # each cell keeps only the summits inside it, so neither is counted twice
    assert sorted(p.name for p in second.peaks) == ["Eiger", "Mönch"]
    assert json.loads((peaks.cache_dir() / "46_8.json").read_text(encoding="utf-8"))[0]["name"] == "Eiger"


def test_a_cell_is_asked_by_exact_tags_so_the_server_uses_its_index(tmp_workspace, monkeypatch):
    asked = _overpass(monkeypatch, [])
    _settled(46.5, 7.5, 1_000)
    query = asked[0][1]
    assert 'node["natural"="peak"]["name"](46,7,47,8)' in query
    assert 'node["natural"="volcano"]["name"](46,7,47,8)' in query
    assert "~" not in query


def test_the_view_never_waits_on_overpass(tmp_workspace, monkeypatch):
    gate = threading.Event()

    def slow(url, data=None, timeout=None, headers=None):
        gate.wait(5)
        return httpx.Response(200, json={"elements": []}, request=httpx.Request("POST", url))

    monkeypatch.setattr(peaks.httpx, "post", slow)
    known = peaks.known_around(*EYE, 60_000)
    assert known.peaks == [] and known.pending == len(peaks.cells_around(*EYE, 60_000))
    # asked again while the first are out: nothing is asked twice
    again = peaks.known_around(*EYE, 60_000)
    assert again.pending == known.pending
    gate.set()
    # the cells come in before the workspace goes: a thread still writing its
    # cache into a folder being torn down failed the test under a loaded runner
    assert peaks.wait_idle()


def test_the_eye_s_own_cell_is_asked_first(tmp_workspace, monkeypatch):
    asked = _overpass(monkeypatch, [])
    monkeypatch.setattr(peaks, "PARALLEL", 1)
    peaks._pool = None
    _settled(46.9, 7.1, 80_000)
    assert "(46,7,47,8)" in asked[0][1]


def test_a_busy_server_hands_the_question_to_the_next(tmp_workspace, monkeypatch):
    asked = _overpass(monkeypatch, [_node("Eiger", 46.5776, 8.0053, "3967")], refuse=(peaks.ENDPOINTS[0],))
    known = _settled(46.5, 8.5, 1_000)
    assert [p.name for p in known.peaks] == ["Eiger"]
    assert [url for url, _query in asked] == list(peaks.ENDPOINTS[:2])


def test_a_cell_with_no_summit_is_remembered_and_a_stale_one_asked_again(tmp_workspace, monkeypatch):
    asked = _overpass(monkeypatch, [])
    _settled(0.5, -30.5, 10_000)
    _settled(0.5, -30.5, 10_000)
    assert len(asked) == 1
    for path in peaks.cache_dir().iterdir():
        old = time.time() - (peaks.TTL_DAYS + 1) * 86400
        os.utime(path, (old, old))
    _settled(0.5, -30.5, 10_000)
    assert len(asked) == 2


def test_a_cell_no_server_answers_is_left_a_while_then_asked_again(tmp_workspace, monkeypatch):
    calls = []

    def post(*args, **kwargs):
        calls.append(1)
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(peaks.httpx, "post", post)
    known = _settled(0.5, -30.5, 10_000)
    assert known.failed == 1 and known.pending == 0 and known.peaks == []
    assert len(calls) == len(peaks.ENDPOINTS)
    assert peaks.known_around(0.5, -30.5, 10_000).failed == 1
    assert len(calls) == len(peaks.ENDPOINTS)  # not asked again so soon
    monkeypatch.setattr(peaks, "RETRY_AFTER", 0.0)
    assert peaks.known_around(0.5, -30.5, 10_000).pending == 1


def test_the_route_places_each_summit_where_the_eye_sees_it(client, monkeypatch):
    north = offset(*EYE, 0.0, 10_000.0)
    east = offset(*EYE, 90.0, 20_000.0)
    _overpass(monkeypatch, [_node("North top", *north, "2500"), _node("East top", *east)])
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(), plain=1200.0))
    terrain.forget_decoded()
    params = {"lat": EYE[0], "lon": EYE[1], "altitude": 1000, "far": 50_000}
    early = client.get("/api/horizon/peaks", params=params).json()
    assert early["pending"] > 0  # answered at once, with what is known so far
    assert peaks.wait_idle()
    body = client.get("/api/horizon/peaks", params=params).json()
    assert body["pending"] == 0 and body["failed"] == 0
    named = {row["name"]: row for row in body["peaks"]}
    assert named["North top"]["azimuth"] == pytest.approx(0.0, abs=0.01)
    assert named["North top"]["distance"] == pytest.approx(10_000, rel=1e-3)
    # 1500 m above the eye at 10 km, less the Earth's drop: just under 8.5°
    assert 8.3 < named["North top"]["angle"] < 8.55
    # OSM gave the east summit no height, so the terrain did
    assert named["East top"]["ele"] == pytest.approx(1200.0, abs=0.5)
    assert named["East top"]["ele_from_osm"] is False
    assert body["credits"][0]["attribution"] == "© OpenStreetMap contributors"


def test_the_route_says_how_many_areas_could_not_be_read(client, monkeypatch):
    def post(*args, **kwargs):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(peaks.httpx, "post", post)
    params = {"lat": EYE[0], "lon": EYE[1], "altitude": 1000, "far": 20_000}
    client.get("/api/horizon/peaks", params=params)
    assert peaks.wait_idle()
    body = client.get("/api/horizon/peaks", params=params).json()
    assert body["peaks"] == []
    assert body["failed"] == len(peaks.cells_around(*EYE, 20_000))
