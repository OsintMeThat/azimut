"""The entity and connection vocabularies (ONTOLOGY §§2–3).

Families organize the board; each verb still declares the concrete endpoints that
make semantic sense. A new type therefore joins no connection accidentally. This
file locks the exact matrix exposed by the API and enforced on writes.
"""

import pytest

from azimut.engine import artifacts
from azimut.engine import entities
from azimut.engine import links as link_engine
from azimut.workspace import Case, CaseError


def _new_case(client, name):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _link(client, cid, from_id, to_id, type_):
    return client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": from_id, "to_id": to_id, "type": type_},
    )


# -- the registry -------------------------------------------------------------


def test_the_vocabulary_says_each_types_family_reading_and_fields(client):
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}

    assert rows["person"]["family"] == "actor"
    assert rows["person"]["manual"] is True
    assert rows["vessel"]["family"] == "asset"
    assert rows["media"]["family"] == "collected"
    assert rows["proof"]["family"] == "document"
    assert rows["place"]["family"] == "place"
    assert rows["person"]["identity_label"] == "Full name"
    assert rows["ip"]["identity_label"] == "IP address"
    assert rows["ip"]["identity_placeholder"] == "203.0.113.42"
    # the fields are what lets one generated form serve every hand-made type
    assert [attr["key"] for attr in rows["aircraft"]["attrs"]] == [
        "registration",
        "icao24",
        "model",
    ]
    kinds = {attr["key"]: attr["kind"] for attr in rows["account"]["attrs"]}
    assert kinds["url"] == "url"


def test_identifiers_expose_the_value_field_and_relevant_context(client):
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}

    assert [attr["key"] for attr in rows["ip"]["attrs"]] == [
        "network",
        "asn",
        "provider",
    ]
    assert rows["ip"]["attrs"][0]["editable"] is False
    assert rows["network"]["identity_label"] == "Network or CIDR"
    assert [attr["key"] for attr in rows["network"]["attrs"]] == [
        "asn",
        "provider",
        "country",
    ]
    # The handle is the account's label. A second handle field could disagree.
    assert "handle" not in {attr["key"] for attr in rows["account"]["attrs"]}


def test_the_legacy_ip_network_field_is_read_only(client):
    cid = _new_case(client, "Legacy IP field")
    created = client.post(
        f"/api/cases/{cid}/entities",
        json={
            "type": "ip",
            "label": "203.0.113.42",
            "attrs": {"network": "203.0.113.0/24"},
        },
    )
    assert created.status_code == 400

    case = Case.open(cid)
    legacy = case.add_entity(
        "ip", "203.0.113.43", {"network": "Old free text"}, by="user"
    )
    kept = client.patch(
        f"/api/cases/{cid}/entities/{legacy['id']}",
        json={"attrs": {"network": "Old free text", "provider": "Example"}},
    )
    changed = client.patch(
        f"/api/cases/{cid}/entities/{legacy['id']}",
        json={"attrs": {"network": "New free text"}},
    )

    assert kept.status_code == 200
    assert changed.status_code == 400


def test_a_type_whose_fields_share_a_subject_says_what_heads_them(client):
    """A place's four fields are all about how tightly the point is pinned, which is
    worth saying once above them. A vessel's registration numbers are just its own
    fields, so they head nothing — and the panel renders them bare."""
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}

    assert rows["place"]["group"] == "How precise"
    assert rows["vessel"]["group"] == ""
    # a heading with no fields under it would render as a lone label
    for row in rows.values():
        assert not row["group"] or row["attrs"], row["type"]


def test_the_types_saved_through_a_tool_route_declare_no_fields():
    """A cross-layer gate. Details saves a `capture` through `/satellite` and a
    `media` through `/media`, and those routes write the sidecar with a title and
    notes only — a declared field on either type would be typed into the panel and
    silently dropped on Save. Declaring one means teaching that branch to patch the
    entity too; this test is what says so out loud instead of losing the value."""
    for type_ in ("capture", "media"):
        entry = entities.entity_type(type_)
        assert entry is not None and not entry.attrs, type_


def test_only_hand_made_types_are_offered_for_creation(client):
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}

    # a media is born from an import and a proof from an export, so neither
    # belongs in a create menu
    assert rows["media"]["manual"] is False
    assert rows["proof"]["manual"] is False
    assert rows["place"]["manual"] is False
    assert rows["structure"]["manual"] is True


