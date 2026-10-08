"""The horizon: what can be seen from a point, on relief whose answer is known."""

import math

import numpy as np
import pytest

from azimut.engine import horizon, terrain
from fakerelief import Peak, Relief, offset

EYE = (45.0, 6.0)
NEAR = Peak(*offset(*EYE, 60.0, 10_000.0), height=600.0, radius=800.0)
FAR = Peak(*offset(*EYE, 60.0, 30_000.0), height=3000.0, radius=1500.0)
LONE = Peak(*offset(*EYE, 200.0, 20_000.0), height=2000.0, radius=1500.0)


@pytest.fixture()
def relief():
    return Relief(peaks=(NEAR, FAR, LONE))


def _sampler(relief):
    return terrain.Sampler(fetch=relief)


def _dense_skyline(relief, bearing, altitude, far):
    """The highest angle along one bearing, from the analytic field at 5 m steps."""
    d = np.arange(5.0, far, 5.0)
    lat, lon = terrain.destination(*EYE, bearing, d)
    return math.degrees(float(np.max(horizon.elevation_angle(d, relief.height(lat, lon), altitude))))


def test_the_earth_hides_about_680_m_at_100_km():
    radius = horizon.effective_radius()
    hidden = radius * (1 / math.cos(100_000 / radius) - 1)
    assert hidden == pytest.approx(683.0, abs=1.0)
    assert float(horizon.elevation_angle(100_000.0, hidden, 0.0)) == pytest.approx(0.0, abs=1e-9)


def test_without_refraction_the_earth_hides_more():
    plain = horizon.effective_radius(0.0)
    assert plain == pytest.approx(terrain.EARTH_RADIUS)
    assert horizon.elevation_angle(100_000.0, 0.0, 0.0, k=0.0) < horizon.elevation_angle(
        100_000.0, 0.0, 0.0)


def test_rays_are_sampled_finely_near_and_coarsely_far():
    d = horizon.ray_distances(150_000.0)
    assert d[0] == horizon.NEAR_STEP and d[-1] >= 150_000.0
    steps = np.diff(d)
    assert np.all(steps > 0)
    assert steps.max() <= d[-1] * horizon.STEP_RATIO * 1.01
    assert d.size < 2500  # the cost of a ray, bounded


def test_rays_never_go_past_the_ceiling():
    assert horizon.ray_distances(10_000_000.0)[-1] <= horizon.FAR_MAX * (1 + horizon.STEP_RATIO)


def test_the_skyline_matches_a_dense_march_of_the_true_field(relief):
    found = horizon.sweep(
        horizon.Observer(*EYE), azimuths=[60.0, 200.0], far=60_000, sampler=_sampler(relief)
    )
    for column, bearing in enumerate((60.0, 200.0)):
        expected = _dense_skyline(relief, bearing, found.altitude, 60_000)
        assert found.skyline[column] == pytest.approx(expected, abs=0.02)


def test_a_lone_peak_stands_where_it_is(relief):
    azimuths = np.arange(150.0, 250.0, 0.25)
    found = horizon.sweep(
        horizon.Observer(*EYE), azimuths=azimuths, far=60_000, sampler=_sampler(relief)
    )
    top = int(np.argmax(found.skyline))
    assert azimuths[top] == pytest.approx(200.0, abs=0.5)
    assert found.skyline_distance[top] == pytest.approx(20_000.0, rel=0.05)


def test_a_nearer_ridge_is_drawn_in_front_of_the_skyline(relief):
    found = horizon.sweep(
        horizon.Observer(*EYE), azimuths=[60.0], far=60_000, sampler=_sampler(relief)
    )
    angles, distances = found.ridge_angle, found.ridge_distance
    assert np.all(found.ridge_column == 0)
    near = distances[np.abs(distances - 10_000) < 1_500]
    assert near.size >= 1
    # the farthest ridge is the skyline itself
    assert distances.max() == pytest.approx(30_000.0, rel=0.05)
    assert angles[np.argmax(distances)] == pytest.approx(found.skyline[0], abs=1e-3)
    assert angles[np.abs(distances - 10_000) < 1_500].max() < found.skyline[0]


def test_the_picture_stacks_depth_upward_and_ends_in_sky(relief):
    rows = np.arange(10.0, -5.0, -0.05)
    found = horizon.sweep(
        horizon.Observer(*EYE), azimuths=[60.0, 200.0], rows=rows, far=60_000,
        sampler=_sampler(relief),
    )
    depth = found.depth
    assert depth.shape == (rows.size, 2)
    for column in range(2):
        ground = depth[:, column][~np.isnan(depth[:, column])]
        # top-down rows: a pixel higher in the picture never shows nearer ground
        assert np.all(np.diff(ground) <= 1e-3)
        above = rows > found.skyline[column] + 0.05
        assert np.all(np.isnan(depth[above, column]))
    just_under = int(np.argmax(rows < found.skyline[0] - 0.06))
    assert depth[just_under, 0] == pytest.approx(30_000.0, rel=0.08)
    # one degree down from a 1.7 m eye meets the plain about 97 m out
    assert depth[int(np.argmin(np.abs(rows + 1.0))), 1] == pytest.approx(97.0, rel=0.1)


