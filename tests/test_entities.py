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
        "condition",
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


def test_a_field_that_opens_a_subject_says_what_heads_it(client):
    """A place's four fields are all about how tightly the point is pinned, which is
    worth saying once above them. A vessel's registration numbers are just its own
    fields, so they head nothing — and the panel renders them bare.

    The heading is on the field rather than on the type because one type can hold two
    subjects: a Claim says *what* it states, *when* it applies and *why* that is
    believed, and running them all under one word would file a count as reasoning."""
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}

    heads = {attr["key"]: attr["group"] for attr in rows["place"]["attrs"]}
    assert heads == {"radius_m": "How precise", "footprint": "", "verbatim": "", "method": ""}
    assert {attr["group"] for attr in rows["vessel"]["attrs"]} == {""}
    assert [attr["group"] for attr in rows["claim"]["attrs"]] == [
        "What it states", "", "When", "", "Reasoning", "", "",
    ]


def test_a_heading_opens_its_block_once():
    """A field with no group of its own continues whatever heading is open, which is
    how a place states "How precise" once over four fields. What that costs is order:
    reopening an earlier heading further down the list would draw it twice, so each
    one may be opened once."""
    for entry in entities.ENTITY_TYPES:
        opened = [attr.group for attr in entry.attrs if attr.group]
        assert len(opened) == len(set(opened)), (entry.type, opened)


def test_a_heading_reads_as_a_heading_not_as_a_clause():
    """Same rule the relation groups follow: it labels a block rather than
    completing a label, so it opens upper-case and does not run to a sentence."""
    headings = {attr.group for e in entities.ENTITY_TYPES for attr in e.attrs if attr.group}

    assert headings
    for group in headings:
        assert group == group.strip() and group[0].isupper(), group
        assert not group.endswith("."), group
        assert len(group) <= 24, group


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


def test_every_declared_type_says_what_it_is_for_when_the_case_is_drawn():
    """The role is the axis a graph lens narrows nodes on, and it has no default: a
    type that did not decide would answer "is a picture of the case about this?" by
    omission. Every role earns its place too — an empty one is a treatment nothing
    receives."""
    assert {entry.role for entry in entities.ENTITY_TYPES} == set(entities.ROLES)
    for role in entities.ROLES:
        assert entities.types_with_role(role), role


def test_the_role_is_not_the_manual_flag_under_another_name():
    """The two axes are independent, which is why an existing field could not be
    reused: `media` and `place` are tool-born subjects, `post` is tool-born and a
    deliverable, `claim` is hand-made and a subject."""
    roles = {entry.type: (entry.role, entry.manual) for entry in entities.ENTITY_TYPES}

    assert roles["media"] == (entities.SUBJECT, False)
    assert roles["place"] == (entities.SUBJECT, False)
    assert roles["post"] == (entities.DELIVERABLE, False)
    assert roles["claim"] == (entities.SUBJECT, True)


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
    invented = entities.EntityType(
        "drone", "Drone", entities.ASSET, "grip", entities.SUBJECT, manual=True
    )
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
    """The material family *is* the old {media, capture} pair, and generalising to
    families must never have widened these three by itself.

    `depicts` gained `proof` since, and that one is a decision rather than a side
    effect: a proof is a rendered image, so what it shows is a property of its
    pixels, and it is where a geolocation is concluded (ONTOLOGY §3). The line the
    guard still holds is the one below it — **`located-at` stays material-only**,
    because a proof was composed, never recorded anywhere.
    """
    by_type = {entry.type: entry for entry in link_engine.RELATION_TYPES}

    assert by_type["located-at"].from_types == frozenset({"media"})
    assert by_type["located-at"].to_types == frozenset({"place"})
    assert by_type["depicts"].from_types == frozenset({"media", "capture", "proof"})
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
    assert by_type["instance-of"].from_types == entities.types_in(entities.ASSET)
    assert by_type["instance-of"].to_types == frozenset({"equipment-type"})
    assert "equipment-type" in by_type["about"].to_types


# -- which verbs a pair of types has at all ------------------------------------


