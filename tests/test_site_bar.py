"""The site's own bar on Azimut's article pages: `azimut-bar.html` at the site's root, read and cleaned
(`site.own_bar`), put between the `<!-- azimut:bar -->` markers of every article page at its publish
and by Update the site (`engine/sitesync.py`), and never taken for an edit of the analyst's
(`githubpages.changed_since`, `page_state`).

GitHub is `tests/githubfake.py`, never the network.
"""

from __future__ import annotations

import hashlib
import io
import json
import re

import pytest
from PIL import Image

from azimut import config
from azimut.engine import githubpages, site, sitesync
from azimut.engine.site import Frame, Site

from githubfake import TOKEN, FakeGitHub
from test_site_publish import DAY, _connect, _map_note, _new_note

READ = "/api/publishing/github/site/read"
UPDATE = "/api/publishing/github/site"
OWN = (b'<style>@font-face{font-family:"Plex";src:url(theme/fonts/plex.woff2) format("woff2")}'
       b':host{font:15px Plex} header{display:flex} a{color:#b00}</style>'
       b'<header><a href="./"><img src="theme/logo.png" width="28" height="28" alt=""> The Desk</a>'
       b'<nav><a href="about/">About</a></nav></header>')


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
    sitesync._bars.clear()
    sitesync._weight = 0


def _put(fake: FakeGitHub, changes: dict[str, bytes | None], message: str = "edit by hand") -> None:
    """A commit made on GitHub by hand: each path given its bytes, or taken away for None."""
    files = fake.files()
    for path, data in changes.items():
        if data is None:
            files.pop(path, None)
        else:
            files[path] = data
    tree = fake.write_tree(None, [{"path": name, "mode": "100644", "type": "blob", "sha": fake.blob(content)}
                                  for name, content in files.items()])
    fake.repos["octo/articles"]["refs"]["main"] = fake.commit(tree, [fake.repos["octo/articles"]["refs"]["main"]],
                                                               message)


def _published(client, fake, title: str = "Port strike", short: str = "port-strike", **look: str) -> dict:
    made = _new_note(client, title=title)
    if look:
        client.put(f"/api/cases/{made['cid']}/notes/{made['note']}/look", json=look)
    answer = client.post(made["url"], json={"short_name": short})
    assert answer.status_code == 200, answer.text
    return {**made, "answer": answer.json(), "short": short}


def _inner(page: bytes) -> bytes:
    found = site.bar_in(page)
    assert found is not None, "the page has no bar between markers"
    return found


def _blob_reads(fake: FakeGitHub) -> list[str]:
    return [request.url.path.rsplit("/", 1)[1] for request in fake.requests
            if request.method == "GET" and "/git/blobs/" in request.url.path]


# -- what azimut-bar.html becomes -------------------------------------------------------------------------


def _cleaned(markup: str | bytes) -> str:
    inner, said = site.own_bar(markup.encode() if isinstance(markup, str) else markup)
    assert said == "" and inner, said
    return inner


def _shadow(inner: str) -> str:
    """What the bar's shadow root holds after its own sheet."""
    return inner.split("</style>", 2)[-1] if inner.startswith("<style>") else inner.split("</style>", 1)[1]


