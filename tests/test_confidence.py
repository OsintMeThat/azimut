"""Confidence on statements and ordinary semantic relations (ONTOLOGY §3).

A Claim carries one confidence for the whole statement. Its ``about``, ``at`` and
``cites`` edges only connect that statement to subjects, places and evidence. An
ordinary relation may still carry the older integer scale because it is itself the
statement being assessed. Mentions, machine matches and lineage carry no rating.
"""

import pytest

from azimut.engine import entities as entity_engine
from azimut.engine import links as link_engine
from azimut.workspace import Case, CaseError


def _case(client, name):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _entity(client, cid, type_, label, attrs=None):
    res = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": type_, "label": label, "attrs": attrs or {}},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _link(client, cid, from_id, to_id, type_):
    res = client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": from_id, "to_id": to_id, "type": type_},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _rate(client, cid, link_id, value):
    return client.patch(f"/api/cases/{cid}/links/{link_id}", json={"confidence": value})


def _ordinary_relation(client, cid):
    media = _entity(client, cid, "media", "Frame", {"path": "media/frame.jpg"})
    place = _entity(client, cid, "place", "Quay", {"lat": 53.44, "lon": 14.55})
    return _link(client, cid, media["id"], place["id"], "located-at")


# -- Claim confidence ---------------------------------------------------------


def test_claim_confidence_is_a_closed_entity_field(client):
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}
    fields = {field["key"]: field for field in rows["claim"]["attrs"]}

    assert set(fields) == {
        "count", "condition", "when", "time_role", "confidence", "method", "verbatim",
    }
    assert fields["confidence"]["kind"] == "choice"
    assert [option["value"] for option in fields["confidence"]["options"]] == [
        "certain", "probable", "possible", "refuted",
    ]
    assert "exclusive" not in fields
    assert [value for value, _ in entity_engine.CLAIM_CONFIDENCE] == [
        "certain", "probable", "possible", "refuted",
    ]


@pytest.mark.parametrize("value", ["certain", "probable", "possible", "refuted"])
def test_every_claim_confidence_round_trips(client, value):
    cid = _case(client, f"Claim {value}")
    claim = _entity(client, cid, "claim", "A statement", {"confidence": value})

    assert claim["attrs"]["confidence"] == value
    assert Case.open(cid).get_entity(claim["id"])["attrs"]["confidence"] == value


@pytest.mark.parametrize("value", ["unknown", 3, -1, True, ["possible"]])
def test_a_claim_confidence_outside_the_scale_is_refused(client, value):
    cid = _case(client, "Invalid claim confidence")
    res = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "claim", "label": "A statement", "attrs": {"confidence": value}},
    )

    assert res.status_code == 400


def test_one_claim_confidence_applies_to_all_its_connectors(client):
    cid = _case(client, "Claim connectors")
    claim = _entity(
        client,
        cid,
        "claim",
        "The vessel reached the harbour",
        {"confidence": "probable", "method": "two independent observations"},
    )
    vessel = _entity(client, cid, "vessel", "Cargo vessel")
    place = _entity(client, cid, "place", "Harbour", {"lat": 1.0, "lon": 2.0})
    bookmark = _entity(client, cid, "bookmark", "Port notice")
    connectors = [
        _link(client, cid, claim["id"], vessel["id"], "about"),
        _link(client, cid, claim["id"], place["id"], "at"),
        _link(client, cid, claim["id"], bookmark["id"], "cites"),
    ]

    assert all("confidence" not in connector for connector in connectors)
    stored = Case.open(cid).get_entity(claim["id"])
    assert stored["attrs"]["confidence"] == "probable"


def test_no_claim_connector_can_be_rated(client):
    """All four, and clearing is refused as flatly as setting.

    This is what lets the Claim editor render a connector as a name and a Remove and
    nothing else: there is no route that puts a rating on one, so there is no legacy
    value for a surface to display or an analyst to be stuck with.
    """
    cid = _case(client, "Connector confidence")
    claim = _entity(client, cid, "claim", "A statement")
    rival = _entity(client, cid, "claim", "The other reading")
    vessel = _entity(client, cid, "vessel", "Cargo vessel")
    place = _entity(client, cid, "place", "Candidate", {"lat": 1.0, "lon": 2.0})
    bookmark = _entity(client, cid, "bookmark", "Port notice")
    connectors = [
        _link(client, cid, claim["id"], vessel["id"], "about"),
        _link(client, cid, claim["id"], place["id"], "at"),
        _link(client, cid, claim["id"], bookmark["id"], "cites"),
        # How strongly each side is held is already on each Claim; a grade on the
        # edge between two of them would be the mixture the three homes prevent.
        _link(client, cid, claim["id"], rival["id"], "contradicts"),
    ]

    for connector in connectors:
        assert _rate(client, cid, connector["id"], 2).status_code == 400
        assert _rate(client, cid, connector["id"], None).status_code == 400
        assert "confidence" not in Case.open(cid).get_link(connector["id"])


def test_claim_confidence_can_be_cleared(client):
    cid = _case(client, "Clear claim confidence")
    claim = _entity(client, cid, "claim", "A statement", {"confidence": "certain"})

    cleared = client.patch(
        f"/api/cases/{cid}/entities/{claim['id']}", json={"attrs": {"confidence": None}}
    )

    assert cleared.status_code == 200, cleared.text
    assert not cleared.json()["attrs"].get("confidence")


