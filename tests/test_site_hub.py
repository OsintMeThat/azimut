"""Settings › Website as the site's hub, the server side: the site's own logo, the unlisted role, reading
what the site holds, deleting an article's folder, and the Privacy page starter
(`POST /api/publishing/github/site/read`, `.../site/delete`, `POST /notes/privacy-notice`,
`engine/sitesync.survey`, `githubpages.delete_folder`).

GitHub is `tests/githubfake.py`, never the network. The live site (`tests/fixtures/site/`) is the repository
the read and the delete are held to.
"""

from __future__ import annotations

import io
import json
from typing import Any

import httpx
import pytest
from PIL import Image

from azimut.engine import githubpages, site, sitesync
from azimut.engine.site import Site

from githubfake import TOKEN, FakeGitHub
from notecase import make_case
from test_site_publish import DAY, _card, _changed, _connect, _edit, _marked, _new_note, _the_live_site

READ = "/api/publishing/github/site/read"
DELETE = "/api/publishing/github/site/delete"
ARTICLES = "bab-el-mandab-2026"


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


@pytest.fixture()
def note(client):
    return _new_note(client)


def _png(colour: tuple[int, int, int]) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (64, 64), colour).save(out, "PNG")
    return out.getvalue()


def _card_file(title: str, day: str = "2026-11-21", **more: Any) -> bytes:
    card = {"format": "azimut-article/1", "title": title, "summary": f"About {title}.", "date": day,
            "category": "", "author": "Desk", "role": "article", "layout": "article", "image": "cover.jpg",
            "links": [], "maps": [], **more}
    return json.dumps(card).encode()


def _folder(name: str, title: str, day: str = "2026-11-21", **more: Any) -> dict[str, bytes]:
    """The files an Azimut-published folder holds: its card and its marker files."""
    return {f"{name}/article.json": _card_file(title, day, **more), f"{name}/index.html": b"<p>page</p>",
            f"{name}/share.jpg": b"jpg"}


def _survey(fake: FakeGitHub, files: dict[str, bytes], home: Site | None = None) -> sitesync.Survey:
    """`sitesync.survey` over a repository holding ``files``: the function a read press calls, with no API."""
    fake.make_repo(files=files)
    gh = githubpages.GitHub(TOKEN, githubpages.client(fake.transport()))
    commit = fake.repos["octo/articles"]["refs"]["main"]
    tree = githubpages.read_tree(gh, "octo", "articles", fake.objects[commit][1]["tree"])
    return sitesync.survey(gh, "octo", "articles", home or Site(title="Desk", address="https://desk.example/"), tree)


def _written(fake: FakeGitHub) -> list[httpx.Request]:
    return [request for request in fake.requests if request.method != "GET"]


# -- the site's own logo, else the Publishing logo -------------------------------------------------------------


def test_the_site_pages_carry_the_site_logo_else_the_publishing_one_else_none(client, fake, note):
    fake.make_repo()
    _connect(client)
    assert client.get("/api/publishing").json()["github"]["website"]["logo"] is False
    assert client.get("/api/publishing").json()["github"]["website"]["logo_from"] == ""
    client.post(note["url"], json={"short_name": "port-strike"})
    assert "azimut-site/logo.png" not in fake.files()
    # the Publishing logo is what the site carries when it has none of its own
    publishing, own = _png((30, 90, 160)), _png((200, 40, 40))
    client.post("/api/settings/signature", files={"file": ("logo.png", publishing, "image/png")})
    website = client.get("/api/publishing").json()["github"]["website"]
    assert website["logo"] is True and website["logo_from"] == "publishing"
    assert client.post("/api/publishing/github/site").json()["updated"] is True
    assert fake.files()["azimut-site/logo.png"] == publishing
    # a logo of its own replaces it on the site and never on the Publishing side
    client.post("/api/settings/site-logo", files={"file": ("site.png", own, "image/png")})
    website = client.get("/api/publishing").json()["github"]["website"]
    assert website["logo"] is True and website["logo_from"] == "site"
    client.post("/api/publishing/github/site")
    files = fake.files()
    assert files["azimut-site/logo.png"] == own and client.get("/api/settings/signature.png").content == publishing
    # the article pages carry it too
    client.post(note["url"], json={"short_name": "port-strike"})
    assert any(path.endswith("-site-logo.png") and data == own for path, data in fake.files().items())
    assert not any(path.endswith("-site-logo.png") and data == publishing for path, data in fake.files().items())
    # deleting it is back to the Publishing logo, and deleting that leaves none
    client.delete("/api/settings/site-logo")
    assert client.get("/api/publishing").json()["github"]["website"]["logo_from"] == "publishing"
    client.post("/api/publishing/github/site")
    assert fake.files()["azimut-site/logo.png"] == publishing
    client.delete("/api/settings/signature")
    website = client.get("/api/publishing").json()["github"]["website"]
    assert website["logo"] is False and website["logo_from"] == ""


def test_reading_the_settings_and_the_publishing_state_reaches_no_one(client, fake):
    fake.make_repo()
    _connect(client)
    client.post("/api/settings/site-logo", files={"file": ("site.png", _png((1, 2, 3)), "image/png")})
    for path in ("/api/settings", "/api/publishing", "/api/settings/site-logo.png", "/api/settings/export"):
        assert client.get(path).status_code == 200
    assert fake.requests == []


# -- unlisted ----------------------------------------------------------------------------------------------------


