"""Named summits around an eye, for the labels on a panorama.

They come from OpenStreetMap through the Overpass API: every node tagged
`natural=peak` or `natural=volcano` that carries a name. The answer is kept
under the workspace in 1° × 1° cells for three months, so a reopened view and
its neighbours ask for nothing. A cell holding no summit is kept too, as an
empty one.

The public Overpass servers are shared and often busy: a whole view's area in
one question took a minute, or was turned away. So the names never hold the
view up. Each cell is asked on its own, the eye's own cell first and the rest
outward, in the background two at a time, and the view reads whatever cells
are in so far (`known_around`) and asks again while some are still coming. A
server that turns a question away (busy, rate limit, error) hands it to the
next one in `ENDPOINTS`, all listed on the OpenStreetMap wiki as public
instances. A cell no server would answer is left for a few minutes before it
is asked again.

Overpass is asked only once summit names are switched on in a view, which is
the analyst asking what they are looking at.
"""

from __future__ import annotations

import json
import logging
import math
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from .. import config
from . import tiles

logger = logging.getLogger(__name__)

# Asked in this order; a server that turns a question away passes it on.
ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
TTL_DAYS = 90
# Overpass's own ceiling for one cell's query, and ours for the answer.
QUERY_TIMEOUT = 25
# Cells asked at once: the public servers allow a few slots per address.
PARALLEL = 2
# How long a cell no server would answer is left alone.
RETRY_AFTER = 300.0
# The widest box asked for at once, in cells: past this a view is an aircraft's
# looking over half a country, and the labels stop at the nearer summits.
MAX_CELLS = 64
_ELE = re.compile(r"-?\d+(?:\.\d+)?")


class PeaksUnavailable(Exception):
    """Overpass could not be reached or did not answer."""


@dataclass(frozen=True)
class Peak:
    name: str
    lat: float
    lon: float
    ele: float | None
    name_en: str | None = None


def cache_dir() -> Path:
    return config.internal_dir() / "cache" / "peaks"


def _cell_path(lat: int, lon: int) -> Path:
    return cache_dir() / f"{lat}_{lon}.json"


def cells_around(lat: float, lon: float, radius_m: float) -> list[tuple[int, int]]:
    """The 1° cells a circle of `radius_m` around a point touches."""
    dlat = radius_m / 111_195.0
    dlon = radius_m / (111_195.0 * max(math.cos(math.radians(lat)), 0.01))
    south, north = math.floor(lat - dlat), math.floor(min(lat + dlat, 89.999))
    west, east = math.floor(lon - dlon), math.floor(lon + dlon)
    cells = []
    for la in range(max(south, -90), north + 1):
        for lo in range(west, east + 1):
            cells.append((la, (lo + 180) % 360 - 180))
    return sorted(set(cells))


def parse_ele(value: str | None) -> float | None:
    """A summit height from OSM's `ele`, which is metres but not always tidy."""
    if not value:
        return None
    found = _ELE.search(value.replace(",", "."))
    if not found:
        return None
    number = float(found.group())
    if "ft" in value.lower():
        number *= 0.3048
    return number if -500 < number < 9000 else None


def _from_elements(elements: list[dict[str, Any]]) -> list[Peak]:
    found = []
    for element in elements:
        tags = element.get("tags") or {}
        name = (tags.get("name") or "").strip()
        if not name or "lat" not in element or "lon" not in element:
            continue
        found.append(Peak(
            name=name, lat=float(element["lat"]), lon=float(element["lon"]),
            ele=parse_ele(tags.get("ele")), name_en=(tags.get("name:en") or None),
        ))
    return found


def _read_cell(lat: int, lon: int) -> list[Peak] | None:
    path = _cell_path(lat, lon)
    try:
        if time.time() - path.stat().st_mtime > TTL_DAYS * 86400:
            return None
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return [Peak(**row) for row in rows]


def _write_cell(lat: int, lon: int, found: list[Peak]) -> None:
    path = _cell_path(lat, lon)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps([peak.__dict__ for peak in found]), encoding="utf-8")
    except OSError:
        pass


