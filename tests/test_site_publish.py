"""The site a publish keeps: its card, its list, its feed, its sitemap, its home, and what it
leaves alone (`engine/sitesync.py`, `engine/githubpages.py`, `POST /notes/{id}/github`,
`/api/publishing/github/site`).

GitHub is `tests/githubfake.py`. The live site (`tests/fixtures/site/`) is the repository a
publish must not disturb: its home is the analyst's own, its feed, sitemap and list are Azimut's.
"""

from __future__ import annotations

import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import pytest
from PIL import Image

from azimut import config
from azimut.engine import githubpages, notes_web, site, sitehome, sitesync
from azimut.workspace import Case

from ambushfixture import _ground, _image
from githubfake import TOKEN, FakeGitHub
from notecase import make_case, make_note

LIVE = Path(__file__).parent / "fixtures" / "site"
DAY = datetime(2026, 11, 22, 10, 0, tzinfo=timezone.utc)


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
    """What a publish read stays in memory for the next one: each test starts without it."""
    sitesync._kept.clear()
    sitesync._plain.clear()
    sitesync._weight = 0


def _connect(client, **more: str) -> None:
    saved = client.put("/api/publishing/github", json={"account": "octo", "token": TOKEN, **more})
    assert saved.status_code == 200, saved.text


def _the_live_site(client, fake) -> None:
    """GitHub holding the live site, and the settings of the analyst it belongs to."""
    fake.make_repo(files=_live_repo(), url="https://osintmethat.com/")
    _connect(client)
    assert client.put("/api/settings/prefs", json={"site_title": "OSINT Me That"}).status_code == 200


def _live_repo() -> dict[str, bytes]:
    """The live site as its repository holds it: the cards, the marked pages, the feed, the sitemap and
    the list, and the analyst's own pages the sitemap lists."""
    files = {path.relative_to(LIVE).as_posix(): path.read_bytes() for path in LIVE.rglob("*") if path.is_file()}
    for page in ("about-contact", "registration", "legal-notice", "privacy"):
        files[f"{page}/index.html"] = f"<p>{page}, the analyst's own</p>".encode()
    for folder in ("bab-el-mandab-2026", "bab-el-mandab-2026-map", "operation-absolute-resolve-map"):
        files[f"{folder}/index.html"] = b"<p>an article</p>"
        files[f"{folder}/share.jpg"] = b"jpg"
    files["CNAME"] = b"osintmethat.com\n"
    files[".nojekyll"] = b""
    return files


def _new_note(client, *, text: str = "## What we saw\n\nSmoke over the pier.\n", title: str = "Port strike"):
    cid = make_case(client, f"Case of {title}")
    note = make_note(client, cid, title=title, content=text)
    return {"cid": cid, "note": note["id"], "url": f"/api/cases/{cid}/notes/{note['id']}/github"}


@pytest.fixture()
def note(client):
    return _new_note(client)


def _changed(before: dict[str, bytes], after: dict[str, bytes]) -> set[str]:
    return {path for path, data in after.items() if before.get(path) != data}


def _marked(text: str) -> str:
    """A page with its markers' insides left out: what is the analyst's."""
    return site.MARKER.sub(lambda found: f"<!-- azimut:articles{found.group('attrs')}--><!-- /azimut:articles -->", text)


def _card(files: dict[str, bytes], folder: str) -> dict[str, Any]:
    return json.loads(files[f"{folder}/article.json"])


# -- into the live site: only what Azimut made, and only what differs ----------------------------------


def test_a_publish_into_the_live_site_fills_its_markers_and_touches_nothing_else(client, fake, note):
    _the_live_site(client, fake)
    before = fake.files()
    answer = client.post(note["url"], json={"short_name": "port-strike", "category": "Conflict Watch"})
    assert answer.status_code == 200, answer.text
    after = fake.files()
    folder = {path for path in after if path.startswith("port-strike/")}
    # the list, the feed and the sitemap are Azimut's; the home and the category page are the analyst's with
    # markers; a category nothing was added to is not rewritten (the same output, so not committed)
    assert _changed(before, after) - folder == {"articles.json", "feed.xml", "sitemap.xml", "index.html",
                                                "conflict-watch/index.html"}
    assert answer.json()["site"]["written"] == ["articles.json", "conflict-watch/index.html", "feed.xml",
                                                "index.html", "sitemap.xml"]
    # everything outside the markers is the analyst's, byte for byte
    for path in ("index.html", "conflict-watch/index.html"):
        assert _marked(after[path].decode()) == _marked(before[path].decode())
    home = after["index.html"].decode()
    assert "azimut-site" not in home and not site.owns_home(home)
    assert home.index("Port strike") < home.index("The fall of the Bab al-Mandab front")
    assert '<a class="az-more" href="/port-strike/">Continue reading →</a>' in home
    assert "Port strike" not in after["investigations/index.html"].decode()
    # the one commit holds all of it
    assert len(fake.posted("/git/commits")) == 1 and len(fake.history()) == 2
    # none of the home's own files was written: the home is not Azimut's
    assert not [path for path in after if path.startswith("azimut-site/")]


def test_the_list_the_feed_and_the_sitemap_after_a_publish_are_the_sites(client, fake, note):
    _the_live_site(client, fake)
    client.post(note["url"], json={"short_name": "port-strike", "category": "Conflict Watch"})
    files = fake.files()
    listed = json.loads(files["articles.json"])
    assert listed["format"] == "azimut-site/1" and listed["site"]["address"] == "https://osintmethat.com/"
    assert [line["title"] for line in listed["articles"]][:2] == ["Port strike",
                                                                  "The fall of the Bab al-Mandab front, Sep-Nov 2026"]
    assert listed["articles"][0] == {
        "address": "/port-strike/", "title": "Port strike", "summary": "Smoke over the pier.",
        "date": "2026-11-22", "date_label": "22 November 2026", "category": "Conflict Watch",
        "author": "OSINT Me That",
        "layout": "article", "image": "/port-strike/cover.jpg" if "port-strike/cover.jpg" in files else "",
        "maps": []}
    assert listed["pages"] == [] and len(listed["maps"]) == 2
    feed = files["feed.xml"].decode()
    assert feed.index("Port strike") < feed.index("Bab al-Mandab") and "<generator>Azimut</generator>" in feed
    assert "<category>Conflict Watch</category>" in feed
    sitemap = files["sitemap.xml"].decode()
    assert "https://osintmethat.com/port-strike/" in sitemap and "https://osintmethat.com/privacy/" in sitemap
    assert sitemap.startswith('<?xml version="1.0" encoding="utf-8"?>\n<!-- generator: Azimut -->')


