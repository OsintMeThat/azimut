"""The derivation link layer (ONTOLOGY §3), and what deleting an entity means.

Every tool that files an artifact already knows the case paths it was made from:
a proof's panels, a post's proof or a frame's video. This module turns those
paths into typed edges in the case graph so the chain becomes traversable. The
Details panel, derivation breadcrumbs and dependency-aware delete all read the
same edges.

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

Everything else is a **relation**: a statement about the world rather than about
how a file was made. ``RELATION_TYPES`` below is the registry the UI offers and
the API validates against, so one vocabulary serves the Details panel, the map
and the case board rather than one per tool.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from ..repository import CaseRepository
from ..workspace import CaseError

DERIVED_FROM = "derived-from"
DEPENDS_ON = "depends-on"

#: The two link types the derivation chain reads, in either direction.
CHAIN_TYPES = (DERIVED_FROM, DEPENDS_ON)
#: Incoming links of these types take their holder down with the target.
CASCADE_TYPES = (DEPENDS_ON,)
#: Incoming links of these types leave their holder in place, with a tombstone.
TOMBSTONE_TYPES = (DERIVED_FROM,)

#: ``attrs`` key holding the tombstones. Additive — schema stays 0.
LOST = "lost_sources"

# -- relations: the non-chain edges (ONTOLOGY §3) -----------------------------
#
# A relation says something about the world — this photo was shot there, these
# two files are the same picture — where a chain edge says something about how a
# file was produced. Nothing here cascades a delete or leaves a tombstone:
# removing either endpoint just drops the edge.

LOCATED_AT = "located-at"
SAME_IMAGE_AS = "same-image-as"
DEPICTS = "depicts"


@dataclass(frozen=True)
class RelationType:
    """One relation the vocabulary knows, and what it may join.

    ``from_types``/``to_types`` are the entity types each end accepts, so the
    picker can only offer edges the ontology has a reading for and the API can
    refuse the rest. ``label`` completes the sentence *"<from> … <to>"* and is
    what every surface displays instead of the type slug. ``manual`` is whether
    an analyst may state it: some relations are only ever a machine's claim.
    """

    type: str
    label: str
    from_types: frozenset[str]
    to_types: frozenset[str]
    manual: bool = True


#: The relation vocabulary, in menu order. Deliberately not every type in the
#: ONTOLOGY §3 table: a type reaches this tuple once an entity type exists at both
#: ends, so nothing is offered that cannot be filed.
RELATION_TYPES: tuple[RelationType, ...] = (
    RelationType(
        LOCATED_AT,
        "was shot at",
        from_types=frozenset({"media", "capture"}),
        to_types=frozenset({"place"}),
    ),
    RelationType(
        DEPICTS,
        "shows",
        from_types=frozenset({"media", "capture"}),
        to_types=frozenset({"place"}),
    ),
    # Enrichment's own claim: two files whose perceptual hashes are within
    # DHASH_MATCH bits. Named here so the UI can say it in words, never offered
    # by hand — a person comparing two pictures is not measuring a hash.
    RelationType(
        SAME_IMAGE_AS,
        "is the same picture as",
        from_types=frozenset({"media"}),
        to_types=frozenset({"media"}),
        manual=False,
    ),
)


def relation_type(type_: str) -> RelationType | None:
    """The registry entry for a relation type, or None if it has no reading."""
    return next((entry for entry in RELATION_TYPES if entry.type == type_), None)


def add_relation(
    case: CaseRepository, from_id: str, to_id: str, type_: str, *, by: str
) -> dict[str, Any]:
    """State one relation between two entities, as the analyst's own claim.

    ``status`` is always ``confirmed``: a suggestion is what a tool proposes for
    review (ONTOLOGY §4), so an analyst clicking "relate these" would have
    nothing left to review. Chain types are refused — a derivation is recorded by
    the save that produced it, never asserted after the fact — and so is any pair
    the registry has no reading for. Repeats are idempotent rather than stacked.
    """
    spec = _statable(type_)
    if from_id == to_id:
        raise CaseError("an entity cannot relate to itself")
    _check_endpoints(case, spec, from_id, to_id)
    return case.add_link(from_id, to_id, type_, by=by, unique=True)


def set_relation_type(case: CaseRepository, link_id: str, type_: str) -> dict[str, Any]:
    """Correct which relation an existing edge states.

    The same two entities, a different reading — "shows this place" where the
    analyst first said "was shot at" — so it is one edge corrected rather than a
    delete and a re-statement, and the wrong reading leaves no trace. Same
    validation as stating one, plus a refusal to collapse onto a relation the pair
    already holds.
    """
    spec = _statable(type_)
    link = case.get_link(link_id)
    if link is None:
        raise CaseError(f"link '{link_id}' not found")
    _statable(link["type"])  # a machine's claim is not the analyst's to reword
    _check_endpoints(case, spec, link["from"], link["to"])
    twin = any(
        other["id"] != link_id
        and other["from"] == link["from"]
        and other["to"] == link["to"]
        and other["type"] == type_
        for other in case.links_of(link["from"])
    )
    if twin:
        raise CaseError("those two already hold that relation")
    return case.update_link(link_id, {"type": type_})


def confirm_relation(case: CaseRepository, link_id: str) -> dict[str, Any]:
    """Accept a proposed relation, and with it the entities it joins.

    The two halves of an enrichment suggestion are one claim: "this file was shot
    at this point" cannot be true while the point itself is still only proposed.
    So confirming the edge confirms whichever endpoint is still `suggested` — the
    mirror of confirming an entity, which confirms its incident suggestions
    (api/cases.update_entity). Without both directions the Suggestions list and
    the relation rows disagree about the same click.
    """
    link = case.get_link(link_id)
    if link is None:
        raise CaseError(f"link '{link_id}' not found")
    for endpoint in (link["from"], link["to"]):
        entity = case.get_entity(endpoint)
        if entity is not None and entity["provenance"]["status"] == "suggested":
            case.update_entity(endpoint, {"status": "confirmed"})
    return case.update_link(link_id, {"status": "confirmed"})


def remove_relation(case: CaseRepository, link_id: str) -> None:
    """Take back one relation.

    Chain edges are refused here as they are everywhere else in this module: a
    derivation is recorded by the save that produced it, and dropping one behind
    the delete path would lose it without the tombstone `losses` relies on
    (``TOMBSTONE_TYPES``). A relation, by contrast, is a statement, and taking a
    statement back is the only way to correct one.
    """
    link = case.get_link(link_id)
    if link is None:
        raise CaseError(f"link '{link_id}' not found")
    if link["type"] in CHAIN_TYPES:
        raise CaseError(f"'{link['type']}' is a derivation, not a relation to take back")
    case.remove_link(link_id)


def confirm_incident_relations(case: CaseRepository, entity_id: str) -> None:
    """Accept the suggestions hanging off an entity the analyst just confirmed.

    The mirror of :func:`confirm_relation`, and it has to carry the same
    invariant: an edge is confirmed together with the entity at its far end, or
    the map still chips a point "suggested" while the relation row beside it reads
    as a finding. One hop only — accepting a photo's own point is a reading of
    that photo, not a licence to accept whatever that point was separately
    proposed to be.
    """
    for link in case.links_of(entity_id):
        if link["provenance"]["status"] != "suggested":
            continue
        far = link["to"] if link["from"] == entity_id else link["from"]
        neighbour = case.get_entity(far)
        if neighbour is not None and neighbour["provenance"]["status"] == "suggested":
            case.update_entity(far, {"status": "confirmed"})
        case.update_link(link["id"], {"status": "confirmed"})


def _statable(type_: str) -> RelationType:
    spec = relation_type(type_)
    if spec is None or not spec.manual:
        raise CaseError(f"'{type_}' is not a relation the analyst can state")
    return spec


def _check_endpoints(
    case: CaseRepository, spec: RelationType, from_id: str, to_id: str
) -> None:
    source, target = _entity(case, from_id), _entity(case, to_id)
    if source["type"] not in spec.from_types:
        raise CaseError(f"a {source['type']} cannot be the subject of '{spec.type}'")
    if target["type"] not in spec.to_types:
        raise CaseError(f"a {target['type']} cannot be the object of '{spec.type}'")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _entity(case: CaseRepository, entity_id: str) -> dict[str, Any]:
    entity = case.get_entity(entity_id)
    if entity is None:
        raise CaseError(f"entity '{entity_id}' not found")
    return entity


def artifact_path(entity: dict[str, Any]) -> str | None:
    """The case-relative file an entity stands for, whichever attr holds it."""
    attrs = entity.get("attrs", {})
    for key in ("path", "spec", "draft"):
        if attrs.get(key):
            return attrs[key]
    return None


def resolve(case: CaseRepository, rel_paths: list[str]) -> tuple[list[str], list[str]]:
    """Map case-relative artifact paths to entity ids, in one read.

    Returns ``(entity_ids, unresolved_paths)``. A path resolves to nothing when
    its artifact was deleted while the tool that references it was open.
    """
    by_path: dict[str, str] = {}
    for entity in case.list_entities():
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
    case: CaseRepository, entity_id: str, type_: str, rel_paths: list[str], *, by: str
) -> None:
    """Restate an artifact's sources: reconcile its links, tombstone the rest.

    Called on every save, so a proof that loses a panel loses the matching edge
    and one saved three times still carries one edge per panel. A path that no
    longer resolves cannot be linked, but the fact that it was used is kept as a
    tombstone rather than dropped in silence.
    """
    found, missing = resolve(case, rel_paths)
    case.sync_links(entity_id, type_, found, by=by)
    add_tombstones(case, entity_id, [{"path": path} for path in missing])


def link_all(
    case: CaseRepository, entity_id: str, type_: str, rel_paths: list[str], *, by: str
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
    add_tombstones(case, entity_id, [{"path": path} for path in missing])


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


def add_tombstone(case: CaseRepository, entity_id: str, info: dict[str, Any]) -> bool:
    """Record on an artifact that one of its sources is gone.

    Keyed by path, so re-saving or a second delete never stacks duplicates.
    False means this scar was already there — which is what the trash needs to
    know, so an undo only lifts the scars its own delete wrote.
    """
    return bool(add_tombstones(case, entity_id, [info]))


def add_tombstones(
    case: CaseRepository, entity_id: str, infos: list[dict[str, Any]]
) -> list[str]:
    """Record several lost sources with one case read and at most one write.

    Returns the paths actually written, skipping the ones already scarred.
    """
    if not infos:
        return []
    entity = _entity(case, entity_id)
    lost = list(entity.get("attrs", {}).get(LOST, []))
    paths = {item.get("path") for item in lost}
    added: list[str] = []
    for info in infos:
        path = info.get("path")
        if path in paths:
            continue
        lost.append({**info, "at": info.get("at") or _now()})
        paths.add(path)
        added.append(str(path))
    if added:
        case.update_entity(entity_id, {"attrs": {LOST: lost}})
    return added


def remove_tombstone(case: CaseRepository, entity_id: str, path: str) -> None:
    """Lift a scar, because the source it recorded came back.

    Keyed by path like `add_tombstone`, and silent when the entity or the scar is
    already gone: restoring a group whose survivor was deleted in the meantime is
    not an error, there is simply nothing left to unscar.
    """
    entity = case.get_entity(entity_id)
    if entity is None:
        return
    lost = list(entity.get("attrs", {}).get(LOST, []))
    kept = [item for item in lost if item.get("path") != path]
    if len(kept) != len(lost):
        case.update_entity(entity_id, {"attrs": {LOST: kept}})


def losses(case: CaseRepository, doomed_ids: set[str]) -> dict[str, list[dict[str, Any]]]:
    """Per surviving artifact, the doomed sources it *actually* derives from.

    Scars belong only where the derivation was: a proof loses the media it was
    composed from, not whatever else happened to be deleted in the same breath.
    """
    data = case.snapshot()
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


def chain_of(case: CaseRepository, entity_id: str) -> dict[str, Any] | None:
    """One entity's derivation chain and direct relations, for Details.

    Mirrors the frontend ``chainOf``: its direct ``sources`` (outgoing
    ``derived-from`` / ``depends-on`` edges), its direct ``dependents`` (the
    incoming ones), direct non-chain ``relations``, and the tombstoned
    ``lost_sources`` it still carries. Reads only the edges incident to this
    entity (``links_of``) plus each neighbour, so it never materialises the whole
    graph. Returns ``None`` if the entity is gone.
    """
    entity = case.get_entity(entity_id)
    if entity is None:
        return None
    sources: list[dict[str, Any]] = []
    dependents: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    for link in case.links_of(entity_id):
        if link["type"] not in CHAIN_TYPES:
            neighbour_id = link["to"] if link["from"] == entity_id else link["from"]
            neighbour = case.get_entity(neighbour_id)
            if neighbour is not None:
                relations.append(
                    {
                        "entity": neighbour,
                        "link": link,
                        "direction": "out" if link["from"] == entity_id else "in",
                    }
                )
            continue
        if link["from"] == entity_id:
            neighbour = case.get_entity(link["to"])
            if neighbour is not None:
                sources.append({"entity": neighbour, "type": link["type"]})
        elif link["to"] == entity_id:
            neighbour = case.get_entity(link["from"])
            if neighbour is not None:
                dependents.append({"entity": neighbour, "type": link["type"]})
    lost = list(entity.get("attrs", {}).get(LOST, []))
    return {
        "entity": entity,
        "sources": sources,
        "lost": lost,
        "dependents": dependents,
        "relations": relations,
        "empty": not sources and not lost and not dependents and not relations,
    }


def derivation_subgraph(case: CaseRepository, entity_id: str) -> dict[str, Any] | None:
    """The transitive ``derived-from`` closure rooted at an entity.

    Walks only the outgoing ``derived-from`` edges (artifact → source) through
    bounded ``links_of`` reads and returns ``{entities, links}`` — the slice the
    Post composer needs to trace a proof back to the original downloaded media it
    was built from, without shipping the whole graph. Returns ``None`` if the
    root entity is gone.
    """
    root = case.get_entity(entity_id)
    if root is None:
        return None
    entities: dict[str, dict[str, Any]] = {entity_id: root}
    links: list[dict[str, Any]] = []
    seen_links: set[str] = set()
    frontier = [entity_id]
    while frontier:
        current = frontier.pop()
        for link in case.links_of(current):
            if link["type"] != DERIVED_FROM or link["from"] != current:
                continue
            if link["id"] not in seen_links:
                seen_links.add(link["id"])
                links.append(link)
            to_id = link["to"]
            if to_id not in entities:
                neighbour = case.get_entity(to_id)
                if neighbour is not None:
                    entities[to_id] = neighbour
                    frontier.append(to_id)
    return {"entities": list(entities.values()), "links": links}


def plan_delete(case: CaseRepository, entity_id: str) -> dict[str, list[dict[str, Any]]]:
    """What deleting ``entity_id`` takes with it, and what it leaves standing.

    ``cascade`` follows ``depends-on`` transitively (a session dies with its
    subject, and anything depending on that session follows) — never through
    ``derived-from``, which is the whole point: outputs outlive their sources.
    ``tombstone`` lists the artifacts that survive with a scar, computed over
    everything about to go, not just the entity that was asked for.
    """
    data = case.snapshot()
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
