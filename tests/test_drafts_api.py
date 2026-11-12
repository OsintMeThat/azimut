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
        json={"title": "Before after", "state": {"kind": "compare", "tweet1": "Depot", "firstMedia": ["media/c.png"]}},
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
    assert rows["Before after"]["kind"] == "compare"
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


def test_a_video_thread_is_made_from_its_video_and_lists_as_one(client):
    """A video thread draft names its video, its contact sheet, its recap map and the clip
    it picked: each links the post to the file as a posted picture does, so a delete of
    one warns, and the home knows the video's series has its thread."""
    cid = client.post("/api/cases", json={"name": "Thread"}).json()["id"]
    video = mediafixture._upload(client, cid, "convoy.png", color=(10, 90, 10))
    sheet = mediafixture._upload(client, cid, "sheet.png", color=(90, 10, 10))
    recap_map = mediafixture._upload(client, cid, "map.png", color=(90, 90, 10))
    clip = mediafixture._upload(client, cid, "clip.png", color=(10, 10, 90))
    state = {
        "kind": "video", "video": video, "order": "recap", "sheet": sheet, "map": recap_map, "clip": clip,
        "recap": "map", "mapOptions": {"background": "satellite", "line": True, "signature": False, "mark": False},
        "posts": [{"role": "video", "body": "Source: #source"}, {"role": "place", "body": "#description"}],
        "tweet1": "1. [0:00–0:07] Road bridge", "firstMedia": [sheet], "firstMediaType": "images",
        "mediaEnabled": False, "mediaType": "none", "first": "recap",
        "extraTweets": [
            {"text": "Source: https://x.com/a/1", "mediaPaths": [clip], "mediaType": "video", "key": "video"},
            {"text": "The bridge", "mediaPaths": [], "mediaType": "images", "key": "place:bridge", "edited": True},
        ],
    }
    saved = client.post(f"/api/cases/{cid}/drafts", json={"title": "Convoy thread", "state": state})
    assert saved.status_code == 200, saved.text
    assert client.get(f"/api/cases/{cid}/drafts/Convoy thread").json()["state"] == state

    row = client.get(f"/api/cases/{cid}/drafts").json()[0]
    assert (row["kind"], row["video"], row["posts"], row["picture"], row["proof"]) == (
        "video", video, 3, sheet, None,
    )
    post = next(e for e in graph_read.entities(cid) if e["type"] == "post")
    paths = {e["id"]: e["attrs"].get("path") for e in graph_read.entities(cid)}
    made_from = {paths[link["to"]] for link in graph_read.links(cid, "derived-from") if link["from"] == post["id"]}
    assert made_from == {video, sheet, recap_map, clip}

    unsafe = client.post(
        f"/api/cases/{cid}/drafts", json={"title": "Out", "state": {"kind": "video", "video": "../outside.mp4"}},
    )
    assert unsafe.status_code == 422


def test_the_list_gives_the_links_of_what_each_post_geolocates(client):
    """Post's search finds a post by the link of its source pasted (frontend `postHome.js`):
    the list says the links its Source field holds, then those of the files it carries,
    read from the media index in one go rather than from each file."""
    cid = client.post("/api/cases", json={"name": "Sources"}).json()["id"]
    video = mediafixture._upload(client, cid, "convoy.png", color=(10, 90, 10))
    photo = mediafixture._upload(client, cid, "photo.png", color=(90, 10, 10))
    bare = mediafixture._upload(client, cid, "bare.png", color=(10, 10, 90))
    for path, url in ((video, "https://www.youtube.com/watch?v=dQw4w9WgXcQ"), (photo, "https://t.me/channel/1234")):
        stated = client.patch(f"/api/cases/{cid}/media", json={"path": path, "source_url": url})
        assert stated.status_code == 200, stated.text
    geolocation = dict(STATE, source="https://x.com/Witness/status/1849000000000000007 · https://t.me/channel/1234",
                       mediaPaths=[photo, bare], mediaPath=photo, extraTweets=[])
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Bridge", "state": geolocation})
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Convoy thread", "state": {
        "kind": "video", "video": video, "source": "", "extraTweets": [{"text": "", "mediaPaths": [photo], "mediaType": "images"}],
    }})
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Words", "state": {"description": "No link"}})

    rows = {row["name"]: row["sources"] for row in client.get(f"/api/cases/{cid}/drafts").json()}
    assert rows == {
        # the field's links first, then the files', each once; a file with no link adds none
        "Bridge": ["https://x.com/Witness/status/1849000000000000007", "https://t.me/channel/1234"],
        "Convoy thread": ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://t.me/channel/1234"],
        "Words": [],
    }


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

    # a post an earlier build opened the site with and that never went out is a draft
    assert {title: row["state"] for title, row in rows.items()} == {
        "Plain": "draft", "Opened": "draft", "Out": "posted", "Edited": "changed",
    }
    assert rows["Out"]["posted"] == {"url": POSTED_X, "site": "x", "at": "2026-11-10T10:05:00Z"}
    assert rows["Edited"]["posted"]["site"] == "bluesky"
    assert "site" not in rows["Out"]
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


