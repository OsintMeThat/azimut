"""Case workspace: create/list/open cases, scratch cases, entities and links.

A case is a plain directory (spec §4):

    <case>/
    ├── case.json      # metadata + entities + links
    ├── notes.md       # free-form case notes
    ├── media/         # imported/downloaded media + satellite crops + sidecars
    ├── proofs/        # composed proofs (PNG + editable JSON spec)
    └── exports/       # post drafts, reports

One-shot mode uses a *scratch* case under ``scratch/`` — same layout, same code
path — which can be promoted (moved) into ``cases/`` at any time (spec §3.3).
"""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from . import config
from .repository import EntityStatus

if TYPE_CHECKING:
    from .repository import CaseRepository
    from .sqlite_backend import SqliteCase

CASE_SUBDIRS = ("media", "notes", "proofs", "exports", "inspect", "search")

# On-disk schema. A newer Azimut opens an older case by running the migrations
# below up to the current number on first open; a case written by a *newer*
# Azimut (higher schema) is refused rather than mangled (spec §7, forward
# compatibility). Bump CASE_SCHEMA in the same change that adds a migration.
#
# The graph lived inside case.json through schema 2 ("json" storage). Schema 3
# moves it into a per-case SQLite `case.db` ("sqlite" storage) and shrinks
# case.json to a manifest. JSON_SCHEMA is the last json-storage schema: migrate()
# runs the json-shape migrations up to it, then activates SQLite to reach
# CASE_SCHEMA. An older Azimut that predates schema 3 sees a higher number and
# refuses, the same guarantee the schema check has always given.
JSON_SCHEMA = 2
CASE_SCHEMA = 3

# from_version -> function(data) returning data reshaped for from_version + 1.
# The runner (Case.migrate) owns stamping the new schema number, so a migration
# only rewrites fields. These cover json-shape upgrades within case.json (up to
# JSON_SCHEMA); the storage activation to schema 3 is not a field reshape and is
# handled specially by migrate() via _activate_sqlite, not through this table.
CASE_MIGRATIONS: dict[int, Callable[[dict[str, Any]], dict[str, Any]]] = {
    1: lambda data: data,
}


def _case_schema(data: dict[str, Any]) -> int:
    """The schema a loaded case.json declares. Legacy/untagged files predate the
    tag and are treated as the first schema."""
    meta = data.get("azimut")
    if isinstance(meta, dict) and isinstance(meta.get("schema"), int):
        return meta["schema"]
    return 1

# Empty scratch sessions older than this are reaped at startup (spec §9).
SCRATCH_MAX_AGE_DAYS = 14

# One lock per case directory, shared across every Case instance that points
# at it (a fresh instance is constructed per request). Without it, concurrent
# read-modify-write of case.json — e.g. several media downloads from the
# multi-item picker finishing at once — silently drop each other's entity or
# crash on the tmp-file rename (spec §6 honest output requires none lost).
#
# Reentrant on purpose: every read() and every write goes through it, and a
# mutator (add_entity, …) reads *inside* its own locked section, so the same
# thread has to be able to re-take the lock it already holds. It also serialises
# reads against writes — required on Windows, where os.replace() cannot rename
# over a case.json another thread still has open, and open() cannot read one
# mid-replace (both surface as PermissionError; POSIX has neither problem).
_case_locks_guard = threading.Lock()
_case_locks: dict[str, threading.RLock] = {}


def _case_lock(path: Path) -> threading.RLock:
    key = str(path)
    with _case_locks_guard:
        lock = _case_locks.get(key)
        if lock is None:
            lock = threading.RLock()
            _case_locks[key] = lock
        return lock

# Extensible vocabulary (spec §5); free strings are accepted, these are the
# well-known ones the UI knows how to render.
ENTITY_TYPES = (
    "person", "organization", "alias", "account", "email", "phone", "domain",
    "ip", "vehicle", "place", "capture", "event", "media", "proof", "note",
    "bookmark",
)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "case"


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def ensure_dir(path: Path) -> Path:
    """``path.mkdir(parents=True, exist_ok=True)``, tolerant of a transient
    ``PermissionError`` Windows can raise when several threads race to create
    the very same directory for the first time (e.g. several concurrent
    downloads all hitting a case's not-yet-created ``media/.dl`` or
    ``media/.thumbs`` at once): CreateDirectory there occasionally answers
    "access is denied" instead of "already exists" mid-race, which
    ``exist_ok=True`` alone does not catch. Retried briefly — the directory
    reliably exists by the next attempt, whoever won the race.
    """
    for attempt in range(20):
        try:
            path.mkdir(parents=True, exist_ok=True)
            return path
        except PermissionError:
            if path.is_dir():
                return path
            if attempt == 19:
                raise
            time.sleep(0.01)
    return path  # pragma: no cover - loop always returns or raises above


