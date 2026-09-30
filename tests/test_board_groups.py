"""The reads behind the Board's groups: counts per type under the question, the
"Most noted" ordering, and the per-page event summary its rows are drawn from."""

from __future__ import annotations


def _case(client, name: str = "Groups") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _entity(client, case_id: str, type_: str, label: str, attrs: dict | None = None) -> dict:
    response = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": type_, "label": label, "attrs": attrs or {}},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _claim(client, case_id: str, statement: str, **connectors) -> dict:
    response = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": statement, **connectors},
    )
    assert response.status_code == 200, response.text
    return response.json()["entity"]


def test_a_page_counts_its_answer_per_type_under_the_same_question(client):
    cid = _case(client)
    _entity(client, cid, "person", "Anna North")
    _entity(client, cid, "person", "Boris Nord")
    _entity(client, cid, "organization", "North Unit")
    _entity(client, cid, "bookmark", "North log", {"url": "https://x.test"})
    _entity(client, cid, "person", "Carla South")

    page = client.get(
        f"/api/cases/{cid}/catalog/entities",
        params={"q": "north", "limit": 1, "counts": "type"},
    ).json()

    assert page["total"] == 3
    assert page["by_type"] == {"person": 1, "organization": 1, "bookmark": 1}
    # Without the ask, the page stays the shape every other caller reads.
    plain = client.get(f"/api/cases/{cid}/catalog/entities").json()
    assert "by_type" not in plain


def test_a_count_it_does_not_know_is_refused(client):
    cid = _case(client)
    res = client.get(f"/api/cases/{cid}/catalog/entities", params={"counts": "folder"})
    assert res.status_code == 400


def test_most_noted_orders_the_case_by_the_claims_naming_each_row(client):
    cid = _case(client)
    quiet = _entity(client, cid, "person", "Quiet")
    busy = _entity(client, cid, "person", "Busy")
    some = _entity(client, cid, "person", "Some")
    place = _entity(client, cid, "place", "Crossroads", {"lat": 49.9, "lon": 36.2})
    for n in range(3):
        _claim(client, cid, f"Busy seen {n}", about=[busy["id"]])
    _claim(client, cid, "Some seen", about=[some["id"]], at=[place["id"]])
    # One Claim placing and naming the same row is one event about it, not two.
    _claim(client, cid, "Busy there", about=[busy["id"]], at=[place["id"]])

    page = client.get(
        f"/api/cases/{cid}/catalog/entities",
        params={"type": "person", "order": "-events", "limit": 2},
    ).json()
    assert [row["label"] for row in page["items"]] == ["Busy", "Some"]
    rest = client.get(
        f"/api/cases/{cid}/catalog/entities",
        params={
            "type": "person", "order": "-events", "limit": 2,
            "cursor": page["next_cursor"],
        },
    ).json()
    # The cursor resumes on a count, so the last row is neither skipped nor repeated.
    assert [row["label"] for row in rest["items"]] == ["Quiet"]
    assert rest["next_cursor"] is None
    assert quiet["id"] == rest["items"][0]["id"]


def test_most_noted_breaks_ties_on_the_newest_row(client):
    cid = _case(client)
    for label in ("older", "newer"):
        _entity(client, cid, "person", label)
    page = client.get(
        f"/api/cases/{cid}/catalog/entities", params={"type": "person", "order": "-events"}
    ).json()
    assert [row["label"] for row in page["items"]] == ["newer", "older"]


def test_most_noted_is_asked_of_a_group_never_of_the_whole_case(client):
    cid = _case(client)
    res = client.get(f"/api/cases/{cid}/catalog/entities", params={"order": "-events"})
    assert res.status_code == 400


def test_a_count_cursor_that_is_not_a_number_is_refused(client):
    cid = _case(client)
    res = client.get(
        f"/api/cases/{cid}/catalog/entities",
        params={"type": "person", "order": "-events", "cursor": "3:many"},
    )
    assert res.status_code == 400


