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
    assert view["spec"]["timeline"] == {"from": None, "to": None, "field": None}

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
