"""/api/horizon/match: a traced skyline looked for on the turn the tab holds."""

import json

import numpy as np

import pytest

from skyturns import HALF, RANGE, trace_on

URL = "/api/horizon/match"


def _body(**change):
    x, y = trace_on(RANGE, heading=47.0, fov=52.0, tilt=2.0)
    body = {
        "skyline": [round(float(v), 3) for v in RANGE.angles],
        "start": 0.0,
        "step": 0.1,
        "x": x.tolist(),
        "y": y.tolist(),
        "half_width": HALF,
        "fov": 60.0,
        "tilt": 0.0,
    }
    body.update(change)
    return body


def test_a_trace_comes_back_placed_on_the_turn(client):
    answer = client.post(URL, json=_body())
    assert answer.status_code == 200, answer.text
    found = answer.json()
    assert found["verdict"] == "match"
    best = found["fits"][0]
    assert best["heading"] == pytest.approx(47.0, abs=0.3)
    assert best["fov"] == pytest.approx(52.0, rel=0.03)
    assert best["tilt"] == pytest.approx(2.0, abs=0.3)
    assert best["explained"] > 0.9 and best["close"] is True
    assert best["gap"] < 0.05
    # a clear match leaves no other place about as good
    assert not any(fit["close"] for fit in found["fits"][1:])
    low, high = found["lenses"]
    assert low < 60 < high


def test_a_lens_the_photo_says_is_kept(client):
    found = client.post(URL, json=_body(fov=52.0, known=True)).json()
    assert found["lenses"] == [52.0, 52.0]
    assert all(fit["fov"] == 52.0 for fit in found["fits"])


def test_a_turn_with_a_hole_is_read_around_it(client):
    skyline = _body()["skyline"]
    skyline[1500:2000] = [None] * 500
    answer = client.post(URL, json=_body(skyline=skyline))
    assert answer.status_code == 200, answer.text
    assert answer.json()["fits"][0]["heading"] == pytest.approx(47.0, abs=0.3)


@pytest.mark.parametrize(
    "change",
    [
        {"x": [0.0] * 10, "y": [0.0] * 11},  # as many x as y
        {"step": 0.2},  # half a turn
        {"x": [0.0] * 3, "y": [0.0] * 3},  # too few points
        {"x": [0.0] * 2001, "y": [0.0] * 2001},  # too many
        {"skyline": [None] * 3600},  # no ground at all
        {"fov": 0.0},
        {"tilt": 95.0},
        {"half_width": 0.0},
    ],
)
def test_a_trace_the_search_cannot_read_is_refused(client, change):
    assert client.post(URL, json=_body(**change)).status_code == 422


def test_a_trace_off_the_picture_is_refused(client):
    body = _body()
    body["x"][0] = 50.0
    assert client.post(URL, json=body).status_code == 422


@pytest.mark.parametrize("field", ["x", "skyline"])
def test_numbers_that_are_not_numbers_are_refused(client, field):
    body = _body()
    body[field][3] = float("nan")
    # the browser's JSON cannot carry NaN; a hand-made request still can
    raw = json.dumps(body, allow_nan=True)
    answer = client.post(URL, content=raw, headers={"content-type": "application/json"})
    assert answer.status_code == 422


def test_the_search_reads_no_terrain(client, monkeypatch):
    # it works on the skyline it is sent: nothing is marched, nothing fetched
    from azimut.engine import horizon

    def no_sweep(*args, **kwargs):
        raise AssertionError("the match swept the terrain")

    monkeypatch.setattr(horizon, "sweep", no_sweep)
    answer = client.post(URL, json=_body())
    assert answer.status_code == 200, answer.text


def _cut_body(**change):
    """A trace of a near ridge the whole turn hides behind a farther range, with the turn's cut."""
    from skyturns import skyturn

    near = skyturn([(40, 2.0, 3), (52, 1.5, 1.5), (61, 2.2, 4)], base=0.5)
    farther = skyturn([(50, 4.0, 10)], base=0.0)
    whole = [round(float(v), 3) for v in np.maximum(near.angles, farther.angles)]
    x, y = trace_on(near, heading=50.0, fov=40.0)
    body = _body(skyline=whole, x=x.tolist(), y=y.tolist(), fov=40.0, known=True,
                 cuts=[{"reach": 10_000.0, "skyline": [round(float(v), 3) for v in near.angles]}])
    body.update(change)
    return body


def test_a_cut_of_the_turn_is_searched_and_said(client):
    answer = client.post(URL, json=_cut_body())
    assert answer.status_code == 200, answer.text
    best = answer.json()["fits"][0]
    assert best["heading"] == pytest.approx(50.0, abs=0.3)
    assert best["reach"] == 10_000.0
    whole = client.post(URL, json=_cut_body(cuts=[])).json()["fits"][0]
    assert whole["reach"] is None
    assert whole["explained"] < best["explained"] - 0.3


def test_a_turn_sent_cut_says_its_reach_on_every_place(client):
    body = _cut_body()
    body["skyline"], body["reach"], body["cuts"] = body["cuts"][0]["skyline"], 10_000.0, []
    found = client.post(URL, json=body).json()
    assert found["fits"][0]["heading"] == pytest.approx(50.0, abs=0.3)
    assert all(fit["reach"] == 10_000.0 for fit in found["fits"])


def test_the_lens_range_and_the_sector_narrow_the_search(client):
    x, y = trace_on(RANGE, heading=52.0, fov=8.0)
    body = _body(x=x.tolist(), y=y.tolist(), fov=60.0, within=[120.0, 1.5])
    found = client.post(URL, json=body).json()
    assert found["fits"][0]["fov"] == pytest.approx(8.0, rel=0.03)
    assert found["lenses"] == [1.5, 120.0]
    inside = client.post(URL, json={**body, "facing": [230.0, 20.0]}).json()
    assert all(abs((fit["heading"] - 230.0 + 180) % 360 - 180) <= 20.0 for fit in inside["fits"])


def test_a_rolled_trace_comes_back_with_its_roll_unless_held_level(client):
    x, y = trace_on(RANGE, heading=47.0, fov=52.0, roll=3.0)
    body = _body(x=x.tolist(), y=y.tolist(), fov=52.0, known=True)
    assert client.post(URL, json=body).json()["fits"][0]["roll"] == pytest.approx(3.0, abs=0.3)
    held = client.post(URL, json={**body, "level": True, "roll": 1.0}).json()
    assert held["fits"][0]["roll"] == 1.0


@pytest.mark.parametrize(
    "change",
    [
        {"within": [0.1, 60.0]},  # no lens that narrow
        {"within": [30.0]},
        {"facing": [400.0, 20.0]},
        {"facing": [40.0, 0.0]},
        {"reach": 0.0},
        {"cuts": [{"reach": 5000.0, "skyline": [1.0] * 100}]},  # not the turn's columns
        {"cuts": [{"reach": 5000.0, "skyline": [None] * 3600}]},
        {"cuts": [{"reach": 5000.0, "skyline": [1.0] * 3600}] * 9},
    ],
)
def test_hints_the_search_cannot_use_are_refused(client, change):
    assert client.post(URL, json=_body(**change)).status_code == 422
