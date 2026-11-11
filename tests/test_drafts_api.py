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


# -- whether a post went out ---------------------------------------------------------

POSTED_X = "https://x.com/someone/status/1850000000000000001"


def _proof_entity(cid, png):
    return next(e for e in graph_read.entities(cid) if e["type"] == "proof" and e["attrs"].get("path") == png)


def test_the_list_says_whether_each_post_went_out_and_the_picture_its_card_shows(client):
    """Post's home splits its drafts by where they stand and shows each one's picture,
    read off the drafts the list opens anyway."""
    cid = client.post("/api/cases", json={"name": "States"}).json()["id"]
    states = {
        "Plain": {"proofPng": "proofs/a.png"},
        "Opened": {"publish": {"opened_at": "2026-11-10T10:00:00Z", "site": "x"}, "firstMedia": ["media/b.png"]},
        "Out": {"publish": {"opened_at": "2026-11-10T10:00:00Z", "site": "x", "url": POSTED_X,
                            "posted_at": "2026-11-10T10:05:00Z", "mark": "abc", "changed": False}},
        "Edited": {"publish": {"site": "bluesky", "url": "https://bsky.app/profile/me.bsky.social/post/3kabc",
                               "posted_at": "2026-11-09T09:00:00Z", "mark": "abc", "changed": True},
                   "mediaPaths": ["media/c.mp4"]},
    }
    for title, state in states.items():
        saved = client.post(f"/api/cases/{cid}/drafts", json={"title": title, "state": state})
        assert saved.status_code == 200, saved.text
    rows = {row["title"]: row for row in client.get(f"/api/cases/{cid}/drafts").json()}

    assert {title: row["state"] for title, row in rows.items()} == {
        "Plain": "draft", "Opened": "opened", "Out": "posted", "Edited": "changed",
    }
    assert rows["Out"]["posted"] == {"url": POSTED_X, "site": "x", "at": "2026-11-10T10:05:00Z"}
    assert [rows[t]["site"] for t in ("Plain", "Opened", "Out", "Edited")] == [None, "x", "x", "bluesky"]
    assert rows["Edited"]["posted"]["site"] == "bluesky"
    assert rows["Plain"]["posted"] is None and rows["Opened"]["posted"] is None
    assert [rows[t]["picture"] for t in ("Plain", "Opened", "Out", "Edited")] == [
        "proofs/a.png", "media/b.png", None, "media/c.mp4",
    ]


def test_a_draft_from_before_reads_as_a_draft(client):
    cid = client.post("/api/cases", json={"name": "Old"}).json()["id"]
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Old", "state": STATE})
    (row,) = client.get(f"/api/cases/{cid}/drafts").json()
    assert row["state"] == "draft" and row["posted"] is None


@pytest.mark.parametrize("publish", [
    "posted",
    {"url": "https://x.com/someone"},
    {"url": "https://evil.example/x.com/a/status/1"},
    {"url": "http://x.com/a/status/1"},
    {"url": "https://x.com/a/status/1?s=20"},
    {"site": "mastodon"},
    {"opened_at": "x" * 65},
    {"changed": "yes"},
    {"unknown": 1},
])
def test_a_publishing_record_is_refused_unless_it_is_what_the_composer_writes(client, publish):
    cid = client.post("/api/cases", json={"name": "Edge"}).json()["id"]
    res = client.post(f"/api/cases/{cid}/drafts", json={"title": "Bad", "state": {"publish": publish}})
    assert res.status_code == 422, res.text
    assert client.get(f"/api/cases/{cid}/drafts").json() == []


