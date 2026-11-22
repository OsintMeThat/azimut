"""The site's own footer on Azimut's article pages: `azimut-footer.html` at the site's root, read and
cleaned as the bar is (`site.own_footer`), put after Azimut's own footer between `<!-- azimut:footer -->`
markers at a publish and by Update the site (`engine/sitesync.py`), kept in `articles.json` as `footer`,
and never taken for an edit of the analyst's (`githubpages.changed_since`, `page_state`).

GitHub is `tests/githubfake.py`, never the network.
"""

from __future__ import annotations

import hashlib
import json
import re

import pytest

from azimut.engine import githubpages, site, sitesync

from githubfake import FakeGitHub
from test_site_bar import OWN, READ, UPDATE, _blob_reads, _published, _put, _survey
from test_site_publish import DAY, _connect, _map_note

#: A footer written like the one a live site publishes: self-contained under one class, its links
#: from the site's root, one 34×34 picture, no script.
LIVE_LIKE = """<style>
.osm-foot{--ink:#e9e6df;--muted:#a7a39a;--rule:rgba(233,230,223,.16);--accent:#f2b134;
  background:#16181c;color:var(--ink);font:400 15px/1.55 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  padding:48px 24px 28px;border-top:3px solid var(--accent)}
.osm-foot *{box-sizing:border-box}
.osm-foot .wrap{max-width:1080px;margin:0 auto;display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:32px}
.osm-foot .brand{display:flex;align-items:center;gap:12px;color:var(--ink);text-decoration:none;font-weight:700;
  letter-spacing:.01em;font-size:17px}
.osm-foot .brand img{width:34px;height:34px;border-radius:50%;flex:none;background:#fff}
.osm-foot .about{margin:14px 0 0;color:var(--muted);max-width:34ch}
.osm-foot h2{margin:0 0 12px;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;
  color:var(--muted)}
.osm-foot ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.osm-foot a{color:var(--ink);text-decoration:none;border-bottom:1px solid transparent;
  transition:color .15s ease,border-color .15s ease}
.osm-foot a:hover,.osm-foot a:focus-visible{color:var(--accent);border-bottom-color:currentColor;outline:none}
.osm-foot .base{max-width:1080px;margin:36px auto 0;padding-top:18px;border-top:1px solid var(--rule);
  display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;color:var(--muted);font-size:13px}
.osm-foot .base a{color:var(--muted)}
.osm-foot .tag{display:inline-block;padding:2px 8px;border:1px solid var(--rule);border-radius:99px;font-size:12px}
@media (max-width:860px){.osm-foot .wrap{grid-template-columns:1fr 1fr}}
@media (max-width:520px){.osm-foot{padding:36px 18px 22px}.osm-foot .wrap{grid-template-columns:1fr}
  .osm-foot .base{flex-direction:column}}
@media (prefers-reduced-motion:reduce){.osm-foot a{transition:none}}
</style>
<footer class="osm-foot" role="contentinfo">
  <div class="wrap">
    <div>
      <a class="brand" href="/" aria-label="The Desk, home">
        <img src="/assets/desk-mark.png" width="34" height="34" alt="" loading="lazy" decoding="async">
        <span>The Desk</span>
      </a>
      <p class="about">Open-source investigations: what was seen, where, and how we know it.
        Every claim links to its source.</p>
    </div>
    <nav aria-label="Investigations">
      <h2>Read</h2>
      <ul>
        <li><a href="/">Latest</a></li>
        <li><a href="/investigations/">Investigations</a></li>
        <li><a href="/conflict-watch/">Conflict Watch</a></li>
        <li><a href="/methods/">Methods</a></li>
      </ul>
    </nav>
    <nav aria-label="The site">
      <h2>About</h2>
      <ul>
        <li><a href="/about/">Who writes here</a></li>
        <li><a href="/legal-notice/">Legal notice</a></li>
        <li><a href="/privacy/">Privacy</a></li>
        <li><a href="/feed.xml">RSS feed</a></li>
      </ul>
    </nav>
    <nav aria-label="Elsewhere">
      <h2>Follow</h2>
      <ul>
        <li><a href="https://social.example/@desk" rel="me noopener" target="_blank">Mastodon</a></li>
        <li><a href="https://video.example/desk" rel="noopener" target="_blank">Videos</a></li>
        <li><a href="mailto:desk@example.org">desk@example.org</a></li>
      </ul>
    </nav>
  </div>
  <div class="base">
    <span>&copy; 2026 The Desk &middot; Texts under <a href="https://creativecommons.org/licenses/by/4.0/"
      rel="license noopener" target="_blank">CC BY 4.0</a></span>
    <span class="tag">Independent &amp; reader-funded</span>
  </div>
</footer>
""".encode()

