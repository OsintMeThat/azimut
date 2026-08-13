"""Forward compatibility (spec §7): an older case.json / settings.json is
migrated up to the running schema on open, a newer one is refused rather than
mangled. The chains are empty today, so these tests register throwaway
migrations to prove the runners, and pin the "same schema doesn't rewrite" and
"newer is refused" invariants that hold with zero migrations."""

import json
import shutil
import sqlite3

import pytest
import fullcase
from legacy_case import rewind_case, unwrap_case, write_legacy_json_case

from azimut import config, layout, workspace
from azimut.sqlite_backend import SQLITE_SCHEMA
from azimut.engine import trash as trash_engine
from azimut.workspace import Case, CaseError, ensure_dir


# -- case.json ------------------------------------------------------------


def test_open_current_schema_does_not_rewrite(tmp_workspace):
    """The common path: a case at the running schema is returned untouched, no
    backup file appears, updated_at is left alone."""
    case = Case.create("Investigation")
    before = case.read()["updated_at"]

    reopened = Case.open(case.id)

    assert reopened.read()["updated_at"] == before
    backups = list(case.tool_root.glob("case.pre-migrate*.json"))
    assert backups == []


def test_startup_migrates_old_permanent_and_scratch_cases_as_one_pass(tmp_workspace):
    permanent = write_legacy_json_case("Old permanent")
    scratch = write_legacy_json_case("Old scratch", scratch=True)
    root = config.workspace_root()
    old_cases = root / "cases"
    old_scratch = root / "scratch"
    old_cases.mkdir()
    old_scratch.mkdir()
    permanent.path.rename(old_cases / permanent.id)
    scratch.path.rename(old_scratch / scratch.id)

    from azimut.server import create_app

    create_app()

    migrated_permanent = Case.open(permanent.id)
    migrated_scratch = Case.open(scratch.id)
    assert migrated_permanent.path == root / permanent.id
    assert migrated_scratch.path == config.scratch_dir() / scratch.id
    assert migrated_scratch.is_scratch is True
    assert migrated_permanent.read()["azimut"]["schema"] == workspace.CASE_SCHEMA
    assert migrated_scratch.read()["azimut"]["schema"] == workspace.CASE_SCHEMA
    assert not (root / "cases").exists()
    assert not (root / "scratch").exists()


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
    backup = case.tool_root / "case.pre-migrate-v1.json"
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
    backup = case.tool_root / "case.pre-migrate-v1.json"
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
        entities=[
            {
                "id": "e_note",
                "type": "note",
                "label": "Lead",
                "attrs": {"folder": "Research", "content": "# Saved lead"},
                "provenance": {"by": "user", "at": "2026-01-01T00:00:00Z", "status": "confirmed"},
            }
        ],
    )

    migrated = Case.open(case.id).snapshot()

    note = migrated["entities"][0]
    # The body left case.json, and the layout normalizer named the file after
    # the note's title inside its folder.
    assert note["attrs"] == {"folder": "Research", "path": "notes/Research/Lead.md"}
    assert case.resolve_inside(note["attrs"]["path"]).read_text(encoding="utf-8") == "# Saved lead"
    assert (case.tool_root / "case.pre-migrate-v1.json").exists()


# -- storage activation: legacy json -> sqlite on open --------------------


