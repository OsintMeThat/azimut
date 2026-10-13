"""PMTiles v3 reading: the header, the Hilbert ids, the directories, the leaf cache, the failures.

The archives are written here by a small writer, so no test needs a file from
the network. Reads are served from the bytes by a fake that counts its calls.
"""

from __future__ import annotations

import gzip
import json
import struct

import httpx
import pytest

from azimut.engine import pmtiles, tiles
from azimut.engine.pmtiles import Archive, PMTilesUnavailable, zxy_to_tileid

URL = "https://example.test/archive.pmtiles"

WORLD = b"world tile bytes"
WATER = b"water tile bytes"
LAND = b"land tile bytes"
LEAF_A = b"leaf tile a"
LEAF_B = b"leaf tile b"

# Tile id 0 is the world, ids 1 to 3 are one run of water, id 4 is land. Every
# zoom 2 tile sits in a leaf directory. (2, 3, 3) reuses the world's bytes, so its
# entry points at an earlier offset than the one before it: the explicit encoding.
TILE_MAP = {
    (0, 0, 0): WORLD,
    (1, 0, 0): WATER,
    (1, 0, 1): WATER,
    (1, 1, 1): WATER,
    (1, 1, 0): LAND,
    (2, 0, 0): LEAF_A,
    (2, 1, 0): LEAF_B,
    (2, 3, 3): WORLD,
}
ABSENT_IN_LEAF = (2, 2, 2)


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


def _compress(data: bytes, compression: int) -> bytes:
    """Gzip for 2; anything else is stored as given (a brotli test only claims brotli)."""
    if compression == 2:
        return gzip.compress(data, mtime=0)
    return data


def _directory(entries: list[tuple[int, int, int, int]], compression: int) -> bytes:
    """(tile_id, run_length, offset, length) entries, encoded as the spec's directory."""
    out = bytearray(_varint(len(entries)))
    last = 0
    for tile_id, _run, _offset, _length in entries:
        out += _varint(tile_id - last)
        last = tile_id
    for _tile_id, run, _offset, _length in entries:
        out += _varint(run)
    for _tile_id, _run, _offset, length in entries:
        out += _varint(length)
    for i, (_tile_id, _run, offset, _length) in enumerate(entries):
        follows = i > 0 and offset == entries[i - 1][2] + entries[i - 1][3]
        out += _varint(0 if follows else offset + 1)
    return _compress(bytes(out), compression)


def build_archive(
    tile_map: dict[tuple[int, int, int], bytes],
    *,
    leaf_from: int = 5,
    internal: int = 2,
    tile_compression: int = 2,
    tile_type: int = 1,
    min_zoom: int = 0,
    max_zoom: int = 2,
    metadata: object = None,
) -> bytes:
    """A PMTiles v3 archive: header, root, metadata, one leaf, then the tile data.

    Tiles with an id from `leaf_from` on go into one leaf directory, the rest into
    the root, which gets one pointer (run length 0) to the leaf. A payload shared by
    several tiles is stored once. Consecutive ids with one payload become one run.
    """
    placed: dict[bytes, tuple[int, int]] = {}
    data = bytearray()
    sorted_tiles = sorted((zxy_to_tileid(*key), payload) for key, payload in tile_map.items())
    runs: list[list] = []
    for tile_id, payload in sorted_tiles:
        if runs and runs[-1][2] == payload and runs[-1][0] + runs[-1][1] == tile_id:
            runs[-1][1] += 1
        else:
            runs.append([tile_id, 1, payload])
    entries: list[tuple[int, int, int, int]] = []
    for tile_id, run, payload in runs:
        if payload not in placed:
            stored = _compress(payload, tile_compression)
            placed[payload] = (len(data), len(stored))
            data += stored
        offset, length = placed[payload]
        entries.append((tile_id, run, offset, length))
    root_entries = [entry for entry in entries if entry[0] < leaf_from]
    leaf_entries = [entry for entry in entries if entry[0] >= leaf_from]

    leaf = _directory(leaf_entries, internal)
    root = _directory(
        root_entries + [(leaf_entries[0][0], 0, 0, len(leaf))], internal,
    )
    if metadata is None:
        metadata = {"name": "fixture"}
    raw_meta = metadata if isinstance(metadata, bytes) else json.dumps(metadata).encode()
    meta = _compress(raw_meta, internal)

    root_offset = pmtiles.HEADER_LENGTH
    metadata_offset = root_offset + len(root)
    leaf_offset = metadata_offset + len(meta)
    data_offset = leaf_offset + len(leaf)
    header = struct.pack(
        "<7sB11Q4B2B4iB2i",
        b"PMTiles", 3,
        root_offset, len(root),
        metadata_offset, len(meta),
        leaf_offset, len(leaf),
        data_offset, len(data),
        len(tile_map), len(entries), len(placed),
        1, internal, tile_compression, tile_type,
        min_zoom, max_zoom,
        48_000_000, 520_000_000, 49_000_000, 530_000_000,
        1, 48_922_000, 523_731_000,
    )
    assert len(header) == pmtiles.HEADER_LENGTH
    return header + root + meta + leaf + bytes(data)