def test_legacy_exclusive_data_stays_readable_but_is_not_declared(client):
    cid = _case(client, "Legacy exclusive")
    case = Case.open(cid)
    claim = case.add_entity(
        "claim", "Which bridge?", {"exclusive": True, "method": "span count"}, by="user"
    )

    updated = client.patch(
        f"/api/cases/{cid}/entities/{claim['id']}", json={"attrs": {"method": "pier count"}}
    )

    assert updated.status_code == 200
    assert updated.json()["attrs"]["exclusive"] is True
    fields = next(
        row["attrs"] for row in client.get("/api/cases/entity-types").json()
        if row["type"] == "claim"
    )
    assert "exclusive" not in {field["key"] for field in fields}


def test_eliminated_candidates_are_separate_claims(client):
    cid = _case(client, "Candidate bridges")
    values = []
    for index in range(3):
        confidence = "probable" if index == 0 else "refuted"
        claim = _entity(
            client,
            cid,
            "claim",
            f"Bridge {index} is the location",
            {"confidence": confidence},
        )
        place = _entity(
            client,
            cid,
            "place",
            f"Bridge {index}",
            {"lat": 53.4 + index / 100, "lon": 14.5},
        )
        _link(client, cid, claim["id"], place["id"], "at")
        values.append(Case.open(cid).get_entity(claim["id"])["attrs"]["confidence"])

    assert values == ["probable", "refuted", "refuted"]


# -- ordinary relation confidence --------------------------------------------


def test_a_new_ordinary_relation_is_not_assessed(client):
    cid = _case(client, "Unrated relation")
    edge = _ordinary_relation(client, cid)

    assert "confidence" not in edge


@pytest.mark.parametrize("value", [3, 2, 1, -1])
def test_every_edge_confidence_round_trips(client, value):
    cid = _case(client, f"Edge confidence {value}")
    edge = _ordinary_relation(client, cid)

    assert _rate(client, cid, edge["id"], value).json()["confidence"] == value
    assert Case.open(cid).get_link(edge["id"])["confidence"] == value


def test_an_edge_rating_can_be_cleared(client):
    cid = _case(client, "Clear edge confidence")
    edge = _ordinary_relation(client, cid)
    _rate(client, cid, edge["id"], 3)

    cleared = _rate(client, cid, edge["id"], None)

    assert cleared.status_code == 200
    assert "confidence" not in cleared.json()


@pytest.mark.parametrize("value", [0, 4, -2, 100, 2.5, True])
def test_an_edge_confidence_outside_the_scale_is_refused(client, value):
    cid = _case(client, "Invalid edge confidence")
    edge = _ordinary_relation(client, cid)

    assert _rate(client, cid, edge["id"], value).status_code in (400, 422)
    assert "confidence" not in Case.open(cid).get_link(edge["id"])


def test_the_registry_marks_only_semantic_relations_ratable(client):
    rows = {row["type"]: row for row in client.get("/api/cases/relation-types").json()}

    assert rows["located-at"]["ratable"] is True
    for type_ in ("mentions", "about", "at", "cites", "same-image-as"):
        assert rows[type_]["ratable"] is False
    assert "derived-from" not in rows


def test_the_edge_levels_are_still_served_for_semantic_relations(client):
    levels = client.get("/api/cases/confidence-levels").json()

    assert [level["value"] for level in levels] == [3, 2, 1, -1]
    assert [level["label"] for level in levels] == [
        "Certain", "Probable", "Possible", "Ruled out",
    ]


def test_lineage_mentions_and_machine_matches_carry_no_rating(client):
    cid = _case(client, "Non-ratable connections")
    case = Case.open(cid)
    first = case.add_entity("media", "First", {"path": "media/first.jpg"}, by="user")
    second = case.add_entity("media", "Second", {"path": "media/second.jpg"}, by="user")
    place = case.add_entity("place", "Place", {"lat": 1.0, "lon": 2.0}, by="user")
    note = case.add_entity("note", "Note", {}, by="user")
    edges = [
        case.add_link(first["id"], second["id"], "derived-from", by="inspect"),
        _link(client, cid, note["id"], place["id"], "mentions"),
        case.add_link(first["id"], second["id"], "same-image-as", by="enrich"),
    ]

    for edge in edges:
        assert _rate(client, cid, edge["id"], 2).status_code == 400
        assert "confidence" not in Case.open(cid).get_link(edge["id"])


def test_a_suggestion_is_confirmed_before_it_is_rated(client):
    cid = _case(client, "Suggested relation")
    case = Case.open(cid)
    media = case.add_entity("media", "Frame", {"path": "media/frame.jpg"}, by="user")
    place = case.add_entity("place", "Place", {"lat": 1.0, "lon": 2.0}, by="user")
    edge = case.add_link(
        media["id"], place["id"], "located-at", by="enrich", status="suggested"
    )

    assert _rate(client, cid, edge["id"], 2).status_code == 400
    both = client.patch(
        f"/api/cases/{cid}/links/{edge['id']}",
        json={"status": "confirmed", "confidence": 2},
    )
    assert both.status_code == 200
    assert both.json()["confidence"] == 2


def test_rating_a_missing_link_is_a_404(client):
    cid = _case(client, "Missing link")
    assert _rate(client, cid, "l_missing", 2).status_code == 404


def test_the_engine_refuses_a_value_outside_the_edge_scale(client):
    cid = _case(client, "Engine validation")
    edge = _ordinary_relation(client, cid)

    with pytest.raises(CaseError, match="must be one of"):
        link_engine.set_confidence(Case.open(cid), edge["id"], 7)
