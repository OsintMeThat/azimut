"""The site's categories changed from Settings › Website: rename one, delete one, give one article
another, and add one the publish dialog then offers (`POST /api/publishing/github/categories/rename`,
`.../categories/delete`, `.../site/category`, `PUT .../categories/added`, `sitesync.recategorizer`).

Each change is one commit: the cards concerned with their category rewritten and nothing else of them,
and the lists, the feed and the sitemap made from the cards as they will be, with no page published
again. A rename is recorded in `articles.json` as `"renamed": {"Old": "New"}`. GitHub is
`tests/githubfake.py`, never the network.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from azimut import config
from azimut.engine import githubpages, site, sitesync

from githubfake import TOKEN, FakeGitHub
from test_site_hub import _card_file, _folder
from test_site_publish import _changed, _connect, _edit, _marked, _new_note, _the_live_site

RENAME = "/api/publishing/github/categories/rename"
DELETE = "/api/publishing/github/categories/delete"
MOVE = "/api/publishing/github/site/category"
ADDED = "/api/publishing/github/categories/added"
READ = "/api/publishing/github/site/read"


@pytest.fixture()
def fake(monkeypatch):
    stand_in = FakeGitHub()
    real = githubpages.client
    monkeypatch.setattr(githubpages, "client", lambda transport=None: real(stand_in.transport()))
    monkeypatch.setattr(githubpages.time, "sleep", lambda seconds: None)
    return stand_in


@pytest.fixture(autouse=True)
def an_empty_memory():
    sitesync._kept.clear()
    sitesync._plain.clear()
    sitesync._weight = 0


def _desk(fake: FakeGitHub) -> None:
    """A site with Azimut's home: two articles in Harbour, one in Roads, a page in Harbour, and a card made
    outside Azimut (no marker files) in Harbour."""
    files: dict[str, bytes] = {"README.md": b"x"}
    files.update(_folder("pier", "The pier", "2026-11-20", category="Harbour", place={"lat": 12.5, "lon": 43.1, "name": "Pier"}))
    files.update(_folder("dock", "The dock", "2026-11-19", category="Harbour"))
    files.update(_folder("road", "The road", "2026-11-18", category="Roads"))
    files.update(_folder("about", "About", "2026-11-17", category="Harbour", role="page"))
    files["2026/01/old/article.json"] = _card_file("An old one", "2026-01-05", category="Harbour")
    fake.make_repo(files=files)


def _set_up(client, fake) -> None:
    _desk(fake)
    _connect(client)
    assert client.post("/api/publishing/github/site").json()["updated"] is True


def _card(fake: FakeGitHub, folder: str) -> dict[str, Any]:
    return json.loads(fake.files()[f"{folder}/article.json"])


def _list(fake: FakeGitHub) -> dict[str, Any]:
    return json.loads(fake.files()["articles.json"])


# -- rename --------------------------------------------------------------------------------------------------------


def test_a_rename_rewrites_every_card_that_carries_it_and_the_lists_in_one_commit(client, fake):
    _set_up(client, fake)
    before, commits = fake.files(), len(fake.history())
    said = client.post(RENAME, json={"name": "Harbour", "to": "Ports"})
    assert said.status_code == 200, said.text
    answer = said.json()
    assert answer["ok"] is True and answer["changed"] == 4 and answer["warnings"] == []
    assert len(fake.history()) == commits + 1 and fake.history()[0]["message"] == "Rename the category Harbour to Ports"
    after = fake.files()
    cards = {"pier/article.json", "dock/article.json", "about/article.json", "2026/01/old/article.json"}
    # the cards concerned, the home, the list, the feed: nothing else, and no page published again
    assert _changed(before, after) == cards | {"index.html", "articles.json", "feed.xml"}
    assert set(answer["written"]) == _changed(before, after)
    # each card keeps every other key as it was, its place and the folder made outside Azimut included
    for path in cards:
        was, now = json.loads(before[path]), json.loads(after[path])
        assert now["category"] == "Ports" and {**was, "category": "Ports"} == now
    assert _card(fake, "road")["category"] == "Roads"
    listed = _list(fake)
    assert {line["category"] for line in listed["articles"]} == {"Ports", "Roads"}
    assert listed["renamed"] == {"Harbour": "Ports"}
    assert list(listed) == ["format", "site", "articles", "maps", "pages", "renamed", "bar"]
    assert "<category>Ports</category>" in after["feed.xml"].decode()
    assert 'data-category="ports"' in after["index.html"].decode() and "Harbour" not in after["index.html"].decode()
    # the publish dialog is offered the new name, and the old one is gone
    assert client.get("/api/publishing").json()["github"]["categories"] == ["Ports", "Roads"]


def test_renames_chain_to_one_step_outlive_an_update_and_leave_when_the_old_name_comes_back(client, fake):
    _set_up(client, fake)
    client.post(RENAME, json={"name": "Harbour", "to": "Ports"})
    client.post(RENAME, json={"name": "Ports", "to": "Docks"})
    assert _list(fake)["renamed"] == {"Harbour": "Docks", "Ports": "Docks"}
    # a later update and a later publish keep the record
    _edit(fake, "added/article.json", _card_file("Added", "2026-11-21", category="Roads"))
    assert client.post("/api/publishing/github/site").json()["updated"] is True
    assert _list(fake)["renamed"] == {"Harbour": "Docks", "Ports": "Docks"}
    # an article in a category named as an old one again: that old name leaves the record
    assert client.post(MOVE, json={"folder": "road", "category": "Ports"}).status_code == 200
    assert _list(fake)["renamed"] == {"Harbour": "Docks"}
    # renamed back to where it started: no name leads to itself
    client.post(RENAME, json={"name": "Docks", "to": "Harbour"})
    assert _list(fake)["renamed"] == {"Docks": "Harbour"}


def test_a_rename_into_a_category_the_site_has_gathers_both(client, fake):
    _set_up(client, fake)
    answer = client.post(RENAME, json={"name": "Roads", "to": "Harbour"}).json()
    assert answer["changed"] == 1
    assert {line["category"] for line in _list(fake)["articles"]} == {"Harbour"}
    assert _list(fake)["renamed"] == {"Roads": "Harbour"}


def test_the_record_of_renames_reads_what_a_hand_left_and_keeps_its_bound():
    assert site.renamed_of({"renamed": {"A": "B", " C ": " D ", "E": "", "F": "F", "G": 3}}) == {"A": "B", "C": "D"}
    assert site.renamed_of({"renamed": ["A"]}) == {} and site.renamed_of(None) == {}
    record = {f"old {n}": "new" for n in range(site.MAX_RENAMED)}
    made = site.renamed_after(record, "newest", "new")
    assert len(made) == site.MAX_RENAMED and "old 0" not in made and made["newest"] == "new"
    assert site.renamed_kept({"A": "B", "C": "D"}, ["A"]) == {"C": "D"}


def test_a_site_whose_list_is_the_analysts_has_its_cards_renamed_and_no_record(client, fake):
    _desk(fake)
    _connect(client)
    _edit(fake, "articles.json", b'{"mine": true}\n')
    answer = client.post(RENAME, json={"name": "Harbour", "to": "Ports"}).json()
    assert answer["changed"] == 4 and fake.files()["articles.json"] == b'{"mine": true}\n'


# -- delete ----------------------------------------------------------------------------------------------------------


def test_a_delete_leaves_its_articles_on_the_site_with_no_category(client, fake):
    _set_up(client, fake)
    before = fake.files()
    answer = client.post(DELETE, json={"name": "Harbour"}).json()
    assert answer["ok"] is True and answer["changed"] == 4
    assert fake.history()[0]["message"] == "Delete the category Harbour"
    for folder in ("pier", "dock", "about", "2026/01/old"):
        assert _card(fake, folder)["category"] == ""
    listed = _list(fake)
    assert [line["title"] for line in listed["articles"]] == [line["title"] for line in json.loads(before["articles.json"])["articles"]]
    assert "renamed" not in listed and client.get("/api/publishing").json()["github"]["categories"] == ["Roads"]


# -- one article ---------------------------------------------------------------------------------------------------


def test_one_article_takes_another_category_its_card_alone_with_the_lists(client, fake):
    _set_up(client, fake)
    before = fake.files()
    answer = client.post(MOVE, json={"folder": "road", "category": "  New   ones "}).json()
    assert answer["changed"] == 1 and fake.history()[0]["message"] == "Move road to New ones"
    assert _changed(before, fake.files()) == {"road/article.json", "index.html", "articles.json", "feed.xml"}
    assert _card(fake, "road")["category"] == "New ones"
    # a card nested deep, made outside Azimut, and none for no category
    client.post(MOVE, json={"folder": "2026/01/old", "category": ""})
    assert _card(fake, "2026/01/old")["category"] == "" and fake.history()[0]["message"] == "Take 2026/01/old out of its category"
    # already there: nothing is committed
    commits = len(fake.history())
    same = client.post(MOVE, json={"folder": "road", "category": "New ones"}).json()
    assert same["ok"] is True and same["changed"] == 0 and same["commit"] == "" and len(fake.history()) == commits


def test_a_folder_with_no_card_or_a_path_to_walk_is_refused_and_nothing_is_written(client, fake):
    _set_up(client, fake)
    commits = len(fake.history())
    gone = client.post(MOVE, json={"folder": "nowhere", "category": "X"})
    assert gone.status_code == 404 and gone.json()["detail"] == githubpages.GONE
    for folder in ("../x", "a/../b", "", "a\\b"):
        assert client.post(MOVE, json={"folder": folder, "category": "X"}).status_code == 422, folder
    assert client.post(MOVE, json={"folder": "x" * 301, "category": "X"}).status_code == 422
    assert len(fake.history()) == commits


# -- what is refused, and what the analyst's own site keeps ------------------------------------------------------------


def test_names_are_asked_for_and_a_category_no_card_carries_is_a_404(client, fake):
    _set_up(client, fake)
    commits = len(fake.history())
    assert client.post(RENAME, json={"name": "Harbour", "to": "  "}).status_code == 422
    assert client.post(RENAME, json={"name": "Harbour", "to": "Harbour"}).json()["detail"] == "That is its name already."
    assert client.post(DELETE, json={"name": " "}).status_code == 422
    gone = client.post(DELETE, json={"name": "Nowhere"})
    assert gone.status_code == 404 and gone.json()["detail"] == sitesync.CATEGORY_GONE
    assert client.post(RENAME, json={"name": "Nowhere", "to": "X"}).status_code == 404
    assert len(fake.history()) == commits


def test_a_site_too_large_to_read_changes_nothing_and_says_so(client, fake, monkeypatch):
    _set_up(client, fake)
    commits = len(fake.history())
    fake.truncated = True
    answer = client.post(RENAME, json={"name": "Harbour", "to": "Ports"})
    assert answer.status_code == 422 and answer.json()["detail"] == sitesync.CATEGORY_TOO_LONG
    fake.truncated = False
    monkeypatch.setattr(site, "MAX_CARDS", 2)
    answer = client.post(DELETE, json={"name": "Harbour"})
    assert answer.status_code == 422 and "nothing was changed" in answer.json()["detail"]
    assert len(fake.history()) == commits


def test_a_moved_branch_is_a_409_with_nothing_changed_and_the_press_works_again(client, fake):
    _set_up(client, fake)
    before, head = fake.files(), fake.repos["octo/articles"]["refs"]["main"]
    fake.fail[("PATCH", r"/repos/octo/articles/git/refs/heads/main")] = httpx.Response(
        422, json={"message": "Update is not a fast forward"})
    answer = client.post(RENAME, json={"name": "Harbour", "to": "Ports"})
    assert answer.status_code == 409 and answer.json()["detail"] == sitesync.CATEGORY_MOVED
    assert fake.files() == before and fake.repos["octo/articles"]["refs"]["main"] == head
    fake.fail.clear()
    assert client.post(RENAME, json={"name": "Harbour", "to": "Ports"}).status_code == 200


def test_update_the_site_says_a_moved_branch_in_its_own_words(client, fake):
    _desk(fake)
    _connect(client)
    fake.fail[("PATCH", r"/repos/octo/articles/git/refs/heads/main")] = httpx.Response(
        422, json={"message": "Update is not a fast forward"})
    answer = client.post("/api/publishing/github/site")
    assert answer.status_code == 409 and answer.json()["detail"] == githubpages.UPDATE_MOVED


def test_on_the_analysts_own_site_only_the_cards_and_the_lists_change_never_the_pages_outside_their_markers(client, fake):
    _the_live_site(client, fake)
    before = fake.files()
    answer = client.post(RENAME, json={"name": "Investigations", "to": "Inquiries"}).json()
    after = fake.files()
    assert answer["changed"] == 3
    changed = _changed(before, after)
    assert {path for path in changed if path.endswith("article.json")} == {
        "operation-absolute-resolve-map/article.json",
        "2026/03/12/operation-absolute-resolve-the-night-maduro-was-taken-a-full-osint-reconstruction/article.json",
        "2026/01/12/the-shadow-of-operation-absolute-resolve/article.json"}
    # the page that lists the old name keeps its words: its list is empty until the analyst changes it there
    assert 'section="Investigations"' in after["investigations/index.html"].decode()
    assert "No articles yet." in after["investigations/index.html"].decode()
    for page in ("index.html", "investigations/index.html", "conflict-watch/index.html"):
        assert _marked(after[page].decode()) == _marked(before[page].decode())
    assert _list(fake)["renamed"] == {"Investigations": "Inquiries"}


def test_a_change_of_categories_keeps_the_record_of_the_bar(client, fake):
    _set_up(client, fake)
    client.post("/api/publishing/github/site")
    payload = _list(fake)
    _edit(fake, "articles.json", (json.dumps({**payload, "bar": "azimut"}, indent=1) + "\n").encode())
    client.post(DELETE, json={"name": "Roads"})
    assert _list(fake)["bar"] == "azimut"


def test_a_change_reaches_github_only_and_settings_read_nothing(client, fake):
    _set_up(client, fake)
    fake.requests.clear()
    client.get("/api/publishing")
    assert fake.requests == []
    client.post(RENAME, json={"name": "Harbour", "to": "Ports"})
    assert fake.requests and all(request.url.host == "api.github.com" for request in fake.requests)


def test_a_change_needs_github_set_up_and_says_what_is_missing(client, fake):
    assert client.post(RENAME, json={"name": "A", "to": "B"}).status_code == 409
    _connect(client)
    assert client.post(DELETE, json={"name": "A"}).json()["needs"] == "repository"
    fake.make_repo(pages=False)
    assert client.post(MOVE, json={"folder": "a", "category": "B"}).json()["needs"] == "pages"
    assert not [request for request in fake.requests if request.method != "GET"]


# -- a publish after a change on the site --------------------------------------------------------------------------


def test_a_republish_keeps_the_category_the_site_gave_since_and_says_so(client, fake):
    fake.make_repo()
    _connect(client)
    note = _new_note(client)
    assert client.post(note["url"], json={"short_name": "port-strike", "category": "Harbour"}).status_code == 200
    client.post(RENAME, json={"name": "Harbour", "to": "Ports"})
    # the check before the next press: a change of category is no edit of the analyst's
    check = client.post(f"{note['url']}/check", json={"short_name": "port-strike"}).json()
    assert check["edited"] is False and check["warning"] == ""
    # the dialog still asks for the look's category, the one the note had: the site's stands
    again = client.post(note["url"], json={"short_name": "port-strike", "category": "Harbour"}).json()
    assert again["edited"] is False
    assert again["site"]["warnings"][0] == site.category_kept("Ports")
    assert _card(fake, "port-strike")["category"] == "Ports"
    look = client.get(f"/api/cases/{note['cid']}/notes/{note['note']}/look").json()["look"]
    assert look["category"] == "Ports"
    # another category picked in the dialog wins
    client.post(note["url"], json={"short_name": "port-strike", "category": "Roads"})
    assert _card(fake, "port-strike")["category"] == "Roads"


def test_a_republish_after_a_delete_stays_with_no_category(client, fake):
    fake.make_repo()
    _connect(client)
    note = _new_note(client)
    client.post(note["url"], json={"short_name": "port-strike", "category": "Harbour"})
    client.post(DELETE, json={"name": "Harbour"})
    again = client.post(note["url"], json={"short_name": "port-strike", "category": "Harbour"}).json()
    assert again["site"]["warnings"][0] == site.category_kept("")
    assert _card(fake, "port-strike")["category"] == ""


def test_a_card_changed_beyond_its_category_is_still_an_edit():
    from azimut.engine.githubpages import _but_category

    one = _card_file("A", category="X")
    assert _but_category(one) == _but_category(_card_file("A", category="Y"))
    assert _but_category(one) != _but_category(_card_file("B", category="X"))
    assert _but_category(b"not json") is None and _but_category(None) is None


# -- add: offered until an article carries it ------------------------------------------------------------------------


def test_an_added_category_is_offered_kept_here_and_leaves_once_an_article_carries_it(client, fake):
    _set_up(client, fake)
    client.post(READ)
    fake.requests.clear()
    said = client.put(ADDED, json={"names": ["Bridges", "  Rail   yards ", "Bridges", ""]}).json()
    assert said["added"] == ["Bridges", "Rail yards"]
    assert said["categories"] == ["Bridges", "Harbour", "Rail yards", "Roads"]
    # kept on this machine: GitHub is not asked
    assert fake.requests == []
    github = client.get("/api/publishing").json()["github"]
    assert github["added"] == ["Bridges", "Rail yards"] and "Bridges" in github["categories"]
    # an article in it: it is on the site, and no longer an added one
    client.post(MOVE, json={"folder": "road", "category": "Bridges"})
    github = client.get("/api/publishing").json()["github"]
    assert github["added"] == ["Rail yards"] and github["categories"] == ["Bridges", "Harbour", "Rail yards"]
    # the dialog's own read keeps offering it
    assert "Rail yards" in client.post("/api/publishing/github/categories").json()["categories"]


def test_added_categories_belong_to_their_site_and_travel_in_the_backup(client, fake):
    _connect(client)
    client.put(ADDED, json={"names": ["Bridges"]})
    assert config.load_settings()["github_categories_added"] == ["Bridges"]
    exported = client.get("/api/settings/export").json()
    assert exported["settings"]["github_categories_added"] == ["Bridges"]
    client.put("/api/publishing/github", json={"repo": "elsewhere"})
    assert client.get("/api/publishing").json()["github"]["added"] == []
    client.put(ADDED, json={"names": ["Bridges"]})
    client.delete("/api/publishing/github")
    assert config.load_settings()["github_categories_added"] == []
    assert client.put(ADDED, json={"names": ["x"] * 51}).status_code == 422


def test_the_token_never_comes_back_in_any_answer(client, fake):
    _set_up(client, fake)
    for answer in (client.put(ADDED, json={"names": ["A"]}), client.post(RENAME, json={"name": "Harbour", "to": "Ports"})):
        assert TOKEN not in answer.text