def test_a_drafts_alt_texts_are_kept_by_picture(client):
    cid = client.post("/api/cases", json={"name": "Alt"}).json()["id"]
    alt = {"proofs/bridge.png": "A road bridge over a canal", "media/after.png": "é" * 2000}
    state = {**STATE, "proofPng": "proofs/bridge.png", "alt": alt}
    saved = client.post(f"/api/cases/{cid}/drafts", json={"title": "Described", "state": state}).json()
    assert client.get(f"/api/cases/{cid}/drafts/{saved['name']}").json()["state"]["alt"] == alt


@pytest.mark.parametrize("alt", [
    ["proofs/bridge.png"],
    {"../outside.png": "A bridge"},
    {"/etc/passwd": "A bridge"},
    {"proofs/bridge.png": 3},
    {"proofs/bridge.png": "x" * 2001},
    {f"media/{i}.png": "A bridge" for i in range(200)},
])
def test_a_drafts_alt_texts_are_refused_unless_bounded_pictures_and_words(client, alt):
    cid = client.post("/api/cases", json={"name": "Edge"}).json()["id"]
    res = client.post(f"/api/cases/{cid}/drafts", json={"title": "Bad", "state": {**STATE, "alt": alt}})
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
    assert row["state"] == "draft" and row["posted"] is None

    # a post never opened, posted from elsewhere, and taken back says nothing at all
    client.post(f"/api/cases/{cid}/drafts", json={"rename_from": saved["name"], "title": "Bridge post", "state": out})
    client.post(f"/api/cases/{cid}/drafts", json={"rename_from": saved["name"], "title": "Bridge post", "state": {"proofPng": png}})
    assert [one["url"] for one in _proof_entity(cid, png)["attrs"]["posted"]] == [other]
    row = next(r for r in client.get(f"/api/cases/{cid}/drafts").json() if r["name"] == saved["name"])
    assert row["state"] == "draft"


def _media_id(cid, path):
    return next(e["id"] for e in graph_read.entities(cid) if e["type"] == "media" and e["attrs"].get("path") == path)


POSTED_BSKY = "https://bsky.app/profile/desk.bsky.social/post/3kabc2defgh22"


def _row(client, cid, name):
    return next(r for r in client.get(f"/api/cases/{cid}/drafts").json() if r["name"] == name)


def test_a_post_marked_posted_without_its_link_is_posted_and_its_proof_says_so(client):
    """Posted with no link: the list reads it out on the site it was marked on, and its
    proof keeps where and when with no link. A link given later replaces that entry, and
    Not posted takes it off the proof."""
    cid = client.post("/api/cases", json={"name": "No link"}).json()["id"]
    path = mediafixture._upload(client, cid, "pic.png")
    mediafixture._save_proof(client, cid, "Bridge", [path])
    png = "proofs/Bridge.png"
    out = {"site": "bluesky", "posted_at": "2026-11-09T09:00:00Z", "mark": "m1", "changed": False}
    state = {"proofPng": png, "target": "bluesky", "publish": out}
    saved = client.post(f"/api/cases/{cid}/drafts", json={"title": "Bridge post", "state": state})
    assert saved.status_code == 200, saved.text
    row = _row(client, cid, "Bridge post")
    assert row["state"] == "posted"
    assert row["posted"] == {"url": None, "site": "bluesky", "at": "2026-11-09T09:00:00Z"}
    assert _proof_entity(cid, png)["attrs"]["posted"] == [{"site": "bluesky", "at": "2026-11-09T09:00:00Z"}]

    linked = dict(state, publish={**out, "url": POSTED_BSKY})
    client.post(f"/api/cases/{cid}/drafts", json={"rename_from": "Bridge post", "title": "Bridge post", "state": linked})
    assert _proof_entity(cid, png)["attrs"]["posted"] == [
        {"url": POSTED_BSKY, "site": "bluesky", "at": "2026-11-09T09:00:00Z"},
    ]

    client.post(f"/api/cases/{cid}/drafts", json={"rename_from": "Bridge post", "title": "Bridge post", "state": dict(state, publish=None)})
    assert not _proof_entity(cid, png)["attrs"].get("posted")
    assert _row(client, cid, "Bridge post")["state"] == "draft"