@pytest.mark.parametrize("given, gone", [
    ('<header><script>alert(1)</script>Desk</header>', ["script", "alert"]),
    ('<header><script/>alert(1)</script>Desk</header>', ["script", "alert"]),
    ('<header onclick="alert(1)" onMouseOver=steal()>Desk</header>', ["onclick", "onmouseover", "alert", "steal"]),
    ('<a href="javascript:alert(1)">Desk</a>', ["javascript", "alert", "href"]),
    ('<a href="  JaVa&#x09;ScRiPt:alert(1)">Desk</a>', ["script", "alert", "href"]),
    ('<a href="data:text/html,<b>x</b>">Desk</a><img src="data:image/png;base64,AAAA" alt="">', ["data:", "href", "src"]),
    ('<base href="https://elsewhere.example/"><a href="x/">Desk</a>', ["<base", "elsewhere"]),
    ('<meta http-equiv="refresh" content="0;url=https://elsewhere.example/">Desk', ["<meta", "refresh", "elsewhere"]),
    ('<iframe src="https://elsewhere.example/"></iframe><object data="x.swf"></object><embed src="y">Desk',
     ["iframe", "object", "embed", "elsewhere", "swf"]),
    ('<svg width="9" height="9"><animate attributeName="href" to="javascript:alert(1)"/><set to="x"/>'
     '<a xlink:href="javascript:alert(1)"><circle r="4"/></a><foreignObject><b>x</b></foreignObject></svg>Desk',
     ["animate", "<set", "javascript", "foreignobject", "<b>"]),
    ('<template shadowrootmode="open"><b>inner</b></template><form action="/search"><input name="q"></form>Desk',
     ["template shadowrootmode=\"open\"><b>", "inner", "<form", "<input", "/search"]),
    ('<link rel="stylesheet" href="theme/site.css"><noscript><p>no</p></noscript>Desk', ["<link", "site.css", "<noscript"]),
    ('<!-- /azimut:bar --><header>Desk<!-- a comment --></header>', ["azimut:bar", "comment", "<!--"]),
    ('<header>Desk</header><plaintext><b>swallowed', ["plaintext", "swallowed"]),
])
def test_the_bar_drops_what_could_run_or_reach_elsewhere(given, gone):
    shadow = _shadow(_cleaned(given))
    assert "Desk" in shadow
    for word in gone:
        assert word not in shadow.lower().replace("<template shadowrootmode=\"open\"><style>", ""), word


def test_what_it_keeps_is_written_again_balanced_so_it_never_closes_what_holds_it():
    inner = _cleaned('<header><nav><ul><li><a href="/">Home</a></nav></template></azimut-bar></body></html>'
                     '<p title="&quot;><script>x</script>">Tip &lt;b&gt; &amp; more</p>'
                     '<style>.a::after{content:"<!-- /azimut:bar --></style>"}</style>')
    assert inner.count("<template") == 1 and inner.count("</template>") == 1
    assert inner.endswith("</template></azimut-bar>")
    assert "<!--" not in inner and site.BAR_CLOSE.decode() not in inner
    # every word and value escaped, and nothing but tags opens a `<`
    assert 'title="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"' in inner and "Tip &lt;b&gt; &amp; more" in inner
    shadow = _shadow(inner)
    assert shadow.startswith('<header><nav><ul><li><a href="/">Home</a></li></ul></nav><p')
    assert shadow.endswith("</p>\"}</header></template></azimut-bar>")
    # a page given it finds its bar's end where Azimut put it
    page = b"<!doctype html><html><body>" + site.BAR_OPEN + b"x" + site.BAR_CLOSE + b"\n<main>words</main></body></html>"
    barred = site.with_bar(page, inner)
    assert barred is not None and site.bar_in(barred) == inner.encode()
    assert barred.endswith(site.BAR_CLOSE + b"\n<main>words</main></body></html>")


def test_a_stylesheet_has_no_less_than_left_and_keeps_its_rules():
    inner = _cleaned('<style>/* <!-- /azimut:bar --> */ .tip::before{content:"<"} header{gap:8px}</style><header>Desk</header>')
    sheet = inner.split("<style>", 1)[1].split("</style>", 1)[0]
    assert "<" not in sheet and "azimut:bar" not in sheet and "/*" not in sheet
    assert 'content:"\\3c "' in sheet and "header{gap:8px}" in sheet


def test_addresses_from_the_sites_root_are_made_the_articles_and_the_others_are_kept():
    inner = _cleaned(
        '<style>header{background:url(theme/bg.png)} .a{background:url("/theme/abs.png")}'
        ' .b{background:url(\'https://cdn.example/x.png\')} @import "theme/bar.css";</style>'
        '<header><a href="./">Home</a><a href="">Root</a><a href="about/">About</a><a href="/feed.xml">Feed</a>'
        '<a href="https://osintmethat.com/x/">Abs</a><a href="#top">Top</a><a href="mailto:desk@example.org">Mail</a>'
        '<a href="?tag=x">Tag</a><img src="theme/logo.png" srcset="theme/l1.png 1x, theme/l2.png 2x" alt="">'
        '<span style="background:url(theme/dot.png)">.</span><svg width="9" height="9"><use href="theme/i.svg#a"/></svg>'
        '</header>')
    for found in ('<a href=".././">Home</a>', '<a href="../">Root</a>', 'href="../about/"', 'href="/feed.xml"', 'href="https://osintmethat.com/x/"',
                  'href="#top"', 'href="mailto:desk@example.org"', 'href="../?tag=x"', 'src="../theme/logo.png"',
                  'srcset="../theme/l1.png 1x, ../theme/l2.png 2x"', 'style="background:url(&quot;../theme/dot.png&quot;)"',
                  'url("../theme/bg.png")', 'url("/theme/abs.png")', 'url("https://cdn.example/x.png")',
                  '@import "../theme/bar.css"', 'href="../theme/i.svg#a"'):
        assert found in inner, found
    # a page deeper down is given its own way up
    assert 'src="../../theme/logo.png"' in site.own_bar(b'<img src="theme/logo.png" alt="">', "../../")[0]


