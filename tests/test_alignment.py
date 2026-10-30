"""Where an alignment's tops touch: the eye's altitude along the line, and the place it gives."""

import pytest

from azimut.engine import alignment, terrain
from fakerelief import Peak, Relief, offset

CAMERA = (16.9988, 45.0938)
PLAIN = 100.0
BEARING = 70.0  # from the camera to the near mast and the far summit
NEAR_M = 900.0
FAR_M = 25_000.0
SUMMIT = Peak(*offset(*CAMERA, BEARING, FAR_M), height=1500.0, radius=800.0)


@pytest.fixture(autouse=True)
def synthetic_relief(monkeypatch):
    terrain.forget_decoded()
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(SUMMIT,), plain=PLAIN))
    yield
    terrain.forget_decoded()


def _mast_top(eye_altitude: float) -> float:
    """The altitude a mast's top must reach, NEAR_M out, to touch the summit seen from that eye."""
    low, high = PLAIN, PLAIN + 500.0
    for _ in range(80):
        mid = (low + high) / 2
        seen = float(alignment.eye_altitudes([NEAR_M], mid, PLAIN + SUMMIT.height, FAR_M - NEAR_M)[0])
        # a taller mast lifts the line behind it, and the eye with it
        if seen > eye_altitude:
            high = mid
        else:
            low = mid
    return (low + high) / 2


def _ends(mast_height: float):
    near = alignment.Top(*offset(*CAMERA, BEARING, NEAR_M), height=mast_height)
    far = alignment.Top(SUMMIT.lat, SUMMIT.lon)
    return near, far


def test_the_eye_altitude_lays_both_tops_on_one_ray():
    # tops at one altitude: the eye stands at it, a little higher for the Earth's curve between
    flat = alignment.eye_altitudes([1000.0], 500.0, 500.0, 10_000.0)[0]
    assert 500.0 < flat < 502.0
    # a far top higher than the near one: the eye stands below the near top, farther back lower still
    near, far = alignment.eye_altitudes([500.0, 2000.0], 300.0, 900.0, 20_000.0)
    assert far < near < 300.0


def test_a_mast_touching_a_summit_says_where_a_person_stood():
    mast = _mast_top(PLAIN + 1.7) - PLAIN
    near, far = _ends(mast)
    found = alignment.tops_touch(near, far, bearing=(BEARING + 180) % 360, mode="ground", low=1.7, high=1.7)
    # the summit read as the highest ground round the click, the mast as its own height
    assert found["far"]["top"] == pytest.approx(PLAIN + SUMMIT.height, abs=1.0)
    assert found["near"]["top"] == pytest.approx(PLAIN + mast, abs=0.1)
    assert found["apart"] == pytest.approx(FAR_M - NEAR_M, rel=1e-3)
    [fit] = found["fits"]
    assert fit["at"]["distance"] == pytest.approx(NEAR_M, abs=5.0)
    assert terrain.distance(fit["at"]["lat"], fit["at"]["lon"], *CAMERA) < 6.0
    assert fit["at"]["eye"] == pytest.approx(1.7, abs=0.1)


def test_a_drones_height_range_gives_a_stretch_of_the_line():
    mast = _mast_top(PLAIN + 60.0) - PLAIN
    near, far = _ends(mast)
    found = alignment.tops_touch(near, far, bearing=(BEARING + 180) % 360, mode="drone", low=30.0, high=90.0)
    [stretch] = found["fits"]
    # a higher drone stands nearer the mast
    assert stretch["from"]["distance"] < NEAR_M < stretch["to"]["distance"]
    assert stretch["from"]["eye"] == pytest.approx(90.0, abs=1.5)
    assert stretch["to"]["eye"] == pytest.approx(30.0, abs=1.5)


def test_tops_no_eye_could_lay_together_give_nothing():
    # a mast standing over the summit: the line through the tops climbs away behind it
    near, far = _ends(1600.0)
    found = alignment.tops_touch(near, far, bearing=(BEARING + 180) % 360, mode="ground", low=1.7, high=1.7)
    assert found["fits"] == []


def test_the_route_answers_and_refuses_what_it_cannot_read(client):
    mast = _mast_top(PLAIN + 1.7) - PLAIN
    near, far = _ends(mast)
    body = {
        "near": {"lat": near.lat, "lon": near.lon, "height": mast},
        "far": {"lat": far.lat, "lon": far.lon},
        "bearing": (BEARING + 180) % 360,
    }
    answer = client.post("/api/horizon/alignment", json=body)
    assert answer.status_code == 200, answer.text
    assert len(answer.json()["fits"]) == 1
    for change in (
        {"low": 50.0, "high": 10.0},
        {"mode": "ground", "high": 500.0},
        {"far": body["near"]},
        {"bearing": 360.0},
        {"near": {**body["near"], "height": -1}},
    ):
        assert client.post("/api/horizon/alignment", json={**body, **change}).status_code == 422
