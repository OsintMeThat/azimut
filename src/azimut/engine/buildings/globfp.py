"""3D-GloBFP: estimated building heights, worldwide, read from grids kept on disk.

The dataset (2024, ESSD 16:5357, DOI 10.5281/zenodo.15487037, CC BY
4.0) is a model's estimate of each building's height, about 2020, and it comes as
one zipped shapefile per grid cell: 2,553 cells, from 4 MB to 1.9 GB. A cell is
downloaded only once the analyst has agreed to its size (buildings/service.py
asks), unzipped, and indexed once: each footprint's bounding box names the z14 tiles it touches, and
those tiles are saved as sorted codes beside the shapefile. A tile is then read
by a binary search over the codes and a seek into the .shp, the .shx and the .dbf,
so no whole grid is ever held in memory.

Nothing here reaches the network except `download`, which the analyst asks for
through the buildings service. `read_tile` only reads what is already on disk.

A grid is ready when its folder holds the `complete` marker. The folder is built
beside its final place, then moved in by renaming, so a half-built grid is never
mistaken for a ready one. The zip is deleted once it is unpacked.
"""

from __future__ import annotations

import array
import json
import logging
import math
import shutil
import struct
import threading
import uuid
import zipfile
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, NamedTuple

import httpx
import numpy as np

from .. import tiles
from . import globfp_grids, model
from .model import Building, Point, Ring

logger = logging.getLogger(__name__)

SOURCE = "globfp"
LABEL = "3D-GloBFP"
LICENCE = "CC BY 4.0"
LINK = "https://doi.org/10.5194/essd-16-5357-2024"
DATE = "2020"
DOI = "10.5281/zenodo.15487037"
# Bumped when the folder layout or the index changes, so an old folder is read
# as not ready and downloaded again.
FORMAT = 1
ZIP_CHUNK = 1 << 20
# Polygon shape types: plain, with Z, with M. The first fields are the same.
POLYGON_TYPES = (5, 15, 25)
SHP_HEADER = 100
SHP_CODE = 9994
# How many grids' indexes are kept in memory at once: a large grid's index is
# tens of MB, and a view reads one or two grids at a time.
CACHED_INDEXES = 2
# A download can take minutes, so the read timeout is long; connecting is not.
TIMEOUT = httpx.Timeout(30.0, read=120.0)


@dataclass(frozen=True)
class Grid:
    name: str
    west: float
    south: float
    east: float
    north: float
    file_id: int
    size: int

    @property
    def url(self) -> str:
        return f"https://ndownloader.figshare.com/files/{self.file_id}"

    @property
    def folder_name(self) -> str:
        return Path(self.name).stem


class _Cancelled(Exception):
    """The analyst gave up on this download."""


class _Index(NamedTuple):
    codes: np.ndarray  # int64, sorted: x * 2**ZOOM + y of each z14 tile
    shapefile: np.ndarray  # int16: which .shp of the grid holds the record
    record: np.ndarray  # int32: the record's number in that .shp
    stems: tuple[str, ...]  # the shapefiles of the grid, in number order


# -- where the grids live -------------------------------------------------------------


def _root() -> Path:
    return model.cache_root() / SOURCE


def _folder(grid: Grid) -> Path:
    return _root() / grid.folder_name


def is_ready(grid: Grid) -> bool:
    folder = _folder(grid)
    return (folder / "complete").is_file() and (folder / "index.npz").is_file()


def grids_for_tile(z: int, x: int, y: int) -> list[Grid]:
    """Every grid whose bounds reach into the tile, ready or not."""
    west, south, east, north = model.tile_bounds(z, x, y)
    return [
        Grid(*row)
        for row in globfp_grids.GRIDS
        if row[1] < east and row[3] > west and row[2] < north and row[4] > south
    ]


def needed(z: int, x: int, y: int) -> list[Grid]:
    """The grids covering the tile that are not on disk yet."""
    return [grid for grid in grids_for_tile(z, x, y) if not is_ready(grid)]


def all_grids() -> list[Grid]:
    return [Grid(*row) for row in globfp_grids.GRIDS]


def grid_folders() -> list[Path]:
    """The grids on disk, ready ones only: what the cache's budget may let go."""
    root = _root()
    if not root.is_dir():
        return []
    return [folder for folder in root.iterdir() if folder.is_dir() and (folder / "complete").is_file()]


# -- download and indexing --------------------------------------------------------------


def _client() -> httpx.Client:
    return httpx.Client(
        follow_redirects=True,
        timeout=TIMEOUT,
        headers={"User-Agent": tiles.USER_AGENT},
    )


