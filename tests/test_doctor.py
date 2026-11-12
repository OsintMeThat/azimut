"""The Case Doctor diagnoses damage first and repairs only on request."""

import base64
import io
import json
import sqlite3
from contextlib import closing

import pytest

from azimut import layout
from jobwait import WAIT
from azimut.engine import media as media_engine
from azimut.engine import renames as rename_engine
from azimut.engine import workqueue
from azimut.workspace import Case

from fullcase import _png


def _new_case(client, name="Doctor case"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _upload(client, case_id, name="evidence.txt", content=b"evidence"):
    result = client.post(
        f"/api/cases/{case_id}/media/upload",
        files={"file": (name, io.BytesIO(content), "text/plain")},
    ).json()
    assert workqueue.wait_until_idle(timeout=WAIT)
    return result


def test_healthy_case_has_no_doctor_findings(client):
    case_id = _new_case(client)

    report = client.get(f"/api/cases/{case_id}/doctor").json()

    assert report["status"] == "healthy"
    assert report["issues"] == []
    assert report["summary"] == {"errors": 0, "warnings": 0, "info": 0}


def test_stale_timeline_index_is_diagnosed_then_explicitly_rebuilt(client):
    case_id = _new_case(client, "Stale Timeline")
    claim = client.post(
        f"/api/cases/{case_id}/entities",
        json={
            "type": "claim",
            "label": "The vessel arrived",
            "attrs": {"when": "2026-08-11T10:32:14.5Z", "time_role": "observed"},
        },
    ).json()
    case = Case.open(case_id)
    with closing(sqlite3.connect(case.db_path)) as conn:
        conn.execute(
            "UPDATE temporal_items SET earliest = ? WHERE owner_id = ?",
            ("2026-08-11T10:32:14.5Z", claim["id"]),
        )
        conn.commit()

    report = client.get(f"/api/cases/{case_id}/doctor").json()

    issue = next(item for item in report["issues"] if item["kind"] == "temporal-index-stale")
    assert issue["actions"] == [
        {
            "id": "rebuild-timeline",
            "label": "Rebuild Timeline index",
            "tone": "primary",
        }
    ]
    with closing(sqlite3.connect(case.db_path)) as conn:
        assert conn.execute(
            "SELECT earliest FROM temporal_items WHERE owner_id = ?", (claim["id"],)
        ).fetchone()[0] == "2026-08-11T10:32:14.5Z"

    repaired = client.post(
        f"/api/cases/{case_id}/doctor/repair",
        json={"action": "rebuild-timeline"},
    ).json()

    assert repaired["repair"]["status"] == "rebuilt"
    assert repaired["report"]["status"] == "healthy"
    with closing(sqlite3.connect(case.db_path)) as conn:
        assert conn.execute(
            "SELECT earliest FROM temporal_items WHERE owner_id = ?", (claim["id"],)
        ).fetchone()[0] == "2026-08-11T10:32:14.500000Z"


def test_deleted_database_can_be_rebuilt_from_file_backed_artifacts(client):
    case_id = _new_case(client, "Rebuildable")
    uploaded = _upload(client, case_id, "Street clip.txt")
    client.post(
        f"/api/cases/{case_id}/notes",
        json={"title": "Witness note", "folder": "Leads", "content": "Body"},
    )
    case = Case.open(case_id)
    proof_meta = case.resolve_inside(f"proofs/{layout.META_DIR}")
    proof_meta.mkdir(parents=True, exist_ok=True)
    proof_meta.joinpath("Timeline.json").write_text(
        json.dumps({"azimut_proof": 1, "title": "Timeline", "panels": []}),
        encoding="utf-8",
    )
    case.resolve_inside("proofs/Timeline.png").write_bytes(b"rendered proof")
    case.db_path.unlink()

    listed = next(item for item in client.get("/api/cases").json() if item["id"] == case_id)
    assert listed["health"] == "needs-attention"
    assert listed["entity_count"] is None
    report = client.get(f"/api/cases/{case_id}/doctor").json()
    issue = report["issues"][0]
    assert issue["kind"] == "database-missing"
    assert issue["actions"] == [
        {"id": "rebuild", "label": "Rebuild database", "tone": "primary"}
    ]
    assert "Relations between entities" in issue["losses"]
    assert not case.db_path.exists()  # diagnosis stayed read-only

    repaired = client.post(
        f"/api/cases/{case_id}/doctor/repair",
        json={"action": "rebuild"},
    ).json()

    assert repaired["repair"]["counts"] == {"media": 1, "notes": 1, "proofs": 1}
    assert repaired["report"]["status"] == "healthy"
    rebuilt = Case.open(case_id)
    entities = rebuilt.list_entities()
    assert {(item["type"], item["label"]) for item in entities} == {
        ("media", "Street clip"),
        ("note", "Witness note"),
        ("proof", "Timeline"),
    }
    media = next(item for item in entities if item["type"] == "media")
    assert media["attrs"]["path"] == uploaded["item"]["path"]
    assert media["provenance"]["by"] == "case-doctor"


def test_missing_media_can_be_relinked_without_replacing_its_entity(client):
    case_id = _new_case(client)
    uploaded = _upload(client, case_id, "Original.txt")
    entity_id = uploaded["entity"]["id"]
    case = Case.open(case_id)
    original = case.resolve_inside(uploaded["item"]["path"])
    original.unlink()
    replacement = case.media_dir / "Replacement.txt"
    replacement.write_bytes(b"replacement")

    report = client.get(f"/api/cases/{case_id}/doctor").json()
    missing = next(issue for issue in report["issues"] if issue["kind"] == "media-missing")
    unknown = next(issue for issue in report["issues"] if issue["kind"] == "media-unknown")
    assert {action["id"] for action in missing["actions"]} == {"relink", "drop"}
    assert missing["state"] == "missing"
    assert missing["replacements"] == ["media/Replacement.txt"]
    assert unknown["actions"][0]["id"] == "import"

    repaired = client.post(
        f"/api/cases/{case_id}/doctor/repair",
        json={
            "action": "relink",
            "entity_id": entity_id,
            "replacement": "media/Replacement.txt",
        },
    ).json()

    assert repaired["report"]["status"] == "healthy"
    entity = Case.open(case_id).get_entity(entity_id)
    assert entity is not None
    assert entity["label"] == "Replacement"
    assert entity["attrs"]["path"] == "media/Replacement.txt"


def test_missing_media_record_can_be_explicitly_removed(client):
    case_id = _new_case(client)
    uploaded = _upload(client, case_id)
    Case.open(case_id).resolve_inside(uploaded["item"]["path"]).unlink()

    repaired = client.post(
        f"/api/cases/{case_id}/doctor/repair",
        json={"action": "drop", "entity_id": uploaded["entity"]["id"]},
    ).json()

    assert repaired["repair"]["status"] == "deleted"
    assert repaired["report"]["status"] == "healthy"


def test_file_dropped_into_media_is_imported_only_after_explicit_action(client):
    case_id = _new_case(client)
    case = Case.open(case_id)
    dropped = case.media_dir / "Hand dropped.txt"
    dropped.write_bytes(b"manual")
    database_before = case.db_path.read_bytes()

    report = client.get(f"/api/cases/{case_id}/doctor").json()
    assert report["issues"][0]["kind"] == "media-unknown"
    assert Case.open(case_id).list_entities() == []
    assert case.db_path.read_bytes() == database_before
    assert not case.resolve_inside("media/.meta/Hand dropped.txt.json").exists()

    repaired = client.post(
        f"/api/cases/{case_id}/doctor/repair",
        json={"action": "import", "path": "media/Hand dropped.txt"},
    ).json()

    assert repaired["report"]["status"] == "healthy"
    entity = Case.open(case_id).list_entities()[0]
    assert entity["label"] == "Hand dropped"
    assert entity["provenance"]["by"] == "case-doctor"


def test_doctor_refuses_repairs_that_the_current_damage_does_not_offer(client):
    case_id = _new_case(client)
    uploaded = _upload(client, case_id)

    assert client.post(
        f"/api/cases/{case_id}/doctor/repair", json={"action": "rebuild"}
    ).status_code == 409
    assert client.post(
        f"/api/cases/{case_id}/doctor/repair", json={"action": "rebuild-timeline"}
    ).status_code == 409
    assert client.post(
        f"/api/cases/{case_id}/doctor/repair",
        json={"action": "import", "path": "notes.md"},
    ).status_code == 409
    assert client.post(
        f"/api/cases/{case_id}/doctor/repair",
        json={"action": "drop", "entity_id": uploaded["entity"]["id"]},
    ).status_code == 409
    assert client.post(
        f"/api/cases/{case_id}/doctor/repair", json={"action": "finish-rename"}
    ).status_code == 409


def test_case_renamed_outside_azimut_is_found_from_its_manifest(client):
    case_id = _new_case(client, "Original folder")
    case = Case.open(case_id)
    renamed = case.path.with_name("renamed-by-user")
    case.path.rename(renamed)

    assert client.get(f"/api/cases/{case_id}/doctor").status_code == 404
    report = client.get("/api/cases/renamed-by-user/doctor").json()
    assert report["status"] == "healthy"
    assert report["case_name"] == "Original folder"
    assert client.get("/api/cases/renamed-by-user").status_code == 200


def test_scratch_case_uses_the_same_doctor_and_rebuild(client):
    case_id = client.post("/api/cases/scratch").json()["id"]
    case = Case.open(case_id)
    case.db_path.unlink()

    report = client.get(f"/api/cases/{case_id}/doctor").json()
    assert report["scratch"] is True
    assert report["issues"][0]["kind"] == "database-missing"

    repaired = client.post(
        f"/api/cases/{case_id}/doctor/repair", json={"action": "rebuild"}
    ).json()
    assert repaired["report"]["status"] == "healthy"
    assert repaired["report"]["scratch"] is True


def test_the_rebuild_states_every_loss_and_leaves_no_photo_behind(client):
    """A rebuild reads files, so anything that lived only in `case.db` is gone.

    The dialog has to say so before the analyst chooses it, and the private photos
    have to go with the rows that owned them: kept, they would be files nothing
    displays, nothing deletes and every later bundle still carries.
    """
    case_id = _new_case(client, "Photo loss")
    subject = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": "person", "label": "Unknown subject"},
    ).json()
    added = client.post(
        f"/api/cases/{case_id}/entities/{subject['id']}/images/upload",
        files={"file": ("portrait.png", io.BytesIO(_png()), "image/png")},
    )
    assert added.status_code == 200, added.text
    case = Case.open(case_id)
    photo = case.resolve_inside(added.json()["images"][0]["path"])
    assert photo.is_file()
    case.db_path.unlink()

    issue = client.get(f"/api/cases/{case_id}/doctor").json()["issues"][0]
    assert issue["losses"] == [
        "Relations between entities",
        "Catalog filing folders",
        "Provenance that was not stored in a sidecar",
        "Entity photo galleries, and the photos added from the computer",
        "Saved analysis views",
        "The graph arrangement, per lens",
    ]
    assert photo.is_file()  # naming the loss changed nothing

    client.post(f"/api/cases/{case_id}/doctor/repair", json={"action": "rebuild"})

    assert not photo.exists()
    assert not layout.entity_images(case.path).exists()
    assert client.get(f"/api/cases/{case_id}/doctor").json()["status"] == "healthy"


