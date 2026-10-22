"""Find where a photo was taken: the grid, the alignments that narrow it, and the camera found again."""

from dataclasses import replace

import numpy as np
import pytest

from azimut.engine import finder, horizon, horizon_finds, skymatch, terrain, workqueue
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
    monkeypatch.setattr(terrain, "tile", Relief(peaks=PEAKS, plain=200.0, ripple=0.5))
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
    # Auto lays some four thousand points: every 250 m over 100 km², 50 m over 4 km², 20 m over one
    assert finder.auto_spacing(_square(CAMERA, 5_000.0)) == 250.0
    assert finder.auto_spacing(_square(CAMERA, 1_000.0)) == 50.0
    assert finder.auto_spacing(_square(CAMERA, 500.0)) == 20.0
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
    assert big["coarse"] <= finder.PICKED_MAX
    assert finder.estimate(finder.Plan(area=_square(CAMERA, 30_000.0)))["coarse"] <= finder.COARSE_MAX


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


def test_ticked_directions_are_joined_into_sectors_and_narrow_the_march():
    assert finder.facing_sectors(["n"]) == ((0.0, 22.5),)
    # side by side, round north too, they are one sector
    assert finder.facing_sectors(["e", "n", "ne"]) == ((45.0, 67.5),)
    assert finder.facing_sectors(["nw", "n", "ne"]) == ((0.0, 67.5),)
    # apart, each is its own
    assert finder.facing_sectors(["n", "s"]) == ((0.0, 22.5), (180.0, 22.5))
    # none ticked, or all, is the whole turn; a word no compass has is left out
    assert finder.facing_sectors([]) is None
    assert finder.facing_sectors(list(finder.DIRECTIONS)) is None
    assert finder.facing_sectors(["north"]) is None
    lens = lambda **kw: finder.Trace(x=np.zeros(6), y=np.zeros(6), half_width=HALF, fov=40.0, known=True, **kw)  # noqa: E731
    assert finder.turn_share(lens()) == 1.0
    # one direction and a 40° lens: the sector, the photo's half width either side and a margin
    assert finder.turn_share(lens(facing=finder.facing_sectors(["e"]))) == pytest.approx((45 + 40 + 4) / 360, abs=0.01)
    # an unknown lens is marched as wide as the widest it may be
    wide = finder.Trace(x=np.zeros(6), y=np.zeros(6), half_width=HALF, fov=40.0, within=(30.0, 110.0), facing=finder.facing_sectors(["e"]))
    assert finder.turn_share(wide) == pytest.approx((45 + 110 + 4) / 360, abs=0.01)


def test_directions_keep_the_search_to_their_sectors():
    plan = finder.Plan(area=_square(offset(*CAMERA, 60.0, 600.0), 1_500.0), reach=REACH, spacing=500.0, fine=500.0)
    facing_east = _photo()  # 80°: east
    told = replace(facing_east, facing=finder.facing_sectors(["e"]))
    found = finder.search(plan, told)
    best = found["places"][0]
    assert terrain.distance(best["lat"], best["lon"], *CAMERA) < 400.0
    assert best["heading"] == pytest.approx(80.0, abs=3.0)
    # told it faces south, every place found faces south
    south = replace(facing_east, facing=finder.facing_sectors(["s"]))
    for place in finder.search(plan, south)["places"]:
        assert skymatch.within_sectors(place["heading"], ((180.0, 22.5),))


def test_the_ground_ticked_keeps_the_grid_to_it_and_water_only_when_ticked(monkeypatch):
    area = _square(CAMERA, 2_000.0)
    plan = finder.Plan(area=area, spacing=500.0)
    lat, lon = finder.grid(plan, 500.0)
    # the camera's plain, round hills a few kilometres off: all plain or slope, none summit
    shown = finder.preview(plan)
    assert shown["total"] == lat.size == shown["kept"]
    assert {kind for _, _, kind, _ in shown["points"]} <= {"plain", "slope", "valley"}
    summits = finder.preview(finder.Plan(area=area, spacing=500.0, stands=("summit",)))
    assert summits["kept"] == 0 and summits["total"] == lat.size
    assert all(not kept for *_, kept in summits["points"])
    plains = finder.preview(finder.Plan(area=area, spacing=500.0, stands=("plain", "valley")))
    assert plains["kept"] == plains["kinds"]["plain"] + plains["kinds"]["valley"]
    # on water, nobody on foot stands; a drone may fly over it
    terrain.forget_decoded()
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(), plain=0.0))
    wet = finder.preview(plan)
    assert wet["kinds"]["water"] == wet["total"] and wet["kept"] == 0
    assert finder.preview(finder.Plan(area=area, spacing=500.0, mode="drone"))["kept"] == wet["total"]
    # a boat: water ticked keeps it
    assert finder.preview(finder.Plan(area=area, spacing=500.0, stands=("water",)))["kept"] == wet["total"]
    found = finder.search(finder.Plan(area=area, reach=REACH, spacing=500.0, fine=500.0), _photo())
    assert found["points"] == [] and found["verdict"] == "none"


