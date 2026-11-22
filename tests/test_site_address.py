"""The site's address in the pages Azimut published: a page gives the address the site had when it was
published (its canonical, og:url, og:image and twitter:image, and the links its text wrote to the site's
other pages), and the site may move since (a custom domain, a repository renamed). Update the site
refreshes those attributes and nothing else (`site.readdressed`, `sitesync.own_parts`), keeps the address
they all give in `articles.json` so the next press reads no page, and a page refreshed is never taken for
an edit of the analyst's (`githubpages.changed_since`, `page_state`). A read of the site counts the pages
left on an old address; a publish uses the site's address now, its custom domain before a lagging
`html_url`.

GitHub is `tests/githubfake.py`, never the network.
"""

from __future__ import annotations

import json
import re

import pytest

from PIL import Image

from azimut.engine import githubpages, site, sitesync
from azimut.workspace import Case

from githubfake import FakeGitHub
from notecase import make_case, make_note
from test_site_bar import READ, UPDATE, _blob_reads, _published, _put
from test_site_publish import DAY, _connect

OLD = "https://octo.github.io/articles/"
NEW = "https://desk.example/"
#: The article's words: a link to the map page under the site's address, the same address quoted as
#: code, and a link to another site.
ARTICLE = (f"## What we saw\n\nSmoke over the pier, on the [map of the road]({OLD}the-road/).\n\n"
           f"It was at `{OLD}the-road/` then, beside [another map](https://elsewhere.example/the-road/).\n")
#: The map page's words: a link back to the article.
MAP = (f"The road, in one line.\n\n::: map\ntitle: The road\nlayer: Front\n:::\n\n"
       f"Words beside it, from [the article]({OLD}port-strike/).\n")


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
    sitesync._carried.clear()
    sitesync._weight = 0


def _map_note(client, monkeypatch, tmp_path, text: str = MAP) -> tuple[Case, str]:
    """A map page's note (`test_site_publish._map_note`) whose words are ``text``."""
    import dataclasses

    from mapfixture import fixture_map

    from azimut.engine import notes_maps

    cid = make_case(client, "Maps")
    ground = tmp_path / "ground.png"
    Image.new("RGB", (400, 300), (40, 160, 90)).save(ground, "PNG")
    monkeypatch.setattr(notes_maps, "derive", lambda *_, **__: dataclasses.replace(fixture_map(), ground=ground))
    made = make_note(client, cid, title="The road", content=text)
    client.put(f"/api/cases/{cid}/notes/{made['id']}/look", json={"style": "article", "web": "map"})
    return Case.open(cid), made["id"]


def _domain(fake: FakeGitHub, domain: str = "desk.example", url: str | None = None) -> None:
    """The analyst gave the site a custom domain on GitHub: Pages names it, and serves the site there."""
    pages = fake.repos["octo/articles"]["pages"]
    pages["cname"] = domain
    pages["html_url"] = f"https://{domain}/" if url is None else url


def _cold() -> None:
    """A new session: nothing read before is remembered."""
    sitesync._kept.clear()
    sitesync._carried.clear()
    sitesync._weight = 0


def _csp(page: bytes) -> bytes:
    found = re.search(rb'<meta http-equiv="Content-Security-Policy" content="[^"]*">', page)
    assert found is not None
    return found.group(0)


# -- the pure part: what a page gives, and what is changed in it ----------------------------------------


def _page(base: str = OLD, folder: str = "port-strike") -> bytes:
    """A page as Azimut writes one at ``base``: its head, a bar and a footer of the site's own naming the
    site, a link to a page of the site, the address quoted, a link to a folder the site lacks and one away."""
    here = f"{base}{folder}/"
    return (f'<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            f'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' {base}">\n'
            f'<title>Port strike</title>\n<link rel="canonical" href="{here}">\n'
            f'<meta property="og:title" content="Port strike">\n<meta property="og:url" content="{here}">\n'
            f'<meta property="og:image" content="{here}share.jpg">\n<meta property="og:image:width" content="1200">\n'
            f'<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="{here}share.jpg">\n'
            f'</head>\n<body><!-- azimut:bar --><a href="{base}the-road/">bar</a><!-- /azimut:bar -->\n'
            f'<p>On the <a href="{base}the-road/#map" target="_blank" rel="noopener noreferrer">{base}the-road/</a>, '
            f'once at <code>{base}the-road/</code>, <a href="{base}gone/">gone</a>, <a href="{base}">home</a>, '
            f'<a href="https://elsewhere.example/the-road/">away</a>.</p>\n<footer class="az-footer">\n<p>Public edition</p>\n'
            f'</footer>\n<!-- azimut:footer --><a href="{base}about/">About</a><!-- /azimut:footer -->\n</body>\n</html>\n'
            ).encode()


