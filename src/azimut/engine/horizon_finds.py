"""A search for where a photo was taken, kept in the case as it runs.

A search is case work in `.horizon/finds/<name>.json`: what was asked (the photo
and its trace, the area, the alignments, who took it, the settings), its status
and progress while it runs, and once done every point scored and the best
places, so the heatmap comes back without searching again. It runs on the case's
background queue (engine/workqueue.py) as Detect's runs do: started only by the
analyst's press, stopped by theirs, and a search an app restart cut short starts
again from the beginning.

While it runs, the points it has scored are held in memory (`LIVE`) for the map
to fill in as it goes, never written: the record would grow with every write. A
search stopped (`stopping`, then `cancelled`) keeps what it had found by then as
its result, marked `partial`. The place the analyst confirmed, from the search
or by looking from one of its points, is kept on it as `found`, and stops it.

The search itself is engine/finder.py; this module turns the saved question into
its plan and writes the answer back. A photo exported from a collage Azimut
stitched is read frame by frame on the bubble the pan was filmed on
(engine/frames.py): the trace drawn on the flat collage becomes the directions it
was filmed in, read through one camera of the frames' own lens.
"""

from __future__ import annotations

import functools
import json
import threading
import time
import uuid
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from .. import __version__, layout
from . import finder, horizon, skymatch, terrain, turncache, workqueue
from .media import write_json_atomic

if TYPE_CHECKING:
    from ..workspace import Case

TYPE = "horizon-find"
JOB = "horizon-find"
VERSION = 1
ACTIVE = ("queued", "running")
# Asked to stop while it runs: it stops between two points, keeping what it found.
STOPPING = "stopping"
# Kept to run later: the question only, its job never queued.
SAVED = "saved"
# A collage is read frame by frame only when at least this share of its frames were stitched: frames laid by hand are
# tied to the stitched ones by their overlaps, and many of them chained bend the pan (v11, eleven of twelve frames laid
# by hand, its truth against the 100 best places of its search: read frame by frame 97th, as one picture 12th).
FRAMES_STITCHED = 0.25
# The lens a stitch says is what joining the frames worked out, not the camera's: Find searches it this share either
# way, the frames' lens here and a strip's span in the browser (hints.js STITCHED_GIVE). Measured on the bench's five
# collages Azimut stitched (three read frame by frame), against the best places of three nights: the truth's rank 100
# to 12, 41 to 2, 160 to 4, 103 to 35 and 182 to 192, and a Quick search finds two of them first where it found none.
# A tenth either way is too little.
STITCHED_GIVE = 0.2
# The points each running search has scored, by case and name: `{ started, points }`.
LIVE: dict[tuple[str, str], dict[str, Any]] = {}
# Progress is written this often while a search runs, seconds, and the stop asked for read as often.
WRITE_EVERY = 3.0
# How hard a search works the machine (`lanes_for`): the fastest in a process for each of its own cores, a
# fast one in half the cores and this many processes at the most, a gentle one in one. Each process is
# counted at this much memory, leaving the machine this much free (light on the analyst's machine).
# Measured over 600 points of a DRC search on an 8-core laptop (16 threads): 4 processes 1.9 times as fast
# as one, 8 2.6 times, 12 no faster than 8.
SPEEDS = ("fastest", "fast", "gentle")
LANES_MAX = 4
LANE_BYTES = 400e6
SPARE_BYTES = 2e9


#: Windows waits on at most this many processes at once (`ProcessPoolExecutor` refuses more).
WINDOWS_LANES = 61


def _available_memory() -> float | None:
    """Memory the system can give, bytes: read on Linux, asked of Windows and macOS; None when
    none answers."""
    import sys

    if sys.platform == "win32":
        return _windows_available()
    if sys.platform == "darwin":
        return _darwin_available()
    try:
        with open("/proc/meminfo", encoding="ascii") as info:
            for line in info:
                if line.startswith("MemAvailable:"):
                    return float(line.split()[1]) * 1024
    except OSError:
        return None
    return None


def _windows_available() -> float | None:
    """The physical memory Windows says is free (`GlobalMemoryStatusEx`)."""
    import ctypes
    import sys

    if sys.platform != "win32":
        return None

    class Status(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
            (field, ctypes.c_ulonglong)
            for field in ("total", "available", "page_total", "page_free", "virtual_total", "virtual_free", "extended")
        ]

    status = Status()
    status.length = ctypes.sizeof(Status)
    try:
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return None
    except (AttributeError, OSError):
        return None
    return float(status.available)


