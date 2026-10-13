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
again with the estimates once they are in. Tiles are merged in the background:
the view is answered at once with the last merged version while the next one
is made, and `working` tells it to keep asking.

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
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from . import globfp, google25d, ign, merge, model, nl3dbag, nrw, nyc, osm, overture, wire
from .model import Building, BuildingsUnavailable, Key

logger = logging.getLogger(__name__)

RADIUS_MIN = 100.0
RADIUS_MAX = 10_000.0
# A 10 km radius touches about 60 tiles at the equator, more toward the poles.
MAX_TILES = 160
PARALLEL = 4
HEAVY_PARALLEL = 3
MERGE_PARALLEL = 2
RETRY_AFTER = 30.0
RETRY_MAX = 600.0
TTL_DAYS = {
    "osm": 30, "ign": 90, "nl3dbag": 90, "nrw": 90, "nyc": 30, "overture": 30, "globfp": 3650, "google": 3650,
}
# Decoded source tiles and merged tiles kept in memory between two polls.
DECODED_KEEP = 512
MERGED_KEEP = 256
# What the tile files may take on disk before the oldest go; 3D-GloBFP's grids
# are counted apart, each one the analyst agreed to.
TILES_BUDGET = 512 << 20
GRIDS_BUDGET = 6 << 30

PROVIDERS: dict[str, Any] = {
    "ign": ign, "nl3dbag": nl3dbag, "nrw": nrw, "nyc": nyc, "osm": osm, "overture": overture,
    "globfp": globfp, "google": google25d,
}
LABELS = {name: (p.LABEL, p.LICENCE, p.LINK) for name, p in PROVIDERS.items()}
# Sources whose data comes in big files downloaded once, each only after the analyst says yes
PACKED = ("globfp",)
# Google's heights and Overture's footprints are heavy tiles, read once the analyst said yes,
# for this run of the app
GOOGLE = "google"
OVERTURE = "overture"
ASKED_ONCE = {GOOGLE: google25d.TILE_BYTES, OVERTURE: overture.TILE_BYTES}

# "resolving" (which files a tile needs is being looked up), "needs" (a file waits for the
# analyst) and "downloading" never hold a tile up; "pending" (a quick read under way) does
State = Literal["ready", "pending", "failed", "none", "needs", "downloading", "resolving", "reading"]


@dataclass(frozen=True)
class Pack:
    """One file a source downloads once: a 3D-GloBFP grid or a Google raster."""

    source: str
    name: str
    size: int
    item: Any


def _packs(source: str, key: Key) -> list[Pack]:
    """The files a tile needs from a packed source."""
    return [Pack(source, g.name, g.size, g) for g in globfp.grids_for_tile(*key)]


def _pack_ready(pack: Pack) -> bool:
    return bool(PROVIDERS[pack.source].is_ready(pack.item))


# -- the area round the eye -----------------------------------------------------------


def tiles_around(lat: float, lon: float, radius: float) -> list[Key]:
    """The z14 tiles that come within `radius` metres of the eye, nearest first.

    Past the antimeridian the columns go on from the grid's first, measured on
    the eye's side of it.
    """
    radius = min(max(radius, RADIUS_MIN), RADIUS_MAX)
    kx, ky = model.metres_frame(lat)
    dlat, dlon = radius / ky, radius / max(kx, 1.0)
    n = 2**model.ZOOM
    _, _, y0 = model.tile_of(lat + dlat, lon)
    _, _, y1 = model.tile_of(lat - dlat, lon)
    x0 = math.floor((lon - dlon + 180) / 360 * n)
    x1 = math.floor((lon + dlon + 180) / 360 * n)
    found = []
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            west, south, east, north = model.tile_bounds(model.ZOOM, x, y)
            # the nearest point of the tile's box to the eye
            nx = (min(max(lon, west), east) - lon) * kx
            ny = (min(max(lat, south), north) - lat) * ky
            distance = math.hypot(nx, ny)
            if distance <= radius:
                found.append((distance, (model.ZOOM, x % n, y)))
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
_pools: dict[str, ThreadPoolExecutor] = {}
# grids download one at a time on a thread of their own that never holds the app
# open at exit: a 1.9 GB grid must not keep a closed window's server alive
_grid_queue: queue.Queue[Pack] = queue.Queue()
_grid_thread: threading.Thread | None = None
# the 3D-GloBFP grids the analyst agreed to download, and how each download goes
_allowed: set[str] = set()
_yes = {source: threading.Event() for source in ASKED_ONCE}
_downloads: dict[str, dict[str, Any]] = {}


