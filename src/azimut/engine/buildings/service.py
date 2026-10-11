"""The buildings a view asks for round its eye: fetched behind it, kept, merged, said.

Nothing here runs until the analyst switches buildings on in a view: the view
then asks for the area (`status`) every second or so while it fills, and for
the tiles that are ready (`tile_bytes`).

Each source's tiles are read in the background, nearest first, and kept under
the workspace cache (`model.cache_root() / "tiles"`): OpenStreetMap's for a
month (OpenFreeMap rebuilds weekly), the IGN's for three months, 3D-GloBFP's
for good (it is a frozen dataset). A tile waits for the quick sources (OSM, the
IGN), so a house never shows from one and then jumps to the other's height; it
does not wait for a 3D-GloBFP download, which can take minutes, and is drawn
again with the estimates once they are in.

3D-GloBFP comes in grids of 1.25° (51 MB at the median, 1.9 GB at the most).
None is downloaded until the analyst says yes to it (`allow`), with its size in
front of them; meanwhile the tiles it covers are drawn without its estimates
and the status says what is waiting. Grids download one at a time.

A source that cannot be read is left a while, twice as long each time, and the
status says so; the tile is drawn from the others meanwhile.
"""

from __future__ import annotations

import logging
import math
import os
import queue
import shutil
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Literal

from . import globfp, ign, merge, model, osm, wire
from .model import Building, BuildingsUnavailable, Key

logger = logging.getLogger(__name__)

RADIUS_MIN = 100.0
RADIUS_MAX = 10_000.0
# A 10 km radius touches about 60 tiles at the equator, more toward the poles.
MAX_TILES = 160
PARALLEL = 4
RETRY_AFTER = 30.0
RETRY_MAX = 600.0
TTL_DAYS = {"osm": 30, "ign": 90, "globfp": 3650}
# Decoded source tiles and merged tiles kept in memory between two polls.
DECODED_KEEP = 512
MERGED_KEEP = 256
# What the tile files may take on disk before the oldest go; 3D-GloBFP's grids
# are counted apart, each one the analyst agreed to.
TILES_BUDGET = 512 << 20
GRIDS_BUDGET = 6 << 30

PROVIDERS: dict[str, Any] = {"osm": osm, "ign": ign, "globfp": globfp}
LABELS = {name: (p.LABEL, p.LICENCE, p.LINK) for name, p in PROVIDERS.items()}

State = Literal["ready", "pending", "failed", "none", "needs", "downloading"]


# -- the area round the eye -----------------------------------------------------------


def tiles_around(lat: float, lon: float, radius: float) -> list[Key]:
    """The z14 tiles that come within `radius` metres of the eye, nearest first."""
    radius = min(max(radius, RADIUS_MIN), RADIUS_MAX)
    kx, ky = model.metres_frame(lat)
    dlat, dlon = radius / ky, radius / max(kx, 1.0)
    _, x0, y0 = model.tile_of(lat + dlat, lon - dlon)
    _, x1, y1 = model.tile_of(lat - dlat, lon + dlon)
    found = []
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            west, south, east, north = model.tile_bounds(model.ZOOM, x, y)
            # the nearest point of the tile's box to the eye
            nx = (min(max(lon, west), east) - lon) * kx
            ny = (min(max(lat, south), north) - lat) * ky
            distance = math.hypot(nx, ny)
            if distance <= radius:
                found.append((distance, (model.ZOOM, x, y)))
    found.sort()
    return [key for _, key in found[:MAX_TILES]]


def key_text(key: Key) -> str:
    return "/".join(map(str, key))


# -- each source's tiles on disk --------------------------------------------------------


def _tile_path(source: str, key: Key) -> Path:
    z, x, y = key
    return model.cache_root() / "tiles" / source / str(z) / str(x) / f"{y}.json.gz"


_decoded: OrderedDict[tuple[str, Key, float], list[Building]] = OrderedDict()


def _cached(source: str, key: Key) -> tuple[list[Building], float] | None:
    """A source's kept tile and when it was written, unless it is missing, stale or unreadable."""
    path = _tile_path(source, key)
    try:
        stamp = path.stat().st_mtime
    except OSError:
        return None
    if time.time() - stamp > TTL_DAYS[source] * 86400:
        return None
    with _lock:
        hit = _decoded.get((source, key, stamp))
        if hit is not None:
            _decoded.move_to_end((source, key, stamp))
            return hit, stamp
    rows = model.read_json_gz(path)
    buildings = model.from_rows(rows.get("rows") if isinstance(rows, dict) else None)
    if buildings is None:
        return None
    with _lock:
        _decoded[(source, key, stamp)] = buildings
        while len(_decoded) > DECODED_KEEP:
            _decoded.popitem(last=False)
    return buildings, stamp


