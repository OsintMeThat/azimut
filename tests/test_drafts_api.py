"""Post drafts: save state, list, reload, entity upsert, delete."""

STATE = {
    "description": "A formation of 13 helicopters was spotted heading East",
    "coordsText": "10.303315, -66.874095",
    "place": "Los Anacuos, Miranda, Venezuela",
    "mention": "@GeoConfirmed",
    "source": "https://instagram.com/urreiztieta_ne",
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
    assert saved["name"] == "helicopter-formation"
    assert saved["draft"] == "exports/helicopter-formation.json"

    listed = client.get(f"/api/cases/{cid}/drafts").json()
    assert len(listed) == 1
    assert listed[0]["title"] == "Helicopter formation"

    draft = client.get(f"/api/cases/{cid}/drafts/helicopter-formation").json()
    assert draft["title"] == "Helicopter formation"
    assert draft["state"]["place"] == "Los Anacuos, Miranda, Venezuela"
    assert draft["state"]["extraTweets"][0]["text"] == "More context here"


def test_draft_filed_as_post_entity_and_updated_on_resave(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]

    saved = client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "First title", "state": STATE},
    ).json()

    # resave under the same name with a new title updates the single entity
    client.post(
        f"/api/cases/{cid}/drafts",
        json={"name": saved["name"], "title": "Renamed draft", "state": STATE},
    )
    posts = [e for e in client.get(f"/api/cases/{cid}").json()["entities"] if e["type"] == "post"]
    assert len(posts) == 1
    assert posts[0]["label"] == "Renamed draft"
    assert posts[0]["attrs"]["draft"] == "exports/first-title.json"


def test_created_at_preserved_on_resave(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Keep created", "state": STATE})
    first = client.get(f"/api/cases/{cid}/drafts/keep-created").json()
    client.post(
        f"/api/cases/{cid}/drafts",
        json={"name": "keep-created", "title": "Keep created", "state": STATE},
    )
    second = client.get(f"/api/cases/{cid}/drafts/keep-created").json()
    assert first["created_at"] == second["created_at"]


def test_delete_removes_file_and_entity(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    client.post(f"/api/cases/{cid}/drafts", json={"title": "To delete", "state": STATE})

    r = client.delete(f"/api/cases/{cid}/drafts/to-delete")
    assert r.json()["status"] == "deleted"
    assert client.get(f"/api/cases/{cid}/drafts").json() == []
    assert client.get(f"/api/cases/{cid}/drafts/to-delete").status_code == 404
    posts = [e for e in client.get(f"/api/cases/{cid}").json()["entities"] if e["type"] == "post"]
    assert posts == []


def test_load_missing_draft_is_404(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    assert client.get(f"/api/cases/{cid}/drafts/nope").status_code == 404
