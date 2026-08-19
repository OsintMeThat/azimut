"""SQLite-backed `CaseRepository` (Step 3 of docs/STORAGE_AND_PERFORMANCE.md).

`SqliteCase` implements the graph and media browse contracts in
`repository.py`. Production cases use one `case.db`, so a mutation touches one
row and one short transaction instead of rewriting the complete graph. The
small case manifest only identifies the case and selects this backend.

Frozen-binary constraints (see the doc): SQLite is the stdlib `sqlite3` module,
already bundled by PyInstaller, so this adds no runtime dependency. Anything
beyond core SQL (FTS5, JSON1, RTree) is per-binary and must be probed at runtime
with a fallback before it enters the contract. Two attribute reads live on that
line: `find_entity` and `attr_facets` scan and match in Python, and the field
filter asks JSON1 through `store.filters._has_json1()` with a `LIKE` spelling of
the same question behind it.

The schema, the connection and `SqliteCase` itself live here. What the class is
built out of — statement shaping, the filter predicates, cursors, the indexed
columns a record carries, the temporal projection and the schema upgrades — lives
in `store/`, one module per concern.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import closing, contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterator, TypeVar

from .engine import links as link_engine
from .engine import timeline as timeline_engine
from . import layout
from .repository import EntityStatus
from .store.cursors import (
    _PAGE_ORDERS,
    _page_cursor,
    _parse_timeline_cursor,
    _parse_timeline_phase,
    _timeline_cursor,
    _timeline_phase_cursor,
)
from .store.filters import (
    MAX_ATTR_VALUES,
    _entity_filters,
    _facet_value,
    _holds_number,
    _link_scope,
    _linked_at_all,
)
from .store.migrations import _SQLITE_MIGRATIONS
from .store.rows import (
    _MADE_HERE_SQL,
    _MEDIA_CATEGORIES,
    _MEDIA_CATEGORY_SQL,
    _entity_search_text,
    _folder_of,
    _normalise_media_item,
    _replace_exact,
)
from .store.sql import _SCOPE, _chunks, _like_contains, _marks, _scope_table
from .store.temporal import (
    _rebuild_temporal_projection_conn,
    _sync_entity_temporal,
    _sync_media_temporal,
    _temporal_projection_status_conn,
)
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
# Schema 5 adds `has_gps` to that index. The coordinates themselves travel in
# `item_json` and need no column; presence does, because filtering "only the
# files that carry a position" has to happen in SQL over the whole case rather
# than in the page the client already holds.
# Schema 6 adds the `trash` journal: one row per delete action, holding the
# recipe to put it back. Schema 7 adds its recovery state so interrupted
# filesystem moves can be completed or rolled back on the next case open.
# Schema 8 adds relation confidence. Schema 9 rebuilds `search_text` so a case
# search reaches the declared fields — a plate, an IMO, a claim's wording —
# instead of stopping at label and notes.
# Schema 10 adds `graph_pins`: where the analyst put a node on the graph canvas
# by hand. Its own table rather than a key in `attrs` because a canvas coordinate
# is not a fact about the entity (ONTOLOGY §1 keeps entities to identity, links
# and provenance), because dragging thirty nodes would otherwise rewrite thirty
# entity rows and their search text, and because dropping every pin at once is
# then one statement. Those pins are keyed by lens as well as by entity: a lens is
# a reading, it draws its own nodes and edges and so clusters differently, and one
# shared arrangement would anchor every reading into the shape of whichever one it
# was built in.
# Schema 11 adds `links.nature`: what kind of tie one edge states, in the analyst's
# own words. Only a verb declaring a `qualifier` may carry one (`engine/links.py`),
# which is what keeps the column from becoming a note any edge can hold — the same
# guard `confidence` gets from `ratable`.
# Schema 12 adds `entity_images`: ordered private photos or existing Media
# references attached to a hand-made entity, with at most one primary image.
# They are not semantic graph links, and a computer import creates no Media row.
# Schema 13 adds `analysis_views`: named, case-owned recipes for reopening a Board
# or Graph reading. A snapshot keeps its captured entities and links inside the
# recipe; a live view keeps only the question and presentation state. Its denormalised
# count lets a bounded menu say how large a capture is without parsing its JSON.
# Schema 14 indexes catalog ordering. Schema 15 adds the rebuildable temporal
# projection used by Time and Timeline; Claims and media sidecars remain authoritative.
# Schema 16 lets the existing Analysis View store own Timeline recipes and snapshots.
# Schema 17 rebuilds the derived temporal projection with fixed-width UTC bounds, so
# SQLite text ordering remains chronological at sub-second precision.
SQLITE_SCHEMA = 17

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
    prov_source TEXT,
    -- Optional confidence for ordinary semantic relations. Claim connectors,
    -- mentions and artifact lineage never use it.
    confidence  INTEGER,
    -- What kind of tie this edge states, where the verb alone cannot say it:
    -- "sister", "employer". Only a verb declaring a `qualifier` may carry one, so
    -- this is not a note every edge can hold.
    nature      TEXT
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
CREATE TABLE trash (
    id           TEXT PRIMARY KEY,
    deleted_at   TEXT NOT NULL,
    label        TEXT NOT NULL,
    type         TEXT NOT NULL,
    item_count   INTEGER NOT NULL DEFAULT 0,
    size_bytes   INTEGER NOT NULL DEFAULT 0,
    state        TEXT NOT NULL DEFAULT 'ready',
    payload_json TEXT NOT NULL DEFAULT '{}'
);
-- Where the analyst dragged a node on the graph canvas. Presentation, not an
-- assertion about the case: the graph reads it as a fixed anchor and places
-- everything else around it. Cascades with the entity, so a deleted node leaves
-- no pin behind to resurrect at an id that has been taken again.
--
-- Keyed by lens as well as by entity, because a lens is a reading: it draws its
-- own nodes and its own edges, so it clusters differently. One arrangement forced
-- on every reading would anchor each of them into the shape of whichever one it
-- was built in.
CREATE TABLE graph_pins (
    entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    lens      TEXT NOT NULL,
    x         REAL NOT NULL,
    y         REAL NOT NULL,
    PRIMARY KEY (entity_id, lens)
);
CREATE INDEX idx_graph_pins_lens ON graph_pins(lens);
CREATE TABLE entity_images (
    entity_id  TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    image_id   TEXT NOT NULL,
    media_id   TEXT REFERENCES entities(id) ON DELETE CASCADE,
    path       TEXT,
    thumbnail  TEXT,
    title      TEXT,
    position   INTEGER NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    PRIMARY KEY (entity_id, image_id),
    CHECK (
        (media_id IS NOT NULL AND path IS NULL AND thumbnail IS NULL)
        OR (media_id IS NULL AND path IS NOT NULL AND thumbnail IS NOT NULL)
    )
);
CREATE INDEX idx_entity_images_media ON entity_images(media_id);
CREATE UNIQUE INDEX idx_entity_images_media_once
    ON entity_images(entity_id, media_id) WHERE media_id IS NOT NULL;
CREATE UNIQUE INDEX idx_entity_images_path
    ON entity_images(path) WHERE path IS NOT NULL;
CREATE UNIQUE INDEX idx_entity_images_primary
    ON entity_images(entity_id) WHERE is_primary = 1;
CREATE TABLE analysis_views (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    mode       TEXT NOT NULL CHECK (mode IN ('live', 'snapshot')),
    surface    TEXT NOT NULL CHECK (surface IN ('board', 'graph', 'timeline')),
    spec_json  TEXT NOT NULL,
    snapshot_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_analysis_views_updated ON analysis_views(updated_at DESC);
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
    imagery_mode TEXT,
    has_gps      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE temporal_items (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    authority   TEXT NOT NULL CHECK (authority IN ('entity', 'media')),
    category    TEXT NOT NULL CHECK (
        category IN ('statement', 'media', 'case_activity')
    ),
    kind        TEXT NOT NULL,
    raw         TEXT,
    earliest    TEXT,
    latest      TEXT,
    precision   TEXT,
    shape       TEXT,
    time_role   TEXT,
    uncertain   INTEGER NOT NULL DEFAULT 0 CHECK (uncertain IN (0, 1)),
    approximate INTEGER NOT NULL DEFAULT 0 CHECK (approximate IN (0, 1)),
    zone        TEXT,
    sortable    INTEGER NOT NULL DEFAULT 0 CHECK (sortable IN (0, 1)),
    status      TEXT,
    confidence  TEXT,
    parse_error TEXT
);
CREATE INDEX idx_entities_type   ON entities(type);
CREATE INDEX idx_entities_status ON entities(prov_status);
CREATE INDEX idx_entities_folder ON entities(folder);
-- The two columns the catalog orders the whole case by. Without them a sorted
-- page scans the table and builds a temp B-tree, which is the cost the bounded
-- catalog exists to avoid. The collation is part of the index because it is part
-- of the ORDER BY: an index on the bare column cannot serve a NOCASE sort.
CREATE INDEX idx_entities_label  ON entities(label COLLATE NOCASE);
CREATE INDEX idx_entities_filed  ON entities(prov_at);
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
CREATE INDEX idx_media_gps      ON media_items(has_gps);
CREATE INDEX idx_trash_deleted  ON trash(deleted_at);
CREATE INDEX idx_temporal_window ON temporal_items(category, earliest, latest);
CREATE INDEX idx_temporal_owner  ON temporal_items(owner_id, category);
CREATE INDEX idx_temporal_kind   ON temporal_items(kind);
"""

# Job lifecycle (doc "Job states"): a fresh job is `queued`; the worker claims it
# `running`; it finishes `ready` or, past its retry budget, `failed`; an explicit
# cancel makes it `cancelled`. An interrupted `running` job (a crash mid-work) is
# recovered on open back to `queued` or `failed` per its retry count.
JOB_STATES = ("queued", "running", "ready", "failed", "cancelled")
_JOB_TERMINAL = frozenset({"ready", "failed", "cancelled"})

T = TypeVar("T")


def read_meta(db_path: Path) -> dict[str, str]:
    """The `meta` table of a case database, without opening the case.

    `SqliteCase.open` would upgrade the schema on the way in, which is the wrong
    move on a database whose case cannot even be read yet — the caller is
    `workspace.restore_manifest`, recovering the name and dates of a case that
    lost its manifest. So this is a peek, read-only and best effort: a missing
    file, a foreign format or a database that needs recovery all answer with
    nothing, and the caller falls back to the folder's own name.
    """
    try:
        with closing(sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True)) as conn:
            rows = conn.execute("SELECT key, value FROM meta")
            return {str(key): str(value) for key, value in rows}
    except (sqlite3.Error, ValueError, OSError):
        return {}