def _keep(source: str, key: Key, buildings: list[Building]) -> None:
    model.write_json_gz(_tile_path(source, key), {"at": time.time(), "rows": model.to_rows(buildings)})


# -- reading in the background ------------------------------------------------------------

_lock = threading.Lock()
_in_flight: set[tuple[str, Key]] = set()
# when a tile that could not be read may be asked again, how long it was left, and why
_failed: dict[tuple[str, Key], tuple[float, float, str]] = {}
_pool: ThreadPoolExecutor | None = None
# grids download one at a time on a thread of their own that never holds the app
# open at exit: a 1.9 GB grid must not keep a closed window's server alive
_grid_queue: queue.Queue[globfp.Grid] = queue.Queue()
_grid_thread: threading.Thread | None = None
# the 3D-GloBFP grids the analyst agreed to download, and how each download goes
_allowed: set[str] = set()
_downloads: dict[str, dict[str, Any]] = {}


def _fetch(source: str, key: Key) -> None:
    try:
        provider = PROVIDERS[source]
        buildings = provider.read_tile(*key) if source == "globfp" else provider.fetch_tile(*key)
        _keep(source, key, buildings)
    except Exception as exc:  # any failure is the same "not now" for one tile
        reason = str(exc) if isinstance(exc, BuildingsUnavailable) else f"{LABELS[source][0]} could not be read just now"
        logger.info("buildings from %s for tile %s: %s", source, key, exc)
        with _lock:
            wait = min(_failed[(source, key)][1] * 2, RETRY_MAX) if (source, key) in _failed else RETRY_AFTER
            _failed[(source, key)] = (time.monotonic() + wait, wait, reason)
            _in_flight.discard((source, key))
        return
    with _lock:
        _failed.pop((source, key), None)
        _in_flight.discard((source, key))


def _start(source: str, key: Key) -> None:
    """Called with the lock held."""
    global _pool
    if _pool is None:
        _pool = ThreadPoolExecutor(max_workers=PARALLEL, thread_name_prefix="buildings")
    _in_flight.add((source, key))
    _pool.submit(_fetch, source, key)


def _download(grid: globfp.Grid) -> None:
    def progress(done: int, total: int) -> None:
        with _lock:
            _downloads[grid.name].update(done=done, total=total)

    try:
        globfp.download(grid, progress=progress)
    except Exception as exc:  # the analyst is told, and may ask again
        logger.info("3D-GloBFP grid %s: %s", grid.name, exc)
        with _lock:
            _downloads[grid.name]["error"] = str(exc) if isinstance(exc, BuildingsUnavailable) else (
                f"3D-GloBFP's {grid.name} could not be downloaded")
            _allowed.discard(grid.name)
        return
    with _lock:
        _downloads.pop(grid.name, None)


def _grid_worker() -> None:
    while True:
        _download(_grid_queue.get())


def _start_download(grid: globfp.Grid) -> None:
    """Called with the lock held."""
    global _grid_thread
    running = _downloads.get(grid.name)
    if running is not None and not running.get("error"):
        return
    if _grid_thread is None:
        _grid_thread = threading.Thread(target=_grid_worker, name="buildings-grid", daemon=True)
        _grid_thread.start()
    _downloads[grid.name] = {"done": 0, "total": grid.size, "error": ""}
    _grid_queue.put(grid)


def _settle(source: str, key: Key) -> tuple[State, list[Building] | None, float]:
    """Where one source stands on one tile: its state, its buildings when ready, and their stamp.

    Starts what has to be started: a tile read, a grid the analyst agreed to.
    """
    if source == "ign" and not ign.covers(*key):
        return "none", None, 0.0
    if source == "globfp":
        grids = globfp.grids_for_tile(*key)
        if not grids:
            return "none", None, 0.0
        missing = [grid for grid in grids if not globfp.is_ready(grid)]
        if missing:
            with _lock:
                for grid in missing:
                    if grid.name in _allowed:
                        _start_download(grid)
                waiting = any(grid.name not in _allowed for grid in missing)
            return ("needs" if waiting else "downloading"), None, 0.0
    hit = _cached(source, key)
    if hit is not None:
        return "ready", hit[0], hit[1]
    with _lock:
        if (source, key) in _in_flight:
            return "pending", None, 0.0
        failed = _failed.get((source, key))
        if failed is not None and failed[0] > time.monotonic():
            return "failed", None, 0.0
        _start(source, key)
    return "pending", None, 0.0


# -- merged tiles --------------------------------------------------------------------------

