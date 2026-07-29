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
import threading

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
    column is added and backfilled (1->2), the jobs table is created (2->3),
    search/media browse indexes arrive in schema 4, the position flag in 5 and
    the trash journal in 6. A second open applies nothing."""
    db = tmp_path / "case.db"
    with sqlite3.connect(db) as conn:
        conn.executescript(_SCHEMA_V1)

    store = SqliteCase.open(db)  # runs 1 -> 2 -> 3 -> 4 -> 5 -> 6 in place

    # 1 -> 2: the folder column is backfilled and pages by folder.
    assert [e["id"] for e in store.page_entities(folder="Sources/Telegram")["items"]] == ["e1"]
    assert [e["id"] for e in store.page_entities(unfiled=True)["items"]] == ["e2"]
    # 2 -> 3: the durable jobs table exists and works.
    store.enqueue_job("thumbnail", key="media/x.jpg")
    assert store.count_jobs() == {"queued": 1}
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0] == "6"
        applied = {
            r[0] for r in conn.execute("SELECT version FROM schema_migrations").fetchall()
        }
        assert {2, 3, 4, 5, 6} <= applied
        columns = {
            row[1] for row in conn.execute("PRAGMA table_info(entities)").fetchall()
        }
        assert "search_text" in columns
        assert conn.execute(
            "SELECT value FROM meta WHERE key='media_index_ready'"
        ).fetchone()[0] == "1"
        # 5 -> 6: the trash journal is there, and empty.
        assert store.trash_summary() == {"groups": 0, "items": 0, "size_bytes": 0}

    SqliteCase.open(db)  # idempotent — the second open applies nothing
    with sqlite3.connect(db) as conn:
        for version in (2, 3, 4, 5):
            assert conn.execute(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = ?", (version,)
            ).fetchone()[0] == 1


# A schema-4 media index: the browse table as it shipped, before the position
# flag. `media_index_ready` is set because a real v4 case has already backfilled;
# without it, open would rescan the (absent) media folder and clear these rows.
_SCHEMA_V4_MEDIA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE entities (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL,
    attrs_json TEXT NOT NULL DEFAULT '{}', folder TEXT,
    search_text TEXT NOT NULL DEFAULT '',
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
CREATE TABLE jobs (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, job_key TEXT,
    state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3, payload_json TEXT NOT NULL DEFAULT '{}',
    error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE media_items (
    path TEXT PRIMARY KEY, entity_id TEXT UNIQUE, item_json TEXT NOT NULL,
    filename TEXT NOT NULL, kind TEXT NOT NULL, folder TEXT,
    name_sort TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL, search_text TEXT NOT NULL,
    source_type TEXT, source_op TEXT, imagery_mode TEXT
);
INSERT INTO meta(key, value) VALUES('schema_version', '4');
INSERT INTO meta(key, value) VALUES('media_index_ready', '1');
INSERT INTO media_items(path, item_json, filename, kind, name_sort, added_at, search_text)
    VALUES('media/photo.jpg',
           '{"path": "media/photo.jpg", "kind": "image", "gps": {"lat": 48.85, "lon": 2.29}}',
           'photo.jpg', 'image', 'photo.jpg', '2026-01-01T00:00:00Z', 'photo.jpg');
INSERT INTO media_items(path, item_json, filename, kind, name_sort, added_at, search_text)
    VALUES('media/plain.jpg', '{"path": "media/plain.jpg", "kind": "image"}',
           'plain.jpg', 'image', 'plain.jpg', '2026-01-02T00:00:00Z', 'plain.jpg');
"""


def test_open_backfills_the_position_flag_from_already_indexed_items(tmp_path):
    """4 -> 5 reads the sidecar JSON already in the row, so a case enriched before
    the column existed gains its GPS filter on open — no file scan, no re-enrich."""
    db = tmp_path / "case.db"
    with sqlite3.connect(db) as conn:
        conn.executescript(_SCHEMA_V4_MEDIA)

    store = SqliteCase.open(db)

    page = store.page_media_items(gps=True)
    assert [item["path"] for item in page["items"]] == ["media/photo.jpg"]
    assert store.page_media_items()["facets"]["gps_count"] == 1


