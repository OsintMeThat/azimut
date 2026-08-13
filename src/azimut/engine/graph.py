"""The case drawn as nodes and edges (SPEC §5, "Case graph").

The Board already lists a case, and lists it better than any drawing would: it
sorts, filters and shows columns. So this module deliberately does not answer
"browse the case". It answers the four questions a table cannot:

**the path** — how one gets from this account to that place · **the convergence**
— what points at the same thing · **the independence** — whether three citations
are three sources or one repeated · **the contradiction** — what stands against a
statement.

Two reads serve them, and the first is the entry point:

``view``
    The whole case, or as much of it as a first draw opens on. A case is a subject
    before it is a set of statements — a conflict followed over months has no single
    root to expand from — so the graph opens on everything and the analyst narrows.
    ``OPENING_NODES`` is a comfort number rather than a ceiling: what a first draw
    keeps is decided by degree, so the hubs stay and the picture is the case rather
    than an arbitrary slice of it, and **everything after that first draw is
    unbounded** — nothing the analyst asks for is refused for room.

    It also **grows**, and the drawing is **a set the caller owns**. ``expand``
    names the nodes whose neighbours join the picture, so opening one up adds to the
    case on screen instead of replacing it with a different question. That is what
    makes the graph a place to work rather than a thing to navigate: the shape you
    were reading is still there when the answer arrives.

    Two more lists edit that set by hand, and they are what keep an unbounded
    drawing usable. ``keep`` draws a node and **nothing around it**, which is what a
    route and a named entity actually want — a picture that dragged every route
    node's whole neighbourhood in behind it answered a question with a crowd.
    ``omit`` takes a node out — and with it whatever nothing else was holding —
    whichever of the three put it there, so a drawing that can grow without limit has
    a way back that is not "fold everything".

``neighborhood``
    One node and what surrounds it, hop by hop, for when the question does have a
    root. Every frontier node reports its degree, so a click's cost is known
    before it is paid.

**Lenses are derived, never declared twice.** A lens is a set of verbs *and* a set of
node roles, and both live in the registries: the verbs in ``engine/links.py``, the
roles on ``EntityType``. Adding a relation or a type there puts it in the right lens
here with no edit — a verb that lands on a ``place`` is geography, a verb an analyst
states about a subject is the subject web, the rest follow their registry ``action``,
and a type is drawn if its role says a picture of the case is about it. A lens the
registries cannot derive would be a second vocabulary, which is the thing they exist
to prevent.

**A lens narrows nodes, not only verbs.** A case flows in one direction — sources,
evidence, statements, deliverables — and the four stages are not four things to draw
at the same rank. What the analyst *wrote* is the filing rather than the case: a post
is cited by nothing, a note hangs off one node and is consulted rather than seen, so
neither is in a reading of what the case is about. They are one lens away, not gone
(``My work``). The narrowing reaches the **degree** as well as the drawing: a node
stating a connection this reading cannot show would price a click that brings nothing.

**The wrapper is an edge, and the count is what it says.** An attestation — a bookmark,
a proof, a capture — is not a leaf: *this account posted it, this statement cites it* is
a path through it, and that path is a fact about the case. Drawn as a node it says
nothing and spends the budget; collapsed (``_fold``) the path survives and becomes
legible as ``cites (3 sources · 1 account)``. "These three citations are one source"
stops being a computation and becomes what the edge says, which is where the folding
and the independence number meet. Nothing is removed silently: the edge names what it
stands for, one click brings those nodes back, and a middle carrying anything an edge
cannot say stays a node.

**A step is an edge too, and it points one way.** A frame pulled out of a video and
built into a proof is a node saying "there was a step here", and it costs a slot to say
it — twelve saved frames draw as twelve pictures of one video. Collapsed (``_relay``)
the step becomes what the edge is written with: *derived from 1 frame*. It folds on the
same all-or-nothing rule, plus a direction guard the fold above does not need — a node
with **two** outgoing chain edges is a confluence, not a passage, and collapsing a proof
made from both a frame and an overhead capture would state that the capture came out of
the footage. That is the false convergence, and it is the thing this reading is for.

**And what came out of it and was not used is its own count.** Twelve frames saved off
a video and cited by nothing draw as twelve pictures of that video; the video says *12
frames* instead (``_roll``), and one click brings them back. Narrow on purpose: one
edge, a chain verb, and the node is the end that was derived — a leaf with a single
*relation* stays, because a person with one link is thin material the case has yet to
exploit rather than clutter, and the direction decides which of a lone pair goes.

**One finding on the ground is one arrow.** A proof concluding a coordinate states the
point of the whole material behind it, so four arrows land on one dot and a reading of
the ground draws no chain verb to say that three of them are the same picture. A reader
counts four sources agreeing; there is one. ``_star`` groups them by their derivation —
asked of the repository, since the redundancy is a fact the lens does not draw — and
keeps the arrow on the **subject** root. A capture is the sharp case: pulled at the
coordinates already suspected, it is the reference the comparison was made against
rather than a witness, and the roles already say so (``media`` is a subject,
``capture`` and ``proof`` are attestations). The place then reports what it really
rests on, which is the geographic counterpart of the independence number.

**On the arrangement.** A whole-case view also carries the nodes the analyst placed
by hand (``pin``), because an arrangement somebody built is worth more than the one
a relaxation computes, and losing it on reload would make dragging pointless. It is
presentation, not a claim about the case, so it lives in its own table rather than on
the entity, and it is **per lens**: a lens draws its own nodes and its own edges, so
it clusters differently, and one shared arrangement would anchor every reading into
the shape of whichever one it was built in. A neighbourhood carries none: distance
from the root owns the horizontal axis there, and a pinned coordinate would
contradict it.

**On time.** No verb carries a date (ONTOLOGY §3) and dated statements are v4, so
nothing here reads event time — that would be inventing a fact the case does not
hold. What *is* real today is when work entered the case, and ``order="recent"``
ranks on it. The seam is deliberate: a third ordering over stated time slots in
beside these two without reshaping a response or a caller, because ordering is
already the axis this module varies.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..repository import CaseRepository
from ..workspace import CaseError
from . import entities, links

#: **How many nodes a case opens on, not how many it may hold.** A ceiling that
#: refuses is the app overruling the analyst about their own picture, and the drawing
#: is a set they own: it grows from here without limit, and what a large one costs is
#: said rather than prevented (UI *Graph*, the weight the drawing carries).
#:
#: An absolute count rather than a share of the case: a tenth of fifty entities is an
#: empty picture and a tenth of ten thousand is a freeze. The case's own total is sent
#: beside it — *300 of 1 050* — so a first draw states what it is a part of.
OPENING_NODES = 300

#: The largest first draw a caller may ask for. Not a ceiling on the drawing, which
#: has none: it bounds one ranking query, so a typed URL cannot ask the database for
#: a hundred thousand rows in one read.
MAX_OPENING = 2000

#: How far one expansion reaches. Two hops already fans out past what a screen
#: holds on a well-linked case, so the budget stops the walk before the layout
#: has to apologise for it.
MAX_HOPS = 3

#: How long a route between two entities may be before the answer stops being one.
#: Four hops on a well-linked case reaches most of it, and a chain that long says
#: "everything is connected to everything", which is true and useless.
MAX_PATH_HOPS = 4

#: How many equally-short routes are returned. Ties are the interesting case — two
#: accounts reaching the same place by different sources is the finding — but past a
#: dozen the answer is a hub, and the list stops being read.
MAX_PATHS = 12

#: Nodes one side of the search may load before it gives up. The guard against the
#: hub: on a case where one account touches half the entities, an unbounded walk
#: pulls the case into memory to answer a question about two of its nodes.
MAX_PATH_VISIT = 4000

#: Ranking, and with it which nodes a truncated view keeps.
ORDERS: tuple[tuple[str, str, str], ...] = (
    ("degree", "Most connected", "keeps the hubs, so a cut view still shows the shape"),
    ("recent", "Latest work", "keeps what entered the case last"),
)

#: The roles a reading of the **case** draws. A deliverable carries nothing — nothing
#: cites a post — and an annex hangs off one node, so neither belongs in a picture of
#: what the case is about; both are drawn by the one lens that is about the filing.
#: Attestations stay, because they are not leaves: a bookmark is a degree-2
#: pass-through, and *this statement rests on this account* is a fact about the case.
#: They leave the day the collapsed edge carries that path instead (SPEC §6).
CASE_ROLES: tuple[str, ...] = (entities.SUBJECT, entities.ATTESTATION)

#: The verbs that say where a source came from, and the only ones a collapse folds
#: across. A statement rests on a source, and the source came from somewhere: an
#: account published it, or it was made out of material the case already holds. That
#: chain is what the collapsed edge carries.
#:
#: **The content verbs are deliberately absent.** `depicts`, `appears-in` and
#: `located-at` say what is *in* the material, which is a subject-to-subject reading —
#: a vehicle seen at a place is a finding, and folding the capture that shows both
#: would state a claim about them the case never made. So an attestation holding one of
#: those stays a node: it carries something the edge cannot say.
PROVENANCE_VERBS: tuple[str, ...] = tuple(links.CHAIN_TYPES) + (links.POSTED,)

#: How a collapsed edge's id is spelled. Deterministic from the pair and the verb, so
#: the same case answers with the same id on every read and a selection survives a
#: reload; prefixed because it is not a row anybody may write to, and the surfaces that
#: confirm, rate or remove an edge have to be able to tell.
FOLDED_PREFIX = "folded:"


@dataclass(frozen=True)
class Lens:
    """One reading of the case: what it draws, and how it reads in words.

    ``types`` is the **verbs**, resolved from the relation registry, and ``roles`` is
    which **nodes**, resolved from the entity registry. Neither is listed, so the
    vocabulary has exactly one home. ``hint`` is the one clause every other registry
    carries, for the surface that has to explain itself.
    """

    id: str
    label: str
    hint: str
    types: tuple[str, ...]
    roles: tuple[str, ...]

    @property
    def hides(self) -> tuple[str, ...]:
        """The declared entity types this reading leaves out of the drawing.

        Stated as what is left out rather than as what is kept, and that is the load
        bearing choice: a **free type** — one the vocabulary has never heard of — has
        no role, so an allowlist resolved from the registry would silently drop an
        entity nobody agreed to drop. An exclusion only ever removes what a role
        explicitly claims.
        """
        left = set(entities.ROLES) - set(self.roles)
        return tuple(sorted(entities.types_with_role(*left)))


def _relation_verbs(predicate: Any) -> tuple[str, ...]:
    return tuple(entry.type for entry in links.RELATION_TYPES if predicate(entry))


def _lands_on_place(entry: links.RelationType) -> bool:
    """Whether a verb's object is a point on the ground.

    Geography is what a verb *targets*, not what it is called, so a relation
    added later that puts something at a place joins the ground lens by itself.
    """
    return entry.action == "relation" and entities.PLACE in entry.to_families


def lenses() -> tuple[Lens, ...]:
    """The readings, in menu order: four of the case, then one of the filing.

    Each is resolved from the two registries. The last one is not an extra control —
    it is exactly the switch that lets the other four leave the analyst's own output
    out of the drawing while keeping it one click away.
    """
    return (
        Lens(
            "all", "Everything",
            "every connection between the things the case is about",
            tuple(links.CHAIN_TYPES) + _relation_verbs(lambda e: True),
            CASE_ROLES,
        ),
        Lens(
            "subjects", "Subjects",
            "who owns, belongs to, posted or appears in what",
            # `same-image-as` is here rather than with the artifact chain: two files
            # being one picture is a fact about the case, not about the filing, and
            # `media` is a subject. Filed with the chain verbs it made one lens hold a
            # derivation and a finding about the world at once.
            _relation_verbs(lambda e: e.action == "relation" and not _lands_on_place(e)),
            CASE_ROLES,
        ),
        Lens(
            "ground", "Ground",
            "what is tied to a place on the map",
            _relation_verbs(_lands_on_place),
            CASE_ROLES,
        ),
        Lens(
            "claims", "Statements",
            "what is asserted, and what it rests on",
            _relation_verbs(lambda e: e.action == "claim"),
            CASE_ROLES,
        ),
        # The filing, read on its own terms. `derived-from` and `depends-on` answer
        # *what did I write, and out of what*, and `mentions` starts at a `document` by
        # construction, so it has never held one subject-to-subject edge. Three verbs
        # that are all one question, and they sat in the same menu as Subjects and
        # Ground as though they were peers.
        Lens(
            "work", "My work",
            "what you wrote, what it was made from, and what it points at",
            tuple(links.CHAIN_TYPES) + _relation_verbs(lambda e: e.action == "mention"),
            entities.ROLES,
        ),
    )


def lens(lens_id: str) -> Lens:
    """One lens by id, defaulting to everything when none was asked for."""
    wanted = lens_id or "all"
    found = next((entry for entry in lenses() if entry.id == wanted), None)
    if found is None:
        raise CaseError(f"'{lens_id}' is not a lens")
    return found


def view(
    case: CaseRepository,
    *,
    lens_id: str = "all",
    limit: int | None = None,
    types: list[str] | None = None,
    status: str | None = None,
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
    temporal_since: str | None = None,
    temporal_until: str | None = None,
    temporal_categories: list[str] | None = None,
    order: str = "degree",
    keep: list[str] | None = None,
    expand: list[str] | None = None,
    omit: list[str] | None = None,
) -> dict[str, Any]:
    """The whole case as one bounded graph, and a set the caller may edit by hand.

    Returns ``{lens, order, nodes, links, total, shown, truncated, isolated}``.
    ``links`` is the closed set — both ends among the nodes returned — so nothing
    drawn points at a node that was not sent.

    ``isolated`` counts the entities this lens joins to nothing, which is the case's
    unexploited material and the one number a table cannot show. It is a count over
    the **case**, like ``total``, not over what was drawn: a node with no edge sorts
    last, so a cut discards it first, and read off the returned nodes the number
    reported zero on exactly the cases large enough to need it.

    Three lists edit the ranked set, and the split between the first two is the point:
    a node can be **drawn** without its neighbourhood being drawn with it.

    ``keep``
        these nodes are drawn, and nothing around them. A route through four nodes,
        or one entity named in the search, is a small precise answer — expanded, each
        of them dragged its whole neighbourhood in and buried it.
    ``expand``
        these, plus one hop each. The drill-down, unchanged.
    ``omit``
        these are not drawn, whichever of the ranking, ``keep`` or a hop put them
        there, **and neither is the arrival no anchor still reaches**: what came in
        because a node was opened leaves with it, or the picture keeps a handful of
        dots joined to nothing. Applied last, so nothing can hand back a node the
        analyst took out. This is what makes a drawing that grows without limit usable:
        the way back was folding every expansion, which takes the reading down with it.

    ``keep`` and ``expand`` arrive **beside** the case rather than instead of it, and
    they ignore the filters: an analyst who named a node is asking about the case, not
    about the narrowing they set earlier. The nodes named are kept even when the
    ranking or the filters would have dropped them, or the view would answer a
    question with the question missing from it.

    **The lens outranks a named node**, which is the one place it differs from a
    filter. A filter is a narrowing the analyst set earlier; a lens is the reading
    itself, so a type it does not draw is not drawn because it was asked for by name
    either — it is drawn by switching reading. What comes back says which nodes were
    actually drawn by name (``kept``) and which were actually opened (``expanded``),
    so a caller never holds one the drawing refused.
    """
    entry = lens(lens_id)
    verbs = list(entry.types)
    hidden = list(entry.hides)
    bounded = max(1, min(int(OPENING_NODES if limit is None else limit), MAX_OPENING))
    if order not in {value for value, _, _ in ORDERS}:
        raise CaseError(f"'{order}' is not an ordering")

    ranked = case.rank_entities(
        limit=bounded, types=types, exclude_types=hidden, status=_status(status),
        query=query, folder=folder, unfiled=unfiled, recursive=recursive,
        attr=attr, attr_value=attr_value, linked=linked, unlinked_only=unlinked,
        since=since, until=until, filed_by=filed_by,
        temporal_since=temporal_since, temporal_until=temporal_until,
        temporal_categories=temporal_categories,
        link_types=verbs, order=order,
    )
    nodes = ranked["entities"]
    degrees = dict(ranked["degrees"])
    held, by_name = _hold(case, nodes, keep, verbs, hidden, degrees)
    nodes = nodes + held
    grown, opened = _grow(case, nodes, expand, verbs, hidden, degrees)
    nodes = nodes + grown
    ids = [node["id"] for node in nodes]
    edges = case.links_among(ids, types=verbs) if ids else []
    named = {
        entity_id for entity_id in list(keep or []) + list(expand or []) if entity_id
    }
    # What arrived by a hop rather than by rank or by name. These are the only nodes a
    # removal may take with it: a ranked node stands on its own — it is allowed to have
    # no edge at all, which is what ``isolated`` counts — and a named one was asked for.
    hops = {node["id"] for node in grown if node["id"] not in named}
    taken = {entity_id for entity_id in (omit or []) if entity_id}
    nodes, edges, severed = _take_out(nodes, edges, omit, degrees, hops)
    nodes, edges, rests = _fold(case, entry, nodes, edges, degrees, named, taken, severed)
    # Read before the relay pass rather than after it, because the passes spend them:
    # a folded passage is off the drawing by the time the nodes are built, and the word
    # its edge is written with — *1 frame* rather than *1 media* — is its own origin.
    origins = _origins(case, nodes)
    nodes, edges, agree = _star(case, entry, nodes, edges, named, opened, origins)
    rests = {**rests, **agree}
    nodes, edges = _relay(entry, nodes, edges, degrees, named, origins)
    nodes, edges, rolled = _roll(entry, nodes, edges, named, opened, origins)
    thumbs = _previews(case, nodes)
    kinds = _kinds(case, nodes)
    pins = case.graph_pins(entry.id)
    arrived = {node["id"] for node in grown + held}
    return {
        "lens": entry.id,
        "order": order,
        "nodes": [
            _node(
                node, degrees.get(node["id"], 0),
                thumb=thumbs.get(node["id"]), kind=kinds.get(node["id"]),
                origin=origins.get(node["id"]),
                pin=pins.get(node["id"]),
                added=node["id"] in arrived,
                rests=rests.get(node["id"]),
                rolled=rolled.get(node["id"]),
                query=query,
            )
            for node in nodes
        ],
        "links": edges,
        "total": ranked["total"],
        "shown": len(nodes),
        "truncated": ranked["truncated"],
        # Counted over the whole filtered case, never over what was drawn. A
        # degree-0 entity sorts last, so a cut discards it first: read off the
        # returned nodes, the case's unexploited material reported zero on exactly
        # the cases too large to draw, which is the one place it is worth knowing.
        "isolated": ranked["unlinked"],
        # How many drawn statements rest on more than one source and yet on a single
        # account. The independence number, and it is a **read over the edges** rather
        # than a computation of its own: the collapsed edge already carries how many
        # sources it stands for and how many accounts published them. Counted over the
        # drawing, like the match count and unlike the total, because that is the set
        # whose edges were read.
        "single_account": sum(1 for held in rests.values() if held["one"]),
        # The nodes actually drawn by name, and the nodes actually opened. Neither is
        # always what was asked for: one deleted in another tab, or of a type this
        # reading does not draw, is absent rather than reported held — so the caller's
        # own list never keeps an id the drawing refused, and no control offers to fold
        # or hand back a ghost. A removal needs no such answer: taking a node out of a
        # picture always succeeds, which is why `omit` is not echoed.
        "kept": by_name,
        "expanded": opened,
        # Every pin this lens holds, not only the ones on screen: the control that
        # offers to undo the arrangement has to appear even when the pinned nodes
        # were cut from this view or filtered out of it.
        "pinned": len(pins),
    }


def snapshot_view(
    snapshot: dict[str, Any], *, lens_id: str = "all", query: str | None = None
) -> dict[str, Any]:
    """Draw one immutable captured set without consulting the live case.

    Snapshot entities and links were validated when the view was saved or duplicated.
    The lens is still applied because it is part of how the reading was made, but no
    current entity, relation, thumbnail or pin can rewrite what the capture contains.
    """
    entry = lens(lens_id)
    hidden = set(entry.hides)
    verbs = set(entry.types)
    raw_nodes = [
        entity for entity in snapshot.get("entities", [])
        if entity.get("type") not in hidden
    ]
    ids = {entity["id"] for entity in raw_nodes}
    raw_links = [
        link for link in snapshot.get("links", [])
        if link.get("from") in ids and link.get("to") in ids
        and (not verbs or link.get("type") in verbs)
    ]
    degrees = {entity_id: 0 for entity_id in ids}
    for link in raw_links:
        degrees[link["from"]] += 1
        degrees[link["to"]] += 1
    nodes = [_node(entity, degrees[entity["id"]], query=query) for entity in raw_nodes]
    return {
        "lens": entry.id,
        "order": "snapshot",
        "nodes": nodes,
        "links": raw_links,
        "total": len(nodes),
        "shown": len(nodes),
        "truncated": False,
        "isolated": sum(1 for degree in degrees.values() if degree == 0),
        "single_account": 0,
        "kept": [],
        "expanded": [],
        "pinned": 0,
        "snapshot": True,
        "captured_at": snapshot.get("captured_at"),
    }


def _hold(
    case: CaseRepository,
    ranked: list[dict[str, Any]],
    keep: list[str] | None,
    verbs: list[str],
    hidden: list[str],
    degrees: dict[str, int],
) -> tuple[list[dict[str, Any]], list[str]]:
    """The nodes named to be drawn, and **nothing around them**.

    The half of the old ``expand`` that was never expressible: *draw this one*. Both
    acts were one parameter, so every named node arrived with its whole
    neighbourhood — which is right for opening a node and wrong for everything else.
    A route of four nodes came in with four neighbourhoods around it and the answer
    was buried in the crowd it brought.

    Returns ``(arrivals, drawn)``. ``drawn`` is the ids the drawing actually holds, in
    the order they were asked for, so a caller's own list can be pruned of what this
    reading refuses: an entity the case no longer has, or one of a type the lens does
    not draw. **Nothing here is refused for room**: the drawing has no ceiling, and a
    node named by an analyst is the last thing that should be told there is no space.

    Sorted by degree, then label, then id — the tie-break the layout and ``_grow``
    already use — so the same case draws the same picture whatever order the database
    returned.
    """
    wanted = [entity_id for entity_id in dict.fromkeys(keep or []) if entity_id]
    if not wanted:
        return [], []

    present = {node["id"] for node in ranked}
    left_out = set(hidden)
    found = [
        entity
        for entity in case.entities_by_ids(wanted)
        if entity["type"] not in left_out
    ]
    arrivals = [entity for entity in found if entity["id"] not in present]
    if not arrivals:
        already = {entity["id"] for entity in found}
        return [], [i for i in wanted if i in already]

    known = case.degrees_of(
        [entity["id"] for entity in arrivals], types=verbs, exclude_types=hidden
    )
    arrivals.sort(
        key=lambda entity: (
            -known.get(entity["id"], 0),
            str(entity["label"]),
            entity["id"],
        )
    )
    degrees.update({entity["id"]: known.get(entity["id"], 0) for entity in arrivals})
    drawn = {entity["id"] for entity in found if entity["id"] in present}
    drawn.update(entity["id"] for entity in arrivals)
    return arrivals, [i for i in wanted if i in drawn]


def _take_out(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    omit: list[str] | None,
    degrees: dict[str, int],
    hops: set[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """The nodes taken out of the drawing by hand, and the edges that went with them.

    **Last, and over everything**, which is the whole of why it works: applied to the
    ranking alone, a node removed came back the moment a neighbour was opened, and the
    analyst was arguing with the ranking about their own picture.

    ``degrees`` is corrected in place, for the same reason the fold corrects it: a
    degree says what a click would bring in, and a removed node is not something a
    click can bring back — a neighbour left offering to open it would answer with an
    unchanged picture. What the removed node itself said no longer matters; it is not
    drawn.

    A middle taken out is still a middle. The fold runs after this and reads the case
    rather than the drawing, so a bookmark removed by hand comes back as the edge it
    always stood for — the path through it is a fact about the case, and this act was
    about the picture. The edge names it, and one click draws it again.

    **A ranked node is not taken by it.** One left with no edge after a removal is still
    a node the case ranked, and its reason to be drawn was never the neighbour that
    went: taking it too overrules the ranking, and on a small case removing one node
    empties the picture. Only what arrived by a hop is held by what brought it.
    """
    out = {entity_id for entity_id in (omit or []) if entity_id}
    if not out:
        return nodes, edges, []

    standing = []
    severed = []
    for link in edges:
        ends = (link["from"], link["to"])
        if not out.intersection(ends):
            standing.append(link)
            continue
        severed.append(link)
        for end in ends:
            if end not in out and end in degrees:
                degrees[end] = max(degrees[end] - 1, 0)
    kept, standing = _stranded(
        [node for node in nodes if node["id"] not in out], standing, hops
    )
    return kept, standing, severed


def _stranded(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    hops: set[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """What a removal leaves behind that nothing was holding but the node removed.

    Taking a node out used to take only that node: the three media its expansion had
    brought stayed drawn with no edge to anything, and the picture kept a handful of
    dots whose only reason to be there had just left. The act says *this picture is not
    about it*, and a neighbourhood nothing else reaches is not about anything either.

    **It is reachability, not degree**, because the vocabulary ranks no edge above
    another and there is no such thing as the link that holds a node. An arrival stays
    while something standing on its own still reaches it, through however many other
    arrivals: a pair that only holds each other is as adrift as a single dot, and
    counting edges would keep it.

    ``hops`` is what arrived by a hop. Everything else drawn is an anchor — a ranked
    node, which is allowed to have no edge at all, or one named by ``keep`` or
    ``expand``, which was asked for. Two anchors are the common way an arrival
    survives: a second expansion that reached the same node, which is the convergence
    the drawing exists to show, and an arrival joined to something the ranking drew.

    No degree is corrected here. A node this drops is unreachable from every anchor, so
    everything it touched is unreachable too and goes with it — no node still drawn
    loses an edge.
    """
    drawn = {node["id"] for node in nodes}
    reach = {entity_id for entity_id in drawn if entity_id not in hops}
    if len(reach) == len(drawn):
        return nodes, edges

    near: dict[str, list[str]] = {}
    for link in edges:
        near.setdefault(link["from"], []).append(link["to"])
        near.setdefault(link["to"], []).append(link["from"])
    frontier = list(reach)
    while frontier:
        for far in near.get(frontier.pop(), ()):
            if far in drawn and far not in reach:
                reach.add(far)
                frontier.append(far)
    if len(reach) == len(drawn):
        return nodes, edges
    return (
        [node for node in nodes if node["id"] in reach],
        [link for link in edges if link["from"] in reach and link["to"] in reach],
    )


def _grow(
    case: CaseRepository,
    ranked: list[dict[str, Any]],
    expand: list[str] | None,
    verbs: list[str],
    hidden: list[str],
    degrees: dict[str, int],
) -> tuple[list[dict[str, Any]], list[str]]:
    """One hop around each opened node, as the entities the ranked set is missing.

    Returns ``(arrivals, opened)`` and fills ``degrees`` for what it brings, so an
    arrival states its own cost like every other node.

    **Nothing is cut for room.** An expansion is the one thing in the tool the analyst
    asked for outright, and the drawing has no ceiling to refuse it with: every missing
    neighbour of an opened node arrives, so the node's own degree drops to what is
    drawn and the control that offered the act stops offering it. Arrivals are still
    sorted by degree, then label, then id — the tie-break the layout uses — so the same
    case draws the same picture whatever order the database returned.

    **``opened`` is what this reading drew, not what was asked for.** A type the lens
    does not draw is refused here as it is everywhere else: the reading decides what is
    on screen, and a named node is not an exception to it.
    """
    wanted = [entity_id for entity_id in dict.fromkeys(expand or []) if entity_id]
    if not wanted:
        return [], []

    present = {node["id"] for node in ranked}
    left_out = set(hidden)
    # An opened node that the filters or the cut left out comes back first: a view
    # answering "what touches this" without the node itself is a broken sentence. One
    # this reading does not draw at all is not opened, and says so by its absence from
    # what is returned.
    opened = [
        entity["id"]
        for entity in case.entities_by_ids(wanted)
        if entity["type"] not in left_out
    ]
    if not opened:
        return [], []

    reached: set[str] = set()
    # An edge onto a node this reading leaves out never arrives here, so a neighbour
    # the lens does not draw is not brought in by an expansion either: the reading
    # decides what is on screen, and asking about one node is not a way around it.
    for link in case.links_touching(opened, types=verbs, exclude_types=hidden):
        for end in (link["from"], link["to"]):
            if end not in present:
                reached.add(end)
    for entity_id in opened:
        # An opened node the ranking or the filters left out is itself an arrival, and
        # bringing it back is the expansion doing its job.
        if entity_id not in present:
            reached.add(entity_id)

    found = case.entities_by_ids(sorted(reached))
    if not found:
        # Everything these nodes touch is already drawn: opened, with nothing to show
        # for it, which is a true answer and not a failure. Returned here rather than
        # falling through, to spare the degree query the common case does not need.
        return [], opened

    known = case.degrees_of(
        [entity["id"] for entity in found], types=verbs, exclude_types=hidden
    )
    # An opened node still comes before the neighbours it brought, which is what makes
    # the picture the same on every read of the same case.
    order = {entity_id: 0 for entity_id in opened}
    found.sort(
        key=lambda entity: (
            order.get(entity["id"], 1),
            -known.get(entity["id"], 0),
            str(entity["label"]),
            entity["id"],
        )
    )
    degrees.update({entity["id"]: known.get(entity["id"], 0) for entity in found})
    return found, opened


def _fold(
    case: CaseRepository,
    entry: Lens,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    degrees: dict[str, int],
    named: set[str],
    out: set[str],
    severed: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, dict[str, int]]]:
    """Attestations on a statement→source chain, as one edge each instead of a node.

    **The wrapper is an edge, and the count is what it says.** A bookmark is not a leaf:
    ``account posted it`` and ``statement cites it`` is a path through it, and that path
    is a fact about the case rather than about the filing. Drawn as a node it says
    nothing and spends a third of the budget; collapsed, the same path becomes legible:

    ::

        before   claim → bookmark → account A
                         bookmark → account A
                         bookmark → account A
        after    claim  --cites (3 sources · 1 account)-->  account A

    "These three citations are one source" stops being a computation and becomes what
    the edge says, which is where the folding and the independence number meet.

    **Only across provenance, and only all of it** (``PROVENANCE_VERBS``). A middle
    whose drawn edges are not every one either a statement's or a provenance verb's
    stays a node: it is carrying something an edge between its two neighbours cannot
    say. That is what keeps a capture showing a place from turning "this vehicle
    appears in it" and "it shows this place" into a claim about the vehicle and the
    place.

    **A middle that is not drawn is still a middle.** Two things keep one out of the
    picture, and neither is a reason to lose the path through it:

    * its **type** is one this reading leaves out. A reconstructed case bends its own
      types — an import can file an external source under a type meant for the
      analyst's own output — so shape outranks the type name (SPEC §6).
    * the **budget** cut it. This is the common one and the one that matters, because
      the ranking cuts the least connected first, which is exactly the sources this
      folds. Left out, the fold only kept its promise below the ceiling: on a case too
      large to draw whole — the case that needed it — a statement resting on nine
      sources and one account drew as a lone dot with both of its ends on screen and
      nothing joining them.

    One query answers both, and the guard is the same: the middle is not drawn, the
    far end is. What that query cannot see is the middle's edges to nodes that are not
    drawn either, and it does not need to — an edge with an undrawn end is not an edge
    this picture could have shown, so "all of it, or none" is asked of everything the
    reading can actually say.

    **A named node is never folded**, which is also the way back: the collapsed edge
    carries the ids it stands for, and asking for one of them by name draws it as a node
    with its own edges again. That is what makes the collapse a reading rather than a
    loss, and it is why a route through a bookmark still lands.

    Returns ``(nodes, links, rests)``. ``rests`` is per drawn statement
    ``{"sources": n, "accounts": m}`` — what the independence number is read off.
    ``degrees`` is corrected in place: a claim whose three citations became one edge
    would otherwise price a click at three and bring nothing, which is the failure the
    honest degree exists to prevent.
    """
    drawn = {node["id"]: node for node in nodes}
    claims = {
        node_id
        for node_id, node in drawn.items()
        if entities.family_of(node["type"]) == entities.CLAIM
    }
    if not claims:
        return nodes, edges, {}

    hidden = list(entry.hides)
    unseen = set(hidden)
    kinds = {node_id: node["type"] for node_id, node in drawn.items()}
    # Every edge a candidate middle holds, as (link, the node at its other end).
    legs: dict[str, list[tuple[dict[str, Any], str]]] = {}
    # ``severed`` too: a removal cuts the provenance edge before this runs, so read from
    # the drawing alone the chain has already lost the leg that makes it one.
    for link in list(edges) + list(severed):
        for near, far in ((link["from"], link["to"]), (link["to"], link["from"])):
            node = drawn.get(near)
            if node is None or near in named or near in claims:
                continue
            if entities.role_of(node["type"]) != entities.ATTESTATION:
                continue
            legs.setdefault(near, []).append((link, far))

    # One query for the edges that reach a middle this drawing does not hold: a type
    # the reading leaves out, or an attestation the budget cut. Both legs of a bridge
    # come back from it — each has one end drawn (the statement, the account) and the
    # other end the middle — so the row names the bridge and what it bridges to at
    # once. Rows whose middle *is* drawn come back too and are dropped here rather
    # than in SQL: they are the ones the pass above already holds.
    #
    # Unmeasured, and worth measuring before it is defended: the list is never empty
    # now, so the query runs in every lens rather than only where a type was left out,
    # and on a case with many captures and proofs the rows it discards are a second scan
    # of what the pass above already read.
    bridging = sorted(unseen | entities.types_with_role(entities.ATTESTATION))
    if bridging and drawn:
        for link in case.links_touching(
            list(drawn), types=list(entry.types), end_types=bridging
        ):
            middle = link["to"] if link["from"] in drawn else link["from"]
            far = link["from"] if middle == link["to"] else link["to"]
            # A named node is never folded, drawn or not. Absent, it was refused by the
            # reading itself, and folding it would offer to hand back an id already in
            # the expansion — a button that answers a click with nothing.
            if middle in drawn or middle in named or far not in drawn:
                continue
            legs.setdefault(middle, []).append((link, far))
        outside = [middle for middle in legs if middle not in drawn]
        if outside:
            kinds.update(
                {entity["id"]: entity["type"] for entity in case.entities_by_ids(outside)}
            )

    held: dict[tuple[str, str, str], dict[str, Any]] = {}
    gone: set[str] = set()
    dropped: set[str] = set()
    # What each statement turns out to rest on, kept as ids so a source folded onto two
    # different accounts is one source rather than two. `attributed` is the sources whose
    # publisher is known at all, which is what keeps "all on one account" from being
    # claimed about a set half of which nobody has traced.
    rests: dict[str, dict[str, set[str]]] = {
        claim_id: {"sources": set(), "accounts": set(), "attributed": set()}
        for claim_id in claims
    }
    for middle, incident in legs.items():
        stated = [
            (link, far)
            for link, far in incident
            if far in claims and link["type"] in links.CLAIM_CONNECTION_TYPES
        ]
        provenance = [
            (link, far)
            for link, far in incident
            if link["type"] in PROVENANCE_VERBS
            and (far in drawn or far in out)
            and far not in claims
        ]
        if not stated or not provenance:
            continue
        # All of it, or none: a middle holding one edge this cannot express stays where
        # it is rather than being folded into a picture that leaves that edge out.
        if len(stated) + len(provenance) != len(incident):
            continue
        publishers = {far for link, far in provenance if link["type"] == links.POSTED}
        gone.add(middle)
        for link, _ in incident:
            dropped.add(link["id"])
        for near, claim_id in stated:
            rests[claim_id]["sources"].add(middle)
            rests[claim_id]["accounts"].update(publishers)
            if publishers:
                rests[claim_id]["attributed"].add(middle)
            for far_link, far_id in provenance:
                # Taken out by hand: the middle still goes, and no edge is drawn to a
                # node that is not there. A removal must never *add* a node, and
                # restoring the three bookmarks an account's fold stood for is exactly
                # that — two nodes became four on the one act that promised fewer.
                if far_id in out:
                    continue
                key = (claim_id, far_id, near["type"])
                folded = held.setdefault(
                    key,
                    {"middles": {}, "accounts": set(), "open": set(),
                     "at": "", "suggested": False},
                )
                folded["middles"][middle] = kinds.get(middle, "")
                folded["accounts"].update(publishers)
                # Offered back when this reading would draw the middle at all — which
                # is a question about its type, not about whether it is on screen. A
                # source the budget cut is handed back by the same `expand` that opens
                # a node; one of a type the lens leaves out could only be refused, so
                # the edge names the lens that does draw it instead.
                if kinds.get(middle, "") not in unseen:
                    folded["open"].add(middle)
                for one in (near, far_link):
                    folded["at"] = max(folded["at"], one["provenance"].get("at", ""))
                    if one["provenance"].get("status") == "suggested":
                        folded["suggested"] = True

    # ``gone`` without ``held`` is the fold whose far end was taken out by hand: there
    # is no edge to draw, and the middles still leave.
    if not held and not gone:
        return nodes, edges, _counted(rests, edges, claims, drawn)

    # A degree says what a click would bring in, so it answers to what is drawn: three
    # citations that became one edge are one connection now, and the two the fold
    # removed must not go on being offered.
    for link in edges:
        if link["id"] not in dropped:
            continue
        for end in (link["from"], link["to"]):
            if end in degrees and end not in gone:
                degrees[end] = max(degrees[end] - 1, 0)

    synthetic = [
        {
            "id": f"{FOLDED_PREFIX}{verb}:{from_id}:{to_id}",
            "from": from_id,
            "to": to_id,
            "type": verb,
            "folded": {
                "sources": len(folded["middles"]),
                "via": sorted({kind for kind in folded["middles"].values() if kind}),
                "accounts": len(folded["accounts"]),
                **({"open": sorted(folded["open"])} if folded["open"] else {}),
            },
            "provenance": {
                # No author: nobody wrote this edge, the reading did. What it can say
                # honestly is when the path was last stated, and that it is only as
                # confirmed as its weakest part — a fold must not launder a proposal
                # into a finding.
                "by": "graph",
                "at": folded["at"],
                "status": "suggested" if folded["suggested"] else "confirmed",
            },
        }
        for (from_id, to_id, verb), folded in sorted(held.items())
    ]
    for link in synthetic:
        for end in (link["from"], link["to"]):
            if end in degrees:
                degrees[end] = degrees.get(end, 0) + 1

    kept = [node for node in nodes if node["id"] not in gone]
    standing = [link for link in edges if link["id"] not in dropped]
    return kept, standing + synthetic, _counted(rests, standing, claims, drawn)


def _star(
    case: CaseRepository,
    entry: Lens,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    named: set[str],
    opened: list[str],
    origins: dict[str, dict[str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, dict[str, int]]]:
    """One finding on the ground drawn once, and what it actually rests on.

    A proof concluding a coordinate states the point of **the whole material behind
    it** — the frame, the collage, the video two hops up, the capture
    (``satellite._state_point``). Four arrows then converge on one dot, and since a
    reading of the ground draws no chain verb, nothing on screen says three of the four
    are the same picture. A reader counts four sources that agree. There is one.

    Clutter is annoying; a false independence claim is a finding the case never made.
    That is what this collapses.

    **The derivation is read even where the reading does not draw it.** Ground holds no
    chain verb at all, and the redundancy is exactly a fact about the chain — so the
    repository is asked, like the safeguard query in ``_fold`` already does. The lens
    decides what is *drawn*, never what is *known*.

    **One edge per root, and the roots are the subjects.** Group the nodes pointing at
    the same place with the same verb, join them by their derivations, and the arrow
    stays on the material the finding is about. The rest fold into it and come back with
    a click.

    A capture is the sharp case and it is why the roles decide. Pulled at the
    coordinates already under suspicion, it is the **reference the comparison was made
    against**, and its ``depicts`` is close to a tautology: counting it as a second
    source states a corroboration nobody found. Shape cannot tell it from the footage —
    in the worked example both have one chain leaving them and one arrow landing — but
    the vocabulary already has: ``media`` is a ``subject``, ``capture`` and ``proof``
    are ``attestation``, the role that means *a wrapper carrying a path*. So a subject
    root keeps the arrow and an attestation root folds into it. A group with no subject
    root keeps its own: a capture nobody made a proof from is the only thing saying
    anything about that point, and it is drawn.

    **All or nothing, as everywhere else here.** A member holding an edge this cannot
    express — a second place, a claim citing it, a derivation reaching outside the
    group — stays a node with its own arrow. It is carrying something the collapsed
    line cannot say.

    **The arrow that survives is the case's own row.** Not a synthetic id: the video
    really does state that point, and an analyst has to be able to confirm or withdraw
    it. So it is annotated (``merged``) rather than replaced, and the acts on it stay.

    **The one fold whose degree is left alone, and expanding beats it.** Every other
    collapse here hands its nodes back from a line that *touches* them: the bookmarks a
    claim cited are on the claim's own edge, the step between a proof and a video is on
    the line between the two. Not this one — a proof that stays drawn loses its
    derivations to a frame and a capture now named on ``video → place``, **a line that
    does not touch the proof at all**. Priced down to nothing, that node would say it has
    no more connections while the analyst is looking straight at two that exist. So the
    degree keeps counting them, and **what an opened node touches is never folded**: the
    click is the analyst asking for exactly these, and it has to answer with them. Read
    off the neighbours rather than off what the expansion *brought*, because on a case
    that fits they are all drawn already and the expansion brings nothing at all — which
    is precisely where the click used to answer with the picture it was pressed on.

    Returns ``(nodes, links, agree)``. ``agree`` is per place ``{sources, accounts,
    one}`` — how many independent origins land on it, the geographic counterpart of
    ``single_account``, reported only where more than one arrow arrived and the number
    is therefore a reading rather than a restatement of the picture.
    """
    landing = {item.type for item in links.RELATION_TYPES if _lands_on_place(item)}
    landing &= set(entry.types)
    if not landing:
        return nodes, edges, {}

    drawn = {node["id"]: node for node in nodes}
    stars: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for link in edges:
        if link["type"] not in landing or link.get("folded"):
            continue
        target = drawn.get(link["to"])
        if target is None or entities.family_of(target["type"]) != entities.PLACE:
            continue
        if link["from"] in drawn and link["from"] != link["to"]:
            stars.setdefault(link["to"], {}).setdefault(link["type"], []).append(link)
    if not stars:
        return nodes, edges, {}

    # One read for every star at once. These are the edges the reading may not draw and
    # the whole answer depends on: Ground holds no chain verb, so asked of the drawing
    # alone, four arrows off one video are four unrelated sources.
    everyone = sorted(
        {link["from"] for verbs in stars.values() for group in verbs.values() for link in group}
    )
    chain = case.links_touching(everyone, types=list(links.CHAIN_TYPES))

    incident: dict[str, list[dict[str, Any]]] = {}
    for link in edges:
        for end in (link["from"], link["to"]):
            if end in drawn:
                incident.setdefault(end, []).append(link)
    spared = set(named) | {
        (link["to"] if link["from"] == one else link["from"])
        for one in opened
        for link in incident.get(one, ())
    }

    landed: dict[str, int] = {}
    behind: dict[str, set[str]] = {}
    folding: set[str] = set()
    # Keyed by the arrow that absorbs them: one node can state two points, and what it
    # took on the first is not what it took on the second.
    merged: dict[str, set[str]] = {}
    for place_id, verbs in sorted(stars.items()):
        # **The family is every arrow on the point, whatever verb it is written with.**
        # Answering POV writes `located-at` on the material and leaves `depicts` on the
        # composition and the capture, so one material arrives under two verbs. Read per
        # verb, each half sees the other as outside itself, the all-or-nothing rule
        # refuses both and nothing collapses at all — and the picture goes back to
        # claiming two origins where the case has one.
        family = {link["from"] for group in verbs.values() for link in group}
        landed[place_id] = sum(len(group) for group in verbs.values())
        arrows: dict[str, dict[str, str]] = {}
        for verb, group in verbs.items():
            for link in group:
                arrows.setdefault(link["from"], {})[verb] = link["id"]

        out: dict[str, set[str]] = {member: set() for member in family}
        near: dict[str, set[str]] = {member: set() for member in family}
        for link in chain:
            source, holder = link["to"], link["from"]
            if holder in family and source in family and holder != source:
                out[holder].add(source)
                near[holder].add(source)
                near[source].add(holder)

        def _roots(start: str, out: dict[str, set[str]] = out) -> set[str]:
            """Where this one's derivation ends. Itself when it starts nowhere, and
            when it runs in a circle — a loop names no origin, so nothing on it may
            claim to be one."""
            seen: set[str] = set()
            found: set[str] = set()
            frontier = [start]
            while frontier:
                current = frontier.pop()
                if current in seen:
                    continue
                seen.add(current)
                if out[current]:
                    frontier.extend(out[current])
                else:
                    found.add(current)
            return found or {start}

        kept: set[str] = set()
        home: dict[str, set[str]] = {}
        left = set(family)
        while left:
            frontier = [left.pop()]
            component = set(frontier)
            while frontier:
                for far in near[frontier.pop()]:
                    if far not in component:
                        component.add(far)
                        frontier.append(far)
            left -= component
            roots = {member for member in component if not out[member]}
            subjects = {
                member
                for member in roots
                if entities.role_of(drawn[member]["type"]) != entities.ATTESTATION
            }
            # A component that is one derivation loop has no root at all. Nothing in it
            # is an origin, so nothing in it is folded away either.
            here = subjects or roots or component
            kept |= here
            for member in component:
                home[member] = here
        # What the point rests on is counted over the **family**, once, whatever verbs
        # its arrows are written with: a capture reached through the same footage is the
        # reference either way.
        behind.setdefault(place_id, set()).update(kept)

        for member in sorted(family - kept - spared):
            # All or nothing: everything this one holds is one of its own arrows onto
            # this point, or a derivation inside the family. Anything else — a second
            # place, a statement citing it, a chain reaching outside — is something the
            # collapsed line cannot say, so it stays a node with its arrows.
            mine = set(arrows[member].values())
            spare = [
                link
                for link in incident.get(member, ())
                if link["id"] not in mine
                and not (
                    link["type"] in links.CHAIN_TYPES
                    and (link["to"] if link["from"] == member else link["from"]) in family
                )
            ]
            if spare:
                continue
            folding.add(member)
            # Where its arrows go. Its own roots when they are kept; otherwise it is an
            # attestation root itself — the capture — and it joins the material of the
            # component it was compared against. **Whatever verb it was written with**:
            # the surviving line is the root's own statement, the folded one is named on
            # it, and one click brings it back saying exactly what it said.
            for root in (_roots(member) & home[member]) or home[member]:
                held = arrows[root]
                for verb in arrows[member]:
                    landing_on = held.get(verb) or held[sorted(held)[0]]
                    merged.setdefault(landing_on, set()).add(member)

    if not folding:
        return nodes, edges, _agrees(landed, behind)

    dropped = {link["id"] for member in folding for link in incident.get(member, ())}
    standing = []
    for link in edges:
        if link["id"] in dropped:
            continue
        ids = merged.get(link["id"])
        if not ids:
            standing.append(link)
            continue
        standing.append(
            {
                **link,
                # Annotated, never replaced: this row is the case's own statement, and
                # confirming or withdrawing it has to stay possible.
                "merged": {
                    "sources": len(ids),
                    "via": sorted({_act(drawn[one], origins) for one in ids}),
                    "open": sorted(ids),
                },
            }
        )
    return (
        [node for node in nodes if node["id"] not in folding],
        standing,
        _agrees(landed, behind),
    )


def _agrees(
    landed: dict[str, int], behind: dict[str, set[str]]
) -> dict[str, dict[str, int]]:
    """Per place, how many independent origins land on it.

    Reported only where more than one arrow arrived: on a point stated once the number
    restates the picture, and a count that says nothing is a count nobody reads. The
    account clause is carried at zero so the surface that already reads a statement's
    independence reads this one with no second branch — nobody publishes a coordinate.
    """
    return {
        place_id: {"sources": len(behind.get(place_id, ())), "accounts": 0, "one": False}
        for place_id, arrows in landed.items()
        if arrows > 1 and behind.get(place_id)
    }


def _reads_the_case(entry: Lens) -> bool:
    """Whether this reading collapses the derivation chain at all.

    Two things make one a reading of the **case**: it draws the chain, and it leaves
    the analyst's own output out. ``My work`` is the filing read on its own terms —
    *what did I write, and out of what* is the question it exists to answer — so
    collapsing the production chain there would collapse its answer. Asked of the lens
    rather than of its id, because a lens is derived and a name is not.
    """
    return bool(set(links.CHAIN_TYPES) & set(entry.types)) and set(entry.roles) == set(
        CASE_ROLES
    )


def _act(node: dict[str, Any], origins: dict[str, dict[str, str]]) -> str:
    """What to call one derivative: the act when the case made it, the type otherwise.

    *1 frame* says what *1 media* cannot, and the reading needs the word twice — on the
    edge a step becomes and on the count a source carries — so it is resolved once here.
    The words themselves live on the one surface that writes them (`entityIcon.js`):
    this sends the act, not a second vocabulary's rendering of it.
    """
    op = (origins.get(node["id"]) or {}).get("op")
    return op or str(node["type"])


def _relay(
    entry: Lens,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    degrees: dict[str, int],
    named: set[str],
    origins: dict[str, dict[str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """A derivative that only relays its source to what was made from it, as an edge.

    A frame is pulled out of a video and a proof is built on the frame. The frame is
    three things at once — a node, a picture, a step — and only the third is a fact the
    drawing has to state: *this proof was made out of that video*. Drawn as a node it
    spends a slot to say "there was a step here", and a video with twelve saved frames
    draws as thirteen pictures of the same thing.

    ::

        before   proof --derived-from--> frame --derived-from--> video
        after    proof --derived-from (1 frame)----------------> video

    **Every drawn edge a chain verb, and exactly one of them outgoing.** The first half
    is the all-or-nothing rule ``_fold`` already keeps: a frame that shows a place, or
    that a statement cites, carries something an edge between its neighbours cannot say,
    so it stays a node. The second half is a direction guard, and it is what a plain
    geolocation taught: a proof derived from **both** a frame and a capture is a
    confluence, not a passage, and folding it would state ``capture derived-from video``
    — a claim that the overhead imagery came out of the footage, which is false and is
    exactly the false convergence this whole reading exists to stop.

    **It must relay something.** A derivative nothing was made from is a chain leaf, not
    a passage: folded here it would leave the drawing with nothing saying the video has
    twelve frames at all. Rolling those onto their source with a count is its own act
    (SPEC §6), and this pass leaves them where they are rather than dropping them
    silently.

    **Passages in a row resolve to the far end.** A frame adjusted and then built on is
    two steps and one sentence, so the walk runs to the first node that is not itself a
    passage and the edge names every step it went through. A derivation that loops back
    on itself has no far end — nothing on it is a source — so none of it folds.

    **Only in a reading of the case.** ``My work`` is the filing read on its own terms:
    *what did I write, and out of what* is the question it exists to answer, and folding
    the production chain there would fold the answer. So the pass asks the two things
    that make a reading one of the case — that it draws the chain at all, and that it
    leaves the analyst's own output out — rather than naming a lens.

    A named node is never folded, which is the way back: the edge carries the ids it
    stands for and ``expand`` draws them again, the same mechanism ``_fold`` uses.
    ``degrees`` is corrected in place for the same reason it is there — a click that
    would bring nothing must not be priced as though it would.
    """
    if not _reads_the_case(entry):
        return nodes, edges

    drawn = {node["id"]: node for node in nodes}
    incident: dict[str, list[dict[str, Any]]] = {}
    for link in edges:
        for end in (link["from"], link["to"]):
            if end in drawn:
                incident.setdefault(end, []).append(link)

    # Each passage with the one edge that leaves it: its source.
    passage: dict[str, dict[str, Any]] = {}
    for node_id, touching in incident.items():
        if node_id in named:
            continue
        if any(link["type"] not in links.CHAIN_TYPES for link in touching):
            continue
        out = [link for link in touching if link["from"] == node_id and link["to"] != node_id]
        if len(out) != 1 or len(touching) == len(out):
            continue
        passage[node_id] = out[0]
    if not passage:
        return nodes, edges

    # A derivation that comes back to where it started names no source, so nothing on
    # it is relaying anything. Every node on the loop stays drawn, and whatever hangs
    # off it resolves onto the loop instead, which is where the walk now stops.
    looping = set()
    for start in passage:
        seen: set[str] = set()
        current = start
        while current in passage:
            if current in seen:
                looping.add(start)
                break
            seen.add(current)
            current = passage[current]["to"]
    for node_id in looping:
        passage.pop(node_id)
    if not passage:
        return nodes, edges

    def _walk(start: str) -> tuple[str, list[str]]:
        """The first node that is not a passage, and every step taken to reach it."""
        steps: list[str] = []
        current = start
        while current in passage:
            steps.append(current)
            current = passage[current]["to"]
        return current, steps

    held: dict[tuple[str, str, str], dict[str, Any]] = {}
    dropped = {link["id"] for middle in passage for link in incident[middle]}
    for middle in passage:
        for link in incident[middle]:
            # Its own outgoing edge, and the consumers that are passages themselves:
            # those arrive here through the one node at the end of their own walk.
            if link["to"] != middle or link["from"] in passage:
                continue
            root, steps = _walk(middle)
            folded = held.setdefault(
                (link["from"], root, link["type"]),
                {"middles": [], "at": "", "suggested": False},
            )
            for step in steps:
                if step not in folded["middles"]:
                    folded["middles"].append(step)
            for one in [link] + [passage[step] for step in steps]:
                folded["at"] = max(folded["at"], one["provenance"].get("at", ""))
                if one["provenance"].get("status") == "suggested":
                    folded["suggested"] = True

    for link in edges:
        if link["id"] not in dropped:
            continue
        for end in (link["from"], link["to"]):
            if end in degrees and end not in passage:
                degrees[end] = max(degrees[end] - 1, 0)

    synthetic = [
        {
            "id": f"{FOLDED_PREFIX}{verb}:{from_id}:{to_id}",
            "from": from_id,
            "to": to_id,
            "type": verb,
            "folded": {
                "sources": len(folded["middles"]),
                "via": sorted({_act(drawn[step], origins) for step in folded["middles"]}),
                # No publisher on this side: a derivation is the case's own act, and
                # "0 accounts" would read as a gap rather than as "not that kind of
                # step". The edge says one thing instead of two.
                "accounts": 0,
                "open": sorted(folded["middles"]),
            },
            "provenance": {
                "by": "graph",
                "at": folded["at"],
                "status": "suggested" if folded["suggested"] else "confirmed",
            },
        }
        for (from_id, to_id, verb), folded in sorted(held.items())
    ]
    for link in synthetic:
        for end in (link["from"], link["to"]):
            if end in degrees:
                degrees[end] = degrees.get(end, 0) + 1

    return (
        [node for node in nodes if node["id"] not in passage],
        [link for link in edges if link["id"] not in dropped] + synthetic,
    )


def _roll(
    entry: Lens,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    named: set[str],
    opened: list[str],
    origins: dict[str, dict[str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Derivatives nothing was made from, as a count on the thing they came out of.

    Twelve frames saved off a video and not used yet are twelve pictures of the same
    video, and the drawing spends twelve slots saying "twelve frames exist". The video
    already says it: *12 frames*, on the node they came out of, and one click brings
    them back as nodes.

    **Deliberately narrow, and the narrowness is the whole design.** One drawn edge, it
    is a chain verb, and the node is the end that was **derived** — it points at its
    source rather than being pointed at. Three consequences, each of them the point:

    * a leaf with a single *relation* is untouched. Rolling those up would start putting
      away a person with one link, which is a picture of the case with its thin material
      hidden — and thin material is what the case has yet to exploit, not what it should
      stop showing.
    * the direction settles the pair. A video and its one unused frame are both
      single-edge nodes; only the frame came out of the other, so only the frame rolls,
      and the picture keeps the collected material rather than the derivative.
    * a chain leaf that is also a passage has already gone (``_relay``), and what is
      left here relays nothing by construction.

    **Never across a collapsed step.** A leaf whose one edge is already a fold stays a
    node: that line stands for something and offers it back, and burying it inside a
    counter would put two acts behind one number and lose the way to the step.

    **The count is a fact, not an offer.** The node goes on pricing those twelve among
    the connections the drawing does not hold, and **what an opened node touches is
    never rolled up**, so the one act that brings them is the one that brings every
    other missing neighbour: *expand*. Priced down instead, the node reported four
    connections away while offering twelve elsewhere, and the analyst read two counters
    for one question — a distinction about the mechanism rather than about the case.

    Returns ``(nodes, links, rolled)``, ``rolled`` being per surviving node
    ``{count, via, open}`` — what came out of it, in the act's own word, with the ids
    the sentence names.
    """
    if not _reads_the_case(entry):
        return nodes, edges, {}

    drawn = {node["id"]: node for node in nodes}
    incident: dict[str, list[dict[str, Any]]] = {}
    for link in edges:
        for end in (link["from"], link["to"]):
            if end in drawn:
                incident.setdefault(end, []).append(link)

    # Asking for a node is asking for what it touches, so an expansion outranks this
    # the way it outranks the star fold: read off the neighbours rather than off what
    # the expansion brought, since on a case that fits they are all drawn already.
    spared = set(named) | {
        (link["to"] if link["from"] == one else link["from"])
        for one in opened
        for link in incident.get(one, ())
    }

    onto: dict[str, list[str]] = {}
    gone: dict[str, str] = {}
    for node_id, held in incident.items():
        # A node with no edge at all is not here: it is the case's unexploited
        # material, it is what ``isolated`` counts, and it belongs to nobody.
        if node_id in spared or len(held) != 1:
            continue
        link = held[0]
        if link["type"] not in links.CHAIN_TYPES or link.get("folded"):
            continue
        if link["from"] != node_id or link["to"] not in drawn:
            continue
        onto.setdefault(link["to"], []).append(node_id)
        gone[node_id] = link["id"]
    if not gone:
        return nodes, edges, {}

    rolled = {
        source_id: {
            "count": len(leaves),
            "via": sorted({_act(drawn[leaf], origins) for leaf in leaves}),
            "open": sorted(leaves),
        }
        for source_id, leaves in onto.items()
    }
    dropped = set(gone.values())
    return (
        [node for node in nodes if node["id"] not in gone],
        [link for link in edges if link["id"] not in dropped],
        rolled,
    )


