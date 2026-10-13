"""The merge's rule: whose footprints a tile draws, and whose height each building carries."""

from __future__ import annotations

from azimut.engine.buildings import merge
from azimut.engine.buildings.model import Building, metres_frame, tile_bounds, tile_of

KEY = tile_of(45.7578, 4.8320)
WEST, SOUTH, EAST, NORTH = tile_bounds(*KEY)
LON0, LAT0 = (WEST + EAST) / 2, (SOUTH + NORTH) / 2
KX, KY = metres_frame(LAT0)


def square(east: float, north: float, side: float = 12.0, *, height: float | None = None,
           kind: str | None = None, source: str = "osm", date: str = "") -> Building:
    """A square footprint `side` metres across, centred `east`/`north` metres from the tile's middle."""
    h = side / 2
    ring = tuple(
        (LON0 + (east + dx) / KX, LAT0 + (north + dy) / KY)
        for dx, dy in ((-h, -h), (h, -h), (h, h), (-h, h))
    )
    if kind is None:
        kind = "unknown" if height is None else ("estimated" if source == "globfp" else "measured")
    return Building(rings=(ring,), height=height, kind=kind, source=source, date=date)  # type: ignore[arg-type]


def street(source: str, count: int, *, shift: float = 0.0, height: float | None = None, side: float = 12.0) -> list[Building]:
    """`count` houses 25 m apart along an east-west street, moved `shift` metres east."""
    return [square(i * 25.0 + shift, 0.0, side, height=height, source=source, date="2020" if source == "globfp" else "")
            for i in range(count)]


def run(found: dict, enabled: set[str] | None = None) -> merge.Merged:
    return merge.merge_tile(*KEY, found, enabled or {"ign", "osm", "globfp"})


def test_the_ign_draws_the_footprints_where_it_covers_the_tile():
    ign = street("ign", 3, height=15.0)
    # the same three houses, as the other sources draw them a few metres off
    result = run({"ign": ign, "osm": street("osm", 3, shift=3.0), "globfp": street("globfp", 3, shift=-4.0, height=7.0)})
    assert result.footprints == "ign"
    assert len(result.buildings) == 3
    assert [b.height for b in result.buildings] == [15.0, 15.0, 15.0]
    assert all(b.kind == "measured" and b.height_source == "" for b in result.buildings)


def test_an_ign_building_without_a_height_takes_a_mapped_one_before_an_estimate():
    ign = [square(0, 0, source="ign"), square(25, 0, source="ign")]
    osm = [square(0, 0, height=21.0)]
    glo = [square(0, 0, height=7.0, source="globfp", date="2020"), square(25, 0, height=9.0, source="globfp", date="2020")]
    result = run({"ign": ign, "osm": osm, "globfp": glo})
    first, second = result.buildings
    assert (first.height, first.kind, first.height_source) == (21.0, "measured", "osm")
    assert (second.height, second.kind, second.height_source, second.height_date) == (9.0, "estimated", "globfp", "2020")


def test_osm_draws_the_footprints_when_it_covers_the_built_ground():
    osm = street("osm", 30)
    glo = street("globfp", 32, height=8.0)
    result = run({"osm": osm, "globfp": glo})
    assert result.footprints == "osm"
    assert len(result.buildings) == 30
    assert all(b.kind == "estimated" and b.height == 8.0 and b.height_source == "globfp" for b in result.buildings)


def test_globfp_draws_the_footprints_where_osm_has_mapped_little_and_osm_heights_still_win():
    osm = [square(0, 0, height=30.0)]
    glo = street("globfp", 30, height=8.0)
    result = run({"osm": osm, "globfp": glo})
    assert result.footprints == "globfp"
    assert len(result.buildings) == 30
    assert (result.buildings[0].height, result.buildings[0].kind, result.buildings[0].height_source) == (30.0, "measured", "osm")
    assert all(b.height == 8.0 and b.kind == "estimated" and b.height_source == "" for b in result.buildings[1:])


