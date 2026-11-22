"""A note's web folder published to GitHub Pages in one press (`engine/githubpages.py`,
`POST /notes/{id}/github`, Settings › Website › GitHub Pages).

GitHub is stood in for by a small Git object store behind `httpx.MockTransport`: blobs,
trees, commits and refs as the REST API's Git database answers them, the repository,
its Pages site and its builds. No test reaches GitHub, and none needs an account: the
calls are held to GitHub's REST reference (docs.github.com), not to a live site.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import stat
import sys
from typing import Any

import httpx
import pytest

from azimut import config
from azimut.engine import githubpages, notes_web, publishsecrets, site
from azimut.workspace import Case

from ambushfixture import _ground, _image
from githubfake import TOKEN, FakeGitHub
from notecase import make_case, make_note

SECRET = "The second source asked not to be named"


@pytest.fixture()
def fake(monkeypatch):
    stand_in = FakeGitHub()
    real = githubpages.client
    monkeypatch.setattr(githubpages, "client", lambda transport=None: real(stand_in.transport()))
    monkeypatch.setattr(githubpages.time, "sleep", lambda seconds: None)
    return stand_in


def _connect(client, account: str = "octo", **more: str) -> None:
    saved = client.put("/api/publishing/github", json={"account": account, "token": TOKEN, **more})
    assert saved.status_code == 200, saved.text


@pytest.fixture()
def published(client, fake):
    """A filed note with a picture and an internal passage, GitHub set up, and a
    repository already holding another article."""
    fake.make_repo(files={"README.md": b"# articles\n", "other-story/index.html": b"<p>other</p>",
                          "other-story/share.jpg": b"jpg"})
    cid = make_case(client, "Port strike")
    picture = _image(Case.open(cid), "The pier", _ground(3), {"type": "clipboard"})
    text = (f"## What we saw\n\nSmoke over the pier.\n\n[[media:{picture['id']}|The pier]]\n\n"
            f"> [!internal]\n> {SECRET}.\n")
    note = make_note(client, cid, title="Port strike", content=text)
    _connect(client)
    return {"cid": cid, "note": note["id"], "url": f"/api/cases/{cid}/notes/{note['id']}/github",
            "picture": picture}


# -- the names ------------------------------------------------------------------------------


@pytest.mark.parametrize("value,kept", [("octo", "octo"), ("@Octo-Cat", "Octo-Cat"), ("", ""), ("a" * 39, "a" * 39)])
def test_an_account_is_taken_as_github_names_it(value, kept):
    assert githubpages.account_name(value) == kept


@pytest.mark.parametrize("value", ["-octo", "octo-", "oc--to", "octo/cat", "a" * 40, "oc to", "../x"])
def test_an_account_github_would_refuse_is_refused(value):
    with pytest.raises(githubpages.GitHubError):
        githubpages.account_name(value)


@pytest.mark.parametrize("value,kept", [("articles", "articles"), ("my.site_1-x", "my.site_1-x"),
                                        ("articles.git", "articles"), ("", "")])
def test_a_repository_name_is_taken_as_github_names_it(value, kept):
    assert githubpages.repository_name(value) == kept


@pytest.mark.parametrize("value", ["..", ".", "a/b", "a b", "x" * 101, "é"])
def test_a_repository_name_github_would_refuse_is_refused(value):
    with pytest.raises(githubpages.GitHubError):
        githubpages.repository_name(value)


@pytest.mark.parametrize("value", ["main", "gh-pages", "site/v2", "release-1.0"])
def test_a_branch_name_git_takes_is_kept(value):
    assert githubpages.branch_name(value) == value


@pytest.mark.parametrize("value", ["../main", "a..b", "-x", "a//b", "/a", "a/", ".hidden", "x.lock", "a.", "HEAD",
                                   "a b", "a~1", "a^", "a:b", "a?", "a*", "a[", "a\\b"])
def test_a_branch_name_git_refuses_is_refused(value):
    with pytest.raises(githubpages.GitHubError):
        githubpages.branch_name(value)


@pytest.mark.parametrize("value", ["port-strike", "a", "wadi_sahm-2026", "x" * 80])
def test_a_short_name_is_one_plain_part_of_an_address(value):
    assert githubpages.short_name(value) == value


@pytest.mark.parametrize("value", ["", "Port-Strike", "port strike", "../x", "a/b", "-x", "x-", ".x", "a.b", "x" * 81,
                                   "é", "%2e%2e"])
def test_a_short_name_that_is_not_one_is_refused(value):
    with pytest.raises(githubpages.GitHubError):
        githubpages.short_name(value)


@pytest.mark.parametrize("account,repo,url,base", [
    ("Octo", "articles", "", "https://octo.github.io/articles/"),
    ("octo", "Octo.github.io", "", "https://octo.github.io/"),
    ("octo", "articles", "https://news.example.org/", "https://news.example.org/"),
    ("octo", "articles", "http://example.org/articles", "https://example.org/articles/"),
    ("octo", "articles", "javascript:alert(1)", "https://octo.github.io/articles/"),
])
def test_the_site_is_where_pages_says_or_github_io(account, repo, url, base):
    assert githubpages.site_base(account, repo, url) == base


def test_a_file_is_known_by_the_id_git_gives_it():
    assert githubpages.blob_sha(b"") == "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"
    assert githubpages.blob_sha(b"hello\n") == "ce013625030ba8dba906f756967f9e9ca394464a"


def test_a_folder_past_the_bounds_or_with_a_path_out_of_it_is_refused():
    with pytest.raises(githubpages.GitHubError, match="name it cannot have"):
        githubpages._bounded({"../index.html": b"x"})
    with pytest.raises(githubpages.GitHubError, match="name it cannot have"):
        githubpages._bounded({"assets/../../x": b"x"})
    with pytest.raises(githubpages.GitHubError, match="files"):
        githubpages._bounded({f"f{index}": b"" for index in range(githubpages.MAX_FILES + 1)})
    with pytest.raises(githubpages.GitHubError, match="MB"):
        githubpages._bounded({"clip.mp4": b"0" * (githubpages.MAX_FILE_BYTES + 1)})


# -- publishing -----------------------------------------------------------------------------


def said_tree(fake: FakeGitHub, folder: str) -> str:
    """The id of a folder's tree on the branch now, which the note's record keeps."""
    head = fake.repos["octo/articles"]["refs"]["main"]
    return fake.objects[fake.objects[head][1]["tree"]][1][folder]["sha"]


def test_one_press_commits_the_folder_in_one_commit_and_the_note_keeps_its_record(client, fake, published):
    before = fake.repos["octo/articles"]["refs"]["main"]
    answer = client.post(published["url"], json={"short_name": "port-strike"})
    assert answer.status_code == 200, answer.text
    said = answer.json()
    address = "https://octo.github.io/articles/port-strike/"
    assert said["published"] and said["address"] == address and said["repository"] == "octo/articles"
    files = fake.files()
    page = files["port-strike/index.html"]
    assert hashlib.sha256(page).hexdigest() == said["sha256"]
    # the page knows its address, so X draws its picture card
    assert f'<meta property="og:url" content="{address}">'.encode() in page
    assert f'content="{address}share.jpg"'.encode() in page
    assert "port-strike/share.jpg" in files and any(path.startswith("port-strike/assets/") for path in files)
    # Pages serves the files as they are; the how-to is for putting a folder online by hand
    assert files[".nojekyll"] == b"" and "port-strike/HOW-TO-PUBLISH.md" not in files
    # every other article stays as it was
    assert files["other-story/index.html"] == b"<p>other</p>" and files["README.md"] == b"# articles\n"
    # one commit on top of what was there, named for the note and nobody else
    history = fake.history()
    assert history[0]["message"] == "Publish Port strike" and history[0]["parents"] == [before]
    assert len(fake.posted("/git/commits")) == 1
    patches = [request for request in fake.requests if request.method == "PATCH"]
    assert len(patches) == 1 and json.loads(patches[0].content) == {"sha": said["commit"], "force": False}
    # files first, then the folder, then the commit, then the branch
    order = [request.url.path.rsplit("/", 1)[-1] for request in fake.requests if request.method in ("POST", "PATCH")]
    assert order.index("commits") > max(index for index, kind in enumerate(order) if kind in ("blobs", "trees"))
    assert order[-1] == "main"
    # the public edition only: no request carries the internal passage
    assert all(SECRET.encode() not in request.content for request in fake.requests)
    editions = client.get(f"/api/cases/{published['cid']}/notes/{published['note']}/editions").json()["editions"]
    assert editions[0] == {
        "at": said["at"], "edition": "public", "format": "github", "file": "port-strike", "address": address,
        "repository": "octo/articles", "branch": "main", "path": "port-strike", "commit": said["commit"],
        "sha256": said["sha256"], "text_sha256": editions[0]["text_sha256"], "tree": said_tree(fake, "port-strike"),
        # the page's id with no bar, which an edition's Check reads past a bar Update the site changed
        "bare_sha256": hashlib.sha256(site.without_bar(page)).hexdigest()}
    assert client.get("/api/publishing").json()["github"]["site"] == "https://octo.github.io/articles/"


def test_keep_its_maps_offline_reaches_the_published_folder_too(client, fake, published, monkeypatch):
    from azimut.engine import notes_web

    asked: list[bool] = []
    real = notes_web.build

    def build(*args, **kwargs):
        asked.append(kwargs.get("live", True))
        return real(*args, **kwargs)

    monkeypatch.setattr(notes_web, "build", build)
    assert client.post(published["url"], json={"short_name": "port-strike"}).status_code == 200
    assert client.post(published["url"], json={"short_name": "port-strike", "offline_maps": True}).status_code == 200
    # as the web folder's export does: live maps unless the analyst keeps them offline
    assert asked == [True, False]


def test_a_second_press_replaces_the_folder_and_git_keeps_the_history(client, fake, published):
    first = client.post(published["url"], json={"short_name": "port-strike"}).json()
    before = set(fake.files())
    uploads = len(fake.posted("/git/blobs"))
    # the folder's files, and the site's own beside it (its list, feed, sitemap and home)
    assert first["uploaded"] + len(first["site"]["written"]) == uploads and first["removed"] == 0
    # the picture leaves the note: its file leaves the page, in the same commit
    client.put(f"/api/cases/{published['cid']}/notes/{published['note']}",
               json={"text": "## What we saw\n\nSmoke over the pier.\n"})
    second = client.post(published["url"], json={"short_name": "port-strike"})
    assert second.status_code == 200, second.text
    said = second.json()
    files = fake.files()
    gone = before - set(files)
    # the picture's file left with it; the page's own script, style and fonts stayed
    assert gone and all(path.startswith("port-strike/assets/") for path in gone) and said["removed"] == len(gone)
    assert any(path.startswith("port-strike/assets/") for path in files)
    assert files["other-story/index.html"] == b"<p>other</p>" and ".nojekyll" in files
    history = fake.history()
    assert [commit["message"] for commit in history[:2]] == ["Publish Port strike"] * 2
    assert history[0]["parents"] == [first["commit"]]
    # what the earlier copy held already is named, not sent again
    assert said["reused"] >= 1
    assert len(fake.posted("/git/blobs")) - uploads == said["uploaded"] + len(said["site"]["written"])
    editions = client.get(f"/api/cases/{published['cid']}/notes/{published['note']}/editions").json()["editions"]
    assert [edition["commit"] for edition in editions[:2]] == [said["commit"], first["commit"]]


def test_a_folder_azimut_did_not_make_is_never_replaced(client, fake, published):
    files = fake.files()
    fake.make_repo(files={**files, "port-strike/notes.txt": b"mine"})
    answer = client.post(published["url"], json={"short_name": "port-strike"})
    assert answer.status_code == 502 and "Azimut did not make" in answer.json()["detail"]
    fake.make_repo(files={**files, "port-strike": b"a file"})
    answer = client.post(published["url"], json={"short_name": "port-strike"})
    assert answer.status_code == 502 and "file named port-strike" in answer.json()["detail"]
    assert not fake.posted("/git/commits")


def test_a_site_on_a_custom_domain_or_served_from_docs_gets_its_own_address(client, fake, published):
    fake.make_repo(url="https://news.example.org/")
    fake.repos["octo/articles"]["pages"]["source"]["path"] = "/docs"
    said = client.post(published["url"], json={"short_name": "port-strike"}).json()
    assert said["address"] == "https://news.example.org/port-strike/"
    files = fake.files()
    assert "docs/port-strike/index.html" in files and "docs/.nojekyll" in files and ".nojekyll" not in files
    assert b'content="https://news.example.org/port-strike/share.jpg"' in files["docs/port-strike/index.html"]
    record = client.get(f"/api/cases/{published['cid']}/notes/{published['note']}/editions").json()["editions"][0]
    assert record["path"] == "docs/port-strike" and record["file"] == "port-strike"


def test_a_short_name_that_is_no_address_part_is_refused_before_github(client, fake, published):
    answer = client.post(published["url"], json={"short_name": "../escape"})
    assert answer.status_code == 422 and "short name" in answer.json()["detail"]
    assert fake.requests == []


def test_a_branch_pages_does_not_serve_is_said_and_nothing_is_written(client, fake, published):
    fake.repos["octo/articles"]["pages"]["source"]["branch"] = "gh-pages"
    answer = client.post(published["url"], json={"short_name": "port-strike"})
    assert answer.status_code == 409 and "set Branch to gh-pages" in answer.json()["detail"]
    assert not fake.posted("/git/blobs")


# -- setting up, each on its own press ----------------------------------------------------


def test_a_missing_repository_and_pages_off_are_said_then_set_up_on_their_presses(client, fake):
    cid = make_case(client, "Setup")
    note = make_note(client, cid, title="Setup", content="Words.\n")
    _connect(client)
    url = f"/api/cases/{cid}/notes/{note['id']}/github"
    said = client.post(url, json={"short_name": "setup"}).json()
    assert said == {"published": False, "needs": "repository", "repository": "octo/articles",
                    "detail": "There is no repository octo/articles that this token can reach."}
    assert not [request for request in fake.requests if request.method != "GET"]
    made = client.post("/api/publishing/github/repository").json()
    assert made == {"ok": True, "repository": "octo/articles", "branch": "main"}
    body = json.loads(fake.posted("/user/repos")[0].content)
    assert body["private"] is False and body["auto_init"] is True and body["name"] == "articles"
    said = client.post(url, json={"short_name": "setup"}).json()
    assert said["needs"] == "pages" and said["detail"] == "Pages is off for octo/articles."
    on = client.post("/api/publishing/github/pages").json()
    assert on["ok"] and on["base"] == "https://octo.github.io/articles/"
    assert json.loads(fake.posted("/pages")[0].content) == {"build_type": "legacy",
                                                            "source": {"branch": "main", "path": "/"}}
    assert client.post(url, json={"short_name": "setup"}).json()["published"]


def test_a_repository_for_an_organisation_is_made_under_it(client, fake):
    _connect(client, account="osint-desk")
    assert client.post("/api/publishing/github/repository").json()["ok"]
    assert fake.posted("/orgs/osint-desk/repos") and "osint-desk/articles" in fake.repos


def test_a_token_that_may_not_make_repositories_is_told_the_way_on_github(client, fake):
    fake.fail[("POST", "/user/repos")] = httpx.Response(
        403, json={"message": "Resource not accessible by personal access token"},
        headers={"x-accepted-github-permissions": "administration=write"})
    _connect(client)
    said = client.post("/api/publishing/github/repository").json()
    assert said["ok"] is False and said["manual"] is True
    assert said["detail"].startswith("This token may not make repositories")


def test_a_token_that_may_not_turn_pages_on_names_what_it_lacks(client, fake):
    fake.make_repo(pages=False)
    fake.fail[("POST", "/repos/octo/articles/pages")] = httpx.Response(
        403, json={"message": "Resource not accessible by personal access token"},
        headers={"x-accepted-github-permissions": "pages=write,administration=write"})
    _connect(client)
    said = client.post("/api/publishing/github/pages").json()
    assert said == {"ok": False, "manual": True, "detail": "This token may not turn Pages on: give it Pages and "
                    "Administration, Read and write, or turn it on in the repository's Settings › Pages."}


def test_an_empty_repository_is_started_before_pages_serves_it(client, fake):
    fake.make_repo(pages=False, empty=True)
    _connect(client)
    said = client.post("/api/publishing/github/pages").json()
    assert said["ok"], said
    put = [request for request in fake.requests if request.method == "PUT"]
    assert put and put[0].url.path == "/repos/octo/articles/contents/README.md"
    assert json.loads(put[0].content)["branch"] == "main"
    assert fake.repos["octo/articles"]["pages"]["source"] == {"branch": "main", "path": "/"}


def test_a_branch_not_there_yet_is_made_from_the_default_one(client, fake):
    fake.make_repo(pages=False)
    _connect(client, branch="gh-pages")
    assert client.post("/api/publishing/github/pages").json()["ok"]
    refs = fake.repos["octo/articles"]["refs"]
    assert refs["gh-pages"] == refs["main"]


def test_test_connection_says_who_where_and_what_to_mind(client, fake):
    fake.make_repo()
    fake.repos["octo/articles"]["private"] = True
    _connect(client)
    said = client.post("/api/publishing/github/test").json()
    assert said["ok"] and said["login"] == "octo" and said["pages"]["url"] == "https://octo.github.io/articles/"
    assert said["warnings"] == ["The repository is private, but its Pages site is public."]
    assert [request.method for request in fake.requests] == ["GET"] * len(fake.requests)
    publishsecrets.write("github", "github_pat_" + "y" * 60)
    said = client.post("/api/publishing/github/test").json()
    assert said == {"ok": False, "detail": githubpages.BAD_TOKEN, "needs": ""}


# -- watching, checking -----------------------------------------------------------------------


def test_the_build_is_watched_until_pages_has_built_the_commit(client, fake, published):
    commit = client.post(published["url"], json={"short_name": "port-strike"}).json()["commit"]
    assert client.post("/api/publishing/github/build", json={"commit": commit}).json()["state"] == "building"
    fake.build_status = "built"
    assert client.post("/api/publishing/github/build", json={"commit": commit}).json() == {"state": "built",
                                                                                          "detail": ""}
    other = "0" * 40
    assert client.post("/api/publishing/github/build", json={"commit": other}).json()["state"] == "building"
    fake.build_status = "errored"
    assert client.post("/api/publishing/github/build", json={"commit": commit}).json() == {
        "state": "errored", "detail": "Page build failed."}
    assert client.post("/api/publishing/github/build", json={"commit": "nope"}).status_code == 422


def test_check_reads_the_page_back_and_show_has_no_folder_here(client, fake, published):
    client.post(published["url"], json={"short_name": "port-strike"})
    base = f"/api/cases/{published['cid']}/notes/{published['note']}/editions"
    record = client.get(base).json()["editions"][0]
    ref = {"at": record["at"], "file": record["file"]}
    assert client.post(f"{base}/check", json=ref).json() == {"state": "unchanged"}
    files = fake.files()
    tree = fake.write_tree(None, [{"path": path, "mode": "100644", "type": "blob", "sha": fake.blob(data)}
                                  for path, data in {**files, "port-strike/index.html": b"edited"}.items()])
    fake.repos["octo/articles"]["refs"]["main"] = fake.commit(tree, [], "edit")
    assert client.post(f"{base}/check", json=ref).json() == {"state": "changed"}
    del files["port-strike/index.html"]
    tree = fake.write_tree(None, [{"path": path, "mode": "100644", "type": "blob", "sha": fake.blob(data)}
                                  for path, data in files.items()])
    fake.repos["octo/articles"]["refs"]["main"] = fake.commit(tree, [], "gone")
    assert client.post(f"{base}/check", json=ref).json() == {"state": "missing"}
    shown = client.post(f"{base}/reveal", json=ref)
    assert shown.status_code == 409 and "GitHub" in shown.json()["detail"]


def test_a_published_record_from_a_bundle_is_read_part_by_part(client):
    cid = make_case(client, "Records")
    note = make_note(client, cid, title="N")
    good = {"at": "2026-11-18T10:00:00Z", "edition": "public", "format": "github", "file": "port-strike",
            "address": "https://octo.github.io/articles/port-strike/", "repository": "octo/articles",
            "branch": "main", "path": "port-strike", "commit": "a" * 40, "sha256": "b" * 64, "text_sha256": "c" * 64}
    bad = [{**good, "address": "javascript:alert(1)"}, {**good, "repository": "octo/../x"},
           {**good, "path": "../port-strike"}, {**good, "path": "other"}, {**good, "commit": "zz"},
           {**good, "branch": "a..b"}, {**good, "edition": "internal"}, {**good, "file": "Port Strike"}]
    Case.open(cid).update_entity(note["id"], {"attrs": {"editions": [good, *bad]}})
    editions = client.get(f"/api/cases/{cid}/notes/{note['id']}/editions").json()["editions"]
    assert editions == [good]


# -- what goes wrong, in one sentence -------------------------------------------------------


def _limit(headers: dict[str, str], status: int = 403, message: str = "API rate limit exceeded") -> httpx.Response:
    return httpx.Response(status, json={"message": message}, headers=headers)


@pytest.mark.parametrize("pattern,answer,said", [
    (r"/repos/octo/articles/git/blobs", httpx.Response(
        403, json={"message": "Resource not accessible by personal access token"},
        headers={"x-accepted-github-permissions": "contents=write"}),
     "The token may not upload the folder's files: give it Contents, Read and write on this repository."),
    (r"/repos/octo/articles/git/blobs", _limit({"x-ratelimit-remaining": "0", "x-ratelimit-reset": "4102444800"}),
     "GitHub's hourly limit for this token is used up: try again after"),
    (r"/repos/octo/articles/git/refs/heads/main", httpx.Response(422, json={"message": "Update is not a fast forward"}),
     "The branch changed on GitHub while Azimut was publishing: press Publish again."),
    (r"/repos/octo/articles/git/commits", httpx.Response(503, text="unavailable"),
     "GitHub is having trouble (HTTP 503): try again in a moment."),
    (r"/repos/octo/articles/git/trees", httpx.Response(409, json={"message": "Git Repository is empty."}),
     "The repository is empty, or GitHub is still making it"),
])
def test_what_went_wrong_is_said_in_one_sentence(client, fake, published, pattern, answer, said):
    method = "PATCH" if pattern.endswith("/main") else "POST"
    fake.fail[(method, pattern)] = answer
    response = client.post(published["url"], json={"short_name": "port-strike"})
    assert response.status_code == 502
    assert response.json()["detail"].startswith(said)


def test_a_refused_token_is_said_and_never_echoed(client, fake, published):
    publishsecrets.write("github", "github_pat_" + "z" * 60)
    response = client.post(published["url"], json={"short_name": "port-strike"})
    assert response.status_code == 502 and response.json()["detail"] == githubpages.BAD_TOKEN
    assert "z" * 20 not in response.text


def test_a_pause_github_asks_for_is_waited_within_bounds(client, fake, published, monkeypatch):
    waits: list[float] = []
    monkeypatch.setattr(githubpages.time, "sleep", waits.append)
    once = {"left": 1}

    def slow_down(request: httpx.Request) -> httpx.Response:
        if once["left"]:
            once["left"] -= 1
            return _limit({"retry-after": "3"}, 429, "You have exceeded a secondary rate limit")
        return fake.answer(request)

    fake.fail[("POST", r"/repos/octo/articles/git/commits")] = slow_down
    answer = client.post(published["url"], json={"short_name": "port-strike"})
    assert answer.status_code == 200, answer.text
    assert 3.0 in waits
    # past what a press may wait, it stops and says so
    fake.fail[("POST", r"/repos/octo/articles/git/commits")] = _limit({"retry-after": "500"}, 429,
                                                                      "You have exceeded a secondary rate limit")
    answer = client.post(published["url"], json={"short_name": "port-strike"})
    assert answer.status_code == 502 and "slow down" in answer.json()["detail"]


@pytest.mark.parametrize("failure,said", [
    ("timeout", "GitHub did not answer in time. Try again in a moment."),
    ("refused", "Azimut could not reach GitHub. Check this computer's connection."),
])
def test_an_unreachable_github_is_said(client, monkeypatch, failure, said):
    def broken(request: httpx.Request) -> httpx.Response:
        if failure == "timeout":
            raise httpx.ConnectTimeout("timed out", request=request)
        raise httpx.ConnectError("refused", request=request)

    real = githubpages.client
    monkeypatch.setattr(githubpages, "client", lambda transport=None: real(httpx.MockTransport(broken)))
    _connect(client)
    assert client.post("/api/publishing/github/test").json() == {"ok": False, "detail": said, "needs": ""}


def test_a_redirect_is_followed_only_on_api_github_com(client, fake, published):
    fake.fail[("GET", "/repos/octo/articles")] = httpx.Response(
        301, headers={"location": "https://evil.example.org/repos/octo/articles"})
    answer = client.post(published["url"], json={"short_name": "port-strike"})
    assert answer.status_code == 502 and "another address" in answer.json()["detail"]
    assert all(request.url.host == "api.github.com" for request in fake.requests)
    fake.fail.clear()
    moved = {"done": False}

    def renamed(request: httpx.Request) -> httpx.Response:
        if moved["done"]:
            return fake.repo(request, fake.repos["octo/articles"], "", None)
        moved["done"] = True
        return httpx.Response(301, headers={"location": "https://api.github.com/repositories/42"})

    fake.fail[("GET", "/repos/octo/articles")] = renamed
    fake.fail[("GET", "/repositories/42")] = renamed
    assert client.post(published["url"], json={"short_name": "port-strike"}).status_code == 200


# -- the token ---------------------------------------------------------------------------------


def test_the_token_is_kept_apart_owner_only_and_never_sent_back(client, fake, published, caplog):
    caplog.set_level(logging.DEBUG)
    client.post("/api/publishing/github/test")
    client.post(published["url"], json={"short_name": "port-strike"})
    state = client.get("/api/publishing").json()["github"]
    assert state == {"account": "octo", "repo": "articles", "branch": "main",
                     "site": "https://octo.github.io/articles/", "base": "https://octo.github.io/articles/",
                     "token": {"set": True, "hint": f"…{TOKEN[-4:]}"},
                     "website": {"title": "octo", "logo": False, "logo_from": "", "counting": ""}, "categories": [],
                     "added": []}
    for path in ("/api/publishing", "/api/settings", "/api/settings/export",
                 f"/api/cases/{published['cid']}/notes/{published['note']}/editions"):
        assert TOKEN not in client.get(path).text, path
    assert TOKEN not in caplog.text
    for request in fake.requests:
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        assert TOKEN.encode() not in request.content and TOKEN not in str(request.url)
    kept = publishsecrets.path()
    assert json.loads(kept.read_text())["github"]["token"] == TOKEN
    assert TOKEN not in config.settings_path().read_text()
    if sys.platform != "win32":
        assert stat.S_IMODE(kept.stat().st_mode) == 0o600
    # an empty token keeps the one kept; Forget takes the token and the account away
    client.put("/api/publishing/github", json={"token": ""})
    assert publishsecrets.read("github") == TOKEN
    forgotten = client.delete("/api/publishing/github").json()
    assert forgotten == {"account": "", "repo": "articles", "branch": "main", "site": "", "base": "",
                         "token": {"set": False, "hint": ""}, "categories": [], "added": [],
                         "website": {"title": "", "logo": False, "logo_from": "", "counting": ""}}
    assert publishsecrets.read("github") == ""


def test_the_backup_carries_the_repository_never_the_token(client, fake, published):
    client.post("/api/publishing/github/test")
    blob = client.get("/api/settings/export").json()
    assert {key: blob["settings"][key] for key in ("github_account", "github_repo", "github_branch", "github_site")} \
        == {"github_account": "octo", "github_repo": "articles", "github_branch": "main",
            "github_site": "https://octo.github.io/articles/"}
    assert TOKEN not in json.dumps(blob)
    client.delete("/api/publishing/github")
    assert client.post("/api/settings/import", json=blob).status_code == 200
    state = client.get("/api/publishing").json()["github"]
    assert state["account"] == "octo" and state["site"] == "https://octo.github.io/articles/"
    assert state["token"]["set"] is False


def test_names_settings_would_refuse_read_as_none_from_a_backup(client):
    res = client.post("/api/settings/import", json={"settings": {
        "github_account": "-bad-", "github_repo": "../x", "github_branch": "a..b", "github_site": "http://x.org"}})
    assert res.status_code == 200, res.text
    stored = config.load_settings()
    assert (stored["github_account"], stored["github_repo"], stored["github_branch"], stored["github_site"]) \
        == ("", "articles", "main", "")


def test_names_typed_in_settings_are_checked_there(client):
    for body in ({"account": "-octo"}, {"repo": "a/b"}, {"branch": "../main"}, {"token": "not a token"}):
        refused = client.put("/api/publishing/github", json=body)
        assert refused.status_code == 422, body
    assert client.get("/api/publishing").json()["github"]["account"] == ""


def test_another_repository_forgets_the_site_address_it_read(client, fake, published):
    client.post("/api/publishing/github/test")
    assert client.get("/api/publishing").json()["github"]["site"]
    client.put("/api/publishing/github", json={"repo": "reports"})
    state = client.get("/api/publishing").json()["github"]
    assert state["site"] == "" and state["base"] == "https://octo.github.io/reports/"


def test_publishing_before_setup_is_said(client, fake):
    cid = make_case(client, "Unset")
    note = make_note(client, cid, title="Unset")
    answer = client.post(f"/api/cases/{cid}/notes/{note['id']}/github", json={"short_name": "unset"})
    assert answer.status_code == 409 and answer.json()["detail"] == githubpages.NOT_SET
    assert client.post("/api/publishing/github/repository").status_code == 409
    assert fake.requests == []


# -- nothing reaches the network but a press -----------------------------------------------------


def test_no_network_at_startup_or_on_any_read(monkeypatch, tmp_path):
    """Settings, the editions and the dialog's check stay on this machine; Test
    connection, Create the repository, Turn on Pages, Publish, the build watch and an
    edition's Check are the presses that reach GitHub."""
    reached: list[str] = []

    def nowhere(self: Any, request: httpx.Request) -> httpx.Response:
        reached.append(str(request.url))
        raise AssertionError(f"reached {request.url}")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", nowhere)
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    from fastapi.testclient import TestClient

    from azimut.server import create_app

    with TestClient(create_app(), base_url="http://127.0.0.1") as client:
        _connect(client)
        cid = make_case(client, "Quiet")
        note = make_note(client, cid, title="Quiet", content="Words.\n")
        for path in ("/api/settings", "/api/publishing", f"/api/cases/{cid}/notes/{note['id']}/editions",
                     "/api/settings/export"):
            assert client.get(path).status_code == 200, path
        checked = client.post(f"/api/cases/{cid}/notes/pdf/check", json={"notes": [note["id"]], "format": "web",
                                                                         "base_url": "https://octo.github.io/a/b/"})
        assert checked.status_code == 200
        client.put("/api/publishing/github", json={"repo": "reports", "branch": "gh-pages"})
        client.delete("/api/publishing/github")
    assert reached == []


def test_the_engine_reaches_api_github_com_and_nothing_else():
    source = (githubpages.__file__ and open(githubpages.__file__, encoding="utf-8").read()) or ""
    hosts = set(re.findall(r"https://([a-z0-9.-]+)", source))
    assert hosts <= {"api.github.com"}, hosts
    assert notes_web.address("https://octo.github.io/articles/x/")