def test_a_pair_offers_only_the_verbs_the_registry_allows():
    """`pair_verbs` is the type-only endpoint check, asked before either entity exists.

    Two ordered pairs, two different answers: a media may be *at* a place or *show*
    one, and a person may only be a member of an organization, own it, or be tied to
    it. `part-of` is absent on purpose — it runs organization to organization, so a
    person is never *part of* one.
    """
    assert [s.type for s in link_engine.pair_verbs("media", "place")] == [
        "located-at", "depicts",
    ]
    assert [s.type for s in link_engine.pair_verbs("person", "organization")] == [
        "owns", "member-of", "associated-with",
    ]
    assert [s.type for s in link_engine.pair_verbs("organization", "organization")] == [
        "owns", "part-of", "member-of", "associated-with",
    ]
    assert [s.type for s in link_engine.pair_verbs("structure", "place")] == ["sited-at"]


def test_a_person_and_a_point_have_no_verb_between_them():
    """The witness case for a promotion that maps coordinates onto a column of people:
    the vocabulary joins them by nothing, so the pair is never offered and a latitude
    never lands on a person as a field nothing shows or edits."""
    assert link_engine.pair_verbs("person", "place") == ()
    assert link_engine.pair_verbs("place", "media") == ()


def test_a_pair_never_offers_what_only_a_machine_may_state():
    """`same-image-as` is enrichment's own claim and the derivation chain is recorded
    by the save that produced it, so neither is a verb a batch of edges may pick."""
    assert link_engine.pair_verbs("media", "media") == ()
    offered = {
        spec.type
        for a in ("media", "person", "organization", "note", "proof")
        for b in ("media", "person", "organization", "place")
        for spec in link_engine.pair_verbs(a, b)
    }
    assert offered.isdisjoint({"same-image-as", *link_engine.CHAIN_TYPES})


def test_a_pair_can_be_asked_for_one_kind_of_gesture():
    """A document naming a place is a pointer, not a finding, and the two never share a
    select — so the caller asks for the action it is drawing."""
    assert [s.type for s in link_engine.pair_verbs("note", "place")] == ["mentions"]
    assert link_engine.pair_verbs("note", "place", action="relation") == ()
    assert [
        s.type for s in link_engine.pair_verbs("note", "place", action="mention")
    ] == ["mentions"]


# -- what state a thing is in, and how many of it ------------------------------


def test_every_asset_says_what_state_it_is_in(client):
    """A bridge, a ship, an airframe and a lorry can all be damaged, so the field is
    the family's rather than the two types it was first wanted for. One list, because
    a count that groups by condition has to reach both the asset and the claim."""
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}

    for type_ in entities.types_in(entities.ASSET):
        field = next(a for a in rows[type_]["attrs"] if a["key"] == "condition")
        assert field["kind"] == "choice"
        assert [o["value"] for o in field["options"]] == [
            "intact", "damaged", "destroyed", "abandoned",
        ]

    claim_condition = next(a for a in rows["claim"]["attrs"] if a["key"] == "condition")
    assert claim_condition["options"] == field["options"]


def test_changing_hands_is_not_a_condition():
    """"Captured" is a change of owner, which `owns` already states. Folded into the
    scale it would mix condition with possession, and a mixture does not aggregate."""
    stored = {value for value, _ in entities.ASSET_CONDITIONS}

    assert "captured" not in stored
    assert "seized" not in stored


def test_a_condition_outside_the_scale_is_refused(client):
    cid = _new_case(client, "Condition scale")
    good = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "structure", "label": "Rail bridge", "attrs": {"condition": "destroyed"}},
    )
    invented = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "structure", "label": "Road bridge", "attrs": {"condition": "scratched"}},
    )
    # absent is unknown, and an analyst is entitled to go back to it
    cleared = client.patch(
        f"/api/cases/{cid}/entities/{good.json()['id']}",
        json={"attrs": {"condition": None}},
    )

    assert good.status_code == 200, good.text
    assert invented.status_code == 400
    assert cleared.status_code == 200
    assert cleared.json()["attrs"].get("condition") in (None, "")


def test_a_count_is_a_whole_number_of_at_least_one(client):
    """Zero is not a count for the same reason zero is not a radius: absent already
    says "seen, not counted", and half a destroyed tank is not a quantity anyone can
    defend."""
    cid = _new_case(client, "Counting")

    def claim(attrs):
        return client.post(
            f"/api/cases/{cid}/entities",
            json={"type": "claim", "label": "Two of these", "attrs": attrs},
        )

    assert claim({"count": 2}).status_code == 200
    assert claim({"count": 2.0}).status_code == 200  # JSON has one number type
    assert claim({"count": 0}).status_code == 400
    assert claim({"count": -3}).status_code == 400
    assert claim({"count": 2.5}).status_code == 400
    assert claim({"count": True}).status_code == 400
    assert claim({"count": entities.MAX_COUNT + 1}).status_code == 400
    # absent is "seen, not counted", which is a different answer from one
    assert claim({}).status_code == 200


