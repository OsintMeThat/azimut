"""A Mapbox Vector Tile reader, enough to check what ``engine/mvt.py`` wrote.

Written from the specification rather than borrowed from the encoder, so a
test that reads a tile back is two implementations agreeing, not one agreeing
with itself.
"""

from __future__ import annotations

import struct
from collections.abc import Iterator
from typing import Any


def _varint(buf: bytes, i: int) -> tuple[int, int]:
    shift = value = 0
    while True:
        byte = buf[i]
        i += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, i
        shift += 7


def _fields(buf: bytes) -> Iterator[tuple[int, Any]]:
    """``(field number, value)`` of every field of one message."""
    i = 0
    while i < len(buf):
        key, i = _varint(buf, i)
        number, wire = key >> 3, key & 7
        if wire == 0:
            value, i = _varint(buf, i)
        elif wire == 1:
            value = buf[i:i + 8]
            i += 8
        elif wire == 2:
            size, i = _varint(buf, i)
            value = buf[i:i + size]
            i += size
        elif wire == 5:
            value = buf[i:i + 4]
            i += 4
        else:
            raise ValueError(f"wire type {wire}")
        yield number, value


def _packed(buf: bytes) -> list[int]:
    out, i = [], 0
    while i < len(buf):
        value, i = _varint(buf, i)
        out.append(value)
    return out


def _unzig(n: int) -> int:
    return (n >> 1) ^ -(n & 1)


def _value(buf: bytes) -> Any:
    for number, value in _fields(buf):
        if number == 1:
            return value.decode()
        if number == 2:
            return struct.unpack("<f", value)[0]
        if number == 3:
            return struct.unpack("<d", value)[0]
        if number in (4, 5):
            return value
        if number == 6:
            return _unzig(value)
        if number == 7:
            return bool(value)
    return None


def geometry(commands: list[int]) -> list[list[tuple[int, int]]]:
    """The parts of one geometry: each MoveTo starts one, LineTo extends it."""
    x = y = i = 0
    parts: list[list[tuple[int, int]]] = []
    while i < len(commands):
        command, count = commands[i] & 7, commands[i] >> 3
        i += 1
        if command == 7:  # ClosePath: the ring ends where it began
            continue
        for _ in range(count):
            x += _unzig(commands[i])
            y += _unzig(commands[i + 1])
            i += 2
            if command == 1:
                parts.append([(x, y)])
            else:
                parts[-1].append((x, y))
    return parts


def read(tile: bytes) -> dict[str, dict[str, Any]]:
    """Every layer of a tile by name, its features decoded."""
    layers: dict[str, dict[str, Any]] = {}
    for number, body in _fields(tile):
        assert number == 3, "a tile holds layers and nothing else"
        layer: dict[str, Any] = {"name": None, "keys": [], "values": [], "raw": [], "extent": None, "version": None}
        for field, value in _fields(body):
            if field == 1:
                layer["name"] = value.decode()
            elif field == 2:
                layer["raw"].append(value)
            elif field == 3:
                layer["keys"].append(value.decode())
            elif field == 4:
                layer["values"].append(_value(value))
            elif field == 5:
                layer["extent"] = value
            elif field == 15:
                layer["version"] = value
        features = []
        for raw in layer.pop("raw"):
            tags: list[int] = []
            kind = None
            commands: list[int] = []
            for field, value in _fields(raw):
                if field == 2:
                    tags = _packed(value)
                elif field == 3:
                    kind = value
                elif field == 4:
                    commands = _packed(value)
            properties = {layer["keys"][tags[k]]: layer["values"][tags[k + 1]] for k in range(0, len(tags), 2)}
            features.append({"type": kind, "properties": properties, "parts": geometry(commands)})
        layer["features"] = features
        layers[layer["name"]] = layer
    return layers


def ring_area(ring: list[tuple[int, int]]) -> float:
    """Twice the signed area by the surveyor's formula, positive for an outer ring."""
    closed = ring + ring[:1]
    return float(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(closed, closed[1:], strict=False)))
