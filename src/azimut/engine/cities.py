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
    global _rows, _index
    with _lock:
        _rows, _index = None, []


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
