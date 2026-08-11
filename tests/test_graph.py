"""The case drawn as a graph (SPEC §6, v2 "Case graph"; `engine/graph.py`).

Four rules carry this file.

**A lens is derived, never declared twice.** The verbs live in the relation
registry and the node roles on `EntityType`, so every verb must land in exactly one
reading, every type must declare a role, and neither addition may need an edit here.
A lens that had to be maintained by hand would be a second vocabulary, which is the
thing the registries exist to prevent.

**A lens narrows nodes, not only verbs.** What the analyst wrote is the filing rather
than the case, so a post and a note leave the default drawing and one lens fetches
them back. The narrowing reaches the degree too: a node may not state a connection
this reading has no way to show.

**Bounded means bounded.** No request may reach the whole graph, and a view that
was cut has to say so rather than present a slice as the case.

**A cut view keeps the hubs.** Which nodes survive truncation is the whole
question for a case too large to draw: ordering by degree keeps the shape of the
case on screen, where an arbitrary slice would misrepresent it.
"""

import io
import json
import sqlite3

from bigcase import build_big_case
from PIL import Image

from azimut.engine import entities as entity_engine
from azimut.engine import graph as graph_engine
from azimut.engine import links as link_engine
from azimut.workspace import Case


def _case(client, name):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _entity(client, cid, type_, label, attrs=None):
    res = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": type_, "label": label, "attrs": attrs or {}},
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _media(client, cid, label):
    """A picture the vocabulary accepts either end of: `depicts` and `appears-in` both
    narrow to image or video, so a bare media entity is refused."""
    return _entity(
        client, cid, "media", label, {"path": f"media/{label}.jpg", "kind": "image"}
    )


def _link(client, cid, from_id, to_id, type_):
    res = client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": from_id, "to_id": to_id, "type": type_},
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _graph(client, cid, **params):
    res = client.get(f"/api/cases/{cid}/graph", params=params)
    assert res.status_code == 200, res.text
    return res.json()


def _ids(payload):
    return {node["id"] for node in payload["nodes"]}


def _node(payload, entity_id):
    return next(node for node in payload["nodes"] if node["id"] == entity_id)


# -- the lens vocabulary ------------------------------------------------------


def test_every_verb_the_registry_knows_lands_in_exactly_one_lens():
    """A verb in no lens is unreachable; a verb in two is an ambiguity the
    analyst has to resolve. Both are the drift a derived lens exists to stop, so
    adding a relation type without touching `graph.py` has to keep this green."""
    every = set(link_engine.CHAIN_TYPES) | {e.type for e in link_engine.RELATION_TYPES}
    homes: dict[str, list[str]] = {verb: [] for verb in every}
    for lens in graph_engine.lenses():
        if lens.id == "all":
            continue
        for verb in lens.types:
            homes[verb].append(lens.id)
    assert all(len(where) == 1 for where in homes.values()), homes


def test_the_everything_lens_holds_every_verb():
    every = set(link_engine.CHAIN_TYPES) | {e.type for e in link_engine.RELATION_TYPES}
    assert set(graph_engine.lens("all").types) == every


def test_geography_is_what_a_verb_targets_not_what_it_is_called():
    """The ground lens is derived from the endpoint families, so a verb landing on
    a place belongs to it whatever it is named."""
    ground = set(graph_engine.lens("ground").types)
    for entry in link_engine.RELATION_TYPES:
        if entry.action == "relation" and entity_engine.PLACE in entry.to_families:
            assert entry.type in ground


def test_two_files_being_one_picture_is_a_fact_about_the_case():
    """`same-image-as` says two pictures are one picture, and `media` is a subject.

    Filed with the artifact chain it was a derivation defect: one lens holding *what
    did I make, out of what* and a finding about the world at once. It is the mirror
    detection the source-folding work needs, which is a reading of the case.
    """
    assert link_engine.SAME_IMAGE_AS in graph_engine.lens("subjects").types
    assert link_engine.SAME_IMAGE_AS not in graph_engine.lens("work").types


def test_the_readings_of_the_case_are_told_apart_from_the_reading_of_the_filing():
    """Six lenses were two axes stacked in one menu. `derived-from`, `depends-on` and
    `mentions` all answer *what did I write, and out of what*, which is a reading of
    the filing — and `mentions` starts at a `document` by construction, so it has
    never held one subject-to-subject edge. One lens, named for what it is."""
    assert [entry.id for entry in graph_engine.lenses()] == [
        "all", "subjects", "ground", "claims", "work",
    ]
    work = graph_engine.lens("work")
    assert set(work.types) == {
        link_engine.DERIVED_FROM, link_engine.DEPENDS_ON, link_engine.MENTIONS,
    }


def test_saying_which_model_a_thing_is_reads_with_the_subject_web():
    """`instance-of` is an analyst's reading of an object, so it lands in Subjects by
    the same derivation every other verb follows — no edit here was needed to place
    it, which is the property the derived lenses exist for."""
    assert link_engine.INSTANCE_OF in graph_engine.lens("subjects").types
    assert link_engine.INSTANCE_OF not in graph_engine.lens("ground").types


def test_an_unknown_lens_is_refused_rather_than_silently_widened(client):
    cid = _case(client, "unknown lens")
    res = client.get(f"/api/cases/{cid}/graph", params={"lens": "everything-ish"})
    assert res.status_code == 400


def test_the_lens_registry_is_served_with_its_bounds(client):
    body = client.get("/api/cases/graph-lenses").json()
    assert [entry["id"] for entry in body["lenses"]][0] == "all"
    assert all(entry["hint"] for entry in body["lenses"])
    assert body["max_hops"] == graph_engine.MAX_HOPS
    # No node ceiling is served, because there is none: the drawing grows without
    # limit, and a number the client could only use to refuse a click is not sent.
    assert "max_nodes" not in body
    assert {entry["value"] for entry in body["orders"]} == {"degree", "recent"}


# -- which nodes a reading draws -----------------------------------------------


def test_a_reading_of_the_case_leaves_out_what_the_analyst_wrote():
    """The node half of a lens, and it is derived from the roles exactly as the verbs
    are derived from the relation registry: a type added there lands in the right
    readings with no edit here."""
    filing = entity_engine.types_with_role(entity_engine.ANNEX, entity_engine.DELIVERABLE)
    assert filing == {"note", "inspect-session", "post"}

    for lens_id in ("all", "subjects", "ground", "claims"):
        assert set(graph_engine.lens(lens_id).hides) == filing, lens_id
    # And the one reading that is about the filing hides nothing at all: it is the
    # switch that puts the others' omissions one click away.
    assert graph_engine.lens("work").hides == ()


def test_an_attestation_is_still_drawn_because_it_carries_a_path():
    """A bookmark is not a leaf: *account posted it, statement cites it* is a path
    through it, and that path is a fact about the case. It leaves the drawing the day
    a collapsed edge can carry the same sentence, not before."""
    for type_ in ("bookmark", "proof", "capture"):
        assert entity_engine.entity_type(type_).role == entity_engine.ATTESTATION
        assert type_ not in graph_engine.lens("all").hides


def test_the_default_drawing_holds_the_case_and_the_other_lens_the_filing(client):
    cid = _case(client, "roles")
    person = _entity(client, cid, "person", "Subject")
    note = _entity(client, cid, "note", "Working notes")
    post = _entity(client, cid, "post", "Thread draft")
    session = _entity(client, cid, "inspect-session", "Frame pass")

    assert _ids(_graph(client, cid)) == {person}
    assert _graph(client, cid)["total"] == 1
    assert _ids(_graph(client, cid, lens="work")) == {person, note, post, session}


def test_a_free_type_no_role_speaks_for_is_drawn_by_every_reading(client):
    """A type the vocabulary has never heard of has no role, and leaving it out would
    drop an entity nobody agreed to drop. Which is why a reading states what it
    excludes rather than what it keeps."""
    cid = _case(client, "free type")
    tablet = _entity(client, cid, "cuneiform-tablet", "BM 92687")

    assert _ids(_graph(client, cid)) == {tablet}
    assert _ids(_graph(client, cid, lens="claims")) == {tablet}


def test_a_degree_counts_only_the_connections_the_reading_can_show(client):
    """The number that prices a click. Counted over every edge, a media whose only
    connection is a note reads as connected in a reading that draws neither the note
    nor the edge to it — and the control offering to open it can only ever appear to
    do nothing."""
    cid = _case(client, "honest degree")
    media = _entity(client, cid, "media", "clip.mp4", {"path": "media/clip.mp4"})
    note = _entity(client, cid, "note", "What the clip shows")
    _link(client, cid, note, media, "mentions")

    drawn = _graph(client, cid)
    assert _node(drawn, media)["degree"] == 0
    assert drawn["isolated"] == 1

    work = _graph(client, cid, lens="work")
    assert _node(work, media)["degree"] == 1
    assert work["isolated"] == 0


def test_opening_a_node_never_brings_in_what_the_reading_leaves_out(client):
    cid = _case(client, "open past the reading")
    media = _entity(client, cid, "media", "clip.mp4", {"path": "media/clip.mp4"})
    note = _entity(client, cid, "note", "What the clip shows")
    _link(client, cid, note, media, "mentions")

    body = _graph(client, cid, expand=media)
    assert _ids(body) == {media}
    # Opened, with nothing to show for it: a true answer, and not a truncation. A view
    # reporting itself cut because a lens left something out would read as a finding
    # about the size of the case.
    assert body["expanded"] == [media]
    assert body["truncated"] is False


def test_naming_a_node_the_reading_leaves_out_does_not_draw_it(client):
    """The one place a lens outranks the rule that a named node survives the filters.
    A filter is a narrowing set earlier; a lens is the reading itself."""
    cid = _case(client, "named but not drawn")
    person = _entity(client, cid, "person", "Subject")
    post = _entity(client, cid, "post", "Thread draft")

    body = _graph(client, cid, expand=post)
    assert _ids(body) == {person}
    assert body["expanded"] == []


def test_a_neighbourhood_refuses_a_root_the_reading_does_not_draw(client):
    """Said in words rather than answered with an empty picture, which would read as
    a finding about the case."""
    cid = _case(client, "hidden root")
    note = _entity(client, cid, "note", "Working notes")

    res = client.get(f"/api/cases/{cid}/graph/neighborhood", params={"root": note})
    assert res.status_code == 400
    assert "does not draw" in res.json()["detail"]

    ok = client.get(
        f"/api/cases/{cid}/graph/neighborhood", params={"root": note, "lens": "work"}
    )
    assert ok.status_code == 200


def test_a_route_never_runs_through_a_node_the_reading_leaves_out(client):
    """A sentence naming a node that is not on screen points at nothing, and the view
    that tried to bring it in would refuse for the same reason."""
    cid = _case(client, "route through the filing")
    person = _entity(client, cid, "person", "Subject")
    domain = _entity(client, cid, "domain", "example.test")
    note = _entity(client, cid, "note", "Both are named here")
    _link(client, cid, note, person, "mentions")
    _link(client, cid, note, domain, "mentions")

    def route(lens):
        res = client.get(
            f"/api/cases/{cid}/graph/paths",
            params={"from": person, "to": domain, "lens": lens},
        )
        assert res.status_code == 200, res.text
        return res.json()

    assert route("all")["found"] is False
    answered = route("work")
    assert answered["found"] is True
    assert note in {node["id"] for node in answered["nodes"]}


# -- the wrapper is an edge ----------------------------------------------------
#
# An attestation on a statement→source chain is one edge, not a node. On a real case
# that is a third of the drawing, and the path through it survives as what the edge
# says rather than as a computation somebody has to do.


def _derives(cid, from_id, to_id, type_):
    """One derivation edge, filed the way a save files it.

    Never through `POST /links`: a derivation is recorded by the save that produced the
    artifact, and the API refuses to let it be asserted after the fact (`engine/links`).
    """
    Case.open(cid).add_link(from_id, to_id, type_, by="user")


def _sourced(client, cid, *, sources=3, account="@harbourwatch"):
    """A claim citing N bookmarks, all published by one account. The shape the
    collapse exists for, and the shape the independence number is read off."""
    claim = _entity(client, cid, "claim", "Shot at the quay")
    who = _entity(client, cid, "account", account)
    marks = []
    for n in range(sources):
        mark = _entity(client, cid, "bookmark", f"thread {n}", {"url": f"https://x.test/{n}"})
        _link(client, cid, claim, mark, "cites")
        _link(client, cid, who, mark, "posted")
        marks.append(mark)
    return claim, who, marks


def _folded(payload):
    return [link for link in payload["links"] if link.get("folded")]


def test_three_citations_of_one_account_are_one_edge_that_says_so(client):
    cid = _case(client, "fold sources")
    claim, who, marks = _sourced(client, cid)

    body = _graph(client, cid)
    assert _ids(body) == {claim, who}  # the three bookmarks are the edge now
    edge = _folded(body)[0]
    assert (edge["from"], edge["to"], edge["type"]) == (claim, who, "cites")
    assert edge["folded"]["sources"] == 3
    assert edge["folded"]["via"] == ["bookmark"]
    assert edge["folded"]["accounts"] == 1
    # Its id is stable and cannot be mistaken for a row: nothing may be written to it.
    assert edge["id"] == f"{graph_engine.FOLDED_PREFIX}cites:{claim}:{who}"
    assert client.delete(f"/api/cases/{cid}/links/{edge['id']}").status_code == 404


def test_a_folded_edge_prices_the_click_it_leaves(client):
    """The degree says what opening a node would bring in, so it answers to what is
    drawn. Three citations that became one edge are one connection now, and the two the
    fold removed must not go on being offered."""
    cid = _case(client, "folded degree")
    claim, who, _ = _sourced(client, cid)

    body = _graph(client, cid)
    assert _node(body, claim)["degree"] == 1
    assert _node(body, who)["degree"] == 1


def test_a_folded_edge_names_what_it_stands_for_and_hands_it_back(client):
    """Expandable from the edge itself, and it is the same mechanism as opening a node:
    a named node is never folded, so asking for one draws it with its own edges."""
    cid = _case(client, "unfold")
    claim, who, marks = _sourced(client, cid)

    edge = _folded(_graph(client, cid))[0]
    assert edge["folded"]["open"] == sorted(marks)

    back = _graph(client, cid, expand=marks[0])
    assert marks[0] in _ids(back)
    # The one asked for is a node with its real edges; the other two are still the edge.
    assert {link["type"] for link in back["links"] if not link.get("folded")} == {
        "cites", "posted",
    }
    assert _folded(back)[0]["folded"]["sources"] == 2