def test_a_rebuilt_case_is_shaped_like_a_new_one(client):
    """The birth-state gate, from the other direction: after a rebuild the tool root
    holds nothing a fresh case would not, so no orphan survives the repair."""
    case_id = _new_case(client, "Shape after repair")
    subject = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": "organization", "label": "Northwind"},
    ).json()
    client.post(
        f"/api/cases/{case_id}/entities/{subject['id']}/images/upload",
        files={"file": ("logo.png", io.BytesIO(_png()), "image/png")},
    )
    case = Case.open(case_id)
    case.db_path.unlink()
    client.post(f"/api/cases/{case_id}/doctor/repair", json={"action": "rebuild"})

    born = Case.open(client.post("/api/cases", json={"name": "Newborn"}).json()["id"])

    def tree(root):
        return sorted(
            path.relative_to(root).as_posix()
            for path in root.rglob("*")
            if path.name != "case.db"
        )

    assert tree(Case.open(case_id).tool_root) == tree(born.tool_root)


# -- a rename cut short ------------------------------------------------------------------


def _proof(client, case_id, title):
    saved = client.post(f"/api/cases/{case_id}/proofs", json={
        "title": title, "spec": {"panels": []}, "png_base64": base64.b64encode(_png()).decode(),
    })
    assert saved.status_code == 200, saved.text
    return saved.json()