def test_a_second_publish_with_nothing_new_writes_only_the_folder(client, fake, note):
    _the_live_site(client, fake)
    client.post(note["url"], json={"short_name": "port-strike"})
    before = fake.files()
    again = client.post(note["url"], json={"short_name": "port-strike"}).json()
    assert again["site"]["written"] == []
    assert _changed(before, fake.files()) == set()


def test_the_analysts_own_home_with_no_marker_is_never_touched(client, fake, note):
    files = {"README.md": b"# mine\n", "index.html": b"<h1>My home</h1>", "feed.xml": b"<rss>the analyst's</rss>",
             "articles.json": b'{"format": "mine/1"}', "sitemap.xml": b"<urlset></urlset>"}
    fake.make_repo(files=files)
    _connect(client)
    answer = client.post(note["url"], json={"short_name": "port-strike"})
    assert answer.status_code == 200, answer.text
    after = fake.files()
    for path in ("index.html", "feed.xml", "articles.json", "sitemap.xml"):
        assert after[path] == files[path], path
    assert answer.json()["site"]["written"] == []
    assert "port-strike/index.html" in after and "azimut-site/site.css" not in after


def test_an_analysts_feed_is_left_while_the_list_and_the_home_are_still_made(client, fake, note):
    fake.make_repo(files={"README.md": b"x", "feed.xml": b"<rss>the analyst's</rss>"})
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike"})
    after = fake.files()
    assert after["feed.xml"] == b"<rss>the analyst's</rss>"
    assert site.owns_home(after["index.html"].decode()) and site.owns_articles(after["articles.json"].decode())
    assert site.owns_sitemap(after["sitemap.xml"].decode())


# -- with no home of its own: Azimut's -------------------------------------------------------------------


def test_with_no_home_the_default_one_is_written_with_its_files_and_kept_up_to_date(client, fake, note):
    fake.make_repo()
    _connect(client)
    client.put("/api/settings/prefs", json={"site_title": "The Desk", "site_tagline": "Notes from the desk."})
    answer = client.post(note["url"], json={"short_name": "port-strike", "category": "Harbour"})
    assert answer.status_code == 200, answer.text
    files = fake.files()
    home = files["index.html"].decode()
    assert site.owns_home(home) and "<title>The Desk</title>" in home and "Notes from the desk." in home
    assert 'href="/articles/port-strike/"' in home and 'data-category="harbour"' in home
    assert "Made with Azimut" in home
    assert {"azimut-site/site.css", "azimut-site/site.js"} <= set(files)
    assert [path for path in files if path.endswith(".woff")] and "azimut-site/count.js" not in files
    # the setting that is the home's alone: its credit, and the tagline, change it at the next press
    client.put("/api/settings/prefs", json={"site_credit_azimut": False, "site_tagline": ""})
    client.post(note["url"], json={"short_name": "port-strike"})
    home = fake.files()["index.html"].decode()
    assert "Made with Azimut" not in home and "Notes from the desk." not in home and site.owns_home(home)
    # a second note joins the first on the same home
    other = _new_note(client, title="Second", text="Words about something else.\n")
    client.post(other["url"], json={"short_name": "second"})
    assert fake.files()["index.html"].decode().count('<li class="az-item') == 2


def test_the_homes_files_follow_the_logo_and_stay_out_of_a_home_that_is_the_analysts(client, fake, note):
    logo = io.BytesIO()
    Image.new("RGB", (64, 64), (30, 90, 160)).save(logo, "PNG")
    config.signature_path().parent.mkdir(parents=True, exist_ok=True)
    config.signature_path().write_bytes(logo.getvalue())
    fake.make_repo()
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike"})
    files = fake.files()
    assert files["azimut-site/logo.png"] == logo.getvalue() and 'src="azimut-site/logo.png"' in files["index.html"].decode()
    fake.make_repo(files={"README.md": b"x", "index.html": b"<h1>Mine</h1>"})
    client.post(note["url"], json={"short_name": "port-strike"})
    assert "azimut-site/logo.png" not in fake.files()


# -- pages -------------------------------------------------------------------------------------------------


def test_a_page_is_off_every_list_listed_under_pages_and_linked_from_the_home(client, fake, note):
    fake.make_repo()
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike"})
    page = _new_note(client, title="Legal notice", text="Hosted by GitHub.\n")
    answer = client.post(page["url"], json={"short_name": "legal-notice", "role": "page"})
    assert answer.status_code == 200, answer.text
    files = fake.files()
    listed = json.loads(files["articles.json"])
    assert [line["title"] for line in listed["articles"]] == ["Port strike"]
    assert listed["pages"] == [{"title": "Legal notice", "address": "/legal-notice/"}]
    assert _card(files, "legal-notice")["role"] == "page"
    home = files["index.html"].decode()
    assert '<nav class="site-pages"><a href="/articles/legal-notice/">Legal notice</a></nav>' in home
    assert home.count('<li class="az-item') == 1 and "Legal notice" not in home.split("</header>")[1]
    assert "Legal notice" not in files["feed.xml"].decode()
    assert "/legal-notice/" in files["sitemap.xml"].decode()
    # the choice is kept with the note, so the next press starts from it
    look = client.get(f"/api/cases/{page['cid']}/notes/{page['note']}/look").json()["look"]
    assert look["role"] == "page"
    assert _changed(files, fake.files()) == set()
    client.post(page["url"], json={"short_name": "legal-notice"})
    assert _card(fake.files(), "legal-notice")["role"] == "page"
    client.post(page["url"], json={"short_name": "legal-notice", "role": "article"})
    assert _card(fake.files(), "legal-notice")["role"] == "article"
    assert client.get(f"/api/cases/{page['cid']}/notes/{page['note']}/look").json()["look"].get("role", "") == ""