def test_open_activates_sqlite_and_preserves_the_graph(tmp_workspace):
    """A legacy json case is converted to the sqlite storage format on open,
    keeping its graph and leaving a recoverable backup."""
    prov = {"by": "user", "at": "2026-01-01T00:00:00Z", "status": "confirmed"}
    legacy = write_legacy_json_case(
        "To migrate",
        entities=[
            {
                "id": "e_a",
                "type": "person",
                "label": "Ada",
                "attrs": {"handle": "@ada"},
                "provenance": prov,
            },
            {"id": "e_b", "type": "account", "label": "acct", "attrs": {}, "provenance": prov},
        ],
        links=[{"id": "l_1", "from": "e_a", "to": "e_b", "type": "owns", "provenance": prov}],
        folders=["Sources", "Sources/Telegram"],
    )

    opened = Case.open(legacy.id)

    manifest = opened.read()
    assert manifest["azimut"] == {"schema": workspace.CASE_SCHEMA, "storage": "sqlite"}
    assert "entities" not in manifest  # case.json is a manifest now
    assert opened.db_path.exists()
    assert (opened.tool_root / "case.pre-migrate-v2.json").exists()

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
    assert not legacy.db_path.exists()

    # with the fault cleared (restore just the converter, not the whole
    # monkeypatch — undo() would also revert tmp_workspace's AZIMUT_HOME), a
    # retry migrates it and the graph survives
    monkeypatch.setattr(sqlite_backend, "_import_graph", real_import)
    assert [e["label"] for e in Case.open(legacy.id).list_entities()] == ["Ada"]


# -- consolidated folder migration: released schema 3 / dev schemas 4–7 ----


def _case_at_folder_checkpoint(schema: int) -> tuple[Case, dict[str, str]]:
    case = Case.create(f"Folder checkpoint {schema}")
    note = case.create_note("Bridge sighting", "Video 1", "# note")
    old_paths = {
        "proof": layout.proof_spec_rel("proof"),
        "inspect": layout.session_rel("session"),
        "draft": layout.draft_rel("draft"),
        "media": "media/clip.jpg",
        "sidecar": layout.sidecar_rel("clip.jpg"),
    }
    for key in ("proof", "inspect", "draft", "sidecar"):
        path = case.resolve_inside(old_paths[key])
        path.parent.mkdir(parents=True, exist_ok=True)
        data = (
            {
                "filename": "clip.jpg",
                "title": "Clip",
                "source": {"type": "download"},
            }
            if key == "sidecar"
            else {"title": key}
        )
        path.write_text(json.dumps(data) + "\n", encoding="utf-8")
    case.resolve_inside(old_paths["media"]).write_bytes(b"image")
    case.add_entity("proof", "Proof", {"spec": old_paths["proof"]}, by="user")
    case.add_entity("inspect-session", "Session", {"spec": old_paths["inspect"]}, by="user")
    case.add_entity("post", "Draft", {"draft": old_paths["draft"]}, by="user")
    rewind_case(case, schema)
    return case, {
        "proof": layout.proof_spec_rel("Proof"),
        "inspect": layout.session_rel("Session"),
        "draft": layout.draft_rel("Draft"),
        "media": "media/Clip.jpg",
        "sidecar": layout.sidecar_rel("Clip.jpg"),
        "note_id": note["id"],
    }


@pytest.mark.parametrize("schema", range(workspace.STORAGE_SCHEMA, workspace.CASE_SCHEMA))
def test_every_unreleased_folder_checkpoint_jumps_to_the_final_layout(tmp_workspace, schema):
    case, expected = _case_at_folder_checkpoint(schema)
    legacy_manifest = (
        layout.manifest(case.path)
        if layout.manifest(case.path).is_file()
        else layout.unwrapped_manifest(case.path)
    )
    assert json.loads(legacy_manifest.read_text(encoding="utf-8"))["azimut"]["schema"] == schema

    opened = Case.open(case.id)

    assert opened.read()["azimut"]["schema"] == workspace.CASE_SCHEMA
    assert opened.read_note(expected["note_id"]) == "# note"
    for key in ("proof", "inspect", "draft", "media", "sidecar"):
        assert opened.resolve_inside(expected[key]).exists()
    attrs = {
        entity["type"]: entity["attrs"]
        for entity in opened.list_entities()
        if entity["type"] in {"proof", "inspect-session", "post"}
    }
    assert attrs["proof"]["spec"] == expected["proof"]
    assert attrs["inspect-session"]["spec"] == expected["inspect"]
    assert attrs["post"]["draft"] == expected["draft"]
    assert sorted(path.name for path in opened.path.iterdir()) == ["README.txt", "azimut"]


