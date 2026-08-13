"""Read-only case diagnostics and explicit, narrowly-scoped repairs."""

from __future__ import annotations

import json
import shutil
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Iterator

from .. import layout
from ..sqlite_backend import SqliteCase
from ..workspace import Case, CaseError, ensure_dir
from . import media as media_engine

DATABASE_MISSING = "database-missing"
DATABASE_UNREADABLE = "database-unreadable"
MEDIA_MISSING = "media-missing"
MEDIA_UNKNOWN = "media-unknown"
TEMPORAL_INDEX_STALE = "temporal-index-stale"


def _media_files(case: Case) -> Iterator[Path]:
    """Visible files the media pipeline can adopt, without creating folders."""
    directory = case.media_dir
    if not directory.is_dir():
        return
    for path in sorted(directory.iterdir(), key=lambda item: item.name.casefold()):
        if path.is_file() and not path.is_symlink() and not path.name.startswith("."):
            yield path


def _media_entities(case: Case) -> Iterator[dict[str, Any]]:
    cursor: str | None = None
    while True:
        page = case.page_entities(
            limit=500,
            cursor=cursor,
            types=["media", "capture"],
        )
        yield from page["items"]
        cursor = page.get("next_cursor")
        if cursor is None:
            return


def _database_issue(*, unreadable: str | None = None) -> dict[str, Any]:
    if unreadable is not None:
        return {
            "id": DATABASE_UNREADABLE,
            "kind": DATABASE_UNREADABLE,
            "severity": "error",
            "title": "Case database cannot be read",
            "detail": unreadable,
            "actions": [],
        }
    return {
        "id": DATABASE_MISSING,
        "kind": DATABASE_MISSING,
        "severity": "error",
        "title": "Case database is missing",
        "detail": (
            "Azimut can rebuild media, notes and proofs from their files and sidecars."
        ),
        # What a rebuild costs, stated before it is chosen. Every line is case
        # state that lives only in `case.db`: the rebuild reads files, and these
        # were never written to one. A new table that cannot be read back from
        # disk belongs here, or the app is asking for a yes it has not earned.
        "losses": [
            "Relations between entities",
            "Catalog filing folders",
            "Provenance that was not stored in a sidecar",
            "Entity photo galleries, and the photos added from the computer",
            "Saved analysis views",
            "The graph arrangement, per lens",
        ],
        "actions": [{"id": "rebuild", "label": "Rebuild database", "tone": "primary"}],
    }


def scan(case: Case) -> dict[str, Any]:
    """Inspect one case without changing its filesystem or database."""
    manifest = case.read()
    if not case.db_path.is_file():
        return _report(case, manifest, [_database_issue()])

    try:
        entities = list(_media_entities(case))
        temporal_status = case.temporal_projection_status()
    except (CaseError, OSError, sqlite3.Error) as exc:
        return _report(case, manifest, [_database_issue(unreadable=str(exc))])

    known_paths = {
        str((entity.get("attrs") or {}).get("path"))
        for entity in entities
        if (entity.get("attrs") or {}).get("path")
    }
    unknown_paths = [
        path.relative_to(case.tool_root).as_posix()
        for path in _media_files(case)
        if path.relative_to(case.tool_root).as_posix() not in known_paths
    ]

    issues: list[dict[str, Any]] = []
    if not temporal_status["consistent"]:
        issues.append(
            {
                "id": TEMPORAL_INDEX_STALE,
                "kind": TEMPORAL_INDEX_STALE,
                "severity": "warning",
                "title": "Timeline index is out of date",
                "detail": "The index does not match the case's Claims and media metadata.",
                "expected": temporal_status["expected"],
                "actual": temporal_status["actual"],
                "actions": [
                    {
                        "id": "rebuild-timeline",
                        "label": "Rebuild Timeline index",
                        "tone": "primary",
                    }
                ],
            }
        )
    for entity in entities:
        rel_path = str((entity.get("attrs") or {}).get("path") or "")
        if rel_path and not case.resolve_inside(rel_path).is_file():
            issues.append(
                {
                    "id": f"{MEDIA_MISSING}:{entity['id']}",
                    "kind": MEDIA_MISSING,
                    "severity": "warning",
                    "state": "missing",
                    "title": f"{entity.get('label') or 'Media'} is missing",
                    "detail": rel_path,
                    "entity_id": entity["id"],
                    "path": rel_path,
                    "replacements": unknown_paths,
                    "actions": [
                        {"id": "relink", "label": "Use replacement", "tone": "primary"},
                        {"id": "drop", "label": "Remove record", "tone": "danger"},
                    ],
                }
            )

    for rel_path in unknown_paths:
        issues.append(
            {
                "id": f"{MEDIA_UNKNOWN}:{rel_path}",
                "kind": MEDIA_UNKNOWN,
                "severity": "info",
                "title": f"{Path(rel_path).stem} is not imported",
                "detail": rel_path,
                "path": rel_path,
                "actions": [{"id": "import", "label": "Import file", "tone": "primary"}],
            }
        )
    return _report(case, manifest, issues)


def _report(case: Case, manifest: dict[str, Any], issues: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "case_id": case.id,
        "case_name": manifest.get("name", case.id),
        "scratch": case.is_scratch,
        "status": "issues" if issues else "healthy",
        "summary": {
            "errors": sum(issue["severity"] == "error" for issue in issues),
            "warnings": sum(issue["severity"] == "warning" for issue in issues),
            "info": sum(issue["severity"] == "info" for issue in issues),
        },
        "issues": issues,
    }


