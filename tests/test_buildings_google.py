"""Google's Open Buildings 2.5D heights: manifests, the rasters a tile needs, reading a tile's pixels.

The rasters are read through `cog.GeoTiff`, so the tests build a tiny real GeoTIFF
in memory (classic, little-endian, tiled, three float32 bands, one overview) and serve
its bytes through the same range reader the network path uses. Nothing touches the
network: `_get_json` and `_range_reader` are replaced.
"""

from __future__ import annotations

import math
import struct
from collections.abc import Callable

import numpy as np
import pytest

from azimut.engine import utm
from azimut.engine.buildings import google25d, model
from azimut.engine.buildings.model import Building, BuildingsUnavailable

# A z14 tile over Caracas, in UTM zone 19 (EPSG 32619), where Google's rasters are.
Z, X, Y = model.tile_of(10.49, -66.90)
WEST, SOUTH, EAST, NORTH = model.tile_bounds(Z, X, Y)
ZONE, SOUTH_ZONE = utm.zone_of((SOUTH + NORTH) / 2, (WEST + EAST) / 2)
EPSG = utm.epsg_of(ZONE, SOUTH_ZONE)
# the tile's centre in metres, and the whole-metre point the test raster is built around
CENTRE_E, CENTRE_N = (float(v) for v in utm.forward((SOUTH + NORTH) / 2, (WEST + EAST) / 2, ZONE, SOUTH_ZONE))
RX, RY = round(CENTRE_E), round(CENTRE_N)

RASTER_NAME = "v1/geotiffs/009d4_2023_06_30/tile_A.tif"
MEDIA = google25d.MEDIA
MANIFEST_NAME = f"v1/manifests/8c_EPSG_{EPSG}_2023_06_30.json"
OTHER_ZONE_MANIFEST = "v1/manifests/8c_EPSG_32620_2023_06_30.json"
OLDER_MANIFEST = f"v1/manifests/8c_EPSG_{EPSG}_2022_06_30.json"

TILE_UNITS = 16  # the raster's own tile size, in pixels
FULL_PIXEL = 1.0  # metres, the raster's own pixel
OVERVIEW_PIXEL = 2.0  # metres, the overview that a 2 m read picks
RASTER_HALF = 128  # the raster covers 256 m square, centred on the tile's centre
BLOCK_HALF = 9  # the painted building block, metres from the centre
BUILT_HEIGHT = 12.0
BAND_XML = (
    b"<GDALMetadata>"
    b'<Item name="DESCRIPTION" sample="0" role="description">building_fractional_count</Item>'
    b'<Item name="DESCRIPTION" sample="1" role="description">building_height</Item>'
    b'<Item name="DESCRIPTION" sample="2" role="description">building_presence</Item>'
    b"</GDALMetadata>\0"
)


# -- manifests -----------------------------------------------------------------------


def _manifest(east: float, north: float, uri: str = "9d4_2023_06_30/tile_A.tif") -> dict:
    """A manifest with one raster whose top-left corner is (east, north), 12.5 km square."""
    return {
        "uriPrefix": "gs://open-buildings-temporal-data/v1/geotiffs/00",
        "tilesets": [
            {
                "sources": [
                    {
                        "uris": [uri],
                        "affineTransform": {
                            "scaleX": 0.5,
                            "translateX": east,
                            "scaleY": -0.5,
                            "translateY": north,
                        },
                        "dimensions": {"width": 25000, "height": 25000},
                    }
                ]
            }
        ],
    }


def test_manifest_gives_the_raster_with_its_full_bucket_name_and_bounds() -> None:
    manifest = _manifest(560164.0, 7422800.0)

    rasters = google25d._parse_manifest(manifest, 32619)

    assert rasters == [
        google25d.Raster(
            "v1/geotiffs/009d4_2023_06_30/tile_A.tif", 32619, 560164.0, 7410300.0, 572664.0, 7422800.0
        )
    ]


