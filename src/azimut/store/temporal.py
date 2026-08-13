"""The derived temporal projection, written and checked.

Claims and media sidecars stay authoritative; `temporal_items` is a rebuildable
index over them that Time and Timeline read. These keep it in step with a write
and answer whether it has drifted, both inside the caller's transaction.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from ..engine import timeline as timeline_engine


_TEMPORAL_COLUMNS = (
    "id", "owner_id", "authority", "category", "kind", "raw", "earliest",
    "latest", "precision", "shape", "time_role", "uncertain", "approximate",
    "zone", "sortable", "status", "confidence", "parse_error",
)


def _write_temporal_rows(
    conn: sqlite3.Connection,
    owner_id: str,
    authority: str,
    rows: list[timeline_engine.ProjectionRow],
) -> None:
    """Replace one authority's derived rows for one owner."""
    conn.execute(
        "DELETE FROM temporal_items WHERE owner_id = ? AND authority = ?",
        (owner_id, authority),
    )
    placeholders = ", ".join("?" for _ in _TEMPORAL_COLUMNS)
    for row in rows:
        record = row.record()
        conn.execute(
            f"INSERT INTO temporal_items({', '.join(_TEMPORAL_COLUMNS)})"
            f" VALUES({placeholders})",
            tuple(record[column] for column in _TEMPORAL_COLUMNS),
        )


def _entity_for_projection(row: sqlite3.Row) -> dict[str, Any]:
    entity: dict[str, Any] = {
        "id": row["id"],
        "type": row["type"],
        "label": row["label"],
        "attrs": json.loads(row["attrs_json"]),
        "provenance": {
            "by": row["prov_by"],
            "at": row["prov_at"],
            "status": row["prov_status"],
        },
    }
    if row["prov_source"] is not None:
        entity["provenance"]["source"] = row["prov_source"]
    return entity


def _sync_entity_temporal(conn: sqlite3.Connection, entity: dict[str, Any]) -> None:
    _write_temporal_rows(
        conn,
        str(entity["id"]),
        "entity",
        timeline_engine.project_entity(entity),
    )


def _sync_media_temporal(
    conn: sqlite3.Connection, item: dict[str, Any], entity_id: str | None
) -> None:
    if not entity_id:
        return
    # The media browse contract historically permits a row whose optional
    # entity id no longer resolves (imports repair that association later).
    # Temporal rows do carry a foreign key, so only project an owner that exists.
    if conn.execute("SELECT 1 FROM entities WHERE id = ?", (entity_id,)).fetchone() is None:
        return
    _write_temporal_rows(
        conn,
        entity_id,
        "media",
        timeline_engine.project_media(item, entity_id),
    )


def _rebuild_temporal_projection_conn(conn: sqlite3.Connection) -> int:
    """Rebuild the projection in the caller's transaction, returning its size."""
    conn.execute("DELETE FROM temporal_items")
    for row in conn.execute("SELECT * FROM entities ORDER BY rowid").fetchall():
        _sync_entity_temporal(conn, _entity_for_projection(row))
    for row in conn.execute(
        "SELECT item_json, entity_id FROM media_items"
        " WHERE entity_id IS NOT NULL ORDER BY rowid"
    ).fetchall():
        _sync_media_temporal(conn, json.loads(row["item_json"]), row["entity_id"])
    return int(conn.execute("SELECT COUNT(*) FROM temporal_items").fetchone()[0])


def _temporal_projection_status_conn(conn: sqlite3.Connection) -> dict[str, int | bool]:
    """Compare the derived index with graph and media authorities without writing."""
    expected: dict[str, tuple[Any, ...]] = {}

    def remember(rows: list[timeline_engine.ProjectionRow]) -> None:
        for row in rows:
            record = row.record()
            expected[row.id] = tuple(
                int(record[column])
                if column in {"uncertain", "approximate", "sortable"}
                else record[column]
                for column in _TEMPORAL_COLUMNS
            )

    entity_rows = conn.execute("SELECT * FROM entities ORDER BY rowid").fetchall()
    entity_ids = {str(row["id"]) for row in entity_rows}
    for row in entity_rows:
        remember(timeline_engine.project_entity(_entity_for_projection(row)))
    for row in conn.execute(
        "SELECT item_json, entity_id FROM media_items"
        " WHERE entity_id IS NOT NULL ORDER BY rowid"
    ).fetchall():
        entity_id = str(row["entity_id"])
        if entity_id in entity_ids:
            remember(timeline_engine.project_media(json.loads(row["item_json"]), entity_id))

    actual = {
        str(row["id"]): tuple(row[column] for column in _TEMPORAL_COLUMNS)
        for row in conn.execute(
            f"SELECT {', '.join(_TEMPORAL_COLUMNS)} FROM temporal_items"
        ).fetchall()
    }
    missing = expected.keys() - actual.keys()
    extra = actual.keys() - expected.keys()
    changed = {
        item_id for item_id in expected.keys() & actual.keys()
        if expected[item_id] != actual[item_id]
    }
    return {
        "consistent": not (missing or extra or changed),
        "expected": len(expected),
        "actual": len(actual),
        "missing": len(missing),
        "extra": len(extra),
        "changed": len(changed),
    }
