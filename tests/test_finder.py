"""Find where a photo was taken: the grid, the alignments that narrow it, and the camera found again."""

import numpy as np
import pytest

from azimut.engine import finder, horizon, skymatch, terrain, workqueue
from fakerelief import Peak, Relief, offset
from skyturns import HALF, trace_on

CAMERA = (45.0, 6.0)
REACH = 10_000.0
# hills all round at a few kilometres, each its own height and width, so every place sees its own skyline
PEAKS = tuple(
    Peak(*offset(*CAMERA, bearing, metres), height=height, radius=radius)
    for bearing, metres, height, radius in (
        (20, 4_000, 700, 500), (75, 6_500, 900, 700), (110, 3_000, 400, 350),
        (170, 5_000, 800, 600), (250, 4_500, 600, 450), (320, 7_000, 1_000, 900),
    )
)


@pytest.fixture(autouse=True)
def synthetic_relief(monkeypatch):
    terrain.forget_decoded()
    monkeypatch.setattr(terrain, "tile", Relief(peaks=PEAKS, plain=200.0))
    yield
    terrain.forget_decoded()


def _square(centre, half):
    corners = [terrain.destination(*centre, bearing, half * 2**0.5) for bearing in (45, 135, 225, 315)]
    return [(float(lat), float(lon)) for lat, lon in corners]


def _photo(heading=80.0, fov=40.0):
    """The trace a camera at CAMERA sees, facing `heading` through `fov`."""
    swept = horizon.sweep(horizon.Observer(*CAMERA), azimuths=np.arange(0.0, 360.0, 0.1), far=REACH)
    x, y = trace_on(skymatch.Turn(0.0, 0.1, swept.skyline), heading=heading, fov=fov)
    return finder.Trace(x=x, y=y, half_width=HALF, fov=fov, known=True)


def test_the_grid_lies_over_the_area_and_on_the_lines():
    area = _square(CAMERA, 2_000.0)
    plan = finder.Plan(area=area)
    lat, lon = finder.grid(plan, 500.0)
    assert lat.size == 64
    assert finder.inside(area, lat, lon).all()
    # an alignment through the camera keeps only the points along its line
    near = offset(*CAMERA, 30.0, 1_500.0)
    lined = finder.Plan(area=area, alignments=(finder.Alignment(*near, bearing=210.0, tolerance=8.0),))
    on = finder.grid(lined, 250.0)
    assert 0 < on[0].size < finder.grid(plan, 250.0)[0].size / 4
    assert finder.on_lines(lined.alignments, np.array([CAMERA[0]]), np.array([CAMERA[1]]))[0]


def test_the_spacing_and_the_columns_follow_the_area_and_the_lens():
    assert finder.auto_spacing(_square(CAMERA, 5_000.0)) == 400.0
    assert finder.auto_spacing(_square(CAMERA, 1_000.0)) == 100.0
    assert finder.levels(900.0, 100.0) == 2
    assert finder.levels(100.0, 100.0) == 0
    # refined as finely as the terrain is worth: GLO-30 here, so 60 m, the analyst's own when said
    assert finder.fine_spacing(finder.Plan(area=_square(CAMERA, 1_000.0)), probe=False) == 60.0
    assert finder.fine_spacing(finder.Plan(area=_square(CAMERA, 1_000.0), fine=200.0)) == 200.0
    lens = lambda **kw: finder.Trace(x=np.zeros(6), y=np.zeros(6), half_width=HALF, **kw)  # noqa: E731
    assert finder.column_step(lens(fov=60.0, known=True)) == 0.5
    assert finder.column_step(lens(fov=4.8, known=True)) == pytest.approx(0.16)
    # any lens at all is read as fine as a lens six degrees wide; a long zoom said reads finer
    assert finder.column_step(lens(fov=60.0, within=(1.5, 120.0))) == pytest.approx(0.2)
    assert finder.column_step(lens(fov=5.0, within=(1.0, 12.0))) == finder.STEP_MIN
    big = finder.estimate(finder.Plan(area=_square(CAMERA, 30_000.0), spacing=100.0))
    assert big["coarse"] <= finder.COARSE_MAX


def test_the_camera_is_found_again_from_its_skyline():
    trace = _photo()
    plan = finder.Plan(area=_square(offset(*CAMERA, 60.0, 600.0), 1_500.0), reach=REACH, spacing=500.0, fine=500.0)
    seen = []
    found = finder.search(plan, trace, progress=lambda done, total: seen.append((done, total)))
    best = found["places"][0]
    assert terrain.distance(best["lat"], best["lon"], *CAMERA) < 400.0
    assert best["heading"] == pytest.approx(80.0, abs=1.5)
    assert best["explained"] > 0.8
    assert found["verdict"] in ("match", "ambiguous")
    assert seen[-1][0] == seen[-1][1]
    assert len(found["points"]) >= 30