def test_font_faces_go_to_the_page_and_never_one_of_the_readers():
    inner = _cleaned(OWN.decode() + '<style>@font-face{font-family:az-head;src:url(x.woff2)}</style>')
    fonts, rest = inner.split("<azimut-bar>", 1)
    assert fonts == '<style>@font-face{font-family:"Plex";src:url("../theme/fonts/plex.woff2") format("woff2")}</style>'
    assert "@font-face" not in rest and "az-head" not in inner
    # with no face, the page gets no sheet of its own
    assert _cleaned("<header>Desk</header>").startswith("<azimut-bar>")


def test_the_bar_is_its_own_box_inherits_nothing_and_holds_an_unsized_svg_small():
    inner = _cleaned(OWN)
    sheet = inner.split('<template shadowrootmode="open"><style>', 1)[1].split("</style>", 1)[0]
    assert sheet.startswith(site.OWN_BAR_BASE)
    assert ":host{all:initial;display:block}" in site.OWN_BAR_BASE
    assert ":where(svg:not([width])){width:1.5em}" in site.OWN_BAR_BASE
    assert ":where(svg:not([height])){height:1.5em}" in site.OWN_BAR_BASE
    # the site's own rules come after, so they win over these
    assert ":host{font:15px Plex}" in sheet[len(site.OWN_BAR_BASE):]
    assert inner.startswith("<style>@font-face") and '<azimut-bar><template shadowrootmode="open">' in inner


@pytest.mark.parametrize("data, said", [
    (None, ""),
    (b"<header>" + b"x" * site.MAX_OWN_BAR_BYTES + b"</header>", site.OWN_BAR_TOO_LARGE),
    (b"<header>\xff\xfe</header>", site.OWN_BAR_UNREAD),
    (b"", site.OWN_BAR_UNREAD),
    (b"<script>alert(1)</script><!-- nothing -->", site.OWN_BAR_UNREAD),
])
def test_past_its_bound_or_not_read_the_articles_keep_azimuts_bar(data, said):
    assert site.own_bar(data) == ("", said)
    assert site.OWN_BAR_TOO_LARGE == "azimut-bar.html is larger than 64 KB: the articles keep Azimut's bar."
    assert site.OWN_BAR_UNREAD == "azimut-bar.html does not read as HTML: the articles keep Azimut's bar."


def test_the_markers_hold_the_bar_and_every_byte_outside_them_stays():
    frame = Frame(title="The Desk")
    marked = site.marked_bar(frame, "")
    assert marked == f"<!-- azimut:bar -->{site.bar(frame, '')}<!-- /azimut:bar -->"
    page = (b'<!doctype html>\n<html lang="en"><head><title>T</title></head>\n<body>' + marked.encode()
            + b'\n<article>typo fixed by hand \xc3\xa9</article>\n</body>\n</html>\n')
    assert site.is_azimut_bar(_inner(page)) and site.bar_in(page) == site.bar(frame, "").encode()
    swapped = site.with_bar(page, "<azimut-bar>x</azimut-bar>")
    assert swapped == page.replace(site.bar(frame, "").encode(), b"<azimut-bar>x</azimut-bar>")
    assert not site.is_azimut_bar(_inner(swapped))
    assert site.without_bar(page) == site.without_bar(swapped) == page.replace(site.bar(frame, "").encode(), b"")
    # no markers, or markers anywhere but where Azimut puts them: the page is never changed
    for other in (b"<body><nav>mine</nav></body>", b"<body>\n" + marked.encode() + b"</body>",
                  b"<body><!-- azimut:bar -->never closed</body>"):
        assert site.bar_in(other) is None and site.with_bar(other, "x") is None and site.without_bar(other) == other


