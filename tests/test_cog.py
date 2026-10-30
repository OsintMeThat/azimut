"""The tiled GeoTIFF reader, checked against files this module writes itself.

The writer below is the smallest one that makes the layouts the reader must
handle: tiles, planar or chunky samples, deflate or none, the horizontal and the
floating-point predictors, little- or big-endian, classic or BigTIFF. Each file
is written in memory, so no test touches the disk except the one that opens a
local file.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

import numpy as np
import pytest

from azimut.engine.cog import GeoTiff, _lzw_decode

TILE = 16
ORIGIN_X, ORIGIN_Y = 547664.0, 7262632.0
NAMES = ["building_presence", "building_height", "confidence"]

SHORT, LONG, ASCII, DOUBLE, LONG8 = 3, 4, 2, 12, 16
SAMPLE_FORMAT = {"u": 1, "i": 2, "f": 3}


# -- a small TIFF writer ---------------------------------------------------------------


def lzw_encode(data: bytes) -> bytes:
    """TIFF LZW with the early change, the mirror of what the reader decodes."""
    table = {bytes((i,)): i for i in range(256)}
    codes: list[tuple[int, int]] = [(256, 9)]
    width, next_code = 9, 258
    word = b""
    for byte in data:
        candidate = word + bytes((byte,))
        if candidate in table:
            word = candidate
            continue
        codes.append((table[word], width))
        table[candidate] = next_code
        next_code += 1
        if next_code >= 1 << width and width < 12:
            width += 1
        if next_code >= 4094:  # the table is full: clear it and start again
            codes.append((256, width))
            table = {bytes((i,)): i for i in range(256)}
            width, next_code = 9, 258
        word = bytes((byte,))
    if word:
        codes.append((table[word], width))
    if next_code + 1 >= 1 << width and width < 12:
        width += 1
    codes.append((257, width))
    return _pack_codes(codes)


def _pack_codes(codes: list[tuple[int, int]]) -> bytes:
    acc = 0
    have = 0
    out = bytearray()
    for code, width in codes:
        acc = (acc << width) | code
        have += width
        while have >= 8:
            have -= 8
            out.append((acc >> have) & 0xFF)
        acc &= (1 << have) - 1
    if have:
        out.append((acc << (8 - have)) & 0xFF)
    return bytes(out)


def _encode_tile(tile: np.ndarray, predictor: int, endian: str) -> bytes:
    """One tile, (rows, columns, samples), as the writer lays it on disk."""
    rows, cols, nch = tile.shape
    dtype = tile.dtype.newbyteorder(endian)
    if predictor == 2:
        diff = tile.copy()
        diff[:, 1:, :] = tile[:, 1:, :] - tile[:, :-1, :]  # wraps in the sample type
        return diff.astype(dtype).tobytes()
    if predictor == 3:
        size = tile.dtype.itemsize
        samples = tile.reshape(rows, cols * nch).astype(dtype)
        cut = samples.view(np.uint8).reshape(rows, cols * nch, size)
        # Most significant byte of every sample first, then the next plane, and so on.
        msb_first = cut if endian == ">" else cut[:, :, ::-1]
        planes = msb_first.transpose(0, 2, 1).reshape(rows, cols * nch * size)
        diff = planes.copy()
        diff[:, nch:] = planes[:, nch:] - planes[:, :-nch]  # difference, `nch` bytes back
        return diff.tobytes()
    return tile.astype(dtype).tobytes()


def _compress(raw: bytes, compression: int) -> bytes:
    if compression == 8:
        return zlib.compress(raw)
    if compression == 5:
        return lzw_encode(raw)
    return raw


def _values(typ: int, values: object, endian: str) -> bytes:
    if typ == ASCII:
        return str(values).encode("ascii") + b"\0"
    code = {SHORT: "H", LONG: "I", LONG8: "Q", DOUBLE: "d"}[typ]
    items = list(values)  # type: ignore[call-overload]
    return struct.pack(f"{endian}{len(items)}{code}", *items)


def write_tiff(
    data: np.ndarray,
    *,
    planar: int = 2,
    predictor: int = 1,
    compression: int = 8,
    endian: str = "<",
    big: bool = False,
    names: list[str] | None = None,
    nodata: float | None = -99.0,
    strips: bool = False,
    epsg: int = 32723,
) -> bytes:
    """A tiled GeoTIFF of `data` (bands, height, width), in memory."""
    bands, height, width = data.shape
    across, down = -(-width // TILE), -(-height // TILE)
    padded = np.zeros((bands, down * TILE, across * TILE), dtype=data.dtype)
    padded[:, :height, :width] = data

    # Planar: one run of tiles per band. Chunky: every band in each tile.
    planes = [padded[b : b + 1] for b in range(bands)] if planar == 2 else [padded]
    blocks = [
        plane[:, ty * TILE : (ty + 1) * TILE, tx * TILE : (tx + 1) * TILE].transpose(1, 2, 0)
        for plane in planes
        for ty in range(down)
        for tx in range(across)
    ]
    blobs = [_compress(_encode_tile(block, predictor, endian), compression) for block in blocks]

    out = bytearray(b"II" if endian == "<" else b"MM")
    if big:
        out += struct.pack(endian + "HHHQ", 43, 8, 0, 0)
    else:
        out += struct.pack(endian + "HI", 42, 0)
    offsets, counts = [], []
    for blob in blobs:
        offsets.append(len(out))
        counts.append(len(blob))
        out += blob

    offset_type = LONG8 if big else LONG
    entries: list[tuple[int, int, object]] = [
        (256, LONG, [width]),
        (257, LONG, [height]),
        (258, SHORT, [data.dtype.itemsize * 8] * bands),
        (259, SHORT, [compression]),
        (277, SHORT, [bands]),
        (284, SHORT, [planar]),
        (317, SHORT, [predictor]),
        (339, SHORT, [SAMPLE_FORMAT[data.dtype.kind]] * bands),
        (33550, DOUBLE, [0.5, 0.5, 0.0]),
        (33922, DOUBLE, [0.0, 0.0, 0.0, ORIGIN_X, ORIGIN_Y, 0.0]),
        (34735, SHORT, [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, epsg]),
    ]
    if names:
        items = "".join(
            f'<Item name="DESCRIPTION" sample="{i}" role="description">{name}</Item>'
            for i, name in enumerate(names)
        )
        entries.append((42112, ASCII, f"<GDALMetadata>{items}</GDALMetadata>"))
    if nodata is not None:
        entries.append((42113, ASCII, f"{nodata:g}"))
    if strips:
        entries += [(273, offset_type, offsets), (279, offset_type, counts)]
    else:
        entries += [
            (322, LONG, [TILE]),
            (323, LONG, [TILE]),
            (324, offset_type, offsets),
            (325, offset_type, counts),
        ]

    inline = 8 if big else 4
    fields = bytearray()
    for tag, typ, values in sorted(entries, key=lambda entry: entry[0]):
        raw = _values(typ, values, endian)
        count = len(raw) if typ == ASCII else len(list(values))  # type: ignore[call-overload]
        if len(raw) <= inline:
            field = raw.ljust(inline, b"\0")
        else:
            if len(out) % 2:
                out += b"\0"
            where = len(out)
            out += raw
            field = struct.pack(endian + ("Q" if big else "I"), where)
        fields += struct.pack(endian + ("HHQ" if big else "HHI"), tag, typ, count) + field

    if len(out) % 2:
        out += b"\0"
    ifd = len(out)
    out += struct.pack(endian + ("Q" if big else "H"), len(entries)) + fields
    out += struct.pack(endian + ("Q" if big else "I"), 0)
    if big:
        struct.pack_into(endian + "Q", out, 8, ifd)
    else:
        struct.pack_into(endian + "I", out, 4, ifd)
    return bytes(out)


class CountingReader:
    """A reader over bytes in memory that remembers every request it was asked for."""

    def __init__(self, blob: bytes) -> None:
        self.blob = blob
        self.requests: list[tuple[int, int]] = []

    def __call__(self, offset: int, length: int) -> bytes:
        self.requests.append((offset, length))
        return self.blob[offset : offset + length]


def samples(bands: int, height: int, width: int, dtype: str, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    if np.dtype(dtype).kind == "f":
        return rng.normal(0.0, 50.0, (bands, height, width)).astype(dtype)
    info = np.iinfo(dtype)
    return rng.integers(info.min, info.max, (bands, height, width), endpoint=True, dtype=dtype)


# -- the tags, and the windows, of the case the sample file is -------------------------


def test_float_planar_deflate_predictor3_reads_its_tags_and_windows():
    data = samples(3, 32, 32, "float32")
    blob = write_tiff(data, names=NAMES, predictor=3)

    tiff = GeoTiff(CountingReader(blob))

    assert (tiff.width, tiff.height, tiff.bands) == (32, 32, 3)
    assert tiff.dtype == np.float32
    assert tiff.tile_size == (16, 16)
    assert tiff.nodata == -99.0
    assert tiff.epsg == 32723
    assert tiff.transform == (ORIGIN_X, 0.5, ORIGIN_Y, -0.5)
    assert tiff.band_names == NAMES
    for band in range(3):
        np.testing.assert_array_equal(tiff.window(band, 0, 0, 32, 32), data[band])
        # A window that crosses the tile edges at 16 and 32 px.
        np.testing.assert_array_equal(tiff.window(band, 10, 12, 22, 20), data[band, 12:20, 10:22])


def test_window_partly_outside_the_image_is_nodata():
    data = samples(1, 32, 32, "float32")
    tiff = GeoTiff(CountingReader(write_tiff(data, predictor=3)))

    out = tiff.window(0, -4, -3, 36, 34)

    assert out.shape == (37, 40)
    np.testing.assert_array_equal(out[3:35, 4:36], data[0])
    outside = np.ones(out.shape, dtype=bool)
    outside[3:35, 4:36] = False
    assert np.all(out[outside] == -99.0)


def test_float_without_nodata_fills_outside_with_nan():
    data = samples(1, 20, 20, "float32")
    tiff = GeoTiff(CountingReader(write_tiff(data, predictor=3, nodata=None)))

    out = tiff.window(0, -2, 0, 4, 2)

    assert tiff.nodata is None
    assert np.isnan(out[:, :2]).all()
    np.testing.assert_array_equal(out[:, 2:], data[0, 0:2, 0:4])


def test_chunky_uint8_with_horizontal_predictor_and_no_band_names():
    data = samples(3, 20, 25, "uint8")
    tiff = GeoTiff(CountingReader(write_tiff(data, planar=1, predictor=2)))

    assert tiff.dtype == np.uint8
    assert tiff.band_names == []
    for band in range(3):
        np.testing.assert_array_equal(tiff.window(band, 0, 0, 25, 20), data[band])
        np.testing.assert_array_equal(tiff.window(band, 9, 15, 20, 19), data[band, 15:19, 9:20])


def test_bigtiff_reads_the_same_windows():
    data = samples(3, 32, 32, "float32")
    tiff = GeoTiff(CountingReader(write_tiff(data, predictor=3, big=True, names=NAMES)))

    assert tiff.band_names == NAMES
    assert tiff.transform == (ORIGIN_X, 0.5, ORIGIN_Y, -0.5)
    np.testing.assert_array_equal(tiff.window(2, 0, 0, 32, 32), data[2])


@pytest.mark.parametrize(("dtype", "predictor"), [("u2", 2), ("f4", 3)])
def test_big_endian_reads_the_same_windows(dtype, predictor):
    data = samples(2, 25, 37, dtype)
    tiff = GeoTiff(CountingReader(write_tiff(data, endian=">", predictor=predictor)))

    for band in range(2):
        np.testing.assert_array_equal(tiff.window(band, 0, 0, 37, 25), data[band])


@pytest.mark.parametrize(
    ("dtype", "predictor"),
    [("u1", 2), ("u2", 2), ("i2", 2), ("i4", 2), ("f4", 3), ("f8", 3), ("u1", 1), ("f4", 1)],
)
@pytest.mark.parametrize("planar", [1, 2])
@pytest.mark.parametrize("compression", [1, 8, 5])
def test_every_layout_round_trips(dtype, predictor, planar, compression):
    data = samples(3, 25, 37, dtype)  # edge tiles are part tiles
    blob = write_tiff(data, planar=planar, predictor=predictor, compression=compression)

    tiff = GeoTiff(CountingReader(blob))

    assert tiff.dtype == np.dtype(dtype)
    for band in range(3):
        np.testing.assert_array_equal(tiff.window(band, 0, 0, 37, 25), data[band])
        np.testing.assert_array_equal(tiff.window(band, 10, 12, 22, 20), data[band, 12:20, 10:22])


def test_a_window_reads_only_the_tiles_it_overlaps():
    data = samples(3, 64, 64, "float32")
    reader = CountingReader(write_tiff(data, predictor=3))
    tiff = GeoTiff(reader)
    reader.requests.clear()

    # One tile of one band: a single read of that tile's bytes.
    tiff.window(1, 0, 0, 8, 8)

    assert len(reader.requests) == 1


def test_the_parsed_ifd_and_recent_tiles_are_not_read_again():
    data = samples(1, 128, 128, "u1")
    reader = CountingReader(write_tiff(data, planar=1, predictor=1, compression=1))
    tiff = GeoTiff(reader)

    # 64 tiles, and the cache keeps 32: the last one read is still there, the first is not.
    tiff.window(0, 0, 0, 128, 128)
    reader.requests.clear()
    tiff.window(0, 112, 112, 128, 128)
    assert reader.requests == []

    tiff.window(0, 0, 0, 16, 16)
    assert len(reader.requests) == 1


def test_open_reads_a_local_file(tmp_path: Path):
    data = samples(3, 32, 32, "float32")
    path = tmp_path / "tile.tif"
    path.write_bytes(write_tiff(data, predictor=3))

    tiff = GeoTiff.open(path)

    np.testing.assert_array_equal(tiff.window(2, 5, 5, 30, 30), data[2, 5:30, 5:30])


def test_a_band_outside_the_image_is_refused():
    tiff = GeoTiff(CountingReader(write_tiff(samples(3, 16, 16, "u1"), predictor=2)))

    with pytest.raises(ValueError, match="band 3"):
        tiff.window(3, 0, 0, 4, 4)


# -- what the reader refuses ------------------------------------------------------------


def test_strips_are_refused_with_a_clear_message():
    blob = write_tiff(samples(1, 32, 32, "float32"), predictor=3, strips=True)

    with pytest.raises(ValueError, match="strips"):
        GeoTiff(CountingReader(blob))


def test_an_unknown_compression_is_refused():
    blob = write_tiff(samples(1, 32, 32, "float32"), predictor=3, compression=7)

    with pytest.raises(ValueError, match="compression 7"):
        GeoTiff(CountingReader(blob))


def test_the_floating_point_predictor_needs_floats():
    blob = write_tiff(samples(1, 16, 16, "u1"), predictor=3)

    with pytest.raises(ValueError, match="floating-point predictor"):
        GeoTiff(CountingReader(blob))


def test_the_horizontal_predictor_needs_integers():
    blob = write_tiff(samples(1, 16, 16, "f4"), predictor=2)

    with pytest.raises(ValueError, match="horizontal predictor"):
        GeoTiff(CountingReader(blob))


def test_a_file_that_is_not_tiff_is_refused():
    with pytest.raises(ValueError, match="not a TIFF"):
        GeoTiff(CountingReader(b"PK\x03\x04" + b"\0" * 32))


# -- LZW -------------------------------------------------------------------------------


def test_lzw_decodes_the_tiff_spec_example():
    # "-----A---B" as TIFF 6.0 codes it: clear, 45, 258, 258, 65, 259, 66, end.
    codes = [(256, 9), (45, 9), (258, 9), (258, 9), (65, 9), (259, 9), (66, 9), (257, 9)]

    assert _lzw_decode(_pack_codes(codes)) == b"-----A---B"


def test_lzw_round_trip_crosses_the_10_and_11_bit_widths():
    rng = np.random.default_rng(3)
    data = bytes(rng.integers(0, 4, 6000, dtype=np.uint8))  # 4 symbols: long code table

    assert _lzw_decode(lzw_encode(data)) == data


def test_neighbouring_tiles_are_read_in_one_request():
    """Over HTTP each request costs a round trip: a window's tiles, side by side in the
    file, come in one."""
    data = samples(1, 128, 128, "u1")
    reader = CountingReader(write_tiff(data, planar=1, predictor=1, compression=8))
    tiff = GeoTiff(reader)
    reader.requests.clear()
    np.testing.assert_array_equal(tiff.window(0, 0, 0, 128, 128), data[0])
    assert len(reader.requests) == 1


def test_the_header_and_its_directories_are_read_in_a_block_or_two():
    """The directories are parsed a few bytes at a time; over HTTP each would be a round trip."""
    data = samples(3, 128, 128, "float32")
    reader = CountingReader(write_tiff(data, predictor=3))
    GeoTiff(reader, pixel=1.0)
    assert len(reader.requests) <= 2