def test_lines_said_how_far_set_the_reach_and_the_grid():
    trace = _photo()
    line = np.zeros(trace.x.size, dtype=np.int64)
    said = replace(trace, marks=skymatch.Marks(line=line, far=((0, 3_000.0, 10_000.0),)))
    # read as far as the farthest line can stand, no farther: what haze hides past it is never searched
    far, cuts = finder.reaches(finder.Plan(area=[]), said)
    assert far == pytest.approx(10_000.0 * skymatch.BAND_SLACK, abs=1.0) and cuts == []
    # a line said nothing of leaves the reach to the rest of the setup
    assert finder.reaches(finder.Plan(area=[]), trace) == finder.reaches(finder.Plan(area=[]))
    # the grid is laid finely enough for the nearest line said
    area = _square(CAMERA, 5_000.0)
    assert finder.asked_spacing(finder.Plan(area=area)) == finder.auto_spacing(area)
    assert finder.asked_spacing(finder.Plan(area=area, near=1_000.0)) == pytest.approx(finder.SAID_SHARE * 1_000.0)
    assert finder.said_nearest([[0, 0.0, 1_000.0]]) == finder.SAID_NEAREST
    assert finder.said_nearest([[0, 3_000.0, 10_000.0], [1, 1_000.0, 3_000.0]]) == 1_000.0
    # a spacing picked is kept for hours of search: 20 m over 25 km² is some 62,000 points
    kept = finder.estimate(finder.Plan(area=_square(CAMERA, 2_500.0), spacing=20.0))
    assert kept["spacing"] == 20.0 and kept["asked"] is None and kept["coarse"] > finder.COARSE_MAX
    assert finder.estimate(finder.Plan(area=_square(CAMERA, 1_000.0)))["asked"] is None
    # past that the grid widens and says so, started near where it ends rather than from millions of points
    big = finder.estimate(finder.Plan(area=_square(CAMERA, 30_000.0), spacing=20.0))
    assert big["asked"] == 20.0 and big["spacing"] > 20.0 and big["coarse"] <= finder.PICKED_MAX
    assert big["coarse"] > 0.9 * finder.PICKED_MAX


def test_near_lines_are_rounded_to_the_planet_s_cell_when_asked():
    ask = {**_ask(), "area": [[lat, lon] for lat, lon in _square(CAMERA, 1_500.0)]}
    assert horizon_finds.trace_from(ask).rounding is None
    assert horizon_finds.trace_from({**ask, "round": True}).rounding == terrain.PLANET_DETAIL_M


def test_the_tilt_follows_who_took_the_photo_and_what_was_said():
    assert finder.tilts_for("ground") == finder.TILTS["ground"]
    assert finder.tilts_for("ground", ["down"])[0] == finder.LOOK_DOWN
    assert finder.tilts_for("ground", ["up"])[1] == finder.LOOK_UP
    assert finder.tilts_for("drone")[0] < -45


def test_a_selfie_is_found_mirrored():
    shot = _photo()
    mirrored = replace(shot, x=-shot.x[::-1], y=shot.y[::-1])
    plan = finder.Plan(area=[CAMERA] * 3, reach=REACH)
    sampler = terrain.Sampler()
    as_shot = finder.score_point(*CAMERA, mirrored, plan, sampler=sampler, quick=False)
    both = finder.score_point(*CAMERA, replace(mirrored, mirror=True), plan, sampler=sampler, quick=False)
    assert both["mirrored"] is True
    # the score lets one quarter of the trace go, so a flipped trace keeps some of its fit (0.83 here)
    assert both["explained"] > as_shot["explained"] + 0.15
    assert both["heading"] == pytest.approx(80.0, abs=2.0)


def test_the_turn_is_marched_as_wide_as_the_trace_spans():
    lens = finder.Trace(x=np.array([-0.5, 0.5] * 3), y=np.zeros(6), half_width=HALF, fov=40.0, known=True)
    assert finder.half_span(lens) == pytest.approx(20.0)
    # a collage read frame by frame spans past its frames' lens
    wide = replace(lens, x=np.array([-4.0, 3.0] * 3))
    assert finder.half_span(wide) == pytest.approx(np.degrees(np.arctan(4.0 * np.tan(np.radians(20.0)))))


