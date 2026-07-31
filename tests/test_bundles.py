"""Portable case bundles: contents, integrity, encryption and round trip."""

from __future__ import annotations

import json
import os
import sqlite3
import zipfile
from contextlib import closing
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest

from azimut import config, layout
from azimut.engine import bundles, workqueue
from azimut.workspace import Case


@pytest.fixture()
def bundle_case(tmp_workspace, monkeypatch) -> Case:
    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Source case")
    case.create_note("Witness", "", content="# Witness\n")
    (case.trash_dir / "old").mkdir(parents=True)
    (case.trash_dir / "old" / "gone.txt").write_text("gone", encoding="utf-8")
    (case.subdir("media") / ".thumbs").mkdir()
    (case.subdir("media") / ".thumbs" / "cache.jpg").write_bytes(b"cache")
    (case.subdir("media") / ".dl").mkdir()
    (case.subdir("media") / ".dl" / "partial").write_bytes(b"partial")
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


def test_clean_database_closes_every_sqlite_handle(monkeypatch, tmp_path):
    connections: list[SimpleNamespace] = []

    def connect(_path):
        connection = SimpleNamespace(closed=False)
        connection.backup = lambda _target: None
        connection.execute = lambda _sql: None
        connection.commit = lambda: None
        connection.close = lambda: setattr(connection, "closed", True)
        connections.append(connection)
        return connection

    monkeypatch.setattr(bundles.sqlite3, "connect", connect)

    bundles._clean_database(tmp_path / "source.db", tmp_path / "target.db")

    assert len(connections) == 3
    assert all(connection.closed for connection in connections)


def test_plain_bundle_has_ordered_manifests_and_a_clean_database(bundle_case):
    exported = bundles.export_case(bundle_case)

    assert exported.parent == config.bundles_dir()
    assert exported.name.endswith(".azimut.zip")
    with zipfile.ZipFile(exported) as archive:
        names = archive.namelist()
        assert names[0] == bundles.HEADER_NAME
        assert names[-1] == bundles.MANIFEST_NAME
        prefix = f"{bundles.BUNDLE_ROOT}/azimut/"
        assert not any(name.startswith(prefix + ".trash/") for name in names)
        assert not any(name.startswith(prefix + "media/.thumbs/") for name in names)
        assert not any(name.startswith(prefix + "media/.dl/") for name in names)

        manifest = json.loads(archive.read(bundles.MANIFEST_NAME))
        assert [member["path"] for member in manifest["members"]] == names[:-1]

        extracted = config.bundles_dir() / "clean.db"
        member = (
            f"{bundles.BUNDLE_ROOT}/"
            f"{bundle_case.db_path.relative_to(bundle_case.path).as_posix()}"
        )
        extracted.write_bytes(archive.read(member))
    with closing(sqlite3.connect(extracted)) as conn:
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
    (bundle_case.subdir("media") / "large.bin").write_bytes(payload)
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
    with closing(sqlite3.connect(imported.db_path)) as conn:
        meta = dict(conn.execute("SELECT key, value FROM meta"))
    assert meta["origin_case_id"] == bundle_case.id
    assert meta["imported_at"]


def test_format_one_bundle_still_imports(bundle_case):
    """The new `case/` prefix must not strand bundles written before it."""
    exported = bundles.export_case(bundle_case)
    legacy = config.bundles_dir() / "legacy-format-one.azimut.zip"
    tool_prefix = f"{bundles.BUNDLE_ROOT}/azimut/"
    with zipfile.ZipFile(exported) as source:
        header = json.loads(source.read(bundles.HEADER_NAME))
        members = [
            (name.removeprefix(tool_prefix), source.read(name))
            for name in source.namelist()
            if name.startswith(tool_prefix)
        ]
    header["format_version"] = 1
    header["total_size"] = sum(len(body) for _, body in members)
    records = []
    with zipfile.ZipFile(legacy, "w") as archive:
        bundles._write_bytes(
            archive,
            bundles.HEADER_NAME,
            bundles._json_bytes(header),
            records,
        )
        for name, body in members:
            bundles._write_bytes(archive, name, body, records)
        archive.writestr(
            bundles._zip_info(bundles.MANIFEST_NAME, compressed=True),
            bundles._json_bytes({"format_version": 1, "members": records}),
        )

    destination = Case.create("Legacy format import")
    imported = Case.open(bundles.import_into(destination, legacy)["case_id"])

    assert imported.read()["name"] == "Legacy format import"
    assert [entity["label"] for entity in imported.list_entities()] == ["Witness"]
    assert imported.read_note(imported.list_entities()[0]["id"]) == "# Witness\n"


def test_import_reapplies_the_hidden_attribute_to_the_data_directory(
    bundle_case, monkeypatch
):
    exported = bundles.export_case(bundle_case)
    destination = Case.create("Hidden database import")
    ensured = []
    real_ensure_dir = bundles.ensure_dir

    def remember(path):
        ensured.append(path)
        return real_ensure_dir(path)

    monkeypatch.setattr(bundles, "ensure_dir", remember)

    imported = Case.open(bundles.import_into(destination, exported)["case_id"])

    assert layout.data_dir(imported.path) in ensured


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