def test_every_declared_type_sits_in_a_declared_family():
    assert {entry.family for entry in entities.ENTITY_TYPES} <= set(entities.FAMILIES)
    # and every family earns its place: an empty one is a verb nobody can use
    for family in entities.FAMILIES:
        assert entities.types_in(family), family


def test_every_declared_field_uses_a_known_editor():
    for entry in entities.ENTITY_TYPES:
        for attr in entry.attrs:
            assert attr.kind in entities.ATTR_KINDS, (entry.type, attr.key)


def test_a_field_that_holds_sentences_says_so():
    """A quoted source and the reasoning behind a claim run to paragraphs, and the
    form has no other way to know a field wants more than a line."""
    for type_, key in (("claim", "method"), ("claim", "verbatim"),
                       ("place", "method"), ("place", "verbatim")):
        entry = entities.entity_type(type_)
        attr = next(a for a in entry.attrs if a.key == key)
        assert attr.kind == "longtext", (type_, key)
    # and it is checked exactly as text is: same value, same bound
    entities.check_attrs("claim", {"method": "x" * entities.MAX_TEXT})
    with pytest.raises(CaseError):
        entities.check_attrs("claim", {"method": "x" * (entities.MAX_TEXT + 1)})
    with pytest.raises(CaseError):
        entities.check_attrs("claim", {"verbatim": 12})


def test_no_two_declared_types_share_an_icon():
    """The icon is the whole of what tells two rows apart at a glance. A lorry, a
    freighter and an airframe drawn as one symbol made a mixed list unreadable.

    Every declared type, not just the ones an analyst creates: the board lists a
    case whole, so a tool-born type sits in the same column as a hand-made one. That
    is how a bookmark and a domain both drew a globe.
    """
    icons = [entry.icon for entry in entities.ENTITY_TYPES]

    assert len(icons) == len(set(icons)), sorted(icons)


def test_a_closed_field_declares_the_whole_of_what_it_may_hold():
    """`choice` is the only kind whose validity is a list rather than a shape, so the
    list has to exist and has to be the only thing carrying one. A choice with no
    options renders as an empty dropdown; options on a text field are a scale the
    validator would never apply."""
    for entry in entities.ENTITY_TYPES:
        for attr in entry.attrs:
            if attr.kind == "choice":
                assert attr.options, (entry.type, attr.key)
            else:
                assert not attr.options, (entry.type, attr.key)


def test_every_declared_type_says_what_it_owns_on_disk():
    """The registry-level twin of the full-case drift gate: a type cannot join the
    vocabulary without deciding whether it is file-backed."""
    undeclared = {e.type for e in entities.ENTITY_TYPES if not artifacts.declares(e.type)}

    assert undeclared == set()


def test_a_retired_type_leaves_nothing_behind():
    """`alias` folded into `account` with an optional platform, and `event` was
    replaced by the claim node. Neither was ever created by a tool, so the entries
    that used to describe them are dead wiring."""
    assert "alias" not in artifacts.NO_FILES
    assert "event" not in artifacts.NO_FILES
    assert entities.entity_type("alias") is None
    assert entities.entity_type("event") is None


def test_an_undeclared_free_type_has_no_family():
    """Free-string types stay storable. What they cannot be is the end of a
    relation, since nothing states what they may join."""
    assert entities.family_of("cuneiform-tablet") is None
    assert entities.entity_type("cuneiform-tablet") is None


# -- the verbs declare their exact endpoints ----------------------------------


def test_a_new_type_inherits_only_the_family_wide_relations(
    client, monkeypatch
):
    """Broad verbs follow a family; narrowed verbs still need an explicit type."""
    invented = entities.EntityType("drone", "Drone", entities.ASSET, "grip", manual=True)
    monkeypatch.setattr(entities, "ENTITY_TYPES", entities.ENTITY_TYPES + (invented,))

    cid = _new_case(client, "Inherited verbs")
    case = Case.open(cid)
    person = case.add_entity("person", "Owner", {}, by="user")
    drone = case.add_entity("drone", "Quadcopter", {}, by="user")
    media = case.add_entity("media", "Clip", {"path": "media/clip.mp4"}, by="user")
    place = case.add_entity("place", "Field", {"lat": 1.0, "lon": 2.0}, by="user")

    assert _link(client, cid, person["id"], drone["id"], "owns").status_code == 200
    assert _link(client, cid, drone["id"], media["id"], "appears-in").status_code == 200
    assert _link(client, cid, drone["id"], place["id"], "sited-at").status_code == 400