def test_a_source_without_its_transform_is_skipped_not_fatal() -> None:
    manifest = _manifest(560164.0, 7422800.0)
    manifest["tilesets"][0]["sources"].append({"uris": ["broken.tif"]})

    rasters = google25d._parse_manifest(manifest, 32619)

    assert [raster.name for raster in rasters] == [RASTER_NAME]


@pytest.fixture()
def fresh_manifests(monkeypatch: pytest.MonkeyPatch, tmp_workspace: str) -> None:
    """Forget the zone manifests a previous test kept in memory."""
    monkeypatch.setattr(google25d, "_manifests", {})


def _answer_manifests(
    monkeypatch: pytest.MonkeyPatch, manifests: dict[str, dict]
) -> list[str]:
    """Replace the JSON reader: the bucket listing names three manifests, and the URLs in `manifests` answer.

    Returns the list every GET is appended to, so a test can count the network.
    """
    calls: list[str] = []

    def get_json(url: str) -> object:
        calls.append(url)
        if "prefix=v1/manifests/" in url:
            names = [MANIFEST_NAME, OTHER_ZONE_MANIFEST, OLDER_MANIFEST]
            return {"items": [{"name": name} for name in names]}
        if url in manifests:
            return manifests[url]
        raise AssertionError(f"an unexpected request: {url}")

    monkeypatch.setattr(google25d, "_get_json", get_json)
    return calls


def _covering_manifest() -> dict:
    """A manifest whose one raster covers the Caracas tile in its UTM zone."""
    corners = [utm.forward(lat, lon, ZONE, SOUTH_ZONE) for lat in (SOUTH, NORTH) for lon in (WEST, EAST)]
    min_e = min(float(e) for e, _ in corners)
    max_n = max(float(n) for _, n in corners)
    # 12.5 km is the raster's extent; a kilometre of margin on the tile's west and north keeps it inside
    return _manifest(math.floor(min_e) - 1000, math.ceil(max_n) + 1000)


def test_resolve_tile_reads_the_zone_manifest_once_and_then_nothing(
    monkeypatch: pytest.MonkeyPatch, fresh_manifests: None
) -> None:
    manifest = _covering_manifest()
    calls = _answer_manifests(monkeypatch, {MEDIA + MANIFEST_NAME: manifest})

    rasters = google25d.resolve_tile(Z, X, Y)

    east = manifest["tilesets"][0]["sources"][0]["affineTransform"]["translateX"]
    north = manifest["tilesets"][0]["sources"][0]["affineTransform"]["translateY"]
    assert rasters == [google25d.Raster(RASTER_NAME, EPSG, east, north - 12500, east + 12500, north)]
    # the listing, then the one manifest of this zone: never the other zone's or the older year's
    assert len(calls) == 2
    assert "prefix=v1/manifests/" in calls[0]
    assert calls[1] == MEDIA + MANIFEST_NAME

    calls.clear()
    assert google25d.cached_rasters(Z, X, Y) == rasters
    assert calls == []


def test_a_neighbouring_tile_reuses_the_manifest_even_in_a_new_process(
    monkeypatch: pytest.MonkeyPatch, fresh_manifests: None
) -> None:
    manifest = _covering_manifest()
    calls = _answer_manifests(monkeypatch, {MEDIA + MANIFEST_NAME: manifest})
    first = google25d.resolve_tile(Z, X, Y)
    calls.clear()

    neighbour = google25d.resolve_tile(Z, X + 1, Y)
    assert neighbour == first
    assert calls == []

    # a fresh process keeps the manifests on disk, so it reads nothing from the bucket either
    monkeypatch.setattr(google25d, "_manifests", {})
    assert google25d.resolve_tile(Z, X, Y) == first
    assert calls == []


def test_a_tile_never_resolved_has_no_cached_rasters(tmp_workspace: str) -> None:
    assert google25d.cached_rasters(Z, X, Y) is None


# -- a real GeoTIFF, built in the test --------------------------------------------------


