"""OpenStreetMap buildings from OpenFreeMap's tiles: clipping, heights, holes, the failures."""

from __future__ import annotations

import pytest

from azimut.engine import mvt, peaks, tiles
from azimut.engine.buildings import model, osm

TEMPLATE = "https://tiles.openfreemap.org/planet/20261004_113936_pt/{z}/{x}/{y}.pbf"
# a z14 tile over Lyon, where the live check reads
X, Y = 8411, 5848


def _zigzag(d: int) -> int:
    return (d << 1) ^ (d >> 63)


def _polygon(*rings: list[tuple[int, int]]) -> bytes:
    """Rings as the specification writes them: MoveTo, LineTo, ClosePath, the cursor carried on."""
    commands: list[int] = []
    cx = cy = 0
    for ring in rings:
        for index, (px, py) in enumerate(ring):
            if index == 0:
                commands.append(mvt._command(1, 1))
            elif index == 1:
                commands.append(mvt._command(2, len(ring) - 1))
            commands += [_zigzag(px - cx), _zigzag(py - cy)]
            cx, cy = px, py
        commands.append(mvt._command(7, 1))
    return b"".join(mvt._varint(c) for c in commands)


def _square(x0: int, y0: int, x1: int, y1: int) -> list[tuple[int, int]]:
    """Clockwise on screen, so an exterior ring."""
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


# counter-clockwise on screen, so a hole in the square around it
HOLE = [(150, 150), (150, 250), (250, 250), (250, 150)]


def _tile(buildings: list[tuple[list[list[tuple[int, int]]], dict]]) -> bytes:
    layer = mvt.Layer("building")
    for rings, properties in buildings:
        layer.features.append((3, _polygon(*rings), properties))
    return mvt.encode([layer])


def _fetch(monkeypatch, buildings, template: str = TEMPLATE) -> list[model.Building]:
    tile = _tile(buildings)
    monkeypatch.setattr(peaks, "fetch_vector_tile", lambda z, x, y: (tile, template))
    return osm.fetch_tile(model.ZOOM, X, Y)


def _lon_at(fx: float) -> float:
    return tiles.unproject(X + fx, Y + 0.25, model.ZOOM)[1]


def test_a_building_across_the_east_edge_is_clipped_to_the_tile(monkeypatch):
    # runs from 3900 to 4300 units: the tile is 4096 wide, the rest is the neighbour's
    crossing = _square(3900, 1000, 4300, 1200)
    [building] = _fetch(monkeypatch, [([crossing], {"render_height": 12})])
    _west, _south, east, _north = model.tile_bounds(model.ZOOM, X, Y)
    lons = [lon for lon, _lat in building.rings[0]]
    assert max(lons) == pytest.approx(east, abs=1e-12)
    assert min(lons) == pytest.approx(_lon_at(3900 / 4096), abs=1e-9)
    assert len(building.rings[0]) == 4  # the clipped square is still a square
    assert building.height == 12.0 and building.kind == "measured"


def test_a_building_wholly_in_the_buffer_is_left_to_the_neighbour(monkeypatch):
    beyond = _square(4150, 1000, 4300, 1200)
    inside = _square(100, 100, 300, 300)
    buildings = _fetch(monkeypatch, [([beyond], {"render_height": 12}), ([inside], {"render_height": 12})])
    assert len(buildings) == 1


def test_the_five_metre_fill_is_no_height_at_all(monkeypatch):
    [filled] = _fetch(monkeypatch, [([_square(100, 100, 300, 300)], {"render_height": 5})])
    assert (filled.height, filled.kind) == (None, "unknown")
    [missing] = _fetch(monkeypatch, [([_square(100, 100, 300, 300)], {})])
    assert (missing.height, missing.kind) == (None, "unknown")
    [real] = _fetch(monkeypatch, [([_square(100, 100, 300, 300)], {"render_height": 9})])
    assert (real.height, real.kind) == (9.0, "measured")


