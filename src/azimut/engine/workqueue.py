"""The durable background work queue (doc "Thumbnail and background-job model"),
generalised beyond thumbnails.

Each case owns a `jobs` table; this module is the single consumer of it. A job
kind registers one handler, and **one** worker thread drains one case at a time
across every kind. That single-worker rule is not just about CPU (ffmpeg must not
run several times at once) — it is also what serialises handlers that write the
same media sidecar. Do not widen it to a pool without giving those writes their
own locking.

Settlement is central, so a handler only decides *what happened*:

- returns normally -> the job is `ready`
- raises `JobCancelled` -> the work no longer applies (its media is gone); the
  job is dropped without burning the retry budget on something that cannot
  succeed
- raises `JobFailed`, or anything unexpected -> the job is recorded failed and
  retried until its attempt budget is spent

Work only ever starts from a user action (an import, a regenerate, a backfill)
or from crash recovery — never from merely opening a case or a tab.
"""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from ..workspace import Case as CaseType

Handler = Callable[["CaseType", dict[str, Any]], None]

#: kind -> handler. Producers register at import time (see engine/thumbnails.py
#: and engine/enrich.py); a kind with no handler is a job nothing can run, so it
#: is cancelled rather than retried.
HANDLERS: dict[str, Handler] = {}


class JobCancelled(Exception):
    """The job's subject is gone or no longer applies. Drop it."""


class JobFailed(Exception):
    """The job failed this time and deserves another attempt."""


class JobRemoved(Exception):
    """The handler removed its owning case, so no row remains to settle."""


def register(kind: str, handler: Handler) -> None:
    HANDLERS[kind] = handler


def enqueue(
    case: "CaseType",
    kind: str,
    *,
    key: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Queue one job and wake the worker. A ``key`` makes the enqueue idempotent:
    re-queueing the same (kind, key) returns the pending job instead of stacking
    a duplicate."""
    job = case.enqueue_job(kind, key=key, payload=payload or {})
    wake(case)
    return job


def has_queued(case: "CaseType") -> bool:
    """True when the case has work waiting, of any kind."""
    return bool(case.list_jobs(state="queued"))


def _settle(case: "CaseType", job: dict[str, Any]) -> bool:
    """Settle one job. ``True`` means the handler removed the owning case."""
    handler = HANDLERS.get(job["kind"])
    if handler is None:
        case.cancel_job(job["id"])
        return False
    try:
        handler(case, job)
    except JobRemoved:
        return True
    except JobCancelled:
        case.cancel_job(job["id"])
    except JobFailed as exc:
        case.fail_job(job["id"], str(exc))
    except Exception as exc:  # a handler bug must not stall the queue
        case.fail_job(job["id"], f"{type(exc).__name__}: {exc}")
    else:
        case.complete_job(job["id"])
    return False


def drain(case: "CaseType") -> int:
    """Process every queued job for one case, one at a time, in the calling
    thread. Returns how many jobs were handled. Synchronous and deterministic —
    the worker loop and the tests both call it."""
    handled = 0
    while True:
        job = case.claim_job()
        if job is None:
            return handled
        removed = _settle(case, job)
        handled += 1
        if removed:
            return handled


# -- the single background worker -----------------------------------------

_worker_lock = threading.Lock()
_pending: dict[str, "CaseType"] = {}
_worker_running = False

# When False, `wake` does not start the background thread — the queue is drained
# explicitly instead (tests, and any caller that wants deterministic draining).
start_workers = True


def _run_loop() -> None:
    global _worker_running
    while True:
        with _worker_lock:
            if not _pending:
                _worker_running = False
                return
            case_id, case = next(iter(_pending.items()))
        try:
            drain(case)
        except Exception:  # a worker must never die on one case's failure
            pass
        with _worker_lock:
            _pending.pop(case_id, None)


def wake(case: "CaseType") -> None:
    """Ensure the single background worker is draining ``case``'s queue. A no-op
    if the case is already pending."""
    global _worker_running
    if not start_workers:
        return
    with _worker_lock:
        _pending[case.id] = case
        if _worker_running:
            return
        _worker_running = True
    threading.Thread(target=_run_loop, name="azimut-worker", daemon=True).start()


def wait_until_idle(timeout: float = 5.0) -> bool:
    """Wait for the shared worker to finish its current queue, if any.

    Useful for orderly shutdown and for callers that need to move a case
    directory after queuing work. It never interrupts active work; ``False``
    means the caller's timeout elapsed first.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with _worker_lock:
            if not _worker_running:
                return True
        time.sleep(0.01)
    # One last look: the worker may have finished during the final sleep, and
    # reporting a timeout for work that is actually done would have the caller
    # refuse to move a case directory it is now free to move.
    with _worker_lock:
        return not _worker_running
