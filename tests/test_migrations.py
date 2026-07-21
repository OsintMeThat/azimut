"""Forward compatibility (spec §7): an older case.json / settings.json is
migrated up to the running schema on open, a newer one is refused rather than
mangled. The chains are empty today, so these tests register throwaway
migrations to prove the runners, and pin the "same schema doesn't rewrite" and
"newer is refused" invariants that hold with zero migrations."""

import json

import pytest
from legacy_case import write_legacy_json_case

from azimut import config, workspace
from azimut.workspace import Case, CaseError


# -- case.json ------------------------------------------------------------


def test_open_current_schema_does_not_rewrite(tmp_workspace):
    """The common path: a case at the running schema is returned untouched, no
    backup file appears, updated_at is left alone."""
    case = Case.create("Investigation")
    before = case.read()["updated_at"]

    reopened = Case.open(case.id)

    assert reopened.read()["updated_at"] == before
    backups = list(case.path.glob("case.pre-migrate*.json"))
    assert backups == []


def test_open_newer_schema_is_refused(tmp_workspace):
    case = Case.create("From the future")
    data = case.read()
    data["azimut"]["schema"] = workspace.CASE_SCHEMA + 5
    case._write_json(data)

    with pytest.raises(CaseError, match="newer Azimut"):
        Case.open(case.id)


def test_open_older_schema_migrates_and_backs_up(tmp_workspace, monkeypatch):
    case = Case.create("Legacy")
    data = case.read()  # stamp it back down to the first schema
    data["azimut"]["schema"] = 1
    case._write_json(data)

    def to_v2(data):
        data.setdefault("attrs", {})["migrated"] = True
        return data

    monkeypatch.setattr(workspace, "CASE_SCHEMA", 2)
    monkeypatch.setattr(workspace, "CASE_MIGRATIONS", {1: to_v2})

    migrated = Case.open(case.id).read()

    assert migrated["azimut"]["schema"] == 2
    assert migrated["attrs"]["migrated"] is True
    backup = case.path / "case.pre-migrate-v1.json"
    assert backup.exists()
    assert json.loads(backup.read_text())["azimut"]["schema"] == 1


def test_migration_backup_is_not_overwritten(tmp_workspace, monkeypatch):
    """A second migration run keeps the first pre-migration copy."""
    case = Case.create("Legacy")
    data = case.read()  # stamp it back down to the first schema
    data["azimut"]["schema"] = 1
    case._write_json(data)
    monkeypatch.setattr(workspace, "CASE_SCHEMA", 2)
    monkeypatch.setattr(workspace, "CASE_MIGRATIONS", {1: lambda d: d})

    Case.open(case.id)
    backup = case.path / "case.pre-migrate-v1.json"
    first = backup.read_text()

    # Force another migration pass from the same starting schema.
    data = case.read()
    data["azimut"]["schema"] = 1
    case._write_json(data)
    Case.open(case.id)

    assert backup.read_text() == first


def test_note_bodies_migrate_out_of_case_json(tmp_workspace):
    case = write_legacy_json_case(
        "Legacy notes",
        schema=1,
        entities=[{
            "id": "e_note", "type": "note", "label": "Lead",
            "attrs": {"folder": "Research", "content": "# Saved lead"},
            "provenance": {"by": "user", "at": "2026-01-01T00:00:00Z", "status": "confirmed"},
        }],
    )

    migrated = Case.open(case.id).snapshot()

    note = migrated["entities"][0]
    assert note["attrs"] == {"folder": "Research", "path": "notes/e_note.md"}
    assert (case.path / "notes/e_note.md").read_text(encoding="utf-8") == "# Saved lead"
    assert (case.path / "case.pre-migrate-v1.json").exists()


# -- storage activation: legacy json -> sqlite on open --------------------


