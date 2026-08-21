"""Saved analysis readings: live recipes, immutable captures and Trash."""

from __future__ import annotations

import io

from PIL import Image


def _case(client, name: str = "View case") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _entity(client, case_id: str, type_: str, label: str, attrs=None) -> dict:
    response = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": type_, "label": label, "attrs": attrs or {}},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _body(name: str, *, mode: str = "live", surface: str = "board") -> dict:
    return {
        "name": name,
        "mode": mode,
        "surface": surface,
        "spec": {
            "query": {
                "filter": {"q": "AB-123", "types": ["vehicle"]},
                "terms": {"q": "AB-123", "type": "vehicle"},
                "label": "AB-123 · Type: Vehicle",
            },
            "board": {"order": "label"},
            "timeline": {"from": None, "to": None, "field": None},
        },
    }


def test_live_view_crud_and_bounded_list(client):
    case_id = _case(client)
    created = client.post(
        f"/api/cases/{case_id}/analysis-views", json=_body("Plate watch")
    )
    assert created.status_code == 200, created.text
    view = created.json()
    assert view["mode"] == "live"
    assert view["snapshot_count"] == 0
    # A Board or Graph view saves the period it was read through, and which temporal
    # categories that period is asked of. Unset means the two the case states itself.
    assert view["spec"]["timeline"] == {
        "from": None,
        "to": None,
        "field": None,
        "categories": ["statement", "media"],
    }

    listing = client.get(f"/api/cases/{case_id}/analysis-views").json()["views"]
    assert listing == [{key: value for key, value in view.items() if key != "spec"}]

    duplicate = client.post(
        f"/api/cases/{case_id}/analysis-views", json=_body("plate WATCH")
    )
    assert duplicate.status_code == 409

    changed = _body("Plate watch updated", surface="graph")
    changed["spec"]["graph"] = {
        "lens": "all",
        "omitted": ["e_hidden"],
        "collapsed": ["e_folded"],
        "arrangement": [{"id": "e_pinned", "x": 120.5, "y": -42.0}],
        "camera": {"x": 18.0, "y": 24.0, "zoom": 1.25},
    }
    updated = client.put(
        f"/api/cases/{case_id}/analysis-views/{view['id']}", json=changed
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["surface"] == "graph"
    assert updated.json()["created_at"] == view["created_at"]
    assert updated.json()["spec"]["graph"] == changed["spec"]["graph"]


def test_snapshot_keeps_captured_entities_and_relations_after_live_delete(client):
    case_id = _case(client)
    truck = _entity(client, case_id, "vehicle", "White pickup", {"plate": "AB-123-CD"})
    place = _entity(client, case_id, "organization", "Checkpoint team")
    link = client.post(
        f"/api/cases/{case_id}/links",
        json={"from_id": place["id"], "to_id": truck["id"], "type": "owns"},
    )
    assert link.status_code == 200, link.text

    body = _body("Captured plate", mode="snapshot", surface="graph")
    # Capture the exact drawing rather than the query-only match, so its context
    # relation and far end are frozen with it.
    body["spec"]["capture_ids"] = [truck["id"], place["id"]]
    saved = client.post(
        f"/api/cases/{case_id}/analysis-views", json=body
    )
    assert saved.status_code == 200, saved.text
    view = saved.json()
    assert view["snapshot_count"] == 2
    assert len(view["spec"]["snapshot"]["links"]) == 1

    duplicate = client.post(
        f"/api/cases/{case_id}/analysis-views/{view['id']}/duplicate",
        json={"name": "Captured plate copy"},
    )
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json()["id"] != view["id"]
    assert duplicate.json()["spec"]["snapshot"] == view["spec"]["snapshot"]

    update = client.put(
        f"/api/cases/{case_id}/analysis-views/{view['id']}", json=body
    )
    assert update.status_code == 409
    assert "immutable" in update.json()["detail"]

    other_case = _case(client, "Other case")
    imported = _body("Detached capture", mode="snapshot", surface="graph")
    imported["spec"]["snapshot"] = view["spec"]["snapshot"]
    refused = client.post(
        f"/api/cases/{other_case}/analysis-views", json=imported
    )
    assert refused.status_code == 400
    assert "duplicated inside its case" in refused.json()["detail"]

    deleted = client.delete(f"/api/cases/{case_id}/entities/{truck['id']}")
    assert deleted.status_code == 200, deleted.text

    page = client.get(
        f"/api/cases/{case_id}/catalog/entities",
        params={"view": view["id"], "limit": 100},
    )
    assert page.status_code == 200, page.text
    assert {row["label"] for row in page.json()["items"]} == {
        "White pickup", "Checkpoint team"
    }

    graph = client.get(
        f"/api/cases/{case_id}/graph", params={"view": view["id"]}
    )
    assert graph.status_code == 200, graph.text
    assert graph.json()["snapshot"] is True
    assert {row["label"] for row in graph.json()["nodes"]} == {
        "White pickup", "Checkpoint team"
    }
    assert len(graph.json()["links"]) == 1


def test_snapshot_query_is_broad_search_and_explains_the_matching_field(client):
    case_id = _case(client)
    _entity(client, case_id, "vehicle", "White pickup", {"plate": "AB-123-CD"})
    saved = client.post(
        f"/api/cases/{case_id}/analysis-views",
        json=_body("Plate snapshot", mode="snapshot"),
    )
    assert saved.status_code == 200, saved.text
    view = saved.json()
    assert view["snapshot_count"] == 1

    page = client.get(
        f"/api/cases/{case_id}/catalog/entities",
        params={"view": view["id"], "q": "AB-123"},
    ).json()
    assert page["items"][0]["matches"] == [
        {"field": "plate", "label": "Plate", "value": "AB-123-CD"}
    ]


def test_snapshot_embeds_gallery_previews_for_read_only_details(client):
    case_id = _case(client)
    person = _entity(client, case_id, "person", "Captured witness", {"role": "observer"})
    pixels = io.BytesIO()
    Image.new("RGB", (48, 36), (30, 60, 90)).save(pixels, "PNG")
    uploaded = client.post(
        f"/api/cases/{case_id}/entities/{person['id']}/images/upload",
        files={"file": ("portrait.png", io.BytesIO(pixels.getvalue()), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    body = _body("Witness photo", mode="snapshot")
    body["spec"]["capture_ids"] = [person["id"]]

    saved = client.post(f"/api/cases/{case_id}/analysis-views", json=body)
    assert saved.status_code == 200, saved.text
    captured = saved.json()["spec"]["snapshot"]["entities"][0]
    assert captured["attrs"]["role"] == "observer"
    assert captured["thumb"].startswith("data:image/jpeg;base64,")
    assert captured["snapshot_images"][0]["title"] == "portrait"

    assert client.delete(
        f"/api/cases/{case_id}/entities/{person['id']}"
    ).status_code == 200
    frozen = client.get(
        f"/api/cases/{case_id}/catalog/entities",
        params={"view": saved.json()["id"]},
    ).json()["items"][0]
    assert frozen["thumb"] == captured["thumb"]
    assert frozen["snapshot_images"] == captured["snapshot_images"]


def test_deleted_view_goes_to_trash_and_restores(client):
    case_id = _case(client)
    view = client.post(
        f"/api/cases/{case_id}/analysis-views", json=_body("Recover me")
    ).json()

    deleted = client.delete(
        f"/api/cases/{case_id}/analysis-views/{view['id']}"
    )
    assert deleted.status_code == 200, deleted.text
    group = deleted.json()["trash"]
    assert client.get(
        f"/api/cases/{case_id}/analysis-views/{view['id']}"
    ).status_code == 404

    trash = client.get(f"/api/cases/{case_id}/trash").json()
    assert trash["groups"][0]["type"] == "analysis-view"
    restored = client.post(
        f"/api/cases/{case_id}/trash/{group}/restore", json={}
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["analysis_views"] == 1
    assert client.get(
        f"/api/cases/{case_id}/analysis-views/{view['id']}"
    ).status_code == 200


def test_a_board_snapshot_freezes_the_period_it_was_read_through(client):
    """A Board view saved with a fact-time period captures what that period holds.

    The window is written as a reduced date, which is where a capture and the live
    question can disagree: `2024-03` is the whole of March on the axis, and a snapshot
    that stopped at its first instant would freeze an emptier case than the one the
    analyst was looking at.
    """
    case_id = _case(client, "Board period")
    person = _entity(client, case_id, "person", "Witness")
    march = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={
            "statement": "Witness reached the gate",
            "when": "2024-03-05T10:00:00Z",
            "about": [person["id"]],
        },
    ).json()
    april = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={"statement": "Later event", "when": "2024-04-05T10:00:00Z"},
    ).json()

    body = {
        "name": "March",
        "mode": "snapshot",
        "surface": "board",
        "spec": {
            "query": {"filter": {}, "terms": {}, "label": ""},
            "board": {"order": "label"},
            "timeline": {
                "from": "2024-03",
                "to": "2024-03",
                "field": "fact-time",
                "categories": ["statement"],
            },
        },
    }
    created = client.post(f"/api/cases/{case_id}/analysis-views", json=body)
    assert created.status_code == 200, created.text
    view = created.json()
    assert view["spec"]["timeline"]["from"] == "2024-03"

    frozen = client.get(
        f"/api/cases/{case_id}/catalog/entities", params={"view": view["id"]}
    )
    assert frozen.status_code == 200, frozen.text
    frozen_ids = {entity["id"] for entity in frozen.json()["items"]}
    assert frozen_ids == {march["entity"]["id"], person["id"]}
    assert april["entity"]["id"] not in frozen_ids

    # And it froze what the live question over the same period answers, rather than
    # its own reading of the boundaries.
    live = client.get(
        f"/api/cases/{case_id}/catalog/entities",
        params={
            "temporal_from": "2024-03",
            "temporal_to": "2024-03",
            "temporal_category": "statement",
        },
    )
    assert live.status_code == 200, live.text
    assert {entity["id"] for entity in live.json()["items"]} == frozen_ids


def test_a_saved_period_that_is_not_a_date_is_refused(client):
    case_id = _case(client, "Bad period")
    body = {
        "name": "Nonsense",
        "mode": "snapshot",
        "surface": "board",
        "spec": {
            "query": {"filter": {}, "terms": {}, "label": ""},
            "timeline": {"from": "last tuesday", "to": "2024-03", "categories": ["statement"]},
        },
    }
    refused = client.post(f"/api/cases/{case_id}/analysis-views", json=body)
    assert refused.status_code == 400, refused.text


def test_timeline_snapshot_freezes_rows_and_track_assignments(client):
    """A snapshot captures the window it was read through, track by track.

    The window is in the past so the run date cannot change the answer: the case
    activity of a case filed today falls outside it, which is exactly why the second
    track comes back empty.
    """
    case_id = _case(client, "Timeline snapshot")
    person = _entity(client, case_id, "person", "Witness")
    saved_claim = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={
            "statement": "Witness reached the gate",
            "when": "2024-03-05T10:00:00Z",
            "about": [person["id"]],
        },
    )
    assert saved_claim.status_code == 200, saved_claim.text
    temporal_id = saved_claim.json()["temporal"]["id"]
    body = {
        "name": "Frozen chronology",
        "mode": "snapshot",
        "surface": "timeline",
        "spec": {
            "query": {"filter": {}, "terms": {}, "label": ""},
            "timeline": {
                "from": "2024-03-05T00:00:00Z",
                "to": "2024-03-06T00:00:00Z",
                "timezone": "Europe/Paris",
                "zone_choice": "machine",
                "group_by": "subject",
                "visible_categories": ["statement"],
                "tracks": [
                    {
                        "id": "people",
                        "label": "People",
                        "categories": ["statement"],
                        "query": {
                            "filter": {"types": ["person"]},
                            "terms": {"type": "person"},
                            "relation": "about",
                        },
                        "collapsed": False,
                        "hidden": [],
                        "pinned": [temporal_id],
                    },
                    {
                        "id": "activity",
                        "label": "Case activity",
                        "categories": ["case_activity"],
                    },
                ],
            },
        },
    }
    response = client.post(f"/api/cases/{case_id}/analysis-views", json=body)
    assert response.status_code == 200, response.text
    view = response.json()
    assert view["snapshot_count"] == 1
    assert view["spec"]["timeline"]["timezone"] == "Europe/Paris"
    assert view["spec"]["timeline"]["zone_choice"] == "machine"
    assert view["spec"]["snapshot"]["timeline_tracks"] == {
        "people": [temporal_id],
        "activity": [],
    }
    frozen = view["spec"]["snapshot"]["timeline_items"][0]
    assert frozen["label"] == "Witness reached the gate"
    assert frozen["subject_entities"][0]["label"] == "Witness"

    claim_id = saved_claim.json()["entity"]["id"]
    assert client.delete(f"/api/cases/{case_id}/entities/{claim_id}").status_code == 200
    reopened = client.get(
        f"/api/cases/{case_id}/analysis-views/{view['id']}"
    ).json()
    assert reopened["spec"]["snapshot"]["timeline_items"][0] == frozen

    duplicate = client.post(
        f"/api/cases/{case_id}/analysis-views/{view['id']}/duplicate",
        json={"name": "Frozen chronology copy"},
    )
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json()["spec"]["snapshot"] == view["spec"]["snapshot"]


def test_a_track_captures_the_case_activity_it_asks_for(client):
    """Tracks own category selection: there is no second global switch above them.

    A lane declaring `case_activity` therefore freezes the filing dates, while a lane
    declaring `statement` beside it freezes only the Claim.
    """
    case_id = _case(client, "Activity track")
    person = _entity(client, case_id, "person", "Witness")
    claim = client.post(
        f"/api/cases/{case_id}/timeline/claims",
        json={
            "statement": "Witness reached the gate",
            "when": "2024-03-05T10:00:00Z",
            "about": [person["id"]],
        },
    )
    assert claim.status_code == 200, claim.text

    created = client.post(
        f"/api/cases/{case_id}/analysis-views",
        json={
            "name": "Everything",
            "mode": "snapshot",
            "surface": "timeline",
            "spec": {
                "timeline": {
                    "tracks": [
                        {"id": "events", "label": "Events", "categories": ["statement"]},
                        {
                            "id": "activity",
                            "label": "Case activity",
                            "categories": ["case_activity"],
                        },
                    ],
                },
            },
        },
    )
    assert created.status_code == 200, created.text
    snapshot = created.json()["spec"]["snapshot"]

    assert snapshot["timeline_tracks"] == {
        "events": [claim.json()["temporal"]["id"]],
        "activity": [f"temporal:activity:{person['id']}:filed"],
    }
    assert created.json()["snapshot_count"] == 2


def test_empty_timeline_snapshot_duplicates_without_changing_its_tracks(client):
    case_id = _case(client, "Empty Timeline snapshot")
    created = client.post(
        f"/api/cases/{case_id}/analysis-views",
        json={
            "name": "Empty chronology",
            "mode": "snapshot",
            "surface": "timeline",
            "spec": {
                "timeline": {
                    "tracks": [{
                        "id": "events",
                        "label": "Events",
                        "categories": ["statement"],
                    }],
                },
            },
        },
    )
    assert created.status_code == 200, created.text
    view = created.json()
    assert view["spec"]["snapshot"]["timeline_tracks"] == {"events": []}

    duplicate = client.post(
        f"/api/cases/{case_id}/analysis-views/{view['id']}/duplicate",
        json={"name": "Empty chronology copy"},
    )
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json()["spec"]["snapshot"] == view["spec"]["snapshot"]


def test_a_name_is_claimed_inside_its_own_family(client):
    """Board and Graph share one list of views; the Timeline has its own.

    Refusing a name because it is taken on a list the analyst cannot see from here is
    worse than allowing the repeat, so the check is scoped to the family.
    """
    case_id = _case(client, "Two families")
    board = client.post(f"/api/cases/{case_id}/analysis-views", json=_body("Week one"))
    assert board.status_code == 200, board.text

    graph = client.post(
        f"/api/cases/{case_id}/analysis-views", json=_body("week ONE", surface="graph")
    )
    assert graph.status_code == 409

    timeline = client.post(
        f"/api/cases/{case_id}/analysis-views",
        json={
            "name": "Week one",
            "mode": "live",
            "surface": "timeline",
            "spec": {"timeline": {"tracks": []}},
        },
    )
    assert timeline.status_code == 200, timeline.text
    assert timeline.json()["surface"] == "timeline"

    names = {
        (view["surface"], view["name"])
        for view in client.get(f"/api/cases/{case_id}/analysis-views").json()["views"]
    }
    assert names == {("board", "Week one"), ("timeline", "Week one")}


def test_renaming_a_view_leaves_the_reading_it_holds_alone(client):
    """A label is not a reading, so both modes accept a rename.

    The `PUT` a live view saves through refuses a snapshot on purpose — its capture is
    evidence. Renaming has to reach it anyway, or a frozen reading is stuck with the
    name it was given, and the answer stays the menu row rather than the whole capture.
    """
    case_id = _case(client, "Renaming")
    truck = _entity(client, case_id, "vehicle", "White pickup", {"plate": "AB-123-CD"})
    live = client.post(
        f"/api/cases/{case_id}/analysis-views", json=_body("Plate watch")
    ).json()
    body = _body("Captured plate", mode="snapshot")
    body["spec"]["capture_ids"] = [truck["id"]]
    snapshot = client.post(f"/api/cases/{case_id}/analysis-views", json=body).json()

    renamed = client.patch(
        f"/api/cases/{case_id}/analysis-views/{live['id']}", json={"name": "  Plates  "}
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Plates"
    # The row a menu reads, not the recipe: a rename ships no spec back.
    assert "spec" not in renamed.json()
    assert renamed.json()["created_at"] == live["created_at"]
    assert renamed.json()["updated_at"] >= live["updated_at"]
    assert client.get(
        f"/api/cases/{case_id}/analysis-views/{live['id']}"
    ).json()["spec"] == live["spec"]

    frozen = client.patch(
        f"/api/cases/{case_id}/analysis-views/{snapshot['id']}",
        json={"name": "Plate capture"},
    )
    assert frozen.status_code == 200, frozen.text
    assert frozen.json()["name"] == "Plate capture"
    assert frozen.json()["snapshot_count"] == 1
    reread = client.get(f"/api/cases/{case_id}/analysis-views/{snapshot['id']}").json()
    assert reread["spec"]["snapshot"] == snapshot["spec"]["snapshot"]

    # A name still belongs to one view of the family, and a whitespace-only name is
    # not a name.
    taken = client.patch(
        f"/api/cases/{case_id}/analysis-views/{snapshot['id']}", json={"name": "plates"}
    )
    assert taken.status_code == 409
    assert client.patch(
        f"/api/cases/{case_id}/analysis-views/{live['id']}", json={"name": "   "}
    ).status_code == 400
    assert client.patch(
        f"/api/cases/{case_id}/analysis-views/{live['id']}", json={"name": ""}
    ).status_code == 422
    assert client.patch(
        f"/api/cases/{case_id}/analysis-views/v_missing", json={"name": "Nowhere"}
    ).status_code == 404
    # Keeping its own name is not a clash with itself.
    assert client.patch(
        f"/api/cases/{case_id}/analysis-views/{live['id']}", json={"name": "Plates"}
    ).status_code == 200


def test_a_renamed_view_keeps_its_name_across_a_family(client):
    """The two lists are separate namespaces for a rename as much as for a save."""
    case_id = _case(client, "Rename across families")
    board = client.post(
        f"/api/cases/{case_id}/analysis-views", json=_body("Week one")
    ).json()
    timeline = client.post(
        f"/api/cases/{case_id}/analysis-views",
        json={
            "name": "Tracks", "mode": "live", "surface": "timeline",
            "spec": {"timeline": {"tracks": []}},
        },
    ).json()

    renamed = client.patch(
        f"/api/cases/{case_id}/analysis-views/{timeline['id']}", json={"name": "Week one"}
    )
    assert renamed.status_code == 200, renamed.text
    assert {
        (view["surface"], view["name"])
        for view in client.get(f"/api/cases/{case_id}/analysis-views").json()["views"]
    } == {("board", "Week one"), ("timeline", "Week one")}
    assert board["name"] == "Week one"


def test_a_timeline_view_keeps_the_clock_and_the_colours_it_was_read_with(client):
    case_id = _case(client, "Zone and colour")
    body = {
        "name": "Tokyo reading",
        "mode": "live",
        "surface": "timeline",
        "spec": {
            "timeline": {
                "timezone": "Asia/Tokyo",
                "zone_choice": "zone:Asia/Tokyo",
                "tracks": [
                    {
                        "id": "vessels",
                        "label": "Vessels",
                        "categories": ["statement"],
                        "color": "blue",
                    },
                    {
                        "id": "media",
                        "label": "Media",
                        "categories": ["media"],
                        "color": "chartreuse",
                    },
                ],
            },
        },
    }
    created = client.post(f"/api/cases/{case_id}/analysis-views", json=body)
    assert created.status_code == 200, created.text
    timeline = created.json()["spec"]["timeline"]

    # a zone named outright travels: the view was read on it and must reopen on it
    assert timeline["zone_choice"] == "zone:Asia/Tokyo"
    assert [track["color"] for track in timeline["tracks"]] == ["blue", ""]

    for refused in ("zone:../../etc/passwd", "zone:", "somewhere else"):
        body["spec"]["timeline"]["zone_choice"] = refused
        answer = client.put(
            f"/api/cases/{case_id}/analysis-views/{created.json()['id']}", json=body
        )
        assert answer.status_code == 200, answer.text
        assert answer.json()["spec"]["timeline"]["zone_choice"] == "utc"
