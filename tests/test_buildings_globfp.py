"""3D-GloBFP: download, index and read, with no network.

The grid is a small shapefile written here, zipped, and served from memory through
a mock transport, so the real download, unpack, index and read code run end to end.
"""

from __future__ import annotations

import io
import struct
import zipfile

import httpx
import numpy as np
import pytest

from azimut.engine.buildings import globfp, globfp_grids, model

LAT, LON = 12.83, 43.18
TILE = model.tile_of(LAT, LON, model.ZOOM)
_z, _x, _y = TILE
WEST, SOUTH, EAST, NORTH = model.tile_bounds(*TILE)
EAST_TILE = model.tile_of((SOUTH + NORTH) / 2, EAST + (EAST - WEST) / 2, model.ZOOM)
EAST_WEST, _s, EAST_EAST, _n = model.tile_bounds(*EAST_TILE)
MID_LAT = (SOUTH + NORTH) / 2


def square(cx: float, cy: float, half: float, clockwise: bool = True) -> list[tuple[float, float]]:
    ring = [(cx - half, cy - half), (cx + half, cy - half), (cx + half, cy + half), (cx - half, cy + half)]
    return ring if not clockwise else list(reversed(ring))


def _polygon(rings: list[list[tuple[float, float]]]) -> bytes:
    points: list[tuple[float, float]] = []
    parts: list[int] = []
    for ring in rings:
        parts.append(len(points))
        points.extend(list(ring) + [ring[0]])
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    flat = [c for p in points for c in p]
    return (
        struct.pack("<i", 5)
        + struct.pack("<4d", min(xs), min(ys), max(xs), max(ys))
        + struct.pack("<ii", len(rings), len(points))
        + struct.pack(f"<{len(parts)}i", *parts)
        + struct.pack(f"<{len(flat)}d", *flat)
    )


