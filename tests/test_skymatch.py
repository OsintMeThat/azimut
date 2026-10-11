"""Where a traced skyline lies on a turn: heading, lens and tilt, and the verdict."""

import numpy as np
import pytest

from azimut.engine import skymatch
from skyturns import HALF, RANGE, STEP, skyturn, trace_on

# camera.js `rayFor` at heading 0 for these points (x, y on the picture plane in half
# widths), lens, tilt and roll: azimuth and elevation, computed by the browser's own code.
RAYS = [
    (-0.8, 0.1, 60, 0, 0, -24.791281, 3.000369),
    (0.76, 0.46, 60, 0, 0, 23.691203, 13.668918),
    (0.28, -0.52, 60, 0, 0, 9.182882, -16.50848),
    (-0.8, 0.1, 45, 7, 0, -18.550004, 8.892998),
    (0.76, 0.46, 45, 7, 0, 17.991948, 16.969049),
    (0.28, -0.52, 45, 7, 0, 6.494597, -5.122387),
    (-0.8, 0.1, 80, -5, 4, -33.377022, 2.035322),
    (0.76, 0.46, 80, -5, 4, 32.877079, 11.66153),
    (0.28, -0.52, 80, -5, 4, 12.03197, -28.76661),
    (-0.8, 0.1, 20, 25, -10, -8.874446, 24.33139),
    (0.76, 0.46, 20, 25, -10, 7.781136, 30.656162),
    (0.28, -0.52, 20, 25, -10, 3.92442, 20.284179),
]


@pytest.mark.parametrize("x, y, fov, tilt, roll, azimuth, elevation", RAYS)
def test_directions_are_the_browsers_camera(x, y, fov, tilt, roll, azimuth, elevation):
    az, el = skymatch.directions(np.array([x]), np.array([y]), fov=fov, tilt=tilt, roll=roll)
    assert az[0] == pytest.approx(azimuth, abs=1e-5)
    assert el[0] == pytest.approx(elevation, abs=1e-5)


def test_the_turn_reads_between_columns_and_round_north():
    turn = skymatch.Turn(0.0, 1.0, np.arange(360.0))
    assert turn.at(np.array([10.25]))[0] == pytest.approx(10.25)
    # past the last column the turn comes back to the first
    assert turn.at(np.array([359.5]))[0] == pytest.approx(179.5)
    assert turn.at(np.array([-1.0]))[0] == pytest.approx(359.0)


def test_a_column_without_ground_takes_its_neighbours_value():
    angles = np.array([1.0, np.nan, 3.0, 4.0])
    turn = skymatch.Turn(0.0, 90.0, angles)
    assert turn.at(np.array([45.0]))[0] == 1.0
    assert turn.at(np.array([135.0]))[0] == 3.0


def test_a_lens_the_photo_says_is_the_only_one_tried():
    assert skymatch.lenses(52.0, known=True) == [52.0]


def test_an_unknown_lens_is_looked_for_about_the_views_own():
    tried = skymatch.lenses(60.0, known=False)
    assert 60.0 in [pytest.approx(f) for f in tried]
    assert tried == sorted(tried)
    assert min(tried) >= 60 / skymatch.LENS_REACH - 1e-9
    assert max(tried) <= 60 * skymatch.LENS_REACH + 1e-9
    wide = skymatch.lenses(140.0, known=False)
    assert max(wide) == skymatch.FOV_MAX
    assert len(wide) == len(set(wide))  # the steps past the widest lens are one lens, not several
    assert skymatch.lenses(1.0, known=False)[0] == skymatch.FOV_MIN


def test_a_trace_is_found_at_its_heading_lens_and_tilt():
    x, y = trace_on(RANGE, heading=47.0, fov=52.0, tilt=3.0)
    found = skymatch.match(x, y, RANGE, half_width=HALF, fov=60.0, tilt=0.0)
    assert found.verdict == "match"
    best = found.fits[0]
    assert best.heading == pytest.approx(47.0, abs=0.3)
    assert best.fov == pytest.approx(52.0, rel=0.03)
    assert best.tilt == pytest.approx(3.0, abs=0.3)
    assert best.explained > 0.9
    assert best.points == x.size


def test_a_wide_lens_tilted_down_is_found_too():
    # a tilt bends the trace across a wide lens: it is not a shift up or down
    x, y = trace_on(RANGE, heading=228.0, fov=80.0, tilt=-6.0)
    found = skymatch.match(x, y, RANGE, half_width=HALF, fov=80.0, known=True, tilt=0.0)
    assert found.verdict == "match"
    assert found.fits[0].heading == pytest.approx(228.0, abs=0.3)
    assert found.fits[0].tilt == pytest.approx(-6.0, abs=0.3)
    assert found.fits[0].fov == 80.0


