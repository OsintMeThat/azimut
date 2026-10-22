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


@pytest.mark.parametrize("slope", [0.05, 0.15, 0.3])
def test_a_straight_line_of_any_slope_is_too_flat_to_place(slope):
    # a roll turns a sloping line level: measured against a level line, it once passed for a skyline
    x = np.linspace(-0.9, 0.9, 150)
    found = skymatch.match(x, slope * x, RANGE, half_width=HALF, fov=40.0)
    assert found.verdict == "flat"
    assert all(fit.explained == pytest.approx(0.0, abs=1e-9) for fit in found.fits)


def test_a_straight_trace_explains_nothing_however_well_it_lies():
    x = np.linspace(-0.9, 0.9, 120)
    y = 0.2 * x
    assert skymatch.explained_by(np.zeros(x.size), x, y, HALF) == pytest.approx(0.0, abs=1e-9)
    # a skyline with shape, lying exactly on the terrain, is explained whole
    x, y = trace_on(RANGE, heading=47.0, fov=52.0)
    assert skymatch.explained_by(np.zeros(x.size), x, y, HALF) == 1.0


def test_the_straight_line_is_not_dragged_up_by_a_peak():
    x = np.linspace(-0.9, 0.9, 200)
    y = 0.1 * x + np.where(np.abs(x) < 0.1, 0.2, 0.0)
    off = skymatch.off_line(x, y, HALF)
    # the slope's points stand on the line; the peak alone stands off it
    assert np.abs(off[np.abs(x) > 0.2]).max() < 1.0
    assert off[np.abs(x) < 0.05].min() > 90.0


def test_one_part_of_the_trace_may_miss_but_not_two():
    x, y = trace_on(RANGE, heading=47.0, fov=52.0)
    loss = np.zeros(x.size)
    whole = skymatch.explained_by(loss, x, y, HALF)
    # the right quarter lost (a collage's edge, a ridge too near for the terrain): let go, the rest still counts
    loss[x > 0.5] = skymatch.LOST_LOSS
    one = skymatch.explained_by(loss, x, y, HALF)
    assert whole == 1.0 and 0.5 < one < 0.8
    # a second part lost as well: the place no longer fits across the trace
    loss[x < -0.5] = skymatch.LOST_LOSS
    two = skymatch.explained_by(loss, x, y, HALF)
    assert two < 0.4
    loss[x > 0] = skymatch.LOST_LOSS
    assert skymatch.explained_by(loss, x, y, HALF) < 0.3
    # a part with no shape of its own is only asked to lie on the terrain
    flat = np.linspace(-0.9, 0.9, 200)
    bumped = np.where(flat < 0, 0.3 * np.exp(-((flat + 0.45) ** 2) / 0.01), 0.0)
    near = np.full(flat.size, float(skymatch._loss(np.array([1.0]))[0]))
    assert skymatch.explained_by(near, flat, bumped, HALF) > 0.8


def test_near_lines_rounded_lose_the_teeth_the_terrain_cannot_hold():
    # a ridge 400 m off, known to a 30 m cell: the photo shows teeth on it the terrain cannot
    near = skymatch.Turn(0.0, STEP, RANGE.angles, distance=np.full(RANGE.angles.size, 400.0))
    x, y = trace_on(near, heading=50.0, fov=40.0)
    teeth = y + 0.02 * np.sin(x * 60)
    drawn = skymatch.match(x, teeth, near, half_width=HALF, fov=40.0, known=True).fits[0]
    rounded = skymatch.match(x, teeth, near, half_width=HALF, fov=40.0, known=True, rounding=30.0).fits[0]
    assert drawn.explained < 0.6 and rounded.explained > 0.95
    assert rounded.heading == pytest.approx(50.0, abs=0.2)
    # a trace lying exactly on the terrain still does once rounded
    assert skymatch.match(x, y, near, half_width=HALF, fov=40.0, known=True, rounding=30.0).fits[0].explained == 1.0
    # the nearer, the rounder: a ridge 1.5 km off keeps more of its teeth
    farther = skymatch.Turn(0.0, STEP, RANGE.angles, distance=np.full(RANGE.angles.size, 1_500.0))
    less = skymatch.match(x, teeth, farther, half_width=HALF, fov=40.0, known=True, rounding=30.0).fits[0]
    assert drawn.explained < less.explained < rounded.explained
    # a far ridge is left as drawn
    far = skymatch.Turn(0.0, STEP, RANGE.angles, distance=np.full(RANGE.angles.size, 10_000.0))
    plain = skymatch.match(x, teeth, far, half_width=HALF, fov=40.0, known=True).fits[0]
    kept = skymatch.match(x, teeth, far, half_width=HALF, fov=40.0, known=True, rounding=30.0).fits[0]
    assert kept.explained == pytest.approx(plain.explained, abs=1e-9)