def test_an_unlisted_note_is_online_at_its_address_and_in_no_list_feed_sitemap_or_category(client, fake, note):
    fake.make_repo()
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike", "category": "Harbour"})
    draft = _new_note(client, title="A draft", text="Words for one reader.\n")
    answer = client.post(draft["url"], json={"short_name": "a-draft", "role": "unlisted", "category": "Secret"})
    assert answer.status_code == 200, answer.text
    files = fake.files()
    assert "a-draft/index.html" in files and _card(files, "a-draft")["role"] == "unlisted"
    listed = json.loads(files["articles.json"])
    assert [line["title"] for line in listed["articles"]] == ["Port strike"] and listed["pages"] == []
    for path in ("articles.json", "feed.xml", "sitemap.xml", "index.html"):
        assert "a-draft" not in files[path].decode() and "A draft" not in files[path].decode(), path
    assert "data-category=\"secret\"" not in files["index.html"].decode()
    # its category adds none: not to the home's tabs, nor to the categories kept for the dialog
    assert ">Secret<" not in files["index.html"].decode()
    assert client.get("/api/publishing").json()["github"]["categories"] == ["Harbour"]
    # the choice is kept with the note, and a later press without one keeps it
    look = client.get(f"/api/cases/{draft['cid']}/notes/{draft['note']}/look").json()["look"]
    assert look["role"] == "unlisted"
    client.post(draft["url"], json={"short_name": "a-draft"})
    assert _card(fake.files(), "a-draft")["role"] == "unlisted"
    assert "a-draft" not in fake.files()["sitemap.xml"].decode()
    # the read still shows it, with its role
    items = {item["folder"]: item for item in client.post(READ).json()["items"]}
    assert items["a-draft"]["role"] == "unlisted" and items["port-strike"]["role"] == "article"


def test_an_article_made_unlisted_leaves_every_list_and_the_sitemap_it_was_in(client, fake, note):
    fake.make_repo()
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike"})
    assert "/port-strike/" in fake.files()["sitemap.xml"].decode()
    assert client.post(note["url"], json={"short_name": "port-strike", "role": "unlisted"}).status_code == 200
    files = fake.files()
    for path in ("articles.json", "feed.xml", "sitemap.xml", "index.html"):
        assert "port-strike" not in files[path].decode(), path
    assert json.loads(files["articles.json"])["articles"] == []
    # and an article again is listed again
    client.post(note["url"], json={"short_name": "port-strike", "role": "article"})
    assert "/port-strike/" in fake.files()["sitemap.xml"].decode()
    assert client.post(note["url"], json={"short_name": "port-strike", "role": "secret"}).status_code == 422


def test_unlisted_is_a_look_value_a_note_keeps_and_a_template_may_carry():
    from azimut.engine import notelook

    look = notelook.NoteLook.model_validate({"role": "unlisted"})
    assert look.role == "unlisted" and look.model_dump(mode="json")["role"] == "unlisted"
    assert notelook.TemplateLook.model_validate({"role": "unlisted"}).role == "unlisted"
    assert site.UNLISTED == "unlisted"


# -- reading the site --------------------------------------------------------------------------------------------


def test_the_read_lists_every_card_newest_first_with_addresses_on_the_site(client, fake):
    _the_live_site(client, fake)
    before = len(fake.requests)
    said = client.post(READ).json()
    assert list(said) == ["ok", "address", "home", "bar", "footer", "items", "categories", "marked", "legal", "privacy",
                          "last", "size", "warnings"]
    assert said["ok"] is True and said["address"] == "https://osintmethat.com/" and said["warnings"] == []
    assert [(item["folder"], item["role"], item["layout"]) for item in said["items"]] == [
        (ARTICLES, "article", "article"), ("bab-el-mandab-2026-map", "article", "map"),
        ("2026/08/13/installing-azimut-the-complete-guide", "article", "article"),
        ("2026/03/12/operation-absolute-resolve-the-night-maduro-was-taken-a-full-osint-reconstruction",
         "article", "article"),
        ("operation-absolute-resolve-map", "article", "map"),
        ("2026/01/12/the-shadow-of-operation-absolute-resolve", "article", "article"),
        ("2026/01/05/lost-in-low-res-how-to-reconstruct-rare-military-patches-using-osint-and-ai",
         "article", "article")]
    first = said["items"][0]
    assert list(first) == ["folder", "address", "title", "summary", "date", "date_label", "category", "role",
                           "layout", "image", "bytes", "author", "deletable"]
    assert first["address"] == f"https://osintmethat.com/{ARTICLES}/"
    assert first["title"] == "The fall of the Bab al-Mandab front, Sep-Nov 2026"
    assert first["date"] == "2026-11-20" and first["date_label"] == "20 November 2026"
    assert first["category"] == "Conflict Watch" and first["summary"]
    assert first["author"] == "OSINT Me That" and "author_image" not in first
    assert first["image"] == f"https://osintmethat.com/{ARTICLES}/cover.jpg"
    assert said["items"][2]["address"] == (
        "https://osintmethat.com/2026/08/13/installing-azimut-the-complete-guide/")
    # a read, and only that: GETs, and not a thing written anywhere
    assert not _written(fake) and len(fake.requests) > before
    assert all(request.url.host == "api.github.com" for request in fake.requests)


def test_the_read_counts_the_categories_of_the_listed_cards_and_names_the_pages_that_list_them(client, fake):
    _the_live_site(client, fake)
    said = client.post(READ).json()
    # a category only a marked page names is one too, with no article yet
    assert said["categories"] == [
        {"name": "Investigations", "count": 3, "pages": ["investigations/"]},
        {"name": "Conflict Watch", "count": 2, "pages": ["conflict-watch/"]},
        {"name": "Methods & Tools", "count": 2, "pages": ["methods-tools/"]},
        {"name": "Deep Dives", "count": 0, "pages": ["deep-dives/"]}]
    # every page with Azimut's markers: the root page, then the ones one level down (a card's folder is no page)
    assert said["marked"] == ["", "conflict-watch/", "deep-dives/", "investigations/", "maps/", "methods-tools/"]
    # the categories are kept for the publish dialog as /github/categories keeps them, a section too
    assert client.get("/api/publishing").json()["github"]["categories"] == [
        "Conflict Watch", "Deep Dives", "Investigations", "Methods & Tools"]
    assert said["home"] == "yours" and said["legal"] == "legal-notice/" and said["privacy"] == "privacy/"