class _TiffWriter:
    """A little-endian classic TIFF, one tag at a time: all the reader's tests need."""

    def __init__(self) -> None:
        self.buf = bytearray(b"II" + struct.pack("<HI", 42, 0))

    def put(self, data: bytes) -> int:
        if len(self.buf) % 2:
            self.buf += b"\0"
        at = len(self.buf)
        self.buf += data
        return at

    def ifd(self, entries: list[tuple[int, int, int, bytes]], next_offset: int) -> int:
        """One image file directory of (tag, field type, count, packed value); returns its offset."""
        start = self.put(b"")
        entries = sorted(entries)
        extra_at = start + 2 + 12 * len(entries) + 4
        extra = bytearray()
        rows = bytearray()
        for tag, kind, count, payload in entries:
            if len(payload) <= 4:
                field = payload.ljust(4, b"\0")
            else:
                if len(extra) % 2:
                    extra += b"\0"
                field = struct.pack("<I", extra_at + len(extra))
                extra += payload
            rows += struct.pack("<HHI", tag, kind, count) + field
        self.buf += struct.pack("<H", len(entries)) + rows + struct.pack("<I", next_offset) + extra
        return start


def _short(tag: int, *values: int) -> tuple[int, int, int, bytes]:
    return tag, 3, len(values), struct.pack(f"<{len(values)}H", *values)


def _long(tag: int, *values: int) -> tuple[int, int, int, bytes]:
    return tag, 4, len(values), struct.pack(f"<{len(values)}I", *values)


def _double(tag: int, *values: float) -> tuple[int, int, int, bytes]:
    return tag, 12, len(values), struct.pack(f"<{len(values)}d", *values)


def _ascii(tag: int, text: bytes) -> tuple[int, int, int, bytes]:
    return tag, 2, len(text), text


