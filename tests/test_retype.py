"""Changing what a subject is: refused whenever something would be lost."""

from __future__ import annotations

import io

import pytest
from PIL import Image

from azimut.workspace import Case


def _case(client) -> str:
    return client.post("/api/cases", json={"name": "Retype"}).json()["id"]


def _entity(client, case_id, type_, label, attrs=None):
    response = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": type_, "label": label, "attrs": attrs or {}},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _retype(client, case_id, entity_id, type_):
    return client.patch(f"/api/cases/{case_id}/entities/{entity_id}", json={"type": type_})


@pytest.mark.parametrize(
    ("type_", "label", "attrs", "into", "reason"),
    [
        ("place", "Crossroads", {"lat": 1, "lon": 2}, "person", "a place keeps its type"),
        ("person", "Subject A", {}, "place", "nothing can become a place"),
        ("person", "Subject A", {}, "claim", "nothing can become a claim"),
        ("claim", "Seen", {}, "person", "a claim keeps its type"),
        ("person", "Subject A", {}, "media", "nothing can become a media"),
        ("bookmark", "Page", {"url": "https://x.test"}, "person", "a bookmark keeps its type"),
        ("person", "Subject A", {}, "unheard-of", "'unheard-of' is not a type this case knows"),
    ],
)
def test_a_type_outside_the_named_subjects_never_changes(client, type_, label, attrs, into, reason):
    case_id = _case(client)
    entity = _entity(client, case_id, type_, label, attrs)

    refused = _retype(client, case_id, entity["id"], into)

    assert refused.status_code == 409, refused.text
    assert reason in refused.json()["detail"]
    assert Case.open(case_id).get_entity(entity["id"])["type"] == type_


def test_a_relation_the_new_type_cannot_hold_is_named_and_kept(client):
    case_id = _case(client)
    unit = _entity(client, case_id, "organization", "4th brigade")
    subject_a = _entity(client, case_id, "person", "Subject A")
    joined = client.post(
        f"/api/cases/{case_id}/links",
        json={"from_id": subject_a["id"], "to_id": unit["id"], "type": "member-of"},
    )
    assert joined.status_code == 200, joined.text

    refused = _retype(client, case_id, unit["id"], "person")

    assert refused.status_code == 409
    assert refused.json()["detail"] == ["“Subject A” is a member of it"]
    case = Case.open(case_id)
    assert case.get_entity(unit["id"])["type"] == "organization"
    assert [link["type"] for link in case.links_of(unit["id"])] == ["member-of"]


def test_photos_hold_back_a_type_with_no_gallery(client):
    case_id = _case(client)
    person = _entity(client, case_id, "person", "Subject A")
    picture = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(picture, format="PNG")
    added = client.post(
        f"/api/cases/{case_id}/entities/{person['id']}/images/upload",
        files={"file": ("face.png", picture.getvalue(), "image/png")},
    )
    assert added.status_code == 200, added.text

    refused = _retype(client, case_id, person["id"], "account")

    assert refused.status_code == 409
    assert refused.json()["detail"] == ["an account has no photos, and this one has 1"]


def test_fields_are_kept_through_a_change_and_come_back_on_return(client):
    case_id = _case(client)
    truck = _entity(client, case_id, "vehicle", "Bridge truck", {"plate": "AA1234", "notes": "blue cab"})

    moved = _retype(client, case_id, truck["id"], "vessel")

    assert moved.status_code == 200, moved.text
    assert moved.json()["type"] == "vessel"
    assert moved.json()["attrs"]["plate"] == "AA1234"
    case = Case.open(case_id)
    # The index follows the type: the plate is no longer a declared field of it.
    found = case.page_entities(query="vessel")["items"]
    assert [entity["id"] for entity in found] == [truck["id"]]
    assert case.page_entities(query="AA1234")["items"] == []

    back = _retype(client, case_id, truck["id"], "vehicle")
    assert back.status_code == 200
    assert [entity["id"] for entity in case.page_entities(query="AA1234")["items"]] == [truck["id"]]

    # A field kept from another type is let go of by clearing it.
    _retype(client, case_id, truck["id"], "vessel")
    cleared = client.patch(
        f"/api/cases/{case_id}/entities/{truck['id']}", json={"attrs": {"plate": None}}
    )
    assert cleared.status_code == 200
    assert "plate" not in cleared.json()["attrs"]
    assert cleared.json()["attrs"]["notes"] == "blue cab"


def test_an_identifier_the_case_already_holds_is_reported_not_refused(client):
    case_id = _case(client)
    account = _entity(client, case_id, "account", "@spotter")
    person = _entity(client, case_id, "person", "spotter")

    moved = _retype(client, case_id, person["id"], "account")

    assert moved.status_code == 200, moved.text
    assert moved.json()["type"] == "account"
    assert moved.json()["twin"]["id"] == account["id"]


def test_a_change_that_passes_keeps_every_relation(client):
    case_id = _case(client)
    unit = _entity(client, case_id, "organization", "Crew")
    subject_a = _entity(client, case_id, "person", "Subject A")
    client.post(
        f"/api/cases/{case_id}/links",
        json={"from_id": subject_a["id"], "to_id": unit["id"], "type": "associated-with"},
    )

    moved = _retype(client, case_id, unit["id"], "person")

    assert moved.status_code == 200, moved.text
    assert "twin" in moved.json()
    assert [link["type"] for link in Case.open(case_id).links_of(unit["id"])] == ["associated-with"]