# -- a publish gives its article the site's own bar ---------------------------------------------------------


def _logo() -> bytes:
    picture = io.BytesIO()
    Image.new("RGB", (32, 32), (30, 90, 160)).save(picture, "PNG")
    config.signature_path().parent.mkdir(parents=True, exist_ok=True)
    config.signature_path().write_bytes(picture.getvalue())
    return picture.getvalue()


def test_an_article_starts_with_azimuts_bar_between_markers_and_a_map_page_has_only_its_crumb(client, fake,
                                                                                                monkeypatch, tmp_path):
    fake.make_repo()
    _connect(client)
    client.put("/api/settings/prefs", json={"site_title": "The Desk"})
    _published(client, fake)
    page = fake.files()["port-strike/index.html"]
    assert re.search(rb"<body><!-- azimut:bar --><style>.*?</style><nav class=\"az-site-bar\".*?</nav>"
                     rb"<!-- /azimut:bar -->\n", page, re.S)
    case, note_id = _map_note(client, monkeypatch, tmp_path)
    said = client.post(f"/api/cases/{case.id}/notes/{note_id}/github", json={"short_name": "the-road"})
    assert said.status_code == 200, said.text
    map_page = fake.files()["the-road/index.html"]
    assert b"azimut:bar" not in map_page and b'<a class="az-site-crumb" href="../">The Desk</a>' in map_page


def test_a_publish_gives_the_article_the_sites_own_bar_and_a_map_page_keeps_its_crumb(client, fake, monkeypatch,
                                                                                       tmp_path):
    fake.make_repo(files={"README.md": b"# articles\n", "azimut-bar.html": OWN})
    _connect(client)
    client.put("/api/settings/prefs", json={"site_title": "The Desk"})
    made = _published(client, fake)
    files = fake.files()
    page = files["port-strike/index.html"]
    inner = _inner(page)
    assert inner.decode() == site.own_bar(OWN)[0] and b"az-site-bar" not in inner
    assert made["answer"]["site"]["warnings"] == []
    # the page's policy lets in what the bar needs: its inline styles, and its pictures and fonts from the site
    policy = re.search(rb'http-equiv="Content-Security-Policy" content="([^"]*)"', page).group(1).decode()
    assert "style-src 'self' 'unsafe-inline'" in policy and "img-src 'self'" in policy and "font-src 'self'" in policy
    assert "script-src 'self'" in policy and "'unsafe-inline'" not in policy.split("script-src", 1)[1].split(";")[0]
    # the edition is the page as committed, its bar included
    record = client.get(f"/api/cases/{made['cid']}/notes/{made['note']}/editions").json()["editions"][0]
    assert record["sha256"] == made["answer"]["sha256"] == hashlib.sha256(page).hexdigest()
    case, note_id = _map_note(client, monkeypatch, tmp_path)
    assert client.post(f"/api/cases/{case.id}/notes/{note_id}/github", json={"short_name": "the-road"}).status_code == 200
    map_page = fake.files()["the-road/index.html"]
    assert b"azimut-bar" not in map_page and b'class="az-site-crumb"' in map_page


def test_with_no_azimut_bar_html_nothing_more_is_read_and_one_is_read_once(client, fake):
    fake.make_repo()
    _connect(client)
    _published(client, fake)
    before = len(_blob_reads(fake))
    _put(fake, {"azimut-bar.html": OWN})
    _published(client, fake, title="Harbour", short="harbour")
    own = githubpages.blob_sha(OWN)
    assert _blob_reads(fake)[before:].count(own) == 1
    _published(client, fake, title="Third", short="third")
    # what the first publish read is remembered by its blob id
    assert _blob_reads(fake).count(own) == 1


def test_a_bar_past_its_bound_is_not_read_and_the_publish_and_the_update_say_so(client, fake):
    fake.make_repo(files={"README.md": b"#\n", "azimut-bar.html": b"<header>" + b"x" * (64 * 1024) + b"</header>"})
    _connect(client)
    made = _published(client, fake)
    assert made["answer"]["site"]["warnings"] == [site.OWN_BAR_TOO_LARGE]
    assert site.is_azimut_bar(_inner(fake.files()["port-strike/index.html"]))
    assert githubpages.blob_sha(fake.files()["azimut-bar.html"]) not in _blob_reads(fake)
    assert client.post(UPDATE).json()["warnings"] == [site.OWN_BAR_TOO_LARGE]
    _put(fake, {"azimut-bar.html": b"\xff\xfe<header>"})
    assert client.post(UPDATE).json()["warnings"] == [site.OWN_BAR_UNREAD]
    assert site.is_azimut_bar(_inner(fake.files()["port-strike/index.html"]))