def test_zones_lay_their_own_grid_and_zones_left_out_are_never_searched():
    area = _square(CAMERA, 3_000.0)
    finer = finder.Zone(area=_square(offset(*CAMERA, 45.0, 1_000.0), 500.0), spacing=100.0)
    lake = finder.Zone(area=_square(offset(*CAMERA, 225.0, 1_500.0), 600.0), out=True)
    plan = finder.Plan(area=area, spacing=500.0, zones=(finer, lake))
    lat, lon, steps = finder.spaced_grid(plan, 500.0)
    plain = finder.grid(finder.Plan(area=area, spacing=500.0), 500.0)[0].size
    in_finer = finder.inside(finer.area, lat, lon)
    # the zone's own 100 m grid, its points saying their spacing
    assert in_finer.sum() >= 80 and set(steps[in_finer].tolist()) == {100.0}
    assert set(steps[~in_finer].tolist()) == {500.0}
    # nothing in the zone left out, even where the area covers it
    assert not finder.inside(lake.area, lat, lon).any()
    assert lat.size > plain
    # a zone searched beyond the area adds its ground; a zone with no spacing is laid a third as wide
    beyond = finder.Zone(area=_square(offset(*CAMERA, 90.0, 6_000.0), 800.0))
    assert finder.zone_spacings(finder.Plan(area=area, zones=(beyond,)), 600.0) == [200.0]
    far = finder.spaced_grid(finder.Plan(area=area, spacing=500.0, zones=(beyond,)), 500.0)
    assert finder.inside(beyond.area, far[0], far[1]).sum() > 0
    assert finder.within(plan, np.array([CAMERA[0]]), np.array([CAMERA[1]]))[0]
    lake_middle = offset(*CAMERA, 225.0, 1_500.0)
    assert not finder.within(plan, np.array([lake_middle[0]]), np.array([lake_middle[1]]))[0]
    # the zones' grids between them are capped: their spacing widens alike
    huge = finder.Zone(area=_square(CAMERA, 20_000.0), spacing=50.0)
    assert finder.zone_spacings(finder.Plan(area=area, zones=(huge,)), 500.0)[0] > 50.0
    # and the estimate says by how much, for the zones given a spacing only
    wider = finder.estimate(finder.Plan(area=area, spacing=500.0, zones=(huge,)))["zones_wider"]
    assert wider == pytest.approx(finder.zone_spacings(finder.Plan(area=area, zones=(huge,)), 500.0)[0] / 50.0, rel=0.01)
    fine = finder.Zone(area=_square(CAMERA, 500.0), spacing=20.0)
    assert finder.estimate(finder.Plan(area=area, spacing=500.0, zones=(fine,)))["zones_wider"] is None
    assert finder.zones_wider(finder.Plan(area=area, zones=(finder.Zone(area=huge.area),)), 500.0) is None


def test_a_search_with_a_zone_left_out_keeps_out_of_it():
    lake = finder.Zone(area=_square(CAMERA, 400.0), out=True)
    plan = finder.Plan(area=_square(offset(*CAMERA, 60.0, 600.0), 1_500.0), reach=REACH, spacing=500.0, fine=500.0, zones=(lake,))
    found = finder.search(plan, _photo())
    assert found["points"]
    assert not finder.inside(lake.area, np.array([p["lat"] for p in found["points"]]), np.array([p["lon"] for p in found["points"]])).any()


def test_headings_go_to_masks_and_back():
    sectors = finder.facing_sectors(["n", "ne", "s"])
    back = finder.mask_sectors(finder.heading_mask(sectors))
    assert back is not None and len(back) == 2
    # back to sectors and to headings again, within the degree a border rounds to
    assert abs(int(finder.heading_mask(back).sum()) - int(finder.heading_mask(sectors).sum())) <= 2
    assert abs(int(finder.heading_mask(sectors).sum()) - 135) <= 2
    assert finder.mask_sectors(finder.heading_mask(None)) is None
    assert finder.mask_sectors(np.zeros(360, dtype=bool)) == ()


def test_the_sun_against_the_camera_gives_its_headings():
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from azimut.engine import sky

    noon = datetime(2024, 6, 21, 13, 0, tzinfo=ZoneInfo("Europe/Paris"))
    azimuth = float(sky.positions(*CAMERA, [noon])["sun_azimuth"][0])
    mask, read = finder.sun_headings(*CAMERA, "2024-06-21", "13:00", "13:00", ["ahead"])
    assert read["up"] and read["zone"] == "Europe/Paris" and read["from"] == pytest.approx(azimuth, abs=0.1)
    # facing the sun: a quarter turn about it
    assert mask[int(azimuth)] and abs(int(mask.sum()) - 90) <= 1
    assert not mask[int(azimuth + 180) % 360]
    # the sun on the right: the camera faced a quarter turn short of it
    right, _ = finder.sun_headings(*CAMERA, "2024-06-21", "13:00", "13:00", ["right"])
    assert right[int(azimuth - 90) % 360] and not right[int(azimuth) % 360]
    # a window widens it: the sun moves over the afternoon
    afternoon, _ = finder.sun_headings(*CAMERA, "2024-06-21", "13:00", "17:00", ["ahead"])
    assert afternoon.sum() > mask.sum() + 40
    # at night the sun says nothing; no side said, nothing either
    _, dark = finder.sun_headings(*CAMERA, "2024-06-21", "02:00", "03:00", ["ahead"])
    assert dark["up"] is False
    assert finder.sun_headings(*CAMERA, "2024-06-21", "13:00", "14:00", []) is None
    # with compass directions, a heading must agree with both
    south_sun = finder.facing_with_sun(finder.facing_sectors(["s", "sw"]), mask)
    assert south_sun and finder.heading_mask(south_sun).sum() < finder.heading_mask(finder.facing_sectors(["s", "sw"])).sum()
    assert finder.facing_with_sun(finder.facing_sectors(["n"]), mask) == ()