def test_the_legal_notice_starter_is_a_page_with_the_host_named_and_is_made_once(client):
    cid = make_case(client, "Legal")
    made = client.post(f"/api/cases/{cid}/notes/legal-notice")
    assert made.status_code == 200, made.text
    said = made.json()
    assert said["created"] is True and said["title"] == "Legal notice"
    text = client.get(f"/api/cases/{cid}/notes/{said['id']}").json()
    assert "GitHub, Inc., 88 Colin P. Kelly Jr. St., San Francisco, CA 94107, United States" in json.dumps(text)
    assert "Name:" in json.dumps(text)
    assert client.get(f"/api/cases/{cid}/notes/{said['id']}/look").json()["look"]["role"] == "page"
    again = client.post(f"/api/cases/{cid}/notes/legal-notice").json()
    assert again == {"id": said["id"], "title": "Legal notice", "created": False}
    assert client.post("/api/cases/nowhere/notes/legal-notice").status_code == 404


# -- the card ---------------------------------------------------------------------------------------------------


def test_the_folder_carries_its_card_and_the_picture_of_its_line(client, fake):
    fake.make_repo()
    cid = make_case(client, "Port strike")
    case = Case.open(cid)
    picture = _image(case, "The pier", _ground(3), {"type": "clipboard"})
    text = f"## What we saw\n\nSmoke over the pier.\n\n[[media:{picture['id']}|The pier]]\n"
    other = make_note(client, cid, title="Port strike", content=text)
    url = f"/api/cases/{cid}/notes/{other['id']}/github"
    _connect(client)
    answer = client.post(url, json={"short_name": "port-strike", "category": " Harbour  news "})
    assert answer.status_code == 200, answer.text
    files = fake.files()
    card = _card(files, "port-strike")
    assert card == {"format": "azimut-article/1", "title": "Port strike", "summary": "Smoke over the pier.",
                    "date": "2026-11-22", "category": "Harbour news", "author": "octo", "role": "article",
                    "layout": "article", "image": "cover.jpg", "links": [], "maps": []}
    cover = Image.open(io.BytesIO(files["port-strike/cover.jpg"]))
    assert cover.format == "JPEG" and cover.size == (1200, 630) and cover.info.get("progressive")
    assert files["port-strike/cover.jpg"] != files["port-strike/share.jpg"]
    assert "port-strike/article.json" in files and "port-strike/HOW-TO-PUBLISH.md" not in files


def test_a_republish_keeps_the_day_of_the_first_and_the_look_names_a_day_of_its_own(client, fake, note, monkeypatch):
    fake.make_repo()
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike"})
    assert _card(fake.files(), "port-strike")["date"] == "2026-11-22"
    monkeypatch.setattr("azimut.api.notes._now", lambda: datetime(2026, 12, 25, 10, 0, tzinfo=timezone.utc).astimezone())
    client.post(note["url"], json={"short_name": "port-strike"})
    assert _card(fake.files(), "port-strike")["date"] == "2026-11-22"
    # a first publication takes the day of the look's cover when it has one
    dated = _new_note(client, title="Dated")
    client.put(f"/api/cases/{dated['cid']}/notes/{dated['note']}/look",
               json={"style": "article", "cover": {"on": True, "date": "2026-03-04"}})
    client.post(dated["url"], json={"short_name": "dated"})
    assert _card(fake.files(), "dated")["date"] == "2026-03-04"


def test_the_card_names_the_site_by_the_report_name_and_the_pages_it_links(client, fake):
    fake.make_repo()
    _connect(client)
    client.put("/api/settings/prefs", json={"report_name": "A. Analyst"})
    first = _new_note(client, title="First story")
    client.post(first["url"], json={"short_name": "first-story"})
    text = ("See [the first story](https://octo.github.io/articles/first-story/) and "
            "[another](../second-one/index.html#top), [outside](https://example.org/x/).\n")
    second = _new_note(client, title="Second", text=text)
    client.post(second["url"], json={"short_name": "second-one"})
    card = _card(fake.files(), "second-one")
    assert card["author"] == "A. Analyst" and card["links"] == ["first-story"]


def test_a_picture_for_the_list_replaces_the_cover_in_the_list_and_never_on_the_page(client, fake):
    fake.make_repo()
    cid = make_case(client, "Covers")
    case = Case.open(cid)

    def solid(colour: tuple[int, int, int]) -> Image.Image:
        return Image.new("RGB", (1200, 630), colour)

    hero = _image(case, "Hero", solid((200, 30, 30)), {"type": "clipboard"})
    designed = _image(case, "Designed", solid((30, 30, 200)), {"type": "clipboard"})
    made = make_note(client, cid, title="Covered", content="Words under a cover.\n")
    url = f"/api/cases/{cid}/notes/{made['id']}"
    look = {"style": "article", "cover": {"on": True, "image": hero["id"]}}
    assert client.put(f"{url}/look", json=look).status_code == 200
    _connect(client)
    client.post(f"{url}/github", json={"short_name": "covered"})

    def centre(files: dict[str, bytes]) -> tuple[int, ...]:
        return Image.open(io.BytesIO(files["covered/cover.jpg"])).convert("RGB").getpixel((600, 315))

    first = fake.files()
    assert centre(first)[0] > 150 and centre(first)[2] < 80
    # a list picture is stored with the look and replaces the cover's in the card
    assert client.put(f"{url}/look", json={**look, "list_image": designed["id"]}).status_code == 200
    client.post(f"{url}/github", json={"short_name": "covered"})
    second = fake.files()
    assert centre(second)[2] > 150 and centre(second)[0] < 80
    # the page's own hero is the cover picture still, and the link card too
    hero = re.compile(r"assets/[0-9a-f]{8}-hero\.[a-z]+")
    seen = hero.findall(first["covered/index.html"].decode())
    assert seen and hero.findall(second["covered/index.html"].decode()) == seen
    assert not re.search(r"designed", second["covered/index.html"].decode(), re.I)
    assert second["covered/share.jpg"] == first["covered/share.jpg"]
    # a picture that is no picture of the case is refused where the look is saved
    assert client.put(f"{url}/look", json={**look, "list_image": "nope"}).status_code == 422
    client.put(f"{url}/look", json={**look, "list_image": ""})
    assert client.get(f"{url}/look").json()["look"].get("list_image", "") == ""


def test_a_list_picture_gone_from_the_case_falls_back_with_a_word(client, fake):
    fake.make_repo()
    cid = make_case(client, "Gone")
    case = Case.open(cid)
    designed = _image(case, "Designed", Image.new("RGB", (600, 300), (30, 30, 200)), {"type": "clipboard"})
    made = make_note(client, cid, title="Gone", content="Words.\n")
    url = f"/api/cases/{cid}/notes/{made['id']}"
    assert client.put(f"{url}/look", json={"style": "article", "list_image": designed["id"]}).status_code == 200
    case.update_entity(designed["id"], {"attrs": {"path": "media/missing.png"}})
    _connect(client)
    said = client.post(f"{url}/github", json={"short_name": "gone"}).json()
    assert any("list picture" in warning for warning in said["warnings"])
    assert "gone/cover.jpg" in fake.files()