def test_a_trace_matched_on_the_wrong_turn_scores_lower_than_today():
    # the right half lies on some ridge of the wrong turn, the left misses: no longer half explained
    elsewhere = skyturn([(100, 3, 4), (130, 2.5, 6), (300, 4, 3)])
    x, y = trace_on(RANGE, heading=47.0, fov=52.0)
    found = skymatch.match(x, y, elsewhere, half_width=HALF, fov=52.0, known=True)
    assert found.fits[0].explained < skymatch.LOOSE_BELOW


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


def test_several_sectors_are_each_searched_and_nothing_between():
    twice = skyturn([(30, 5, 3), (42, 3, 2), (210, 5, 3), (222, 3, 2)])
    x, y = trace_on(twice, heading=36.0, fov=50.0)
    both = skymatch.match(x, y, twice, half_width=HALF, fov=50.0, known=True, facing=((36.0, 10.0), (216.0, 10.0)))
    headings = sorted(round(fit.heading) for fit in both.fits[:2])
    assert headings == [36, 216]
    # a sector holding neither copy, beside one that holds the second: only the second is offered
    one = skymatch.match(x, y, twice, half_width=HALF, fov=50.0, known=True, facing=[(120.0, 20.0), (216.0, 15.0)])
    assert one.fits[0].heading == pytest.approx(216.0, abs=0.5)
    assert all(skymatch.within_sectors(fit.heading, ((120.0, 20.0), (216.0, 15.0))) for fit in one.fits)
    assert skymatch.sectors_of((200.0, 30.0)) == ((200.0, 30.0),)
    assert skymatch.sectors_of(None) is None and skymatch.sectors_of(()) is None


def test_a_line_said_to_stand_near_is_laid_only_on_ground_that_near():
    # the same skyline twice round the turn, once on ridges 2 km out and once on ridges 20 km out
    twice = skyturn([(30, 5, 3), (42, 3, 2), (210, 5, 3), (222, 3, 2)])
    distance = np.where(np.abs(((np.arange(twice.angles.size) * STEP) - 36 + 180) % 360 - 180) < 40, 2_000.0, 20_000.0)
    turn = skymatch.Turn(0.0, STEP, twice.angles, distance=distance)
    x, y = trace_on(turn, heading=216.0, fov=50.0)
    line = np.zeros(x.size, dtype=np.int64)
    near = skymatch.Marks(line=line, far=((0, 1_000.0, 3_000.0),))
    found = skymatch.match(x, y, turn, half_width=HALF, fov=50.0, known=True, marks=near)
    assert found.fits[0].heading == pytest.approx(36.0, abs=0.5)
    # said far, the far copy; said nothing, either may come first
    far = skymatch.Marks(line=line, far=((0, 10_000.0, 30_000.0),))
    assert skymatch.match(x, y, turn, half_width=HALF, fov=50.0, known=True, marks=far).fits[0].heading == pytest.approx(216.0, abs=0.5)
    # a floor keeps lines said nothing of off the ground nearer than it
    floored = skymatch.match(x, y, turn, half_width=HALF, fov=50.0, known=True, floor=5_000.0)
    assert floored.fits[0].heading == pytest.approx(216.0, abs=0.5)
    assert all(abs(((fit.heading - 36.0 + 180) % 360) - 180) > 10 for fit in floored.fits)


def test_bands_widen_what_the_analyst_said_and_say_nothing_without_strokes():
    lines = np.array([0, 0, 1, 1, 2])
    low, high = skymatch.bands_of(lines, 5, ((0, 1_000.0, 3_000.0), (1, 0.0, 1_000.0)), floor=250.0)
    assert low[0] == pytest.approx(1_000.0 / skymatch.BAND_SLACK) and high[0] == pytest.approx(3_000.0 * skymatch.BAND_SLACK)
    # said near: no floor under it; said nothing: the floor, and anywhere past it
    assert low[2] == 0.0 and low[4] == 250.0 and np.isinf(high[4])
    assert skymatch.bands_of(None, 3, ()) is None
    assert skymatch.bands_of(None, 3, (), floor=100.0)[0].tolist() == [100.0] * 3