def test_export_import_round_trip_keeps_the_analysts_free_zone(bundle_case):
    materials = bundle_case.path / "Source material" / "Interview"
    materials.mkdir(parents=True)
    (materials / "transcript.txt").write_text("Unedited source\n", encoding="utf-8")
    # These names belong to the ZIP container too. The `case/` member prefix
    # keeps them valid in the analyst's half of the folder.
    (bundle_case.path / bundles.HEADER_NAME).write_text("analyst file\n", encoding="utf-8")
    (bundle_case.path / bundles.MANIFEST_NAME).write_text("analyst file\n", encoding="utf-8")

    exported = bundles.export_case(bundle_case)
    with zipfile.ZipFile(exported) as archive:
        assert (
            f"{bundles.BUNDLE_ROOT}/Source material/Interview/transcript.txt"
            in archive.namelist()
        )
        assert f"{bundles.BUNDLE_ROOT}/{bundles.HEADER_NAME}" in archive.namelist()
        assert f"{bundles.BUNDLE_ROOT}/{bundles.MANIFEST_NAME}" in archive.namelist()
    destination = Case.create(bundles.imported_name("Source case"))
    imported = Case.open(bundles.import_into(destination, exported)["case_id"])

    assert (
        imported.path / "Source material" / "Interview" / "transcript.txt"
    ).read_text(encoding="utf-8") == "Unedited source\n"
    assert (imported.path / bundles.HEADER_NAME).read_text(encoding="utf-8") == "analyst file\n"
    assert (imported.path / bundles.MANIFEST_NAME).read_text(encoding="utf-8") == "analyst file\n"


def test_export_refuses_a_symbolic_link_in_the_free_zone(bundle_case, tmp_path):
    outside = tmp_path / "outside.txt"
    outside.write_text("must not be followed\n", encoding="utf-8")
    link = bundle_case.path / "linked-source.txt"
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("symbolic links are unavailable on this filesystem")

    with pytest.raises(bundles.BundleError, match="symbolic link"):
        bundles.export_case(bundle_case)


@pytest.mark.parametrize("name", ["Azimut", "AZIMUT"])
def test_free_zone_refuses_a_portable_tool_folder_collision(name):
    with pytest.raises(bundles.BundleError, match="collides"):
        bundles._check_free_name(name)


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
        db_member = (
            f"{bundles.BUNDLE_ROOT}/"
            f"{bundle_case.db_path.relative_to(bundle_case.path).as_posix()}"
        )
        record = next(item for item in manifest["members"] if item["path"] == db_member)
        record["size"] += 1
        for info in infos[:-1]:
            target.writestr(info, source.read(info))
        target.writestr(infos[-1], json.dumps(manifest).encode())

    destination = Case.create("Wrong size import")
    with pytest.raises(bundles.BundleError, match="manifest member"):
        bundles.import_into(destination, tampered)

    assert destination.list_entities() == []


def test_import_refuses_a_bundle_member_marked_as_a_symbolic_link(bundle_case):
    free_file = bundle_case.path / "source.txt"
    free_file.write_text("source\n", encoding="utf-8")
    exported = bundles.export_case(bundle_case)
    tampered = config.bundles_dir() / "symlink.azimut.zip"
    member_name = f"{bundles.BUNDLE_ROOT}/source.txt"
    with zipfile.ZipFile(exported) as source, zipfile.ZipFile(tampered, "w") as target:
        for info in source.infolist():
            body = source.read(info)
            if info.filename == member_name:
                info.external_attr = 0o120777 << 16
            target.writestr(info, body)

    destination = Case.create("Symlink import")
    with pytest.raises(bundles.BundleError, match="symbolic link"):
        bundles.import_into(destination, tampered)

    assert destination.path.exists()
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
    reserve = bundles.disk_reserve(total)
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
    reserve = bundles.disk_reserve(total)
    monkeypatch.setattr(
        bundles.shutil,
        "disk_usage",
        lambda _path: SimpleNamespace(total=total, used=total - reserve, free=reserve),
    )

    with pytest.raises(bundles.BundleError, match="not enough free space"):
        bundles.export_case(bundle_case)

    assert not any(config.bundles_dir().glob("*.tmp"))


def test_every_top_level_case_entry_has_a_bundle_decision(bundle_case):
    """The drift gate: a new directory in the case ships in the bundle or is
    listed as deliberately left behind, never silently dropped.

    It reads the tool root, because that is what a bundle carries and how it
    names its members. What sits beside it in the case folder is the analyst's
    and answers to its own rule.
    """
    assert all(
        bundles.classify_case_entry(path.name) is not None
        for path in bundle_case.tool_root.iterdir()
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
    with closing(sqlite3.connect(bundle_case.db_path)) as conn:
        export_payload = conn.execute(
            "SELECT payload_json FROM jobs WHERE id = ?", (export_job["id"],)
        ).fetchone()[0]
    with closing(sqlite3.connect(imported.db_path)) as conn:
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
