"""A tiled GeoTIFF, read a window at a time, for rasters too big to load whole.

Google's Open Buildings 2.5D Temporal rasters are the reason it exists: one
25 000 px tile of float32 bands, each band a plane of 512 px tiles, deflated
with the floating-point predictor, and served from a bucket. Nothing here loads
the whole image. A caller asks for a window of one band and only the tiles that
overlap it are fetched (through `read`, which is a local file or an HTTP Range
request) and decoded, and the last few decoded tiles are kept, because a view
asks for neighbouring windows.

The full-resolution image is read unless a coarser pixel is asked for
(`pixel=`): then the coarsest overview (NewSubfileType 1) whose pixels are no
larger is read instead, georeferenced from the full image. A raster whose
detail is coarser than its pixels (Google's 2.5D, 4 m in 0.5 m pixels) is read
for a sixteenth of the bytes.
Anything this reader does not decode (strips, JPEG, other codecs) is refused with
a ValueError that says so, rather than read wrongly.
"""

from __future__ import annotations

import math
import struct
import threading
import xml.etree.ElementTree as ET
import zlib
from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

# Reads `length` bytes at `offset`: a local file, or one HTTP Range request.
Reader = Callable[[int, int], bytes]

# The TIFF tags this reader uses. Everything else in an IFD is ignored.
_NEW_SUBFILE_TYPE = 254
_IMAGE_WIDTH = 256
_IMAGE_LENGTH = 257
_BITS_PER_SAMPLE = 258
_COMPRESSION = 259
_SAMPLES_PER_PIXEL = 277
_PLANAR_CONFIG = 284
_TILE_WIDTH = 322
_TILE_LENGTH = 323
_TILE_OFFSETS = 324
_TILE_BYTE_COUNTS = 325
_STRIP_OFFSETS = 273
_SAMPLE_FORMAT = 339
_PREDICTOR = 317
_MODEL_PIXEL_SCALE = 33550
_MODEL_TIEPOINT = 33922
_GEO_KEYS = 34735
_GDAL_METADATA = 42112
_GDAL_NODATA = 42113

# GeoTIFF keys: the projected CRS (or, failing that, the geographic one) is an EPSG code.
_GEO_GEOGRAPHIC = 2048
_GEO_PROJECTED = 3072
_GEO_USER_DEFINED = 32767

_NONE, _LZW, _DEFLATE = 1, 5, 8
_DEFLATE_ADOBE = 32946
_SUPPORTED_COMPRESSION = (_NONE, _LZW, _DEFLATE, _DEFLATE_ADOBE)
_PREDICT_HORIZONTAL, _PREDICT_FLOAT = 2, 3
_SAMPLE_UINT, _SAMPLE_INT, _SAMPLE_FLOAT = 1, 2, 3

# TIFF field types: (struct code, size in bytes). ASCII is handled apart.
_ASCII = 2
_FIELD_TYPES: dict[int, tuple[str, int]] = {
    1: ("B", 1), 3: ("H", 2), 4: ("I", 4), 6: ("b", 1), 7: ("B", 1), 8: ("h", 2),
    9: ("i", 4), 11: ("f", 4), 12: ("d", 8), 16: ("Q", 8), 17: ("q", 8), 18: ("Q", 8),
}

# (sample format, bits per sample) to the native numpy type.
_DTYPES: dict[tuple[int, int], str] = {
    (_SAMPLE_UINT, 8): "u1", (_SAMPLE_UINT, 16): "u2",
    (_SAMPLE_INT, 16): "i2", (_SAMPLE_INT, 32): "i4",
    (_SAMPLE_FLOAT, 32): "f4", (_SAMPLE_FLOAT, 64): "f8",
}

# Decoded tiles kept in memory: a view asks for neighbouring windows, so a few
# tiles' worth is enough, and the cap keeps a 512 px float band near 1 MB a tile.
TILE_CACHE = 32
# Tiles closer than this in the file are read in one request, up to RUN_MAX bytes a request.
RUN_GAP = 256 << 10
RUN_MAX = 16 << 20
# The header and directories are read in blocks of this size.
HEADER_BLOCK = 64 << 10

# Lempel-Ziv-Welch: the code table stops growing here, as the TIFF spec says.
_LZW_MAX_CODES = 4096


