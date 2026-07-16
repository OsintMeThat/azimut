"""The derivation link layer (ONTOLOGY §3), and what deleting an entity means.

Every tool that files an artifact already knows the case paths it was made from
— a proof's panels, a post's proof, a frame's video. This module turns those
paths into typed edges in ``case.json`` so the chain becomes traversable: the
Details panel's relations, the derivation breadcrumbs and the dependency-aware
delete all read the same edges.

Two link types carry it, and the delete policy reads off the **link type**, not
off the producing tool, so a new tool inherits the right behaviour just by
picking one:

``derived-from`` (artifact → source)
    The artifact holds its own content — pixels, text — and still means
    something once the source is gone. Deleting the source leaves the artifact
    in place, with a tombstone recording what it came from.

``depends-on`` (session → subject)
    The artifact is nothing but a pointer at its subject: an Inspect session is
    a set of adjustments over a video, worthless without it. Deleting the
    subject deletes the session.

The test a new tool applies: *delete the target — is anything usable left in my
file?* Yes → ``derived-from``. No → ``depends-on``. Emitted at save time with
``status: "confirmed"``: a derivation is a mechanical fact of the analyst's own
click, not a tool's guess (ONTOLOGY §4).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..workspace import Case, CaseError

DERIVED_FROM = "derived-from"
DEPENDS_ON = "depends-on"

#: Incoming links of these types take their holder down with the target.
CASCADE_TYPES = (DEPENDS_ON,)
#: Incoming links of these types leave their holder in place, with a tombstone.
TOMBSTONE_TYPES = (DERIVED_FROM,)

#: ``attrs`` key holding the tombstones. Additive — schema stays 0.
LOST = "lost_sources"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _entity(case: Case, entity_id: str) -> dict[str, Any]:
    for entity in case.read()["entities"]:
        if entity["id"] == entity_id:
            return entity
    raise CaseError(f"entity '{entity_id}' not found")


def artifact_path(entity: dict[str, Any]) -> str | None:
    """The case-relative file an entity stands for, whichever attr holds it."""
    attrs = entity.get("attrs", {})
    for key in ("path", "spec", "draft"):
        if attrs.get(key):
            return attrs[key]
    return None


def resolve(case: Case, rel_paths: list[str]) -> tuple[list[str], list[str]]:
    """Map case-relative artifact paths to entity ids, in one read.

    Returns ``(entity_ids, unresolved_paths)``. A path resolves to nothing when
    its artifact was deleted while the tool that references it was open.
    """
    by_path: dict[str, str] = {}
    for entity in case.read()["entities"]:
        path = artifact_path(entity)
        if path:
            by_path.setdefault(path, entity["id"])
    found, missing = [], []
    for path in dict.fromkeys(p for p in rel_paths if p):
        if path in by_path:
            found.append(by_path[path])
        else:
            missing.append(path)
    return found, missing


def sync(
    case: Case, entity_id: str, type_: str, rel_paths: list[str], *, by: str
) -> None:
    """Restate an artifact's sources: reconcile its links, tombstone the rest.

    Called on every save, so a proof that loses a panel loses the matching edge
    and one saved three times still carries one edge per panel. A path that no
    longer resolves cannot be linked, but the fact that it was used is kept as a
    tombstone rather than dropped in silence.
    """
    found, missing = resolve(case, rel_paths)
    case.sync_links(entity_id, type_, found, by=by)
    for path in missing:
        add_tombstone(case, entity_id, {"path": path})


def link_all(
    case: Case, entity_id: str, type_: str, rel_paths: list[str], *, by: str
) -> None:
    """Add an artifact's source links without removing any (see ``sync``).

    For one-shot outputs that can dedupe onto an entity already in the case: the
    same bytes really can come from two different videos, and that entity keeps
    both derivations.
    """
    found, missing = resolve(case, rel_paths)
    for to_id in found:
        if to_id != entity_id:
            case.add_link(entity_id, to_id, type_, by=by, unique=True)
    for path in missing:
        add_tombstone(case, entity_id, {"path": path})


def tombstone_of(entity: dict[str, Any]) -> dict[str, Any]:
    """What a survivor keeps of a source about to be deleted (ONTOLOGY §4).

    The sha256 and the source URL are what make the loss auditable six months
    later: the artifact can still say which file it came from and where that
    file was fetched, even though the bytes are gone.
    """
    attrs = entity.get("attrs", {})
    fields = {
        "label": entity.get("label"),
        "type": entity.get("type"),
        "path": artifact_path(entity),
        "sha256": attrs.get("sha256"),
        "source_url": attrs.get("source_url")
        or entity.get("provenance", {}).get("source"),
    }
    return {k: v for k, v in fields.items() if v}


def add_tombstone(case: Case, entity_id: str, info: dict[str, Any]) -> None:
    """Record on an artifact that one of its sources is gone.

    Keyed by path, so re-saving or a second delete never stacks duplicates.
    """
    entity = _entity(case, entity_id)
    lost = list(entity.get("attrs", {}).get(LOST, []))
    if any(t.get("path") == info.get("path") for t in lost):
        return
    lost.append({**info, "at": info.get("at") or _now()})
    case.update_entity(entity_id, {"attrs": {LOST: lost}})


def losses(case: Case, doomed_ids: set[str]) -> dict[str, list[dict[str, Any]]]:
    """Per surviving artifact, the doomed sources it *actually* derives from.

    Scars belong only where the derivation was: a proof loses the media it was
    composed from, not whatever else happened to be deleted in the same breath.
    """
    data = case.read()
    by_id = {e["id"]: e for e in data["entities"]}
    out: dict[str, list[dict[str, Any]]] = {}
    for link in data["links"]:
        if (
            link["type"] in TOMBSTONE_TYPES
            and link["to"] in doomed_ids
            and link["from"] not in doomed_ids
            and link["to"] in by_id
        ):
            out.setdefault(link["from"], []).append(by_id[link["to"]])
    return out


def plan_delete(case: Case, entity_id: str) -> dict[str, list[dict[str, Any]]]:
    """What deleting ``entity_id`` takes with it, and what it leaves standing.

    ``cascade`` follows ``depends-on`` transitively (a session dies with its
    subject, and anything depending on that session follows) — never through
    ``derived-from``, which is the whole point: outputs outlive their sources.
    ``tombstone`` lists the artifacts that survive with a scar, computed over
    everything about to go, not just the entity that was asked for.
    """
    data = case.read()
    by_id = {e["id"]: e for e in data["entities"]}
    if entity_id not in by_id:
        raise CaseError(f"entity '{entity_id}' not found")

    doomed = [entity_id]
    frontier = [entity_id]
    while frontier:
        current = frontier.pop()
        for link in data["links"]:
            if (
                link["to"] == current
                and link["type"] in CASCADE_TYPES
                and link["from"] not in doomed
                and link["from"] in by_id
            ):
                doomed.append(link["from"])
                frontier.append(link["from"])

    scarred: list[str] = []
    for link in data["links"]:
        if (
            link["to"] in doomed
            and link["type"] in TOMBSTONE_TYPES
            and link["from"] not in doomed
            and link["from"] not in scarred
            and link["from"] in by_id
        ):
            scarred.append(link["from"])

    return {
        "cascade": [by_id[i] for i in doomed[1:]],
        "tombstone": [by_id[i] for i in scarred],
    }
