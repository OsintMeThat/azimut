"""Single tiles out of a PMTiles archive, read over HTTP Range requests.

A PMTiles archive packs a whole basemap or a whole dataset into one file, often
gigabytes, that sits in a bucket. Its header and its directories say where each
tile lies inside it, so a view that needs a dozen tiles reads a few kilobytes of
directory and the bytes of those dozen tiles, and never the file. A country-sized
archive can then be read round a view without downloading it.

Supported: PMTiles v3, clustered or not, with the directories stored uncompressed
or gzipped, and tiles stored uncompressed or gzipped. Brotli and zstd need a
decoder the app does not ship, so an archive that uses either raises `ValueError`
rather than returning garbage.

The reads go through one shared HTTP client with the app's User-Agent, a timeout,
and a retry on the transient gateway statuses, as `peaks` and `tiles` do. A test
or another source can pass its own `read` function instead.
"""

from __future__ import annotations

import bisect
import gzip
import json
import struct
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

from . import tiles

HEADER_LENGTH = 127
# The header and the root directory are read together: the spec keeps both inside
# the first 16 KiB, so one request answers the first two questions of an archive.
FIRST_READ = 16384
MAGIC = b"PMTiles"
VERSION = 3

COMPRESSION_NAMES = {1: "none", 2: "gzip", 3: "brotli", 4: "zstd"}
TILE_TYPES = {1: "mvt", 2: "png", 3: "jpeg", 4: "webp", 5: "avif", 6: "maplibre-mvt"}

ReadFunction = Callable[[str, int, int], bytes]


class PMTilesUnavailable(Exception):
    """The archive could not be read just now: the reason, a short English sentence."""


@dataclass(frozen=True)
class Entry:
    """One directory entry: a run of tiles, or a leaf when `run_length` is 0."""

    tile_id: int
    run_length: int
    offset: int
    length: int


def zxy_to_tileid(z: int, x: int, y: int) -> int:
    """The position of a tile along the Hilbert curves that PMTiles numbers by.

    Zoom levels are laid end to end: the tiles of every lower zoom come first
    (1 + 4 + 16 + ... for z tiles below), then the tile's own index on the
    Hilbert curve of its zoom. The curve's rotation is the standard xy2d step.
    """
    if z < 0 or not 0 <= x < 1 << z or not 0 <= y < 1 << z:
        raise ValueError(f"tile {z}/{x}/{y} is outside the grid")
    below = sum((1 << t) * (1 << t) for t in range(z))
    n = 1 << z
    index = 0
    s = n // 2
    while s > 0:
        rx = 1 if x & s else 0
        ry = 1 if y & s else 0
        index += s * s * ((3 * rx) ^ ry)
        if ry == 0:
            if rx == 1:
                x = n - 1 - x
                y = n - 1 - y
            x, y = y, x
        s //= 2
    return below + index


def _decompress(data: bytes, compression: int) -> bytes:
    if compression == 1:
        return data
    if compression == 2:
        return gzip.decompress(data)
    if compression in (3, 4):
        raise ValueError(f"{COMPRESSION_NAMES[compression]} compression is not supported")
    raise ValueError(f"unknown compression {compression}")


