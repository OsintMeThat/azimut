"""In-place schema upgrades for `case.db`, one step per version.

The whole chain runs inside one immediate transaction in `SqliteCase._upgrade`,
which stamps each new schema version and records each migration as it goes. A
failure at any step rolls the lot back and the next open replays from where the
database still says it is. A step only ever reshapes the db: anything needing the
case directory as well is done by the caller after the transaction.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Callable

from .rows import _entity_search_text, _folder_of, _has_gps
from .temporal import _rebuild_temporal_projection_conn


def _migrate_1_to_2(conn: sqlite3.Connection) -> None:
    """Add the ``folder`` column, backfill it from each entity's ``attrs.folder``
    (in Python, no JSON1 dependency), and index it."""
    conn.execute("ALTER TABLE entities ADD COLUMN folder TEXT")
    for row in conn.execute("SELECT id, attrs_json FROM entities").fetchall():
        folder = _folder_of(json.loads(row["attrs_json"]))
        if folder is not None:
            conn.execute("UPDATE entities SET folder = ? WHERE id = ?", (folder, row["id"]))
    conn.execute("CREATE INDEX idx_entities_folder ON entities(folder)")


def _migrate_2_to_3(conn: sqlite3.Connection) -> None:
    """Add the durable ``jobs`` table and its indexes (background-job model)."""
    conn.execute(
        "CREATE TABLE jobs ("
        " id TEXT PRIMARY KEY, kind TEXT NOT NULL, job_key TEXT,"
        " state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,"
        " max_attempts INTEGER NOT NULL DEFAULT 3, payload_json TEXT NOT NULL DEFAULT '{}',"
        " error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    conn.execute("CREATE INDEX idx_jobs_state ON jobs(state)")
    conn.execute("CREATE UNIQUE INDEX idx_jobs_key ON jobs(kind, job_key) WHERE job_key IS NOT NULL")


def _migrate_3_to_4(conn: sqlite3.Connection) -> None:
    """Add the sidecar-derived media browse index.

    Backfilling needs the case directory as well as the database connection, so
    ``SqliteCase.open`` performs it after the schema transaction and records a
    durable ``media_index_ready`` marker. A crash between the two simply retries
    the backfill on the next open.
    """
    conn.execute("ALTER TABLE entities ADD COLUMN search_text TEXT NOT NULL DEFAULT ''")
    for row in conn.execute("SELECT id, type, label, attrs_json FROM entities"):
        attrs = json.loads(row["attrs_json"])
        conn.execute(
            "UPDATE entities SET search_text = ? WHERE id = ?",
            (_entity_search_text(row["type"], row["label"], attrs), row["id"]),
        )
    conn.execute(
        "CREATE TABLE media_items ("
        " path TEXT PRIMARY KEY, entity_id TEXT UNIQUE, item_json TEXT NOT NULL,"
        " filename TEXT NOT NULL, kind TEXT NOT NULL, folder TEXT,"
        " name_sort TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,"
        " added_at TEXT NOT NULL, search_text TEXT NOT NULL,"
        " source_type TEXT, source_op TEXT, imagery_mode TEXT)"
    )
    conn.execute("CREATE INDEX idx_media_kind ON media_items(kind)")
    conn.execute("CREATE INDEX idx_media_folder ON media_items(folder)")
    conn.execute("CREATE INDEX idx_media_name ON media_items(name_sort)")
    conn.execute("CREATE INDEX idx_media_size ON media_items(size)")
    conn.execute("CREATE INDEX idx_media_added ON media_items(added_at)")
    conn.execute("CREATE INDEX idx_media_source ON media_items(source_type)")


def _migrate_4_to_5(conn: sqlite3.Connection) -> None:
    """Add ``media_items.has_gps`` and backfill it from each indexed item.

    The sidecar JSON is already in the row, so this reads no files: a case
    enriched before the column existed gains its GPS filter on open, and one that
    was never enriched simply has every flag at zero.
    """
    conn.execute("ALTER TABLE media_items ADD COLUMN has_gps INTEGER NOT NULL DEFAULT 0")
    for row in conn.execute("SELECT path, item_json FROM media_items").fetchall():
        if _has_gps(json.loads(row["item_json"])):
            conn.execute("UPDATE media_items SET has_gps = 1 WHERE path = ?", (row["path"],))
    conn.execute("CREATE INDEX idx_media_gps ON media_items(has_gps)")


def _migrate_5_to_6(conn: sqlite3.Connection) -> None:
    """Add the ``trash`` journal.

    One row per delete action, not per entity: deleting a video that carries
    three Inspect sessions writes a single group that comes back as a whole. The
    payload holds the recipe (entities, their incident links, the files moved
    aside, the tombstones the delete wrote); the head columns are what the
    sidebar node reads, so listing the trash never touches a payload.
    """
    conn.execute(
        "CREATE TABLE trash ("
        " id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL, label TEXT NOT NULL,"
        " type TEXT NOT NULL, item_count INTEGER NOT NULL DEFAULT 0,"
        " size_bytes INTEGER NOT NULL DEFAULT 0,"
        " payload_json TEXT NOT NULL DEFAULT '{}')"
    )
    conn.execute("CREATE INDEX idx_trash_deleted ON trash(deleted_at)")


def _migrate_6_to_7(conn: sqlite3.Connection) -> None:
    """Track interrupted delete and restore operations for crash recovery."""
    conn.execute("ALTER TABLE trash ADD COLUMN state TEXT NOT NULL DEFAULT 'ready'")


def _migrate_7_to_8(conn: sqlite3.Connection) -> None:
    """Let an edge say how sure the analyst is (ONTOLOGY §3).

    Nullable and unset, so every link already in the case reads as "not assessed",
    which is the truth about them rather than a level invented on their behalf.
    """
    conn.execute("ALTER TABLE links ADD COLUMN confidence INTEGER")


def _migrate_8_to_9(conn: sqlite3.Connection) -> None:
    """Rebuild every entity's search text so the declared fields are in it.

    The index is a stored column, so widening what goes into it only reaches rows
    written afterwards: a case filed last week would keep answering searches from
    its label alone. One pass, no shape change.
    """
    for row in conn.execute("SELECT id, type, label, attrs_json FROM entities").fetchall():
        attrs = json.loads(row["attrs_json"])
        conn.execute(
            "UPDATE entities SET search_text = ? WHERE id = ?",
            (_entity_search_text(row["type"], row["label"], attrs), row["id"]),
        )


def _migrate_9_to_10(conn: sqlite3.Connection) -> None:
    """Let the analyst's own arrangement of the graph survive a reload.

    One row per node *per lens*: a lens draws its own nodes and edges, so it
    clusters differently, and a single arrangement would force every reading into
    the shape of whichever one it was built in.

    Nothing to backfill: a case opened before this had no way to move a node, so
    every node in it is placed by the layout, which is what an empty table says.
    """
    conn.execute(
        "CREATE TABLE graph_pins ("
        " entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,"
        " lens      TEXT NOT NULL,"
        " x         REAL NOT NULL,"
        " y         REAL NOT NULL,"
        " PRIMARY KEY (entity_id, lens)"
        ")"
    )
    conn.execute("CREATE INDEX idx_graph_pins_lens ON graph_pins(lens)")


def _migrate_10_to_11(conn: sqlite3.Connection) -> None:
    """Let an edge say what kind of tie it states, where the verb cannot.

    Nothing to backfill and no index: every existing edge is unqualified, which is
    what a null column already says, and nothing filters or sorts on this — it is
    read with the edge it sits on.
    """
    conn.execute("ALTER TABLE links ADD COLUMN nature TEXT")


def _migrate_11_to_12(conn: sqlite3.Connection) -> None:
    """Add galleries holding private photos or existing Media references."""
    conn.execute(
        "CREATE TABLE entity_images ("
        " entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,"
        " image_id TEXT NOT NULL,"
        " media_id TEXT REFERENCES entities(id) ON DELETE CASCADE,"
        " path TEXT,"
        " thumbnail TEXT,"
        " title TEXT,"
        " position INTEGER NOT NULL,"
        " is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),"
        " PRIMARY KEY (entity_id, image_id),"
        " CHECK ((media_id IS NOT NULL AND path IS NULL AND thumbnail IS NULL)"
        " OR (media_id IS NULL AND path IS NOT NULL AND thumbnail IS NOT NULL)))"
    )
    conn.execute("CREATE INDEX idx_entity_images_media ON entity_images(media_id)")
    conn.execute(
        "CREATE UNIQUE INDEX idx_entity_images_media_once"
        " ON entity_images(entity_id, media_id) WHERE media_id IS NOT NULL"
    )
    conn.execute(
        "CREATE UNIQUE INDEX idx_entity_images_path"
        " ON entity_images(path) WHERE path IS NOT NULL"
    )
    conn.execute(
        "CREATE UNIQUE INDEX idx_entity_images_primary"
        " ON entity_images(entity_id) WHERE is_primary = 1"
    )


def _migrate_12_to_13(conn: sqlite3.Connection) -> None:
    """Add named analysis readings, empty until the analyst saves one."""
    conn.execute(
        "CREATE TABLE analysis_views ("
        " id TEXT PRIMARY KEY,"
        " name TEXT NOT NULL,"
        " mode TEXT NOT NULL CHECK (mode IN ('live', 'snapshot')),"
        " surface TEXT NOT NULL CHECK ("
        "surface IN ('board', 'graph')"
        "),"
        " spec_json TEXT NOT NULL,"
        " snapshot_count INTEGER NOT NULL DEFAULT 0,"
        " created_at TEXT NOT NULL,"
        " updated_at TEXT NOT NULL"
        ")"
    )
    conn.execute(
        "CREATE INDEX idx_analysis_views_updated ON analysis_views(updated_at DESC)"
    )


def _migrate_13_to_14(conn: sqlite3.Connection) -> None:
    """Index the two columns the catalog orders the whole case by.

    Sorting by identity or by when a row was filed reads the whole filtered set,
    not the page — which is the difference between *the newest in this case* and
    *the newest of the hundred rows loaded*. Without an index to seek into, every
    page of that read scanned the table and sorted it in a temp B-tree, so the
    keyset cursor bounded what came back and not what it cost.

    The label index carries `COLLATE NOCASE` because the ordering does: an index
    on the bare column sorts by byte and cannot serve the query.
    """
    conn.execute("CREATE INDEX idx_entities_label ON entities(label COLLATE NOCASE)")
    conn.execute("CREATE INDEX idx_entities_filed ON entities(prov_at)")


def _migrate_14_to_15(conn: sqlite3.Connection) -> None:
    """Add and backfill the rebuildable Time and Timeline search projection."""
    conn.execute(
        "CREATE TABLE temporal_items ("
        " id TEXT PRIMARY KEY,"
        " owner_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,"
        " authority TEXT NOT NULL CHECK (authority IN ('entity', 'media')),"
        " category TEXT NOT NULL CHECK ("
        "category IN ('statement', 'media', 'case_activity')"
        "),"
        " kind TEXT NOT NULL, raw TEXT, earliest TEXT, latest TEXT, precision TEXT,"
        " shape TEXT, time_role TEXT,"
        " uncertain INTEGER NOT NULL DEFAULT 0 CHECK (uncertain IN (0, 1)),"
        " approximate INTEGER NOT NULL DEFAULT 0 CHECK (approximate IN (0, 1)),"
        " zone TEXT, sortable INTEGER NOT NULL DEFAULT 0 CHECK (sortable IN (0, 1)),"
        " status TEXT, confidence TEXT, parse_error TEXT"
        ")"
    )
    conn.execute(
        "CREATE INDEX idx_temporal_window"
        " ON temporal_items(category, earliest, latest)"
    )
    conn.execute(
        "CREATE INDEX idx_temporal_owner ON temporal_items(owner_id, category)"
    )
    conn.execute("CREATE INDEX idx_temporal_kind ON temporal_items(kind)")
    _rebuild_temporal_projection_conn(conn)


def _migrate_15_to_16(conn: sqlite3.Connection) -> None:
    """Extend the case-owned Analysis View contract to Timeline readings."""
    conn.execute("ALTER TABLE analysis_views RENAME TO analysis_views_legacy")
    conn.execute(
        "CREATE TABLE analysis_views ("
        " id TEXT PRIMARY KEY, name TEXT NOT NULL,"
        " mode TEXT NOT NULL CHECK (mode IN ('live', 'snapshot')),"
        " surface TEXT NOT NULL CHECK (surface IN ('board', 'graph', 'timeline')),"
        " spec_json TEXT NOT NULL, snapshot_count INTEGER NOT NULL DEFAULT 0,"
        " created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    # Named, not `SELECT *`: the legacy table's columns are in whatever order its own
    # history left them, and a positional copy would silently rotate the last three.
    conn.execute(
        "INSERT INTO analysis_views"
        " (id, name, mode, surface, spec_json, snapshot_count, created_at, updated_at)"
        " SELECT id, name, mode, surface, spec_json, snapshot_count, created_at,"
        " updated_at FROM analysis_views_legacy"
    )
    conn.execute("DROP TABLE analysis_views_legacy")
    conn.execute(
        "CREATE INDEX idx_analysis_views_updated ON analysis_views(updated_at DESC)"
    )


def _migrate_16_to_17(conn: sqlite3.Connection) -> None:
    """Rewrite temporal bounds to their fixed-width sortable representation."""
    _rebuild_temporal_projection_conn(conn)


# from_version -> function(conn) applying the in-place upgrade to from_version + 1.
# The whole chain runs inside one immediate transaction in `SqliteCase._upgrade`,
# which stamps each new schema_version and records each migration as it goes; a
# failure at any step rolls the lot back and the next open replays from where the
# database still says it is. A step only reshapes the db.
_SQLITE_MIGRATIONS: dict[int, Callable[[sqlite3.Connection], None]] = {
    1: _migrate_1_to_2,
    2: _migrate_2_to_3,
    3: _migrate_3_to_4,
    4: _migrate_4_to_5,
    5: _migrate_5_to_6,
    6: _migrate_6_to_7,
    7: _migrate_7_to_8,
    8: _migrate_8_to_9,
    9: _migrate_9_to_10,
    10: _migrate_10_to_11,
    11: _migrate_11_to_12,
    12: _migrate_12_to_13,
    13: _migrate_13_to_14,
    14: _migrate_14_to_15,
    15: _migrate_15_to_16,
    16: _migrate_16_to_17,
}