def test_the_read_shows_pages_and_unlisted_cards_but_counts_only_the_listed(client, fake):
    _the_live_site(client, fake)
    _edit(fake, "about/article.json", _card_file("About", "2026-11-22", role="page", category="Pages"))
    _edit(fake, "about/index.html", b"<p>about</p>")
    _edit(fake, "draft/article.json", _card_file("A draft", "2026-11-23", role="unlisted", category="Secret"))
    _edit(fake, "draft/index.html", b"<p>draft</p>")
    said = client.post(READ).json()
    assert [(item["folder"], item["role"]) for item in said["items"][:2]] == [("draft", "unlisted"), ("about", "page")]
    assert len(said["items"]) == 9
    assert {category["name"] for category in said["categories"] if category["count"]} == {
        "Investigations", "Conflict Watch", "Methods & Tools"}
    assert {category["name"] for category in said["categories"]} == {"Investigations", "Conflict Watch",
                                                                      "Methods & Tools", "Deep Dives"}
    # an unlisted page adds no category anywhere public; a page keeps the one it names
    assert "Secret" not in client.get("/api/publishing").json()["github"]["categories"]
    assert "Pages" in client.get("/api/publishing").json()["github"]["categories"]


def test_the_home_is_azimuts_the_analysts_or_none(client, fake):
    fake.make_repo()
    _connect(client)
    said = client.post(READ).json()
    assert said["home"] == "none" and said["items"] == [] and said["marked"] == [] and said["categories"] == []
    assert said["legal"] == "" and said["privacy"] == ""
    client.post("/api/publishing/github/site")
    said = client.post(READ).json()
    # the home Azimut wrote has its lists marked, and its pages are the ones with a marker
    assert said["home"] == "azimut" and said["marked"] == [""]
    _edit(fake, "index.html", b"<h1>Mine</h1>")
    said = client.post(READ).json()
    assert said["home"] == "yours" and said["marked"] == []
    _edit(fake, "index.html", b"<h1>Mine</h1><!-- azimut:articles --><!-- /azimut:articles -->")
    assert client.post(READ).json()["marked"] == [""]


@pytest.mark.parametrize("name", sitesync.LEGAL_FOLDERS)
def test_the_legal_notice_is_found_by_the_folder_names_sites_give_it(fake, name):
    assert _survey(fake, {"README.md": b"x", f"{name}/index.html": b"<p>legal</p>"}).legal == f"{name}/"


@pytest.mark.parametrize("name", sitesync.PRIVACY_FOLDERS)
def test_the_privacy_page_is_found_by_the_folder_names_sites_give_it(fake, name):
    found = _survey(fake, {"README.md": b"x", f"{name}/index.html": b"<p>privacy</p>"})
    assert found.privacy == f"{name}/" and found.legal == ""


def test_a_legal_or_privacy_page_is_found_by_the_title_of_its_card_when_no_folder_is_named_so(fake):
    found = _survey(fake, {"README.md": b"x", **_folder("terms", "Legal notice", role="page"),
                           **_folder("data", "privacy", role="page"), **_folder("other", "Something else")})
    assert (found.legal, found.privacy) == ("terms/", "data/")
    # a folder with no index.html is no page, and a folder named so wins over a card
    found = _survey(fake, {"README.md": b"x", "legal/notes.txt": b"x", **_folder("terms", "Legal notice")})
    assert found.legal == "terms/"
    found = _survey(fake, {"README.md": b"x", "imprint/index.html": b"x", **_folder("terms", "Legal notice")})
    assert found.legal == "imprint/"
    assert _survey(fake, {"README.md": b"x"}).legal == ""


def test_the_survey_reads_a_tree_without_an_api_and_each_item_is_the_card_as_the_list_reads_it(fake):
    found = _survey(fake, {
        "README.md": b"x",
        **_folder("older", "Older", "2026-01-01", category="Harbour", image="https://example.org/p.jpg"),
        **_folder("newer", "Newer", "2026-03-01", category="Harbour", layout="map"),
        **_folder("hidden", "Hidden", "2026-02-01", role="unlisted", category="Harbour"),
        "theme/article.json": _card_file("A skipped folder"),
        "article.json": _card_file("Not a folder")})
    assert [item["folder"] for item in found.items] == ["newer", "hidden", "older"]
    older = found.items[2]
    assert older["image"] == "https://example.org/p.jpg" and older["address"] == "https://desk.example/older/"
    assert found.items[0]["image"] == "https://desk.example/newer/cover.jpg" and found.items[0]["layout"] == "map"
    assert found.categories == [{"name": "Harbour", "count": 2, "pages": []}]
    assert found.found == ["Harbour"] and found.home == "none"
    # a site under a path names its pictures under it
    under = _survey(fake, _folder("older", "Older"), Site(title="Desk", address="https://octo.github.io/articles/"))
    assert under.items[0]["address"] == "https://octo.github.io/articles/older/"
    assert under.items[0]["image"] == "https://octo.github.io/articles/older/cover.jpg"