def _file_header(length: int, bbox: tuple[float, float, float, float]) -> bytes:
    return (
        struct.pack(">i", 9994)
        + b"\0" * 20
        + struct.pack(">i", length // 2)
        + struct.pack("<ii", 1000, 5)
        + struct.pack("<4d", *bbox)
        + b"\0" * 32
    )


def _dbf(heights: list[float]) -> bytes:
    fields = [(b"FID_1", b"N", 10, 0), (b"Height", b"N", 12, 2)]
    header_len = 32 + 32 * len(fields) + 1
    record_len = 1 + sum(size for _n, _t, size, _d in fields)
    out = struct.pack("<BBBBIHH", 3, 126, 1, 1, len(heights), header_len, record_len) + b"\0" * 20
    for name, kind, size, dec in fields:
        out += name.ljust(11, b"\0") + kind + b"\0" * 4 + bytes([size, dec]) + b"\0" * 14
    out += b"\r"
    for i, height in enumerate(heights):
        out += b" " + str(i + 1).rjust(10).encode() + f"{height:.2f}".rjust(12).encode()
    return out


def shapefile(polygons: list[list[list[tuple[float, float]]]], heights: list[float]) -> dict[str, bytes]:
    """The .shp, .shx and .dbf of one shapefile, one record per polygon."""
    body = b""
    index = b""
    offset = 100
    points = [p for poly in polygons for ring in poly for p in ring]
    for number, poly in enumerate(polygons, 1):
        content = _polygon(poly)
        body += struct.pack(">ii", number, len(content) // 2) + content
        index += struct.pack(">ii", offset // 2, len(content) // 2)
        offset += 8 + len(content)
    bbox = (
        min(p[0] for p in points), min(p[1] for p in points),
        max(p[0] for p in points), max(p[1] for p in points),
    )
    return {
        ".shp": _file_header(100 + len(body), bbox) + body,
        ".shx": _file_header(100 + len(index), bbox) + index,
        ".dbf": _dbf(heights),
    }


# Dotted, like the real cells ("...13.75_DJ_ER_YM"): a suffix taken with
# `with_suffix` would cut such a name in the wrong place.
DOTTED = "cell_1563_42.5_12.5_43.75_13.75"


def zipped(members: dict[str, bytes], stem: str = DOTTED) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for ext, data in members.items():
            archive.writestr(f"{stem}{ext}", data)
    return buffer.getvalue()


# One cell of the test grid: a building in the tile, one in the tile to the east,
# one across their border, a courtyard, two parts, a zero height, and a shed.
def _cell_polygons() -> tuple[list[list[list[tuple[float, float]]]], list[float]]:
    inside = (WEST + 0.004, SOUTH + 0.004)
    polygons = [
        [square(WEST + 0.002, MID_LAT, 0.0002)],  # 0: in the tile, 12.5 m
        [square(EAST_WEST + 0.005, MID_LAT, 0.0002)],  # 1: only in the east tile, 30 m
        [square(EAST, MID_LAT, 0.0002)],  # 2: across the border, 8 m
        [  # 3: a courtyard, outer clockwise, hole counter-clockwise
            square(inside[0], inside[1], 0.0005),
            square(inside[0], inside[1], 0.0002, clockwise=False),
        ],
        [  # 4: two separate clockwise parts in one record
            square(WEST + 0.012, SOUTH + 0.002, 0.0005),
            square(WEST + 0.012, SOUTH + 0.012, 0.0005),
        ],
        [square(WEST + 0.016, SOUTH + 0.016, 0.0002)],  # 5: height 0, unknown
        [square(WEST + 0.006, SOUTH + 0.010, 0.000005)],  # 6: about 1 m², dropped
    ]
    heights = [12.5, 30.0, 8.0, 20.0, 5.0, 0.0, 15.0]
    return polygons, heights


def _grid(size: int, file_id: int = 1, name: str = "cell.zip") -> globfp.Grid:
    return globfp.Grid(
        name=name, west=WEST - 0.01, south=SOUTH - 0.01, east=EAST_EAST + 0.01, north=NORTH + 0.01,
        file_id=file_id, size=size,
    )


@pytest.fixture()
def cell(monkeypatch, tmp_workspace):
    """The test grid's zip, registered as the one grid the app knows of."""
    polygons, heights = _cell_polygons()
    body = zipped(shapefile(polygons, heights))
    grid = _grid(len(body))
    monkeypatch.setattr(globfp_grids, "GRIDS", ((grid.name, grid.west, grid.south, grid.east, grid.north, grid.file_id, grid.size),))
    return grid, body


def _serve(monkeypatch, body: bytes | None = None, status: int = 200, error: Exception | None = None):
    """Route the download's GET to memory. Returns the list of requested URLs."""
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(str(request.url))
        if error is not None:
            raise error
        if status != 200 or body is None:
            return httpx.Response(status)
        return httpx.Response(200, content=body, headers={"content-length": str(len(body))})

    def make_client() -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)

    monkeypatch.setattr(globfp, "_client", make_client)
    return asked


def _summary(buildings: list[model.Building]) -> list[tuple[float | None, str, int]]:
    return sorted(((b.height, b.kind, len(b.rings)) for b in buildings), key=repr)


def _root():
    return model.cache_root() / globfp.SOURCE


def test_download_then_read_returns_the_buildings_of_each_tile(monkeypatch, cell):
    grid, body = cell
    asked = _serve(monkeypatch, body)

    globfp.download(grid)

    assert asked == [grid.url]
    assert globfp.is_ready(grid)
    here = globfp.read_tile(*TILE)
    assert _summary(here) == sorted(
        [
            (5.0, "estimated", 1),
            (5.0, "estimated", 1),
            (8.0, "estimated", 1),
            (12.5, "estimated", 1),
            (20.0, "estimated", 2),
            (None, "unknown", 1),
        ],
        key=repr,
    )
    assert {b.source for b in here} == {"globfp"}
    assert {b.date for b in here} == {"2020"}
    assert {b.min_height for b in here} == {0.0}
    there = globfp.read_tile(*EAST_TILE)
    assert _summary(there) == sorted([(8.0, "estimated", 1), (30.0, "estimated", 1)], key=repr)


def test_a_tile_with_no_buildings_reads_empty(monkeypatch, cell):
    grid, body = cell
    _serve(monkeypatch, body)
    globfp.download(grid)

    far = model.tile_of(LAT, LON + 0.1, model.ZOOM)
    assert globfp.read_tile(*far) == []


def test_a_building_across_two_tiles_comes_back_in_both(monkeypatch, cell):
    grid, body = cell
    _serve(monkeypatch, body)
    globfp.download(grid)

    straddler = [b for b in globfp.read_tile(*TILE) if b.height == 8.0]
    beyond = [b for b in globfp.read_tile(*EAST_TILE) if b.height == 8.0]
    assert len(straddler) == 1 and len(beyond) == 1
    assert straddler[0].rings == beyond[0].rings


def test_a_courtyard_is_a_hole_of_its_outer_ring(monkeypatch, cell):
    grid, body = cell
    _serve(monkeypatch, body)
    globfp.download(grid)

    (courtyard,) = [b for b in globfp.read_tile(*TILE) if b.height == 20.0]
    assert len(courtyard.rings) == 2
    outer, hole = courtyard.rings
    lat0 = outer[0][1]
    assert model.ring_area(outer, lat0) < 0 < model.ring_area(hole, lat0)  # clockwise, counter-clockwise
    assert abs(model.ring_area(outer, lat0)) > abs(model.ring_area(hole, lat0))
    assert len(outer) == 4 and len(hole) == 4
    assert outer[0] != outer[-1]  # rings come out open


def test_two_separate_parts_are_two_buildings(monkeypatch, cell):
    grid, body = cell
    _serve(monkeypatch, body)
    globfp.download(grid)

    parts = [b for b in globfp.read_tile(*TILE) if b.height == 5.0]
    assert len(parts) == 2
    assert all(len(b.rings) == 1 for b in parts)
    assert parts[0].rings != parts[1].rings


def test_a_zero_height_is_unknown_not_zero(monkeypatch, cell):
    grid, body = cell
    _serve(monkeypatch, body)
    globfp.download(grid)

    unknown = [b for b in globfp.read_tile(*TILE) if b.kind == "unknown"]
    assert len(unknown) == 1
    assert unknown[0].height is None


def test_a_shed_under_the_minimum_area_is_dropped(monkeypatch, cell):
    grid, body = cell
    _serve(monkeypatch, body)
    globfp.download(grid)

    assert all(b.height != 15.0 for b in globfp.read_tile(*TILE))


def test_progress_reports_the_bytes_of_the_zip(monkeypatch, cell):
    grid, body = cell
    _serve(monkeypatch, body)
    seen: list[tuple[int, int]] = []

    globfp.download(grid, progress=lambda done, total: seen.append((done, total)))

    assert seen
    assert seen[-1] == (len(body), len(body))
    assert [done for done, _total in seen] == sorted(done for done, _total in seen)


def test_a_cancelled_download_leaves_nothing(monkeypatch, cell):
    grid, body = cell
    _serve(monkeypatch, body)

    globfp.download(grid, cancelled=lambda: True)

    assert not globfp.is_ready(grid)
    assert globfp.read_tile(*TILE) == []
    incoming = _root() / "incoming"
    assert not incoming.exists() or list(incoming.iterdir()) == []
    assert not (_root() / grid.folder_name).exists()
    leftovers = [p for p in _root().iterdir() if p.name != "incoming"] if _root().exists() else []
    assert leftovers == []


@pytest.mark.parametrize(
    "answer",
    [
        {"status": 500},
        {"error": httpx.ConnectError("refused")},
    ],
    ids=["http-error", "no-connection"],
)
def test_a_failed_download_is_unavailable_and_leaves_nothing(monkeypatch, cell, answer):
    grid, _body = cell
    _serve(monkeypatch, **answer)

    with pytest.raises(model.BuildingsUnavailable):
        globfp.download(grid)

    assert not globfp.is_ready(grid)
    assert not (_root() / grid.folder_name).exists()
    assert list((_root() / "incoming").iterdir()) == []


def test_a_download_that_is_not_a_zip_is_unavailable(monkeypatch, cell):
    grid, _body = cell
    _serve(monkeypatch, b"<html>not a grid</html>")

    with pytest.raises(model.BuildingsUnavailable):
        globfp.download(grid)
    assert not globfp.is_ready(grid)


def test_a_zip_without_a_complete_shapefile_is_unavailable(monkeypatch, cell):
    grid, _body = cell
    shp_only = zipped({".shp": shapefile(*_cell_polygons())[".shp"]})
    _serve(monkeypatch, shp_only)

    with pytest.raises(model.BuildingsUnavailable):
        globfp.download(grid)
    assert not globfp.is_ready(grid)


def test_read_never_touches_the_network(monkeypatch, cell):
    grid, body = cell

    def no_client() -> httpx.Client:
        raise AssertionError("read_tile must not reach the network")

    monkeypatch.setattr(globfp, "_client", no_client)
    assert globfp.read_tile(*TILE) == []  # not downloaded yet

    _serve(monkeypatch, body)
    globfp.download(grid)
    monkeypatch.setattr(globfp, "_client", no_client)
    assert len(globfp.read_tile(*TILE)) == 6


def test_needed_lists_the_grids_not_on_disk(monkeypatch, cell):
    grid, body = cell
    assert [g.name for g in globfp.needed(*TILE)] == [grid.name]

    _serve(monkeypatch, body)
    globfp.download(grid)
    assert globfp.needed(*TILE) == []


def test_grids_for_tile_follows_the_grid_bounds(monkeypatch):
    rows = (
        ("in.zip", WEST - 0.001, SOUTH - 0.001, WEST + 0.001, SOUTH + 0.001, 1, 10),
        ("beside.zip", EAST, SOUTH, EAST + 1.0, NORTH, 2, 10),  # shares an edge only
        ("away.zip", 0.0, 0.0, 1.0, 1.0, 3, 10),
        ("over.zip", WEST - 1.0, SOUTH - 1.0, EAST + 1.0, NORTH + 1.0, 4, 10),
    )
    monkeypatch.setattr(globfp_grids, "GRIDS", rows)

    names = [g.name for g in globfp.grids_for_tile(*TILE)]
    assert names == ["in.zip", "over.zip"]
    assert globfp.grids_for_tile(*TILE)[0].url == "https://ndownloader.figshare.com/files/1"


def test_redownload_replaces_the_folder(monkeypatch, cell):
    grid, body = cell
    _serve(monkeypatch, body)
    globfp.download(grid)
    first = {b.height for b in globfp.read_tile(*TILE)}

    other = shapefile([[square(WEST + 0.003, MID_LAT, 0.0002)]], [77.0])
    _serve(monkeypatch, zipped(other))
    globfp.download(grid)

    assert {b.height for b in globfp.read_tile(*TILE)} == {77.0}
    assert 12.5 in first
    leftovers = [p.name for p in _root().iterdir() if ".old-" in p.name or p.name.endswith(".tmp")]
    assert leftovers == []


def test_the_generated_grid_index_is_well_formed():
    grids = globfp_grids.GRIDS
    assert grids
    names = [row[0] for row in grids]
    assert names == sorted(names)
    assert len({row[5] for row in grids}) == len(grids)
    for name, west, south, east, north, file_id, size in grids:
        assert name.endswith(".zip")
        assert -180 <= west < east <= 180
        assert -90 <= south < north <= 90
        assert file_id > 0 and size > 0


def test_read_tile_refuses_another_zoom(tmp_workspace):
    with pytest.raises(ValueError):
        globfp.read_tile(13, _x, _y)


def test_the_index_is_sorted_by_tile_code(monkeypatch, cell):
    grid, body = cell
    _serve(monkeypatch, body)
    globfp.download(grid)

    with np.load(_root() / grid.folder_name / "index.npz") as data:
        codes = data["codes"]
        assert codes.dtype == np.int64
        assert np.all(np.diff(codes) >= 0)
        assert int(codes.max()) < 2**28  # x and y both below 2**14