def _fetch(source: str, key: Key) -> None:
    try:
        provider = PROVIDERS[source]
        if source == GOOGLE:
            # first which rasters cover the tile (small), then, once the analyst said yes, their heights
            if provider.cached_rasters(*key) is None:
                provider.resolve_tile(*key)
            elif _yes[GOOGLE].is_set():
                provider.fetch_tile(*key)
        else:
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
    """Called with the lock held. Heavy tiles (Google's heights, Overture's footprints) are
    read on threads of their own, so a quick read never waits behind a download."""
    lane = "heavy" if source in ASKED_ONCE else "quick"
    pool = _pools.get(lane)
    if pool is None:
        pool = _pools[lane] = ThreadPoolExecutor(
            max_workers=HEAVY_PARALLEL if lane == "heavy" else PARALLEL, thread_name_prefix=f"buildings-{lane}",
        )
    _in_flight.add((source, key))
    pool.submit(_fetch, source, key)


def _download(pack: Pack) -> None:
    def progress(done: int, total: int) -> None:
        with _lock:
            _downloads[pack.name].update(done=done, total=total)

    try:
        PROVIDERS[pack.source].download(pack.item, progress=progress)
    except Exception as exc:  # the analyst is told, and may ask again
        logger.info("%s file %s: %s", pack.source, pack.name, exc)
        with _lock:
            _downloads[pack.name]["error"] = str(exc) if isinstance(exc, BuildingsUnavailable) else (
                f"{LABELS[pack.source][0]} could not be downloaded")
            _allowed.discard(pack.name)
        return
    with _lock:
        _downloads.pop(pack.name, None)


def _grid_worker() -> None:
    while True:
        _download(_grid_queue.get())


def _start_download(pack: Pack) -> None:
    """Called with the lock held."""
    global _grid_thread
    running = _downloads.get(pack.name)
    if running is not None and not running.get("error"):
        return
    if _grid_thread is None:
        _grid_thread = threading.Thread(target=_grid_worker, name="buildings-grid", daemon=True)
        _grid_thread.start()
    _downloads[pack.name] = {"done": 0, "total": pack.size, "error": "", "source": pack.source}
    _grid_queue.put(pack)


def _settle(source: str, key: Key) -> tuple[State, list[Building] | None, float]:
    """Where one source stands on one tile: its state, its buildings when ready, and their stamp.

    Starts what has to be started: a tile read, a grid the analyst agreed to.
    """
    if source in model.NATIONAL and not PROVIDERS[source].covers(*key):
        return "none", None, 0.0
    if source == GOOGLE:
        return _settle_google(key)
    if source == OVERTURE:
        return _settle_overture(key)
    if source in PACKED:
        packs = _packs(source, key)
        if not packs:
            return "none", None, 0.0
        missing = [pack for pack in packs if not _pack_ready(pack)]
        if missing:
            with _lock:
                for pack in missing:
                    if pack.name in _allowed:
                        _start_download(pack)
                waiting = any(pack.name not in _allowed for pack in missing)
            return ("needs" if waiting else "downloading"), None, 0.0
        # read off the grid on disk once it is in: the tile shows without its estimates meanwhile
        return _settle_read(source, key, "reading")
    return _settle_read(source, key, "pending")


def _settle_read(source: str, key: Key, waiting: State) -> tuple[State, list[Building] | None, float]:
    """A source's kept tile, else its read started: `waiting` says whether it holds the tile up."""
    hit = _cached(source, key)
    if hit is not None:
        return "ready", hit[0], hit[1]
    with _lock:
        if (source, key) in _in_flight:
            return waiting, None, 0.0
        failed = _failed.get((source, key))
        if failed is not None and failed[0] > time.monotonic():
            return "failed", None, 0.0
        _start(source, key)
    return waiting, None, 0.0