def test_a_height_no_source_could_give_is_unknown(monkeypatch):
    [building] = _fetch(monkeypatch, [([_square(100, 100, 300, 300)], {"render_height": 5000})])
    assert (building.height, building.kind) == (None, "unknown")


def test_a_feature_hidden_in_3d_is_skipped(monkeypatch):
    outline = ([_square(100, 100, 300, 300)], {"render_height": 12, "hide_3d": True})
    drawn = ([_square(1000, 1000, 1200, 1200)], {"render_height": 12})
    [building] = _fetch(monkeypatch, [outline, drawn])
    # the square at 1000 units is the one kept, the outline at 100 is not
    assert min(lon for lon, _lat in building.rings[0]) == pytest.approx(_lon_at(1000 / 4096), abs=1e-9)
    assert _fetch(monkeypatch, [outline]) == []


def test_a_part_that_starts_above_the_ground_keeps_its_minimum_height(monkeypatch):
    lifted = _fetch(monkeypatch, [([_square(100, 100, 300, 300)], {"render_height": 30, "render_min_height": 10})])
    assert (lifted[0].height, lifted[0].min_height) == (30.0, 10.0)
    # a start at or above the top is no part at all: the ground is the answer
    above = _fetch(monkeypatch, [([_square(100, 100, 300, 300)], {"render_height": 30, "render_min_height": 40})])
    assert above[0].min_height == 0.0
    # without a height there is nothing for it to start below
    unknown = _fetch(monkeypatch, [([_square(100, 100, 300, 300)], {"render_height": 5, "render_min_height": 3})])
    assert unknown[0].min_height == 0.0


def test_a_hole_is_kept_as_the_second_ring(monkeypatch):
    [building] = _fetch(monkeypatch, [([_square(100, 100, 300, 300), HOLE], {"render_height": 12})])
    assert len(building.rings) == 2
    outer, hole = building.rings
    assert len(outer) == 4 and len(hole) == 4
    assert outer != hole


def test_a_footprint_under_the_minimum_area_is_dropped(monkeypatch):
    assert _fetch(monkeypatch, [([_square(100, 100, 102, 102)], {"render_height": 12})]) == []


def test_a_tile_the_build_lacks_has_no_buildings(monkeypatch):
    monkeypatch.setattr(peaks, "fetch_vector_tile", lambda z, x, y: (None, TEMPLATE))
    assert osm.fetch_tile(model.ZOOM, X, Y) == []


def test_a_source_that_cannot_be_read_is_buildings_unavailable(monkeypatch):
    def unreachable(z, x, y):
        raise peaks.PeaksUnavailable("OpenFreeMap answered 500")

    monkeypatch.setattr(peaks, "fetch_vector_tile", unreachable)
    with pytest.raises(model.BuildingsUnavailable, match="could not be read just now") as info:
        osm.fetch_tile(model.ZOOM, X, Y)
    assert "500" in str(info.value)


def test_a_tile_that_is_not_one_is_buildings_unavailable(monkeypatch):
    monkeypatch.setattr(peaks, "fetch_vector_tile", lambda z, x, y: (b"not a tile at all", TEMPLATE))
    with pytest.raises(model.BuildingsUnavailable):
        osm.fetch_tile(model.ZOOM, X, Y)


def test_the_date_is_the_weekly_build_the_tile_came_from(monkeypatch):
    [building] = _fetch(monkeypatch, [([_square(100, 100, 300, 300)], {"render_height": 12})])
    assert building.date == "2026-10-04"
    assert building.source == osm.SOURCE == "osm"
    [unnamed] = _fetch(monkeypatch, [([_square(100, 100, 300, 300)], {"render_height": 12})], template="https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf")
    assert unnamed.date == ""


def test_only_zoom_fourteen_is_read():
    with pytest.raises(ValueError, match="zoom 14"):
        osm.fetch_tile(13, X // 2, Y // 2)
