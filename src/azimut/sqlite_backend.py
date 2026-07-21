"""SQLite-backed `CaseRepository` (Step 3 of docs/STORAGE_AND_PERFORMANCE.md).

`SqliteCase` is the second implementation of the graph contract in
`repository.py`; `workspace.Case` is the first (JSON). It answers the same
methods from a per-case `case.db`, so a single mutation touches one row and one
short transaction instead of rewriting the whole file — the O(n)-per-write
ceiling the migration removes.

Scope of this step: the store and the JSON->SQLite converter, exercised by the
shared contract tests in `tests/test_repository.py` and by
`tests/test_sqlite_backend.py`. Wiring it into `Case.open` behind the manifest's
storage format is deliberately a *later* step (Delivery 4, "Safe activation"),
so nothing here changes production behavior yet.

Frozen-binary constraints (see the doc): SQLite is the stdlib `sqlite3` module,
already bundled by PyInstaller, so this adds no runtime dependency. Anything
beyond core SQL (FTS5, JSON1, RTree) is per-binary and must be probed at runtime
with a fallback before it enters the contract — this module stays on core SQL:
`find_entity` scans and matches attrs in Python rather than relying on JSON1.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterator, TypeVar

from .repository import EntityStatus
from .workspace import Case, CaseError, _new_id, _now, _parse_cursor, _replace_with_retry

if TYPE_CHECKING:
    from .repository import CaseRepository

# SQLite storage schema. Independent of the JSON `CASE_SCHEMA`: the manifest's
# storage-format field selects the backend, and each format counts its own shape
# upgrades. Bump this in the same change that adds a migration to
# `_SQLITE_MIGRATIONS` (and update `_SCHEMA` so a fresh db is born current).
#
# Schema 2 denormalises `attrs.folder` into an indexed `folder` column so the
# catalog can page and count a folder's entities without a JSON scan.
# Schema 3 adds the durable `jobs` table: local background work (thumbnails
# today, EXIF/OCR/transcript later) that must survive a restart and be
# recoverable — the doc's "thumbnail and background-job model".
SQLITE_SCHEMA = 3

_SCHEMA = """
CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);
CREATE TABLE entities (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    label       TEXT NOT NULL,
    attrs_json  TEXT NOT NULL DEFAULT '{}',
    folder      TEXT,
    prov_by     TEXT NOT NULL,
    prov_at     TEXT NOT NULL,
    prov_status TEXT NOT NULL DEFAULT 'confirmed',
    prov_source TEXT
);
CREATE TABLE links (
    id          TEXT PRIMARY KEY,
    from_id     TEXT NOT NULL REFERENCES entities(id),
    to_id       TEXT NOT NULL REFERENCES entities(id),
    type        TEXT NOT NULL,
    prov_by     TEXT NOT NULL,
    prov_at     TEXT NOT NULL,
    prov_status TEXT NOT NULL DEFAULT 'confirmed',
    prov_source TEXT
);
CREATE TABLE folders (
    path TEXT PRIMARY KEY
);
CREATE TABLE jobs (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    job_key      TEXT,
    state        TEXT NOT NULL DEFAULT 'queued',
    attempts     INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    payload_json TEXT NOT NULL DEFAULT '{}',
    error        TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX idx_entities_type   ON entities(type);
CREATE INDEX idx_entities_status ON entities(prov_status);
CREATE INDEX idx_entities_folder ON entities(folder);
CREATE INDEX idx_links_from ON links(from_id);
CREATE INDEX idx_links_to   ON links(to_id);
CREATE INDEX idx_links_type ON links(type);
CREATE INDEX idx_jobs_state ON jobs(state);
CREATE UNIQUE INDEX idx_jobs_key ON jobs(kind, job_key) WHERE job_key IS NOT NULL;
"""

# Job lifecycle (doc "Job states"): a fresh job is `queued`; the worker claims it
# `running`; it finishes `ready` or, past its retry budget, `failed`; an explicit
# cancel makes it `cancelled`. An interrupted `running` job (a crash mid-work) is
# recovered on open back to `queued` or `failed` per its retry count.
JOB_STATES = ("queued", "running", "ready", "failed", "cancelled")
_JOB_TERMINAL = frozenset({"ready", "failed", "cancelled"})

T = TypeVar("T")


def _like_contains(term: str) -> str:
    """Wrap a search term for a case-insensitive ``LIKE ? ESCAPE '\\'`` substring
    match, escaping the LIKE wildcards so a literal ``%`` or ``_`` matches
    itself."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _folder_of(attrs: dict[str, Any] | None) -> str | None:
    """The indexed folder value for an entity: its ``attrs.folder`` path, or None
    when unfiled — an absent or empty folder both read as unfiled."""
    folder = (attrs or {}).get("folder")
    return folder or None


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


# from_version -> function(conn) applying the in-place upgrade to from_version + 1.
# Runs inside one transaction per step in `SqliteCase._upgrade`, which stamps the
# new schema_version and records the migration; the step only reshapes the db.
_SQLITE_MIGRATIONS: dict[int, Callable[[sqlite3.Connection], None]] = {
    1: _migrate_1_to_2,
    2: _migrate_2_to_3,
}


class SqliteCase:
    """SQLite implementation of `CaseRepository` over one `case.db` file."""

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)

    # -- lifecycle ---------------------------------------------------------

    @classmethod
    def create(
        cls,
        db_path: Path,
        *,
        name: str,
        created_at: str | None = None,
        updated_at: str | None = None,
    ) -> "SqliteCase":
        db_path = Path(db_path)
        if db_path.exists():
            raise CaseError(f"case db '{db_path.name}' already exists")
        store = cls(db_path)
        now = _now()
        with store._connect() as conn:
            conn.executescript(_SCHEMA)
            conn.execute("BEGIN IMMEDIATE")
            try:
                for key, value in (
                    ("schema_version", str(SQLITE_SCHEMA)),
                    ("name", name),
                    ("created_at", created_at or now),
                    ("updated_at", updated_at or now),
                ):
                    conn.execute("INSERT INTO meta(key, value) VALUES(?, ?)", (key, value))
                conn.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)",
                    (SQLITE_SCHEMA, now),
                )
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
        return store

    @classmethod
    def open(cls, db_path: Path) -> "SqliteCase":
        """Open an existing `case.db`, upgrading an older schema and refusing a
        newer one.

        Mirrors `Case.migrate`'s forward-compat guarantee for the JSON format: a
        database written by a newer Azimut is refused rather than mangled, and an
        older one is brought up to `SQLITE_SCHEMA` in order before use.
        """
        db_path = Path(db_path)
        if not db_path.exists():
            raise CaseError(f"case db '{db_path.name}' not found")
        store = cls(db_path)
        with store._connect() as conn:
            row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
        version = int(row["value"]) if row else 1
        if version > SQLITE_SCHEMA:
            raise CaseError(
                f"case db '{db_path.name}' was made with a newer Azimut "
                f"(schema {version} > {SQLITE_SCHEMA}); update Azimut to open it"
            )
        if version < SQLITE_SCHEMA:
            store._upgrade()
        return store

    def _upgrade(self) -> None:
        """Bring an older `case.db` up to `SQLITE_SCHEMA`, each step in its own
        immediate transaction and rolled back on failure. Re-reads the version
        inside the transaction so a second opener that raced the first finds
        nothing left to apply rather than replaying a migration."""
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute(
                    "SELECT value FROM meta WHERE key = 'schema_version'"
                ).fetchone()
                current = int(row["value"]) if row else 1
                for step in range(current, SQLITE_SCHEMA):
                    migrate = _SQLITE_MIGRATIONS.get(step)
                    if migrate is None:
                        raise CaseError(f"no migration for case db schema {step}")
                    migrate(conn)
                    conn.execute(
                        "UPDATE meta SET value = ? WHERE key = 'schema_version'", (str(step + 1),)
                    )
                    conn.execute(
                        "INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)",
                        (step + 1, _now()),
                    )
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise

    # -- connection / transaction plumbing ---------------------------------

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        # A fresh connection per operation: the per-case work is serialised by
        # SQLite's own file lock plus busy_timeout, so no Python lock is needed
        # and there is no cross-thread connection to mismanage. Autocommit
        # (isolation_level=None) leaves transaction control explicit — reads run
        # bare, writes wrap in BEGIN IMMEDIATE..COMMIT via `_write`.
        conn = sqlite3.connect(self.db_path, isolation_level=None)
        try:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA busy_timeout = 5000")
            conn.execute("PRAGMA synchronous = FULL")
            yield conn
        finally:
            conn.close()

    def _write(self, op: Callable[[sqlite3.Connection], T]) -> T:
        """Run `op` inside one immediate transaction, rolling back on error."""
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                result = op(conn)
                conn.execute("COMMIT")
                return result
            except BaseException:
                conn.execute("ROLLBACK")
                raise

    @staticmethod
    def _touch(conn: sqlite3.Connection) -> None:
        conn.execute("UPDATE meta SET value = ? WHERE key = 'updated_at'", (_now(),))

    # -- row <-> dict mapping ----------------------------------------------

    @staticmethod
    def _entity(row: sqlite3.Row) -> dict[str, Any]:
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

    @staticmethod
    def _link(row: sqlite3.Row) -> dict[str, Any]:
        link: dict[str, Any] = {
            "id": row["id"],
            "from": row["from_id"],
            "to": row["to_id"],
            "type": row["type"],
            "provenance": {
                "by": row["prov_by"],
                "at": row["prov_at"],
                "status": row["prov_status"],
            },
        }
        if row["prov_source"] is not None:
            link["provenance"]["source"] = row["prov_source"]
        return link

    @staticmethod
    def _job(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "kind": row["kind"],
            "key": row["job_key"],
            "state": row["state"],
            "attempts": row["attempts"],
            "max_attempts": row["max_attempts"],
            "payload": json.loads(row["payload_json"]),
            "error": row["error"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    # -- reads -------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        with self._connect() as conn:
            meta = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM meta")}
            entities = [
                self._entity(r) for r in conn.execute("SELECT * FROM entities ORDER BY rowid")
            ]
            links = [self._link(r) for r in conn.execute("SELECT * FROM links ORDER BY rowid")]
            folders = [
                r["path"]
                for r in conn.execute("SELECT path FROM folders ORDER BY path COLLATE NOCASE")
            ]
        schema = int(meta.get("schema_version", SQLITE_SCHEMA))
        return {
            "azimut": {"schema": schema, "storage": "sqlite"},
            "name": meta.get("name", ""),
            "created_at": meta.get("created_at"),
            "updated_at": meta.get("updated_at"),
            "folders": folders,
            "entities": entities,
            "links": links,
        }

    def list_entities(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            return [self._entity(r) for r in conn.execute("SELECT * FROM entities ORDER BY rowid")]

    def list_links(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            return [self._link(r) for r in conn.execute("SELECT * FROM links ORDER BY rowid")]

    def links_of(self, entity_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM links WHERE from_id = ? OR to_id = ? ORDER BY rowid",
                (entity_id, entity_id),
            ).fetchall()
        return [self._link(r) for r in rows]

    def page_entities(
        self,
        *,
        limit: int = 100,
        cursor: str | None = None,
        types: list[str] | None = None,
        status: EntityStatus | None = None,
        query: str | None = None,
        folder: str | None = None,
        unfiled: bool = False,
    ) -> dict[str, Any]:
        """A bounded, cursor-paginated slice of entities in insertion order.

        The cursor keys on ``rowid`` (monotonic, primary-index-backed), so a
        background import appending rows never shifts a page the analyst already
        scrolled past — new rows land after the current tail. Filters compose in
        SQL: ``types`` (an ``IN`` set), ``status``, a case-insensitive ``query``
        over the label, and folder — either ``unfiled`` (no folder) or an exact
        ``folder`` path. One extra row is peeked to know whether a further page
        exists, so ``next_cursor`` is None exactly on the last page.
        """
        where: list[str] = []
        params: list[Any] = []
        if cursor is not None:
            where.append("rowid > ?")
            params.append(_parse_cursor(cursor))
        if types:
            where.append(f"type IN ({', '.join('?' * len(types))})")
            params.extend(types)
        if status is not None:
            where.append("prov_status = ?")
            params.append(status)
        if unfiled:
            where.append("folder IS NULL")
        elif folder is not None:
            where.append("folder = ?")
            params.append(folder)
        if query:
            where.append("label LIKE ? ESCAPE '\\'")
            params.append(_like_contains(query))
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        params.append(limit + 1)
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT rowid AS _rowid, * FROM entities{clause} ORDER BY rowid LIMIT ?",
                params,
            ).fetchall()
        has_more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = str(rows[-1]["_rowid"]) if has_more and rows else None
        return {"items": [self._entity(r) for r in rows], "next_cursor": next_cursor}

    def catalog_summary(self) -> dict[str, Any]:
        """Total plus per-type, per-status and per-folder counts in grouped scans
        — the catalog's badges without materialising the graph."""
        with self._connect() as conn:
            total = conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0]
            by_type = {
                r["type"]: r["n"]
                for r in conn.execute("SELECT type, COUNT(*) AS n FROM entities GROUP BY type")
            }
            by_status = {
                r["prov_status"]: r["n"]
                for r in conn.execute(
                    "SELECT prov_status, COUNT(*) AS n FROM entities GROUP BY prov_status"
                )
            }
            by_folder = {
                r["folder"]: r["n"]
                for r in conn.execute(
                    "SELECT folder, COUNT(*) AS n FROM entities"
                    " WHERE folder IS NOT NULL GROUP BY folder"
                )
            }
        return {
            "total": total,
            "by_type": by_type,
            "by_status": by_status,
            "by_folder": by_folder,
        }

    def get_entity(self, entity_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM entities WHERE id = ?", (entity_id,)).fetchone()
        return self._entity(row) if row is not None else None

    def find_entity(self, *, attr: str, value: Any) -> dict[str, Any] | None:
        # Scan and match in Python so the store stays on core SQL (no JSON1
        # dependency). A JSON1-indexed lookup is a later optimisation, gated on
        # per-binary availability like FTS5.
        with self._connect() as conn:
            for row in conn.execute("SELECT * FROM entities ORDER BY rowid"):
                if json.loads(row["attrs_json"]).get(attr) == value:
                    return self._entity(row)
        return None

    def list_folders(self) -> list[str]:
        with self._connect() as conn:
            return [
                r["path"]
                for r in conn.execute("SELECT path FROM folders ORDER BY path COLLATE NOCASE")
            ]

    def count_entities(self) -> int:
        """Entity total via one indexed count — the case switcher's per-case
        badge without materialising the graph."""
        with self._connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0]

    def updated_at(self) -> str | None:
        """Last-activity timestamp, bumped by every mutation. The manifest's own
        `updated_at` only moves on manifest writes, so this is the truthful sort
        key for the case switcher once the graph lives in the db."""
        with self._connect() as conn:
            row = conn.execute("SELECT value FROM meta WHERE key = 'updated_at'").fetchone()
        return row["value"] if row is not None else None

    # -- entity mutations --------------------------------------------------

    def add_entity(
        self,
        type_: str,
        label: str,
        attrs: dict[str, Any] | None = None,
        *,
        by: str,
        status: EntityStatus = "confirmed",
        source: str | None = None,
    ) -> dict[str, Any]:
        entity: dict[str, Any] = {
            "id": _new_id("e"),
            "type": type_,
            "label": label,
            "attrs": attrs or {},
            "provenance": {"by": by, "at": _now(), "status": status},
        }
        if source:
            entity["provenance"]["source"] = source

        def op(conn: sqlite3.Connection) -> dict[str, Any]:
            conn.execute(
                "INSERT INTO entities"
                "(id, type, label, attrs_json, folder, prov_by, prov_at, prov_status, prov_source)"
                " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    entity["id"],
                    type_,
                    label,
                    json.dumps(entity["attrs"], ensure_ascii=False),
                    _folder_of(entity["attrs"]),
                    by,
                    entity["provenance"]["at"],
                    status,
                    source or None,
                ),
            )
            self._touch(conn)
            return entity

        return self._write(op)

    def update_entity(self, entity_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        def op(conn: sqlite3.Connection) -> dict[str, Any]:
            row = conn.execute("SELECT * FROM entities WHERE id = ?", (entity_id,)).fetchone()
            if row is None:
                raise CaseError(f"entity '{entity_id}' not found")
            entity = self._entity(row)
            for key in ("type", "label"):
                if key in patch:
                    entity[key] = patch[key]
            if "attrs" in patch:
                entity["attrs"].update(patch["attrs"])
            if patch.get("status") in ("confirmed", "suggested"):
                entity["provenance"]["status"] = patch["status"]
            conn.execute(
                "UPDATE entities SET type = ?, label = ?, attrs_json = ?, folder = ?,"
                " prov_status = ? WHERE id = ?",
                (
                    entity["type"],
                    entity["label"],
                    json.dumps(entity["attrs"], ensure_ascii=False),
                    _folder_of(entity["attrs"]),
                    entity["provenance"]["status"],
                    entity_id,
                ),
            )
            self._touch(conn)
            return entity

        return self._write(op)

    def remove_entity(self, entity_id: str) -> None:
        def op(conn: sqlite3.Connection) -> None:
            if conn.execute("SELECT 1 FROM entities WHERE id = ?", (entity_id,)).fetchone() is None:
                raise CaseError(f"entity '{entity_id}' not found")
            # Drop directly incident edges first: foreign keys forbid dangling
            # links, and this is the repository-level cleanup, not the
            # dependency-aware deep delete (that lives in engine/links.py).
            conn.execute(
                "DELETE FROM links WHERE from_id = ? OR to_id = ?", (entity_id, entity_id)
            )
            conn.execute("DELETE FROM entities WHERE id = ?", (entity_id,))
            self._touch(conn)

        self._write(op)

    # -- link mutations ----------------------------------------------------

    def add_link(
        self,
        from_id: str,
        to_id: str,
        type_: str,
        *,
        by: str,
        status: EntityStatus = "confirmed",
        unique: bool = False,
    ) -> dict[str, Any]:
        def op(conn: sqlite3.Connection) -> dict[str, Any]:
            present = {
                r["id"]
                for r in conn.execute(
                    "SELECT id FROM entities WHERE id IN (?, ?)", (from_id, to_id)
                )
            }
            for eid in (from_id, to_id):
                if eid not in present:
                    raise CaseError(f"entity '{eid}' not found")
            if unique:
                existing = conn.execute(
                    "SELECT * FROM links WHERE from_id = ? AND to_id = ? AND type = ?"
                    " ORDER BY rowid LIMIT 1",
                    (from_id, to_id, type_),
                ).fetchone()
                if existing is not None:
                    return self._link(existing)
            link: dict[str, Any] = {
                "id": _new_id("l"),
                "from": from_id,
                "to": to_id,
                "type": type_,
                "provenance": {"by": by, "at": _now(), "status": status},
            }
            conn.execute(
                "INSERT INTO links"
                "(id, from_id, to_id, type, prov_by, prov_at, prov_status, prov_source)"
                " VALUES(?, ?, ?, ?, ?, ?, ?, NULL)",
                (link["id"], from_id, to_id, type_, by, link["provenance"]["at"], status),
            )
            self._touch(conn)
            return link

        return self._write(op)

    def sync_links(
        self,
        from_id: str,
        type_: str,
        to_ids: list[str],
        *,
        by: str,
        status: EntityStatus = "confirmed",
    ) -> list[dict[str, Any]]:
        def op(conn: sqlite3.Connection) -> list[dict[str, Any]]:
            if conn.execute("SELECT 1 FROM entities WHERE id = ?", (from_id,)).fetchone() is None:
                raise CaseError(f"entity '{from_id}' not found")
            candidates = list(dict.fromkeys(to_ids))
            present: set[str] = set()
            if candidates:
                placeholders = ", ".join("?" * len(candidates))
                present = {
                    r["id"]
                    for r in conn.execute(
                        f"SELECT id FROM entities WHERE id IN ({placeholders})", candidates
                    )
                }
            wanted = [i for i in candidates if i in present and i != from_id]
            wanted_set = set(wanted)
            existing = {
                r["to_id"]: r
                for r in conn.execute(
                    "SELECT * FROM links WHERE from_id = ? AND type = ?", (from_id, type_)
                )
            }
            # Drop edges no longer wanted; leave the survivors untouched so their
            # id and timestamp are preserved (restating sources, not rebuilding).
            stale = [(r["id"],) for to_id, r in existing.items() if to_id not in wanted_set]
            if stale:
                conn.executemany("DELETE FROM links WHERE id = ?", stale)
            for to_id in wanted:
                if to_id not in existing:
                    conn.execute(
                        "INSERT INTO links"
                        "(id, from_id, to_id, type, prov_by, prov_at, prov_status, prov_source)"
                        " VALUES(?, ?, ?, ?, ?, ?, ?, NULL)",
                        (_new_id("l"), from_id, to_id, type_, by, _now(), status),
                    )
            self._touch(conn)
            rows = conn.execute(
                "SELECT * FROM links WHERE from_id = ? AND type = ? ORDER BY rowid",
                (from_id, type_),
            ).fetchall()
            return [self._link(r) for r in rows]

        return self._write(op)

    def remove_link(self, link_id: str) -> None:
        def op(conn: sqlite3.Connection) -> None:
            cur = conn.execute("DELETE FROM links WHERE id = ?", (link_id,))
            if cur.rowcount == 0:
                raise CaseError(f"link '{link_id}' not found")
            self._touch(conn)

        self._write(op)

    # -- folders -----------------------------------------------------------

    def add_folder(self, name: str) -> list[str]:
        path = Case._normalize_folder(name)

        def op(conn: sqlite3.Connection) -> list[str]:
            before = conn.total_changes
            segments = path.split("/")
            for i in range(1, len(segments) + 1):
                ancestor = "/".join(segments[:i])
                conn.execute("INSERT OR IGNORE INTO folders(path) VALUES(?)", (ancestor,))
            if conn.total_changes > before:
                self._touch(conn)
            return [
                r["path"]
                for r in conn.execute("SELECT path FROM folders ORDER BY path COLLATE NOCASE")
            ]

        return self._write(op)

    def remove_folder(self, name: str) -> list[str]:
        prefix = name + "/"

        def op(conn: sqlite3.Connection) -> list[str]:
            doomed = [
                (p["path"],)
                for p in conn.execute("SELECT path FROM folders")
                if p["path"] == name or p["path"].startswith(prefix)
            ]
            if doomed:
                conn.executemany("DELETE FROM folders WHERE path = ?", doomed)
            # Unfile any entity filed under a removed node or its descendants.
            for row in conn.execute("SELECT id, attrs_json FROM entities").fetchall():
                attrs = json.loads(row["attrs_json"])
                folder = attrs.get("folder")
                if folder is not None and (folder == name or folder.startswith(prefix)):
                    attrs.pop("folder", None)
                    conn.execute(
                        "UPDATE entities SET attrs_json = ?, folder = NULL WHERE id = ?",
                        (json.dumps(attrs, ensure_ascii=False), row["id"]),
                    )
            self._touch(conn)
            return [
                r["path"]
                for r in conn.execute("SELECT path FROM folders ORDER BY path COLLATE NOCASE")
            ]

        return self._write(op)

    # -- durable jobs (thumbnail and background-job model) -----------------

    def enqueue_job(
        self,
        kind: str,
        *,
        key: str | None = None,
        payload: dict[str, Any] | None = None,
        max_attempts: int = 3,
    ) -> dict[str, Any]:
        """Queue a unit of background work, returning the job row.

        Keyed jobs are idempotent: a second enqueue for the same ``(kind, key)``
        never stacks a duplicate. A job already ``running`` is left running (the
        worker owns it); any other prior state — including a finished ``ready``
        one, so a re-enqueue is how a thumbnail is regenerated — is reset to a
        fresh ``queued`` attempt. The keyless form is a plain append.
        """
        now = _now()

        def op(conn: sqlite3.Connection) -> dict[str, Any]:
            if key is not None:
                row = conn.execute(
                    "SELECT * FROM jobs WHERE kind = ? AND job_key = ?", (kind, key)
                ).fetchone()
                if row is not None:
                    if row["state"] == "running":
                        return self._job(row)
                    conn.execute(
                        "UPDATE jobs SET state = 'queued', attempts = 0, error = NULL,"
                        " payload_json = ?, max_attempts = ?, updated_at = ? WHERE id = ?",
                        (
                            json.dumps(payload or {}, ensure_ascii=False),
                            max_attempts,
                            now,
                            row["id"],
                        ),
                    )
                    return self._job(
                        conn.execute("SELECT * FROM jobs WHERE id = ?", (row["id"],)).fetchone()
                    )
            job_id = _new_id("j")
            conn.execute(
                "INSERT INTO jobs"
                "(id, kind, job_key, state, attempts, max_attempts, payload_json,"
                " error, created_at, updated_at)"
                " VALUES(?, ?, ?, 'queued', 0, ?, ?, NULL, ?, ?)",
                (job_id, kind, key, max_attempts, json.dumps(payload or {}, ensure_ascii=False), now, now),
            )
            return self._job(conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone())

        return self._write(op)

    def claim_job(self, *, kinds: list[str] | None = None) -> dict[str, Any] | None:
        """Atomically take the oldest ``queued`` job into ``running`` and return
        it (attempt counted), or None when nothing is queued. One row per call —
        the single-worker default is enforced by the caller running one at a time.
        """
        def op(conn: sqlite3.Connection) -> dict[str, Any] | None:
            where = "state = 'queued'"
            params: list[Any] = []
            if kinds:
                where += f" AND kind IN ({', '.join('?' * len(kinds))})"
                params.extend(kinds)
            row = conn.execute(
                f"SELECT * FROM jobs WHERE {where} ORDER BY rowid LIMIT 1", params
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                "UPDATE jobs SET state = 'running', attempts = attempts + 1, updated_at = ?"
                " WHERE id = ?",
                (_now(), row["id"]),
            )
            return self._job(conn.execute("SELECT * FROM jobs WHERE id = ?", (row["id"],)).fetchone())

        return self._write(op)

    def complete_job(self, job_id: str) -> None:
        """Mark a finished job ``ready``."""
        self._set_job_state(job_id, "ready", error=None)

    def fail_job(self, job_id: str, error: str) -> dict[str, Any]:
        """Record a failure: back to ``queued`` while attempts remain, else
        ``failed``. Returns the resulting job row so the worker can see whether a
        retry is pending."""
        def op(conn: sqlite3.Connection) -> dict[str, Any]:
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if row is None:
                raise CaseError(f"job '{job_id}' not found")
            state = "queued" if row["attempts"] < row["max_attempts"] else "failed"
            conn.execute(
                "UPDATE jobs SET state = ?, error = ?, updated_at = ? WHERE id = ?",
                (state, error[:2000], _now(), job_id),
            )
            return self._job(conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone())

        return self._write(op)

    def cancel_job(self, job_id: str) -> None:
        self._set_job_state(job_id, "cancelled", error=None)

    def _set_job_state(self, job_id: str, state: str, *, error: str | None) -> None:
        def op(conn: sqlite3.Connection) -> None:
            cur = conn.execute(
                "UPDATE jobs SET state = ?, error = ?, updated_at = ? WHERE id = ?",
                (state, error, _now(), job_id),
            )
            if cur.rowcount == 0:
                raise CaseError(f"job '{job_id}' not found")

        self._write(op)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return self._job(row) if row is not None else None

    def list_jobs(
        self, *, kind: str | None = None, state: str | None = None
    ) -> list[dict[str, Any]]:
        where: list[str] = []
        params: list[Any] = []
        if kind is not None:
            where.append("kind = ?")
            params.append(kind)
        if state is not None:
            where.append("state = ?")
            params.append(state)
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        with self._connect() as conn:
            rows = conn.execute(f"SELECT * FROM jobs{clause} ORDER BY rowid", params).fetchall()
        return [self._job(r) for r in rows]

    def count_jobs(self) -> dict[str, int]:
        """Per-state job counts — the queue's badge without listing every row."""
        with self._connect() as conn:
            rows = conn.execute("SELECT state, COUNT(*) AS n FROM jobs GROUP BY state").fetchall()
        return {r["state"]: r["n"] for r in rows}

    def recover_jobs(self) -> int:
        """Return jobs left ``running`` by an interrupted process to the queue
        (or ``failed`` if their retry budget is spent), and report how many.

        Called when a case is opened. A worker that crashed mid-thumbnail leaves
        a ``running`` row that nothing owns; this reclaims it so the work resumes
        instead of stalling forever.
        """
        def op(conn: sqlite3.Connection) -> int:
            rows = conn.execute("SELECT * FROM jobs WHERE state = 'running'").fetchall()
            for row in rows:
                state = "queued" if row["attempts"] < row["max_attempts"] else "failed"
                error = None if state == "queued" else "interrupted"
                conn.execute(
                    "UPDATE jobs SET state = ?, error = ?, updated_at = ? WHERE id = ?",
                    (state, error, _now(), row["id"]),
                )
            return len(rows)

        return self._write(op)

    def prune_jobs(self, *, kind: str | None = None) -> int:
        """Drop terminal (ready/failed/cancelled) job rows, optionally of one
        kind. Keeps the table from growing without bound across a long session;
        live (queued/running) work is never touched. Returns how many were dropped.
        """
        def op(conn: sqlite3.Connection) -> int:
            placeholders = ", ".join("?" * len(_JOB_TERMINAL))
            params: list[Any] = list(_JOB_TERMINAL)
            clause = f"state IN ({placeholders})"
            if kind is not None:
                clause += " AND kind = ?"
                params.append(kind)
            cur = conn.execute(f"DELETE FROM jobs WHERE {clause}", params)
            return cur.rowcount

        return self._write(op)


# -- JSON -> SQLite conversion ---------------------------------------------


@dataclass
class MigrationReport:
    """What a JSON->SQLite conversion imported and found (doc "Migration
    validation"). Integrity failures abort; missing link endpoints are reported
    and the offending edge dropped, never erasing an entity."""

    entities: int = 0
    links: int = 0
    folders: int = 0
    missing_endpoints: list[str] = field(default_factory=list)
    integrity_ok: bool = True


def convert_json_to_sqlite(data: dict[str, Any], db_path: Path) -> MigrationReport:
    """Build `db_path` from a parsed `case.json` graph, atomically.

    Writes a `case.db.tmp` beside the target, imports the whole graph in one
    transaction, runs `foreign_key_check` / `integrity_check`, then renames it
    into place. Any failure removes the temporary file and raises, leaving the
    target untouched (the doc's "a crash before the manifest change leaves the
    legacy case active"). This is the mechanism; flipping the manifest onto it is
    Delivery step 4.
    """
    db_path = Path(db_path)
    tmp = db_path.with_name(db_path.name + ".tmp")
    if tmp.exists():
        tmp.unlink()

    report = MigrationReport(
        entities=len(data.get("entities", [])),
        folders=len(data.get("folders", [])),
    )
    store = SqliteCase.create(
        tmp,
        name=data.get("name", ""),
        created_at=data.get("created_at"),
        updated_at=data.get("updated_at"),
    )
    try:
        with store._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                _import_graph(conn, data, report)
                fk_problems = conn.execute("PRAGMA foreign_key_check").fetchall()
                integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
                report.integrity_ok = not fk_problems and integrity == "ok"
                report.links = conn.execute("SELECT COUNT(*) FROM links").fetchone()[0]
                if not report.integrity_ok:
                    raise CaseError(f"migration integrity check failed for '{db_path.name}'")
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    _replace_with_retry(tmp, db_path)
    return report


def _import_graph(conn: sqlite3.Connection, data: dict[str, Any], report: MigrationReport) -> None:
    entity_ids: set[str] = set()
    for entity in data.get("entities", []):
        prov = entity.get("provenance", {})
        conn.execute(
            "INSERT INTO entities"
            "(id, type, label, attrs_json, folder, prov_by, prov_at, prov_status, prov_source)"
            " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                entity["id"],
                entity.get("type", ""),
                entity.get("label", ""),
                json.dumps(entity.get("attrs") or {}, ensure_ascii=False),
                _folder_of(entity.get("attrs")),
                prov.get("by", ""),
                prov.get("at", ""),
                prov.get("status", "confirmed"),
                prov.get("source"),
            ),
        )
        entity_ids.add(entity["id"])
    for link in data.get("links", []):
        if link["from"] not in entity_ids or link["to"] not in entity_ids:
            report.missing_endpoints.append(link["id"])
            continue
        prov = link.get("provenance", {})
        conn.execute(
            "INSERT INTO links"
            "(id, from_id, to_id, type, prov_by, prov_at, prov_status, prov_source)"
            " VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
            (
                link["id"],
                link["from"],
                link["to"],
                link.get("type", ""),
                prov.get("by", ""),
                prov.get("at", ""),
                prov.get("status", "confirmed"),
                prov.get("source"),
            ),
        )
    for folder in data.get("folders", []):
        conn.execute("INSERT OR IGNORE INTO folders(path) VALUES(?)", (folder,))


if TYPE_CHECKING:
    # `SqliteCase` is the SQLite `CaseRepository`; this fails type-check if a
    # graph method drifts from the boundary contract, exactly as `Case` is held
    # in workspace.py.
    def _sqlite_conforms(store: SqliteCase) -> "CaseRepository":
        return store