_merged: OrderedDict[tuple[Key, tuple[str, ...], str], tuple[merge.Merged, bytes]] = OrderedDict()


def _tile(key: Key, sources: tuple[str, ...]) -> tuple[bool, str, dict[str, State], merge.Merged | None, bytes | None]:
    """One tile: whether it is ready, its version, each source's state, and the merge once ready."""
    states: dict[str, State] = {}
    found: dict[str, list[Building] | None] = {}
    parts = []
    for source in sources:
        if source == "globfp" and states.get("ign") in ("pending", "ready") and (
            states["ign"] == "pending" or found.get("ign")
        ):
            # where the IGN has surveyed the tile, 3D-GloBFP's estimates add nothing worth a
            # download; while the IGN is still coming, it is not offered yet either
            states[source], found[source] = "none", None
            parts.append(f"{source}:none:0")
            continue
        state, buildings, stamp = _settle(source, key)
        states[source] = state
        found[source] = buildings
        parts.append(f"{source}:{state}:{stamp:.0f}")
    if "pending" in states.values():
        return False, "", states, None, None
    version = "|".join(parts)
    entry = (key, sources, version)
    with _lock:
        hit = _merged.get(entry)
        if hit is not None:
            _merged.move_to_end(entry)
            return True, version, states, hit[0], hit[1]
    merged = merge.merge_tile(*key, found, set(sources))
    body = wire.encode(*key, merged.buildings)
    with _lock:
        _merged[entry] = (merged, body)
        while len(_merged) > MERGED_KEEP:
            _merged.popitem(last=False)
    return True, version, states, merged, body


def _sources(asked: list[str] | None) -> tuple[str, ...]:
    """The sources asked for, in the order `_tile` settles them (the IGN before 3D-GloBFP)."""
    if asked is None:
        return model.SOURCES
    return tuple(source for source in model.SOURCES if source in asked)


def status(lat: float, lon: float, radius: float, asked: list[str] | None = None) -> dict[str, Any]:
    """What the area round the eye holds so far, and what it waits for."""
    sources = _sources(asked)
    keys = tiles_around(lat, lon, radius)
    tiles = []
    counts = {kind: 0 for kind in model.KINDS}
    by_source: dict[str, int] = {}
    dates: dict[str, list[str]] = {}
    seen: set[tuple[str, float, float]] = set()
    needs: dict[str, globfp.Grid] = {}
    failing: dict[str, str] = {}
    pending = 0
    for key in keys:
        ready, version, states, merged, _body = _tile(key, sources)
        tiles.append({"key": key_text(key), "ready": ready, "version": version})
        if not ready:
            pending += 1
        if states.get("globfp") == "needs":
            for grid in globfp.needed(*key):
                if grid.name not in _allowed:
                    needs[grid.name] = grid
        for source, state in states.items():
            if state == "failed":
                with _lock:
                    reason = _failed.get((source, key), (0.0, 0.0, ""))[2]
                failing.setdefault(source, reason)
        if merged is None:
            continue
        for building in merged.buildings:
            # a building across a tile's edge is listed by both tiles: count it once
            cx, cy = model.centroid(building)
            identity = (building.source, round(cx, 5), round(cy, 5))
            if identity in seen:
                continue
            seen.add(identity)
            counts[building.kind] += 1
            by_source[building.source] = by_source.get(building.source, 0) + 1
            for name, date in ((building.source, building.date),
                               (building.height_source, building.height_date)):
                if name and date:
                    dates.setdefault(name, []).append(date)
    with _lock:
        retry = [left - time.monotonic() for left, _wait, _why in _failed.values()]
        downloads = [
            {"grid": name, "done": d["done"], "total": d["total"], "error": d["error"]}
            for name, d in sorted(_downloads.items())
        ]
    used = sorted(set(by_source) | {s for s in dates})
    return {
        "tiles": tiles,
        "pending": pending,
        "counts": counts,
        "footprints": by_source,
        "sources": [
            {"id": s, "label": LABELS[s][0], "licence": LABELS[s][1], "link": LABELS[s][2],
             "oldest": min(dates.get(s, [""])), "newest": max(dates.get(s, [""]))}
            for s in used if s in LABELS
        ],
        "failed": [{"source": s, "reason": why} for s, why in sorted(failing.items())],
        "retry_in": max(0.0, min(retry)) if retry and failing else 0.0,
        "needs": [{"grid": g.name, "size": g.size} for g in sorted(needs.values(), key=lambda g: g.name)],
        "downloads": downloads,
    }