def _counted(
    rests: dict[str, dict[str, set[str]]],
    edges: list[dict[str, Any]],
    claims: set[str],
    drawn: dict[str, dict[str, Any]],
) -> dict[str, dict[str, int]]:
    """Per statement, how many sources it rests on and how many accounts published them.

    Read off what the drawing can say, which is the honest scope: a cut view already
    says it was cut. The sources a fold stands for are counted through the fold, and
    the ones still drawn as nodes are counted where they are — so citing three
    bookmarks reads as three sources whether or not they collapsed, and whether or not
    the budget kept them, since a fold reaches a middle the drawing does not hold.

    ``accounts`` is what makes the number worth having: three citations that all trace
    back to one account are one source, and that is a measurement rather than a
    judgement (SPEC anti-goals).
    """
    posted: dict[str, set[str]] = {}
    for link in edges:
        if link["type"] == links.POSTED:
            posted.setdefault(link["to"], set()).add(link["from"])
    for link in edges:
        if link["type"] != links.CITES or link["from"] not in rests:
            continue
        source = link["to"]
        if source not in drawn or source in claims:
            continue
        rests[link["from"]]["sources"].add(source)
        rests[link["from"]]["accounts"].update(posted.get(source, ()))
        if posted.get(source):
            rests[link["from"]]["attributed"].add(source)
    return {
        claim_id: {
            "sources": len(held["sources"]),
            "accounts": len(held["accounts"]),
            # Whether every one of those sources traces back to the same account, which
            # is the finding. A set half of which nobody has traced is not it: the
            # untraced half may well be independent, and saying otherwise would be a
            # judgement rather than a measurement.
            "one": len(held["sources"]) > 1
            and len(held["accounts"]) == 1
            and held["attributed"] == held["sources"],
        }
        for claim_id, held in rests.items()
        if held["sources"]
    }




