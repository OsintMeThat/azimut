"""The generic durable worker: one registry of kind -> handler, one thread, and
central settlement of every claimed job.

The queue is drained explicitly here (`start_workers = False`) so ordering is
deterministic and no background thread outlives a test.
"""

from __future__ import annotations

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