# -- readers counted -----------------------------------------------------------------------------------------


def _policy(page: str) -> dict[str, list[str]]:
    policy = re.search(r'http-equiv="Content-Security-Policy" content="([^"]*)"', page).group(1)
    return {part.split()[0]: part.split()[1:] for part in policy.split("; ")}


def test_a_page_published_to_the_site_has_the_way_back_and_counts_no_one_by_default(client, fake, note):
    logo = io.BytesIO()
    Image.new("RGB", (64, 64), (30, 90, 160)).save(logo, "PNG")
    config.signature_path().parent.mkdir(parents=True, exist_ok=True)
    config.signature_path().write_bytes(logo.getvalue())
    fake.make_repo()
    _connect(client)
    client.put("/api/settings/prefs", json={"site_title": "The Desk"})
    client.post(note["url"], json={"short_name": "port-strike"})
    files = fake.files()
    page = files["port-strike/index.html"].decode()
    assert re.search(r'<body><!-- azimut:bar --><style>.*?</style><nav class="az-site-bar" aria-label="Site"><a href="\.\./">'
                     r'<img src="assets/[0-9a-f]{8}-site-logo\.png" alt="">The Desk</a>'
                     r'<a class="back" href="\.\./">All articles</a></nav><!-- /azimut:bar -->\n', page, re.S)
    assert any(path.endswith("-site-logo.png") and data == logo.getvalue() for path, data in files.items())
    assert "goatcounter" not in page and "cloudflare" not in page and "az-counter" not in page
    assert _policy(page)["script-src"] == ["'self'"] and "connect-src" not in _policy(page)


def test_goatcounter_counts_every_page_of_the_site_through_its_one_host(client, fake, note):
    fake.make_repo()
    _connect(client)
    client.put("/api/settings/prefs", json={"site_stats": "goatcounter", "site_stats_code": "Desk"})
    client.post(note["url"], json={"short_name": "port-strike"})
    files = fake.files()
    page = files["port-strike/index.html"].decode()
    assert '<meta name="az-counter" content="desk">' in page
    policy = _policy(page)
    assert policy["img-src"] == ["'self'", "https://desk.goatcounter.com"]
    assert policy["connect-src"] == ["https://desk.goatcounter.com"] and policy["script-src"] == ["'self'"]
    counter = re.search(r'<script src="(assets/[0-9a-f]{8}-reader-count\.js)"></script>', page).group(1)
    assert b"goatcounter.com" in files[f"port-strike/{counter}"]
    home = files["index.html"].decode()
    assert '<meta name="az-counter" content="desk">' in home and "azimut-site/count.js" in home
    assert b"az-counter" in files["azimut-site/count.js"]
    assert _policy(home)["connect-src"] == ["https://desk.goatcounter.com"]


def test_cloudflare_counts_with_its_two_hosts_and_nothing_else(client, fake, note):
    fake.make_repo()
    _connect(client)
    token = "0123456789abcdef0123456789abcdef"
    saved = client.put("/api/settings/prefs", json={"site_stats": "cloudflare", "site_stats_token": token})
    assert saved.status_code == 200, saved.text
    client.post(note["url"], json={"short_name": "port-strike"})
    files = fake.files()
    tag = site.cloudflare_tag(token)
    for path in ("port-strike/index.html", "index.html"):
        page = files[path].decode()
        assert tag + "\n</body>" in page, path
        policy = _policy(page)
        assert policy["script-src"] == ["'self'", "https://static.cloudflareinsights.com"], path
        assert policy["connect-src"] == ["https://cloudflareinsights.com"], path
        assert policy["default-src"] == ["'none'"] and "az-counter" not in page
    assert "goatcounter" not in files["port-strike/index.html"].decode()


def test_a_folder_exported_by_hand_has_no_bar_no_card_and_no_count(client, fake, note, tmp_path):
    client.put("/api/settings/prefs", json={"site_stats": "goatcounter", "site_stats_code": "desk"})
    case = Case.open(note["cid"])
    made = notes_web.build(case, note["note"], base_url="https://octo.github.io/articles/port-strike/")
    page = made.files["index.html"].decode()
    assert "az-site-bar" not in page and "goatcounter" not in page and made.card is None
    assert "article.json" not in made.files and "cover.jpg" not in made.files


# -- the map page: its way home is in its own header -----------------------------------------------------------


def _map_note(client, monkeypatch, tmp_path):
    import dataclasses

    from mapfixture import fixture_map

    cid = make_case(client, "Maps")
    case = Case.open(cid)
    ground = tmp_path / "ground.png"
    Image.new("RGB", (400, 300), (40, 160, 90)).save(ground, "PNG")
    derived = dataclasses.replace(fixture_map(), ground=ground)
    from azimut.engine import notes_maps

    monkeypatch.setattr(notes_maps, "derive", lambda *_, **__: derived)
    text = "The road, in one line.\n\n::: map\ntitle: The road\nlayer: Front\n:::\n\nWords beside it.\n"
    made = make_note(client, cid, title="The road", content=text)
    client.put(f"/api/cases/{cid}/notes/{made['id']}/look", json={"style": "article", "web": "map"})
    return case, made["id"]


def test_a_map_page_has_the_crumb_in_its_header_and_never_a_bar_and_its_map_is_its_picture(client, monkeypatch,
                                                                                             tmp_path):
    case, note_id = _map_note(client, monkeypatch, tmp_path)
    placement = site.Placement(site.Site(title="The Desk", address="https://octo.github.io/articles/"))
    made = notes_web.build(case, note_id, base_url="https://octo.github.io/articles/the-road/", placement=placement)
    page = made.files["index.html"].decode()
    assert "az-site-bar" not in page.replace(site.BAR_STYLE, "")
    assert re.search(r'<div class="az-mappage-titles">' + re.escape(site.BAR_STYLE)
                     + r'<a class="az-site-crumb" href="\.\./">The Desk</a><h1 class="az-title"', page)
    assert made.card is not None and made.card.layout == "map" and made.card.image == "cover.jpg"
    # the list's picture is the map's own cover (`test_notes_mapcover.py`), its link card as well
    cover = Image.open(io.BytesIO(made.files["cover.jpg"])).convert("RGB")
    assert cover.size == (1200, 630) and made.files["cover.jpg"] == made.files["share.jpg"]
    counted = site.Placement(site.Site(title="The Desk", address="https://octo.github.io/articles/", stats="goatcounter",
                                       code="desk"))
    page = notes_web.build(case, note_id, base_url="https://octo.github.io/articles/the-road/",
                           placement=counted).files["index.html"].decode()
    # the views line appears under the title for the site's count too
    assert '<span class="az-mappage-views" data-counter="desk" hidden></span>' in page