def test_a_large_grid_is_scored_by_processes_and_finds_the_same_camera():
    plan = finder.Plan(area=_square(offset(*CAMERA, 60.0, 600.0), 2_000.0), reach=REACH, spacing=250.0, fine=250.0)
    trace = _photo()
    assert finder.grid(plan, 250.0)[0].size >= finder.LANE_MIN_POINTS
    told = []
    alone = finder.search(plan, trace)
    shared = finder.search(plan, trace, lanes=2, progress=lambda done, total: told.append((done, total)))
    assert shared["places"][0]["lat"] == pytest.approx(alone["places"][0]["lat"], abs=1e-6)
    assert shared["places"][0]["explained"] == pytest.approx(alone["places"][0]["explained"], abs=1e-6)
    assert len(shared["points"]) == len(alone["points"])
    # progress is told once a point, rising
    assert [done for done, _ in told] == sorted(done for done, _ in told)
    # a stop asked reaches the processes too
    with pytest.raises(finder.Cancelled):
        finder.search(plan, trace, lanes=2, cancelled=lambda: True)


def test_a_fast_search_takes_the_cores_the_machine_can_spare(monkeypatch):
    assert horizon_finds.lanes_for("gentle") == 1
    monkeypatch.setattr("os.cpu_count", lambda: 16)
    monkeypatch.setattr(horizon_finds, "_available_memory", lambda: 16e9)
    assert horizon_finds.lanes_for("fast") == horizon_finds.LANES_MAX
    monkeypatch.setattr(horizon_finds, "_available_memory", lambda: 2.5e9)
    assert horizon_finds.lanes_for("fast") == 1
    monkeypatch.setattr(horizon_finds, "_available_memory", lambda: None)
    monkeypatch.setattr("os.cpu_count", lambda: 4)
    assert horizon_finds.lanes_for(None) == 2


def test_a_line_along_the_sea_lies_on_the_sea_s_horizon(monkeypatch):
    coast = (12.7, 43.5)
    land = Peak(*offset(*coast, 90.0, 3_000.0), height=400.0, radius=2_500.0)
    headland = Peak(*offset(*coast, 225.0, 6_000.0), height=250.0, radius=900.0)
    terrain.forget_decoded()
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(land, headland), plain=0.0))
    # the sea's horizon from 2 m and from 200 m above it
    assert finder.sea_horizon(2.0) == pytest.approx(5_400, rel=0.03)
    assert finder.sea_horizon(200.0) == pytest.approx(54_100, rel=0.03)
    swept = horizon.sweep(horizon.Observer(*coast), azimuths=np.arange(0.0, 360.0, 0.1), far=80_000.0)
    turn = skymatch.Turn(0.0, 0.1, swept.skyline, distance=swept.skyline_distance)
    x, y = trace_on(turn, heading=245.0, fov=60.0)
    # the headland is one stroke, the sea's horizon past it another, said to be the sea
    out_at_sea = turn.far(245.0 + skymatch.directions(x, y, fov=60.0)[0]) > 20_000
    line = out_at_sea.astype(np.int64)
    trace = finder.Trace(x=x, y=y, half_width=HALF, fov=60.0, known=True, floor=finder.FLOOR_M,
                         marks=skymatch.Marks(line=line, sea=(1,)))
    plan = finder.Plan(area=[coast] * 3)
    sampler = terrain.Sampler()
    found = finder.score_point(*coast, trace, plan, sampler=sampler, quick=False)
    assert found["explained"] > 0.5 and found["heading"] == pytest.approx(245.0, abs=1.5)
    # the same stroke said to stand within a kilometre cannot lie on that horizon
    near = replace(trace, marks=skymatch.Marks(line=line, far=((1, 0.0, 1_000.0),)))
    assert finder.score_point(*coast, near, plan, sampler=sampler, quick=False)["explained"] < found["explained"] - 0.3
    terrain.forget_decoded()


def test_a_line_with_only_sky_above_is_read_as_far_as_the_photo_is_said_to_see(monkeypatch):
    eye = (12.7, 43.5)
    hill = Peak(*offset(*eye, 90.0, 3_000.0), height=300.0, radius=1_000.0)
    mountain = Peak(*offset(*eye, 100.0, 8_000.0), height=1_500.0, radius=1_500.0)
    terrain.forget_decoded()
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(hill, mountain), plain=0.0))
    # haze stops the air at 5 km: the hill is the skyline, the mountain behind it unseen
    swept = horizon.sweep(horizon.Observer(*eye), azimuths=np.arange(0.0, 360.0, 0.1), far=20_000.0, cuts=[5_000.0])
    x, y = trace_on(skymatch.Turn(0.0, 0.1, swept.skyline_cuts[0]), heading=95.0, fov=40.0)
    # the line said to stand 1 to 3 km off: the turn is searched no farther than that, whatever the reach
    line = np.zeros(x.size, dtype=np.int64)
    said = skymatch.Marks(line=line, far=((0, 1_000.0, 3_000.0),))
    sure = replace(said, clear=(0,))
    trace = finder.Trace(x=x, y=y, half_width=HALF, fov=40.0, known=True)
    sampler = terrain.Sampler()

    def scored(reach, marks):
        plan = finder.Plan(area=[eye] * 3, reach=reach)
        return finder.score_point(*eye, replace(trace, marks=marks), plan, sampler=sampler, quick=False)

    found = scored(10_000.0, said)
    assert found["explained"] > 0.5 and "over" not in found
    # left to Auto or said to see 5 km, the line has only sky above it as far as that: the mountain is haze's
    for reach in (None, 5_000.0):
        kept = scored(reach, sure)
        assert kept["over"] == 0.0 and kept["explained"] == pytest.approx(found["explained"], abs=1e-3)
    # said to see 10 km, the mountain stands over the line, read past where the line is searched: no place
    lost = scored(10_000.0, sure)
    assert lost["over"] > 0.2 and lost["explained"] == 0.0 and lost["reach"] == found["reach"]
    # a saved trace carries the lines it says have only sky above
    assert finder.marks_of({"line": [0, 0, 1], "clear": [1]}).clear == (1,)
    terrain.forget_decoded()


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