def test_a_card_that_does_not_read_is_no_item_and_a_page_with_no_marker_is_not_marked(fake):
    found = _survey(fake, {"README.md": b"x", "broken/article.json": b"{not json", "broken/index.html": b"x",
                           "plain/index.html": b"<p>no markers</p>", **_folder("fine", "Fine")})
    assert [item["folder"] for item in found.items] == ["fine"] and found.marked == []


def test_the_read_says_when_the_site_is_too_large_to_read(client, fake):
    _the_live_site(client, fake)
    fake.truncated = True
    said = client.post(READ).json()
    assert said["ok"] is True and said["items"] == [] and said["warnings"] == [sitesync.TREE_TOO_LONG_READ]
    assert said["size"]["site"] is None and said["last"] is not None
    # the categories kept are not blanked by a read that saw nothing
    assert client.get("/api/publishing").json()["github"]["categories"] == []


def test_a_site_past_the_card_bound_shows_the_first_cards_with_a_word(client, fake, monkeypatch):
    _the_live_site(client, fake)
    monkeypatch.setattr(site, "MAX_CARDS", 3)
    said = client.post(READ).json()
    assert len(said["items"]) == 3 and said["warnings"] == [sitesync.TOO_MANY_CARDS_READ]


def test_a_site_past_the_page_bound_is_looked_through_up_to_it_with_a_word(client, fake, monkeypatch):
    _the_live_site(client, fake)
    monkeypatch.setattr(site, "MAX_PAGES", 2)
    said = client.post(READ).json()
    # the first two pages, in order: the analyst's own about page holds no marker, the next one does
    assert said["warnings"] == [sitesync.TOO_MANY_PAGES_READ] and said["marked"] == ["", "conflict-watch/"]


def test_what_the_read_remembers_it_does_not_read_again(client, fake):
    _the_live_site(client, fake)
    client.post(READ)
    first = len([request for request in fake.requests if "/git/blobs/" in request.url.path])
    assert first > 0
    client.post(READ)
    assert len([request for request in fake.requests if "/git/blobs/" in request.url.path]) == first


def test_the_read_says_what_is_missing_and_needs_the_token(client, fake):
    assert client.post(READ).status_code == 409
    _connect(client)
    assert client.post(READ).json()["needs"] == "repository"
    fake.make_repo(pages=False)
    assert client.post(READ).json() == {"ok": False, "needs": "pages", "detail": "Pages is off for octo/articles."}
    assert not _written(fake)


def test_the_read_says_what_github_said_when_it_fails_and_when_pages_serves_another_branch(client, fake):
    fake.make_repo()
    _connect(client)
    fake.fail[("GET", r"/repos/octo/articles/git/trees/[0-9a-f]{40}")] = httpx.Response(500, json={})
    answer = client.post(READ)
    assert answer.status_code == 502 and "GitHub is having trouble" in answer.json()["detail"]
    fake.fail.clear()
    fake.repos["octo/articles"]["pages"]["source"]["branch"] = "gh-pages"
    assert client.post(READ).status_code == 409


def test_the_last_commit_is_the_branch_heads_date_and_first_line(client, fake):
    _the_live_site(client, fake)
    assert client.post(READ).json()["last"] == {"date": "2026-11-21T13:55:52Z", "message": "Initial commit"}
    fake.commit_date = "2026-11-22T08:00:01Z"
    client.post("/api/publishing/github/site")
    assert client.post(READ).json()["last"] == {"date": "2026-11-22T08:00:01Z", "message": "Update the site"}
    # only the first line of a longer message, and a date that does not read is no last commit
    head = fake.repos["octo/articles"]["refs"]["main"]
    fake.repos["octo/articles"]["refs"]["main"] = fake.commit(fake.objects[head][1]["tree"], [head],
                                                               "  A subject\n\nand a longer body\n")
    assert client.post(READ).json()["last"]["message"] == "A subject"
    fake.commit_date = "yesterday"
    fake.repos["octo/articles"]["refs"]["main"] = fake.commit(fake.objects[head][1]["tree"], [head], "x")
    assert client.post(READ).json()["last"] is None


def test_the_read_gives_the_weight_of_the_site_of_each_item_and_of_the_repository(client, fake):
    _the_live_site(client, fake)
    said = client.post(READ).json()
    files = fake.files()
    assert said["size"] == {"site": sum(len(data) for data in files.values()), "repository": 2048 * 1024}
    item = next(one for one in said["items"] if one["folder"] == ARTICLES)
    assert item["bytes"] == sum(len(data) for path, data in files.items() if path.startswith(f"{ARTICLES}/"))
    assert item["bytes"] > 0
    nested = next(one for one in said["items"] if one["folder"].startswith("2026/01/12/"))
    assert nested["bytes"] == sum(len(data) for path, data in files.items() if path.startswith(nested["folder"] + "/"))
    other = next(one for one in said["items"] if one["folder"] == "bab-el-mandab-2026-map")
    assert other["bytes"] == sum(len(data) for path, data in files.items() if path.startswith("bab-el-mandab-2026-map/"))


def test_a_card_nested_in_another_cards_folder_weighs_in_both(fake):
    found = _survey(fake, {"README.md": b"x" * 7, **_folder("outer", "Outer"), **_folder("outer/inner", "Inner"),
                           **_folder("apart", "Apart")})
    weight = {item["folder"]: item["bytes"] for item in found.items}
    inner = sum(len(data) for data in _folder("outer/inner", "Inner").values())
    own = sum(len(data) for data in _folder("outer", "Outer").values())
    assert weight == {"outer/inner": inner, "outer": own + inner,
                      "apart": sum(len(data) for data in _folder("apart", "Apart").values())}
    assert found.bytes == 7 + own + inner + weight["apart"]