# -- Update the site gives every article the bar the site asks for ----------------------------------------


def test_update_the_site_gives_each_article_the_sites_bar_where_it_differs_and_keeps_the_rest_byte_for_byte(
        client, fake, monkeypatch, tmp_path):
    logo = _logo()
    fake.make_repo()
    _connect(client)
    first = _published(client, fake)
    _published(client, fake, title="Harbour", short="harbour", style="article", web="story")
    case, note_id = _map_note(client, monkeypatch, tmp_path)
    client.post(f"/api/cases/{case.id}/notes/{note_id}/github", json={"short_name": "the-road"})
    # a typo the analyst fixed on GitHub, outside the markers
    fixed = fake.files()["port-strike/index.html"].replace(b"Smoke over the pier", b"Smoke over the quay")
    _put(fake, {"port-strike/index.html": fixed})
    # the first update after this one learns that every page carries Azimut's bar, and says so in the list
    assert client.post(UPDATE).json()["written"] == ["articles.json"]
    assert json.loads(fake.files()["articles.json"])["bar"] == "azimut"
    before = fake.files()

    _put(fake, {"azimut-bar.html": OWN})
    said = client.post(UPDATE).json()
    assert said["ok"] and said["updated"] and said["warnings"] == []
    assert said["written"] == ["articles.json", "harbour/index.html", "port-strike/index.html"]
    after = fake.files()
    inner = site.own_bar(OWN)[0].encode()
    for folder in ("port-strike", "harbour"):
        page = after[f"{folder}/index.html"]
        assert _inner(page) == inner
        assert site.without_bar(page) == site.without_bar(before[f"{folder}/index.html"])
    assert b"Smoke over the quay" in after["port-strike/index.html"]
    # the map page, the folders' other files and everything else are as they were
    assert {path for path, data in after.items() if before.get(path) != data} == {
        "azimut-bar.html", "articles.json", "harbour/index.html", "port-strike/index.html"}
    assert json.loads(after["articles.json"])["bar"] == sitesync.bar_kind(inner)
    assert fake.history()[0]["message"] == "Update the site"

    # nothing left to change: no commit, and no page read for it
    commits = len(fake.history())
    quiet = client.post(UPDATE).json()
    assert quiet["updated"] is False and len(fake.history()) == commits
    sitesync._kept.clear()
    sitesync._bars.clear()
    reads = len(_blob_reads(fake))
    assert client.post(UPDATE).json()["updated"] is False
    pages = {githubpages.blob_sha(after[f"{folder}/index.html"]) for folder in ("port-strike", "harbour", "the-road")}
    assert not pages & set(_blob_reads(fake)[reads:])

    # an edit of the bar reaches every article
    _put(fake, {"azimut-bar.html": OWN.replace(b"The Desk", b"The Desk, again")})
    assert client.post(UPDATE).json()["written"] == ["articles.json", "harbour/index.html", "port-strike/index.html"]
    assert all(b"The Desk, again" in _inner(fake.files()[f"{folder}/index.html"]) for folder in ("port-strike", "harbour"))

    # and without it, Azimut's bar is back, with the logo each folder holds
    _put(fake, {"azimut-bar.html": None})
    assert client.post(UPDATE).json()["written"] == ["articles.json", "harbour/index.html", "port-strike/index.html"]
    back = fake.files()
    for folder in ("port-strike", "harbour"):
        bar = _inner(back[f"{folder}/index.html"])
        assert site.is_azimut_bar(bar) and re.search(rb'<img src="assets/[0-9a-f]{8}-site-logo\.png" alt="">', bar)
        logo_path = re.search(rb'src="(assets/[^"]+)"', bar).group(1).decode()
        assert back[f"{folder}/{logo_path}"] == logo
        assert site.without_bar(back[f"{folder}/index.html"]) == site.without_bar(before[f"{folder}/index.html"])
    assert json.loads(back["articles.json"])["bar"] == "azimut"
    assert first["short"] == "port-strike"