def test_a_count_says_it_steps_by_one(client):
    """Served so the spinner and the validator cannot disagree about what a valid
    quantity is."""
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}
    count = next(a for a in rows["claim"]["attrs"] if a["key"] == "count")
    radius = next(a for a in rows["place"]["attrs"] if a["key"] == "radius_m")

    assert count["whole"] is True
    assert count["minimum"] == 1
    assert radius["whole"] is False  # a metre is not the smallest honest step


def test_a_claim_declares_when_its_statement_applies(client):
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}
    fields = {field["key"]: field for field in rows["claim"]["attrs"]}

    assert fields["when"]["kind"] == "temporal"
    assert fields["when"]["group"] == "When"
    assert fields["time_role"]["kind"] == "choice"
    assert [option["value"] for option in fields["time_role"]["options"]] == [
        "occurred", "observed", "valid",
    ]


def test_a_claim_keeps_only_supported_temporal_values(client):
    cid = _new_case(client, "Temporal statement")

    created = client.post(
        f"/api/cases/{cid}/entities",
        json={
            "type": "claim",
            "label": "The address appeared in the access log",
            "attrs": {
                "when": "2026-08-11T18:40:00+02:00",
                "time_role": "observed",
            },
        },
    )
    assert created.status_code == 200, created.text
    assert created.json()["attrs"]["when"] == "2026-08-11T18:40:00+02:00"

    interval = client.patch(
        f"/api/cases/{cid}/entities/{created.json()['id']}",
        json={"attrs": {"when": "2026-08~/2026-10?", "time_role": "valid"}},
    )
    bad_date = client.patch(
        f"/api/cases/{cid}/entities/{created.json()['id']}",
        json={"attrs": {"when": "2026-02-29"}},
    )
    bad_role = client.patch(
        f"/api/cases/{cid}/entities/{created.json()['id']}",
        json={"attrs": {"time_role": "published"}},
    )

    assert interval.status_code == 200, interval.text
    assert interval.json()["attrs"]["when"] == "2026-08~/2026-10?"
    assert bad_date.status_code == 400
    assert bad_role.status_code == 400


def test_a_claim_may_keep_a_local_time_or_no_time_at_all(client):
    cid = _new_case(client, "Local time statement")

    local = client.post(
        f"/api/cases/{cid}/entities",
        json={
            "type": "claim",
            "label": "The camera clock showed this time",
            "attrs": {"when": "2026-08-11T18:40:00"},
        },
    )
    undated = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "claim", "label": "The date is not known", "attrs": {}},
    )
    cleared = client.patch(
        f"/api/cases/{cid}/entities/{local.json()['id']}",
        json={"attrs": {"when": None}},
    )

    assert local.status_code == 200, local.text
    assert undated.status_code == 200, undated.text
    assert cleared.status_code == 200, cleared.text


# -- the class family ----------------------------------------------------------


def test_a_model_is_its_own_family_and_not_an_asset(client):
    """Nobody owns "T-72B3" and it sits nowhere, so the three verbs an asset takes
    are all wrong for it. Held in `asset` the picker would offer them."""
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}
    by_type = {entry.type: entry for entry in link_engine.RELATION_TYPES}

    assert rows["equipment-type"]["family"] == "class"
    assert entities.types_in(entities.CLASS) == frozenset({"equipment-type"})
    for verb in ("owns", "appears-in", "sited-at"):
        assert "equipment-type" not in by_type[verb].to_types, verb
        assert "equipment-type" not in by_type[verb].from_types, verb


def test_a_named_object_states_which_model_it_is(client):
    cid = _new_case(client, "Order of battle kit")
    case = Case.open(cid)
    tank = case.add_entity("vehicle", "Turret 214", {"plate": "214"}, by="user")
    model = case.add_entity("equipment-type", "T-72B3", {"category": "tank"}, by="user")
    crew = case.add_entity("person", "Crew commander", {}, by="user")

    stated = _link(client, cid, tank["id"], model["id"], "instance-of")

    assert stated.status_code == 200, stated.text
    # and it runs one way: a model is not an instance of the object
    assert _link(client, cid, model["id"], tank["id"], "instance-of").status_code == 400
    # a person is not a member of a class either
    assert _link(client, cid, crew["id"], model["id"], "instance-of").status_code == 400
    # "probably a T-72B3" is a reading of the footage, so the edge takes a rating
    assert link_engine.relation_type("instance-of").ratable is True


