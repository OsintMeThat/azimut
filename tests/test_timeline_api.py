"""Public Time and Timeline API, including atomic Temporal Claim writes."""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing

import pytest
from fastapi import HTTPException

from azimut.api.cases import timeline
from azimut.sqlite_backend import SQLITE_SCHEMA
from azimut.workspace import Case


def _case(client, name="Timeline"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _entity(client, case_id, type_, label, attrs=None):
    response = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": type_, "label": label, "attrs": attrs or {}},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_atomic_create_returns_a_normalized_claim_and_connectors(client):
    case_id = _case(client)
    subject = _entity(client, case_id, "ip", "203.0.113.42")
    source = _entity(client, case_id, "bookmark", "Access log", {"url": "https://x.test"})

    created = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={
            "statement": "This address appeared in the access log",
            "when": "2026-08-11T10:32:14Z",
            "time_role": "observed",
            "confidence": "probable",
            "about": [subject["id"]],
            "cites": [source["id"]],
        },
    )

    assert created.status_code == 200, created.text
    body = created.json()
    assert body["entity"]["attrs"]["when"] == "2026-08-11T10:32:14Z"
    assert {(link["type"], link["to"]) for link in body["links"]} == {
        ("about", subject["id"]),
        ("cites", source["id"]),
    }
    assert body["temporal"]["earliest"] == "2026-08-11T10:32:14.000000Z"
    assert body["temporal"]["latest"] == "2026-08-11T10:32:15.000000Z"
    assert body["temporal"]["subjects"] == [subject["id"]]
    assert body["temporal"]["sources"] == [source["id"]]


def test_a_bad_connector_rolls_back_the_whole_claim(client):
    case_id = _case(client)
    person = _entity(client, case_id, "person", "Witness")

    refused = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "Invalid evidence", "cites": [person["id"]]},
    )

    assert refused.status_code == 400
    entities = Case.open(case_id).list_entities()
    assert [entity["type"] for entity in entities] == ["person"]


def test_a_line_creates_the_subjects_it_names_with_its_claim(client):
    case_id = _case(client)
    place = _entity(client, case_id, "place", "Crossroads", {"lat": 49.9, "lon": 36.2})

    created = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={
            "statement": "4th brigade seen at Crossroads",
            "at": [place["id"]],
            "create": [
                {"slot": "about", "type": "organization", "label": " 4th brigade "},
                {"slot": "about", "type": "account", "label": "@spotter"},
            ],
        },
    )

    assert created.status_code == 200, created.text
    body = created.json()
    made = body["created"]
    assert [(entry["type"], entry["label"], entry["slot"]) for entry in made] == [
        ("organization", "4th brigade", "about"),
        ("account", "@spotter", "about"),
    ]
    assert {(link["type"], link["to"]) for link in body["links"]} == {
        ("at", place["id"]),
        ("about", made[0]["id"]),
        ("about", made[1]["id"]),
    }
    case = Case.open(case_id)
    organization = case.get_entity(made[0]["id"])
    assert organization["provenance"]["by"] == "user"
    assert organization["provenance"]["status"] == "confirmed"

    # Undo is the grouped delete: the Claim and what it created, as one trash group.
    undone = client.post(
        f"/api/cases/{case_id}/entities/delete",
        json={"ids": [body["entity"]["id"], *(entry["id"] for entry in made)]},
    )
    assert undone.status_code == 200, undone.text
    assert sorted(entity["type"] for entity in case.list_entities()) == ["place"]
    restored = client.post(f"/api/cases/{case_id}/trash/{undone.json()['trash']}/restore")
    assert restored.status_code == 200, restored.text
    assert sorted(entity["type"] for entity in case.list_entities()) == [
        "account", "claim", "organization", "place",
    ]


