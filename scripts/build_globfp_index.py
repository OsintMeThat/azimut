"""Rebuild the grid index of 3D-GloBFP: src/azimut/engine/buildings/globfp_grids.py.

3D-GloBFP (2024, ESSD 16:5357, DOI 10.5281/zenodo.15487037) is
distributed as one zipped shapefile per grid cell, over ten figshare articles.
The app needs to know, before it downloads anything, which grid covers which
part of the world. Most file names carry the bounds (`gridID_west_south_east_
north_regions.zip`). The Chinese and US files are named by province or state,
so their bounds are read from the .shp header instead: the zip is read through
HTTP Range requests, the central directory and then the start of the .shp
member, so no whole file is ever downloaded here.

A file whose bounds cannot be read is logged and left out; the summary says how
many were left out, so the maintainer can see it.

Run it once from the repo root, when the dataset's file list changes:

    uv run python scripts/build_globfp_index.py
"""

from __future__ import annotations

import datetime
import json
import logging
import math
import os
import re
import struct
import sys
import zlib
from pathlib import Path

import httpx

ARTICLES = (
    28879733, 28881749, 28882700, 28889813, 28890593,
    28891631, 28903454, 28903853, 28904453, 28906499,
)
FILES_API = "https://api.figshare.com/v2/articles/{article}/files?page_size=1000&page={page}"
PAGE_SIZE = 1000
DOI = "10.5281/zenodo.15487037"
LICENCE = "CC BY 4.0"
OUT = Path(__file__).resolve().parent.parent / "src/azimut/engine/buildings/globfp_grids.py"
NAME_RE = re.compile(r"^(\d+)_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)_.+\.zip$")
ZIP_EOCD = 0x06054B50
ZIP_CENTRAL = 0x02014B50
ZIP_LOCAL = 0x04034B50
SHP_CODE = 9994
# The bounds are rounded outwards, to the micro-degree, so the rounding never
# drops a tile at a grid's edge.
DECIMALS = 6
TIMEOUT = httpx.Timeout(60.0)

log = logging.getLogger("build_globfp_index")
Entry = tuple[str, float, float, float, float, int, int]


def list_files(client: httpx.Client, article: int) -> list[dict]:
    """Every file of one figshare article, one page at a time."""
    files: list[dict] = []
    page = 1
    while True:
        response = client.get(FILES_API.format(article=article, page=page))
        response.raise_for_status()
        batch = response.json()
        files.extend(batch)
        if len(batch) < PAGE_SIZE:
            return files
        page += 1


def _range(client: httpx.Client, url: str, start: int, end: int) -> bytes:
    """Bytes start..end (inclusive) of a file; the host must answer with a range."""
    response = client.get(url, headers={"Range": f"bytes={start}-{end}"})
    if response.status_code != 206:
        raise RuntimeError(f"no range support (HTTP {response.status_code})")
    return response.content


def _central_directory(client: httpx.Client, url: str, size: int) -> list[tuple[str, int, int, int]]:
    """(name, method, compressed size, local header offset) of every member of a zip."""
    tail_len = min(size, 65_557)  # the end record plus the longest possible comment
    tail = _range(client, url, size - tail_len, size - 1)
    at = tail.rfind(struct.pack("<I", ZIP_EOCD))
    if at < 0 or at + 22 > len(tail):
        raise ValueError("no end-of-central-directory record")
    _sig, _disk, _disk_cd, _on_disk, _total, cd_size, cd_offset, _comment = struct.unpack_from(
        "<IHHHHIIH", tail, at
    )
    if cd_offset == 0xFFFFFFFF:
        raise ValueError("zip64 archives are not read here")
    cd = _range(client, url, cd_offset, cd_offset + cd_size - 1)
    members: list[tuple[str, int, int, int]] = []
    pos = 0
    while pos + 46 <= len(cd) and struct.unpack_from("<I", cd, pos)[0] == ZIP_CENTRAL:
        fields = struct.unpack_from("<IHHHHHHIIIHHHHHII", cd, pos)
        method, csize, name_len, extra_len, comment_len, local_offset = (
            fields[4], fields[8], fields[10], fields[11], fields[12], fields[16],
        )
        name = cd[pos + 46 : pos + 46 + name_len].decode("utf-8", "replace")
        members.append((name, method, csize, local_offset))
        pos += 46 + name_len + extra_len + comment_len
    return members