def neighborhood(
    case: CaseRepository,
    root_id: str,
    *,
    lens_id: str = "all",
    hops: int = 1,
    limit: int | None = None,
) -> dict[str, Any]:
    """One node, and what reaches it within ``hops``.

    The walk stops on whichever comes first: the hop budget, or the node budget.
    Stopping on the budget is reported rather than silently trimmed, because a
    view that quietly dropped half a neighbourhood would read as a finding about
    the case. Every node carries its full degree in this lens, so what a further
    expansion would bring in is visible on the node itself.

    **The edges are closed once, at the end, over everything the walk loaded.** The
    walk finds nodes; it is a bad witness for edges, because an edge between two
    nodes reached at the *same* hop touches neither of the frontiers that found them.
    Collected hop by hop, the outermost ring came back with no edges inside it: a
    triangle around a root drew as a star, and both its far nodes reported the edge
    between them as a connection further out than the hops asked for.

    The walk obeys the lens on both axes: it steps over its verbs and never onto a
    node it does not draw. A root the lens leaves out is refused rather than drawn as
    the one exception, because a reading with one node in it that does not belong to
    that reading is not the reading it says it is.
    """
    entry = lens(lens_id)
    verbs = list(entry.types)
    hidden = list(entry.hides)
    bounded = max(1, min(int(OPENING_NODES if limit is None else limit), MAX_OPENING))
    depth = max(1, min(int(hops), MAX_HOPS))

    root = case.get_entity(root_id)
    if root is None:
        raise CaseError(f"entity '{root_id}' not found")
    _drawn(entry, root)

    found: dict[str, dict[str, Any]] = {root_id: root}
    distance = {root_id: 0}
    frontier = [root_id]
    truncated = False

    for hop in range(1, depth + 1):
        if not frontier or len(found) >= bounded:
            break
        reached: list[str] = []
        for link in case.links_touching(frontier, types=verbs, exclude_types=hidden):
            far = link["to"] if link["from"] in found else link["from"]
            if far not in found:
                if len(found) + len(reached) >= bounded:
                    truncated = True
                    continue
                if far not in reached:
                    reached.append(far)
        for entity in case.entities_by_ids(reached):
            found[entity["id"]] = entity
            distance[entity["id"]] = hop
        frontier = [entity_id for entity_id in reached if entity_id in found]

    ids = list(found)
    # The same closed set `view` draws, asked once now that every node is known:
    # both ends loaded, so nothing drawn dangles, and an edge inside the outermost
    # ring is in the picture rather than reported as lying beyond it.
    edges = case.links_among(ids, types=verbs)
    degrees = case.degrees_of(ids, types=verbs, exclude_types=hidden)
    walked = [found[i] for i in ids]
    thumbs = _previews(case, walked)
    kinds = _kinds(case, walked)
    origins = _origins(case, walked)
    return {
        "lens": entry.id,
        "root": root_id,
        "hops": depth,
        "nodes": [
            _node(
                found[i], degrees.get(i, 0), distance.get(i, 0),
                thumb=thumbs.get(i), kind=kinds.get(i), origin=origins.get(i),
            )
            for i in ids
        ],
        "links": edges,
        "shown": len(ids),
        "truncated": truncated,
    }




