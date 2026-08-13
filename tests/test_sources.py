"""Where a claim rests, and what its source is worth (ONTOLOGY §2, §3).

One rule carries this file, and it is the reason the Admiralty scheme exists at all:
**reliability and credibility are two axes, and they never combine.** Reliability is
what the source is worth and lives on the source entity; credibility is what one
statement is worth and lives on the Claim entity. Multiplying them into a single number is
precisely what the scheme was written to prevent, so the model makes it impossible
rather than discouraged — the two values are not on the same object, and no route
returns a third.

The rest is the shape of a source: a page, when it was seen, the archived copy that
outlives it, and the fact that a claim never needs one.
"""

import pytest

from azimut import config
from azimut.engine import entities as entity_engine
from azimut.engine import links as link_engine


def _case(client, name):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _entity(client, cid, type_, label, attrs=None):
    res = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": type_, "label": label, "attrs": attrs or {}},
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _patch(client, cid, entity_id, attrs):
    return client.patch(f"/api/cases/{cid}/entities/{entity_id}", json={"attrs": attrs})


def _link(client, cid, from_id, to_id, type_):
    res = client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": from_id, "to_id": to_id, "type": type_},
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _read(client, cid, entity_id):
    return client.get(f"/api/cases/{cid}/entities/{entity_id}/chain").json()


# -- the scale ----------------------------------------------------------------


def test_the_registry_serves_the_grades_so_no_surface_spells_them(client):
    """The picker offers exactly what the validator accepts, which is what the radius
    rungs and the confidence levels are served for. It rides with the entity registry
    rather than on a route of its own: reliability belongs to an entity, so it travels
    with the entity vocabulary."""
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}

    for type_ in ("bookmark", "account"):
        field = next(a for a in rows[type_]["attrs"] if a["key"] == "reliability")
        assert field["kind"] == "choice"
        assert [option["value"] for option in field["options"]] == ["A", "B", "C", "D", "E"]
        assert field["options"][0]["label"] == "Completely reliable"


def test_the_scale_stops_at_e_because_absent_already_says_cannot_be_judged():
    """Admiralty's sixth grade is "reliability cannot be judged", which is what an
    empty field says — and this model never spells one state twice. The same call the
    confidence ordinal makes, where "not assessed" is the lack of a level rather than
    a fifth one."""
    assert [grade for grade, _ in entity_engine.RELIABILITY_GRADES] == list("ABCDE")


def test_only_a_source_is_graded(client):
    """The grade sits on the bookmark or the account cited, and nowhere else. Putting
    it on the whole `document` family would ask an analyst how reliable their own
    proof is; SPEC's open question reopens this the day a source is neither."""
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}
    graded = {
        row["type"] for row in rows.values()
        if any(attr["key"] == "reliability" for attr in row["attrs"])
    }

    assert graded == {"bookmark", "account"}


@pytest.mark.parametrize("grade", ["F", "a", "AA", 1, True, ["A"]])
def test_a_grade_outside_the_scale_is_refused(client, grade):
    """A closed scale is only closed if the store says so: an unknown letter would
    render as itself and read as a level nobody agreed on. `F` is in this list rather
    than in the scale on purpose — Admiralty's "cannot be judged" is what an empty
    field already says."""
    cid = _case(client, f"Grade {grade}")
    bookmark = _entity(client, cid, "bookmark", "Leak site", {"url": "https://example.test/"})

    assert _patch(client, cid, bookmark, {"reliability": grade}).status_code == 400


def test_a_grade_is_cleared_back_to_ungraded(client):
    """Ungraded is the normal state of a source and one to be able to return to. It is
    the absence of a judgement, not a sixth grade, so it is stored as nothing."""
    cid = _case(client, "Ungrade")
    bookmark = _entity(client, cid, "bookmark", "Leak site", {"url": "https://example.test/"})
    assert _patch(client, cid, bookmark, {"reliability": "B"}).status_code == 200

    cleared = _patch(client, cid, bookmark, {"reliability": None})
    blanked = _patch(client, cid, bookmark, {"reliability": ""})

    assert cleared.status_code == 200, cleared.text
    assert blanked.status_code == 200, blanked.text
    assert not blanked.json()["attrs"].get("reliability")