def test_the_shipped_relations_keep_the_endpoints_they_shipped_with():
    """The material family *is* the old {media, capture} pair. Generalising to
    families must not have widened these three by a single type — a picker offering
    "this proof was recorded at this point" would be a regression, not a feature."""
    by_type = {entry.type: entry for entry in link_engine.RELATION_TYPES}

    assert by_type["located-at"].from_types == frozenset({"media"})
    assert by_type["located-at"].to_types == frozenset({"place"})
    assert by_type["depicts"].from_types == frozenset({"media", "capture"})
    assert by_type["depicts"].to_types == frozenset({"place"})
    assert by_type["same-image-as"].from_types == frozenset({"media"})
    assert by_type["same-image-as"].to_types == frozenset({"media"})


def test_the_new_verbs_keep_the_approved_endpoint_matrix():
    by_type = {entry.type: entry for entry in link_engine.RELATION_TYPES}

    assert by_type["owns"].from_types == entities.types_in(entities.ACTOR)
    assert by_type["owns"].to_types == frozenset({
        "organization", "vehicle", "vessel", "aircraft", "structure",
        "account", "email", "phone", "domain", "ip", "network",
    })
    assert by_type["posted"].from_types == frozenset({"account"})
    assert by_type["posted"].to_types == frozenset({"media", "bookmark"})
    assert by_type["appears-in"].from_types == entities.types_in(
        entities.ACTOR, entities.ASSET, entities.IDENTIFIER
    )
    assert by_type["appears-in"].to_types == frozenset({"media", "capture"})
    assert by_type["sited-at"].from_types == frozenset({"structure"})
    assert by_type["sited-at"].to_types == frozenset({"place"})
    assert by_type["part-of"].from_types == frozenset({"organization"})
    assert by_type["part-of"].to_types == frozenset({"organization"})
    assert by_type["member-of"].from_types == frozenset({"person", "organization"})
    assert by_type["member-of"].to_types == frozenset({"organization"})
    assert by_type["in-network"].from_types == frozenset({"ip", "network"})
    assert by_type["in-network"].to_types == frozenset({"network"})


def test_each_entity_type_declares_every_field_once():
    for entry in entities.ENTITY_TYPES:
        keys = [attr.key for attr in entry.attrs]
        assert len(keys) == len(set(keys)), f"duplicate field on {entry.type}: {keys}"


def test_mentions_are_a_separate_action_from_relations(client):
    rows = {row["type"]: row for row in client.get("/api/cases/relation-types").json()}

    assert rows["mentions"]["action"] == "mention"
    assert rows["mentions"]["group"] == "Mentions"
    assert rows["mentions"]["ratable"] is False
    assert {type_ for type_, row in rows.items() if row["action"] == "claim"} == {
        "about", "at", "cites"
    }
    assert rows["owns"]["ratable"] is True


def test_an_order_of_battle_is_part_of_edges_between_organizations(client):
    """The tree an OSINT conflict case is built on: a battalion inside a brigade
    inside a corps. `owns` would read wrong — a brigade commands its battalions
    rather than owning them — so containment is its own verb."""
    cid = _new_case(client, "Order of battle")
    case = Case.open(cid)
    corps = case.add_entity("organization", "3rd Army Corps", {"echelon": "corps"}, by="user")
    brigade = case.add_entity(
        "organization", "72nd Motor Rifle Brigade", {"echelon": "brigade"}, by="user"
    )
    battalion = case.add_entity(
        "organization", "1st Battalion", {"echelon": "battalion"}, by="user"
    )
    truck = case.add_entity("vehicle", "Ural-4320", {"plate": "AB 1234"}, by="user")
    commander = case.add_entity("person", "Unit commander", {}, by="user")

    assert _link(client, cid, battalion["id"], brigade["id"], "part-of").status_code == 200
    assert _link(client, cid, brigade["id"], corps["id"], "part-of").status_code == 200
    # the unit's kit is owned, never a part of it
    assert _link(client, cid, brigade["id"], truck["id"], "owns").status_code == 200
    assert _link(client, cid, commander["id"], brigade["id"], "member-of").status_code == 200
    assert _link(client, cid, truck["id"], brigade["id"], "part-of").status_code == 400
    assert _link(client, cid, brigade["id"], truck["id"], "part-of").status_code == 400

    # containment never cascades: disbanding a brigade does not delete its corps
    case.remove_entity(brigade["id"])
    assert case.get_entity(corps["id"]) is not None
    assert case.get_entity(battalion["id"]) is not None


