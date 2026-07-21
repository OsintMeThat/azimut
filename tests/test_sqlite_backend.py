"""SQLite backend and JSON->SQLite converter (Step 3 of
docs/STORAGE_AND_PERFORMANCE.md).

The graph contract itself is covered by `tests/test_repository.py`, which runs
the same suite against both `Case` and `SqliteCase`. This file pins the
store-specific behaviour the contract can't reach: create/open, forward-compat
refusal, foreign-key enforcement, transaction rollback, and the atomic converter
that must never leave a half-built database or touch the legacy `case.json`.
"""

from __future__ import annotations

import sqlite3

import pytest
from bigcase import build_big_case
from legacy_case import write_legacy_json_case

from azimut.sqlite_backend import SqliteCase, convert_json_to_sqlite
from azimut.workspace import CaseError


def _entity(eid, **over):
    ent = {
        "id": eid,
        "type": "person",
        "label": eid,
        "attrs": {},
        "provenance": {"by": "user", "at": "2026-01-01T00:00:00Z", "status": "confirmed"},
    }
    ent.update(over)
    return ent


def _json_case(**over):
    data = {
        "azimut": {"schema": 2},
        "name": "Legacy",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-02T00:00:00Z",
        "folders": [],
        "entities": [],
        "links": [],
    }
    data.update(over)
    return data


# -- create / open ---------------------------------------------------------


def test_create_then_open_roundtrips(tmp_path):
    store = SqliteCase.create(tmp_path / "case.db", name="Contract")
    e = store.add_entity("person", "Ada", {"handle": "@ada"}, by="user")

    reopened = SqliteCase.open(tmp_path / "case.db")
    assert reopened.get_entity(e["id"]) == e
    assert reopened.snapshot()["name"] == "Contract"


def test_create_refuses_existing_db(tmp_path):
    SqliteCase.create(tmp_path / "case.db", name="One")
    with pytest.raises(CaseError, match="already exists"):
        SqliteCase.create(tmp_path / "case.db", name="Two")


def test_open_missing_db_raises(tmp_path):
    with pytest.raises(CaseError, match="not found"):
        SqliteCase.open(tmp_path / "nope.db")


def test_open_refuses_newer_schema(tmp_path):
    db = tmp_path / "case.db"
    SqliteCase.create(db, name="From the future")
    with sqlite3.connect(db) as conn:
        conn.execute("UPDATE meta SET value = ? WHERE key = 'schema_version'", ("99",))
    with pytest.raises(CaseError, match="newer Azimut"):
        SqliteCase.open(db)


# -- database behaviour ----------------------------------------------------


def test_foreign_keys_forbid_a_dangling_link(tmp_path):
    """A raw insert bypassing add_entity validation still can't dangle: the FK
    pragma is on for every connection."""
    db = tmp_path / "case.db"
    store = SqliteCase.create(db, name="FK")
    a = store.add_entity("person", "A", by="user")
    with store._connect() as conn:  # exercising the connection policy directly
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO links"
                "(id, from_id, to_id, type, prov_by, prov_at, prov_status)"
                " VALUES('l_x', ?, 'ghost', 'owns', 'user', '2026', 'confirmed')",
                (a["id"],),
            )


def test_write_rolls_back_on_error(tmp_path):
    store = SqliteCase.create(tmp_path / "case.db", name="Rollback")
    store.add_entity("person", "A", by="user")

    def boom(conn):
        conn.execute(
            "INSERT INTO entities(id, type, label, prov_by, prov_at)"
            " VALUES('e_x', 'person', 'B', 'user', '2026')"
        )
        raise RuntimeError("mid-transaction failure")

    with pytest.raises(RuntimeError):
        store._write(boom)  # exercising the transaction helper directly

    # the aborted insert left no trace
    assert store.get_entity("e_x") is None
    assert len(store.list_entities()) == 1


_SCHEMA_V1 = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE entities (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL,
    attrs_json TEXT NOT NULL DEFAULT '{}',
    prov_by TEXT NOT NULL, prov_at TEXT NOT NULL,
    prov_status TEXT NOT NULL DEFAULT 'confirmed', prov_source TEXT
);
CREATE TABLE links (
    id TEXT PRIMARY KEY, from_id TEXT NOT NULL REFERENCES entities(id),
    to_id TEXT NOT NULL REFERENCES entities(id), type TEXT NOT NULL,
    prov_by TEXT NOT NULL, prov_at TEXT NOT NULL,
    prov_status TEXT NOT NULL DEFAULT 'confirmed', prov_source TEXT
);
CREATE TABLE folders (path TEXT PRIMARY KEY);
INSERT INTO meta(key, value) VALUES('schema_version', '1');
INSERT INTO entities(id, type, label, attrs_json, prov_by, prov_at)
    VALUES('e1', 'media', 'm', '{"folder": "Sources/Telegram"}', 'user', '2026');
INSERT INTO entities(id, type, label, attrs_json, prov_by, prov_at)
    VALUES('e2', 'media', 'loose', '{}', 'user', '2026');