def _query(lat: int, lon: int) -> str:
    """One cell's summits. Two exact tag matches rather than a pattern, so the
    server answers from its index."""
    box = f"({lat},{lon},{lat + 1},{lon + 1})"
    return (
        f"[out:json][timeout:{QUERY_TIMEOUT}];"
        f'(node["natural"="peak"]["name"]{box};node["natural"="volcano"]["name"]{box};);'
        "out qt;"
    )


def _ask_cell(lat: int, lon: int) -> list[Peak]:
    """One cell from the first server that answers it."""
    query = _query(lat, lon)
    reason = "no Overpass server answered"
    for url in ENDPOINTS:
        try:
            response = httpx.post(
                url, data={"data": query}, timeout=QUERY_TIMEOUT + 10,
                headers={"User-Agent": tiles.USER_AGENT},
            )
        except httpx.HTTPError as exc:
            reason = tiles.upstream_failure(exc)
            continue
        if response.status_code != 200:
            reason = f"Overpass answered {response.status_code}"
            continue
        try:
            elements = response.json().get("elements", [])
        except ValueError:
            reason = "Overpass sent something that is not JSON"
            continue
        return _from_elements(elements)
    raise PeaksUnavailable(reason)


def _fetch(cell: tuple[int, int]) -> None:
    """Ask one cell and keep the answer. The cell stays in flight until its file
    is written, so a view reading meanwhile never asks for it twice."""
    try:
        found = _ask_cell(*cell)
    except Exception as exc:  # any failure is the same "not now" for one cell
        logger.info("summit names for cell %s: %s", cell, exc)
        with _lock:
            _failed[cell] = time.monotonic()
            _in_flight.discard(cell)
        return
    # a summit on a cell's edge belongs to the cell its own floor names
    _write_cell(*cell, [p for p in found if (math.floor(p.lat), math.floor(p.lon)) == cell])
    with _lock:
        _failed.pop(cell, None)
        _in_flight.discard(cell)


_lock = threading.Lock()
_in_flight: set[tuple[int, int]] = set()
_failed: dict[tuple[int, int], float] = {}
_pool: ThreadPoolExecutor | None = None


def _start(cell: tuple[int, int]) -> None:
    global _pool
    if _pool is None:
        _pool = ThreadPoolExecutor(max_workers=PARALLEL, thread_name_prefix="peaks")
    _in_flight.add(cell)
    _pool.submit(_fetch, cell)


@dataclass(frozen=True)
class Known:
    """What the cells around an eye hold so far."""

    peaks: list[Peak]
    pending: int  # cells still being asked
    failed: int  # cells no server would answer just now


def known_around(lat: float, lon: float, radius_m: float) -> Known:
    """Every named summit the cache holds around a point, asking for the rest.

    Never waits on the network: cells not in yet are asked in the background,
    the eye's own first and the rest by distance, and counted as pending.
    """
    cells = sorted(
        cells_around(lat, lon, radius_m),
        key=lambda c: math.hypot(c[0] + 0.5 - lat, (c[1] + 0.5 - lon) * math.cos(math.radians(lat))),
    )[:MAX_CELLS]
    found: list[Peak] = []
    pending = failed = 0
    with _lock:
        for cell in cells:
            cached = _read_cell(*cell)
            if cached is not None:
                found.extend(cached)
            elif cell in _in_flight:
                pending += 1
            elif time.monotonic() - _failed.get(cell, -RETRY_AFTER) < RETRY_AFTER:
                failed += 1
            else:
                _start(cell)
                pending += 1
    return Known(found, pending, failed)


def wait_idle(timeout: float = 10.0) -> bool:
    """Block until no cell is being asked. For tests."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with _lock:
            if not _in_flight:
                return True
        time.sleep(0.01)
    return False


def forget_failures() -> None:
    """Let every cell be asked again at once. For tests."""
    with _lock:
        _failed.clear()
