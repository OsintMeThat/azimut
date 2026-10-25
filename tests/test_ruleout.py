"""Points ruled out before any sweep: the sea and the lakes off the map, the eye above or below the land round it."""

import numpy as np
import pytest

from azimut import config
from azimut.engine import finder, horizon, mvt, peaks, ruleout, skymatch, terrain, water
from fakerelief import Peak, Relief, offset
from skyturns import HALF, trace_on

HILL = (45.0, 6.0)
# the map's tiles the tests draw water on: the one holding the lake's middle, at the map's level
LAKE = (10.0, 20.0)


@pytest.fixture(autouse=True)
def synthetic_ground(monkeypatch, tmp_path):
    terrain.forget_decoded()
    water.forget()
    monkeypatch.setattr(config, "internal_dir", lambda: tmp_path)
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(Peak(*HILL, height=600.0, radius=700.0),), plain=200.0, ripple=0.5))
    yield
    terrain.forget_decoded()
    water.forget()


def _tile_of(lat, lon, zoom=water.ZOOM):
    px, py = terrain._pixels(np.array([lat]), np.array([lon]), zoom)
    scale = water.SIDE / terrain.TILE
    return int((px[0] + 0.5) * scale) // water.SIDE, int((py[0] + 0.5) * scale) // water.SIDE


def _map(drawn):
    """A map whose `water` layer holds rectangles (fractions of a tile) of a class, on the tiles named."""
    asked = []

    def fetch(z, x, y):
        asked.append((z, x, y))
        layer = mvt.Layer("water")
        for kind, (x0, y0, x1, y1) in drawn.get((x, y), []):
            layer.rectangles(np.array([x0 * mvt.EXTENT]), np.array([y0 * mvt.EXTENT]), np.array([x1 * mvt.EXTENT]),
                             np.array([y1 * mvt.EXTENT]), {"class": kind})
        return mvt.encode([layer]) or mvt.encode([mvt.Layer("water")]) or b"", "build"

    return fetch, asked


def test_the_map_lays_the_sea_and_the_lakes_apart_rivers_left_out_and_keeps_them(monkeypatch):
    x, y = _tile_of(*LAKE)
    fetch, asked = _map({(x, y): [("ocean", (0, 0, 0.25, 1)), ("lake", (0.5, 0.5, 0.75, 0.75)), ("river", (0.9, 0, 1, 1))]})
    monkeypatch.setattr(peaks, "fetch_vector_tile", fetch)
    sea, lakes = water.masks(water.ZOOM, x, y)
    assert sea[:, :64].all() and not sea[:, 64:].any()
    assert lakes[128:192, 128:192].all() and lakes.sum() == 64 * 64
    # a river is no lake
    assert not lakes[:, 240:].any()
    # kept on the disk: read again without asking the map
    water.forget()
    monkeypatch.setattr(peaks, "fetch_vector_tile", lambda *key: pytest.fail("asked the map again"))
    again_sea, again_lakes = water.masks(water.ZOOM, x, y)
    assert (again_sea == sea).all() and (again_lakes == lakes).all()
    assert len(asked) == 1


def test_a_map_that_cannot_be_read_says_nothing(monkeypatch):
    def down(*key):
        raise peaks.PeaksUnavailable("offline")

    monkeypatch.setattr(peaks, "fetch_vector_tile", down)
    assert water.masks(water.ZOOM, 1, 2) is None
    monkeypatch.setattr(peaks, "fetch_vector_tile", lambda *key: (None, "build"))
    assert water.masks(water.ZOOM, 3, 4) is None


def test_a_ring_is_filled_its_hole_left_out():
    outer = [(0.25, 0.25), (0.75, 0.25), (0.75, 0.75), (0.25, 0.75)]
    hole = [(0.4, 0.4), (0.6, 0.4), (0.6, 0.6), (0.4, 0.6)]
    inside = water.fill([outer, hole], side=100)
    assert inside[30, 30] and inside[70, 30] and not inside[50, 50] and not inside[10, 10]
    assert inside.sum() == 50 * 50 - 20 * 20


def test_water_said_rules_out_the_points_with_none_within_reach(monkeypatch):
    x, y = _tile_of(*LAKE)
    fetch, _ = _map({(x, y): [("lake", (0, 0, 1, 1))]})
    monkeypatch.setattr(peaks, "fetch_vector_tile", fetch)
    near = offset(*LAKE, 90.0, 1_000.0)
    far = offset(*LAKE, 90.0, 120_000.0)
    lat, lon = np.array([LAKE[0], near[0], far[0]]), np.array([LAKE[1], near[1], far[1]])
    plan = finder.Plan(area=[], reach=5_000.0, water=True)
    sampler = terrain.Sampler()
    why = [str(r) for r in ruleout.ruled(plan, lat, lon, sampler)]
    assert why == ["", "", ruleout.NO_WATER]
    # a lake is not the sea: a line along the sea's horizon finds none there
    seen = ruleout.ruled(finder.Plan(area=[], sea=True), lat[:1], lon[:1], sampler)
    assert list(seen) == [ruleout.NO_SEA]
    # said of nothing, nothing is read
    assert list(ruleout.ruled(finder.Plan(area=[]), lat, lon, sampler)) == ["", "", ""]


