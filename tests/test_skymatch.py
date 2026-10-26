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


def test_the_rows_middle_is_numpys_nanmedian_exactly():
    rng = np.random.default_rng(7)
    values = rng.normal(size=(300, 41))
    values[rng.random(values.shape) < 0.4] = np.nan
    values[0, :] = np.nan
    values[0, 5] = 2.5  # one number left in a row
    values[1, :] = 1.0  # a row of ties
    count = (~np.isnan(values)).sum(axis=1)
    assert np.array_equal(skymatch._nanmedian_rows(values, count), np.nanmedian(values, axis=1))


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


def test_a_lens_window_slides_the_very_lenses_a_full_slide_tries_near_it(monkeypatch):
    x, y = trace_on(RANGE, heading=47.0, fov=52.0, tilt=3.0)
    slid = []
    slide = skymatch._slide_after

    def sliding(seen, *rest, **named):
        slid.append(seen.fov)
        return slide(seen, *rest, **named)

    monkeypatch.setattr(skymatch, "_slide_after", sliding)
    skymatch.match(x, y, RANGE, half_width=HALF, fov=60.0, within=(20.0, 85.0), rough=True)
    full = list(slid)
    slid.clear()
    found = skymatch.match(x, y, RANGE, half_width=HALF, fov=60.0, within=(20.0, 85.0), rough=True, lens_window=(45.0, 60.0))
    assert slid and set(slid) <= set(full) and slid == [lens for lens in full if 45.0 <= lens <= 60.0]
    assert found.fits[0].heading == pytest.approx(47.0, abs=0.5)
    # a window between two of them slides the nearer
    slid.clear()
    skymatch.match(x, y, RANGE, half_width=HALF, fov=60.0, within=(20.0, 85.0), rough=True, lens_window=(52.0, 52.5))
    assert len(slid) == 1 and slid[0] in full


def test_a_widest_lens_leaves_the_wider_ones_out_and_tries_the_very_others(monkeypatch):
    x, y = trace_on(RANGE, heading=47.0, fov=52.0, tilt=3.0)
    slid = []
    slide = skymatch._slide_after

    def sliding(seen, *rest, **named):
        slid.append(seen.fov)
        return slide(seen, *rest, **named)

    monkeypatch.setattr(skymatch, "_slide_after", sliding)
    skymatch.match(x, y, RANGE, half_width=HALF, fov=60.0, within=(20.0, 85.0), rough=True)
    full = list(slid)
    slid.clear()
    found = skymatch.match(x, y, RANGE, half_width=HALF, fov=60.0, within=(20.0, 85.0), rough=True, lens_max=60.0)
    assert slid == [lens for lens in full if lens <= 60.0]
    assert found.fits and all(fit.fov <= 60.0 + 1e-9 for fit in found.fits)


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
    # a silhouette outside the direction's band is not there
    off, _ = ridges.nearest(np.array([7.0]), np.array([3.0]), (np.array([0.0]), np.array([800.0])))
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


def test_inner_edges_lie_on_ridges_past_the_cut_the_skyline_was_found_on():
    # the skyline fits the turn cut at 4 km, the ridge the inner edge lies on stands 6 km out
    x, y = trace_on(RANGE, heading=47.0, fov=52.0)
    rx, ry = _inner_edges(47.0, 52.0, 0.0, ridge_at=0.4)
    cut = skymatch.Turn(RANGE.start, RANGE.step, RANGE.angles, reach=4_000.0)
    held = skymatch.match(x, y, cut, half_width=HALF, fov=52.0, known=True,
                          marks=skymatch.Marks(ridge_x=rx, ridge_y=ry),
                          ridges=_ridges_under(RANGE, 0.4, distance=6_000.0)).fits[0]
    assert held.reach == 4_000.0
    assert held.inner > 0.9


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
    # one pair alone takes its share as one of `PAIR_MIN`: it never halves a place
    assert bad.explained == pytest.approx(alone.explained * (1 - skymatch.PAIR_COST / skymatch.PAIR_MIN), abs=1e-6)