#: A smaller footer of the site's own, for the publish and the update.
FOOT = (b'<style>@font-face{font-family:"Plex";src:url(theme/fonts/plex.woff2)} footer{font:13px Plex;color:#555}</style>'
        b'<footer><a href="/about/">About</a> <small>&copy; The Desk</small></footer>')


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


def _footer(page: bytes) -> bytes:
    found = site.footer_in(page)
    assert found is not None, "the page has no footer between markers"
    return found


# -- what azimut-footer.html becomes -----------------------------------------------------------------------


def test_a_footer_like_the_live_sites_reads_with_no_word_and_keeps_every_link_and_its_picture():
    assert 3 * 1024 < len(LIVE_LIKE) < 4 * 1024
    inner, said = site.own_footer(LIVE_LIKE)
    assert said == "" and inner.startswith('<azimut-footer><template shadowrootmode="open"><style>')
    assert inner.endswith("</footer>\n</template></azimut-footer>")
    sheet, markup = inner.split("</style>", 1)
    # its rules stay inside, after the part's own base, and its links from the root stay as written
    assert sheet.endswith("@media (prefers-reduced-motion:reduce){.osm-foot a{transition:none}}")
    assert site.OWN_BAR_BASE in sheet and ".osm-foot .brand img{width:34px;height:34px;" in sheet
    assert '<img src="/assets/desk-mark.png" width="34" height="34" alt="" loading="lazy" decoding="async">' in markup
    for address in ("/", "/investigations/", "/about/", "/legal-notice/", "/privacy/", "/feed.xml",
                    "https://social.example/@desk", "mailto:desk@example.org", "https://creativecommons.org/licenses/by/4.0/"):
        assert f'href="{address}"' in markup, address
    assert markup.count("<a ") == LIVE_LIKE.count(b"<a ") and markup.count("<nav ") == 3
    assert 'role="contentinfo"' in markup and 'rel="me noopener" target="_blank"' in markup
    assert "© 2026 The Desk · Texts under" in markup and "Independent &amp; reader-funded" in markup


def test_the_footer_is_cleaned_as_the_bar_is_in_an_element_of_its_own():
    bar, footer = site.own_bar(OWN)[0], site.own_footer(OWN)[0]
    assert footer == bar.replace("<azimut-bar>", "<azimut-footer>").replace("</azimut-bar>", "</azimut-footer>")
    # its faces go to the page, its addresses relative to the root are made the article's
    assert footer.startswith('<style>@font-face{font-family:"Plex";src:url("../theme/fonts/plex.woff2")')
    hostile = site.own_footer(b'<footer onclick="x()"><script>alert(1)</script><a href="javascript:x()">Desk</a>'
                              b'<!-- /azimut:footer --><iframe src="https://elsewhere.example/"></iframe></footer>')[0]
    assert "Desk" in hostile
    for word in ("onclick", "script", "alert", "javascript", "<!--", "azimut:footer", "iframe", "elsewhere"):
        assert word not in hostile, word


@pytest.mark.parametrize("data, said", [
    (None, ""),
    (b"<footer>" + b"x" * site.MAX_OWN_BAR_BYTES + b"</footer>", site.OWN_FOOTER_TOO_LARGE),
    (b"<footer>\xff\xfe</footer>", site.OWN_FOOTER_UNREAD),
    (b"<script>alert(1)</script>", site.OWN_FOOTER_UNREAD),
])
def test_past_its_bound_or_not_read_the_articles_go_without_it(data, said):
    assert site.own_footer(data) == ("", said)
    assert site.OWN_FOOTER_TOO_LARGE == "azimut-footer.html is larger than 64 KB: the articles go without it."
    assert site.OWN_FOOTER_UNREAD == "azimut-footer.html does not read as HTML: the articles go without it."


# -- where it goes on a page ----------------------------------------------------------------------------------


