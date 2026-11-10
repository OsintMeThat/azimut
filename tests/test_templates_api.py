"""Templates API: workspace-level proof/post presets, CRUD + guard rails."""

from __future__ import annotations

import json
from pathlib import Path

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
        {"footerText": "false"},
        {"footerCoords": 1},
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


def test_post_template_mention_holds_several_full_handles(client):
    mention = "@geoconfirmed.org @uacontrolmap.bsky.social @ukrainedailyupdate.bsky.social"
    response = client.post(
        "/api/templates/post", json={"name": "Handles", "data": {"mention": mention}}
    )
    assert response.status_code == 200
    assert response.json()["data"]["mention"] == mention


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


def test_a_style_stored_before_the_footer_switches_reads_as_it_looked(client):
    """The credit line goes on printing, the coordinates go on not printing."""
    saved = client.post(
        "/api/templates/proof",
        json={"name": "Old house style", "data": {"bg": "#101418"}},
    ).json()

    assert saved["data"]["footerText"] is True
    assert saved["data"]["footerCoords"] is False


def test_a_style_carries_what_the_plate_prints(client):
    saved = client.post(
        "/api/templates/proof",
        json={"name": "Points on the plate", "data": {"footerText": False, "footerCoords": True}},
    ).json()

    assert saved["data"]["footerText"] is False
    assert saved["data"]["footerCoords"] is True


def test_a_style_carries_its_typeface_and_a_style_from_before_keeps_the_system_one(client):
    saved = client.post(
        "/api/templates/proof",
        json={"name": "Condensed", "data": {"font": "barlow", "fontBold": False}},
    ).json()
    assert saved["data"]["font"] == "barlow"
    assert saved["data"]["fontBold"] is False

    older = client.post("/api/templates/proof", json={"name": "Before fonts", "data": {"bg": "#101418"}}).json()
    assert older["data"]["font"] == "system"
    assert older["data"]["fontBold"] is True


def test_a_typeface_the_app_does_not_ship_is_refused(client):
    response = client.post("/api/templates/proof", json={"name": "Comic", "data": {"font": "comic-sans"}})
    assert response.status_code == 422


def test_a_proof_template_keeps_its_caption_colour(client):
    saved = client.post(
        "/api/templates/proof",
        json={"name": "Amber captions", "data": {"captionColor": "#FFD740"}},
    ).json()
    assert saved["data"]["captionColor"] == "#ffd740"

    older = client.post("/api/templates/proof", json={"name": "Auto captions", "data": {}}).json()
    assert older["data"]["captionColor"] is None
    refused = client.post("/api/templates/proof", json={"name": "Bad", "data": {"captionColor": "amber"}})
    assert refused.status_code == 422


# -- styles stored before the scene keys and the Azimut mark ------------------

FIXTURE = Path(__file__).parent / "fixtures" / "proof-templates-0.3.3.json"


def test_proof_templates_from_before_read_and_save_back_as_written(client):
    """A templates.json written by 0.3.3 lists, and saves again, byte for byte.

    The fixture holds what the editor never shows (a dragged logo's offsets and
    ratios, a handle's opacity, a stack direction under free layout), so a save
    that dropped or reset any of them would show here.
    """
    stored = json.loads(FIXTURE.read_text(encoding="utf-8"))
    config.save_templates(stored)

    listed = client.get("/api/templates").json()["proof"]
    assert [t["data"] for t in listed] == [t["data"] for t in stored["proof"]]

    for record in stored["proof"]:
        saved = client.post(
            "/api/templates/proof",
            json={"id": record["id"], "name": record["name"], "data": record["data"]},
        )
        assert saved.status_code == 200, saved.text
        assert json.dumps(saved.json()["data"]) == json.dumps(record["data"])

    on_disk = json.loads(config.templates_path().read_text(encoding="utf-8"))["proof"]
    assert [json.dumps(t["data"]) for t in on_disk] == [json.dumps(t["data"]) for t in stored["proof"]]
    assert [t["id"] for t in on_disk] == [t["id"] for t in stored["proof"]]


