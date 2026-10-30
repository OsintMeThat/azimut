"""Find where a photo was taken: the grid, the alignments that narrow it, and the camera found again."""

import json
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from azimut.engine import finder, horizon, horizon_finds, landform, skymatch, terrain, workqueue
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
    # a hex lattice: a quarter fewer points than a square grid 500 m apart (64), no spot farther from one
    assert 46 <= lat.size <= 52
    assert finder.inside(area, lat, lon).all()
    rng = np.random.default_rng(1)
    spots = [offset(*CAMERA, b, d) for b, d in zip(rng.uniform(0, 360, 200), np.sqrt(rng.uniform(0, 1, 200)) * 1_400.0)]
    nearest = [min(terrain.distance(a, o, *spot) for a, o in zip(lat, lon)) for spot in spots]
    assert max(nearest) <= 500.0 / 2**0.5 * 1.01
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
    # a couple of hundred metres off, ridges 3 to 7 km out turn by a degree or two
    assert best["heading"] == pytest.approx(80.0, abs=2.0)
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
    # a spacing picked is kept for hours of search: 20 m over 25 km² is some 48,000 points
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


def test_several_areas_share_one_grid_and_the_spacing_counts_them_all():
    first = _square(CAMERA, 2_000.0)
    # one beside it and one overlapping it: every point is laid once
    beside = _square(offset(*CAMERA, 90.0, 6_000.0), 1_000.0)
    over = _square(offset(*CAMERA, 0.0, 1_500.0), 1_000.0)
    plan = finder.Plan(area=first, spacing=500.0, areas=(beside, over))
    lat, lon = finder.grid(plan, 500.0)
    assert finder.inside(beside, lat, lon).sum() > 0
    assert finder.within(plan, lat, lon).all()
    assert len({(round(a, 6), round(o, 6)) for a, o in zip(lat, lon)}) == lat.size
    assert lat.size > finder.grid(finder.Plan(area=first, spacing=500.0), 500.0)[0].size
    # Auto lays its points over every area: wider than over the first alone
    assert finder.searched_m2(plan) > finder.area_m2(first)
    assert finder.asked_spacing(replace(plan, spacing=None)) >= finder.asked_spacing(finder.Plan(area=first))
    # one area alone is laid as it always was
    alone = finder.Plan(area=first, spacing=500.0)
    assert np.array_equal(np.column_stack(finder.grid(alone, 500.0)), np.column_stack(finder._polygon_grid(first, 500.0)))


def test_the_brush_paints_points_out_and_back_in_each_stroke_over_the_last():
    area = _square(CAMERA, 2_000.0)
    across = [offset(*CAMERA, 270.0, 2_500.0), offset(*CAMERA, 90.0, 2_500.0)]
    out = finder.Stroke(path=across, radius=400.0)
    plan = finder.Plan(area=area, spacing=250.0, strokes=(out,))
    lat, lon = finder.grid(plan, 250.0)
    plain = finder.grid(finder.Plan(area=area, spacing=250.0), 250.0)
    assert lat.size < plain[0].size
    assert not finder.near_path(across, 400.0, lat, lon).any()
    # painted back over the middle: the middle comes back, the rest of the band stays out
    back = finder.Stroke(path=[offset(*CAMERA, 270.0, 300.0), offset(*CAMERA, 90.0, 300.0)], radius=200.0, out=False)
    again = finder.grid(replace(plan, strokes=(out, back)), 250.0)
    middle = finder.near_path(back.path, 200.0, *again)
    assert middle.sum() > 0 and again[0].size < plain[0].size
    # painted in beyond every area: that ground is searched too
    far = finder.Stroke(path=[offset(*CAMERA, 0.0, 5_000.0), offset(*CAMERA, 0.0, 6_000.0)], radius=300.0, out=False)
    beyond = finder.grid(finder.Plan(area=area, spacing=250.0, strokes=(far,)), 250.0)
    assert finder.near_path(far.path, 300.0, *beyond).sum() > 0
    # ground painted in past the area's box leaves the area's own points where they were: the lattice holds
    # to the area's corner, so the map lays the new ones beside them while the brush paints
    south = finder.Stroke(path=[offset(*CAMERA, 200.0, 2_400.0), offset(*CAMERA, 250.0, 3_500.0)], radius=300.0, out=False)
    grown = finder.grid(finder.Plan(area=area, spacing=250.0, strokes=(far, south)), 250.0)
    held = {(round(a, 6), round(o, 6)) for a, o in zip(*grown)}
    assert {(round(a, 6), round(o, 6)) for a, o in zip(*plain)} <= held
    # the preview keeps what the brush left out on the map, greyed and said painted, the ground under it after
    shown = finder.preview(plan)
    painted = [point for point in shown["points"] if point[2] == finder.PAINTED]
    assert painted and not any(point[3] for point in painted)
    assert all(point[4] in landform.STANDS for point in painted)
    assert all(len(point) == 4 for point in shown["points"] if point[2] != finder.PAINTED)
    assert shown["total"] == plain[0].size and shown["kept"] == lat.size


def test_zones_lay_their_own_grid_and_zones_left_out_are_never_searched():
    area = _square(CAMERA, 3_000.0)
    finer = finder.Zone(area=_square(offset(*CAMERA, 45.0, 1_000.0), 500.0), spacing=100.0)
    lake = finder.Zone(area=_square(offset(*CAMERA, 225.0, 1_500.0), 600.0), out=True)
    plan = finder.Plan(area=area, spacing=500.0, zones=(finer, lake))
    lat, lon, steps = finder.spaced_grid(plan, 500.0)
    plain = finder.grid(finder.Plan(area=area, spacing=500.0), 500.0)[0].size
    in_finer = finder.inside(finer.area, lat, lon)
    # the zone's own 100 m grid (a hex lattice: some 77 points over its square kilometre), its points saying
    # their spacing
    assert in_finer.sum() >= 70 and set(steps[in_finer].tolist()) == {100.0}
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
    plan = finder.Plan(area=_square(offset(*CAMERA, 60.0, 600.0), 2_000.0), reach=REACH, spacing=220.0, fine=220.0)
    trace = _photo()
    assert finder.grid(plan, 220.0)[0].size >= finder.LANE_MIN_POINTS
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
    # the fastest takes one process for each of the machine's own cores, as the memory allows
    monkeypatch.setattr(horizon_finds, "cores", lambda: 8)
    assert horizon_finds.lanes_for("fastest") == 8
    monkeypatch.setattr(horizon_finds, "_available_memory", lambda: 4e9)
    assert horizon_finds.lanes_for("fastest") == 5
    monkeypatch.setattr(horizon_finds, "_available_memory", lambda: 2.5e9)
    assert horizon_finds.lanes_for("fast") == 1
    monkeypatch.setattr(horizon_finds, "_available_memory", lambda: None)
    monkeypatch.setattr("os.cpu_count", lambda: 4)
    assert horizon_finds.lanes_for(None) == 2


