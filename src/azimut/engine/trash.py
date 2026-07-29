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
    """Move a file or a directory, making room for it first.

    Windows cannot rename onto an existing directory and refuses to delete an
    open file, so the destination is cleared before the move rather than
    overwritten by it.
    """
    ensure_dir(dst.parent)
    if dst.exists():
        if dst.is_dir():
            shutil.rmtree(dst, ignore_errors=True)
        else:
            dst.unlink(missing_ok=True)
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


def send(
    case: Case,
    entities: list[dict[str, Any]],
    tombstones: list[dict[str, Any]],
) -> dict[str, Any]:
    """Move one delete action's artifacts aside and journal how to undo it.

    Called by the delete chokepoint once it has scarred the survivors, with the
    entities about to leave the graph and the tombstones it just wrote. The
    entities are still in the graph here, so their links can still be read.

    Returns the journal row.
    """
    group_id = _new_id("t")
    root = _group_dir(case, group_id)
    ids = {e["id"] for e in entities}
    links = collect_links(case, ids)

    moved: list[str] = []
    for entity in entities:
        for rel in artifact_engine.owned(case, entity):
            source = case.resolve_inside(rel)
            if not source.exists():
                continue
            _move(source, root / rel)
            moved.append(rel)

    target = entities[0]
    payload = {
        "entities": entities,
        "links": links,
        "files": moved,
        "tombstones": tombstones,
    }
    return case.add_trash_group(
        group_id,
        label=str(target.get("label") or target.get("id")),
        type_=str(target.get("type") or ""),
        item_count=len(entities),
        size_bytes=_dir_size(root),
        payload=payload,
    )


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
    group = case.get_trash_group(group_id)
    if group is None:
        raise CaseError(f"trash group '{group_id}' not found")
    payload = group.get("payload") or {}
    root = _group_dir(case, group_id)

    files: list[str] = list(payload.get("files") or [])
    occupied = [rel for rel in files if case.resolve_inside(rel).exists()]
    if occupied:
        raise CaseError(
            f"'{occupied[0]}' is back in the case; rename or delete it before restoring"
        )
    for rel in files:
        source = root / rel
        if source.exists():
            _move(source, case.resolve_inside(rel))

    entities: list[dict[str, Any]] = list(payload.get("entities") or [])
    result = case.reinsert(entities, list(payload.get("links") or []))

    for scar in payload.get("tombstones") or []:
        link_engine.remove_tombstone(case, scar["entity"], scar["path"])

    for entity in entities:
        refiled = artifact_engine.refile(case, entity)
        if refiled:
            thumbnail_engine.enqueue(case, refiled)

    _drop_dir(case, group_id)
    case.remove_trash_group(group_id)
    return {"status": "restored", **result, "group": group_id}


def purge(case: Case, group_id: str) -> None:
    """Drop one group for good. The entity left the graph when it was deleted,
    so this is a directory and a row, never a second trip through the delete
    chokepoint."""
    if case.get_trash_group(group_id) is None:
        raise CaseError(f"trash group '{group_id}' not found")
    _drop_dir(case, group_id)
    case.remove_trash_group(group_id)


def empty(case: Case) -> int:
    """Purge every group. Returns how many were dropped."""
    ids = case.clear_trash()
    for group_id in ids:
        _drop_dir(case, group_id)
    return len(ids)


def _drop_dir(case: Case, group_id: str) -> None:
    """Remove one group's directory, and the trash root once it holds nothing —
    an emptied trash leaves a case exactly as it was born."""
    shutil.rmtree(_group_dir(case, group_id), ignore_errors=True)
    root = case.trash_dir
    if root.is_dir() and not any(root.iterdir()):
        root.rmdir()
