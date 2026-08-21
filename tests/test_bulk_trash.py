"""A multi-selection is one delete action and one restore group."""

import shutil

import pytest

from azimut.api.cases import delete_entities_deep
from azimut.engine import trash
from azimut.workspace import Case


def test_multi_delete_is_one_trash_group(tmp_workspace):
    case = Case.create("Bulk delete")
    first = case.create_note("First", "", "one")
    second = case.create_note("Second", "", "two")

    deleted = delete_entities_deep(case, [first["id"], second["id"]])

    assert set(deleted["deleted"]) == {first["id"], second["id"]}
    groups = case.list_trash()
    assert len(groups) == 1
    assert groups[0]["item_count"] == 2
    assert not case.resolve_inside(first["attrs"]["path"]).exists()
    assert not case.resolve_inside(second["attrs"]["path"]).exists()

    restored = trash.restore(case, deleted["trash"])
    assert restored["entities"] == 2
    assert case.resolve_inside(first["attrs"]["path"]).read_text(encoding="utf-8") == "one"
    assert case.resolve_inside(second["attrs"]["path"]).read_text(encoding="utf-8") == "two"


def test_the_route_deletes_a_selection_as_one_undoable_act(client):
    """The Board's ticked rows and the organizer's selected tiles come this way.

    One request, one trash group, one Undo: sending a row per click would put the
    selection back a row at a time, which is the same as having no way back.
    """
    case_id = client.post("/api/cases", json={"name": "Ticked rows"}).json()["id"]
    ids = [
        client.post(
            f"/api/cases/{case_id}/entities",
            json={"type": "person", "label": name},
        ).json()["id"]
        for name in ("First", "Second", "Third")
    ]

    deleted = client.post(f"/api/cases/{case_id}/entities/delete", json={"ids": ids[:2]}).json()

    assert set(deleted["deleted"]) == set(ids[:2])
    listed = client.get(f"/api/cases/{case_id}/trash").json()
    assert len(listed["groups"]) == 1
    assert listed["items"] == 2

    restored = client.post(f"/api/cases/{case_id}/trash/{deleted['trash']}/restore")
    assert restored.status_code == 200
    held = client.get(f"/api/cases/{case_id}/catalog/entities").json()["items"]
    assert {row["id"] for row in held} == set(ids)


def test_the_route_refuses_a_selection_holding_an_unknown_row(client):
    """Nothing goes if one id does not resolve: half a delete is the worst answer,
    since the analyst would have to work out which half."""
    case_id = client.post("/api/cases", json={"name": "Stale tick"}).json()["id"]
    kept = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "person", "label": "Kept"}
    ).json()["id"]

    answer = client.post(f"/api/cases/{case_id}/entities/delete", json={"ids": [kept, "e_gone"]})

    assert answer.status_code == 404
    held = client.get(f"/api/cases/{case_id}/catalog/entities").json()["items"]
    assert [row["id"] for row in held] == [kept]
    assert client.get(f"/api/cases/{case_id}/trash").json()["items"] == 0


def test_recovery_rolls_back_an_interrupted_delete(tmp_workspace):
    case = Case.create("Interrupted delete")
    note = case.create_note("Note", "", "kept")

    group = trash.send(case, [note], [])
    assert case.list_trash() == []
    assert not case.resolve_inside(note["attrs"]["path"]).exists()

    trash.recover(case)

    assert case.get_entity(note["id"]) is not None
    assert case.resolve_inside(note["attrs"]["path"]).read_text(encoding="utf-8") == "kept"
    assert case.get_trash_group(group["id"]) is None


def test_recovery_publishes_a_delete_after_the_graph_rows_are_gone(tmp_workspace):
    case = Case.create("Interrupted commit")
    note = case.create_note("Note", "", "kept")

    group = trash.send(case, [note], [])
    case.remove_entity(note["id"])
    trash.recover(case)

    assert case.get_entity(note["id"]) is None
    assert case.list_trash()[0]["id"] == group["id"]
    assert not case.resolve_inside(note["attrs"]["path"]).exists()


def test_recovery_finishes_a_partially_moved_restore(tmp_workspace):
    case = Case.create("Interrupted restore")
    note = case.create_note("Note", "", "kept")
    deleted = delete_entities_deep(case, [note["id"]])
    rel = note["attrs"]["path"]
    # The file waits under its numbered slot, and the journal is what pairs the
    # two — so a half-finished restore is simulated by moving the slot back.
    payload = case.get_trash_group(deleted["trash"])["payload"]
    slot = payload["slots"][payload["files"].index(rel)]
    source = case.trash_dir / deleted["trash"] / slot
    destination = case.resolve_inside(rel)

    case.update_trash_group(deleted["trash"], state="restoring")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(source, destination)
    trash.recover(case)

    assert case.get_entity(note["id"]) is not None
    assert destination.read_text(encoding="utf-8") == "kept"
    assert case.get_trash_group(deleted["trash"]) is None


def test_purge_keeps_the_journal_when_windows_refuses_the_delete(
    tmp_workspace, monkeypatch
):
    case = Case.create("Locked trash")
    note = case.create_note("Note", "", "kept")
    deleted = delete_entities_deep(case, [note["id"]])

    with monkeypatch.context() as patch:
        patch.setattr(
            trash.shutil,
            "rmtree",
            lambda _path, **_kwargs: (_ for _ in ()).throw(PermissionError("locked")),
        )
        with pytest.raises(PermissionError, match="locked"):
            trash.purge(case, deleted["trash"])

        assert case.list_trash()[0]["id"] == deleted["trash"]