# -- the two axes -------------------------------------------------------------


def test_reliability_and_credibility_are_two_fields_on_two_objects(client):
    """The heart of it. A claim cites a source and rates the statement; the grade of
    the source and the confidence of the Claim arrive on different objects, and neither
    route can be made to write the other."""
    cid = _case(client, "Two axes")
    claim = _entity(
        client, cid, "claim", "The convoy passed on the 3rd", {"confidence": "possible"}
    )
    bookmark = _entity(
        client, cid, "bookmark", "Local paper",
        {"url": "https://example.test/report", "reliability": "B"},
    )
    cites = _link(client, cid, claim, bookmark, "cites")

    chain = _read(client, cid, claim)
    row = next(r for r in chain["relations"] if r["link"]["id"] == cites)

    # what the source is worth: on the entity
    assert row["entity"]["attrs"]["reliability"] == "B"
    # what this one statement is worth: on the Claim
    assert chain["entity"]["attrs"]["confidence"] == "possible"
    assert "confidence" not in row["link"]
    # and nothing anywhere is the two of them folded together
    assert "reliability" not in row["link"]
    assert "confidence" not in row["entity"]["attrs"]


def test_rating_the_citation_leaves_the_source_alone_and_the_reverse(client):
    """A well-graded source can carry a claim nobody believes, and a poor source can
    carry one that checks out. Neither write may drag the other with it."""
    cid = _case(client, "Independent")
    claim = _entity(
        client, cid, "claim", "Filmed from the north bank", {"confidence": "certain"}
    )
    bookmark = _entity(
        client, cid, "bookmark", "Anonymous channel",
        {"url": "https://example.test/post", "reliability": "E"},
    )
    cites = _link(client, cid, claim, bookmark, "cites")

    # an unreliable source, and a statement of theirs that was corroborated anyway
    graded = client.get(f"/api/cases/{cid}/entities/{bookmark}/chain").json()["entity"]
    assert graded["attrs"]["reliability"] == "E"

    # and re-grading the source does not touch what was said about the statement
    _patch(client, cid, bookmark, {"reliability": "A"})
    chain = _read(client, cid, claim)
    row = next(r for r in chain["relations"] if r["link"]["id"] == cites)
    assert chain["entity"]["attrs"]["confidence"] == "certain"
    assert "confidence" not in row["link"]
    assert row["entity"]["attrs"]["reliability"] == "A"


def test_neither_axis_is_declared_where_the_other_lives():
    """A registry-level gate, so the separation cannot be undone by a stray field.
    An entity that declared `confidence` or a relation that carried `reliability`
    would be the first half of the merged score the scheme exists to prevent."""
    holders = {
        entry.type for entry in entity_engine.ENTITY_TYPES
        if any(attr.key == "confidence" for attr in entry.attrs)
    }
    assert holders == {"claim"}
    for relation in link_engine.RELATION_TYPES:
        assert not hasattr(relation, "reliability"), relation.type


def test_a_link_patch_cannot_carry_a_grade(client):
    """The edge accepts one closed ordinal and nothing else (ONTOLOGY §3). A body
    reaching for the source's axis changes nothing rather than quietly landing."""
    cid = _case(client, "Edge fields")
    claim = _entity(client, cid, "claim", "Shot at dawn")
    bookmark = _entity(client, cid, "bookmark", "Thread", {"url": "https://example.test/t"})
    cites = _link(client, cid, claim, bookmark, "cites")

    res = client.patch(f"/api/cases/{cid}/links/{cites}", json={"reliability": "A"})

    assert res.status_code == 400  # nothing to update: the field is not the edge's
    row = next(r for r in _read(client, cid, claim)["relations"] if r["link"]["id"] == cites)
    assert "reliability" not in row["link"]