def test_a_map_page_keeps_its_own_counter_over_the_sites(client, monkeypatch, tmp_path):
    case, note_id = _map_note(client, monkeypatch, tmp_path)
    client.put(f"/api/cases/{case.id}/notes/{note_id}/look", json={"style": "article", "web": "map", "counter": "mine"})
    counted = site.Placement(site.Site(title="The Desk", address="https://octo.github.io/articles/", stats="goatcounter",
                                       code="desk"))
    page = notes_web.build(case, note_id, base_url="https://octo.github.io/articles/the-road/",
                           placement=counted).files["index.html"].decode()
    assert 'data-counter="mine"' in page and 'name="az-counter" content="mine"' in page and "desk.goatcounter" not in page


def test_only_an_unlisted_page_asks_search_engines_to_leave_it_out(client, tmp_path):
    cid = make_case(client, "Roles")
    made = make_note(client, cid, title="Port strike", content="Smoke over the pier.\n")
    case = Case.open(cid)
    where = "https://octo.github.io/articles/port-strike/"
    desk = site.Site(title="The Desk", address="https://octo.github.io/articles/")

    def head(placement: site.Placement | None) -> str:
        page = notes_web.build(case, made["id"], base_url=where, placement=placement).files["index.html"].decode()
        return page[:page.index("</head>")]

    noindex = '<meta name="robots" content="noindex">'
    assert noindex in head(site.Placement(desk, role="unlisted"))
    for role in ("article", "page"):
        assert "robots" not in head(site.Placement(desk, role=role)), role
    # a web folder exported to disk is no page of the site
    assert "robots" not in head(None)
    # left to the look, the look's role decides
    client.put(f"/api/cases/{cid}/notes/{made['id']}/look", json={"role": "unlisted"})
    assert noindex in head(site.Placement(desk))
    assert "robots" not in head(site.Placement(desk, role="article"))


def test_a_note_asked_to_be_a_map_page_that_holds_no_map_is_an_article_in_its_card(client, tmp_path):
    cid = make_case(client, "NoMap")
    made = make_note(client, cid, title="No map", content="Words.\n")
    client.put(f"/api/cases/{cid}/notes/{made['id']}/look", json={"style": "article", "web": "map"})
    placement = site.Placement(site.Site(title="T", address="https://octo.github.io/articles/"))
    built = notes_web.build(Case.open(cid), made["id"], base_url="https://octo.github.io/articles/no-map/",
                            placement=placement)
    assert built.card is not None and built.card.layout == "article"
    assert "az-site-bar" in built.files["index.html"].decode()


# -- a folder changed on GitHub since --------------------------------------------------------------------------


def _edit(fake: FakeGitHub, path: str, data: bytes, *, repo: str = "octo/articles") -> None:
    files = fake.files(repo)
    files[path] = data
    tree = fake.write_tree(None, [{"path": name, "mode": "100644", "type": "blob", "sha": fake.blob(content)}
                                  for name, content in files.items()])
    fake.repos[repo]["refs"]["main"] = fake.commit(tree, [fake.repos[repo]["refs"]["main"]], "edit by hand")


def test_a_folder_changed_on_github_is_warned_before_and_after_never_blocked(client, fake, note):
    fake.make_repo()
    _connect(client)
    url = note["url"]
    # nothing published yet: nothing to be changed
    never = client.post(f"{url}/check", json={"short_name": "port-strike"}).json()
    assert never == {"checked": True, "exists": False, "edited": False, "warning": "", "taken": None, "free": ""}
    first = client.post(url, json={"short_name": "port-strike"}).json()
    assert first["edited"] is False
    record = client.get(f"/api/cases/{note['cid']}/notes/{note['note']}/editions").json()["editions"][0]
    assert re.fullmatch(r"[0-9a-f]{40}", record["tree"])
    assert client.post(f"{url}/check", json={"short_name": "port-strike"}).json() == {
        "checked": True, "exists": True, "edited": False, "warning": "", "taken": None, "free": ""}
    _edit(fake, "port-strike/index.html", b"changed by hand")
    warned = client.post(f"{url}/check", json={"short_name": "port-strike"}).json()
    assert warned == {"checked": True, "exists": True, "edited": True, "warning": site.HAND_EDITED, "taken": None, "free": ""}
    assert site.HAND_EDITED == "This folder was changed on GitHub since you published it: publishing replaces it."
    # the press goes through, replaces the folder, and says it did
    again = client.post(url, json={"short_name": "port-strike"})
    assert again.status_code == 200 and again.json()["edited"] is True
    assert fake.files()["port-strike/index.html"] != b"changed by hand"
    assert client.post(f"{url}/check", json={"short_name": "port-strike"}).json()["edited"] is False
    # a record from before the tree was kept has nothing to compare with
    case = Case.open(note["cid"])
    stored = case.get_entity(note["note"])["attrs"]["editions"]
    for item in stored:
        item.pop("tree", None)
    case.update_entity(note["note"], {"attrs": {"editions": stored}})
    _edit(fake, "port-strike/index.html", b"changed again")
    assert client.post(f"{url}/check", json={"short_name": "port-strike"}).json()["edited"] is False
    assert client.post(url, json={"short_name": "port-strike"}).json()["edited"] is False


