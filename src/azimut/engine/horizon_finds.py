"""A search for where a photo was taken, kept in the case as it runs.

A search is case work in `.horizon/finds/<name>.json`: what was asked (the photo
and its trace, the area, the alignments, who took it, the settings), its status
and progress while it runs, and once done every point scored and the best
places, so the heatmap comes back without searching again. It runs on the case's
background queue (engine/workqueue.py) as Detect's runs do: started only by the
analyst's press, stopped by theirs, and a search an app restart cut short starts
again from the beginning.

The search itself is engine/finder.py; this module turns the saved question into
its plan and writes the answer back.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

import numpy as np

from .. import __version__, layout
from . import finder, horizon, terrain, workqueue
from .media import write_json_atomic

if TYPE_CHECKING:
    from ..workspace import Case

TYPE = "horizon-find"
JOB = "horizon-find"
VERSION = 1
ACTIVE = ("queued", "running")
# Progress is written this often while a search runs, seconds, and the stop asked for read as often.
WRITE_EVERY = 3.0


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
    who = ask.get("who") or {}
    mode = who.get("mode", "ground")
    low = float(who.get("low", horizon.EYE_HEIGHT))
    high = float(who.get("high", low))
    middle = (low + high) / 2
    final = (low, middle, high) if high - low > 1e-6 else (low,)
    lens = ask["trace"]
    within = lens.get("within")
    facing = lens.get("facing")
    trace = finder.Trace(
        x=np.asarray(lens["x"], dtype=np.float64),
        y=np.asarray(lens["y"], dtype=np.float64),
        half_width=float(lens["half_width"]),
        fov=float(lens["fov"]),
        known=bool(lens.get("known")),
        within=(float(min(within)), float(max(within))) if within else None,
        projection=lens.get("projection", "camera"),
        facing=(float(facing[0]), float(facing[1])) if facing else None,
    )
    alignments = tuple(
        finder.Alignment(
            lat=float(one["near"]["lat"]), lon=float(one["near"]["lon"]), bearing=float(one["bearing"]),
            tolerance=float(one.get("tolerance", 1.0)),
            photo_x=None if one.get("photo_x") is None else float(one["photo_x"]),
        )
        for one in ask.get("alignments") or []
    )
    plan = finder.Plan(
        area=[(float(lat), float(lon)) for lat, lon in ask["area"]],
        mode=mode,
        heights=(middle,),
        final_heights=final,
        reach=None if ask.get("reach") is None else float(ask["reach"]),
        spacing=None if ask.get("spacing") is None else float(ask["spacing"]),
        alignments=alignments,
    )
    return plan, trace


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
        result = finder.search(plan, trace, progress=progress, cancelled=lambda: stopped["asked"])
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
    record.update(status="done", result=result, progress={"done": total, "total": total, "started": started, "left": 0})
    write(case, name, record)


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
