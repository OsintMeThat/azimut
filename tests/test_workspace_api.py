"""The workspace-folder routes, and the two states that close the app down.

A configured folder that is gone and a workspace being copied are the same
answer to a case route: 503, with the recovery routes still reachable so the
browser can say what happened and offer the way out.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from azimut import config
from azimut.engine import workspacemove
from azimut.workspace import Case


@pytest.fixture(autouse=True)
def forget_the_last_move():
    workspacemove._move = None
    yield
    workspacemove._move = None


@pytest.fixture()
def pointed_client(monkeypatch, tmp_path):
    """A client whose workspace is found through the pointer, as in the field.

    The ``client`` fixture pins ``AZIMUT_HOME``, which deliberately overrides
    the pointer — it would hide every effect these routes have.
    """
    monkeypatch.delenv("AZIMUT_HOME", raising=False)
    root = tmp_path / "home" / "Azimut"
    root.mkdir(parents=True)
    config.write_pointer(root)
    from azimut.server import create_app

    with TestClient(create_app(), base_url="http://127.0.0.1") as client:
        yield client, root


def _wait_for_the_move(client, timeout: float = 20.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        move = client.get("/api/settings/workspace").json()["move"]
        if move and move["done"]:
            return move
        time.sleep(0.01)
    raise AssertionError("the move never finished")


def test_the_status_names_the_folder_and_its_cases(pointed_client):
    client, root = pointed_client
    Case.create("Harbour survey")

    body = client.get("/api/settings/workspace").json()

    assert body["root"] == str(root)
    assert body["cases"] == 1
    assert body["pointed"] is True
    assert body["move"] is None


def test_inspecting_a_folder_reports_rather_than_fails(pointed_client, tmp_path):
    client, root = pointed_client

    body = client.post(
        "/api/settings/workspace/inspect", json={"path": str(root / "inside")}
    ).json()

    assert body["ok"] is False
    assert body["problems"] == ["that folder is inside the current workspace"]


def test_inspecting_touches_nothing(pointed_client, tmp_path):
    client, _root = pointed_client
    target = tmp_path / "never-created"

    client.post("/api/settings/workspace/inspect", json={"path": str(target)})

    assert not target.exists()


def test_using_a_folder_switches_without_moving_anything(pointed_client, tmp_path):
    client, root = pointed_client
    Case.create("Harbour survey")
    fresh = tmp_path / "fresh"

    body = client.post("/api/settings/workspace/use", json={"path": str(fresh)}).json()

    assert body["root"] == str(fresh)
    assert body["cases"] == 0
    assert (root / "harbour-survey").is_dir()
    assert client.get("/api/cases").json() == []


def test_using_a_refused_folder_is_a_conflict(pointed_client):
    client, root = pointed_client

    response = client.post("/api/settings/workspace/use", json={"path": str(root)})

    assert response.status_code == 409
    assert "already the workspace" in response.json()["detail"]


def test_going_back_to_the_default_folder(pointed_client):
    client, _root = pointed_client

    body = client.post("/api/settings/workspace/default").json()

    assert body["pointed"] is False
    assert config.read_pointer() is None


def test_moving_the_workspace_end_to_end(pointed_client, tmp_path):
    client, root = pointed_client
    Case.create("Harbour survey")
    target = tmp_path / "volume" / "Azimut"

    queued = client.post("/api/settings/workspace/move", json={"path": str(target)})
    assert queued.status_code == 200
    move = _wait_for_the_move(client)

    assert not move["error"]
    assert client.get("/api/settings/workspace").json()["root"] == str(target)
    assert [row["name"] for row in client.get("/api/cases").json()] == ["Harbour survey"]

    removed = client.post("/api/settings/workspace/discard-old")

    assert removed.status_code == 200
    assert not (root.parent / f"{root.name}.old-{time.strftime('%Y-%m-%d')}").exists()


def test_discarding_nothing_is_a_conflict(pointed_client):
    client, _root = pointed_client

    response = client.post("/api/settings/workspace/discard-old")

    assert response.status_code == 409


def test_a_move_onto_an_existing_workspace_is_a_conflict(pointed_client, tmp_path):
    client, _root = pointed_client
    other = tmp_path / "other"
    (other / ".azimut").mkdir(parents=True)

    response = client.post("/api/settings/workspace/move", json={"path": str(other)})

    assert response.status_code == 409


# -- the two closed states -----------------------------------------------------


def test_a_workspace_that_is_gone_stops_the_app_without_recreating_it(pointed_client):
    """The drive was unplugged, or the folder renamed. Recreating it silently is
    how someone concludes they lost everything."""
    client, root = pointed_client
    import shutil

    shutil.rmtree(root)

    refused = client.get("/api/cases")

    assert refused.status_code == 503
    assert refused.json()["workspace"] == "missing"
    assert not root.exists()


def test_the_recovery_routes_stay_reachable_when_the_workspace_is_gone(pointed_client, tmp_path):
    client, root = pointed_client
    import shutil

    shutil.rmtree(root)

    status = client.get("/api/settings/workspace")

    assert status.status_code == 200
    assert status.json()["missing"] is True
    assert client.get("/api/health").status_code == 200

    adopted = client.post("/api/settings/workspace/use", json={"path": str(tmp_path / "again")})

    assert adopted.status_code == 200
    assert client.get("/api/cases").status_code == 200


def test_a_workspace_another_azimut_holds_is_left_alone(monkeypatch, tmp_path):
    """Not "stopped because the folder is missing" — the folder is fine, it just
    isn't ours. Nothing is migrated and nothing is written."""
    import json

    from azimut.engine import workspacelock

    monkeypatch.delenv("AZIMUT_HOME", raising=False)
    root = tmp_path / "shared" / "Azimut"
    (root / ".azimut").mkdir(parents=True)
    workspacelock.lock_path(root).write_text(
        json.dumps({"host": "other-laptop", "pid": 4321, "port": 8477, "at": workspacelock._now()}),
        encoding="utf-8",
    )
    config.write_pointer(root)
    from azimut.server import create_app

    with TestClient(create_app(), base_url="http://127.0.0.1") as client:
        refused = client.get("/api/cases")

        assert refused.status_code == 503
        assert refused.json()["workspace"] == "locked"
        assert "other-laptop" in refused.json()["detail"]

        status = client.get("/api/settings/workspace").json()
        assert status["locked_by"]["host"] == "other-laptop"
        assert "other-laptop" in status["locked_detail"]
        assert not config.settings_path().exists(), "a locked workspace must not be written to"

        taken = client.post("/api/settings/workspace/take")

        assert taken.status_code == 200
        assert taken.json()["locked_by"] is None
        assert client.get("/api/cases").status_code == 200
        assert config.settings_path().exists()