def test_an_attestation_nothing_states_anything_about_stays_a_node(client):
    """The collapse is a reading of a statement→source chain, not of the type name. A
    bookmark nobody cites is unexploited material, and unexploited material is exactly
    what the drawing should show."""
    cid = _case(client, "uncited")
    mark = _entity(client, cid, "bookmark", "thread", {"url": "https://x.test/1"})
    who = _entity(client, cid, "account", "@harbourwatch")
    _link(client, cid, who, mark, "posted")

    body = _graph(client, cid)
    assert _ids(body) == {mark, who}
    assert _folded(body) == []


def test_a_middle_carrying_content_stays_a_node(client):
    """A capture that shows a place holds something an edge between its neighbours
    cannot say: folding it would turn "this vehicle appears in it" and "it shows this
    place" into a claim about the vehicle and the place that nobody made."""
    cid = _case(client, "content middle")
    claim = _entity(client, cid, "claim", "The convoy passed here")
    capture = _entity(
        client, cid, "capture", "48.0, 2.0", {"path": "captures/x.png", "lat": 48.0}
    )
    place = _entity(client, cid, "place", "48.0, 2.0", {"lat": 48.0, "lon": 2.0})
    proof = _entity(client, cid, "proof", "panel", {"spec": "proofs/x.json"})
    _link(client, cid, claim, capture, "cites")
    _link(client, cid, capture, place, "depicts")
    # and the proof made from it is provenance, so that leg alone would have folded
    _derives(cid, proof, capture, "derived-from")

    body = _graph(client, cid)
    assert capture in _ids(body)
    assert _folded(body) == []


def test_a_proof_between_a_statement_and_its_media_is_an_edge(client):
    """The other provenance shape: a proof is a rendering of media the case already
    holds, so the statement rests on the media through it."""
    cid = _case(client, "fold proof")
    claim = _entity(client, cid, "claim", "This is the same quay")
    proof = _entity(client, cid, "proof", "panel", {"spec": "proofs/x.json"})
    media = _entity(client, cid, "media", "quay.jpg", {"path": "media/quay.jpg"})
    _link(client, cid, claim, proof, "cites")
    _derives(cid, proof, media, "derived-from")

    body = _graph(client, cid)
    assert _ids(body) == {claim, media}
    edge = _folded(body)[0]
    assert (edge["from"], edge["to"]) == (claim, media)
    # No account published a proof, so the edge says three words fewer.
    assert edge["folded"]["accounts"] == 0


def test_a_fold_is_only_as_confirmed_as_its_weakest_part(client):
    """A proposal must not be laundered into a finding by being folded with a stated
    edge: the path is not fully stated until both halves are."""
    cid = _case(client, "fold status")
    claim, who, marks = _sourced(client, cid, sources=1)
    case = Case.open(cid)
    edge = next(link for link in case.links_of(who) if link["type"] == "posted")
    case.update_link(edge["id"], {"status": "suggested"})

    assert _folded(_graph(client, cid))[0]["provenance"]["status"] == "suggested"


def test_shape_outranks_the_type_name(client):
    """SPEC §6's safeguard. A reconstructed case bends its own types — an import can
    file an external source under a type meant for the analyst's own output — so a node
    of a type this reading does not draw at all is collapsed when it turns out to lie on
    the same chain, rather than dropped."""
    cid = _case(client, "mislabelled source")
    claim = _entity(client, cid, "claim", "Filmed from the bridge")
    note = _entity(client, cid, "note", "imported source", {"path": "notes/x.md"})
    media = _entity(client, cid, "media", "clip.mp4", {"path": "media/clip.mp4"})
    _link(client, cid, claim, note, "cites")
    _derives(cid, note, media, "derived-from")

    body = _graph(client, cid)
    assert _ids(body) == {claim, media}
    edge = _folded(body)[0]
    assert edge["folded"]["via"] == ["note"]
    # Nothing to hand back: this reading does not draw a note at all, so the edge does
    # not offer an act it would then refuse.
    assert "open" not in edge["folded"]


def test_a_fold_needs_both_ends_drawn(client):
    """The closed set is the invariant: an edge whose far end was cut would have to
    invent it. So the middle stays a node instead, and nothing is lost."""
    cid = _case(client, "fold at the cut")
    claim, who, marks = _sourced(client, cid, sources=1)

    body = _graph(client, cid, limit=2)  # the account does not fit
    assert body["truncated"] is True
    assert who not in _ids(body)
    assert _folded(body) == []


def test_a_source_the_budget_cut_still_joins_what_it_joined(client):
    """The fold's promise held only under the ceiling until this.

    The ranking cuts the least connected first, which is exactly the sources this
    collapses — so on a case too large to draw whole, the case that needed it, a
    statement resting on three sources and one account drew as a lone dot with both of
    its ends on screen and nothing joining them. The middle being absent is not a
    reason to lose the path through it: it is the reason the path has to be said as an
    edge.
    """
    cid = _case(client, "cut middle")
    claim, who, marks = _sourced(client, cid)

    # The statement and the account carry three edges each, the bookmarks two, so the
    # ranking keeps the two ends and cuts every middle.
    body = _graph(client, cid, limit=2)
    assert body["truncated"] is True
    assert _ids(body) == {claim, who}

    edge = _folded(body)[0]
    assert (edge["from"], edge["to"], edge["type"]) == (claim, who, "cites")
    assert edge["folded"]["sources"] == 3
    assert edge["folded"]["via"] == ["bookmark"]
    # And the finding is readable without opening anything, which is the whole point.
    assert _node(body, claim)["rests"] == {"sources": 3, "accounts": 1, "one": True}
    assert body["single_account"] == 1


def test_a_source_the_budget_cut_is_handed_back_like_any_other(client):
    """Whether an edge offers its sources back is a question about their **type**, not
    about whether they are on screen: a bookmark cut by the budget is drawn by the same
    `expand` that opens a node, where a type this reading leaves out could only be
    refused."""
    cid = _case(client, "hand back a cut source")
    claim, who, marks = _sourced(client, cid)

    edge = _folded(_graph(client, cid, limit=2))[0]
    assert edge["folded"]["open"] == sorted(marks)

    back = _graph(client, cid, limit=2, expand=marks[0])
    assert marks[0] in _ids(back)
    assert _folded(back)[0]["folded"]["sources"] == 2


def test_the_click_a_folded_statement_offers_still_brings_what_it_says(client):
    """The honest degree, through a middle that was never drawn. Nothing was removed
    from the picture here — the three bookmarks were cut before the fold saw them — so
    the count has to keep offering them while the edge stands for them."""
    cid = _case(client, "cut middle degree")
    claim, who, marks = _sourced(client, cid)

    body = _graph(client, cid, limit=2)
    # One edge drawn, and three sources plus the fold's own edge still to bring in.
    assert _node(body, claim)["degree"] == 4

    back = _graph(client, cid, limit=2, expand=",".join(marks))
    assert set(marks) <= _ids(back)


# -- independence --------------------------------------------------------------


def test_a_statement_says_how_many_sources_and_how_many_accounts(client):
    """The first independence number, and it falls out of the collapsed edge: "three
    citations" is not "three sources" when one account published all three."""
    cid = _case(client, "independence")
    claim, who, _ = _sourced(client, cid)

    body = _graph(client, cid)
    assert _node(body, claim)["rests"] == {"sources": 3, "accounts": 1, "one": True}
    assert body["single_account"] == 1


def test_two_accounts_behind_the_same_statement_are_two_sources(client):
    cid = _case(client, "two accounts")
    claim = _entity(client, cid, "claim", "Two witnesses")
    for n, handle in enumerate(("@one", "@two")):
        who = _entity(client, cid, "account", handle)
        mark = _entity(client, cid, "bookmark", f"post {n}", {"url": f"https://x.test/{n}"})
        _link(client, cid, claim, mark, "cites")
        _link(client, cid, who, mark, "posted")

    body = _graph(client, cid)
    assert _node(body, claim)["rests"] == {"sources": 2, "accounts": 2, "one": False}
    # Two independent sources is not the finding, so the number stays at zero.
    assert body["single_account"] == 0


def test_a_source_still_drawn_as_a_node_is_counted_too(client):
    """The number answers to the drawing, not to which nodes happened to collapse: an
    uncollapsed citation is a source the statement rests on like any other."""
    cid = _case(client, "counted whole")
    claim = _entity(client, cid, "claim", "Two sources, one folded")
    who = _entity(client, cid, "account", "@harbourwatch")
    posted = _entity(client, cid, "bookmark", "thread", {"url": "https://x.test/1"})
    lone = _entity(client, cid, "bookmark", "report", {"url": "https://x.test/2"})
    _link(client, cid, claim, posted, "cites")
    _link(client, cid, who, posted, "posted")
    _link(client, cid, claim, lone, "cites")

    body = _graph(client, cid)
    assert lone in _ids(body) and posted not in _ids(body)
    assert _node(body, claim)["rests"] == {"sources": 2, "accounts": 1, "one": False}
    # One of the two sources has no account behind it, so this is not "all on one".
    assert body["single_account"] == 0


def test_resting_on_another_statement_is_not_resting_on_a_source(client):
    """A cited statement is reasoning, not material, so it never lifts the number.

    The independence count answers "three citations, how many sources" — a statement
    built on another statement has found nothing new, and counting it would say the
    opposite of what the graph is drawing.
    """
    cid = _case(client, "grounded on reasoning")
    model = _entity(client, cid, "claim", "The vehicle is a T-72B3")
    unit = _entity(client, cid, "claim", "The column is the 4th brigade")
    video = _entity(client, cid, "media", "Column", {"path": "media/column.mp4"})
    _link(client, cid, model, video, "cites")
    _link(client, cid, unit, model, "cites")

    body = _graph(client, cid)
    # The one that reached material rests on it; the one that reached a statement
    # rests on nothing of its own, which is the honest reading.
    assert _node(body, model)["rests"] == {"sources": 1, "accounts": 0, "one": False}
    assert "rests" not in _node(body, unit)
    assert body["single_account"] == 0


def test_a_statement_with_nothing_to_rest_on_says_nothing(client):
    cid = _case(client, "no sources")
    claim = _entity(client, cid, "claim", "Unsupported")
    place = _entity(client, cid, "place", "1.0, 1.0", {"lat": 1.0, "lon": 1.0})
    _link(client, cid, claim, place, "at")

    body = _graph(client, cid)
    assert "rests" not in _node(body, claim)
    assert body["single_account"] == 0


# -- the global view ----------------------------------------------------------


def test_the_graph_opens_on_the_whole_case(client):
    """A case is a subject before it is a set of statements — a conflict followed
    over months has no single root — so the entry point is everything."""
    cid = _case(client, "whole case")
    unit = _entity(client, cid, "organization", "3rd Battalion")
    driver = _entity(client, cid, "person", "Driver")
    _link(client, cid, driver, unit, "member-of")
    lone = _entity(client, cid, "domain", "example.test")

    body = _graph(client, cid)
    assert _ids(body) == {unit, driver, lone}
    assert body["total"] == 3
    assert body["truncated"] is False


def test_a_lens_narrows_the_edges_and_keeps_a_subject_with_none(client):
    """Narrowing the verbs must not hide a subject: an entity with no edge in this
    lens is a real answer — it is what nobody has connected yet. What a lens does take
    out of the drawing is a whole role, never one node for want of an edge."""
    cid = _case(client, "lens edges")
    unit = _entity(client, cid, "organization", "Brigade")
    person = _entity(client, cid, "person", "Officer")
    place = _entity(client, cid, "place", "48.0, 2.0")
    _link(client, cid, person, unit, "member-of")

    subjects = _graph(client, cid, lens="subjects")
    assert _ids(subjects) == {unit, person, place}
    assert [link["type"] for link in subjects["links"]] == ["member-of"]

    ground = _graph(client, cid, lens="ground")
    assert _ids(ground) == {unit, person, place}
    assert ground["links"] == []


def test_only_edges_with_both_ends_on_screen_are_returned(client):
    """A drawn edge whose far node was never sent would have to invent it. The
    closed set is what the view guarantees."""
    cid = _case(client, "closed set")
    hub = _entity(client, cid, "organization", "Hub")
    others = [_entity(client, cid, "person", f"Member {n}") for n in range(6)]
    for other in others:
        _link(client, cid, other, hub, "member-of")

    body = _graph(client, cid, limit=3)
    shown = _ids(body)
    assert len(shown) == 3
    for link in body["links"]:
        assert link["from"] in shown and link["to"] in shown


def test_a_cut_view_keeps_the_hubs_and_says_it_was_cut(client):
    """The whole point of ranking: what survives a truncated case is its shape."""
    cid = _case(client, "hub first")
    hub = _entity(client, cid, "organization", "Command")
    for n in range(8):
        member = _entity(client, cid, "person", f"Member {n}")
        _link(client, cid, member, hub, "member-of")
    for n in range(8):
        _entity(client, cid, "domain", f"loose{n}.test")

    body = _graph(client, cid, limit=4)
    assert hub in _ids(body)
    assert body["truncated"] is True
    assert body["total"] == 17
    assert body["shown"] == 4
    degrees = [node["degree"] for node in body["nodes"]]
    assert degrees == sorted(degrees, reverse=True)


def test_ranking_by_recent_keeps_the_latest_work(client):
    """The other honest cut, and the seam a stated-time ordering slots into: what
    an analyst touched last is what they are still working on."""
    cid = _case(client, "recent first")
    first = _entity(client, cid, "person", "Filed first")
    last = _entity(client, cid, "person", "Filed last")

    body = _graph(client, cid, order="recent", limit=1)
    assert _ids(body) == {last}
    assert first not in _ids(body)


def test_an_unknown_ordering_is_refused(client):
    cid = _case(client, "bad order")
    res = client.get(f"/api/cases/{cid}/graph", params={"order": "alphabetical"})
    assert res.status_code == 400


def test_the_node_budget_cannot_be_raised_past_the_ceiling(client, monkeypatch):
    """No request reaches the whole graph, whatever it asks for. The clamp is
    asserted on the limit that reaches storage, since a small fixture would pass
    this on its size alone."""
    cid = _case(client, "ceiling")
    _entity(client, cid, "person", "Only one")

    from azimut import workspace

    asked: list[int] = []
    original = workspace.Case.rank_entities

    def record(self, **kwargs):
        asked.append(kwargs["limit"])
        return original(self, **kwargs)

    monkeypatch.setattr(workspace.Case, "rank_entities", record)
    _graph(client, cid, limit=10_000)
    _graph(client, cid, limit=0)
    assert asked == [graph_engine.MAX_OPENING, 1]


