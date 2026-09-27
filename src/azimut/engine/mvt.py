"""Mapbox Vector Tiles, written for the two shapes the app serves.

The map draws a vector tile itself, every frame, so a mark keeps its size on
screen through a zoom where a picture's pixels would be stretched until the
next picture lands. The format is protobuf (the Mapbox Vector Tile
specification 2.1), and the app only ever writes points and axis-aligned
rectangles, so a hundred lines of encoding stand in for a protobuf library.

Coordinates are the tile's own, 0 to ``EXTENT`` from the top-left corner. A
feature here is many points or many rectangles sharing their properties,
written as one MultiPoint or one MultiPolygon: a burning week is tens of
thousands of detections, and one feature each would make the tile mostly
headers. The geometry is encoded with numpy, a whole feature at a time.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

import numpy as np

EXTENT = 4096

_MOVE_TO, _LINE_TO, _CLOSE_PATH = 1, 2, 7
_POINT, _POLYGON = 1, 3


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _varints(values: np.ndarray) -> bytes:
    """Many unsigned ints as packed varints, all at once."""
    values = values.astype(np.uint64, copy=False)
    if not values.size:
        return b""
    width = np.ones(values.size, dtype=np.int64)
    for shift in range(7, 64, 7):
        width += values >= (np.uint64(1) << np.uint64(shift))
    out = np.zeros(int(width.sum()), dtype=np.uint8)
    start = np.concatenate([[0], np.cumsum(width)[:-1]])
    rest = values.copy()
    for k in range(int(width.max())):
        live = width > k
        more = width > k + 1
        byte = (rest[live] & np.uint64(0x7F)).astype(np.uint8)
        byte[more[live]] |= 0x80
        out[start[live] + k] = byte
        rest[live] >>= np.uint64(7)
    return out.tobytes()


def _zigzag(values: np.ndarray) -> np.ndarray:
    signed = values.astype(np.int64, copy=False)
    return ((signed << 1) ^ (signed >> 63)).astype(np.uint64)


def _field(number: int, payload: bytes) -> bytes:
    """A length-delimited field: an embedded message, a string or packed ints."""
    return _varint(number << 3 | 2) + _varint(len(payload)) + payload


def _command(command: int, count: int) -> int:
    return command | count << 3


def points_geometry(xs: np.ndarray, ys: np.ndarray) -> bytes:
    """A MultiPoint: one MoveTo carrying every point, each a step from the last."""
    xs, ys = np.asarray(xs, dtype=np.int64), np.asarray(ys, dtype=np.int64)
    steps = np.empty(2 * xs.size, dtype=np.int64)
    steps[0::2] = np.diff(xs, prepend=0)
    steps[1::2] = np.diff(ys, prepend=0)
    return _varint(_command(_MOVE_TO, xs.size)) + _varints(_zigzag(steps))


def rectangles_geometry(x0: np.ndarray, y0: np.ndarray, x1: np.ndarray, y1: np.ndarray) -> bytes:
    """A MultiPolygon of rectangles, each ring clockwise on screen as an outer ring must be.

    A ring is MoveTo its top-left corner, LineTo the other three, ClosePath.
    The cursor carries on from the last ring's last corner.
    """
    x0, y0 = np.asarray(x0, dtype=np.int64), np.asarray(y0, dtype=np.int64)
    x1, y1 = np.asarray(x1, dtype=np.int64), np.asarray(y1, dtype=np.int64)
    n = x0.size
    # corners: top-left, top-right, bottom-right, bottom-left
    cx = np.stack([x0, x1, x1, x0], axis=1)
    cy = np.stack([y0, y0, y1, y1], axis=1)
    flat_x, flat_y = cx.reshape(-1), cy.reshape(-1)
    dx = np.diff(flat_x, prepend=0).reshape(n, 4)
    dy = np.diff(flat_y, prepend=0).reshape(n, 4)
    ring = np.empty((n, 11), dtype=np.uint64)
    ring[:, 0] = _command(_MOVE_TO, 1)
    ring[:, 1], ring[:, 2] = _zigzag(dx[:, 0]), _zigzag(dy[:, 0])
    ring[:, 3] = _command(_LINE_TO, 3)
    for k in range(1, 4):
        ring[:, 2 * k + 2], ring[:, 2 * k + 3] = _zigzag(dx[:, k]), _zigzag(dy[:, k])
    ring[:, 10] = _command(_CLOSE_PATH, 1)
    return _varints(ring.reshape(-1))


Value = int | float | str


@dataclass
class Layer:
    """One named layer: its features, and the keys and values they share."""

    name: str
    features: list[tuple[int, bytes, dict[str, Value]]] = field(default_factory=list)

    def points(self, xs: np.ndarray, ys: np.ndarray, properties: dict[str, Value]) -> None:
        if len(xs):
            self.features.append((_POINT, points_geometry(xs, ys), properties))

    def rectangles(self, x0: np.ndarray, y0: np.ndarray, x1: np.ndarray, y1: np.ndarray,
                   properties: dict[str, Value]) -> None:
        if len(x0):
            self.features.append((_POLYGON, rectangles_geometry(x0, y0, x1, y1), properties))

    def encode(self) -> bytes:
        keys: dict[str, int] = {}
        values: dict[tuple[type, Value], int] = {}
        body = [_varint(15 << 3) + _varint(2), _field(1, self.name.encode())]
        for kind, geometry, properties in self.features:
            tags = []
            for key, value in properties.items():
                tags.append(keys.setdefault(key, len(keys)))
                tags.append(values.setdefault((type(value), value), len(values)))
            feature = (_field(2, b"".join(_varint(t) for t in tags))
                       + _varint(3 << 3) + _varint(kind) + _field(4, geometry))
            body.append(_field(2, feature))
        body += [_field(3, key.encode()) for key in keys]
        body += [_field(4, _value(value)) for _, value in values]
        body.append(_varint(5 << 3) + _varint(EXTENT))
        return b"".join(body)


def _value(value: Value) -> bytes:
    if isinstance(value, bool):
        return _varint(7 << 3) + _varint(int(value))
    if isinstance(value, int):
        if value >= 0:
            return _varint(5 << 3) + _varint(value)
        return _varint(6 << 3) + _varint(int(_zigzag(np.array([value]))[0]))
    if isinstance(value, float):
        return _varint(3 << 3 | 1) + struct.pack("<d", value)
    return _field(1, str(value).encode())


def encode(layers: list[Layer]) -> bytes:
    """A tile of these layers. A layer with nothing in it is left out."""
    return b"".join(_field(3, layer.encode()) for layer in layers if layer.features)
