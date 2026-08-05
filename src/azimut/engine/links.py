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

Each relation starts from **families** in ``engine/entities.py`` and may narrow an
endpoint to explicit types. A broad verb such as ``owns`` can therefore extend to
new assets, while ``sited-at`` stays limited to a structure.
"""

from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from ..repository import CaseRepository
from ..workspace import CaseError
from . import entities

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

#: Exact artifact contract. These are not ordinary relations: producing tools
#: record them, and the pair decides delete behaviour. A file path resolving to an
#: entity outside this matrix is a producer bug, not a reason to widen the graph.
CHAIN_ENDPOINTS: dict[str, dict[str, frozenset[str]]] = {
    DERIVED_FROM: {
        "media": frozenset({"media", "capture"}),
        "proof": frozenset({"media", "capture"}),
        "post": frozenset({"proof", "media", "capture"}),
        "note": frozenset({"post", "proof", "media", "capture"}),
    },
    DEPENDS_ON: {
        "inspect-session": frozenset({"media", "capture"}),
    },
}

# -- relations: the non-chain edges (ONTOLOGY §3) -----------------------------
#
# A relation says something about the world — this photo was recorded there, these
# two files are the same picture — where a chain edge says something about how a
# file was produced. Nothing here cascades a delete or leaves a tombstone:
# removing either endpoint just drops the edge.

LOCATED_AT = "located-at"
SAME_IMAGE_AS = "same-image-as"
DEPICTS = "depicts"
OWNS = "owns"
PART_OF = "part-of"
MEMBER_OF = "member-of"
POSTED = "posted"
APPEARS_IN = "appears-in"
SITED_AT = "sited-at"
IN_NETWORK = "in-network"
MENTIONS = "mentions"
ABOUT = "about"
AT = "at"
CITES = "cites"

CLAIM_CONNECTION_TYPES = (ABOUT, AT, CITES)

#: How sure the analyst is that an edge holds, as one closed ordinal (ONTOLOGY §3).
#: No 0-100 slider: a number invites false precision, nobody calibrates it, and the
#: standing criticism of vague estimative language is that it lets a report commit to
#: nothing. Kent's words and ICD 203's bands are ordinal for the same reason.
CERTAIN = 3
PROBABLE = 2
POSSIBLE = 1
#: Ruled out — and that is a finding, not a deletion. "It is not this bridge" is half
#: the work of a geolocation: twelve candidates are checked and eleven are eliminated.
#: Without this state the only options are deleting the work or leaving it at
#: `possible` and polluting the case.
REFUTED = -1

#: Each level with its reading and one clause placing it, served together so the
#: picker, the tooltip and the validator are the same list. The words are ordinal on
#: purpose: a percentage invites a precision nobody calibrates.
CONFIDENCE_LEVELS: tuple[tuple[int, str, str], ...] = (
    (CERTAIN, "Certain", "established and corroborated"),
    (PROBABLE, "Probable", "more likely than not, and short of established"),
    (POSSIBLE, "Possible", "roughly even odds, and it cannot be excluded"),
    (REFUTED, "Ruled out", "checked and eliminated, which is a finding rather than a deletion"),
)

#: Every rating an edge may hold. Absent stays distinct from `POSSIBLE`: most edges in
#: a live case have never been assessed, and assigning them a level manufactures
#: opinions nobody holds.
CONFIDENCE_STATES: tuple[int, ...] = tuple(value for value, _, _ in CONFIDENCE_LEVELS)


@dataclass(frozen=True)
class RelationType:
    """One relation the vocabulary knows, and what it may join.

    Each end starts as a set of **families** (``engine/entities.py``).
    ``from_types`` and ``to_types`` resolve those families plus any narrowing to
    the exact endpoint sets checked by the API and served to the frontend.

    ``from_only``/``to_only`` narrow an end *inside* its family, for a verb
    a whole family is too broad for. They intersect rather than replace, so a
    narrowing can only ever remove a type — it cannot smuggle one in from another
    family. ``from_exclude``/``to_exclude`` remove one invalid family member while
    preserving inheritance for the rest.

    ``label`` completes the sentence *"<from> … <to>"* and is what every surface
    displays instead of the type slug. ``hint`` is one clause saying what the verb
    means where the words alone are ambiguous — "is part of" against "owns" is the
    distinction an order of battle turns on. ``manual`` is whether an analyst may
    state it: some relations are only ever a machine's claim.

    ``action`` keeps distinct gestures distinct. A document mentioning a subject
    is a pointer, not a relation that can be restated into ownership or location,
    so the UI gives it its own button and never mixes both sets in one select.

    ``group`` heads the verb where it does not belong among the rest, the way
    ``Attr.group`` heads a set of fields. Empty is the common case and means "with
    the others". A verb that merely points — a document naming a place it was not
    made from — reads as a finding when it sits in the same list as one, so the
    heading is what keeps a pointer from being mistaken for a statement.
    """

    type: str
    label: str
    from_families: frozenset[str]
    to_families: frozenset[str]
    inverse_label: str = ""
    hint: str = ""
    group: str = ""
    action: str = "relation"
    ratable: bool = True
    manual: bool = True
    from_only: frozenset[str] = frozenset()
    to_only: frozenset[str] = frozenset()
    from_exclude: frozenset[str] = frozenset()
    to_exclude: frozenset[str] = frozenset()
    from_media_kinds: frozenset[str] = frozenset()
    to_media_kinds: frozenset[str] = frozenset()

    @property
    def from_types(self) -> frozenset[str]:
        return self._resolve(self.from_families, self.from_only, self.from_exclude)

    @property
    def to_types(self) -> frozenset[str]:
        return self._resolve(self.to_families, self.to_only, self.to_exclude)

    @staticmethod
    def _resolve(
        families: frozenset[str], only: frozenset[str], exclude: frozenset[str]
    ) -> frozenset[str]:
        types = entities.types_in(*families)
        narrowed = types & only if only else types
        return narrowed - exclude


#: The relation vocabulary, in menu order. Deliberately not every type in the
#: ONTOLOGY §3 table: a type reaches this tuple once an entity type exists at both
#: ends, so nothing is offered that cannot be filed. `about`/`at`/`cites` wait on
#: the claim node for the same reason.
RELATION_TYPES: tuple[RelationType, ...] = (
    RelationType(
        LOCATED_AT, "was recorded at",
        inverse_label="was recorded here",
        hint="where the photo, video or audio was recorded",
        from_families=frozenset({entities.COLLECTED}),
        to_families=frozenset({entities.PLACE}),
        from_only=frozenset({"media"}),
        from_media_kinds=frozenset({"image", "video", "audio"}),
    ),
    RelationType(
        DEPICTS, "shows",
        inverse_label="is shown in",
        hint="the place is visible in the image or video",
        from_families=frozenset({entities.COLLECTED}),
        to_families=frozenset({entities.PLACE}),
        from_only=frozenset({"media", "capture"}),
        from_media_kinds=frozenset({"image", "video"}),
    ),
    RelationType(
        OWNS, "owns",
        inverse_label="is owned by",
        hint="ownership rather than use, access or operational control",
        from_families=frozenset({entities.ACTOR}),
        to_families=frozenset({entities.ACTOR, entities.ASSET, entities.IDENTIFIER}),
        to_exclude=frozenset({"person"}),
    ),
    RelationType(
        PART_OF, "is part of",
        inverse_label="contains",
        hint="an internal unit inside its parent organization",
        from_families=frozenset({entities.ACTOR}),
        to_families=frozenset({entities.ACTOR}),
        from_only=frozenset({"organization"}),
        to_only=frozenset({"organization"}),
    ),
    RelationType(
        MEMBER_OF, "is a member of",
        inverse_label="has member",
        hint="membership rather than internal containment",
        from_families=frozenset({entities.ACTOR}),
        to_families=frozenset({entities.ACTOR}),
        to_only=frozenset({"organization"}),
    ),
    RelationType(
        POSTED, "posted",
        inverse_label="was posted by",
        hint="the account published the content or URL",
        from_families=frozenset({entities.IDENTIFIER}),
        to_families=frozenset({entities.COLLECTED, entities.DOCUMENT}),
        from_only=frozenset({"account"}),
        to_only=frozenset({"media", "bookmark"}),
    ),
    RelationType(
        APPEARS_IN, "appears in",
        inverse_label="shows",
        hint="the entity or a recognizable representation is visible",
        from_families=frozenset({entities.ACTOR, entities.ASSET, entities.IDENTIFIER}),
        to_families=frozenset({entities.COLLECTED}),
        to_only=frozenset({"media", "capture"}),
        to_media_kinds=frozenset({"image", "video"}),
    ),
    RelationType(
        SITED_AT, "is sited at",
        inverse_label="is the site of",
        hint="a permanent site rather than a dated presence",
        from_families=frozenset({entities.ASSET}),
        to_families=frozenset({entities.PLACE}),
        from_only=frozenset({"structure"}),
    ),
    RelationType(
        IN_NETWORK, "is in network",
        inverse_label="contains",
        hint="the address or subnet belongs inside this network",
        from_families=frozenset({entities.IDENTIFIER}),
        to_families=frozenset({entities.IDENTIFIER}),
        from_only=frozenset({"ip", "network"}),
        to_only=frozenset({"network"}),
    ),
    RelationType(
        SAME_IMAGE_AS, "is the same image as",
        inverse_label="is the same image as",
        hint="enrichment matched the perceptual hashes",
        from_families=frozenset({entities.COLLECTED}),
        to_families=frozenset({entities.COLLECTED}),
        manual=False,
        ratable=False,
        from_only=frozenset({"media"}),
        to_only=frozenset({"media"}),
        from_media_kinds=frozenset({"image"}),
        to_media_kinds=frozenset({"image"}),
    ),
    RelationType(
        MENTIONS, "mentions",
        inverse_label="is mentioned by",
        from_families=frozenset({entities.DOCUMENT}),
        to_families=frozenset(entities.FAMILIES),
        from_only=frozenset({"note", "post", "proof", "bookmark"}),
        hint="the document refers to the entity",
        group="Mentions",
        action="mention",
        ratable=False,
    ),
    RelationType(
        ABOUT, "is about",
        inverse_label="has claim",
        hint="what the statement concerns",
        from_families=frozenset({entities.CLAIM}),
        to_families=frozenset({
            entities.ACTOR, entities.ASSET, entities.IDENTIFIER,
            entities.PLACE, entities.COLLECTED,
        }),
        action="claim",
        ratable=False,
    ),
    RelationType(
        AT, "places it at",
        inverse_label="is a claim location",
        hint="where the statement places its subject or event",
        from_families=frozenset({entities.CLAIM}),
        to_families=frozenset({entities.PLACE}),
        action="claim",
        ratable=False,
    ),
    RelationType(
        CITES, "cites",
        inverse_label="supports claim",
        hint="the evidence the statement relies on",
        from_families=frozenset({entities.CLAIM}),
        to_families=frozenset({entities.DOCUMENT, entities.COLLECTED}),
        to_only=frozenset({"bookmark", "note", "proof", "media", "capture"}),
        action="claim",
        ratable=False,
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
    _check_relation_cycle(case, spec.type, from_id, to_id)
    return case.add_link(from_id, to_id, type_, by=by, unique=True)


def set_relation_type(case: CaseRepository, link_id: str, type_: str) -> dict[str, Any]:
    """Correct which relation an existing edge states.

    The same two entities, a different reading — "shows this place" where the
    analyst first said "was recorded at" — so it is one edge corrected rather than a
    delete and a re-statement, and the wrong reading leaves no trace. Same
    validation as stating one, plus a refusal to collapse onto a relation the pair
    already holds.
    """
    spec = _statable(type_)
    link = case.get_link(link_id)
    if link is None:
        raise CaseError(f"link '{link_id}' not found")
    current = _statable(link["type"])  # a machine's claim is not the analyst's to reword
    if current.action != spec.action:
        raise CaseError("a connection cannot change into another kind")
    # An older out-of-matrix connection stays readable and removable, but cannot
    # be used as a shortcut to mint a new statement under today's rules.
    _check_endpoints(case, current, link["from"], link["to"])
    _check_endpoints(case, spec, link["from"], link["to"])
    _check_relation_cycle(case, spec.type, link["from"], link["to"])
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

    The two halves of an enrichment suggestion are one claim: "this file was recorded
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


def set_confidence(case: CaseRepository, link_id: str, value: int | None) -> dict[str, Any]:
    """Rate how sure the analyst is that one relation holds, or clear the rating.

    ``None`` returns the edge to *not assessed*, which is a state an analyst is
    entitled to go back to: a level assigned by mistake must not be a hole they are
    trapped out of. ``REFUTED`` is set the same way as any other level — eliminating
    a candidate is a finding, so it is recorded, not deleted.

    **A chain edge never takes a rating.** ``derived-from`` records a mechanical fact
    of the analyst's own click; "this frame probably came from that video" is not a
    thing the save could have been unsure about. And a machine's suggestion is not
    rated either: the axes are separate — ``prov_status`` is whether the claim has
    been reviewed, ``confidence`` is how sure the reviewer is — so a suggestion is
    confirmed first, and rated after.
    """
    link = case.get_link(link_id)
    if link is None:
        raise CaseError(f"link '{link_id}' not found")
    if link["type"] in CHAIN_TYPES:
        raise CaseError(f"'{link['type']}' is a derivation, and carries no confidence")
    spec = relation_type(str(link["type"]))
    if spec is not None and not spec.ratable:
        raise CaseError(f"'{link['type']}' is a pointer, and carries no confidence")
    if value is not None:
        # bool is an int in Python, and `True` is not a level.
        if isinstance(value, bool) or value not in CONFIDENCE_STATES:
            raise CaseError(f"confidence must be one of {list(CONFIDENCE_STATES)}, or nothing")
    if link["provenance"]["status"] == "suggested":
        raise CaseError("confirm this relation before rating it")
    return case.update_link(link_id, {"confidence": value})


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
    _check_media_kind(source, spec.from_media_kinds, spec.type, "subject")
    _check_media_kind(target, spec.to_media_kinds, spec.type, "object")


def _media_kind(entity: dict[str, Any]) -> str | None:
    if entity.get("type") != "media":
        return None
    attrs = entity.get("attrs") or {}
    kind = attrs.get("kind")
    if isinstance(kind, str) and kind:
        return kind
    path = attrs.get("path")
    mime = mimetypes.guess_type(str(path or ""))[0] or ""
    for candidate in ("image", "video", "audio"):
        if mime.startswith(candidate):
            return candidate
    return "file"


def _check_media_kind(
    entity: dict[str, Any], allowed: frozenset[str], verb: str, end: str
) -> None:
    if not allowed or entity.get("type") != "media":
        return
    kind = _media_kind(entity)
    if kind not in allowed:
        expected = ", ".join(sorted(allowed))
        raise CaseError(f"the {end} of '{verb}' must be {expected} media")


def _check_relation_cycle(
    case: CaseRepository, type_: str, from_id: str, to_id: str
) -> None:
    """Keep structural containment directed and acyclic.

    Ownership and membership can contain real cross-holdings, so only the two
    relations whose meaning is strict containment are checked.
    """
    if type_ not in (PART_OF, IN_NETWORK):
        return
    frontier = [to_id]
    seen: set[str] = set()
    while frontier:
        current = frontier.pop()
        if current == from_id:
            raise CaseError(f"'{type_}' cannot create a cycle")
        if current in seen:
            continue
        seen.add(current)
        frontier.extend(
            link["to"]
            for link in case.links_of(current)
            if link["type"] == type_ and link["from"] == current
        )


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


def _validated_chain_targets(
    case: CaseRepository, entity_id: str, type_: str, target_ids: list[str]
) -> list[str]:
    holder = _entity(case, entity_id)
    allowed = CHAIN_ENDPOINTS.get(type_, {}).get(str(holder["type"]))
    if allowed is None:
        raise CaseError(f"a {holder['type']} cannot hold '{type_}' sources")
    valid: list[str] = []
    for target_id in dict.fromkeys(target_ids):
        if target_id == entity_id:
            # A derivative that deduplicates onto its input must not create a
            # self-edge. The bytes still exist once, so there is no second artifact
            # whose lineage could be represented.
            continue
        target = _entity(case, target_id)
        if target["type"] not in allowed:
            raise CaseError(
                f"a {holder['type']} cannot be {type_} a {target['type']}"
            )
        _check_chain_cycle(case, entity_id, target_id)
        valid.append(target_id)
    return valid


def _check_chain_cycle(case: CaseRepository, from_id: str, to_id: str) -> None:
    frontier = [to_id]
    seen: set[str] = set()
    while frontier:
        current = frontier.pop()
        if current == from_id:
            raise CaseError("artifact lineage cannot create a cycle")
        if current in seen:
            continue
        seen.add(current)
        frontier.extend(
            link["to"]
            for link in case.links_of(current)
            if link["type"] in CHAIN_TYPES and link["from"] == current
        )


def sync(
    case: CaseRepository, entity_id: str, type_: str, rel_paths: list[str], *, by: str
) -> None:
    """Restate an artifact's sources: reconcile its links, tombstone the rest.

    Called on every save, so a proof that loses a panel loses the matching edge
    and one saved three times still carries one edge per panel. A path that no
    longer resolves cannot be linked, but the fact that it was used is kept as a
    tombstone rather than dropped in silence.
    """
    paths = [path for path in rel_paths if path]
    holder = _entity(case, entity_id)
    if not paths and CHAIN_ENDPOINTS.get(type_, {}).get(str(holder["type"])) is None:
        # Registration is shared by every file-backed type. A capture with no case
        # source has no lineage to write; it is not an invalid attempted edge.
        return
    found, missing = resolve(case, paths)
    valid = _validated_chain_targets(case, entity_id, type_, found)
    case.sync_links(entity_id, type_, valid, by=by)
    add_tombstones(case, entity_id, [{"path": path} for path in missing])


#: Derivation targets an artifact's own body can speak for. A note shows media,
#: captures and proofs; the `post` draft it was composed in is filed by the composer
#: at creation and is named nowhere in the Markdown, so a body-driven restatement
#: must leave that edge alone rather than read its absence as a removal.
EMBEDDED_TYPES = frozenset({"media", "capture", "proof"})


def sync_embedded(
    case: CaseRepository,
    entity_id: str,
    to_ids: list[str],
    *,
    by: str,
    over: frozenset[str] = EMBEDDED_TYPES,
) -> None:
    """Restate the ``derived-from`` edges an artifact's own text names.

    ``sync`` reconciles every edge of its type, which is right for a proof whose spec
    lists all of its panels. A note's Markdown is narrower: it names the files it
    shows and nothing else, so reconciling on it would drop the draft edge nothing in
    the body could have restated. ``over`` is the set of target types the body speaks
    for; an edge pointing anywhere else is left exactly as it is.

    Called on every note save, so a case image inserted afterwards gets its edge and
    one deleted from the text loses it. Without that, a hand-inserted image was a
    dependency nothing in the graph knew about — deleting it left the note showing a
    hole — and a removed one left a scar the note had stopped earning.

    An id the vocabulary cannot join is skipped rather than refused: a body is prose,
    and a note must not fail to save because a token points somewhere odd.
    """
    holder = _entity(case, entity_id)
    allowed = CHAIN_ENDPOINTS.get(DERIVED_FROM, {}).get(str(holder["type"]))
    if allowed is None:
        return

    wanted: list[str] = []
    for to_id in dict.fromkeys(to_ids):
        if to_id == entity_id:
            continue
        target = case.get_entity(to_id)
        if target is None or target["type"] not in allowed or target["type"] not in over:
            continue
        try:
            _check_chain_cycle(case, entity_id, to_id)
        except CaseError:
            continue  # a note embedded inside its own source is prose, not a graph edit
        wanted.append(to_id)

    for link in case.links_of(entity_id):
        if link["type"] != DERIVED_FROM or link["from"] != entity_id:
            continue
        if link["to"] in wanted:
            continue
        neighbour = case.get_entity(link["to"])
        if neighbour is not None and neighbour["type"] in over:
            case.remove_link(link["id"])
    for to_id in wanted:
        case.add_link(entity_id, to_id, DERIVED_FROM, by=by, unique=True)


def link_all(
    case: CaseRepository, entity_id: str, type_: str, rel_paths: list[str], *, by: str
) -> None:
    """Add an artifact's source links without removing any (see ``sync``).

    For one-shot outputs that can dedupe onto an entity already in the case: the
    same bytes really can come from two different videos, and that entity keeps
    both derivations.
    """
    paths = [path for path in rel_paths if path]
    holder = _entity(case, entity_id)
    if not paths and CHAIN_ENDPOINTS.get(type_, {}).get(str(holder["type"])) is None:
        return
    found, missing = resolve(case, paths)
    valid = _validated_chain_targets(case, entity_id, type_, found)
    for to_id in valid:
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