_locks_guard = threading.Lock()
_grid_locks: dict[str, threading.Lock] = {}


def _grid_lock(grid: Grid) -> threading.Lock:
    """One download of a grid at a time: two would share the same .part file."""
    with _locks_guard:
        return _grid_locks.setdefault(grid.name, threading.Lock())


def download(
    grid: Grid,
    progress: Callable[[int, int], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
) -> None:
    """Fetch one grid, unpack it and index it; nothing is left behind if it fails.

    `progress(done, total)` is called as bytes arrive. If `cancelled()` turns true,
    the download stops and leaves nothing on disk. Raises `BuildingsUnavailable`
    when the grid cannot be fetched or is not a shapefile.
    """
    with _grid_lock(grid):
        incoming = _root() / "incoming"
        incoming.mkdir(parents=True, exist_ok=True)
        part = incoming / f"{grid.name}.part"
        staging = _root() / f".{grid.folder_name}.{uuid.uuid4().hex}.tmp"
        try:
            _stream(grid, part, progress, cancelled)
            stems = _unpack(part, staging, cancelled)
            _index(staging, stems, cancelled)
            _install(staging, _folder(grid))
        except _Cancelled:
            logger.info("3D-GloBFP download of %s cancelled", grid.name)
        finally:
            part.unlink(missing_ok=True)
            shutil.rmtree(staging, ignore_errors=True)


def _stream(
    grid: Grid,
    part: Path,
    progress: Callable[[int, int], None] | None,
    cancelled: Callable[[], bool] | None,
) -> None:
    total = grid.size
    try:
        with _client() as client, client.stream("GET", grid.url) as response:
            if response.status_code != 200:
                raise model.BuildingsUnavailable(
                    f"3D-GloBFP answered HTTP {response.status_code} for {grid.name}"
                )
            total = int(response.headers.get("content-length") or grid.size)
            done = 0
            with part.open("wb") as out:
                for chunk in response.iter_bytes(ZIP_CHUNK):
                    if cancelled and cancelled():
                        raise _Cancelled
                    out.write(chunk)
                    done += len(chunk)
                    if progress:
                        progress(done, total)
    except httpx.HTTPError as exc:
        raise model.BuildingsUnavailable(
            f"3D-GloBFP could not be downloaded: {tiles.upstream_failure(exc)}"
        ) from exc


def _unpack(part: Path, staging: Path, cancelled: Callable[[], bool] | None) -> list[str]:
    """Copy each complete shapefile (.shp, .shx, .dbf) out of the zip, streamed.

    Returns the stems of those shapefiles in the order they are numbered.
    """
    staging.mkdir(parents=True)
    wanted = (".shp", ".shx", ".dbf")
    try:
        archive = zipfile.ZipFile(part)
    except zipfile.BadZipFile as exc:
        raise model.BuildingsUnavailable(f"{part.name} is not a zip archive") from exc
    with archive:
        members: dict[str, dict[str, zipfile.ZipInfo]] = {}
        for info in archive.infolist():
            path = Path(info.filename)
            ext = path.suffix.lower()
            if info.is_dir() or ext not in wanted or path.stem in ("", ".", ".."):
                continue
            members.setdefault(path.stem, {})[ext] = info
        stems = sorted(stem for stem, parts in members.items() if set(parts) == set(wanted))
        if not stems:
            raise model.BuildingsUnavailable(f"{part.name} holds no complete shapefile")
        for stem in stems:
            for ext, info in members[stem].items():
                if cancelled and cancelled():
                    raise _Cancelled
                with archive.open(info) as src, (staging / f"{stem}{ext}").open("wb") as dst:
                    shutil.copyfileobj(src, dst, ZIP_CHUNK)
    return stems


def _tile_xy(lat: float, lon: float) -> tuple[int, int]:
    _z, x, y = model.tile_of(lat, lon, model.ZOOM)
    return x, y


def _index(staging: Path, stems: list[str], cancelled: Callable[[], bool] | None) -> None:
    """Write index.npz and the `complete` marker into the staging folder.

    Each record's bounding box is read from its header and nothing else. Every
    z14 tile the box touches gets one row: the tile code, the shapefile's number
    and the record's number.
    """
    codes = array.array("q")
    shapefiles = array.array("h")
    records = array.array("i")
    counted = 0
    for number, stem in enumerate(stems):
        with (staging / f"{stem}.shp").open("rb") as shp:
            head = shp.read(SHP_HEADER)
            if len(head) < SHP_HEADER or struct.unpack_from(">i", head, 0)[0] != SHP_CODE:
                raise model.BuildingsUnavailable(f"{stem}.shp is not a shapefile")
            number_in_file = 0
            while True:
                if number_in_file % 4096 == 0 and cancelled and cancelled():
                    raise _Cancelled
                header = shp.read(8)
                if len(header) < 8:
                    break
                _record, words = struct.unpack(">ii", header)
                length = words * 2
                body = shp.read(min(36, length))
                shp.seek(length - len(body), 1)
                if len(body) == 36 and struct.unpack_from("<i", body, 0)[0] in POLYGON_TYPES:
                    xmin, ymin, xmax, ymax = struct.unpack_from("<4d", body, 4)
                    if all(math.isfinite(v) for v in (xmin, ymin, xmax, ymax)):
                        x0, y0 = _tile_xy(ymax, xmin)
                        x1, y1 = _tile_xy(ymin, xmax)
                        for x in range(x0, x1 + 1):
                            for y in range(y0, y1 + 1):
                                codes.append((x << model.ZOOM) | y)
                                shapefiles.append(number)
                                records.append(number_in_file)
                        counted += 1
                number_in_file += 1
    code_array = np.frombuffer(codes, dtype=np.int64)
    order = np.argsort(code_array, kind="stable")
    with (staging / "index.npz").open("wb") as out:
        np.savez(
            out,
            codes=code_array[order],
            shapefile=np.frombuffer(shapefiles, dtype=np.int16)[order],
            record=np.frombuffer(records, dtype=np.int32)[order],
        )
    marker = {
        "format": FORMAT,
        "dataset": DOI,
        "shapefiles": stems,
        "records": counted,
        "tiles": len(codes),
    }
    (staging / "complete").write_text(json.dumps(marker, separators=(",", ":")), encoding="utf-8")


def _install(staging: Path, final: Path) -> None:
    """Move the staging folder into place. On Windows a folder cannot be renamed
    over, so the old one is moved aside first and deleted last."""
    with _cache_lock:
        _indexes.pop(str(final), None)
    final.parent.mkdir(parents=True, exist_ok=True)
    old: Path | None = None
    if final.exists():
        old = final.with_name(f"{final.name}.old-{uuid.uuid4().hex}")
        final.rename(old)
    try:
        staging.rename(final)
    except OSError:
        if old is not None:
            old.rename(final)
        raise
    if old is not None:
        shutil.rmtree(old, ignore_errors=True)


# -- reading ---------------------------------------------------------------------------

_cache_lock = threading.Lock()
_indexes: OrderedDict[str, tuple[tuple[int, int], _Index]] = OrderedDict()


def _load_index(folder: Path) -> _Index:
    """The grid's index, read once and kept while the folder is unchanged.

    The arrays are read into memory, not mapped: a mapped file stays open, and on
    Windows an open file cannot be replaced by the next download.
    """
    npz = folder / "index.npz"
    stat = npz.stat()
    stamp = (stat.st_mtime_ns, stat.st_size)
    key = str(folder)
    with _cache_lock:
        hit = _indexes.get(key)
        if hit is not None and hit[0] == stamp:
            _indexes.move_to_end(key)
            return hit[1]
    marker = json.loads((folder / "complete").read_text(encoding="utf-8"))
    with np.load(npz) as data:
        index = _Index(
            codes=data["codes"],
            shapefile=data["shapefile"],
            record=data["record"],
            stems=tuple(marker["shapefiles"]),
        )
    with _cache_lock:
        _indexes[key] = (stamp, index)
        _indexes.move_to_end(key)
        while len(_indexes) > CACHED_INDEXES:
            _indexes.popitem(last=False)
    return index


def read_tile(z: int, x: int, y: int) -> list[Building]:
    """The buildings of the ready grids that touch the z14 tile.

    A building that touches two tiles comes back for each of them. A grid that is
    not on disk yet contributes nothing: this function never reaches the network.
    """
    if z != model.ZOOM:
        raise ValueError(f"3D-GloBFP is indexed at zoom {model.ZOOM}, not {z}")
    code = (x << model.ZOOM) | y
    out: list[Building] = []
    for grid in grids_for_tile(z, x, y):
        if not is_ready(grid):
            continue
        folder = _folder(grid)
        try:
            index = _load_index(folder)
            lo = int(np.searchsorted(index.codes, code, side="left"))
            hi = int(np.searchsorted(index.codes, code, side="right"))
            if lo == hi:
                continue
            rows = sorted(zip(index.shapefile[lo:hi].tolist(), index.record[lo:hi].tolist()))
            out.extend(_read_records(folder, index.stems, rows))
        except OSError as exc:
            raise model.BuildingsUnavailable(
                f"3D-GloBFP grid {grid.name} is being replaced; try again"
            ) from exc
    return out


def _read_records(folder: Path, stems: tuple[str, ...], rows: list[tuple[int, int]]) -> list[Building]:
    """The buildings of (shapefile number, record number) rows, sorted by file."""
    out: list[Building] = []
    start = 0
    while start < len(rows):
        number = rows[start][0]
        end = start
        while end < len(rows) and rows[end][0] == number:
            end += 1
        out.extend(_read_shapefile(folder, stems[number], [rec for _n, rec in rows[start:end]]))
        start = end
    return out


def _read_shapefile(folder: Path, stem: str, records: list[int]) -> list[Building]:
    """Read some records of one shapefile. The files are open only while reading.

    The stem is joined by hand: names carry dots (the cell's bounds), and a
    suffix from `with_suffix` would replace the wrong part of them.
    """
    out: list[Building] = []
    with (
        (folder / f"{stem}.shx").open("rb") as shx,
        (folder / f"{stem}.shp").open("rb") as shp,
        (folder / f"{stem}.dbf").open("rb") as dbf,
    ):
        height_field = _dbf_height_field(dbf)
        for record in records:
            shx.seek(SHP_HEADER + 8 * record)
            entry = shx.read(8)
            if len(entry) < 8:
                continue
            offset_words, _length = struct.unpack(">ii", entry)
            shp.seek(offset_words * 2)
            header = shp.read(8)
            if len(header) < 8:
                continue
            _rec, words = struct.unpack(">ii", header)
            rings = _polygon_rings(shp.read(words * 2))
            if not rings:
                continue
            height = _record_height(dbf, height_field, record)
            out.extend(_buildings(rings, height))
    return out


def _dbf_height_field(dbf: BinaryIO) -> tuple[int, int, int, int] | None:
    """(header length, record length, Height's offset in a record, its size), or None."""
    head = dbf.read(32)
    if len(head) < 32:
        return None
    header_len, record_len = struct.unpack_from("<HH", head, 8)
    offset = 1  # the deletion flag
    height: tuple[int, int] | None = None
    while True:
        descriptor = dbf.read(32)
        if len(descriptor) < 32 or descriptor[0] == 0x0D:
            break
        name = descriptor[:11].split(b"\0", 1)[0].decode("latin-1")
        size = descriptor[16]
        if name == "Height":
            height = (offset, size)
        offset += size
    if height is None:
        return None
    return header_len, record_len, height[0], height[1]


def _record_height(
    dbf: BinaryIO, layout: tuple[int, int, int, int] | None, record: int
) -> float | None:
    if layout is None:
        return None
    header_len, record_len, at, size = layout
    dbf.seek(header_len + record * record_len)
    raw = dbf.read(record_len)
    if len(raw) < at + size:
        return None
    return model.clean_height(raw[at : at + size].decode("latin-1").strip())


def _polygon_rings(content: bytes) -> list[list[Point]] | None:
    """The rings of a polygon record, as (lon, lat), closing point dropped; None if not one."""
    if len(content) < 44 or struct.unpack_from("<i", content, 0)[0] not in POLYGON_TYPES:
        return None
    try:
        parts_n, points_n = struct.unpack_from("<ii", content, 36)
        parts = struct.unpack_from(f"<{parts_n}i", content, 44)
        flat = struct.unpack_from(f"<{2 * points_n}d", content, 44 + 4 * parts_n)
    except struct.error:
        return None
    points = list(zip(flat[0::2], flat[1::2]))
    bounds = list(parts) + [points_n]
    rings: list[list[Point]] = []
    for i in range(parts_n):
        ring = points[bounds[i] : bounds[i + 1]]
        if len(ring) > 1 and ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(set(ring)) >= 3:
            rings.append(ring)
    return rings


def _buildings(rings: list[list[Point]], height: float | None) -> list[Building]:
    """Group rings into buildings: a clockwise ring starts one, a counter-clockwise
    ring is a courtyard of the one before it. Footprints under MIN_AREA are dropped."""
    groups: list[list[Ring]] = []
    for ring in rings:
        if not groups or model.ring_area(tuple(ring), ring[0][1]) < 0:
            groups.append([tuple(ring)])
        else:
            groups[-1].append(tuple(ring))
    out: list[Building] = []
    for group in groups:
        building = Building(
            rings=tuple(group),
            height=height,
            kind="estimated" if height is not None else "unknown",
            source=SOURCE,
            date=DATE,
        )
        if model.footprint_area(building) >= model.MIN_AREA:
            out.append(building)
    return out