def test_a_statement_counts_a_model_rather_than_minting_anonymous_objects(client):
    """The whole point of the class family: "two of these were destroyed here" with
    no second vehicle entity that names nobody."""
    cid = _new_case(client, "Counted losses")
    case = Case.open(cid)
    model = case.add_entity("equipment-type", "ZU-23-2", {"category": "air defence"}, by="user")
    place = case.add_entity("place", "Crossroads", {"lat": 48.1, "lon": 37.6}, by="user")
    video = case.add_entity("media", "Drone clip", {"path": "media/clip.mp4"}, by="user")
    claim = case.add_entity(
        "claim", "Two ZU-23-2 destroyed at the crossroads",
        {"count": 2, "condition": "destroyed", "confidence": "probable"}, by="user",
    )

    for to_id, verb in ((model["id"], "about"), (place["id"], "at"), (video["id"], "cites")):
        stated = _link(client, cid, claim["id"], to_id, verb)
        assert stated.status_code == 200, f"{verb}: {stated.text}"

    assert {link["type"] for link in case.links_of(claim["id"])} == {"about", "at", "cites"}
    assert case.get_entity(claim["id"])["attrs"]["count"] == 2
    # the count sits on the node, never on the connector it points through
    assert all(link.get("confidence") is None for link in case.links_of(claim["id"]))


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
        "about", "at", "cites", "contradicts"
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


# -- when the case already holds the value ------------------------------------


@pytest.mark.parametrize(
    "type_, one, other",
    [
        ("account", "@Handle", "handle"),
        ("email", "Name@Example.org", "name@example.org"),
        ("phone", "+33 6 12 34 56 78", "+33-612.345678"),
        ("domain", "Example.org.", "example.org"),
        ("ip", "203.0.113.42", "203.0.113.42 "),
        ("network", "203.0.113.0/24", "203.0.113.0/24"),
    ],
)
def test_one_identifier_written_two_ways_is_one_identity(type_, one, other):
    key = entities.identity_key(type_, one)
    assert key and key == entities.identity_key(type_, other)


@pytest.mark.parametrize(
    "type_, one, other",
    [
        # Supplying a country code is a guess about what the analyst meant.
        ("phone", "+33612345678", "0612345678"),
        # A subdomain is its own hostname, not a spelling of the parent.
        ("domain", "www.example.org", "example.org"),
        ("email", "a@example.org", "b@example.org"),
    ],
)
def test_two_values_that_only_look_alike_stay_two_identities(type_, one, other):
    assert entities.identity_key(type_, one) != entities.identity_key(type_, other)


def test_only_an_identifier_has_an_identity_a_label_can_duplicate():
    """Two people really can share a name, and two claims really can be worded alike.

    The `identifier` family is the one place the label *is* the identity (ONTOLOGY
    §2), so it is the only one that answers here — a guard over the rest would refuse
    entities that are genuinely different.
    """
    for entry in entities.ENTITY_TYPES:
        answered = bool(entities.identity_key(entry.type, "Some value"))
        assert answered == (entry.family == entities.IDENTIFIER), entry.type
    assert entities.identity_key("email", "   ") == ""
    assert entities.identity_key("not-a-type", "anything") == ""


def test_the_case_says_which_row_already_holds_an_identifier(client):
    """It reports and never refuses: merging is not shipped, so a create that failed
    would leave the analyst holding a value with nowhere to put it."""
    cid = _new_case(client, "Twin identifiers")
    case = Case.open(cid)
    first = case.add_entity("account", "@osint_handle", {}, by="user")
    person = case.add_entity("person", "A Name", {}, by="user")

    def twin(type_, label, ignore=""):
        return client.get(
            f"/api/cases/{cid}/entities/twin",
            params={"type": type_, "label": label, "ignore": ignore},
        ).json()["entity"]

    # the sigil is how the same handle gets filed twice a week apart
    assert twin("account", "osint_handle")["id"] == first["id"]
    assert twin("account", "  @OSINT_Handle ")["id"] == first["id"]
    assert twin("account", "someone_else") is None
    # an entity is never its own twin, which is what makes this usable on a rename
    assert twin("account", "@osint_handle", ignore=first["id"]) is None
    # two people may share a name, so the question is not asked of them
    assert twin("person", "A Name") is None
    assert person["id"]

    # and the value really can still be filed: this warns, it does not block
    again = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "account", "label": "osint_handle", "attrs": {}},
    )
    assert again.status_code == 200