class FakeHost:
    """Serves byte ranges of one archive and counts every call."""

    def __init__(self, data: bytes) -> None:
        self.data = data
        self.calls: list[tuple[int, int]] = []

    def __call__(self, url: str, offset: int, length: int) -> bytes:
        assert url == URL
        self.calls.append((offset, length))
        return self.data[offset:offset + length]


def _archive(**kwargs) -> tuple[Archive, FakeHost]:
    host = FakeHost(build_archive(TILE_MAP, **kwargs))
    return Archive(URL, read=host), host


# -- Hilbert ids ---------------------------------------------------------------

@pytest.mark.parametrize(
    ("z", "x", "y", "tile_id"),
    [
        (0, 0, 0, 0),
        (1, 0, 0, 1),
        (1, 0, 1, 2),
        (1, 1, 1, 3),
        (1, 1, 0, 4),
        (2, 0, 0, 5),
        # from the spec's own table of examples
        (12, 3423, 1763, 19078479),
    ],
)
def test_zxy_to_tileid_matches_the_spec(z, x, y, tile_id):
    assert zxy_to_tileid(z, x, y) == tile_id


@pytest.mark.parametrize("z", [0, 1, 2, 3])
def test_hilbert_ids_cover_each_zoom_once_and_walk_neighbours(z):
    count = 1 << z
    first = sum(4 ** t for t in range(z))
    cells = {zxy_to_tileid(z, x, y): (x, y) for x in range(count) for y in range(count)}
    assert sorted(cells) == list(range(first, first + count * count))
    for tile_id in range(first, first + count * count - 1):
        (x0, y0), (x1, y1) = cells[tile_id], cells[tile_id + 1]
        assert abs(x0 - x1) + abs(y0 - y1) == 1


def test_zxy_to_tileid_rejects_a_tile_off_the_grid():
    with pytest.raises(ValueError):
        zxy_to_tileid(2, 4, 0)
    with pytest.raises(ValueError):
        zxy_to_tileid(-1, 0, 0)


# -- the header -----------------------------------------------------------------

def test_header_fields_are_parsed():
    archive, _host = _archive()
    header = archive.header
    assert header["version"] == 3
    assert header["clustered"] is True
    assert header["internal_compression"] == 2
    assert header["tile_compression"] == 2
    assert header["tile_type"] == "mvt"
    assert (header["min_zoom"], header["max_zoom"]) == (0, 2)
    assert header["addressed_tiles"] == len(TILE_MAP)
    # five distinct payloads are stored: the world is stored once for its two tiles
    assert header["tile_contents"] == 5
    assert header["bounds"] == pytest.approx((4.8, 52.0, 4.9, 53.0))
    assert header["center_zoom"] == 1
    assert header["center"] == pytest.approx((4.8922, 52.3731))
    assert header["root_offset"] == pmtiles.HEADER_LENGTH
    assert header["data_offset"] > header["leaf_offset"] > header["metadata_offset"]