def test_a_reach_given_is_read_as_about_that_far():
    assert finder.reaches(finder.Plan(area=[])) == (finder.AUTO_FAR, list(finder.AUTO_CUTS))
    # a ridge just past the reach still counts: the turn runs on to twice as far
    assert finder.reaches(finder.Plan(area=[], reach=5_000.0)) == (10_000.0, [5_000.0])
    assert finder.reaches(finder.Plan(area=[], reach=40_000.0)) == (finder.AUTO_FAR, [40_000.0])
    assert finder.reaches(finder.Plan(area=[], reach=100_000.0)) == (100_000.0, [])


def test_the_relief_is_how_far_the_ridges_the_trace_lies_on_stand():
    # near hills to the east, far ones elsewhere: a fit facing east lies on the near ones
    distance = np.where((np.arange(360) >= 60) & (np.arange(360) < 120), 1_500.0, 40_000.0)
    turn = skymatch.Turn(0.0, 1.0, np.zeros(360), distance=distance)
    east = skymatch.Fit(heading=90.0, tilt=0.0, fov=40.0, gap=0.0, explained=0.8, points=50)
    assert finder.relief(turn, east) == 1_500.0
    assert finder.relief(turn, skymatch.Fit(**{**east.__dict__, "heading": 250.0})) == 40_000.0
    assert finder.relief(skymatch.Turn(0.0, 1.0, np.zeros(360)), east) == float("inf")


def test_cells_near_relief_are_filled_in_within_the_budget():
    area = _square(CAMERA, 2_000.0)
    plan = finder.Plan(area=area)
    lat, lon = finder.grid(plan, 500.0)
    seen = {(round(float(a), 6), round(float(o), 6)) for a, o in zip(lat, lon)}
    coarse = [{"lat": float(a), "lon": float(o), "explained": 0.1, "relief": 1_500.0} for a, o in zip(lat, lon)]
    # ridges 1.5 km out: a tenth of that is 150 m, three points a side in a 500 m cell (its middle scored)
    one = finder.filled(plan, coarse[27:28], 500.0, 60.0, set(seen))
    assert len(one) == 0  # a single cell's eight would pass its budget of three: two a side instead
    extra = finder.filled(plan, coarse, 500.0, 60.0, set(seen))
    assert extra[0][2] == pytest.approx(500.0 / 3)
    assert len(extra) <= finder.DENSE_MAX * len(coarse)
    assert finder.inside(area, np.array([e[0] for e in extra]), np.array([e[1] for e in extra])).all()
    # past the budget the nearest relief comes first, the rest two by two, then none
    nearest = [{**p, "relief": 1_500.0 if i else 400.0} for i, p in enumerate(coarse)]
    many = finder.filled(plan, nearest, 500.0, 25.0, set(seen))
    assert len(many) <= finder.DENSE_MAX * len(coarse)
    assert many[0][2] == pytest.approx(500.0 / 12)  # the nearest relief's cell (40 m), filled first and finest
    assert {round(own, 3) for _, _, own in many[144:]} <= {round(500.0 / 3, 3), 250.0}
    # a plain seeing no relief, or relief far enough for the grid, is left as it is
    assert finder.filled(plan, [{**p, "relief": float("inf")} for p in coarse], 500.0, 60.0, set(seen)) == []
    assert finder.filled(plan, [{**p, "relief": 9_000.0} for p in coarse], 500.0, 60.0, set(seen)) == []
    assert finder.estimate(plan)["most"] >= finder.estimate(plan)["points"]


def test_the_marks_a_saved_trace_holds_come_back():
    assert finder.marks_of({"x": [0.0]}) is None
    marks = finder.marks_of({"ridge_x": [0.1, 0.2], "ridge_y": [0.0, 0.0], "ridge_line": [1, 1], "line": [0, 0],
                             "pairs": [[1, 0]], "piece": [0, 1], "ridge_piece": [0, 1]})
    assert marks.pairs == ((1, 0),)
    assert marks.ridge_x.tolist() == [0.1, 0.2]
    assert marks.cut


def test_inner_edges_are_judged_at_every_place_searched():
    trace = _photo()
    # an inner edge a degree under the skyline across the middle: no such ridge stands there
    marks = skymatch.Marks(ridge_x=np.linspace(-0.3, 0.3, 20), ridge_y=np.full(20, float(np.median(trace.y)) - 0.05))
    plan = finder.Plan(area=_square(offset(*CAMERA, 60.0, 600.0), 1_500.0), reach=REACH, spacing=500.0, fine=500.0)
    found = finder.search(plan, finder.Trace(**{**trace.__dict__, "marks": marks}))
    best = found["places"][0]
    assert "inner" in best and "sky" in best
    assert best["explained"] <= best["sky"] + 1e-9