def _lit(found, row, column, azimuth, altitude):
    """Lambert light on a pixel, from its normal, as the browser computes it."""
    east, north = found.normal_east[row, column], found.normal_north[row, column]
    up = math.sqrt(max(0.0, 1 - east**2 - north**2))
    a, h = math.radians(azimuth), math.radians(altitude)
    return east * math.sin(a) * math.cos(h) + north * math.cos(a) * math.cos(h) + up * math.sin(h)


def test_the_normals_face_the_eye_on_the_slope_it_sees(relief):
    rows = np.arange(6.0, -2.0, -0.05)
    found = horizon.sweep(
        horizon.Observer(*EYE), azimuths=[199.5, 200.0, 200.5], rows=rows, far=40_000,
        sampler=_sampler(relief),
    )
    face = int(np.argmax(rows < found.skyline[1] - 1.0))
    # the lone peak stands to the south-south-west: the face seen leans back
    # toward the eye, so light from behind the eye lights it, light from behind
    # the peak does not
    assert _lit(found, face, 1, 20.0, 30.0) > _lit(found, face, 1, 200.0, 30.0)
    # a normal is a unit vector: its flat part never exceeds one
    flat = np.hypot(found.normal_east, found.normal_north)
    assert flat.max() <= 1.0
    # and the sky has none
    sky = np.isnan(found.depth)
    assert np.all(found.normal_east[sky] == 0) and np.all(found.normal_north[sky] == 0)


def test_a_drone_sees_lower_angles_than_a_walker(relief):
    walker = horizon.sweep(horizon.Observer(*EYE), azimuths=[60.0], far=60_000,
                           sampler=_sampler(relief))
    drone = horizon.sweep(horizon.Observer(*EYE, mode="drone", height=500.0), azimuths=[60.0],
                          far=60_000, sampler=_sampler(relief))
    assert drone.altitude == pytest.approx(walker.ground + 500.0)
    assert drone.skyline[0] < walker.skyline[0]


def test_an_aircraft_altitude_is_above_the_sea_and_never_underground():
    assert horizon.Observer(*EYE, mode="aircraft", height=5000.0).altitude(1200.0) == 5000.0
    with pytest.raises(horizon.BelowGround):
        horizon.Observer(*EYE, mode="aircraft", height=800.0).altitude(1200.0)


def test_an_aircraft_looks_farther_by_default():
    assert horizon.default_far(horizon.Observer(*EYE, mode="aircraft", height=9000.0)) > (
        horizon.default_far(horizon.Observer(*EYE)))


def test_line_of_sight_sees_a_summit_and_not_what_hides_behind_a_ridge(relief):
    eye = horizon.Observer(*EYE)
    # The very top of a round summit seen from below sits just behind its own
    # shoulder: a hair out of sight, which is why a label allows a tolerance.
    _seen, _angle, bare = horizon.line_of_sight(eye, LONE.lat, LONE.lon, sampler=_sampler(relief))
    assert -0.05 < bare < 0.05
    seen, _angle, margin = horizon.line_of_sight(
        eye, LONE.lat, LONE.lon, target_height=30.0, sampler=_sampler(relief))
    assert seen and margin > 0
    behind = offset(*EYE, 60.0, 11_500.0)
    seen, _angle, margin = horizon.line_of_sight(eye, *behind, sampler=_sampler(relief))
    assert not seen and margin < -1.0
    seen, _angle, _margin = horizon.line_of_sight(
        eye, FAR.lat, FAR.lon, target_height=30.0, sampler=_sampler(relief))
    assert seen


def test_a_mast_can_rise_into_sight(relief):
    eye = horizon.Observer(*EYE)
    behind = offset(*EYE, 60.0, 11_500.0)
    hidden, _a, low = horizon.line_of_sight(eye, *behind, sampler=_sampler(relief))
    tall, _a, high = horizon.line_of_sight(eye, *behind, target_height=2_000.0,
                                           sampler=_sampler(relief))
    assert not hidden and tall and high > low