class SqliteCase:
    """SQLite implementation of `CaseRepository` over one `case.db` file."""

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        # The connection a `batch()` is holding open, per thread. Thread-local rather
        # than a plain attribute because one `SqliteCase` is shared by the request
        # threads and the job worker, and a sqlite3 connection belongs to the thread
        # that made it: an attribute would hand one thread's open transaction to
        # another and raise from somewhere unrelated.
        self._local = threading.local()

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
    def open(cls, db_path: Path, *, media_dir: Path | None = None) -> "SqliteCase":
        """Open an existing `case.db`, upgrading an older schema and refusing a
        newer one.

        Mirrors `Case.migrate`'s forward-compat guarantee for the JSON format: a
        database written by a newer Azimut is refused rather than mangled, and an
        older one is brought up to `SQLITE_SCHEMA` in order before use.

        `media_dir` is where the one-time sidecar backfill reads from. The
        backend is not told the case layout anywhere else and must not guess it,
        so an open without it leaves the backfill for a later open that has it.
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
        if media_dir is not None:
            store._ensure_media_index(media_dir)
        return store

    def _upgrade(self) -> None:
        """Bring an older `case.db` up to `SQLITE_SCHEMA` inside one immediate
        transaction, rolled back whole on failure — a case that cannot finish the
        chain stays exactly at the version it was, rather than at a half-applied
        one no migration knows how to resume. Re-reads the version inside the
        transaction so a second opener that raced the first finds nothing left to
        apply rather than replaying a migration.

        The cost of that guarantee is that a long step holds the write lock for
        the whole chain: a case coming from several versions back rebuilds its
        search index and creates its tables in one go."""
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

    def forget_media_index(self) -> None:
        """Drop the one-time backfill marker so the next open rebuilds the index.

        The folder migration moves the sidecars, and the backfill may already
        have run — and stamped itself done — while they were still at their old
        location. Without this the browse index of every migrating case would
        come out empty, silently.
        """

        def op(conn: sqlite3.Connection) -> None:
            conn.execute("DELETE FROM meta WHERE key = 'media_index_ready'")

        self._write(op)

    def _ensure_media_index(self, media_dir: Path) -> None:
        """Backfill media sidecars once after schema 4 reaches a case.

        The marker is written in the same transaction as the rows, so an
        interrupted scan is retried rather than leaving a partial index active.
        Normal media writes keep the index current after this one-time pass.

        `media_dir` comes from the caller: where media live is the case layout's
        business, not the database's.
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
        for sidecar in sorted((media_dir / layout.META_DIR).glob("*.json")):
            media_name = sidecar.stem
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
        #
        # Inside a `batch()`, that connection is lent instead. Reads have to join it
        # or they would be looking at the file as it was before the batch started:
        # SQLite shows uncommitted rows to the connection that wrote them and to no
        # other, so a planner that adds an entity and then reads it back would find
        # nothing. Never closed here — the batch owns its lifetime.
        ambient = getattr(self._local, "conn", None)
        if ambient is not None:
            yield ambient
            return
        conn = self._open()
        try:
            yield conn
        finally:
            conn.close()

    def _open(self) -> sqlite3.Connection:
        """One configured connection. Here rather than inline because `batch()` opens
        its own and the two must agree on every pragma."""
        conn = sqlite3.connect(self.db_path, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        # Long enough for a queue, not long enough to hide a deadlock: every write goes
        # through BEGIN IMMEDIATE, so no waiter is queued behind a lock it holds itself,
        # and what it waits on is the fsync `synchronous = FULL` charges per commit.
        # Five seconds held on Linux and ran out on Windows. Eight concurrent downloads
        # open eighty of these between them, ten per filed item; the whole lot costs two
        # seconds of lock on Linux and enough more on Windows that one of the eight gave
        # up on a queue that was still moving.
        conn.execute("PRAGMA busy_timeout = 30000")
        conn.execute("PRAGMA synchronous = FULL")
        return conn

    def _write(self, op: Callable[[sqlite3.Connection], T]) -> T:
        """Run `op` inside one immediate transaction, rolling back on error.

        Inside a `batch()` there is already a transaction open and it belongs to the
        batch, so the operation joins it and neither commits nor rolls back: one
        `COMMIT` for the whole lot is the point of the thing.
        """
        ambient = getattr(self._local, "conn", None)
        if ambient is not None:
            return op(ambient)
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                result = op(conn)
                conn.execute("COMMIT")
                return result
            except BaseException:
                conn.execute("ROLLBACK")
                raise

    @contextmanager
    def batch(self) -> Iterator[None]:
        """One transaction for every store call made inside, on this thread.

        What "all or nothing" costs. A promotion that writes thirty-four entities and
        thirty-four links makes sixty-nine short transactions on its own, and a failure
        at the fortieth leaves the first thirty-nine standing — a case half-way through
        an operation nobody can see the shape of. Wrapped in a batch, the same calls
        share one `BEGIN IMMEDIATE`: the last one commits them all, and any exception
        leaves the case exactly as it was.

        **Keep a batch short and keep I/O out of it.** It holds SQLite's write lock for
        its whole duration, so every other writer — the job worker included — waits on
        it and then fails on `busy_timeout`. That is precisely why the road that
        downloads files is atomic per row instead: a batch around a hundred network
        fetches would lock the case for minutes.

        Not nestable, deliberately. An inner batch would either commit early, breaking
        the outer promise, or silently do nothing, breaking its own; refusing says which
        caller is wrong while there is still a stack trace to say it in.
        """
        if getattr(self._local, "conn", None) is not None:
            raise CaseError("a batch is already open on this thread")
        conn = self._open()
        try:
            conn.execute("BEGIN IMMEDIATE")
            self._local.conn = conn
            try:
                yield
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            finally:
                self._local.conn = None
        finally:
            conn.close()

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
        # Absent rather than null: "not assessed" is the absence of a key, so no
        # reader has to tell an unevaluated edge from one someone rated as nothing.
        if row["confidence"] is not None:
            link["confidence"] = row["confidence"]
        # Same rule: an edge nobody has qualified carries no key at all, so a reader
        # never has to tell "unstated" from "stated as empty".
        if row["nature"] is not None:
            link["nature"] = row["nature"]
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
        # One read transaction, not four bare SELECTs: the connection runs in
        # autocommit, so without it a write landing between the entities read and
        # the links read would produce a snapshot whose edges point at nodes it
        # does not carry. A bundle export runs on the worker thread while the
        # analyst keeps editing, which is exactly that window.
        with self._connect() as conn:
            conn.execute("BEGIN")
            try:
                meta = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM meta")}
                entities = [
                    self._entity(r) for r in conn.execute("SELECT * FROM entities ORDER BY rowid")
                ]
                links = [self._link(r) for r in conn.execute("SELECT * FROM links ORDER BY rowid")]
                folders = [
                    r["path"]
                    for r in conn.execute("SELECT path FROM folders ORDER BY path COLLATE NOCASE")
                ]
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
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

    def get_link(self, link_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM links WHERE id = ?", (link_id,)).fetchone()
        return self._link(row) if row is not None else None

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

    def count_incident_links(self, *, exclude_types: list[str]) -> dict[str, int]:
        skipped = list(dict.fromkeys(exclude_types))
        where = ""
        if skipped:
            where = f" WHERE type NOT IN ({', '.join('?' * len(skipped))})"
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, COUNT(*) AS n FROM ("
                f" SELECT from_id AS id FROM links{where}"
                " UNION ALL"
                f" SELECT to_id AS id FROM links{where}"
                ") GROUP BY id",
                (*skipped, *skipped),
            ).fetchall()
        return {r["id"]: int(r["n"]) for r in rows}

    # -- graph reads (engine/graph.py) -------------------------------------
    #
    # The board pages entities in insertion order; a graph needs a different cut.
    # Which nodes matter is a property of the edges, so these four read the graph
    # shape rather than the list: rank by how connected a node is, fetch a known
    # set, and resolve the edges inside or around it. Everything is bounded by an
    # id set or an explicit limit, so no caller can reach the whole graph through
    # them — `snapshot` stays the one deliberate whole-case read.

    def rank_entities(
        self,
        *,
        limit: int = 200,
        types: list[str] | None = None,
        exclude_types: list[str] | None = None,
        status: EntityStatus | None = None,
        query: str | None = None,
        folder: str | None = None,
        unfiled: bool = False,
        recursive: bool = False,
        attr: str | None = None,
        attr_value: str | None = None,
        linked: str | None = None,
        unlinked_only: bool = False,
        since: str | None = None,
        until: str | None = None,
        filed_by: list[str] | None = None,
        temporal_since: str | None = None,
        temporal_until: str | None = None,
        temporal_categories: list[str] | None = None,
        link_types: list[str] | None = None,
        order: str = "degree",
    ) -> dict[str, Any]:
        """The most significant entities first, bounded, with their degree.

        Which nodes survive a truncated view is the whole question for a case too
        large to draw. Ordering decides it: ``degree`` keeps the hubs, so the shape
        of the case is what stays on screen rather than an arbitrary slice, and
        ``recent`` keeps the latest work. ``link_types`` counts the degree over one
        lens only, so a node reads as isolated in a lens it truly has no edge in, and
        ``exclude_types`` is the set that lens does not draw at all: it leaves those
        entities out of the ranking *and* out of every degree counted here, or a node
        would state a connection to something the drawing has no room to show.

        The narrowing terms are the catalog's own, so the board and the graph cannot
        disagree about what *confirmed people in this folder, added this week* means:
        one predicate answers both (``_entity_filters``).

        Returns ``{entities, degrees, total, truncated, unlinked}``, where ``total``
        and ``unlinked`` both count every entity matching the filters, whether it was
        returned or not.

        ``unlinked`` is counted here rather than off the returned rows for one
        reason: a degree-0 entity sorts **last** under ``degree`` ordering, so it is
        the first thing a cut discards. Counted on the page, "what nobody has
        connected" reads zero on exactly the cases where it matters, which is worse
        than not offering the number at all. Its degree is read over the lens's verbs
        alone and says nothing about whether the far end of an edge was returned, so
        a narrowing cannot inflate it either.
        """
        clause, params = _entity_filters(
            types=types, exclude_types=exclude_types, status=status, query=query,
            folder=folder, unfiled=unfiled, recursive=recursive,
            attr=attr, attr_value=attr_value, linked=linked, unlinked=unlinked_only,
            since=since, until=until, filed_by=filed_by,
            temporal_since=temporal_since, temporal_until=temporal_until,
            temporal_categories=temporal_categories,
            # This statement names the entity table `e`, and the shared predicate has
            # one term that correlates to the outer row rather than reading a column.
            alias="e",
        )
        link_clause, link_params = _link_scope(link_types, ends_out=exclude_types)
        # A node with no edge has no row in the degree subquery, hence the join and
        # the COALESCE: an isolated entity is degree 0, never missing.
        degree_sql = (
            "SELECT id, COUNT(*) AS n FROM ("
            f" SELECT from_id AS id FROM links{link_clause}"
            " UNION ALL"
            f" SELECT to_id AS id FROM links{link_clause}"
            ") GROUP BY id"
        )
        ordering = (
            "e.prov_at DESC, e.rowid DESC" if order == "recent" else "degree DESC, e.rowid ASC"
        )
        with self._connect() as conn:
            # Aliased `e` like the two statements below it: the shared predicate has
            # terms that correlate to the outer row — *linked to a place*, *connected
            # to nothing* — and they name the table they are counting.
            total = int(
                conn.execute(f"SELECT COUNT(*) FROM entities e{clause}", params).fetchone()[0]
            )
            rows = conn.execute(
                "SELECT e.*, COALESCE(d.n, 0) AS degree FROM entities e"
                f" LEFT JOIN ({degree_sql}) d ON d.id = e.id{clause}"
                f" ORDER BY {ordering} LIMIT ?",
                (*link_params, *link_params, *params, limit),
            ).fetchall()
            joined = f"{clause} AND" if clause else " WHERE"
            unlinked = int(
                conn.execute(
                    "SELECT COUNT(*) FROM entities e"
                    f" LEFT JOIN ({degree_sql}) d ON d.id = e.id{joined}"
                    " COALESCE(d.n, 0) = 0",
                    (*link_params, *link_params, *params),
                ).fetchone()[0]
            )
        return {
            "entities": [self._entity(r) for r in rows],
            "degrees": {r["id"]: int(r["degree"]) for r in rows},
            "total": total,
            "truncated": total > len(rows),
            "unlinked": unlinked,
        }

    def graph_pins(self, lens: str) -> dict[str, tuple[float, float]]:
        """The nodes placed by hand in one lens, as ``{entity_id: (x, y)}``.

        Scoped to the lens because that is what an arrangement belongs to. Otherwise
        unbounded, and deliberately: a pin exists only because somebody dragged a
        node, so the row count follows the hand, not the size of the case.
        """
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT entity_id, x, y FROM graph_pins WHERE lens = ?", (lens,)
            ).fetchall()
        return {r["entity_id"]: (float(r["x"]), float(r["y"])) for r in rows}

    def pin_entities(self, lens: str, pins: dict[str, tuple[float, float]]) -> int:
        """Record where these nodes were dropped in this lens, replacing any earlier
        spot in it and leaving the other lenses alone.

        One transaction for the whole batch, because a drag that moved a group is
        one act: half of it landing would leave an arrangement nobody chose. An id
        that does not exist is skipped rather than raising — a drag races a delete
        made in another tab, and losing the pin is the right outcome there.
        """
        if not pins:
            return 0

        def op(conn: sqlite3.Connection) -> int:
            written = 0
            for entity_id, (x, y) in pins.items():
                if conn.execute(
                    "SELECT 1 FROM entities WHERE id = ?", (entity_id,)
                ).fetchone() is None:
                    continue
                conn.execute(
                    "INSERT INTO graph_pins(entity_id, lens, x, y) VALUES(?, ?, ?, ?)"
                    " ON CONFLICT(entity_id, lens)"
                    " DO UPDATE SET x = excluded.x, y = excluded.y",
                    (entity_id, lens, float(x), float(y)),
                )
                written += 1
            if written:
                self._touch(conn)
            return written

        return self._write(op)

    def unpin_entities(self, lens: str, ids: list[str]) -> int:
        """Hand these nodes back to the layout in this lens. Ids with no pin in it
        are simply absent."""
        wanted = list(dict.fromkeys(ids))
        if not wanted:
            return 0

        def op(conn: sqlite3.Connection) -> int:
            dropped = 0
            for chunk in _chunks(wanted):
                cursor = conn.execute(
                    "DELETE FROM graph_pins WHERE lens = ?"
                    f" AND entity_id IN ({_marks(chunk)})",
                    (lens, *chunk),
                )
                dropped += cursor.rowcount if cursor.rowcount > 0 else 0
            if dropped:
                self._touch(conn)
            return dropped

        return self._write(op)

    def clear_graph_pins(self, lens: str) -> int:
        """Drop this lens's arrangement, and only its own: the reading goes back to
        the placement it computes while the others keep theirs."""

        def op(conn: sqlite3.Connection) -> int:
            cursor = conn.execute("DELETE FROM graph_pins WHERE lens = ?", (lens,))
            dropped = cursor.rowcount if cursor.rowcount > 0 else 0
            if dropped:
                self._touch(conn)
            return dropped

        return self._write(op)

    # -- saved analysis views ---------------------------------------------

    @staticmethod
    def _analysis_view(row: sqlite3.Row) -> dict[str, Any]:
        spec = json.loads(row["spec_json"])
        return {
            "id": row["id"],
            "name": row["name"],
            "mode": row["mode"],
            "surface": row["surface"],
            "spec": spec,
            "snapshot_count": int(row["snapshot_count"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def list_analysis_views(self) -> list[dict[str, Any]]:
        """Named readings, newest edit first.

        The count is denormalised beside the JSON so naming a menu never parses or
        ships every captured entity merely to say how large its snapshot is.
        """
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, name, mode, surface, snapshot_count, created_at, updated_at"
                " FROM analysis_views ORDER BY updated_at DESC, name COLLATE NOCASE"
            ).fetchall()
        return [dict(row) for row in rows]

    def get_analysis_view(self, view_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM analysis_views WHERE id = ?", (view_id,)
            ).fetchone()
        return self._analysis_view(row) if row is not None else None

    def save_analysis_view(self, view: dict[str, Any]) -> dict[str, Any]:
        """Insert or replace one validated recipe as a single transaction."""
        spec = json.dumps(view["spec"], ensure_ascii=False, separators=(",", ":"))
        snapshot = view["spec"].get("snapshot", {})
        snapshot_count = len(
            snapshot.get("timeline_items", snapshot.get("entities", []))
        )

        def op(conn: sqlite3.Connection) -> None:
            conn.execute(
                "INSERT INTO analysis_views"
                " (id, name, mode, surface, spec_json, snapshot_count, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT(id) DO UPDATE SET"
                " name = excluded.name, mode = excluded.mode,"
                " surface = excluded.surface, spec_json = excluded.spec_json,"
                " snapshot_count = excluded.snapshot_count,"
                " updated_at = excluded.updated_at",
                (
                    view["id"], view["name"], view["mode"], view["surface"], spec,
                    snapshot_count,
                    view["created_at"], view["updated_at"],
                ),
            )
            self._touch(conn)

        self._write(op)
        saved = self.get_analysis_view(view["id"])
        if saved is None:  # pragma: no cover - the insert above is the invariant
            raise CaseError(f"analysis view '{view['id']}' was not saved")
        return saved

    def rename_analysis_view(
        self, view_id: str, name: str, updated_at: str
    ) -> dict[str, Any] | None:
        """Give one saved reading another name, leaving the reading itself alone.

        The spec column is never touched here, so a snapshot keeps the exact bytes it
        captured: a label is not evidence, and rewriting thousands of frozen rows to
        change one is both slow and a chance to lose them.
        """

        def op(conn: sqlite3.Connection) -> bool:
            cursor = conn.execute(
                "UPDATE analysis_views SET name = ?, updated_at = ? WHERE id = ?",
                (name, updated_at, view_id),
            )
            renamed = cursor.rowcount > 0
            if renamed:
                self._touch(conn)
            return renamed

        if not self._write(op):
            return None
        return self.get_analysis_view(view_id)

    def remove_analysis_view(self, view_id: str) -> dict[str, Any] | None:
        """Remove one view and return the recipe Trash needs to restore it."""
        existing = self.get_analysis_view(view_id)
        if existing is None:
            return None

        def op(conn: sqlite3.Connection) -> None:
            conn.execute("DELETE FROM analysis_views WHERE id = ?", (view_id,))
            self._touch(conn)

        self._write(op)
        return existing

    def reinsert_analysis_views(self, views: list[dict[str, Any]]) -> int:
        """Restore saved readings whose ids have not been reused."""
        restored = 0
        for view in views:
            if self.get_analysis_view(str(view.get("id") or "")) is not None:
                continue
            self.save_analysis_view(view)
            restored += 1
        return restored

    def entities_by_ids(self, ids: list[str]) -> list[dict[str, Any]]:
        """A known set of entities in one read, skipping ids that are gone."""
        found: list[dict[str, Any]] = []
        with self._connect() as conn:
            for chunk in _chunks(list(dict.fromkeys(ids))):
                rows = conn.execute(
                    f"SELECT * FROM entities WHERE id IN ({_marks(chunk)})", chunk
                ).fetchall()
                found.extend(self._entity(r) for r in rows)
        return found

    def labels_of_type(self, type_: str) -> list[tuple[str, str]]:
        """Every entity of one type as ``(id, label)``, off ``idx_entities_type``.

        Two columns and no payload: the caller compares identifier values
        (``entities.identity_key``), and that normalization is vocabulary — pushed
        into SQL it would be a second copy of the rules, drifting from the one the
        create form is answered by.
        """
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, label FROM entities WHERE type = ?", (type_,)
            ).fetchall()
        return [(row["id"], row["label"]) for row in rows]

    def links_among(
        self, ids: list[str], *, types: list[str] | None = None
    ) -> list[dict[str, Any]]:
        """Edges with **both** ends inside the set — what a drawn view may show.

        An edge to a node that was not loaded cannot be drawn without inventing the
        node at its far end, so the view asks for the closed set and gets it from the
        database rather than filtering a wider one in Python.

        It takes no ``exclude_types``, unlike the two reads below: both ends are
        already nodes the caller resolved and drew, so a type the lens leaves out
        cannot be one of them.
        """
        return self._links_in(ids, types=types, touching=False)

    def links_touching(
        self,
        ids: list[str],
        *,
        types: list[str] | None = None,
        exclude_types: list[str] | None = None,
        end_types: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Edges with **either** end inside the set — one hop of an expansion.

        ``exclude_types`` drops an edge whose far end the lens does not draw, which is
        what stops a walk from stepping onto one and reporting it as a neighbour.
        ``end_types`` asks the opposite and is the collapse's probe: only edges that do
        reach one of those types, so a bridge through a node the reading leaves out
        comes back in one row instead of being looked for.
        """
        return self._links_in(
            ids, types=types, exclude_types=exclude_types,
            end_types=end_types, touching=True,
        )

    def degrees_of(
        self,
        ids: list[str],
        *,
        types: list[str] | None = None,
        exclude_types: list[str] | None = None,
    ) -> dict[str, int]:
        """How many edges each of these nodes carries, over one lens.

        What a node shows before it is expanded, so the analyst knows the size of
        what a click is about to bring in — hence ``exclude_types``: a connection to a
        node this reading leaves out is not something a click could bring in.
        """
        clause, params = _link_scope(types, ends_out=exclude_types)
        counts: dict[str, int] = {}
        with self._connect() as conn:
            for chunk in _chunks(list(dict.fromkeys(ids))):
                marks = _marks(chunk)
                where = f"{clause} AND" if clause else " WHERE"
                rows = conn.execute(
                    "SELECT id, COUNT(*) AS n FROM ("
                    f" SELECT from_id AS id FROM links{where} from_id IN ({marks})"
                    " UNION ALL"
                    f" SELECT to_id AS id FROM links{where} to_id IN ({marks})"
                    ") GROUP BY id",
                    (*params, *chunk, *params, *chunk),
                ).fetchall()
                for row in rows:
                    counts[row["id"]] = int(row["n"])
        return {entity_id: counts.get(entity_id, 0) for entity_id in dict.fromkeys(ids)}

    def _links_in(
        self,
        ids: list[str],
        *,
        types: list[str] | None,
        touching: bool,
        exclude_types: list[str] | None = None,
        end_types: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Edges over an id set, in one statement whatever the set's size.

        **Both ends have to be asked at once**, and that is what the id set cannot be
        chunked for. One end inside is a question a chunk can settle alone: an edge
        either touches it or it does not. Both ends inside is not — the two ends can
        fall in two different chunks, and then no chunk holds the edge and neither did
        the answer. Asked chunk by chunk, a drawn view over `_ID_CHUNK` nodes lost
        most of its edges: nodes drew as unconnected dots, and a node whose edges had
        gone kept reporting them as connections still to open, under a control that
        could never bring one in.

        Asking every *pair* of chunks closed that hole and bought a worse one, which
        the ceiling on the drawing was hiding: the statement count is the square of
        the set. `_scope_table` is the answer that scales — the ids go in as rows, and
        the closed set is a join on the primary key.

        Rows come back in `rowid` order, so the edge order a caller sees is the order
        the case recorded them in.
        """
        wanted = list(dict.fromkeys(ids))
        if not wanted:
            return []
        clause, params = _link_scope(types, ends_out=exclude_types, ends_in=end_types)
        # One end in the set, or both. The closed set says it as a join, because that
        # is what a join is: the far end has to *exist* in the scope for the row to
        # stand, and both ends are then one condition rather than two chunk lists.
        if touching:
            reaches = (
                f" (links.from_id IN (SELECT id FROM {_SCOPE})"
                f" OR links.to_id IN (SELECT id FROM {_SCOPE}))"
            )
            joined = ""
            where = f"{clause} AND{reaches}" if clause else f" WHERE{reaches}"
        else:
            joined = (
                f" JOIN {_SCOPE} near ON near.id = links.from_id"
                f" JOIN {_SCOPE} far ON far.id = links.to_id"
            )
            where = clause
        with self._connect() as conn:
            _scope_table(conn, wanted)
            rows = conn.execute(
                f"SELECT links.* FROM links{joined}{where} ORDER BY links.rowid",
                params,
            ).fetchall()
        return [self._link(row) for row in rows]

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
        attr: str | None = None,
        attr_value: str | None = None,
        linked: str | None = None,
        unlinked: bool = False,
        since: str | None = None,
        until: str | None = None,
        filed_by: list[str] | None = None,
        temporal_since: str | None = None,
        temporal_until: str | None = None,
        temporal_categories: list[str] | None = None,
        order: str = "",
    ) -> dict[str, Any]:
        """A bounded, cursor-paginated slice of entities, in insertion order or sorted.

        The default cursor keys on ``rowid`` (monotonic, primary-index-backed), so a
        background import appending rows never shifts a page the analyst already
        scrolled past — new rows land after the current tail. Filters compose in
        SQL: ``types`` (an ``IN`` set), ``status``, a case-insensitive ``query``
        over the label, folder — either ``unfiled`` (no folder) or an exact
        ``folder`` path (or its descendants when ``recursive`` is true) — one stored
        field holding one value (``attr``/``attr_value``), having a neighbour of a
        type (``linked``) or none at all (``unlinked``), and when and by what the row
        was filed (``since``/``until``/``filed_by``). One extra row is peeked to know
        whether a further page exists, so ``next_cursor`` is None exactly on the last
        page.

        ``order`` sorts the whole filtered set rather than the page (``_PAGE_ORDERS``),
        which is the difference between *the newest in this case* and *the newest of
        the hundred rows a table has loaded* — the second is what a client-side sort
        can answer, and on a case worth paging it is the wrong answer.

        ``total`` counts every row matching the same terms, which is what makes the
        narrowing terms answer a question rather than only shorten a list: *how many
        videos have coordinates* is that number.
        """
        if order and order not in _PAGE_ORDERS:
            raise CaseError(f"'{order}' is not an ordering")
        filter_clause, filter_params = _entity_filters(
            types=types, status=status, query=query,
            folder=folder, unfiled=unfiled, recursive=recursive,
            attr=attr, attr_value=attr_value, linked=linked, unlinked=unlinked,
            since=since, until=until, filed_by=filed_by,
            temporal_since=temporal_since, temporal_until=temporal_until,
            temporal_categories=temporal_categories,
        )
        clause, params = filter_clause, list(filter_params)
        sort_key = ""
        if order:
            expression, sort_key, descending = _PAGE_ORDERS[order]
            way = "<" if descending else ">"
            if cursor is not None:
                seat, key = _page_cursor(cursor)
                joiner = " AND " if clause else " WHERE "
                clause = (
                    f"{clause}{joiner}({expression} {way} ?"
                    f" OR ({expression} = ? AND rowid {way} ?))"
                )
                params.extend((key, key, seat))
            direction = "DESC" if descending else "ASC"
            ordering = f"{expression} {direction}, rowid {direction}"
        else:
            if cursor is not None:
                joiner = " AND " if clause else " WHERE "
                clause = f"{clause}{joiner}rowid > ?"
                params.append(_parse_cursor(cursor))
            ordering = "rowid"
        params.append(limit + 1)
        with self._connect() as conn:
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM entities{filter_clause}",
                    filter_params,
                ).fetchone()[0]
            )
            rows = conn.execute(
                f"SELECT rowid AS _rowid, * FROM entities{clause}"
                f" ORDER BY {ordering} LIMIT ?",
                params,
            ).fetchall()
        has_more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = None
        if has_more and rows:
            tail = rows[-1]
            next_cursor = (
                f"{tail['_rowid']}:{tail[sort_key]}" if sort_key else str(tail["_rowid"])
            )
        return {
            "items": [self._entity(r) for r in rows],
            "next_cursor": next_cursor,
            "total": total,
        }

    def catalog_summary(self) -> dict[str, Any]:
        """Total plus per-type, per-status, per-folder and per-filer counts in grouped
        scans — the catalog's badges without materialising the graph.

        ``by_source`` is ``provenance.by``: which tool filed a row, or the analyst.
        ``unlinked`` is how many the case connects to nothing, and it is here rather
        than left to a query because it is a *menu* count — a filter menu that states
        how much of an answer each term is before it is chosen is what stops the
        analyst picking one and landing on an empty table.
        """
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
            by_source = {
                r["prov_by"]: r["n"]
                for r in conn.execute(
                    "SELECT prov_by, COUNT(*) AS n FROM entities GROUP BY prov_by"
                )
            }
            unlinked = int(
                conn.execute(
                    "SELECT COUNT(*) FROM entities"
                    f" WHERE NOT{_linked_at_all('entities')}"
                ).fetchone()[0]
            )
            # How many entities have **a neighbour** of each type, which is a different
            # number from how many of that type the case holds: four things pointing at
            # one place is four here and one there. The filter asks the first, so the
            # menu has to price the first — a count that answers the neighbouring
            # question is worse than no count, because it looks like an answer.
            #
            # Distinct per near-end, since a media joined to one place by two verbs is
            # one row that is linked to a place, not two.
            linked_to = {
                r["type"]: int(r["n"])
                for r in conn.execute(
                    "SELECT far_type AS type, COUNT(DISTINCT near_id) AS n FROM ("
                    " SELECT l.from_id AS near_id, far.type AS far_type"
                    " FROM links l JOIN entities far ON far.id = l.to_id"
                    " UNION ALL"
                    " SELECT l.to_id AS near_id, near.type AS far_type"
                    " FROM links l JOIN entities near ON near.id = l.from_id"
                    ") GROUP BY far_type"
                )
            }
            # How many statements would actually produce a row if the case were added
            # up: one carrying a number, about something. Here for the same reason
            # `unlinked` is — it prices a control before it is pressed, and the two
            # halves are what make the row real. A statement with no number says
            # *seen, not counted* and one about nothing has no subject to sit under,
            # so neither draws a line, and a total offered over them opens on an empty
            # answer that reads as a finding about the case.
            countable = int(
                conn.execute(
                    "SELECT COUNT(*) FROM entities e"
                    " WHERE e.type = 'claim'"
                    f" AND {_holds_number('count')}"
                    " AND EXISTS ("
                    "  SELECT 1 FROM links l WHERE l.from_id = e.id AND l.type = ?"
                    " )",
                    (link_engine.ABOUT,),
                ).fetchone()[0]
            )
        return {
            "total": total,
            "by_type": by_type,
            "by_status": by_status,
            "by_folder": by_folder,
            "by_source": by_source,
            "linked_to": linked_to,
            "unlinked": unlinked,
            "countable": countable,
        }

    def attr_facets(
        self, *, types: list[str] | None = None, limit: int = MAX_ATTR_VALUES
    ) -> list[dict[str, Any]]:
        """Which stored fields these entities hold, and which values they hold.

        What makes a field filterable without a query language: the select of fields
        and the select of values are both **populated from the case**, so every term of
        a search is chosen rather than typed (SPEC anti-goals). It also answers a
        question the vocabulary cannot: `kind` is written by the importer and declared
        nowhere, so a registry-driven menu would never have offered the one field an
        analyst most wants to filter on.

        Returns one entry per field, ``{key, entities, values, truncated}``, ordered by
        how many entities carry it. Bounded twice over, because this is a menu and not
        a report: a field holding more than ``limit`` distinct values comes back with
        none of them and ``truncated`` true — five thousand file paths is not a choice —
        and a value longer than ``MAX_ATTR_TEXT`` is left out for the same reason.
        Objects, arrays and booleans are skipped: a footprint is a shape, and `True` is
        not a word anyone picks off a menu.

        Scanned in Python like ``find_entity``, deliberately: it is a bounded read
        behind an explicit act, and a JSON1 grouping would put the one thing this
        module refuses to depend on in the middle of a menu.

        **What it costs, so no caller gates on case size again.** The scan is linear
        in the rows the narrowing covers and small per row: measured at 6 ms for 1 000
        entities, 0.3 s for 50 000 and 0.7 s for 100 000, with a distinct ``path`` and
        ``sha256`` each — the shape that overflows ``limit`` and so pays the most.
        The Board and the graph used to darken the field menu past five thousand,
        which cost the cases that most need a field to narrow with the one filter that
        scales for them. The bound that keeps a menu readable is the one on values,
        above.
        """
        wanted = list(dict.fromkeys(types or []))
        counts: dict[str, int] = {}
        values: dict[str, dict[str, int]] = {}
        overflowed: set[str] = set()
        clause = f" WHERE type IN ({_marks(wanted)})" if wanted else ""
        with self._connect() as conn:
            for row in conn.execute(f"SELECT attrs_json FROM entities{clause}", wanted):
                for key, value in json.loads(row["attrs_json"]).items():
                    text = _facet_value(value)
                    if text is None:
                        continue
                    counts[key] = counts.get(key, 0) + 1
                    held = values.setdefault(key, {})
                    if text in held:
                        held[text] += 1
                    elif len(held) < limit:
                        held[text] = 1
                    else:
                        overflowed.add(key)
        return [
            {
                "key": key,
                "entities": counts[key],
                "values": (
                    []
                    if key in overflowed
                    else [
                        {"value": value, "count": count}
                        for value, count in sorted(
                            values[key].items(), key=lambda pair: (-pair[1], pair[0])
                        )
                    ]
                ),
                "truncated": key in overflowed,
            }
            for key in sorted(counts, key=lambda key: (-counts[key], key))
        ]

    def get_entity(self, entity_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM entities WHERE id = ?", (entity_id,)).fetchone()
        return self._entity(row) if row is not None else None

    def note_ids_by_titles(self, titles: set[str]) -> dict[str, list[str]]:
        """Note ids grouped by case-folded title, for stable flat exports."""
        wanted = {title.casefold() for title in titles}
        grouped: dict[str, list[str]] = {title: [] for title in wanted}
        if not wanted:
            return grouped
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, label FROM entities WHERE type = 'note' ORDER BY id"
            ).fetchall()
        for row in rows:
            key = str(row["label"]).casefold()
            if key in grouped:
                grouped[key].append(str(row["id"]))
        return grouped

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

    # -- entity image galleries ------------------------------------------

    @staticmethod
    def _ensure_entity_image_primary(conn: sqlite3.Connection, entity_id: str) -> bool:
        if conn.execute(
            "SELECT 1 FROM entity_images WHERE entity_id = ? AND is_primary = 1",
            (entity_id,),
        ).fetchone() is not None:
            return False
        row = conn.execute(
            "SELECT image_id FROM entity_images WHERE entity_id = ?"
            " ORDER BY position, image_id LIMIT 1",
            (entity_id,),
        ).fetchone()
        if row is None:
            return False
        conn.execute(
            "UPDATE entity_images SET is_primary = 1"
            " WHERE entity_id = ? AND image_id = ?",
            (entity_id, row["image_id"]),
        )
        return True

    def entity_images(self, entity_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT ei.image_id, ei.media_id, ei.path, ei.thumbnail, ei.title,"
                " ei.position, ei.is_primary, mi.item_json"
                " FROM entity_images ei"
                " LEFT JOIN media_items mi ON mi.entity_id = ei.media_id"
                " WHERE ei.entity_id = ?"
                " ORDER BY ei.position, ei.image_id",
                (entity_id,),
            ).fetchall()
        images: list[dict[str, Any]] = []
        for row in rows:
            item = json.loads(row["item_json"]) if row["item_json"] else {}
            direct = row["media_id"] is None
            images.append(
                {
                    **item,
                    "id": row["image_id"],
                    "media_id": row["media_id"],
                    "direct": direct,
                    "path": row["path"] if direct else item.get("path"),
                    "thumbnail": (
                        row["thumbnail"] if direct else item.get("thumbnail")
                    ),
                    "title": row["title"] if direct else item.get("title"),
                    "kind": "image",
                    "position": int(row["position"]),
                    "primary": bool(row["is_primary"]),
                }
            )
        return images

    def entity_image_thumbs(self, entity_ids: list[str]) -> dict[str, str]:
        unique = list(dict.fromkeys(entity_ids))
        if not unique:
            return {}
        found: dict[str, str] = {}
        with self._connect() as conn:
            for chunk in _chunks(unique):
                rows = conn.execute(
                    "SELECT ei.entity_id, ei.thumbnail, mi.item_json"
                    " FROM entity_images ei"
                    " LEFT JOIN media_items mi ON mi.entity_id = ei.media_id"
                    " WHERE ei.is_primary = 1"
                    f" AND ei.entity_id IN ({_marks(chunk)})",
                    chunk,
                ).fetchall()
                for row in rows:
                    thumb = row["thumbnail"]
                    if not thumb and row["item_json"]:
                        thumb = json.loads(row["item_json"]).get("thumbnail")
                    if thumb:
                        found[row["entity_id"]] = thumb
        return found

    def entity_images_touching(self, entity_ids: list[str]) -> list[dict[str, Any]]:
        unique = list(dict.fromkeys(entity_ids))
        if not unique:
            return []
        found: dict[tuple[str, str], dict[str, Any]] = {}
        with self._connect() as conn:
            for chunk in _chunks(unique):
                marks = _marks(chunk)
                rows = conn.execute(
                    "SELECT entity_id, image_id, media_id, path, thumbnail, title,"
                    " position, is_primary"
                    " FROM entity_images"
                    f" WHERE entity_id IN ({marks}) OR media_id IN ({marks})",
                    (*chunk, *chunk),
                ).fetchall()
                for row in rows:
                    found[(row["entity_id"], row["image_id"])] = {
                        "entity_id": row["entity_id"],
                        "image_id": row["image_id"],
                        "media_id": row["media_id"],
                        "path": row["path"],
                        "thumbnail": row["thumbnail"],
                        "title": row["title"],
                        "position": int(row["position"]),
                        "primary": bool(row["is_primary"]),
                    }
        return sorted(found.values(), key=lambda row: (row["entity_id"], row["position"]))

    def add_entity_images(self, entity_id: str, media_ids: list[str]) -> int:
        candidates = list(dict.fromkeys(media_ids))

        def op(conn: sqlite3.Connection) -> int:
            if conn.execute(
                "SELECT 1 FROM entities WHERE id = ?", (entity_id,)
            ).fetchone() is None:
                raise CaseError(f"entity '{entity_id}' not found")
            if not candidates:
                return 0
            present = {
                row["id"]
                for row in conn.execute(
                    f"SELECT id FROM entities WHERE id IN ({_marks(candidates)})",
                    candidates,
                )
            }
            missing = next((media_id for media_id in candidates if media_id not in present), None)
            if missing is not None:
                raise CaseError(f"entity '{missing}' not found")
            row = conn.execute(
                "SELECT COALESCE(MAX(position), -1) AS position"
                " FROM entity_images WHERE entity_id = ?",
                (entity_id,),
            ).fetchone()
            position = int(row["position"]) + 1
            added = 0
            for media_id in candidates:
                cursor = conn.execute(
                    "INSERT OR IGNORE INTO entity_images"
                    "(entity_id, image_id, media_id, position, is_primary)"
                    " VALUES(?, ?, ?, ?, 0)",
                    (entity_id, media_id, media_id, position),
                )
                if cursor.rowcount:
                    position += 1
                    added += 1
            promoted = self._ensure_entity_image_primary(conn, entity_id)
            if added or promoted:
                self._touch(conn)
            return added

        return self._write(op)

    def add_entity_image_file(
        self,
        entity_id: str,
        image_id: str,
        path: str,
        thumbnail: str,
        title: str,
    ) -> None:
        def op(conn: sqlite3.Connection) -> None:
            if conn.execute(
                "SELECT 1 FROM entities WHERE id = ?", (entity_id,)
            ).fetchone() is None:
                raise CaseError(f"entity '{entity_id}' not found")
            row = conn.execute(
                "SELECT COALESCE(MAX(position), -1) AS position"
                " FROM entity_images WHERE entity_id = ?",
                (entity_id,),
            ).fetchone()
            conn.execute(
                "INSERT INTO entity_images"
                "(entity_id, image_id, media_id, path, thumbnail, title, position, is_primary)"
                " VALUES(?, ?, NULL, ?, ?, ?, ?, 0)",
                (entity_id, image_id, path, thumbnail, title, int(row["position"]) + 1),
            )
            self._ensure_entity_image_primary(conn, entity_id)
            self._touch(conn)

        self._write(op)

    def set_primary_entity_image(self, entity_id: str, image_id: str) -> None:
        def op(conn: sqlite3.Connection) -> None:
            row = conn.execute(
                "SELECT is_primary FROM entity_images"
                " WHERE entity_id = ? AND image_id = ?",
                (entity_id, image_id),
            ).fetchone()
            if row is None:
                raise CaseError("that image is not attached to this entity")
            if row["is_primary"]:
                return
            conn.execute(
                "UPDATE entity_images SET is_primary = 0 WHERE entity_id = ?",
                (entity_id,),
            )
            conn.execute(
                "UPDATE entity_images SET is_primary = 1"
                " WHERE entity_id = ? AND image_id = ?",
                (entity_id, image_id),
            )
            self._touch(conn)

        self._write(op)

    def remove_entity_image(self, entity_id: str, image_id: str) -> dict[str, Any]:
        def op(conn: sqlite3.Connection) -> dict[str, Any]:
            row = conn.execute(
                "SELECT image_id, media_id, path, thumbnail, title, position, is_primary"
                " FROM entity_images WHERE entity_id = ? AND image_id = ?",
                (entity_id, image_id),
            ).fetchone()
            if row is None:
                raise CaseError("that image is not attached to this entity")
            conn.execute(
                "DELETE FROM entity_images WHERE entity_id = ? AND image_id = ?",
                (entity_id, image_id),
            )
            self._ensure_entity_image_primary(conn, entity_id)
            self._touch(conn)
            return {
                "id": row["image_id"],
                "media_id": row["media_id"],
                "path": row["path"],
                "thumbnail": row["thumbnail"],
                "title": row["title"],
                "position": int(row["position"]),
                "primary": bool(row["is_primary"]),
            }

        return self._write(op)

    def reinsert_entity_images(self, rows: list[dict[str, Any]]) -> dict[str, int]:
        def op(conn: sqlite3.Connection) -> dict[str, int]:
            entity_ids = list(
                dict.fromkeys(
                    str(value)
                    for row in rows
                    for value in (row.get("entity_id"),)
                    if value is not None
                )
            )
            media_ids = list(
                dict.fromkeys(
                    str(row["media_id"])
                    for row in rows
                    if row.get("media_id") is not None
                )
            )
            present: set[str] = set()
            for chunk in _chunks([*entity_ids, *media_ids]):
                present.update(
                    row["id"]
                    for row in conn.execute(
                        f"SELECT id FROM entities WHERE id IN ({_marks(chunk)})",
                        chunk,
                    )
                )
            kept = [
                row
                for row in rows
                if row.get("entity_id") in present
                and (row.get("media_id") is None or row.get("media_id") in present)
            ]
            primary_entities = {
                str(row["entity_id"]) for row in kept if row.get("primary")
            }
            for entity_id in primary_entities:
                conn.execute(
                    "UPDATE entity_images SET is_primary = 0 WHERE entity_id = ?",
                    (entity_id,),
                )
            for row in kept:
                conn.execute(
                    "INSERT OR REPLACE INTO entity_images"
                    "(entity_id, image_id, media_id, path, thumbnail, title,"
                    " position, is_primary) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        row["entity_id"],
                        row.get("image_id") or row.get("media_id"),
                        row.get("media_id"),
                        row.get("path"),
                        row.get("thumbnail"),
                        row.get("title"),
                        int(row.get("position", 0)),
                        int(bool(row.get("primary"))),
                    ),
                )
            for entity_id in {str(row["entity_id"]) for row in kept}:
                self._ensure_entity_image_primary(conn, entity_id)
            if kept:
                self._touch(conn)
            return {"images": len(kept), "images_lost": len(rows) - len(kept)}

        return self._write(op)

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
            " size, added_at, search_text, source_type, source_op, imagery_mode,"
            " has_gps"
            ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(path) DO UPDATE SET"
            " entity_id = COALESCE(excluded.entity_id, media_items.entity_id),"
            " item_json = excluded.item_json,"
            " filename = excluded.filename, kind = excluded.kind,"
            " folder = excluded.folder, name_sort = excluded.name_sort,"
            " size = excluded.size, added_at = excluded.added_at,"
            " search_text = excluded.search_text, source_type = excluded.source_type,"
            " source_op = excluded.source_op, imagery_mode = excluded.imagery_mode,"
            " has_gps = excluded.has_gps",
            (values[0], entity_id, *values[1:]),
        )
        indexed = conn.execute(
            "SELECT item_json, entity_id FROM media_items WHERE path = ?",
            (values[0],),
        ).fetchone()
        assert indexed is not None
        _sync_media_temporal(
            conn,
            json.loads(indexed["item_json"]),
            indexed["entity_id"],
        )

    def upsert_media_item(
        self, item: dict[str, Any], *, entity_id: str | None = None
    ) -> None:
        def op(conn: sqlite3.Connection) -> None:
            self._upsert_media_conn(conn, item, entity_id=entity_id)

        self._write(op)

    def remove_media_item(self, path: str) -> None:
        def op(conn: sqlite3.Connection) -> None:
            row = conn.execute(
                "SELECT entity_id FROM media_items WHERE path = ?", (path,)
            ).fetchone()
            conn.execute("DELETE FROM media_items WHERE path = ?", (path,))
            if row is not None and row["entity_id"]:
                conn.execute(
                    "DELETE FROM temporal_items"
                    " WHERE owner_id = ? AND authority = 'media'",
                    (row["entity_id"],),
                )

        self._write(op)

    @staticmethod
    def _media_item(row: sqlite3.Row) -> dict[str, Any]:
        """One browse item, with the media entity it belongs to.

        ``entity_id`` is the column, not a sidecar field: the row already holds
        the link, so a caller that needs the entity behind a path reads it here
        instead of scanning the graph for an attribute match.
        """
        return {**json.loads(row["item_json"]), "entity_id": row["entity_id"]}

    def list_media_items(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT item_json, entity_id FROM media_items"
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
                f"SELECT item_json, entity_id FROM media_items WHERE path IN ({placeholders})",
                unique,
            ).fetchall()
        by_path = {
            item["path"]: item for item in (self._media_item(row) for row in rows)
        }
        return [by_path[path] for path in unique if path in by_path]

    def media_thumbs(self, entity_ids: list[str]) -> dict[str, str]:
        """The cached thumbnail of each of these entities that has one.

        Chunked like every other id lookup here, and like `media_kinds` beside it.
        The bound this used to raise on was a statement-size bound wearing the
        clothes of a policy: the caller is the graph, whose ceiling is its own
        business, and refusing the read left a drawable case drawing nothing at all.
        """
        unique = list(dict.fromkeys(entity_ids))
        if not unique:
            return {}
        rows: list[sqlite3.Row] = []
        with self._connect() as conn:
            for chunk in _chunks(unique):
                rows.extend(
                    conn.execute(
                        "SELECT entity_id, item_json FROM media_items"
                        f" WHERE entity_id IN ({_marks(chunk)})",
                        chunk,
                    ).fetchall()
                )
        found: dict[str, str] = {}
        for row in rows:
            thumb = json.loads(row["item_json"]).get("thumbnail")
            if thumb:
                found[row["entity_id"]] = thumb
        return found

    def media_kinds(self, entity_ids: list[str]) -> dict[str, str]:
        """What the bytes behind each of these entities are: image, video, audio…

        Read off the indexed column rather than out of `item_json`, and keyed by
        entity for the same reason the thumbnails are: the surfaces that draw an
        entity hold ids. An entity with no indexed media is absent rather than
        guessed at, which is what lets a caller tell "not media" from "unknown".
        """
        unique = list(dict.fromkeys(entity_ids))
        if not unique:
            return {}
        found: dict[str, str] = {}
        with self._connect() as conn:
            for chunk in _chunks(unique):
                rows = conn.execute(
                    "SELECT entity_id, kind FROM media_items"
                    f" WHERE entity_id IN ({_marks(chunk)})",
                    chunk,
                ).fetchall()
                for row in rows:
                    if row["kind"]:
                        found[row["entity_id"]] = row["kind"]
        return found

    def media_origins(self, entity_ids: list[str]) -> dict[str, dict[str, str]]:
        """How each of these entities came into the case: the route, and the act that
        produced it where there was one.

        Read off the two indexed columns rather than out of `item_json`, and keyed by
        entity for the same reason `media_kinds` beside it is. A row recording no
        route is left out, so a caller can tell "came in by no stated route" from "the
        index has never seen this entity".
        """
        unique = list(dict.fromkeys(entity_ids))
        if not unique:
            return {}
        found: dict[str, dict[str, str]] = {}
        with self._connect() as conn:
            for chunk in _chunks(unique):
                rows = conn.execute(
                    "SELECT entity_id, source_type, source_op FROM media_items"
                    f" WHERE entity_id IN ({_marks(chunk)})",
                    chunk,
                ).fetchall()
                for row in rows:
                    if not row["source_type"]:
                        continue
                    origin = {"type": row["source_type"]}
                    if row["source_op"]:
                        origin["op"] = row["source_op"]
                    found[row["entity_id"]] = origin
        return found

    def page_media_items(
        self,
        *,
        q: str | None = None,
        kind: str | None = None,
        category: str | None = None,
        folder: str | None = None,
        gps: bool = False,
        collected_only: bool = False,
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

        # "Only what the case collected" scopes the whole answer rather than
        # refining it, the counts included: a case where 150 of 200 files are
        # extracted frames is the one this exists for, and a facet still
        # advertising 30 collages the switch is hiding is a chooser that lies.
        # `made_here_count` says how many it is taking out, over the same
        # narrowing, so nothing disappears without a number.
        scope_where = list(base_where)
        if collected_only:
            base_where.append(f"NOT {_MADE_HERE_SQL}")

        # Category and GPS are two independent refinements of that base. Each
        # one's own facet count leaves itself out and applies the other, so a
        # chooser always reports what clicking it would actually yield.
        category_sql = _MEDIA_CATEGORY_SQL.get(category or "")
        selected_where = list(base_where)
        selected_params = list(base_params)
        if category_sql:
            selected_where.append(category_sql)
        if gps:
            selected_where.append("has_gps = 1")

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
                f"SELECT item_json, entity_id FROM media_items{selected_clause}"
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
            # selected, so its counts exclude the current category but keep the
            # rest of the filter, GPS included.
            gps_scope = [*base_where, "has_gps = 1"] if gps else base_where
            category_counts: dict[str, int] = {}
            for key in _MEDIA_CATEGORIES:
                category_counts[key] = int(
                    conn.execute(
                        f"SELECT COUNT(*) FROM media_items{clause([*gps_scope, _MEDIA_CATEGORY_SQL[key]])}",
                        base_params,
                    ).fetchone()[0]
                )
            gps_count = int(
                conn.execute(
                    "SELECT COUNT(*) FROM media_items"
                    f"{clause([*base_where, *([category_sql] if category_sql else []), 'has_gps = 1'])}",
                    base_params,
                ).fetchone()[0]
            )
            # What the switch stands to take out, under the narrowing already set.
            # Counted whether it is on or off: off, it is what turning it on would
            # hide, and on, it is what is being hidden — one number, honest both ways,
            # and the reason the switch can never empty a list silently.
            made_here_count = int(
                conn.execute(
                    "SELECT COUNT(*) FROM media_items"
                    f"{clause([*scope_where, *([category_sql] if category_sql else []), *(['has_gps = 1'] if gps else []), _MADE_HERE_SQL])}",
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
                "gps_count": gps_count,
                "made_here_count": made_here_count,
            },
        }

    # -- temporal projection ---------------------------------------------

    @staticmethod
    def _timeline_scope(
        *, categories: list[str], entity_id: str | None,
        track: dict[str, Any] | None = None,
    ) -> tuple[list[str], list[Any]]:
        invalid = sorted(set(categories) - set(timeline_engine.ALL_CATEGORIES))
        if invalid:
            raise CaseError(f"unknown timeline category '{invalid[0]}'")
        if not categories:
            raise CaseError("at least one timeline category is required")
        placeholders = ", ".join("?" for _ in categories)
        where = [f"t.category IN ({placeholders})"]
        params: list[Any] = list(categories)
        if entity_id:
            where.append(
                "(t.owner_id = ? OR EXISTS ("
                "SELECT 1 FROM links temporal_link"
                " WHERE temporal_link.from_id = t.owner_id"
                " AND temporal_link.to_id = ?"
                " AND temporal_link.type IN ('about', 'at', 'cites')))"
            )
            params.extend((entity_id, entity_id))
        query: dict[str, Any] = track if isinstance(track, dict) else {}
        roles = [
            value for value in query.get("roles", [])
            if value in {"occurred", "observed", "valid", "unset"}
        ] if isinstance(query.get("roles"), list) else []
        if roles:
            role_values = [value for value in roles if value != "unset"]
            role_parts = []
            if role_values:
                role_parts.append(f"t.time_role IN ({_marks(role_values)})")
                params.extend(role_values)
            if "unset" in roles:
                role_parts.append("t.time_role IS NULL")
            where.append("(" + " OR ".join(role_parts) + ")")

        raw_terms: dict[Any, Any] = (
            query["terms"] if isinstance(query.get("terms"), dict) else {}
        )
        terms = {str(key): value for key, value in raw_terms.items()}
        has_terms = any(value not in (None, "", [], False) for value in terms.values())
        relation_value = query.get("relation")
        relation = relation_value if isinstance(relation_value, str) else None
        relation_key = relation or "any"
        if has_terms:
            def term(key: str) -> str:
                return str(terms.get(key) or "")[:1000]

            types = [part for part in term("type").split(",") if part][:100]
            filed_by = [part for part in term("by").split(",") if part][:100]
            entity_clause, entity_params = _entity_filters(
                types=types or None,
                status=(
                    term("status")
                    if term("status") in {"confirmed", "suggested"}
                    else None
                ),
                query=term("q") or None,
                folder=term("folder") or None,
                unfiled=term("unfiled").lower() == "true",
                recursive=term("recursive").lower() == "true",
                attr=term("attr") or None,
                attr_value=term("value") or None,
                linked=term("linked") or None,
                unlinked=term("unlinked").lower() == "true",
                since=term("since") or None,
                until=term("until") or None,
                filed_by=filed_by or None,
                alias="scope_entity",
            )
            match = entity_clause.removeprefix(" WHERE ") or "1"
            relation_types = {
                "about": ("about",),
                "place": ("at",),
                "source": ("cites",),
                "owner": (),
                "any": ("about", "at", "cites"),
            }.get(relation_key, ("about", "at", "cites"))
            reaches = ["scope_entity.id = t.owner_id"] if relation_key in {"any", "owner"} else []
            if relation_types:
                reaches.append(
                    "EXISTS (SELECT 1 FROM links track_link"
                    " WHERE track_link.from_id = t.owner_id"
                    " AND track_link.to_id = scope_entity.id"
                    f" AND track_link.type IN ({_marks(list(relation_types))}))"
                )
                entity_params.extend(relation_types)
            where.append(
                "EXISTS (SELECT 1 FROM entities scope_entity WHERE "
                f"({match}) AND ({' OR '.join(reaches)}))"
            )
            params.extend(entity_params)
        elif relation in {"about", "place", "source"}:
            connector = {"about": "about", "place": "at", "source": "cites"}[relation]
            where.append(
                "EXISTS (SELECT 1 FROM links track_link"
                " WHERE track_link.from_id = t.owner_id AND track_link.type = ?)"
            )
            params.append(connector)
        hidden_raw: list[Any] = (
            query["hidden"] if isinstance(query.get("hidden"), list) else []
        )
        hidden = [str(value) for value in hidden_raw[:500] if value]
        if hidden:
            where.append(f"t.id NOT IN ({_marks(hidden)})")
            params.extend(hidden)
        return where, params

    @staticmethod
    def _timeline_item(
        row: sqlite3.Row, connectors: dict[str, dict[str, list[dict[str, str]]]]
    ) -> dict[str, Any]:
        joined = connectors.get(row["owner_id"], {})
        return {
            "id": row["id"],
            "owner_id": row["owner_id"],
            "authority": row["authority"],
            "category": row["category"],
            "kind": row["kind"],
            "label": row["label"],
            "raw": row["raw"],
            "earliest": row["earliest"],
            "latest": row["latest"],
            "precision": row["precision"],
            "shape": row["shape"],
            "time_role": row["time_role"],
            "uncertain": bool(row["uncertain"]),
            "approximate": bool(row["approximate"]),
            "zone": row["zone"],
            "sortable": bool(row["sortable"]),
            "status": row["status"],
            "confidence": row["confidence"],
            "parse_error": row["parse_error"],
            "owner_type": row["owner_type"],
            "subjects": [entry["id"] for entry in joined.get("about", [])],
            "places": [entry["id"] for entry in joined.get("at", [])],
            "sources": [entry["id"] for entry in joined.get("cites", [])],
            "subject_entities": joined.get("about", []),
            "place_entities": joined.get("at", []),
            "source_entities": joined.get("cites", []),
        }

    def timeline_page(
        self,
        *,
        since: str | None = None,
        until: str | None = None,
        categories: list[str] | None = None,
        entity_id: str | None = None,
        include_undated: bool = True,
        limit: int = 100,
        cursor: str | None = None,
        bucket: str | None = None,
        track: dict[str, Any] | None = None,
        spread: bool = False,
    ) -> dict[str, Any]:
        """Return one indexed, homogeneous page for Time or Timeline.

        ``since`` is inclusive and ``until`` exclusive. Rows intersect the
        window. A local timestamp has no UTC bounds and travels as ``unplaced``
        until its timezone is known; ``undated`` is reserved for an absent value.

        A page is the front of the window unless ``spread`` asks otherwise, and
        the front of a lopsided case is one corner of it: 200 rows off 273 media
        that pile into January leave February onward empty, which reads as
        missing data rather than as an unread page. A spread read cuts the same
        ordering into ``stride`` interleaved slices and serves one per page, so
        the first page samples the whole window at the density the overview
        draws, and the rest fill it in without a repeat or a gap.
        """
        if not 1 <= limit <= 200:
            raise CaseError("a timeline page holds between 1 and 200 items")
        selected = list(dict.fromkeys(categories or timeline_engine.DEFAULT_CATEGORIES))
        base_where, base_params = self._timeline_scope(
            categories=selected, entity_id=entity_id, track=track
        )
        dated = ["t.earliest IS NOT NULL"]
        dated_params: list[Any] = []
        if since:
            dated.append("t.latest > ?")
            dated_params.append(since)
        if until:
            dated.append("t.earliest < ?")
            dated_params.append(until)
        time_scope = "(" + " AND ".join(dated) + ")"
        if include_undated:
            time_scope = f"({time_scope} OR t.earliest IS NULL)"
        where = [*base_where, time_scope]
        params = [*base_params, *dated_params]

        parsed_cursor = None if spread else _parse_timeline_cursor(cursor)
        phase_cursor = _parse_timeline_phase(cursor) if spread else None
        group_sql = "CASE WHEN t.earliest IS NULL THEN 1 ELSE 0 END"
        stamp_sql = "COALESCE(t.earliest, '')"
        if parsed_cursor is not None:
            group, stamp, item_id = parsed_cursor
            where.append(
                f"({group_sql} > ? OR ({group_sql} = ? AND "
                f"({stamp_sql} > ? OR ({stamp_sql} = ? AND t.id > ?))))"
            )
            params.extend((group, group, stamp, stamp, item_id))

        clause = " WHERE " + " AND ".join(where)
        total_clause = " WHERE " + " AND ".join([*base_where, time_scope])
        total_params = [*base_params, *dated_params]
        with self._connect() as conn:
            extent_row = conn.execute(
                "SELECT MIN(t.earliest) AS first, MAX(t.latest) AS last"
                " FROM temporal_items t WHERE "
                + " AND ".join([*base_where, "t.earliest IS NOT NULL"]),
                base_params,
            ).fetchone()
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM temporal_items t{total_clause}",
                    total_params,
                ).fetchone()[0]
            )
            undated = int(
                conn.execute(
                    "SELECT COUNT(*) FROM temporal_items t WHERE "
                    + " AND ".join([*base_where, "t.raw IS NULL"]),
                    base_params,
                ).fetchone()[0]
            )
            unplaced = int(
                conn.execute(
                    "SELECT COUNT(*) FROM temporal_items t WHERE "
                    + " AND ".join(
                        [*base_where, "t.raw IS NOT NULL", "t.earliest IS NULL"]
                    ),
                    base_params,
                ).fetchone()[0]
            )
            # `stride` slices of the same ordering, one per page. A slice holds
            # ceil((total - phase) / stride) rows, which never exceeds the limit the
            # stride was derived from, so a spread page needs no overflow row to know
            # it is full — the phase says whether another slice is owed.
            stride, phase = phase_cursor or (
                max(1, -(-total // limit)) if spread else 1, 0
            )
            if stride > 1:
                rows = conn.execute(
                    "WITH ranked AS (SELECT t.id AS ranked_id,"
                    f" ROW_NUMBER() OVER (ORDER BY {group_sql}, {stamp_sql}, t.id) - 1 AS rn"
                    f" FROM temporal_items t{clause})"
                    " SELECT t.*, e.label, e.type AS owner_type FROM ranked"
                    " JOIN temporal_items t ON t.id = ranked.ranked_id"
                    " JOIN entities e ON e.id = t.owner_id"
                    " WHERE ranked.rn % ? = ? ORDER BY ranked.rn LIMIT ?",
                    (*params, stride, phase, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT t.*, e.label, e.type AS owner_type FROM temporal_items t"
                    " JOIN entities e ON e.id = t.owner_id"
                    f"{clause} ORDER BY {group_sql}, {stamp_sql}, t.id LIMIT ?",
                    (*params, limit + 1),
                ).fetchall()

            page_rows = rows[:limit]
            owner_ids = list(dict.fromkeys(str(row["owner_id"]) for row in page_rows))
            connectors: dict[str, dict[str, list[dict[str, str]]]] = {}
            if owner_ids:
                placeholders = ", ".join("?" for _ in owner_ids)
                for link in conn.execute(
                    "SELECT temporal_link.from_id, temporal_link.to_id,"
                    " temporal_link.type, target.label, target.type AS entity_type"
                    " FROM links temporal_link JOIN entities target"
                    " ON target.id = temporal_link.to_id"
                    f" WHERE temporal_link.from_id IN ({placeholders})"
                    " AND temporal_link.type IN ('about', 'at', 'cites')"
                    " ORDER BY temporal_link.rowid",
                    owner_ids,
                ).fetchall():
                    by_type = connectors.setdefault(link["from_id"], {})
                    by_type.setdefault(link["type"], []).append({
                        "id": link["to_id"],
                        "label": link["label"],
                        "type": link["entity_type"],
                    })

            buckets: list[dict[str, Any]] = []
            buckets_truncated = False
            if bucket is not None:
                # `hour` cuts on the "T" boundary of the stored instant, which is what
                # lets a window zoomed onto a single day still read as a histogram
                # rather than as one column.
                widths = {"year": 4, "month": 7, "day": 10, "hour": 13}
                if bucket not in widths:
                    raise CaseError("a timeline bucket must be year, month, day or hour")
                bucket_where = [*base_where, *dated]
                bucket_params = [*base_params, *dated_params]
                # A bucket also reports where its own entries actually sit. The period
                # it names is the coarse thing — six August rows all falling in the
                # first week are not "August" — and the overview draws each bar across
                # that inner span, so the bars and the visible-range brush answer the
                # same question on the same instants.
                bucket_rows = conn.execute(
                    "SELECT substr(t.earliest, 1, ?) AS start, t.category,"
                    " COUNT(*) AS count, MIN(t.earliest) AS first, MAX(t.latest) AS last"
                    " FROM temporal_items t WHERE "
                    + " AND ".join(bucket_where)
                    + " GROUP BY start, t.category ORDER BY start, t.category LIMIT 3001",
                    (widths[bucket], *bucket_params),
                ).fetchall()
                grouped: dict[str, dict[str, Any]] = {}
                for row in bucket_rows:
                    start = str(row["start"])
                    if start not in grouped and len(grouped) >= 1000:
                        buckets_truncated = True
                        break
                    target = grouped.setdefault(
                        start,
                        {"start": start, "count": 0, "categories": {}, "first": None, "last": None},
                    )
                    count = int(row["count"])
                    target["count"] += count
                    target["categories"][str(row["category"])] = count
                    first = row["first"]
                    last = row["last"]
                    if first is not None and (target["first"] is None or first < target["first"]):
                        target["first"] = first
                    # An open-ended row has no `latest`; the bar then reaches as far as
                    # what it is known to start at, never further.
                    reach = last if last is not None else first
                    if reach is not None and (target["last"] is None or reach > target["last"]):
                        target["last"] = reach
                buckets = list(grouped.values())

        next_cursor = None
        if spread:
            if phase + 1 < stride:
                next_cursor = _timeline_phase_cursor(stride, phase + 1)
        elif len(rows) > limit and page_rows:
            last = page_rows[-1]
            next_cursor = _timeline_cursor(
                1 if last["earliest"] is None else 0,
                str(last["earliest"] or ""),
                str(last["id"]),
            )
        return {
            "items": [self._timeline_item(row, connectors) for row in page_rows],
            "next_cursor": next_cursor,
            "total": total,
            "undated": undated,
            "unplaced": unplaced,
            "buckets": buckets,
            "buckets_truncated": buckets_truncated,
            "extent": {
                "from": extent_row["first"] if extent_row is not None else None,
                "to": extent_row["last"] if extent_row is not None else None,
            },
        }

    def rebuild_temporal_projection(self) -> int:
        """Explicitly recreate every derived temporal row in one transaction."""
        return self._write(_rebuild_temporal_projection_conn)

    def temporal_projection_status(self) -> dict[str, int | bool]:
        """Report whether every derived temporal row still matches its authority."""
        with self._connect() as conn:
            return _temporal_projection_status_conn(conn)

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
            _sync_entity_temporal(conn, entity)
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
            _sync_entity_temporal(conn, entity)
            self._touch(conn)
            return entity

        return self._write(op)

    def save_temporal_claim(
        self,
        *,
        entity_id: str | None,
        label: str,
        attrs: dict[str, Any],
        connectors: dict[str, list[str]] | None,
        by: str,
        status: EntityStatus = "confirmed",
    ) -> dict[str, Any]:
        """Create or replace a Claim and selected connectors atomically."""
        if connectors is not None:
            invalid = set(connectors) - set(link_engine.CLAIM_CONNECTION_TYPES)
            if invalid:
                raise CaseError(f"unknown Claim connector '{sorted(invalid)[0]}'")

        def op(conn: sqlite3.Connection) -> dict[str, Any]:
            claim_id = entity_id or _new_id("e")
            now = _now()
            existing = conn.execute(
                "SELECT * FROM entities WHERE id = ?", (claim_id,)
            ).fetchone()
            if entity_id is not None:
                if existing is None:
                    raise CaseError(f"entity '{claim_id}' not found")
                if existing["type"] != "claim":
                    raise CaseError(f"entity '{claim_id}' is not a Claim")
                conn.execute(
                    "UPDATE entities SET label = ?, attrs_json = ?, folder = ?,"
                    " search_text = ?, prov_status = ? WHERE id = ?",
                    (
                        label,
                        json.dumps(attrs, ensure_ascii=False),
                        _folder_of(attrs),
                        _entity_search_text("claim", label, attrs),
                        status,
                        claim_id,
                    ),
                )
                provenance = {
                    "by": existing["prov_by"],
                    "at": existing["prov_at"],
                    "status": status,
                }
                if existing["prov_source"] is not None:
                    provenance["source"] = existing["prov_source"]
            else:
                conn.execute(
                    "INSERT INTO entities"
                    "(id, type, label, attrs_json, folder, search_text,"
                    " prov_by, prov_at, prov_status, prov_source)"
                    " VALUES(?, 'claim', ?, ?, ?, ?, ?, ?, ?, NULL)",
                    (
                        claim_id,
                        label,
                        json.dumps(attrs, ensure_ascii=False),
                        _folder_of(attrs),
                        _entity_search_text("claim", label, attrs),
                        by,
                        now,
                        status,
                    ),
                )
                provenance = {"by": by, "at": now, "status": status}

            if connectors is not None:
                for type_, raw_targets in connectors.items():
                    targets = [
                        target
                        for target in dict.fromkeys(raw_targets)
                        if target != claim_id
                    ]
                    present: set[str] = set()
                    if targets:
                        placeholders = ", ".join("?" for _ in targets)
                        present = {
                            row["id"]
                            for row in conn.execute(
                                f"SELECT id FROM entities WHERE id IN ({placeholders})",
                                targets,
                            )
                        }
                    missing = [target for target in targets if target not in present]
                    if missing:
                        raise CaseError(f"entity '{missing[0]}' not found")
                    existing_links = {
                        row["to_id"]: row
                        for row in conn.execute(
                            "SELECT * FROM links WHERE from_id = ? AND type = ?",
                            (claim_id, type_),
                        ).fetchall()
                    }
                    wanted = set(targets)
                    stale = [
                        (row["id"],)
                        for target, row in existing_links.items()
                        if target not in wanted
                    ]
                    if stale:
                        conn.executemany("DELETE FROM links WHERE id = ?", stale)
                    for target in targets:
                        if target in existing_links:
                            continue
                        conn.execute(
                            "INSERT INTO links"
                            "(id, from_id, to_id, type, prov_by, prov_at,"
                            " prov_status, prov_source)"
                            " VALUES(?, ?, ?, ?, ?, ?, ?, NULL)",
                            (_new_id("l"), claim_id, target, type_, by, _now(), status),
                        )

            entity = {
                "id": claim_id,
                "type": "claim",
                "label": label,
                "attrs": attrs,
                "provenance": provenance,
            }
            _sync_entity_temporal(conn, entity)
            self._touch(conn)
            links = conn.execute(
                "SELECT * FROM links WHERE from_id = ?"
                " AND type IN ('about', 'at', 'cites') ORDER BY rowid",
                (claim_id,),
            ).fetchall()
            return {"entity": entity, "links": [self._link(row) for row in links]}

        return self._write(op)

    def remove_entity(self, entity_id: str) -> None:
        def op(conn: sqlite3.Connection) -> None:
            if conn.execute("SELECT 1 FROM entities WHERE id = ?", (entity_id,)).fetchone() is None:
                raise CaseError(f"entity '{entity_id}' not found")
            galleries = [
                row["entity_id"]
                for row in conn.execute(
                    "SELECT entity_id FROM entity_images"
                    " WHERE media_id = ? AND is_primary = 1",
                    (entity_id,),
                ).fetchall()
            ]
            # Drop directly incident edges first: foreign keys forbid dangling
            # links, and this is the repository-level cleanup, not the
            # dependency-aware deep delete (that lives in engine/links.py).
            conn.execute(
                "DELETE FROM links WHERE from_id = ? OR to_id = ?", (entity_id, entity_id)
            )
            conn.execute("DELETE FROM entities WHERE id = ?", (entity_id,))
            for gallery_id in galleries:
                self._ensure_entity_image_primary(conn, gallery_id)
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

    def update_link(self, link_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        """Update a link's status or type without rebuilding the edge.

        Restating the type keeps the edge's id and provenance: the two entities
        were always related, only the reading was wrong. Which types may be
        restated is the vocabulary's call (``engine/links.py``), not the store's.
        """

        def op(conn: sqlite3.Connection) -> dict[str, Any]:
            row = conn.execute("SELECT * FROM links WHERE id = ?", (link_id,)).fetchone()
            if row is None:
                raise CaseError(f"link '{link_id}' not found")
            status = patch.get("status")
            if status not in ("confirmed", "suggested"):
                status = row["prov_status"]
            type_ = patch.get("type") or row["type"]
            # Membership, not truthiness: `None` clears the rating back to "not
            # assessed", and `-1` (refuted) is a value like any other. Which
            # ordinals are legal, and which edges may carry one at all, is the
            # vocabulary's call in `engine/links.py`.
            confidence = patch["confidence"] if "confidence" in patch else row["confidence"]
            # Membership again: `None` clears the qualifier, an absent key leaves it.
            nature = patch["nature"] if "nature" in patch else row["nature"]
            conn.execute(
                "UPDATE links SET prov_status = ?, type = ?, confidence = ?, nature = ?"
                " WHERE id = ?",
                (status, type_, confidence, nature, link_id),
            )
            self._touch(conn)
            updated = conn.execute("SELECT * FROM links WHERE id = ?", (link_id,)).fetchone()
            assert updated is not None
            return self._link(updated)

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

    # -- trash journal -----------------------------------------------------
    #
    # The live graph keeps hard-deleting: a deleted entity is gone from
    # `entities`, so no query anywhere needs a "not deleted" filter. What is kept
    # is the recipe to put it back, in one row per delete action.

    @staticmethod
    def _trash(row: sqlite3.Row, *, payload: bool = False) -> dict[str, Any]:
        group = {
            "id": row["id"],
            "deleted_at": row["deleted_at"],
            "label": row["label"],
            "type": row["type"],
            "item_count": row["item_count"],
            "size_bytes": row["size_bytes"],
        }
        if payload:
            group["state"] = row["state"]
            group["payload"] = json.loads(row["payload_json"])
        return group

    def add_trash_group(
        self,
        group_id: str,
        *,
        label: str,
        type_: str,
        item_count: int,
        size_bytes: int,
        payload: dict[str, Any],
        state: str = "ready",
    ) -> dict[str, Any]:
        """Record one delete action before its filesystem move begins."""
        now = _now()

        def op(conn: sqlite3.Connection) -> dict[str, Any]:
            conn.execute(
                "INSERT INTO trash"
                "(id, deleted_at, label, type, item_count, size_bytes, state, payload_json)"
                " VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    group_id, now, label, type_, item_count, size_bytes,
                    state,
                    json.dumps(payload, ensure_ascii=False),
                ),
            )
            self._touch(conn)
            row = conn.execute("SELECT * FROM trash WHERE id = ?", (group_id,)).fetchone()
            return self._trash(row, payload=True)

        return self._write(op)

    def update_trash_group(
        self,
        group_id: str,
        *,
        state: str | None = None,
        size_bytes: int | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        def op(conn: sqlite3.Connection) -> dict[str, Any]:
            row = conn.execute("SELECT * FROM trash WHERE id = ?", (group_id,)).fetchone()
            if row is None:
                raise CaseError(f"trash group '{group_id}' not found")
            conn.execute(
                "UPDATE trash SET state = ?, size_bytes = ?, payload_json = ? WHERE id = ?",
                (
                    state if state is not None else row["state"],
                    size_bytes if size_bytes is not None else row["size_bytes"],
                    json.dumps(payload, ensure_ascii=False)
                    if payload is not None
                    else row["payload_json"],
                    group_id,
                ),
            )
            self._touch(conn)
            updated = conn.execute("SELECT * FROM trash WHERE id = ?", (group_id,)).fetchone()
            return self._trash(updated, payload=True)

        return self._write(op)

    def list_trash(self) -> list[dict[str, Any]]:
        """Every group, newest first, without its payload — the sidebar node
        reads this and stays within the bounded-loading rule."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, deleted_at, label, type, item_count, size_bytes"
                ", state FROM trash WHERE state = 'ready'"
                " ORDER BY deleted_at DESC, rowid DESC"
            ).fetchall()
        return [self._trash(r) for r in rows]

    def list_incomplete_trash(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM trash WHERE state != 'ready' ORDER BY deleted_at, rowid"
            ).fetchall()
        return [self._trash(row, payload=True) for row in rows]

    def get_trash_group(self, group_id: str) -> dict[str, Any] | None:
        """One group with its payload — read only when restoring or purging."""
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM trash WHERE id = ?", (group_id,)).fetchone()
        return self._trash(row, payload=True) if row is not None else None

    def remove_trash_group(self, group_id: str) -> None:
        def op(conn: sqlite3.Connection) -> None:
            cur = conn.execute("DELETE FROM trash WHERE id = ?", (group_id,))
            if cur.rowcount == 0:
                raise CaseError(f"trash group '{group_id}' not found")
            self._touch(conn)

        self._write(op)

    def clear_trash(self) -> list[str]:
        """Drop every group, returning the ids so the caller can remove their
        directories."""

        def op(conn: sqlite3.Connection) -> list[str]:
            ids = [
                r["id"]
                for r in conn.execute("SELECT id FROM trash WHERE state = 'ready'")
            ]
            if ids:
                conn.execute("DELETE FROM trash WHERE state = 'ready'")
                self._touch(conn)
            return ids

        return self._write(op)

    def trash_summary(self) -> dict[str, int]:
        """Groups, items and bytes held — what the node shows, in one query."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS groups, COALESCE(SUM(item_count), 0) AS items,"
                " COALESCE(SUM(size_bytes), 0) AS size"
                " FROM trash WHERE state = 'ready'"
            ).fetchone()
        return {
            "groups": int(row["groups"]),
            "items": int(row["items"]),
            "size_bytes": int(row["size"]),
        }

    def reinsert(
        self, entities: list[dict[str, Any]], links: list[dict[str, Any]]
    ) -> dict[str, int]:
        """Put deleted rows back with their original ids, in one transaction.

        The ids were freed by the delete, so they are taken again rather than
        minted — every path, spec and draft recorded elsewhere still points at
        them. A link is re-inserted only when both endpoints exist: foreign keys
        forbid the rest, and an endpoint deleted separately is a real loss, so it
        is counted and reported instead of hidden.
        """

        def op(conn: sqlite3.Connection) -> dict[str, int]:
            for entity in entities:
                attrs = entity.get("attrs") or {}
                prov = entity.get("provenance") or {}
                conn.execute(
                    "INSERT OR REPLACE INTO entities"
                    "(id, type, label, attrs_json, folder, search_text,"
                    " prov_by, prov_at, prov_status, prov_source)"
                    " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        entity["id"],
                        entity["type"],
                        entity["label"],
                        json.dumps(attrs, ensure_ascii=False),
                        _folder_of(attrs),
                        _entity_search_text(entity["type"], entity["label"], attrs),
                        prov.get("by", "user"),
                        prov.get("at", _now()),
                        prov.get("status", "confirmed"),
                        prov.get("source"),
                    ),
                )
                _sync_entity_temporal(conn, entity)
            present = {
                r["id"]
                for r in conn.execute("SELECT id FROM entities")
            }
            kept = 0
            for link in links:
                if link["from"] not in present or link["to"] not in present:
                    continue
                prov = link.get("provenance") or {}
                conn.execute(
                    "INSERT OR REPLACE INTO links"
                    "(id, from_id, to_id, type, prov_by, prov_at, prov_status,"
                    " prov_source, confidence, nature)"
                    " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        link["id"], link["from"], link["to"], link["type"],
                        prov.get("by", "user"), prov.get("at", _now()),
                        prov.get("status", "confirmed"), prov.get("source"),
                        # restoring an eliminated candidate must bring back the
                        # elimination: "I ruled these eleven out" is the finding
                        link.get("confidence"),
                        # and the qualifier with it: "brother of" is the analyst's
                        # own reading of the tie, not a decoration on the verb
                        link.get("nature"),
                    ),
                )
                kept += 1
            self._touch(conn)
            return {
                "entities": len(entities),
                "links": kept,
                "links_lost": len(links) - kept,
            }

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

    def count_jobs(self, *, kind: str | None = None) -> dict[str, int]:
        """Per-state job counts — the queue's badge without listing every row."""
        with self._connect() as conn:
            if kind is None:
                rows = conn.execute(
                    "SELECT state, COUNT(*) AS n FROM jobs GROUP BY state"
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT state, COUNT(*) AS n FROM jobs"
                    " WHERE kind = ? GROUP BY state",
                    (kind,),
                ).fetchall()
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

    def replace_path_references(self, old: str, new: str) -> None:
        """Rewrite an exact case-relative path in graph attrs and durable jobs.

        One SQLite transaction keeps structured references coherent. File specs
        and sidecars live outside the database and are handled by the artifact
        rename journal that calls this method.
        """
        def op(conn: sqlite3.Connection) -> None:
            for row in conn.execute(
                "SELECT id, type, label, attrs_json FROM entities"
            ).fetchall():
                attrs = json.loads(row["attrs_json"])
                replaced = _replace_exact(attrs, old, new)
                if replaced == attrs:
                    continue
                conn.execute(
                    "UPDATE entities SET attrs_json = ?, folder = ?, search_text = ?"
                    " WHERE id = ?",
                    (
                        json.dumps(replaced, ensure_ascii=False),
                        _folder_of(replaced),
                        _entity_search_text(row["type"], row["label"], replaced),
                        row["id"],
                    ),
                )

            for row in conn.execute(
                "SELECT id, job_key, payload_json FROM jobs"
            ).fetchall():
                payload = json.loads(row["payload_json"])
                replaced = _replace_exact(payload, old, new)
                key = new if row["job_key"] == old else row["job_key"]
                if key == row["job_key"] and replaced == payload:
                    continue
                conn.execute(
                    "UPDATE jobs SET job_key = ?, payload_json = ?, updated_at = ?"
                    " WHERE id = ?",
                    (
                        key,
                        json.dumps(replaced, ensure_ascii=False),
                        _now(),
                        row["id"],
                    ),
                )
            self._touch(conn)

        self._write(op)


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
        _sync_entity_temporal(conn, entity)
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
