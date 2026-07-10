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


def start(kind: str, work: Callable[[Callable[[dict[str, Any]], None]], Any]) -> str:
    """Run `work(set_progress)` in a thread; returns the job id."""
    job_id = uuid.uuid4().hex[:12]
    with _lock:
        _jobs[job_id] = {"id": job_id, "kind": kind, "status": "running", "progress": {}}

    def set_progress(progress: dict[str, Any]) -> None:
        with _lock:
            if job_id in _jobs:
                _jobs[job_id]["progress"] = progress

    def runner() -> None:
        try:
            result = work(set_progress)
            with _lock:
                _jobs[job_id].update(status="done", result=result)
        except Exception as exc:  # surfaced to the UI, not swallowed
            with _lock:
                _jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=runner, daemon=True).start()
    return job_id


def get(job_id: str) -> dict[str, Any] | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None