@pytest.mark.parametrize(
    ("entry", "reason"),
    [
        ({"slot": "about", "type": "place", "label": "Somewhere"}, "cannot be a 'place'"),
        ({"slot": "about", "type": "media", "label": "clip.mp4"}, "cannot be a 'media'"),
        ({"slot": "about", "type": "claim", "label": "Another"}, "cannot be a 'claim'"),
        ({"slot": "about", "type": "unheard-of", "label": "X"}, "cannot be a 'unheard-of'"),
        ({"slot": "about", "type": "person", "label": "   "}, "needs a name"),
        # A person is not evidence: the vocabulary refuses the seat, after the
        # subject was written, and the whole line goes back.
        ({"slot": "cites", "type": "person", "label": "Witness"}, ""),
    ],
)
def test_a_new_subject_the_line_cannot_create_leaves_nothing(client, entry, reason):
    case_id = _case(client)

    refused = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "Something seen", "create": [entry]},
    )

    assert refused.status_code == 400, refused.text
    assert reason in refused.json()["detail"]
    assert Case.open(case_id).list_entities() == []


def test_a_line_names_at_most_ten_new_subjects(client):
    case_id = _case(client)
    entries = [{"slot": "about", "type": "person", "label": f"P{n}"} for n in range(11)]

    refused = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "Crowd", "create": entries},
    )

    assert refused.status_code == 422
    assert Case.open(case_id).list_entities() == []


def test_a_claim_without_new_subjects_still_posts_the_old_body(client):
    case_id = _case(client)

    created = client.post(
        f"/api/cases/{case_id}/timeline/claims", json={"statement": "Plain"}
    )

    assert created.status_code == 200, created.text
    assert created.json()["created"] == []


def test_subsecond_bounds_sort_filter_and_measure_the_extent_chronologically(client):
    case_id = _case(client, "Subsecond order")
    for statement, when in (
        ("Whole second", "2026-08-11T10:32:14Z"),
        ("One half", "2026-08-11T10:32:14.5Z"),
        ("Five decimal places", "2026-08-11T10:32:14.50001Z"),
    ):
        response = client.post(
            f"/api/cases/{case_id}/timeline/claims",
            json={"statement": statement, "when": when},
        )
        assert response.status_code == 200, response.text

    page = client.get(
        f"/api/cases/{case_id}/timeline",
        params={"category": "statement", "include_undated": "false"},
    ).json()

    assert [item["label"] for item in page["items"]] == [
        "Whole second",
        "One half",
        "Five decimal places",
    ]
    assert [item["earliest"] for item in page["items"]] == [
        "2026-08-11T10:32:14.000000Z",
        "2026-08-11T10:32:14.500000Z",
        "2026-08-11T10:32:14.500010Z",
    ]
    assert page["extent"] == {
        "from": "2026-08-11T10:32:14.000000Z",
        "to": "2026-08-11T10:32:15.000000Z",
    }

    narrow = client.get(
        f"/api/cases/{case_id}/timeline",
        params={
            "from": "2026-08-11T10:32:14.500005Z",
            "to": "2026-08-11T10:32:14.500009Z",
            "category": "statement",
            "include_undated": "false",
        },
    ).json()
    assert [item["label"] for item in narrow["items"]] == [
        "Whole second",
        "One half",
    ]