# -- a source is never required -----------------------------------------------


def test_a_claim_with_no_source_stays_valid_and_ratable(client):
    """Nothing in this model is compulsory. A statement with no citation is a normal
    statement — an unsourced reading of an image is most of a live case — and it is
    rated like any other. Requiring a source would make the field a gate rather than
    a record."""
    cid = _case(client, "Unsourced")
    claim = _entity(
        client, cid, "claim", "This is the same bridge", {"confidence": "probable"}
    )
    place = _entity(client, cid, "place", "48.85, 2.29", {"lat": 48.85, "lon": 2.29})
    _link(client, cid, claim, place, "at")
    chain = _read(client, cid, claim)
    assert [row["link"]["type"] for row in chain["relations"]] == ["at"]
    assert chain["entity"]["attrs"]["confidence"] == "probable"


def test_an_ungraded_source_is_a_source(client):
    """Most bookmarks are never graded, and that has to cost nothing: the citation
    holds, the rating holds, and nothing on the read path reports the absence."""
    cid = _case(client, "Ungraded source")
    claim = _entity(client, cid, "claim", "Posted the same day", {"confidence": "probable"})
    bookmark = _entity(client, cid, "bookmark", "Mirror", {"url": "https://example.test/m"})
    cites = _link(client, cid, claim, bookmark, "cites")

    chain = _read(client, cid, claim)
    row = next(r for r in chain["relations"] if r["link"]["id"] == cites)

    assert "reliability" not in row["entity"]["attrs"]
    assert "confidence" not in row["link"]
    assert chain["entity"]["attrs"]["confidence"] == "probable"


# -- the page, and the copy that outlives it ----------------------------------


def test_the_extension_stamps_when_the_page_was_seen(client):
    """`fetched_at` is written by the route that was standing on the page, in UTC and
    from the server's clock: the moment is known rather than typed, and a browser
    clock is not a source. It is what an archived copy is later dated against."""
    cid = _case(client, "Fetched")
    token = config.ingest_token()
    res = client.post(
        "/api/ingest/bookmark",
        data={"url": "https://example.test/page", "case_id": cid, "title": "Leak"},
        headers={"X-Azimut-Token": token},
    )
    assert res.status_code == 200, res.text

    entity = client.get(f"/api/cases/{cid}/entities/{res.json()['entity_id']}/chain").json()
    fetched = entity["entity"]["attrs"]["fetched_at"]
    assert fetched.startswith("20") and fetched.endswith("+00:00")


def test_a_bookmark_typed_by_hand_was_never_fetched(client):
    """Nothing went and looked at the page, so there is no moment to record — and an
    empty field is never flagged. Absence is a state, not a gap."""
    cid = _case(client, "Hand-typed")
    bookmark = _entity(client, cid, "bookmark", "To read", {"url": "https://example.test/x"})

    entity = client.get(f"/api/cases/{cid}/entities/{bookmark}/chain").json()["entity"]

    assert "fetched_at" not in entity["attrs"]


def test_an_archived_copy_is_a_url_or_it_is_refused(client):
    """The field is rendered as a link, so the scheme is checked at the edge rather
    than trusted — the same reason the account's profile URL is."""
    cid = _case(client, "Archive")
    bookmark = _entity(client, cid, "bookmark", "Deleted post", {"url": "https://example.test/p"})

    assert _patch(
        client, cid, bookmark,
        {"archive_url": "https://web.archive.test/web/2026/https://example.test/p"},
    ).status_code == 200
    assert _patch(client, cid, bookmark, {"archive_url": "javascript:alert(1)"}).status_code == 400
    assert _patch(client, cid, bookmark, {"archive_url": None}).status_code == 200