def _replace_with_retry(src: Path, dst: Path) -> None:
    """``src.replace(dst)`` with a brief retry for a transient Windows
    ``PermissionError``. The case lock already keeps our own threads off the
    destination during a rename, but on Windows an external handle (a virus
    scanner or the search indexer opening the freshly written file) can still
    make os.replace() fail for a few milliseconds. POSIX rename is atomic and
    never hits this, so the loop is a no-op there.
    """
    for attempt in range(20):
        try:
            src.replace(dst)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.01)


class CaseError(Exception):
    """Raised for invalid case operations; maps to HTTP 4xx in the API layer."""


_UNSET: Any = object()


def _parse_cursor(cursor: str | None) -> int:
    """Parse an opaque pagination cursor to its integer key (0 when absent).

    The cursor is the SQLite backend's ``rowid`` keyset token, round-tripped
    through the API as a string. A malformed one is a client error, surfaced as
    `CaseError` (HTTP 400)."""
    if cursor is None:
        return 0
    try:
        return int(cursor)
    except (TypeError, ValueError):
        raise CaseError(f"invalid cursor '{cursor}'") from None


class Case:
    """Handle over one case directory.

    The filesystem shell (manifest, notes, media, lifecycle, path resolution)
    lives here. Graph operations — entities, links, folders — are the
    `CaseRepository` contract, delegated to a `SqliteCase` over `case.db`. A
    legacy json case (schema ≤ `JSON_SCHEMA`) is converted to sqlite on open
    (`migrate`), so every live handle is sqlite-backed.
    """

    def __init__(self, path: Path):
        self.path = path
        self._lock = _case_lock(path)
        # Resolved lazily from the manifest on first graph access, then cached.
        self._sqlite_cache: Any = _UNSET

    @property
    def _sqlite(self) -> "SqliteCase | None":
        """The SQLite graph backend if this case is on the sqlite storage
        format, else None (a legacy json case handled in-file).

        The manifest's ``azimut.storage`` field is the discriminator — not the
        presence of ``case.db`` — so a crash mid-migration (db written, manifest
        not yet flipped) still opens as json and the orphan db is rebuilt.
        """
        if self._sqlite_cache is _UNSET:
            self._sqlite_cache = self._resolve_sqlite()
        return self._sqlite_cache

    def _resolve_sqlite(self) -> "SqliteCase | None":
        from .sqlite_backend import SqliteCase

        try:
            meta = json.loads(self.json_path.read_text(encoding="utf-8")).get("azimut", {})
        except (OSError, json.JSONDecodeError):
            return None
        if isinstance(meta, dict) and meta.get("storage") == "sqlite":
            # `.open` (not the bare constructor) so an older `case.db` schema is
            # upgraded in place on first access — the storage-format equivalent
            # of `Case.migrate` for the manifest.
            return SqliteCase.open(self.path / "case.db")
        return None

    # -- identity ---------------------------------------------------------

    @property
    def id(self) -> str:
        return self.path.name

    @property
    def is_scratch(self) -> bool:
        return self.path.parent == config.scratch_dir()

    # -- creation / loading ------------------------------------------------

    @classmethod
    def create(cls, name: str, *, scratch: bool = False) -> "Case":
        """Create a new case. Every case is born on the SQLite backend; a legacy
        json case only ever arrives from disk and is converted on open."""
        from .sqlite_backend import SqliteCase

        parent = config.scratch_dir() if scratch else config.cases_dir()
        parent.mkdir(parents=True, exist_ok=True)
        slug = _new_id("scratch") if scratch else _slugify(name)
        path = parent / slug
        if path.exists():
            raise CaseError(f"case '{slug}' already exists")
        path.mkdir()
        for sub in CASE_SUBDIRS:
            (path / sub).mkdir()
        case = cls(path)
        case._sqlite_cache = SqliteCase.create(path / "case.db", name=name)
        case._write_json(
            {
                "azimut": {"schema": CASE_SCHEMA, "storage": "sqlite"},
                "name": name,
                "created_at": _now(),
                "updated_at": _now(),
            }
        )
        (path / "notes.md").write_text(f"# {name}\n\n", encoding="utf-8")
        return case

    @classmethod
    def open(cls, case_id: str) -> "Case":
        for parent in (config.cases_dir(), config.scratch_dir()):
            path = parent / case_id
            if (path / "case.json").exists():
                case = cls(path)
                case.migrate()
                return case
        raise CaseError(f"case '{case_id}' not found")

    def migrate(self) -> dict[str, Any]:
        """Bring case.json up to ``CASE_SCHEMA`` on open, and return the data.

        A case written by the same schema is returned untouched (the common
        path, so today this never rewrites anything). An older one is upgraded
        in order, backing the file up once before the first rewrite so a bad
        migration is recoverable. A *newer* one is refused: an old Azimut must
        not silently drop fields it was never taught, so the user is told to
        update instead (spec §7).
        """
        with self._lock:
            data = self.read()
            version = _case_schema(data)
            if version == CASE_SCHEMA:
                return data
            if version > CASE_SCHEMA:
                raise CaseError(
                    f"case '{self.id}' was made with a newer Azimut "
                    f"(schema {version} > {CASE_SCHEMA}); update Azimut to open it"
                )
            storage = data.get("azimut", {}).get("storage")
            self._backup(f"pre-migrate-v{version}")
            # 1) json-shape migrations, up to the last json-storage schema.
            for step in range(version, min(CASE_SCHEMA, JSON_SCHEMA)):
                migrate = CASE_MIGRATIONS.get(step)
                if migrate is None:
                    raise CaseError(f"no migration for case schema {step}")
                data = migrate(data)
                data.setdefault("azimut", {})["schema"] = step + 1
            self._materialize_note_content(data)
            self._write_json(data)
            # 2) storage activation: json graph -> sqlite (case.db), manifest last.
            if CASE_SCHEMA > JSON_SCHEMA and storage != "sqlite":
                self._activate_sqlite(self.read())
                return self.snapshot()
            return data

    def _activate_sqlite(self, data: dict[str, Any]) -> None:
        """Convert a note-materialized json case (schema JSON_SCHEMA) into the
        sqlite format: build case.db, then flip case.json to the small manifest.

        The conversion is atomic and the manifest changes last, so a crash
        before the flip leaves the legacy json case active (the pre-migrate
        backup is already taken by the caller). Media, proofs and note files are
        untouched.
        """
        from .sqlite_backend import convert_json_to_sqlite

        convert_json_to_sqlite(data, self.path / "case.db")
        self._write_json(
            {
                "azimut": {"schema": CASE_SCHEMA, "storage": "sqlite"},
                "name": data.get("name", self.id),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at") or _now(),
            }
        )
        self._sqlite_cache = _UNSET  # re-resolve against the new manifest

    def _backup(self, tag: str) -> None:
        """Copy case.json aside once, under a ``tag``. Never overwrites an
        existing backup — a re-run of the same migration keeps the first copy."""
        dst = self.json_path.with_name(f"case.{tag}.json")
        if not dst.exists():
            shutil.copy2(self.json_path, dst)

    @classmethod
    def cleanup_scratch(cls, max_age_days: int = SCRATCH_MAX_AGE_DAYS) -> int:
        """Delete scratch cases that hold nothing and haven't been touched in
        ``max_age_days``. Returns how many were removed.

        "Nothing" means no entities, no links and no files under the case
        subdirs — a scratch with any content is never touched (promote or
        delete it deliberately). Closes the spec §9 question: one-shot
        sessions and unpicked extension captures stop accumulating forever.
        """
        parent = config.scratch_dir()
        if not parent.is_dir():
            return 0
        cutoff = datetime.now(timezone.utc).timestamp() - max_age_days * 86400
        removed = 0
        for path in list(parent.iterdir()):
            if not (path / "case.json").exists():
                continue
            case = cls(path)
            try:
                data = case.read()
                has_graph = bool(case.list_entities() or case.list_links())
            except (OSError, json.JSONDecodeError, sqlite3.Error):
                continue
            if has_graph:
                continue
            stamp = data.get("updated_at") or data.get("created_at") or ""
            try:
                when = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ")
            except ValueError:
                continue
            if when.replace(tzinfo=timezone.utc).timestamp() > cutoff:
                continue
            if any(
                p.is_file()
                for sub in CASE_SUBDIRS
                if (path / sub).is_dir()
                for p in (path / sub).rglob("*")
            ):
                continue
            try:
                case.delete()
                removed += 1
            except OSError:
                continue  # a file may be open elsewhere (Windows) — next start
        return removed

    @classmethod
    def list_all(cls) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for parent, scratch in ((config.cases_dir(), False), (config.scratch_dir(), True)):
            if not parent.is_dir():
                continue
            for path in sorted(parent.iterdir()):
                if not (path / "case.json").exists():
                    continue
                case = cls(path)
                data = case.read()
                updated_at = data.get("updated_at")
                if case._sqlite is not None:
                    updated_at = case._sqlite.updated_at() or updated_at
                out.append(
                    {
                        "id": case.id,
                        "name": data.get("name", case.id),
                        "scratch": scratch,
                        "created_at": data.get("created_at"),
                        "updated_at": updated_at,
                        "entity_count": case.entity_count(),
                    }
                )
        out.sort(key=lambda c: c.get("updated_at") or "", reverse=True)
        return out

    # -- json io -----------------------------------------------------------

    @property
    def json_path(self) -> Path:
        return self.path / "case.json"

    def read(self) -> dict[str, Any]:
        # Under the lock so a concurrent write can't be replacing case.json
        # while we open it — on Windows that open() raises PermissionError
        # (the file is momentarily unopenable mid-rename).
        with self._lock:
            return json.loads(self.json_path.read_text(encoding="utf-8"))

    def _write_json(self, data: dict[str, Any]) -> None:
        # Under the lock so no reader has case.json open when we rename over it:
        # Windows' os.replace() refuses a destination another handle holds open
        # ("Access is denied"). A unique tmp name keeps two writers' scratch
        # files apart even though the lock already serialises them.
        with self._lock:
            data["updated_at"] = _now()
            tmp = self.json_path.with_suffix(f".{uuid.uuid4().hex}.tmp")
            tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            _replace_with_retry(tmp, self.json_path)

    # -- graph reads (CaseRepository boundary) ------------------------------
    #
    # The one way engine and API code reads the graph: no caller reaches into
    # the raw case.json shape any more, so the SQLite backend (Step 2) can
    # answer these without materialising the whole file. `read()` above stays
    # the JSON implementation detail, used internally and by storage tests.

    def _graph(self) -> "SqliteCase":
        """The SQLite graph backend. Every opened case is on the sqlite storage
        format — a legacy json case is converted on open (`migrate`) — so this is
        always set for a live handle; it raises only if a graph op is attempted on
        an unmigrated case, which `open`/`create` never hand out."""
        backend = self._sqlite
        if backend is None:
            raise CaseError(f"case '{self.id}' has no sqlite graph (unmigrated)")
        return backend

    def snapshot(self) -> dict[str, Any]:
        """Full case view (manifest + graph) in one consistent read: the small
        manifest joined to the graph assembled from `case.db`."""
        manifest = self.read()
        graph = self._graph().snapshot()
        return {
            **manifest,  # manifest owns name, created_at and the storage/schema tag
            # ...but the db tracks last-activity, bumped by every graph mutation.
            "updated_at": graph.get("updated_at") or manifest.get("updated_at"),
            "folders": graph["folders"],
            "entities": graph["entities"],
            "links": graph["links"],
        }

    def overview(self) -> dict[str, Any]:
        """The case-open view without the graph arrays (Step 5).

        Returns the manifest and the folder list — everything the shell needs to
        open a case — but not the ``entities``/``links`` arrays, which load through
        the bounded catalog endpoints. ``snapshot()`` still returns the full graph
        for internal callers (delete planning, export, migration checks).
        """
        return {**self.read(), "folders": self._graph().list_folders()}

    def list_entities(self) -> list[dict[str, Any]]:
        return self._graph().list_entities()

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
        """A bounded, filtered page of the catalog (Step 5), paged with an indexed
        rowid keyset."""
        return self._graph().page_entities(
            limit=limit, cursor=cursor, types=types, status=status,
            query=query, folder=folder, unfiled=unfiled,
        )

    def catalog_summary(self) -> dict[str, Any]:
        """Total plus per-type, per-status and per-folder counts."""
        return self._graph().catalog_summary()

    def list_links(self) -> list[dict[str, Any]]:
        return self._graph().list_links()

    def links_of(self, entity_id: str) -> list[dict[str, Any]]:
        return self._graph().links_of(entity_id)

    def get_entity(self, entity_id: str) -> dict[str, Any] | None:
        return self._graph().get_entity(entity_id)

    def entity_count(self) -> int:
        """Entity total for the case switcher — one indexed count."""
        return self._graph().count_entities()

    # -- notes -------------------------------------------------------------

    @property
    def notes_path(self) -> Path:
        return self.path / "notes.md"

    def read_notes(self) -> str:
        try:
            return self.notes_path.read_text(encoding="utf-8")
        except OSError:
            return ""

    def write_notes(self, text: str) -> None:
        self.notes_path.write_text(text, encoding="utf-8")

    @property
    def note_dir(self) -> Path:
        return self.path / "notes"

    def _note_entity(self, entity_id: str) -> dict[str, Any]:
        entity = self.get_entity(entity_id)
        if entity is None or entity.get("type") != "note":
            raise CaseError(f"note '{entity_id}' not found")
        return entity

    def _note_path(self, entity: dict[str, Any]) -> Path:
        path = entity.get("attrs", {}).get("path")
        if not isinstance(path, str):
            raise CaseError(f"note '{entity['id']}' has no file")
        return self.resolve_inside(path)

    def _materialize_note_content(self, data: dict[str, Any]) -> None:
        """Move legacy note bodies out of case.json before writing a migration."""
        for entity in data.get("entities", []):
            if entity.get("type") != "note":
                continue
            attrs = entity.setdefault("attrs", {})
            content = attrs.pop("content", None)
            path = attrs.setdefault("path", f"notes/{entity['id']}.md")
            note_path = self.resolve_inside(path)
            if content is not None or not note_path.exists():
                note_path.parent.mkdir(parents=True, exist_ok=True)
                note_path.write_text(str(content or ""), encoding="utf-8")

    def create_note(
        self,
        label: str,
        folder: str,
        content: str = "",
        *,
        by: str = "user",
        status: EntityStatus = "confirmed",
        source: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            # The graph row goes to case.db; the body stays a file on the shell.
            # Add the row to mint an id, write notes/<id>.md, then record its
            # relative path on the row.
            graph = self._graph()
            entity = graph.add_entity(
                "note", label, {"folder": folder}, by=by, status=status, source=source
            )
            rel = f"notes/{entity['id']}.md"
            note_path = self.resolve_inside(rel)
            note_path.parent.mkdir(parents=True, exist_ok=True)
            note_path.write_text(content, encoding="utf-8")
            return graph.update_entity(entity["id"], {"attrs": {"path": rel}})

    def read_note(self, entity_id: str) -> str:
        entity = self._note_entity(entity_id)
        try:
            return self._note_path(entity).read_text(encoding="utf-8")
        except OSError:
            return ""

    def write_note(self, entity_id: str, text: str) -> None:
        entity = self._note_entity(entity_id)
        path = self._note_path(entity)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    # -- lifecycle -----------------------------------------------------------

    def rename(self, name: str) -> None:
        with self._lock:
            data = self.read()
            data["name"] = name
            self._write_json(data)

    def promote(self, name: str) -> "Case":
        """Move a scratch case into cases/ under a proper name (spec §3.3)."""
        if not self.is_scratch:
            raise CaseError("only scratch cases can be promoted")
        slug = _slugify(name)
        dest = config.cases_dir() / slug
        if dest.exists():
            raise CaseError(f"case '{slug}' already exists")
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(self.path), str(dest))
        promoted = Case(dest)
        promoted.rename(name)
        return promoted

    def delete(self) -> None:
        shutil.rmtree(self.path)

    # -- entities & links (spec §5) -----------------------------------------

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
        if type_ == "note":
            note_attrs = attrs or {}
            return self.create_note(
                label,
                str(note_attrs.get("folder", "")),
                str(note_attrs.get("content", "")),
                by=by,
                status=status,
                source=source,
            )
        return self._graph().add_entity(type_, label, attrs, by=by, status=status, source=source)

    def update_entity(self, entity_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        return self._graph().update_entity(entity_id, patch)

    def remove_entity(self, entity_id: str) -> None:
        self._graph().remove_entity(entity_id)

    def find_entity(self, *, attr: str, value: Any) -> dict[str, Any] | None:
        return self._graph().find_entity(attr=attr, value=value)

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
        """Add a typed edge. ``unique`` returns the existing identical edge
        instead of stacking a duplicate — what a producer wants when its output
        can dedupe onto an entity that is already in the case."""
        return self._graph().add_link(from_id, to_id, type_, by=by, status=status, unique=unique)

    def sync_links(
        self,
        from_id: str,
        type_: str,
        to_ids: list[str],
        *,
        by: str,
        status: EntityStatus = "confirmed",
    ) -> list[dict[str, Any]]:
        """Make ``from_id``'s outgoing links of ``type_`` exactly ``to_ids``.

        Re-saving an artifact restates its sources rather than piling onto them:
        edges that are still true are left untouched (same id, same timestamp),
        edges that are no longer true are dropped, new ones are appended. Unknown
        targets and a self-reference are ignored.
        """
        return self._graph().sync_links(from_id, type_, to_ids, by=by, status=status)

    def remove_link(self, link_id: str) -> None:
        self._graph().remove_link(link_id)

    # -- folders (nested organisational buckets for entities) ----------------
    #
    # Folders form a tree encoded as ``/``-separated paths, e.g.
    # ``Sources/Telegram``. An entity's ``attrs.folder`` holds the full path of
    # the node it is filed under. The stored list always contains every
    # ancestor of every leaf, so the tree is well-formed on its own.

    @staticmethod
    def _normalize_folder(name: str) -> str:
        parts = [p.strip() for p in str(name).split("/")]
        parts = [p for p in parts if p]
        if not parts:
            raise CaseError("folder name is required")
        return "/".join(parts)

    def list_folders(self) -> list[str]:
        return self._graph().list_folders()

    def add_folder(self, name: str) -> list[str]:
        return self._graph().add_folder(name)

    def remove_folder(self, name: str) -> list[str]:
        return self._graph().remove_folder(name)

    # -- durable jobs (thumbnail and background-job model) -------------------

    def enqueue_job(
        self,
        kind: str,
        *,
        key: str | None = None,
        payload: dict[str, Any] | None = None,
        max_attempts: int = 3,
    ) -> dict[str, Any]:
        return self._graph().enqueue_job(
            kind, key=key, payload=payload, max_attempts=max_attempts
        )

    def claim_job(self, *, kinds: list[str] | None = None) -> dict[str, Any] | None:
        return self._graph().claim_job(kinds=kinds)

    def complete_job(self, job_id: str) -> None:
        self._graph().complete_job(job_id)

    def fail_job(self, job_id: str, error: str) -> dict[str, Any]:
        return self._graph().fail_job(job_id, error)

    def cancel_job(self, job_id: str) -> None:
        self._graph().cancel_job(job_id)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        return self._graph().get_job(job_id)

    def list_jobs(
        self, *, kind: str | None = None, state: str | None = None
    ) -> list[dict[str, Any]]:
        return self._graph().list_jobs(kind=kind, state=state)

    def count_jobs(self) -> dict[str, int]:
        return self._graph().count_jobs()

    def recover_jobs(self) -> int:
        return self._graph().recover_jobs()

    def prune_jobs(self, *, kind: str | None = None) -> int:
        return self._graph().prune_jobs(kind=kind)

    # -- helpers -------------------------------------------------------------

    def subdir(self, name: str) -> Path:
        if name not in CASE_SUBDIRS:
            raise CaseError(f"unknown case subdir '{name}'")
        return ensure_dir(self.path / name)

    def resolve_inside(self, relative: str) -> Path:
        """Resolve a case-relative path, refusing traversal outside the case."""
        candidate = (self.path / relative).resolve()
        if not candidate.is_relative_to(self.path.resolve()):
            raise CaseError("path escapes the case directory")
        return candidate


if TYPE_CHECKING:
    # `Case` conforms to `CaseRepository` (it delegates the graph to `SqliteCase`).
    # This fails type-check if a graph method ever drifts from the boundary
    # contract (a missing method, a changed signature).
    def _case_conforms(case: Case) -> "CaseRepository":
        return case