def test_timeline_filters_intersections_categories_entities_and_undated(client):
    case_id = _case(client)
    subject = _entity(client, case_id, "person", "Witness")
    other = _entity(client, case_id, "person", "Other")
    for statement, when, about in (
        ("During August", "2026-08/2026-09", subject["id"]),
        ("One day elsewhere", "2026-07-01", other["id"]),
        ("Not dated yet", None, subject["id"]),
    ):
        payload = {"statement": statement, "about": [about]}
        if when:
            payload["when"] = when
        response = client.post(f"/api/cases/{case_id}/timeline/claims", json=payload)
        assert response.status_code == 200, response.text

    page = client.get(
        f"/api/cases/{case_id}/timeline",
        params={
            "from": "2026-08-15",
            "to": "2026-08-20",
            "entity": subject["id"],
            "category": "statement",
            "include_undated": "true",
            "bucket": "month",
        },
    )

    assert page.status_code == 200, page.text
    body = page.json()
    assert [item["label"] for item in body["items"]] == ["During August", "Not dated yet"]
    assert body["undated"] == 1
    assert body["unplaced"] == 0
    # A bucket carries the span of its own entries beside the count: the overview
    # opens a clicked bar onto what it holds rather than onto the whole month.
    assert body["buckets"] == [
        {
            "start": "2026-08",
            "count": 1,
            "categories": {"statement": 1},
            "first": "2026-08-01T00:00:00.000000Z",
            "last": "2026-10-01T00:00:00.000000Z",
        }
    ]
    assert body["window"] == {
        "from": "2026-08-15T00:00:00.000000Z",
        "to": "2026-08-21T00:00:00.000000Z",
    }
    assert body["extent"] == {
        "from": "2026-08-01T00:00:00.000000Z",
        "to": "2026-10-01T00:00:00.000000Z",
    }


def test_local_time_is_counted_as_unplaced_instead_of_undated(client):
    case_id = _case(client)
    created = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "Local observation", "when": "2021-04-24T14:52:29"},
    )
    assert created.status_code == 200, created.text

    body = client.get(
        f"/api/cases/{case_id}/timeline",
        params={"category": "statement", "include_undated": "true"},
    ).json()
    assert body["undated"] == 0
    assert body["unplaced"] == 1
    assert body["items"][0]["raw"] == "2021-04-24T14:52:29"
    assert body["items"][0]["zone"] == "local"


def test_a_day_stated_in_a_zone_is_that_zones_day_on_the_axis(client):
    """The 12th in Tokyo ends at 15:00 UTC, so a window closing at 16:00 UTC on
    the 12th holds all of it; read as UTC's day it would spill past the window."""
    case_id = _case(client)
    created = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "Filmed", "when": "2024-03-12", "when_zone": "Asia/Tokyo"},
    )
    assert created.status_code == 200, created.text
    row = created.json()["temporal"]
    assert (row["earliest"], row["latest"], row["tz"]) == (
        "2024-03-11T15:00:00.000000Z", "2024-03-12T15:00:00.000000Z", "Asia/Tokyo",
    )

    local = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "Clock", "when": "2024-03-12T09:00:00", "when_zone": "Asia/Tokyo"},
    )
    assert local.json()["temporal"]["earliest"] == "2024-03-12T00:00:00.000000Z"
    assert local.json()["temporal"]["zone"] == "named"


def test_a_zone_leaves_with_the_date_it_read(client):
    case_id = _case(client)
    claim_id = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "Filmed", "when": "2024-03-12", "when_zone": "Europe/Kyiv"},
    ).json()["entity"]["id"]

    # Editing the date alone keeps the zone it was stated in.
    moved = client.patch(
        f"/api/cases/{case_id}/timeline/claims/{claim_id}", json={"when": "2024-03-13"}
    )
    assert moved.json()["entity"]["attrs"]["when_zone"] == "Europe/Kyiv"
    assert moved.json()["temporal"]["earliest"] == "2024-03-12T22:00:00.000000Z"

    cleared = client.patch(
        f"/api/cases/{case_id}/timeline/claims/{claim_id}", json={"when": None}
    )
    assert "when_zone" not in cleared.json()["entity"]["attrs"]

    refused = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "Nowhere", "when": "2024-03-12", "when_zone": "Mars/Olympus"},
    )
    assert refused.status_code == 400


def test_timestamp_window_uses_the_given_second_as_its_upper_boundary(client):
    case_id = _case(client)
    for second in (0, 1):
        response = client.post(
            f"/api/cases/{case_id}/timeline/claims",
            json={
                "statement": f"Observation {second}",
                "when": f"2026-08-12T10:00:{second:02d}Z",
            },
        )
        assert response.status_code == 200, response.text

    response = client.get(
        f"/api/cases/{case_id}/timeline",
        params={
            "category": "statement",
            "from": "2026-08-12T10:00:00Z",
            "to": "2026-08-12T10:00:01Z",
        },
    )

    assert response.status_code == 200, response.text
    assert [item["label"] for item in response.json()["items"]] == ["Observation 0"]
    assert response.json()["window"]["to"] == "2026-08-12T10:00:01.000000Z"


