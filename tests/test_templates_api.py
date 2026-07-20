"""Templates API: workspace-level proof/post presets, CRUD + guard rails."""

from __future__ import annotations

import json

import pytest

from azimut import config


def test_list_empty_by_default(client):
    r = client.get("/api/templates")
    assert r.status_code == 200
    body = r.json()
    assert body["proof"] == []
    assert body["post"] == []


def test_create_edit_delete_proof_template(client):
    created = client.post(
        "/api/templates/proof",
        json={"name": "House dark", "data": {"bg": "#0d1117", "footer": "By me"}},
    )
    assert created.status_code == 200
    rec = created.json()
    assert rec["id"]
    assert rec["name"] == "House dark"
    assert rec["data"]["footer"] == "By me"

    # it shows up in the list
    listed = client.get("/api/templates").json()["proof"]
    assert [t["id"] for t in listed] == [rec["id"]]

    # editing in place keeps the id, updates fields
    edited = client.post(
        "/api/templates/proof",
        json={"id": rec["id"], "name": "House light", "data": {"bg": "#ffffff"}},
    )
    assert edited.status_code == 200
    assert edited.json()["id"] == rec["id"]
    assert edited.json()["name"] == "House light"
    assert client.get("/api/templates").json()["proof"][0]["data"]["bg"] == "#ffffff"

    # delete
    gone = client.delete(f"/api/templates/proof/{rec['id']}")
    assert gone.status_code == 200 and gone.json()["deleted"] is True
    assert client.get("/api/templates").json()["proof"] == []


def test_kinds_are_separate(client):
    client.post("/api/templates/proof", json={"name": "P", "data": {}})
    client.post("/api/templates/post", json={"name": "T", "data": {"mediaEnabled": False}})
    body = client.get("/api/templates").json()
    assert len(body["proof"]) == 1 and len(body["post"]) == 1
    assert body["post"][0]["data"]["mediaEnabled"] is False


def test_unknown_kind_rejected(client):
    assert client.post("/api/templates/bogus", json={"name": "x", "data": {}}).status_code == 404
    assert client.delete("/api/templates/bogus/whatever").status_code == 404


def test_edit_missing_id_is_404(client):
    r = client.post(
        "/api/templates/proof", json={"id": "deadbeef", "name": "x", "data": {}}
    )
    assert r.status_code == 404


def test_oversize_data_rejected(client):
    big = {"blob": "x" * (64 * 1024 + 1)}
    r = client.post("/api/templates/proof", json={"name": "big", "data": big})
    assert r.status_code == 413


def test_per_kind_cap(client):
    for i in range(50):
        assert client.post(
            "/api/templates/proof", json={"name": f"t{i}", "data": {}}
        ).status_code == 200
    overflow = client.post("/api/templates/proof", json={"name": "one too many", "data": {}})
    assert overflow.status_code == 409


def test_delete_missing_returns_false(client):
    assert client.delete("/api/templates/proof/nope").json()["deleted"] is False


def test_templates_live_beside_settings_not_in_a_case(client, monkeypatch):
    client.post("/api/templates/proof", json={"name": "P", "data": {"footer": "hi"}})
    # stored in the workspace-level file, not settings.json
    path = config.templates_path()
    assert path.exists()
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert stored["proof"][0]["name"] == "P"
    assert "proof" not in config.load_settings()


@pytest.mark.parametrize(
    "data",
    [
        {"captionSize": 1e308},
        {"space": {"gap": -1}},
        {"space": []},
        {"layout": "stacked"},
        {"bg": "red"},
        {"signature": {"scale": 2}},
        {"signatureText": {"size": 0}},
        {"footerEnabled": "false"},
    ],
)
def test_invalid_proof_render_values_are_rejected(client, data):
    response = client.post("/api/templates/proof", json={"name": "Unsafe", "data": data})
    assert response.status_code == 422


@pytest.mark.parametrize("constant", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_json_numbers_are_rejected(client, constant):
    response = client.post(
        "/api/templates/proof",
        content=f'{{"name":"Unsafe","data":{{"captionSize":{constant}}}}}',
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 422


def test_template_data_is_canonical_and_content_free(client):
    response = client.post(
        "/api/templates/proof",
        json={
            "name": "Canonical",
            "data": {"bg": "#AABBCC", "panels": [{"src": "media/private.png"}]},
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["bg"] == "#aabbcc"
    assert "panels" not in data


def test_post_template_tweet_count_is_bounded(client):
    response = client.post(
        "/api/templates/post",
        json={
            "name": "Too many",
            "data": {"extraTweets": [{"text": str(i)} for i in range(21)]},
        },
    )
    assert response.status_code == 422


def test_whitespace_only_names_are_rejected_on_create_and_edit(client):
    created = client.post("/api/templates/proof", json={"name": "Good", "data": {}})
    assert created.status_code == 200
    assert client.post(
        "/api/templates/proof", json={"name": "   ", "data": {}}
    ).status_code == 422
    assert client.post(
        "/api/templates/proof",
        json={"id": created.json()["id"], "name": "\t ", "data": {}},
    ).status_code == 422


def test_invalid_hand_edited_template_is_not_returned(client):
    config.save_templates(
        {
            "schema": 1,
            "proof": [
                {
                    "id": "broken",
                    "name": "Broken",
                    "data": {"space": {"gap": -1}},
                    "updated_at": "2026-07-20T00:00:00Z",
                }
            ],
            "post": [],
        }
    )
    assert client.get("/api/templates").json()["proof"] == []