def test_a_dataset_shifted_as_a_whole_is_paired_after_its_shift_is_taken_off():
    # 3D-GloBFP 12 m west of OSM, past the 10 m a pair may be apart: without the
    # shift taken off, no house would find its twin
    osm = [square(i * 25.0, 0.0, 10.0) for i in range(30)]
    glo = [square(i * 25.0 - 12.0, 0.0, 10.0, height=6.0 + i, source="globfp", date="2020") for i in range(30)]
    result = run({"osm": osm, "globfp": glo})
    assert result.footprints == "osm"
    dx, dy = result.shifts["globfp"]
    assert abs(dx + 12.0) < 0.5 and abs(dy) < 0.5
    # each house takes its own twin's height, not its neighbour's
    assert [b.height for b in result.buildings] == [6.0 + i for i in range(30)]


def test_too_few_pairs_trust_no_shift_and_a_far_footprint_lends_nothing():
    osm = [square(0, 0)]
    glo = [square(-15.0, 0, height=9.0, source="globfp")]
    result = run({"osm": osm, "globfp": glo})
    assert result.shifts["globfp"] == (0.0, 0.0)
    assert result.buildings[0].kind == "unknown" and result.buildings[0].height is None


def test_a_footprint_of_a_very_different_size_is_not_the_same_building():
    osm = [square(0, 0, 40.0)]
    glo = [square(0, 0, 8.0, height=12.0, source="globfp")]
    result = run({"osm": osm, "globfp": glo})
    assert result.buildings[0].kind == "unknown"


def test_a_source_switched_off_is_ignored_even_when_its_tile_is_there():
    result = run({"ign": street("ign", 3, height=10.0), "osm": street("osm", 2)}, enabled={"osm"})
    assert result.footprints == "osm"
    assert len(result.buildings) == 2


def test_a_source_with_nothing_to_say_is_passed_over():
    result = run({"ign": None, "osm": None, "globfp": street("globfp", 4, height=5.0)})
    assert result.footprints == "globfp"
    assert len(result.buildings) == 4


def test_no_source_means_no_buildings():
    result = run({"ign": None, "osm": None, "globfp": None})
    assert result.buildings == [] and result.footprints is None



def test_a_tile_the_ign_has_nothing_in_is_left_to_the_other_sources():
    result = run({"ign": [], "osm": street("osm", 5)})
    assert result.footprints == "osm" and len(result.buildings) == 5


def test_across_a_border_the_far_side_comes_from_the_next_source_and_no_house_is_doubled():
    # French houses west of the tile's middle, Swiss ones 300 m east of them
    ign = [square(-300.0 + i * 25.0, 0.0, height=12.0, source="ign") for i in range(4)]
    osm_here = [square(-300.0 + i * 25.0 + 3.0, 0.0) for i in range(4)]  # the same French houses, 3 m off
    osm_there = [square(200.0 + i * 25.0, 0.0) for i in range(3)]
    result = run({"ign": ign, "osm": osm_here + osm_there})
    assert result.footprints == "ign"
    assert [b.source for b in result.buildings] == ["ign"] * 4 + ["osm"] * 3


def test_a_tile_travels_to_the_view_and_back_unchanged():
    from azimut.engine.buildings import wire

    courtyard = square(0, 0, 4.0).rings[0]
    sent = [
        Building(rings=(square(0, 0, 30.0).rings[0], courtyard), height=21.5, kind="measured", source="ign",
                 date="2022-08-10", min_height=3.0),
        Building(rings=square(600, 0).rings, height=None, kind="unknown", source="osm", date="2026-10-04",
                 height_source="", height_date=""),
        Building(rings=square(1300, 0).rings, height=7.25, kind="estimated", source="osm", date="2026-10-04",
                 height_source="globfp", height_date="2020"),
    ]
    back = wire.decode(wire.encode(*KEY, sent), *KEY)
    assert [(b.kind, b.source, b.date, b.height_source, b.height_date, b.min_height) for b in back] == [
        (b.kind, b.source, b.date, b.height_source, b.height_date, b.min_height) for b in sent
    ]
    assert back[0].height == 21.5 and back[1].height is None and back[2].height == 7.25
    assert len(back[0].rings) == 2
    for got, want in zip(back, sent):
        for ring_got, ring_want in zip(got.rings, want.rings):
            for (a, b), (c, d) in zip(ring_got, ring_want):
                assert abs(a - c) < 1e-6 and abs(b - d) < 1e-6