def _lock_the_picture(monkeypatch):
    """The proof's picture held open by another program, as Windows refuses to move it:
    the rename stops once its record moved, and every open after it stops there too.
    Answers the switch that lets it go."""
    real = rename_engine._move
    held = {"locked": True}

    def move(case, source_rel, target_rel, *, main):
        if held["locked"] and source_rel.endswith(".png"):
            raise PermissionError(f"the file '{source_rel}' is in use by another program")
        return real(case, source_rel, target_rel, main=main)

    monkeypatch.setattr(rename_engine, "_move", move)
    return held


def _cut_issues(report):
    return [one for one in report["issues"] if one["kind"] == "rename-cut-short"]


def test_a_rename_cut_short_is_named_and_finished_on_request(client, monkeypatch):
    case_id = _new_case(client)
    saved = _proof(client, case_id, "Depot")
    post = client.post(f"/api/cases/{case_id}/drafts", json={"title": "Strike", "state": {"proofPng": saved["png"]}})
    held = _lock_the_picture(monkeypatch)
    spec = client.get(f"/api/cases/{case_id}/proofs/Depot").json()
    with pytest.raises(PermissionError):
        client.post(f"/api/cases/{case_id}/proofs", json={"rename_from": "Depot", "title": "Fuel depot", "spec": spec})
    Case.open(case_id)  # the next open tries to finish it, and stops at the same file

    [issue] = _cut_issues(client.get(f"/api/cases/{case_id}/doctor").json())
    assert issue["title"] == "A rename was cut short"
    assert issue["detail"] == "Proof “Depot” to “Fuel depot”"
    assert issue["actions"] == [{"id": "finish-rename", "label": "Finish rename", "tone": "primary"}]

    # still held: the repair says why, and the issue stands
    refused = client.post(f"/api/cases/{case_id}/doctor/repair", json={"action": "finish-rename"})
    assert refused.status_code == 409
    assert "in use by another program" in refused.json()["detail"]
    assert _cut_issues(client.get(f"/api/cases/{case_id}/doctor").json())

    held["locked"] = False
    repaired = client.post(f"/api/cases/{case_id}/doctor/repair", json={"action": "finish-rename"})
    assert repaired.status_code == 200, repaired.text
    assert repaired.json()["repair"] == {"status": "finished"}
    assert repaired.json()["report"]["status"] == "healthy"
    assert Case.open(case_id).resolve_inside("proofs/Fuel depot.png").is_file()
    state = client.get(f"/api/cases/{case_id}/drafts/{post.json()['name']}").json()["state"]
    assert state["proofPng"] == "proofs/Fuel depot.png"