def test_a_spread_read_reaches_the_far_end_of_a_lopsided_window(client):
    case_id = _case(client)
    for index in range(30):
        _entity(client, case_id, "claim", f"Jan {index:02d}", {"when": f"2026-01-{index % 28 + 1:02d}"})
    for index in range(5):
        _entity(client, case_id, "claim", f"Jul {index:02d}", {"when": f"2026-07-{index + 1:02d}"})

    params = {"category": "statement", "limit": 20}
    front = client.get(f"/api/cases/{case_id}/timeline", params=params).json()
    spread = client.get(
        f"/api/cases/{case_id}/timeline", params={**params, "spread": "true"}
    ).json()

    assert front["total"] == spread["total"] == 35
    assert {item["earliest"][:7] for item in front["items"]} == {"2026-01"}
    assert {item["earliest"][:7] for item in spread["items"]} == {"2026-01", "2026-07"}

    seen = list(spread["items"])
    cursor = spread["next_cursor"]
    while cursor:
        page = client.get(
            f"/api/cases/{case_id}/timeline",
            params={**params, "spread": "true", "cursor": cursor},
        ).json()
        seen.extend(page["items"])
        cursor = page["next_cursor"]
    assert len({item["id"] for item in seen}) == 35


def test_a_time_assessment_about_a_claim_explains_the_single_date_rule(client):
    case_id = _case(client)
    original = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "A vehicle crossed the gate", "when": "2026-08-12"},
    ).json()["entity"]

    response = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={
            "statement": "The crossing occurred later",
            "when": "2026-08-13",
            "about": [original["id"]],
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "A Claim has one date or range. Edit its date, or create a separate Claim."
    )


def test_timeline_uses_keyset_pagination(client):
    case_id = _case(client)
    for day in range(1, 6):
        response = client.post(
            f"/api/cases/{case_id}/timeline/claims",
            json={"statement": f"Event {day}", "when": f"2026-08-{day:02d}"},
        )
        assert response.status_code == 200, response.text

    first = client.get(
        f"/api/cases/{case_id}/timeline",
        params={"category": "statement", "limit": 2},
    ).json()
    second = client.get(
        f"/api/cases/{case_id}/timeline",
        params={"category": "statement", "limit": 2, "cursor": first["next_cursor"]},
    ).json()

    assert [item["label"] for item in first["items"]] == ["Event 1", "Event 2"]
    assert [item["label"] for item in second["items"]] == ["Event 3", "Event 4"]
    assert first["total"] == 5