def test_the_machine_s_own_cores_are_counted_not_their_threads(monkeypatch, tmp_path):
    # four cores of two threads each, as Linux lists them
    listed = tmp_path / "cpuinfo"
    listed.write_text("".join(f"processor\t: {n}\nphysical id\t: 0\ncore id\t\t: {n % 4}\n\n" for n in range(8)), encoding="ascii")
    assert horizon_finds.cores(str(listed)) == 4
    # where they are not listed, half the threads
    monkeypatch.setattr("os.cpu_count", lambda: 12)
    monkeypatch.setattr("platform.system", lambda: "Windows")
    assert horizon_finds.cores(str(tmp_path / "none")) == 6
    horizon_finds.cores.cache_clear()


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


def test_a_line_with_only_sky_above_is_read_as_far_as_its_own_band_past_the_reach(monkeypatch):
    # v27's case: the reach said 10 km, a Sky-only line said 3 to 30 km off lies on a mountain 13 km out
    eye = (12.7, 43.5)
    mountain = Peak(*offset(*eye, 90.0, 13_000.0), height=1_200.0, radius=2_500.0)
    terrain.forget_decoded()
    monkeypatch.setattr(terrain, "tile", Relief(peaks=(mountain,), plain=0.0))
    swept = horizon.sweep(horizon.Observer(*eye), azimuths=np.arange(0.0, 360.0, 0.1), far=40_000.0)
    x, y = trace_on(skymatch.Turn(0.0, 0.1, swept.skyline), heading=90.0, fov=40.0)
    line = np.zeros(x.size, dtype=np.int64)
    trace = finder.Trace(x=x, y=y, half_width=HALF, fov=40.0, known=True,
                         marks=skymatch.Marks(line=line, far=((0, 3_000.0, 30_000.0),), clear=(0,)))
    plan = finder.Plan(area=[eye] * 3, reach=10_000.0)
    assert finder.sky_reaches(trace.marks, 10_000.0) == {0: 20_000.0}
    found = finder.score_point(*eye, trace, plan, sampler=terrain.Sampler(), quick=False)
    assert found["explained"] > 0.5 and found["over"] == 0.0
    assert found["heading"] == pytest.approx(90.0, abs=1.0)
    # read no farther than the reach, as it once was, the line cannot lie on its own mountain
    monkeypatch.setattr(finder, "SKY_SLACK", 0.0)
    assert finder.sky_reaches(trace.marks, 10_000.0) == {0: 10_000.0}
    short = finder.score_point(*eye, trace, plan, sampler=terrain.Sampler(), quick=False)
    assert short["explained"] < found["explained"] - 0.2
    # a line said nothing of is read as far as the trace is searched, a line said near as far as the reach
    near = skymatch.Marks(line=line, far=((1, 0.0, 1_000.0),), clear=(0, 1))
    monkeypatch.setattr(finder, "SKY_SLACK", 1.0)
    assert finder.sky_reaches(near, 10_000.0) == {0: 20_000.0, 1: 10_000.0}
    # a band reaching past twice the reach is read no farther than the trace is searched
    assert finder.sky_reaches(skymatch.Marks(far=((0, 3_000.0, 150_000.0),), clear=(0,)), 10_000.0) == {0: 20_000.0}
    terrain.forget_decoded()


def test_a_line_with_only_sky_above_is_read_as_far_as_the_photo_is_said_to_see(monkeypatch):
    eye = (12.7, 43.5)
    hill = Peak(*offset(*eye, 90.0, 3_000.0), height=300.0, radius=1_000.0)

    def photo(mountain):
        terrain.forget_decoded()
        monkeypatch.setattr(terrain, "tile", Relief(peaks=(hill, mountain), plain=0.0))
        # haze stops the air at 5 km: the hill is the skyline, the mountain behind it unseen
        swept = horizon.sweep(horizon.Observer(*eye), azimuths=np.arange(0.0, 360.0, 0.1), far=20_000.0,
                              cuts=[5_000.0])
        x, y = trace_on(skymatch.Turn(0.0, 0.1, swept.skyline_cuts[0]), heading=95.0, fov=40.0)
        # a reader of its own: one holds the tiles it decoded, the relief they were cut from included
        return finder.Trace(x=x, y=y, half_width=HALF, fov=40.0, known=True), terrain.Sampler()

    trace, sampler = photo(Peak(*offset(*eye, 100.0, 8_000.0), height=1_500.0, radius=1_500.0))
    line = np.zeros(trace.x.size, dtype=np.int64)
    # the line said to stand 1 to 3 km off: the turn is searched no farther than that, whatever the reach
    said = skymatch.Marks(line=line, far=((0, 1_000.0, 3_000.0),))
    sure = replace(said, clear=(0,))

    def scored(reach, marks, traced=trace, reader=sampler):
        plan = finder.Plan(area=[eye] * 3, reach=reach)
        return finder.score_point(*eye, replace(traced, marks=marks), plan, sampler=reader, quick=False)

    found = scored(10_000.0, said)
    assert found["explained"] > 0.5 and "over" not in found
    # said to see 5 km, the line has only sky above it as far as that: the mountain is haze's
    kept = scored(5_000.0, sure)
    assert kept["over"] == 0.0 and kept["explained"] == pytest.approx(found["explained"], abs=1e-3)
    # said to see 10 km, the mountain stands over the line where it was filmed, read past where the line is
    # searched: no place there, and what is left elsewhere is the hill alone, a poor fit (its own crest off the
    # trace there is not land over the line)
    filmed = replace(trace, facing=((95.0, 3.0),))
    lost = scored(10_000.0, sure, filmed)
    assert lost["over"] > 0.2 and lost["explained"] == 0.0 and lost["reach"] == found["reach"]
    assert scored(10_000.0, sure)["explained"] < 0.3 * found["explained"]
    # left to Auto, the line is read on past the 3 km it is said to stand at, and a mountain under three times as
    # far still stands over it (owner, 2026-10-22): no place, and the place says how far out it stands
    for marks in (sure, skymatch.Marks(line=line, clear=(0,))):
        auto = scored(None, marks, filmed)
        assert auto["over"] > 0.2 and auto["explained"] == 0.0
        assert auto["over_far"] == pytest.approx(8_000.0, rel=0.2)
        assert scored(None, marks)["explained"] < 0.3 * found["explained"]
    # a range seven times as far haze may well hide: left to Auto the place keeps its score
    far, reader = photo(Peak(*offset(*eye, 100.0, 20_000.0), height=3_000.0, radius=2_500.0))
    plain = scored(None, skymatch.Marks(line=line), far, reader)
    hazy = scored(None, skymatch.Marks(line=line, clear=(0,)), far, reader)
    assert hazy["over"] == 0.0 and hazy["explained"] == pytest.approx(plain["explained"], abs=1e-3)
    # a saved trace carries the lines it says have only sky above
    assert finder.marks_of({"line": [0, 0, 1], "clear": [1]}).clear == (1,)
    # and the lines it marks as key
    assert finder.marks_of({"line": [0, 0, 1], "key": [0]}).key == (0,)
    # and the points that lie in a part brushed as bent
    assert finder.marks_of({"bent": [0, 1, 1]}).bent.tolist() == [False, True, True]
    assert finder.marks_of({"bent": [0, 0, 0]}) is None
    # a point ruled out says why on the map, one that keeps its score says nothing
    assert finder._ruled(auto) == {"over": auto["over"], "over_far": auto["over_far"]}
    assert finder._ruled(hazy) == {} and finder._ruled(found) == {}
    terrain.forget_decoded()