def test_a_posted_link_goes_on_the_proof_and_follows_the_draft(client):
    """The proof a post is about keeps where it went out (not as a source: it is no
    evidence). A link changed on the draft replaces it, and a delete of the draft leaves
    it, since the post did go out."""
    cid = client.post("/api/cases", json={"name": "Posted"}).json()["id"]
    path = mediafixture._upload(client, cid, "pic.png")
    mediafixture._save_proof(client, cid, "Bridge", [path])
    png = "proofs/Bridge.png"
    state = {"proofPng": png, "publish": {"opened_at": "2026-11-10T10:00:00Z", "site": "x"}}
    saved = client.post(f"/api/cases/{cid}/drafts", json={"title": "Bridge post", "state": state}).json()
    assert not _proof_entity(cid, png)["attrs"].get("posted")

    out = dict(state, publish={**state["publish"], "url": POSTED_X, "posted_at": "2026-11-10T10:05:00Z", "mark": "m1"})
    client.post(f"/api/cases/{cid}/drafts", json={"rename_from": saved["name"], "title": "Bridge post", "state": out})
    assert _proof_entity(cid, png)["attrs"]["posted"] == [{"url": POSTED_X, "site": "x", "at": "2026-11-10T10:05:00Z"}]
    # saving again with the same link records it once
    client.post(f"/api/cases/{cid}/drafts", json={"rename_from": saved["name"], "title": "Bridge post", "state": out})
    assert len(_proof_entity(cid, png)["attrs"]["posted"]) == 1
    # the proof gains no source from it
    proof = _proof_entity(cid, png)
    assert not [link for link in graph_read.links(cid, "derived-from") if link["from"] == proof["id"] and link["to"] != _media_id(cid, path)]

    fixed = "https://x.com/someone/status/1850000000000000002"
    moved = dict(out, publish={**out["publish"], "url": fixed})
    client.post(f"/api/cases/{cid}/drafts", json={"rename_from": saved["name"], "title": "Bridge post", "state": moved})
    assert [one["url"] for one in _proof_entity(cid, png)["attrs"]["posted"]] == [fixed]

    assert client.delete(f"/api/cases/{cid}/drafts/{saved['name']}").status_code == 200
    assert [one["url"] for one in _proof_entity(cid, png)["attrs"]["posted"]] == [fixed]


def test_a_link_taken_back_leaves_the_proof(client):
    """Clearing the link field means the link was wrong: the draft goes back to opened (or
    says nothing), and its link leaves the proof's record while another post's stays."""
    cid = client.post("/api/cases", json={"name": "Taken back"}).json()["id"]
    path = mediafixture._upload(client, cid, "pic.png")
    mediafixture._save_proof(client, cid, "Bridge", [path])
    png = "proofs/Bridge.png"
    other = "https://x.com/someone/status/1850000000000000003"
    first = {"proofPng": png, "publish": {"site": "x", "url": other, "posted_at": "2026-11-09T09:00:00Z", "mark": "m0"}}
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Other post", "state": first})

    opened = {"opened_at": "2026-11-10T10:00:00Z", "site": "x"}
    out = {"proofPng": png, "publish": {**opened, "url": POSTED_X, "posted_at": "2026-11-10T10:05:00Z", "mark": "m1"}}
    saved = client.post(f"/api/cases/{cid}/drafts", json={"title": "Bridge post", "state": out}).json()
    assert [one["url"] for one in _proof_entity(cid, png)["attrs"]["posted"]] == [other, POSTED_X]

    back = {"proofPng": png, "publish": opened}
    client.post(f"/api/cases/{cid}/drafts", json={"rename_from": saved["name"], "title": "Bridge post", "state": back})
    assert [one["url"] for one in _proof_entity(cid, png)["attrs"]["posted"]] == [other]
    row = next(r for r in client.get(f"/api/cases/{cid}/drafts").json() if r["name"] == saved["name"])
    assert row["state"] == "opened" and row["posted"] is None

    # a post never opened, posted from elsewhere, and taken back says nothing at all
    client.post(f"/api/cases/{cid}/drafts", json={"rename_from": saved["name"], "title": "Bridge post", "state": out})
    client.post(f"/api/cases/{cid}/drafts", json={"rename_from": saved["name"], "title": "Bridge post", "state": {"proofPng": png}})
    assert [one["url"] for one in _proof_entity(cid, png)["attrs"]["posted"]] == [other]
    row = next(r for r in client.get(f"/api/cases/{cid}/drafts").json() if r["name"] == saved["name"])
    assert row["state"] == "draft"


def _media_id(cid, path):
    return next(e["id"] for e in graph_read.entities(cid) if e["type"] == "media" and e["attrs"].get("path") == path)