def test_a_bad_magic_is_a_value_error():
    host = FakeHost(b"NotPMTiles" + bytes(200))
    with pytest.raises(ValueError, match="PMTiles v3"):
        Archive(URL, read=host).header


def test_a_brotli_or_zstd_internal_compression_is_a_value_error():
    for compression in (3, 4):
        archive, _host = _archive(internal=compression)
        with pytest.raises(ValueError, match="compression is not supported"):
            archive.tile(0, 0, 0)


def test_constructing_an_archive_reads_nothing():
    archive, host = _archive()
    assert host.calls == []
    assert archive.url == URL


# -- tiles ----------------------------------------------------------------------

def test_the_first_tile_costs_the_header_read_and_its_own_bytes():
    archive, host = _archive()
    assert archive.tile(0, 0, 0) == WORLD
    # the header and the root directory come in one request of 16 KiB
    assert host.calls[0] == (0, pmtiles.FIRST_READ)
    assert len(host.calls) == 2
    assert all(offset != 0 for offset, _length in host.calls[1:])


def test_a_tile_in_a_run_returns_the_run_bytes():
    archive, _host = _archive()
    assert archive.tile(1, 0, 1) == WATER
    assert archive.tile(1, 1, 1) == WATER
    assert archive.tile(1, 1, 0) == LAND


def test_a_tile_through_a_leaf_returns_its_bytes():
    archive, _host = _archive()
    assert archive.tile(2, 0, 0) == LEAF_A
    assert archive.tile(2, 1, 0) == LEAF_B


def test_a_leaf_entry_with_an_earlier_offset_returns_its_bytes():
    archive, _host = _archive()
    assert archive.tile(2, 3, 3) == WORLD


def test_an_absent_tile_inside_a_leaf_is_none():
    archive, _host = _archive()
    assert archive.tile(2, *ABSENT_IN_LEAF[1:]) is None


def test_a_tile_outside_the_zoom_range_is_none_without_a_tile_read():
    archive, host = _archive(min_zoom=0, max_zoom=2)
    assert archive.tile(3, 0, 0) is None
    # only the header read: the zoom range is in it, and no tile bytes are asked for
    assert host.calls == [(0, pmtiles.FIRST_READ)]


def test_tiles_are_stored_uncompressed_when_the_archive_says_so():
    archive, _host = _archive(tile_compression=1, internal=1)
    assert archive.tile(0, 0, 0) == WORLD
    assert archive.tile(2, 0, 0) == LEAF_A


def test_a_brotli_or_zstd_tile_compression_is_a_value_error():
    for compression in (3, 4):
        archive, _host = _archive(tile_compression=compression)
        with pytest.raises(ValueError, match="compression is not supported"):
            archive.tile(0, 0, 0)


# -- the leaf cache --------------------------------------------------------------

def test_a_second_tile_in_the_same_leaf_does_not_read_the_leaf_again():
    archive, host = _archive()
    leaf_offset = archive.header["leaf_offset"]
    leaf_length = archive.header["leaf_length"]
    assert archive.tile(2, 0, 0) == LEAF_A
    assert archive.tile(2, 1, 0) == LEAF_B
    leaf_reads = [call for call in host.calls if call[0] == leaf_offset]
    assert leaf_reads == [(leaf_offset, leaf_length)]


def test_a_zero_sized_leaf_cache_reads_the_leaf_every_time():
    host = FakeHost(build_archive(TILE_MAP))
    archive = Archive(URL, read=host, cache_size=0)
    leaf_offset = archive.header["leaf_offset"]
    assert archive.tile(2, 0, 0) == LEAF_A
    assert archive.tile(2, 1, 0) == LEAF_B
    assert len([call for call in host.calls if call[0] == leaf_offset]) == 2
    assert len(archive._cache) == 0


