"""Deleting an artifact stops being final.

The live graph keeps hard-deleting. What a delete leaves behind is a journal
row holding the recipe to undo it, and the files moved aside into
``.trash/<group_id>/`` under their original case-relative names. Nothing else
in the app learns that a trash exists — no catalog query, no search, no picker,
no future tool has to remember to filter out deleted rows. That is the whole
reason a journal was chosen over a ``trashed`` status.

One row is one **delete action**, not one entity: deleting a video that carries
three Inspect sessions writes a single group, and restoring it brings the whole
cascade back at once.

What travels: everything the artifact registry says an entity owns. What does
not: thumbnails, which are a shared content-addressed cache — moving one aside
would blank a surviving row, so a delete drops it as before and a restore
re-queues it.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from ..workspace import Case, CaseError, _new_id, ensure_dir
from . import artifacts as artifact_engine
from . import links as link_engine
from . import thumbnails as thumbnail_engine


def _group_dir(case: Case, group_id: str) -> Path:
    """The directory one delete action's files wait in.

    Resolved through the case so a group id from a request can never address
    anything outside it.
    """
    if not group_id or "/" in group_id or "\\" in group_id or group_id.startswith("."):
        raise CaseError(f"invalid trash group '{group_id}'")
    from ..workspace import TRASH_DIR

    return case.resolve_inside(f"{TRASH_DIR}/{group_id}")


def _dir_size(path: Path) -> int:
    if not path.is_dir():
        return 0
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def _move(src: Path, dst: Path) -> None:
    """Move one path without ever overwriting an unrelated artifact."""
    ensure_dir(dst.parent)
    if dst.exists():
        raise CaseError(f"'{dst}' already exists")
    shutil.move(str(src), str(dst))


def collect_links(case: Case, entity_ids: set[str]) -> list[dict[str, Any]]:
    """Every link incident to the group, deduped — chain edges *and* relations.

    Relations are the loss nothing else records: a derivation leaves a tombstone
    on the survivor, but "this photo was shot at this place" vanishes without a
    trace. So the payload carries all of them, and a restore puts back whichever
    still has both ends.
    """
    seen: dict[str, dict[str, Any]] = {}
    for entity_id in entity_ids:
        for link in case.links_of(entity_id):
            seen[link["id"]] = link
    return list(seen.values())


def _travelling_files(case: Case, entities: list[dict[str, Any]]) -> list[str]:
    """Return existing owned paths without children already covered by a folder."""
    paths = list(
        dict.fromkeys(
            rel
            for entity in entities
            for rel in artifact_engine.owned(case, entity)
        )
    )
    kept: list[str] = []
    for rel in sorted(paths, key=lambda value: len(Path(value).parts)):
        parts = Path(rel).parts
        if any(parts[: len(Path(parent).parts)] == Path(parent).parts for parent in kept):
            continue
        kept.append(rel)
    return kept


def send(
    case: Case,
    entities: list[dict[str, Any]],
    tombstones: list[dict[str, Any]],
) -> dict[str, Any]:
    """Journal a delete before changing files, indexes or graph rows."""
    with case.lock:
        group_id = _new_id("t")
        root = _group_dir(case, group_id)
        ids = {e["id"] for e in entities}
        links = collect_links(case, ids)
        files = _travelling_files(case, entities)
        target = entities[0]
        payload = {
            "entities": entities,
            "links": links,
            "files": files,
            "tombstones": tombstones,
        }
        group = case.add_trash_group(
            group_id,
            label=str(target.get("label") or target.get("id")),
            type_=str(target.get("type") or ""),
            item_count=len(entities),
            size_bytes=0,
            payload=payload,
            state="preparing",
        )
        try:
            for entity in entities:
                artifact_engine.unfile(case, entity)
            for rel in files:
                source = case.resolve_inside(rel)
                if source.exists():
                    _move(source, root / rel)
            return case.update_trash_group(group_id, size_bytes=_dir_size(root))
        except Exception:
            _rollback_delete(case, group)
            raise


def commit(case: Case, group_id: str) -> dict[str, Any]:
    """Publish a fully completed delete in the user-visible trash."""
    with case.lock:
        return case.update_trash_group(group_id, state="ready")


def rollback(case: Case, group_id: str) -> None:
    """Undo a delete that did not reach its durable ready state."""
    with case.lock:
        group = case.get_trash_group(group_id)
        if group is not None:
            _rollback_delete(case, group)


def restore(case: Case, group_id: str) -> dict[str, Any]:
    """Put one delete action back, all of it or none.

    In this order, because the order is the correctness:

    1. every destination is checked free, then the files move back — a restore
       that would overwrite something refuses instead, naming the path, rather
       than renaming an artifact behind the analyst;
    2. the entities come back with their original ids, since the delete freed
       them and every recorded path still points at them;
    3. the links come back where both ends survived; the rest are counted and
       reported, not hidden;
    4. the tombstones this delete wrote on survivors are lifted;
    5. restored media are filed in the browse index again and their thumbnails
       re-queued, because a thumbnail was dropped rather than moved.
    """
    with case.lock:
        group = case.get_trash_group(group_id)
        if group is None or group.get("state") != "ready":
            raise CaseError(f"trash group '{group_id}' not found")
        payload = group.get("payload") or {}
        root = _group_dir(case, group_id)
        files: list[str] = list(payload.get("files") or [])
        occupied = [
            rel for rel in files
            if (root / rel).exists() and case.resolve_inside(rel).exists()
        ]
        if occupied:
            raise CaseError(
                f"'{occupied[0]}' is back in the case; rename or delete it before restoring"
            )
        group = case.update_trash_group(group_id, state="restoring")
        return _finish_restore(case, group)


def purge(case: Case, group_id: str) -> None:
    """Drop one group for good. The entity left the graph when it was deleted,
    so this is a directory and a row, never a second trip through the delete
    chokepoint."""
    with case.lock:
        group = case.get_trash_group(group_id)
        if group is None or group.get("state") != "ready":
            raise CaseError(f"trash group '{group_id}' not found")
        _drop_dir(case, group_id)
        case.remove_trash_group(group_id)


def empty(case: Case) -> int:
    """Purge every group. Returns how many were dropped."""
    with case.lock:
        ids = [group["id"] for group in case.list_trash()]
        for group_id in ids:
            purge(case, group_id)
        return len(ids)


def recover(case: Case) -> None:
    """Resolve interrupted filesystem operations whenever a case is opened."""
    with case.lock:
        for group in case.list_incomplete_trash():
            state = group.get("state")
            if state == "restoring":
                _finish_restore(case, group)
                continue
            if state != "preparing":
                raise CaseError(
                    f"trash group '{group['id']}' has an unknown state '{state}'"
                )
            entities = list((group.get("payload") or {}).get("entities") or [])
            if any(case.get_entity(entity["id"]) is not None for entity in entities):
                _rollback_delete(case, group)
            else:
                case.update_trash_group(group["id"], state="ready")


def _restore_files(case: Case, group: dict[str, Any]) -> None:
    payload = group.get("payload") or {}
    root = _group_dir(case, group["id"])
    for rel in payload.get("files") or []:
        source = root / rel
        destination = case.resolve_inside(rel)
        if source.exists():
            _move(source, destination)
        elif not destination.exists():
            raise CaseError(f"trash artifact '{rel}' is missing")


def _restore_records(case: Case, group: dict[str, Any]) -> dict[str, int]:
    payload = group.get("payload") or {}
    entities: list[dict[str, Any]] = list(payload.get("entities") or [])
    result = case.reinsert(entities, list(payload.get("links") or []))
    for scar in payload.get("tombstones") or []:
        link_engine.remove_tombstone(case, scar["entity"], scar["path"])
    for entity in entities:
        refiled = artifact_engine.refile(case, entity)
        if refiled:
            thumbnail_engine.enqueue(case, refiled)
    return result


def _finish_restore(case: Case, group: dict[str, Any]) -> dict[str, Any]:
    _restore_files(case, group)
    result = _restore_records(case, group)
    _drop_dir(case, group["id"])
    case.remove_trash_group(group["id"])
    return {"status": "restored", **result, "group": group["id"]}


def _rollback_delete(case: Case, group: dict[str, Any]) -> None:
    _restore_files(case, group)
    _restore_records(case, group)
    _drop_dir(case, group["id"])
    case.remove_trash_group(group["id"])


def _drop_dir(case: Case, group_id: str) -> None:
    """Remove one group's directory, and the trash root once it holds nothing —
    an emptied trash leaves a case exactly as it was born."""
    group = _group_dir(case, group_id)
    if group.exists():
        shutil.rmtree(group)
    root = case.trash_dir
    if root.is_dir() and not any(root.iterdir()):
        root.rmdir()
