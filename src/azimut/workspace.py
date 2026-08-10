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
            _hide_dotted_chain(path)
            return path
        except PermissionError:
            if path.is_dir():
                return path
            if attempt == 19:
                raise
            time.sleep(0.01)
    return path  # pragma: no cover - loop always returns or raises above


def _hide_dotted_chain(path: Path) -> None:
    """Hide *path* on Windows, and the dot-directories `parents=True` just made.

    `media/.meta/<proof>.assets` creates `.meta` on the way to a leaf that is
    not itself dotted, so hiding the leaf alone would leave the directory that
    matters visible. The walk stops at the first ancestor without a leading dot,
    which is always the visible half of the case (`media/`, `proofs/`, the tool
    root), so it never climbs out of the workspace.
    """
    current = path
    while True:
        config.hide_if_dotted(current)
        parent = current.parent
        if parent == current or not parent.name.startswith("."):
            return
        current = parent


def _follow_hidden_dirs(root: Path) -> None:
    """Put the hidden attribute back on a case's internal directories.

    `.azimut` gets this at every startup (`config.ensure_workspace`); a case only
    got it the day it was born, so any copy of a workspace — a move onto another
    drive, a folder carried between machines, a backup unpacked — showed the
    analyst directories the layout means to keep out of sight.

    Costs nothing off Windows, where `hide_if_dotted` is what returns early: one
    guard in one place beats a second copy of the platform test here.
    """
    for directory in layout.hidden_dirs(root):
        config.hide_if_dotted(directory)