def paths(
    case: CaseRepository,
    from_id: str,
    to_id: str,
    *,
    lens_id: str = "all",
    max_hops: int = MAX_PATH_HOPS,
    limit: int = MAX_PATHS,
) -> dict[str, Any]:
    """How one entity reaches another: every shortest route between them.

    **The question the tool existed without.** A case answers "what touches this"
    one hop at a time, and an investigation asks "how does this reach that" — the
    account and the place, the claim and the source. Held in the analyst's head
    until now, one click at a time.

    *Every* shortest route, not one of them, because the ties are the finding: two
    accounts reaching the same place through two different sources is what
    independence looks like, and an answer that picked one would hide the thing
    worth seeing. Longer routes are not returned at all — once a shorter one exists
    the long way round says nothing about how the two are connected.

    **Searched from both ends.** A one-sided walk at four hops on a hub-heavy case
    loads most of the case, because the hub is reached at hop one and everything it
    touches at hop two. Meeting in the middle spends two hops a side instead of
    four, which is the difference between a query and a stall. Whichever side has
    fewer nodes to open is the one that grows, so a walk out of a quiet corner into
    a busy one stays cheap.

    Undirected, like every other reading of distance here: an arrowhead says what
    the edge claims, not which way a route may run. The direction is kept on each
    link so the sentence can read it back the way the case states it.

    Bounded by the lens on both axes, like every other read: a route only ever runs
    over verbs it draws and through nodes it draws, so the sentence it answers with is
    one the drawing can show.
    """
    entry = lens(lens_id)
    verbs = list(entry.types)
    hidden = list(entry.hides)
    depth = max(1, min(int(max_hops), MAX_PATH_HOPS))
    wanted = max(1, min(int(limit), MAX_PATHS))

    ends = {entity["id"]: entity for entity in case.entities_by_ids([from_id, to_id])}
    for entity_id in (from_id, to_id):
        if entity_id not in ends:
            raise CaseError(f"entity '{entity_id}' not found")
        _drawn(entry, ends[entity_id])

    held: dict[str, dict[str, Any]] = {}
    # One step back towards the node the walk started from, per side. A pair joined
    # by two verbs records both: they are two different findings, and the sentence
    # is where they read apart.
    behind: list[dict[str, list[tuple[str, str]]]] = [{from_id: []}, {to_id: []}]
    seen: list[dict[str, int]] = [{from_id: 0}, {to_id: 0}]
    edge: list[list[str]] = [[from_id], [to_id]]
    reach = 0
    truncated = False
    # Checked before the first step so that a node asked about against itself is a
    # route of length zero rather than a walk looking for one.
    met: list[str] = sorted(node for node in seen[0] if node in seen[1])

    while not met and reach < depth and edge[0] and edge[1]:
        # The cheaper side grows. A frontier of three against a frontier of four
        # hundred is the whole reason this is not a one-sided walk.
        side = 0 if len(edge[0]) <= len(edge[1]) else 1
        if len(seen[side]) >= MAX_PATH_VISIT:
            truncated = True
            break
        reach += 1
        step = seen[side][edge[side][0]] + 1
        ahead: list[str] = []
        # A route through a node this reading does not draw is not a route it can
        # show: the sentence would name a node that is not on screen, and the view
        # that tried to bring it in would refuse for the same reason.
        for link in case.links_touching(edge[side], types=verbs, exclude_types=hidden):
            held[link["id"]] = link
            near, far = link["from"], link["to"]
            if near not in seen[side] or seen[side].get(near) != step - 1:
                near, far = far, near
            if seen[side].get(near) != step - 1 or far == near:
                continue
            if far in seen[side] and seen[side][far] < step:
                continue
            if far not in seen[side]:
                if len(seen[side]) >= MAX_PATH_VISIT:
                    truncated = True
                    continue
                seen[side][far] = step
                behind[side].setdefault(far, [])
                ahead.append(far)
            behind[side][far].append((near, link["id"]))
        edge[side] = ahead
        met = sorted(node for node in seen[0] if node in seen[1])

    if not met:
        return _no_path(entry.id, from_id, to_id, depth, truncated)

    shortest = min(seen[0][node] + seen[1][node] for node in met)
    routes: list[dict[str, list[str]]] = []
    for node in met:
        if len(routes) >= wanted or seen[0][node] + seen[1][node] != shortest:
            continue
        # One side was walked out of `from`, the other out of `to`, so the second
        # half arrives reversed. Its meeting node is dropped rather than written
        # twice, and its links are read back in the order the route runs.
        for head in _routes(behind[0], node, from_id, wanted):
            for tail in _routes(behind[1], node, to_id, wanted):
                if len(routes) >= wanted:
                    truncated = True
                    break
                routes.append(
                    {
                        "nodes": head["nodes"] + list(reversed(tail["nodes"]))[1:],
                        "links": head["links"] + list(reversed(tail["links"])),
                    }
                )

    walked = [node for route in routes for node in route["nodes"]]
    on_path = list(dict.fromkeys(walked))
    used = list(dict.fromkeys(link for route in routes for link in route["links"]))
    found = {entity["id"]: entity for entity in case.entities_by_ids(on_path)}
    degrees = case.degrees_of(on_path, types=verbs, exclude_types=hidden)
    kept = [found[i] for i in on_path if i in found]
    thumbs = _previews(case, kept)
    kinds = _kinds(case, kept)
    origins = _origins(case, kept)
    return {
        "lens": entry.id,
        "from": from_id,
        "to": to_id,
        "hops": shortest,
        "found": True,
        "routes": routes,
        "nodes": [
            _node(
                found[i], degrees.get(i, 0), None,
                thumb=thumbs.get(i), kind=kinds.get(i), origin=origins.get(i),
            )
            for i in on_path if i in found
        ],
        "links": [held[i] for i in used if i in held],
        "searched": depth,
        "truncated": truncated,
    }


