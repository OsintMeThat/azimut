"""Portable case bundles: contents, integrity, encryption and round trip."""

from __future__ import annotations

import json
import os
import sqlite3
import zipfile
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest

from azimut import config
from azimut.engine import bundles, workqueue
from azimut.workspace import Case


@pytest.fixture()
def bundle_case(tmp_workspace, monkeypatch) -> Case:
    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Source case")
    case.create_note("Witness", "", content="# Witness\n")
    (case.trash_dir / "old").mkdir(parents=True)
    (case.trash_dir / "old" / "gone.txt").write_text("gone", encoding="utf-8")
    (case.path / "media" / ".thumbs").mkdir()
    (case.path / "media" / ".thumbs" / "cache.jpg").write_bytes(b"cache")
    (case.path / "media" / ".dl").mkdir()
    (case.path / "media" / ".dl" / "partial").write_bytes(b"partial")
    case.add_trash_group(
        "old",
        label="Gone",
        type_="note",
        item_count=1,
        size_bytes=4,
        payload={},
    )
    case.enqueue_job("test-pending", payload={"machine": "local"})
    return case


def test_plain_bundle_has_ordered_manifests_and_a_clean_database(bundle_case):
    exported = bundles.export_case(bundle_case)

    assert exported.parent == config.bundles_dir()
    assert exported.name.endswith(".azimut.zip")
    with zipfile.ZipFile(exported) as archive:
        names = archive.namelist()
        assert names[0] == bundles.HEADER_NAME
        assert names[-1] == bundles.MANIFEST_NAME
        assert not any(name.startswith(".trash/") for name in names)
        assert not any(name.startswith("media/.thumbs/") for name in names)
        assert not any(name.startswith("media/.dl/") for name in names)

        manifest = json.loads(archive.read(bundles.MANIFEST_NAME))
        assert [member["path"] for member in manifest["members"]] == names[:-1]

        extracted = config.bundles_dir() / "clean.db"
        extracted.write_bytes(archive.read("case.db"))
    with sqlite3.connect(extracted) as conn:
        assert conn.execute("SELECT COUNT(*) FROM trash").fetchone()[0] == 0
        assert conn.execute(
            "SELECT COUNT(*) FROM jobs WHERE state IN ('queued', 'running')"
        ).fetchone()[0] == 0


def test_sealed_bundle_hides_the_zip_and_rejects_a_wrong_password(bundle_case):
    exported = bundles.export_case(bundle_case, password="correct horse")

    assert exported.name.endswith(".azimut.enc")
    assert exported.read_bytes().startswith(bundles.MAGIC)
    assert not exported.read_bytes().startswith(b"PK")
    inspected = bundles.inspect_bundle(exported, password="correct horse")
    assert inspected["sealed"] is True
    assert inspected["case_name"] == "Source case"
    assert inspected["space_ok"] is True
    assert inspected["estimated_import_bytes"] >= inspected["total_size"]
    assert inspected["free_space_bytes"] > inspected["space_reserve_bytes"]
    with pytest.raises(bundles.BundleError, match="wrong password"):
        bundles.inspect_bundle(exported, password="wrong")

    hostile = config.bundles_dir() / "hostile-kdf.azimut.enc"
    data = bytearray(exported.read_bytes())
    data[16] = 31  # log2(n), authenticated only after key derivation
    hostile.write_bytes(data)
    with pytest.raises(bundles.BundleError, match="key parameters"):
        bundles.inspect_bundle(hostile, password="correct horse")


def test_sealed_chunks_detect_truncation_before_any_case_swap(bundle_case):
    payload = os.urandom(2 * bundles.CHUNK_SIZE + 123)
    (bundle_case.path / "media" / "large.bin").write_bytes(payload)
    exported = bundles.export_case(bundle_case, password="secret")
    truncated = config.bundles_dir() / "truncated.azimut.enc"
    truncated.write_bytes(exported.read_bytes()[:-1])
    destination = Case.create("Truncated import")

    with pytest.raises(bundles.BundleError, match="damaged|incomplete"):
        bundles.import_into(destination, truncated, password="secret")

    assert destination.path.exists()
    assert destination.list_entities() == []