def test_a_file_rename_cut_short_names_the_file(client, monkeypatch):
    case_id = _new_case(client)
    path = _upload(client, case_id)["item"]["path"]
    real = media_engine.rename_path

    def locked(source, target):
        raise PermissionError("the file is in use by another program")

    monkeypatch.setattr(media_engine, "rename_path", locked)
    with pytest.raises(PermissionError):
        client.patch(f"/api/cases/{case_id}/media", json={"path": path, "title": "Report"})

    [issue] = _cut_issues(client.get(f"/api/cases/{case_id}/doctor").json())
    assert issue["detail"] == "File “evidence.txt” to “Report.txt”"

    monkeypatch.setattr(media_engine, "rename_path", real)
    repaired = client.post(f"/api/cases/{case_id}/doctor/repair", json={"action": "finish-rename"})
    assert repaired.status_code == 200, repaired.text
    assert not _cut_issues(repaired.json()["report"])
    assert Case.open(case_id).resolve_inside("media/Report.txt").is_file()


def test_a_rename_journal_that_cannot_be_read_is_named_without_a_repair(client):
    case_id = _new_case(client)
    rename_engine.record_journal(Case.locate(case_id)).write_text("{not json", encoding="utf-8")

    [issue] = _cut_issues(client.get(f"/api/cases/{case_id}/doctor").json())
    assert issue["detail"] == "What it was renaming cannot be read."
    assert issue["actions"] == []
    refused = client.post(f"/api/cases/{case_id}/doctor/repair", json={"action": "finish-rename"})
    assert refused.status_code == 409
    assert refused.json()["detail"] == "a rename journal is unreadable"