def _sidecar(case: Case, rel_path: str) -> dict[str, Any]:
    try:
        item = media_engine.read_item(case, rel_path)
    except (OSError, json.JSONDecodeError, CaseError):
        item = None
    return item or {}


def _capture_attrs(source: dict[str, Any]) -> dict[str, Any]:
    keys = ("coords", "lat", "lon", "plus_code", "zoom", "bearing", "provider")
    return {key: source[key] for key in keys if source.get(key) is not None}


def rebuild_database(case: Case) -> dict[str, Any]:
    """Rebuild only file-backed entities, then atomically install the database."""
    with case.lock:
        if case.db_path.exists():
            raise CaseError("the case database already exists")
        manifest = case.read()
        ensure_dir(case.db_path.parent)
        staging = case.db_path.with_name(f".{case.db_path.name}.doctor-{uuid.uuid4().hex}.tmp")
        counts = {"media": 0, "notes": 0, "proofs": 0}
        try:
            store = SqliteCase.create(
                staging,
                name=str(manifest.get("name") or case.id),
                created_at=manifest.get("created_at"),
                updated_at=manifest.get("updated_at"),
            )
            for path in _media_files(case):
                rel_path = path.relative_to(case.tool_root).as_posix()
                previous = _sidecar(case, rel_path)
                source = previous.get("source")
                if not isinstance(source, dict):
                    source = {"type": "manual", "original_name": path.name}
                digest = media_engine.sha256_file(path)
                kind = media_engine.media_kind(path.name)
                item = {
                    **previous,
                    "filename": path.name,
                    "title": path.stem,
                    "kind": kind,
                    "sha256": digest,
                    "size": path.stat().st_size,
                    "added_at": previous.get("added_at") or manifest.get("updated_at"),
                    "source": source,
                    "thumbnail": previous.get("thumbnail"),
                    "path": rel_path,
                }
                entity_type = "capture" if source.get("type") == "satellite" else "media"
                attrs = {"path": rel_path, "sha256": digest, "kind": kind}
                if source.get("url"):
                    attrs["source_url"] = source["url"]
                if entity_type == "capture":
                    attrs.update(_capture_attrs(source))
                entity = store.add_entity(
                    entity_type,
                    path.stem,
                    attrs,
                    by="case-doctor",
                    source=source.get("url"),
                )
                store.upsert_media_item(item, entity_id=entity["id"])
                counts["media"] += 1

            notes = case.note_dir
            if notes.is_dir():
                for path in sorted(notes.rglob("*.md")):
                    if path.is_symlink():
                        continue
                    rel_path = path.relative_to(case.tool_root).as_posix()
                    folder = path.parent.relative_to(notes).as_posix()
                    store.add_entity(
                        "note",
                        path.stem,
                        {"path": rel_path, "folder": "" if folder == "." else folder},
                        by="case-doctor",
                    )
                    counts["notes"] += 1

            proof_meta = case.resolve_inside(f"proofs/{layout.META_DIR}")
            if proof_meta.is_dir():
                for path in sorted(proof_meta.glob("*.json")):
                    if path.is_symlink():
                        continue
                    try:
                        spec = json.loads(path.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        continue
                    if spec.get("azimut_proof") != 1:
                        continue
                    attrs = {"spec": layout.proof_spec_rel(path.stem)}
                    png = case.resolve_inside(layout.proof_export_rel(path.stem))
                    if png.is_file():
                        attrs["path"] = layout.proof_export_rel(path.stem)
                    store.add_entity("proof", path.stem, attrs, by="case-doctor")
                    counts["proofs"] += 1

            staging.replace(case.db_path)
        except BaseException:
            for path in (staging, Path(f"{staging}-wal"), Path(f"{staging}-shm")):
                path.unlink(missing_ok=True)
            raise
        _drop_orphaned_entity_photos(case)
        return {"status": "rebuilt", "counts": counts}


def _drop_orphaned_entity_photos(case: Case) -> None:
    """Remove the private photos the rebuilt database can no longer own.

    A photo added from the computer is bytes under `.data/entity-images/` plus a
    row saying which entity shows it. The rebuild reads files, and that row was
    never in one, so it does not come back — and the bytes left behind would be
    files nothing displays, nothing deletes and every later bundle still carries.
    The dialog names this loss before the analyst chooses the repair.

    After the database is installed, never before: a crash between the two leaves
    the case exactly as it was, with the photos and no database, and the next run
    starts over.
    """
    shutil.rmtree(layout.entity_images(case.path), ignore_errors=True)


def require_missing_media(case: Case, entity_id: str) -> dict[str, Any]:
    entity = case.get_entity(entity_id)
    if entity is None or entity.get("type") not in {"media", "capture"}:
        raise CaseError(f"media entity '{entity_id}' not found")
    rel_path = str((entity.get("attrs") or {}).get("path") or "")
    if not rel_path or case.resolve_inside(rel_path).is_file():
        raise CaseError(f"media entity '{entity_id}' is not missing")
    return entity


def require_unknown_media(case: Case, rel_path: str) -> Path:
    raw_path = case.tool_root / rel_path
    path = case.resolve_inside(rel_path)
    if (
        raw_path.is_symlink()
        or path.parent.resolve() != case.media_dir.resolve()
        or not path.is_file()
    ):
        raise CaseError("the file is not an unknown media file")
    if case.find_entity(attr="path", value=rel_path) is not None:
        raise CaseError(f"media '{rel_path}' is already registered")
    return path


def require_stale_temporal_projection(case: Case) -> None:
    """Refuse a Timeline repair unless the read-only check currently offers it."""
    if case.temporal_projection_status()["consistent"]:
        raise CaseError("the Timeline index is already current")