def test_a_line_with_only_sky_above_loses_the_place_where_land_stands_over_it():
    near = skyturn([(40, 2.0, 3), (52, 1.5, 1.5), (61, 2.2, 4)], base=0.5)
    farther = skyturn([(58, 4.0, 4)], base=0.0)
    over = farther.angles > near.angles
    x, y = trace_on(near, heading=50.0, fov=40.0)
    # the left half is one stroke, the right half, under the farther range, another
    line = (x > 0).astype(np.int64)
    # the place itself, the search held to its heading
    at = (50.0, 3.0)

    def turns(range_at):
        cut = skymatch.Turn(0.0, STEP, near.angles, reach=5_000.0, distance=np.full(near.angles.size, 3_000.0))
        whole = skymatch.Turn(0.0, STEP, np.maximum(near.angles, farther.angles), reach=50_000.0,
                              distance=np.where(over, range_at, 3_000.0))
        return cut, whole

    cut, whole = turns(8_000.0)
    alone = skymatch.match(x, y, [cut, whole], half_width=HALF, fov=40.0, known=True, facing=at,
                           marks=skymatch.Marks(line=line)).fits[0]
    assert alone.reach == 5_000.0 and alone.over is None

    def said(clear, seen=None, both=(cut, whole)):
        marks = skymatch.Marks(line=line, clear=clear)
        return skymatch.match(x, y, list(both), half_width=HALF, fov=40.0, known=True, facing=at, marks=marks,
                              clear=seen).fits[0]

    # said to see 5 km, haze hides the range: nothing stands over the line
    hazy = said((1,), cut)
    assert hazy.over == 0.0 and hazy.explained == pytest.approx(alone.explained, abs=1e-6)
    # said to see 50 km, the range stands over the right half, and the place is no place
    clear = said((1,), whole)
    assert clear.over > 0.3 and clear.explained == 0.0 and clear.over_far == pytest.approx(8_000.0)
    # left to Auto, a range under three times as far as the line still counts (owner, 2026-10-22: places
    # with mountains behind a sky-only line), and the place says how far out it stands
    auto = said((1,))
    assert auto.over > skymatch.CLEAR_HARD and auto.explained == 0.0 and auto.over_far == pytest.approx(8_000.0)
    # one seven times as far haze may well hide: the place keeps its score
    far = said((1,), both=turns(20_000.0))
    assert far.over == 0.0 and far.explained == pytest.approx(alone.explained, abs=1e-6)
    # the left half has sky above it wherever the photo sees
    assert said((0,), whole).over == 0.0
    assert said((0,)).over == 0.0


def test_the_lines_own_crest_off_the_trace_is_not_land_over_it(monkeypatch):
    ridge = skyturn([(40, 2.0, 3), (52, 1.5, 1.5), (61, 2.2, 4)], base=0.5)
    # nothing behind the ridge, 3 km out, however far the photo sees
    cut = skymatch.Turn(0.0, STEP, ridge.angles, reach=5_000.0, distance=np.full(ridge.angles.size, 3_000.0))
    whole = skymatch.Turn(0.0, STEP, ridge.angles, reach=50_000.0, distance=np.full(ridge.angles.size, 3_000.0))
    # filmed through 40°, searched through a measured 46°: the crest stands off the trace towards the edges
    x, y = trace_on(ridge, heading=50.0, fov=40.0)
    line = np.zeros(x.size, dtype=np.int64)

    def said(clear=(0,), seen=None):
        return skymatch.match(x, y, [cut, whole], half_width=HALF, fov=46.0, known=True, facing=(50.0, 3.0),
                              marks=skymatch.Marks(line=line, clear=clear), clear=seen).fits[0]

    plain = said(clear=())
    for fit in (said(), said(seen=whole)):
        assert fit.over == 0.0 and fit.explained == pytest.approx(plain.explained, abs=1e-6)
    # read as land over the line (owner's v01, 2026-10-24), the crest itself all but ruled the place out
    monkeypatch.setattr(skymatch, "BEHIND", 0.0)
    assert said().over > skymatch.CLEAR_FREE and said().explained < plain.explained - 0.25


