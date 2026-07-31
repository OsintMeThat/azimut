"""The Case Doctor diagnoses damage first and repairs only on request."""

import io
import json

from azimut import layout
from azimut.engine import workqueue
from azimut.workspace import Case


def _new_case(client, name="Doctor case"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _upload(client, case_id, name="evidence.txt", content=b"evidence"):
    result = client.post(
        f"/api/cases/{case_id}/media/upload",
        files={"file": (name, io.BytesIO(content), "text/plain")},
    ).json()
    assert workqueue.wait_until_idle(timeout=10)
    return result


def test_healthy_case_has_no_doctor_findings(client):
    case_id = _new_case(client)

    report = client.get(f"/api/cases/{case_id}/doctor").json()

    assert report["status"] == "healthy"
    assert report["issues"] == []
    assert report["summary"] == {"errors": 0, "warnings": 0, "info": 0}


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
        f"/api/cases/{case_id}/doctor/repair",
        json={"action": "import", "path": "notes.md"},
    ).status_code == 409
    assert client.post(
        f"/api/cases/{case_id}/doctor/repair",
        json={"action": "drop", "entity_id": uploaded["entity"]["id"]},
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
