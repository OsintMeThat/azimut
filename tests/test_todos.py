"""Case checklist persistence, validation, concurrency and portable bundles."""

from copy import deepcopy

import pytest

from azimut.engine import bundles
from azimut.workspace import Case


def checklist():
    return {"revision": 0, "lists": [
        {"id": "first", "name": "Checks", "tasks": [
            {"id": "task", "text": "Verify source", "done": False},
        ]},
        {"id": "second", "name": "Follow up", "tasks": []},
    ]}


def test_checklist_lifecycle_and_case_isolation(client):
    cid = client.post("/api/cases", json={"name": "Checklist"}).json()["id"]
    other = client.post("/api/cases", json={"name": "Other case"}).json()["id"]
    url = f"/api/cases/{cid}/todos"
    initial = client.get(url).json()
    assert initial == {"revision": 0, "lists": [{"id": "default", "name": "Tasks", "tasks": []}]}
    assert "todos" not in Case.open(cid).read()  # viewing an old case needs no migration
    saved = client.put(url, json=checklist()).json()
    assert saved["revision"] == 1
    saved["lists"][0]["tasks"][0].update(text="Verify original source", done=True)
    saved["lists"][1]["name"] = "Contacts"
    saved = client.put(url, json=saved).json()
    assert Case.open(cid).read_todos() == saved
    assert client.get(f"/api/cases/{other}/todos").json() == initial
    assert client.put(url, json=checklist()).status_code == 409
    assert client.get(url).json() == saved
    saved["lists"][0]["tasks"] = []
    saved = client.put(url, json=saved).json()
    saved["lists"] = []
    assert client.put(url, json=saved).json()["lists"] == []
    assert Case.open(cid).list_entities() == []


@pytest.mark.parametrize("change", [
    lambda data: data["lists"][0].update(name="   "),
    lambda data: data["lists"][0]["tasks"][0].update(text=" "),
    lambda data: data["lists"][0]["tasks"][0].update(text="x" * 2001),
    lambda data: data["lists"].append(deepcopy(data["lists"][0])),
    lambda data: data["lists"][0]["tasks"].append(deepcopy(data["lists"][0]["tasks"][0])),
    lambda data: data.update(revision=-1),
    lambda data: data["lists"][0].update(id="../escape"),
    lambda data: data["lists"][0].update(tasks=[{"id": str(i), "text": "Check"} for i in range(201)]),
    lambda data: data.update(lists=[{"id": str(i), "name": "List"} for i in range(51)]),
])
def test_invalid_checklist_does_not_change_case(client, change):
    cid = client.post("/api/cases", json={"name": "Validation"}).json()["id"]
    data = checklist()
    change(data)
    assert client.put(f"/api/cases/{cid}/todos", json=data).status_code == 422
    assert Case.open(cid).read_todos()["revision"] == 0


def test_checklists_survive_bundle_round_trip(client):
    cid = client.post("/api/cases", json={"name": "Portable tasks"}).json()["id"]
    data = checklist()
    data["lists"][0]["tasks"][0]["done"] = True
    saved = client.put(f"/api/cases/{cid}/todos", json=data).json()
    exported = bundles.export_case(Case.open(cid))
    destination = Case.create("Imported tasks")
    bundles.import_into(destination, exported)
    assert Case.open(destination.id).read_todos() == saved


def test_missing_case_does_not_create_checklist(client):
    assert client.get("/api/cases/missing/todos").status_code == 404
    assert client.put("/api/cases/missing/todos", json=checklist()).status_code == 404


def test_scratch_cleanup_keeps_checklists(tmp_workspace):
    case = Case.create("Scratch tasks", scratch=True)
    case.write_todos(checklist())
    data = case.read()
    data["updated_at"] = "2000-01-01T00:00:00Z"
    import json

    case.json_path.write_text(json.dumps(data), encoding="utf-8")
    assert Case.cleanup_scratch() == 0
    assert Case.open(case.id).read_todos()["lists"] == checklist()["lists"]