def _settle_google(key: Key) -> tuple[State, list[Building] | None, float]:
    """Google's heights for a tile: looked up, waiting for the yes, being read, or kept.

    None of it holds the tile up: the buildings show with the other heights first.
    """
    rasters = google25d.cached_rasters(*key)
    stamp = google25d.has_tile(*key)
    if rasters == []:
        return "none", None, 0.0
    if stamp is not None:
        return "ready", [], stamp
    if rasters is not None and not _yes[GOOGLE].is_set():
        return "needs", None, 0.0
    waiting: State = "resolving" if rasters is None else "downloading"
    with _lock:
        if (GOOGLE, key) in _in_flight:
            return waiting, None, 0.0
        failed = _failed.get((GOOGLE, key))
        if failed is not None and failed[0] > time.monotonic():
            return "failed", None, 0.0
        _start(GOOGLE, key)
    return waiting, None, 0.0


def _settle_overture(key: Key) -> tuple[State, list[Building] | None, float]:
    """Overture's footprints for a tile: kept, waiting for the yes, or being read.

    Like Google's heights, they never hold the tile up: it shows from the other
    sources first and is drawn again once they are in."""
    hit = _cached(OVERTURE, key)
    if hit is not None:
        return "ready", hit[0], hit[1]
    if not _yes[OVERTURE].is_set():
        return "needs", None, 0.0
    with _lock:
        if (OVERTURE, key) in _in_flight:
            return "downloading", None, 0.0
        failed = _failed.get((OVERTURE, key))
        if failed is not None and failed[0] > time.monotonic():
            return "failed", None, 0.0
        _start(OVERTURE, key)
    return "downloading", None, 0.0


# -- merged tiles --------------------------------------------------------------------------

# Who a building is across tiles (a building over a tile's edge is listed by both), its
# kind, whose footprint it is, and the (source, date) pairs it carries: what the status counts.
Row = tuple[tuple[str, float, float], model.Kind, str, tuple[tuple[str, str], ...]]


@dataclass(frozen=True)
class Built:
    """A tile merged: its buildings, as the view is sent them, and as the status counts them."""

    merged: merge.Merged
    body: bytes
    rows: tuple[Row, ...]


@dataclass(frozen=True)
class Tile:
    ready: bool
    version: str
    states: dict[str, State]
    built: Built | None
    # something is still coming for it: a source being read, or a merge under way
    working: bool


_merged: OrderedDict[tuple[Key, tuple[str, ...], str], Built] = OrderedDict()
# the version each tile last showed, for the sources asked: shown again while the next one merges
_latest: dict[tuple[Key, tuple[str, ...]], str] = {}
_merging: set[tuple[Key, tuple[str, ...], str]] = set()
_merger: ThreadPoolExecutor | None = None
# States that are not the tile's last word yet, though they do not hold it up
BUSY = ("resolving", "downloading", "reading")


def _build(z: int, x: int, y: int, found: dict[str, list[Building] | None], sources: tuple[str, ...],
           google: bool) -> Built:
    rasters = {GOOGLE: (google25d.sampler(z, x, y), google25d.YEAR)} if google else {}
    merged = merge.merge_tile(z, x, y, found, set(sources), rasters)
    rows = []
    for b in merged.buildings:
        cx, cy = model.centroid(b)
        dates = tuple((name, date) for name, date in ((b.source, b.date), (b.height_source, b.height_date))
                      if name and date)
        rows.append(((b.source, round(cx, 5), round(cy, 5)), b.kind, b.source, dates))
    return Built(merged, wire.encode(z, x, y, merged.buildings), tuple(rows))


def _merge_job(entry: tuple[Key, tuple[str, ...], str], found: dict[str, list[Building] | None], google: bool) -> None:
    key, sources, version = entry
    try:
        built = _build(*key, found, sources, google)
    except Exception:  # a tile that cannot be merged stays as it was shown
        logger.exception("buildings: merging tile %s", key)
        with _lock:
            _merging.discard(entry)
        return
    with _lock:
        _merged[entry] = built
        while len(_merged) > MERGED_KEEP:
            _merged.popitem(last=False)
        _latest[(key, sources)] = version
        _merging.discard(entry)