def write_readme(root: Path) -> None:
    """Leave the note that says which half of the case folder is whose.

    Only when there is none. The file sits in the analyst's half, so once it is
    there it is theirs: an edited or deleted README is a choice, not damage, and
    rewriting it on every open would undo it.
    """
    readme = layout.readme(root)
    if not readme.exists():
        readme.write_text(layout.README_TEXT, encoding="utf-8")


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
        self._sqlite_cache = _UNSET  # re-resolve against the new manifest

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
        recursive: bool = False,
        attr: str | None = None,
        attr_value: str | None = None,
        linked: str | None = None,
        unlinked: bool = False,
        since: str | None = None,
        until: str | None = None,
        filed_by: list[str] | None = None,
        order: str = "",
    ) -> dict[str, Any]:
        """A bounded, filtered page of the catalog (Step 5), paged with an indexed
        keyset over the ordering asked for."""
        return self._graph().page_entities(
            limit=limit,
            cursor=cursor,
            types=types,
            status=status,
            query=query,
            folder=folder,
            unfiled=unfiled,
            recursive=recursive,
            attr=attr,
            attr_value=attr_value,
            linked=linked,
            unlinked=unlinked,
            since=since,
            until=until,
            filed_by=filed_by,
            order=order,
        )

    def catalog_summary(self) -> dict[str, Any]:
        """Total plus per-type, per-status, per-folder and per-filer counts."""
        return self._graph().catalog_summary()

    def attr_facets(
        self, *, types: list[str] | None = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        """Which stored fields these entities hold, and which values, as a menu."""
        return self._graph().attr_facets(types=types, limit=limit)

    def list_links(self) -> list[dict[str, Any]]:
        return self._graph().list_links()

    def entity_images(self, entity_id: str) -> list[dict[str, Any]]:
        return self._graph().entity_images(entity_id)

    def entity_image_thumbs(self, entity_ids: list[str]) -> dict[str, str]:
        return self._graph().entity_image_thumbs(entity_ids)

    def entity_images_touching(self, entity_ids: list[str]) -> list[dict[str, Any]]:
        return self._graph().entity_images_touching(entity_ids)

    def add_entity_images(self, entity_id: str, media_ids: list[str]) -> int:
        return self._graph().add_entity_images(entity_id, media_ids)

    def add_entity_image_file(
        self,
        entity_id: str,
        image_id: str,
        path: str,
        thumbnail: str,
        title: str,
    ) -> None:
        self._graph().add_entity_image_file(
            entity_id, image_id, path, thumbnail, title
        )

    def set_primary_entity_image(self, entity_id: str, image_id: str) -> None:
        self._graph().set_primary_entity_image(entity_id, image_id)

    def remove_entity_image(self, entity_id: str, image_id: str) -> dict[str, Any]:
        return self._graph().remove_entity_image(entity_id, image_id)

    def reinsert_entity_images(self, rows: list[dict[str, Any]]) -> dict[str, int]:
        return self._graph().reinsert_entity_images(rows)

    def upsert_media_item(self, item: dict[str, Any], *, entity_id: str | None = None) -> None:
        self._graph().upsert_media_item(item, entity_id=entity_id)

    def remove_media_item(self, path: str) -> None:
        self._graph().remove_media_item(path)

    def list_media_items(self) -> list[dict[str, Any]]:
        return self._graph().list_media_items()

    def media_items_by_paths(self, paths: list[str]) -> list[dict[str, Any]]:
        return self._graph().media_items_by_paths(paths)

    def media_thumbs(self, entity_ids: list[str]) -> dict[str, str]:
        return self._graph().media_thumbs(entity_ids)

    def media_kinds(self, entity_ids: list[str]) -> dict[str, str]:
        return self._graph().media_kinds(entity_ids)

    def media_origins(self, entity_ids: list[str]) -> dict[str, dict[str, str]]:
        return self._graph().media_origins(entity_ids)

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
        return self._graph().page_media_items(
            q=q,
            kind=kind,
            category=category,
            folder=folder,
            gps=gps,
            collected_only=collected_only,
            sort=sort,
            direction=direction,
            limit=limit,
            offset=offset,
        )

    def get_link(self, link_id: str) -> dict[str, Any] | None:
        return self._graph().get_link(link_id)

    def links_of(self, entity_id: str) -> list[dict[str, Any]]:
        return self._graph().links_of(entity_id)

    def count_dependents(self, *, link_type: str, from_type: str) -> dict[str, int]:
        return self._graph().count_dependents(link_type=link_type, from_type=from_type)

    def count_incident_links(self, *, exclude_types: list[str]) -> dict[str, int]:
        return self._graph().count_incident_links(exclude_types=exclude_types)

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
        link_types: list[str] | None = None,
        order: str = "degree",
    ) -> dict[str, Any]:
        return self._graph().rank_entities(
            limit=limit, types=types, exclude_types=exclude_types, status=status,
            query=query, folder=folder, unfiled=unfiled, recursive=recursive,
            attr=attr, attr_value=attr_value, linked=linked, unlinked_only=unlinked_only,
            since=since, until=until, filed_by=filed_by,
            link_types=link_types, order=order,
        )

    def entities_by_ids(self, ids: list[str]) -> list[dict[str, Any]]:
        return self._graph().entities_by_ids(ids)

    def labels_of_type(self, type_: str) -> list[tuple[str, str]]:
        return self._graph().labels_of_type(type_)

    def links_among(
        self, ids: list[str], *, types: list[str] | None = None
    ) -> list[dict[str, Any]]:
        return self._graph().links_among(ids, types=types)

    def links_touching(
        self,
        ids: list[str],
        *,
        types: list[str] | None = None,
        exclude_types: list[str] | None = None,
        end_types: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        return self._graph().links_touching(
            ids, types=types, exclude_types=exclude_types, end_types=end_types
        )

    def degrees_of(
        self,
        ids: list[str],
        *,
        types: list[str] | None = None,
        exclude_types: list[str] | None = None,
    ) -> dict[str, int]:
        return self._graph().degrees_of(ids, types=types, exclude_types=exclude_types)


    def graph_pins(self, lens: str) -> dict[str, tuple[float, float]]:
        return self._graph().graph_pins(lens)

    def pin_entities(self, lens: str, pins: dict[str, tuple[float, float]]) -> int:
        return self._graph().pin_entities(lens, pins)

    def unpin_entities(self, lens: str, ids: list[str]) -> int:
        return self._graph().unpin_entities(lens, ids)

    def clear_graph_pins(self, lens: str) -> int:
        return self._graph().clear_graph_pins(lens)

    def list_analysis_views(self) -> list[dict[str, Any]]:
        return self._graph().list_analysis_views()

    def get_analysis_view(self, view_id: str) -> dict[str, Any] | None:
        return self._graph().get_analysis_view(view_id)

    def save_analysis_view(self, view: dict[str, Any]) -> dict[str, Any]:
        return self._graph().save_analysis_view(view)

    def remove_analysis_view(self, view_id: str) -> dict[str, Any] | None:
        return self._graph().remove_analysis_view(view_id)

    def reinsert_analysis_views(self, views: list[dict[str, Any]]) -> int:
        return self._graph().reinsert_analysis_views(views)

    def get_entity(self, entity_id: str) -> dict[str, Any] | None:
        return self._graph().get_entity(entity_id)

    def note_ids_by_titles(self, titles: set[str]) -> dict[str, list[str]]:
        return self._graph().note_ids_by_titles(titles)

    def entity_count(self) -> int:
        """Entity total for the case switcher — one indexed count."""
        return self._graph().count_entities()

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

    def update_link(self, link_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        return self._graph().update_link(link_id, patch)

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
        # Folders nest, so without a bound the deepest path in a case is
        # unbounded too — and note files will mirror this tree on disk.
        if len(parts) > layout.MAX_FOLDER_DEPTH:
            raise CaseError(f"a folder nests at most {layout.MAX_FOLDER_DEPTH} deep")
        path = "/".join(parts)
        if len(path) > layout.MAX_FOLDER_PATH:
            raise CaseError(f"a folder path is at most {layout.MAX_FOLDER_PATH} characters")
        return path

    def list_folders(self) -> list[str]:
        return self._graph().list_folders()

    def add_folder(self, name: str) -> list[str]:
        return self._graph().add_folder(name)

    def remove_folder(self, name: str) -> list[str]:
        return self._graph().remove_folder(name)

    # -- trash journal (engine/trash.py owns the files) ----------------------

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
        return self._graph().add_trash_group(
            group_id,
            label=label,
            type_=type_,
            item_count=item_count,
            size_bytes=size_bytes,
            payload=payload,
            state=state,
        )

    def update_trash_group(
        self,
        group_id: str,
        *,
        state: str | None = None,
        size_bytes: int | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._graph().update_trash_group(
            group_id,
            state=state,
            size_bytes=size_bytes,
            payload=payload,
        )

    def list_trash(self) -> list[dict[str, Any]]:
        return self._graph().list_trash()

    def get_trash_group(self, group_id: str) -> dict[str, Any] | None:
        return self._graph().get_trash_group(group_id)

    def list_incomplete_trash(self) -> list[dict[str, Any]]:
        return self._graph().list_incomplete_trash()

    def remove_trash_group(self, group_id: str) -> None:
        self._graph().remove_trash_group(group_id)

    def clear_trash(self) -> list[str]:
        return self._graph().clear_trash()

    def trash_summary(self) -> dict[str, int]:
        return self._graph().trash_summary()

    def reinsert(
        self, entities: list[dict[str, Any]], links: list[dict[str, Any]]
    ) -> dict[str, int]:
        return self._graph().reinsert(entities, links)

    @property
    def trash_dir(self) -> Path:
        """Where deleted artifacts wait. Hidden, at the case root, and never a
        `CASE_SUBDIRS` member: nothing that walks a case's content should walk
        into it."""
        return layout.trash(self.path)

    # -- durable jobs (thumbnail and background-job model) -------------------

    def enqueue_job(
        self,
        kind: str,
        *,
        key: str | None = None,
        payload: dict[str, Any] | None = None,
        max_attempts: int = 3,
    ) -> dict[str, Any]:
        return self._graph().enqueue_job(kind, key=key, payload=payload, max_attempts=max_attempts)

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

    def count_jobs(self, *, kind: str | None = None) -> dict[str, int]:
        return self._graph().count_jobs(kind=kind)

    def recover_jobs(self) -> int:
        return self._graph().recover_jobs()

    def prune_jobs(self, *, kind: str | None = None) -> int:
        return self._graph().prune_jobs(kind=kind)

    def replace_path_references(self, old: str, new: str) -> None:
        self._graph().replace_path_references(old, new)

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


def _wrap_case_folder(case: "Case") -> None:
    """Move the tool's files into `azimut/`.

    What this buys is in `layout.py`: the case root becomes the analyst's, and a
    folder they create there can no longer collide with one of ours.

    Nothing inside is rewritten. Paths are stored relative to the tool root
    (`media/x.png`), so they go on meaning the same thing one level down — the
    database, the sidecars and any bundle are untouched.

    **Only the tool's own entries move** (`layout.UNWRAPPED_ENTRIES`). Nothing
    stopped an analyst from keeping their own folder beside a case before this,
    and carrying it into `azimut/` would contradict the very boundary being
    drawn. Anything unrecognised stays at the case root, which is where it now
    belongs anyway.

    **The manifest moves last.** While it is still at the case root the move is
    unfinished, and that is exactly what `layout.needs_wrapper` reads, so a
    power cut mid-move is resumed rather than half-applied. Runs before anything
    reads the manifest, which is why it is keyed on the filesystem rather than
    on a schema number nobody could load yet.
    """
    root = case.path
    if not layout.needs_wrapper(root):
        return
    tool = layout.tool_root(root)
    tool.mkdir(exist_ok=True)
    ours = [root / name for name in layout.UNWRAPPED_ENTRIES]
    ours += sorted(root.glob(layout.UNWRAPPED_BACKUP_GLOB))
    for entry in dict.fromkeys(ours):
        destination = tool / entry.name
        if not entry.exists() or destination.exists():
            continue  # absent, or already carried over by an interrupted run
        shutil.move(str(entry), str(destination))
    shutil.move(str(layout.unwrapped_manifest(root)), str(layout.manifest(root)))
    case._sqlite_cache = _UNSET  # the database is at a new path now


def _flatten_trash(case: "Case") -> None:
    """Make trash groups stop mirroring the case tree.

    A group used to hold ``media/clip.mp4`` under its own directory, stacking
    two case trees and making the trash the longest path Azimut could write —
    on its own enough to pass Windows' 260-character limit. The journal already
    knows where each file came from, so the files move to numbered slots and the
    payload gains the ``slots`` list that pairs with ``files``.

    Idempotent: a file already in its slot is left alone, so an interrupted run
    resumes.
    """
    from .engine.trash import slots_for

    groups = [g["id"] for g in case.list_trash()]
    groups += [g["id"] for g in case.list_incomplete_trash()]
    for group_id in dict.fromkeys(groups):
        group = case.get_trash_group(group_id)
        if group is None:
            continue
        payload = dict(group.get("payload") or {})
        files = [str(rel) for rel in (payload.get("files") or [])]
        slots = slots_for(files)
        root = case.trash_dir / group_id
        for rel, slot in zip(files, slots):
            source = root / rel
            destination = root / slot
            if source.exists() and not destination.exists():
                shutil.move(str(source), str(destination))
        _drop_empty_dirs(root)
        payload["slots"] = slots
        case.update_trash_group(group_id, payload=payload)


def _drop_empty_dirs(root: Path) -> None:
    """Remove the directories a mirrored group left behind, deepest first."""
    if not root.is_dir():
        return
    for path in sorted(root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()


def _prune_empty_note_dirs(root: Path, directory: Path) -> None:
    """Drop the folder directories a moved note left empty, up to `notes/`.

    A mirrored tree that keeps every directory a note ever passed through stops
    being a mirror. Stops at `notes/` itself, which is born with the case.

    Both paths are resolved before they are compared. Callers hand in the note
    directory as the case knows it and the note's own parent as
    `resolve_inside` returned it, which are the same directory in two spellings
    the moment a symlink sits anywhere above the workspace: macOS reaches every
    temporary directory through `/var` → `/private/var`, and a workspace under a
    synced or linked folder does the same on any platform. Comparing the two
    spellings makes the containment check say "outside", and the loop that
    should prune then does nothing at all.
    """
    root = root.resolve()
    directory = directory.resolve()
    while directory != root and directory.is_relative_to(root):
        try:
            if any(directory.iterdir()):
                return
            directory.rmdir()
        except OSError:
            return
        directory = directory.parent


def _move_into(source: Path, destination: Path) -> None:
    """Carry one entry over, skipping what an interrupted run already moved."""
    if not source.exists() or destination.exists():
        return
    ensure_dir(destination.parent)
    shutil.move(str(source), str(destination))


def _hide_the_machinery(case: "Case") -> None:
    """Move what only Azimut can read out of the way.

    The rule is in `layout.py`: visible means openable in another program.
    Applied here it moves the database into `.data/`, the media sidecars into
    `media/.meta/`, the proof specs and their pasted assets into
    `proofs/.meta/`, and renames `inspect/` and `search/` to dot-directories.

    `exports/` is the one that changes meaning rather than place. It held post
    drafts — its name was wrong — so the drafts become `.drafts/` and a fresh,
    empty `exports/` is left behind for what the word actually promises.

    This is the first folder step that rewrites *stored* paths: a proof's
    ``spec``, a session's ``spec`` and a post's ``draft`` all name a directory
    that just moved.
    """
    root = case.path
    tool = layout.tool_root(root)

    # The database first, and with no connection open: on Windows an open file
    # cannot be moved. Nothing holds one here — every backend connection is
    # scoped to its own `with` — but the cached handle is dropped anyway so the
    # next access re-resolves against the new path.
    _move_into(tool / layout.PRE_HIDDEN_DB, layout.database(root))
    case._sqlite_cache = _UNSET

    # Sidecars: `media/clip.mp4.azimut.json` -> `media/.meta/clip.mp4.json`.
    media_dir = layout.media(root)
    if media_dir.is_dir():
        suffix = layout.PRE_HIDDEN_SIDECAR_SUFFIX
        for sidecar in sorted(media_dir.glob(f"*{suffix}")):
            name = sidecar.name[: -len(suffix)]
            _move_into(sidecar, case.resolve_inside(layout.sidecar_rel(name)))

    # Proof specs and pasted assets join them; the rendered PNG stays visible.
    proofs_dir = layout.subdir(root, "proofs")
    if proofs_dir.is_dir():
        for spec in sorted(proofs_dir.glob("*.json")):
            _move_into(spec, case.resolve_inside(layout.proof_spec_rel(spec.stem)))
        for assets in sorted(proofs_dir.glob("*.assets")):
            _move_into(assets, case.resolve_inside(layout.proof_assets_rel(assets.stem)))

    # The sidecars just moved, and the one-time browse-index backfill may have
    # already run against their old location. Forget it, so the reopen below
    # rebuilds the index from where they are now.
    store = case._sqlite
    if store is not None:
        store.forget_media_index()
        case._sqlite_cache = _UNSET

    for old, new in layout.PRE_HIDDEN_DIRS.items():
        _move_into(tool / old, tool / new)
    for directory in layout.content_dirs(root):
        ensure_dir(directory)

    _rewrite_moved_paths(case)


#: entity type -> (attribute holding a case-relative path, old prefix, rebuild).
_MOVED_ATTRS: dict[str, tuple[str, str, Callable[[str], str]]] = {
    "proof": ("spec", "proofs/", layout.proof_spec_rel),
    "inspect-session": ("spec", "inspect/", layout.session_rel),
    "post": ("draft", "exports/", layout.draft_rel),
}


def _rewrite_moved_paths(case: "Case") -> None:
    """Point the graph at the directories the migration just renamed.

    Only entities still naming the old location are touched, so a re-run after
    an interruption rewrites nothing twice.
    """
    for entity in case.list_entities():
        rule = _MOVED_ATTRS.get(str(entity.get("type") or ""))
        if rule is None:
            continue
        attribute, prefix, rebuild = rule
        current = (entity.get("attrs") or {}).get(attribute)
        if not isinstance(current, str) or not current.startswith(prefix):
            continue
        stem = Path(current).stem
        case.update_entity(entity["id"], {"attrs": {attribute: rebuild(stem)}})


def _name_notes_after_their_titles(case: "Case") -> None:
    """Make notes stop being named after their entity id.

    `notes/e_03aeb50d41.md` was visible and illegible — in the way without being
    readable. Every other document already follows "the name is the filename";
    notes were the only holdout, and only because they are generic entities with
    their path hardcoded rather than a tool of their own.

    Titles are not unique, so a collision inside one folder takes a numbered
    suffix, exactly as a new note would.

    An empty patch is the whole migration: `update_entity` already moves a note
    whose title or folder no longer matches its filename. Once moved, the
    current path is reserved for that note, so a resumed pass leaves the path
    and any collision suffix unchanged.
    """
    for entity in case.list_entities():
        if entity.get("type") == "note":
            case.update_entity(entity["id"], {})


def _leave_a_readme(case: "Case") -> None:
    """Teach a case that predates the free zone which half is whose.

    The wrapper gave the analyst the case root three schemas ago; nothing on
    disk told them. This is the step that does, and it is the only migration
    here that writes into their half of the folder rather than ours.
    """
    write_readme(case.path)


def _align_visible_names(case: "Case") -> None:
    """Make every analyst-visible filename stem the name Azimut displays.

    Uploads belong to the analyst, so their existing filename wins. Downloads,
    captures and derived media belong to an Azimut save gate, so their stored
    title wins and machine timestamps/remote ids remain provenance. Named
    documents run through their existing rename hooks, which also repairs a
    Details edit that changed only the graph label.
    """
    from .engine import media as media_engine

    media_engine.recover_media_rename(case)
    for item in list(case.list_media_items()):
        path = str(item.get("path") or "")
        if not path:
            continue
        source: dict[str, Any] = item["source"] if isinstance(item.get("source"), dict) else {}
        entity = case.find_entity(attr="path", value=path)
        if source.get("type") == "upload":
            desired = Path(path).stem
        else:
            desired = str(item.get("title") or (entity or {}).get("label") or Path(path).stem)
        # `Case.migrate` already owns the case lock. An older case cannot have
        # live work in this process; waiting here would deadlock a test that
        # deliberately rewinds a just-created case while its worker is draining.
        media_engine.rename_media(case, path, desired, settle_worker=False)

    for entity in list(case.list_entities()):
        if entity.get("type") in {"note", "proof", "inspect-session", "post"}:
            case.update_entity(entity["id"], {"label": entity.get("label") or ""})


def _normalize_case_layout(case: "Case") -> None:
    """Bring every unreleased folder checkpoint to the final layout.

    Schemas 4 through 7 were useful while building the layout, but no released
    Azimut wrote them. One normalizer accepts schema 3 and those development
    states, applies every operation in dependency order, then the runner stamps
    the current schema once. Each operation is idempotent, so an interrupted
    pass restarts here without guessing which line completed.
    """
    _wrap_case_folder(case)
    _flatten_trash(case)
    _hide_the_machinery(case)
    _name_notes_after_their_titles(case)
    _leave_a_readme(case)
    _align_visible_names(case)


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