def test_the_repositorys_weight_is_null_when_github_gives_none_and_a_site_on_docs_weighs_docs(client, fake):
    fake.make_repo(files={"README.md": b"x" * 100, "docs/index.html": b"y" * 40, **{
        f"docs/{path}": data for path, data in _folder("older", "Older").items()}})
    fake.repos["octo/articles"]["size"] = None
    fake.repos["octo/articles"]["pages"]["source"]["path"] = "/docs"
    _connect(client)
    said = client.post(READ).json()
    assert said["size"]["repository"] is None
    # the site is what lies under docs/, not the whole repository
    assert said["size"]["site"] == 40 + sum(len(data) for data in _folder("older", "Older").values())
    assert [item["folder"] for item in said["items"]] == ["older"]
    assert said["address"] == "https://octo.github.io/articles/"


def test_the_tree_read_keeps_each_files_size_and_the_repository_read_keeps_its_weight(fake):
    fake.make_repo(files={"a/one.txt": b"12345", "two.txt": b"12"})
    gh = githubpages.GitHub(TOKEN, githubpages.client(fake.transport()))
    commit = fake.repos["octo/articles"]["refs"]["main"]
    tree = githubpages.read_tree(gh, "octo", "articles", fake.objects[commit][1]["tree"])
    assert tree.sizes == {"a/one.txt": 5, "two.txt": 2} and set(tree.sizes) == set(tree.entries)
    assert githubpages.read_tree(gh, "octo", "articles", "").sizes == {}
    repo = githubpages.repository(gh, "octo", "articles")
    assert repo is not None and repo.size == 2048 * 1024
    fake.repos["octo/articles"]["size"] = 0
    again = githubpages.repository(gh, "octo", "articles")
    assert again is not None and again.size == 0


# -- deleting an article's folder ---------------------------------------------------------------------------------


def test_delete_takes_the_folder_off_in_one_commit_and_out_of_every_list_and_the_sitemap(client, fake):
    _the_live_site(client, fake)
    before = fake.files()
    commits = len(fake.history())
    answer = client.post(DELETE, json={"folder": ARTICLES})
    assert answer.status_code == 200, answer.text
    said = answer.json()
    after = fake.files()
    gone = {path for path in before if path.startswith(f"{ARTICLES}/")}
    assert gone == {f"{ARTICLES}/article.json", f"{ARTICLES}/index.html", f"{ARTICLES}/share.jpg"}
    assert set(before) - set(after) == gone
    assert list(said) == ["ok", "commit", "folder", "removed", "written", "warnings"]
    assert said["ok"] is True and said["folder"] == ARTICLES and said["removed"] == 3 and said["warnings"] == []
    assert said["commit"] == fake.repos["octo/articles"]["refs"]["main"]
    # one commit, named for the folder, holding the deletion and the root files together
    assert len(fake.history()) == commits + 1 and len(fake.posted("/git/commits")) == 1
    assert fake.history()[0]["message"] == f"Delete {ARTICLES}"
    # the lists, the feed, the sitemap and the marked pages are those of the site without it
    changed = _changed(before, after)
    assert changed == set(said["written"]) and {"articles.json", "feed.xml", "sitemap.xml", "index.html"} <= changed
    listed = json.loads(after["articles.json"])
    assert all(line["address"] != f"/{ARTICLES}/" for line in listed["articles"])
    assert [line["address"] for line in listed["articles"]][0] == f"/{ARTICLES}-map/"
    assert f"/{ARTICLES}/" not in after["feed.xml"].decode()
    sitemap = after["sitemap.xml"].decode()
    assert f"<loc>https://osintmethat.com/{ARTICLES}/</loc>" not in sitemap
    # the map that article cited has its own line now, and is still in the sitemap
    assert f"<loc>https://osintmethat.com/{ARTICLES}-map/</loc>" in sitemap
    assert "The fall of the Bab al-Mandab front" not in after["index.html"].decode()
    assert "The fall of the Bab al-Mandab front" not in after["conflict-watch/index.html"].decode()
    # everything outside the markers is the analyst's, byte for byte
    for path in ("index.html", "conflict-watch/index.html"):
        assert _marked(after[path].decode()) == _marked(before[path].decode())
    # the pages of the analyst's own that the sitemap lists still are
    assert "<loc>https://osintmethat.com/about-contact/</loc>" in sitemap
    # the categories kept for the dialog are those of the site as it is now
    assert client.get("/api/publishing").json()["github"]["categories"] == [
        "Conflict Watch", "Deep Dives", "Investigations", "Methods & Tools"]


def test_a_folder_deleted_is_gone_from_the_next_read_and_deleting_it_again_is_a_404(client, fake):
    _the_live_site(client, fake)
    assert client.post(DELETE, json={"folder": ARTICLES}).status_code == 200
    assert ARTICLES not in [item["folder"] for item in client.post(READ).json()["items"]]
    again = client.post(DELETE, json={"folder": ARTICLES})
    assert again.status_code == 404 and again.json()["detail"] == "That folder is not on the site any more."
    assert len(fake.posted("/git/commits")) == 1


def test_delete_of_an_article_of_the_default_home_leaves_the_home_empty_and_the_note_in_its_case(client, fake, note):
    fake.make_repo()
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike", "category": "Harbour"})
    assert "Port strike" in fake.files()["index.html"].decode()
    said = client.post(DELETE, json={"folder": "port-strike"}).json()
    files = fake.files()
    assert not [path for path in files if path.startswith("port-strike/")]
    assert said["removed"] > 3 and "index.html" in said["written"]
    home = files["index.html"].decode()
    assert site.owns_home(home) and "No articles yet." in home and "Port strike" not in home
    assert json.loads(files["articles.json"])["articles"] == []
    assert "/port-strike/" not in files["sitemap.xml"].decode() and "Port strike" not in files["feed.xml"].decode()
    assert "azimut-site/site.css" in files
    # the note stays in the case with its record of editions, which is history
    editions = client.get(f"/api/cases/{note['cid']}/notes/{note['note']}/editions").json()["editions"]
    assert editions and editions[0]["format"] == "github" and editions[0]["path"] == "port-strike"
    assert client.get(f"/api/cases/{note['cid']}/notes/{note['note']}").status_code == 200
    # the category it alone named is no longer kept; publishing it again puts it back
    assert client.get("/api/publishing").json()["github"]["categories"] == []
    assert client.post(note["url"], json={"short_name": "port-strike"}).status_code == 200
    assert "port-strike/index.html" in fake.files()