def _tile(key: Key, sources: tuple[str, ...]) -> Tile:
    """One tile: whether it can be drawn, its version, each source's state, and its buildings.

    The version names only the sources whose buildings are in, so a source moving from
    waiting to downloading does not send the view the same buildings again. A tile is
    merged in the background, away from the view's asking: until a new version is
    merged, the last one is shown.
    """
    global _merger
    states: dict[str, State] = {}
    found: dict[str, list[Building] | None] = {}
    parts = []
    for source in sources:
        surveyed = [states.get(n) for n in model.NATIONAL if n in states]
        heavy = source in PACKED or source == OVERTURE
        if heavy and ("pending" in surveyed or any(found.get(n) for n in model.NATIONAL)):
            # where a national survey has the tile, estimates and other footprints add nothing
            # worth a download; while the survey is still coming, none is offered yet either
            states[source], found[source] = "none", None
            continue
        state, buildings, stamp = _settle(source, key)
        states[source] = state
        found[source] = buildings
        if state == "ready":
            parts.append(f"{source}:{stamp:.0f}")
    working = any(state in BUSY for state in states.values())
    if "pending" in states.values():
        return Tile(False, "", states, None, True)
    version = "|".join(parts) or "-"
    entry = (key, sources, version)
    with _lock:
        hit = _merged.get(entry)
        if hit is not None:
            _merged.move_to_end(entry)
            _latest[(key, sources)] = version
            return Tile(True, version, states, hit, working)
        if entry not in _merging:
            if _merger is None:
                _merger = ThreadPoolExecutor(max_workers=MERGE_PARALLEL, thread_name_prefix="buildings-merge")
            _merging.add(entry)
            _merger.submit(_merge_job, entry, found, states.get(GOOGLE) == "ready")
        shown = _latest.get((key, sources))
        old = _merged.get((key, sources, shown)) if shown else None
    if old is not None and shown is not None:
        return Tile(True, shown, states, old, True)
    return Tile(False, "", states, None, True)


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
    needs: dict[str, Pack] = {}
    failing: dict[str, str] = {}
    pending = working = 0
    # the sources asked once: how many tiles wait for the yes, are being read, are in
    tally = {source: {"needs": 0, "downloading": 0, "ready": 0} for source in ASKED_ONCE}
    google_read = 0
    for key in keys:
        tile = _tile(key, sources)
        tiles.append({"key": key_text(key), "ready": tile.ready, "version": tile.version})
        pending += not tile.ready
        working += tile.working
        states = tile.states
        for source in PACKED:
            if states.get(source) == "needs":
                for pack in _packs(source, key):
                    if pack.name not in _allowed and not _pack_ready(pack):
                        needs[pack.name] = pack
        for source, counted in tally.items():
            state = states.get(source)
            if state in counted:
                counted[state] += 1
        if states.get(GOOGLE) == "downloading":
            google_read += min(google25d.received(*key), google25d.TILE_BYTES)
        for source, state in states.items():
            if state == "failed":
                with _lock:
                    reason = _failed.get((source, key), (0.0, 0.0, ""))[2]
                failing.setdefault(source, reason)
        if tile.built is None:
            continue
        for identity, kind, source, carried in tile.built.rows:
            if identity in seen:
                continue
            seen.add(identity)
            counts[kind] += 1
            by_source[source] = by_source.get(source, 0) + 1
            for name, date in carried:
                dates.setdefault(name, []).append(date)
    with _lock:
        retry = [left - time.monotonic() for left, _wait, _why in _failed.values()]
        downloads = [
            {"grid": name, "source": d.get("source", ""), "done": d["done"], "total": d["total"], "error": d["error"]}
            for name, d in sorted(_downloads.items())
        ]
    asked_once = []
    for source, counted in tally.items():
        weight = ASKED_ONCE[source]
        if counted["downloading"]:
            # tiles said as the bytes they are expected to weigh, Google's read so far counted as it comes
            partial = google_read if source == GOOGLE else 0
            downloads.append({
                "grid": source, "source": source, "error": "", "done": counted["ready"] * weight + partial,
                "total": (counted["ready"] + counted["downloading"]) * weight,
            })
        if counted["needs"]:
            asked_once.append({
                "grid": source, "size": counted["needs"] * weight, "source": source, "label": LABELS[source][0],
            })
    used = sorted(set(by_source) | {s for s in dates})
    return {
        "tiles": tiles,
        "pending": pending,
        "working": working,
        "counts": counts,
        "footprints": by_source,
        "sources": [
            {"id": s, "label": LABELS[s][0], "licence": LABELS[s][1], "link": LABELS[s][2],
             "oldest": min(dates.get(s, [""])), "newest": max(dates.get(s, [""]))}
            for s in used if s in LABELS
        ],
        "failed": [{"source": s, "reason": why} for s, why in sorted(failing.items())],
        "retry_in": max(0.0, min(retry)) if retry and failing else 0.0,
        "needs": [
            {"grid": p.name, "size": p.size, "source": p.source, "label": LABELS[p.source][0]}
            for p in sorted(needs.values(), key=lambda p: (p.source, p.name))
        ] + asked_once,
        "downloads": downloads,
    }


