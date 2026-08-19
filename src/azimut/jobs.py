"""Tiny in-memory job registry for long-running work (downloads, …).

POST endpoints start a job in a thread and return its id; the UI polls
GET /api/jobs/{id}. Local single-user app — no persistence needed.
"""

from __future__ import annotations

import threading
import uuid
from typing import Any, Callable

_jobs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()

# Finished jobs kept for late polls; older ones are dropped when a new job
# starts, so a long session doesn't grow the registry without bound.
MAX_FINISHED = 100


def _evict_finished() -> None:
    """Drop the oldest finished jobs past MAX_FINISHED. Call under _lock."""
    finished = [jid for jid, job in _jobs.items() if job["status"] != "running"]
    for jid in finished[: max(0, len(finished) - MAX_FINISHED)]:
        del _jobs[jid]


def start(kind: str, work: Callable[..., Any], *, stoppable: bool = False) -> str:
    """Run `work(set_progress)` in a thread; returns the job id.

    ``stoppable`` calls it as ``work(set_progress, stopping)`` instead, where
    ``stopping()`` answers whether somebody has pressed cancel. A job that takes
    it is promising to check between units of work and to leave the unit it was
    part-way through unwritten — which is the only kind of cancellation this
    registry can offer, since a thread cannot be interrupted from outside.
    """
    job_id = uuid.uuid4().hex[:12]
    with _lock:
        _evict_finished()
        _jobs[job_id] = {"id": job_id, "kind": kind, "status": "running", "progress": {}}

    def set_progress(progress: dict[str, Any]) -> None:
        with _lock:
            if job_id in _jobs:
                _jobs[job_id]["progress"] = progress

    def stopping() -> bool:
        return cancelled(job_id)

    def runner() -> None:
        try:
            result = work(set_progress, stopping) if stoppable else work(set_progress)
            with _lock:
                _jobs[job_id].update(status="done", result=result)
        except Exception as exc:  # surfaced to the UI, not swallowed
            with _lock:
                _jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=runner, daemon=True).start()
    return job_id


def cancel(job_id: str) -> bool:
    """Ask a running job to stop at its next safe point. Answers whether it heard.

    A flag, never a kill: the work decides where stopping is safe, and for the one
    job that takes it that is between two rows.
    """
    with _lock:
        job = _jobs.get(job_id)
        if not job or job["status"] != "running":
            return False
        job["cancelled"] = True
        return True


def cancelled(job_id: str) -> bool:
    with _lock:
        return bool((_jobs.get(job_id) or {}).get("cancelled"))


def get(job_id: str) -> dict[str, Any] | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None