def test_a_style_says_nothing_about_the_scene_keys_until_it_is_told(client):
    older = client.post("/api/templates/proof", json={"name": "Before", "data": {"bg": "#101418"}}).json()
    for key in ("sceneBadge", "footerCredits", "azimutMark"):
        assert key not in older["data"]

    stated = client.post(
        "/api/templates/proof",
        json={"name": "Series", "data": {"sceneBadge": True, "footerCredits": False}},
    ).json()
    assert stated["data"]["sceneBadge"] is True
    assert stated["data"]["footerCredits"] is False

    unset = client.post(
        "/api/templates/proof",
        json={"name": "Unset", "data": {"sceneBadge": None, "footerCredits": None, "azimutMark": None}},
    ).json()
    for key in ("sceneBadge", "footerCredits", "azimutMark"):
        assert key not in unset["data"]


def test_a_style_can_carry_the_azimut_mark(client):
    saved = client.post(
        "/api/templates/proof",
        json={"name": "Marked", "data": {"azimutMark": {"anchor": "tl", "show": "logo"}}},
    ).json()
    assert saved["data"]["azimutMark"] == {"anchor": "tl", "show": "logo", "size": 28.0}
    plain = client.post("/api/templates/proof", json={"name": "Lockup", "data": {"azimutMark": {}}}).json()
    assert plain["data"]["azimutMark"] == {"anchor": "br", "show": "both", "size": 28.0}


@pytest.mark.parametrize(
    "data",
    [
        {"sceneBadge": "yes"},
        {"footerCredits": 1},
        {"azimutMark": True},
        {"azimutMark": {"anchor": "middle"}},
        {"azimutMark": {"size": 4}},
        {"azimutMark": {"show": "icon"}},
        {"azimutMark": {"show": True}},
    ],
)
def test_unreadable_scene_keys_and_marks_are_refused(client, data):
    assert client.post("/api/templates/proof", json={"name": "Bad", "data": data}).status_code == 422


# -- post templates: a kind, a reply variant, and the ones from before --------------

POST_FIXTURE = Path(__file__).parent / "fixtures" / "post-templates-0.3.3.json"


def test_post_templates_from_before_read_and_save_back_as_written(client):
    """A 0.3.3 thread layout has no kind and no reply variant: it lists as written, saves
    back byte for byte, and gains neither key on the way (a Geolocation one, unchanged)."""
    stored = json.loads(POST_FIXTURE.read_text(encoding="utf-8"))
    config.save_templates(stored)

    listed = client.get("/api/templates").json()["post"]
    assert [t["data"] for t in listed] == [t["data"] for t in stored["post"]]

    for record in stored["post"]:
        saved = client.post(
            "/api/templates/post",
            json={"id": record["id"], "name": record["name"], "data": record["data"]},
        )
        assert saved.status_code == 200, saved.text
        assert json.dumps(saved.json()["data"]) == json.dumps(record["data"])
        assert "kind" not in saved.json()["data"] and "reply" not in saved.json()["data"]

    on_disk = json.loads(config.templates_path().read_text(encoding="utf-8"))["post"]
    assert [json.dumps(t["data"]) for t in on_disk] == [json.dumps(t["data"]) for t in stored["post"]]


def test_a_post_template_can_say_its_kind_and_to_reply_by_default(client):
    plate = client.post(
        "/api/templates/post",
        json={"name": "Plate", "data": {"body": "#description\n\n#credits", "kind": "plate", "reply": True}},
    )
    assert plate.status_code == 200, plate.text
    assert plate.json()["data"]["kind"] == "plate"
    assert plate.json()["data"]["reply"] is True

    # Geolocation is what saying nothing means, so it has the one spelling; so is no reply
    geo = client.post("/api/templates/post", json={"name": "Geo", "data": {"kind": "geolocation", "reply": False}}).json()
    assert "kind" not in geo["data"] and "reply" not in geo["data"]

    for bad in ({"kind": "telegram"}, {"reply": "maybe"}, {"reply": 1}):
        assert client.post("/api/templates/post", json={"name": "Bad", "data": bad}).status_code == 422


def test_a_template_from_the_first_reply_builds_still_lists(client):
    """The first 0.3.4 builds stored whether a reply kept its source line. Neither word
    asks for a reply, so the template lists, reads as no default, and saves back without it."""
    config.save_templates({"schema": 1, "proof": [], "map": [], "note": [], "post": [
        {"id": "po_keep", "name": "Keep", "data": {"body": "#place", "reply": "keep-source"}},
        {"id": "po_drop", "name": "Drop", "data": {"body": "#place", "reply": "drop-source"}},
    ]})
    listed = client.get("/api/templates").json()["post"]
    assert [t["id"] for t in listed] == ["po_keep", "po_drop"]
    assert all("reply" not in t["data"] for t in listed)