def test_a_collage_cut_in_pieces_gives_each_place_its_pieces():
    trace = _photo()
    marks = skymatch.Marks(piece=(trace.x > 0).astype(np.int64))
    plan = finder.Plan(area=_square(offset(*CAMERA, 60.0, 600.0), 1_500.0), reach=REACH, spacing=500.0, fine=500.0)
    best = finder.search(plan, finder.Trace(**{**trace.__dict__, "marks": marks}))["places"][0]
    assert [piece["piece"] for piece in best["pieces"]] == [0, 1]
    assert all(abs(piece["turn"]) <= skymatch.PIECE_TURN for piece in best["pieces"])


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
    # every point says how far off the terrain the trace lies there, for a map with nothing explained
    assert all(point["gap"] >= 0 for point in record["result"]["points"])
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


def test_a_search_keeps_the_directions_ticked_and_runs_with_them(client):
    case_id = client.post("/api/cases", json={"name": "Facing search"}).json()["id"]
    started = client.post(f"/api/cases/{case_id}/horizon/finds", json=_ask(facing=["ne", "e"]))
    assert started.status_code == 200, started.text
    name = started.json()["name"]
    client.post(f"/api/cases/{case_id}/horizon/finds/{name}/cancel")
    workqueue.wait_until_idle(timeout=120)
    ask = client.get(f"/api/cases/{case_id}/horizon/finds/{name}").json()["ask"]
    assert ask["facing"] == ["ne", "e"]
    plan, trace = horizon_finds.plan_of(ask)
    assert trace.facing == ((67.5, 45.0),)
    assert plan.stands == ()
    # every search keeps unsaid lines off the eye's own slope, and bounds the tilt as who took it
    assert trace.floor == finder.FLOOR_M and trace.tilts == finder.TILTS["ground"] and not trace.mirror
    _, looking = horizon_finds.plan_of({**ask, "view": ["down"], "mirror": True})
    assert looking.tilts[0] == finder.LOOK_DOWN and looking.mirror
    # a search saved before directions could be ticked keeps the trace's own sector, if any
    _, old = horizon_finds.plan_of({**ask, "facing": None, "trace": {**ask["trace"], "facing": [200.0, 30.0]}})
    assert old.facing == ((200.0, 30.0),)


def test_a_search_keeps_how_far_its_lines_stand_how_the_camera_looks_and_a_selfie(client):
    case_id = client.post("/api/cases", json={"name": "Said search"}).json()["id"]
    count = len(_ask()["trace"]["x"])
    trace = {**_ask()["trace"], "line": [0] * count, "far": [[0, 1_000.0, 3_000.0]]}
    started = client.post(f"/api/cases/{case_id}/horizon/finds",
                          json=_ask(trace=trace, view=["down"], mirror=True, stands=["water"]))
    assert started.status_code == 200, started.text
    name = started.json()["name"]
    client.post(f"/api/cases/{case_id}/horizon/finds/{name}/cancel")
    workqueue.wait_until_idle(timeout=120)
    ask = client.get(f"/api/cases/{case_id}/horizon/finds/{name}").json()["ask"]
    assert ask["view"] == ["down"] and ask["mirror"] is True and ask["stands"] == ["water"]
    plan, read = horizon_finds.plan_of(ask)
    assert read.marks.far == ((0, 1_000.0, 3_000.0),) and read.mirror and read.tilts[0] == finder.LOOK_DOWN
    # the grid is laid for the nearest line said
    assert plan.near == 1_000.0
    # zones are kept with the question, and an area of a few thousand km² is searched
    zones = [{"area": _ask()["area"], "spacing": 100.0}, {"area": [{"lat": lat, "lon": lon} for lat, lon in _square(CAMERA, 300.0)], "out": True}]
    big = [{"lat": lat, "lon": lon} for lat, lon in _square(CAMERA, 35_000.0)]
    zoned = client.post(f"/api/cases/{case_id}/horizon/finds", json=_ask(zones=zones, area=big))
    assert zoned.status_code == 200, zoned.text
    client.post(f"/api/cases/{case_id}/horizon/finds/{zoned.json()['name']}/cancel")
    workqueue.wait_until_idle(timeout=120)
    kept = client.get(f"/api/cases/{case_id}/horizon/finds/{zoned.json()['name']}").json()["ask"]["zones"]
    assert kept[0]["spacing"] == 100.0 and kept[1]["out"] is True and len(kept[1]["area"][0]) == 2
    zoned_plan, _ = horizon_finds.plan_of(client.get(f"/api/cases/{case_id}/horizon/finds/{zoned.json()['name']}").json()["ask"])
    assert [zone.out for zone in zoned_plan.zones] == [False, True]
    estimate = client.post("/api/horizon/finds/estimate", json=_ask(trace=trace)).json()
    assert estimate["spacing"] <= finder.SAID_SHARE * 1_000.0 * 1.25 ** 8


