"""The in-memory job registry: finished jobs are evicted, running ones never."""

import threading

from azimut import jobs


def test_start_evicts_old_finished_jobs_but_keeps_running_ones(monkeypatch):
    registry = {}
    monkeypatch.setattr(jobs, "_jobs", registry)
    monkeypatch.setattr(jobs, "MAX_FINISHED", 3)

    for i in range(5):
        registry[f"done{i}"] = {"id": f"done{i}", "kind": "t", "status": "done", "progress": {}}
    registry["busy"] = {"id": "busy", "kind": "t", "status": "running", "progress": {}}

    finished = threading.Event()
    job_id = jobs.start("t", lambda set_progress: finished.set())
    assert finished.wait(timeout=5)

    # the two oldest finished jobs were dropped; running and recent ones stay
    assert "done0" not in registry and "done1" not in registry
    assert all(key in registry for key in ("done2", "done3", "done4", "busy", job_id))


def test_get_reports_completion(monkeypatch):
    monkeypatch.setattr(jobs, "_jobs", {})
    finished = threading.Event()

    def work(set_progress):
        set_progress({"percent": 50})
        finished.set()
        return {"answer": 42}

    job_id = jobs.start("t", work)
    assert finished.wait(timeout=5)
    for _ in range(200):  # the runner thread updates status after `finished`
        job = jobs.get(job_id)
        if job["status"] == "done":
            break
        threading.Event().wait(0.01)
    assert job["status"] == "done"
    assert job["result"] == {"answer": 42}