def test_a_page_says_the_address_it_gives_and_the_site_it_is_under():
    page = _page()
    assert site.page_address(page) == f"{OLD}port-strike/"
    assert site.site_of(site.page_address(page)) == OLD
    assert site.site_of(site.page_address(page), "port-strike") == OLD
    # a canonical naming another folder, the site's root, or no canonical at all: no site to move
    assert site.site_of(site.page_address(page), "harbour") == ""
    assert site.site_of("https://desk.example/") == "" and site.site_of("http://desk.example/a/") == ""
    assert site.page_address(b"<html><head><title>T</title></head><body></body></html>") == ""
    # a canonical written in the body is no canonical
    assert site.page_address(b'<head></head><body><link rel="canonical" href="https://x.example/a/"></body>') == ""


def test_readdressed_moves_the_heads_own_lines_and_the_links_to_the_sites_folders_and_nothing_else():
    page = _page()
    moved = site.readdressed(page, OLD, NEW, {"the-road", "port-strike", "about"})
    assert site.page_address(moved) == f"{NEW}port-strike/"
    for line in (f'<link rel="canonical" href="{NEW}port-strike/">', f'<meta property="og:url" content="{NEW}port-strike/">',
                 f'<meta property="og:image" content="{NEW}port-strike/share.jpg">',
                 f'<meta name="twitter:image" content="{NEW}port-strike/share.jpg">',
                 f'<a href="{NEW}the-road/#map" target="_blank" rel="noopener noreferrer">{OLD}the-road/</a>'):
        assert line.encode() in moved, line
    # the policy, the quoted address, the link's own words, a folder the site lacks, the home, a link away,
    # and the site's own bar and footer stay byte for byte
    assert _csp(moved) == _csp(page)
    for kept in (f"<code>{OLD}the-road/</code>", f'<a href="{OLD}gone/">', f'<a href="{OLD}">home',
                 '<a href="https://elsewhere.example/the-road/">', f'<a href="{OLD}the-road/">bar</a>',
                 f'<a href="{OLD}about/">About</a>'):
        assert kept.encode() in moved, kept
    assert moved.replace(NEW.encode(), OLD.encode()) == page
    # nothing to move: the page itself
    assert site.readdressed(page, NEW, NEW, {"the-road"}) is page
    assert site.readdressed(page, "https://other.example/", NEW, {"the-road"}) == page
    # an old address that is only the front of another site's is not it
    assert site.readdressed(page, "https://octo.github.io/art", NEW, {"icles"}) == page


def test_a_page_whose_address_alone_moved_reads_as_it_was_and_any_other_change_does_not():
    page = _page()
    moved = site.readdressed(page, OLD, NEW, {"the-road"})
    assert site.upkept(page, moved) and site.upkept(moved, page)
    assert site.bare(page) != site.bare(moved)
    assert site.bare(page, {OLD, NEW}) == site.bare(moved, {OLD, NEW})
    # with the bar and the footer changed too
    both = site.with_footer(site.with_bar(moved, "<azimut-bar>b</azimut-bar>") or moved, "<i>f</i>") or moved
    assert site.upkept(page, both)
    # an edit of the words is one, whatever the address
    assert not site.upkept(page, moved.replace(b"Public edition", b"Edition"))
    assert not site.upkept(page, moved.replace(b"<code>", b"<kbd>"))
    # a link moved to another page of the site is an edit too
    assert not site.upkept(page, moved.replace(f'{NEW}the-road/#map'.encode(), f'{NEW}harbour/#map'.encode()))
    # a page with no canonical has no address to move
    plain = b"<html><head></head><body><p>x</p></body></html>"
    assert not site.upkept(plain, plain.replace(b"x", b"y"))