def _shp_head(client: httpx.Client, url: str, member: tuple[str, int, int, int]) -> bytes:
    """The first 100 bytes of one .shp member, inflated if it is deflated."""
    _name, method, csize, local_offset = member
    local = _range(client, url, local_offset, local_offset + 29)
    if struct.unpack_from("<I", local, 0)[0] != ZIP_LOCAL:
        raise ValueError("bad local file header")
    name_len, extra_len = struct.unpack_from("<HH", local, 26)
    start = local_offset + 30 + name_len + extra_len
    if method == 0:
        return _range(client, url, start, start + 99)
    if method != 8:
        raise ValueError(f"unsupported compression method {method}")
    inflater = zlib.decompressobj(-15)
    out = b""
    pos = start
    while len(out) < 100 and pos < start + csize:
        chunk = _range(client, url, pos, min(pos + 4095, start + csize - 1))
        if not chunk:
            break
        out += inflater.decompress(chunk)
        pos += len(chunk)
    if len(out) < 100:
        raise ValueError("the .shp header is cut short")
    return out[:100]


def header_bounds(client: httpx.Client, url: str, size: int) -> tuple[float, float, float, float]:
    """The union of the bounding boxes in every .shp member's header."""
    shps = [m for m in _central_directory(client, url, size) if m[0].lower().endswith(".shp")]
    if not shps:
        raise ValueError("no .shp member")
    boxes = []
    for member in shps:
        head = _shp_head(client, url, member)
        if struct.unpack_from(">i", head, 0)[0] != SHP_CODE:
            raise ValueError(f"{member[0]} is not a shapefile")
        boxes.append(struct.unpack_from("<4d", head, 36))  # xmin, ymin, xmax, ymax
    west = min(b[0] for b in boxes)
    south = min(b[1] for b in boxes)
    east = max(b[2] for b in boxes)
    north = max(b[3] for b in boxes)
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError(f"implausible bounds {west, south, east, north}")
    return west, south, east, north


def _outward(value: float, up: bool) -> float:
    scale = 10**DECIMALS
    return (math.ceil(value * scale) if up else math.floor(value * scale)) / scale


def build(client: httpx.Client) -> tuple[list[Entry], int, list[str]]:
    """The index entries, how many were bound by header, and the names left out."""
    entries: dict[str, Entry] = {}
    from_header = 0
    failed: list[str] = []
    for article in ARTICLES:
        for file in list_files(client, article):
            name, file_id, size = file["name"], int(file["id"]), int(file["size"])
            if name in entries and entries[name][6] >= size:
                log.warning("duplicate file name %s in article %s: smaller copy skipped", name, article)
                continue
            if name in entries:
                # The same name twice: the larger copy is the whole cell, the smaller one a part.
                log.warning("duplicate file name %s in article %s: larger copy kept", name, article)
            match = NAME_RE.match(name)
            if match:
                west, south, east, north = (float(g) for g in match.groups()[1:])
            else:
                try:
                    west, south, east, north = header_bounds(client, file["download_url"], size)
                except (httpx.HTTPError, RuntimeError, ValueError, struct.error, zlib.error) as exc:
                    log.error("left out %s: %s", name, exc)
                    failed.append(name)
                    continue
                from_header += 1
            entries[name] = (
                name,
                _outward(west, up=False), _outward(south, up=False),
                _outward(east, up=True), _outward(north, up=True),
                file_id, size,
            )
    return sorted(entries.values()), from_header, sorted(failed)


def render(entries: list[Entry], generated: str) -> str:
    lines = [
        '"""3D-GloBFP grid index: generated, do not edit by hand.',
        "",
        "Written by scripts/build_globfp_index.py on " + generated + " from the ten figshare",
        "articles of the dataset (2024, DOI " + DOI + ").",
        "Licence: " + LICENCE + ". Each entry is (name, west, south, east, north, file_id,",
        "size_bytes), sorted by name; the bounds are WGS84 degrees.",
        '"""',
        "",
        "GRIDS: tuple[tuple[str, float, float, float, float, int, int], ...] = (",
    ]
    for name, west, south, east, north, file_id, size in entries:
        lines.append(
            f"    ({json.dumps(name)}, {west!r}, {south!r}, {east!r}, {north!r}, {file_id}, {size}),"
        )
    lines.append(")")
    return "\n".join(lines) + "\n"


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    with httpx.Client(timeout=TIMEOUT, follow_redirects=True) as client:
        entries, from_header, failed = build(client)
    generated = datetime.date.today().isoformat()
    part = OUT.with_name(OUT.name + ".part")
    part.write_text(render(entries, generated), encoding="utf-8", newline="\n")
    os.replace(part, OUT)
    print(f"entries:        {len(entries)}")
    print(f"bound by header: {from_header}")
    print(f"failed:         {len(failed)}")
    for name in failed:
        print(f"  left out: {name}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
