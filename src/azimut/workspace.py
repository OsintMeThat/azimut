"""Create, list and open case and scratch workspaces.

A case is a plain directory (spec §4). What sits inside it is `layout.py`'s
answer, not this module's: `Case` owns creation, locking and traversal guards,
and asks `layout` where each file goes.

One-shot mode uses the same layout under ``.azimut/scratch/`` and can be
promoted into a permanent case at the workspace root (spec §3.3).
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from . import config, layout
from .caselayout import (
    _follow_hidden_dirs,
    _normalize_case_layout,
    _prune_empty_note_dirs,
    _wrap_case_folder,
    ensure_dir,
    write_readme,
)
from .casestore import CaseStore
from .layout import MAX_CASE_SLUG
from .repository import EntityStatus

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from .repository import CaseRepository
    from .sqlite_backend import SqliteCase

# On-disk schema. Older cases migrate on open; newer schemas are refused.
# Bump CASE_SCHEMA with every migration.
#
# A case migrates in three passes, because the three kinds of change need
# different tools:
#
#   1..JSON_SCHEMA   field reshapes inside case.json          CASE_MIGRATIONS
#   ..STORAGE_SCHEMA the graph moves into case.db             _activate_sqlite
#   ..CASE_SCHEMA    the case *folder* changes shape          FOLDER_MIGRATIONS
#
# The third pass reshapes the case tree. Folder migrations declare their target
# schema explicitly: several green implementation checkpoints may collapse into
# one public jump before release, rather than becoming compatibility contracts
# nobody has on disk.
JSON_SCHEMA = 2
STORAGE_SCHEMA = 3
CASE_SCHEMA = 9

# from_version -> function(data) returning data reshaped for from_version + 1.
# The runner (Case.migrate) owns stamping the new schema number, so a migration
# only rewrites fields.
CASE_MIGRATIONS: dict[int, Callable[[dict[str, Any]], dict[str, Any]]] = {
    1: lambda data: data,
}


@dataclass(frozen=True)
class FolderMigration:
    """One folder-shape migration, which may jump over unreleased schemas."""

    target: int
    migrate: Callable[["Case"], None]


# from_version -> migration to a declared later version. Populated below the
# class, once `Case` exists.
FOLDER_MIGRATIONS: dict[int, FolderMigration] = {}


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


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:MAX_CASE_SLUG].strip("-") or "case"


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


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


class Case(CaseStore):
    """Handle over one case directory.

    The filesystem shell (manifest, notes, media, lifecycle, path resolution)
    lives here. Graph operations — entities, links, folders — are the
    `CaseRepository` contract, delegated to a `SqliteCase` over `case.db`. A
    legacy json case (schema ≤ `JSON_SCHEMA`) is converted to sqlite on open
    (`migrate`), so every live handle is sqlite-backed.

    That delegation is `CaseStore` (`casestore.py`), inherited rather than written
    out here: it is a seam, not behaviour, and the methods that only forward were
    burying the ones that also have a folder to keep in step. What stays below is
    the half that has both.
    """

    def __init__(self, path: Path):
        self.path = path
        self._lock = _case_lock(path)
        # Resolved lazily from the manifest on first graph access, then cached.
        self._sqlite_cache: Any = _UNSET

    @property
    def lock(self) -> threading.RLock:
        """The per-case reentrant lock guarding read-modify-write of the case's
        files. Public because the media sidecars need the same serialisation the
        case database already gets: two background handlers can patch different
        fields of one sidecar, and an unguarded read-modify-write loses one of
        them."""
        return self._lock

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

    def _forget_store(self) -> None:
        """Drop the cached backend handle so the next graph access re-resolves it
        from the manifest. Called after the database moves on disk or the manifest
        changes storage format."""
        self._sqlite_cache = _UNSET

    def _resolve_sqlite(self) -> "SqliteCase | None":
        from .sqlite_backend import SqliteCase

        try:
            meta = json.loads(self.json_path.read_text(encoding="utf-8")).get("azimut", {})
        except (OSError, json.JSONDecodeError):
            return None
        if isinstance(meta, dict) and meta.get("storage") == "sqlite":
            # `.open` (not the bare constructor) so an older `case.db` schema is
            # upgraded in place on first access — the storage-format equivalent
            # of `Case.migrate` for the manifest. The media directory is passed
            # in because the backend must not have to guess the case layout.
            # A released schema-3 case still keeps `case.db` at the tool root
            # after the wrapper pre-step. The final layout moves it into
            # `.data/`, but the normalizer needs the graph before that move to
            # flatten its trash. Resolve current-then-legacy during migration.
            return SqliteCase.open(
                layout.extracted_database(self.path),
                media_dir=self.media_dir,
            )
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
        parent = config.scratch_dir() if scratch else config.cases_dir()
        parent.mkdir(parents=True, exist_ok=True)
        slug = _new_id("scratch") if scratch else _slugify(name)
        path = parent / slug
        if path.exists():
            raise CaseError(f"case '{slug}' already exists")
        path.mkdir()
        return cls._born(path, name)

    @classmethod
    def adopt(cls, name: str) -> "Case":
        """Make a case out of a folder the analyst put in the workspace.

        The whole feature is that the folder is not moved, renamed or read: a
        case is a directory holding `azimut/`, so filling that one directory in
        is all adoption is. Whatever was already there stays in the analyst's
        half of the case (`free_entries`), exactly as if they had dropped it in
        after the fact — the app does not import it, and the README that lands
        beside it says so.

        Refuses a folder that already holds the tool's files. An `azimut/` with
        content and no manifest is a case that lost it, not a folder waiting to
        become one, and being born over it would write a new database on top of
        the work. `restore_manifest` is that folder's path back.
        """
        _require_case_folder_name(name)
        path = config.cases_dir() / name
        if not path.is_dir():
            raise CaseError(f"folder '{name}' is not in the workspace")
        if layout.is_case(path):
            raise CaseError(f"folder '{name}' is already a case")
        if tool_dir_holds_content(path):
            raise CaseError(f"folder '{name}' holds a case that lost its manifest")
        return cls._born(path, name)

    @classmethod
    def _born(cls, path: Path, name: str) -> "Case":
        """Give an existing directory everything a case is born with.

        Shared by `create` and `adopt` so an adopted folder is a case in the
        same sense as one made in the app, down to the birth state the artifact
        registry is gated on (`tests/test_artifacts.py`). Two spellings of it
        would drift the day a tool adds a directory.
        """
        from .sqlite_backend import SqliteCase

        ensure_dir(layout.tool_root(path))
        for directory in layout.content_dirs(path):
            ensure_dir(directory)  # `ensure_dir`, so a dot-directory is hidden
        ensure_dir(layout.data_dir(path))
        write_readme(path)
        case = cls(path)
        case._sqlite_cache = SqliteCase.create(case.db_path, name=name)
        case._write_json(
            {
                "azimut": {"schema": CASE_SCHEMA, "storage": "sqlite"},
                "name": name,
                "created_at": _now(),
                "updated_at": _now(),
            }
        )
        case.notes_path.write_text(f"# {name}\n\n", encoding="utf-8")
        return case

    @classmethod
    def locate(cls, case_id: str) -> "Case":
        """Find a case from its manifest without opening its database.

        Normal callers want :meth:`open`. The Case Doctor deliberately needs a
        weaker primitive: a missing ``case.db`` is one of the failures it must
        be able to inspect and repair.
        """
        for parent in (config.cases_dir(), config.scratch_dir()):
            path = parent / case_id
            if layout.is_case(path):
                return cls(path)
        raise CaseError(f"case '{case_id}' not found")

    @classmethod
    def open(cls, case_id: str) -> "Case":
        case = cls.locate(case_id)
        case.migrate()
        _follow_hidden_dirs(case.path)
        from .engine import trash as trash_engine

        trash_engine.recover(case)
        return case

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
            # Before anything can be read: an unwrapped case keeps its manifest
            # at the case root, so `self.read()` would not find it at all.
            _wrap_case_folder(self)
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
            # A released SQLite case starts at schema 3, so it skips this whole
            # write: its manifest is stamped only once, after the final folder
            # layout is valid.
            if version <= JSON_SCHEMA:
                for step in range(version, min(CASE_SCHEMA, JSON_SCHEMA)):
                    migrate = CASE_MIGRATIONS.get(step)
                    if migrate is None:
                        raise CaseError(f"no migration for case schema {step}")
                    data = migrate(data)
                    data.setdefault("azimut", {})["schema"] = step + 1
                self._materialize_note_content(data)
                self._write_json(data)
            # 2) storage activation: json graph -> sqlite (case.db), manifest last.
            if storage != "sqlite":
                self._activate_sqlite(self.read())
            # 3) folder-shape steps, on a case that is now on sqlite.
            self._migrate_folder()
            return self.snapshot()

    def _migrate_folder(self) -> None:
        """Run folder-shape migrations up to `CASE_SCHEMA`.

        A migration declares its target rather than implicitly advancing by one.
        This lets unreleased implementation checkpoints share one idempotent
        normalizer and one final stamp. If a process stops during that work, the
        old schema remains in the manifest and the same normalizer resumes.
        """
        while True:
            data = self.read()
            version = _case_schema(data)
            if version >= CASE_SCHEMA:
                return
            migration = FOLDER_MIGRATIONS.get(version)
            if migration is None:
                raise CaseError(f"no migration for case schema {version}")
            if not version < migration.target <= CASE_SCHEMA:
                raise CaseError(f"invalid folder migration {version} -> {migration.target}")
            migration.migrate(self)
            data = self.read()
            data.setdefault("azimut", {})["schema"] = migration.target
            self._write_json(data)

    def _activate_sqlite(self, data: dict[str, Any]) -> None:
        """Convert a note-materialized json case (schema JSON_SCHEMA) into the
        sqlite format: build case.db, then flip case.json to the small manifest.

        The conversion is atomic and the manifest changes last, so a crash
        before the flip leaves the legacy json case active (the pre-migrate
        backup is already taken by the caller). Media, proofs and note files are
        untouched.
        """
        from .sqlite_backend import convert_json_to_sqlite

        ensure_dir(self.db_path.parent)
        convert_json_to_sqlite(data, self.db_path)
        self._write_json(
            {
                "azimut": {"schema": STORAGE_SCHEMA, "storage": "sqlite"},
                "name": data.get("name", self.id),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at") or _now(),
            }
        )
        self._forget_store()  # re-resolve against the new manifest

    def _backup(self, tag: str) -> None:
        """Copy case.json aside once, under a ``tag``. Never overwrites an
        existing backup — a re-run of the same migration keeps the first copy."""
        dst = self.json_path.with_name(f"case.{tag}.json")
        if not dst.exists():
            shutil.copy2(self.json_path, dst)

    @staticmethod
    def _holds_content(path: Path) -> bool:
        """Whether a case directory holds any file the analyst would miss.

        Debris does not count. A sidecar write goes through a scratch file it
        renames into place (``engine/media._write_sidecar``); a power cut in that
        window strands one, and treating it as content would keep an otherwise
        empty scratch case alive forever.

        The trash does count. What is in it was content a moment ago and can be
        brought back, so reaping the case around it would delete recoverable work
        without anyone asking.
        """
        trash = layout.trash(path)
        if trash.is_dir() and any(trash.iterdir()):
            return True
        for directory in layout.content_dirs(path):
            if not directory.is_dir():
                continue
            for candidate in directory.rglob("*"):
                if not candidate.is_file():
                    continue
                name = candidate.name
                if name.startswith(".") and name.endswith(".tmp"):
                    continue
                return True
        return False

    @classmethod
    def migrate_all(cls) -> list[tuple[str, str]]:
        """Upgrade every discovered permanent and scratch case in place.

        Workspace startup calls this before scratch cleanup. One damaged case
        is reported and skipped rather than preventing every healthy case from
        opening; the future doctor can then handle the isolated failure.
        """
        failures: list[tuple[str, str]] = []
        from .engine import trash as trash_engine

        for parent in (config.cases_dir(), config.scratch_dir()):
            if not parent.is_dir():
                continue
            for path in sorted(parent.iterdir(), key=lambda candidate: candidate.name):
                if not layout.is_case(path):
                    continue
                case = cls(path)
                try:
                    case.migrate()
                    trash_engine.recover(case)
                except Exception as exc:
                    failures.append((case.id, str(exc)))
                    logger.warning("could not migrate case %s: %s", case.id, exc)
        return failures

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
            if not layout.is_case(path):
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
            if cls._holds_content(path):
                continue
            try:
                case.delete()
                removed += 1
            except OSError:
                continue  # a file may be open elsewhere (Windows) — next start
        return removed

    @classmethod
    def list_all(cls, *, q: str | None = None, limit: int | None = None) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for parent, scratch in ((config.cases_dir(), False), (config.scratch_dir(), True)):
            if not parent.is_dir():
                continue
            for path in sorted(parent.iterdir()):
                if not layout.is_case(path):
                    continue
                case = cls(path)
                data = case.read()
                updated_at = data.get("updated_at")
                health = "ok"
                try:
                    if case._sqlite is not None:
                        updated_at = case._sqlite.updated_at() or updated_at
                    entity_count: int | None = case.entity_count()
                except (CaseError, OSError, sqlite3.Error):
                    # Keep a damaged case reachable from the switcher. Opening
                    # it normally may fail, but the Doctor still locates it from
                    # the manifest and can offer a repair.
                    health = "needs-attention"
                    entity_count = None
                out.append(
                    {
                        "id": case.id,
                        "name": data.get("name", case.id),
                        "scratch": scratch,
                        "created_at": data.get("created_at"),
                        "updated_at": updated_at,
                        "entity_count": entity_count,
                        "health": health,
                    }
                )
        out.sort(key=lambda c: c.get("updated_at") or "", reverse=True)
        if q:
            needle = q.strip().lower()
            out = [c for c in out if needle in str(c.get("name", "")).lower()]
        if limit is not None:
            out = out[: max(0, limit)]
        return out

    # -- json io -----------------------------------------------------------

    @property
    def tool_root(self) -> Path:
        """The directory Azimut owns. `self.path` is the case folder, whose
        other contents belong to the analyst and are never touched."""
        return layout.tool_root(self.path)

    @property
    def json_path(self) -> Path:
        return layout.manifest(self.path)

    @property
    def db_path(self) -> Path:
        return layout.database(self.path)

    @property
    def media_dir(self) -> Path:
        return layout.media(self.path)

    def free_entries(self) -> list[Path]:
        """What the analyst keeps beside `azimut/`, in the half they own.

        Azimut never looks inside these. The one thing it does with them is
        carry them in a bundle, so that a case travels whole rather than
        travelling as the part the tool happened to author. Listed here so
        "everything that is not `azimut/`" has a single definition.
        """
        return sorted(entry for entry in self.path.iterdir() if entry.name != layout.TOOL_DIR)

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
    # the raw case.json shape. The SQLite backend answers these without
    # materialising the manifest. `read()` above stays the JSON implementation
    # detail used internally and by storage tests.

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


    # -- notes -------------------------------------------------------------

    @property
    def notes_path(self) -> Path:
        return layout.notes_file(self.path)

    def read_notes(self) -> str:
        try:
            return self.notes_path.read_text(encoding="utf-8")
        except OSError:
            return ""

    def write_notes(self, text: str) -> None:
        self.notes_path.write_text(text, encoding="utf-8")

    @property
    def note_dir(self) -> Path:
        return layout.notes(self.path)

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

    def prune_note_dirs(self, rel: str) -> None:
        """Drop the mirrored folder directories a removed note left empty.

        Called wherever a note's file stops being there — a delete, or a move
        into the trash. A mirror that keeps every directory a note ever lived in
        stops being a mirror, and the birth-state gate counts each one.
        """
        if not rel.startswith("notes/"):
            return
        _prune_empty_note_dirs(self.note_dir, self.resolve_inside(rel).parent)

    def note_target(self, folder: str, label: str, *, taken_by: str | None = None) -> str:
        """A free case-relative path for a note called `label` in `folder`.

        The name is the filename, as it already is for proofs, sessions and
        drafts. Uniqueness is scoped to the folder, so "Summary" can exist under
        two different videos — the whole reason the tree is mirrored on disk.

        A name already used in that folder gets a numbered suffix rather than a
        refusal: a note is the most frequent thing an analyst creates, and the
        front already proposes free names (`lib/naming.js`, `uniqueName`).
        `taken_by` is the note being renamed, which does not collide with itself.
        """
        stem = layout.slugify(label, "note")
        candidate = layout.note_rel(folder, stem)
        directory = self.resolve_inside(candidate).parent
        occupied = (
            {
                path.name.casefold()
                for path in directory.iterdir()
                if taken_by is None or path != self.resolve_inside(taken_by)
            }
            if directory.is_dir()
            else set()
        )
        index = 2
        while True:
            if Path(candidate).name.casefold() not in occupied:
                return candidate
            candidate = layout.note_rel(folder, f"{stem}-{index}")
            index += 1

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
            canonical = layout.slugify(label, "Note")
            # The graph row goes to case.db; the body stays a file on the shell.
            graph = self._graph()
            entity = graph.add_entity(
                "note", canonical, {"folder": folder}, by=by, status=status, source=source
            )
            rel = self.note_target(folder, canonical)
            note_path = self.resolve_inside(rel)
            ensure_dir(note_path.parent)
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

    @staticmethod
    def _settle_background_work() -> None:
        """Let the shared worker finish before this case's directory moves.

        Background jobs write inside the case folder — a thumbnail, and
        enrichment's sidecar — and a directory cannot be moved or removed from
        under a thread writing into it: POSIX raises ``Directory not empty`` when
        a file appears between the walk and the ``rmdir``, and Windows refuses
        outright while a handle is open. Enrichment made the window wide enough to
        hit, since reading EXIF or probing a video takes far longer than writing a
        thumbnail.

        Bounded, and it never interrupts work in flight. Nothing re-wakes the
        worker for a case afterwards, because the only thing that queues work is a
        request against that case — and this one is on its way out.
        """
        from .engine import workqueue

        workqueue.wait_until_idle()

    def promote(self, name: str) -> "Case":
        """Move a scratch case to the workspace root under a proper name."""
        if not self.is_scratch:
            raise CaseError("only scratch cases can be promoted")
        slug = _slugify(name)
        dest = config.cases_dir() / slug
        if dest.exists():
            raise CaseError(f"case '{slug}' already exists")
        dest.parent.mkdir(parents=True, exist_ok=True)
        self._settle_background_work()
        shutil.move(str(self.path), str(dest))
        promoted = Case(dest)
        promoted.rename(name)
        return promoted

    def delete(self) -> None:
        self._settle_background_work()
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
        with self._lock:
            self._follow_note_rename(entity_id, patch)
            self._follow_named_artifact_rename(entity_id, patch)
            return self._graph().update_entity(entity_id, patch)


    def _follow_named_artifact_rename(self, entity_id: str, patch: dict[str, Any]) -> None:
        """Keep named tool files aligned with a label edited from Details.

        Tool-specific saves already carry their old filename and perform the
        same move. This hook closes the other route: the shared Details editor
        patches an entity directly. Explicitly supplying the path attribute
        means the caller already owns the move, so this does nothing.
        """
        entity = self.get_entity(entity_id)
        if entity is None or "label" not in patch:
            return
        rules: dict[str, tuple[str, Callable[[str], str], str]] = {
            "proof": ("spec", layout.proof_spec_rel, "Proof"),
            "inspect-session": ("spec", layout.session_rel, "Inspect"),
            "post": ("draft", layout.draft_rel, "Post"),
        }
        rule = rules.get(str(entity.get("type") or ""))
        if rule is None:
            return
        attribute, build, fallback = rule
        incoming = patch.get("attrs") or {}
        if attribute in incoming:
            return
        current = (entity.get("attrs") or {}).get(attribute)
        if not isinstance(current, str):
            return

        from .engine import media as media_engine

        canonical = layout.slugify(str(patch["label"]), fallback)
        target = build(canonical)
        source_path = self.resolve_inside(current)
        target_path = self.resolve_inside(target)
        occupied = {
            path.name.casefold() for path in target_path.parent.iterdir() if path != source_path
        }
        if target_path.name.casefold() in occupied:
            raise CaseError(f"another {entity['type']} already uses that name")

        moves: list[tuple[Path, Path]] = [(source_path, target_path)]
        replacements: list[tuple[str, str]] = [(current, target)]
        attrs = {attribute: target}
        if entity["type"] == "proof":
            old_name = Path(current).stem
            old_export = layout.proof_export_rel(old_name)
            new_export = layout.proof_export_rel(canonical)
            moves.extend(
                [
                    (
                        self.resolve_inside(old_export),
                        self.resolve_inside(new_export),
                    ),
                    (
                        self.resolve_inside(layout.proof_assets_rel(old_name)),
                        self.resolve_inside(layout.proof_assets_rel(canonical)),
                    ),
                ]
            )
            replacements.append((old_export, new_export))
            if (entity.get("attrs") or {}).get("path") == old_export:
                attrs["path"] = new_export

        moved: list[tuple[Path, Path]] = []
        applied: list[tuple[str, str]] = []
        try:
            for source, destination in moves:
                if source.exists() and source != destination:
                    media_engine.rename_path(source, destination)
                    moved.append((source, destination))
            for old, new in replacements:
                if old == new:
                    continue
                self.replace_path_references(old, new)
                media_engine.rewrite_file_references(self, old, new)
                applied.append((old, new))
            if target_path.exists():
                try:
                    data = json.loads(target_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    data = None
                if isinstance(data, dict):
                    data["title"] = canonical
                    media_engine.write_json_atomic(target_path, data)
        except Exception:
            for old, new in reversed(applied):
                self.replace_path_references(new, old)
                media_engine.rewrite_file_references(self, new, old)
            for source, destination in reversed(moved):
                if destination.exists() and not source.exists():
                    media_engine.rename_path(destination, source)
            raise

        patch["label"] = canonical
        if attrs:
            patch.setdefault("attrs", {}).update(attrs)

    def _follow_note_rename(self, entity_id: str, patch: dict[str, Any]) -> None:
        """Move a note's file when its title or its folder changes.

        The name is the filename, so renaming a note in the notebook moves the
        markdown on disk — the same rule proofs, sessions and drafts follow, and
        the reason `notes/` is worth keeping visible at all. The patch is
        completed with the new path, so the graph row and the file never
        disagree.
        """
        entity = self.get_entity(entity_id)
        if entity is None or entity.get("type") != "note":
            return
        attrs = entity.get("attrs") or {}
        incoming = patch.get("attrs") or {}
        if incoming.get("path"):
            if "label" in patch:
                patch["label"] = layout.slugify(str(patch["label"]), "Note")
            return  # the caller is stating where the file is, not renaming it
        label = patch.get("label", entity.get("label"))
        folder = incoming.get("folder", attrs.get("folder") or "")
        current = attrs.get("path")
        if not isinstance(current, str):
            return
        target = self.note_target(str(folder), str(label), taken_by=current)
        canonical = Path(target).stem
        if target == current:
            if patch.get("label") != canonical and entity.get("label") != canonical:
                patch["label"] = canonical
            return
        source = self.resolve_inside(current)
        destination = self.resolve_inside(target)
        if source.exists():
            ensure_dir(destination.parent)
            shutil.move(str(source), str(destination))
            _prune_empty_note_dirs(self.note_dir, source.parent)
        patch.setdefault("attrs", {})["path"] = target
        patch["label"] = canonical


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
        # Folders nest, so without a bound the deepest path in a case is
        # unbounded too — and note files will mirror this tree on disk.
        if len(parts) > layout.MAX_FOLDER_DEPTH:
            raise CaseError(f"a folder nests at most {layout.MAX_FOLDER_DEPTH} deep")
        path = "/".join(parts)
        if len(path) > layout.MAX_FOLDER_PATH:
            raise CaseError(f"a folder path is at most {layout.MAX_FOLDER_PATH} characters")
        return path



    @property
    def trash_dir(self) -> Path:
        """Where deleted artifacts wait. Hidden, at the case root, and never a
        `CASE_SUBDIRS` member: nothing that walks a case's content should walk
        into it."""
        return layout.trash(self.path)


    # -- helpers -------------------------------------------------------------

    def subdir(self, name: str) -> Path:
        try:
            directory = layout.subdir(self.path, name)
        except layout.LayoutError as exc:
            raise CaseError(str(exc)) from exc
        return ensure_dir(directory)

    def resolve_inside(self, relative: str) -> Path:
        """Resolve a case-relative path, refusing traversal outside the case.

        Relative means relative to what the tool owns, not to the case folder:
        `media/x.png` is what the graph, the sidecars and the bundles all say,
        and it kept meaning that when the `azimut/` wrapper arrived. The guard
        is against the tool root too, so a doctored path cannot climb out into
        the analyst's own files sitting beside it.
        """
        root = self.tool_root
        candidate = (root / relative).resolve()
        if not candidate.is_relative_to(root.resolve()):
            raise CaseError("path escapes the case directory")
        return candidate


# -- folders in the workspace that are not cases yet --------------------------
#
# Cases are found by their manifest, so a folder someone creates in `~/Azimut`
# from their file manager is invisible to `Case.list_all` — which is correct
# until they made it *to be* a case. Rather than ask them to recreate it in the
# app, the switcher offers what is already on disk, and a click fills it in.
#
# Three answers, because two of them must not lead to the same move: a folder
# with nothing of ours in it can be born into (`new`), one whose name a case
# folder cannot carry has to be renamed first (`unusable-name`), and one holding
# the tool's files without a manifest is damaged goods (`broken`) that only
# `restore_manifest` may touch.

FOLDER_NEW = "new"
FOLDER_UNUSABLE_NAME = "unusable-name"
FOLDER_BROKEN = "broken"

#: Files an operating system drops into any folder someone opens. A folder
#: holding only these was never filled by the analyst, so they do not make an
#: `azimut/` directory look inhabited.
_OS_JUNK = frozenset({".ds_store", "thumbs.db", "desktop.ini"})


def _require_case_folder_name(name: str) -> None:
    """Refuse a folder name no case can live under, and say what to do instead.

    The remedy is always the same and it is not Azimut's to apply: the folder is
    the analyst's, so it is renamed in their file manager, not behind their back.
    """
    if not layout.usable_case_name(name):
        raise CaseError(
            f"'{name}' cannot name a case folder. Rename it: {MAX_CASE_SLUG} characters "
            f"at most, and none of {layout.UNUSABLE_NAME_CHARS}"
        )


def tool_dir_holds_content(root: Path) -> bool:
    """Whether this folder's `azimut/` holds anything the tool wrote.

    Deliberately generous about what counts: the question is only ever asked to
    decide whether it is safe to create a case here, and the cost of a false
    "empty" is someone's database written over.
    """
    tool = layout.tool_root(root)
    if not tool.is_dir():
        return False
    return any(
        path.is_file() and path.name.casefold() not in _OS_JUNK for path in tool.rglob("*")
    )


def folder_state(root: Path) -> str:
    """What Azimut can do with a workspace folder that is not a case.

    The name is checked first: a folder Windows could not hold a case in has to
    be renamed whether it is empty or damaged, so saying so once is clearer than
    offering a repair that would then refuse.
    """
    if not layout.usable_case_name(root.name):
        return FOLDER_UNUSABLE_NAME
    if tool_dir_holds_content(root):
        return FOLDER_BROKEN
    return FOLDER_NEW


def list_workspace_folders() -> list[dict[str, Any]]:
    """Every folder sitting in the workspace that is not a case, with its state.

    Dotted names are skipped: `.azimut/` is the workspace's own machinery, and
    nothing else hidden was put there to be seen. Files are skipped too — a case
    is a directory.
    """
    parent = config.cases_dir()
    if not parent.is_dir():
        return []
    return [
        {"name": path.name, "state": folder_state(path)}
        for path in sorted(parent.iterdir(), key=lambda item: item.name.casefold())
        if path.is_dir() and not path.name.startswith(".") and not layout.is_case(path)
    ]


def restore_manifest(name: str) -> "Case":
    """Give a case folder back the manifest it lost.

    Without `case.json` a folder is not a case to anything: the switcher, the
    startup migration and the Doctor all walk past it, and adoption must refuse
    it, so a whole investigation can sit in the workspace unreachable. Writing
    the manifest is what puts it back in everyone's view, and it is deliberately
    the smallest possible move — the name and the dates come from the database
    when it can be read, and every other repair stays where it belongs, in the
    Doctor, on a case that is now openable.

    Stamped at `STORAGE_SCHEMA` rather than the current schema. The folder was
    shaped by whichever Azimut wrote it, and claiming it is already current
    would skip the folder migrations that make it so.
    """
    from .sqlite_backend import read_meta

    _require_case_folder_name(name)
    path = config.cases_dir() / name
    if not path.is_dir():
        raise CaseError(f"folder '{name}' is not in the workspace")
    if layout.is_case(path):
        raise CaseError(f"folder '{name}' already holds a case")
    if not tool_dir_holds_content(path):
        raise CaseError(f"folder '{name}' holds no case to recover")
    meta = read_meta(layout.extracted_database(path))
    case = Case(path)
    case._write_json(
        {
            "azimut": {"schema": STORAGE_SCHEMA, "storage": "sqlite"},
            "name": meta.get("name") or name,
            "created_at": meta.get("created_at") or _now(),
            "updated_at": meta.get("updated_at") or _now(),
        }
    )
    write_readme(path)
    return case



def open_workspace() -> None:
    """Bring the workspace at the current root into a state routes can serve.

    Startup does this once, and so does anything that changes where the root is
    — adopting a folder or finishing a move lands on cases this process has
    never looked at, which may have been written by an older Azimut. Each step
    is best-effort on purpose: housekeeping must never be the reason the app
    won't open.

    Imports are local because the modules below sit above this one; calling them
    at import time would close the circle.
    """
    from .engine import bundles, scrapers, workqueue

    config.ensure_workspace()
    scrapers.activate()
    Case.migrate_all()
    for housekeeping in (Case.cleanup_scratch, bundles.cleanup_uploads, workqueue.recover_all):
        try:
            housekeeping()
        except Exception:  # noqa: BLE001 - see the docstring
            logger.warning("workspace housekeeping step failed", exc_info=True)


_FINAL_LAYOUT_MIGRATION = FolderMigration(CASE_SCHEMA, _normalize_case_layout)
FOLDER_MIGRATIONS.update(
    {version: _FINAL_LAYOUT_MIGRATION for version in range(STORAGE_SCHEMA, CASE_SCHEMA)}
)


if TYPE_CHECKING:
    # `Case` conforms to `CaseRepository` (it delegates the graph to `SqliteCase`).
    # This fails type-check if a graph method ever drifts from the boundary
    # contract (a missing method, a changed signature).
    def _case_conforms(case: Case) -> "CaseRepository":
        return case
