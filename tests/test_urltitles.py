"""A web source a note cites: named from its address, and found among what the case
already filed for it, without fetching anything."""

import io

import pytest
from fakeydl import png_bytes
from PIL import Image

from azimut.engine import media as media_engine
from azimut.engine import urltitles
from azimut.workspace import Case


@pytest.mark.parametrize(
    ("url", "title"),
    [
        ("https://x.com/port_watch/status/1890", "Post by @port_watch on X"),
        ("https://twitter.com/port_watch/status/1890/photo/1", "Post by @port_watch on X"),
        ("https://x.com/i/web/status/1890", "Post on X"),
        ("https://x.com/port_watch", "@port_watch on X"),
        ("https://t.me/portnews/412", "Telegram, portnews #412"),
        ("https://t.me/s/portnews/412", "Telegram, portnews #412"),
        ("https://t.me/c/1789/55", "Telegram, private channel #55"),
        ("https://www.youtube.com/watch?v=abc123&t=42", "YouTube video abc123"),
        ("https://youtu.be/abc123", "YouTube video abc123"),
        ("https://youtube.com/shorts/xyz", "YouTube Short xyz"),
        ("https://bsky.app/profile/port.bsky.social/post/3k", "Post by @port.bsky.social on Bluesky"),
        ("https://www.instagram.com/p/C0de/", "Instagram post C0de"),
        ("https://www.instagram.com/reel/C0de/", "Instagram reel C0de"),
        ("https://www.tiktok.com/@port/video/7311", "TikTok video by @port"),
        ("https://www.facebook.com/PortCity/posts/pfbid02", "Facebook post by PortCity"),
        ("https://www.reddit.com/r/osint/comments/1ab/a_title/", "Reddit post in r/osint"),
        ("https://www.example.org/news/2026/03/strike/", "example.org/news/2026/03/strike"),
        ("https://example.org/", "example.org"),
    ],
)
def test_a_source_is_named_from_its_address(url, title):
    assert urltitles.title_of(url) == title


def test_a_long_address_is_cut_with_a_mark():
    title = urltitles.title_of("https://example.org/" + "a" * 300)
    assert len(title) == 120
    assert title.endswith("…")


@pytest.mark.parametrize("bad", ["", "port strike", "ftp://host/x", "javascript:alert(1)", "https://", None, 42])
def test_what_is_not_a_web_address_has_no_name_and_no_key(bad):
    assert urltitles.title_of(bad) == ""
    assert urltitles.url_key(bad) == ""


@pytest.mark.parametrize(
    ("one", "other"),
    [
        ("https://twitter.com/old_name/status/1890?s=20", "https://x.com/new_name/status/1890"),
        ("http://www.t.me/s/PortNews/412", "https://t.me/portnews/412"),
        ("https://youtu.be/abc123?si=share", "https://www.youtube.com/watch?v=abc123&feature=shared"),
        ("https://example.org/a/?utm_source=x&id=4#top", "https://example.org/a?id=4"),
        ("https://m.facebook.com/story.php?story_fbid=9&id=2", "https://www.facebook.com/story.php?id=2&story_fbid=9"),
    ],
)
def test_two_addresses_of_one_page_share_a_key(one, other):
    assert urltitles.url_key(one) == urltitles.url_key(other)


@pytest.mark.parametrize(
    ("one", "other"),
    [
        ("https://x.com/a/status/1", "https://x.com/a/status/2"),
        ("https://example.org/page?id=4", "https://example.org/page?id=5"),
        ("https://t.me/portnews/412", "https://t.me/portnews/413"),
        ("https://example.org/a", "https://example.com/a"),
    ],
)
def test_two_pages_keep_two_keys(one, other):
    assert urltitles.url_key(one) != urltitles.url_key(other)


def _bookmark(client, cid, url, label="Kept"):
    made = client.post(f"/api/cases/{cid}/entities", json={"type": "bookmark", "label": label, "attrs": {"url": url}})
    assert made.status_code == 200, made.text
    return made.json()