def test_delete_of_an_unlisted_page_commits_the_deletion_alone(client, fake, note):
    fake.make_repo()
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike"})
    draft = _new_note(client, title="A draft", text="Words.\n")
    client.post(draft["url"], json={"short_name": "a-draft", "role": "unlisted"})
    commits = len(fake.history())
    said = client.post(DELETE, json={"folder": "a-draft"}).json()
    assert said["written"] == [] and len(fake.history()) == commits + 1
    assert not [path for path in fake.files() if path.startswith("a-draft/")]
    assert "port-strike/index.html" in fake.files()


def test_delete_works_under_docs_and_rewrites_the_lists_there(client, fake, note):
    fake.make_repo(url="https://octo.github.io/articles/")
    fake.repos["octo/articles"]["pages"]["source"]["path"] = "/docs"
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike"})
    assert "docs/port-strike/article.json" in fake.files()
    said = client.post(DELETE, json={"folder": "port-strike"}).json()
    files = fake.files()
    assert said["ok"] is True and not [path for path in files if path.startswith("docs/port-strike/")]
    assert json.loads(files["docs/articles.json"])["articles"] == []
    assert "README.md" in files and "docs/index.html" in files
    assert client.post(DELETE, json={"folder": "port-strike"}).status_code == 404


@pytest.mark.parametrize("folder, files", [
    ("mine", {"mine/notes.txt": b"x"}),
    ("mine", {"mine/index.html": b"x", "mine/share.jpg": b"x"}),
    ("mine", {"mine/article.json": b'{"format": "other/1", "title": "T", "date": "2026-01-01"}',
              "mine/index.html": b"x", "mine/share.jpg": b"x"}),
    ("mine", {"mine/article.json": b"{not json", "mine/index.html": b"x", "mine/share.jpg": b"x"}),
    ("mine", {"mine/article.json": _card_file("A card"), "mine/index.html": b"x"}),
    ("mine", {"mine/article.json": _card_file("A card"), "mine/share.jpg": b"x"}),
    ("azimut-site", {"azimut-site/site.css": b"x", "azimut-site/site.js": b"x"}),
    ("theme", {"theme/article.json": _card_file("A card"), "theme/index.html": b"x", "theme/share.jpg": b"x"}),
    ("wp-content", {"wp-content/article.json": _card_file("A card"), "wp-content/index.html": b"x",
                    "wp-content/share.jpg": b"x"}),
    ("2026/01/05/lost", {"2026/01/05/lost/article.json": _card_file("A card"), "2026/01/05/lost/index.html": b"x",
                         "2026/01/05/lost/share.jpg": b"x"}),
    ("2026", {"2026/01/05/lost/article.json": _card_file("A card")}),
    ("Mine", {"Mine/article.json": _card_file("A card"), "Mine/index.html": b"x", "Mine/share.jpg": b"x"}),
    ("..", {"x/article.json": _card_file("A card")}),
    (".git", {"x/article.json": _card_file("A card")}),
    ("", {"x/article.json": _card_file("A card")}),
    ("a b", {"x/article.json": _card_file("A card")}),
    ("../x", {"x/article.json": _card_file("A card")}),
    ("x\\y", {"x/article.json": _card_file("A card")}),
])
def test_delete_refuses_a_folder_azimut_did_not_publish_and_writes_nothing(client, fake, folder, files):
    fake.make_repo(files={"README.md": b"x", "index.html": b"<h1>Mine</h1>", **files})
    _connect(client)
    answer = client.post(DELETE, json={"folder": folder})
    assert answer.status_code == 422 and answer.json()["detail"] == "Azimut deletes only the folders it published."
    assert not _written(fake) and len(fake.history()) == 1


def test_each_item_says_whether_a_delete_would_take_it_and_the_delete_agrees(client, fake):
    fake.make_repo(files={
        "README.md": b"x", "index.html": b"<h1>Mine</h1>",
        **_folder("good", "Good", "2026-11-25"),
        **_folder("2026/01/05/nested", "Nested", "2026-11-24"),
        "no-files/article.json": _card_file("No files", "2026-11-23"),
        "no-index/article.json": _card_file("No index", "2026-11-22"), "no-index/share.jpg": b"jpg",
        "no-share/article.json": _card_file("No share", "2026-11-21"), "no-share/index.html": b"x",
        **_folder("Upper", "Upper case", "2026-11-20"),
        **_folder("with_assets", "With assets", "2026-11-19"), "with_assets/assets/a.png": b"png"})
    _connect(client)
    said = {item["folder"]: item["deletable"] for item in client.post(READ).json()["items"]}
    assert said == {"good": True, "2026/01/05/nested": False, "no-files": False, "no-index": False,
                    "no-share": False, "Upper": False, "with_assets": True}
    # the delete takes exactly what the read said it would, and writes nothing for the others
    for folder, deletable in said.items():
        answer = client.post(DELETE, json={"folder": folder})
        assert (answer.status_code == 200) == deletable, (folder, answer.text)
        assert deletable or answer.json()["detail"] == "Azimut deletes only the folders it published."
    assert len(fake.history()) == 3
    left = {item["folder"] for item in client.post(READ).json()["items"]}
    assert left == {folder for folder, deletable in said.items() if not deletable}