def test_the_heading_is_found_wherever_the_search_starts():
    x, y = trace_on(RANGE, heading=300.0, fov=60.0, tilt=1.0)
    found = skymatch.match(x, y, RANGE, half_width=HALF, fov=60.0, known=True, tilt=12.0)
    assert found.fits[0].heading == pytest.approx(300.0, abs=0.3)


def test_a_stretch_traced_over_the_wrong_edge_does_not_move_the_fit():
    x, y = trace_on(RANGE, heading=47.0, fov=52.0)
    wrong = (x > -0.2) & (x < 0.1)  # about a sixth of the trace, 50 px under the ridge
    y = np.where(wrong, y - 0.1, y)
    found = skymatch.match(x, y, RANGE, half_width=HALF, fov=52.0, known=True)
    assert found.verdict == "match"
    assert found.fits[0].heading == pytest.approx(47.0, abs=0.3)


def test_a_turn_that_shows_the_same_ridge_twice_is_ambiguous():
    twice = skyturn([(30, 5, 3), (42, 3, 2), (210, 5, 3), (222, 3, 2)])
    x, y = trace_on(twice, heading=36.0, fov=50.0)
    found = skymatch.match(x, y, twice, half_width=HALF, fov=50.0, known=True)
    assert found.verdict == "ambiguous"
    headings = sorted(fit.heading for fit in found.fits[:2])
    assert headings[0] == pytest.approx(36.0, abs=0.5)
    assert headings[1] == pytest.approx(216.0, abs=0.5)


def test_a_trace_from_elsewhere_matches_nothing():
    elsewhere = skyturn([(100, 1.5, 25), (260, 1.0, 30)])
    x, y = trace_on(RANGE, heading=47.0, fov=52.0)
    found = skymatch.match(x, y, elsewhere, half_width=HALF, fov=52.0, known=True)
    assert found.verdict == "none"
    assert found.fits  # the closest places still come back, for the analyst to look at


def test_a_level_line_is_too_flat_to_place():
    x = np.linspace(-0.9, 0.9, 150)
    y = np.full(x.size, -0.05)
    found = skymatch.match(x, y, RANGE, half_width=HALF, fov=60.0)
    assert found.verdict == "flat"


def test_a_level_line_is_flat_even_through_a_tilted_camera():
    x = np.linspace(-0.9, 0.9, 150)
    found = skymatch.match(x, np.full(x.size, -0.3), RANGE, half_width=HALF, fov=80.0, tilt=10.0)
    assert found.verdict == "flat"


def test_ground_the_turn_does_not_hold_counts_against_the_fit():
    holed = skyturn([(40, 6, 3), (52, 3.5, 1.5), (61, 4.5, 4), (230, 5, 2)], nan_between=(120, 200))
    x, y = trace_on(holed, heading=47.0, fov=52.0)
    found = skymatch.match(x, y, holed, half_width=HALF, fov=52.0, known=True)
    assert found.fits[0].heading == pytest.approx(47.0, abs=0.3)
    # looking into the hole, nothing is read
    empty = skymatch.Turn(0.0, STEP, np.full(3600, np.nan))
    assert skymatch.match(x, y, empty, half_width=HALF, fov=52.0, known=True).fits == []


def test_too_few_points_say_nothing():
    found = skymatch.match(np.zeros(3), np.zeros(3), RANGE, half_width=HALF, fov=60.0)
    assert found.verdict == "none" and found.fits == []


def test_places_returned_stand_apart():
    x, y = trace_on(RANGE, heading=47.0, fov=52.0)
    found = skymatch.match(x, y, RANGE, half_width=HALF, fov=60.0)
    headings = [fit.heading for fit in found.fits]
    assert len(headings) <= skymatch.KEPT
    for i, a in enumerate(headings):
        for b in headings[i + 1:]:
            assert abs((a - b + 180) % 360 - 180) >= skymatch.APART_MIN
    # best first
    shares = [fit.explained for fit in found.fits]
    assert shares == sorted(shares, reverse=True)


def test_a_range_of_lenses_is_stepped_end_to_end():
    tried = skymatch.lenses(60.0, known=False, within=(5.0, 40.0))
    assert tried[0] == pytest.approx(5.0) and tried[-1] == pytest.approx(40.0)
    assert tried == sorted(tried)
    assert np.diff(np.log(tried)).max() <= np.log(skymatch.RANGE_RATIO) + 1e-9
    # past the lenses a view has, the range is clipped; a lens the photo says still wins
    clipped = skymatch.lenses(60.0, known=False, within=(0.1, 500.0))
    assert clipped[0] == skymatch.FOV_MIN and clipped[-1] == skymatch.FOV_MAX
    assert skymatch.lenses(52.0, known=True, within=(5.0, 40.0)) == [52.0]