def test_a_tilt_past_the_bounds_is_no_place():
    x, y = trace_on(RANGE, heading=50.0, fov=40.0, tilt=-15.0)
    free = skymatch.match(x, y, RANGE, half_width=HALF, fov=40.0, known=True)
    assert free.fits[0].tilt == pytest.approx(-15.0, abs=0.5)
    bounded = skymatch.match(x, y, RANGE, half_width=HALF, fov=40.0, known=True, tilts=(-10.0, 10.0))
    assert all(-11.0 <= fit.tilt <= 11.0 for fit in bounded.fits)
    assert not any(abs(((fit.heading - 50.0 + 180) % 360) - 180) < 2 for fit in bounded.fits)


def test_the_turn_reads_the_same_with_and_without_holes():
    holed = skyturn([(40, 6, 3)], nan_between=(300, 301))
    plain = skyturn([(40, 6, 3)])
    az = np.linspace(-20.0, 380.0, 997)
    keep = (np.mod(az, 360.0) < 299.0) | (np.mod(az, 360.0) > 302.0)
    assert np.allclose(holed.at(az)[keep], plain.at(az)[keep])
    # exactly round north, the last column meets the first
    assert plain.at(360.0) == pytest.approx(plain.at(0.0))
    assert plain.at(359.95) == pytest.approx((plain.angles[-1] + plain.angles[0]) / 2)


def test_a_panorama_strip_reads_its_degrees_straight_off_the_picture():
    # camera.js's panorama strip: half a width is half the field, across and up
    az, el = skymatch.directions(np.array([0.5, -1.0]), np.array([0.1, -0.05]), fov=200.0, tilt=2.0,
                                 projection="panorama")
    assert az.tolist() == pytest.approx([50.0, -100.0])
    assert el.tolist() == pytest.approx([12.0, -3.0])
    # the roll a camera has, a strip has not
    _, rolled = skymatch.directions(np.array([0.5]), np.array([0.1]), fov=200.0, roll=5.0, projection="panorama")
    assert rolled[0] == pytest.approx(10.0)


def test_a_panorama_may_span_the_whole_turn():
    assert max(skymatch.lenses(300.0, known=False, projection="panorama")) == skymatch.PANORAMA_FOV_MAX
    assert max(skymatch.lenses(300.0, known=False)) == skymatch.FOV_MAX
    assert skymatch.lenses(200.0, known=False, within=(120.0, 300.0), projection="panorama")[-1] == pytest.approx(300.0)


def test_a_panorama_is_found_at_its_heading_and_width():
    x, y = trace_on(RANGE, heading=60.0, fov=180.0, tilt=1.5, projection="panorama")
    found = skymatch.match(x, y, RANGE, half_width=HALF, fov=150.0, within=(100.0, 260.0), projection="panorama")
    assert found.verdict == "match"
    best = found.fits[0]
    assert best.heading == pytest.approx(60.0, abs=0.5)
    assert best.fov == pytest.approx(180.0, rel=0.03)
    assert best.tilt == pytest.approx(1.5, abs=0.3)
    # held level, whatever roll the search was handed
    assert best.roll == 0.0
    level = skymatch.match(x, y, RANGE, half_width=HALF, fov=180.0, known=True, roll=4.0, projection="panorama")
    assert level.fits[0].roll == 0.0
    assert level.fits[0].heading == pytest.approx(60.0, abs=0.5)


def test_a_panorama_read_as_a_photo_explains_less_of_itself():
    # a strip wide enough to bend a straight lens: its own projection explains it better
    x, y = trace_on(RANGE, heading=60.0, fov=140.0, tilt=1.0, projection="panorama")
    strip = skymatch.match(x, y, RANGE, half_width=HALF, fov=140.0, known=True, projection="panorama")
    photo = skymatch.match(x, y, RANGE, half_width=HALF, fov=140.0, known=True)
    assert strip.fits[0].explained > photo.fits[0].explained


# -- the marks beside the skyline ---------------------------------------------------


def test_an_unknown_lens_stays_within_the_range_the_analyst_gave():
    # the photo's lens lies past the widest the analyst said: the refinement may not ease it out
    x, y = trace_on(RANGE, heading=47.0, fov=70.0, tilt=3.0)
    found = skymatch.match(x, y, RANGE, half_width=HALF, fov=50.0, within=(40.0, 60.0))
    assert found.fits
    assert all(40.0 - 1e-9 <= fit.fov <= 60.0 + 1e-9 for fit in found.fits)