def test_a_line_with_only_sky_above_lies_on_the_top_of_the_land_it_would_show():
    ridge = skyturn([(50, 2.0, 4)], base=0.5)
    nearer = skymatch.Turn(0.0, STEP, ridge.angles, reach=5_000.0, distance=np.full(ridge.angles.size, 3_000.0))
    # a range 5 km out stands over the ridge left of the heading, one 20 km out over all of it
    behind = skyturn([(40, 4.0, 5)], base=0.0)
    middle = skymatch.Turn(0.0, STEP, np.maximum(ridge.angles, behind.angles), reach=10_000.0,
                           distance=np.where(behind.angles > ridge.angles, 5_000.0, 3_000.0))
    whole = skymatch.Turn(0.0, STEP, np.maximum(middle.angles, 6.0), reach=50_000.0,
                          distance=np.full(ridge.angles.size, 20_000.0))
    tops = skymatch._tops([nearer, middle, whole])
    # from the nearest cut, a line laid 3 km out shows land to 9 km over it: the range 5 km out, not the 20 km one
    assert np.array_equal(tops[0].angles, middle.angles)
    assert np.array_equal(tops[1].angles, middle.angles) and np.array_equal(tops[2].angles, whole.angles)
    # traced on the ridge, sure of only sky above it: on the nearest cut the line is laid on the range over its
    # left part and fits worse than as a plain line, whatever is ruled after
    x, y = trace_on(ridge, heading=50.0, fov=30.0)
    line = np.zeros(x.size, dtype=np.int64)
    plain = skymatch.match(x, y, nearer, half_width=HALF, fov=30.0, known=True, facing=(50.0, 3.0),
                           marks=skymatch.Marks(line=line)).fits[0]
    sure = skymatch.match(x, y, [nearer, middle, whole], half_width=HALF, fov=30.0, known=True, facing=(50.0, 3.0),
                          marks=skymatch.Marks(line=line, clear=(0,)))
    assert all(fit.explained < plain.explained - 0.2 for fit in sure.fits)
    # a turn whose distances the sweep did not say leaves the lines on their cut
    assert skymatch._tops([skymatch.Turn(0.0, STEP, ridge.angles), whole]) == [None, None]


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


def test_a_piece_of_a_strip_laid_turned_rolls_about_its_own_middle(monkeypatch):
    x, y = trace_on(RANGE, heading=47.0, fov=120.0, projection="panorama")
    right = x > 0
    about = (float(x[right].mean()), float(y[right].mean()))
    # the right frame of a hand collage was laid turned a degree the other way about its middle
    tx, ty = skymatch._rolled(x[right], y[right], -1.0, about)
    laid_x, laid_y = x.copy(), y.copy()
    laid_x[right], laid_y[right] = tx, ty
    marks = skymatch.Marks(piece=right.astype(np.int64))
    whole = skymatch.match(laid_x, laid_y, RANGE, half_width=HALF, fov=120.0, known=True, projection="panorama").fits[0]
    cut = skymatch.match(laid_x, laid_y, RANGE, half_width=HALF, fov=120.0, known=True, projection="panorama",
                         marks=marks).fits[0]
    assert cut.explained > 0.99 and cut.explained > whole.explained + 0.05
    rolled = {k: r for k, _, _, r in cut.pieces}
    assert rolled[1] == pytest.approx(1.0) and rolled[0] == pytest.approx(0.0)
    # the app is told the middle it rolls about, the left piece unrolled says none
    said = {one["piece"]: one for one in skymatch.pieces_of(cut)}
    assert said[1]["about"] == pytest.approx([float(laid_x[right].mean()), float(laid_y[right].mean())], abs=1e-4)
    assert "about" not in said[0]
    # without the roll the strip cannot follow it
    monkeypatch.setattr(skymatch, "PIECE_STRIP_ROLL", 0.0)
    flat = skymatch.match(laid_x, laid_y, RANGE, half_width=HALF, fov=120.0, known=True, projection="panorama",
                          marks=marks).fits[0]
    assert flat.explained < cut.explained - 0.05 and flat.pivots is None