def _page(bar: str = "", body: bytes = b"<main>words</main>") -> bytes:
    """An article page as Azimut writes one: its bar between markers, its words, its own footer, its scripts."""
    bar = bar or site.marked_bar(site.Frame(title="The Desk"), "")
    return (b'<!doctype html>\n<html><head><title>T</title></head>\n<body>' + bar.encode() + b"\n" + body
            + b'\n<footer class="az-footer">\n<p>Public edition</p>\n</footer>\n'
            + b'<script src="assets/0123abcd-reader.js"></script>\n</body>\n</html>\n')


def test_the_footer_goes_right_after_azimuts_and_every_byte_outside_its_markers_stays():
    page = _page()
    assert site.footer_in(page) is None and site.bare(page) == site.without_bar(page)
    given = site.with_footer(page, "<azimut-footer>x</azimut-footer>")
    assert given == page.replace(b"</footer>\n", b"</footer>\n<!-- azimut:footer --><azimut-footer>x</azimut-footer>"
                                 b"<!-- /azimut:footer -->\n")
    assert _footer(given) == b"<azimut-footer>x</azimut-footer>"
    # changed between its markers, then taken off with them: the page is back byte for byte
    again = site.with_footer(given, "<azimut-footer>y</azimut-footer>")
    assert again == given.replace(b">x<", b">y<")
    assert site.with_footer(again, "") == page and site.with_footer(page, "") == page
    assert site.bare(page) == site.bare(given) == site.bare(again)
    assert site.bare(site.with_bar(given, "<azimut-bar>b</azimut-bar>")) == site.bare(page)
    assert site.marked_footer("") == ""


def test_a_footer_never_lands_on_a_page_that_is_no_article_nor_where_a_bar_names_one():
    footer = "<azimut-footer>x</azimut-footer>"
    # a map page has no bar's markers, so no footer, though Azimut's footer is in its panel
    map_page = b'<body><div class="az-mappage"><footer class="az-footer"><p>e</p></footer>\n</div></body>'
    assert site.with_footer(map_page, footer) is None and site.footer_in(map_page) is None
    assert site.bare(map_page) == map_page
    # a page with no footer of Azimut's to follow is never changed
    assert site.with_footer(_page().replace(b'<footer class="az-footer">', b"<footer>"), footer) is None
    # a bar of the site's own naming Azimut's footer, or markers inside the bar, are not where it goes
    named = site.marked_bar(site.Frame(title="D"), "").replace(
        "</nav>", '</nav><footer class="az-footer">mine</footer>\n<!-- azimut:footer -->x<!-- /azimut:footer -->')
    page = _page(named)
    assert site.footer_in(page) is None
    given = site.with_footer(page, footer)
    assert given is not None and given.index(b"<!-- azimut:footer --><azimut-footer>") > given.index(b"Public edition")
    assert _footer(given) == footer.encode()


# -- a publish gives its article the site's footer -------------------------------------------------------------


def test_a_publish_gives_an_article_and_a_story_the_sites_footer_after_azimuts_and_a_map_page_none(
        client, fake, monkeypatch, tmp_path):
    fake.make_repo(files={"README.md": b"# articles\n", "azimut-footer.html": FOOT})
    _connect(client)
    made = _published(client, fake)
    _published(client, fake, title="Harbour", short="harbour", style="article", web="story")
    inner = site.own_footer(FOOT)[0]
    for folder in ("port-strike", "harbour"):
        page = fake.files()[f"{folder}/index.html"]
        assert _footer(page).decode() == inner
        # after Azimut's own footer, before the page's scripts and the end of its body
        assert re.search(rb'<footer class="az-footer">.*?</footer>\n<!-- azimut:footer --><style>@font-face.*?'
                         rb"</azimut-footer><!-- /azimut:footer -->\n<script src=\"assets/[^\"]+\"></script>\n"
                         rb"(?:<script[^>]*>.*?</script>\n)*</body>", page, re.S), folder
        assert site.is_azimut_bar(site.bar_in(page))
    assert made["answer"]["site"]["warnings"] == []
    # the edition is the page as committed, and its bare id the page without the footer
    page = fake.files()["port-strike/index.html"]
    record = client.get(f"/api/cases/{made['cid']}/notes/{made['note']}/editions").json()["editions"][0]
    assert record["sha256"] == hashlib.sha256(page).hexdigest()
    assert record["bare_sha256"] == hashlib.sha256(site.bare(page)).hexdigest()
    case, note_id = _map_note(client, monkeypatch, tmp_path)
    assert client.post(f"/api/cases/{case.id}/notes/{note_id}/github", json={"short_name": "the-road"}).status_code == 200
    map_page = fake.files()["the-road/index.html"]
    assert b"azimut-footer" not in map_page and b"azimut:footer" not in map_page


