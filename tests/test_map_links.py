"""A link to a map: an article's mention of a web map, or a written link to an address the map
was published at (`notelinks.linked_maps`)."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from azimut.engine import githubpages, notelinks, notes_maps, notes_markdown, site, sitesync
from azimut.workspace import Case

from githubfake import FakeGitHub
from mapfixture import fixture_map
from notecase import make_case, make_note
from test_site_publish import DAY, _card, _connect

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


# -- published to a site: the link opens the map's page there ---------------------------------------

SITE = "https://octo.github.io/articles/"
TOLD = 'target="_blank" rel="noopener noreferrer"'


@pytest.fixture()
def fake(monkeypatch):
    stand_in = FakeGitHub()
    real = githubpages.client
    monkeypatch.setattr(githubpages, "client", lambda transport=None: real(stand_in.transport()))
    monkeypatch.setattr(githubpages.time, "sleep", lambda seconds: None)
    monkeypatch.setattr("azimut.api.notes._now", lambda: DAY.astimezone())
    return stand_in


@pytest.fixture(autouse=True)
def an_empty_memory():
    sitesync._kept.clear()
    sitesync._plain.clear()
    sitesync._weight = 0


def _drawn_map(client, cid: str, monkeypatch, tmp_path, title: str = "The road") -> str:
    """A web map whose map draws, so its card on the site says it is one."""
    ground = tmp_path / "ground.png"
    Image.new("RGB", (400, 300), (40, 160, 90)).save(ground, "PNG")
    monkeypatch.setattr(notes_maps, "derive", lambda *_, **__: dataclasses.replace(fixture_map(), ground=ground))
    made = make_note(client, cid, title=title, content="The road, in one line.\n\n::: map\ntitle: The road\nlayer: Front\n:::\n")
    assert client.put(f"/api/cases/{cid}/notes/{made['id']}/look", json=MAP_LOOK).status_code == 200
    return made["id"]


def _publish(client, cid: str, note_id: str, short: str, role: str = "article") -> dict[str, Any]:
    answer = client.post(f"/api/cases/{cid}/notes/{note_id}/github", json={"short_name": short, "role": role})
    assert answer.status_code == 200 and answer.json()["published"], answer.text
    return answer.json()


def _maps(client, cid: str, note_id: str) -> list[dict[str, str]]:
    answer = client.get(f"/api/cases/{cid}/notes/{note_id}/github/maps")
    assert answer.status_code == 200, answer.text
    return answer.json()["maps"]


def test_a_link_to_a_map_the_site_holds_opens_its_page_there_and_folds_it_under_the_article(
        client, fake, monkeypatch, tmp_path):
    fake.make_repo()
    _connect(client)
    cid = make_case(client, "Road")
    road = _drawn_map(client, cid, monkeypatch, tmp_path)
    _publish(client, cid, road, "road-map")
    article = make_note(client, cid, title="Port strike", content=f"Smoke over the pier: see [[entity:{road}|the road map]].\n")
    assert _maps(client, cid, article["id"]) == [
        {"id": road, "title": "The road", "address": f"{SITE}road-map/", "short": "", "mentioned": True}]
    _publish(client, cid, article["id"], "port-strike")
    files = fake.files()
    page = files["port-strike/index.html"].decode()
    assert f'<a class="az-ref" href="{SITE}road-map/" {TOLD}>the road map</a>' in page
    # the site reads it as a link to its own map: the card names it, the list folds it, the cover badges it
    assert _card(files, "port-strike")["links"] == ["road-map"]
    lines = json.loads(files["articles.json"])["articles"]
    assert [line["title"] for line in lines] == ["Port strike"]
    assert lines[0]["maps"] == [{"title": "The road", "address": "/road-map/"}]
    # and a site that moves takes the link with it
    moved = site.readdressed(files["port-strike/index.html"], SITE, "https://desk.example.org/", ["road-map", "port-strike"])
    assert b'href="https://desk.example.org/road-map/"' in moved and f'href="{SITE}'.encode() not in moved


def test_a_map_not_on_the_site_yet_is_said_its_link_reads_as_words_and_a_later_publish_links_it(
        client, fake, monkeypatch, tmp_path):
    fake.make_repo()
    _connect(client)
    cid = make_case(client, "Road")
    road = _drawn_map(client, cid, monkeypatch, tmp_path)
    article = make_note(client, cid, title="Port strike", content=f"See [[entity:{road}|the road map]].\n")
    assert _maps(client, cid, article["id"]) == [{"id": road, "title": "The road", "address": "", "short": "", "mentioned": True}]
    _publish(client, cid, article["id"], "port-strike")
    page = fake.files()["port-strike/index.html"].decode()
    assert "the road map" in page and "road-map" not in page
    assert _card(fake.files(), "port-strike")["links"] == []
    # the map goes up by hand under its own name: the article's next publish finds its address
    _publish(client, cid, road, "the-road")
    assert _maps(client, cid, article["id"])[0]["address"] == f"{SITE}the-road/"
    _publish(client, cid, article["id"], "port-strike")
    page = fake.files()["port-strike/index.html"].decode()
    assert f'<a class="az-ref" href="{SITE}the-road/" {TOLD}>the road map</a>' in page


def test_a_map_published_to_another_site_only_offers_the_name_it_has_there(client, fake, monkeypatch, tmp_path):
    fake.make_repo()
    _connect(client)
    cid = make_case(client, "Road")
    road = _drawn_map(client, cid, monkeypatch, tmp_path)
    Case.open(cid).update_entity(road, {"attrs": {"editions": [
        _published("the-road", "https://octo.github.io/old/the-road/", repository="octo/old")]}})
    article = make_note(client, cid, title="Port strike", content=f"See [[entity:{road}|the road map]].\n")
    assert _maps(client, cid, article["id"]) == [
        {"id": road, "title": "The road", "address": "", "short": "the-road", "mentioned": True}]
    # a link written to its address there still opens it there: no mention, nothing reads as words
    written = make_note(client, cid, title="Old", content="See [the road](https://octo.github.io/old/the-road/).\n")
    assert _maps(client, cid, written["id"]) == [
        {"id": road, "title": "The road", "address": "", "short": "the-road", "mentioned": False}]


def test_a_written_link_to_the_map_on_another_site_takes_its_address_on_this_one(client, fake, monkeypatch, tmp_path):
    fake.make_repo()
    _connect(client)
    cid = make_case(client, "Road")
    road = _drawn_map(client, cid, monkeypatch, tmp_path)
    _publish(client, cid, road, "road-map")
    case = Case.open(cid)
    kept = case.get_entity(road)["attrs"]["editions"]
    case.update_entity(road, {"attrs": {"editions": [
        *kept, _published("road", "https://octo.github.io/old/road/", repository="octo/old")]}})
    old = "https://octo.github.io/old/road/"
    text = f"The [road map]({old}#top), also at {old} and [elsewhere](https://example.org/road/).\n"
    article = make_note(client, cid, title="Port strike", content=text)
    assert [row["id"] for row in _maps(client, cid, article["id"])] == [road]
    _publish(client, cid, article["id"], "port-strike")
    files = fake.files()
    page = files["port-strike/index.html"].decode()
    assert f'<a href="{SITE}road-map/" {TOLD}>road map</a>' in page
    # the address written bare is the one it now opens
    assert f'<a href="{SITE}road-map/" {TOLD}>{SITE}road-map/</a>' in page
    assert old not in page and 'href="https://example.org/road/"' in page
    assert _card(files, "port-strike")["links"] == ["road-map"]


def test_on_a_site_served_from_docs_the_map_there_is_linked_and_one_left_at_the_root_is_none(
        client, fake, monkeypatch, tmp_path):
    fake.make_repo()
    fake.repos["octo/articles"]["pages"]["source"]["path"] = "/docs"
    _connect(client)
    cid = make_case(client, "Road")
    road = _drawn_map(client, cid, monkeypatch, tmp_path)
    _publish(client, cid, road, "road-map")
    article = make_note(client, cid, title="Port strike", content=f"See [[entity:{road}|the road map]].\n")
    _publish(client, cid, article["id"], "port-strike")
    assert f'href="{SITE}road-map/"' in fake.files()["docs/port-strike/index.html"].decode()
    # the site served from its root again: the map's folder under docs/ is no page of it
    fake.repos["octo/articles"]["pages"]["source"]["path"] = "/"
    _publish(client, cid, article["id"], "port-strike")
    page = fake.files()["port-strike/index.html"].decode()
    assert "the road map" in page and "road-map/" not in page


def test_a_map_named_only_in_an_internal_passage_is_none_of_the_public_pages(client, fake, monkeypatch, tmp_path):
    fake.make_repo()
    _connect(client)
    cid = make_case(client, "Road")
    road = _drawn_map(client, cid, monkeypatch, tmp_path)
    article = make_note(client, cid, title="Port strike",
                        content=f"Public words.\n\n> [!internal]\n> Later: [[entity:{road}|the road map]].\n")
    assert _maps(client, cid, article["id"]) == []


def test_off_a_site_a_link_to_a_map_is_its_words_as_before(client, monkeypatch, tmp_path):
    cid = make_case(client, "Road")
    road = _drawn_map(client, cid, monkeypatch, tmp_path)
    Case.open(cid).update_entity(road, {"attrs": {"editions": [_published("road-map", f"{SITE}road-map/")]}})
    article = make_note(client, cid, title="Port strike", content=f"See [[entity:{road}|the road map]].\n")
    answer = client.post(f"/api/cases/{cid}/notes/html", json={"notes": [article["id"]], "edition": "public"})
    assert answer.status_code == 200, answer.text
    written = answer.json()["written"][0]
    page = Path(answer.json()["path"], written["file"]).read_text(encoding="utf-8")
    assert "the road map" in page and "road-map" not in page