def _no_path(
    lens_id: str, from_id: str, to_id: str, depth: int, truncated: bool
) -> dict[str, Any]:
    """No route inside the budget, which is an answer and not a failure.

    Said apart from "no such entity" and apart from "gave up": an analyst who
    learns two entities are *not* connected within four hops has learned something
    about the case, where an empty response would read as the tool having no
    opinion.
    """
    return {
        "lens": lens_id,
        "from": from_id,
        "to": to_id,
        "hops": 0,
        "found": False,
        "routes": [],
        "nodes": [],
        "links": [],
        "searched": depth,
        "truncated": truncated,
    }


def _routes(
    behind: dict[str, list[tuple[str, str]]], node: str, stop: str, wanted: int
) -> list[dict[str, list[str]]]:
    """Every way back from ``node`` to ``stop``, following one side's steps.

    Walked backwards from the meeting point and then reversed by the caller, since
    that is the direction the predecessors were recorded in. Capped on the way out
    rather than after: a hub can hold thousands of equally short ways back, and
    building them all to keep twelve is the cost this search exists to avoid.
    """
    if node == stop:
        return [{"nodes": [node], "links": []}]
    out: list[dict[str, list[str]]] = []
    for prev, link_id in behind.get(node, []):
        for route in _routes(behind, prev, stop, wanted):
            if len(out) >= wanted:
                return out
            out.append({"nodes": route["nodes"] + [node], "links": route["links"] + [link_id]})
    return out


