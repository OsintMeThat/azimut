"""Rebuild the offline city gazetteer shipped in engine/data/cities.tsv.gz.

The Satellite search bar proposes matches while the analyst types, and the
geocoder it would otherwise ask (Nominatim) forbids exactly that. So the cities
travel with the app: a trimmed GeoNames extract, gzipped, read straight off disk.

GeoNames publishes a fresh dump daily, so nothing here is SHA-pinned — the
guards are size bounds and a shape check on every row instead. The source is
CC BY 4.0; the attribution rides in the file header and in what the API returns.

Run it from the repo root when the gazetteer needs refreshing:

    python scripts/build_cities.py

It writes src/azimut/engine/data/cities.tsv.gz and prints what changed.
"""

from __future__ import annotations

import argparse
import gzip
import io
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

CITIES_URL = "https://download.geonames.org/export/dump/cities15000.zip"
ADMIN1_URL = "https://download.geonames.org/export/dump/admin1CodesASCII.txt"
#: Both dumps are a few MB; anything an order of magnitude past that is not the
#: file we asked for.
MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
MAX_MEMBER_BYTES = 96 * 1024 * 1024
MEMBER = "cities15000.txt"

#: Columns of the GeoNames dump this reads (the file has 19).
NAME, ASCII, LAT, LON, COUNTRY, ADMIN1, POPULATION = 1, 2, 4, 5, 8, 10, 14

OUT = Path(__file__).resolve().parents[1] / "src" / "azimut" / "engine" / "data" / "cities.tsv.gz"


def _fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:  # noqa: S310 (fixed https URL)
        data = response.read(MAX_ARCHIVE_BYTES + 1)
    if len(data) > MAX_ARCHIVE_BYTES:
        raise SystemExit(f"{url} is larger than {MAX_ARCHIVE_BYTES} bytes — refusing it")
    return data


def _regions(text: str) -> dict[str, str]:
    """``"ua.12"`` → ``"Kyiv Oblast"``, from the admin1 code table."""
    table: dict[str, str] = {}
    for line in text.splitlines():
        fields = line.split("\t")
        if len(fields) >= 2 and fields[0]:
            table[fields[0].lower()] = fields[1]
    return table


def _rows(dump: str, regions: dict[str, str]) -> list[tuple[str, ...]]:
    rows: list[tuple[str, ...]] = []
    for line in dump.splitlines():
        fields = line.split("\t")
        if len(fields) <= POPULATION:
            continue
        name = fields[NAME].strip()
        country = fields[COUNTRY].strip().lower()
        if not name or len(country) != 2:
            continue
        try:
            lat, lon = float(fields[LAT]), float(fields[LON])
            population = int(fields[POPULATION] or 0)
        except ValueError:
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        ascii_name = fields[ASCII].strip()
        region = regions.get(f"{country}.{fields[ADMIN1].strip().lower()}", "")
        rows.append(
            (
                name,
                # only when it says something the name doesn't
                "" if ascii_name == name else ascii_name,
                country,
                "" if region == name else region,
                _trim(lat),
                _trim(lon),
                str(population),
            )
        )
    # Biggest first, so a row's position in the file *is* its rank and the
    # reader needs no second sort.
    rows.sort(key=lambda row: -int(row[6]))
    return rows


def _trim(value: float) -> str:
    """Four decimals is ~11 m — a city centre, not a survey mark."""
    return f"{value:.4f}".rstrip("0").rstrip(".") or "0"


def build(cities_zip: bytes, admin1: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(cities_zip)) as archive:
        info = archive.getinfo(MEMBER)
        if info.file_size > MAX_MEMBER_BYTES:
            raise SystemExit(f"{MEMBER} unpacks to {info.file_size} bytes — refusing it")
        dump = archive.read(MEMBER).decode("utf-8")
    rows = _rows(dump, _regions(admin1.decode("utf-8")))
    if len(rows) < 10_000:  # the dump has ~34k; a tenth of that means a bad fetch
        raise SystemExit(f"only {len(rows)} cities parsed — the dump looks wrong")
    header = (
        f"# GeoNames cities15000, trimmed {date.today().isoformat()} — "
        "© GeoNames (CC BY 4.0), https://www.geonames.org/\n"
        "# name\tascii\tcountry\tregion\tlat\tlon\tpopulation\n"
    )
    body = "\n".join("\t".join(row) for row in rows)
    return gzip.compress((header + body + "\n").encode("utf-8"), 9)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    print(f"fetching {CITIES_URL}")
    cities_zip = _fetch(CITIES_URL)
    print(f"fetching {ADMIN1_URL}")
    admin1 = _fetch(ADMIN1_URL)

    packed = build(cities_zip, admin1)
    before = args.out.stat().st_size if args.out.exists() else 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(packed)
    lines = gzip.decompress(packed).decode("utf-8").splitlines()
    print(f"{args.out}: {len(lines) - 2} cities, {len(packed) / 1024:.0f} KiB (was {before / 1024:.0f} KiB)")


if __name__ == "__main__":
    main()