def test_event_rows_say_how_often_when_and_through_what_each_row_is_named(client):
    cid = _case(client)
    brigade = _entity(client, cid, "organization", "4th brigade")
    idle = _entity(client, cid, "person", "Nobody")
    place = _entity(client, cid, "place", "Crossroads", {"lat": 49.9, "lon": 36.2})
    video = _entity(client, cid, "bookmark", "VID_0312", {"url": "https://x.test/v"})
    photo = _entity(client, cid, "bookmark", "S2 11/03", {"url": "https://x.test/p"})
    _claim(
        client, cid, "Column seen", when="2026-03-11",
        about=[brigade["id"]], at=[place["id"]], cites=[video["id"]],
    )
    _claim(
        client, cid, "Column again", when="2026-03-19T10:00:00Z",
        about=[brigade["id"]], cites=[video["id"], photo["id"]],
    )
    _claim(client, cid, "Undated rumour", about=[brigade["id"]])

    body = client.post(
        f"/api/cases/{cid}/catalog/events",
        json={"ids": [brigade["id"], idle["id"], place["id"]]},
    ).json()

    row = body["rows"][brigade["id"]]
    assert row["events"] == 3
    assert row["first"] == "2026-03-11T00:00:00.000000Z"
    assert row["last"] == "2026-03-19T10:00:01.000000Z"
    assert row["sources"] == 2
    assert row["places"] == 1
    # Two dated Claims across the case's own span: the first and the last bucket.
    assert len(row["buckets"]) == 12
    assert sum(row["buckets"]) == 2
    assert row["buckets"][0] == 1 and row["buckets"][-1] == 1
    assert body["range"] == {
        "from": "2026-03-11T00:00:00.000000Z",
        "to": "2026-03-19T10:00:01.000000Z",
    }
    assert body["rows"][idle["id"]] == {
        "events": 0, "first": None, "last": None,
        "sources": 0, "places": 0, "buckets": [0] * 12,
    }
    # The place is named by one Claim through `at`, and is not its own place.
    assert body["rows"][place["id"]]["events"] == 1
    assert body["rows"][place["id"]]["places"] == 0


def test_event_rows_count_a_place_the_entity_states_itself(client):
    cid = _case(client)
    truck = _entity(client, cid, "structure", "Depot hall")
    depot = _entity(client, cid, "place", "Depot", {"lat": 49.0, "lon": 36.0})
    linked = client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": truck["id"], "to_id": depot["id"], "type": "sited-at"},
    )
    assert linked.status_code == 200, linked.text
    body = client.post(f"/api/cases/{cid}/catalog/events", json={"ids": [truck["id"]]}).json()
    assert body["rows"][truck["id"]]["places"] == 1
    assert body["range"] is None


def test_event_rows_are_bounded_to_a_page(client):
    cid = _case(client)
    res = client.post(
        f"/api/cases/{cid}/catalog/events", json={"ids": [f"e{n}" for n in range(201)]}
    )
    assert res.status_code == 422
    empty = client.post(f"/api/cases/{cid}/catalog/events", json={"ids": []}).json()
    assert empty == {"range": None, "rows": {}}


def test_a_snapshot_page_narrows_counts_and_orders_its_frozen_rows(client):
    cid = _case(client)
    busy = _entity(client, cid, "person", "Busy")
    _entity(client, cid, "person", "Quiet")
    _entity(client, cid, "bookmark", "Log", {"url": "https://x.test"})
    _claim(client, cid, "Busy seen", about=[busy["id"]])
    view = client.post(
        f"/api/cases/{cid}/analysis-views",
        json={"name": "Frozen", "surface": "board", "mode": "snapshot", "spec": {}},
    )
    assert view.status_code == 200, view.text
    vid = view.json()["id"]
    # A row the live case gains afterwards is not in the frozen reading.
    _claim(client, cid, "Quiet seen", about=[busy["id"]])

    page = client.get(
        f"/api/cases/{cid}/catalog/entities",
        params={"view": vid, "type": "person", "order": "-events", "counts": "type"},
    ).json()
    assert [row["label"] for row in page["items"]] == ["Busy", "Quiet"]
    assert page["total"] == 2
    assert page["by_type"] == {"person": 2}


def test_the_summary_prices_what_the_claims_lack(client):
    cid = _case(client)
    log = _entity(client, cid, "bookmark", "Log", {"url": "https://x.test"})
    _claim(client, cid, "Cited and graded", cites=[log["id"]], confidence="probable")
    _claim(client, cid, "Cited only", cites=[log["id"]])
    _claim(client, cid, "Bare")
    summary = client.get(f"/api/cases/{cid}/catalog/summary").json()
    assert summary["lacks"] == {"source": 1, "assessment": 2}


def test_a_claim_says_where_it_sits_on_the_timeline(client):
    cid = _case(client)
    dated = _claim(client, cid, "Seen", when="2026-03-12")["id"]
    undated = _claim(client, cid, "Rumoured")["id"]
    person = _entity(client, cid, "person", "Witness")

    item = client.get(f"/api/cases/{cid}/timeline/claims/{dated}").json()["item"]
    assert item["id"] == f"temporal:claim:{dated}"
    assert item["earliest"] == "2026-03-12T00:00:00.000000Z"
    assert client.get(f"/api/cases/{cid}/timeline/claims/{undated}").json()["item"]["earliest"] is None
    # only a Claim has a row of its own to land on
    assert client.get(f"/api/cases/{cid}/timeline/claims/{person['id']}").status_code == 404
    assert client.get(f"/api/cases/{cid}/timeline/claims/e_missing").status_code == 404