def test_a_post_marked_without_a_site_goes_out_on_its_platform(client):
    cid = client.post("/api/cases", json={"name": "Platform"}).json()["id"]
    state = {"target": "bluesky", "publish": {"posted_at": "2026-11-09T09:00:00Z"}}
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Out", "state": state})
    assert _row(client, cid, "Out")["posted"]["site"] == "bluesky"


def test_the_publish_route_marks_a_saved_post_posted_with_or_without_its_link(client):
    """The home marks a post without opening it: only its record and its proof change."""
    cid = client.post("/api/cases", json={"name": "Route"}).json()["id"]
    path = mediafixture._upload(client, cid, "pic.png")
    mediafixture._save_proof(client, cid, "Bridge", [path])
    png = "proofs/Bridge.png"
    # a post saved by Geo Report in 0.3.3: no kind and no publish
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Old", "state": {**STATE, "proofPng": png, "target": "x"}})
    before = client.get(f"/api/cases/{cid}/drafts/Old").json()

    res = client.put(f"/api/cases/{cid}/drafts/Old/publish", json={"posted": True})
    assert res.status_code == 200, res.text
    assert res.json()["state"] == "posted"
    after = client.get(f"/api/cases/{cid}/drafts/Old").json()
    publish = after["state"].pop("publish")
    assert publish == {"site": "x", "posted_at": publish["posted_at"], "changed": False}
    # nothing else of the post moved
    assert after["state"] == before["state"] and after["created_at"] == before["created_at"]
    assert _proof_entity(cid, png)["attrs"]["posted"] == [{"site": "x", "at": publish["posted_at"]}]

    # a link given later keeps the day it was marked, and the proof's entry takes it
    res = client.put(f"/api/cases/{cid}/drafts/Old/publish", json={"posted": True, "url": POSTED_X})
    assert res.json()["posted"] == {"url": POSTED_X, "site": "x", "at": publish["posted_at"]}
    assert _proof_entity(cid, png)["attrs"]["posted"] == [{"url": POSTED_X, "site": "x", "at": publish["posted_at"]}]

    # posted with no link after all: still posted, the link gone
    res = client.put(f"/api/cases/{cid}/drafts/Old/publish", json={"posted": True, "url": None})
    assert res.json()["posted"] == {"url": None, "site": "x", "at": publish["posted_at"]}
    assert _proof_entity(cid, png)["attrs"]["posted"] == [{"site": "x", "at": publish["posted_at"]}]

    # Not posted: a draft again, its proof's entry gone
    res = client.put(f"/api/cases/{cid}/drafts/Old/publish", json={"posted": False})
    assert res.json() == {"name": "Old", "state": "draft", "posted": None}
    assert "publish" not in client.get(f"/api/cases/{cid}/drafts/Old").json()["state"]
    assert not _proof_entity(cid, png)["attrs"].get("posted")


def test_the_publish_route_keeps_what_the_composer_marked(client):
    """A post the composer marked keeps its print and its changed flag: a link caught
    for it later only adds the link, on the link's own site."""
    cid = client.post("/api/cases", json={"name": "Kept"}).json()["id"]
    out = {"site": "x", "posted_at": "2026-11-09T09:00:00Z", "mark": "m1", "changed": True}
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Out", "state": {"target": "x", "publish": out}})
    res = client.put(f"/api/cases/{cid}/drafts/Out/publish", json={"posted": True, "url": POSTED_BSKY})
    assert res.status_code == 200, res.text
    assert client.get(f"/api/cases/{cid}/drafts/Out").json()["state"]["publish"] == {
        "posted_at": "2026-11-09T09:00:00Z", "mark": "m1", "changed": True, "site": "bluesky", "url": POSTED_BSKY,
    }
    assert res.json()["state"] == "changed"