def _darwin_available() -> float | None:
    """What macOS can give without swapping, read off `vm_stat`."""
    import subprocess

    try:
        said = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=5, check=False).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return _vm_stat_bytes(said)


def _vm_stat_bytes(said: str) -> float | None:
    """Free, inactive and speculative pages of a `vm_stat` answer, in bytes, or None."""
    import re

    size = re.search(r"page size of (\d+) bytes", said)
    pages = [re.search(rf"^{key}:\s+(\d+)", said, re.M) for key in ("Pages free", "Pages inactive", "Pages speculative")]
    if size is None or not any(pages):
        return None
    return float(sum(int(found.group(1)) for found in pages if found) * int(size.group(1)))


@functools.lru_cache(maxsize=1)
def cores(listed: str = "/proc/cpuinfo") -> int:
    """The machine's own cores, not their threads: counted where Linux lists them (`listed`), every one of an
    Apple chip's (one thread each), else half the threads (two a core on most others)."""
    import os
    import platform

    threads = os.cpu_count() or 1
    try:
        with open(listed, encoding="ascii", errors="replace") as info:
            ids = set()
            chip = core = ""
            for line in info:
                key, _, value = line.partition(":")
                if key.strip() == "physical id":
                    chip = value.strip()
                elif key.strip() == "core id":
                    core = value.strip()
                    ids.add((chip, core))
            if ids:
                return len(ids)
    except OSError:
        pass
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        return threads
    return max(1, threads // 2)


def lanes_for(speed: str | None) -> int:
    """How many processes a search scores in: one when gentle, one for each of the machine's own cores when
    fastest, else half the threads up to `LANES_MAX`; never more than the free memory allows, no more than
    `LANES_MAX` when the system does not say it, and no more than Windows can wait on."""
    import os
    import sys

    if speed == "gentle":
        return 1
    lanes = cores() if speed == "fastest" else min(LANES_MAX, (os.cpu_count() or 1) // 2)
    free = _available_memory()
    if free is not None:
        lanes = min(lanes, int((free - SPARE_BYTES) // LANE_BYTES))
    else:
        lanes = min(lanes, LANES_MAX)
    if sys.platform == "win32":
        lanes = min(lanes, WINDOWS_LANES)
    return max(1, lanes)


# The Mesh step's check of water in sight (finder.check_sight), one at a time: `{ id, status, done, total }`,
# the status `running`, `done`, `cancelled` or `failed` (its `error` said).
_SIGHT: dict[str, dict[str, Any]] = {}
_SIGHT_LOCK = threading.Lock()


def check_sight(ask: dict[str, Any]) -> dict[str, Any]:
    """Start checking which points of a setup's grid see the water the photo shows, stopping the check under
    way: it runs beside the case's queue, the setup needing no case."""
    plan = plan_from(ask)
    state: dict[str, Any] = {"id": uuid.uuid4().hex[:12], "status": "running", "done": 0, "total": 0, "stop": False}
    with _SIGHT_LOCK:
        before = _SIGHT.get("now")
        if before is not None:
            before["stop"] = True
        _SIGHT["now"] = state

    def tell(done: int, total: int) -> None:
        state.update(done=done, total=total)

    def work() -> None:
        try:
            finder.check_sight(plan, tell=tell, cancelled=lambda: bool(state["stop"]))
            state["status"] = "done"
        except finder.Cancelled:
            state["status"] = "cancelled"
        except terrain.TerrainUnavailable as exc:
            state.update(status="failed", error=f"The terrain could not be loaded: {exc}")

    threading.Thread(target=work, name="find-sight", daemon=True).start()
    return sight_state(state["id"])


def sight_state(check: str) -> dict[str, Any]:
    """Where a check of water in sight stands, by its id: `missing` once another took its place."""
    with _SIGHT_LOCK:
        state = _SIGHT.get("now")
        if state is None or state["id"] != check:
            return {"id": check, "status": "missing", "done": 0, "total": 0}
        return {key: state[key] for key in ("id", "status", "done", "total", "error") if key in state}


def stop_sight(check: str) -> dict[str, Any]:
    """Ask a check of water in sight to stop: what it checked by then is kept."""
    with _SIGHT_LOCK:
        state = _SIGHT.get("now")
        if state is not None and state["id"] == check:
            state["stop"] = True
    return sight_state(check)


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read(case: Case, name: str) -> dict[str, Any] | None:
    """A search as the case keeps it, or None."""
    from ..workspace import CaseError

    try:
        path = case.resolve_inside(layout.horizon_find_rel(name))
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (CaseError, OSError, ValueError):
        return None
    return saved if isinstance(saved, dict) and saved.get("azimut_horizon_find") == VERSION else None


def write(case: Case, name: str, record: dict[str, Any]) -> None:
    path = case.resolve_inside(layout.horizon_find_rel(name))
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(path, {**record, "updated_at": now()})


def new_record(name: str, ask: dict[str, Any]) -> dict[str, Any]:
    stamp = now()
    return {
        "azimut_horizon_find": VERSION,
        "title": name,
        "created_at": stamp,
        "updated_at": stamp,
        "app_version": __version__,
        "ask": ask,
        "status": "queued",
        "progress": {"done": 0, "total": 0},
        "error": "",
        "result": None,
    }


def settle_carried(folder: Path) -> int:
    """Searches a bundle carried while they were queued, running or stopping, kept as stopped:
    a bundle leaves the case's jobs behind, so nothing would ever run or stop them. What one
    had found by then is kept. How many were settled."""
    settled = 0
    for path in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(record, dict) or record.get("status") not in (*ACTIVE, STOPPING):
            continue
        record["status"] = "cancelled"
        write_json_atomic(path, record)
        settled += 1
    return settled


def stop(record: dict[str, Any]) -> None:
    """Ask a search to stop: one running stops between two points and keeps what it found, one queued at once."""
    if record.get("status") == "running":
        record["status"] = STOPPING
    elif record.get("status") == "queued":
        record["status"] = "cancelled"


def live(case: Case, name: str, since: int = 0, started: float | None = None) -> dict[str, Any]:
    """The points a running search has scored, from the `since`-th on: all of them when `started` names
    another run than the one under way. `{ started, since, points }`, no points when none runs."""
    held = LIVE.get((case.id, name))
    if held is None:
        return {"started": None, "since": 0, "points": []}
    if started != held["started"]:
        since = 0
    return {"started": held["started"], "since": since, "points": held["points"][since:]}


def _carried(record: dict[str, Any], on_disk: dict[str, Any] | None) -> dict[str, Any]:
    """The search's record with the place the analyst confirmed meanwhile, which the run never sets."""
    found = (on_disk or {}).get("found")
    if found:
        record["found"] = found
    return record


def _kept(case: Case, name: str, record: dict[str, Any]) -> bool:
    """Write a run's record over the case's copy, unless the search was deleted meanwhile;
    whether it was written. Under the case's lock, which a delete holds too, so a write
    can never bring a deleted search back as a file no entity owns."""
    with case.lock:
        on_disk = read(case, name)
        if on_disk is None:
            return False
        write(case, name, _carried(record, on_disk))
        return True


def plan_of(ask: dict[str, Any]) -> tuple[finder.Plan, finder.Trace]:
    """The search a saved question asks for."""
    return plan_from(ask), trace_from(ask)


def trace_from(ask: dict[str, Any]) -> finder.Trace:
    """The trace a saved question searches for."""
    lens = ask["trace"]
    within = lens.get("within")
    # the compass directions ticked in Find and the sun; a single sector on the trace as the match route takes it otherwise
    facing = facing_of(ask) if ask.get("facing") or ask.get("sun") else skymatch.sectors_of(lens.get("facing"))
    who = ask.get("who") or {}
    return finder.Trace(
        x=np.asarray(lens["x"], dtype=np.float64),
        y=np.asarray(lens["y"], dtype=np.float64),
        half_width=float(lens["half_width"]),
        fov=float(lens["fov"]),
        known=bool(lens.get("known")),
        within=(float(min(within)), float(max(within))) if within else None,
        projection=lens.get("projection", "camera"),
        lens_max=float(lens["lens_max"]) if lens.get("lens_max") else None,
        facing=facing,
        marks=finder.marks_of(lens),
        floor=finder.FLOOR_M,
        tilts=finder.tilts_for(str(who.get("mode", "ground")), ask.get("view") or ()),
        mirror=bool(ask.get("mirror")),
        # offered where the relief is the planet's coarse model: its cell is the one rounded to
        rounding=terrain.PLANET_DETAIL_M if ask.get("round") else None,
    )


def _middle(ask: dict[str, Any]) -> tuple[float, float]:
    corners = ask.get("area") or []
    return (
        sum(float(lat) for lat, _ in corners) / len(corners),
        sum(float(lon) for _, lon in corners) / len(corners),
    )


def sun_of(ask: dict[str, Any]) -> dict[str, Any] | None:
    """What the sun the question says reads at the area's middle (finder `sun_headings`), or None."""
    sun = ask.get("sun")
    if not sun or not ask.get("area"):
        return None
    found = finder.sun_headings(*_middle(ask), sun["date"], sun.get("start", "06:00"), sun.get("end", "18:00"), sun.get("sides") or ())
    return None if found is None else found[1]


def facing_of(ask: dict[str, Any]) -> tuple[skymatch.Sector, ...] | None:
    """The headings a question leaves to search: its compass directions and its sun, as sectors; None for
    every heading, () for none."""
    facing = finder.facing_sectors(ask.get("facing"))
    sun = ask.get("sun")
    if not sun or not ask.get("area"):
        return facing
    found = finder.sun_headings(*_middle(ask), sun["date"], sun.get("start", "06:00"), sun.get("end", "18:00"), sun.get("sides") or ())
    if found is None or not found[1]["up"]:
        return facing
    return finder.facing_with_sun(facing, found[0])


def plan_from(ask: dict[str, Any]) -> finder.Plan:
    """Where a saved question searches, by whom, on what ground and how finely: everything but the trace."""
    who = ask.get("who") or {}
    mode = who.get("mode", "ground")
    low = float(who.get("low", horizon.EYE_HEIGHT))
    high = float(who.get("high", low))
    middle = (low + high) / 2
    final = (low, middle, high) if high - low > 1e-6 else (low,)
    alignments = tuple(
        finder.Alignment(
            lat=float(one["near"]["lat"]), lon=float(one["near"]["lon"]), bearing=float(one["bearing"]),
            tolerance=float(one.get("tolerance", 1.0)),
            photo_x=None if one.get("photo_x") is None else float(one["photo_x"]),
        )
        for one in ask.get("alignments") or []
    )
    return finder.Plan(
        area=[(float(lat), float(lon)) for lat, lon in ask["area"]],
        mode=mode,
        heights=(middle,),
        final_heights=final,
        reach=None if ask.get("reach") is None else float(ask["reach"]),
        spacing=None if ask.get("spacing") is None else float(ask["spacing"]),
        alignments=alignments,
        stands=tuple(ask.get("stands") or ()),
        near=_near(ask),
        zones=tuple(
            finder.Zone(
                area=[(float(lat), float(lon)) for lat, lon in zone["area"]],
                spacing=None if zone.get("spacing") is None else float(zone["spacing"]),
                out=bool(zone.get("out")),
            )
            for zone in ask.get("zones") or []
        ),
        areas=tuple([(float(lat), float(lon)) for lat, lon in area] for area in ask.get("areas") or []),
        strokes=tuple(
            finder.Stroke(
                path=[(float(lat), float(lon)) for lat, lon in stroke["path"]],
                radius=float(stroke["radius"]),
                out=bool(stroke.get("out", True)),
            )
            for stroke in ask.get("strokes") or []
        ),
        effort=finder.EFFORTS.get(str(ask.get("effort") or "normal"), 1.0),
        # a line along the sea's horizon, said of the trace or, before it is drawn, of the ground
        sea=bool((ask.get("trace") or {}).get("sea") or ask.get("sea")),
        water=bool(ask.get("water")),
        over=ask.get("over") if ask.get("over") in ("above", "below") else None,
    )


def _near(ask: dict[str, Any]) -> float | None:
    """The nearest a traced line is said to stand, metres: from the trace, else as the question says it."""
    said = finder.said_nearest((ask.get("trace") or {}).get("far"))
    if said is not None:
        return said
    near = ask.get("near")
    return None if near is None else float(max(finder.SAID_NEAREST, float(near)))


def on_frames(
    case: Case, ask: dict[str, Any], plan: finder.Plan, trace: finder.Trace,
) -> tuple[finder.Plan, finder.Trace, dict[str, Any] | None]:
    """The search read frame by frame when its photo is a collage Azimut stitched, with what the result
    says of it: `{ collage, frames, stitched, lens, span, middle, mesh }`, `middle` the heading of the
    picture's middle from the place's and `mesh` where each point of it was read (frames.mesh); the plan
    and trace as they were otherwise.

    The trace must lie on the picture as exported: a curve or pulled corners laid over it since
    leave it read as one photo, as does a collage with no frame stitched (its lens unknown) or with fewer than
    `FRAMES_STITCHED` of its frames stitched, read as a collage laid by hand.
    """
    from . import frames, inspectwork

    photo = ask.get("photo") or {}
    if not photo.get("path") or photo.get("kind", "image") != "image" or photo.get("bend") or photo.get("corners"):
        return plan, trace, None
    found = inspectwork.frames_of(case, str(photo["path"]))
    if found is None or found[1].get("lens") is None:
        return plan, trace, None
    if found[1].get("frames") and found[1].get("stitched", 0) < FRAMES_STITCHED * found[1]["frames"]:
        return plan, trace, None
    model, said = found
    export = (float(said["export"][0]), float(said["export"][1]))
    marks = trace.marks
    ridge_x = marks.ridge_x if marks is not None else np.empty(0)
    ridge_y = marks.ridge_y if marks is not None else np.empty(0)
    reading = frames.read(model, trace.x, trace.y, ridge_x, ridge_y, export)
    if reading is None or reading.x.size < finder.skymatch.MIN_POINTS:
        return plan, trace, None
    if marks is not None:
        keep, ridge_keep = reading.kept, reading.ridge_kept
        marks = replace(
            marks,
            ridge_x=reading.ridge_x, ridge_y=reading.ridge_y,
            line=None if marks.line is None else marks.line[keep],
            ridge_line=None if marks.ridge_line is None else marks.ridge_line[ridge_keep],
            bent=None if marks.bent is None else marks.bent[keep],
            ridge_bent=None if marks.ridge_bent is None else marks.ridge_bent[ridge_keep],
            # the frames are the pieces now: each is read through its own camera already
            piece=None, ridge_piece=None,
        )
    trace = replace(
        trace, x=reading.x, y=reading.y, half_width=reading.half_width, fov=reading.lens, known=False,
        within=(reading.lens * (1 - STITCHED_GIVE), reading.lens * (1 + STITCHED_GIVE)), projection="camera",
        marks=marks,
    )
    if plan.alignments:
        # where each alignment's near point stands across the virtual camera
        lined = []
        for line, one in zip(plan.alignments, ask.get("alignments") or []):
            near = (one.get("photo") or {}).get("near")
            if not near:
                lined.append(replace(line, photo_x=None))
                continue
            px = np.array([float(near["u"]) * 2 - 1])
            py = np.array([(0.5 - float(near["v"])) * export[1] / export[0] * 2])
            at = frames.read(model, px, py, np.empty(0), np.empty(0), export)
            lined.append(replace(line, photo_x=float(at.x[0]) if at is not None and at.x.size else None))
        plan = replace(plan, alignments=tuple(lined))
    return plan, trace, {
        "collage": said["collage"], "frames": said["frames"], "stitched": said["stitched"],
        "lens": round(reading.lens, 2), "span": round(reading.span, 2), "middle": round(reading.middle, 2),
        # where each point of the collage was read, so the view lays it as the search did
        "mesh": frames.mesh(model, reading.camera, export, reading.lens),
    }


def run(case: Case, job: dict[str, Any]) -> None:
    """The queue's handler: search, writing progress as it goes and the answer at the end.

    Between points it lets the case's other work through (a thumbnail, an
    import's enrichment), so a long search holds nothing else up.
    """
    payload = job.get("payload") or {}
    name = str(payload.get("name") or "")
    started = time.time()
    with case.lock:
        record = read(case, name)
        if record is not None and record.get("status") == STOPPING:
            # asked to stop as an app restart cut it short: nothing found by then is held any more
            record.update(status="cancelled")
            write(case, name, record)
        if record is None or record.get("status") not in ACTIVE:
            raise workqueue.JobCancelled(f"search {name!r} is gone or no longer asked for")
        record.update(status="running", error="", progress={"done": 0, "total": 0, "started": started, "left": None})
        write(case, name, record)
    plan, trace = plan_of(record["ask"])
    plan, trace, framed = on_frames(case, record["ask"], plan, trace)
    clock = {"last": time.monotonic()}
    stopped = {"asked": False}
    heard: list[dict[str, Any]] = []
    LIVE[(case.id, name)] = {"started": started, "points": heard}

    def scored_one(point: dict[str, Any]) -> None:
        if point["explained"] >= 0:
            heard.append(finder.shown(point))

    def progress(done: int, total: int) -> None:
        # the time left, from this machine's own pace so far
        spent = time.time() - started
        left = round(spent / done * (total - done)) if done >= 3 else None
        record["progress"] = {"done": done, "total": total, "started": started, "left": left}
        workqueue.let_others_through(case, JOB)
        if time.monotonic() - clock["last"] >= WRITE_EVERY:
            clock["last"] = time.monotonic()
            with case.lock:
                on_disk = read(case, name)
                if on_disk is None or on_disk.get("status") in ("cancelled", STOPPING):
                    stopped["asked"] = True
                    return
                write(case, name, _carried(record, on_disk))

    try:
        result = finder.search(
            plan, trace, progress=progress, cancelled=lambda: stopped["asked"],
            lanes=lanes_for(record["ask"].get("speed")), scored_one=scored_one,
        )
    except finder.Cancelled as exc:
        turncache.sweep(since=started)
        partial = exc.result if exc.result is not None and exc.result["points"] else None
        if partial is not None and framed is not None:
            partial["frames"] = framed
        record.update(status="cancelled", result=partial)
        _kept(case, name, record)
        raise workqueue.JobCancelled(f"search {name!r} stopped") from exc
    except terrain.TerrainUnavailable as exc:
        record.update(status="failed", error=f"The terrain could not be loaded: {exc}")
        _kept(case, name, record)
        raise workqueue.JobRefused(record["error"]) from exc
    finally:
        LIVE.pop((case.id, name), None)
    # the turns this search kept, held under their budget, its first ones last to go
    turncache.sweep(since=started)
    total = record["progress"]["total"]
    if framed is not None:
        result["frames"] = framed
    record.update(status="done", result=result, progress={"done": total, "total": total, "started": started, "left": 0})
    if not _kept(case, name, record):
        raise workqueue.JobCancelled(f"search {name!r} was deleted while it ran")


def check(case: Case, record: dict[str, Any]) -> list[dict[str, Any]]:
    """Each of a finished search's places searched again with decoys of its trace, mirrored and upside
    down: what the best decoy explains there, kept on the place (`decoy`). A real place explains its
    trace far better than any decoy; where a decoy does about as well, the terrain there fits any shape.

    A selfie's search tries the mirrored trace already, so only the upside-down one is a decoy there.
    """
    plan, trace = plan_of(record["ask"])
    plan, trace, _ = on_frames(case, record["ask"], plan, trace)
    decoys = [replace(trace, y=-trace.y, mirror=False)]
    if not trace.mirror:
        decoys.append(replace(trace, x=-trace.x, mirror=False))
    sampler = terrain.Sampler(keep=finder.SEARCH_TILES)
    places = (record.get("result") or {}).get("places") or []
    for place in places:
        best = 0.0
        for decoy in decoys:
            if decoy.marks is not None:
                # the marks name the trace's own points: a decoy is judged on its skyline alone
                decoy = replace(decoy, marks=replace(
                    decoy.marks, ridge_x=np.empty(0), ridge_y=np.empty(0), pairs=(), piece=None, ridge_piece=None, clear=(),
                    key=(), bent=None, ridge_bent=None,
                ))
            scored = finder.score_point(
                float(place["lat"]), float(place["lon"]), decoy, plan, sampler=sampler, quick=False,
                heights=plan.final_heights or None,
            )
            best = max(best, float(scored["explained"]))
        place["decoy"] = round(best, 4)
    return places


def row(name: str, record: dict[str, Any]) -> dict[str, Any]:
    """What the list of searches shows of one."""
    result = record.get("result") or {}
    best = (result.get("places") or [None])[0]
    photo = (record.get("ask") or {}).get("photo") or {}
    return {
        "name": name,
        "title": record.get("title", name),
        "status": record.get("status"),
        "progress": record.get("progress"),
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
        "photo": photo.get("path"),
        "verdict": result.get("verdict"),
        "best": {k: best[k] for k in ("lat", "lon", "explained") if k in best} if best else None,
        "found": bool(record.get("found")),
    }


workqueue.register(JOB, run)
