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


def test_one_bounded_reader_shared_by_many_threads_reads_the_same_turn(relief):
    """A sweep reads with several threads through one reader: a reader holding few tiles lets tiles go while
    another thread adds its own, which once broke a search ("OrderedDict mutated during iteration")."""
    alone = horizon.sweep(horizon.Observer(*EYE), azimuths=np.arange(0.0, 360.0, 2.0), far=40_000.0,
                          sampler=_sampler(relief), workers=1)
    for _ in range(3):
        shared = horizon.sweep(horizon.Observer(*EYE), azimuths=np.arange(0.0, 360.0, 2.0), far=40_000.0,
                               sampler=terrain.Sampler(fetch=relief, keep=4), workers=8)
        assert np.allclose(shared.skyline, alone.skyline, equal_nan=True)


def _no_survey_past_the_planet(relief):
    """The relief as Mapterhorn serves most of the world: no tile deeper than the planet's level."""
    def fetch(z, x, y):
        return None if z > terrain.PLANET_ZOOM else relief(z, x, y)
    return fetch


@pytest.mark.parametrize("survey", [True, False])
def test_a_sweep_skipping_hidden_ground_finds_what_a_full_read_finds(survey):
    """A sweep whose reader keeps its plates reads only the stretches of ray that may rise into sight
    (`horizon._seen_angles`): the skyline, its distances, the cuts and the ridges are the full read's, to the
    bit, whether the deep levels exist or the reads climb to the planet's."""
    relief = Relief(peaks=(NEAR, FAR, LONE), ripple=40.0)
    fetch = relief if survey else _no_survey_past_the_planet(relief)
    plain, kept = terrain.Sampler(fetch=fetch), terrain.Sampler(fetch=fetch, plates=True)
    read = {"plain": 0, "kept": 0}
    for name, sampler in (("plain", plain), ("kept", kept)):
        heights = sampler.heights

        def counted(lat, lon, zoom, heights=heights, name=name):
            read[name] += np.size(lat)
            return heights(lat, lon, zoom)

        sampler.heights = counted  # type: ignore[method-assign]
    for bearing, metres in ((0.0, 0.0), (60.0, 7_000.0), (250.0, 3_000.0)):
        eye = horizon.Observer(*offset(*EYE, bearing, metres), "ground", 1.7)
        kw = dict(azimuths=np.arange(0.0, 360.0, 1.0), far=50_000.0, cuts=(5_000.0, 20_000.0), near_step=25.0)
        a = horizon.sweep(eye, sampler=plain, **kw)
        b = horizon.sweep(eye, sampler=kept, **kw)
        for field_ in ("skyline", "skyline_distance", "skyline_cuts", "skyline_cuts_distance", "ridge_column",
                       "ridge_angle", "ridge_distance"):
            assert np.array_equal(getattr(a, field_), getattr(b, field_), equal_nan=True), field_
    # most of the ground stands behind nearer ground
    assert read["kept"] < 0.6 * read["plain"]


def test_a_kept_plate_reads_what_a_fresh_mosaic_reads():
    """Plates kept between reads, grown and let go, give every height a mosaic laid out for the read alone gives."""
    relief = Relief(peaks=(NEAR, FAR, LONE), ripple=40.0)
    for fetch in (relief, _no_survey_past_the_planet(relief)):
        plain, kept = terrain.Sampler(fetch=fetch), terrain.Sampler(fetch=fetch, plates=True)
        rng = np.random.default_rng(3)
        for step in range(12):
            centre = offset(*EYE, 30.0 * step, 4_000.0 * (step % 4))
            lat = centre[0] + rng.uniform(-0.03, 0.03, 5_000)
            lon = centre[1] + rng.uniform(-0.03, 0.03, 5_000)
            for zoom in (14, 12, 10):
                assert np.array_equal(plain.heights(lat, lon, zoom), kept.heights(lat, lon, zoom))


def test_a_level_known_empty_is_read_a_level_down_at_once(monkeypatch):
    """Where the plate knows no tile exists this deep, a read starts at the level its points would climb to: the
    same heights, without placing every point on the empty levels first."""
    fetch = _no_survey_past_the_planet(Relief(peaks=(NEAR, FAR, LONE), ripple=40.0))
    plain, kept = terrain.Sampler(fetch=fetch), terrain.Sampler(fetch=fetch, plates=True)
    rng = np.random.default_rng(4)
    lat = EYE[0] + rng.uniform(-0.01, 0.01, 2_000)
    lon = EYE[1] + rng.uniform(-0.01, 0.01, 2_000)
    expected = plain.heights(lat, lon, 14)
    # the first read learns the deep levels are empty there
    assert np.array_equal(kept.heights(lat, lon, 14), expected)
    placed: list[tuple[int, int]] = []
    pixels = terrain._pixels
    monkeypatch.setattr(terrain, "_pixels", lambda la, lo, z: placed.append((z, np.size(la))) or pixels(la, lo, z))
    assert np.array_equal(kept.heights(lat, lon, 14), expected)
    assert (terrain.PLANET_ZOOM, lat.size) in placed
    assert all(size <= 2 for zoom, size in placed if zoom > terrain.PLANET_ZOOM)