def tile_bytes(keys: list[Key], asked: list[str] | None = None) -> dict[Key, bytes | None]:
    """Each tile's merged buildings as `wire` bytes, or None while it is not ready."""
    sources = _sources(asked)
    out: dict[Key, bytes | None] = {}
    for key in keys:
        tile = _tile(key, sources)
        out[key] = tile.built.body if tile.ready and tile.built else None
    return out


def allow(names: list[str]) -> list[str]:
    """The analyst agreed to download these files: they start, one after another."""
    grids = {grid.name: grid for grid in globfp.all_grids()}
    started = []
    for name in names:
        if name in _yes:
            _yes[name].set()
            started.append(name)
            continue
        if name not in grids:
            continue
        pack = Pack("globfp", name, grids[name].size, grids[name])
        if _pack_ready(pack):
            continue
        with _lock:
            _allowed.add(name)
            _start_download(pack)
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
    tile = _tile(key, _sources(asked))
    if not tile.ready or tile.built is None:
        return None
    merged = tile.built.merged
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
    # the downloaded files, 3D-GloBFP's grids and Google's rasters, held under one budget
    packs = [(g.stat().st_mtime, _size(g), g) for g in globfp.grid_folders()]
    packs += [(r.stat().st_mtime, r.stat().st_size, r) for r in google25d.grid_files()]
    total = sum(size for _, size, _ in packs)
    for _stamp, size, path in sorted(packs):
        if total <= grids_budget:
            break
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)
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


def self_check() -> bool:
    """Whether this build reads what the sources send, without the network.

    The release smoke test asks it of each binary: the decompressors the readers
    lean on (a GeoTIFF tile's LZW and deflate, a PMTiles directory's gzip), the
    UTM projection Google's rasters need, the compressed arrays its cache keeps,
    and the tile the view is sent."""
    import gzip
    import io
    import zlib

    import numpy as np

    from .. import cog, pmtiles, utm

    try:
        text = b"azimut azimut"
        lzw = cog._decompress(bytes.fromhex("80184f469369d4e820814120d010"), cog._LZW, len(text))
        deflated = cog._decompress(zlib.compress(text), cog._DEFLATE, len(text))
        gzipped = pmtiles._decompress(gzip.compress(text), 2)
        x, y = utm.forward(48.8583701, 2.2944813, 31, False)
        kept = io.BytesIO()
        np.savez_compressed(kept, heights=np.arange(4, dtype=np.uint16))
        kept.seek(0)
        with np.load(kept) as arrays:
            heights = arrays["heights"].tolist()
        house = Building((((2.2945, 48.8584), (2.2946, 48.8584), (2.2946, 48.8585)),), 9.0, "measured", "osm", "2026")
        back = wire.decode(wire.encode(14, 8296, 5636, [house]), 14, 8296, 5636)
    except Exception:  # noqa: BLE001  (any failure means the build cannot read buildings)
        logger.exception("the buildings self-check failed")
        return False
    return (
        lzw == deflated == gzipped == text
        and abs(float(x) - 448250.599) < 0.01 and abs(float(y) - 5411951.599) < 0.01
        and heights == [0, 1, 2, 3]
        and len(back) == 1 and back[0].height == 9.0 and back[0].kind == "measured"
    )


def forget() -> None:
    """Drop what is held in memory (tests, and after `clear`)."""
    with _lock:
        _decoded.clear()
        _merged.clear()
        _latest.clear()
        _failed.clear()
        _allowed.clear()
        _downloads.clear()
    for said in _yes.values():
        said.clear()


def wait_idle(timeout: float = 10.0) -> bool:
    """Wait until no tile is being read or merged and no grid downloaded (tests)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with _lock:
            busy = bool(_in_flight) or bool(_merging) or any(not d.get("error") for d in _downloads.values())
        if not busy:
            return True
        time.sleep(0.01)
    return False
