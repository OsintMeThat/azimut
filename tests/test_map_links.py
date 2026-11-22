"""A link to a map: an article's mention of a web map, or a written link to an address the map
was published at (`notelinks.linked_maps`)."""

from __future__ import annotations

from typing import Any

from azimut.engine import notelinks, notes_markdown
from azimut.workspace import Case

from notecase import make_case, make_note

MAP_LOOK = {"style": "article", "web": "map"}


def _published(file: str, address: str, *, repository: str = "octo/articles") -> dict[str, Any]:
    """A GitHub Pages record, as a publish leaves it among the note's editions."""
    return {"at": "2026-11-20T10:00:00Z", "edition": "public", "format": "github", "file": file,
            "address": address, "repository": repository, "branch": "main", "path": file,
            "commit": "a" * 40, "sha256": "b" * 64, "text_sha256": "c" * 64}


def _map(client, cid: str, title: str, *records: dict[str, Any]) -> str:
    """A web map of the case, published where ``records`` say."""
    note = make_note(client, cid, title=title, content="::: map\nlayer: Nothing\n:::\n")
    assert client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json=MAP_LOOK).status_code == 200
    if records:
        Case.open(cid).update_entity(note["id"], {"attrs": {"editions": list(records)}})
    return note["id"]


def test_a_mention_of_a_web_map_is_a_link_to_it_and_of_anything_else_is_not(client):
    cid = make_case(client, "Maps")
    road = _map(client, cid, "Road map")
    coast = _map(client, cid, "Coast map")
    plain = make_note(client, cid, title="Plain", content="Words.\n")["id"]
    case = Case.open(cid)
    text = (f"See [[entity:{coast}|the coast]] and [[entity:{plain}|the notes]], then\n"
            f"[[entity:{road}|the road]] and [[entity:{coast}|the coast again]].\n\n"
            f"```\n[[entity:{plain}|an example]] [[entity:{road}|in code]]\n```\n")
    # in order and once each, a plain note no map, and a mention in code no link
    assert notelinks.linked_maps(case, text) == [coast, road]
    assert notelinks.linked_maps(case, f"Only ```[[entity:{road}|code]]``` here.\n") == []
    assert notelinks.linked_maps(case, "") == []
    # a mention of a record gone from the case is none
    assert notelinks.linked_maps(case, "[[entity:e_gone|Gone]]\n") == []


def test_a_written_link_to_an_address_a_map_was_published_at_is_a_link_to_it(client):
    cid = make_case(client, "Addresses")
    road = _map(client, cid, "Road map", _published("road-map", "https://octo.github.io/articles/road-map/"))
    coast = _map(client, cid, "Coast map", _published("coast", "https://osintmethat.com/coast/"),
                 _published("coast", "https://octo.github.io/articles/coast/"))
    case = Case.open(cid)
    # a web folder given an address puts the map there too
    folder = {"at": "2026-11-19T10:00:00Z", "edition": "public", "format": "web", "file": "harbour", "folder": "exports",
              "address": "https://desk.example.org/harbour/", "sha256": "d" * 64, "text_sha256": "e" * 64}
    harbour = _map(client, cid, "Harbour", folder)
    text = ("The [old road](https://octo.github.io/articles/road-map) map, the coast at\n"
            "https://octo.github.io/articles/coast/index.html#top and\n"
            "[the harbour](https://desk.example.org/harbour/), [elsewhere](https://example.org/road-map/).\n")
    assert notelinks.linked_maps(case, text) == [road, coast, harbour]
    # an address on another site, or the site's own root, is no map
    assert notelinks.linked_maps(case, "[home](https://octo.github.io/articles/)\n") == []
    # a mention and a written link to one map are one link, in the order they first come
    both = f"[[entity:{coast}|Coast]] then [road](https://octo.github.io/articles/road-map/) and [c](https://osintmethat.com/coast/)\n"
    assert notelinks.linked_maps(case, both) == [coast, road]


def test_a_note_that_was_a_map_once_and_is_no_longer_one_is_no_map(client):
    cid = make_case(client, "Was a map")
    road = _map(client, cid, "Road map", _published("road-map", "https://octo.github.io/articles/road-map/"))
    assert client.put(f"/api/cases/{cid}/notes/{road}/look", json={"style": "article"}).status_code == 200
    case = Case.open(cid)
    assert notelinks.linked_maps(case, f"[[entity:{road}|r]] [r](https://octo.github.io/articles/road-map/)\n") == []


def test_on_the_public_text_a_link_inside_an_internal_passage_is_left_out(client):
    cid = make_case(client, "Internal")
    road = _map(client, cid, "Road map")
    coast = _map(client, cid, "Coast map")
    case = Case.open(cid)
    text = f"Public [[entity:{road}|road]].\n\n> [!internal]\n> Not yet: [[entity:{coast}|coast]].\n"
    assert notelinks.linked_maps(case, text) == [road, coast]
    public, _ = notes_markdown.strip_internal(text)
    assert notelinks.linked_maps(case, public) == [road]


def test_the_key_two_addresses_of_one_page_share():
    key = notelinks.page_key
    assert key("https://Octo.GitHub.io/articles/road-map/") == "octo.github.io/articles/road-map"
    assert key("http://octo.github.io/articles/road-map/index.html?x=1#top") == "octo.github.io/articles/road-map"
    assert key("https://octo.github.io:8443/a/") == "octo.github.io:8443/a"
    assert key("https://octo.github.io/articles/myindex.html") == "octo.github.io/articles/myindex.html"
    for nothing in ("", "mailto:a@b.org", "azimut://entity/e_1", "https://", "https://[bad/"):
        assert key(nothing) == ""
