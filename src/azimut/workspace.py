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
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from . import config

CASE_SUBDIRS = ("media", "proofs", "exports", "inspect")

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

EntityStatus = Literal["confirmed", "suggested"]

# Extensible vocabulary (spec §5); free strings are accepted, these are the
# well-known ones the UI knows how to render.
ENTITY_TYPES = (
    "person", "organization", "alias", "account", "email", "phone", "domain",
    "ip", "vehicle", "place", "capture", "event", "media", "proof", "note",
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


class Case:
    """Handle over one case directory. All reads/writes go through here."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = _case_lock(path)

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
        case._write_json(
            {
                "azimut": {"schema": 1},
                "name": name,
                "created_at": _now(),
                "updated_at": _now(),
                "folders": [],
                "entities": [],
                "links": [],
            }
        )
        (path / "notes.md").write_text(f"# {name}\n\n", encoding="utf-8")
        return case

    @classmethod
    def open(cls, case_id: str) -> "Case":
        for parent in (config.cases_dir(), config.scratch_dir()):
            path = parent / case_id
            if (path / "case.json").exists():
                return cls(path)
        raise CaseError(f"case '{case_id}' not found")

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
                out.append(
                    {
                        "id": case.id,
                        "name": data.get("name", case.id),
                        "scratch": scratch,
                        "created_at": data.get("created_at"),
                        "updated_at": data.get("updated_at"),
                        "entity_count": len(data.get("entities", [])),
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
        with self._lock:
            data = self.read()
            entity = {
                "id": _new_id("e"),
                "type": type_,
                "label": label,
                "attrs": attrs or {},
                "provenance": {"by": by, "at": _now(), "status": status},
            }
            if source:
                entity["provenance"]["source"] = source
            data["entities"].append(entity)
            self._write_json(data)
            return entity

    def update_entity(self, entity_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            data = self.read()
            for entity in data["entities"]:
                if entity["id"] == entity_id:
                    for key in ("type", "label"):
                        if key in patch:
                            entity[key] = patch[key]
                    if "attrs" in patch:
                        entity["attrs"].update(patch["attrs"])
                    if patch.get("status") in ("confirmed", "suggested"):
                        entity["provenance"]["status"] = patch["status"]
                    self._write_json(data)
                    return entity
            raise CaseError(f"entity '{entity_id}' not found")

    def remove_entity(self, entity_id: str) -> None:
        with self._lock:
            data = self.read()
            before = len(data["entities"])
            data["entities"] = [e for e in data["entities"] if e["id"] != entity_id]
            if len(data["entities"]) == before:
                raise CaseError(f"entity '{entity_id}' not found")
            data["links"] = [
                l for l in data["links"] if entity_id not in (l["from"], l["to"])
            ]
            self._write_json(data)

    def find_entity(self, *, attr: str, value: Any) -> dict[str, Any] | None:
        for entity in self.read()["entities"]:
            if entity["attrs"].get(attr) == value:
                return entity
        return None

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
        with self._lock:
            data = self.read()
            ids = {e["id"] for e in data["entities"]}
            for eid in (from_id, to_id):
                if eid not in ids:
                    raise CaseError(f"entity '{eid}' not found")
            if unique:
                for existing in data["links"]:
                    if (existing["from"], existing["to"], existing["type"]) == (
                        from_id,
                        to_id,
                        type_,
                    ):
                        return existing
            link = {
                "id": _new_id("l"),
                "from": from_id,
                "to": to_id,
                "type": type_,
                "provenance": {"by": by, "at": _now(), "status": status},
            }
            data["links"].append(link)
            self._write_json(data)
            return link

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
        with self._lock:
            data = self.read()
            ids = {e["id"] for e in data["entities"]}
            if from_id not in ids:
                raise CaseError(f"entity '{from_id}' not found")
            wanted = [
                i for i in dict.fromkeys(to_ids) if i in ids and i != from_id
            ]
            mine = {
                l["to"]: l
                for l in data["links"]
                if l["from"] == from_id and l["type"] == type_
            }
            keep = {mine[to_id]["id"] for to_id in wanted if to_id in mine}
            data["links"] = [
                l
                for l in data["links"]
                if l["from"] != from_id or l["type"] != type_ or l["id"] in keep
            ]
            for to_id in wanted:
                if to_id not in mine:
                    data["links"].append(
                        {
                            "id": _new_id("l"),
                            "from": from_id,
                            "to": to_id,
                            "type": type_,
                            "provenance": {"by": by, "at": _now(), "status": status},
                        }
                    )
            self._write_json(data)
            return [l for l in data["links"] if l["from"] == from_id and l["type"] == type_]

    def remove_link(self, link_id: str) -> None:
        with self._lock:
            data = self.read()
            before = len(data["links"])
            data["links"] = [l for l in data["links"] if l["id"] != link_id]
            if len(data["links"]) == before:
                raise CaseError(f"link '{link_id}' not found")
            self._write_json(data)

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
        return self.read().get("folders", [])

    def add_folder(self, name: str) -> list[str]:
        path = self._normalize_folder(name)
        with self._lock:
            data = self.read()
            folders = data.setdefault("folders", [])
            # materialise the leaf and every ancestor so the tree stays connected
            segments = path.split("/")
            changed = False
            for i in range(1, len(segments) + 1):
                ancestor = "/".join(segments[:i])
                if ancestor not in folders:
                    folders.append(ancestor)
                    changed = True
            if changed:
                folders.sort(key=str.lower)
                self._write_json(data)
            return data["folders"]

    def remove_folder(self, name: str) -> list[str]:
        with self._lock:
            data = self.read()
            folders = data.setdefault("folders", [])
            # a folder and its whole subtree go together
            prefix = name + "/"
            doomed = {f for f in folders if f == name or f.startswith(prefix)}
            data["folders"] = [f for f in folders if f not in doomed]
            # unassign any entity filed under a removed node (or its descendants)
            for entity in data.get("entities", []):
                folder = entity.get("attrs", {}).get("folder")
                if folder is not None and (folder == name or folder.startswith(prefix)):
                    entity["attrs"].pop("folder", None)
            self._write_json(data)
            return data["folders"]

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