def test_a_narrowing_can_only_remove_never_widen():
    """`from_only` intersects its families rather than replacing them, so a
    narrowing cannot smuggle in a type from somewhere else."""
    rogue = link_engine.RelationType(
        "rogue",
        "reaches for",
        from_families=frozenset({entities.PLACE}),
        to_families=frozenset({entities.PLACE}),
        from_only=frozenset({"person"}),
    )

    assert rogue.from_types == frozenset()


# -- what the vocabulary refuses ----------------------------------------------


def test_the_new_verbs_refuse_the_pairs_that_read_backwards(client):
    cid = _new_case(client, "Refused new verbs")
    case = Case.open(cid)
    person = case.add_entity("person", "Owner", {}, by="user")
    vessel = case.add_entity("vessel", "Bulk carrier", {"imo": "9074729"}, by="user")
    account = case.add_entity("account", "@harbourwatch", {}, by="user")
    media = case.add_entity("media", "Clip", {"path": "media/clip.mp4"}, by="user")
    place = case.add_entity("place", "Quay", {"lat": 1.0, "lon": 2.0}, by="user")

    # an asset does not own its owner
    assert _link(client, cid, vessel["id"], person["id"], "owns").status_code == 400
    # a person does not post; the account they own does
    assert _link(client, cid, person["id"], media["id"], "posted").status_code == 400
    # a place is not somewhere a vessel appears
    assert _link(client, cid, vessel["id"], place["id"], "appears-in").status_code == 400
    # an identifier is not sited anywhere
    assert _link(client, cid, account["id"], place["id"], "sited-at").status_code == 400

    assert case.links_of(person["id"]) == []


def test_an_undeclared_type_cannot_be_related(client):
    """Storable, but not relatable: nothing in the vocabulary says what a free type
    may join, so the API refuses rather than guessing."""
    cid = _new_case(client, "Free type")
    case = Case.open(cid)
    tablet = case.add_entity("cuneiform-tablet", "Tablet 4", {}, by="user")
    place = case.add_entity("place", "Dig site", {"lat": 1.0, "lon": 2.0}, by="user")

    assert _link(client, cid, tablet["id"], place["id"], "sited-at").status_code == 400
    assert case.get_entity(tablet["id"]) is not None


def test_an_analyst_can_own_a_vessel_and_place_a_building(client):
    """The vocabulary end to end: the two statements the new types exist for."""
    cid = _new_case(client, "Harbour survey")
    case = Case.open(cid)
    company = case.add_entity("organization", "Northwind Shipping", {}, by="user")
    vessel = case.add_entity("vessel", "MV Aurora", {"imo": "9074729"}, by="user")
    warehouse = case.add_entity("structure", "Quay 4 warehouse", {"kind": "warehouse"}, by="user")
    place = case.add_entity("place", "Quay 4", {"lat": 53.44, "lon": 14.55}, by="user")

    owned = _link(client, cid, company["id"], vessel["id"], "owns")
    sited = _link(client, cid, warehouse["id"], place["id"], "sited-at")

    assert owned.status_code == 200, owned.text
    assert sited.status_code == 200, sited.text
    # stated by hand, so confirmed: there is nothing left to review
    assert owned.json()["provenance"]["status"] == "confirmed"
    assert {link["type"] for link in case.links_of(vessel["id"])} == {"owns"}


def test_the_vocabulary_explains_itself_in_one_clause():
    """The words are terse by design — `capture`, `claim`, `collected` — and a terse
    word nobody can look up is jargon. Every type and every family says what it is,
    and each says it the way the copy rules ask: one clause, no full stop, nothing
    that grows into a paragraph in a tooltip."""
    readings = [entry.hint for entry in entities.ENTITY_TYPES]
    readings += list(entities.FAMILY_READS.values())
    readings += [r.hint for r in link_engine.RELATION_TYPES]
    readings += [hint for _, _, hint in link_engine.CONFIDENCE_LEVELS]
    readings += [a.hint for e in entities.ENTITY_TYPES for a in e.attrs if a.hint]

    assert readings, "nothing declares a reading"
    for hint in readings:
        assert hint, readings
        assert not hint.endswith("."), hint  # a clause, not a sentence
        assert "—" not in hint, hint  # no em-dash appositive
        assert len(hint) <= 100, hint
        assert hint[0].islower(), hint  # it completes a label, it does not open one