def _previews(case: CaseRepository, entities: list[dict[str, Any]]) -> dict[str, str]:
    """The cached preview of each of these entities that has one, keyed by entity.

    Two sources, one query. **Media** is in the browse index. **Anything else that
    records a preview** carries the path on the entity itself, which is how a proof
    reaches the graph without its spec file being opened — the copy onto the entity
    is made by the caller that has the filesystem, since this module answers from
    the database alone.

    Nothing here renders anything. A read that draws does no CPU work, so an entity
    whose picture was never cached has no preview and draws as its glyph.
    """
    ids = [entity["id"] for entity in entities]
    found = dict(case.media_thumbs(ids)) if ids else {}
    found.update(case.entity_image_thumbs(ids))
    for entity in entities:
        recorded = entity.get("attrs", {}).get("thumb")
        if recorded and entity["id"] not in found:
            found[entity["id"]] = recorded
    return found


def _kinds(case: CaseRepository, entities: list[dict[str, Any]]) -> dict[str, str]:
    """What the bytes behind each media entity are: image, video, audio or file.

    A drawn `media` node that cannot say which of those it holds is drawn with the
    generic file glyph and reads as a document, which is the picture telling the
    analyst something untrue about the case. One type covers all four, so the answer
    is a property of the file rather than of the vocabulary.

    Two sources, the same two as the previews. The **browse index** is the authority,
    because the importer put the MIME-derived kind there. `attrs.kind` covers an
    entity the index has never seen — one filed by a tool that writes the attr
    without registering a browse row. Nothing here opens a file: a read that draws
    does no I/O beyond the database.
    """
    ids = [entity["id"] for entity in entities if entity["type"] == "media"]
    if not ids:
        return {}
    found = dict(case.media_kinds(ids))
    for entity in entities:
        stated = entity.get("attrs", {}).get("kind")
        if stated and entity["id"] not in found:
            found[entity["id"]] = stated
    return found