"""


def test_open_upgrades_a_v1_db_through_every_migration(tmp_path):
    """A schema-1 case.db is upgraded on open through the whole chain: the folder
    column is added and backfilled (1->2) and the jobs table is created (2->3),
    reaching the current schema — and a second open re-applies nothing."""
    db = tmp_path / "case.db"
    with sqlite3.connect(db) as conn:
        conn.executescript(_SCHEMA_V1)

    store = SqliteCase.open(db)  # runs 1 -> 2 -> 3 in place

    # 1 -> 2: the folder column is backfilled and pages by folder.
    assert [e["id"] for e in store.page_entities(folder="Sources/Telegram")["items"]] == ["e1"]
    assert [e["id"] for e in store.page_entities(unfiled=True)["items"]] == ["e2"]
    # 2 -> 3: the durable jobs table exists and works.
    store.enqueue_job("thumbnail", key="media/x.jpg")
    assert store.count_jobs() == {"queued": 1}
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0] == "3"
        applied = {
            r[0] for r in conn.execute("SELECT version FROM schema_migrations").fetchall()
        }
        assert {2, 3} <= applied

    SqliteCase.open(db)  # idempotent — the second open applies nothing
    with sqlite3.connect(db) as conn:
        for version in (2, 3):
            assert conn.execute(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = ?", (version,)
            ).fetchone()[0] == 1


def test_pagination_keys_on_rowid_so_a_deletion_does_not_skip(tmp_path):
    """The cursor keys on rowid, not an offset, so removing an already-seen row
    between page fetches never makes the next page skip a live entity."""
    store = SqliteCase.create(tmp_path / "case.db", name="Keyset")
    ids = [store.add_entity("person", f"P{i}", by="user")["id"] for i in range(4)]

    page1 = store.page_entities(limit=2)
    assert [e["id"] for e in page1["items"]] == ids[:2]

    store.remove_entity(ids[0])  # a row before the cursor disappears

    page2 = store.page_entities(limit=2, cursor=page1["next_cursor"])
    assert [e["id"] for e in page2["items"]] == ids[2:]  # nothing skipped


# -- converter -------------------------------------------------------------


def test_convert_matches_the_source_graph(tmp_path):
    src = _json_case(
        folders=["Sources", "Sources/Telegram"],
        entities=[
            _entity("e_a", type="person", label="Ada"),
            _entity("e_b", type="account", label="@ada", attrs={"handle": "@ada"}),
            _entity("e_c", type="media", label="photo", attrs={"path": "media/x.jpg"}),
        ],
        links=[
            {
                "id": "l_1",
                "from": "e_a",
                "to": "e_b",
                "type": "owns",
                "provenance": {"by": "user", "at": "2026-01-01T00:00:00Z", "status": "confirmed"},
            }
        ],
    )

    report = convert_json_to_sqlite(src, tmp_path / "case.db")
    assert (report.entities, report.links, report.folders) == (3, 1, 2)
    assert report.integrity_ok and report.missing_endpoints == []

    store = SqliteCase.open(tmp_path / "case.db")
    assert {e["id"] for e in store.list_entities()} == {"e_a", "e_b", "e_c"}
    assert store.get_entity("e_b")["attrs"] == {"handle": "@ada"}
    assert store.list_folders() == ["Sources", "Sources/Telegram"]
    assert store.find_entity(attr="path", value="media/x.jpg")["id"] == "e_c"
    snap = store.snapshot()
    assert snap["name"] == "Legacy" and snap["created_at"] == "2026-01-01T00:00:00Z"


def test_convert_reports_and_drops_dangling_links(tmp_path):
    src = _json_case(
        entities=[_entity("e_a")],
        links=[
            {
                "id": "l_ghost",
                "from": "e_a",
                "to": "e_missing",
                "type": "owns",
                "provenance": {"by": "user", "at": "2026", "status": "confirmed"},
            }
        ],
    )

    report = convert_json_to_sqlite(src, tmp_path / "case.db")
    assert report.missing_endpoints == ["l_ghost"]
    assert report.integrity_ok  # a dropped edge is not an integrity failure

    store = SqliteCase.open(tmp_path / "case.db")
    assert store.list_links() == []
    assert store.get_entity("e_a") is not None  # the entity is never erased


def test_convert_rolls_back_and_leaves_no_db_on_failure(tmp_path):
    src = _json_case(entities=[_entity("e_dup"), _entity("e_dup")])  # duplicate primary key
    db = tmp_path / "case.db"

    with pytest.raises(sqlite3.IntegrityError):
        convert_json_to_sqlite(src, db)

    assert not db.exists()
    assert not (tmp_path / "case.db.tmp").exists()


def test_convert_writes_only_the_target_db(tmp_workspace, tmp_path):
    prov = {"by": "user", "at": "2026-01-01T00:00:00Z", "status": "confirmed"}
    case = write_legacy_json_case(
        "Live",
        entities=[{"id": "e_a", "type": "person", "label": "Ada", "attrs": {}, "provenance": prov}],
    )
    before = case.json_path.read_bytes()

    convert_json_to_sqlite(case.read(), tmp_path / "case.db")

    # the converter only reads the graph; it never rewrites the source case.json
    assert case.json_path.read_bytes() == before
    assert (tmp_path / "case.db").exists()


def test_convert_a_large_case_is_intact(tmp_workspace, tmp_path):
    case, summary = build_big_case(
        name="Big", entities=300, links=400, media=100, notes=20, artifacts=30,
        write_media_files=False,
    )
    report = convert_json_to_sqlite(case.read(), tmp_path / "case.db")

    assert report.integrity_ok
    assert report.entities == summary.entities
    store = SqliteCase.open(tmp_path / "case.db")
    assert len(store.list_entities()) == summary.entities
    # every surviving link resolves to real endpoints
    ids = {e["id"] for e in store.list_entities()}
    for link in store.list_links():
        assert link["from"] in ids and link["to"] in ids
