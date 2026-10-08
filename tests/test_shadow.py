"""Shadows cast over a panorama's ground by the sun or the moon."""

import base64
import math
import zlib

import numpy as np
import pytest

from azimut.engine import horizon, shadow, terrain
from fakerelief import Peak, Relief, offset

EYE = (45.0, 6.0)
# a 2 km mountain 6 km east of a point on the plain
FOOT = offset(*EYE, 90.0, 4_000.0)
PEAK = Peak(*offset(*FOOT, 90.0, 6_000.0), height=2000.0, radius=1500.0)


def _lit(point, azimuth, altitude, relief=None):
    relief = relief or Relief((PEAK,))
    sampler = terrain.Sampler(fetch=relief)
    lat, lon = np.array([point[0]]), np.array([point[1]])
    return float(shadow.lit_fraction(lat, lon, np.array([13]), azimuth, altitude, sampler)[0])


def test_a_mountain_shadows_the_plain_behind_it_from_a_low_sun():
    # seen from the foot, the summit stands about 18° high to the east
    assert _lit(FOOT, 90.0, 8.0) == 0.0
    assert _lit(FOOT, 90.0, 40.0) == 1.0


def test_the_same_point_is_lit_with_the_sun_on_its_other_side():
    assert _lit(FOOT, 270.0, 8.0) == 1.0


def test_a_shadow_edge_is_as_soft_as_the_sun_is_wide():
    relief = Relief((PEAK,))
    sampler = terrain.Sampler(fetch=relief)
    lat, lon = np.array([FOOT[0]]), np.array([FOOT[1]])
    # the highest angle the ground ahead stands at, from the point
    blocked = None
    for altitude in np.arange(10.0, 30.0, 0.05):
        value = float(shadow.lit_fraction(lat, lon, np.array([13]), 90.0, float(altitude), sampler)[0])
        if 0.0 < value < 1.0:
            blocked = altitude
            break
    assert blocked is not None, "no altitude gave a part of the disc"
    # a sun a disc higher is clear of it
    assert float(shadow.lit_fraction(lat, lon, np.array([13]), 90.0, blocked + shadow.DISC, sampler)[0]) == 1.0


def test_a_light_under_the_horizon_lights_nothing_and_reads_no_terrain():
    relief = Relief((PEAK,))
    sampler = terrain.Sampler(fetch=relief)
    lit = shadow.lit_fraction(np.array([FOOT[0]]), np.array([FOOT[1]]), np.array([13]), 90.0, -5.0, sampler)
    assert lit.tolist() == [0.0]
    assert relief.calls == []


def test_a_march_stops_once_it_clears_the_highest_ground():
    relief = Relief((PEAK,))
    sampler = terrain.Sampler(fetch=relief)
    shadow.lit_fraction(np.array([FOOT[0]]), np.array([FOOT[1]]), np.array([13]), 270.0, 45.0, sampler)
    # a 45° sun clears 2.5 km of relief within 2.5 km: a few tiles near the point, none far west
    farthest = max(abs(x - terrain._pixels(np.array([FOOT[0]]), np.array([FOOT[1]]), z)[0][0] / terrain.TILE)
                   for z, x, _y in relief.calls)
    assert farthest < 3


def test_a_panorama_s_ground_is_shaded_and_its_sky_left_lit():
    relief = Relief((PEAK,))
    sampler = terrain.Sampler(fetch=relief)
    found = horizon.sweep(
        horizon.Observer(*EYE), azimuths=np.arange(60.0, 120.0, 1.0),
        rows=np.arange(20.0, -10.0, -1.0), far=30_000.0, sampler=sampler,
    )
    assert found.depth is not None
    light = shadow.shadow_panorama(
        EYE[0], EYE[1], found.azimuths, 1.0, found.depth, 90.0, 6.0, sampler,
    )
    assert light.shape == found.depth.shape
    sky = ~np.isfinite(found.depth)
    assert (light[sky] == 255).all()
    # the plain between the eye and the mountain lies in its shadow; the mountain's
    # own face turned to the eye is lit by nothing but is not shadowed by another
    middle = list(found.azimuths).index(90.0)
    column = light[:, middle]
    ground = np.isfinite(found.depth[:, middle])
    near = ground & (found.depth[:, middle] < 6_000.0)
    assert near.any() and (column[near] < 128).all()