def test_update_delete_undo_and_rebuild_keep_the_projection_in_step(client):
    case_id = _case(client)
    subject = _entity(client, case_id, "person", "Witness")
    created = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "First reading", "when": "2026-08", "about": [subject["id"]]},
    ).json()
    claim_id = created["entity"]["id"]

    updated = client.patch(
        f"/api/cases/{case_id}/timeline/claims/{claim_id}",
        json={"statement": "Corrected reading", "when": "2026-09?", "about": []},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["temporal"]["raw"] == "2026-09?"
    assert updated.json()["temporal"]["subjects"] == []

    case = Case.open(case_id)
    before = case.timeline_page(categories=["statement"])
    assert case.rebuild_temporal_projection() >= before["total"]
    assert case.timeline_page(categories=["statement"]) == before

    deleted = client.delete(f"/api/cases/{case_id}/timeline/claims/{claim_id}").json()
    assert case.timeline_page(categories=["statement"])["total"] == 0
    restored = client.post(f"/api/cases/{case_id}/trash/{deleted['trash']}/restore")
    assert restored.status_code == 200, restored.text
    assert case.timeline_page(categories=["statement"])["items"][0]["raw"] == "2026-09?"


def test_a_heavily_cited_claim_still_answers_with_its_own_row(client):
    """The entity scope returns every statement resting on this one, ordered by
    date — so the Claim being written can sit past the first page of its own
    response, which used to fail a write that had already been committed."""
    case_id = _case(client)
    created = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "The convoy passed the bridge", "when": "2030-01-01"},
    )
    claim_id = created.json()["entity"]["id"]
    case = Case.open(case_id)
    for index in range(201):
        case.save_temporal_claim(
            entity_id=None,
            label=f"Supporting reading {index:03d}",
            attrs={"when": "2020-01-01"},
            connectors={"cites": [claim_id]},
            by="user",
        )

    updated = client.patch(
        f"/api/cases/{case_id}/timeline/claims/{claim_id}", json={"when": "2030-02-02"}
    )

    assert updated.status_code == 200, updated.text
    assert updated.json()["temporal"]["owner_id"] == claim_id
    assert updated.json()["temporal"]["raw"] == "2030-02-02"


def test_media_metadata_and_case_activity_are_separate_categories(client):
    case_id = _case(client)
    case = Case.open(case_id)
    media = case.add_entity(
        "media", "Clip", {"path": "media/clip.mp4", "kind": "video"}, by="user"
    )
    case.upsert_media_item(
        {
            "path": "media/clip.mp4",
            "filename": "clip.mp4",
            "kind": "video",
            "taken_at": "2024-02-03T10:11:12Z",
            "added_at": "2026-08-11T10:00:00Z",
            "source": {"type": "download", "upload_date": "20240204"},
        },
        entity_id=media["id"],
    )

    default = client.get(f"/api/cases/{case_id}/timeline").json()
    activity = client.get(
        f"/api/cases/{case_id}/timeline", params={"category": "case_activity"}
    ).json()

    assert {item["kind"] for item in default["items"]} == {"captured", "published"}
    assert [item["kind"] for item in activity["items"]] == ["added"]


def test_a_file_row_carries_the_preview_the_case_already_cached(client):
    """A card on a zoomed axis shows the picture: the row brings the cached thumbnail,
    and a row whose owner has none, or is not a file, brings nothing."""
    case_id = _case(client)
    case = Case.open(case_id)
    shown = case.add_entity("media", "Frame", {"path": "media/frame.jpg", "kind": "image"}, by="user")
    bare = case.add_entity("media", "Clip", {"path": "media/clip.mp4", "kind": "video"}, by="user")
    for entity, path, thumb in ((shown, "media/frame.jpg", ".thumbs/frame.jpg"), (bare, "media/clip.mp4", None)):
        case.upsert_media_item(
            {
                "path": path, "filename": path.rsplit("/", 1)[1], "kind": "image",
                "taken_at": "2024-02-03T10:11:12Z", "added_at": "2026-08-11T10:00:00Z",
                **({"thumbnail": thumb} if thumb else {}),
            },
            entity_id=entity["id"],
        )
    _entity(client, case_id, "claim", "Seen the same day", {"when": "2024-02-03"})

    items = client.get(
        f"/api/cases/{case_id}/timeline", params={"category": ["media", "statement"]}
    ).json()["items"]
    thumbs = {item["owner_id"]: item.get("thumb") for item in items}

    assert thumbs[shown["id"]] == ".thumbs/frame.jpg"
    assert thumbs[bare["id"]] is None
    assert all("thumb" not in item for item in items if item["category"] == "statement")