def test_degree_counts_only_the_lens_being_read(client):
    """A node reads as isolated in a lens it truly has no edge in, so the isolated
    count means something rather than being a global figure repeated."""
    cid = _case(client, "lens degree")
    person = _entity(client, cid, "person", "Subject")
    place = _entity(client, cid, "place", "1.0, 1.0")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")

    subjects = {n["id"]: n["degree"] for n in _graph(client, cid, lens="subjects")["nodes"]}
    assert subjects[person] == 1 and subjects[place] == 0

    ground = {n["id"]: n["degree"] for n in _graph(client, cid, lens="ground")["nodes"]}
    assert ground[person] == 0


def test_the_view_counts_what_nobody_has_connected(client):
    """The case's unexploited material, and the one number a table cannot show."""
    cid = _case(client, "isolated")
    person = _entity(client, cid, "person", "Linked")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")
    for n in range(3):
        _entity(client, cid, "domain", f"untouched{n}.test")

    assert _graph(client, cid)["isolated"] == 3


def test_what_nobody_connected_is_counted_over_the_case_not_the_drawing(client):
    """The number a cut view must not lose, and used to.

    An entity with no edge sorts last under `degree`, so it is the first thing a cut
    discards — counted off the returned nodes, "what nobody has connected" reported
    zero on exactly the cases too large to draw. Two linked entities and four loose
    ones, drawn two at a time: the drawing holds the pair, and the count still says
    four.
    """
    cid = _case(client, "isolated at scale")
    person = _entity(client, cid, "person", "Linked")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")
    for n in range(4):
        _entity(client, cid, "domain", f"loose{n}.test")

    body = _graph(client, cid, limit=2)
    assert body["truncated"] is True
    assert _ids(body) == {person, unit}
    assert body["isolated"] == 4


def test_a_narrowing_cannot_inflate_what_nobody_connected(client):
    """Hiding the far end of an edge must not make its near end read as unexploited.

    The degree is read over the lens's verbs, never over whether the other end was
    returned. So filtering the places out of the drawing leaves the media that was
    recorded at one connected, which is the truth about the case.
    """
    cid = _case(client, "narrowed isolation")
    media = _entity(
        client, cid, "media", "quay.jpg", {"path": "media/quay.jpg", "kind": "image"}
    )
    place = _entity(client, cid, "place", "48.0, 2.0", {"lat": 48.0, "lon": 2.0})
    _link(client, cid, media, place, "located-at")

    body = _graph(client, cid, lens="ground", type="media")
    assert _ids(body) == {media}
    assert _node(body, media)["degree"] == 1
    assert body["isolated"] == 0


def test_the_catalog_filters_mean_the_same_thing_on_the_graph(client):
    """The board and the graph must not disagree about "confirmed people here"."""
    cid = _case(client, "shared filters")
    _entity(client, cid, "person", "Kept")
    _entity(client, cid, "domain", "dropped.test")

    body = _graph(client, cid, type="person")
    assert body["total"] == 1
    assert [node["type"] for node in body["nodes"]] == ["person"]


def test_a_node_carries_its_family_so_no_second_lookup_is_needed(client):
    cid = _case(client, "family on node")
    _entity(client, cid, "vessel", "Ship")
    node = _graph(client, cid)["nodes"][0]
    assert node["family"] == entity_engine.ASSET
    assert node["status"] == "confirmed"
    assert node["at"]


def test_a_node_with_a_picture_carries_its_thumbnail_and_never_the_file(client):
    """A card on the graph shows a preview, and the preview has to be the cached
    thumbnail: a few hundred nodes reaching for their own full-size image would
    download the case to draw it. An entity with no indexed media carries no key at
    all, which is what lets a client tell "no picture" from "not loaded"."""
    cid = _case(client, "previews")
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (30, 90, 160)).save(buf, "PNG")
    client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": ("shot.png", io.BytesIO(buf.getvalue()), "image/png")},
    )
    _entity(client, cid, "person", "Nobody")

    nodes = {node["label"]: node for node in _graph(client, cid)["nodes"]}
    assert nodes["shot"]["thumb"].startswith("media/")
    assert "thumb" not in nodes["Nobody"]
    # The thumbnail, not the media file the entity points at.
    assert nodes["shot"]["thumb"] != "media/shot.png"


# -- the neighborhood ---------------------------------------------------------


def _hood(client, cid, root, **params):
    res = client.get(
        f"/api/cases/{cid}/graph/neighborhood", params={"root": root, **params}
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_one_hop_reaches_the_direct_neighbours_only(client):
    cid = _case(client, "one hop")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    parent = _entity(client, cid, "organization", "Parent")
    _link(client, cid, person, unit, "member-of")
    _link(client, cid, unit, parent, "part-of")

    body = _hood(client, cid, person)
    assert _ids(body) == {person, unit}
    assert {node["id"]: node["hop"] for node in body["nodes"]}[unit] == 1


def test_a_second_hop_reaches_further_and_records_the_distance(client):
    cid = _case(client, "two hops")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    parent = _entity(client, cid, "organization", "Parent")
    _link(client, cid, person, unit, "member-of")
    _link(client, cid, unit, parent, "part-of")

    body = _hood(client, cid, person, hops=2)
    assert _ids(body) == {person, unit, parent}
    hops = {node["id"]: node["hop"] for node in body["nodes"]}
    assert hops == {person: 0, unit: 1, parent: 2}


def test_the_walk_is_bounded_by_hops_whatever_the_graph_holds(client):
    cid = _case(client, "hop ceiling")
    chain = [_entity(client, cid, "organization", f"Echelon {n}") for n in range(8)]
    for lower, upper in zip(chain, chain[1:]):
        _link(client, cid, lower, upper, "part-of")

    body = _hood(client, cid, chain[0], hops=99)
    assert body["hops"] == graph_engine.MAX_HOPS
    assert body["shown"] == graph_engine.MAX_HOPS + 1


def test_a_neighbour_reports_the_degree_an_expansion_would_cost(client):
    """The click's price before it is paid — the guard against the hairball."""
    cid = _case(client, "degree before expanding")
    root = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Busy unit")
    _link(client, cid, root, unit, "member-of")
    for n in range(5):
        other = _entity(client, cid, "person", f"Other {n}")
        _link(client, cid, other, unit, "member-of")

    body = _hood(client, cid, root)
    degrees = {node["id"]: node["degree"] for node in body["nodes"]}
    assert degrees[unit] == 6  # one edge shown, five more behind it
    assert body["shown"] == 2


def test_the_node_budget_ending_a_walk_is_reported(client):
    cid = _case(client, "hood budget")
    hub = _entity(client, cid, "organization", "Hub")
    for n in range(6):
        member = _entity(client, cid, "person", f"Member {n}")
        _link(client, cid, member, hub, "member-of")

    body = _hood(client, cid, hub, limit=3)
    assert body["shown"] == 3
    assert body["truncated"] is True


def test_a_neighborhood_returns_the_closed_edge_set(client):
    cid = _case(client, "hood closed set")
    hub = _entity(client, cid, "organization", "Hub")
    for n in range(6):
        member = _entity(client, cid, "person", f"Member {n}")
        _link(client, cid, member, hub, "member-of")

    body = _hood(client, cid, hub, limit=3)
    shown = _ids(body)
    for link in body["links"]:
        assert link["from"] in shown and link["to"] in shown


def test_the_outermost_ring_holds_the_edges_inside_it(client):
    """Closed is half the promise; the other half is complete.

    An edge between two nodes reached at the **same** hop touches neither of the
    frontiers that found them, so a walk that collected edges hop by hop came back
    with an outermost ring that had none inside it. A triangle around a root drew as
    a star, and both far nodes reported the edge between them as a connection lying
    further out than the hops asked for — a count no reachable control could settle.
    """
    cid = _case(client, "hood outer ring")
    photo = _entity(
        client, cid, "media", "roof.jpg", {"path": "media/roof.jpg", "kind": "image"}
    )
    account = _entity(client, cid, "account", "@poster")
    person = _entity(client, cid, "person", "Poster")
    _link(client, cid, account, photo, "posted")
    _link(client, cid, person, photo, "appears-in")
    # The edge the walk cannot witness, and on a worked case the finding: the person
    # in the picture is the one who put it out.
    across = _link(client, cid, person, account, "owns")

    body = _hood(client, cid, photo, hops=1)

    assert _ids(body) == {photo, account, person}
    assert across in {link["id"] for link in body["links"]}
    # And the degree each node states is now settled by what is drawn, which is what
    # the panel subtracts to decide there is anything left to open.
    for node in body["nodes"]:
        assert node["degree"] == 2


def test_a_lens_scopes_the_walk(client):
    cid = _case(client, "hood lens")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")

    assert _ids(_hood(client, cid, person, lens="ground")) == {person}


def test_a_missing_root_is_a_404(client):
    cid = _case(client, "no root")
    res = client.get(
        f"/api/cases/{cid}/graph/neighborhood", params={"root": "e_nope"}
    )
    assert res.status_code == 404


def test_a_media_node_says_whether_it_is_a_video_or_a_picture(client):
    """One `media` type covers images, video, audio and everything else, so a node
    that cannot say which it holds draws as a generic file and reads as a document.
    The browse index is the authority, because the importer put the kind there."""
    cid = _case(client, "media kinds")
    png = io.BytesIO()
    Image.new("RGB", (8, 6), (10, 20, 30)).save(png, "PNG")
    res = client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": ("frame.png", io.BytesIO(png.getvalue()), "image/png")},
    )
    assert res.status_code == 200, res.text
    path = res.json()["item"]["path"]
    entity = client.get(
        f"/api/cases/{cid}/entities/lookup", params={"attr": "path", "value": path}
    ).json()["entity"]

    assert _node(_graph(client, cid), entity["id"])["kind"] == "image"


def test_a_kind_is_carried_for_media_and_for_nothing_else(client):
    """It answers a question only that type raises: a person is a person."""
    cid = _case(client, "kind only for media")
    person = _entity(client, cid, "person", "Not a file")

    assert "kind" not in _node(_graph(client, cid), person)


def test_a_media_entity_the_index_never_saw_still_says_what_it_is(client):
    """A tool can file a media row without registering a browse row; the attr the
    importer would have written is the fallback."""
    cid = _case(client, "kind from attrs")
    clip = _entity(client, cid, "media", "clip.mp4", {"path": "media/clip.mp4", "kind": "video"})

    assert _node(_graph(client, cid), clip)["kind"] == "video"


def test_a_neighbourhood_says_what_its_media_holds_too(client):
    """The same question, asked from a root: an expansion that drew every file the
    same would lose the reading the whole-case view gives."""
    cid = _case(client, "hood kinds")
    person = _entity(client, cid, "person", "Root")
    clip = _entity(client, cid, "media", "clip.mp4", {"path": "media/clip.mp4", "kind": "video"})
    _link(client, cid, person, clip, "appears-in")

    assert _node(_hood(client, cid, person), clip)["kind"] == "video"


# -- material the case made, told apart from material it collected -------------
#
# A frame, an adjustment, a collage: filed as ordinary media, and drawn with the
# same glyph as a photograph somebody handed over. Nothing on the drawing says
# which. The route is already in the browse index, so the node carries it, and it
# carries it only for the tools that compose case material: "upload" on an upload
# says nothing about the upload.


def _upload(client, cid, name="shot.png", colour=(10, 20, 30)):
    """One real file through the real importer — the index row is what this is for."""
    png = io.BytesIO()
    Image.new("RGB", (8, 6), colour).save(png, "PNG")
    res = client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(png.getvalue()), "image/png")},
    )
    assert res.status_code == 200, res.text
    return res.json()["item"]


def _entity_at(client, cid, path):
    return client.get(
        f"/api/cases/{cid}/entities/lookup", params={"attr": "path", "value": path}
    ).json()["entity"]["id"]


def _adjusted(client, cid, path, amount=1.4, label=None):
    """A derivative through the real Inspect route, so this tests the wiring rather
    than a hand-written index row."""
    res = client.post(
        f"/api/cases/{cid}/inspect/save-frames",
        json={
            "items": [
                {
                    "path": path,
                    "ops": [{"op": "brightness", "params": {"amount": amount}}],
                    **({"label": label} if label else {}),
                }
            ]
        },
    )
    assert res.status_code == 200, res.text
    return res.json()["saved"][0]


def test_a_node_made_here_says_which_act_made_it(client):
    """The whole point of step one: a derivative and a photograph are the same node
    today, so a video with twelve saved frames draws as thirteen pictures with
    nothing saying which twelve came out of the first."""
    cid = _case(client, "made here")
    original = _upload(client, cid, "orig.png")
    derived = _adjusted(client, cid, original["path"])["item"]

    node = _node(_graph(client, cid), _entity_at(client, cid, derived["path"]))
    assert node["origin"] == "inspect"
    assert node["op"] == "adjust"


def test_collected_material_carries_no_origin(client):
    """Only the tools that compose case material mark their output. An upload came
    from outside the case, and a node saying "upload" would be a mark on everything,
    which is a mark on nothing."""
    cid = _case(client, "collected")
    original = _upload(client, cid, "orig.png")

    node = _node(_graph(client, cid), _entity_at(client, cid, original["path"]))
    assert "origin" not in node and "op" not in node


def test_a_media_entity_the_index_never_saw_claims_no_origin(client):
    """Unlike the kind, nothing writes the route to the entity, so there is no
    fallback to read — and a default here would be the drawing inventing where a
    file came from."""
    cid = _case(client, "unindexed origin")
    clip = _entity(client, cid, "media", "clip.mp4", {"path": "media/clip.mp4", "kind": "video"})

    assert "origin" not in _node(_graph(client, cid), clip)


def test_identical_bytes_arriving_later_do_not_rewrite_how_a_file_entered(client):
    """Dedupe hands back the entity that is already there, and its row with it. The
    file was made in Inspect; somebody importing the same bytes afterwards is a
    second route to it, not a different origin — which is exactly why the origin is
    read off the index rather than guessed from the links, where both are true."""
    cid = _case(client, "deduped origin")
    original = _upload(client, cid, "orig.png")
    made = _adjusted(client, cid, original["path"])["item"]
    same_bytes = client.get(f"/files/{cid}/{made['path']}").content

    again = client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": ("handed-over.png", io.BytesIO(same_bytes), "image/png")},
    )
    assert again.status_code == 200, again.text
    assert again.json()["duplicate"] is True

    node = _node(_graph(client, cid), _entity_at(client, cid, made["path"]))
    assert node["origin"] == "inspect"