def _image(
    writer: _TiffWriter,
    bands: np.ndarray,
    pixel: float,
    origin: tuple[float, float],
    overview: bool,
    next_offset: int,
) -> int:
    """One image of (3, rows, columns) float32 bands, planar, uncompressed, in 16-pixel tiles."""
    count, rows, cols = bands.shape
    offsets: list[int] = []
    sizes: list[int] = []
    # planar: all the tiles of band 0 (rows down, columns across), then band 1, then band 2
    for band in range(count):
        for ty in range(rows // TILE_UNITS):
            for tx in range(cols // TILE_UNITS):
                block = bands[band, ty * TILE_UNITS:(ty + 1) * TILE_UNITS, tx * TILE_UNITS:(tx + 1) * TILE_UNITS]
                data = np.ascontiguousarray(block, dtype="<f4").tobytes()
                offsets.append(writer.put(data))
                sizes.append(len(data))
    entries = [
        _long(256, cols),
        _long(257, rows),
        _short(258, 32, 32, 32),
        _short(259, 1),
        _short(277, 3),
        _short(284, 2),
        _short(322, TILE_UNITS),
        _short(323, TILE_UNITS),
        _long(324, *offsets),
        _long(325, *sizes),
        _short(339, 3, 3, 3),
    ]
    if overview:
        entries.append(_long(254, 1))
    else:
        origin_x, origin_y = origin
        entries += [
            _double(33550, pixel, pixel, 0.0),
            _double(33922, 0.0, 0.0, 0.0, origin_x, origin_y, 0.0),
            # GeoKeyDirectory: version 1.1, three keys, the projected CRS inline
            _short(34735, 1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, EPSG),
            _ascii(42112, BAND_XML),
        ]
    return writer.ifd(entries, next_offset)


TILE_UNITS_BYTES = TILE_UNITS * TILE_UNITS * 4  # one uncompressed float32 tile


def _painted_bands(origin: tuple[float, float], pixel: float, size: int, blocks: list[tuple[float, ...]]) -> np.ndarray:
    """Count, height and presence for a size-square grid: 12 m and presence 1 inside the blocks, else 0."""
    origin_x, origin_y = origin
    centres_e = origin_x + (np.arange(size) + 0.5) * pixel
    centres_n = origin_y - (np.arange(size) + 0.5) * pixel
    east, north = np.meshgrid(centres_e, centres_n)
    built = np.zeros((size, size), dtype=bool)
    for west_, south_, east_, north_ in blocks:
        built |= (east >= west_) & (east <= east_) & (north >= south_) & (north <= north_)
    presence = built.astype(np.float32)
    height = np.where(built, np.float32(BUILT_HEIGHT), np.float32(0.0)).astype(np.float32)
    return np.stack([presence, height, presence])  # building_fractional_count, height, presence


def _raster_file(blocks: list[tuple[float, ...]]) -> bytes:
    """A 256 m raster around the tile's centre, with a 2 m overview, as the bucket's files are."""
    origin = (RX - RASTER_HALF, RY + RASTER_HALF)
    writer = _TiffWriter()
    overview_at = _image(
        writer, _painted_bands(origin, OVERVIEW_PIXEL, 2 * RASTER_HALF // 2, blocks), OVERVIEW_PIXEL,
        origin, overview=True, next_offset=0,
    )
    full_at = _image(
        writer, _painted_bands(origin, FULL_PIXEL, 2 * RASTER_HALF, blocks), FULL_PIXEL,
        origin, overview=False, next_offset=overview_at,
    )
    struct.pack_into("<I", writer.buf, 4, full_at)
    return bytes(writer.buf)


# The painted building: a 2*BLOCK_HALF metre square, in UTM metres (west, south, east, north).
BLOCK = (RX - BLOCK_HALF, RY - BLOCK_HALF, RX + BLOCK_HALF, RY + BLOCK_HALF)


def _lonlat(easting: float, northing: float) -> tuple[float, float]:
    """The inverse of utm.forward for this zone, by fixed-point steps from the tile's centre."""
    lat, lon = (SOUTH + NORTH) / 2, (WEST + EAST) / 2
    for _ in range(40):
        fx, fy = utm.forward(lat, lon, ZONE, SOUTH_ZONE)
        lat += (northing - float(fy)) / 110_574.0
        lon += (easting - float(fx)) / (111_320.0 * math.cos(math.radians(lat)))
    return lon, lat


def _building(centre_e: float, centre_n: float, half: float) -> Building:
    """A square footprint of 2*half metres a side, given in UTM metres and stored in lon/lat."""
    corners = [
        (centre_e - half, centre_n - half),
        (centre_e + half, centre_n - half),
        (centre_e + half, centre_n + half),
        (centre_e - half, centre_n + half),
    ]
    return Building(rings=(tuple(_lonlat(e, n) for e, n in corners),), height=None, kind="unknown", source="osm")


class _RangeServer:
    """A stand-in for `google25d._range_reader`: serves `data`, and refuses the reads `fail` picks."""

    def __init__(self, data: bytes, fail: Callable[[int, int], bool] | None = None) -> None:
        self.data = data
        self.fail = fail
        self.requested: list[str] = []

    def __call__(self, name: str) -> Callable[[int, int], bytes]:
        self.requested.append(name)

        def read(offset: int, length: int) -> bytes:
            if self.fail is not None and self.fail(offset, length):
                raise BuildingsUnavailable("the range read was refused")
            return self.data[offset:offset + length]

        return read


def _the_tile_raster() -> google25d.Raster:
    return google25d.Raster(
        RASTER_NAME, EPSG, RX - RASTER_HALF, RY - RASTER_HALF, RX + RASTER_HALF, RY + RASTER_HALF
    )


@pytest.fixture()
def raster(monkeypatch: pytest.MonkeyPatch, tmp_workspace: str) -> _RangeServer:
    """The tile's one raster, with a building block painted in it, served from memory."""
    server = _RangeServer(_raster_file([BLOCK]))
    monkeypatch.setattr(google25d, "cached_rasters", lambda z, x, y: [_the_tile_raster()])
    monkeypatch.setattr(google25d, "_range_reader", server)
    return server


def test_fetch_tile_keeps_the_grid_and_reads_the_overview(raster: _RangeServer) -> None:
    assert google25d.has_tile(Z, X, Y) is None

    count = google25d.fetch_tile(Z, X, Y)

    assert count == 1
    assert google25d.has_tile(Z, X, Y) is not None
    assert google25d.grid_files() == [google25d._grid_path(Z, X, Y)]
    assert raster.requested == [RASTER_NAME]
    # the stored origin and pixel: the 2 m overview, not the 1 m full image
    with np.load(google25d._grid_path(Z, X, Y)) as data:
        epsg, origin_x, pixel_x, origin_y, pixel_y = data["t0"]
    assert int(epsg) == EPSG
    assert pixel_x == pytest.approx(OVERVIEW_PIXEL)
    assert pixel_y == pytest.approx(-OVERVIEW_PIXEL)
    assert origin_x == pytest.approx(RX - RASTER_HALF)
    assert origin_y == pytest.approx(RY + RASTER_HALF)


def test_a_footprint_over_the_painted_block_takes_its_height(raster: dict[str, object]) -> None:
    google25d.fetch_tile(Z, X, Y)
    height_of = google25d.sampler(Z, X, Y)

    assert height_of([_building(RX, RY, 8.0)])[0] == pytest.approx(BUILT_HEIGHT)


def test_a_footprint_over_empty_ground_takes_nothing(raster: dict[str, object]) -> None:
    google25d.fetch_tile(Z, X, Y)
    height_of = google25d.sampler(Z, X, Y)

    # 60 m east of the block, inside the raster, where presence is 0
    assert height_of([_building(RX + 60, RY, 8.0)])[0] is None


def test_a_footprint_smaller_than_a_pixel_takes_the_pixel_under_its_middle(raster: dict[str, object]) -> None:
    google25d.fetch_tile(Z, X, Y)
    height_of = google25d.sampler(Z, X, Y)

    # 0.8 m square centred 4.5 m east and north of the tile centre: no pixel centre falls inside it,
    # but the overview pixel holding its middle (the one centred 5 m east and north) is built
    assert height_of([_building(RX + 4.5, RY + 4.5, 0.4)])[0] == pytest.approx(BUILT_HEIGHT)


def test_a_footprint_outside_every_grid_takes_nothing(raster: dict[str, object]) -> None:
    google25d.fetch_tile(Z, X, Y)
    height_of = google25d.sampler(Z, X, Y)

    # 400 m east: inside the tile, but past the raster's east edge
    assert height_of([_building(RX + 400, RY, 8.0)])[0] is None


def test_a_tile_without_a_kept_grid_takes_nothing(raster: dict[str, object]) -> None:
    height_of = google25d.sampler(Z, X + 1, Y)

    assert height_of([_building(RX, RY, 8.0)])[0] is None


@pytest.mark.parametrize(
    "fail",
    [
        pytest.param(lambda offset, length: True, id="every-read"),
        # the header and the directories read, the tiles' own bytes (one tile or a run of them) do not
        pytest.param(lambda offset, length: length >= TILE_UNITS_BYTES, id="tile-reads-only"),
    ],
)
def test_a_refused_range_read_raises_and_leaves_no_grid(
    monkeypatch: pytest.MonkeyPatch, tmp_workspace: str, fail: Callable[[int, int], bool]
) -> None:
    monkeypatch.setattr(google25d, "cached_rasters", lambda z, x, y: [_the_tile_raster()])
    monkeypatch.setattr(google25d, "_range_reader", _RangeServer(_raster_file([BLOCK]), fail))

    with pytest.raises(BuildingsUnavailable, match="refused"):
        google25d.fetch_tile(Z, X, Y)

    assert google25d.has_tile(Z, X, Y) is None
    assert google25d.grid_files() == []
    assert list(google25d._grid_path(Z, X, Y).parent.glob("*.part")) == []


def test_a_listing_without_files_is_not_kept_as_an_answer(tmp_workspace, monkeypatch):
    calls = []

    def answer(url):
        calls.append(url)
        return {"kind": "storage#objects"}

    monkeypatch.setattr(google25d, "_get_json", answer)
    with pytest.raises(model.BuildingsUnavailable):
        google25d._manifest_names()
    assert not (model.cache_root() / "google" / "manifests.json").exists()