def tile_bytes(keys: list[Key], asked: list[str] | None = None) -> dict[Key, bytes | None]:
    """Each tile's merged buildings as `wire` bytes, or None while it is not ready."""
    sources = _sources(asked)
    out: dict[Key, bytes | None] = {}
    for key in keys:
        ready, _version, _states, _merged_tile, body = _tile(key, sources)
        out[key] = body if ready else None
    return out


def allow(names: list[str]) -> list[str]:
    """The analyst agreed to download these 3D-GloBFP grids: they start, one after another."""
    known = {grid.name: grid for grid in globfp.all_grids()}
    started = []
    with _lock:
        for name in names:
            grid = known.get(name)
            if grid is None or globfp.is_ready(grid):
                continue
            _allowed.add(name)
            _start_download(grid)
            started.append(name)
    return started


def _inside(point: model.Point, ring: model.Ring) -> bool:
    x, y = point
    inside = False
    for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1]):
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            inside = not inside
    return inside


# A point read off a wall lies on the footprint's edge, a hair either side of it.
AT_REACH_M = 3.0


def _edge_distance(point: model.Point, ring: model.Ring, scale: tuple[float, float]) -> float:
    """Metres from a point to the nearest edge of a ring."""
    px, py = point[0] * scale[0], point[1] * scale[1]
    best = math.inf
    for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1]):
        ax, ay, bx, by = ax * scale[0], ay * scale[1], bx * scale[0], by * scale[1]
        dx, dy = bx - ax, by - ay
        t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
    return best


def building_at(lat: float, lon: float, asked: list[str] | None = None) -> dict[str, Any] | None:
    """The building drawn at a point, said with where its footprint and its height come from.

    The point is the one under the analyst's pointer: on a roof it falls inside the
    footprint, on a wall on its edge, so a footprint within `AT_REACH_M` counts too.
    """
    key = model.tile_of(lat, lon)
    ready, _version, _states, merged, _body = _tile(key, _sources(asked))
    if not ready or merged is None:
        return None
    scale = model.metres_frame(lat)
    found = None
    nearest = AT_REACH_M
    for b in merged.buildings:
        if _inside((lon, lat), b.rings[0]) and not any(_inside((lon, lat), hole) for hole in b.rings[1:]):
            found = b
            break
        gap = _edge_distance((lon, lat), b.rings[0], scale)
        if gap <= nearest:
            found, nearest = b, gap
    if found is None:
        return None
    return {
        "height": found.height, "kind": found.kind, "min_height": found.min_height,
        "source": found.source, "date": found.date,
        "height_source": model.height_source_of(found), "height_date": found.height_date or found.date,
        "area": round(model.footprint_area(found), 1),
    }


# -- housekeeping ---------------------------------------------------------------------------


def _size(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                pass
    return total


def sweep(tiles_budget: int = TILES_BUDGET, grids_budget: int = GRIDS_BUDGET) -> int:
    """Hold the tile files and the grids under their budgets, oldest first. Returns bytes freed."""
    freed = 0
    root = model.cache_root() / "tiles"
    files = []
    for path in root.rglob("*.json.gz") if root.is_dir() else ():
        try:
            st = path.stat()
        except OSError:
            continue
        files.append((st.st_mtime, st.st_size, path))
    total = sum(size for _, size, _ in files)
    for _stamp, size, path in sorted(files):
        if total <= tiles_budget * 0.8:
            break
        try:
            path.unlink()
        except OSError:
            continue
        total -= size
        freed += size
    grids = [(g.stat().st_mtime, _size(g), g) for g in globfp.grid_folders()]
    total = sum(size for _, size, _ in grids)
    for _stamp, size, folder in sorted(grids):
        if total <= grids_budget:
            break
        shutil.rmtree(folder, ignore_errors=True)
        total -= size
        freed += size
    return freed


def clear() -> int:
    """Forget every building kept on disk and in memory. Returns the bytes freed."""
    root = model.cache_root()
    size = _size(root) if root.is_dir() else 0
    if root.is_dir():
        # moved aside first: Windows cannot delete a folder a reader still holds open
        aside = root.with_name(f"{root.name}.cleared.{os.getpid()}.{time.time_ns()}")
        try:
            root.rename(aside)
        except OSError:
            aside = root
        shutil.rmtree(aside, ignore_errors=True)
    forget()
    return size


def forget() -> None:
    """Drop what is held in memory (tests, and after `clear`)."""
    with _lock:
        _decoded.clear()
        _merged.clear()
        _failed.clear()
        _allowed.clear()
        _downloads.clear()


def wait_idle(timeout: float = 10.0) -> bool:
    """Wait until no tile is being read and no grid downloaded (tests)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with _lock:
            busy = bool(_in_flight) or any(not d.get("error") for d in _downloads.values())
        if not busy:
            return True
        time.sleep(0.01)
    return False
