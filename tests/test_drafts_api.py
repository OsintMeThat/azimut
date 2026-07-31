"""Post drafts: save state, list, reload, entity upsert, delete."""

import pytest

import graph_read

STATE = {
    "description": "A formation of 13 helicopters was spotted heading East",
    "coordsText": "10.303315, -66.874095",
    "place": "Los Anacuos, Miranda, Venezuela",
    "mention": "@GeoConfirmed",
    "source": "https://instagram.com/urreiztieta_ne",
    "target": "bluesky",
    "tweet1": "Los Anacuos, Miranda, Venezuela - 843G+89C",
    "mediaEnabled": True,
    "mediaType": "video",
    "mediaText": "",
    "mediaPath": "media/clip.mp4",
    "extraTweets": [{"id": 1, "text": "More context here"}],
}


def test_save_load_roundtrip(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]

    saved = client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "Helicopter formation", "state": STATE},
    ).json()
    assert saved["name"] == "Helicopter formation"
    assert saved["draft"] == ".drafts/Helicopter formation.json"

    listed = client.get(f"/api/cases/{cid}/drafts").json()
    assert len(listed) == 1
    assert listed[0]["title"] == "Helicopter formation"
    assert listed[0]["target"] == "bluesky"

    draft = client.get(f"/api/cases/{cid}/drafts/{saved['name']}").json()
    assert draft["title"] == "Helicopter formation"
    assert draft["state"]["place"] == "Los Anacuos, Miranda, Venezuela"
    assert draft["state"]["target"] == "bluesky"
    assert draft["state"]["extraTweets"][0]["text"] == "More context here"


def test_draft_filed_as_post_entity_and_updated_on_resave(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]

    saved = client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "First title", "state": STATE},
    ).json()

    # resaving the same draft updates the single entity rather than filing a new one
    client.post(
        f"/api/cases/{cid}/drafts",
        json={"rename_from": saved["name"], "title": "First title", "state": STATE},
    )
    posts = [e for e in graph_read.entities(cid) if e["type"] == "post"]
    assert len(posts) == 1
    assert posts[0]["attrs"]["draft"] == ".drafts/First title.json"


def test_draft_rename_moves_the_file_and_keeps_one_entity(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    saved = client.post(
        f"/api/cases/{cid}/drafts", json={"title": "Post 1", "state": STATE}
    ).json()
    before = next(e for e in graph_read.entities(cid) if e["type"] == "post")

    renamed = client.post(
        f"/api/cases/{cid}/drafts",
        json={"rename_from": saved["name"], "title": "Helicopter thread", "state": STATE},
    ).json()
    assert renamed["name"] == "Helicopter thread"
    assert client.get(f"/api/cases/{cid}/drafts/{saved['name']}").status_code == 404

    posts = [e for e in graph_read.entities(cid) if e["type"] == "post"]
    assert len(posts) == 1
    assert posts[0]["id"] == before["id"]
    assert posts[0]["label"] == "Helicopter thread"
    assert posts[0]["attrs"]["draft"] == ".drafts/Helicopter thread.json"


def test_draft_rename_onto_a_taken_name_is_refused(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Post 1", "state": STATE})
    second = client.post(
        f"/api/cases/{cid}/drafts", json={"title": "Post 2", "state": STATE}
    ).json()

    res = client.post(
        f"/api/cases/{cid}/drafts",
        json={"rename_from": second["name"], "title": "Post 1", "state": STATE},
    )
    assert res.status_code == 409
    listed = client.get(f"/api/cases/{cid}/drafts").json()
    assert sorted(d["name"] for d in listed) == ["Post 1", "Post 2"]


def test_created_at_preserved_on_resave_and_rename(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    saved = client.post(
        f"/api/cases/{cid}/drafts", json={"title": "Keep created", "state": STATE}
    ).json()
    first = client.get(f"/api/cases/{cid}/drafts/{saved['name']}").json()
    client.post(
        f"/api/cases/{cid}/drafts",
        json={"rename_from": saved["name"], "title": "Keep created", "state": STATE},
    )
    second = client.get(f"/api/cases/{cid}/drafts/{saved['name']}").json()
    assert first["created_at"] == second["created_at"]

    client.post(
        f"/api/cases/{cid}/drafts",
        json={"rename_from": saved["name"], "title": "Moved along", "state": STATE},
    )
    third = client.get(f"/api/cases/{cid}/drafts/Moved along").json()
    assert third["created_at"] == first["created_at"]


def test_delete_removes_file_and_entity(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    saved = client.post(
        f"/api/cases/{cid}/drafts", json={"title": "To delete", "state": STATE}
    ).json()

    r = client.delete(f"/api/cases/{cid}/drafts/{saved['name']}")
    assert r.json()["status"] == "deleted"
    assert client.get(f"/api/cases/{cid}/drafts").json() == []
    assert client.get(f"/api/cases/{cid}/drafts/{saved['name']}").status_code == 404
    posts = [e for e in graph_read.entities(cid) if e["type"] == "post"]
    assert posts == []


def test_load_missing_draft_is_404(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    assert client.get(f"/api/cases/{cid}/drafts/nope").status_code == 404


def test_draft_rejects_malformed_extra_posts_before_writing(client):
    cid = client.post("/api/cases", json={"name": "Draft bounds"}).json()["id"]
    response = client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "Bad", "state": {"extraTweets": {"text": "not an array"}}},
    )
    assert response.status_code == 422
    assert client.get(f"/api/cases/{cid}/drafts").json() == []


def test_draft_rejects_attachment_fan_out(client):
    cid = client.post("/api/cases", json={"name": "Draft bounds"}).json()["id"]
    too_many_media = client.post(
        f"/api/cases/{cid}/drafts",
        json={
            "title": "Media",
            "state": {"mediaPaths": [f"media/{index}.png" for index in range(5)]},
        },
    )
    too_many_posts = client.post(
        f"/api/cases/{cid}/drafts",
        json={
            "title": "Posts",
            "state": {"extraTweets": [{"mediaPaths": []} for _ in range(21)]},
        },
    )
    assert too_many_media.status_code == 422
    assert too_many_posts.status_code == 422


@pytest.mark.parametrize(
    "path", [None, ".", "../outside.png", "/absolute.png", "C:\\outside.png", "x" * 513]
)
def test_draft_rejects_unsafe_or_unbounded_paths(client, path):
    cid = client.post("/api/cases", json={"name": "Draft paths"}).json()["id"]
    response = client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "Bad path", "state": {"mediaPaths": [path]}},
    )
    assert response.status_code == 422
