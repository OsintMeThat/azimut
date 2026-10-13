"""3D BAG buildings read from a PMTiles archive: heights, clipping, the failures, the coverage box."""

from __future__ import annotations

import math

import numpy as np
import pytest

from azimut.engine import mvt, pmtiles
from azimut.engine.buildings import model, nl3dbag

# A z14 tile over Amsterdam, where the 3D BAG is.
Z, X, Y = model.tile_of(52.37, 4.90)
WEST, SOUTH, EAST, NORTH = model.tile_bounds(Z, X, Y)


class FakeArchive:
    """Stands in for the PMTiles archive: answers every tile with the same bytes, or fails."""

    def __init__(self) -> None:
        self.body: bytes | None = None
        self.error: Exception | None = None
        self.asked: list[tuple[int, int, int]] = []

    def tile(self, z: int, x: int, y: int) -> bytes | None:
        self.asked.append((z, x, y))
        if self.error is not None:
            raise self.error
        return self.body


def _tile_with(*features: tuple[tuple[int, int, int, int], dict[str, float]]) -> bytes:
    """A vector tile of one 'buildings' layer, one rectangle feature per (box, properties).

    Boxes are in the tile's own units: 0 to 4096 from the top-left corner.
    """
    layer = mvt.Layer("buildings")
    for (x0, y0, x1, y1), properties in features:
        layer.rectangles(np.array([x0]), np.array([y0]), np.array([x1]), np.array([y1]), properties)
    return mvt.encode([layer])


def _lat_at(fraction_y: float) -> float:
    """Latitude of a row fraction of the tile, by the Web Mercator formula."""
    n = 2**Z
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (Y + fraction_y) / n))))


def _lon_at(fraction_x: float) -> float:
    return WEST + fraction_x * (EAST - WEST)


@pytest.fixture()
def archive(monkeypatch: pytest.MonkeyPatch) -> FakeArchive:
    fake = FakeArchive()
    monkeypatch.setattr(nl3dbag, "_open", lambda: fake)
    return fake


def test_building_inside_the_tile_keeps_its_measured_height(archive: FakeArchive) -> None:
    archive.body = _tile_with(((1000, 1000, 1400, 1300), {"height": 12.5, "base_height": 12.0}))

    buildings = nl3dbag.fetch_tile(Z, X, Y)

    assert len(buildings) == 1
    building = buildings[0]
    assert building.height == pytest.approx(12.5)
    assert building.kind == "measured"
    assert building.source == "nl3dbag"
    # base_height is deliberately not read: a 3D BAG part stands on the ground.
    assert building.min_height == 0.0
    assert archive.asked == [(Z, X, Y)]


def test_footprint_is_the_rectangle_in_lon_lat(archive: FakeArchive) -> None:
    archive.body = _tile_with(((1000, 1000, 1400, 1300), {"height": 9.0}))

    (building,) = nl3dbag.fetch_tile(Z, X, Y)

    ring = building.rings[0]
    assert len(building.rings) == 1
    assert len(ring) == 4
    assert ring[0] != ring[-1]  # an open ring: no repeated closing point
    corners = [
        (_lon_at(fx), _lat_at(fy)) for fx in (1000 / 4096, 1400 / 4096) for fy in (1000 / 4096, 1300 / 4096)
    ]
    for point in ring:
        assert any(
            point[0] == pytest.approx(lon, abs=1e-9) and point[1] == pytest.approx(lat, abs=1e-9)
            for lon, lat in corners
        ), point
    assert len({(round(lon, 9), round(lat, 9)) for lon, lat in ring}) == 4


def test_building_crossing_the_east_edge_is_clipped_to_the_tile(archive: FakeArchive) -> None:
    # Runs past the tile's east edge (4096) into the buffer the neighbour tile carries.
    archive.body = _tile_with(((3900, 1000, 4500, 1400), {"height": 20.0}))

    (building,) = nl3dbag.fetch_tile(Z, X, Y)

    east_most = max(lon for lon, _ in building.rings[0])
    assert east_most <= EAST + 1e-9
    assert east_most == pytest.approx(EAST, abs=1e-9)
    assert building.height == pytest.approx(20.0)


def test_building_entirely_in_the_buffer_is_dropped(archive: FakeArchive) -> None:
    archive.body = _tile_with(((4200, 1000, 4400, 1200), {"height": 20.0}))

    assert nl3dbag.fetch_tile(Z, X, Y) == []


def test_footprint_under_the_minimum_area_is_dropped(archive: FakeArchive) -> None:
    # A tile unit is about 0.37 m here, so 4 by 4 units is about 2 m² under MIN_AREA (6 m²).
    archive.body = _tile_with(((1000, 1000, 1004, 1004), {"height": 3.0}))

    assert nl3dbag.fetch_tile(Z, X, Y) == []


def test_building_without_a_height_is_unknown(archive: FakeArchive) -> None:
    archive.body = _tile_with(((1000, 1000, 1400, 1300), {"base_height": 11.0}))

    (building,) = nl3dbag.fetch_tile(Z, X, Y)

    assert building.height is None
    assert building.kind == "unknown"
    assert building.source == "nl3dbag"


@pytest.mark.parametrize("height", [0.0, -3.0, 5000.0])
def test_a_height_no_source_could_mean_is_unknown(archive: FakeArchive, height: float) -> None:
    archive.body = _tile_with(((1000, 1000, 1400, 1300), {"height": height}))

    (building,) = nl3dbag.fetch_tile(Z, X, Y)

    assert building.height is None
    assert building.kind == "unknown"


def test_a_tile_the_archive_does_not_hold_gives_no_buildings(archive: FakeArchive) -> None:
    archive.body = None

    assert nl3dbag.fetch_tile(Z, X, Y) == []
    assert archive.asked == [(Z, X, Y)]


def test_an_unreadable_archive_raises_buildings_unavailable(archive: FakeArchive) -> None:
    archive.error = pmtiles.PMTilesUnavailable("the range read was refused")

    with pytest.raises(model.BuildingsUnavailable, match="could not be read"):
        nl3dbag.fetch_tile(Z, X, Y)


@pytest.mark.parametrize(
    "body",
    [b"this is not a vector tile", b"\x1f\x8b not gzip either"],
    ids=["plain-bytes", "broken-gzip"],
)
def test_a_tile_that_is_not_mvt_raises_buildings_unavailable(archive: FakeArchive, body: bytes) -> None:
    archive.body = body

    with pytest.raises(model.BuildingsUnavailable, match="could not be read"):
        nl3dbag.fetch_tile(Z, X, Y)


def test_another_zoom_is_refused_before_the_archive_is_read(archive: FakeArchive) -> None:
    with pytest.raises(ValueError, match="zoom 14"):
        nl3dbag.fetch_tile(Z - 1, X // 2, Y // 2)
    assert archive.asked == []


def test_covers_amsterdam_and_not_paris_or_taiz() -> None:
    assert nl3dbag.covers(*model.tile_of(52.37, 4.90)) is True
    assert nl3dbag.covers(*model.tile_of(48.85, 2.35)) is False
    assert nl3dbag.covers(*model.tile_of(13.58, 44.02)) is False