# -- the address GitHub gives the site ------------------------------------------------------------------


@pytest.mark.parametrize("cname, url, address", [
    ("desk.example", OLD, NEW),
    ("Desk.Example.", OLD, NEW),
    ("desk.example", None, NEW),
    (None, NEW, NEW),
    (None, None, OLD),
    ("desk.example/path", OLD, OLD),
    ("javascript:alert(1)", OLD, OLD),
    ("", "http://desk.example/", NEW),
])
def test_the_sites_address_is_its_custom_domain_before_a_lagging_html_url(cname, url, address):
    body = {"cname": cname, "status": "built", "build_type": "legacy", "source": {"branch": "main", "path": "/"}}
    if url is not None:
        body["html_url"] = url
    assert githubpages._pages(body, "octo", "articles").url == address


def test_a_publish_on_a_new_domain_uses_it_while_html_url_still_gives_the_old_address(client, fake, monkeypatch, tmp_path):
    fake.make_repo()
    _connect(client)
    case, map_note = _map_note(client, monkeypatch, tmp_path)
    assert client.post(f"/api/cases/{case.id}/notes/{map_note}/github", json={"short_name": "the-road"}).status_code == 200
    _domain(fake, url=OLD)
    note = make_note(client, case.id, title="Port strike", content=ARTICLE)
    said = client.post(f"/api/cases/{case.id}/notes/{note['id']}/github", json={"short_name": "port-strike"}).json()
    assert said["published"] is True and said["address"] == f"{NEW}port-strike/"
    page = fake.files()["port-strike/index.html"]
    assert site.page_address(page) == f"{NEW}port-strike/"
    assert f'<meta name="twitter:image" content="{NEW}port-strike/share.jpg">'.encode() in page
    # the note's link to the map page, written under the address the site had, is given the new one; its
    # words, the address quoted and a link away are the note's
    assert f'href="{NEW}the-road/"'.encode() in page and f'href="{OLD}the-road/"'.encode() not in page
    assert f"<code>{OLD}the-road/</code>".encode() in page and b'href="https://elsewhere.example/the-road/"' in page
    assert client.get("/api/publishing").json()["github"]["base"] == NEW


# -- Update the site refreshes the pages published before the move ----------------------------------------


def _two_pages(client, fake, monkeypatch, tmp_path):
    """An article and its map page, each linking to the other, published at the github.io address."""
    fake.make_repo()
    _connect(client)
    case, map_note = _map_note(client, monkeypatch, tmp_path, MAP)
    assert client.post(f"/api/cases/{case.id}/notes/{map_note}/github", json={"short_name": "the-road"}).status_code == 200
    note = make_note(client, case.id, title="Port strike", content=ARTICLE)
    assert client.post(f"/api/cases/{case.id}/notes/{note['id']}/github", json={"short_name": "port-strike"}).status_code == 200
    return case, {"port-strike": note["id"], "the-road": map_note}