def test_the_live_sites_root_folders_are_deletable_and_its_nested_cards_are_not(client, fake):
    _the_live_site(client, fake)
    said = {item["folder"]: item["deletable"] for item in client.post(READ).json()["items"]}
    assert said[ARTICLES] is True and said["bab-el-mandab-2026-map"] is True
    assert said["operation-absolute-resolve-map"] is True
    assert [folder for folder, deletable in said.items() if not deletable] == [
        folder for folder in said if "/" in folder] and len(said) == 7


def test_the_one_guard_of_the_delete_and_of_the_read():
    ours = ("article.json", *githubpages.OURS, "assets/x.png")
    assert githubpages.deletable("port-strike", ours, True) is True
    assert githubpages.deletable("port-strike", ours, False) is False
    assert githubpages.deletable("port-strike", ("article.json", "index.html"), True) is False
    assert githubpages.deletable("port-strike", ("index.html", "share.jpg"), True) is False
    for name in ("a/b", "theme", ".git", "wp-content", "Upper", "", "..", "a b"):
        assert githubpages.deletable_name(name) is False and githubpages.deletable(name, ours, True) is False
    assert githubpages.deletable_name("port-strike") and githubpages.deletable_name("a_b-2")


def test_delete_asks_for_a_name_and_never_a_path_to_walk(client, fake):
    fake.make_repo()
    _connect(client)
    assert client.post(DELETE, json={}).status_code == 422
    assert client.post(DELETE, json={"folder": "x" * 301}).status_code == 422
    assert not _written(fake)


def test_delete_with_the_branch_moved_on_github_is_a_409_and_changes_nothing(client, fake):
    _the_live_site(client, fake)
    before = fake.files()
    head = fake.repos["octo/articles"]["refs"]["main"]
    fake.fail[("PATCH", r"/repos/octo/articles/git/refs/heads/main")] = httpx.Response(
        422, json={"message": "Update is not a fast forward"})
    answer = client.post(DELETE, json={"folder": ARTICLES})
    assert answer.status_code == 409
    assert answer.json()["detail"] == "The branch changed on GitHub while Azimut was deleting: press Delete again."
    assert fake.repos["octo/articles"]["refs"]["main"] == head and fake.files() == before
    # and pressed again once it has settled
    fake.fail.clear()
    assert client.post(DELETE, json={"folder": ARTICLES}).status_code == 200


def test_delete_says_what_is_missing_and_what_github_said(client, fake):
    assert client.post(DELETE, json={"folder": "x"}).status_code == 409
    _connect(client)
    assert client.post(DELETE, json={"folder": "x"}).json()["needs"] == "repository"
    fake.make_repo(pages=False)
    assert client.post(DELETE, json={"folder": "x"}).json()["needs"] == "pages"
    assert not _written(fake)
    fake.make_repo(files=_folder("older", "Older"))
    fake.fail[("POST", r"/repos/octo/articles/git/trees")] = httpx.Response(500, json={})
    answer = client.post(DELETE, json={"folder": "older"})
    assert answer.status_code == 502 and "GitHub is having trouble" in answer.json()["detail"]
    assert len(fake.history()) == 1 and "older/index.html" in fake.files()


def test_delete_of_a_folder_github_cut_short_is_refused_before_anything_is_written(client, fake):
    fake.make_repo(files={"README.md": b"x", **_folder("older", "Older")})
    _connect(client)
    fake.truncated = True
    answer = client.post(DELETE, json={"folder": "older"})
    assert answer.status_code == 422
    assert answer.json()["detail"] == "The folder holds more files than Azimut can read: delete it on GitHub."
    assert not _written(fake) and len(fake.history()) == 1 and "older/index.html" in fake.files()


def test_delete_from_a_site_too_large_to_read_still_removes_the_folder_and_says_the_lists_were_left(
        client, fake, monkeypatch):
    fake.make_repo(files={"README.md": b"x", **_folder("older", "Older")})
    _connect(client)
    # the site's own listing is more than Azimut reads; the folder's is not
    monkeypatch.setattr(githubpages, "MAX_TREE", 50)
    said = client.post(DELETE, json={"folder": "older"}).json()
    assert said["ok"] is True and said["removed"] == 3 and said["written"] == []
    assert said["warnings"] == [site.TREE_TOO_LONG]
    assert not [path for path in fake.files() if path.startswith("older/")]


def test_a_delete_reads_the_site_once_and_reaches_only_github(client, fake):
    _the_live_site(client, fake)
    client.post(DELETE, json={"folder": ARTICLES})
    assert all(request.url.host == "api.github.com" for request in fake.requests)
    # the listing of the site's whole tree, and the one of the folder to remove
    recursive = [request for request in fake.requests if request.method == "GET"
                 and "/git/trees/" in request.url.path and request.url.params.get("recursive")]
    assert len(recursive) == 2
    # the folder goes file by file: a null sha for each blob, none for a folder
    trees = [json.loads(request.content)["tree"] for request in fake.posted("/git/trees")]
    deleting = [entries for entries in trees if any(entry["sha"] is None for entry in entries)]
    assert len(deleting) == 1
    assert [entry for entry in deleting[0] if entry["sha"] is None] == [
        {"path": f"{ARTICLES}/{name}", "mode": "100644", "type": "blob", "sha": None}
        for name in ("article.json", "index.html", "share.jpg")]
    assert not [entry for entry in deleting[0] if entry["type"] == "tree"]