def test_released_schema_three_is_stamped_only_once(tmp_workspace, monkeypatch):
    case, _ = _case_at_folder_checkpoint(workspace.STORAGE_SCHEMA)
    writes = []
    real_write = Case._write_json

    def remember_write(self, data):
        if self.path == case.path:
            writes.append(data["azimut"]["schema"])
        real_write(self, data)

    monkeypatch.setattr(Case, "_write_json", remember_write)

    Case.open(case.id)

    assert writes == [workspace.CASE_SCHEMA]


@pytest.mark.parametrize(
    "stage",
    [
        "_wrap_case_folder",
        "_flatten_trash",
        "_hide_the_machinery",
        "_name_notes_after_their_titles",
        "_leave_a_readme",
    ],
)
def test_folder_normalizer_resumes_after_each_stage(tmp_workspace, monkeypatch, stage):
    case, expected = _case_at_folder_checkpoint(workspace.STORAGE_SCHEMA)
    real_stage = getattr(workspace, stage)

    def stop_after_stage(current):
        real_stage(current)
        raise RuntimeError(f"stop after {stage}")

    monkeypatch.setattr(workspace, stage, stop_after_stage)
    with pytest.raises(RuntimeError, match="stop after"):
        Case.open(case.id)

    manifest = (
        layout.manifest(case.path)
        if layout.manifest(case.path).is_file()
        else layout.unwrapped_manifest(case.path)
    )
    assert json.loads(manifest.read_text(encoding="utf-8"))["azimut"]["schema"] == (
        workspace.STORAGE_SCHEMA
    )

    monkeypatch.setattr(workspace, stage, real_stage)
    opened = Case.open(case.id)

    assert opened.read()["azimut"]["schema"] == workspace.CASE_SCHEMA
    assert opened.read_note(expected["note_id"]) == "# note"
    proof = json.loads(opened.resolve_inside(expected["proof"]).read_text(encoding="utf-8"))
    assert proof["title"] == "Proof"


# -- folder normalizer: trash stops mirroring the case tree ----------------


def _mirrored_trash_group(case: Case, rel: str, body: bytes) -> str:
    """Write a schema-3 trash group by hand: the file waits under a copy of its
    own case-relative path, which is what the app did before slots."""
    group_id = "t_legacy0001"
    waiting = case.trash_dir / group_id / rel
    waiting.parent.mkdir(parents=True, exist_ok=True)
    waiting.write_bytes(body)
    case.add_trash_group(
        group_id,
        label="Old delete",
        type_="media",
        item_count=1,
        size_bytes=len(body),
        payload={"entities": [], "links": [], "files": [rel], "tombstones": []},
        state="ready",
    )
    return group_id


def test_open_flattens_a_mirrored_trash_group_into_slots(tmp_workspace):
    """The normalizer moves each waiting file to a numbered slot and records the
    pairing, so the trash stops stacking a second case tree under itself."""
    case = Case.create("Has an old delete")
    rel = "media/clip.mp4"
    group_id = _mirrored_trash_group(case, rel, b"payload")
    manifest = case.read()
    manifest["azimut"]["schema"] = workspace.STORAGE_SCHEMA
    case._write_json(manifest)

    opened = Case.open(case.id)

    assert opened.read()["azimut"]["schema"] == workspace.CASE_SCHEMA
    group_dir = opened.trash_dir / group_id
    assert [p.name for p in group_dir.iterdir()] == ["0"]
    assert (group_dir / "0").read_bytes() == b"payload"
    group = opened.get_trash_group(group_id)
    assert group["payload"]["files"] == [rel]
    assert group["payload"]["slots"] == ["0"]