def test_update_the_site_leaves_a_page_with_no_markers_and_a_folder_it_did_not_publish(client, fake):
    fake.make_repo()
    _connect(client)
    _published(client, fake)
    marked = fake.files()["port-strike/index.html"]
    card = fake.files()["port-strike/article.json"]
    # a page an older Azimut published, with no markers; a folder holding Azimut's page but no share.jpg
    _put(fake, {"older/index.html": b"<html><body><nav>its old bar</nav></body></html>", "older/share.jpg": b"j",
                "older/article.json": card, "half/index.html": marked, "half/article.json": card})
    client.post(UPDATE)
    _put(fake, {"azimut-bar.html": OWN})
    said = client.post(UPDATE).json()
    assert said["written"] == ["articles.json", "port-strike/index.html"]
    files = fake.files()
    assert files["older/index.html"] == b"<html><body><nav>its old bar</nav></body></html>"
    assert files["half/index.html"] == marked


def test_update_the_site_keeps_to_one_commits_bounds_and_the_next_press_does_the_rest(client, fake, monkeypatch):
    fake.make_repo()
    _connect(client)
    for number in range(3):
        _published(client, fake, title=f"Note {number}", short=f"note-{number}")
    client.post(UPDATE)
    _put(fake, {"azimut-bar.html": OWN})
    # room for the list's files and one page
    monkeypatch.setattr(githubpages, "MAX_FILES", 2)
    first = client.post(UPDATE).json()
    assert first["warnings"] == [sitesync.BARS_LEFT]
    assert first["written"] == ["articles.json", "note-0/index.html"]
    assert "bar" not in json.loads(fake.files()["articles.json"])
    second = client.post(UPDATE).json()
    assert second["warnings"] == [sitesync.BARS_LEFT] and second["written"] == ["note-1/index.html"]
    monkeypatch.setattr(githubpages, "MAX_FILES", 1000)
    third = client.post(UPDATE).json()
    assert third["warnings"] == [] and third["written"] == ["articles.json", "note-2/index.html"]
    inner = site.own_bar(OWN)[0].encode()
    assert all(_inner(fake.files()[f"note-{number}/index.html"]) == inner for number in range(3))
    monkeypatch.setattr(githubpages, "MAX_TOTAL_BYTES", 10)
    _put(fake, {"azimut-bar.html": None})
    assert sitesync.BARS_LEFT in client.post(UPDATE).json()["warnings"]


def test_a_page_too_large_to_read_keeps_its_bar_and_is_said(client, fake, monkeypatch):
    fake.make_repo()
    _connect(client)
    _published(client, fake)
    client.post(UPDATE)
    _put(fake, {"azimut-bar.html": OWN})
    monkeypatch.setattr(sitesync, "MAX_BAR_PAGE_BYTES", 100)
    said = client.post(UPDATE).json()
    assert said["warnings"] == [sitesync.bars_too_large(1)]
    # nothing says every page carries the site's bar, so the next press tries again and says it again
    assert "bar" not in json.loads(fake.files()["articles.json"])
    assert client.post(UPDATE).json()["warnings"] == [sitesync.bars_too_large(1)]
    assert sitesync.bars_too_large(1) == "1 article page is too large for Azimut to change the bar: publish it again."
    assert sitesync.bars_too_large(2) == "2 article pages are too large for Azimut to change the bar: publish them again."
    assert site.is_azimut_bar(_inner(fake.files()["port-strike/index.html"]))


def test_a_publish_keeps_the_record_while_its_bar_is_the_one_every_page_carries_and_drops_it_otherwise(client, fake):
    fake.make_repo()
    _connect(client)
    _published(client, fake)
    client.post(UPDATE)
    assert json.loads(fake.files()["articles.json"])["bar"] == "azimut"
    _published(client, fake, title="Harbour", short="harbour")
    assert json.loads(fake.files()["articles.json"])["bar"] == "azimut"
    # the site's own bar now, given to the one page published: the others still carry Azimut's
    _put(fake, {"azimut-bar.html": OWN})
    _published(client, fake, title="Third", short="third")
    assert "bar" not in json.loads(fake.files()["articles.json"])
    assert client.post(UPDATE).json()["written"] == ["articles.json", "harbour/index.html", "port-strike/index.html"]
    assert json.loads(fake.files()["articles.json"])["bar"] == sitesync.bar_kind(site.own_bar(OWN)[0].encode())
    # a delete takes no bar with it
    assert client.post("/api/publishing/github/site/delete", json={"folder": "third"}).status_code == 200
    assert json.loads(fake.files()["articles.json"])["bar"] == sitesync.bar_kind(site.own_bar(OWN)[0].encode())


