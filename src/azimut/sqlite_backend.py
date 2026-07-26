"""SQLite-backed `CaseRepository` (Step 3 of docs/STORAGE_AND_PERFORMANCE.md).

`SqliteCase` implements the graph and media browse contracts in
`repository.py`. Production cases use one `case.db`, so a mutation touches one
row and one short transaction instead of rewriting the complete graph. The
small case manifest only identifies the case and selects this backend.

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

from .engine import mapsites
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
# Schema 4 adds a browse index for sidecar-backed media. Sidecars remain the
# file-level record; the index avoids opening and sorting every sidecar for each
# bounded Media Library page.
SQLITE_SCHEMA = 4

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
    search_text TEXT NOT NULL DEFAULT '',
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
CREATE TABLE media_items (
    path         TEXT PRIMARY KEY,
    entity_id    TEXT UNIQUE,
    item_json    TEXT NOT NULL,
    filename     TEXT NOT NULL,
    kind         TEXT NOT NULL,
    folder       TEXT,
    name_sort    TEXT NOT NULL,
    size         INTEGER NOT NULL DEFAULT 0,
    added_at     TEXT NOT NULL,
    search_text  TEXT NOT NULL,
    source_type  TEXT,
    source_op    TEXT,
    imagery_mode TEXT
);
CREATE INDEX idx_entities_type   ON entities(type);
CREATE INDEX idx_entities_status ON entities(prov_status);
CREATE INDEX idx_entities_folder ON entities(folder);
CREATE INDEX idx_links_from ON links(from_id);
CREATE INDEX idx_links_to   ON links(to_id);
CREATE INDEX idx_links_type ON links(type);
CREATE INDEX idx_jobs_state ON jobs(state);
CREATE UNIQUE INDEX idx_jobs_key ON jobs(kind, job_key) WHERE job_key IS NOT NULL;
CREATE INDEX idx_media_kind     ON media_items(kind);
CREATE INDEX idx_media_folder   ON media_items(folder);
CREATE INDEX idx_media_name     ON media_items(name_sort);
CREATE INDEX idx_media_size     ON media_items(size);
CREATE INDEX idx_media_added    ON media_items(added_at);
CREATE INDEX idx_media_source   ON media_items(source_type);
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


def _like_prefix(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"{escaped}%"


def _folder_of(attrs: dict[str, Any] | None) -> str | None:
    """The indexed folder value for an entity: its ``attrs.folder`` path, or None
    when unfiled — an absent or empty folder both read as unfiled."""
    folder = (attrs or {}).get("folder")
    return folder or None


def _entity_search_text(type_: str, label: str, attrs: dict[str, Any] | None) -> str:
    attrs = attrs or {}
    return "\n".join(
        str(value)
        for value in (label, type_, attrs.get("folder"), attrs.get("notes"))
        if value
    ).casefold()


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


# from_version -> function(conn) applying the in-place upgrade to from_version + 1.
# Runs inside one transaction per step in `SqliteCase._upgrade`, which stamps the
# new schema_version and records the migration; the step only reshapes the db.
_SQLITE_MIGRATIONS: dict[int, Callable[[sqlite3.Connection], None]] = {
    1: _migrate_1_to_2,
    2: _migrate_2_to_3,
    3: _migrate_3_to_4,
}

_MEDIA_CATEGORIES = (
    "image",
    "video",
    "collage",
    "satellite",
    "upload",
    "download",
    "other",
)
_SATELLITE_SQL = (
    "(COALESCE(source_type, '') = 'satellite' OR "
    "(COALESCE(source_type, '') = 'screenshot' AND imagery_mode = 'satellite'))"
)
_MEDIA_CATEGORY_SQL = {
    "image": f"(kind = 'image' AND NOT {_SATELLITE_SQL})",
    "video": "kind = 'video'",
    "collage": "source_op = 'collage'",
    "satellite": _SATELLITE_SQL,
    "upload": "source_type = 'upload'",
    "download": "source_type = 'download'",
    "other": "kind NOT IN ('image', 'video')",
}


def _normalise_media_item(item: dict[str, Any]) -> tuple[dict[str, Any], tuple[Any, ...]]:
    """Return a JSON-safe browse item plus its indexed column values."""
    clean = json.loads(json.dumps(item, ensure_ascii=False))
    source = clean.get("source")
    if not isinstance(source, dict):
        source = {}
        clean["source"] = source
    if (
        source.get("type") == "screenshot"
        and "imagery_mode" not in source
        and isinstance(source.get("source_url"), str)
    ):
        parsed = mapsites.parse_map_url(source["source_url"])
        if parsed and parsed.get("imagery_mode"):
            source = {**source, "imagery_mode": parsed["imagery_mode"]}
            clean["source"] = source

    path = str(clean.get("path") or "")
    filename = str(clean.get("filename") or Path(path).name)
    kind = str(clean.get("kind") or "file")
    folder = str(clean.get("folder") or "") or None
    title = str(clean.get("title") or "")
    notes = str(clean.get("notes") or "")
    name_sort = (title or filename).casefold()
    try:
        size = max(0, int(clean.get("size") or 0))
    except (TypeError, ValueError):
        size = 0
    added_at = str(clean.get("added_at") or "")
    search_text = "\n".join(
        str(value)
        for value in (
            filename,
            title,
            notes,
            folder,
            source.get("title"),
            source.get("uploader"),
            source.get("webpage_url") or source.get("url"),
        )
        if value
    ).casefold()
    return clean, (
        path,
        json.dumps(clean, ensure_ascii=False),
        filename,
        kind,
        folder,
        name_sort,
        size,
        added_at,
        search_text,
        source.get("type"),
        source.get("op"),
        source.get("imagery_mode"),
    )


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
        store._ensure_media_index()
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

    def _ensure_media_index(self) -> None:
        """Backfill media sidecars once after schema 4 reaches a case.

        The marker is written in the same transaction as the rows, so an
        interrupted scan is retried rather than leaving a partial index active.
        Normal media writes keep the index current after this one-time pass.
        """
        with self._connect() as conn:
            ready = conn.execute(
                "SELECT value FROM meta WHERE key = 'media_index_ready'"
            ).fetchone()
            if ready is not None and ready["value"] == "1":
                return
            entity_by_path: dict[str, str] = {}
            for row in conn.execute("SELECT id, attrs_json FROM entities"):
                attrs = json.loads(row["attrs_json"])
                path = attrs.get("path")
                if isinstance(path, str):
                    entity_by_path[path] = row["id"]

        rows: list[tuple[dict[str, Any], str | None]] = []
        media_dir = self.db_path.parent / "media"
        for sidecar in sorted(media_dir.glob("*.azimut.json")):
            media_name = sidecar.name[: -len(".azimut.json")]
            if not (media_dir / media_name).is_file():
                continue
            try:
                item = json.loads(sidecar.read_text(encoding="utf-8"))
            except (OSError, ValueError, TypeError):
                continue
            path = f"media/{media_name}"
            item["path"] = path
            rows.append((item, entity_by_path.get(path)))

        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                # Several download workers can reach the first schema-4 open at
                # once. They may all scan before one acquires the write lock, so
                # re-check the marker inside the transaction. Otherwise a late
                # opener can delete rows registered after an earlier backfill.
                ready = conn.execute(
                    "SELECT value FROM meta WHERE key = 'media_index_ready'"
                ).fetchone()
                if ready is not None and ready["value"] == "1":
                    conn.execute("COMMIT")
                    return
                conn.execute("DELETE FROM media_items")
                for item, entity_id in rows:
                    self._upsert_media_conn(conn, item, entity_id=entity_id)
                conn.execute(
                    "INSERT INTO meta(key, value) VALUES('media_index_ready', '1')"
                    " ON CONFLICT(key) DO UPDATE SET value = excluded.value"
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

    def count_dependents(self, *, link_type: str, from_type: str) -> dict[str, int]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT links.to_id AS to_id, COUNT(*) AS n FROM links"
                " JOIN entities ON entities.id = links.from_id"
                " WHERE links.type = ? AND entities.type = ?"
                " GROUP BY links.to_id",
                (link_type, from_type),
            ).fetchall()
        return {r["to_id"]: int(r["n"]) for r in rows}

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
        recursive: bool = False,
    ) -> dict[str, Any]:
        """A bounded, cursor-paginated slice of entities in insertion order.

        The cursor keys on ``rowid`` (monotonic, primary-index-backed), so a
        background import appending rows never shifts a page the analyst already
        scrolled past — new rows land after the current tail. Filters compose in
        SQL: ``types`` (an ``IN`` set), ``status``, a case-insensitive ``query``
        over the label, and folder — either ``unfiled`` (no folder) or an exact
        ``folder`` path (or its descendants when ``recursive`` is true). One
        extra row is peeked to know whether a further page exists, so
        ``next_cursor`` is None exactly on the last page.
        """
        where: list[str] = []
        params: list[Any] = []
        if types:
            where.append(f"type IN ({', '.join('?' * len(types))})")
            params.extend(types)
        if status is not None:
            where.append("prov_status = ?")
            params.append(status)
        if unfiled:
            where.append("folder IS NULL")
        elif folder is not None:
            if recursive:
                where.append("(folder = ? OR folder LIKE ? ESCAPE '\\')")
                params.extend((folder, _like_prefix(folder + "/")))
            else:
                where.append("folder = ?")
                params.append(folder)
        for term in (query or "").casefold().split():
            where.append("search_text LIKE ? ESCAPE '\\'")
            params.append(_like_contains(term))
        filter_clause = (" WHERE " + " AND ".join(where)) if where else ""
        filter_params = list(params)
        if cursor is not None:
            where.append("rowid > ?")
            params.append(_parse_cursor(cursor))
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        params.append(limit + 1)
        with self._connect() as conn:
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM entities{filter_clause}",
                    filter_params,
                ).fetchone()[0]
            )
            rows = conn.execute(
                f"SELECT rowid AS _rowid, * FROM entities{clause} ORDER BY rowid LIMIT ?",
                params,
            ).fetchall()
        has_more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = str(rows[-1]["_rowid"]) if has_more and rows else None
        return {
            "items": [self._entity(r) for r in rows],
            "next_cursor": next_cursor,
            "total": total,
        }

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

    # -- media browse index ------------------------------------------------

    @staticmethod
    def _upsert_media_conn(
        conn: sqlite3.Connection,
        item: dict[str, Any],
        *,
        entity_id: str | None = None,
    ) -> None:
        clean, values = _normalise_media_item(item)
        if not clean.get("path"):
            raise CaseError("media item has no path")
        conn.execute(
            "INSERT INTO media_items("
            " path, entity_id, item_json, filename, kind, folder, name_sort,"
            " size, added_at, search_text, source_type, source_op, imagery_mode"
            ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(path) DO UPDATE SET"
            " entity_id = COALESCE(excluded.entity_id, media_items.entity_id),"
            " item_json = excluded.item_json,"
            " filename = excluded.filename, kind = excluded.kind,"
            " folder = excluded.folder, name_sort = excluded.name_sort,"
            " size = excluded.size, added_at = excluded.added_at,"
            " search_text = excluded.search_text, source_type = excluded.source_type,"
            " source_op = excluded.source_op, imagery_mode = excluded.imagery_mode",
            (values[0], entity_id, *values[1:]),
        )

    def upsert_media_item(
        self, item: dict[str, Any], *, entity_id: str | None = None
    ) -> None:
        def op(conn: sqlite3.Connection) -> None:
            self._upsert_media_conn(conn, item, entity_id=entity_id)

        self._write(op)

    def remove_media_item(self, path: str) -> None:
        def op(conn: sqlite3.Connection) -> None:
            conn.execute("DELETE FROM media_items WHERE path = ?", (path,))

        self._write(op)

    @staticmethod
    def _media_item(row: sqlite3.Row) -> dict[str, Any]:
        return json.loads(row["item_json"])

    def list_media_items(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT item_json FROM media_items"
                " ORDER BY added_at DESC, path COLLATE NOCASE"
            ).fetchall()
        return [self._media_item(row) for row in rows]

    def media_items_by_paths(self, paths: list[str]) -> list[dict[str, Any]]:
        unique = list(dict.fromkeys(paths))
        if not unique:
            return []
        if len(unique) > 500:
            raise CaseError("media metadata lookup is limited to 500 paths")
        placeholders = ", ".join("?" for _ in unique)
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT item_json FROM media_items WHERE path IN ({placeholders})",
                unique,
            ).fetchall()
        by_path = {
            item["path"]: item for item in (self._media_item(row) for row in rows)
        }
        return [by_path[path] for path in unique if path in by_path]

    def page_media_items(
        self,
        *,
        q: str | None = None,
        kind: str | None = None,
        category: str | None = None,
        folder: str | None = None,
        sort: str = "newest",
        direction: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> dict[str, Any]:
        base_where: list[str] = []
        base_params: list[Any] = []
        if kind:
            base_where.append("kind = ?")
            base_params.append(kind)
        if folder is not None:
            if folder:
                base_where.append("folder = ?")
                base_params.append(folder)
            else:
                base_where.append("folder IS NULL")
        for term in (q or "").casefold().split():
            base_where.append("search_text LIKE ? ESCAPE '\\'")
            base_params.append(_like_contains(term))

        selected_where = list(base_where)
        selected_params = list(base_params)
        if category in _MEDIA_CATEGORY_SQL:
            selected_where.append(_MEDIA_CATEGORY_SQL[category])

        def clause(parts: list[str]) -> str:
            return (" WHERE " + " AND ".join(parts)) if parts else ""

        sort_columns = {
            "name": "name_sort",
            "size": "size",
            "type": "kind",
            "folder": "COALESCE(folder, '')",
            "oldest": "added_at",
            "newest": "added_at",
        }
        order_col = sort_columns.get(sort, "added_at")
        descending = direction == "desc" or (
            direction not in {"asc", "desc"} and sort in {"newest", "size"}
        )
        order = "DESC" if descending else "ASC"

        selected_clause = clause(selected_where)
        with self._connect() as conn:
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM media_items{selected_clause}",
                    selected_params,
                ).fetchone()[0]
            )
            rows = conn.execute(
                f"SELECT item_json FROM media_items{selected_clause}"
                f" ORDER BY {order_col} {order}, path COLLATE NOCASE {order}"
                " LIMIT ? OFFSET ?",
                [*selected_params, limit, offset],
            ).fetchall()
            kind_counts = {
                row["kind"]: int(row["n"])
                for row in conn.execute(
                    f"SELECT kind, COUNT(*) AS n FROM media_items{selected_clause}"
                    " GROUP BY kind",
                    selected_params,
                )
            }
            folder_counts = {
                row["folder"]: int(row["n"])
                for row in conn.execute(
                    f"SELECT folder, COUNT(*) AS n FROM media_items{selected_clause}"
                    f" {'AND' if selected_clause else 'WHERE'} folder IS NOT NULL"
                    " GROUP BY folder",
                    selected_params,
                ).fetchall()
            }
            # The category chooser remains useful after one category is
            # selected, so its counts use the text/kind/folder base but exclude
            # the current category.
            category_counts: dict[str, int] = {}
            for key in _MEDIA_CATEGORIES:
                category_counts[key] = int(
                    conn.execute(
                        f"SELECT COUNT(*) FROM media_items{clause([*base_where, _MEDIA_CATEGORY_SQL[key]])}",
                        base_params,
                    ).fetchone()[0]
                )

        next_offset = offset + len(rows)
        return {
            "items": [self._media_item(row) for row in rows],
            "next_cursor": str(next_offset) if next_offset < total else None,
            "total": total,
            "facets": {
                "kind_counts": kind_counts,
                "folder_counts": folder_counts,
                "category_counts": category_counts,
            },
        }

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
                "(id, type, label, attrs_json, folder, search_text,"
                " prov_by, prov_at, prov_status, prov_source)"
                " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    entity["id"],
                    type_,
                    label,
                    json.dumps(entity["attrs"], ensure_ascii=False),
                    _folder_of(entity["attrs"]),
                    _entity_search_text(type_, label, entity["attrs"]),
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
                " search_text = ?, prov_status = ? WHERE id = ?",
                (
                    entity["type"],
                    entity["label"],
                    json.dumps(entity["attrs"], ensure_ascii=False),
                    _folder_of(entity["attrs"]),
                    _entity_search_text(
                        entity["type"], entity["label"], entity["attrs"]
                    ),
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
            for row in conn.execute(
                "SELECT id, type, label, attrs_json FROM entities"
            ).fetchall():
                attrs = json.loads(row["attrs_json"])
                folder = attrs.get("folder")
                if folder is not None and (folder == name or folder.startswith(prefix)):
                    attrs.pop("folder", None)
                    conn.execute(
                        "UPDATE entities SET attrs_json = ?, folder = NULL,"
                        " search_text = ? WHERE id = ?",
                        (
                            json.dumps(attrs, ensure_ascii=False),
                            _entity_search_text(row["type"], row["label"], attrs),
                            row["id"],
                        ),
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
    target untouched. A crash before the manifest change leaves the legacy case
    active; ``Case._activate_sqlite`` flips the manifest only after this returns.
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
            "(id, type, label, attrs_json, folder, search_text,"
            " prov_by, prov_at, prov_status, prov_source)"
            " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                entity["id"],
                entity.get("type", ""),
                entity.get("label", ""),
                json.dumps(entity.get("attrs") or {}, ensure_ascii=False),
                _folder_of(entity.get("attrs")),
                _entity_search_text(
                    entity.get("type", ""),
                    entity.get("label", ""),
                    entity.get("attrs"),
                ),
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