def test_a_delete_keeps_each_files_mode_and_leaves_no_empty_folder_behind(client, fake):
    fake.make_repo(files={"README.md": b"x", **_folder("older", "Older"), "older/assets/deep/a.png": b"png",
                          "older/run.sh": b"#!/bin/sh\n", "kept/notes.txt": b"mine"})
    # one file committed as executable: the mode its listing gives is the one the deletion carries
    head = fake.repos["octo/articles"]["refs"]["main"]
    tree = fake.write_tree(fake.objects[head][1]["tree"], [
        {"path": "older/run.sh", "mode": "100755", "type": "blob", "sha": fake.blob(b"#!/bin/sh\n")}])
    fake.repos["octo/articles"]["refs"]["main"] = fake.commit(tree, [head], "executable")
    _connect(client)
    said = client.post(DELETE, json={"folder": "older"}).json()
    assert said["ok"] is True and said["removed"] == 5
    sent = [entry for request in fake.posted("/git/trees") for entry in json.loads(request.content)["tree"]
            if entry["sha"] is None]
    assert {entry["path"]: entry["mode"] for entry in sent}["older/run.sh"] == "100755"
    assert {entry["mode"] for entry in sent} == {"100644", "100755"}
    # the folder and its subfolders are gone from the tree, not left empty; what is not Azimut's stays
    head = fake.repos["octo/articles"]["refs"]["main"]
    top = fake.objects[fake.objects[head][1]["tree"]][1]
    assert "older" not in top and "kept" in top
    assert not [path for path in fake.files() if path.startswith("older/")]


def test_the_fake_refuses_what_github_does_not_document_as_a_deletion(fake):
    """A null sha deletes a file; it is a 422 for a folder and for a path the tree does not hold."""
    fake.make_repo(files={"a/one.txt": b"1", "b.txt": b"2"})
    gh = githubpages.GitHub(TOKEN, githubpages.client(fake.transport()))
    base = fake.objects[fake.repos["octo/articles"]["refs"]["main"]][1]["tree"]

    def post(entries: list[dict[str, Any]]) -> httpx.Response:
        return gh.http.post(f"{githubpages.API}/repos/octo/articles/git/trees", json={"base_tree": base, "tree": entries},
                            headers={"Authorization": f"Bearer {TOKEN}", "X-GitHub-Api-Version": githubpages.API_VERSION})

    assert post([{"path": "a", "mode": "040000", "type": "tree", "sha": None}]).status_code == 422
    assert post([{"path": "a/missing.txt", "mode": "100644", "type": "blob", "sha": None}]).status_code == 422
    assert post([{"path": "nothing.txt", "mode": "100644", "type": "blob", "sha": None}]).status_code == 422
    assert post([{"path": "a/one.txt", "mode": "100644", "type": "blob", "sha": None}]).status_code == 201


# -- the Privacy page starter ----------------------------------------------------------------------------------


def test_the_privacy_starter_is_a_page_made_once_and_found_again(client):
    cid = make_case(client, "Privacy")
    made = client.post(f"/api/cases/{cid}/notes/privacy-notice")
    assert made.status_code == 200, made.text
    said = made.json()
    assert said["created"] is True and said["title"] == "Privacy" and said["id"]
    text = client.get(f"/api/cases/{cid}/notes/{said['id']}").json()["text"]
    assert text == site.privacy_notice("") and "## Counting readers" in text and "logs visitors' IP addresses" in text
    assert client.get(f"/api/cases/{cid}/notes/{said['id']}/look").json()["look"]["role"] == "page"
    again = client.post(f"/api/cases/{cid}/notes/privacy-notice").json()
    assert again == {"id": said["id"], "title": "Privacy", "created": False}
    # the legal notice is its own page, made beside it
    legal = client.post(f"/api/cases/{cid}/notes/legal-notice").json()
    assert legal["created"] is True and legal["id"] != said["id"] and legal["title"] == "Legal notice"
    assert client.post(f"/api/cases/{cid}/notes/privacy-notice").json()["id"] == said["id"]
    assert client.post("/api/cases/nowhere/notes/privacy-notice").status_code == 404


@pytest.mark.parametrize("prefs, counting, stats", [
    ({}, "This site does not count its readers.", ""),
    ({"site_stats": "goatcounter", "site_stats_code": "desk"},
     "Visits are counted with GoatCounter, which sets no cookie and keeps no personal data: the site sees totals only.",
     "goatcounter"),
    ({"site_stats": "cloudflare", "site_stats_token": "0123456789abcdef"},
     "Visits are counted with Cloudflare Web Analytics, which stores nothing on your device: your browser sends "
     "Cloudflare the page's address and how it loaded, and the site sees totals only.", "cloudflare"),
    # a count named but missing its code counts nobody, and the page says so
    ({"site_stats": "goatcounter"}, "This site does not count its readers.", ""),
])
def test_the_privacy_starter_names_what_the_site_counts_as_settings_has_it(client, prefs, counting, stats):
    if prefs:
        assert client.put("/api/settings/prefs", json=prefs).status_code == 200
    cid = make_case(client, "Privacy")
    note = client.post(f"/api/cases/{cid}/notes/privacy-notice").json()
    text = client.get(f"/api/cases/{cid}/notes/{note['id']}").json()["text"]
    assert text == site.privacy_notice(stats)
    assert f"## Counting readers\n\n{counting}\n\n## Host" in text


def test_the_site_hub_asks_nothing_of_github_for_the_starters(client, fake):
    cid = make_case(client, "Starters")
    client.post(f"/api/cases/{cid}/notes/privacy-notice")
    client.post(f"/api/cases/{cid}/notes/legal-notice")
    assert fake.requests == []