def test_a_track_can_hold_back_the_files_the_case_made_itself(client):
    """The Media Library's working-files switch, on a track: a frame and a capture stay
    off it, a download stays on, and the file a reading is focused on always shows."""
    case_id = _case(client, "Working files")
    case = Case.open(case_id)
    owners = {}
    for name, source in (("clip", "download"), ("frame", "inspect"), ("capture", "satellite")):
        entity = case.add_entity("media", name, {"path": f"media/{name}.jpg", "kind": "image"}, by="user")
        case.upsert_media_item(
            {
                "path": f"media/{name}.jpg", "filename": f"{name}.jpg", "kind": "image",
                "taken_at": "2024-02-03T10:11:12Z", "added_at": "2026-08-11T10:00:00Z",
                "source": {"type": source},
            },
            entity_id=entity["id"],
        )
        owners[entity["id"]] = name

    def read(track, **params):
        page = client.get(f"/api/cases/{case_id}/timeline", params={
            "category": "media", "track": json.dumps(track), **params,
        })
        assert page.status_code == 200, page.text
        return {owners[item["owner_id"]]: item["produced_here"] for item in page.json()["items"]}

    assert read({}) == {"clip": False, "frame": True, "capture": True}
    assert read({"collected_only": True}) == {"clip": False}
    for spread in ("false", "true"):
        assert read({"collected_only": True}, spread=spread, limit=1) == {"clip": False}
    frame = next(owner for owner, name in owners.items() if name == "frame")
    assert read({"collected_only": True}, entity=frame) == {"frame": True}


def test_schema_15_backfills_existing_claims_and_media(tmp_path):
    db = tmp_path / "case.db"
    from azimut.sqlite_backend import SqliteCase

    store = SqliteCase.create(db, name="Migration")
    claim = store.add_entity(
        "claim", "Existing event", {"when": "2026-08-11"}, by="user"
    )
    media = store.add_entity(
        "media", "Existing photo", {"path": "media/photo.jpg", "kind": "image"}, by="user"
    )
    store.upsert_media_item(
        {
            "path": "media/photo.jpg",
            "filename": "photo.jpg",
            "kind": "image",
            "taken_at": "2024-02-03T10:11:12Z",
            "added_at": "2026-08-11T10:00:00Z",
            "source": {"type": "upload"},
        },
        entity_id=media["id"],
    )
    with closing(sqlite3.connect(db)) as conn, conn:
        conn.execute("DROP TABLE temporal_items")
        conn.execute("UPDATE meta SET value = '14' WHERE key = 'schema_version'")
        conn.execute("DELETE FROM schema_migrations WHERE version >= 15")

    reopened = SqliteCase.open(db)

    assert SQLITE_SCHEMA >= 15, "the projection this test rewinds past is gone"
    items = reopened.timeline_page(categories=["statement", "media"])["items"]
    assert {(item["owner_id"], item["kind"]) for item in items} == {
        (claim["id"], "claim"),
        (media["id"], "captured"),
    }


def test_timeline_track_filters_through_named_claim_connectors(client):
    case_id = _case(client, "Track query")
    person = _entity(client, case_id, "person", "Witness")
    place = _entity(client, case_id, "place", "North gate", {"lat": 1, "lon": 2})
    source = _entity(
        client, case_id, "bookmark", "Archived report", {"url": "https://example.test"}
    )
    first = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={
            "statement": "Witness reached the gate",
            "when": "2026-08-12T10:00:00Z",
            "about": [person["id"]],
            "at": [place["id"]],
            "cites": [source["id"]],
        },
    ).json()["temporal"]
    client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "Unrelated event", "when": "2026-08-12T11:00:00Z"},
    )

    people = client.get(
        f"/api/cases/{case_id}/timeline",
        params={
            "category": "statement",
            "track": json.dumps({"relation": "about", "terms": {"type": "person"}}),
        },
    )
    assert people.status_code == 200, people.text
    assert [item["id"] for item in people.json()["items"]] == [first["id"]]
    assert people.json()["items"][0]["subject_entities"] == [
        {"id": person["id"], "label": "Witness", "type": "person"}
    ]

    sourced = client.get(
        f"/api/cases/{case_id}/timeline",
        params={"category": "statement", "track": json.dumps({"relation": "source"})},
    )
    assert [item["id"] for item in sourced.json()["items"]] == [first["id"]]

    # The Board's question about what a claim lacks reaches a track the same way.
    unsourced = client.get(
        f"/api/cases/{case_id}/timeline",
        params={
            "category": "statement",
            "track": json.dumps({"relation": "owner", "terms": {"lacks": "source"}}),
        },
    )
    assert unsourced.status_code == 200, unsourced.text
    assert [item["label"] for item in unsourced.json()["items"]] == ["Unrelated event"]