def test_a_flattened_group_still_restores_to_its_original_path(tmp_workspace):
    """The point of recording the pairing: the file goes back where it was, not
    where it waited."""
    case = Case.create("Restores after migrating")
    rel = "media/clip.mp4"
    group_id = _mirrored_trash_group(case, rel, b"payload")
    manifest = case.read()
    manifest["azimut"]["schema"] = workspace.STORAGE_SCHEMA
    case._write_json(manifest)

    opened = Case.open(case.id)
    trash_engine.restore(opened, group_id)

    assert opened.resolve_inside(rel).read_bytes() == b"payload"
    assert not (opened.trash_dir / group_id).exists()


def test_migrating_twice_leaves_the_slots_alone(tmp_workspace):
    """Idempotence, because an interrupted upgrade reopens and runs again."""
    case = Case.create("Migrated twice")
    group_id = _mirrored_trash_group(case, "media/clip.mp4", b"payload")
    manifest = case.read()
    manifest["azimut"]["schema"] = workspace.STORAGE_SCHEMA
    case._write_json(manifest)

    Case.open(case.id)
    reopened = Case.open(case.id)

    group_dir = reopened.trash_dir / group_id
    assert [p.name for p in group_dir.iterdir()] == ["0"]
    assert (group_dir / "0").read_bytes() == b"payload"


# -- folder normalizer: the tool's files move into `azimut/` ----------------


def test_open_wraps_a_flat_case_and_keeps_every_artifact(tmp_workspace):
    """The case root becomes the analyst's, and nothing inside is rewritten:
    stored paths are relative to the tool root, so they go on meaning the same
    thing one level down."""
    case = Case.create("Flat on disk")
    note = case.create_note("Lead", "Research", "# body")
    rel = note["attrs"]["path"]
    unwrap_case(case)
    assert (case.path / "case.json").is_file()  # genuinely the old shape

    opened = Case.open(case.id)

    assert opened.read()["azimut"]["schema"] == workspace.CASE_SCHEMA
    assert sorted(entry.name for entry in opened.path.iterdir()) == ["README.txt", "azimut"]
    assert opened.resolve_inside(rel).read_text(encoding="utf-8") == "# body"
    assert opened.get_entity(note["id"])["attrs"]["path"] == rel  # untouched


def test_an_interrupted_wrap_is_resumed_not_half_applied(tmp_workspace):
    """The manifest moves last, so its presence at the case root is what says
    the move never finished. A run that died after carrying the media over must
    pick up from there rather than refuse or duplicate."""
    case = Case.create("Interrupted wrap")
    case.subdir("media").joinpath("clip.mp4").write_bytes(b"payload")
    unwrap_case(case)
    # simulate the crash: media carried over, manifest still at the root
    tool = case.path / "azimut"
    tool.mkdir()
    shutil.move(str(case.path / "media"), str(tool / "media"))
    assert (case.path / "case.json").is_file()

    opened = Case.open(case.id)

    assert sorted(entry.name for entry in opened.path.iterdir()) == ["README.txt", "azimut"]
    assert opened.resolve_inside("media/clip.mp4").read_bytes() == b"payload"


def test_the_analysts_own_files_are_left_at_the_case_root(tmp_workspace):
    """The whole point of the wrapper. A folder someone keeps beside the case
    does not get swept into the tool's directory by the migration."""
    case = Case.create("Has company")
    unwrap_case(case)
    (case.path / "my rushes").mkdir()
    (case.path / "my rushes" / "raw.mp4").write_bytes(b"mine")

    opened = Case.open(case.id)

    assert (opened.path / "my rushes" / "raw.mp4").read_bytes() == b"mine"
    assert not (opened.tool_root / "my rushes").exists()
    # and the tool's own files did move, so the case is properly wrapped
    assert opened.db_path.is_file()
    assert opened.read()["azimut"]["schema"] == workspace.CASE_SCHEMA


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