def test_the_sea_is_looked_for_as_far_as_its_horizon_from_the_eye(monkeypatch):
    x, y = _tile_of(*LAKE)
    fetch, _ = _map({(x, y): [("ocean", (0, 0, 1, 1))]})
    monkeypatch.setattr(peaks, "fetch_vector_tile", fetch)
    sampler = terrain.Sampler()
    plan = finder.Plan(area=[], sea=True)
    # an eye 200 m over the sea sees its horizon about 50 km out: the sea 30 km off is in sight, 160 km off not
    shore = offset(*LAKE, 90.0, 30_000.0)
    inland = offset(*LAKE, 90.0, 160_000.0)
    assert list(ruleout.ruled(plan, np.array([shore[0]]), np.array([shore[1]]), sampler)) == [""]
    assert list(ruleout.ruled(plan, np.array([inland[0]]), np.array([inland[1]]), sampler)) == [ruleout.NO_SEA]


def test_without_the_map_the_flat_ground_of_the_terrain_stands_for_water(monkeypatch):
    monkeypatch.setattr(peaks, "fetch_vector_tile", lambda *key: (None, "build"))
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(), plain=200.0, ripple=3.0))
    sampler = terrain.Sampler()
    # the plain swells by a few metres: no water anywhere, so a point is ruled out
    point = offset(*LAKE, 0.0, 5_000.0)
    assert list(ruleout.ruled(finder.Plan(area=[], reach=5_000.0, water=True), np.array([point[0]]), np.array([point[1]]), sampler)) == [ruleout.NO_WATER]
    # a plain flat to the centimetre is water to the terrain, and keeps its points
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(), plain=200.0))
    terrain.forget_decoded()
    assert list(ruleout.ruled(finder.Plan(area=[], reach=5_000.0, water=True), np.array([point[0]]), np.array([point[1]]), terrain.Sampler())) == [""]


def test_the_eye_said_above_or_below_the_land_round_it(monkeypatch):
    # a valley ringed by hills 2 km out, and one hill standing alone
    valley = offset(*HILL, 0.0, 15_000.0)
    ring = tuple(Peak(*offset(*valley, bearing, 2_000.0), height=400.0, radius=800.0) for bearing in range(0, 360, 45))
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(Peak(*HILL, height=600.0, radius=700.0), *ring), plain=200.0, ripple=0.5))
    sampler = terrain.Sampler()
    top = HILL
    plain = offset(*HILL, 180.0, 20_000.0)
    lat = np.array([top[0], valley[0], plain[0]])
    lon = np.array([top[1], valley[1], plain[1]])
    risen = ruleout.rise(lat, lon, sampler)
    assert risen[0] > 300 and risen[1] < -100 and abs(risen[2]) < 1
    above = ruleout.ruled(finder.Plan(area=[], over="above"), lat, lon, sampler)
    below = ruleout.ruled(finder.Plan(area=[], over="below"), lat, lon, sampler)
    # a plain is about level with the land round it: kept either way, within the slack
    assert list(above) == ["", ruleout.LOW, ""]
    assert list(below) == [ruleout.HIGH, "", ""]


def test_the_preview_greys_what_is_ruled_out_and_the_search_never_scores_it():
    area = [terrain.destination(*HILL, bearing, 2_500.0 * 2**0.5) for bearing in (45, 135, 225, 315)]
    plan = finder.Plan(area=[(float(a), float(o)) for a, o in area], spacing=400.0, over="below")
    shown = finder.preview(plan)
    ruled = [point for point in shown["points"] if point[2] == ruleout.HIGH]
    assert ruled and shown["ruled"] == {ruleout.HIGH: len(ruled)}
    assert not any(point[3] for point in ruled)
    assert shown["kept"] == shown["total"] - len(ruled)
    # the points ruled out are never scored, the coarse grid's nor those refined about the best
    lat, lon = finder.grid(plan, 400.0)
    heard: list[dict] = []
    with pytest.raises(finder.Cancelled):
        finder.search(plan, _trace(), scored_one=heard.append, cancelled=lambda: len(heard) >= 40)
    risen = ruleout.rise(np.array([p["lat"] for p in heard]), np.array([p["lon"] for p in heard]), terrain.Sampler())
    assert heard and (risen <= ruleout.OVER_SLACK_M).all()
    assert lat.size > len(shown["points"]) - len(ruled)


def _trace():
    """The trace an eye 3 km south-west of the hill sees, facing it."""
    eye = offset(*HILL, 200.0, 3_000.0)
    swept = horizon.sweep(horizon.Observer(*eye), azimuths=np.arange(0.0, 360.0, 0.5), far=10_000.0)
    x, y = trace_on(skymatch.Turn(0.0, 0.5, swept.skyline), heading=20.0, fov=40.0)
    return finder.Trace(x=x, y=y, half_width=HALF, fov=40.0, known=True)


def test_the_preview_is_asked_with_what_the_photo_shows(client):
    area = [{"lat": float(a), "lon": float(o)} for a, o in (terrain.destination(*HILL, b, 3_500.0) for b in (45, 135, 225, 315))]
    shown = client.post("/api/horizon/finds/preview", json={"area": area, "spacing": 400.0, "over": "below"})
    assert shown.status_code == 200, shown.text
    assert shown.json()["ruled"].get(ruleout.HIGH, 0) > 0
    plain = client.post("/api/horizon/finds/preview", json={"area": area, "spacing": 400.0}).json()
    assert plain["ruled"] == {} and plain["kept"] == plain["total"]
    for wrong in ({"over": "sideways"}, {"water": "lots"}):
        assert client.post("/api/horizon/finds/preview", json={"area": area, **wrong}).status_code == 422