def test_timeline_track_can_filter_role_and_hide_one_entry(client):
    case_id = _case(client, "Track role")
    observed = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={
            "statement": "Observed event",
            "when": "2026-08-12T10:00:00Z",
            "time_role": "observed",
        },
    ).json()["temporal"]
    client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={
            "statement": "Occurred event",
            "when": "2026-08-12T11:00:00Z",
            "time_role": "occurred",
        },
    )
    response = client.get(
        f"/api/cases/{case_id}/timeline",
        params={
            "category": "statement",
            "track": json.dumps({"roles": ["observed"], "hidden": [observed["id"]]}),
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["items"] == []


def test_timeline_rejects_an_oversized_track_query(client):
    case_id = _case(client, "Large track query")
    with pytest.raises(HTTPException) as raised:
        timeline(
            case_id,
            from_=None,
            to=None,
            category=None,
            entity=None,
            include_undated=True,
            limit=100,
            cursor=None,
            bucket=None,
            track=json.dumps({"terms": {"q": "x" * (64 * 1024)}}),
        )

    assert raised.value.status_code == 400
    assert raised.value.detail == "timeline track query is too large"


def test_board_graph_and_map_share_the_same_fact_time_window(client):
    case_id = _case(client, "Timeline handoffs")
    person = _entity(client, case_id, "person", "Witness")
    place = _entity(
        client,
        case_id,
        "place",
        "North gate",
        {"lat": 48.8566, "lon": 2.3522},
    )
    source = _entity(
        client,
        case_id,
        "bookmark",
        "Camera log",
        {"url": "https://example.test/log"},
    )
    inside = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={
            "statement": "Witness reached the gate",
            "when": "2026-08-12T10:00:00Z",
            "about": [person["id"]],
            "at": [place["id"]],
            "cites": [source["id"]],
        },
    ).json()
    outside = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "Later event", "when": "2026-08-13T10:00:00Z"},
    ).json()
    params = {
        "temporal_from": "2026-08-12T09:00:00Z",
        "temporal_to": "2026-08-12T11:00:00Z",
        "temporal_category": "statement",
    }

    board = client.get(f"/api/cases/{case_id}/catalog/entities", params=params)
    assert board.status_code == 200, board.text
    board_ids = {entity["id"] for entity in board.json()["items"]}
    assert board_ids == {
        inside["entity"]["id"], person["id"], place["id"], source["id"]
    }
    assert outside["entity"]["id"] not in board_ids

    graph = client.get(f"/api/cases/{case_id}/graph", params=params)
    assert graph.status_code == 200, graph.text
    assert {node["id"] for node in graph.json()["nodes"]} == board_ids

    mapped = client.get(
        f"/api/cases/{case_id}/timeline/map",
        params={"from": "2026-08-12T09:00:00Z", "to": "2026-08-12T11:00:00Z"},
    )
    assert mapped.status_code == 200, mapped.text
    body = mapped.json()
    assert body["matched"] == 1
    assert body["mapped"] == 1
    assert body["marks"] == 1
    assert body["items"][0]["owner_id"] == inside["entity"]["id"]
    assert body["items"][0]["place_entities"] == [{
        "id": place["id"],
        "label": "North gate",
        "lat": 48.8566,
        "lon": 2.3522,
        "radius_m": None,
        "footprint": None,
    }]