def test_an_address_another_note_holds_is_named_before_it_is_replaced(client, fake, note):
    """The check tells the note's own folder from another's by the note's records, names what the
    other holds by its card, and offers a short name nothing holds; a deliberate press still replaces it."""
    fake.make_repo(files={"port-strike-2/index.html": b"<p>taken too</p>", "port-strike-2/share.jpg": b"jpg"})
    _connect(client)
    other = _new_note(client, title="Harbour fire")
    assert client.post(other["url"], json={"short_name": "port-strike"}).status_code == 200
    taken = client.post(f"{note['url']}/check", json={"short_name": "port-strike"}).json()
    assert taken == {"checked": True, "exists": True, "edited": False, "warning": "",
                     "taken": {"title": "Harbour fire", "ours": True}, "free": "port-strike-3"}
    # the other note's own folder is no other's to it
    assert client.post(f"{other['url']}/check", json={"short_name": "port-strike"}).json()["taken"] is None
    # a free address says nothing
    assert client.post(f"{note['url']}/check", json={"short_name": "port-strike-9"}).json()["taken"] is None
    # the analyst has the last word: the press replaces it, and the folder is this note's from then on
    assert client.post(note["url"], json={"short_name": "port-strike"}).status_code == 200
    assert _card(fake.files(), "port-strike")["title"] == "Port strike"
    assert client.post(f"{note['url']}/check", json={"short_name": "port-strike"}).json()["taken"] is None


def test_an_address_holding_a_page_names_it_by_its_title_and_says_what_azimut_did_not_make(client, fake, note):
    fake.make_repo(files={
        "harbour/index.html": b"<html><head><title>Harbour &amp; fire\n  log</title></head><body></body></html>",
        "atlas/index.html": b"<html><head><title>The atlas</title></head></html>", "atlas/share.jpg": b"jpg",
        "bare/readme.txt": b"no page", "license": b"a file at the root"})
    _connect(client)
    asked = len(fake.requests)
    said = {short: client.post(f"{note['url']}/check", json={"short_name": short}).json()
            for short in ("harbour", "atlas", "bare", "license", "free-one")}
    # the check reads, and writes nothing
    assert {request.method for request in fake.requests[asked:]} == {"GET"}
    # a folder of the analyst's own: named by its page, and not Azimut's, which a publish refuses
    assert said["harbour"]["taken"] == {"title": "Harbour & fire log", "ours": False}
    assert said["harbour"]["free"] == "harbour-2"
    # a folder Azimut made that holds no card, such as a map page from before cards: its page's title
    assert said["atlas"]["taken"] == {"title": "The atlas", "ours": True}
    # nothing to read a title from: the folder's name
    assert said["bare"]["taken"] == {"title": "bare", "ours": False}
    # a file of that name at the site's root holds the address too
    assert said["license"] == {"checked": True, "exists": False, "edited": False, "warning": "",
                               "taken": {"title": "license", "ours": False}, "free": "license-2"}
    assert said["free-one"]["taken"] is None and said["free-one"]["free"] == ""
    refused = client.post(note["url"], json={"short_name": "harbour"})
    assert refused.status_code == 502 and "that Azimut did not make" in refused.json()["detail"]


def test_the_check_before_publishing_is_a_read_and_says_what_is_missing(client, fake, note):
    fake.make_repo(pages=False)
    _connect(client)
    said = client.post(f"{note['url']}/check", json={"short_name": "port-strike"}).json()
    assert said == {"checked": False, "exists": False, "edited": False, "warning": "", "taken": None, "free": ""}
    assert [request.method for request in fake.requests] == ["GET"] * len(fake.requests)
    assert client.post(f"{note['url']}/check", json={"short_name": "../x"}).status_code == 422
    fake.make_repo()
    unset = client.delete("/api/publishing/github")
    assert unset.status_code == 200
    assert client.post(f"{note['url']}/check", json={"short_name": "port-strike"}).status_code == 409


def test_a_moved_branch_keeps_todays_answer(client, fake, note):
    fake.make_repo()
    _connect(client)
    from azimut.engine.githubpages import GitHubError  # noqa: F401

    fake.fail[("PATCH", r"/repos/octo/articles/git/refs/heads/main")] = httpx.Response(
        422, json={"message": "Update is not a fast forward"})
    answer = client.post(note["url"], json={"short_name": "port-strike"})
    assert answer.status_code == 502
    assert answer.json()["detail"] == "The branch changed on GitHub while Azimut was publishing: press Publish again."


# -- the site on its own press --------------------------------------------------------------------------------


def test_update_the_site_rebuilds_the_root_files_without_a_note_and_stops_when_it_is_up_to_date(client, fake):
    _the_live_site(client, fake)
    # a card the analyst added by hand, which the list does not know yet
    card = {"format": "azimut-article/1", "title": "Added by hand", "summary": "S.", "date": "2026-11-21",
            "category": "Investigations", "author": "OSINT Me That", "layout": "article", "image": "", "links": [],
            "maps": []}
    _edit(fake, "added-by-hand/article.json", json.dumps(card).encode())
    _edit(fake, "added-by-hand/index.html", b"<p>mine</p>")
    before = fake.files()
    commits = len(fake.history())
    said = client.post("/api/publishing/github/site").json()
    assert said["ok"] and said["updated"] is True and said["warnings"] == []
    after = fake.files()
    assert _changed(before, after) == {"articles.json", "feed.xml", "sitemap.xml", "index.html",
                                       "investigations/index.html"}
    assert said["written"] == sorted(_changed(before, after)) and len(fake.history()) == commits + 1
    assert fake.history()[0]["message"] == "Update the site"
    assert "Added by hand" in after["index.html"].decode()
    # nothing left to change: nothing is committed
    quiet = client.post("/api/publishing/github/site").json()
    assert quiet["ok"] and quiet["updated"] is False and quiet["commit"] == "" and quiet["written"] == []
    assert len(fake.history()) == commits + 1


def test_update_the_site_says_what_is_missing_and_needs_the_token(client, fake):
    assert client.post("/api/publishing/github/site").status_code == 409
    _connect(client)
    assert client.post("/api/publishing/github/site").json()["needs"] == "repository"
    fake.make_repo(pages=False)
    assert client.post("/api/publishing/github/site").json() == {
        "ok": False, "needs": "pages", "detail": "Pages is off for octo/articles."}
    assert not [request for request in fake.requests if request.method != "GET"]


def test_update_the_site_writes_the_home_of_a_site_that_has_none(client, fake):
    fake.make_repo()
    _connect(client)
    said = client.post("/api/publishing/github/site").json()
    assert said["updated"] is True
    files = fake.files()
    assert site.owns_home(files["index.html"].decode()) and "No articles yet." in files["index.html"].decode()
    assert json.loads(files["articles.json"])["articles"] == []