def test_the_tab_comes_back_when_the_other_azimut_closes(monkeypatch, tmp_path):
    """"Close the other Azimut and reload" has to actually work. The lock is
    retried on the next request rather than decided once at startup — but a
    workspace this process never opened is one whose migrations never ran, so
    the retry opens it before serving anything."""
    import json

    from azimut.engine import workspacelock

    monkeypatch.delenv("AZIMUT_HOME", raising=False)
    root = tmp_path / "shared" / "Azimut"
    (root / ".azimut").mkdir(parents=True)
    lock = workspacelock.lock_path(root)
    lock.write_text(
        json.dumps({"host": "other-laptop", "pid": 4321, "at": workspacelock._now()}),
        encoding="utf-8",
    )
    config.write_pointer(root)
    from azimut.server import create_app

    with TestClient(create_app(), base_url="http://127.0.0.1") as client:
        assert client.get("/api/cases").status_code == 503

        lock.write_text("{}", encoding="utf-8")  # the other one exited

        assert client.get("/api/cases").status_code == 200
        assert config.settings_path().exists(), "the workspace was opened, not just unlocked"


def test_case_work_is_refused_while_the_workspace_is_being_moved(
    pointed_client, tmp_path, monkeypatch
):
    client, _root = pointed_client
    reached = {"copying": False}
    real_copy = workspacemove._step_copy

    def slow_copy(move, staging):
        reached["copying"] = True
        time.sleep(0.4)
        real_copy(move, staging)

    monkeypatch.setattr(workspacemove, "_step_copy", slow_copy)
    client.post("/api/settings/workspace/move", json={"path": str(tmp_path / "volume")})
    while not reached["copying"]:
        time.sleep(0.01)

    refused = client.get("/api/cases")

    assert refused.status_code == 503
    assert refused.json()["workspace"] == "moving"
    assert client.get("/api/settings/workspace").status_code == 200

    _wait_for_the_move(client)