def test_map_layer_answers_every_way_the_case_puts_something_on_the_ground(client):
    """A window of photographs is a window with places in it.

    `at` is a Claim's connector and nothing else carries it, so a layer that asked
    for it alone answered a case full of located photographs with an empty map and
    the words "nothing carries a place".
    """
    case_id = _case(client, "Placed by every verb")
    case = Case.open(case_id)
    quay = _entity(client, case_id, "place", "Quay", {"lat": 43.29, "lon": 5.37})
    yard = _entity(client, case_id, "place", "Yard", {"lat": 43.31, "lon": 5.39})

    photo = case.add_entity(
        "media", "Quayside", {"path": "media/quay.jpg", "kind": "image"}, by="user"
    )
    case.upsert_media_item(
        {
            "path": "media/quay.jpg",
            "filename": "quay.jpg",
            "kind": "image",
            "taken_at": "2026-08-12T10:30:00Z",
            "added_at": "2026-08-12T10:30:00Z",
            "source": {"type": "upload"},
        },
        entity_id=photo["id"],
    )
    case.add_link(photo["id"], quay["id"], "located-at", by="user")

    shed = _entity(client, case_id, "structure", "Shed")
    case.add_link(shed["id"], yard["id"], "sited-at", by="user")
    # A note merely referring to a place was never there, so `mentions` stays out.
    note = case.add_entity("note", "Desk note", {}, by="user")
    case.add_link(note["id"], quay["id"], "mentions", by="user")

    window = {"from": "2026-08-12T00:00:00Z", "to": "2026-08-13T00:00:00Z"}
    body = client.get(f"/api/cases/{case_id}/timeline/map", params=window).json()

    placed = {item["owner_id"]: item for item in body["items"]}
    assert photo["id"] in placed, "a located photograph belongs on the map"
    assert [place["id"] for place in placed[photo["id"]]["place_entities"]] == [quay["id"]]
    assert note["id"] not in placed

    # Whatever the case has sited somewhere lands there too, in the category that
    # holds it: the structure is on the ground even though nothing was claimed of it.
    # Filing stamps the row with the wall clock, so this window is the case's life.
    filed = client.get(
        f"/api/cases/{case_id}/timeline/map",
        params={"from": "2000-01-01", "to": "2999-01-01", "category": "case_activity"},
    ).json()
    sited = {item["owner_id"]: item for item in filed["items"]}
    assert [place["id"] for place in sited[shed["id"]]["place_entities"]] == [yard["id"]]

    # The owner travels with the mark, so the card can hand the row back to the tool
    # that owns it and show a photograph as a photograph.
    owner = placed[photo["id"]]["owner"]
    assert owner["type"] == "media"
    assert owner["attrs"]["path"] == "media/quay.jpg"

    # Categories are the caller's, not this route's: asking for statements alone
    # leaves the photograph out.
    claims_only = client.get(
        f"/api/cases/{case_id}/timeline/map", params={**window, "category": "statement"}
    ).json()
    assert photo["id"] not in {item["owner_id"] for item in claims_only["items"]}

    bad = client.get(
        f"/api/cases/{case_id}/timeline/map", params={**window, "category": "nonsense"}
    )
    assert bad.status_code == 400


def test_fact_time_filter_is_not_the_filing_date_filter(client):
    case_id = _case(client, "Separate time meanings")
    claim = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "Historical event", "when": "1999-01-01"},
    ).json()["entity"]

    response = client.get(
        f"/api/cases/{case_id}/catalog/entities",
        params={
            "temporal_from": "1999-01-01",
            "temporal_to": "1999-01-01",
            "temporal_category": "statement",
        },
    )
    assert response.status_code == 200, response.text
    assert [entity["id"] for entity in response.json()["items"]] == [claim["id"]]

    filed = client.get(
        f"/api/cases/{case_id}/catalog/entities",
        params={"since": "1999-01-01", "until": "1999-01-01"},
    )
    assert filed.status_code == 200, filed.text
    assert filed.json()["items"] == []