def test_every_family_and_verb_is_explained(client):
    """A reading nobody serves is a reading nobody reads, and a family the menu names
    without explaining is the jargon this exists to remove."""
    assert set(entities.FAMILY_READS) == set(entities.FAMILIES)
    for entry in link_engine.RELATION_TYPES:
        assert entry.hint, entry.type

    rows = client.get("/api/cases/entity-types").json()
    assert all(row["hint"] and row["family_reads"] for row in rows)
    verbs = client.get("/api/cases/relation-types").json()
    assert all(row["hint"] for row in verbs)
    levels = client.get("/api/cases/confidence-levels").json()
    assert all(row["hint"] for row in levels)


def test_a_document_mentions_what_it_refers_to(client):
    """The verb that answers "this post is about that spot" without pretending the
    post was made from it. It reaches `place` and `collected` as well as the subject
    families, because a note about a point is the ordinary case and refusing it would
    leave that expressible only as a claim."""
    cid = _new_case(client, "Mentions")
    case = Case.open(cid)
    note = case.add_entity("note", "Field notes", {"path": "notes/field.md"}, by="user")
    post = case.add_entity("post", "Thread", {"draft": ".drafts/t.json"}, by="user")
    place = case.add_entity("place", "North quay", {"lat": 1.0, "lon": 2.0}, by="user")
    photo = case.add_entity("media", "Frame", {"path": "media/f.jpg"}, by="user")
    person = case.add_entity("person", "A driver", {}, by="user")
    claim = case.add_entity("claim", "The driver used the quay", {}, by="user")

    for from_id, to_id in (
        (note["id"], place["id"]),
        (note["id"], person["id"]),
        (note["id"], post["id"]),
        (note["id"], claim["id"]),
        (post["id"], photo["id"]),
    ):
        assert _link(client, cid, from_id, to_id, "mentions").status_code == 200

    # and it runs one way: material is gathered, so it refers to nothing
    assert _link(client, cid, photo["id"], place["id"], "mentions").status_code == 400
    assert _link(client, cid, note["id"], note["id"], "mentions").status_code == 400


def test_a_pointer_is_headed_apart_from_the_findings(client):
    """`mentions` says a document names something; every other verb says something
    about the world. Run together in one list the weaker one borrows the weight of
    the others, so the registry heads it and every surface obeys — the split is
    declared once, not drawn per screen."""
    headed = {entry.type: entry.group for entry in link_engine.RELATION_TYPES if entry.group}
    assert headed == {"mentions": "Mentions"}

    for group in headed.values():
        # a heading, not a clause: it labels a section rather than completing a label
        assert group == group.strip() and group[0].isupper(), group
        assert not group.endswith("."), group
        assert len(group) <= 24, group

    rows = {row["type"]: row for row in client.get("/api/cases/relation-types").json()}
    assert rows["mentions"]["group"] == "Mentions"
    assert rows["located-at"]["group"] == ""


def test_mentioning_is_not_being_made_from(client):
    """The two live side by side on the same pair and answer different questions: the
    chain says the file was built from that, the mention says it merely talks about
    it. Only the chain leaves a scar when the target goes."""
    cid = _new_case(client, "Mention beside chain")
    case = Case.open(cid)
    proof = case.add_entity("proof", "Match", {"spec": "proofs/.meta/m.json"}, by="user")
    capture = case.add_entity("capture", "Overview", {"path": "captures/o.png"}, by="user")
    case.add_link(proof["id"], capture["id"], "derived-from", by="proof-composer")

    assert _link(client, cid, proof["id"], capture["id"], "mentions").status_code == 200

    kinds = {link["type"] for link in case.links_of(proof["id"])}
    assert kinds == {"derived-from", "mentions"}
    # deleting the source scars the proof once, for the derivation and not the mention
    client.delete(f"/api/cases/{cid}/entities/{capture['id']}")
    lost = case.get_entity(proof["id"])["attrs"].get("lost_sources", [])
    assert len(lost) == 1
    assert not case.links_of(proof["id"])
