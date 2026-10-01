"""Offline city gazetteer, for search that answers while the analyst types.

Nominatim's usage policy forbids autocomplete, and its 1.1 s pace (``geo._pace``)
would queue a keystroke behind whatever backfill is running anyway. So the cities
travel with the app: ~34k places of 15 000 people or more, gzipped to about
770 KiB, read off disk on first use and searched in memory afterwards. Nothing
here touches the network, ever — the geocoder is a separate, slower layer that
the UI only reaches for once typing stops.

Refresh the file with ``python scripts/build_cities.py``. Source: GeoNames,
CC BY 4.0 — the attribution rides with every answer.
"""

from __future__ import annotations

import gzip
import math
import threading
import unicodedata
from bisect import bisect_left
from pathlib import Path
from typing import Any

from . import countries

DATA = Path(__file__).parent / "data" / "cities.tsv.gz"
ATTRIBUTION = "© GeoNames (CC BY 4.0)"

#: A rank, not a filter: an exact name beats a name that starts with the query,
#: which beats a match on a later word ("york" finding New York).
EXACT, STARTS, WORD = 0, 1, 2

_lock = threading.Lock()
_rows: list[str] | None = None
#: ``(key, kind, row)`` sorted by key, so a prefix is one bisect and a short walk.
_index: list[tuple[str, int, int]] = []


def normalize(text: str) -> str:
    """Casefold, strip accents, and reduce punctuation to single spaces.

    ``"Saint-Étienne"`` and ``"saint etienne"`` have to meet somewhere, and a
    query is normalized by this same function so they meet here.
    """
    folded = unicodedata.normalize("NFKD", text).casefold()
    kept = [
        c if c.isalnum() else " "
        for c in folded
        if not unicodedata.combining(c)
    ]
    return " ".join("".join(kept).split())


def _load() -> None:
    """Read the gazetteer once. Cheap enough to do lazily (~120 ms), and a
    missing file is not fatal: search just finds nothing and the geocoder still
    answers."""
    global _rows, _index
    with _lock:
        if _rows is not None:
            return
        rows: list[str] = []
        index: list[tuple[str, int, int]] = []
        try:
            text = gzip.decompress(DATA.read_bytes()).decode("utf-8")
        except (OSError, EOFError, gzip.BadGzipFile, UnicodeDecodeError):
            _rows, _index = [], []
            return
        for line in text.splitlines():
            if not line or line.startswith("#"):
                continue
            row = len(rows)
            rows.append(line)
            name, ascii_name = line.split("\t", 2)[:2]
            keys = {normalize(name)}
            if ascii_name:
                keys.add(normalize(ascii_name))
            for key in keys:
                if not key:
                    continue
                index.append((key, STARTS, row))
                # Later words are searchable on their own, so "york" reaches New
                # York, but they rank below a name that opens with the query.
                for word in key.split(" ")[1:]:
                    index.append((word, WORD, row))
        index.sort()
        _rows, _index = rows, index


def _reset() -> None:
    """Test seam: forget the loaded table."""
    global _rows, _index, _cells
    with _lock:
        _rows, _index, _cells = None, [], None


#: The cities bucketed on a one-degree grid, built the first time a point asks, so
#: "which town is this near" reads a handful of cells rather than 34 000 rows.
_cells: dict[tuple[int, int], list[int]] | None = None

_COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def _grid() -> dict[tuple[int, int], list[int]]:
    global _cells
    if _rows is None:
        _load()
    with _lock:
        if _cells is None:
            cells: dict[tuple[int, int], list[int]] = {}
            for row, line in enumerate(_rows or []):
                parts = line.split("\t")
                try:
                    lat, lon = float(parts[4]), float(parts[5])
                except (IndexError, ValueError):
                    continue
                cells.setdefault((math.floor(lat), math.floor(lon)), []).append(row)
            _cells = cells
        return _cells


def nearest(lat: float, lon: float, *, within_km: float = 100.0) -> dict[str, Any] | None:
    """The closest city to a point, how far and which way, or None past ``within_km``.

    What a point named only by its coordinates is called where a person reads it:
    "8 km W of Al Hazm" says where `16.98, 45.05` is to anybody who does not read
    coordinates. The cities are those of 15 000 people or more, so in empty country
    the answer is honestly none rather than a hamlet.
    """
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    cells = _grid()
    rows = _rows or []
    best: tuple[float, int] | None = None
    # Enough one-degree cells around the point to hold the whole radius: a degree of
    # latitude is 111 km everywhere, a degree of longitude shrinks towards the poles.
    reach_lat = math.ceil(within_km / 111.0)
    span = 111.0 * max(math.cos(math.radians(lat)), 0.01)
    reach_lon = min(180, math.ceil(within_km / span))
    base_lat, base_lon = math.floor(lat), math.floor(lon)
    for dlat in range(-reach_lat, reach_lat + 1):
        for dlon in range(-reach_lon, reach_lon + 1):
            wrapped = (base_lon + dlon + 180) % 360 - 180
            for row in cells.get((base_lat + dlat, wrapped), ()):
                parts = rows[row].split("\t")
                km = _km(lat, lon, float(parts[4]), float(parts[5]))
                if best is None or km < best[0]:
                    best = (km, row)
    if best is None or best[0] > within_km:
        return None
    km, row = best
    city = _unpack(rows[row])
    return {
        "name": city["name"],
        "country": city["country"],
        "km": round(km),
        "bearing": _bearing(city["lat"], city["lon"], lat, lon),
    }


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
    """Which way the second point lies from the first, on eight points of the compass."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    degrees = (math.degrees(math.atan2(y, x)) + 360) % 360
    return _COMPASS[int((degrees + 22.5) // 45) % 8]


def describe(lat: float, lon: float) -> str | None:
    """A point as the town it is near: `Al Hazm`, or `8 km W of Al Hazm`."""
    city = nearest(lat, lon)
    if city is None:
        return None
    if city["km"] < 2:
        return str(city["name"])
    return f"{city['km']} km {city['bearing']} of {city['name']}"


def _unpack(line: str) -> dict[str, Any]:
    name, _ascii, country, region, lat, lon, population = line.split("\t")
    return {
        "name": name,
        "region": region,
        "country": country,
        "country_name": countries.name_for(country) or country.upper(),
        "lat": float(lat),
        "lon": float(lon),
        "population": int(population),
    }


def search(query: str, limit: int = 8) -> list[dict[str, Any]]:
    """The best `limit` cities whose name starts with `query`.

    Ranked by match kind, then by population — the file is written biggest-first,
    so a row's position is its rank and no second sort is needed.
    """
    key = normalize(query)
    if not key or limit <= 0:
        return []
    if _rows is None:
        _load()
    rows, index = _rows or [], _index
    best: dict[int, tuple[int, int]] = {}
    at = bisect_left(index, (key,))
    while at < len(index):
        entry_key, kind, row = index[at]
        if not entry_key.startswith(key):
            break
        at += 1
        if kind == STARTS and entry_key == key:
            kind = EXACT
        rank = (kind, row)
        if row not in best or rank < best[row]:
            best[row] = rank
    top = sorted(best.values())[:limit]
    return [_unpack(rows[row]) for _kind, row in top]