def test_a_piece_eased_as_far_as_it_may_go_says_so():
    fit = skymatch.Fit(heading=0.0, tilt=0.0, fov=60.0, gap=0.0, explained=0.5, points=100, pieces=(
        (0, skymatch.PIECE_TURN, 0.0, 0.0), (1, 0.25, -skymatch.PIECE_TILT, 0.0), (2, 0.0, 0.0, 1.0), (3, 0.5, 0.25, 0.0),
    ))
    said = {one["piece"]: one for one in skymatch.pieces_of(fit)}
    assert said[0]["edge"] and said[1]["edge"] and "edge" not in said[3]
    # a roll of a degree is the most a strip's piece may take, not a photo's
    assert "edge" not in said[2]
    assert {one["piece"]: one for one in skymatch.pieces_of(fit, "panorama")}[2]["edge"]


def test_one_placing_reads_what_the_separate_reads_give():
    """The slide reads the skyline and its distance off one placing of the azimuths (`_gap`), the top of the land
    for the sky-only points: the very numbers `_at` and `_gate` give apart."""
    rng = np.random.default_rng(11)
    angles = rng.normal(2.0, 1.0, 720)
    angles[rng.random(720) < 0.05] = np.nan
    distance = rng.uniform(500.0, 40_000.0, 720)
    turn = skymatch.Turn(0.0, 0.5, angles, reach=20_000.0, distance=distance)
    top = skymatch.Turn(0.0, 0.5, angles + rng.uniform(0.0, 1.0, 720), reach=20_000.0, distance=distance * 1.5)
    azimuth = rng.uniform(-400.0, 800.0, (64, 90))
    elevation = rng.normal(2.0, 1.0, 90)
    sure = rng.random(90) < 0.4
    low, high = np.full(90, 1_000.0), np.full(90, 30_000.0)
    apart = skymatch._gate(elevation - skymatch._at(turn, top, sure, azimuth), turn, azimuth, low, high, top, sure)
    together = skymatch._gap(elevation, turn, top, sure, azimuth, low, high)
    assert np.array_equal(apart, together, equal_nan=True)
    assert np.array_equal(skymatch._gap(elevation, turn, None, None, azimuth, None, None),
                          elevation - turn.at(azimuth), equal_nan=True)


def test_a_turn_places_azimuths_as_remainder_does_to_the_bit():
    turn = skymatch.Turn(0.25, 0.5, np.zeros(720))
    rng = np.random.default_rng(2)
    edges = np.array([-359.75, -0.25, 0.25, 0.2500000000000001, 359.75, 360.25, 719.75, -360.0, 1e-300, -1e-300])
    for azimuth in (rng.uniform(-359.75, 720.25, 100_000), edges, rng.uniform(-2_000.0, 2_000.0, 10_000),
                    np.array([np.nan, 10.0])):
        plain = np.remainder(azimuth - 0.25, 360.0) / 0.5
        assert np.array_equal(turn.place(azimuth).view(np.int64), plain.view(np.int64))