def test_a_ceiling_stands_over_every_read_between_its_ends():
    relief = Relief(peaks=(NEAR, FAR, LONE), ripple=40.0)
    for fetch in (relief, _no_survey_past_the_planet(relief)):
        sampler = terrain.Sampler(fetch=fetch, plates=True)
        rng = np.random.default_rng(5)
        bearings = rng.uniform(0.0, 360.0, 400)
        # each level over the ring a sweep reads it on
        for zoom, (inner, outer) in ((14, (100.0, 1_500.0)), (11, (2_000.0, 15_000.0))):
            near = rng.uniform(inner, outer, 400)
            span = terrain.metres_per_pixel(EYE[0], zoom) * 30.0
            lat0, lon0 = terrain.destination(*EYE, bearings, near)
            lat1, lon1 = terrain.destination(*EYE, bearings, near + span)
            top = sampler.ceiling(lat0, lon0, lat1, lon1, zoom)
            between = near[:, None] + span * np.linspace(0.0, 1.0, 31)[None, :]
            lat, lon = terrain.destination(*EYE, bearings[:, None], between)
            assert (sampler.heights(lat, lon, zoom) <= top[:, None]).all()
            # and close to it: a bound this loose would skip nothing
            assert np.median(top - sampler.heights(lat, lon, zoom).max(axis=1)) < 60.0


@pytest.mark.parametrize("lat", [0.0, 35.98, 60.1, -33.3])
def test_each_sample_reads_the_level_zoom_for_names(lat):
    distances = horizon.ray_distances(150_000.0, 25.0)
    expected = [terrain.zoom_for(max(d * horizon.LOD_RATIO, 1.0), lat) for d in distances]
    assert horizon.lod_zooms(distances, lat).tolist() == expected


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




def test_a_cut_keeps_the_skyline_haze_would_leave(relief):
    eye = horizon.Observer(*EYE, "ground", 1.7)
    found = horizon.sweep(eye, azimuths=[60.0, 200.0], far=60_000.0, sampler=_sampler(relief),
                          cuts=(15_000.0, 60_000.0))
    assert found.cuts[0] == pytest.approx(15_000.0, rel=horizon.STEP_RATIO)
    assert found.skyline_cuts.shape == (2, 2)
    # toward 60°, inside 15 km only the near peak at 10 km stands; the far one at 30 km rises over it
    within = horizon.sweep(eye, azimuths=[60.0], far=15_000.0, sampler=_sampler(relief))
    assert found.skyline_cuts[0, 0] == pytest.approx(float(within.skyline[0]), abs=1e-9)
    assert found.skyline_cuts[1, 0] == pytest.approx(float(found.skyline[0]), abs=1e-9)
    assert found.skyline_cuts[1, 0] > found.skyline_cuts[0, 0] + 1.0
    # toward 200° the lone peak is 20 km out: the cut at 15 km stops short of it
    assert found.skyline_cuts[0, 1] < found.skyline_cuts[1, 1]


def test_each_cut_says_how_far_its_skyline_stands(relief):
    eye = horizon.Observer(*EYE, "ground", 1.7)
    found = horizon.sweep(eye, azimuths=[60.0, 200.0], far=60_000.0, sampler=_sampler(relief),
                          cuts=(15_000.0, 60_000.0))
    assert found.skyline_cuts_distance.shape == found.skyline_cuts.shape
    # within its reach, and the outermost cut's is the whole turn's
    assert (found.skyline_cuts_distance[0] <= found.cuts[0] + 1e-6).all()
    assert (found.skyline_cuts_distance[0] > 0).all()
    assert found.skyline_cuts_distance[1] == pytest.approx(found.skyline_distance)


def test_a_sweep_without_cuts_has_none(relief):
    found = horizon.sweep(horizon.Observer(*EYE, "ground", 1.7), azimuths=[60.0], far=20_000.0,
                          sampler=_sampler(relief))
    assert found.cuts.size == 0 and found.skyline_cuts.shape[0] == 0


# -- the viewshed --------------------------------------------------------------


def _in_sight(found, azimuth, distance):
    """Whether the viewshed holds the ground `distance` m out along `azimuth`."""
    ray = int(round(azimuth / (360.0 / found.azimuths.size))) % found.azimuths.size
    runs = found.runs[ray].reshape(-1, 2)
    return bool(np.any((runs[:, 0] <= distance) & (distance <= runs[:, 1])))


def test_a_viewshed_sees_the_face_of_a_hill_and_not_the_ground_behind_it(relief):
    found = horizon.viewshed(horizon.Observer(*EYE), far=15_000, sampler=_sampler(relief))
    assert found.azimuths.size == horizon.viewshed_rays(15_000)
    assert _in_sight(found, 60.0, 3_000.0)
    assert _in_sight(found, 60.0, 9_800.0)  # the slope that faces the eye
    assert not _in_sight(found, 60.0, 11_500.0)  # the foot of its far side
    assert 0.0 < found.share < 1.0


def test_on_a_plain_the_viewshed_ends_at_the_horizon_and_a_mast_rises_past_it():
    plain = Relief(peaks=())
    eye = horizon.Observer(*EYE)
    bare = horizon.viewshed(eye, far=12_000, rays=360, sampler=_sampler(plain))
    # from 1.7 m the refracted horizon is about 5 km off: every ray stops there
    for run in bare.runs:
        assert run.size == 2 and run[0] == 0.0
        assert run[1] == pytest.approx(math.sqrt(2 * horizon.effective_radius() * 1.7), rel=0.03)
    mast = horizon.viewshed(eye, far=12_000, rays=360, target_height=10.0, sampler=_sampler(plain))
    assert all(run[-1] == pytest.approx(mast.far) for run in mast.runs)
    assert mast.share == pytest.approx(1.0)
    assert bare.share < 0.25


def test_a_viewshed_is_read_on_rays_a_hundred_metres_apart_at_its_edge():
    assert horizon.viewshed_rays(1_000) == horizon.VIEWSHED_RAYS[0]
    assert horizon.viewshed_rays(10_000) == math.ceil(2 * math.pi * 10_000 / 100)
    assert horizon.viewshed_rays(30_000) == horizon.VIEWSHED_RAYS[1]