def test_with_no_footer_file_the_article_carries_no_markers_and_nothing_more_is_read(client, fake):
    fake.make_repo()
    _connect(client)
    _published(client, fake)
    page = fake.files()["port-strike/index.html"]
    assert b"azimut:footer" not in page and b"azimut-footer" not in page
    before = len(_blob_reads(fake))
    _put(fake, {"azimut-footer.html": FOOT})
    _published(client, fake, title="Harbour", short="harbour")
    own = githubpages.blob_sha(FOOT)
    assert _blob_reads(fake)[before:].count(own) == 1
    _published(client, fake, title="Third", short="third")
    assert _blob_reads(fake).count(own) == 1


def test_a_footer_past_its_bound_is_not_read_and_the_publish_and_the_update_say_so(client, fake):
    fake.make_repo(files={"README.md": b"#\n", "azimut-footer.html": b"<footer>" + b"x" * (64 * 1024) + b"</footer>"})
    _connect(client)
    made = _published(client, fake)
    assert made["answer"]["site"]["warnings"] == [site.OWN_FOOTER_TOO_LARGE]
    assert site.footer_in(fake.files()["port-strike/index.html"]) is None
    assert githubpages.blob_sha(fake.files()["azimut-footer.html"]) not in _blob_reads(fake)
    assert client.post(UPDATE).json()["warnings"] == [site.OWN_FOOTER_TOO_LARGE]
    _put(fake, {"azimut-footer.html": b"\xff\xfe<footer>"})
    assert client.post(UPDATE).json()["warnings"] == [site.OWN_FOOTER_UNREAD]


# -- Update the site gives every article the footer the site asks for --------------------------------------------


def test_update_the_site_adds_the_footer_to_pages_published_before_and_keeps_every_other_byte(
        client, fake, monkeypatch, tmp_path):
    fake.make_repo()
    _connect(client)
    _published(client, fake)
    _published(client, fake, title="Harbour", short="harbour", style="article", web="story")
    case, note_id = _map_note(client, monkeypatch, tmp_path)
    client.post(f"/api/cases/{case.id}/notes/{note_id}/github", json={"short_name": "the-road"})
    # the record a site kept before footers: a bar, and no footer key
    assert client.post(UPDATE).json()["written"] == ["articles.json"]
    assert json.loads(fake.files()["articles.json"])["bar"] == "azimut"
    assert "footer" not in json.loads(fake.files()["articles.json"])
    before = fake.files()

    _put(fake, {"azimut-footer.html": FOOT})
    said = client.post(UPDATE).json()
    assert said["ok"] and said["updated"] and said["warnings"] == []
    assert said["written"] == ["articles.json", "harbour/index.html", "port-strike/index.html"]
    after = fake.files()
    inner = site.own_footer(FOOT)[0]
    for folder in ("port-strike", "harbour"):
        # the markers put in right after Azimut's footer, and not one other byte moved
        assert after[f"{folder}/index.html"] == site.with_footer(before[f"{folder}/index.html"], inner)
        assert site.bare(after[f"{folder}/index.html"]) == site.bare(before[f"{folder}/index.html"])
        assert site.with_footer(after[f"{folder}/index.html"], "") == before[f"{folder}/index.html"]
    assert {path for path, data in after.items() if before.get(path) != data} == {
        "azimut-footer.html", "articles.json", "harbour/index.html", "port-strike/index.html"}
    recorded = json.loads(after["articles.json"])
    assert recorded["bar"] == "azimut" and recorded["footer"] == sitesync.footer_kind(inner.encode())

    # nothing left to change: no commit, and no page read for it
    commits = len(fake.history())
    assert client.post(UPDATE).json()["updated"] is False and len(fake.history()) == commits
    sitesync._kept.clear()
    sitesync._carried.clear()
    reads = len(_blob_reads(fake))
    assert client.post(UPDATE).json()["updated"] is False
    pages = {githubpages.blob_sha(after[f"{folder}/index.html"]) for folder in ("port-strike", "harbour", "the-road")}
    assert not pages & set(_blob_reads(fake)[reads:])

    # an edit of the footer reaches every article
    _put(fake, {"azimut-footer.html": FOOT.replace(b"The Desk", b"The Desk, again")})
    assert client.post(UPDATE).json()["written"] == ["articles.json", "harbour/index.html", "port-strike/index.html"]
    assert all(b"The Desk, again" in _footer(fake.files()[f"{folder}/index.html"]) for folder in ("port-strike", "harbour"))

    # and without it, the pages are back as they were, byte for byte, and so is the record
    _put(fake, {"azimut-footer.html": None})
    assert client.post(UPDATE).json()["written"] == ["articles.json", "harbour/index.html", "port-strike/index.html"]
    back = fake.files()
    for folder in ("port-strike", "harbour", "the-road"):
        assert back[f"{folder}/index.html"] == before[f"{folder}/index.html"]
    assert back["articles.json"] == before["articles.json"]