def test_a_full_turn_reads_a_bounded_number_of_tiles(relief):
    sampler = _sampler(relief)
    found = horizon.sweep(horizon.Observer(*EYE), azimuths=np.arange(0.0, 360.0, 1.0),
                          sampler=sampler)
    assert len(set(relief.calls)) == len(relief.calls)
    assert len(relief.calls) <= 160
    assert found.zooms <= set(range(terrain.MAX_ZOOM + 1))
    assert found.sources == {"mapterhorn"}


def test_bands_cover_every_sample_once():
    zooms = horizon.lod_zooms(horizon.ray_distances(150_000.0), 45.0)
    assert np.all(np.diff(zooms) <= 0)  # coarser with distance
    covered = np.zeros(zooms.size, dtype=int)
    for zoom, band in horizon._bands(zooms):
        assert np.all(zooms[band] == zoom)
        covered[band] += 1
    assert np.all(covered == 1)


def test_a_near_limit_takes_the_hill_in_front_away(relief):
    full = horizon.sweep(horizon.Observer(*EYE), azimuths=[60.0], rows=np.arange(8.0, -3.0, -0.05),
                         far=60_000, sampler=_sampler(relief))
    beyond = horizon.sweep(horizon.Observer(*EYE), azimuths=[60.0], rows=np.arange(8.0, -3.0, -0.05),
                           far=60_000, near=15_000, sampler=_sampler(relief))
    assert np.nanmin(full.depth) < 1_000
    assert np.nanmin(beyond.depth) >= 15_000
    # the far peak is still the skyline either way
    assert beyond.skyline[0] == pytest.approx(full.skyline[0], abs=1e-6)
    assert not np.any(np.abs(beyond.ridge_distance - 10_000) < 1_500)


def test_normals_on_a_tilted_plane_are_exact_near_and_far():
    """A plane rising 1 in 10 to the east: every sample's normal is the same,
    however close the rays are to each other where they leave the eye."""
    azimuths = np.arange(0.0, 360.0, 0.1)
    distances = horizon.ray_distances(20_000)
    theta = np.radians(azimuths)[:, None]
    east = np.sin(theta) * distances[None, :]
    heights = (0.1 * east).astype(np.float64)
    pixel = np.full(distances.size, 3.3)
    normal_east, normal_north = horizon._normals(heights, distances, azimuths, pixel)
    expected = -0.1 / np.sqrt(1.01)
    # the planar part is exact; only the tightest rays next to the eye round off
    assert np.abs(normal_east[:, 50:] - expected).max() < 2e-3
    assert np.abs(normal_north[:, 50:]).max() < 2e-3


def test_normals_of_a_window_of_the_turn_stay_inside_it():
    azimuths = np.arange(80.0, 100.0, 0.05)
    distances = horizon.ray_distances(5_000)
    theta = np.radians(azimuths)[:, None]
    heights = 0.2 * np.cos(theta) * distances[None, :]  # rises northward
    normal_east, normal_north = horizon._normals(
        heights, distances, azimuths, np.full(distances.size, 3.3)
    )
    assert np.abs(normal_north[:, 50:] + 0.2 / np.sqrt(1.04)).max() < 3e-3
    assert np.abs(normal_east[:, 50:]).max() < 3e-3


def test_full_detail_reads_the_finest_terrain_out_to_its_reach_and_no_farther():
    eye = horizon.Observer(*EYE)
    usual = horizon.lod_zooms(np.array([500.0, 5_000.0, 15_000.0, 60_000.0]), EYE[0])
    full = horizon.lod_zooms(np.array([500.0, 5_000.0, 15_000.0, 60_000.0]), EYE[0], full_detail=True)
    assert full[:3].tolist() == [terrain.MAX_ZOOM] * 3
    assert usual[2] < terrain.MAX_ZOOM
    assert full[3] == usual[3]
    rays = horizon.detail_distances(150_000.0)
    assert np.all(np.diff(rays) > 0)
    near = rays[rays <= horizon.FULL_DETAIL_REACH]
    # steps a few metres long at the reach, where the usual ray steps sixty
    assert np.diff(near)[-1] < 40
    assert rays[-1] == pytest.approx(horizon.ray_distances(150_000.0)[-1], rel=0.01)
    found = horizon.sweep(eye, azimuths=np.arange(55.0, 65.0, 1.0), far=40_000.0,
                          sampler=_sampler(Relief(peaks=(NEAR, FAR))), full_detail=True)
    assert terrain.MAX_ZOOM in found.zooms
    # the same skyline either way, to the terrain's own precision
    usual_sweep = horizon.sweep(eye, azimuths=np.arange(55.0, 65.0, 1.0), far=40_000.0,
                                sampler=_sampler(Relief(peaks=(NEAR, FAR))))
    assert np.allclose(found.skyline, usual_sweep.skyline, atol=0.05)