def test_the_ridges_answer_the_nearest_silhouette_in_each_column():
    ridges = skymatch.Ridges.of(
        0.0, 1.0, 360, np.array([5, 5, 7]), np.array([1.0, 2.0, 3.0]), np.array([100.0, 500.0, 900.0])
    )
    off, far = ridges.nearest(np.array([5.2, 7.0, 9.0]), np.array([1.1, 2.5, 0.0]))
    assert off[0] == pytest.approx(0.1) and far[0] == 100.0
    assert off[1] == pytest.approx(-0.5) and far[1] == 900.0
    assert np.isnan(off[2]) and np.isnan(far[2])
    # a silhouette past the reach is not there
    off, _ = ridges.nearest(np.array([7.0]), np.array([3.0]), reach=800.0)
    assert np.isnan(off[0])


def test_the_turn_says_how_far_its_skyline_stands():
    turn = skymatch.Turn(0.0, 90.0, np.zeros(4), distance=np.array([1.0, 2.0, 3.0, 4.0]))
    assert turn.far(np.array([0.0, 100.0, 359.0])).tolist() == [1.0, 2.0, 1.0]
    assert np.isnan(skymatch.Turn(0.0, 90.0, np.zeros(4)).far(np.array([0.0]))[0])


def _inner_edges(heading, fov, tilt, ridge_at, count=60):
    """Points of an inner edge lying `ridge_at` degrees up across the middle of the photo."""
    x = np.linspace(-0.4, 0.4, count)
    low, high = np.full(count, -3.0), np.full(count, 3.0)
    for _ in range(60):
        y = (low + high) / 2
        _, elevation = skymatch.directions(x, y, fov=fov, tilt=tilt)
        above = elevation > ridge_at
        high = np.where(above, y, high)
        low = np.where(above, low, y)
    return x, (low + high) / 2


def _ridges_under(turn, at_angle, distance=1_000.0):
    """Every column holds the skyline and one inner ridge `at_angle` degrees up."""
    columns = turn.angles.size
    column = np.concatenate([np.arange(columns), np.arange(columns)])
    angle = np.concatenate([turn.angles, np.full(columns, at_angle)])
    far = np.concatenate([np.full(columns, 9_000.0), np.full(columns, distance)])
    return skymatch.Ridges.of(0.0, turn.step, columns, column, angle, far)


def test_inner_edges_take_score_from_a_place_where_no_ridge_lies_and_add_none():
    x, y = trace_on(RANGE, heading=47.0, fov=52.0)
    rx, ry = _inner_edges(47.0, 52.0, 0.0, ridge_at=0.4)
    marks = skymatch.Marks(ridge_x=rx, ridge_y=ry)
    alone = skymatch.match(x, y, RANGE, half_width=HALF, fov=52.0, known=True).fits[0]
    held = skymatch.match(x, y, RANGE, half_width=HALF, fov=52.0, known=True, marks=marks,
                          ridges=_ridges_under(RANGE, 0.4)).fits[0]
    assert held.inner > 0.9
    assert held.explained == pytest.approx(alone.explained, abs=1e-6)  # lying on its ridge adds nothing
    missed = skymatch.match(x, y, RANGE, half_width=HALF, fov=52.0, known=True, marks=marks,
                            ridges=_ridges_under(RANGE, -2.0)).fits[0]
    assert missed.inner < 0.2
    assert missed.explained < alone.explained - 0.3
    assert missed.sky == pytest.approx(alone.explained, abs=1e-6)


def test_a_pair_in_the_wrong_order_takes_a_share_of_the_score():
    x, y = trace_on(RANGE, heading=47.0, fov=52.0)
    near = np.full(RANGE.angles.size, 2_000.0)
    turn = skymatch.Turn(0.0, STEP, RANGE.angles, distance=near)
    # the left half of the trace is one stroke, the right half another, at the same distance here
    line = (x > 0).astype(np.int64)
    kept = skymatch.match(x, y, turn, half_width=HALF, fov=52.0, known=True,
                          marks=skymatch.Marks(line=line, pairs=((0, 1),))).fits[0]
    assert kept.pairs == (0, 1)
    farther = np.where(np.arange(near.size) * STEP < 47.0, 1_000.0, 5_000.0)
    turn = skymatch.Turn(0.0, STEP, RANGE.angles, distance=farther)
    alone = skymatch.match(x, y, turn, half_width=HALF, fov=52.0, known=True).fits[0]
    good = skymatch.match(x, y, turn, half_width=HALF, fov=52.0, known=True,
                          marks=skymatch.Marks(line=line, pairs=((0, 1),))).fits[0]
    bad = skymatch.match(x, y, turn, half_width=HALF, fov=52.0, known=True,
                         marks=skymatch.Marks(line=line, pairs=((1, 0),))).fits[0]
    assert good.pairs == (1, 1) and good.explained == pytest.approx(alone.explained, abs=1e-6)
    assert bad.pairs == (0, 1)
    assert bad.explained == pytest.approx(alone.explained * (1 - skymatch.PAIR_COST), abs=1e-6)