def test_open_names_notes_after_their_titles(tmp_workspace):
    """A note used to be `notes/<entity-id>.md`: visible in the case folder and
    illegible, which is the cost of being in the way without the benefit of
    being readable."""
    case = Case.create("Notes to rename")
    note = case.create_note("Bridge sighting", "Video 1", "# body")
    id_named = f"notes/{note['id']}.md"
    moved = case.resolve_inside(id_named)
    ensure_dir(moved.parent)
    shutil.move(str(case.resolve_inside(note["attrs"]["path"])), str(moved))
    case.update_entity(note["id"], {"attrs": {"path": id_named}})
    manifest = case.read()
    manifest["azimut"]["schema"] = workspace.STORAGE_SCHEMA + 3  # before the note rename
    case._write_json(manifest)

    opened = Case.open(case.id)

    renamed = opened.get_entity(note["id"])
    assert renamed["attrs"]["path"] == "notes/Video 1/Bridge sighting.md"
    assert opened.read_note(note["id"]) == "# body"
    assert not opened.resolve_inside(id_named).exists()


def test_two_notes_with_one_title_survive_the_rename(tmp_workspace):
    """Titles are not unique and the migration cannot refuse anything, so the
    second one takes a suffix rather than overwriting the first."""
    case = Case.create("Duplicate titles")
    first = case.create_note("Summary", "", "# first")
    second = case.create_note("Summary", "", "# second")
    for entity, body in ((first, "# first"), (second, "# second")):
        rel = f"notes/{entity['id']}.md"
        shutil.move(
            str(case.resolve_inside(entity["attrs"]["path"])), str(case.resolve_inside(rel))
        )
        case.update_entity(entity["id"], {"attrs": {"path": rel}})
        assert case.resolve_inside(rel).read_text(encoding="utf-8") == body
    manifest = case.read()
    manifest["azimut"]["schema"] = workspace.STORAGE_SCHEMA + 3  # before the note rename
    case._write_json(manifest)

    opened = Case.open(case.id)

    paths = sorted(opened.get_entity(e["id"])["attrs"]["path"] for e in (first, second))
    assert paths == ["notes/Summary-2.md", "notes/Summary.md"]
    assert opened.read_note(first["id"]) == "# first"
    assert opened.read_note(second["id"]) == "# second"


# -- folder normalizer: explain the free zone -------------------------------


def test_a_new_case_explains_which_half_of_the_folder_is_free(tmp_workspace):
    case = Case.create("Readable boundary")

    assert layout.readme(case.path).read_text(encoding="utf-8") == layout.README_TEXT
    assert "everything else here is yours" in layout.README_TEXT


def test_schema_seven_case_gets_a_readme_without_overwriting_one(tmp_workspace):
    case = Case.create("Readme migration")
    readme = layout.readme(case.path)
    readme.unlink()
    manifest = case.read()
    manifest["azimut"]["schema"] = workspace.CASE_SCHEMA - 1
    case._write_json(manifest)

    opened = Case.open(case.id)

    assert readme.read_text(encoding="utf-8") == layout.README_TEXT
    assert opened.read()["azimut"]["schema"] == workspace.CASE_SCHEMA

    readme.write_text("My own instructions\n", encoding="utf-8")
    manifest = opened.read()
    manifest["azimut"]["schema"] = workspace.CASE_SCHEMA - 1
    opened._write_json(manifest)

    Case.open(case.id)

    assert readme.read_text(encoding="utf-8") == "My own instructions\n"


