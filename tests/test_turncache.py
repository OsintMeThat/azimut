"""Turns kept on disk: a search run again reads the turns it swept back instead of sweeping them."""

import os

import numpy as np
import pytest

from azimut.engine import finder, horizon, skymatch, terrain, turncache
from fakerelief import Peak, Relief, offset
from skyturns import HALF, trace_on

EYE = (45.0, 6.0)
PEAKS = (
    Peak(*offset(*EYE, 60.0, 4_000.0), height=700.0, radius=600.0),
    Peak(*offset(*EYE, 140.0, 6_000.0), height=900.0, radius=800.0),
)


@pytest.fixture(autouse=True)
def synthetic_relief(monkeypatch):
    terrain.forget_decoded()
    monkeypatch.setattr(terrain, "tile", Relief(peaks=PEAKS, plain=200.0, ripple=0.5))
    yield
    terrain.forget_decoded()


def _swept(**changed):
    asked = {"azimuths": np.arange(0.0, 360.0, 0.5), "far": 20_000.0, "cuts": [5_000.0], "near_step": 25.0}
    asked.update(changed)
    return asked


def test_a_turn_is_kept_under_everything_it_was_swept_with():
    eye = horizon.Observer(*EYE)
    key = turncache.key_of(eye, **_swept())
    assert key == turncache.key_of(horizon.Observer(*EYE), **_swept())
    others = [
        turncache.key_of(horizon.Observer(EYE[0] + 1e-4, EYE[1]), **_swept()),
        turncache.key_of(horizon.Observer(*EYE, height=10.0), **_swept()),
        turncache.key_of(horizon.Observer(*EYE, mode="drone", height=10.0), **_swept()),
        turncache.key_of(eye, **_swept(azimuths=np.arange(0.0, 360.0, 0.25))),
        turncache.key_of(eye, **_swept(azimuths=np.arange(0.0, 180.0, 0.5))),
        turncache.key_of(eye, **_swept(far=50_000.0)),
        turncache.key_of(eye, **_swept(cuts=[5_000.0, 10_000.0])),
        turncache.key_of(eye, **_swept(near_step=10.0)),
    ]
    assert key not in others and len(set(others)) == len(others)


def test_a_kept_turn_reads_back_as_swept(monkeypatch):
    eye = horizon.Observer(*EYE)
    asked = _swept()
    swept = horizon.sweep(eye, sampler=terrain.Sampler(), workers=1, **asked)
    key = turncache.key_of(eye, **asked)
    turncache.write(key, swept)
    back = turncache.read(key, eye, asked["azimuths"], asked["far"])
    assert back is not None
    for name in ("skyline", "skyline_distance", "ridge_angle", "ridge_distance", "skyline_cuts", "skyline_cuts_distance"):
        assert np.allclose(getattr(back, name), getattr(swept, name), rtol=1e-6, atol=1e-4, equal_nan=True), name
    assert np.array_equal(back.ridge_column, swept.ridge_column) and np.array_equal(back.cuts, swept.cuts)
    assert back.ground == pytest.approx(swept.ground) and back.altitude == pytest.approx(swept.altitude)
    # a turn never kept, or one half written by a process that stopped, is no turn
    assert turncache.read("0" * 40, eye, asked["azimuths"], asked["far"]) is None
    broken = turncache.cache_dir() / "ab" / ("ab" + "1" * 38 + ".npz")
    broken.parent.mkdir(parents=True, exist_ok=True)
    broken.write_bytes(b"not a turn")
    assert turncache.read(broken.stem, eye, asked["azimuths"], asked["far"]) is None


def test_a_search_asked_again_reads_its_turns_back(monkeypatch):
    swept = horizon.sweep(horizon.Observer(*EYE), azimuths=np.arange(0.0, 360.0, 0.1), far=20_000.0)
    x, y = trace_on(skymatch.Turn(0.0, 0.1, swept.skyline), heading=70.0, fov=40.0)
    trace = finder.Trace(x=x, y=y, half_width=HALF, fov=40.0, known=True)
    plan = finder.Plan(area=[EYE] * 3)
    calls = []
    sweep = horizon.sweep

    def counted(*args, **kwargs):
        calls.append(1)
        return sweep(*args, **kwargs)

    monkeypatch.setattr(horizon, "sweep", counted)
    sampler = terrain.Sampler()
    # a relief made up for a test is never kept: its turns are not the terrain's
    finder.score_point(*EYE, trace, plan, sampler=sampler, quick=False)
    finder.score_point(*EYE, trace, plan, sampler=sampler, quick=False)
    assert len(calls) == 2 and not any(turncache.cache_dir().rglob("*.npz"))
    # off the terrain the app reads, the second search sweeps nothing and finds the same place
    monkeypatch.setattr(turncache, "usable", lambda: True)
    first = finder.score_point(*EYE, trace, plan, sampler=sampler, quick=False)
    again = finder.score_point(*EYE, trace, plan, sampler=sampler, quick=False)
    assert len(calls) == 3
    assert again["explained"] == pytest.approx(first["explained"], abs=1e-4)
    assert again["heading"] == pytest.approx(first["heading"], abs=0.05)


def test_the_turns_read_least_recently_go_first_past_the_budget():
    folder = turncache.cache_dir() / "aa"
    folder.mkdir(parents=True)
    now = 1_000_000.0
    for i in range(10):
        path = folder / f"aa{i:038d}.npz"
        path.write_bytes(b"x" * 1_000)
        os.utime(path, (now + i, now + i))
    # under the budget nothing goes
    assert turncache.sweep(budget=20_000) == 0
    # over it, the oldest go until 80% of it is left
    assert turncache.sweep(budget=5_000) == 6
    assert sorted(p.name[-6:-4] for p in folder.iterdir()) == ["06", "07", "08", "09"]
