"""What every case route needs, and the delete chokepoint they all go through.

`get_case` is the 404 boundary: every route in this package and several outside it
(`api/media.py`, `api/proofs.py`, `api/inspect.py`, …) open a case through it, so a
missing case answers the same way everywhere.

The deep deletes are here for the same reason. Removing an entity is never one row:
what cannot outlive it goes too, its files move to the trash, and the links it stood
in leave tombstones. That recipe is stated once and imported, rather than
re-derived per surface.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from ...engine import entities as entity_engine
from ...engine import links as link_engine
from ...engine import sheets as sheet_engine
from ...engine import timeline as timeline_engine
from ...engine import trash as trash_engine
from ...engine.temporal import TemporalError, window_bound
from ...workspace import Case, CaseError


def get_case(case_id: str) -> Case:
    try:
        return Case.open(case_id)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

def delete_entities_deep(case: Case, entity_ids: list[str]) -> dict[str, Any]:
    """Delete one UI action and everything that cannot outlive its targets.

    The one door every delete goes through — sidebar, Media Library, a tool's
    own list — so the rules hold wherever the click came from:

    - artifacts that ``depends-on`` the target die with it (an Inspect session
      is only adjustments over a video), transitively;
    - artifacts ``derived-from`` it are never touched, and are scarred with a
      tombstone first, while the target can still describe itself.

    The whole action lands in the trash as one group, so undoing it brings the
    cascade back together or not at all. The graph rows are still hard-deleted:
    what is kept is the recipe, not a hidden state every other query would have
    to filter out.
    """
    with case.lock:
        going_by_id: dict[str, dict[str, Any]] = {}
        tombstoned: set[str] = set()
        for entity_id in dict.fromkeys(entity_ids):
            plan = link_engine.plan_delete(case, entity_id)
            target = case.get_entity(entity_id)
            if target is None:
                raise CaseError(f"entity '{entity_id}' not found")
            for entity in (target, *plan["cascade"]):
                going_by_id[entity["id"]] = entity
            tombstoned.update(entity["id"] for entity in plan["tombstone"])
        going = list(going_by_id.values())

        scars: list[dict[str, str]] = []
        losses = link_engine.losses(case, {e["id"] for e in going})
        for survivor_id, lost_sources in losses.items():
            survivor = case.get_entity(survivor_id)
            existing = {
                item.get("path")
                for item in (survivor or {}).get("attrs", {}).get(link_engine.LOST, [])
            }
            for lost in lost_sources:
                path = link_engine.tombstone_of(lost).get("path")
                if path and path not in existing:
                    scars.append({"entity": survivor_id, "path": path})
                    existing.add(path)

        group = trash_engine.send(case, going, scars)
        try:
            for survivor_id, lost_sources in losses.items():
                link_engine.add_tombstones(
                    case,
                    survivor_id,
                    [link_engine.tombstone_of(source) for source in lost_sources],
                )
            for entity in going:
                if case.get_entity(entity["id"]) is not None:
                    case.remove_entity(entity["id"])
            trash_engine.commit(case, group["id"])
        except Exception:
            trash_engine.rollback(case, group["id"])
            raise

        # A sheet points at the case through ids in a sidecar rather than through edges,
        # so nothing above reaches them: a cell would stay marked as linked to a row the
        # case no longer holds, and the next save would write the dead id back. Cleared
        # here, which is the one door every delete comes through.
        #
        # **After the commit, and outside the rollback.** A sidecar is a file and the
        # rollback restores the graph and the trash, so clearing them inside it meant a
        # refused delete gave the entities back with the sheets' links, vocabularies and
        # attached pieces already gone for good. Past the commit there is nothing left to
        # roll back, which is what makes this the safe side of the line.
        sheet_engine.forget_entities(case, set(going_by_id))

        return {
            "status": "deleted",
            "deleted": [e["id"] for e in going],
            "tombstoned": sorted(tombstoned - set(going_by_id)),
            "trash": group["id"],
        }

def delete_entity_deep(case: Case, entity_id: str) -> dict[str, Any]:
    return delete_entities_deep(case, [entity_id])

def _summary(entity: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entity["id"],
        "type": entity.get("type"),
        "label": entity.get("label"),
        "path": link_engine.artifact_path(entity),
    }

def delete_by_path(case: Case, rel_path: str) -> dict[str, Any]:
    """Chokepoint entry for a tool that knows its artifact by path, not by id.

    Returns an empty ``deleted`` when no entity claims the path: the artifact was
    never filed, so there is no graph to honour and the caller drops the files
    itself.
    """
    entity = (
        case.find_entity(attr="path", value=rel_path)
        or case.find_entity(attr="spec", value=rel_path)
        or case.find_entity(attr="draft", value=rel_path)
    )
    if entity is None:
        return {"status": "deleted", "deleted": [], "tombstoned": []}
    return delete_entity_deep(case, entity["id"])

def _check_attrs(
    type_: str,
    attrs: dict[str, Any],
    *,
    current: dict[str, Any] | None = None,
) -> None:
    """Refuse a malformed declared field with a 400, never a 404.

    Split out because the two write paths reach it from different places and the
    update path's own ``except CaseError`` answers 404 — a bad radius is a bad
    request, not a missing entity.
    """
    try:
        entity_engine.check_attrs(type_, attrs, current=current)
    except CaseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

def _timeline_bound(raw: str | None, *, upper: bool) -> str | None:
    if raw is None:
        return None
    try:
        return window_bound(raw, upper=upper)
    except TemporalError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

def _temporal_filter_args(
    from_: str | None,
    to: str | None,
    category: str | None,
) -> tuple[str | None, str | None, list[str] | None]:
    """Validate the fact-time window kept separate from filing dates."""
    if from_ is None and to is None:
        return None, None, None
    if from_ is None or to is None:
        raise HTTPException(status_code=400, detail="a temporal filter needs both boundaries")
    since = _timeline_bound(from_, upper=False)
    until = _timeline_bound(to, upper=True)
    if since is not None and until is not None and since >= until:
        raise HTTPException(status_code=400, detail="the temporal filter ends before it starts")
    categories = (
        list(dict.fromkeys(part.strip() for part in category.split(",") if part.strip()))
        if category is not None
        else list(timeline_engine.DEFAULT_CATEGORIES)
    )
    invalid = sorted(set(categories) - set(timeline_engine.ALL_CATEGORIES))
    if invalid:
        raise HTTPException(status_code=400, detail=f"unknown timeline category '{invalid[0]}'")
    if not categories:
        raise HTTPException(status_code=400, detail="a temporal filter needs a category")
    return since, until, categories