@pytest.mark.parametrize("fov, step, sure", [(9.0, 0.1, False), (40.0, 0.25, True), (120.0, 0.5, False)])
def test_a_cut_slid_after_another_gives_what_its_own_slide_gives(fov, step, sure, monkeypatch):
    """A cut's slide takes the cut before's numbers where its trace reads no column the two tell apart: every
    heading's cost, tilt and roll are the very ones a slide of its own gives, to the bit."""
    rng = np.random.default_rng(int(fov))
    count = int(round(360.0 / step))
    angles = rng.normal(1.0, 1.0, count)
    angles[rng.random(count) < 0.03] = np.nan
    distance = rng.uniform(500.0, 5_000.0, count)
    near = skymatch.Turn(0.0, step, angles, reach=5_000.0, distance=distance)
    # the farther cut: ridges past the nearer one rise over it across a few stretches
    farther, far_distance = angles.copy(), distance.copy()
    for start in rng.integers(0, count, 4):
        stretch = (start + np.arange(count // 40)) % count
        farther[stretch] += rng.uniform(0.1, 0.5, stretch.size)
        far_distance[stretch] = rng.uniform(5_000.0, 20_000.0, stretch.size)
    far = skymatch.Turn(0.0, step, farther, reach=20_000.0, distance=far_distance)
    x = np.linspace(-0.9, 0.9, 80)
    y = 0.05 * np.sin(5 * x)
    marked = rng.random(80) < 0.3 if sure else None
    bands = (np.full(80, 300.0), np.full(80, 15_000.0))
    seen = skymatch._through(x, y, fov, 0.0, 0.0, HALF, twist=True, bands=bands, sure=marked)
    tops = skymatch._tops([near, far]) if sure else [None, None]
    headings = skymatch._headings(max(skymatch._step(fov), skymatch.COARSE_MIN, step), None)
    first = skymatch._slide(seen, near, headings, (-10.0, 10.0), tops[0])
    alone = skymatch._slide(seen, far, headings, (-10.0, 10.0), tops[1])
    slid = []
    slide = skymatch._slide
    monkeypatch.setattr(skymatch, "_slide", lambda seen, turn, some, *rest: slid.append(some.size) or slide(seen, turn, some, *rest))
    after = skymatch._slide_after(seen, far, headings, (-10.0, 10.0), tops[1], (near, tops[0], headings, first))
    for a, b in zip(after, alone):
        assert np.array_equal(a.view(np.int64), b.view(np.int64))
    assert not np.array_equal(first[0], alone[0])
    # a narrow lens slides again only the headings near the stretches the cuts tell apart
    if fov < 20.0:
        assert sum(slid) < headings.size / 2


def test_a_lens_keeps_the_places_the_row_by_row_spread_kept():
    """Each lens's few places apart are picked off arrays (`_places`): the very rows, in the same order, that
    spreading out the cheapest headings one row at a time keeps."""
    rng = np.random.default_rng(5)
    for count, apart, most in ((720, 36.0, 6), (3600, 5.0, 6), (300, 73.5, 6), (720, 5.0, 1), (50, 200.0, 6)):
        headings = np.arange(0.0, 360.0, 360.0 / count)
        cost = rng.random(count).round(2)
        cost[rng.random(count) < 0.2] = np.inf
        rows = [(float(cost[i]), float(headings[i]), 0.0, 0.0, 0, 0.0)
                for i in skymatch._cheapest(cost, count) if np.isfinite(cost[i])]
        spread = skymatch._spread_out(rows, apart, most)
        picked = skymatch._places(cost, headings, apart, most)
        assert [(float(cost[i]), float(headings[i])) for i in picked] == [(c, h) for c, h, *_ in spread]
    assert skymatch._places(np.full(10, np.inf), np.arange(10.0), 5.0, 6).size == 0


def test_a_turn_reads_between_its_columns_as_it_always_has():
    """A read starts from each column pair laid ready, a hole's neighbour standing for both: the very numbers
    the interpolation with its holes patched after gives, to the bit."""
    rng = np.random.default_rng(8)
    angles = rng.normal(2.0, 1.0, 720)
    angles[rng.random(720) < 0.1] = np.nan
    angles[100:103] = np.nan
    turn = skymatch.Turn(0.0, 0.5, angles)
    place = np.concatenate([rng.uniform(0.0, 720.0, 50_000), [0.0, 719.0, 719.999, 720.0, 100.5, 101.0]])
    below = np.floor(place)
    i0 = np.minimum(below.astype(np.int64), 719)
    ring = np.append(angles, angles[:1])
    a, b = ring[i0], ring[i0 + 1]
    plain = np.where(np.isnan(b), a, np.where(np.isnan(a), b, a + (b - a) * (place - below)))
    assert np.array_equal(turn.at_place(place).view(np.int64), plain.view(np.int64))