def _varint(buf: bytes, pos: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while True:
        if pos >= len(buf):
            raise ValueError("directory ended in the middle of a number")
        byte = buf[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, pos
        shift += 7
        if shift > 63:
            raise ValueError("directory holds a number too long to be real")


def _parse_directory(raw: bytes) -> list[Entry]:
    """The entries of one (already decompressed) directory, in tile id order."""
    count, pos = _varint(raw, 0)
    ids: list[int] = []
    last = 0
    for _ in range(count):
        delta, pos = _varint(raw, pos)
        last += delta
        ids.append(last)
    runs: list[int] = []
    for _ in range(count):
        run, pos = _varint(raw, pos)
        runs.append(run)
    lengths: list[int] = []
    for _ in range(count):
        length, pos = _varint(raw, pos)
        lengths.append(length)
    entries: list[Entry] = []
    for i in range(count):
        stored, pos = _varint(raw, pos)
        if i > 0 and stored == 0:
            # 0 means the tile lies directly after the previous one in the file
            offset = entries[-1].offset + entries[-1].length
        elif stored == 0:
            raise ValueError("directory's first entry has no offset")
        else:
            offset = stored - 1
        entries.append(Entry(ids[i], runs[i], offset, lengths[i]))
    return entries


def _find(entries: list[Entry], ids: list[int], tile_id: int) -> Entry | None:
    """The entry that holds a tile: an exact match, or the run it falls in.

    Returns a leaf entry (run_length 0) when the tile may be inside a leaf
    directory, and None when no entry can hold it.
    """
    i = bisect.bisect_right(ids, tile_id) - 1
    if i < 0:
        return None
    entry = entries[i]
    if entry.run_length == 0:
        return entry
    if tile_id - entry.tile_id < entry.run_length:
        return entry
    return None


def _http_read(url: str, offset: int, length: int) -> bytes:
    """Bytes `offset` to `offset + length` of a URL, asked again on a transient failure."""
    headers = {"Range": f"bytes={offset}-{offset + length - 1}"}
    for attempt in range(1, tiles.MAX_TILE_TRIES + 1):
        last = attempt == tiles.MAX_TILE_TRIES
        try:
            response = _client().get(url, headers=headers)
        except httpx.HTTPError as exc:
            if last:
                raise PMTilesUnavailable(tiles.upstream_failure(exc)) from exc
            continue
        if response.status_code in tiles.TRANSIENT_STATUSES and not last:
            time.sleep(tiles.RETRY_PAUSE)
            continue
        if response.status_code == 206:
            return response.content
        if response.status_code == 200:
            # the server ignored the Range header and sent the whole file
            return response.content[offset:offset + length]
        raise PMTilesUnavailable(f"the archive answered {response.status_code}")
    raise AssertionError("unreachable")  # the loop returns or raises on its last turn


_client_lock = threading.Lock()
_client_instance: httpx.Client | None = None


def _client() -> httpx.Client:
    global _client_instance
    with _client_lock:
        if _client_instance is None:
            _client_instance = httpx.Client(
                follow_redirects=True,
                timeout=tiles.TILE_TIMEOUT,
                limits=httpx.Limits(max_keepalive_connections=6, max_connections=6),
                headers={"User-Agent": tiles.USER_AGENT},
            )
        return _client_instance


class Archive:
    """One PMTiles archive at a URL, read a tile at a time.

    The header is read on first use, with the root directory, and parsed leaf
    directories are kept in a small LRU. A tile costs at most one leaf read (none
    once that leaf is cached) and one read for its bytes.
    """

    def __init__(
        self, url: str, read: ReadFunction | None = None, cache_size: int = 64
    ) -> None:
        self.url = url
        self._read: ReadFunction = read or _http_read
        self._cache_size = cache_size
        self._header: dict[str, Any] | None = None
        self._root: list[Entry] = []
        self._root_ids: list[int] = []
        self._header_lock = threading.Lock()
        self._cache: OrderedDict[tuple[int, int], tuple[list[Entry], list[int]]] = OrderedDict()
        self._cache_lock = threading.Lock()

    @property
    def header(self) -> dict[str, Any]:
        """The header fields, read and parsed on first use."""
        with self._header_lock:
            if self._header is None:
                self._load()
            assert self._header is not None
            return self._header

    def _load(self) -> None:
        head = self._read(self.url, 0, FIRST_READ)
        if len(head) < HEADER_LENGTH:
            raise ValueError("the archive is shorter than a PMTiles header")
        header = _parse_header(head)
        root_end = header["root_offset"] + header["root_length"]
        if root_end <= len(head):
            raw = head[header["root_offset"]:root_end]
        else:
            raw = self._fetch(header["root_offset"], header["root_length"])
        self._root = _parse_directory(
            _decompress(raw, header["internal_compression"])
        )
        self._root_ids = [entry.tile_id for entry in self._root]
        self._header = header

    def _fetch(self, offset: int, length: int) -> bytes:
        data = self._read(self.url, offset, length)
        if len(data) != length:
            raise PMTilesUnavailable("the archive ended before the expected bytes")
        return data

    def tile(self, z: int, x: int, y: int) -> bytes | None:
        """The bytes of one tile, decompressed when the archive gzips them; None when absent."""
        header = self.header
        if not header["min_zoom"] <= z <= header["max_zoom"]:
            return None
        tile_id = zxy_to_tileid(z, x, y)
        entry = _find(self._root, self._root_ids, tile_id)
        if entry is not None and entry.run_length == 0:
            entry = self._leaf_entry(header, entry, tile_id)
        if entry is None:
            return None
        raw = self._fetch(header["data_offset"] + entry.offset, entry.length)
        return _decompress(raw, header["tile_compression"])

    def _leaf_entry(self, header: dict[str, Any], leaf: Entry, tile_id: int) -> Entry | None:
        entries, ids = self._leaf(header, leaf)
        found = _find(entries, ids, tile_id)
        if found is not None and found.run_length == 0:
            raise ValueError("leaf directories nest deeper than the format allows")
        return found

    def _leaf(self, header: dict[str, Any], leaf: Entry) -> tuple[list[Entry], list[int]]:
        key = (leaf.offset, leaf.length)
        with self._cache_lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        offset = header["leaf_offset"] + leaf.offset
        entries = _parse_directory(
            _decompress(self._fetch(offset, leaf.length), header["internal_compression"])
        )
        parsed = (entries, [entry.tile_id for entry in entries])
        with self._cache_lock:
            self._cache[key] = parsed
            self._cache.move_to_end(key)
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return parsed

    def metadata(self) -> dict[str, Any]:
        """The archive's JSON metadata."""
        header = self.header
        raw = self._fetch(header["metadata_offset"], header["metadata_length"])
        try:
            value = json.loads(_decompress(raw, header["internal_compression"]))
        except (ValueError, UnicodeDecodeError) as exc:
            raise ValueError("the archive's metadata is not JSON") from exc
        if not isinstance(value, dict):
            raise ValueError("the archive's metadata is not a JSON object")
        return value


def _parse_header(head: bytes) -> dict[str, Any]:
    (
        magic, version, root_offset, root_length, metadata_offset, metadata_length,
        leaf_offset, leaf_length, data_offset, data_length,
        addressed, entries, contents,
        clustered, internal, tile_compression, tile_type, min_zoom, max_zoom,
        min_lon, min_lat, max_lon, max_lat, center_zoom, center_lon, center_lat,
    ) = struct.unpack_from("<7sB11Q4B2B4iB2i", head)
    if magic != MAGIC or version != VERSION:
        raise ValueError("not a PMTiles v3 archive")
    return {
        "version": version,
        "root_offset": root_offset,
        "root_length": root_length,
        "metadata_offset": metadata_offset,
        "metadata_length": metadata_length,
        "leaf_offset": leaf_offset,
        "leaf_length": leaf_length,
        "data_offset": data_offset,
        "data_length": data_length,
        "addressed_tiles": addressed,
        "tile_entries": entries,
        "tile_contents": contents,
        "clustered": bool(clustered),
        "internal_compression": internal,
        "tile_compression": tile_compression,
        "tile_type": TILE_TYPES.get(tile_type, "unknown"),
        "min_zoom": min_zoom,
        "max_zoom": max_zoom,
        # the spec stores positions as int32 in tenths of a microdegree
        "bounds": (min_lon / 1e7, min_lat / 1e7, max_lon / 1e7, max_lat / 1e7),
        "center_zoom": center_zoom,
        "center": (center_lon / 1e7, center_lat / 1e7),
    }
