"""A search for where a photo was taken, kept in the case as it runs.

A search is case work in `.horizon/finds/<name>.json`: what was asked (the photo
and its trace, the area, the alignments, who took it, the settings), its status
and progress while it runs, and once done every point scored and the best
places, so the heatmap comes back without searching again. It runs on the case's
background queue (engine/workqueue.py) as Detect's runs do: started only by the
analyst's press, stopped by theirs, and a search an app restart cut short starts
again from the beginning.

The search itself is engine/finder.py; this module turns the saved question into
its plan and writes the answer back. A photo exported from a collage Azimut
stitched is read frame by frame on the bubble the pan was filmed on
(engine/frames.py): the trace drawn on the flat collage becomes the directions it
was filmed in, read through one camera of the frames' own lens.
"""

from __future__ import annotations

import json
import time
from dataclasses import replace
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

import numpy as np

from .. import __version__, layout
from . import finder, horizon, skymatch, terrain, workqueue
from .media import write_json_atomic

if TYPE_CHECKING:
    from ..workspace import Case

TYPE = "horizon-find"
JOB = "horizon-find"
VERSION = 1
ACTIVE = ("queued", "running")
# Progress is written this often while a search runs, seconds, and the stop asked for read as often.
WRITE_EVERY = 3.0
# A fast search scores its grid in this many processes at the most, half the cores, each counted at this
# much memory, leaving the machine this much free (light on the analyst's machine).
LANES_MAX = 4
LANE_BYTES = 400e6
SPARE_BYTES = 2e9


def _available_memory() -> float | None:
    """Memory the system can give, bytes, where it says (Linux); None elsewhere."""
    try:
        with open("/proc/meminfo", encoding="ascii") as info:
            for line in info:
                if line.startswith("MemAvailable:"):
                    return float(line.split()[1]) * 1024
    except OSError:
        return None
    return None


def lanes_for(speed: str | None) -> int:
    """How many processes a search scores in: one when gentle, else up to `LANES_MAX`, half the cores, as
    the free memory allows."""
    import os

    if speed == "gentle":
        return 1
    lanes = min(LANES_MAX, (os.cpu_count() or 1) // 2)
    free = _available_memory()
    if free is not None:
        lanes = min(lanes, int((free - SPARE_BYTES) // LANE_BYTES))
    return max(1, lanes)


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
        facing=facing,
        marks=finder.marks_of(lens),
        floor=finder.FLOOR_M,
        tilts=finder.tilts_for(str(who.get("mode", "ground")), ask.get("view") or ()),
        mirror=bool(ask.get("mirror")),
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
    says of it: `{ collage, frames, stitched, lens, span, middle }`, `middle` the heading of the
    picture's middle from the place's; the plan and trace as they were otherwise.

    The trace must lie on the picture as exported: a curve or pulled corners laid over it since
    leave it read as one photo, as does a collage with no frame stitched (its lens unknown).
    """
    from . import frames, inspectwork

    photo = ask.get("photo") or {}
    if not photo.get("path") or photo.get("kind", "image") != "image" or photo.get("bend") or photo.get("corners"):
        return plan, trace, None
    found = inspectwork.frames_of(case, str(photo["path"]))
    if found is None or found[1].get("lens") is None:
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
            # the frames are the pieces now: each is read through its own camera already
            piece=None, ridge_piece=None,
        )
    trace = replace(
        trace, x=reading.x, y=reading.y, half_width=reading.half_width, fov=reading.lens, known=True,
        within=None, projection="camera", marks=marks,
    )
    if plan.alignments:
        # where each alignment's near point stands across the virtual camera, the lens now known
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
    }


def run(case: Case, job: dict[str, Any]) -> None:
    """The queue's handler: search, writing progress as it goes and the answer at the end.

    Between points it lets the case's other work through (a thumbnail, an
    import's enrichment), so a long search holds nothing else up.
    """
    payload = job.get("payload") or {}
    name = str(payload.get("name") or "")
    record = read(case, name)
    if record is None or record.get("status") not in ACTIVE:
        raise workqueue.JobCancelled(f"search {name!r} is gone or no longer asked for")
    started = time.time()
    record.update(status="running", error="", progress={"done": 0, "total": 0, "started": started, "left": None})
    write(case, name, record)
    plan, trace = plan_of(record["ask"])
    plan, trace, framed = on_frames(case, record["ask"], plan, trace)
    clock = {"last": time.monotonic()}
    stopped = {"asked": False}

    def progress(done: int, total: int) -> None:
        # the time left, from this machine's own pace so far
        spent = time.time() - started
        left = round(spent / done * (total - done)) if done >= 3 else None
        record["progress"] = {"done": done, "total": total, "started": started, "left": left}
        workqueue.let_others_through(case, JOB)
        if time.monotonic() - clock["last"] >= WRITE_EVERY:
            clock["last"] = time.monotonic()
            on_disk = read(case, name)
            if on_disk is None or on_disk.get("status") == "cancelled":
                stopped["asked"] = True
                return
            write(case, name, record)

    try:
        result = finder.search(
            plan, trace, progress=progress, cancelled=lambda: stopped["asked"],
            lanes=lanes_for(record["ask"].get("speed")),
        )
    except finder.Cancelled as exc:
        if read(case, name) is not None:
            record.update(status="cancelled")
            write(case, name, record)
        raise workqueue.JobCancelled(f"search {name!r} stopped") from exc
    except terrain.TerrainUnavailable as exc:
        record.update(status="failed", error=f"The terrain could not be loaded: {exc}")
        write(case, name, record)
        raise workqueue.JobRefused(record["error"]) from exc
    if read(case, name) is None:
        raise workqueue.JobCancelled(f"search {name!r} was deleted while it ran")
    total = record["progress"]["total"]
    if framed is not None:
        result["frames"] = framed
    record.update(status="done", result=result, progress={"done": total, "total": total, "started": started, "left": 0})
    write(case, name, record)


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
                decoy = replace(decoy, marks=replace(decoy.marks, ridge_x=np.empty(0), ridge_y=np.empty(0), pairs=(), piece=None, ridge_piece=None))
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
    }


workqueue.register(JOB, run)