@pytest.mark.parametrize("password", [None, "bundle secret"])
def test_export_import_round_trip_creates_a_new_case(bundle_case, password):
    exported = bundles.export_case(bundle_case, password=password)
    destination = Case.create(bundles.imported_name("Source case"))

    result = bundles.import_into(destination, exported, password=password)
    imported = Case.open(result["case_id"])

    assert imported.id != bundle_case.id
    assert imported.read()["name"] == "Source case (imported)"
    assert [entity["label"] for entity in imported.list_entities()] == ["Witness"]
    note_path = imported.list_entities()[0]["attrs"]["path"]
    assert imported.resolve_inside(note_path).read_text(encoding="utf-8") == "# Witness\n"
    with sqlite3.connect(imported.path / "case.db") as conn:
        meta = dict(conn.execute("SELECT key, value FROM meta"))
    assert meta["origin_case_id"] == bundle_case.id
    assert meta["imported_at"]


def test_export_import_round_trip_keeps_confirmed_relations(bundle_case):
    media = bundle_case.add_entity(
        "media",
        "GPS photo",
        {"path": "media/gps-photo.jpg"},
        by="user",
    )
    place = bundle_case.add_entity(
        "place",
        "Chosen place",
        {"lat": 48.858333, "lon": 2.350833},
        by="user",
    )
    relation = bundle_case.add_link(
        media["id"],
        place["id"],
        "located-at",
        by="user",
        status="confirmed",
    )

    exported = bundles.export_case(bundle_case)
    destination = Case.create(bundles.imported_name("Source case"))
    imported = Case.open(bundles.import_into(destination, exported)["case_id"])

    assert imported.get_link(relation["id"]) == relation
    assert imported.get_link(relation["id"])["provenance"]["status"] == "confirmed"


def test_manifest_is_an_allowlist_not_a_hint(bundle_case):
    exported = bundles.export_case(bundle_case)
    tampered = config.bundles_dir() / "tampered.azimut.zip"
    with zipfile.ZipFile(exported) as source, zipfile.ZipFile(tampered, "w") as target:
        for info in source.infolist()[:-1]:
            target.writestr(info, source.read(info))
        target.writestr("stowaway.txt", b"not declared")
        target.writestr(source.infolist()[-1], source.read(source.infolist()[-1]))

    destination = Case.create("Tampered import")
    with pytest.raises(bundles.BundleError, match="undeclared|do not match"):
        bundles.import_into(destination, tampered)


def test_manifest_sizes_are_checked_before_extraction(bundle_case):
    exported = bundles.export_case(bundle_case)
    tampered = config.bundles_dir() / "wrong-size.azimut.zip"
    with zipfile.ZipFile(exported) as source, zipfile.ZipFile(tampered, "w") as target:
        infos = source.infolist()
        manifest = json.loads(source.read(bundles.MANIFEST_NAME))
        record = next(item for item in manifest["members"] if item["path"] == "case.db")
        record["size"] += 1
        for info in infos[:-1]:
            target.writestr(info, source.read(info))
        target.writestr(infos[-1], json.dumps(manifest).encode())

    destination = Case.create("Wrong size import")
    with pytest.raises(bundles.BundleError, match="manifest member"):
        bundles.import_into(destination, tampered)

    assert destination.list_entities() == []


def test_bundle_header_bounds_names_and_total_sizes():
    base = {
        "format_version": bundles.BUNDLE_FORMAT,
        "case_db_schema": bundles.SQLITE_SCHEMA,
        "case_name": "Case",
        "origin_case_id": "case",
        "total_size": 0,
    }
    with pytest.raises(bundles.BundleError, match="case name"):
        bundles._validate_header({**base, "case_name": "x" * (bundles.MAX_CASE_NAME + 1)})
    with pytest.raises(bundles.BundleError, match="total size"):
        bundles._validate_header({**base, "total_size": -1})
    with pytest.raises(bundles.BundleError, match="total size"):
        bundles._validate_header({**base, "total_size": bundles.MAX_DECLARED_SIZE + 1})