def _origins(case: CaseRepository, entities: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """Which of these nodes were **made here**, and by which act.

    A frame pulled out of a video, an adjusted image, a collage: filed as ordinary
    media, drawn with the same glyph as a photograph the case collected, and a video
    with twelve saved frames draws as thirteen pictures with nothing saying which
    twelve came out of the first. The material is not the finding, and a drawing that
    cannot tell the two apart makes the analyst open files to find out.

    Only ``links.MADE_HERE`` routes are carried, the same set the Media Library hides
    on. The index knows how everything came in, but *how it was collected* is that
    list's question — the graph asks the narrower one, so an upload carries nothing
    rather than carrying "upload" for a reader to ignore.

    One query, off indexed columns, and no fallback onto the entity: unlike the kind,
    nothing writes this to ``attrs``, and a fallback nobody fills is a branch that
    only ever lies. A node the index has never seen is silent.
    """
    ids = [entity["id"] for entity in entities]
    if not ids:
        return {}
    return {
        entity_id: origin
        for entity_id, origin in case.media_origins(ids).items()
        if origin.get("type") in links.MADE_HERE
    }


def _node(
    entity: dict[str, Any],
    degree: int,
    distance: int | None = None,
    *,
    thumb: str | None = None,
    kind: str | None = None,
    origin: dict[str, str] | None = None,
    pin: tuple[float, float] | None = None,
    added: bool = False,
    rests: dict[str, int] | None = None,
    rolled: dict[str, Any] | None = None,
    query: str | None = None,
) -> dict[str, Any]:
    """One entity as the graph needs it: identity, family, degree and a preview.

    The family travels with the node so a client groups and colours without a
    second lookup against the entity registry, and ``degree`` is what a node shows
    before it is expanded.

    ``thumb`` is the *cached thumbnail*, never the file itself: a case draws a few
    hundred nodes at once, and a node that reached for its own full-size image
    would download the case to draw it. An entity with no indexed media carries no
    key at all, which is what lets a client tell "no picture" from "not loaded".

    Two kinds of entity have one, read the same way for both. Media is in the browse
    index, keyed by entity. A proof records its own on the entity, because a proof's
    thumbnail otherwise lives in its spec file and reading a few hundred of those to
    draw a graph is exactly the cost this argument exists to avoid. **Nothing here
    ever generates a thumbnail** — a read that draws must not do CPU work — so an
    entity whose picture was never cached draws as its glyph.

    ``kind`` is what a media node actually holds — image, video, audio or file — and
    is carried only for the one type where it is a real question: `media` covers all
    four, so without it every one of them draws as a generic file and reads as a
    document.

    ``origin`` says the node was **made here** and by which act — ``{origin, op}``,
    a frame or a collage out of material the case already holds. Carried only for
    those, never for collected material, so its presence is the whole signal and a
    client tests for it rather than comparing it against a list of routes.

    ``pin`` is where the analyst dragged the node, absent when nobody has. It only
    reaches a whole-case view: a neighbourhood gives the horizontal axis to distance
    from the root, so a coordinate stated against the cluster would fight the one
    thing that arrangement is for.

    ``added`` marks a node an expansion brought in rather than the ranking. The
    picture has to be able to say which nodes just arrived, or growing the view is
    indistinguishable from the view having changed under the analyst.

    ``rests`` is what a statement rests on — ``{sources, accounts}`` — carried on the
    node because that is where it is read. Three citations tracing back to one account
    are one source, and a node that cannot say so leaves the analyst counting bookmarks
    by eye. Only a ``claim`` carries it, and only when it cites anything at all.

    ``rolled`` is what came out of this one and was not used — ``{count, via, open}``.
    Twelve frames off a video are the video's own fact, and the ids are the way back:
    nothing is put away without the node that holds it saying so and offering it.
    """
    node: dict[str, Any] = {
        "id": entity["id"],
        "type": entity["type"],
        "label": entity["label"],
        "family": entities.family_of(entity["type"]),
        "status": entity.get("provenance", {}).get("status", "confirmed"),
        "at": entity.get("provenance", {}).get("at", ""),
        "degree": degree,
    }
    folder = entity.get("attrs", {}).get("folder")
    if folder:
        node["folder"] = folder
    preview = thumb or entity.get("thumb") or entity.get("attrs", {}).get("thumb")
    if preview:
        node["thumb"] = preview
    if kind:
        node["kind"] = kind
    if origin:
        node["origin"] = origin["type"]
        if origin.get("op"):
            node["op"] = origin["op"]
    if pin is not None:
        node["pin"] = [pin[0], pin[1]]
    if added:
        node["added"] = True
    if rests:
        node["rests"] = dict(rests)
    if rolled:
        node["rolled"] = dict(rolled)
    if matches := entities.search_matches(entity, query):
        node["matches"] = matches
    if distance is not None:
        node["hop"] = distance
    return node


def _drawn(entry: Lens, entity: dict[str, Any]) -> None:
    """Refuse a node this reading does not draw, where one was named by id.

    The whole-case view answers by leaving it out — it was ranking a set, and a set is
    allowed to be missing a member. A neighbourhood and a route are named questions
    about particular nodes, so there is no honest answer to give: drawing the node
    would break the reading, and answering with an empty picture would read as a
    finding about the case. Said in words instead, naming the lens that does draw it.
    """
    if entity["type"] in entry.hides:
        raise CaseError(
            f"the {entry.label} lens does not draw a {entity['type']}"
        )


def _status(value: str | None) -> Any:
    return value if value in ("confirmed", "suggested") else None