def test_a_whole_case_from_the_last_release_opens_on_the_current_schema(client):
    """The upgrade people actually run: a case filed by the previous release,
    opened by this one.

    `tests/test_sqlite_backend.py` proves the chain on hand-built databases, one
    step at a time. This proves it on a case with everything in it — media and
    their sidecars, notes, proofs, places, claims, folders, links — and then reads
    the surfaces that depend on what the chain created. A migration that leaves a
    database technically at the right version but unreadable by the app would pass
    every step-level test and fail here.

    Schema 7 is what `v0.2.7` shipped, so this is the exact jump an installed copy
    makes on its first open after the update.
    """
    import schema_rewind

    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    before = {
        entity["id"]: entity["label"] for entity in case.list_entities()
    }
    assert before, "the fixture planted nothing"
    schema_rewind.rewind(case.db_path, 7)

    reopened = Case.open(full.case_id)

    with sqlite3.connect(reopened.db_path) as conn:
        assert conn.execute(
            "SELECT value FROM meta WHERE key = 'schema_version'"
        ).fetchone()[0] == str(SQLITE_SCHEMA)

    # Nothing the case already held was dropped or renamed on the way up.
    assert {e["id"]: e["label"] for e in reopened.list_entities()} == before
    assert len(reopened.list_links()) == len(case.list_links())

    # The catalog still pages, still counts, and still orders the whole case by
    # the two columns schema 14 indexed.
    page = reopened.page_entities(limit=5, order="label")
    assert page["total"] == len(before)
    assert [item["label"] for item in page["items"]] == sorted(
        (label for label in before.values()), key=str.casefold
    )[:5]
    assert reopened.catalog_summary()["total"] == len(before)

    # The tables the chain created answer, rather than raising "no such table".
    assert reopened.list_analysis_views() == []
    assert reopened.graph_pins("all") == {}
    assert reopened.entity_images(full.org_id) == []
    assert reopened.entity_image_thumbs(list(before)) == {}

    # And the case draws, which is the read that touches most of them at once.
    drawn = client.get(f"/api/cases/{full.case_id}/graph")
    assert drawn.status_code == 200, drawn.text
    assert drawn.json()["nodes"]


def test_a_case_from_the_last_release_keeps_its_photos_and_readings_on_disk(client):
    """The other half: what schema 7 could not hold is gone, and what the *files*
    hold is not. A rewind drops the gallery rows, so the private photo bytes are
    still there and the migration must neither resurrect a row for them nor
    destroy them — only the Case Doctor is allowed to remove them, and it says so
    first."""
    import schema_rewind

    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    photo = case.resolve_inside(full.entity_photo)
    assert photo.is_file()
    schema_rewind.rewind(case.db_path, 7)

    reopened = Case.open(full.case_id)

    assert reopened.entity_images(full.org_id) == []
    assert photo.is_file()