def test_update_the_site_gives_the_new_address_to_articles_and_maps_and_never_calls_it_an_edit(
        client, fake, monkeypatch, tmp_path):
    case, notes = _two_pages(client, fake, monkeypatch, tmp_path)
    before = fake.files()
    assert f'href="{OLD}the-road/"'.encode() in before["port-strike/index.html"]
    assert f'href="{OLD}port-strike/"'.encode() in before["the-road/index.html"]
    # the first press learns every page gives the site's address, and keeps it
    client.post(UPDATE)
    assert json.loads(fake.files()["articles.json"])["address"] == OLD
    assert client.post(READ).json()["old_address"] == 0

    _domain(fake)
    assert client.post(READ).json()["old_address"] == 2
    said = client.post(UPDATE).json()
    assert said["ok"] and said["warnings"] == [] and said["old_address"] == 0
    assert {"port-strike/index.html", "the-road/index.html", "articles.json"} <= set(said["written"])
    after = fake.files()
    folders = {path.split("/")[0] for path in before if "/" in path}
    for folder in ("port-strike", "the-road"):
        page = after[f"{folder}/index.html"]
        # exactly what readdressed makes of the page as it was, and so not one other byte
        assert page == site.readdressed(before[f"{folder}/index.html"], OLD, NEW, folders)
        assert site.page_address(page) == f"{NEW}{folder}/"
        for line in (f'<meta property="og:url" content="{NEW}{folder}/">', f'<meta property="og:image" content="{NEW}{folder}/share.jpg">',
                     f'<meta name="twitter:image" content="{NEW}{folder}/share.jpg">'):
            assert line.encode() in page, line
        assert _csp(page) == _csp(before[f"{folder}/index.html"])
        # the folder's other files are as they were
        assert {path for path, data in after.items() if path.startswith(f"{folder}/") and before.get(path) != data} == {
            f"{folder}/index.html"}
    article, road = after["port-strike/index.html"], after["the-road/index.html"]
    assert f'href="{NEW}the-road/"'.encode() in article and f'href="{NEW}port-strike/"'.encode() in road
    # the address quoted in the words and the link away are the analyst's
    assert f"<code>{OLD}the-road/</code>".encode() in article and b'href="https://elsewhere.example/the-road/"' in article
    assert json.loads(after["articles.json"])["address"] == NEW

    # nothing left: no commit, and with a cold memory no page read for it
    commits = len(fake.history())
    _cold()
    reads = len(_blob_reads(fake))
    assert client.post(UPDATE).json()["updated"] is False and len(fake.history()) == commits
    assert client.post(READ).json()["old_address"] == 0
    pages = {githubpages.blob_sha(after[f"{folder}/index.html"]) for folder in ("port-strike", "the-road")}
    assert not pages & set(_blob_reads(fake)[reads:])

    # neither page is an edit of the analyst's: before a publish, in an edition's Check, and at the publish
    for folder, note_id in notes.items():
        url = f"/api/cases/{case.id}/notes/{note_id}/github"
        assert client.post(f"{url}/check", json={"short_name": folder}).json()["edited"] is False, folder
        edition = f"/api/cases/{case.id}/notes/{note_id}/editions"
        record = client.get(edition).json()["editions"][0]
        ref = {"at": record["at"], "file": record["file"]}
        assert client.post(f"{edition}/check", json=ref).json() == {"state": "unchanged"}, folder
    # the map page has no bar, so no bare id: its Check read the page as published
    assert "bare_sha256" not in client.get(f"/api/cases/{case.id}/notes/{notes['the-road']}/editions").json()["editions"][0]
    again = client.post(f"/api/cases/{case.id}/notes/{notes['port-strike']}/github", json={"short_name": "port-strike"}).json()
    assert again["edited"] is False and again["address"] == f"{NEW}port-strike/"

    # an edit of the words beside the move is one
    road = fake.files()["the-road/index.html"]
    _put(fake, {"the-road/index.html": road.replace(b"Words beside it", b"Words by it")})
    url = f"/api/cases/{case.id}/notes/{notes['the-road']}/github"
    assert client.post(f"{url}/check", json={"short_name": "the-road"}).json()["edited"] is True
    edition = f"/api/cases/{case.id}/notes/{notes['the-road']}/editions"
    record = client.get(edition).json()["editions"][0]
    assert client.post(f"{edition}/check", json={"at": record["at"], "file": record["file"]}).json() == {"state": "changed"}


def test_the_first_update_after_an_upgrade_reads_each_page_once_and_then_none(client, fake, monkeypatch, tmp_path):
    _two_pages(client, fake, monkeypatch, tmp_path)
    client.post(UPDATE)
    # a record from before addresses were kept: its bar, no address
    record = json.loads(fake.files()["articles.json"])
    record.pop("address")
    _put(fake, {"articles.json": (json.dumps(record, indent=1, ensure_ascii=False) + "\n").encode()})
    _cold()
    reads = len(_blob_reads(fake))
    said = client.post(UPDATE).json()
    # every page still gives the site's address: only the record is written, each page read once
    assert said["written"] == ["articles.json"] and said["old_address"] == 0
    files = fake.files()
    pages = [githubpages.blob_sha(files[f"{folder}/index.html"]) for folder in ("port-strike", "the-road")]
    assert all(_blob_reads(fake)[reads:].count(sha) == 1 for sha in pages)
    assert json.loads(files["articles.json"])["address"] == OLD
    _cold()
    reads = len(_blob_reads(fake))
    assert client.post(UPDATE).json()["updated"] is False
    assert not set(pages) & set(_blob_reads(fake)[reads:])