def test_a_neighbourhood_says_what_was_made_here_too(client):
    """Read from a root, the derivation is the reading: this is the hop where an
    analyst is following where a picture came from."""
    cid = _case(client, "hood origins")
    original = _upload(client, cid, "orig.png")
    made = _adjusted(client, cid, original["path"])["item"]
    source_id = _entity_at(client, cid, original["path"])
    made_id = _entity_at(client, cid, made["path"])

    assert _node(_hood(client, cid, source_id), made_id)["origin"] == "inspect"


def test_a_route_says_what_was_made_here_too(client):
    """A route through a derivative is the answer to "how did we get here", so the
    node that says it was made here has to say it there as well."""
    cid = _case(client, "route origins")
    original = _upload(client, cid, "orig.png")
    made = _adjusted(client, cid, original["path"])["item"]
    source_id = _entity_at(client, cid, original["path"])
    made_id = _entity_at(client, cid, made["path"])

    res = client.get(
        f"/api/cases/{cid}/graph/paths", params={"from": made_id, "to": source_id}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["found"] is True
    assert _node(body, made_id)["origin"] == "inspect"


# -- a step is an edge too -----------------------------------------------------
#
# A frame pulled out of a video and built into a proof is a node saying "there was a
# step here", and it spends a slot to say it. Collapsed, the step is what the edge is
# written with. The direction guard is the load-bearing half: a node made from two
# sources is a confluence, and folding it would say one of them came out of the other.


def _proof(client, cid, label="panel"):
    return _entity(client, cid, "proof", label, {"spec": f"proofs/{label}.json"})


def _built_on(client, cid):
    """A proof built on an adjustment of an uploaded picture, through the real Inspect
    route, so the word the edge is written with comes from the act the case recorded
    rather than from a fixture. Returns ``(source, step, proof)``."""
    original = _upload(client, cid, "clip.png")
    made = _adjusted(client, cid, original["path"])["item"]
    source_id = _entity_at(client, cid, original["path"])
    step_id = _entity_at(client, cid, made["path"])
    proof = _proof(client, cid)
    _derives(cid, proof, step_id, "derived-from")
    return source_id, step_id, proof


def test_an_adjustment_the_case_calls_the_same_picture_stays_a_node(client):
    """Saving an adjustment files a mirror suggestion between it and the original, and
    that is a finding about the world: an edge from the proof to the original cannot
    say "these two are one picture", so the step is carrying something the fold would
    drop."""
    cid = _case(client, "mirrored step")
    source_id, step_id, proof = _built_on(client, cid)

    body = _graph(client, cid)
    assert step_id in _ids(body)
    assert _folded(body) == []
    # The proof concludes nothing and nothing cites it, so it is what came out of the
    # step and was not used: a count on it rather than a node of its own.
    assert _node(body, step_id)["rolled"] == {"count": 1, "via": ["proof"], "open": [proof]}


def test_a_step_between_a_source_and_what_was_made_from_it_is_an_edge(client):
    """The shape the whole reading exists for. The mirror suggestion is dropped first,
    the way an analyst who disagrees with it does — with nothing else on the step, it
    relays the picture to the proof and says so as an edge."""
    cid = _case(client, "fold a step")
    source_id, step_id, proof = _built_on(client, cid)
    mirror = next(
        link for link in Case.open(cid).links_of(step_id)
        if link["type"] == "same-image-as"
    )
    assert client.delete(f"/api/cases/{cid}/links/{mirror['id']}").status_code == 200

    body = _graph(client, cid)
    assert _ids(body) == {source_id, proof}  # the step is the edge now
    edge = _folded(body)[0]
    assert (edge["from"], edge["to"], edge["type"]) == (proof, source_id, "derived-from")
    assert edge["folded"]["sources"] == 1
    # The act, not the type: "1 adjusted image" says what "1 media" cannot.
    assert edge["folded"]["via"] == ["adjust"]
    assert edge["folded"]["open"] == [step_id]
    assert edge["id"] == (
        f"{graph_engine.FOLDED_PREFIX}derived-from:{proof}:{source_id}"
    )
    # Nothing may be written to it: the case holds no such row.
    assert client.delete(f"/api/cases/{cid}/links/{edge['id']}").status_code == 404


def test_a_step_with_no_act_recorded_reads_as_what_it_is(client):
    """A derivation the index never saw still folds — the shape is the rule, and the
    origin only decides the word. It falls back to the type rather than going mute."""
    cid = _case(client, "wordless step")
    video = _media(client, cid, "clip")
    frame = _media(client, cid, "frame")
    proof = _proof(client, cid)
    _derives(cid, frame, video, "derived-from")
    _derives(cid, proof, frame, "derived-from")

    edge = _folded(_graph(client, cid))[0]
    assert edge["folded"]["via"] == ["media"]


def test_a_node_made_from_two_sources_is_not_a_passage(client):
    """The direction guard, and the reason it exists. A proof built from footage *and*
    from overhead imagery is a confluence: collapsed, the edge left standing would say
    the capture came out of the video, which is the false convergence this reading is
    against."""
    cid = _case(client, "confluence")
    video = _media(client, cid, "clip")
    capture = _entity(
        client, cid, "capture", "48.0, 2.0", {"path": "captures/x.png", "lat": 48.0}
    )
    proof = _proof(client, cid)
    _derives(cid, proof, video, "derived-from")
    _derives(cid, proof, capture, "derived-from")

    body = _graph(client, cid)
    assert _ids(body) == {video, capture, proof}
    assert _folded(body) == []


def test_a_step_that_says_something_about_the_world_stays_a_node(client):
    """All-or-nothing, the rule the fold above already keeps. A frame that shows a
    place carries a finding, and an edge between the video and the proof cannot say
    it."""
    cid = _case(client, "geolocated step")
    video = _media(client, cid, "clip")
    frame = _media(client, cid, "frame")
    place = _entity(client, cid, "place", "48.0, 2.0", {"lat": 48.0, "lon": 2.0})
    proof = _proof(client, cid)
    _derives(cid, frame, video, "derived-from")
    _derives(cid, proof, frame, "derived-from")
    _link(client, cid, frame, place, "depicts")

    body = _graph(client, cid)
    assert frame in _ids(body)
    assert _folded(body) == []


def test_two_steps_in_a_row_are_one_edge(client):
    """A frame adjusted and then built on is two steps and one sentence. The walk runs
    to the first node that is not itself a step, and the edge names what it went
    through."""
    cid = _case(client, "two steps")
    video = _media(client, cid, "clip")
    frame = _media(client, cid, "frame")
    lighter = _media(client, cid, "frame lighter")
    proof = _proof(client, cid)
    _derives(cid, frame, video, "derived-from")
    _derives(cid, lighter, frame, "derived-from")
    _derives(cid, proof, lighter, "derived-from")

    body = _graph(client, cid)
    assert _ids(body) == {video, proof}
    edge = _folded(body)[0]
    assert (edge["from"], edge["to"]) == (proof, video)
    assert edge["folded"]["sources"] == 2
    assert edge["folded"]["open"] == sorted([frame, lighter])


def test_a_derivative_nothing_was_made_from_is_not_a_passage(client):
    """The boundary between the two acts. A chain leaf relays nothing, so no edge can
    stand for it: it is a count on the node it came out of instead, and the drawing
    never loses the fact that the video has a frame."""
    cid = _case(client, "chain leaf")
    video = _media(client, cid, "clip")
    frame = _media(client, cid, "frame")
    _derives(cid, frame, video, "derived-from")

    body = _graph(client, cid)
    assert _folded(body) == []
    assert _node(body, video)["rolled"]["open"] == [frame]


def test_a_folded_step_prices_the_click_it_leaves(client):
    """The honest degree. Two chain edges became one, and the node must not go on
    offering to bring in what is no longer there to bring."""
    cid = _case(client, "step degree")
    video = _media(client, cid, "clip")
    frame = _media(client, cid, "frame")
    proof = _proof(client, cid)
    _derives(cid, frame, video, "derived-from")
    _derives(cid, proof, frame, "derived-from")

    body = _graph(client, cid)
    assert _node(body, video)["degree"] == 1
    assert _node(body, proof)["degree"] == 1


def test_a_folded_step_hands_its_nodes_back(client):
    """The same way back as every other fold: a named node is never folded, so asking
    for the step draws it with its own edges again. The proof is built on an overhead
    capture as well, which is what keeps it a node of its own on both reads."""
    cid = _case(client, "unfold a step")
    video = _media(client, cid, "clip")
    frame = _media(client, cid, "frame")
    capture = _entity(
        client, cid, "capture", "48.0, 2.0", {"path": "captures/x.png", "lat": 48.0}
    )
    proof = _proof(client, cid)
    _derives(cid, frame, video, "derived-from")
    _derives(cid, proof, frame, "derived-from")
    _derives(cid, proof, capture, "derived-from")

    assert _ids(_graph(client, cid)) == {video, capture, proof}

    back = _graph(client, cid, expand=frame)
    assert _ids(back) == {video, capture, frame, proof}
    assert _folded(back) == []
    assert _node(back, frame)["degree"] == 2


def test_a_folded_step_is_only_as_confirmed_as_its_weakest_part(client):
    """A fold must not launder a proposal into a finding: the path is not stated until
    every leg of it is."""
    cid = _case(client, "step status")
    video = _media(client, cid, "clip")
    frame = _media(client, cid, "frame")
    proof = _proof(client, cid)
    _derives(cid, frame, video, "derived-from")
    _derives(cid, proof, frame, "derived-from")
    case = Case.open(cid)
    edge = next(link for link in case.links_of(frame) if link["to"] == video)
    case.update_link(edge["id"], {"status": "suggested"})

    assert _folded(_graph(client, cid))[0]["provenance"]["status"] == "suggested"


def test_the_filing_lens_draws_its_own_production_chain(client):
    """`My work` answers *what did I write, and out of what*. Folding the production
    chain there would fold the answer, so the pass asks what makes a reading one of the
    case rather than naming a lens."""
    cid = _case(client, "work keeps its steps")
    video = _media(client, cid, "clip")
    frame = _media(client, cid, "frame")
    proof = _proof(client, cid)
    _derives(cid, frame, video, "derived-from")
    _derives(cid, proof, frame, "derived-from")

    body = _graph(client, cid, lens="work")
    assert {video, frame, proof} <= _ids(body)
    assert _folded(body) == []


def test_a_derivation_that_loops_back_folds_nothing(client):
    """A loop names no source, so nothing on it relays anything. Filed straight into
    the store, the way a broken producer would file it: the drawing has to hold rather
    than walk it forever."""
    cid = _case(client, "looping derivation")
    first = _media(client, cid, "one")
    second = _media(client, cid, "two")
    _derives(cid, first, second, "derived-from")
    _derives(cid, second, first, "derived-from")

    body = _graph(client, cid)
    assert _ids(body) == {first, second}
    assert _folded(body) == []


# -- what came out of it and was not used --------------------------------------
#
# Twelve frames saved off a video are twelve pictures of that video. The video already
# says it, so the count goes there and the ids come back with one press. Narrow on
# purpose: one edge, a chain verb, and the node is the end that was derived.


def test_derivatives_nobody_used_are_a_count_on_what_they_came_out_of(client):
    """The picture a case gets after an hour in Inspect: one video, a screenful of
    frames, and nothing yet made from any of them."""
    cid = _case(client, "unused frames")
    video = _media(client, cid, "clip")
    frames = [_media(client, cid, f"frame {n}") for n in range(3)]
    for frame in frames:
        _derives(cid, frame, video, "derived-from")

    body = _graph(client, cid)
    assert _ids(body) == {video}
    rolled = _node(body, video)["rolled"]
    assert rolled["count"] == 3
    assert rolled["via"] == ["media"]
    assert rolled["open"] == sorted(frames)


def test_the_count_is_a_fact_and_the_offer_is_the_ordinary_one(client):
    """The node goes on pricing them among the connections the drawing does not hold,
    and the click that brings them is the one that brings every other missing
    neighbour. Priced down instead, it reported *four away* while offering *twelve*
    somewhere else — two counters for one question, and the difference between them was
    about the mechanism rather than about the case.
    """
    cid = _case(client, "rolled degree")
    video = _media(client, cid, "clip")
    frames = [_media(client, cid, f"frame {n}") for n in range(3)]
    for frame in frames:
        _derives(cid, frame, video, "derived-from")

    body = _graph(client, cid)
    assert _ids(body) == {video}
    assert _node(body, video)["degree"] == 3

    # And expanding answers with them: what an opened node touches is never rolled up.
    back = _graph(client, cid, expand=video)
    assert _ids(back) == {video, *frames}
    assert "rolled" not in _node(back, video)


def test_the_count_hands_its_nodes_back(client):
    """Named rather than opened, the same way back a folded edge offers: they are
    wanted as themselves, not with whatever else they touch."""
    cid = _case(client, "give the frames back")
    video = _media(client, cid, "clip")
    frames = [_media(client, cid, f"frame {n}") for n in range(3)]
    for frame in frames:
        _derives(cid, frame, video, "derived-from")

    back = _graph(client, cid, keep=",".join(frames))
    assert _ids(back) == {video, *frames}
    assert "rolled" not in _node(back, video)
    assert _node(back, video)["degree"] == 3


def test_one_of_them_named_leaves_the_others_counted(client):
    """The way back is per node, so asking for one frame is not asking for the pile."""
    cid = _case(client, "one frame back")
    video = _media(client, cid, "clip")
    frames = [_media(client, cid, f"frame {n}") for n in range(3)]
    for frame in frames:
        _derives(cid, frame, video, "derived-from")

    back = _graph(client, cid, keep=frames[0])
    assert _ids(back) == {video, frames[0]}
    assert _node(back, video)["rolled"]["count"] == 2


def test_the_act_is_what_the_count_is_written_with(client):
    """*3 frames* says what *3 medias* cannot, and it is the word the analyst named it
    by in Inspect. Same resolution as the edge a collapsed step becomes."""
    cid = _case(client, "counted in its own word")
    original = _upload(client, cid, "clip.png")
    made = _adjusted(client, cid, original["path"])["item"]
    source_id = _entity_at(client, cid, original["path"])
    step_id = _entity_at(client, cid, made["path"])
    mirror = next(
        link for link in Case.open(cid).links_of(step_id)
        if link["type"] == "same-image-as"
    )
    assert client.delete(f"/api/cases/{cid}/links/{mirror['id']}").status_code == 200

    body = _graph(client, cid)
    assert _ids(body) == {source_id}
    assert _node(body, source_id)["rolled"] == {
        "count": 1, "via": ["adjust"], "open": [step_id]
    }


def test_a_leaf_that_says_something_about_the_world_is_not_rolled_up(client):
    """One edge and it is a relation, not a step: a picture that shows a place is a
    finding, and putting it away would hide the case's thin material rather than its
    clutter."""
    cid = _case(client, "one relation")
    place = _entity(client, cid, "place", "48.0, 2.0", {"lat": 48.0, "lon": 2.0})
    frame = _media(client, cid, "frame")
    _link(client, cid, frame, place, "depicts")

    body = _graph(client, cid)
    assert _ids(body) == {place, frame}
    assert "rolled" not in _node(body, place)


def test_only_the_derivative_of_a_lone_pair_is_rolled_up(client):
    """Both ends have one edge, so the direction is what decides. The frame came out of
    the video: the collected material stays and the derivative is its count. The other
    way round, a case would answer with the frames and hide the footage."""
    cid = _case(client, "lone pair")
    video = _media(client, cid, "clip")
    frame = _media(client, cid, "frame")
    _derives(cid, frame, video, "derived-from")

    body = _graph(client, cid)
    assert _ids(body) == {video}
    assert _node(body, video)["rolled"]["count"] == 1


def test_a_leaf_hanging_off_a_collapsed_step_stays_a_node(client):
    """That line already stands for something and offers it back. Rolled up, the step
    and the leaf would be two acts behind one number, and the way to the step would be
    gone with it."""
    cid = _case(client, "leaf past a fold")
    video = _media(client, cid, "clip")
    frame = _media(client, cid, "frame")
    proof = _proof(client, cid)
    _derives(cid, frame, video, "derived-from")
    _derives(cid, proof, frame, "derived-from")

    body = _graph(client, cid)
    assert _ids(body) == {video, proof}  # the frame is the edge, the proof is a node
    assert _folded(body)[0]["folded"]["sources"] == 1
    assert "rolled" not in _node(body, video)


def test_an_entity_joined_to_nothing_belongs_to_nobody(client):
    """A node with no edge at all is the case's unexploited material, which is what
    `isolated` counts and the one thing a table cannot show."""
    cid = _case(client, "isolated stays")
    alone = _media(client, cid, "orphan")

    body = _graph(client, cid)
    assert _ids(body) == {alone}


def test_the_filing_lens_keeps_what_was_made_and_not_used(client):
    """`My work` answers what was made out of what, and the pile of unused frames is
    half that answer."""
    cid = _case(client, "work keeps its frames")
    video = _media(client, cid, "clip")
    frames = [_media(client, cid, f"frame {n}") for n in range(3)]
    for frame in frames:
        _derives(cid, frame, video, "derived-from")

    body = _graph(client, cid, lens="work")
    assert {video, *frames} <= _ids(body)
    assert "rolled" not in _node(body, video)


# -- one finding on the ground is one arrow -------------------------------------
#
# A proof concluding a coordinate states the point of everything behind it, so four
# arrows land on one dot and nothing on screen says three of them are the same picture.
# A reader counts four sources agreeing. There is one, and that is the finding the case
# never made.


def _geolocation(client, cid, *, pov=False):
    """The worked example: a frame off a video, compared against a satellite capture,
    and a proof concluding the point. Every one of the four states the place, which is
    what `satellite._state_point` writes. Returns them in derivation order."""
    video = _media(client, cid, "clip")
    frame = _media(client, cid, "frame")
    capture = _entity(
        client, cid, "capture", "46.2, 61.7", {"path": "captures/x.png", "lat": 46.2}
    )
    proof = _proof(client, cid)
    place = _entity(client, cid, "place", "40.2, 61.7", {"lat": 40.2, "lon": 61.7})
    _derives(cid, frame, video, "derived-from")
    _derives(cid, proof, frame, "derived-from")
    _derives(cid, proof, capture, "derived-from")
    for one in (video, frame, proof, capture):
        _link(client, cid, one, place, "depicts")
    return video, frame, capture, proof, place


def _merged(payload):
    return [link for link in payload["links"] if link.get("merged")]


def test_four_arrows_on_one_point_are_one_finding(client):
    """The false convergence, and the whole reason this reading exists. Three of the
    four are the same picture; the drawing has to say the point rests on one."""
    cid = _case(client, "false convergence")
    video, frame, capture, proof, place = _geolocation(client, cid)

    body = _graph(client, cid)
    assert _ids(body) == {video, place}
    edge = _merged(body)[0]
    assert (edge["from"], edge["to"], edge["type"]) == (video, place, "depicts")
    assert edge["merged"]["sources"] == 3
    assert edge["merged"]["open"] == sorted([frame, proof, capture])
    assert _node(body, place)["rests"]["sources"] == 1


def test_pov_splits_the_verbs_and_the_material_is_still_one(client):
    """The shape a real geolocation has, and it is the one that caught this.

    Answering POV writes `located-at` on the material and leaves `depicts` on the
    composition and the capture. Read per verb, each half sees the other as outside
    itself, every member turns out to hold a derivation reaching "outside", and nothing
    collapses at all — the picture goes back to claiming two origins where the case has
    one. So the family is every arrow on the point, whatever verb it is written with:
    the surviving line is the material's own statement and the rest are named on it.
    """
    cid = _case(client, "pov geolocation")
    video, frame, capture, proof, place = _geolocation(client, cid)
    case = Case.open(cid)
    for holder in (video, frame):
        edge = next(
            link for link in case.links_of(holder)
            if link["to"] == place and link["type"] == "depicts"
        )
        case.remove_link(edge["id"])
        case.add_link(holder, place, "located-at", by="proof-composer")

    body = _graph(client, cid)
    assert _ids(body) == {video, place}
    edge = _merged(body)[0]
    assert (edge["from"], edge["type"]) == (video, "located-at")
    assert edge["merged"]["open"] == sorted([frame, proof, capture])
    assert _node(body, place)["rests"]["sources"] == 1


def test_the_reading_that_draws_no_derivation_still_reads_it(client):
    """Ground holds no chain verb at all, and the redundancy is a fact about the chain.
    Asked of the drawing alone, four arrows off one video are four unrelated sources —
    so the repository is asked instead. The lens decides what is drawn, not what is
    known."""
    cid = _case(client, "ground convergence")
    video, frame, capture, proof, place = _geolocation(client, cid)

    body = _graph(client, cid, lens="ground")
    assert _ids(body) == {video, place}
    assert _merged(body)[0]["merged"]["sources"] == 3


def test_the_arrow_that_survives_stays_the_case_s_own_statement(client):
    """Not a synthetic id: the video really does state that point, and withdrawing it
    has to stay possible. The row is annotated, never replaced."""
    cid = _case(client, "still a row")
    video, _frame, _capture, _proof, place = _geolocation(client, cid)

    edge = _merged(_graph(client, cid))[0]
    assert not edge["id"].startswith(graph_engine.FOLDED_PREFIX)
    assert client.delete(f"/api/cases/{cid}/links/{edge['id']}").status_code == 200


def test_a_capture_pulled_at_the_point_is_the_reference_not_a_witness(client):
    """The sharp case, and why the roles decide. Shape cannot tell the capture from the
    footage — both have one chain leaving them and one arrow landing — but `media` is a
    subject and `capture` is an attestation, the role that means a wrapper carrying a
    path. Counting it would state a corroboration nobody found."""
    cid = _case(client, "reference not witness")
    video, _frame, capture, _proof, place = _geolocation(client, cid)

    body = _graph(client, cid)
    assert capture not in _ids(body)
    assert _node(body, place)["rests"]["sources"] == 1


def test_a_capture_nobody_made_a_proof_from_is_the_only_thing_saying_it(client):
    """A group with no subject root keeps its own. Otherwise the one statement about
    that point would leave with the node that made it."""
    cid = _case(client, "lone capture")
    video, _frame, _capture, _proof, place = _geolocation(client, cid)
    alone = _entity(
        client, cid, "capture", "40.2, 61.7", {"path": "captures/y.png", "lat": 40.2}
    )
    _link(client, cid, alone, place, "depicts")

    body = _graph(client, cid)
    assert _ids(body) == {video, alone, place}
    assert _node(body, place)["rests"]["sources"] == 2


def test_a_member_carrying_its_own_finding_stays_a_node(client):
    """All or nothing, as everywhere else here. A capture that also shows a vehicle is
    holding something the collapsed line cannot say — but it is still the reference the
    comparison was made against, so the point still rests on one source."""
    cid = _case(client, "capture with a finding")
    video, _frame, capture, _proof, place = _geolocation(client, cid)
    van = _entity(client, cid, "vehicle", "white van")
    _link(client, cid, van, capture, "appears-in")

    body = _graph(client, cid)
    assert capture in _ids(body)
    assert _merged(body)[0]["merged"]["sources"] == 2
    assert _node(body, place)["rests"]["sources"] == 1


def test_a_statement_citing_the_proof_brings_it_back(client):
    """The guard the plan asked for by name: cited, the proof is carrying something the
    arrow cannot say. It comes back as a node, and the point still rests on one."""
    cid = _case(client, "cited proof")
    video, _frame, _capture, proof, place = _geolocation(client, cid)
    claim = _entity(client, cid, "claim", "The convoy passed here")
    _link(client, cid, claim, proof, "cites")

    body = _graph(client, cid)
    assert proof in _ids(body)
    assert _node(body, place)["rests"]["sources"] == 1


def test_the_collapsed_arrow_hands_its_nodes_back(client):
    """Named rather than opened, the one mechanism every hand-back here uses."""
    cid = _case(client, "unfold the star")
    video, frame, _capture, _proof, place = _geolocation(client, cid)

    back = _graph(client, cid, keep=frame)
    assert frame in _ids(back)
    assert _merged(back)[0]["merged"]["sources"] == 2
    # And it is a node with its own statement again, not a name with nothing on it.
    assert _node(back, frame)["degree"] == 3


def test_a_node_that_stays_keeps_counting_what_the_arrow_took(client):
    """The one fold whose degree is left alone, and the reason is where the way back
    sits. Every other collapse here hands its nodes back from a line that touches them;
    this one names the frame and the capture on `video → place`, which does not touch
    the proof at all. Priced down to nothing, the proof would say it has no more
    connections while the analyst is looking straight at two that exist.
    """
    cid = _case(client, "expand past the fold")
    video, frame, capture, proof, place = _geolocation(client, cid)
    claim = _entity(client, cid, "claim", "The convoy passed here")
    _link(client, cid, claim, proof, "cites")

    body = _graph(client, cid)
    assert proof in _ids(body)
    assert not {frame, capture} & _ids(body)
    # Cited, stating the point, and made from two things: all four still countable.
    assert _node(body, proof)["degree"] == 4

    # And the click answers with them, because it is the analyst asking for exactly
    # these: a node an expansion brought in is never folded.
    back = _graph(client, cid, expand=proof)
    assert {frame, capture} <= _ids(back)


def test_the_point_keeps_offering_what_landed_on_it(client):
    """Same reading from the other end: four arrows arrived, one is drawn, and opening
    the point is how the other three come back."""
    cid = _case(client, "star degree")
    video, frame, capture, proof, place = _geolocation(client, cid)

    assert _node(_graph(client, cid), place)["degree"] == 4
    assert {frame, capture, proof} <= _ids(_graph(client, cid, expand=place))


def test_a_point_stated_once_says_nothing_about_independence(client):
    """A count that restates the picture is a count nobody reads."""
    cid = _case(client, "one arrow")
    place = _entity(client, cid, "place", "48.0, 2.0", {"lat": 48.0, "lon": 2.0})
    video = _media(client, cid, "clip")
    _link(client, cid, video, place, "depicts")

    assert "rests" not in _node(_graph(client, cid), place)


def test_two_recordings_of_the_same_point_are_two_sources(client):
    """The other half of the number, and the reason it is worth having. Two videos
    nobody derived from each other agree, and that is the finding."""
    cid = _case(client, "two witnesses")
    place = _entity(client, cid, "place", "48.0, 2.0", {"lat": 48.0, "lon": 2.0})
    first = _media(client, cid, "one")
    second = _media(client, cid, "two")
    for one in (first, second):
        _link(client, cid, one, place, "depicts")

    body = _graph(client, cid)
    assert _ids(body) == {first, second, place}
    assert _node(body, place)["rests"]["sources"] == 2
    assert _merged(body) == []


def test_a_reading_that_lands_on_no_place_leaves_the_star_alone(client):
    """Subjects draws no verb that reaches a place, so there is no star to read."""
    cid = _case(client, "no ground")
    video, frame, _capture, _proof, _place = _geolocation(client, cid)

    body = _graph(client, cid, lens="subjects")
    assert {video, frame} <= _ids(body)
    assert _merged(body) == []


# -- the analyst's own arrangement --------------------------------------------
#
# A pin is where a hand put a node. It is presentation, not a statement about the
# case, and the reason it is stored at all is that an arrangement somebody built
# is worth more than the one a relaxation computes.


def _pin(client, cid, *pins, lens="all"):
    res = client.put(
        f"/api/cases/{cid}/graph/pins",
        json={"lens": lens, "pins": [{"id": i, "x": x, "y": y} for i, x, y in pins]},
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_a_dragged_node_comes_back_exactly_where_it_was_put(client):
    """Exactly, not approximately: an anchor that drifted would make the whole
    feature feel broken, and the layout treats the pin as a fixed point."""
    cid = _case(client, "pinned")
    person = _entity(client, cid, "person", "Dragged")

    _pin(client, cid, (person, -412.5, 987.25))

    assert _node(_graph(client, cid), person)["pin"] == [-412.5, 987.25]


def test_a_node_nobody_moved_carries_no_pin_at_all(client):
    """Absent rather than zero: (0, 0) is a place on the canvas, and a node the
    layout owns has to be told apart from one dropped at the origin."""
    cid = _case(client, "unpinned")
    person = _entity(client, cid, "person", "Placed by the layout")

    payload = _graph(client, cid)
    assert "pin" not in _node(payload, person)
    assert payload["pinned"] == 0


def test_dragging_the_same_node_twice_keeps_the_last_spot(client):
    cid = _case(client, "moved twice")
    person = _entity(client, cid, "person", "Moved")

    _pin(client, cid, (person, 10, 10))
    body = _pin(client, cid, (person, 300, -40))

    assert body["pinned"] == 1
    assert _node(_graph(client, cid), person)["pin"] == [300, -40]


def test_the_whole_batch_lands_or_none_of_it_does(client):
    """A drag that moved several nodes is one act."""
    cid = _case(client, "batch")
    a = _entity(client, cid, "person", "A")
    b = _entity(client, cid, "person", "B")

    _pin(client, cid, (a, 1, 2), (b, 3, 4))

    payload = _graph(client, cid)
    assert _node(payload, a)["pin"] == [1, 2]
    assert _node(payload, b)["pin"] == [3, 4]
    assert payload["pinned"] == 2


def test_a_pin_for_an_entity_that_is_gone_is_skipped_not_an_error(client):
    """A drag races a delete made in another tab, and losing that pin is the right
    outcome — refusing the whole batch would lose the arrangement instead."""
    cid = _case(client, "racing")
    person = _entity(client, cid, "person", "Still here")

    body = _pin(client, cid, (person, 5, 5), ("e_gone", 9, 9))

    assert body["pinned"] == 1


def test_the_count_of_pins_covers_the_case_not_just_what_is_drawn(client):
    """The control that undoes an arrangement has to appear even when the pinned
    nodes were cut from this view — otherwise the way back is hidden by the cut."""
    cid = _case(client, "pins off screen")
    hub = _entity(client, cid, "organization", "Hub")
    far = _entity(client, cid, "person", "Cut from this view")
    _pin(client, cid, (far, 100, 100))

    payload = _graph(client, cid, limit=1)

    assert _ids(payload) == {hub} or far not in _ids(payload)
    assert payload["pinned"] == 1


def test_one_node_can_be_handed_back_to_the_layout(client):
    cid = _case(client, "unpin one")
    a = _entity(client, cid, "person", "A")
    b = _entity(client, cid, "person", "B")
    _pin(client, cid, (a, 1, 1), (b, 2, 2))

    res = client.delete(f"/api/cases/{cid}/graph/pins/{a}")
    assert res.status_code == 200
    assert res.json()["pinned"] == 1

    payload = _graph(client, cid)
    assert "pin" not in _node(payload, a)
    assert _node(payload, b)["pin"] == [2, 2]


def test_the_whole_arrangement_can_be_dropped_at_once(client):
    """The way out of an arrangement that stopped helping. Pins are saved as they
    are made, and an autosave with no way back is a trap."""
    cid = _case(client, "reset layout")
    a = _entity(client, cid, "person", "A")
    b = _entity(client, cid, "person", "B")
    _pin(client, cid, (a, 1, 1), (b, 2, 2))

    res = client.delete(f"/api/cases/{cid}/graph/pins")
    assert res.status_code == 200
    assert res.json()["pinned"] == 0

    payload = _graph(client, cid)
    assert payload["pinned"] == 0
    assert all("pin" not in node for node in payload["nodes"])


def test_unpinning_what_was_never_pinned_is_not_an_error(client):
    cid = _case(client, "idempotent unpin")
    person = _entity(client, cid, "person", "Never moved")

    assert client.delete(f"/api/cases/{cid}/graph/pins/{person}").status_code == 200
    assert client.delete(f"/api/cases/{cid}/graph/pins").status_code == 200


def test_a_deleted_node_leaves_no_pin_behind(client):
    """Ids are taken again after a delete (`reinsert`), so a surviving pin would
    place an unrelated entity at a spot nobody chose for it."""
    cid = _case(client, "cascade")
    person = _entity(client, cid, "person", "Doomed")
    _pin(client, cid, (person, 50, 60))

    assert client.delete(f"/api/cases/{cid}/entities/{person}").status_code == 200

    assert _graph(client, cid)["pinned"] == 0


def test_a_coordinate_from_nowhere_is_refused_at_the_edge(client):
    """Nothing downstream clamps a coordinate: the layout would place a node at
    1e300 and the view would scale the case to a dot trying to frame it."""
    cid = _case(client, "absurd")
    person = _entity(client, cid, "person", "A")

    res = client.put(
        f"/api/cases/{cid}/graph/pins",
        json={"pins": [{"id": person, "x": 1e300, "y": 0}]},
    )
    assert res.status_code == 422


def test_no_more_pins_than_the_view_can_draw(client):
    cid = _case(client, "too many pins")
    person = _entity(client, cid, "person", "A")
    res = client.put(
        f"/api/cases/{cid}/graph/pins",
        json={
            "pins": [
                {"id": person, "x": 0, "y": 0} for _ in range(graph_engine.MAX_OPENING + 1)
            ]
        },
    )
    assert res.status_code == 422


def test_a_neighbourhood_carries_no_pin(client):
    """Distance from the root owns the horizontal axis there, so a coordinate
    stated against the cluster would contradict the arrangement being asked for."""
    cid = _case(client, "hood pins")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")
    _pin(client, cid, (person, 40, 40), (unit, 80, 80))

    payload = _hood(client, cid, person)

    assert all("pin" not in node for node in payload["nodes"])


def test_each_lens_keeps_its_own_arrangement(client):
    """A lens is a reading: it draws its own nodes and its own edges, so it clusters
    differently. One arrangement shared by all of them would anchor every reading
    into the shape of whichever one it happened to be built in."""
    cid = _case(client, "per lens")
    person = _entity(client, cid, "person", "Arranged")

    _pin(client, cid, (person, 100, 100), lens="all")
    _pin(client, cid, (person, -50, 900), lens="subjects")

    assert _node(_graph(client, cid, lens="all"), person)["pin"] == [100, 100]
    assert _node(_graph(client, cid, lens="subjects"), person)["pin"] == [-50, 900]
    # And a reading nobody arranged is still the layout's to place.
    assert "pin" not in _node(_graph(client, cid, lens="ground"), person)
    assert _graph(client, cid, lens="ground")["pinned"] == 0


def test_dropping_one_lens_arrangement_leaves_the_others(client):
    cid = _case(client, "reset one lens")
    person = _entity(client, cid, "person", "Arranged")
    _pin(client, cid, (person, 1, 2), lens="all")
    _pin(client, cid, (person, 3, 4), lens="subjects")

    assert client.delete(
        f"/api/cases/{cid}/graph/pins", params={"lens": "all"}
    ).status_code == 200

    assert _graph(client, cid, lens="all")["pinned"] == 0
    assert _node(_graph(client, cid, lens="subjects"), person)["pin"] == [3, 4]


def test_unpinning_one_node_is_scoped_to_its_reading(client):
    cid = _case(client, "unpin per lens")
    person = _entity(client, cid, "person", "Arranged")
    _pin(client, cid, (person, 1, 2), lens="all")
    _pin(client, cid, (person, 3, 4), lens="subjects")

    assert client.delete(
        f"/api/cases/{cid}/graph/pins/{person}", params={"lens": "all"}
    ).status_code == 200

    assert "pin" not in _node(_graph(client, cid, lens="all"), person)
    assert _node(_graph(client, cid, lens="subjects"), person)["pin"] == [3, 4]


def test_a_lens_nothing_can_draw_cannot_be_arranged(client):
    """Pins filed under an unknown reading would sit in the case forever, with no
    surface able to show them or clear them."""
    cid = _case(client, "bad lens")
    person = _entity(client, cid, "person", "A")

    res = client.put(
        f"/api/cases/{cid}/graph/pins",
        json={"lens": "everything-ish", "pins": [{"id": person, "x": 0, "y": 0}]},
    )
    assert res.status_code == 400
    assert client.delete(
        f"/api/cases/{cid}/graph/pins", params={"lens": "everything-ish"}
    ).status_code == 400


def test_moving_a_node_says_nothing_about_the_case(client):
    """A pin is where a hand put a dot. It must not touch the entity, its
    provenance or its status, or the graph would be editing the case by drawing."""
    cid = _case(client, "no statement")
    person = _entity(client, cid, "person", "Untouched")
    catalog = f"/api/cases/{cid}/catalog/entities"
    before = client.get(catalog).json()

    _pin(client, cid, (person, 123, 456))

    assert client.get(catalog).json() == before


# -- bounded reading ----------------------------------------------------------


def test_no_graph_read_walks_the_whole_case(client, monkeypatch):
    """The storage rule (STORAGE_AND_PERFORMANCE step 5): `snapshot` is the one
    deliberate whole-case read, and drawing a case is not it."""
    from azimut import workspace

    def refuse(self):  # pragma: no cover - the assertion is that it never runs
        raise AssertionError("the graph must not snapshot the whole case")

    cid = _case(client, "bounded")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")

    monkeypatch.setattr(workspace.Case, "snapshot", refuse)
    _graph(client, cid)
    _hood(client, cid, person, hops=2)


# -- growing the view ---------------------------------------------------------
#
# Opening a node adds to the case on screen instead of replacing it with a
# different question. That is what makes the graph a place to work rather than a
# thing to navigate, and every test here is about the picture surviving the act.


def test_opening_a_node_adds_its_neighbours_to_the_view(client):
    """The point of the whole change: what was on screen is still on screen."""
    cid = _case(client, "grow")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    other = _entity(client, cid, "person", "Elsewhere")
    _link(client, cid, person, unit, "member-of")

    before = _ids(_graph(client, cid))
    after = _graph(client, cid, expand=person)

    assert before <= _ids(after)
    assert {person, unit, other} <= _ids(after)
    assert after["expanded"] == [person]


def test_an_arrival_says_it_arrived(client):
    """A node the expansion brought in has to be tellable from one the ranking
    already held, or growing the view reads as the view changing underfoot."""
    cid = _case(client, "arrivals")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")

    # Filtered to people, so the unit can only be here because it was opened into.
    payload = _graph(client, cid, type="person", expand=person)

    assert _node(payload, unit)["added"] is True
    assert "added" not in _node(payload, person)


def test_an_expansion_ignores_the_filters_it_was_asked_from(client):
    """An analyst who asked what touches this node is asking about the case, not
    about the narrowing they set earlier."""
    cid = _case(client, "past the filter")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")

    narrowed = _graph(client, cid, type="person")
    grown = _graph(client, cid, type="person", expand=person)

    assert unit not in _ids(narrowed)
    assert unit in _ids(grown)


def test_the_node_opened_is_kept_even_when_the_filters_drop_it(client):
    """A view answering "what touches this" without the node itself is a broken
    sentence."""
    cid = _case(client, "the question stays")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")

    payload = _graph(client, cid, type="organization", expand=person)

    assert person in _ids(payload)
    assert _node(payload, person)["added"] is True


def test_an_expansion_returns_the_closed_edge_set(client):
    """The guarantee the view has always made, kept while it grows: nothing drawn
    points at a node that was not sent."""
    cid = _case(client, "closed while growing")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")

    payload = _graph(client, cid, expand=person)
    ids = _ids(payload)

    assert all({link["from"], link["to"]} <= ids for link in payload["links"])


def test_an_arrival_states_what_a_further_expansion_would_cost(client):
    """A node that arrived by expansion prices its own next click like every
    other node, or the second hop is the one that explodes."""
    cid = _case(client, "priced arrivals")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    for at in range(3):
        member = _entity(client, cid, "person", f"Member {at}")
        _link(client, cid, member, unit, "member-of")
    _link(client, cid, person, unit, "member-of")

    payload = _graph(client, cid, limit=1, expand=person)

    assert _node(payload, unit)["degree"] == 4


def test_opening_a_node_that_is_gone_is_not_an_error(client):
    """An expansion races a delete made in another tab. The view still draws."""
    cid = _case(client, "ghost")
    person = _entity(client, cid, "person", "Root")

    payload = _graph(client, cid, expand="ent_nothing")

    assert payload["expanded"] == []
    assert person in _ids(payload)


def test_an_expansion_stays_inside_the_lens(client):
    """A lens is a reading. Growing it must not smuggle in verbs it excluded."""
    cid = _case(client, "lens holds")
    place = _entity(client, cid, "place", "Field")
    unit = _entity(client, cid, "organization", "Unit")
    depot = _entity(client, cid, "structure", "Depot")
    _link(client, cid, unit, depot, "owns")
    _link(client, cid, depot, place, "sited-at")

    # No claim in the case, so the ranking brings nothing and everything on
    # screen is what the expansion reached through this lens's verbs.
    payload = _graph(client, cid, lens="ground", type="claim", expand=depot)

    assert place in _ids(payload)
    assert unit not in _ids(payload)


def test_an_expansion_brings_every_missing_neighbour(client):
    """Growth is unbounded, and this is the half that matters on screen: an expansion
    that came back with part of an answer left the node still counting connections it
    did not draw, under a control that had already agreed it was open."""
    cid = _case(client, "unbounded growth")
    hub = _entity(client, cid, "organization", "Hub")
    for at in range(6):
        member = _entity(client, cid, "person", f"Member {at}")
        _link(client, cid, member, hub, "member-of")

    payload = _graph(client, cid, limit=1, expand=hub)

    # One node paid for by the first draw, and all six neighbours on top of it.
    assert payload["shown"] == 7
    assert payload["expanded"] == [hub]
    # And the node stops asking: its degree is what the drawing now holds.
    assert _node(payload, hub)["degree"] == 6
    # `truncated` is the first draw's own answer and nothing else's: the ranking held
    # one node of seven, which is the only cut the tool still makes.
    assert payload["truncated"] is True


# -- a comfort number, not a ceiling ------------------------------------------
#
# The drawing had a hard limit, and a limit that refuses is the app overruling the
# analyst about their own picture: a full view refused an answer that had been asked
# for outright, and refused it in silence. What is left is a count to open on, growth
# without limit from there, and a client that says what a heavy drawing costs.


def test_a_first_draw_opens_on_the_comfort_number(client, monkeypatch):
    """The one cut the tool still makes, and it is the ranking's: the most connected
    part of the case, said to be a part with the case's own total beside it."""
    monkeypatch.setattr(graph_engine, "OPENING_NODES", 2)
    cid = _case(client, "opens on a number")
    hub = _entity(client, cid, "organization", "Hub")
    for at in range(4):
        member = _entity(client, cid, "person", f"Member {at}")
        _link(client, cid, member, hub, "member-of")

    payload = client.get(f"/api/cases/{cid}/graph").json()

    assert payload["shown"] == 2
    assert payload["total"] == 5
    assert payload["truncated"] is True


def test_the_drawing_states_no_ceiling_because_it_has_none(client):
    """A number a client can only use to refuse a click is not sent. Growth is
    unbounded, so there is nothing left to be full of."""
    cid = _case(client, "no ceiling")
    _entity(client, cid, "person", "Root")

    payload = _graph(client, cid)

    assert "room" not in payload


def test_an_expansion_is_never_refused_for_room(client, monkeypatch):
    """The failure this closes: drawing the case and asking what touches one node
    shared one budget, the ranking spent it first, and the answer the analyst asked
    for outright was the one refused."""
    monkeypatch.setattr(graph_engine, "OPENING_NODES", 2)
    cid = _case(client, "asked for outright")
    hub = _entity(client, cid, "organization", "Hub")
    members = [_entity(client, cid, "person", f"Member {at}") for at in range(6)]
    for member in members:
        _link(client, cid, member, hub, "member-of")

    payload = _graph(client, cid, limit=2, expand=hub)

    assert set(members) <= _ids(payload)
    assert payload["expanded"] == [hub]


def test_naming_a_node_is_never_refused_for_room_either(client, monkeypatch):
    """`keep` is the other half of the same promise: a route and a name found in the
    case are asked for outright, and a picture that came back short of one of them
    answered the question with the question missing from it."""
    monkeypatch.setattr(graph_engine, "OPENING_NODES", 1)
    cid = _case(client, "named past the old ceiling")
    named = [_entity(client, cid, "person", f"Person {at}") for at in range(3)]

    payload = _graph(client, cid, limit=1, keep=",".join(named))

    assert set(named) <= _ids(payload)
    assert payload["kept"] == named


def test_a_drawing_past_the_ranking_ceiling_still_draws(tmp_workspace):
    """The regression the room kept for asking caused, and the reason it is tested
    here rather than only where it broke: raising a ceiling in one module raises it
    for every reader the node ids travel through, and one of them refused more than
    500 at a time. The whole tool drew nothing at all past that line."""
    _, summary = build_big_case(
        name="Past the ceiling", entities=700, links=1200, media=300,
        notes=0, artifacts=0, write_media_files=False,
    )
    case = Case.open(summary.case_id)

    ranked = graph_engine.view(case, limit=graph_engine.OPENING_NODES)
    assert ranked["shown"] == graph_engine.OPENING_NODES

    # Entities the ranking had no room for. Opened, they are kept whatever the cut
    # decided — which is what carries the drawing past the ceiling it was cut to.
    drawn = {node["id"] for node in ranked["nodes"]}
    outside, cursor = [], None
    while True:
        page = case.page_entities(limit=250, cursor=cursor)
        outside.extend(row["id"] for row in page["items"] if row["id"] not in drawn)
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert len(outside) > 100, "the case has to outgrow the ranking for this to test anything"

    grown = graph_engine.view(case, limit=graph_engine.OPENING_NODES, expand=outside[:100])

    assert grown["shown"] > graph_engine.OPENING_NODES

    # **Complete as well as closed.** Asserted here because this is the one test that
    # draws a view large enough for the storage layer to read its ids in more than one
    # statement, and reading them chunk by chunk dropped every edge whose two ends
    # landed in two different chunks. Counted on `shown` alone this passed while two
    # thirds of the edges were gone: nodes drew as unconnected dots, and each one went
    # on reporting the lost edges as connections still to open.
    ids = {node["id"] for node in grown["nodes"]}
    verbs = set(graph_engine.lens("all").types)
    owed = {
        link["id"]
        for link in case.list_links()
        if link["type"] in verbs and link["from"] in ids and link["to"] in ids
    }
    assert owed, "the case has to link its drawn nodes for this to test anything"
    assert {link["id"] for link in grown["links"]} == owed


def test_a_node_with_everything_already_drawn_is_still_reported_open(client):
    """Nothing arrived, and nothing was meant to. That is a true answer, and the
    control that folds the expansion back has to know it is out."""
    cid = _case(client, "nothing left to bring")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")

    payload = _graph(client, cid, expand=person)

    assert payload["expanded"] == [person]
    assert payload["truncated"] is False


# -- the drawing is a set you own ---------------------------------------------
#
# One list conflated two acts: *draw this node* and *draw this node and one hop*.
# Split, a route or a named entity arrives as itself instead of dragging a
# neighbourhood in behind it. And a third list takes any node out — not only one you
# opened — which is what a drawing that can grow without limit needs: the way back was
# folding every expansion, and that takes the reading down with it.


def test_a_node_named_is_drawn_without_its_neighbourhood(client):
    """The half of the old `expand` that was never expressible."""
    cid = _case(client, "held alone")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")

    # Filtered to a type neither of them holds, so anything on screen is named.
    payload = _graph(client, cid, type="claim", keep=person)

    assert _ids(payload) == {person}
    assert payload["kept"] == [person]
    assert _node(payload, person)["added"] is True


def test_naming_a_route_draws_it_without_the_crowd_around_each_node(client):
    """Why the split exists. A route is a small precise answer, and opened it arrived
    with one whole neighbourhood per node — the crowd buried the sentence."""
    cid = _case(client, "route without the crowd")
    account = _entity(client, cid, "account", "@watcher")
    media = _entity(client, cid, "media", "frame", {"path": "media/f.jpg", "kind": "image"})
    place = _entity(client, cid, "place", "checkpoint north")
    _link(client, cid, account, media, "posted")
    _link(client, cid, media, place, "depicts")
    for at in range(4):
        other = _entity(client, cid, "media", f"other {at}", {"path": f"media/o{at}.jpg"})
        _link(client, cid, account, other, "posted")

    route = ",".join([account, media, place])
    held = _graph(client, cid, type="claim", keep=route)
    grown = _graph(client, cid, type="claim", expand=route)

    assert _ids(held) == {account, media, place}
    # The route still reads as a route: its own edges are drawn, closed as ever.
    assert len(held["links"]) == 2
    assert len(_ids(grown)) > len(_ids(held))


def test_what_is_named_survives_the_narrowing_it_was_named_from(client):
    """The same argument an expansion already makes: a name is a question about the
    case, not about the filters set earlier."""
    cid = _case(client, "named past the filter")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")

    payload = _graph(client, cid, type="organization", keep=person)

    assert {person, unit} <= _ids(payload)


def test_the_lens_still_outranks_a_node_named_to_be_drawn(client):
    """A reading that does not draw notes would stop being that reading with a note in
    it, so this is the one narrowing a name cannot be brought past."""
    cid = _case(client, "named but filed")
    post = _entity(client, cid, "post", "Thread draft")

    payload = _graph(client, cid, keep=post)

    assert post not in _ids(payload)
    assert payload["kept"] == []
    assert post in _ids(_graph(client, cid, lens="work", keep=post))


def test_naming_a_node_that_is_gone_is_not_an_error(client):
    """A drawing races a delete made in another tab, and the answer is the picture
    without it rather than a refusal."""
    cid = _case(client, "named ghost")
    person = _entity(client, cid, "person", "Still here")

    payload = _graph(client, cid, keep="e_nothing")

    assert payload["kept"] == []
    assert person in _ids(payload)


def test_a_node_named_prices_its_own_click_like_any_other(client):
    """It arrived without its neighbours, so what it would bring in is the whole of
    what it says: a node that cannot state its degree is a node nobody can decide to
    open."""
    cid = _case(client, "priced by name")
    unit = _entity(client, cid, "organization", "Unit")
    for at in range(3):
        member = _entity(client, cid, "person", f"Member {at}")
        _link(client, cid, member, unit, "member-of")

    payload = _graph(client, cid, type="claim", keep=unit)

    assert _node(payload, unit)["degree"] == 3


def test_a_source_handed_back_is_drawn_rather_than_folded_away_again(client):
    """How a collapsed edge hands its sources back. A named node is never folded, so
    the same list that draws it has to be the one the fold reads — otherwise pressing
    *show the source* answers with the edge it was pressed on."""
    cid = _case(client, "handed back by name")
    claim, who, marks = _sourced(client, cid)

    assert _folded(_graph(client, cid))[0]["folded"]["open"] == sorted(marks)

    back = _graph(client, cid, keep=marks[0])

    assert marks[0] in _ids(back)
    assert _folded(back)[0]["folded"]["sources"] == 2


def test_any_node_can_be_taken_out_of_the_drawing(client):
    """Not only one that was opened. The drawing is the analyst's, and the old way out
    of a crowded one folded every expansion and took the reading with it."""
    cid = _case(client, "take one out")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")

    payload = _graph(client, cid, omit=unit)

    assert _ids(payload) == {person}
    assert payload["links"] == []


def test_a_node_taken_out_stays_out_when_a_neighbour_is_opened(client):
    """Applied last, and that is the whole of why it works: subtracted from the ranking
    alone, a node came back the moment a neighbour was opened and the analyst was
    arguing with the ranking about their own picture."""
    cid = _case(client, "stays out")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")

    payload = _graph(client, cid, type="person", expand=person, omit=unit)

    assert person in _ids(payload)
    assert unit not in _ids(payload)


def test_a_neighbour_stops_offering_to_bring_back_what_was_taken_out(client):
    """A degree says what a click would bring in, and nothing brings a removal back:
    left standing, the count offers an act that answers with an unchanged picture —
    the failure the honest degree exists to prevent."""
    cid = _case(client, "honest after a removal")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    other = _entity(client, cid, "organization", "Other unit")
    _link(client, cid, person, unit, "member-of")
    _link(client, cid, person, other, "member-of")

    assert _node(_graph(client, cid), person)["degree"] == 2
    assert _node(_graph(client, cid, omit=unit), person)["degree"] == 1


def test_taking_a_node_out_takes_it_off_the_count_as_well(client):
    """The count beside the lens is what is drawn, so hiding one has to move it: a
    number that argues with the picture is worse than no number."""
    cid = _case(client, "one fewer drawn")
    person = _entity(client, cid, "person", "Root")
    unit = _entity(client, cid, "organization", "Unit")
    _link(client, cid, person, unit, "member-of")

    before = _graph(client, cid)
    after = _graph(client, cid, omit=unit)

    assert after["shown"] == before["shown"] - 1


def test_a_source_taken_out_comes_back_as_the_edge_it_stood_for(client):
    """A middle taken out is still a middle. The path through it is a fact about the
    case where the act was about the picture, so it is said as an edge — which is what
    the fold does for a source the budget cut, for the same reason."""
    cid = _case(client, "removed middle")
    claim, who, marks = _sourced(client, cid)

    drawn = _graph(client, cid, keep=",".join(marks))
    assert set(marks) <= _ids(drawn)

    payload = _graph(client, cid, keep=",".join(marks[1:]), omit=marks[0])

    assert marks[0] not in _ids(payload)
    edge = _folded(payload)[0]
    assert (edge["from"], edge["to"], edge["type"]) == (claim, who, "cites")
    assert edge["folded"]["sources"] == 1
    assert edge["folded"]["open"] == [marks[0]]


def test_taking_out_an_id_the_case_never_had_changes_nothing(client):
    cid = _case(client, "removed ghost")
    person = _entity(client, cid, "person", "Still here")

    payload = _graph(client, cid, omit="e_nothing")

    assert _ids(payload) == {person}


def test_taking_out_the_account_a_fold_lands_on_never_grows_the_drawing(client):
    """A removal must never *add* a node. The fold reads the chain statement → source →
    account, so taking the account out broke it, nothing folded, and the three bookmarks
    that had never been drawn arrived as nodes: two on screen became four, on the one
    act that promised fewer."""
    cid = _case(client, "fold, then take the account out")
    claim, who, _marks = _sourced(client, cid)

    assert _ids(_graph(client, cid)) == {claim, who}

    payload = _graph(client, cid, omit=who)

    assert _ids(payload) == {claim}
    assert payload["links"] == []


def test_a_middle_a_removal_cut_is_still_a_middle(client):
    """Which is why the fold reads the edges the removal cut. Read off the drawing
    alone, the chain has already lost the leg that makes it one, and the bookmarks come
    back as the nodes the fold exists to keep off the screen."""
    cid = _case(client, "the cut leg still counts")
    claim, who, marks = _sourced(client, cid)

    payload = _graph(client, cid, omit=who)

    for mark in marks:
        assert mark not in _ids(payload)


def test_a_node_taken_out_takes_what_only_it_was_holding(client):
    """The half the removal was missing. Taking out the node you opened left its whole
    neighbourhood drawn with no edge to anything — a handful of dots whose only reason
    to be there had just gone."""
    cid = _case(client, "the arrivals go too")
    root = _entity(client, cid, "person", "Root")
    hub = _entity(client, cid, "account", "@hub")
    _link(client, cid, root, hub, "owns")
    shots = [_entity(client, cid, "media", f"Shot {n}") for n in range(3)]
    for shot in shots:
        _link(client, cid, hub, shot, "posted")

    # Only people are ranked, so the account and its media are there by the expansion
    # alone.
    opened = _graph(client, cid, type="person", expand=hub)
    assert _ids(opened) == {root, hub, *shots}

    payload = _graph(client, cid, type="person", expand=hub, omit=hub)

    assert _ids(payload) == {root}


def test_an_arrival_a_second_expansion_reaches_stays(client):
    """The convergence the drawing exists to show. Two accounts posting the same media
    is the finding, so taking one out must not take the media the other still holds."""
    cid = _case(client, "two accounts, one frame")
    root = _entity(client, cid, "person", "Root")
    hub = _entity(client, cid, "account", "@hub")
    other = _entity(client, cid, "account", "@other")
    _link(client, cid, root, hub, "owns")
    _link(client, cid, root, other, "owns")
    shared = _entity(client, cid, "media", "Shared frame")
    only_hub = _entity(client, cid, "media", "Hub frame")
    for account in (hub, other):
        _link(client, cid, account, shared, "posted")
    _link(client, cid, hub, only_hub, "posted")

    payload = _graph(client, cid, type="person", expand=f"{hub},{other}", omit=hub)

    assert _ids(payload) == {root, other, shared}


def test_an_arrival_the_ranking_already_reaches_stays(client):
    """An arrival joined to something drawn on its own merits is not adrift, whichever
    node brought it in."""
    cid = _case(client, "held by the ranking")
    root = _entity(client, cid, "person", "Root")
    seen = _entity(client, cid, "person", "Also ranked")
    hub = _entity(client, cid, "account", "@hub")
    _link(client, cid, root, hub, "owns")
    frame = _media(client, cid, "Frame")
    adrift = _media(client, cid, "Adrift")
    _link(client, cid, hub, frame, "posted")
    _link(client, cid, hub, adrift, "posted")
    _link(client, cid, seen, frame, "appears-in")

    payload = _graph(client, cid, type="person", expand=hub, omit=hub)

    assert _ids(payload) == {root, seen, frame}
    assert adrift not in _ids(payload)


def test_two_arrivals_holding_only_each_other_are_still_adrift(client):
    """Why it is reachability and not a degree. Counting edges keeps a pair that holds
    itself up, and the vocabulary ranks no edge above another — there is no such thing
    as the link that holds a node."""
    cid = _case(client, "a pair adrift")
    # Only places are ranked, so nothing else in this case stands on its own.
    spot = _entity(client, cid, "place", "Quay")
    unit = _entity(client, cid, "organization", "Unit")
    driver = _entity(client, cid, "person", "Driver")
    truck = _entity(client, cid, "vehicle", "Truck")
    _link(client, cid, driver, unit, "member-of")
    _link(client, cid, unit, truck, "owns")
    # Both arrived by the same hop, and they are joined to each other: once the unit
    # goes each still has an edge, and neither has anything else.
    _link(client, cid, driver, truck, "owns")

    payload = _graph(client, cid, type="place", expand=unit, omit=unit)

    assert _ids(payload) == {spot}


def test_a_node_the_ranking_drew_is_never_dropped_for_standing_alone(client):
    """A ranked node is allowed to have no edge at all — that is what `isolated`
    counts. Only what arrived by a hop is held by what reaches it."""
    cid = _case(client, "alone by right")
    root = _entity(client, cid, "person", "Root")
    lone = _entity(client, cid, "person", "Nobody linked me")
    hub = _entity(client, cid, "account", "@hub")
    _link(client, cid, root, hub, "owns")

    payload = _graph(client, cid, type="person", expand=hub, omit=hub)

    assert _ids(payload) == {root, lone}


def test_a_node_named_to_be_drawn_survives_a_removal_beside_it(client):
    """`keep` says draw this one and nothing around it, so it has no anchor by
    definition. Dropping it for that would refuse the act that drew it."""
    cid = _case(client, "named stands alone")
    root = _entity(client, cid, "person", "Root")
    hub = _entity(client, cid, "account", "@hub")
    _link(client, cid, root, hub, "owns")
    frame = _media(client, cid, "Frame")
    _link(client, cid, hub, frame, "posted")
    far = _entity(client, cid, "place", "Named on its own")

    payload = _graph(client, cid, type="person", expand=hub, keep=far, omit=hub)

    assert _ids(payload) == {root, far}


# -- the path -----------------------------------------------------------------


def _paths(client, cid, from_id, to_id, **params):
    res = client.get(
        f"/api/cases/{cid}/graph/paths",
        params={"from": from_id, "to": to_id, **params},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _chain(client, cid):
    """account --posted--> media --depicts--> place, the shape an investigation walks."""
    account = _entity(client, cid, "account", "@watcher")
    media = _entity(
        client, cid, "media", "harbour frame", {"path": "media/frame.jpg", "kind": "image"}
    )
    place = _entity(client, cid, "place", "checkpoint north")
    _link(client, cid, account, media, "posted")
    _link(client, cid, media, place, "depicts")
    return account, media, place


def test_a_path_is_the_question_the_case_could_not_be_asked(client):
    """How one entity reaches another, which no single hop and no table answers."""
    cid = _case(client, "a path")
    account, media, place = _chain(client, cid)

    payload = _paths(client, cid, account, place)

    assert payload["found"] is True
    assert payload["hops"] == 2
    assert [route["nodes"] for route in payload["routes"]] == [[account, media, place]]
    assert {node["id"] for node in payload["nodes"]} == {account, media, place}
    assert len(payload["links"]) == 2


def test_a_path_runs_against_an_arrow_as_readily_as_along_it(client):
    """An arrowhead says what an edge claims, not which way a route may run: asked
    the other way round, the same two entities are the same two hops apart."""
    cid = _case(client, "either way")
    account, media, place = _chain(client, cid)

    payload = _paths(client, cid, place, account)

    assert payload["hops"] == 2
    assert payload["routes"][0]["nodes"] == [place, media, account]


def test_every_shortest_route_is_returned_because_the_ties_are_the_finding(client):
    """Two accounts reaching the same place by two sources is what independence
    looks like, and an answer that picked one of them would hide it."""
    cid = _case(client, "two sources")
    account = _entity(client, cid, "account", "@watcher")
    place = _entity(client, cid, "place", "checkpoint north")
    for at in range(2):
        media = _entity(
            client, cid, "media", f"frame {at}", {"path": f"media/{at}.jpg", "kind": "image"}
        )
        _link(client, cid, account, media, "posted")
        _link(client, cid, media, place, "depicts")

    payload = _paths(client, cid, account, place)

    assert payload["hops"] == 2
    assert len(payload["routes"]) == 2
    middles = {route["nodes"][1] for route in payload["routes"]}
    assert len(middles) == 2


def test_a_longer_way_round_is_not_returned_once_a_shorter_one_exists(client):
    """Once two entities are joined directly, the scenic route says nothing about
    how they are connected."""
    cid = _case(client, "short and long")
    account = _entity(client, cid, "account", "@watcher")
    media = _entity(
        client, cid, "media", "frame", {"path": "media/frame.jpg", "kind": "image"}
    )
    place = _entity(client, cid, "place", "checkpoint north")
    # The media both shows the place and is the account's own post, so the account
    # is one hop from the place through the picture and two through nothing else.
    _link(client, cid, media, place, "located-at")
    _link(client, cid, account, media, "posted")
    _link(client, cid, media, place, "depicts")

    payload = _paths(client, cid, media, place)

    assert payload["hops"] == 1
    assert all(len(route["nodes"]) == 2 for route in payload["routes"])


def test_no_route_is_an_answer_rather_than_an_error(client):
    """Learning that two entities are not connected within the budget is a finding
    about the case, where an empty response would read as no opinion."""
    cid = _case(client, "unconnected")
    account = _entity(client, cid, "account", "@watcher")
    place = _entity(client, cid, "place", "elsewhere")

    payload = _paths(client, cid, account, place)

    assert payload["found"] is False
    assert payload["routes"] == []
    assert payload["nodes"] == []
    assert payload["hops"] == 0


def test_a_lens_narrows_which_verbs_a_route_may_use(client):
    """A route through a verb the reading excludes is not a route in that reading."""
    cid = _case(client, "lensed path")
    account, media, place = _chain(client, cid)

    everything = _paths(client, cid, account, place, lens="all")
    ground = _paths(client, cid, account, place, lens="ground")

    assert everything["found"] is True
    # `posted` is not a geography verb, so the account cannot be reached from there.
    assert ground["found"] is False


def test_a_route_stops_at_the_hop_budget(client):
    """Four hops on a well-linked case reaches most of it, and a chain that long
    says everything is connected to everything, which is true and useless."""
    cid = _case(client, "too far")
    made = [_entity(client, cid, "organization", f"Unit {at}") for at in range(7)]
    for at in range(6):
        _link(client, cid, made[at], made[at + 1], "part-of")

    assert _paths(client, cid, made[0], made[6])["found"] is False
    assert _paths(client, cid, made[0], made[4])["hops"] == 4


def test_the_hop_budget_cannot_be_raised_past_the_ceiling(client):
    """Asked for more than the ceiling, the read is bounded rather than refused —
    the same contract every other budget here keeps."""
    cid = _case(client, "ceiling")
    made = [_entity(client, cid, "organization", f"Unit {at}") for at in range(7)]
    for at in range(6):
        _link(client, cid, made[at], made[at + 1], "part-of")

    payload = _paths(client, cid, made[0], made[6], hops=40)

    assert payload["searched"] == graph_engine.MAX_PATH_HOPS
    assert payload["found"] is False


def test_an_entity_that_is_not_there_is_said_rather_than_answered_with_nothing(client):
    cid = _case(client, "missing end")
    account = _entity(client, cid, "account", "@watcher")

    res = client.get(
        f"/api/cases/{cid}/graph/paths", params={"from": account, "to": "nope"}
    )

    assert res.status_code == 404


def test_a_node_asked_about_against_itself_is_a_route_of_no_hops(client):
    cid = _case(client, "itself")
    account = _entity(client, cid, "account", "@watcher")

    payload = _paths(client, cid, account, account)

    assert payload["found"] is True
    assert payload["hops"] == 0
    assert payload["routes"] == [{"nodes": [account], "links": []}]


# -- the board's own filter, drawn ------------------------------------------
#
# The two surfaces read one case, and until now they spoke different filters: the
# table could ask *which videos have coordinates* and the drawing could not, so a
# question worked out in one could never be looked at in the other.


def test_the_drawing_answers_the_same_sentence_the_table_does(client):
    """*media, kind video, linked to a place* — the catalog's own sentence, asked of
    the graph. One predicate answers both, so the two cannot disagree."""
    cid = _case(client, "sentence")
    placed = _entity(client, cid, "media", "clip.mp4", {"kind": "video"})
    _entity(client, cid, "media", "orphan.mp4", {"kind": "video"})
    _entity(client, cid, "media", "still.jpg", {"kind": "image"})
    quay = _entity(client, cid, "place", "48.0, 2.0", {"lat": 48.0, "lon": 2.0})
    _link(client, cid, placed, quay, "located-at")

    payload = _graph(client, cid, type="media", attr="kind", value="video", linked="place")

    assert [node["id"] for node in payload["nodes"]] == [placed]
    assert payload["total"] == 1


def test_search_plus_reaches_a_typed_field_in_the_live_graph(client):
    """A plate is searchable even when the graph node title does not contain it."""
    cid = _case(client, "broad graph search")
    vehicle = _entity(
        client, cid, "vehicle", "White pickup", {"plate": "AX-904-ZT"}
    )
    _entity(client, cid, "person", "Unrelated witness")

    payload = _graph(client, cid, q="AX-904-ZT")

    assert [node["id"] for node in payload["nodes"]] == [vehicle]
    assert payload["total"] == 1
    assert payload["nodes"][0]["matches"] == [
        {"field": "plate", "label": "Plate", "value": "AX-904-ZT"}
    ]


def test_the_drawing_can_be_asked_what_nothing_connects_to(client):
    """The case's unexploited material, drawn rather than only counted."""
    cid = _case(client, "loose")
    joined = _media(client, cid, "clip")
    quay = _entity(client, cid, "place", "48.0, 2.0", {"lat": 48.0, "lon": 2.0})
    _link(client, cid, joined, quay, "depicts")
    alone = _media(client, cid, "orphan")

    payload = _graph(client, cid, unlinked="true")

    assert [node["id"] for node in payload["nodes"]] == [alone]


def test_the_drawing_narrows_on_when_a_row_was_filed(client, monkeypatch):
    cid = _case(client, "dates")
    monkeypatch.setattr("azimut.sqlite_backend._now", lambda: "2026-07-01T09:00:00Z")
    _entity(client, cid, "person", "old")
    monkeypatch.setattr("azimut.sqlite_backend._now", lambda: "2026-08-10T09:00:00Z")
    recent = _entity(client, cid, "person", "new")

    payload = _graph(client, cid, since="2026-08-01")

    assert [node["id"] for node in payload["nodes"]] == [recent]


def test_a_node_named_by_the_caller_is_drawn_beside_the_case_it_came_from(client):
    """`keep` draws a node and nothing around it, and the case stays behind it: the
    picture grows rather than being replaced by the answer to a smaller question."""
    cid = _case(client, "named")
    wanted = _media(client, cid, "clip")
    quay = _entity(client, cid, "place", "48.0, 2.0", {"lat": 48.0, "lon": 2.0})
    _link(client, cid, wanted, quay, "depicts")
    _entity(client, cid, "person", "somebody else")

    payload = _graph(client, cid, keep=wanted)

    assert len(payload["nodes"]) == 3
    assert payload["kept"] == [wanted]
    assert payload["total"] == 3


def test_a_proof_adopts_the_preview_its_spec_was_keeping_to_itself(client):
    """A proof saved before the preview lived on the entity keeps it in its spec
    file. The first draw that shows one reads the spec, records it on the row, and
    every later draw finds it there like any other preview."""
    cid = _case(client, "adopt preview")
    case = Case.open(cid)
    meta = case.resolve_inside("proofs/.meta")
    meta.mkdir(parents=True, exist_ok=True)
    meta.joinpath("Quay.json").write_text(
        json.dumps({"azimut_proof": 1, "thumb": "media/.thumbs/quay-g1.jpg"}),
        encoding="utf-8",
    )
    proof = _entity(
        client, cid, "proof", "Quay", {"spec": "proofs/.meta/Quay.json"}
    )
    assert "thumb" not in (case.get_entity(proof)["attrs"])

    assert _node(_graph(client, cid), proof)["thumb"] == "media/.thumbs/quay-g1.jpg"

    assert Case.open(cid).get_entity(proof)["attrs"]["thumb"] == (
        "media/.thumbs/quay-g1.jpg"
    )


def test_the_drawing_still_arrives_when_the_preview_cannot_be_recorded(
    client, monkeypatch
):
    """The copy onto the entity is an optimisation, and a locked database must not
    turn a read of the graph into an error. A background import or a mass delete
    holding the write lock past `busy_timeout` is exactly that case."""
    cid = _case(client, "locked preview")
    case = Case.open(cid)
    meta = case.resolve_inside("proofs/.meta")
    meta.mkdir(parents=True, exist_ok=True)
    meta.joinpath("Roof.json").write_text(
        json.dumps({"azimut_proof": 1, "thumb": "media/.thumbs/roof-g1.jpg"}),
        encoding="utf-8",
    )
    proof = _entity(
        client, cid, "proof", "Roof", {"spec": "proofs/.meta/Roof.json"}
    )

    def locked(self, *args, **kwargs):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(Case, "update_entity", locked)

    body = _graph(client, cid)

    # 200, and the node still carries the preview it just read off the spec
    assert _node(body, proof)["thumb"] == "media/.thumbs/roof-g1.jpg"