def test_a_house_drawn_inside_a_big_surveyed_block_is_not_added_twice():
    block = square(0, 0, 120.0, height=20.0, source="ign")  # a city block, its centre 60 m from its corners
    inner = square(45.0, 45.0, 8.0)  # another source's house in the block's corner
    result = run({"ign": [block], "osm": [inner]})
    assert [b.source for b in result.buildings] == ["ign"]


def test_a_height_read_off_a_raster_comes_after_measured_ones_and_before_globfp():
    osm = [square(0, 0), square(25, 0, height=30.0), square(50, 0)]
    glo = [square(0, 0, height=7.0, source="globfp", date="2020"), square(50, 0, height=8.0, source="globfp", date="2020")]
    # the raster knows the first two houses, not the third
    asked = []
    raster = (lambda bs: asked.append(len(bs)) or [12.5 if footprint_x(b) < 40 else None for b in bs], "2023")
    result = merge.merge_tile(*KEY, {"osm": osm, "globfp": glo}, {"osm", "globfp", "google"}, {"google": raster})
    first, second, third = result.buildings
    assert (first.height, first.kind, first.height_source, first.height_date) == (12.5, "estimated", "google", "2023")
    assert (second.height, second.kind) == (30.0, "measured")
    assert (third.height, third.height_source) == (8.0, "globfp")
    # asked once, for the two footprints no one measured
    assert asked == [2]


def test_a_raster_switched_off_lends_nothing():
    osm = [square(0, 0)]
    result = merge.merge_tile(*KEY, {"osm": osm}, {"osm"}, {"google": (lambda bs: [12.5] * len(bs), "2023")})
    assert result.buildings[0].kind == "unknown"


def footprint_x(building: Building) -> float:
    """Metres east of the tile's middle, of a footprint's first point."""
    return (building.rings[0][0][0] - LON0) * KX


ALL = {"ign", "osm", "overture", "globfp"}


def test_overture_draws_the_footprints_where_osm_has_mapped_little():
    # Taiz: a house mapped by hand, the rest of the street traced by machine
    osm = street("osm", 1, height=9.0)
    traced = street("overture", 6, shift=1.0)
    result = merge.merge_tile(*KEY, {"osm": osm, "overture": traced, "globfp": street("globfp", 6, shift=-4.0, height=7.0)}, ALL)
    assert result.footprints == "overture"
    # the hand-mapped height reaches its house; the others take 3D-GloBFP's estimate
    assert [(b.height, b.height_source) for b in result.buildings] == [(9.0, "osm")] + [(7.0, "globfp")] * 5


def test_osm_keeps_the_footprints_where_it_maps_the_street_and_globfp_where_overture_is_thin():
    assert merge.merge_tile(*KEY, {"osm": street("osm", 6), "overture": street("overture", 6)}, ALL).footprints == "osm"
    thin = merge.merge_tile(*KEY, {"osm": [], "overture": street("overture", 2), "globfp": street("globfp", 6, height=7.0)}, ALL)
    assert thin.footprints == "globfp"


def test_a_count_of_floors_is_an_estimate_lent_before_globfp():
    floors = [square(i * 25.0, 0.0, height=12.0, kind="estimated", source="overture") for i in range(3)]
    result = merge.merge_tile(*KEY, {"osm": street("osm", 3), "overture": floors, "globfp": street("globfp", 3, height=7.0)}, ALL)
    assert result.footprints == "osm"
    assert {(b.height, b.kind, b.height_source) for b in result.buildings} == {(12.0, "estimated", "overture")}
