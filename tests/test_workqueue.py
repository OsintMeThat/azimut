"""The generic durable worker: one registry of kind -> handler, one thread, and
central settlement of every claimed job.

The queue is drained explicitly here (`start_workers = False`) so ordering is
deterministic and no background thread outlives a test.
"""

from __future__ import annotations

import threading
import time

import pytest

from azimut.engine import workqueue
from azimut.workspace import Case


@pytest.fixture()
def case(tmp_workspace, monkeypatch):
    monkeypatch.setattr(workqueue, "start_workers", False)
    monkeypatch.setattr(workqueue, "HANDLERS", dict(workqueue.HANDLERS))
    return Case.create("Queue")


def test_drain_runs_the_handler_registered_for_each_kind(case):
    seen: list[tuple[str, str]] = []
    workqueue.register("alpha", lambda c, job: seen.append(("alpha", job["payload"]["n"])))
    workqueue.register("beta", lambda c, job: seen.append(("beta", job["payload"]["n"])))

    workqueue.enqueue(case, "alpha", payload={"n": "1"})
    workqueue.enqueue(case, "beta", payload={"n": "2"})

    assert workqueue.drain(case) == 2
    assert seen == [("alpha", "1"), ("beta", "2")]
    assert [j["state"] for j in case.list_jobs()] == ["ready", "ready"]


def test_a_handler_raising_job_cancelled_drops_the_job_without_retrying(case):
    def handler(c, job):
        raise workqueue.JobCancelled("nothing to do")

    workqueue.register("alpha", handler)
    workqueue.enqueue(case, "alpha", payload={})

    assert workqueue.drain(case) == 1
    job = case.list_jobs(kind="alpha")[0]
    assert job["state"] == "cancelled"
    assert job["attempts"] == 1


def test_a_failing_handler_retries_until_the_attempt_budget_is_spent(case):
    attempts = []

    def handler(c, job):
        attempts.append(job["id"])
        raise workqueue.JobFailed("boom")

    workqueue.register("alpha", handler)
    workqueue.enqueue(case, "alpha", payload={})

    workqueue.drain(case)  # claims, fails, requeues, up to the budget
    job = case.list_jobs(kind="alpha")[0]
    assert job["state"] == "failed"
    assert job["error"] == "boom"
    assert len(attempts) == job["max_attempts"]


def test_a_job_of_an_unknown_kind_is_cancelled_not_left_running(case):
    workqueue.enqueue(case, "gamma", payload={})

    assert workqueue.drain(case) == 1
    assert case.list_jobs(kind="gamma")[0]["state"] == "cancelled"


def test_has_queued_reports_work_of_any_kind(case):
    workqueue.register("alpha", lambda c, job: None)
    assert workqueue.has_queued(case) is False
    workqueue.enqueue(case, "alpha", payload={})
    assert workqueue.has_queued(case) is True
    workqueue.drain(case)
    assert workqueue.has_queued(case) is False


@pytest.mark.parametrize("operation", ["delete", "promote"])
def test_moving_a_case_directory_waits_for_the_background_worker(
    tmp_workspace, monkeypatch, operation
):
    """A job writes inside the case folder, so moving that folder while the worker
    is still in it is how ``Directory not empty`` happens on POSIX and an outright
    refusal happens on Windows.

    This one runs a real worker thread (no ``start_workers = False``): the race is
    the point, and draining by hand would test nothing. Enrichment is what made the
    window wide enough to hit — probing a video takes far longer than writing a
    thumbnail — but the two operations that move a directory are the fix's place,
    not one job kind.
    """
    monkeypatch.setattr(workqueue, "HANDLERS", dict(workqueue.HANDLERS))
    case = Case.create("Doomed", scratch=operation == "promote")
    started = threading.Event()

    def slow(c, job):
        started.set()
        time.sleep(0.3)  # wide enough that an un-drained move lands mid-job
        (c.path / "media").mkdir(parents=True, exist_ok=True)
        (c.path / "media" / "late.json").write_text("{}", encoding="utf-8")

    workqueue.register("slow", slow)
    workqueue.enqueue(case, "slow", payload={})
    workqueue.wake(case)
    assert started.wait(2), "the worker never picked the job up"

    if operation == "delete":
        case.delete()
        assert not case.path.exists()
    else:
        moved = case.promote("Promoted")
        # the file the worker wrote travelled with the case rather than being
        # stranded in a half-moved directory
        assert (moved.path / "media" / "late.json").exists()

    # the operation returned only once the worker was out, so nothing is left
    # writing into a path that no longer exists
    assert workqueue.wait_until_idle(timeout=0) is True


def test_wait_until_idle_looks_once_more_after_the_deadline(case, monkeypatch):
    """A worker that finishes during the final sleep is idle. Reporting a timeout
    for work that is done would have the caller refuse to move a case directory it
    is now free to move."""
    monkeypatch.setattr(workqueue, "_worker_running", False)

    assert workqueue.wait_until_idle(timeout=0) is True

    monkeypatch.setattr(workqueue, "_worker_running", True)
    assert workqueue.wait_until_idle(timeout=0) is False