def test_the_refresh_keeps_to_one_commits_bounds_and_the_record_waits_for_the_last_page(client, fake, monkeypatch):
    fake.make_repo()
    _connect(client)
    for number in range(3):
        _published(client, fake, title=f"Note {number}", short=f"note-{number}")
    client.post(UPDATE)
    _domain(fake)
    # room for the list's files and one page: the root files the move rewrote come first
    monkeypatch.setattr(githubpages, "MAX_FILES", 2)
    first = client.post(UPDATE).json()
    assert first["warnings"] == [sitesync.PAGES_LEFT] and first["old_address"] is None
    assert not any(path.startswith("note-") for path in first["written"])
    record = json.loads(fake.files()["articles.json"])
    # what the record knew of the bar stands, the address waits
    assert "address" not in record and record["bar"] == "azimut"
    done = []
    for _ in range(3):
        said = client.post(UPDATE).json()
        done += [path for path in said["written"] if path.startswith("note-")]
        if not said["warnings"]:
            break
        assert said["warnings"] == [sitesync.PAGES_LEFT] and said["old_address"] is None
        assert "address" not in json.loads(fake.files()["articles.json"])
    assert said["warnings"] == [] and said["old_address"] == 0
    assert done == ["note-0/index.html", "note-1/index.html", "note-2/index.html"]
    assert json.loads(fake.files()["articles.json"])["address"] == NEW
    assert all(site.page_address(fake.files()[f"note-{number}/index.html"]) == f"{NEW}note-{number}/" for number in range(3))


def test_a_publish_keeps_the_address_record_while_it_publishes_there_and_a_delete_keeps_it(client, fake):
    fake.make_repo()
    _connect(client)
    _published(client, fake)
    client.post(UPDATE)
    assert json.loads(fake.files()["articles.json"])["address"] == OLD
    _published(client, fake, title="Harbour", short="harbour")
    assert json.loads(fake.files()["articles.json"])["address"] == OLD
    # a page published on the new domain while the others still give the old one: the record goes
    _domain(fake)
    _published(client, fake, title="Third", short="third")
    assert "address" not in json.loads(fake.files()["articles.json"])
    assert client.post(READ).json()["old_address"] == 2
    said = client.post(UPDATE).json()
    assert {"harbour/index.html", "port-strike/index.html"} <= set(said["written"]) and "third/index.html" not in said["written"]
    assert json.loads(fake.files()["articles.json"])["address"] == NEW
    assert client.post("/api/publishing/github/site/delete", json={"folder": "third"}).status_code == 200
    assert json.loads(fake.files()["articles.json"])["address"] == NEW


def test_a_page_with_no_canonical_or_one_naming_another_folder_is_left_alone(client, fake):
    fake.make_repo()
    _connect(client)
    _published(client, fake)
    card = fake.files()["port-strike/article.json"]
    page = fake.files()["port-strike/index.html"]
    # a page an older Azimut published, with no canonical; a folder copied by hand, its canonical naming the first
    _put(fake, {"older/index.html": b"<html><head></head><body>its old page</body></html>", "older/share.jpg": b"j",
                "older/article.json": card, "copy/index.html": page, "copy/share.jpg": b"j", "copy/article.json": card})
    client.post(UPDATE)
    _domain(fake)
    assert client.post(READ).json()["old_address"] == 1
    said = client.post(UPDATE).json()
    assert "port-strike/index.html" in said["written"] and said["old_address"] == 0
    files = fake.files()
    assert files["older/index.html"] == b"<html><head></head><body>its old page</body></html>"
    assert files["copy/index.html"] == page
    assert json.loads(files["articles.json"])["address"] == NEW
