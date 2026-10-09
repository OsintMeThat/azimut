"""/api/horizon/match: a traced skyline looked for on the turn the tab holds."""

import json

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