@pytest.mark.parametrize(
    "names",
    [
        ["case.json", "media/../case.db"],
        ["case.json", "media/./photo.jpg"],
        ["case.json", "media/photo.jpg", "media//photo.jpg"],
        ["case.json", "media/CON.txt"],
        ["case.json", "media/photo:stream"],
        ["case.json", "media/photo. "],
    ],
)
def test_bundle_member_names_are_safe_on_every_supported_os(names):
    with pytest.raises(bundles.BundleError, match="not portable"):
        bundles._validate_member_names(names)


def test_bundle_members_cannot_alias_on_case_insensitive_filesystems():
    with pytest.raises(bundles.BundleError, match="collide"):
        bundles._validate_member_names(["media/Photo.jpg", "media/photo.jpg"])


def test_import_space_is_dynamic_instead_of_a_small_fixed_bundle_cap(
    bundle_case, monkeypatch
):
    exported = bundles.export_case(bundle_case)
    total = 40 * 1024 * 1024 * 1024
    free = 30 * 1024 * 1024 * 1024
    monkeypatch.setattr(
        bundles.shutil,
        "disk_usage",
        lambda _path: SimpleNamespace(total=total, used=total - free, free=free),
    )

    preview = bundles.inspect_bundle(exported)
    assert preview["large_bundle"] is False
    assert preview["space_ok"] is True

    free = preview["total_size"] + preview["space_reserve_bytes"] - 1
    monkeypatch.setattr(
        bundles.shutil,
        "disk_usage",
        lambda _path: SimpleNamespace(total=total, used=total - free, free=free),
    )
    preview = bundles.inspect_bundle(exported)
    assert preview["space_ok"] is False
    with pytest.raises(bundles.BundleError, match="not enough free space"):
        bundles.queue_import(exported)


def test_staged_upload_stops_before_consuming_the_disk_reserve(
    tmp_workspace, monkeypatch
):
    total = 10 * 1024 * 1024 * 1024
    reserve = bundles._disk_reserve(total)
    monkeypatch.setattr(
        bundles.shutil,
        "disk_usage",
        lambda _path: SimpleNamespace(total=total, used=total - reserve - 3, free=reserve + 3),
    )

    with pytest.raises(bundles.BundleError, match="not enough free space"):
        bundles.stage_upload(BytesIO(b"four"))

    imports = config.bundles_dir() / ".imports"
    assert list(imports.glob("*")) == []


def test_export_stops_before_consuming_the_disk_reserve(bundle_case, monkeypatch):
    total = 10 * 1024 * 1024 * 1024
    reserve = bundles._disk_reserve(total)
    monkeypatch.setattr(
        bundles.shutil,
        "disk_usage",
        lambda _path: SimpleNamespace(total=total, used=total - reserve, free=reserve),
    )

    with pytest.raises(bundles.BundleError, match="not enough free space"):
        bundles.export_case(bundle_case)

    assert not any(config.bundles_dir().glob("*.tmp"))


def test_every_top_level_case_entry_has_a_bundle_decision(bundle_case):
    assert all(
        bundles.classify_case_entry(path.name) is not None
        for path in bundle_case.path.iterdir()
    )


def test_export_cannot_escape_the_workspace_bundle_directory(bundle_case, tmp_path):
    with pytest.raises(bundles.BundleError, match="must stay"):
        bundles.export_case(bundle_case, output=tmp_path / "outside.azimut.zip")


def test_passwords_never_enter_durable_job_payloads(bundle_case):
    export_job = bundles.queue_export(bundle_case, password="export secret")
    source = bundles.export_case(bundle_case, password="import secret")
    imported, import_job = bundles.queue_import(source, password="import secret")

    assert export_job["payload"]["sealed"] is True
    assert "password" not in export_job["payload"]
    assert import_job["payload"]["sealed"] is True
    assert "password" not in import_job["payload"]
    with sqlite3.connect(bundle_case.path / "case.db") as conn:
        export_payload = conn.execute(
            "SELECT payload_json FROM jobs WHERE id = ?", (export_job["id"],)
        ).fetchone()[0]
    with sqlite3.connect(imported.path / "case.db") as conn:
        import_payload = conn.execute(
            "SELECT payload_json FROM jobs WHERE id = ?", (import_job["id"],)
        ).fetchone()[0]
    assert "export secret" not in export_payload
    assert "import secret" not in import_payload