def test_levels_follow_the_sweep():
    distances = np.array([10.0, 1_000.0, 20_000.0, 150_000.0])
    assert shadow.levels(distances, 46.5).tolist() == horizon.lod_zooms(distances, 46.5).tolist()


def test_steps_lengthen_and_stop_at_the_longest_march():
    steps = shadow.march_distances(1e9)
    assert steps[0] == shadow.FIRST_STEP
    assert math.isclose(steps[1] / steps[0], 1 + shadow.STEP_RATIO)
    assert steps[-1] >= shadow.MARCH_MAX * 0.99
    assert steps[-1] < shadow.MARCH_MAX * (1 + shadow.STEP_RATIO) + 1


# -- the route --------------------------------------------------------------------

FAR_PEAK = Peak(*offset(*EYE, 90.0, 15_000.0), height=2500.0, radius=1500.0)


@pytest.fixture()
def synthetic_relief(monkeypatch):
    terrain.forget_decoded()
    relief = Relief(peaks=(FAR_PEAK,))
    monkeypatch.setattr(terrain, "tile", relief)
    yield relief
    terrain.forget_decoded()


def _light(body):
    shape = (body["elevation"]["count"], body["azimuth"]["count"])
    return np.frombuffer(zlib.decompress(base64.b64decode(body["light"])), dtype=np.uint8).reshape(shape)


GRID = {"lat": EYE[0], "lon": EYE[1], "step": 1.0, "far": 40_000}


def test_the_light_lies_on_the_picture_just_drawn_one_cell_in_every(client, synthetic_relief):
    picture = client.post("/api/horizon/panorama", json=GRID).json()
    answer = client.post(
        "/api/horizon/shadow", json={**GRID, "light_azimuth": 90.0, "light_altitude": 4.0, "every": 2}
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["azimuth"]["step"] == 2.0 and body["elevation"]["step"] == 2.0
    assert body["elevation"]["top"] == picture["elevation"]["top"]
    assert body["azimuth"]["count"] == 180
    light = _light(body)
    assert (light[0] == 255).all()  # the top row is sky, which is lit
    # a sun low behind the mountain: the plain between it and the eye lies in its shadow
    column = light[:, 45]
    assert (column[-6:] == 0).all()


def test_a_sun_behind_the_eye_casts_no_shadow_on_the_mountain_s_face(client, synthetic_relief):
    client.post("/api/horizon/panorama", json=GRID)
    body = client.post(
        "/api/horizon/shadow", json={**GRID, "light_azimuth": 270.0, "light_altitude": 20.0, "every": 1}
    ).json()
    light = _light(body)
    assert (light[:, 90] == 255).all()


def test_a_shadow_with_no_picture_kept_draws_one(client, synthetic_relief):
    answer = client.post(
        "/api/horizon/shadow", json={**GRID, "step": 0.5, "light_azimuth": 90.0, "light_altitude": 30.0}
    )
    assert answer.status_code == 200, answer.text


@pytest.mark.parametrize("light", [{"light_azimuth": 360.0, "light_altitude": 10.0},
                                   {"light_azimuth": 10.0, "light_altitude": 95.0}])
def test_a_light_out_of_the_sky_is_refused(client, synthetic_relief, light):
    assert client.post("/api/horizon/shadow", json={**GRID, **light}).status_code == 422


def test_a_large_picture_is_marched_one_cell_in_a_few(client, synthetic_relief, monkeypatch):
    from azimut.api import horizon as horizon_api

    monkeypatch.setattr(horizon_api, "SHADOW_CELLS", 2_000)
    client.post("/api/horizon/panorama", json=GRID)
    body = client.post("/api/horizon/shadow", json={**GRID, "light_azimuth": 90.0, "light_altitude": 30.0}).json()
    ground = body["azimuth"]["count"] * body["elevation"]["count"]
    assert body["azimuth"]["step"] > 1.0
    assert ground <= 4 * 2_000