def test_a_site_served_from_docs_keeps_all_of_it_under_docs(client, fake, note):
    fake.make_repo(url="https://octo.github.io/articles/")
    fake.repos["octo/articles"]["pages"]["source"]["path"] = "/docs"
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike"})
    files = fake.files()
    assert {"docs/index.html", "docs/articles.json", "docs/feed.xml", "docs/sitemap.xml", "docs/.nojekyll",
            "docs/azimut-site/site.css", "docs/port-strike/article.json"} <= set(files)
    assert not [path for path in files if path in ("index.html", "articles.json", "feed.xml", "sitemap.xml")]
    assert json.loads(files["docs/articles.json"])["articles"][0]["address"] == "/port-strike/"
    # the first update learns which bar the articles carry and keeps it in the list, under docs/ too
    said = client.post("/api/publishing/github/site").json()
    assert said["written"] == ["articles.json"] and json.loads(fake.files()["docs/articles.json"])["bar"] == "azimut"
    assert client.post("/api/publishing/github/site").json()["updated"] is False


# -- bounds: what is too much is said, never a failed publish ---------------------------------------------------


def test_a_tree_github_cuts_short_leaves_the_list_as_it_was_and_the_publish_goes_through(client, fake, note):
    _the_live_site(client, fake)
    fake.truncated = True
    before = fake.files()
    answer = client.post(note["url"], json={"short_name": "port-strike"})
    assert answer.status_code == 200, answer.text
    said = answer.json()["site"]
    assert said == {"written": [], "warnings": [site.TREE_TOO_LONG]}
    after = fake.files()
    assert _changed(before, after) == {path for path in after if path.startswith("port-strike/")}


def test_a_site_past_the_card_bound_leaves_its_list_as_it_was_with_a_word(client, fake, note, monkeypatch):
    _the_live_site(client, fake)
    monkeypatch.setattr(site, "MAX_CARDS", 3)
    before = fake.files()
    said = client.post(note["url"], json={"short_name": "port-strike"}).json()
    assert said["site"] == {"written": [], "warnings": [site.TOO_MANY_CARDS]}
    assert _changed(before, fake.files()) == {path for path in fake.files() if path.startswith("port-strike/")}


def test_a_card_or_a_page_past_its_size_is_left_out_and_the_rest_is_made(client, fake, note, monkeypatch):
    files = _live_repo()
    files["huge/article.json"] = b" " * (site.MAX_CARD_BYTES + 10)
    files["huge/index.html"] = b"x"
    fake.make_repo(files=files, url="https://osintmethat.com/")
    _connect(client)
    client.put("/api/settings/prefs", json={"site_title": "OSINT Me That"})
    monkeypatch.setattr(site, "MAX_PAGE_BYTES", 11_000)
    answer = client.post(note["url"], json={"short_name": "port-strike", "category": "Conflict Watch"})
    assert answer.status_code == 200, answer.text
    after = fake.files()
    assert "Port strike" in after["conflict-watch/index.html"].decode()
    # a page too large to read stays as it is
    assert after["investigations/index.html"] == files["investigations/index.html"]
    assert len(json.loads(after["articles.json"])["articles"]) == 6


def test_too_many_pages_to_look_through_are_said_and_the_first_are_filled(client, fake, note, monkeypatch):
    files = {"README.md": b"x"}
    for number in range(5):
        files[f"p{number}/index.html"] = b'<!-- azimut:articles section="X" -->\n<!-- /azimut:articles -->'
    fake.make_repo(files=files)
    monkeypatch.setattr(site, "MAX_PAGES", 3)
    _connect(client)
    said = client.post(note["url"], json={"short_name": "port-strike"}).json()["site"]
    assert said["warnings"] == [sitesync.TOO_MANY_PAGES]
    after = fake.files()
    assert sum("No articles yet." in after[f"p{number}/index.html"].decode() for number in range(5)) == 3


def test_a_repeat_publish_reads_next_to_nothing_it_read_before(client, fake, note):
    _the_live_site(client, fake)

    def blob_reads() -> int:
        return len([request for request in fake.requests
                    if request.method == "GET" and "/git/blobs/" in request.url.path])

    client.post(note["url"], json={"short_name": "port-strike"})
    first = blob_reads()
    assert first >= 8  # the seven cards, the pages, the three files
    client.post(note["url"], json={"short_name": "port-strike"})
    # what the repository already held is remembered by its blob id; what the first publish wrote, too
    assert blob_reads() - first <= 1


# -- the categories ----------------------------------------------------------------------------------------------


def test_the_categories_are_those_of_the_cards_and_of_the_marked_pages(client, fake, note):
    _the_live_site(client, fake)
    assert client.get("/api/publishing").json()["github"]["categories"] == []
    read = client.post("/api/publishing/github/categories").json()
    assert read == {"ok": True, "warnings": [], "categories": ["Conflict Watch", "Deep Dives", "Investigations",
                                                                 "Methods & Tools"]}
    assert all(request.method == "GET" for request in fake.requests)
    kept = client.get("/api/publishing").json()["github"]["categories"]
    assert kept == read["categories"]
    # a publish keeps them current, with the new category
    client.post(note["url"], json={"short_name": "port-strike", "category": "Harbour"})
    assert "Harbour" in client.get("/api/publishing").json()["github"]["categories"]
    # another repository is another site
    client.put("/api/publishing/github", json={"repo": "reports"})
    assert client.get("/api/publishing").json()["github"]["categories"] == []
    assert client.post("/api/publishing/github/categories").json()["needs"] == "repository"


def test_the_category_chosen_is_kept_with_the_note_and_an_empty_one_is_none(client, fake, note):
    fake.make_repo()
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike", "category": "Harbour"})
    base = f"/api/cases/{note['cid']}/notes/{note['note']}"
    assert client.get(f"{base}/look").json()["look"]["category"] == "Harbour"
    client.post(note["url"], json={"short_name": "port-strike"})
    assert _card(fake.files(), "port-strike")["category"] == "Harbour"
    client.post(note["url"], json={"short_name": "port-strike", "category": ""})
    assert _card(fake.files(), "port-strike")["category"] == ""
    assert client.get(f"{base}/look").json()["look"].get("category", "") == ""


# -- Pages built by a workflow ------------------------------------------------------------------------------------


def test_a_site_built_by_a_workflow_says_its_build_must_copy_the_folders_through(client, fake):
    fake.make_repo()
    fake.repos["octo/articles"]["pages"]["build_type"] = "workflow"
    _connect(client)
    said = client.post("/api/publishing/github/test").json()
    assert said["ok"] and said["workflow"] is True
    assert said["warnings"] == [site.WORKFLOW_NOTICE]
    assert site.WORKFLOW_NOTICE == ("Pages here is built by a GitHub Actions workflow: its build must copy "
                                    "Azimut's folders through to the site.")
    fake.repos["octo/articles"]["pages"]["build_type"] = "legacy"
    assert client.post("/api/publishing/github/test").json()["workflow"] is False