def test_an_alignment_gives_the_heading_and_keeps_the_search_on_its_line():
    trace = _photo()
    near = offset(*CAMERA, 80.0, 2_000.0)  # straight ahead, in the middle of the photo
    line = finder.Alignment(*near, bearing=260.0, tolerance=1.0, photo_x=0.0)
    plan = finder.Plan(area=_square(CAMERA, 1_500.0), reach=REACH, spacing=250.0, fine=250.0, alignments=(line,))
    found = finder.search(plan, trace)
    for point in found["points"]:
        assert finder.on_lines((line,), np.array([point["lat"]]), np.array([point["lon"]]))[0]
    best = found["places"][0]
    assert terrain.distance(best["lat"], best["lon"], *CAMERA) < 400.0
    assert best["heading"] == pytest.approx(80.0, abs=3.5)


def test_a_search_stops_when_asked():
    plan = finder.Plan(area=_square(CAMERA, 1_500.0), reach=REACH, spacing=500.0, fine=500.0)
    with pytest.raises(finder.Cancelled):
        finder.search(plan, _photo(), cancelled=lambda: True)


def test_two_places_about_as_good_and_apart_are_ambiguous():
    places = [{"lat": 45.0, "lon": 6.0, "explained": 0.8}, {"lat": 45.1, "lon": 6.0, "explained": 0.78}]
    assert finder.verdict(places) == "ambiguous"
    # a rival clearly below the best does not make it ambiguous, however far away
    assert finder.verdict([places[0], {**places[1], "explained": 0.7}]) == "match"
    # nearer than that, they are one hot spot
    assert finder.verdict([places[0], {**places[1], "lat": 45.015}]) == "match"
    assert finder.verdict(places[:1]) == "match"
    assert finder.verdict([{**places[0], "explained": 0.4}]) == "loose"
    assert finder.verdict([{**places[0], "explained": 0.1}]) == "none"
    assert finder.verdict([{**places[0], "verdict": "flat"}]) == "flat"
    assert finder.verdict([]) == "none"
    # a best place no higher than the area's top tenth stands out of nothing
    crowd = [{"lat": 45.0, "lon": 6.0 + i / 1000, "explained": 0.70 + (i % 5) / 100} for i in range(40)]
    rise = finder.standout([places[0] | {"explained": 0.75}], crowd)
    assert rise == pytest.approx(0.01)
    assert finder.verdict([places[0] | {"explained": 0.75}], rise) == "unclear"
    assert finder.verdict(places[:1], finder.standout(places[:1], crowd)) == "match"
    assert finder.standout(places[:1], crowd[:5]) is None


# -- the searches a case keeps ----------------------------------------------------


def _ask(**change):
    trace = _photo()
    body = {
        "title": "Ridge search",
        "trace": {"x": trace.x.tolist(), "y": trace.y.tolist(), "half_width": HALF, "fov": 40.0, "known": True},
        "area": [{"lat": lat, "lon": lon} for lat, lon in _square(offset(*CAMERA, 60.0, 600.0), 1_500.0)],
        "reach": int(REACH),
        "spacing": 500.0,
    }
    body.update(change)
    return body


def test_a_search_is_kept_in_the_case_runs_and_lists(client):
    case_id = client.post("/api/cases", json={"name": "Finder"}).json()["id"]
    started = client.post(f"/api/cases/{case_id}/horizon/finds", json=_ask())
    assert started.status_code == 200, started.text
    name = started.json()["name"]
    assert name == "Ridge search"
    workqueue.wait_until_idle(timeout=120)
    record = client.get(f"/api/cases/{case_id}/horizon/finds/{name}").json()
    assert record["status"] == "done", record.get("error")
    best = record["result"]["places"][0]
    assert terrain.distance(best["lat"], best["lon"], *CAMERA) < 600.0
    [row] = client.get(f"/api/cases/{case_id}/horizon/finds").json()
    assert row["name"] == name and row["status"] == "done" and row["best"]["explained"] > 0.5
    # the same title again takes the next free name
    again = client.post(f"/api/cases/{case_id}/horizon/finds", json=_ask()).json()["name"]
    assert again != name
    client.post(f"/api/cases/{case_id}/horizon/finds/{again}/cancel")
    workqueue.wait_until_idle(timeout=120)
    assert client.get(f"/api/cases/{case_id}/horizon/finds/{again}").json()["status"] in ("cancelled", "done")
    deleted = client.delete(f"/api/cases/{case_id}/horizon/finds/{name}")
    assert deleted.status_code == 200, deleted.text
    assert client.get(f"/api/cases/{case_id}/horizon/finds/{name}").status_code == 404


def test_a_search_says_its_size_first_and_refuses_what_it_cannot_run(client):
    estimate = client.post("/api/horizon/finds/estimate", json=_ask()).json()
    assert estimate["coarse"] > 0 and estimate["step"] == 0.5
    case_id = client.post("/api/cases", json={"name": "Refused searches"}).json()["id"]
    url = f"/api/cases/{case_id}/horizon/finds"
    tiny = [{"lat": 45.0, "lon": 6.0}, {"lat": 45.0001, "lon": 6.0}, {"lat": 45.0, "lon": 6.0001}]
    for change in (
        {"area": tiny},
        {"area": _ask()["area"][:2]},
        {"reach": 12_345},
        {"who": {"mode": "drone", "low": 200, "high": 50}},
        {"trace": {**_ask()["trace"], "fov": 200.0}},
    ):
        assert client.post(url, json=_ask(**change)).status_code == 422
    assert client.get(f"{url}/nothing").status_code == 404
