"""Take a `case.db` back to an older shape, so a migration can be run for real.

A test database is born at the current schema, so rewinding it has to undo the
*shape* and not only the version number: every table, index and column a later
migration creates is already there, and replaying that step onto its own work
fails on an object that exists. One entry per object added after the version
being rewound to, which is what keeps this file the single place a new migration
has to be remembered.

Columns are dropped by rebuilding the table rather than with `ALTER TABLE ...
DROP COLUMN`, which needs SQLite 3.35 (2021): the backend matrix runs the Python
3.11 floor against whatever libsqlite3 each platform ships, and a test needing a
newer SQLite than the code does is a false alarm waiting to fire on one OS.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

from azimut.engine import entities as entity_engine

#: Objects created after schema 7, dropped newest first. A migration that adds a
#: table or an index adds its line here in the same change.
_AFTER_7 = (
    "DROP TABLE IF EXISTS temporal_items",
    "DROP INDEX IF EXISTS idx_entities_filed",
    "DROP INDEX IF EXISTS idx_entities_label",
    "DROP TABLE IF EXISTS analysis_views",
    "DROP TABLE IF EXISTS entity_images",
    "DROP TABLE IF EXISTS graph_pins",
)

#: The `links` table exactly as schema 7 shipped it: before `confidence` (8) and
#: before `nature` (11).
_LINKS_V7 = """
CREATE TABLE links_rewound (
    id          TEXT PRIMARY KEY,
    from_id     TEXT NOT NULL REFERENCES entities(id),
    to_id       TEXT NOT NULL REFERENCES entities(id),
    type        TEXT NOT NULL,
    prov_by     TEXT NOT NULL,
    prov_at     TEXT NOT NULL,
    prov_status TEXT NOT NULL DEFAULT 'confirmed',
    prov_source TEXT
);
INSERT INTO links_rewound
    SELECT id, from_id, to_id, type, prov_by, prov_at, prov_status, prov_source FROM links;
DROP TABLE links;
ALTER TABLE links_rewound RENAME TO links;
CREATE INDEX idx_links_from ON links(from_id);
CREATE INDEX idx_links_to   ON links(to_id);
CREATE INDEX idx_links_type ON links(type);
"""

#: The `links` table as schema 8 shipped it: `confidence` is in, `nature` is not.
_LINKS_V8 = """
CREATE TABLE links_rewound AS SELECT id, from_id, to_id, type, prov_by,
    prov_at, prov_status, prov_source, confidence FROM links;
DROP TABLE links;
ALTER TABLE links_rewound RENAME TO links;
CREATE INDEX idx_links_from ON links(from_id);
CREATE INDEX idx_links_to   ON links(to_id);
CREATE INDEX idx_links_type ON links(type);
"""


def _unfold_search_text(conn: sqlite3.Connection) -> None:
    """Write both search indexes the way 0.3.1 did, before schema 19 folded them:
    case only, every accent kept. Column for column what `_entity_search_text` and
    `_media_search_text` put in, less the fold."""
    conn.row_factory = sqlite3.Row
    for row in conn.execute("SELECT id, type, label, attrs_json FROM entities").fetchall():
        attrs = json.loads(row["attrs_json"])
        fixed = (row["label"], row["type"], attrs.get("folder"), attrs.get("notes"))
        declared = entity_engine.search_values(row["type"], attrs)
        text = "\n".join(str(value) for value in (*fixed, *declared) if value)
        conn.execute("UPDATE entities SET search_text = ? WHERE id = ?", (text.casefold(), row["id"]))
    for row in conn.execute("SELECT path, item_json FROM media_items").fetchall():
        item = json.loads(row["item_json"])
        source = item.get("source") or {}
        text = "\n".join(str(value) for value in (
            item.get("filename") or Path(str(item.get("path") or "")).name,
            item.get("title"), item.get("notes"), item.get("folder"),
            source.get("title"), source.get("uploader"),
            source.get("webpage_url") or source.get("url"),
        ) if value)
        conn.execute(
            "UPDATE media_items SET search_text = ? WHERE path = ?", (text.casefold(), row["path"])
        )


def rewind(db: Path | str, version: int) -> None:
    """Put `case.db` back at `version`, shape included, ready to be migrated up.

    18 is what 0.3.1 shipped. Nothing after it changes the shape yet, only what the
    search indexes hold, so that is what a rewind to it undoes.
    """
    if version not in (7, 8, 18):
        raise ValueError(f"no rewind to schema {version}")
    with closing(sqlite3.connect(db)) as conn, conn:
        if version == 18:
            _unfold_search_text(conn)
        else:
            conn.executescript(_LINKS_V7 if version == 7 else _LINKS_V8)
            for statement in _AFTER_7:
                conn.execute(statement)
        conn.execute(
            "UPDATE meta SET value = ? WHERE key = 'schema_version'", (str(version),)
        )
        conn.execute(
            "DELETE FROM schema_migrations WHERE version > ?", (version,)
        )
        conn.commit()