# -- a bar Update the site changed is no edit of the analyst's ---------------------------------------------


def test_a_bar_changed_by_update_the_site_is_never_called_an_edit(client, fake):
    fake.make_repo()
    _connect(client)
    made = _published(client, fake)
    url, check = made["url"], f"{made['url']}/check"
    _put(fake, {"azimut-bar.html": OWN})
    assert client.post(UPDATE).json()["written"] == ["articles.json", "port-strike/index.html"]
    assert client.post(check, json={"short_name": "port-strike"}).json() == {
        "checked": True, "exists": True, "edited": False, "warning": ""}
    edition = f"/api/cases/{made['cid']}/notes/{made['note']}/editions"
    record = client.get(edition).json()["editions"][0]
    assert record["bare_sha256"] != record["sha256"]
    ref = {"at": record["at"], "file": record["file"]}
    assert client.post(f"{edition}/check", json=ref).json() == {"state": "unchanged"}
    again = client.post(url, json={"short_name": "port-strike"}).json()
    assert again["edited"] is False
    # an edit outside the markers is one, before the publish and after
    page = fake.files()["port-strike/index.html"]
    _put(fake, {"port-strike/index.html": page.replace(b"Smoke over the pier", b"Smoke over the quay")})
    assert client.post(check, json={"short_name": "port-strike"}).json()["edited"] is True
    record = client.get(edition).json()["editions"][0]
    assert client.post(f"{edition}/check", json={"at": record["at"], "file": record["file"]}).json() == {"state": "changed"}
    assert client.post(url, json={"short_name": "port-strike"}).json()["edited"] is True
    # and so is a file added to the folder beside a bar changed
    _put(fake, {"azimut-bar.html": None})
    client.post(UPDATE)
    _put(fake, {"port-strike/notes.txt": b"mine"})
    assert client.post(check, json={"short_name": "port-strike"}).json()["edited"] is True


def test_the_folders_old_tree_gone_from_github_is_an_edit_as_before(client, fake):
    fake.make_repo()
    _connect(client)
    made = _published(client, fake)
    record = client.get(f"/api/cases/{made['cid']}/notes/{made['note']}/editions").json()["editions"][0]
    _put(fake, {"port-strike/index.html": b"<html><body>other</body></html>"})
    # a tree GitHub no longer has: nothing to tell a change of bar by, so it is said as before
    fake.objects.pop(record["tree"])
    assert client.post(f"{made['url']}/check", json={"short_name": "port-strike"}).json()["edited"] is True


# -- the read says whose bar the articles carry ---------------------------------------------------------------


def _survey(fake: FakeGitHub, files: dict[str, bytes]) -> sitesync.Survey:
    fake.make_repo(files=files)
    gh = githubpages.GitHub(TOKEN, githubpages.client(fake.transport()))
    commit = fake.repos["octo/articles"]["refs"]["main"]
    tree = githubpages.read_tree(gh, "octo", "articles", fake.objects[commit][1]["tree"])
    return sitesync.survey(gh, "octo", "articles", Site(title="Desk", address="https://desk.example/"), tree)


@pytest.mark.parametrize("files, bar, warnings", [
    ({"README.md": b"#"}, "azimut", []),
    ({"azimut-bar.html": OWN}, "yours", []),
    ({"azimut-bar.html": b"<script>x()</script>"}, "azimut", [site.OWN_BAR_UNREAD]),
    ({"azimut-bar.html": b"x" * (64 * 1024 + 1)}, "azimut", [site.OWN_BAR_TOO_LARGE]),
])
def test_the_survey_says_whose_bar_the_articles_carry(fake, files, bar, warnings):
    surveyed = _survey(fake, files)
    assert surveyed.bar == bar and surveyed.warnings == warnings


def test_the_read_answer_carries_the_bar(client, fake):
    fake.make_repo(files={"README.md": b"#", "azimut-bar.html": OWN})
    _connect(client)
    said = client.post(READ).json()
    assert said["ok"] and said["bar"] == "yours"
    _put(fake, {"azimut-bar.html": None})
    assert client.post(READ).json()["bar"] == "azimut"