def test_the_sectors_a_setup_leaves_are_said_before_the_search(client):
    area = _ask()["area"]
    every = client.post("/api/horizon/finds/sectors", json={"area": area}).json()
    assert every == {"sectors": None, "sun": None}
    east = client.post("/api/horizon/finds/sectors", json={"area": area, "facing": ["e"]}).json()
    assert east["sectors"] == [[90.0, 22.5]]
    sun = {"date": "2024-06-21", "start": "13:00", "end": "13:00", "sides": ["ahead"]}
    lit = client.post("/api/horizon/finds/sectors", json={"area": area, "sun": sun}).json()
    assert lit["sun"]["up"] is True and len(lit["sectors"]) == 1 and lit["sectors"][0][1] == pytest.approx(45.5, abs=0.6)
    none = client.post("/api/horizon/finds/sectors", json={"area": area, "facing": ["n"], "sun": sun}).json()
    assert none["sectors"] == []
    # a search the sun and the compass leave no heading to is refused, and a sun said badly too
    case_id = client.post("/api/cases", json={"name": "Sun search"}).json()["id"]
    url = f"/api/cases/{case_id}/horizon/finds"
    assert client.post(url, json=_ask(facing=["n"], sun=sun)).status_code == 422
    assert client.post(url, json=_ask(sun={**sun, "date": "21/06/2024"})).status_code == 422
    assert client.post(url, json=_ask(sun={**sun, "sides": ["up"]})).status_code == 422
    started = client.post(url, json=_ask(sun=sun))
    assert started.status_code == 200, started.text
    client.post(f"{url}/{started.json()['name']}/cancel")
    workqueue.wait_until_idle(timeout=120)
    ask = client.get(f"{url}/{started.json()['name']}").json()["ask"]
    _, trace = horizon_finds.plan_of(ask)
    assert trace.facing == horizon_finds.facing_of(ask) and trace.facing is not None


def test_a_point_is_tried_alone_as_a_search_would_score_it(client):
    case_id = client.post("/api/cases", json={"name": "Tried point"}).json()["id"]
    body = {key: value for key, value in _ask().items() if key not in ("area", "spacing", "title")}
    here = client.post(f"/api/cases/{case_id}/horizon/finds/try", json={**body, "at": {"lat": CAMERA[0], "lon": CAMERA[1]}})
    assert here.status_code == 200, here.text
    place = here.json()["place"]
    assert place["explained"] > 0.5 and place["heading"] == pytest.approx(80.0, abs=2.0)
    assert here.json()["frames"] is None
    away = client.post(f"/api/cases/{case_id}/horizon/finds/try",
                       json={**body, "at": dict(zip(("lat", "lon"), offset(*CAMERA, 200.0, 3_000.0)))}).json()["place"]
    assert away["explained"] < place["explained"]
    assert client.post(f"/api/cases/{case_id}/horizon/finds/try", json={**body, "at": {"lat": 95, "lon": 0}}).status_code == 422
    assert client.post(f"/api/cases/{case_id}/horizon/finds/try", json={**body, "at": {"lat": 45, "lon": 6}, "reach": 7}).status_code == 422


def test_a_finished_search_is_checked_against_decoys_of_its_trace(client):
    case_id = client.post("/api/cases", json={"name": "Checked search"}).json()["id"]
    url = f"/api/cases/{case_id}/horizon/finds"
    name = client.post(url, json=_ask()).json()["name"]
    workqueue.wait_until_idle(timeout=180)
    assert client.get(f"{url}/{name}").json()["status"] == "done"
    checked = client.post(f"{url}/{name}/check")
    assert checked.status_code == 200, checked.text
    record = checked.json()
    assert record["result"]["checked"] is True
    best = record["result"]["places"][0]
    # the real trace explains the camera's place better than its decoys do, by more than the margin
    # that marks a place any shape fits (lib/horizon/find.js DECOY_MARGIN; 0.35 to 0.45 on solved views)
    assert best["decoy"] < best["explained"] - 0.15
    assert client.get(f"{url}/{name}").json()["result"]["places"][0]["decoy"] == best["decoy"]
    # a search still running, or gone, cannot be checked
    running = client.post(url, json=_ask()).json()["name"]
    assert client.post(f"{url}/{running}/check").status_code in (409, 200)
    client.post(f"{url}/{running}/cancel")
    workqueue.wait_until_idle(timeout=180)
    assert client.post(f"{url}/nothing/check").status_code == 404


def test_a_search_keeps_the_marks_beside_its_trace(client):
    case_id = client.post("/api/cases", json={"name": "Marked search"}).json()["id"]
    trace = {**_ask()["trace"], "ridge_x": [0.0, 0.1, 0.2, 0.3, 0.4, 0.5], "ridge_y": [-0.3] * 6,
             "ridge_line": [1] * 6, "line": [0] * len(_ask()["trace"]["x"]), "pairs": [[1, 0]]}
    started = client.post(f"/api/cases/{case_id}/horizon/finds", json=_ask(trace=trace))
    assert started.status_code == 200, started.text
    name = started.json()["name"]
    client.post(f"/api/cases/{case_id}/horizon/finds/{name}/cancel")
    workqueue.wait_until_idle(timeout=120)
    kept = client.get(f"/api/cases/{case_id}/horizon/finds/{name}").json()["ask"]["trace"]
    assert kept["pairs"] == [[1, 0]] and kept["ridge_x"][:2] == [0.0, 0.1]