# -- metadata -------------------------------------------------------------------

def test_metadata_is_the_archive_json():
    metadata = {"name": "3D BAG", "vector_layers": [{"id": "building"}]}
    host = FakeHost(build_archive(TILE_MAP, metadata=metadata))
    assert Archive(URL, read=host).metadata() == metadata


def test_metadata_that_is_not_json_is_a_value_error():
    host = FakeHost(build_archive(TILE_MAP, metadata=b"[1, 2"))
    with pytest.raises(ValueError, match="not JSON"):
        Archive(URL, read=host).metadata()


def test_metadata_that_is_not_an_object_is_a_value_error():
    host = FakeHost(build_archive(TILE_MAP, metadata=[1, 2]))
    with pytest.raises(ValueError, match="not a JSON object"):
        Archive(URL, read=host).metadata()


# -- the network ---------------------------------------------------------------

class _Response:
    def __init__(self, status_code: int, content: bytes = b"") -> None:
        self.status_code = status_code
        self.content = content


class _Client:
    """A stand-in for the shared httpx client: answers each GET from a script."""

    def __init__(self, answers: list) -> None:
        self.answers = answers
        self.requests: list[dict] = []

    def get(self, url, headers=None):
        self.requests.append({"url": url, "headers": headers})
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def _use_client(monkeypatch, client: _Client) -> None:
    monkeypatch.setattr(pmtiles, "_client", lambda: client)
    monkeypatch.setattr(pmtiles.tiles, "RETRY_PAUSE", 0)


def test_the_default_reader_sends_a_range_request(monkeypatch):
    data = build_archive(TILE_MAP)
    client = _Client([_Response(206, data[:pmtiles.FIRST_READ])])
    _use_client(monkeypatch, client)
    archive = Archive(URL)
    assert archive.header["version"] == 3
    assert client.requests[0]["headers"] == {"Range": f"bytes=0-{pmtiles.FIRST_READ - 1}"}


def test_a_server_that_ignores_range_is_sliced(monkeypatch):
    data = build_archive(TILE_MAP)
    client = _Client([_Response(200, data)])
    _use_client(monkeypatch, client)
    assert Archive(URL).header["version"] == 3


def test_a_transient_status_is_asked_again(monkeypatch):
    data = build_archive(TILE_MAP)
    client = _Client([_Response(503), _Response(206, data[:pmtiles.FIRST_READ])])
    _use_client(monkeypatch, client)
    assert Archive(URL).header["version"] == 3
    assert len(client.requests) == 2


def test_a_missing_archive_is_unavailable(monkeypatch):
    client = _Client([_Response(404)])
    _use_client(monkeypatch, client)
    with pytest.raises(PMTilesUnavailable, match="404"):
        Archive(URL).header


def test_a_network_failure_is_unavailable_and_keeps_the_address_out(monkeypatch):
    error = httpx.ConnectError(f"cannot reach {URL}")
    client = _Client([error] * tiles.MAX_TILE_TRIES)
    _use_client(monkeypatch, client)
    with pytest.raises(PMTilesUnavailable) as caught:
        Archive(URL).header
    assert "could not be reached" in str(caught.value)
    assert URL not in str(caught.value)


def test_an_archive_shorter_than_a_header_is_a_value_error():
    archive = Archive(URL, read=lambda url, offset, length: b"PMTiles")
    with pytest.raises(ValueError, match="shorter than a PMTiles header"):
        archive.header


def test_a_read_that_comes_back_short_is_unavailable():
    data = build_archive(TILE_MAP)

    def clipped(url: str, offset: int, length: int) -> bytes:
        return data[offset:offset + length][:-1]  # every read one byte short

    with pytest.raises(PMTilesUnavailable, match="ended before"):
        Archive(URL, read=clipped).tile(0, 0, 0)


def test_the_shared_client_carries_the_app_user_agent():
    assert pmtiles._client().headers["User-Agent"] == tiles.USER_AGENT