class GeoTiff:
    """A tiled GeoTIFF whose full-resolution pixels are read one window at a time.

    The parsed IFD is kept, so the header and the tag tables are read once. The
    decoded tiles are kept in a small LRU, so a window that sits on tiles it just
    read costs no bytes.
    """

    def __init__(self, read: Reader, pixel: float | None = None) -> None:
        self._read = read
        # the header and the directories are read a few bytes at a time: from blocks, over HTTP
        read = _blocks(read)
        endian, big, first = _header(read)
        self._endian = endian
        full = _full_resolution_ifd(read, endian, big, first)
        tags, factor = full, 1
        if pixel is not None:
            tags, factor = _overview_for(read, endian, big, first, full, pixel)
        self._tags = tags
        if _TILE_WIDTH not in tags:
            raise ValueError("the GeoTIFF is stored in strips, not tiles; only tiled GeoTIFFs can be read")

        self.width = _int(tags, _IMAGE_WIDTH)
        self.height = _int(tags, _IMAGE_LENGTH)
        self.bands = _int(tags, _SAMPLES_PER_PIXEL, 1)
        self.tile_size = (_int(tags, _TILE_WIDTH), _int(tags, _TILE_LENGTH))
        tile_w, tile_h = self.tile_size
        if tile_w <= 0 or tile_h <= 0:
            raise ValueError("the GeoTIFF has an empty tile size")

        self._planar = _int(tags, _PLANAR_CONFIG, 1)
        if self._planar not in (1, 2):
            raise ValueError(f"planar configuration {self._planar} is not supported")
        self._compression = _int(tags, _COMPRESSION, _NONE)
        if self._compression not in _SUPPORTED_COMPRESSION:
            raise ValueError(
                f"compression {self._compression} is not supported (none, deflate and LZW only)"
            )
        self._predictor = _int(tags, _PREDICTOR, 1)
        if self._predictor not in (1, _PREDICT_HORIZONTAL, _PREDICT_FLOAT):
            raise ValueError(f"predictor {self._predictor} is not supported")

        self.dtype = _native_dtype(tags, self.bands)
        self._itemsize = self.dtype.itemsize
        self._file_dtype = np.dtype(f"{endian}{self.dtype.kind}{self._itemsize}")
        if self._predictor == _PREDICT_HORIZONTAL and self.dtype.kind not in "ui":
            raise ValueError("the horizontal predictor needs integer samples")
        if self._predictor == _PREDICT_FLOAT and self.dtype.kind != "f":
            raise ValueError("the floating-point predictor needs float samples")

        self.nodata = _nodata(tags) if _nodata(tags) is not None else _nodata(full)
        self._fill = _fill_value(self.dtype, self.nodata)
        self.epsg = _epsg(full)
        self.band_names = _band_names(full, self.bands)
        whole = _transform(full)
        # an overview's pixels cover `factor` of the full image's each way
        self._transform = None if whole is None else (whole[0], whole[1] * factor, whole[2], whole[3] * factor)

        # Tiles run left to right, then top to bottom. Planar images hold one run
        # of tiles per band, one after the other.
        self._across = -(-self.width // tile_w)
        self._down = -(-self.height // tile_h)
        self._per_plane = self._across * self._down
        count = self._per_plane * (self.bands if self._planar == 2 else 1)
        self._offsets = _tile_table(tags, _TILE_OFFSETS, count)
        self._counts = _tile_table(tags, _TILE_BYTE_COUNTS, count)

        self._cache: OrderedDict[int, np.ndarray] = OrderedDict()
        self._lock = threading.Lock()

    @classmethod
    def open(cls, path: Path, pixel: float | None = None) -> GeoTiff:
        """A local file. It is opened for each read and closed again, so nothing stays open."""
        path = Path(path)

        def read(offset: int, length: int) -> bytes:
            with path.open("rb") as handle:
                handle.seek(offset)
                return handle.read(length)

        return cls(read, pixel)

    @property
    def transform(self) -> tuple[float, float, float, float]:
        """(origin_x, pixel_x, origin_y, pixel_y) in the CRS; pixel_y is negative for north-up."""
        if self._transform is None:
            raise ValueError("the GeoTIFF has no ModelPixelScale and ModelTiepoint tags")
        return self._transform

    def window(self, band: int, x0: int, y0: int, x1: int, y1: int) -> np.ndarray:
        """The pixels [y0:y1, x0:x1] of one band (0 is the first band).

        Only the tiles that overlap the window are read. Pixels outside the image
        come back as the nodata value, or NaN for a float image with no nodata.
        """
        if not 0 <= band < self.bands:
            raise ValueError(f"band {band} is not in 0..{self.bands - 1}")
        if x1 < x0 or y1 < y0:
            raise ValueError("the window's far corner is before its near one")
        out = np.full((y1 - y0, x1 - x0), self._fill, dtype=self.dtype)

        ax0, ay0 = max(x0, 0), max(y0, 0)
        ax1, ay1 = min(x1, self.width), min(y1, self.height)
        if ax1 <= ax0 or ay1 <= ay0:
            return out
        tile_w, tile_h = self.tile_size
        rows = range(ay0 // tile_h, (ay1 - 1) // tile_h + 1)
        columns = range(ax0 // tile_w, (ax1 - 1) // tile_w + 1)
        fetched = self._prefetch([self._index(band, ty, tx) for ty in rows for tx in columns])
        for ty in rows:
            for tx in columns:
                tile = self._tile(band, ty, tx, fetched)
                if tile is None:
                    continue  # a tile the file leaves out keeps the fill value
                # The part of this tile that is both in the window and in the image.
                py0, py1 = max(ay0, ty * tile_h), min(ay1, (ty + 1) * tile_h)
                px0, px1 = max(ax0, tx * tile_w), min(ax1, (tx + 1) * tile_w)
                out[py0 - y0 : py1 - y0, px0 - x0 : px1 - x0] = tile[
                    py0 - ty * tile_h : py1 - ty * tile_h, px0 - tx * tile_w : px1 - tx * tile_w
                ]
        return out

    # -- tiles ----------------------------------------------------------------------

    def _index(self, band: int, ty: int, tx: int) -> int:
        index = ty * self._across + tx
        return index + band * self._per_plane if self._planar == 2 else index

    def _prefetch(self, indices: list[int]) -> dict[int, np.ndarray]:
        """Read the tiles a window needs that are not held yet, neighbours in the file in one
        request each: over HTTP a request costs more than the bytes between two tiles.
        Returns them by index; the cache keeps the most recent as usual."""
        with self._lock:
            wanted = sorted(
                (self._offsets[i], self._counts[i], i) for i in set(indices)
                if i not in self._cache and self._offsets[i] and self._counts[i]
            )
        runs: list[list[tuple[int, int, int]]] = []
        for entry in wanted:
            if runs and entry[0] - (runs[-1][-1][0] + runs[-1][-1][1]) <= RUN_GAP \
                    and entry[0] + entry[1] - runs[-1][0][0] <= RUN_MAX:
                runs[-1].append(entry)
            else:
                runs.append([entry])
        fetched = {}
        for run in runs:
            start = run[0][0]
            body = _read_exact(self._read, start, run[-1][0] + run[-1][1] - start)
            for offset, count, index in run:
                fetched[index] = decoded = self._decode_raw(body[offset - start:offset - start + count])
                with self._lock:
                    self._cache[index] = decoded
                    self._cache.move_to_end(index)
                    while len(self._cache) > TILE_CACHE:
                        self._cache.popitem(last=False)
        return fetched

    def _tile(self, band: int, ty: int, tx: int, fetched: dict[int, np.ndarray] | None = None) -> np.ndarray | None:
        """One band of one tile, as (rows, columns), or None when the file has no such tile."""
        index = self._index(band, ty, tx)
        decoded = fetched[index] if fetched and index in fetched else self._decoded(index)
        if decoded is None:
            return None
        return decoded if self._planar == 2 else decoded[..., band]

    def _decoded(self, index: int) -> np.ndarray | None:
        with self._lock:
            if index in self._cache:
                self._cache.move_to_end(index)
                return self._cache[index]
        if self._offsets[index] == 0 or self._counts[index] == 0:
            return None
        tile = self._decode_tile(index)
        with self._lock:
            self._cache[index] = tile
            self._cache.move_to_end(index)
            while len(self._cache) > TILE_CACHE:
                self._cache.popitem(last=False)
        return tile

    def _decode_tile(self, index: int) -> np.ndarray:
        """Read, decompress and un-predict one tile into native values."""
        return self._decode_raw(_read_exact(self._read, self._offsets[index], self._counts[index]))

    def _decode_raw(self, raw: bytes) -> np.ndarray:
        """Decompress and un-predict one tile's bytes into native values.

        A planar tile holds one band, shaped (rows, columns). A chunky tile holds
        every band, shaped (rows, columns, bands).
        """
        tile_w, tile_h = self.tile_size
        chunky = self._planar == 1
        samples_per_row = tile_w * (self.bands if chunky else 1)
        row_bytes = samples_per_row * self._itemsize
        data = _decompress(raw, self._compression, tile_h * row_bytes)

        rows = np.frombuffer(data, dtype=np.uint8, count=tile_h * row_bytes).reshape(tile_h, row_bytes)
        if self._predictor == _PREDICT_FLOAT:
            rows = _undo_float_predictor(
                rows,
                stride=self.bands if chunky else 1,
                bytes_per_sample=self._itemsize,
                little=self._endian == "<",
            )
        values = np.ascontiguousarray(rows).view(self._file_dtype)
        shape = (tile_h, tile_w, self.bands) if chunky else (tile_h, tile_w)
        out = values.reshape(shape).astype(self.dtype)
        if self._predictor == _PREDICT_HORIZONTAL:
            out = np.cumsum(out, axis=1, dtype=self.dtype)
        return out


# -- the header and the IFD ----------------------------------------------------------


def _blocks(read: Reader) -> Reader:
    """`read`, with small reads served from aligned blocks fetched once each."""
    held: dict[int, bytes] = {}

    def block(n: int) -> bytes:
        if n not in held:
            try:
                held[n] = read(n * HEADER_BLOCK, HEADER_BLOCK)
            except ValueError:
                held[n] = b""
        return held[n]

    def reading(offset: int, length: int) -> bytes:
        if length > HEADER_BLOCK:
            return read(offset, length)
        first, last = offset // HEADER_BLOCK, (offset + length - 1) // HEADER_BLOCK
        joined = b"".join(block(n) for n in range(first, last + 1))
        start = offset - first * HEADER_BLOCK
        body = joined[start:start + length]
        # a block cut short (the end of the file, or a server that will not say) is read as asked
        return body if len(body) == length else read(offset, length)

    return reading


def _read_exact(read: Reader, offset: int, length: int) -> bytes:
    data = bytes(read(offset, length))
    if len(data) != length:
        raise ValueError(f"the GeoTIFF ends early: wanted {length} bytes at {offset}, got {len(data)}")
    return data


def _header(read: Reader) -> tuple[str, bool, int]:
    """(struct byte order, BigTIFF?, offset of the first IFD)."""
    head = _read_exact(read, 0, 8)
    if head[:2] == b"II":
        endian = "<"
    elif head[:2] == b"MM":
        endian = ">"
    else:
        raise ValueError("not a TIFF file")
    (magic,) = struct.unpack_from(endian + "H", head, 2)
    if magic == 42:
        (first,) = struct.unpack_from(endian + "I", head, 4)
        return endian, False, first
    if magic == 43:
        head = _read_exact(read, 0, 16)
        offset_size, zero = struct.unpack_from(endian + "HH", head, 4)
        if offset_size != 8 or zero != 0:
            raise ValueError("not a BigTIFF file")
        (first,) = struct.unpack_from(endian + "Q", head, 8)
        return endian, True, first
    raise ValueError(f"not a TIFF file (magic {magic})")


def _read_ifd(read: Reader, endian: str, big: bool, offset: int) -> tuple[dict[int, Any], int]:
    """One IFD's tags (values decoded) and the offset of the next IFD, 0 for none."""
    count_size = 8 if big else 2
    entry_size = 20 if big else 12
    inline = 8 if big else 4
    offset_code = "Q" if big else "I"
    (n,) = struct.unpack(endian + ("Q" if big else "H"), _read_exact(read, offset, count_size))
    body = _read_exact(read, offset + count_size, n * entry_size + inline)
    (next_offset,) = struct.unpack_from(endian + offset_code, body, n * entry_size)

    tags: dict[int, Any] = {}
    for i in range(n):
        entry = body[i * entry_size : (i + 1) * entry_size]
        tag, typ = struct.unpack_from(endian + "HH", entry)
        if big:
            (count,) = struct.unpack_from(endian + "Q", entry, 4)
            field = entry[12:20]
        else:
            (count,) = struct.unpack_from(endian + "I", entry, 4)
            field = entry[8:12]
        if typ == _ASCII:
            size = 1
        elif typ in _FIELD_TYPES:
            size = _FIELD_TYPES[typ][1]
        else:
            continue  # a field type this reader does not use (rationals, for one)
        total = count * size
        if total <= inline:
            raw = field[:total]
        else:
            (where,) = struct.unpack_from(endian + offset_code, field)
            raw = _read_exact(read, where, total)
        tags[tag] = _ifd_value(raw, typ, count, endian)
    return tags, next_offset


def _ifd_value(raw: bytes, typ: int, count: int, endian: str) -> Any:
    if typ == _ASCII:
        return raw.rstrip(b"\0")
    code, size = _FIELD_TYPES[typ]
    return struct.unpack(f"{endian}{count}{code}", raw[: count * size])


def _full_resolution_ifd(read: Reader, endian: str, big: bool, offset: int) -> dict[int, Any]:
    """The first IFD that is not an overview: a reduced-resolution one is skipped."""
    while True:
        tags, next_offset = _read_ifd(read, endian, big, offset)
        if not _int(tags, _NEW_SUBFILE_TYPE, 0) & 1:
            return tags
        if next_offset == 0:
            raise ValueError("the GeoTIFF has no full-resolution image")
        offset = next_offset


def _overview_for(
    read: Reader, endian: str, big: bool, offset: int, full: dict[int, Any], pixel: float,
) -> tuple[dict[int, Any], int]:
    """The coarsest overview whose pixels are no larger than `pixel`, and how many full pixels each spans."""
    whole = _transform(full)
    if whole is None:
        return full, 1
    width = _int(full, _IMAGE_WIDTH)
    best, best_factor = full, 1
    while offset:
        tags, offset = _read_ifd(read, endian, big, offset)
        if not _int(tags, _NEW_SUBFILE_TYPE, 0) & 1 or _TILE_WIDTH not in tags:
            continue
        if _int(tags, _SAMPLES_PER_PIXEL, 1) != _int(full, _SAMPLES_PER_PIXEL, 1):
            continue
        over = _int(tags, _IMAGE_WIDTH)
        if over <= 0 or width % over:
            continue
        factor = width // over
        if abs(whole[1]) * factor <= pixel and factor > best_factor:
            best, best_factor = tags, factor
    return best, best_factor


def _int(tags: dict[int, Any], tag: int, default: int | None = None) -> int:
    value = tags.get(tag)
    if not value:
        if default is None:
            raise ValueError(f"the GeoTIFF has no tag {tag}")
        return default
    return int(value[0])


def _native_dtype(tags: dict[int, Any], bands: int) -> np.dtype:
    bits = set(tags.get(_BITS_PER_SAMPLE, (1,) * bands))
    formats = set(tags.get(_SAMPLE_FORMAT, (_SAMPLE_UINT,) * bands))
    if len(bits) != 1 or len(formats) != 1:
        raise ValueError("the bands do not all have the same sample type")
    sample_format, bit_count = formats.pop(), bits.pop()
    if (sample_format, bit_count) not in _DTYPES:
        raise ValueError(f"sample format {sample_format} with {bit_count} bits is not supported")
    return np.dtype(_DTYPES[(sample_format, bit_count)])


def _tile_table(tags: dict[int, Any], tag: int, count: int) -> tuple[int, ...]:
    table = tags.get(tag)
    if table is None or len(table) != count:
        raise ValueError("the tile tables do not match the image size")
    return tuple(table)


def _nodata(tags: dict[int, Any]) -> float | None:
    raw = tags.get(_GDAL_NODATA)
    if not raw:
        return None
    try:
        return float(raw.decode("ascii", "replace").strip())
    except ValueError:
        return None


def _fill_value(dtype: np.dtype, nodata: float | None) -> float | int:
    """What a pixel outside the image, or in a missing tile, reads as.

    A float image with no nodata gets NaN. An integer image with no nodata, or
    one whose nodata the type cannot hold, gets 0.
    """
    if dtype.kind == "f":
        return math.nan if nodata is None else nodata
    if nodata is None:
        return 0
    info = np.iinfo(dtype)
    if nodata.is_integer() and info.min <= nodata <= info.max:
        return int(nodata)
    return 0


def _epsg(tags: dict[int, Any]) -> int | None:
    """The projected EPSG code, else the geographic one, else None."""
    keys = tags.get(_GEO_KEYS)
    if not keys or len(keys) < 4:
        return None
    found: dict[int, int] = {}
    for i in range(4, min(len(keys), 4 + 4 * keys[3]), 4):
        key, location, _, value = keys[i : i + 4]
        if location == 0:
            found[key] = value
    for key in (_GEO_PROJECTED, _GEO_GEOGRAPHIC):
        code = found.get(key)
        if code and code != _GEO_USER_DEFINED:
            return int(code)
    return None


def _transform(tags: dict[int, Any]) -> tuple[float, float, float, float] | None:
    scale = tags.get(_MODEL_PIXEL_SCALE)
    tiepoint = tags.get(_MODEL_TIEPOINT)
    if not scale or not tiepoint or len(scale) < 2 or len(tiepoint) < 6:
        return None
    col, row, _, x, y, _ = tiepoint[:6]
    pixel_x, pixel_y = float(scale[0]), -float(scale[1])
    return (x - col * pixel_x, pixel_x, y - row * pixel_y, pixel_y)


def _band_names(tags: dict[int, Any], bands: int) -> list[str]:
    """The DESCRIPTION of each band from the GDAL metadata, or [] when there is none."""
    raw = tags.get(_GDAL_METADATA)
    if not raw:
        return []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []
    names = [""] * bands
    found = False
    for item in root.iter("Item"):
        sample = item.get("sample", "")
        if item.get("name") != "DESCRIPTION" or not sample.isdigit():
            continue
        if int(sample) < bands:
            names[int(sample)] = (item.text or "").strip()
            found = True
    return names if found else []


# -- decoding -------------------------------------------------------------------------


def _decompress(raw: bytes, compression: int, expected: int) -> bytes:
    if compression == _NONE:
        data = raw
    elif compression == _LZW:
        data = _lzw_decode(raw)
    else:
        try:
            data = zlib.decompress(raw)
        except zlib.error as exc:
            raise ValueError(f"a deflated tile is corrupt: {exc}") from exc
    if len(data) < expected:
        raise ValueError(f"a tile holds {len(data)} bytes, fewer than its {expected}")
    return data


def _undo_float_predictor(rows: np.ndarray, stride: int, bytes_per_sample: int, little: bool) -> np.ndarray:
    """Undo the floating-point predictor (TIFF Technical Note 3) on each row of bytes.

    The writer first cuts every sample into its bytes, most significant first, and
    lays the bytes out one plane after another across the row; then it takes the
    difference between each byte and the one `stride` bytes before it. Reading
    back is the running sum along each stride, then the planes are put back into
    samples in the file's byte order. (`stride` is the samples per pixel for a
    chunky tile, and 1 for a planar one, as libtiff does it.)
    """
    count, length = rows.shape
    summed = np.cumsum(
        rows.reshape(count, length // stride, stride), axis=1, dtype=np.uint8
    ).reshape(count, length)
    planes = summed.reshape(count, bytes_per_sample, length // bytes_per_sample)
    if little:
        planes = planes[:, ::-1, :]  # the most significant plane is the last byte, in little-endian
    return np.ascontiguousarray(planes.transpose(0, 2, 1)).reshape(count, length)


def _lzw_decode(data: bytes) -> bytes:
    """TIFF's LZW: codes of 9 to 12 bits, most significant bit first, widened one code early."""
    table: list[bytes] = [bytes((i,)) for i in range(256)] + [b"", b""]  # 256 clear, 257 end
    out = bytearray()
    width = 9
    acc = 0
    have = 0
    pos = 0
    prev: bytes | None = None
    while True:
        while have < width:
            if pos >= len(data):
                return bytes(out)  # a stream without its end code is read as far as it goes
            acc = (acc << 8) | data[pos]
            pos += 1
            have += 8
        have -= width
        code = (acc >> have) & ((1 << width) - 1)
        acc &= (1 << have) - 1
        if code == 256:
            del table[258:]
            width = 9
            prev = None
            continue
        if code == 257:
            break
        added: bytes | None
        if prev is None:
            if code > 255:
                raise ValueError("a LZW tile starts with a code that is not a literal")
            entry = table[code]
            added = None
        elif code < len(table):
            entry = table[code]
            added = prev + entry[:1]
        elif code == len(table):
            added = prev + prev[:1]
            entry = added
        else:
            raise ValueError("a LZW tile is corrupt: a code points past its table")
        out += entry
        if added is not None and len(table) < _LZW_MAX_CODES:
            table.append(added)
        prev = entry
        if len(table) + 1 >= (1 << width) and width < 12:
            width += 1
    return bytes(out)