def test_a_search_keeps_the_curve_and_corners_its_photo_was_read_through(client):
    case_id = client.post("/api/cases", json={"name": "Curved search"}).json()["id"]
    corners = [{"u": 0.02, "v": 0.0}, {"u": 1.0, "v": 0.03}, {"u": 0.98, "v": 1.0}, {"u": 0.0, "v": 0.97}]
    photo = {"path": "media/p.png", "strokes": [[{"u": 0.1, "v": 0.4}, {"u": 0.9, "v": 0.35}]], "bend": -0.12, "corners": corners}
    started = client.post(f"/api/cases/{case_id}/horizon/finds", json=_ask(photo=photo))
    assert started.status_code == 200, started.text
    name = started.json()["name"]
    client.post(f"/api/cases/{case_id}/horizon/finds/{name}/cancel")
    workqueue.wait_until_idle(timeout=120)
    kept = client.get(f"/api/cases/{case_id}/horizon/finds/{name}").json()["ask"]["photo"]
    assert kept["bend"] == -0.12 and kept["corners"] == corners
    # a photo laid straight keeps neither
    plain = client.post(f"/api/cases/{case_id}/horizon/finds", json=_ask(photo={"path": "media/p.png"})).json()["name"]
    client.post(f"/api/cases/{case_id}/horizon/finds/{plain}/cancel")
    workqueue.wait_until_idle(timeout=120)
    straight = client.get(f"/api/cases/{case_id}/horizon/finds/{plain}").json()["ask"]["photo"]
    assert straight["bend"] == 0 and straight["corners"] is None


def test_a_search_says_its_size_first_and_refuses_what_it_cannot_run(client):
    estimate = client.post("/api/horizon/finds/estimate", json=_ask()).json()
    assert estimate["coarse"] > 0 and estimate["step"] == 0.5
    assert estimate["most"] >= estimate["points"]
    assert estimate["turn"] == 1.0
    # a grid as fine as 20 m may be asked, and is kept as asked
    fine = client.post("/api/horizon/finds/estimate", json=_ask(spacing=20.0))
    assert fine.status_code == 200, fine.text
    assert fine.json()["spacing"] == 20.0 and fine.json()["asked"] is None and fine.json()["zones_wider"] is None
    # a direction ticked marches a share of the turn: the time said shrinks with it
    east = client.post("/api/horizon/finds/estimate", json=_ask(facing=["e"])).json()
    assert east["turn"] < 0.3 and east["points"] == estimate["points"]
    # the grid before the search, each point with its ground, the ground ticked kept
    shown = client.post("/api/horizon/finds/preview", json=_ask(stands=["summit"])).json()
    assert shown["total"] > 0 and shown["kept"] == shown["kinds"]["summit"]
    assert len(shown["points"]) == shown["total"]
    # read before any trace is drawn: the area alone is enough
    bare = client.post("/api/horizon/finds/preview", json={"area": _ask()["area"], "spacing": 500.0})
    assert bare.status_code == 200, bare.text
    assert bare.json()["total"] == shown["total"]
    case_id = client.post("/api/cases", json={"name": "Refused searches"}).json()["id"]
    url = f"/api/cases/{case_id}/horizon/finds"
    tiny = [{"lat": 45.0, "lon": 6.0}, {"lat": 45.0001, "lon": 6.0}, {"lat": 45.0, "lon": 6.0001}]
    for change in (
        {"area": tiny},
        {"area": _ask()["area"][:2]},
        {"reach": 12_345},
        {"who": {"mode": "drone", "low": 200, "high": 50}},
        {"trace": {**_ask()["trace"], "fov": 200.0}},
        {"trace": {**_ask()["trace"], "pairs": [[2, 2]]}},
        {"trace": {**_ask()["trace"], "ridge_x": [0.1], "ridge_y": []}},
        {"photo": {"path": "media/p.png", "strokes": [], "marks": {"cuts": [2.0]}}},
        {"photo": {"path": "media/p.png", "bend": 0.5}},
        {"photo": {"path": "media/p.png", "corners": [{"u": 0.0, "v": 0.0}] * 3}},
        {"facing": ["north"]},
        {"stands": ["cliff"]},
        {"view": ["sideways"]},
        {"area": [{"lat": lat, "lon": lon} for lat, lon in _square(CAMERA, 60_000.0)]},
        {"zones": [{"area": tiny}]},
        {"zones": [{"area": _ask()["area"], "spacing": 10}]},
        {"spacing": 10},
        # a line's distance needs each point's stroke, and its nearest before its farthest
        {"trace": {**_ask()["trace"], "far": [[0, 1_000.0, 3_000.0]]}},
        {"trace": {**_ask()["trace"], "line": [0] * len(_ask()["trace"]["x"]), "far": [[0, 3_000.0, 1_000.0]]}},
        {"trace": {**_ask()["trace"], "sea": [0]}},
        # a line with only sky above needs each point's stroke, and a stroke there is
        {"trace": {**_ask()["trace"], "clear": [0]}},
        {"trace": {**_ask()["trace"], "line": [0] * len(_ask()["trace"]["x"]), "clear": [100_000]}},
    ):
        assert client.post(url, json=_ask(**change)).status_code == 422
    assert client.get(f"{url}/nothing").status_code == 404
