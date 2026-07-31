"""One Azimut per workspace, across processes.

The exclusion tests use a real child process, because that is the only way to
test the property the design rests on: the operating system drops the lock when
the holder dies, so a crash can never leave a workspace bolted shut. Simulating
it in-process would test `flock`'s same-process semantics, which differ between
Linux and Windows and are not what the app relies on.

The payload tests are in-process, because a foreign machine is not something a
child can be — a hand-written payload is exactly what a synced folder delivers.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import textwrap
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from azimut.engine import workspacelock
from azimut.engine.workspacelock import WorkspaceBusy

SRC = str(Path(__file__).resolve().parents[1] / "src")


@pytest.fixture(autouse=True)
def release_between_tests():
    workspacelock.release()
    yield
    workspacelock.release()


@pytest.fixture()
def workspace(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    (tmp_path / ".azimut").mkdir()
    return tmp_path


def _payload(root: Path) -> dict:
    return json.loads(workspacelock.lock_path(root).read_text(encoding="utf-8"))


def _write_payload(root: Path, **fields) -> None:
    workspacelock.lock_path(root).write_text(json.dumps(fields), encoding="utf-8")


def _holder_process(root: Path) -> subprocess.Popen:
    """A child that takes the lock and keeps it until it is killed."""
    child = subprocess.Popen(
        [
            sys.executable,
            "-c",
            textwrap.dedent(
                f"""
                import os, sys, time
                sys.path.insert(0, {SRC!r})
                os.environ["AZIMUT_HOME"] = {str(root)!r}
                from azimut.engine import workspacelock
                workspacelock.acquire(8477)
                print("held", flush=True)
                time.sleep(60)
                """
            ),
        ],
        stdout=subprocess.PIPE,
        text=True,
    )
    assert child.stdout is not None
    assert child.stdout.readline().strip() == "held", "the child never took the lock"
    return child


# -- another process -----------------------------------------------------------


def test_a_second_instance_is_refused_and_names_the_holder(workspace):
    child = _holder_process(workspace)
    try:
        with pytest.raises(WorkspaceBusy) as refused:
            workspacelock.acquire(8478)
    finally:
        child.kill()
        child.wait(timeout=10)

    assert refused.value.holder["pid"] == child.pid
    assert refused.value.holder["host"] == socket.gethostname()
    assert "8477" in str(refused.value)


def test_the_lock_dies_with_the_process(workspace):
    """The whole reason it is an OS lock rather than a file we write and delete:
    a crashed Azimut must never leave a workspace nobody can open."""
    child = _holder_process(workspace)
    child.kill()
    child.wait(timeout=10)

    workspacelock.acquire(8478)  # no exception: the OS let go on its own

    assert workspacelock.holder() is None


def test_a_clean_exit_leaves_no_payload_to_age(workspace):
    child = _holder_process(workspace)
    child.terminate()
    child.wait(timeout=10)

    # The child's atexit-free path still releases via the OS; what matters is
    # that the next run can take it without judging a corpse.
    workspacelock.acquire(8478)

    assert _payload(workspace)["pid"] == os.getpid()


# -- another machine, seen through a synced folder -----------------------------


def test_a_beating_heart_on_another_machine_is_believed(workspace):
    """On a share where `flock` is a no-op, the payload is all there is. A lock
    we *could* take is still refused when someone else is plainly using it."""
    _write_payload(workspace, host="other-laptop", pid=999, port=8477, at=workspacelock._now())

    with pytest.raises(WorkspaceBusy, match="other-laptop"):
        workspacelock.acquire(8478)


def test_a_stopped_heart_on_another_machine_is_taken_over(workspace):
    gone = datetime.now(timezone.utc) - timedelta(
        seconds=workspacelock.STALE_AFTER_SECONDS + 60
    )
    _write_payload(
        workspace, host="other-laptop", pid=999, at=gone.isoformat(timespec="seconds")
    )

    workspacelock.acquire(8478)

    assert _payload(workspace)["host"] == socket.gethostname()


def test_our_own_crashed_run_is_taken_over_whatever_its_heartbeat_says(workspace):
    """On this machine the OS lock is the authority. Being granted it proves the
    process that wrote this payload is gone, however recent the timestamp."""
    _write_payload(workspace, host=socket.gethostname(), pid=999, at=workspacelock._now())

    workspacelock.acquire(8478)

    assert _payload(workspace)["pid"] == os.getpid()


def test_an_unreadable_lock_file_never_stops_the_app(workspace):
    workspacelock.lock_path(workspace).write_bytes(b"\x00\xff not json at all")

    workspacelock.acquire(8478)

    assert _payload(workspace)["pid"] == os.getpid()


def test_the_analyst_can_overrule_the_verdict(workspace):
    """Two machines' clocks disagree, and a sync client can leave a file nobody
    is left to clear. Without this, either would make a workspace unopenable."""
    _write_payload(workspace, host="other-laptop", pid=999, at=workspacelock._now())

    workspacelock.take_over(8478)

    assert _payload(workspace)["host"] == socket.gethostname()


def test_forcing_past_a_process_that_really_holds_it_still_reports_the_truth(workspace):
    """Forcing rewrites the payload; it cannot steal the OS lock, and does not
    pretend to. The escape hatch is for ghosts, not for races."""
    child = _holder_process(workspace)
    try:
        workspacelock.take_over(8478)
        assert _payload(workspace)["pid"] == os.getpid()
    finally:
        child.kill()
        child.wait(timeout=10)


# -- holding, releasing, heartbeat ---------------------------------------------


def test_holding_it_is_idempotent(workspace):
    workspacelock.acquire(8477)
    workspacelock.acquire(8477)

    assert workspacelock.holder() is None


def test_releasing_clears_the_payload(workspace):
    workspacelock.acquire(8477)

    workspacelock.release()

    assert _payload(workspace) == {}
    assert workspacelock.holder() is None


def test_the_heartbeat_is_refreshed_while_it_is_held(workspace, monkeypatch):
    monkeypatch.setattr(workspacelock, "HEARTBEAT_SECONDS", 0.05)
    workspacelock.acquire(8477)
    first = _payload(workspace)["at"]

    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and _payload(workspace)["at"] == first:
        time.sleep(0.05)

    assert _payload(workspace)["at"] != first


def test_two_workspaces_do_not_block_each_other(monkeypatch, tmp_path):
    """A work workspace and a personal one are two folders, so two locks."""
    first, second = tmp_path / "work", tmp_path / "personal"
    monkeypatch.setenv("AZIMUT_HOME", str(first))
    workspacelock.acquire(8477)

    monkeypatch.setenv("AZIMUT_HOME", str(second))
    workspacelock.acquire(8477)

    assert workspacelock.holder() is None
    assert _payload(first) == {}, "the first lock should have been given back"


def test_a_folder_can_be_asked_about_before_it_is_adopted(workspace, tmp_path):
    """What the Settings dialog needs: the lock of a folder that is not ours."""
    elsewhere = tmp_path / "elsewhere"
    (elsewhere / ".azimut").mkdir(parents=True)
    _write_payload(elsewhere, host="other-laptop", pid=999, at=workspacelock._now())

    assert workspacelock.holder(elsewhere)["host"] == "other-laptop"
    assert workspacelock.holder(workspace) is None


def test_a_folder_with_no_lock_file_is_free(tmp_path):
    assert workspacelock.holder(tmp_path / "never-used") is None


def test_the_locking_primitive_is_chosen_by_what_imports(workspace, monkeypatch):
    """Not by `sys.platform`, which other tests fake to exercise Windows paths —
    and which would then have this module reach for a module that isn't there.
    A platform with neither primitive degrades to the payload rather than
    raising from inside a lock attempt."""
    monkeypatch.setattr("sys.platform", "win32")
    workspacelock.acquire(8477)  # would have raised ModuleNotFoundError

    workspacelock.release()
    monkeypatch.setattr(workspacelock, "fcntl", None)
    monkeypatch.setattr(workspacelock, "msvcrt", None)

    workspacelock.acquire(8477)

    assert _payload(workspace)["pid"] == os.getpid()