def test_with_a_bar_record_and_no_footer_file_update_the_site_reads_no_page_and_writes_nothing(client, fake):
    fake.make_repo()
    _connect(client)
    _published(client, fake)
    _published(client, fake, title="Harbour", short="harbour")
    client.post(UPDATE)
    # a record written before footers existed, read now with a cold memory
    record = json.loads(fake.files()["articles.json"])
    assert record["bar"] == "azimut" and "footer" not in record
    sitesync._kept.clear()
    sitesync._carried.clear()
    commits, reads = len(fake.history()), len(_blob_reads(fake))
    assert client.post(UPDATE).json()["updated"] is False and len(fake.history()) == commits
    pages = {githubpages.blob_sha(fake.files()[f"{folder}/index.html"]) for folder in ("port-strike", "harbour")}
    assert not pages & set(_blob_reads(fake)[reads:])


def test_a_bar_and_a_footer_come_in_one_write_per_page_and_one_alone_leaves_the_other_byte_for_byte(client, fake):
    fake.make_repo()
    _connect(client)
    _published(client, fake)
    client.post(UPDATE)
    _put(fake, {"azimut-bar.html": OWN, "azimut-footer.html": FOOT})
    assert client.post(UPDATE).json()["written"] == ["articles.json", "port-strike/index.html"]
    page = fake.files()["port-strike/index.html"]
    assert site.bar_in(page) == site.own_bar(OWN)[0].encode() and _footer(page) == site.own_footer(FOOT)[0].encode()
    recorded = json.loads(fake.files()["articles.json"])
    assert (recorded["bar"], recorded["footer"]) == sitesync.carried_by(page)
    # the footer changed alone: the bar's bytes as they were
    _put(fake, {"azimut-footer.html": FOOT.replace(b"About", b"Who we are")})
    assert client.post(UPDATE).json()["written"] == ["articles.json", "port-strike/index.html"]
    changed = fake.files()["port-strike/index.html"]
    assert site.bar_in(changed) == site.bar_in(page) and b"Who we are" in _footer(changed)
    assert site.bare(changed) == site.bare(page)


def test_the_footer_keeps_to_one_commits_bounds_and_the_next_press_does_the_rest(client, fake, monkeypatch):
    fake.make_repo()
    _connect(client)
    for number in range(3):
        _published(client, fake, title=f"Note {number}", short=f"note-{number}")
    client.post(UPDATE)
    _put(fake, {"azimut-footer.html": FOOT})
    monkeypatch.setattr(githubpages, "MAX_FILES", 2)
    first = client.post(UPDATE).json()
    assert first["warnings"] == [sitesync.PAGES_LEFT] and first["written"] == ["articles.json", "note-0/index.html"]
    assert {"bar", "footer"}.isdisjoint(json.loads(fake.files()["articles.json"]))
    assert sitesync.PAGES_LEFT == ("Azimut changed as many articles as one commit holds: press Update the site again "
                                   "for the others.")
    second = client.post(UPDATE).json()
    assert second["warnings"] == [sitesync.PAGES_LEFT] and second["written"] == ["note-1/index.html"]
    monkeypatch.setattr(githubpages, "MAX_FILES", 1000)
    third = client.post(UPDATE).json()
    assert third["warnings"] == [] and third["written"] == ["articles.json", "note-2/index.html"]
    inner = site.own_footer(FOOT)[0].encode()
    assert all(_footer(fake.files()[f"note-{number}/index.html"]) == inner for number in range(3))


