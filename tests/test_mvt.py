"""The vector tile encoder, read back by a reader written from the specification."""

from __future__ import annotations

import gzip
import struct

import numpy as np
import pytest

from azimut.engine import mvt
from mvtread import _fields, _packed, geometry, read, ring_area


def test_many_varints_are_written_as_each_one_would_be():
    values = [0, 1, 127, 128, 300, 16383, 16384, 2**21, 2**35, 2**63 - 1]
    assert mvt._varints(np.array(values, dtype=np.uint64)) == b"".join(mvt._varint(v) for v in values)
    assert mvt._varints(np.array([], dtype=np.uint64)) == b""


def test_a_step_back_is_zigzagged_to_a_small_number():
    steps = np.array([0, -1, 1, -2, 2, -4096, 4096])
    assert mvt._zigzag(steps).tolist() == [0, 1, 2, 3, 4, 8191, 8192]


def test_points_come_back_where_they_were_put():
    xs, ys = np.array([10, 4000, 4000, 0]), np.array([20, 5, 4095, 0])
    commands = _packed(mvt.points_geometry(xs, ys))
    # one MoveTo for all of them
    assert commands[0] == 1 | 4 << 3
    assert geometry(commands) == [[(10, 20)], [(4000, 5)], [(4000, 4095)], [(0, 0)]]


def test_rectangles_come_back_as_outer_rings():
    x0, y0 = np.array([0, -50]), np.array([0, 100])
    x1, y1 = np.array([10, 4200]), np.array([30, 180])
    parts = geometry(_packed(mvt.rectangles_geometry(x0, y0, x1, y1)))
    assert parts == [[(0, 0), (10, 0), (10, 30), (0, 30)], [(-50, 100), (4200, 100), (4200, 180), (-50, 180)]]
    # clockwise on screen, which is what makes each one filled rather than a hole
    assert all(ring_area(ring) > 0 for ring in parts)


def test_a_layer_says_its_name_extent_and_version_and_shares_its_values():
    layer = mvt.Layer("marks")
    layer.points(np.array([1]), np.array([2]), {"recent": 1, "side": 375})
    layer.points(np.array([3]), np.array([4]), {"recent": 1, "side": 400})
    tile = read(mvt.encode([layer]))
    marks = tile["marks"]
    assert (marks["extent"], marks["version"]) == (mvt.EXTENT, 2)
    assert [f["properties"] for f in marks["features"]] == [{"recent": 1, "side": 375}, {"recent": 1, "side": 400}]
    # "recent: 1" is written once for both features
    assert marks["keys"] == ["recent", "side"] and marks["values"] == [1, 375, 400]


def test_every_kind_of_value_reads_back_as_itself():
    layer = mvt.Layer("kinds")
    properties = {"count": 7, "below": -3, "ratio": 0.25, "name": "fire", "on": True}
    layer.points(np.array([0]), np.array([0]), properties)
    [feature] = read(mvt.encode([layer]))["kinds"]["features"]
    assert feature["properties"] == properties
    # a bool is not the int 1, even when both are in one layer
    both = mvt.Layer("both")
    both.points(np.array([0]), np.array([0]), {"a": 1})
    both.points(np.array([0]), np.array([0]), {"a": True})
    assert [f["properties"]["a"] for f in read(mvt.encode([both]))["both"]["features"]] == [1, True]


def test_a_layer_with_nothing_in_it_is_left_out():
    empty, full = mvt.Layer("empty"), mvt.Layer("full")
    empty.points(np.array([], dtype=np.int64), np.array([], dtype=np.int64), {"recent": 0})
    full.points(np.array([5]), np.array([6]), {"recent": 0})
    assert set(read(mvt.encode([empty, full]))) == {"full"}
    assert mvt.encode([empty]) == b""
    # and a tile is layers and nothing else
    assert [number for number, _ in _fields(mvt.encode([full]))] == [3]


# -- reading someone else's tile -------------------------------------------------


def _peaks_tile() -> bytes:
    roads, summits = mvt.Layer("transportation"), mvt.Layer("mountain_peak")
    roads.rectangles(np.array([0]), np.array([0]), np.array([10]), np.array([10]), {"class": "road"})
    summits.points(np.array([1024]), np.array([2048]), {"name": "Eiger", "ele": 3967})
    # past the right edge, in the buffer a tile server keeps
    summits.points(np.array([mvt.EXTENT + 20]), np.array([-20]), {"name": "Mönch"})
    summits.rectangles(np.array([1]), np.array([1]), np.array([2]), np.array([2]), {"name": "a ridge"})
    return mvt.encode([roads, summits])


def test_the_points_of_one_layer_are_read_and_the_rest_stepped_over():
    points = mvt.read_points(_peaks_tile(), "mountain_peak")
    assert points == [
        (0.25, 0.5, {"name": "Eiger", "ele": 3967}),
        ((mvt.EXTENT + 20) / mvt.EXTENT, -20 / mvt.EXTENT, {"name": "Mönch"}),
    ]
    assert mvt.read_points(_peaks_tile(), "place") == []
    # as a tile server stores it
    assert mvt.read_points(gzip.compress(_peaks_tile()), "mountain_peak") == points


def test_a_layer_s_own_extent_is_kept():
    layer = mvt.Layer("mountain_peak")
    layer.points(np.array([128]), np.array([384]), {"name": "Eiger"})
    body = layer.encode()
    extent = mvt._varint(5 << 3) + mvt._varint(mvt.EXTENT)
    assert body.endswith(extent)
    small = mvt._field(3, body[: -len(extent)] + mvt._varint(5 << 3) + mvt._varint(512))
    assert mvt.read_points(small, "mountain_peak") == [(0.25, 0.75, {"name": "Eiger"})]


def test_every_kind_of_value_a_tile_server_writes_is_read():
    layer = mvt.Layer("kinds")
    properties = {"count": 7, "below": -3, "ratio": 0.25, "name": "fire", "on": True}
    layer.points(np.array([0]), np.array([0]), properties)
    [(_x, _y, read_back)] = mvt.read_points(mvt.encode([layer]), "kinds")
    assert read_back == properties
    # a float and a plain int64, which this encoder never writes
    assert mvt._read_value(memoryview(mvt._varint(2 << 3 | 5) + struct.pack("<f", 0.5))) == 0.5
    assert mvt._read_value(memoryview(mvt._varint(4 << 3) + mvt._varint(2**64 - 2))) == -2


def test_a_tile_cut_short_or_not_a_tile_is_refused():
    tile = _peaks_tile()
    with pytest.raises(ValueError):
        mvt.read_points(tile[:-3], "mountain_peak")
    with pytest.raises(ValueError):
        mvt.read_points(b"\x1f\x8b not gzip at all", "mountain_peak")
