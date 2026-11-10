"""Post drafts: save state, list, reload, entity upsert, delete."""

import pytest

import graph_read
import mediafixture

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


def test_a_draft_named_with_a_hash_is_opened_and_deleted_on_its_own(client):
    from urllib.parse import quote

    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    for title in ("Thread", "Thread #2"):
        client.post(f"/api/cases/{cid}/drafts", json={"title": title, "state": STATE})

    assert client.get(f"/api/cases/{cid}/drafts/{quote('Thread #2', safe='')}").json()["title"] == "Thread #2"
    assert client.delete(f"/api/cases/{cid}/drafts/{quote('Thread #2', safe='')}").status_code == 200

    assert [row["title"] for row in client.get(f"/api/cases/{cid}/drafts").json()] == ["Thread"]


@pytest.mark.parametrize("folded", [False, True], ids=["linux", "windows-macos"])
def test_a_change_of_case_renames_the_draft_in_place(client, monkeypatch, folded):
    import casefold

    from azimut import layout
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Thread", "state": STATE})
    if folded:
        casefold.fold_names(monkeypatch, layout.DRAFTS_DIR)

    renamed = client.post(
        f"/api/cases/{cid}/drafts", json={"title": "thread", "rename_from": "Thread", "state": STATE}
    )

    assert renamed.status_code == 200, renamed.text
    folder = Case.open(cid).tool_root / layout.DRAFTS_DIR
    assert [p.name for p in folder.glob("*.json")] == ["thread.json"]
    assert client.get(f"/api/cases/{cid}/drafts/thread").json()["state"]["place"] == STATE["place"]


def test_two_drafts_differing_only_by_case_cannot_both_be_saved(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Thread", "state": STATE})

    again = client.post(f"/api/cases/{cid}/drafts", json={"title": "thread", "state": STATE})

    assert again.status_code == 409


# -- what Post's home reads off the list ------------------------------------------


def test_the_list_says_each_drafts_kind_posts_and_what_it_posts(client):
    """Post's home lists drafts without opening them, and knows a proof has a post from a
    draft naming it, so the list carries the kind, the count and the proof or video."""
    cid = client.post("/api/cases", json={"name": "Home"}).json()["id"]
    old = dict(STATE, proofPng="proofs/strike.png")
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Old shape", "state": old})
    client.post(
        f"/api/cases/{cid}/drafts",
        json={
            "title": "Free one",
            "state": {
                "kind": "free", "tweet1": "Words", "firstMedia": ["media/a.png"],
                "mediaEnabled": False, "mediaType": "none", "extraTweets": [],
            },
        },
    )
    client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "Odd", "state": {"kind": "telegram", "video": 3, "proofPng": None}},
    )
    rows = {row["title"]: row for row in client.get(f"/api/cases/{cid}/drafts").json()}

    # a draft from before kinds is a Geolocation one, its proof named, its three posts counted
    assert rows["Old shape"]["kind"] == "geolocation"
    assert rows["Old shape"]["proof"] == "proofs/strike.png"
    assert rows["Old shape"]["posts"] == 3
    assert rows["Old shape"]["video"] is None
    assert rows["Free one"]["kind"] == "free"
    assert rows["Free one"]["posts"] == 1
    # what this build does not know reads as nothing rather than as itself
    assert rows["Odd"]["kind"] == "geolocation"
    assert rows["Odd"]["video"] is None and rows["Odd"]["proof"] is None


def test_a_first_posts_own_pictures_are_what_the_post_is_made_from(client):
    """A free or plate post carries its pictures on post 1 (`firstMedia`): they link the
    post to them as the proof does, and they face the same path and count checks."""
    cid = client.post("/api/cases", json={"name": "First media"}).json()["id"]
    path = mediafixture._upload(client, cid, "pic.png")
    saved = client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "Plate post", "state": {"kind": "plate", "firstMedia": [path]}},
    )
    assert saved.status_code == 200, saved.text
    post = next(e for e in graph_read.entities(cid) if e["type"] == "post")
    media = next(e for e in graph_read.entities(cid) if e.get("attrs", {}).get("path") == path)
    links = [link for link in graph_read.links(cid, "derived-from") if link["from"] == post["id"]]
    assert [link["to"] for link in links] == [media["id"]]

    too_many = client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "Five", "state": {"firstMedia": [f"media/{i}.png" for i in range(5)]}},
    )
    unsafe = client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "Out", "state": {"firstMedia": ["../outside.png"]}},
    )
    shape = client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "Shape", "state": {"firstMedia": "media/a.png"}},
    )
    assert (too_many.status_code, unsafe.status_code, shape.status_code) == (422, 422, 422)