@pytest.mark.parametrize("body", [
    {"posted": True, "url": "https://example.com/a/status/1"},
    {"posted": True, "url": "x.com/desk/status/1"},
    {"posted": True, "url": "https://x.com/desk/status/1?s=20"},
    {"posted": True, "url": "https://x.com/desk/status/" + "1" * 300},
    {"posted": "yes"},
    {"url": POSTED_X},
])
def test_the_publish_route_refuses_what_is_no_post_and_changes_nothing(client, body):
    cid = client.post("/api/cases", json={"name": "Refused"}).json()["id"]
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Plain", "state": STATE})
    before = client.get(f"/api/cases/{cid}/drafts/Plain").json()
    res = client.put(f"/api/cases/{cid}/drafts/Plain/publish", json=body)
    assert res.status_code == 422, res.text
    assert client.get(f"/api/cases/{cid}/drafts/Plain").json() == before


def test_the_publish_route_answers_404_for_a_post_that_is_not_there(client):
    cid = client.post("/api/cases", json={"name": "Missing"}).json()["id"]
    assert client.put(f"/api/cases/{cid}/drafts/Gone/publish", json={"posted": True}).status_code == 404


# -- a post with no name of its own (`naming.technical_name`) ------------------------


def test_a_draft_saved_with_no_name_files_under_a_technical_one(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    first = client.post(f"/api/cases/{cid}/drafts", json={"title": "", "state": STATE}).json()
    assert first["name"] == "Post 1"
    # the title left out, or only spaces, is no name either
    assert client.post(f"/api/cases/{cid}/drafts", json={"state": STATE}).json()["name"] == "Post 2"
    assert client.post(f"/api/cases/{cid}/drafts", json={"title": "   ", "state": STATE}).json()["name"] == "Post 3"


def test_clearing_a_drafts_name_moves_it_to_a_technical_name_and_keeps_one_entity(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Post 1", "state": STATE})
    named = client.post(f"/api/cases/{cid}/drafts", json={"title": "Bridge strike", "state": STATE}).json()
    before = [e for e in graph_read.entities(cid) if e["label"] == "Bridge strike"][0]

    cleared = client.post(
        f"/api/cases/{cid}/drafts", json={"rename_from": named["name"], "title": "", "state": STATE}
    ).json()
    # the lowest number free, the name the analyst gave gone with its file
    assert cleared["name"] == "Post 2"
    assert client.get(f"/api/cases/{cid}/drafts/Bridge strike").status_code == 404
    assert client.get(f"/api/cases/{cid}/drafts/Post 2").json()["state"]["place"] == STATE["place"]
    after = [e for e in graph_read.entities(cid) if e["id"] == before["id"]][0]
    assert (after["label"], after["attrs"]["draft"]) == ("Post 2", ".drafts/Post 2.json")
    # clearing a post with no name moves nothing
    again = client.post(f"/api/cases/{cid}/drafts", json={"rename_from": "Post 2", "title": "", "state": STATE}).json()
    assert again["name"] == "Post 2"
    assert sorted(d["name"] for d in client.get(f"/api/cases/{cid}/drafts").json()) == ["Post 1", "Post 2"]


def test_the_list_gives_what_a_post_with_no_name_is_labelled_by(client):
    cid = client.post("/api/cases", json={"name": "Drafts"}).json()["id"]
    state = {**STATE, "date": "2025-11-09 06:40 UTC+3", "coordsText": "Gate — 15.471200, 45.322100\n15.48, 45.33"}
    client.post(f"/api/cases/{cid}/drafts", json={"title": "", "state": state})
    client.post(f"/api/cases/{cid}/drafts", json={"title": "Bare", "state": {"tweet1": "Words"}})
    rows = {row["name"]: row for row in client.get(f"/api/cases/{cid}/drafts").json()}
    assert {key: rows["Post 1"][key] for key in ("place", "when", "coords")} == {
        "place": "Los Anacuos, Miranda, Venezuela",
        "when": "2025-11-09 06:40 UTC+3",
        "coords": [15.4712, 45.3221],
    }
    assert {key: rows["Bare"][key] for key in ("place", "when", "coords")} == {"place": None, "when": None, "coords": None}