def test_schema_16_keeps_existing_views_and_accepts_timeline_readings(tmp_workspace):
    case = Case.create("Timeline view migration")
    existing = case.save_analysis_view({
        "id": "v_existing",
        "name": "Existing graph reading",
        "mode": "live",
        "surface": "graph",
        "spec": {"version": 1, "query": {"terms": {}}},
        "created_at": "2026-08-12T10:00:00Z",
        "updated_at": "2026-08-12T10:00:00Z",
    })
    with sqlite3.connect(case.db_path) as conn:
        conn.execute("ALTER TABLE analysis_views RENAME TO analysis_views_current")
        conn.execute(
            "CREATE TABLE analysis_views ("
            "id TEXT PRIMARY KEY, name TEXT NOT NULL,"
            "mode TEXT NOT NULL CHECK (mode IN ('live', 'snapshot')),"
            "surface TEXT NOT NULL CHECK (surface IN ('board', 'graph')),"
            "spec_json TEXT NOT NULL, snapshot_count INTEGER NOT NULL DEFAULT 0,"
            "created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        conn.execute("INSERT INTO analysis_views SELECT * FROM analysis_views_current")
        conn.execute("DROP TABLE analysis_views_current")
        conn.execute("CREATE INDEX idx_analysis_views_updated ON analysis_views(updated_at DESC)")
        conn.execute("UPDATE meta SET value = '15' WHERE key = 'schema_version'")
        conn.execute("DELETE FROM schema_migrations WHERE version >= 16")

    reopened = Case.open(case.id)
    assert reopened.get_analysis_view(existing["id"]) == existing
    timeline = reopened.save_analysis_view({
        "id": "v_timeline",
        "name": "Timeline reading",
        "mode": "live",
        "surface": "timeline",
        "spec": {"version": 1, "timeline": {"tracks": []}},
        "created_at": "2026-08-12T11:00:00Z",
        "updated_at": "2026-08-12T11:00:00Z",
    })
    assert timeline["surface"] == "timeline"


def test_schema_16_copies_views_by_column_name_whatever_their_order(tmp_workspace):
    """The legacy table's columns sit in whatever order its own history left them.

    A case that gained `snapshot_count` by an `ALTER TABLE` carries it last, so the
    positional copy the migration used to do rotated three values on every existing
    row: the count came out holding a timestamp, and the view could no longer be read.
    """
    case = Case.create("View column order")
    saved = case.save_analysis_view({
        "id": "v_snap",
        "name": "Frozen graph reading",
        "mode": "snapshot",
        "surface": "graph",
        "spec": {
            "version": 1,
            "query": {"terms": {}},
            "snapshot": {
                "captured_at": "2026-08-10T21:02:40Z",
                "entities": [
                    {"id": f"e{index}", "type": "person", "label": f"Person {index}"}
                    for index in range(3)
                ],
                "links": [],
            },
        },
        "created_at": "2026-08-10T21:02:40Z",
        "updated_at": "2026-08-10T21:02:45Z",
    })
    assert saved["snapshot_count"] == 3
    with sqlite3.connect(case.db_path) as conn:
        # the pre-16 shape, with the count appended after the timestamps
        conn.execute("ALTER TABLE analysis_views RENAME TO analysis_views_current")
        conn.execute(
            "CREATE TABLE analysis_views ("
            "id TEXT PRIMARY KEY, name TEXT NOT NULL,"
            "mode TEXT NOT NULL CHECK (mode IN ('live', 'snapshot')),"
            "surface TEXT NOT NULL CHECK (surface IN ('board', 'graph')),"
            "spec_json TEXT NOT NULL,"
            "created_at TEXT NOT NULL, updated_at TEXT NOT NULL,"
            "snapshot_count INTEGER NOT NULL DEFAULT 0)"
        )
        conn.execute(
            "INSERT INTO analysis_views"
            " (id, name, mode, surface, spec_json, created_at, updated_at, snapshot_count)"
            " SELECT id, name, mode, surface, spec_json, created_at, updated_at,"
            " snapshot_count FROM analysis_views_current"
        )
        conn.execute("DROP TABLE analysis_views_current")
        conn.execute("CREATE INDEX idx_analysis_views_updated ON analysis_views(updated_at DESC)")
        conn.execute("UPDATE meta SET value = '15' WHERE key = 'schema_version'")
        conn.execute("DELETE FROM schema_migrations WHERE version >= 16")

    reopened = Case.open(case.id)

    assert reopened.get_analysis_view("v_snap") == saved
    assert [view["snapshot_count"] for view in reopened.list_analysis_views()] == [3]


def test_schema_17_rewrites_temporal_bounds_to_fixed_width(tmp_workspace):
    case = Case.create("Variable temporal bounds")
    claim = case.add_entity(
        "claim",
        "Subsecond observation",
        {"when": "2026-08-11T10:32:14.5Z"},
        by="user",
    )
    with sqlite3.connect(case.db_path) as conn:
        conn.execute(
            "UPDATE temporal_items SET earliest = ?, latest = ? WHERE owner_id = ?",
            (
                "2026-08-11T10:32:14.5Z",
                "2026-08-11T10:32:14.6Z",
                claim["id"],
            ),
        )
        conn.execute("UPDATE meta SET value = '16' WHERE key = 'schema_version'")
        conn.execute("DELETE FROM schema_migrations WHERE version >= 17")

    reopened = Case.open(case.id)

    item = reopened.timeline_page(categories=["statement"])["items"][0]
    assert item["earliest"] == "2026-08-11T10:32:14.500000Z"
    assert item["latest"] == "2026-08-11T10:32:14.600000Z"