def test_a_publish_keeps_the_record_while_its_footer_is_the_one_every_page_carries_and_a_delete_keeps_it(
        client, fake):
    fake.make_repo()
    _connect(client)
    _published(client, fake)
    _put(fake, {"azimut-footer.html": FOOT})
    client.post(UPDATE)
    kind = sitesync.footer_kind(site.own_footer(FOOT)[0].encode())
    assert json.loads(fake.files()["articles.json"])["footer"] == kind
    _published(client, fake, title="Harbour", short="harbour")
    assert json.loads(fake.files()["articles.json"])["footer"] == kind
    # another footer, given to the one page published: the others still carry the first
    _put(fake, {"azimut-footer.html": FOOT.replace(b"About", b"Who we are")})
    _published(client, fake, title="Third", short="third")
    assert {"bar", "footer"}.isdisjoint(json.loads(fake.files()["articles.json"]))
    assert client.post(UPDATE).json()["written"] == ["articles.json", "harbour/index.html", "port-strike/index.html"]
    kind = sitesync.footer_kind(_footer(fake.files()["third/index.html"]))
    assert json.loads(fake.files()["articles.json"])["footer"] == kind
    assert client.post("/api/publishing/github/site/delete", json={"folder": "third"}).status_code == 200
    assert json.loads(fake.files()["articles.json"])["footer"] == kind


# -- a footer Update the site changed is no edit of the analyst's -------------------------------------------------


def test_a_footer_added_changed_or_taken_off_by_update_the_site_is_never_called_an_edit(client, fake):
    fake.make_repo()
    _connect(client)
    made = _published(client, fake)
    url, check = made["url"], f"{made['url']}/check"
    edition = f"/api/cases/{made['cid']}/notes/{made['note']}/editions"
    ref = {key: client.get(edition).json()["editions"][0][key] for key in ("at", "file")}
    unedited = {"checked": True, "exists": True, "edited": False, "warning": "", "taken": None, "free": ""}
    for footer in (FOOT, FOOT.replace(b"About", b"Who we are"), None):
        _put(fake, {"azimut-footer.html": footer})
        assert client.post(UPDATE).json()["written"] == ["articles.json", "port-strike/index.html"]
        assert client.post(check, json={"short_name": "port-strike"}).json() == unedited
        assert client.post(f"{edition}/check", json=ref).json() == {"state": "unchanged"}
    _put(fake, {"azimut-footer.html": FOOT})
    client.post(UPDATE)
    assert client.post(url, json={"short_name": "port-strike"}).json()["edited"] is False
    # an edit outside the markers is one, the footer beside it or not
    page = fake.files()["port-strike/index.html"]
    _put(fake, {"port-strike/index.html": page.replace(b"Smoke over the pier", b"Smoke over the quay")})
    assert client.post(check, json={"short_name": "port-strike"}).json()["edited"] is True
    record = client.get(edition).json()["editions"][0]
    assert client.post(f"{edition}/check", json={"at": record["at"], "file": record["file"]}).json() == {"state": "changed"}


# -- the read says whose footer the articles carry -------------------------------------------------------------


@pytest.mark.parametrize("files, footer, warnings", [
    ({"README.md": b"#"}, "none", []),
    ({"azimut-footer.html": FOOT}, "yours", []),
    ({"azimut-footer.html": LIVE_LIKE, "azimut-bar.html": OWN}, "yours", []),
    ({"azimut-footer.html": b"<script>x()</script>"}, "none", [site.OWN_FOOTER_UNREAD]),
    ({"azimut-footer.html": b"x" * (64 * 1024 + 1)}, "none", [site.OWN_FOOTER_TOO_LARGE]),
])
def test_the_survey_says_whose_footer_the_articles_carry(fake, files, footer, warnings):
    surveyed = _survey(fake, files)
    assert surveyed.footer == footer and surveyed.warnings == warnings


def test_the_read_answer_carries_the_footer(client, fake):
    fake.make_repo(files={"README.md": b"#", "azimut-footer.html": FOOT})
    _connect(client)
    said = client.post(READ).json()
    assert said["ok"] and said["footer"] == "yours" and said["bar"] == "azimut"
    _put(fake, {"azimut-footer.html": None})
    assert client.post(READ).json()["footer"] == "none"