def test_the_lookup_finds_what_the_case_filed_for_a_page(client):
    cid = client.post("/api/cases", json={"name": "Sources"}).json()["id"]
    kept = _bookmark(client, cid, "https://twitter.com/port_watch/status/1890?s=20", "Kept post")
    downloaded = media_engine.import_image(
        Case.open(cid),
        Image.new("RGB", (16, 12), (40, 40, 40)),
        "post.png",
        {"type": "download", "url": "https://x.com/port_watch/status/1890", "webpage_url": "https://x.com/port_watch/status/1890"},
    )["entity"]
    _bookmark(client, cid, "https://x.com/port_watch/status/1891", "Another post")

    answer = client.get(f"/api/cases/{cid}/sources/lookup", params={"url": "https://x.com/renamed/status/1890"})
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["title"] == "Post by @renamed on X"
    assert body["url"] == "https://x.com/renamed/status/1890"
    # the downloaded file first: it is the copy of the post the case holds
    assert [found["id"] for found in body["found"]] == [downloaded["id"], kept["id"]]
    assert body["found"][1] == {"id": kept["id"], "type": "bookmark", "label": "Kept post", "attrs": kept["attrs"]}


def test_the_lookup_names_a_page_the_case_does_not_hold(client):
    cid = client.post("/api/cases", json={"name": "Fresh"}).json()["id"]
    body = client.get(f"/api/cases/{cid}/sources/lookup", params={"url": "https://t.me/portnews/412"}).json()
    assert body == {"url": "https://t.me/portnews/412", "title": "Telegram, portnews #412", "found": []}


@pytest.mark.parametrize("bad", ["port strike", "ftp://host/x", "https://example.org/" + "a" * 2000])
def test_the_lookup_refuses_what_is_not_a_web_address(client, bad):
    cid = client.post("/api/cases", json={"name": "Refused"}).json()["id"]
    assert client.get(f"/api/cases/{cid}/sources/lookup", params={"url": bad}).status_code == 422


def test_the_lookup_never_reaches_the_network(client, monkeypatch):
    """Finding and naming a source is read off the address and the case: a link
    pasted offline is named and found the same way."""
    import socket

    def refuse(*_args, **_kwargs):
        raise AssertionError("the lookup tried to reach the network")

    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)
    cid = client.post("/api/cases", json={"name": "Offline"}).json()["id"]
    _bookmark(client, cid, "https://example.org/a")
    body = client.get(f"/api/cases/{cid}/sources/lookup", params={"url": "https://www.example.org/a/"}).json()
    assert [found["label"] for found in body["found"]] == ["Kept"]


def _paste(client, cid):
    return client.post(
        f"/api/cases/{cid}/media/paste",
        files={"file": ("image.png", io.BytesIO(png_bytes()), "image/png")},
        data={"title": "Pasted shot"},
    ).json()


@pytest.mark.parametrize("brought", ["paste", "manual"])
def test_a_picture_brought_in_by_hand_can_be_given_its_source(client, brought):
    """A pasted screenshot or a file adopted from the case folder has an origin only
    the analyst knows: the note's Source… states it, as Details does."""
    cid = client.post("/api/cases", json={"name": "Stated"}).json()["id"]
    if brought == "paste":
        path = _paste(client, cid)["item"]["path"]
    else:
        case = Case.open(cid)
        Image.new("RGB", (16, 12), (90, 10, 10)).save(case.media_dir / "adopted.png")
        path = media_engine.register_existing(case, "media/adopted.png")["item"]["path"]
    res = client.patch(f"/api/cases/{cid}/media", json={"path": path, "source_url": "https://t.me/portnews/412"})
    assert res.status_code == 200, res.text
    assert res.json()["source"]["url"] == "https://t.me/portnews/412"
    rows = client.post(f"/api/cases/{cid}/media/metadata", json={"paths": [path]}).json()
    assert rows[0]["source"]["url"] == "https://t.me/portnews/412"


def test_a_picture_made_in_the_case_keeps_its_origin(client):
    """A frame cut from a video comes from that video: its source is the file it was
    made from, never an address typed over it."""
    cid = client.post("/api/cases", json={"name": "Derived"}).json()["id"]
    frame = media_engine.import_image(
        Case.open(cid),
        Image.new("RGB", (16, 12), (10, 90, 10)),
        "frame.png",
        {"type": "inspect", "from": "media/clip.mp4"},
    )
    res = client.patch(
        f"/api/cases/{cid}/media", json={"path": frame["item"]["path"], "source_url": "https://example.org/x"}
    )
    assert res.status_code == 400