def test_a_line_with_only_sky_above_loses_the_place_where_land_stands_over_it():
    near = skyturn([(40, 2.0, 3), (52, 1.5, 1.5), (61, 2.2, 4)], base=0.5)
    farther = skyturn([(58, 4.0, 4)], base=0.0)
    over = farther.angles > near.angles
    distance = np.where(over, 8_000.0, 3_000.0)
    cut = skymatch.Turn(0.0, STEP, near.angles, reach=5_000.0, distance=np.full(near.angles.size, 3_000.0))
    whole = skymatch.Turn(0.0, STEP, np.maximum(near.angles, farther.angles), reach=20_000.0, distance=distance)
    x, y = trace_on(cut, heading=50.0, fov=40.0)
    # the left half is one stroke, the right half, under the farther range, another
    line = (x > 0).astype(np.int64)
    # the place itself, the search held to its heading
    at = (50.0, 3.0)
    alone = skymatch.match(x, y, [cut, whole], half_width=HALF, fov=40.0, known=True, facing=at,
                           marks=skymatch.Marks(line=line)).fits[0]
    assert alone.reach == 5_000.0 and alone.over is None

    def said(clear, seen=None):
        marks = skymatch.Marks(line=line, clear=clear)
        return skymatch.match(x, y, [cut, whole], half_width=HALF, fov=40.0, known=True, facing=at, marks=marks,
                              clear=seen).fits[0]

    # read as far as the place's own cut, or said to see 5 km, haze hides the range: nothing stands over the line
    for hazy in (said((1,)), said((1,), cut)):
        assert hazy.over == 0.0 and hazy.explained == pytest.approx(alone.explained, abs=1e-6)
    # the photo said to see 20 km: the range stands over the right half, and the place is no place
    clear = said((1,), whole)
    assert clear.over > 0.3 and clear.explained == 0.0
    # the left half has sky above it wherever the photo sees
    assert said((0,), whole).over == 0.0


def test_land_over_a_line_counts_past_the_heights_own_error():
    turn = skymatch.Turn(0.0, 90.0, np.full(4, 3.0), distance=np.array([300.0, 3_000.0, 3_000.0, 3_000.0]))
    per = 20.0
    # 2° over, a hillside 300 m off: within what 15 m of error spans there; 3 km off it is not
    under = skymatch.under_terrain(np.array([0.0, 90.0]), np.array([1.0, 1.0]), turn, per)
    assert under.tolist() == [False, True]
    # a few pixels over is the fit's own give, not land
    assert not skymatch.under_terrain(np.array([90.0]), np.array([3.0 - 0.5]), turn, per)[0]


def test_a_collage_cut_in_pieces_fits_each_a_little_on_its_own_and_no_more():
    x, y = trace_on(RANGE, heading=47.0, fov=52.0)
    right = x > 0
    # the right frame of the collage was laid half a degree low: a pinhole cannot follow it
    _, rise = skymatch.directions(np.array([0.5]), np.array([0.0]), fov=52.0)
    _, lower = skymatch.directions(np.array([0.5]), np.array([-0.0175]), fov=52.0)
    shifted = np.where(right, y - 0.0175, y)
    whole = skymatch.match(x, shifted, RANGE, half_width=HALF, fov=52.0, known=True).fits[0]
    cut = skymatch.match(x, shifted, RANGE, half_width=HALF, fov=52.0, known=True,
                         marks=skymatch.Marks(piece=right.astype(np.int64))).fits[0]
    assert rise[0] - lower[0] > 0.4
    assert cut.explained > 0.99 and cut.explained > whole.explained + 0.05
    assert cut.sky == cut.explained
    # each piece says how it was eased: the right one tilted about half a degree from the left
    (left_piece, *left), (right_piece, *right_eased) = cut.pieces
    assert (left_piece, right_piece) == (0, 1)
    assert abs(right_eased[1] - left[1]) == pytest.approx(rise[0] - lower[0], abs=0.3)
    assert skymatch.pieces_of(cut)[1]["piece"] == 1
    assert whole.pieces is None
    # a piece three degrees off stays off: its camera eases a degree at most
    far_off = np.where(right, y - 0.11, y)
    loose = skymatch.match(x, far_off, RANGE, half_width=HALF, fov=52.0, known=True,
                           marks=skymatch.Marks(piece=right.astype(np.int64))).fits[0]
    assert loose.explained < cut.explained - 0.3
    assert all(abs(tilt) <= skymatch.PIECE_TILT + 1e-9 for _, _, tilt, _ in loose.pieces)