def test_media_browse_index_pages_searches_and_counts_categories(tmp_path):
    store = SqliteCase.create(tmp_path / "case.db", name="Media index")
    store.upsert_media_item(
        {
            "path": "media/photo.png",
            "filename": "photo.png",
            "kind": "image",
            "size": 12,
            "added_at": "2026-01-01T00:00:00Z",
            "title": "Bridge",
            "notes": "river crossing",
            "folder": "Sources",
            "source": {"type": "upload"},
        },
        entity_id="e_photo",
    )
    store.upsert_media_item(
        {
            "path": "media/map.png",
            "filename": "map.png",
            "kind": "image",
            "size": 30,
            "added_at": "2026-01-02T00:00:00Z",
            "source": {"type": "satellite"},
        },
        entity_id="e_map",
    )
    store.upsert_media_item(
        {
            "path": "media/clip.mp4",
            "filename": "clip.mp4",
            "kind": "video",
            "size": 50,
            "added_at": "2026-01-03T00:00:00Z",
            "source": {"type": "download"},
        },
        entity_id="e_clip",
    )

    first = store.page_media_items(limit=2)
    assert [item["path"] for item in first["items"]] == [
        "media/clip.mp4",
        "media/map.png",
    ]
    assert first["next_cursor"] == "2"
    assert first["facets"]["category_counts"] == {
        "image": 1,
        "video": 1,
        "collage": 0,
        "satellite": 1,
        "upload": 1,
        "download": 1,
        "other": 0,
    }

    hit = store.page_media_items(q="bridge river", category="image")
    assert [item["path"] for item in hit["items"]] == ["media/photo.png"]
    assert hit["facets"]["folder_counts"] == {"Sources": 1}
    assert store.page_media_items(category="satellite")["total"] == 1
    assert store.media_items_by_paths(
        ["media/map.png", "media/photo.png", "media/missing.png"]
    ) == [
        store.page_media_items(category="satellite")["items"][0],
        store.page_media_items(q="bridge")["items"][0],
    ]


def test_concurrent_first_open_cannot_replace_registered_media_rows(tmp_path):
    db = tmp_path / "case.db"
    SqliteCase.create(db, name="Concurrent index")
    media_dir = tmp_path / "media"
    media_dir.mkdir()
    for i in range(8):
        name = f"item-{i}.png"
        (media_dir / name).write_bytes(bytes([i]))
        (media_dir / f"{name}.azimut.json").write_text(
            (
                '{"filename": "%s", "kind": "image", "size": 1,'
                ' "added_at": "2026", "source": {"type": "upload"}}'
            )
            % name,
            encoding="utf-8",
        )

    errors: list[BaseException] = []

    def open_and_register(i: int) -> None:
        try:
            store = SqliteCase.open(db)
            store.upsert_media_item(
                {
                    "path": f"media/live-{i}.png",
                    "filename": f"live-{i}.png",
                    "kind": "image",
                    "size": 1,
                    "added_at": "2026",
                    "source": {"type": "upload"},
                }
            )
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    workers = [threading.Thread(target=open_and_register, args=(i,)) for i in range(8)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()

    assert errors == []
    assert len(SqliteCase.open(db).list_media_items()) == 16


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


def test_a_media_row_carries_the_entity_it_belongs_to(tmp_workspace):
    """The link is already a column. A caller that needs the entity behind a path
    reads it off the row instead of scanning the entities table for an attribute
    match — which is what enrichment does for every near-duplicate it finds."""
    from azimut.workspace import Case

    case = Case.create("Media rows")
    photo = case.add_entity("media", "Photo", attrs={"path": "media/photo.jpg"}, by="test")
    case.upsert_media_item(
        {"path": "media/photo.jpg", "filename": "photo.jpg", "kind": "image"},
        entity_id=photo["id"],
    )
    case.upsert_media_item({"path": "media/loose.jpg", "filename": "loose.jpg", "kind": "image"})

    by_path = {item["path"]: item for item in case.list_media_items()}
    assert by_path["media/photo.jpg"]["entity_id"] == photo["id"]
    # a row nothing filed says so rather than pointing at the wrong entity
    assert by_path["media/loose.jpg"]["entity_id"] is None
    assert case.media_items_by_paths(["media/photo.jpg"])[0]["entity_id"] == photo["id"]
    assert case.page_media_items()["items"][0]["entity_id"] in (photo["id"], None)