def test_a_narrow_lens_is_found_across_a_range_far_from_the_views():
    x, y = trace_on(RANGE, heading=52.0, fov=8.0)
    found = skymatch.match(x, y, RANGE, half_width=HALF, fov=60.0, within=(1.5, 120.0))
    best = found.fits[0]
    assert best.heading == pytest.approx(52.0, abs=0.2)
    assert best.fov == pytest.approx(8.0, rel=0.03)
    # the view's own lens give or take never reaches it
    alone = skymatch.match(x, y, RANGE, half_width=HALF, fov=60.0)
    assert all(abs(fit.fov - 8.0) > 1.0 for fit in alone.fits)


def test_a_rolled_camera_is_found_with_its_roll():
    x, y = trace_on(RANGE, heading=47.0, fov=52.0, tilt=1.0, roll=3.0)
    found = skymatch.match(x, y, RANGE, half_width=HALF, fov=52.0, known=True)
    best = found.fits[0]
    assert found.verdict == "match"
    assert best.heading == pytest.approx(47.0, abs=0.3)
    assert best.roll == pytest.approx(3.0, abs=0.3)
    assert best.tilt == pytest.approx(1.0, abs=0.3)
    # held level, the same trace fits worse
    held = skymatch.match(x, y, RANGE, half_width=HALF, fov=52.0, known=True, level=True)
    assert held.fits[0].roll == 0.0
    assert held.fits[0].explained < best.explained


def test_a_roll_buried_under_the_slide_is_still_found():
    # a wide lens and a few degrees of roll: at roll 0 the right heading is not the cheapest
    x, y = trace_on(RANGE, heading=228.0, fov=80.0, roll=-4.0)
    found = skymatch.match(x, y, RANGE, half_width=HALF, fov=80.0, known=True)
    assert found.fits[0].heading == pytest.approx(228.0, abs=0.3)
    assert found.fits[0].roll == pytest.approx(-4.0, abs=0.3)


def test_a_skyline_haze_left_is_found_on_the_cut_that_holds_it():
    near = skyturn([(40, 2.0, 3), (52, 1.5, 1.5), (61, 2.2, 4)], base=0.5)
    farther = skyturn([(50, 4.0, 10)], base=0.0)
    whole = skymatch.Turn(0.0, STEP, np.maximum(near.angles, farther.angles))
    cut = skymatch.Turn(0.0, STEP, near.angles, reach=10_000.0)
    x, y = trace_on(cut, heading=50.0, fov=40.0)
    found = skymatch.match(x, y, [cut, whole], half_width=HALF, fov=40.0, known=True)
    assert found.fits[0].heading == pytest.approx(50.0, abs=0.3)
    assert found.fits[0].reach == 10_000.0
    # on the whole turn alone the far range stands over the traced ridge: nothing explains it
    alone = skymatch.match(x, y, whole, half_width=HALF, fov=40.0, known=True)
    assert alone.fits[0].reach is None
    assert alone.fits[0].explained < found.fits[0].explained - 0.3


def test_a_sector_keeps_the_search_inside_it():
    twice = skyturn([(30, 5, 3), (42, 3, 2), (210, 5, 3), (222, 3, 2)])
    x, y = trace_on(twice, heading=36.0, fov=50.0)
    found = skymatch.match(x, y, twice, half_width=HALF, fov=50.0, known=True, facing=(200.0, 30.0))
    assert found.fits[0].heading == pytest.approx(216.0, abs=0.5)
    assert all(abs((fit.heading - 200.0 + 180) % 360 - 180) <= 30.0 for fit in found.fits)
    # the other copy, outside it, is never offered
    assert not any(abs((fit.heading - 36.0 + 180) % 360 - 180) < 10 for fit in found.fits)


def test_the_turn_reads_the_same_with_and_without_holes():
    holed = skyturn([(40, 6, 3)], nan_between=(300, 301))
    plain = skyturn([(40, 6, 3)])
    az = np.linspace(-20.0, 380.0, 997)
    keep = (np.mod(az, 360.0) < 299.0) | (np.mod(az, 360.0) > 302.0)
    assert np.allclose(holed.at(az)[keep], plain.at(az)[keep])
    # exactly round north, the last column meets the first
    assert plain.at(360.0) == pytest.approx(plain.at(0.0))
    assert plain.at(359.95) == pytest.approx((plain.angles[-1] + plain.angles[0]) / 2)