def test_a_search_stops_when_asked():
    plan = finder.Plan(area=_square(CAMERA, 1_500.0), reach=REACH, spacing=500.0, fine=500.0)
    with pytest.raises(finder.Cancelled) as stopped:
        finder.search(plan, _photo(), cancelled=lambda: True)
    assert stopped.value.result["points"] == [] and stopped.value.result["partial"]


def test_a_search_tells_each_point_and_stopped_keeps_what_it_found():
    plan = finder.Plan(area=_square(offset(*CAMERA, 60.0, 600.0), 1_500.0), reach=REACH, spacing=500.0, fine=500.0)
    told: list[dict] = []
    whole = finder.search(plan, _photo(), scored_one=told.append)
    # every point the answer maps was told as it was scored, as the map draws it
    heard = [finder.shown(p) for p in told if p["explained"] >= 0]
    assert all(point in heard for point in whole["points"]) and len(told) >= len(whole["points"])
    # stopped part way, it keeps the points scored by then and its best places among them
    count = len(whole["points"])
    again: list[dict] = []
    with pytest.raises(finder.Cancelled) as stopped:
        finder.search(plan, _photo(), scored_one=again.append, cancelled=lambda: len(again) >= count // 2)
    partial = stopped.value.result
    assert partial["partial"] and 0 < len(partial["points"]) < count
    assert partial["places"][0]["explained"] == max(p["explained"] for p in partial["points"])
    assert len({(p["lat"], p["lon"]) for p in partial["points"]}) == len(partial["points"])


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
    # ridges 1.5 km out: a tenth of that is 150 m, four points a side in the 570 m square of ground each point
    # of a hex lattice 500 m dense stands for
    cell = 500.0 * (finder.HEX_ACROSS * finder.HEX_ROWS) ** 0.5
    one = finder.filled(plan, coarse[27:28], 500.0, 60.0, set(seen))
    assert len(one) == 0  # a single cell's sixteen would pass its budget of three: two a side instead
    extra = finder.filled(plan, coarse, 500.0, 60.0, set(seen))
    assert extra[0][2] == pytest.approx(cell / 4)
    assert len(extra) <= finder.DENSE_MAX * len(coarse)
    assert finder.inside(area, np.array([e[0] for e in extra]), np.array([e[1] for e in extra])).all()
    # past the budget the nearest relief comes first, the rest two by two, then none
    nearest = [{**p, "relief": 1_500.0 if i else 600.0} for i, p in enumerate(coarse)]
    many = finder.filled(plan, nearest, 500.0, 25.0, set(seen))
    assert len(many) <= finder.DENSE_MAX * len(coarse)
    assert many[0][2] == pytest.approx(cell / 9)  # the nearest relief's cell (63 m), filled first and finest
    assert {round(own, 3) for _, _, own, _ in many[100:]} <= {round(cell / 4, 3), round(cell / 2, 3)}
    # each point filling a cell in starts from its cell's fit, when it has one
    assert {start for _, _, _, start in many} == {None}
    fitted = [{**p, "heading": 80.0, "fov": 40.0} for p in coarse]
    assert finder.filled(plan, fitted, 500.0, 60.0, set(seen))[0][3] == (0.1, 80.0, 40.0)
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


def test_a_search_saved_without_running_keeps_its_question_and_is_saved_again_under_its_name(client, monkeypatch):
    queued = []
    monkeypatch.setattr(workqueue, "enqueue", lambda *a, **k: queued.append(a))
    case_id = client.post("/api/cases", json={"name": "Saved"}).json()["id"]
    saved = client.post(f"/api/cases/{case_id}/horizon/finds", json=_ask(run=False))
    assert saved.status_code == 200, saved.text
    name = saved.json()["name"]
    assert saved.json()["status"] == "saved" and not queued
    record = client.get(f"/api/cases/{case_id}/horizon/finds/{name}").json()
    assert record["status"] == "saved" and record["result"] is None and "run" not in record["ask"]
    # saved again, the same search holds the new question
    again = client.put(f"/api/cases/{case_id}/horizon/finds/{name}", json=_ask(run=False, spacing=250.0))
    assert again.status_code == 200, again.text
    assert again.json()["name"] == name and not queued
    record = client.get(f"/api/cases/{case_id}/horizon/finds/{name}").json()
    assert record["ask"]["spacing"] == 250.0 and record["status"] == "saved"
    assert [row["name"] for row in client.get(f"/api/cases/{case_id}/horizon/finds").json()] == [name]
    # a search that ran stays as it ran
    ran = client.post(f"/api/cases/{case_id}/horizon/finds", json=_ask()).json()["name"]
    assert len(queued) == 1
    refused = client.put(f"/api/cases/{case_id}/horizon/finds/{ran}", json=_ask(run=False))
    assert refused.status_code == 409
    assert client.put(f"/api/cases/{case_id}/horizon/finds/nothing", json=_ask(run=False)).status_code == 404


def test_the_guide_example_is_a_search_the_app_keeps_as_it_was_asked(client, monkeypatch):
    """What the guide's Try this search files (`frontend/src/lib/findExample.js`): a stale example is a button that fails."""
    queued = []
    monkeypatch.setattr(workqueue, "enqueue", lambda *a, **k: queued.append(a))
    example = json.loads((Path(__file__).resolve().parents[1] / "frontend/src/lib/findExample.json").read_text(encoding="utf-8"))
    assert example["photo"]["path"] == "", "the case's own copy of the photo is filled in when it is filed"
    case_id = client.post("/api/cases", json={"name": "Find example"}).json()["id"]
    body = {**example, "photo": {**example["photo"], "path": "half_dome_1901.jpg"}, "run": False}
    saved = client.post(f"/api/cases/{case_id}/horizon/finds", json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()["status"] == "saved" and not queued
    ask = client.get(f"/api/cases/{case_id}/horizon/finds/{saved.json()['name']}").json()["ask"]
    assert len(ask["photo"]["strokes"]) == 7
    assert ask["photo"]["marks"]["key"] and ask["photo"]["marks"]["hazy"] and ask["photo"]["marks"]["far"]
    assert ask["area"] and ask["spacing"] == 50.0


def test_a_running_search_fills_the_map_in_and_a_place_confirmed_stops_it(client, monkeypatch):
    from azimut.api.cases import get_case

    case_id = client.post("/api/cases", json={"name": "Found"}).json()["id"]
    case = get_case(case_id)
    # the search is run here, not on the queue, so it can be stopped at a known point
    monkeypatch.setattr(workqueue, "enqueue", lambda *args, **kwargs: None)
    name = client.post(f"/api/cases/{case_id}/horizon/finds", json=_ask()).json()["name"]
    monkeypatch.setattr(horizon_finds, "WRITE_EVERY", 0.0)
    held: list[int] = []
    real = finder.search

    def search(plan, trace, **told):
        def scored_one(point):
            told["scored_one"](point)
            answer = client.get(f"/api/cases/{case_id}/horizon/finds/{name}/points?since=0").json()
            held.append(len(answer["points"]))
            if len(held) == 6:
                # the analyst looked from a point as it ran and confirmed it
                sure = client.post(f"/api/cases/{case_id}/horizon/finds/{name}/found",
                                   json={"lat": point["lat"], "lon": point["lon"], "heading": 80.0, "view": "Ridge found"})
                assert sure.status_code == 200, sure.text
                assert sure.json()["status"] == "stopping"

        return real(plan, trace, **{**told, "scored_one": scored_one})

    monkeypatch.setattr(finder, "search", search)
    with pytest.raises(workqueue.JobCancelled):
        horizon_finds.run(case, {"payload": {"name": name}})
    # the map filled in as the points were scored, and stops being held once the search ends
    assert held[0] >= 0 and held == sorted(held) and held[-1] > 0
    assert client.get(f"/api/cases/{case_id}/horizon/finds/{name}/points").json() == {"started": None, "since": 0, "points": []}
    record = client.get(f"/api/cases/{case_id}/horizon/finds/{name}").json()
    # stopped, it keeps what it found by then, and the place confirmed
    assert record["status"] == "cancelled" and record["result"]["partial"]
    assert 0 < len(record["result"]["points"]) <= held[-1] + 1
    assert record["found"]["view"] == "Ridge found" and record["found"]["heading"] == 80.0
    [row] = client.get(f"/api/cases/{case_id}/horizon/finds").json()
    assert row["found"] and row["status"] == "cancelled" and row["best"]
    # taken back, the search is as it ended
    back = client.delete(f"/api/cases/{case_id}/horizon/finds/{name}/found").json()
    assert "found" not in back and back["status"] == "cancelled"
    refused = client.post(f"/api/cases/{case_id}/horizon/finds/{name}/found", json={"lat": 95.0, "lon": 0.0})
    assert refused.status_code == 422


def test_the_points_held_are_sent_from_where_the_browser_is():
    case = type("Case", (), {"id": "c1"})()
    horizon_finds.LIVE[("c1", "s")] = {"started": 10.0, "points": [{"n": 0}, {"n": 1}, {"n": 2}]}
    try:
        assert horizon_finds.live(case, "s", 2, 10.0)["points"] == [{"n": 2}]
        # another run than the one the browser read: all of them again
        assert horizon_finds.live(case, "s", 2, 9.0) == {"started": 10.0, "since": 0, "points": [{"n": 0}, {"n": 1}, {"n": 2}]}
    finally:
        horizon_finds.LIVE.clear()
    assert horizon_finds.live(case, "s")["points"] == []
    # asked to stop: one running stops between two points, one queued at once, one ended stays as it ended
    for status, after in (("running", "stopping"), ("queued", "cancelled"), ("done", "done")):
        record = {"status": status}
        horizon_finds.stop(record)
        assert record["status"] == after


def test_the_estimate_says_what_each_speed_gains_here_and_no_time(client, monkeypatch):
    told = client.post("/api/horizon/finds/estimate", json=_ask())
    assert told.status_code == 200, told.text
    answer = told.json()
    assert answer["lane_min"] == finder.LANE_MIN_POINTS
    assert answer["speeds"]["gentle"] == {"lanes": 1, "gain": 1.0}
    assert set(answer["speeds"]) == set(horizon_finds.SPEEDS)
    assert "seconds" not in answer and "step" not in answer and "turn" not in answer
    # between the ones measured, flat past the last, and never under one
    assert [horizon_finds.gain_of(n) for n in (1, 2, 4, 6, 8, 12)] == [1.0, 1.6, 2.5, 2.8, 3.1, 3.1]
    assert horizon_finds.gain_of(0) == 1.0


def test_the_time_left_waits_for_the_first_seconds_then_follows_the_pace_so_far():
    after = horizon_finds.LEFT_AFTER
    # the terrain being read and the processes started: said then it reads twice too long
    assert horizon_finds.time_left(after - 1, 500, 5000) is None
    assert horizon_finds.time_left(after, 2, 5000) is None
    assert horizon_finds.time_left(after, 500, 5000) == round(after * 9)
    assert horizon_finds.time_left(100.0, 5000, 5000) == 0


def test_a_search_asked_to_stop_as_the_app_closed_ends_stopped(client, monkeypatch):
    from azimut.api.cases import get_case

    case_id = client.post("/api/cases", json={"name": "Restart"}).json()["id"]
    monkeypatch.setattr(workqueue, "enqueue", lambda *args, **kwargs: None)
    name = client.post(f"/api/cases/{case_id}/horizon/finds", json=_ask()).json()["name"]
    case = get_case(case_id)
    record = horizon_finds.read(case, name)
    horizon_finds.write(case, name, {**record, "status": "stopping"})
    with pytest.raises(workqueue.JobCancelled):
        horizon_finds.run(case, {"payload": {"name": name}})
    assert horizon_finds.read(case, name)["status"] == "cancelled"


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
    assert trace.lens_max is None
    _, squat = horizon_finds.plan_of({**ask, "trace": {**ask["trace"], "lens_max": 165.0}})
    assert squat.lens_max == 165.0
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
    assert estimate["coarse"] > 0
    assert estimate["most"] >= estimate["points"]
    # a grid as fine as 20 m may be asked, and is kept as asked
    fine = client.post("/api/horizon/finds/estimate", json=_ask(spacing=20.0))
    assert fine.status_code == 200, fine.text
    assert fine.json()["spacing"] == 20.0 and fine.json()["asked"] is None and fine.json()["zones_wider"] is None
    # Auto's grid says as much for each effort the analyst may pick, the quick one the fewest; a grid picked says none
    auto = client.post("/api/horizon/finds/estimate", json=_ask(spacing=None)).json()
    efforts = auto["efforts"]
    assert efforts["quick"]["points"] < efforts["normal"]["points"] < efforts["thorough"]["points"]
    assert efforts["normal"]["points"] == auto["points"]
    assert efforts["quick"]["spacing"] > efforts["normal"]["spacing"] > efforts["thorough"]["spacing"]
    assert "efforts" not in estimate
    thorough = client.post("/api/horizon/finds/estimate", json=_ask(spacing=None, effort="thorough")).json()
    assert thorough["points"] == efforts["thorough"]["points"]
    assert client.post("/api/horizon/finds/estimate", json=_ask(effort="all night")).status_code == 422
    # the grid before the search, each point with its ground, the ground ticked kept
    shown = client.post("/api/horizon/finds/preview", json=_ask(stands=["summit"])).json()
    assert shown["total"] > 0 and shown["kept"] == shown["kinds"]["summit"]
    assert len(shown["points"]) == shown["total"]
    # read before any trace is drawn: the area alone is enough
    bare = client.post("/api/horizon/finds/preview", json={"area": _ask()["area"], "spacing": 500.0})
    assert bare.status_code == 200, bare.text
    assert bare.json()["total"] == shown["total"]
    # an area beside the first, and a stroke of the brush across both: the painted points stay on it, greyed
    beside = [{"lat": lat, "lon": lon} for lat, lon in _square(offset(*CAMERA, 240.0, 5_000.0), 1_000.0)]
    stroke = {"path": [{"lat": lat, "lon": lon} for lat, lon in (CAMERA, offset(*CAMERA, 60.0, 1_500.0))], "radius": 400.0}
    painted = client.post("/api/horizon/finds/preview", json={"area": _ask()["area"], "spacing": 500.0, "areas": [beside],
                                                               "strokes": [stroke]})
    assert painted.status_code == 200, painted.text
    assert painted.json()["total"] > bare.json()["total"]
    assert any(point[2] == finder.PAINTED for point in painted.json()["points"])
    for refused in ({"areas": [beside[:2]]}, {"strokes": [{**stroke, "radius": 1.0}]}, {"strokes": [{**stroke, "path": []}]}):
        assert client.post("/api/horizon/finds/preview", json={"area": _ask()["area"], **refused}).status_code == 422
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
        # so does a key line
        {"trace": {**_ask()["trace"], "key": [0]}},
        {"trace": {**_ask()["trace"], "line": [0] * len(_ask()["trace"]["x"]), "key": [100_000]}},
        # a point brushed as bent is said with a 1 or a 0, one for each point
        {"trace": {**_ask()["trace"], "bent": [1]}},
        {"trace": {**_ask()["trace"], "bent": [2] * len(_ask()["trace"]["x"])}},
    ):
        assert client.post(url, json=_ask(**change)).status_code == 422
    assert client.get(f"{url}/nothing").status_code == 404


def test_the_rough_passes_run_outward_each_point_beside_the_ones_before():
    # a 20 by 20 grid: along the curve each point stands next to the one before
    x, y = np.meshgrid(np.arange(20.0), np.arange(20.0))
    x, y = x.ravel(), y.ravel()
    order = finder.hilbert_order(x, y)
    assert sorted(order.tolist()) == list(range(400))
    steps = np.hypot(np.diff(x[order]), np.diff(y[order]))
    assert np.median(steps) == 1.0 and np.mean(steps <= 1.5) > 0.9
    assert finder.hilbert_order(np.array([3.0]), np.array([4.0])).tolist() == [0]


def test_a_warm_start_slides_near_its_neighbours_within_what_was_said():
    trace = replace(_photo(), known=False, within=(20.0, 85.0), fov=40.0)
    plan = finder.Plan(area=_square(CAMERA, 1_000.0))
    half = finder.warm_half(trace)
    narrowed = finder.warmed(trace, plan, *CAMERA, [(80.0, 40.0), (300.0, 50.0)])
    mask = finder.heading_mask(narrowed.facing)
    assert mask[80] and mask[300] and not mask[180]
    assert abs(int(mask.sum()) - 2 * 2 * round(half)) <= 4
    # the lenses a full slide tries, kept to those near the seeds'
    assert narrowed.within == trace.within
    assert narrowed.lens_window == pytest.approx((40.0 / finder.WARM_LENS, 50.0 * finder.WARM_LENS))
    assert finder.half_span(narrowed) < finder.half_span(trace)
    # within the directions the analyst ticked, and none left when they do not meet
    facing = replace(trace, facing=((90.0, 22.5),))
    assert finder.heading_mask(finder.warmed(facing, plan, *CAMERA, [(80.0, 40.0)]).facing)[80]
    assert finder.warmed(facing, plan, *CAMERA, [(270.0, 40.0)]) is None
    # a known lens stays as it is
    assert finder.warmed(_photo(), plan, *CAMERA, [(80.0, 30.0)]).within is None
    assert finder.half_span(finder.warmed(_photo(), plan, *CAMERA, [(80.0, 30.0)])) == finder.half_span(_photo())


def test_a_run_slides_in_full_every_few_points_with_no_start_or_after_a_fall(monkeypatch):
    calls = []

    def scored(a, o, step, stage, heights, trace, plan, sampler):
        warm = trace.facing is not None
        calls.append(warm)
        # the third point's warm start falls far under its start, every other point keeps a fit
        explained = 0.1 if warm and len(calls) == 3 else 0.6
        return {"lat": a, "lon": o, "explained": explained, "heading": 80.0, "fov": 40.0, "spacing": step}

    monkeypatch.setattr(finder, "_score_stage", scored)
    monkeypatch.setattr(finder, "WARM_EVERY", 4)
    monkeypatch.setattr(finder, "WARM_DROP", 0.1)
    plan = finder.Plan(area=_square(CAMERA, 1_000.0))
    jobs = [(CAMERA[0] + i * 1e-4, CAMERA[1], 50.0, None) for i in range(9)]
    points = finder._warm_run(jobs, "rough", _photo(), plan, terrain.Sampler())
    assert len(points) == 9
    # first in full (no start), then warm; the third falls and is slid again in full; every fourth in full
    assert calls == [False, True, True, False, True, False, True, True, True, False]
    # a start that explains too little gives none
    calls.clear()
    weak = [(CAMERA[0], CAMERA[1], 50.0, (0.05, 80.0, 40.0)), (CAMERA[0] + 1e-4, CAMERA[1], 50.0, (0.05, 80.0, 40.0))]
    monkeypatch.setattr(finder, "_score_stage", lambda a, o, step, *rest: calls.append(rest[2].facing is not None) or {"lat": a, "lon": o, "explained": 0.05, "spacing": step})
    finder._warm_run(weak, "rough", _photo(), plan, terrain.Sampler())
    assert calls == [False, False]


def test_a_search_scored_outward_finds_the_camera_as_one_scored_in_full(monkeypatch):
    area = _square(CAMERA, 1_500.0)
    plan = finder.Plan(area=area, reach=REACH, spacing=500.0, fine=150.0)
    found = finder.search(plan, _photo())
    monkeypatch.setattr(finder, "WARM", False)
    full = finder.search(plan, _photo())
    best, best_full = found["places"][0], full["places"][0]
    assert terrain.distance(best["lat"], best["lon"], *CAMERA) <= 300
    assert best["explained"] >= best_full["explained"] - 0.02
    assert abs(best["heading"] - best_full["heading"]) < 2.0


def test_a_large_grid_is_gathered_in_cells_of_about_nine_points_the_middle_one_first():
    plan = finder.Plan(area=_square(CAMERA, 2_000.0), spacing=100.0)
    lat, lon = finder.grid(plan, 100.0)
    jobs = [(float(a), float(o), 100.0, None) for a, o in zip(lat, lon)]
    cells = finder.cells_of(plan.area[0], jobs)
    members = sorted(i for cell in cells for i in cell)
    assert members == list(range(len(jobs)))
    sizes = np.array([len(cell) for cell in cells])
    assert 7 <= np.median(sizes) <= 11
    # the first point of a cell stands nearer its middle than the others
    x, y = finder._local(*plan.area[0], lat, lon)
    full = max(cells, key=len)
    middle = (x[full].mean(), y[full].mean())
    assert np.hypot(x[full[0]] - middle[0], y[full[0]] - middle[1]) <= np.hypot(x[full] - middle[0], y[full] - middle[1]).min() + 60


def test_a_cell_is_bounded_by_its_score_and_the_rough_score_s_own_grain():
    assert finder.bound({"explained": 0.4}) == pytest.approx(0.4 + finder.BOUND_SLACK)
    assert finder.bound({"explained": -1.0}) == pytest.approx(finder.BOUND_SLACK)


def test_best_first_fills_the_cells_that_could_change_the_places_and_draws_the_others_whole():
    plan = finder.Plan(area=_square(CAMERA, 5_000.0), spacing=100.0)
    lat, lon = finder.grid(plan, 100.0)
    jobs = [(float(a), float(o), 100.0, None) for a, o in zip(lat, lon)]
    # six hot spots 2.5 km apart, each lower than the last, over ground that explains little
    peaks = [(offset(*CAMERA, bearing, 2_500.0), 0.9 - 0.06 * k) for k, bearing in enumerate(range(0, 360, 60))]
    asked: list[list] = []

    def explained(a, o):
        return max([0.05, *(height - terrain.distance(a, o, *where) / 1_500.0 for where, height in peaks)])

    def warm(batch, stage):
        asked.append(list(batch))
        return [{"lat": round(a, 6), "lon": round(o, 6), "explained": explained(a, o), "heading": 80.0, "fov": 40.0,
                 "spacing": step} for a, o, step, start in batch]

    def full(batch, stage):
        # slid in full: no fit to start from
        return warm([(*job, None) for job in batch], stage)

    scored, told = finder._best_first(jobs, plan.area[0], warm, full)
    cells = finder.cells_of(plan.area[0], jobs)
    assert told["cells"] == len(cells) and 0 < told["filled"] < len(cells)
    assert told["skipped"] + len(scored) == len(jobs)
    # first one point a cell, in full and as large as its cell; then the rest of the cells about the hot spots, each
    # from its first
    assert len(asked[0]) == len(cells) and asked[0][0][2] > 250 and {start for *_, start in asked[0]} == {None}
    assert all(start is not None for batch in asked[1:] for *_, start in batch)
    # the places are those every point scored would give: the fifth's hot spot too, not the first's alone
    every = [{"lat": a, "lon": o, "explained": explained(a, o)} for a, o, _, _ in jobs]
    full = finder._spread(every, finder.APART_M, finder.TOP)
    found = finder._spread(scored, finder.APART_M, finder.TOP)
    assert [round(p["explained"], 2) for p in found] == [round(p["explained"], 2) for p in full]
    assert all(terrain.distance(f["lat"], f["lon"], p["lat"], p["lon"]) <= 150 for f, p in zip(found, full))
    # a cell left is drawn whole and filled in by nothing; a cell searched is drawn as its points are
    left = [p for p in scored if p.get("bounded")]
    assert left and all(p["spacing"] > 250 for p in left)
    assert finder.filled(plan, left, 100.0, 25.0, set()) == []
    assert all(p["spacing"] == 100.0 for p in scored if not p.get("bounded"))


def test_a_large_grid_searched_best_first_finds_the_camera_as_one_searched_whole(monkeypatch):
    plan = finder.Plan(area=_square(CAMERA, 3_000.0), reach=REACH, spacing=250.0, fine=250.0)
    monkeypatch.setattr(finder, "BOUND", True)
    monkeypatch.setattr(finder, "BOUND_MIN", 300)
    assert finder.grid(plan, 250.0)[0].size >= finder.BOUND_MIN
    found = finder.search(plan, _photo())
    assert found["bounded"]["skipped"] > 0
    monkeypatch.setattr(finder, "BOUND", False)
    whole = finder.search(plan, _photo())
    assert "bounded" not in whole
    best, best_whole = found["places"][0], whole["places"][0]
    assert terrain.distance(best["lat"], best["lon"], *CAMERA) <= 300
    assert best["explained"] >= best_whole["explained"] - 0.02
    assert len(found["points"]) < len(whole["points"])
    # a small area, fewer places than the answer lists: every point is searched
    small = replace(plan, area=_square(CAMERA, 1_000.0), spacing=100.0, fine=100.0)
    monkeypatch.setattr(finder, "BOUND", True)
    assert finder.search(small, _photo())["bounded"]["skipped"] == 0


def test_a_place_read_low_roughly_but_first_in_full_is_listed_first(monkeypatch):
    # ten hot spots 2 km apart, read roughly a little lower one after the other; the eighth is the place, which only
    # a full fit reads as the best
    spots = [finder._from_local(*CAMERA, np.array([(i % 4) * 2_000.0 - 3_000.0]), np.array([(i // 4) * 2_000.0 - 2_000.0]))
             for i in range(10)]
    spots = [(float(a[0]), float(o[0])) for a, o in spots]

    def scored(a, o, step, stage, heights, trace, plan, sampler):
        near = min(range(10), key=lambda i: terrain.distance(a, o, *spots[i]))
        value = 0.8 - 0.02 * near - terrain.distance(a, o, *spots[near]) / 4_000.0
        if stage == "full" and near == 7:
            value += 0.2
        return {"lat": round(a, 6), "lon": round(o, 6), "explained": round(value, 4), "heading": 80.0, "fov": 40.0,
                "gap": 0.0, "spacing": step, "relief": 9_000.0}

    monkeypatch.setattr(finder, "_score_stage", scored)
    plan = finder.Plan(area=_square(CAMERA, 4_500.0), reach=REACH, spacing=500.0, fine=500.0)
    found = finder.search(plan, _photo())
    assert len(found["places"]) == finder.TOP
    assert terrain.distance(found["places"][0]["lat"], found["places"][0]["lon"], *spots[7]) < 500.0
    # searched in full only as many as are listed, the place is never reached
    monkeypatch.setattr(finder, "FULL_PLACES", finder.TOP)
    found = finder.search(plan, _photo())
    assert all(terrain.distance(p["lat"], p["lon"], *spots[7]) > 1_000.0 for p in found["places"])


def test_a_peak_narrower_than_the_grid_is_refined_to_though_its_nearest_point_ranks_low(monkeypatch):
    # twenty broad hot spots on grid points, and the place: a peak far higher but narrow, 350 m from the grid point
    # nearest it, which reads it lower than all twenty
    plan = finder.Plan(area=_square(CAMERA, 6_000.0), reach=REACH, spacing=900.0, fine=100.0)
    lat, lon = finder.grid(plan, finder.coarse_spacing(plan))
    points = list(zip(lat.tolist(), lon.tolist()))
    middle = min(points, key=lambda p: terrain.distance(*p, *CAMERA))
    spots: list[tuple[float, float]] = []
    for point in sorted(points, key=lambda p: terrain.distance(*p, *CAMERA), reverse=True):
        if len(spots) < 20 and all(terrain.distance(*point, *other) >= 1_750.0 for other in [middle, *spots]):
            spots.append(point)
    assert len(spots) == 20
    a, o = finder._from_local(*middle, np.array([350.0]), np.array([0.0]))
    peak = (float(a[0]), float(o[0]))

    def scored(a, o, step, stage, heights, trace, plan, sampler):
        broad = max(0.7 - 0.005 * i - terrain.distance(a, o, *spot) / 3_000.0 for i, spot in enumerate(spots))
        value = max(broad, 0.95 - terrain.distance(a, o, *peak) / 700.0, 0.0)
        return {"lat": round(a, 6), "lon": round(o, 6), "explained": round(value, 4), "heading": 80.0, "fov": 40.0,
                "gap": 0.0, "spacing": step, "relief": 9_000.0}

    monkeypatch.setattr(finder, "_score_stage", scored)
    found = finder.search(plan, _photo())
    assert terrain.distance(found["places"][0]["lat"], found["places"][0]["lon"], *peak) < 100.0
    # refined about the twelve best points a level only, the search never stands near it
    monkeypatch.setattr(finder, "KEEP", 12)
    found = finder.search(plan, _photo())
    assert all(terrain.distance(p["lat"], p["lon"], *peak) > 1_000.0 for p in found["places"])


def test_a_place_the_analysts_marks_cost_much_says_what_it_explains_without_them(monkeypatch):
    # the place explains 0.5 with its distances and Sky only, 0.9 without
    asked = []

    def scored(a, o, trace, plan, *, sampler, quick=True, heights=None, rough=False, near_step=0.0):
        marked = trace.marks is not None and bool(trace.marks.far or trace.marks.clear)
        asked.append("rough" if rough else "quick" if quick else "full, marked" if marked else "full, bare")
        value = round(0.9 - terrain.distance(a, o, *CAMERA) / 2_000.0 - (0.4 if marked else 0.0), 4)
        return {"lat": round(a, 6), "lon": round(o, 6), "explained": value, "heading": 80.0, "fov": 40.0,
                "gap": 0.0, "relief": 9_000.0}

    monkeypatch.setattr(finder, "score_point", scored)
    plan = finder.Plan(area=_square(CAMERA, 1_000.0), reach=REACH, spacing=100.0, fine=100.0)
    photo = _photo()
    marks = skymatch.Marks(line=np.zeros(photo.x.size, dtype=np.int64), far=((0, 0.0, 3_000.0),), clear=(0,))
    found = finder.search(plan, replace(photo, marks=marks))
    best = found["places"][0]
    assert best["bare"] == pytest.approx(best["explained"] + 0.4, abs=1e-3)
    assert asked.count("full, bare") == len(found["places"])
    # scored again quietly: no point of the map is a bare one
    assert all(p["explained"] < best["bare"] - 0.1 for p in found["points"])
    monkeypatch.setattr(finder, "score_point", scored)
    # a trace with no judging marks is not scored twice
    fulls = asked.count("full, marked")
    asked.clear()
    found = finder.search(plan, photo)
    assert asked.count("full, bare") == fulls and all("bare" not in p for p in found["places"])
    # key lines are left out of the bare reading as well
    keyed = replace(marks, far=(), clear=(), key=(0,))
    assert finder.unmarked(replace(photo, marks=keyed)).marks == replace(keyed, key=())


def test_the_best_points_a_warm_start_scored_are_slid_again_in_full(monkeypatch):
    # a warm start that always reads 0.12 under what a full slide reads, within the fall a run accepts
    def true(a, o):
        return round(0.9 - terrain.distance(a, o, *CAMERA) / 2_000.0, 4)

    def scored(a, o, step, stage, heights, trace, plan, sampler):
        warm = trace.lens_window is not None or trace.facing is not None
        return {"lat": round(a, 6), "lon": round(o, 6), "explained": true(a, o) - (0.12 if warm else 0.0), "heading": 80.0,
                "fov": 40.0, "gap": 0.0, "spacing": step, "relief": 9_000.0}

    monkeypatch.setattr(finder, "_score_stage", scored)
    plan = finder.Plan(area=_square(CAMERA, 1_000.0), reach=REACH, spacing=100.0, fine=100.0)
    trace = replace(_photo(), known=False, within=(20.0, 85.0))
    found = finder.search(plan, trace)
    points = sorted(found["points"], key=lambda p: -p["explained"])
    warm = [p for p in points if abs(p["explained"] - (true(p["lat"], p["lon"]) - 0.12)) < 1e-6]
    assert warm, "some points were warm-started"
    # the best of them read again in full: none of the leading points keeps its warm score
    assert all(abs(p["explained"] - true(p["lat"], p["lon"])) < 1e-6 for p in points[:5])


# -- the machine a search runs on, and the searches a case keeps: what the audit found ---------


def test_a_search_takes_no_more_lanes_than_a_fast_one_where_the_memory_is_not_said(monkeypatch):
    monkeypatch.setattr(horizon_finds, "_available_memory", lambda: None)
    monkeypatch.setattr(horizon_finds, "cores", lambda: 16)
    monkeypatch.setattr("os.cpu_count", lambda: 32)
    assert horizon_finds.lanes_for("fastest") == horizon_finds.LANES_MAX


def test_windows_never_gets_more_lanes_than_it_can_wait_on(monkeypatch):
    monkeypatch.setattr(horizon_finds, "_available_memory", lambda: 1e13)
    monkeypatch.setattr(horizon_finds, "cores", lambda: 128)
    monkeypatch.setattr("sys.platform", "win32")
    assert horizon_finds.lanes_for("fastest") == horizon_finds.WINDOWS_LANES


def test_windows_and_macos_are_asked_their_free_memory(monkeypatch):
    monkeypatch.setattr(horizon_finds, "_windows_available", lambda: 6e9)
    monkeypatch.setattr(horizon_finds, "_darwin_available", lambda: 5e9)
    monkeypatch.setattr("sys.platform", "win32")
    assert horizon_finds._available_memory() == 6e9
    monkeypatch.setattr("sys.platform", "darwin")
    assert horizon_finds._available_memory() == 5e9


def test_a_vm_stat_answer_reads_as_the_memory_macos_can_give():
    said = (
        "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n"
        "Pages free:                               10000.\n"
        "Pages active:                            200000.\n"
        "Pages inactive:                           30000.\n"
        "Pages speculative:                         2000.\n"
    )
    assert horizon_finds._vm_stat_bytes(said) == (10000 + 30000 + 2000) * 16384
    assert horizon_finds._vm_stat_bytes("vm_stat: command not found") is None


@pytest.mark.skipif(sys.platform not in ("win32", "darwin"), reason="the system's own answer, where it is asked")
def test_this_system_says_its_free_memory():
    free = horizon_finds._available_memory()
    assert free is not None and free > 0


def _kept_search(client, monkeypatch, case_name):
    monkeypatch.setattr(workqueue, "enqueue", lambda *a, **k: None)
    case_id = client.post("/api/cases", json={"name": case_name}).json()["id"]
    name = client.post(f"/api/cases/{case_id}/horizon/finds", json=_ask()).json()["name"]
    return case_id, name


def test_a_new_search_leaves_the_name_of_one_in_the_trash_to_its_restore(client, monkeypatch):
    case_id, name = _kept_search(client, monkeypatch, "Trash names")
    assert client.delete(f"/api/cases/{case_id}/horizon/finds/{name}").status_code == 200
    again = client.post(f"/api/cases/{case_id}/horizon/finds", json=_ask()).json()["name"]
    assert again.casefold() != name.casefold()
    [group] = client.get(f"/api/cases/{case_id}/trash").json()["groups"]
    restored = client.post(f"/api/cases/{case_id}/trash/{group['id']}/restore")
    assert restored.status_code == 200, restored.text
    assert client.get(f"/api/cases/{case_id}/horizon/finds/{name}").status_code == 200


def test_a_search_under_way_arrives_stopped_through_a_bundle(client, monkeypatch):
    from azimut.engine import bundles
    from azimut.workspace import Case

    case_id, name = _kept_search(client, monkeypatch, "Carried search")
    assert client.get(f"/api/cases/{case_id}/horizon/finds/{name}").json()["status"] == "queued"
    exported = bundles.export_case(Case.open(case_id))
    landed = bundles.import_into(Case.create(bundles.imported_name(case_id)), exported)["case_id"]
    assert client.get(f"/api/cases/{landed}/horizon/finds/{name}").json()["status"] == "cancelled"
    # the case it came from still runs it
    assert client.get(f"/api/cases/{case_id}/horizon/finds/{name}").json()["status"] == "queued"


def test_a_search_deleted_while_it_runs_is_never_written_back(client, monkeypatch):
    from azimut.workspace import Case

    case_id, name = _kept_search(client, monkeypatch, "Deleted while running")
    case = Case.open(case_id)

    def deleted_then_no_terrain(*args, **kwargs):
        assert client.delete(f"/api/cases/{case_id}/horizon/finds/{name}").status_code == 200
        raise terrain.TerrainUnavailable("offline")

    monkeypatch.setattr(finder, "search", deleted_then_no_terrain)
    with pytest.raises(workqueue.JobRefused):
        horizon_finds.run(case, {"payload": {"name": name}})
    assert horizon_finds.read(case, name) is None
    assert not case.resolve_inside(f".horizon/finds/{name}.json").exists()