# -- the rest of the contract's rules, at the edge ------------------------------------------------------------------


def test_an_azimut_folder_is_still_never_taken_from_the_analyst(client, fake, note):
    fake.make_repo(files={"README.md": b"x", "port-strike/notes.txt": b"mine"})
    _connect(client)
    answer = client.post(note["url"], json={"short_name": "port-strike"})
    assert answer.status_code == 502 and "Azimut did not make" in answer.json()["detail"]
    assert not fake.posted("/git/commits")


def test_the_publish_asks_only_for_what_the_site_needs_and_nothing_reaches_another_host(client, fake, note):
    _the_live_site(client, fake)
    client.post(note["url"], json={"short_name": "port-strike"})
    assert all(request.url.host == "api.github.com" for request in fake.requests)
    # the site is listed by one recursive read of its tree, beside the one of the folder being replaced
    listed = [request for request in fake.requests if request.method == "GET" and "/git/trees/" in request.url.path
              and request.url.params.get("recursive")]
    assert len(listed) == 1


def test_the_settings_backup_carries_the_site_and_reads_what_it_cannot_as_none(client):
    client.put("/api/settings/prefs", json={"site_title": "The Desk", "site_credit_azimut": False,
                                            "site_stats": "goatcounter", "site_stats_code": "desk"})
    exported = client.get("/api/settings/export").json()["settings"]
    assert (exported["site_title"], exported["site_credit_azimut"], exported["site_stats"],
            exported["site_stats_code"]) == ("The Desk", False, "goatcounter", "desk")
    res = client.post("/api/settings/import", json={"settings": {
        "site_title": "  A  title ", "site_tagline": "x" * 100, "site_stats": "tracker", "site_stats_code": "NO GOOD",
        "site_stats_token": "a b", "github_categories": ["b", "a", "a", 3]}})
    assert res.status_code == 200, res.text
    stored = config.load_settings()
    assert stored["site_title"] == "A title" and stored["site_stats"] == "" and stored["site_stats_code"] == ""
    assert stored["site_stats_token"] == "" and stored["github_categories"] == ["a", "b"]


def test_the_website_settings_are_read_and_written_with_the_other_preferences(client):
    assert {key: client.get("/api/settings").json()[key] for key in site.PREF_KEYS} == {
        "site_title": "", "site_tagline": "", "site_credit_azimut": True, "site_stats": "",
        "site_stats_code": "", "site_stats_token": "", "site_stats_account": "", "site_stats_tag": ""}
    for bad in ({"site_stats": "tracker"}, {"site_stats_code": "No Good"}, {"site_stats_token": "bad token!"},
                {"site_title": "x" * 121}):
        assert client.put("/api/settings/prefs", json=bad).status_code == 422, bad
    token = "0123456789abcdef0123456789abcdef"
    ok = client.put("/api/settings/prefs", json={"site_stats": "cloudflare", "site_stats_token": f" {token} ",
                                                 "site_title": "  The   Desk "}).json()
    assert ok["site_stats"] == "cloudflare" and ok["site_stats_token"] == token and ok["site_title"] == "The Desk"
    # a field left out stays as it is
    assert client.put("/api/settings/prefs", json={"site_tagline": "Line."}).json()["site_stats_token"] == token


def test_what_the_card_reader_trusts_is_the_card_alone():
    """A card that lies about its folder cannot reach another: the address is the folder's, not the card's."""
    line = site.read_card("real/folder", json.dumps({
        "format": "azimut-article/1", "title": "T", "date": "2026-01-01", "address": "/elsewhere/",
        "folder": "elsewhere"}).encode())
    assert line is not None and line["address"] == "/real/folder/" and line["folder"] == "real/folder"
    assert sitehome.KIT == "azimut-site"


# -- what a note is on the site is part of its look -----------------------------------------------------------------


def test_the_category_the_role_and_the_list_picture_are_look_keys_written_only_once_set():
    from pydantic import ValidationError

    from azimut.engine import notelook

    plain = notelook.NoteLook().model_dump(mode="json")
    assert not {"category", "role", "list_image"} & set(plain) and notelook.NoteLook().is_default
    look = notelook.NoteLook.model_validate({"category": "  Harbour   news ", "role": "article"})
    assert look.category == "Harbour news" and look.role == "" and "role" not in look.model_dump(mode="json")
    assert notelook.NoteLook.model_validate({"role": "page"}).model_dump(mode="json")["role"] == "page"
    for bad in ({"role": "post"}, {"category": "x" * 61}, {"list_image": "../../etc"}):
        with pytest.raises(ValidationError):
            notelook.NoteLook.model_validate(bad)
    # a later Azimut's look with these keys is read by an older one part by part, and the other way round
    assert notelook.parse({"style": "report", "role": "post", "category": "Harbour"}).category == "Harbour"
    # a template carries a category, never a picture of a case
    assert notelook.TemplateLook.model_validate({"category": "Harbour", "role": "page"}).category == "Harbour"
    with pytest.raises(ValidationError):
        notelook.TemplateLook.model_validate({"list_image": "abc"})


def test_a_list_picture_is_a_picture_the_note_shows(client):
    cid = make_case(client, "Shown")
    case = Case.open(cid)
    picture = _image(case, "Designed", Image.new("RGB", (400, 200), (30, 30, 200)), {"type": "clipboard"})
    note = make_note(client, cid, title="Shown", content="Words.\n")
    route = f"/api/cases/{cid}/notes/{note['id']}/look"

    def derived() -> set[str]:
        return {link["to"] for link in Case.open(cid).links_of(note["id"])
                if link["type"] == "derived-from" and link["from"] == note["id"]}

    assert client.put(route, json={"list_image": picture["id"]}).status_code == 200
    assert derived() == {picture["id"]}
    # saving the text keeps the edge, since the look still shows it; clearing the look lets it go
    client.put(f"/api/cases/{cid}/notes/{note['id']}", json={"text": "New words.\n"})
    assert derived() == {picture["id"]}
    client.put(route, json={})
    assert derived() == set()
    assert client.put(route, json={"list_image": "missing"}).status_code == 422
    assert client.put(route, json={"role": "post"}).status_code == 422