def test_durable_export_and_import_jobs_finish_on_the_case_queue(bundle_case):
    export_job = bundles.queue_export(bundle_case)
    assert workqueue.drain(bundle_case) >= 1
    exported = Path(export_job["payload"]["output"])
    assert exported.is_file()
    assert bundle_case.get_job(export_job["id"])["state"] == "ready"

    imported, import_job = bundles.queue_import(exported)
    assert workqueue.drain(imported) == 1
    restored = Case.open(imported.id)
    assert restored.get_job(import_job["id"])["state"] == "ready"
    assert [entity["label"] for entity in restored.list_entities()] == ["Witness"]


def test_a_failed_import_removes_its_empty_case_shell(bundle_case):
    exported = bundles.export_case(bundle_case)
    tampered = config.bundles_dir() / "broken.azimut.zip"
    data = bytearray(exported.read_bytes())
    data[len(data) // 2] ^= 0xFF
    tampered.write_bytes(data)

    imported, job = bundles.queue_import(tampered)
    case_id = imported.id
    workqueue.drain(imported)

    assert not imported.path.exists()
    status = bundles.job_status(case_id, job["id"])
    assert status["state"] == "failed"


def test_browser_upload_previews_then_imports_and_removes_staging(client, bundle_case):
    exported = bundles.export_case(bundle_case, password="secret")
    response = client.post(
        "/api/cases/bundles/inspect",
        files={"file": ("source.azimut.enc", BytesIO(exported.read_bytes()), "application/octet-stream")},
        data={"password": "secret"},
    )

    assert response.status_code == 200
    preview = response.json()
    assert preview["case_name"] == "Source case"
    assert "path" not in preview
    assert preview["space_ok"] is True
    assert preview["estimated_import_bytes"] >= preview["total_size"]
    staged = bundles.uploaded_bundle(preview["upload_id"])

    started = client.post(
        "/api/cases/bundles/import",
        json={"upload_id": preview["upload_id"], "password": "secret"},
    )
    assert started.status_code == 200
    body = started.json()
    imported = Case.open(body["case_id"])
    assert workqueue.drain(imported) == 1
    assert not staged.exists()
    assert Case.open(body["case_id"]).read()["name"] == "Source case (imported)"


def test_browser_upload_can_be_discarded_and_invalid_content_is_removed(client, bundle_case):
    exported = bundles.export_case(bundle_case)
    preview = client.post(
        "/api/cases/bundles/inspect",
        files={"file": ("source.azimut.zip", exported.read_bytes(), "application/zip")},
    ).json()
    staged = bundles.uploaded_bundle(preview["upload_id"])

    discarded = client.delete(f"/api/cases/bundles/uploads/{preview['upload_id']}")
    assert discarded.status_code == 200
    assert not staged.exists()

    invalid = client.post(
        "/api/cases/bundles/inspect",
        files={"file": ("fake.zip", b"not a bundle", "application/zip")},
    )
    assert invalid.status_code == 400
    assert list((config.bundles_dir() / ".imports").glob("*.bundle")) == []


def test_ready_export_downloads_as_an_attachment(client, bundle_case):
    started = client.post(
        f"/api/cases/{bundle_case.id}/bundle/export",
        json={"password": None},
    )
    assert started.status_code == 200
    job_id = started.json()["job_id"]
    assert "output" not in started.json()
    assert workqueue.drain(bundle_case) >= 1

    status = client.get(f"/api/cases/{bundle_case.id}/bundle/jobs/{job_id}")
    assert "payload" not in status.json()
    response = client.get(
        f"/api/cases/{bundle_case.id}/bundle/jobs/{job_id}/download"
    )
    assert response.status_code == 200
    assert response.content.startswith(b"PK")
    assert "attachment;" in response.headers["content-disposition"]
    assert ".azimut.zip" in response.headers["content-disposition"]


def test_abandoned_browser_uploads_expire(bundle_case):
    upload_id, staged = bundles.stage_upload(BytesIO(b"old upload"))
    os.utime(staged, (0, 0))

    bundles.cleanup_uploads(now=bundles.UPLOAD_MAX_AGE + 1)

    assert not staged.exists()
    with pytest.raises(bundles.BundleError, match="not found"):
        bundles.uploaded_bundle(upload_id)