def test_open_activates_sqlite_and_preserves_the_graph(tmp_workspace):
    """A legacy json case is converted to the sqlite storage format on open,
    keeping its graph and leaving a recoverable backup."""
    prov = {"by": "user", "at": "2026-01-01T00:00:00Z", "status": "confirmed"}
    legacy = write_legacy_json_case(
        "To migrate",
        entities=[
            {"id": "e_a", "type": "person", "label": "Ada", "attrs": {"handle": "@ada"}, "provenance": prov},
            {"id": "e_b", "type": "account", "label": "acct", "attrs": {}, "provenance": prov},
        ],
        links=[{"id": "l_1", "from": "e_a", "to": "e_b", "type": "owns", "provenance": prov}],
        folders=["Sources", "Sources/Telegram"],
    )

    opened = Case.open(legacy.id)

    manifest = opened.read()
    assert manifest["azimut"] == {"schema": workspace.CASE_SCHEMA, "storage": "sqlite"}
    assert "entities" not in manifest  # case.json is a manifest now
    assert (opened.path / "case.db").exists()
    assert (opened.path / "case.pre-migrate-v2.json").exists()

    snap = opened.snapshot()
    assert {e["id"] for e in snap["entities"]} == {"e_a", "e_b"}
    assert len(snap["links"]) == 1
    assert "Sources/Telegram" in snap["folders"]
    # and the migrated case now takes the fast path on further edits
    opened.add_entity("email", "a@b.c", by="user")
    assert len(Case.open(legacy.id).list_entities()) == 3


def test_switcher_timestamp_tracks_the_db_not_the_stale_manifest(tmp_workspace):
    """Graph edits bump the db, not the small manifest, so the case switcher must
    read last-activity from the db for a sqlite case."""
    case = Case.create("Active")  # sqlite
    case.add_entity("person", "Ada", by="user")
    db_time = case._sqlite.updated_at()
    assert case.snapshot()["updated_at"] == db_time

    # deliberately stale the manifest; the switcher must still show real activity
    manifest = case.read()
    manifest["updated_at"] = "2000-01-01T00:00:00Z"
    case._write_json(manifest)
    row = next(c for c in Case.list_all() if c["id"] == case.id)
    assert row["updated_at"] == db_time != "2000-01-01T00:00:00Z"


def test_failed_activation_leaves_the_json_case_usable(tmp_workspace, monkeypatch):
    prov = {"by": "user", "at": "2026-01-01T00:00:00Z", "status": "confirmed"}
    legacy = write_legacy_json_case(
        "Fragile",
        entities=[{"id": "e_a", "type": "person", "label": "Ada", "attrs": {}, "provenance": prov}],
    )

    def boom(conn, data, report):
        raise RuntimeError("conversion blew up")

    from azimut import sqlite_backend

    real_import = sqlite_backend._import_graph
    monkeypatch.setattr(sqlite_backend, "_import_graph", boom)
    with pytest.raises(RuntimeError):
        Case.open(legacy.id)

    # the manifest never flipped, no half-built db is left, the file still reads
    reopened_json = json.loads(legacy.json_path.read_text(encoding="utf-8"))
    assert reopened_json["azimut"]["storage"] == "json"
    assert reopened_json["entities"][0]["label"] == "Ada"
    assert not (legacy.path / "case.db").exists()

    # with the fault cleared (restore just the converter, not the whole
    # monkeypatch — undo() would also revert tmp_workspace's AZIMUT_HOME), a
    # retry migrates it and the graph survives
    monkeypatch.setattr(sqlite_backend, "_import_graph", real_import)
    assert [e["label"] for e in Case.open(legacy.id).list_entities()] == ["Ada"]


# -- settings.json --------------------------------------------------------


def test_migrate_settings_newer_is_left_alone():
    data = {"schema": config.SETTINGS_SCHEMA + 3, "unknown_future_key": 1}
    assert config.migrate_settings(dict(data)) == data


def test_load_settings_untagged_file_is_first_schema(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.settings_path().parent.mkdir(parents=True, exist_ok=True)
    config.settings_path().write_text(json.dumps({"api_keys": {}}), encoding="utf-8")

    assert config.load_settings()["schema"] == 1


def test_ensure_workspace_upgrades_settings_in_place(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.settings_path().parent.mkdir(parents=True, exist_ok=True)
    config.settings_path().write_text(
        json.dumps({"schema": 1, "post_mention": "@old"}), encoding="utf-8"
    )

    def to_v2(data):
        data["post_mention"] = "@new"
        return data

    monkeypatch.setattr(config, "SETTINGS_SCHEMA", 2)
    monkeypatch.setattr(config, "SETTINGS_MIGRATIONS", {1: to_v2})

    config.ensure_workspace()

    saved = json.loads(config.settings_path().read_text(encoding="utf-8"))
    assert saved["schema"] == 2
    assert saved["post_mention"] == "@new"
