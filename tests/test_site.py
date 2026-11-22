"""The site's cards, list, feed, sitemap and markers (`engine/site.py`), and its default home
(`engine/sitehome.py`).

The live site this was built from is the reference: `tests/fixtures/site/` holds copies of its
cards, its marked pages, its feed, its sitemap and its list, all made by the prototype this
engine ports. Azimut taking the site over must not change a byte of what they show for the same
data, so each is rebuilt here from the cards and held to the file.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest

from azimut import __version__
from azimut.api import settings as settings_api
from azimut.engine import githubpages, notelook, site, sitehome, sitesync
from azimut.engine.site import Card, Frame, Site

LIVE = Path(__file__).parent / "fixtures" / "site"
MARKED = ("index.html", "conflict-watch/index.html", "methods-tools/index.html", "investigations/index.html",
          "deep-dives/index.html", "maps/index.html")
THE_SITE = Site(title="OSINT Me That", address="https://osintmethat.com/",
                tagline="In a world of fragmented information and digital noise, clarity is the ultimate tool.")


def _live(path: str) -> str:
    return (LIVE / path).read_text(encoding="utf-8")


def _cards() -> list[dict]:
    found = []
    for path in sorted(LIVE.rglob(site.CARD)):
        card = site.read_card(path.parent.relative_to(LIVE).as_posix(), path.read_bytes())
        assert card is not None, path
        found.append(card)
    return found


# -- the same output as the prototype's, for the same data ------------------------------------------


def test_the_list_is_the_one_the_live_site_holds():
    cards = _cards()
    lines, maps = site.listing(cards), site.map_view(cards)
    live = json.loads(_live("articles.json"))
    assert (lines, maps) == (live["articles"], live["maps"])
    # the file is the live one's, with the pages the live one never had
    made = site.articles_json(lines, maps, site.pages_of(cards), THE_SITE)
    assert json.loads(made) == {**live, "pages": []}
    assert list(json.loads(made)) == ["format", "site", "articles", "maps", "pages"]
    without = json.dumps({key: value for key, value in json.loads(made).items() if key != "pages"},
                         indent=1, ensure_ascii=False) + "\n"
    assert without == _live("articles.json")


def test_each_line_has_the_shape_the_contract_names():
    lines = site.listing(_cards())
    assert list(lines[0]) == ["address", "title", "summary", "date", "date_label", "category", "author", "layout",
                              "image", "maps"]
    assert lines[0]["date_label"] == "20 November 2026" and lines[0]["maps"][0]["address"] == "/bab-el-mandab-2026-map/"


def test_every_marked_page_of_the_live_site_is_filled_as_it_already_is():
    cards = _cards()
    lines, maps = site.listing(cards), site.map_view(cards)
    for path in MARKED:
        page = _live(path)
        assert site.MARKER.search(page), path
        assert site.fill(page, lines, maps, THE_SITE.title) == page, path


def test_a_category_page_lists_that_category_only_and_reads_the_attribute_as_html():
    lines = site.listing(_cards())
    page = _live("methods-tools/index.html")
    assert 'section="Methods &amp; Tools"' in page
    shown = re.findall(r'<li class="az-item[^"]*" data-category="([^"]*)"', page)
    assert shown and set(shown) == {"methods-tools"}
    assert len(shown) == len([line for line in lines if line["category"] == "Methods & Tools"])
    assert site.sections_of(page) == ["Methods & Tools"]


def test_the_feed_and_the_sitemap_are_the_live_ones():
    cards = _cards()
    lines, maps = site.listing(cards), site.map_view(cards)
    assert site.feed(lines, THE_SITE) == _live("feed.xml")
    old = _live("sitemap.xml")
    answering = {f"{path}/index.html": "x" for path in ("investigations", "conflict-watch", "methods-tools",
                                                         "deep-dives", "maps", "about-contact", "registration",
                                                         "legal-notice", "privacy")}
    marked = [f"/{path.split('/')[0]}/" for path in MARKED[1:]]
    paths = sitesync._sitemap_pages(old, THE_SITE, answering, lines, maps, sorted(marked), [])
    assert site.sitemap(lines, maps, paths, THE_SITE) == old


def test_the_sitemap_keeps_the_analysts_pages_that_still_answer_and_drops_the_dead_ones():
    cards = _cards()
    lines, maps = site.listing(cards), site.map_view(cards)
    old = _live("sitemap.xml")
    answering = {"about-contact/index.html": "x", "privacy/index.html": "x"}
    paths = sitesync._sitemap_pages(old, THE_SITE, answering, lines, maps, [], [])
    assert paths == ["/", "/about-contact/", "/privacy/"]
    # an article that left the repository is not kept as a page of the site
    assert "/bab-el-mandab-2026/" not in paths


def test_the_feed_carries_the_thirty_newest_and_the_marks_that_make_it_azimuts():
    lines = [{"address": f"/a{number}/", "title": f"Article {number}", "summary": "", "date": "2026-01-01",
              "category": "", "author": "", "layout": "article", "image": "", "maps": []} for number in range(40)]
    feed = site.feed(lines, THE_SITE)
    assert feed.count("<item>") == site.FEED_ITEMS
    assert "<generator>Azimut</generator>" in feed and site.owns_feed(feed)
    assert site.owns_sitemap(site.sitemap([], [], ["/"], THE_SITE))


# -- the list is the lists the site holds, by role and layout ------------------------------------------


def _card(folder: str, **more) -> dict:
    card = {"format": site.CARD_FORMAT, "title": f"Title {folder}", "summary": "About it.", "date": "2026-02-03",
            "category": "", "author": "", "layout": "article", "image": "cover.jpg", "links": [], "maps": [], **more}
    made = site.read_card(folder, json.dumps(card).encode())
    assert made is not None
    return made


def test_a_page_is_on_no_list_and_is_listed_under_pages_by_title():
    cards = [_card("legal", title="Legal notice", role="page"), _card("about", title="about us", role="page"),
             _card("story", title="A story")]
    assert [line["title"] for line in site.listing(cards)] == ["A story"]
    assert site.map_view(cards) == []
    assert site.pages_of(cards) == [{"title": "about us", "address": "/about/"},
                                    {"title": "Legal notice", "address": "/legal/"}]
    # a page that links a map does not fold it under itself
    cards.append(_card("map", layout="map", title="The map"))
    cards[0]["links"] = ["map"]
    assert {line["title"] for line in site.listing(cards)} == {"The map", "A story"}
    assert all(line["maps"] == [] for line in site.listing(cards))


def test_an_unlisted_page_is_in_no_list_no_feed_no_sitemap_and_adds_no_category():
    cards = [_card("story", title="A story", category="Harbour"),
             _card("draft", title="A draft", category="Secret", role="unlisted"),
             _card("legal", title="Legal notice", role="page")]
    assert [card["role"] for card in cards] == ["article", "unlisted", "page"]
    assert [line["title"] for line in site.listing(cards)] == ["A story"]
    assert site.map_view(cards) == [] and site.pages_of(cards) == [{"title": "Legal notice", "address": "/legal/"}]
    assert site.categories_of(cards) == ["Harbour"]
    lines, maps, pages = site.listing(cards), site.map_view(cards), site.pages_of(cards)
    made = site.articles_json(lines, maps, pages, THE_SITE)
    assert "draft" not in made and "A draft" not in made
    assert "A draft" not in site.feed(lines, THE_SITE) and "/draft/" not in site.sitemap(lines, maps, ["/"], THE_SITE)
    assert "A draft" not in site.render(lines, THE_SITE.title)
    # a card that names another role, or none, is an article
    assert _card("x", role="post")["role"] == "article" and _card("y")["role"] == "article"


def test_an_unlisted_map_has_no_line_and_an_unlisted_article_never_shows_as_what_cites_a_map():
    cards = [_card("map", layout="map", title="The map", role="unlisted"),
             _card("story", title="Story", links=["map"]),
             _card("quiet", title="Quiet", role="unlisted", links=["cited"]),
             _card("cited", layout="map", title="Cited")]
    # the unlisted map is not folded under the article that links it, and the listed map is not
    # said to come from the unlisted article that links it
    assert [(line["title"], line["maps"]) for line in site.listing(cards)] == [("Story", []), ("Cited", [])]
    assert [(m["title"], m["article"]) for m in site.map_view(cards)] == [("Cited", None)]


def test_the_sitemap_never_keeps_an_unlisted_page_an_earlier_sitemap_listed():
    cards = [_card("draft", role="unlisted"), _card("story", title="Story")]
    lines, maps = site.listing(cards), site.map_view(cards)
    old = site.sitemap(lines, maps, ["/", "/draft/"], THE_SITE)
    answering = {"draft/index.html": "x", "story/index.html": "x"}
    assert sitesync._sitemap_pages(old, THE_SITE, answering, lines, maps, [], []) == ["/", "/draft/"]
    assert sitesync._sitemap_pages(old, THE_SITE, answering, lines, maps, [], [], {"/draft/"}) == ["/"]


def test_a_map_an_article_cites_folds_under_it_and_a_map_nothing_cites_keeps_its_own_line():
    cards = [_card("story", links=["cited-map"], title="Story"), _card("cited-map", layout="map", title="Cited"),
             _card("lost-map", layout="map", title="Lost", date="2026-01-01")]
    lines = site.listing(cards)
    assert [line["title"] for line in lines] == ["Story", "Lost"]
    assert lines[0]["maps"] == [{"title": "Cited", "address": "/cited-map/"}] and lines[1]["maps"] == []
    maps = site.map_view(cards)
    assert [(m["title"], m["article"]) for m in maps] == [("Cited", {"title": "Story", "address": "/story/"}),
                                                          ("Lost", None)]


def test_a_limit_and_an_empty_list_say_what_they_are():
    lines = site.listing([_card(f"a{n}", date=f"2026-01-0{n}") for n in range(1, 5)])
    assert site.render(lines, "Site", limit=2).count('<li class="az-item') == 2
    assert site.render(lines, "Site", section="Nothing") == '<p class="az-empty">No articles yet.</p>'
    assert site.render_maps([], "Site") == '<p class="az-empty">No maps yet.</p>'
    page = '<!-- azimut:articles limit="1" --><!-- /azimut:articles -->\n<!-- azimut:articles layout="map" --><!-- /azimut:articles -->'
    filled = site.fill(page, lines, [], "Site")
    assert filled.count('<li class="az-item') == 1 and "No maps yet." in filled


def test_the_authors_name_shows_unless_it_is_the_sites_own_on_articles_and_maps():
    lines = site.listing([_card("a", author="Someone"), _card("b", author="Site", date="2026-01-01")])
    shown = site.render(lines, "Site")
    assert "· Someone" in shown and "· Site" not in shown
    maps = site.map_view([_card("m", layout="map", author="Guest"), _card("n", layout="map", author="Site")])
    drawn = site.render_maps(maps, "Site")
    assert "· Guest" in drawn and "· Site" not in drawn


def test_a_site_under_a_path_links_under_it_and_a_domain_root_links_as_the_prototype_did():
    lines = site.listing([_card("story", links=[])])
    root = site.render(lines, "Site")
    assert 'href="/story/"' in root and 'src="/story/cover.jpg"' in root
    under = site.render(lines, "Site", prefix="/articles")
    assert 'href="/articles/story/"' in under and 'src="/articles/story/cover.jpg"' in under
    assert Site(title="T", address="https://octo.github.io/articles/").prefix == "/articles"
    assert Site(title="T", address="https://octo.github.io/").prefix == ""
    # an address kept elsewhere is no business of the site's path
    elsewhere = site.render([{**lines[0], "maps": [{"title": "Far", "address": "https://maps.example.org/a/"}]}],
                            "Site", prefix="/articles")
    assert 'href="https://maps.example.org/a/"' in elsewhere


# -- the card ---------------------------------------------------------------------------------------


def test_the_card_a_folder_carries_is_written_as_the_contract_has_it():
    card = Card(title="A title", summary="What it is.", date="2026-11-20", category="Conflict Watch",
                author="Desk", role="article", layout="article", image="cover.jpg", links=("other",))
    assert json.loads(card.as_json()) == {
        "format": "azimut-article/1", "title": "A title", "summary": "What it is.", "date": "2026-11-20",
        "category": "Conflict Watch", "author": "Desk", "role": "article", "layout": "article",
        "image": "cover.jpg", "links": ["other"], "maps": []}
    assert list(json.loads(card.as_json())) == ["format", "title", "summary", "date", "category", "author", "role",
                                                "layout", "image", "links", "maps"]
    assert site.card_date(card.dated("2026-01-02").as_json()) == "2026-01-02"
    assert site.card_date(b"{not json") == "" and site.card_date(b'{"date": "soon"}') == ""
    # what it writes is what the list reads back
    line = site.line_of(card, "port-strike")
    assert line["address"] == "/port-strike/" and line["image"] == "/port-strike/cover.jpg" and line["links"] == ["other"]


@pytest.mark.parametrize("card", [
    {"format": "other/1", "title": "T", "date": "2026-01-01"},
    {"format": "azimut-article/1", "title": "", "date": "2026-01-01"},
    {"format": "azimut-article/1", "title": "T", "date": "yesterday"},
    {"format": "azimut-article/1", "title": "T", "date": "2026-13-45"},
    {"format": "azimut-article/1", "date": "2026-01-01"},
])
def test_a_card_that_is_not_one_azimut_reads_is_left_out(card):
    assert site.read_card("x", json.dumps(card).encode()) is None
    assert site.read_card("x", b"not json") is None
    assert site.read_card("x", b"[]") is None


def test_a_card_cannot_make_a_page_run_something_or_swell():
    hostile = {"format": "azimut-article/1", "title": "T" * 900, "summary": "S" * 5000, "date": "2026-01-01",
               "image": "//evil.example.org/x.jpg", "layout": "<script>", "role": "root",
               "links": ["a/", 3, "b"], "maps": [{"title": "ok", "address": "javascript:alert(1)"},
                                                  {"title": "far", "address": "https://maps.example.org/"},
                                                  {"title": "near", "address": "//evil.example.org/"},
                                                  {"title": "quote", "address": '/a"onmouseover="x'}, "bare"]}
    card = site.read_card("x", json.dumps(hostile).encode())
    assert card is not None
    assert len(card["title"]) == site.MAX_TITLE and len(card["summary"]) == site.MAX_SUMMARY
    assert card["image"] == "" and card["layout"] == "article" and card["role"] == "article"
    assert card["links"] == ["a", "b"]
    assert card["maps"] == [{"title": "far", "address": "https://maps.example.org/"}]
    assert site.read_card("x", b" " * (site.MAX_CARD_BYTES + 1)) is None


def test_what_holds_an_address_is_named_by_its_card_else_its_page():
    card = Card(title="Harbour   fire\nat dawn", summary="", date="2026-11-20")
    assert site.card_title(card.as_json()) == "Harbour fire at dawn"
    for other in (b"not json", b"[]", json.dumps({"format": "else/1", "title": "x"}).encode(), b" " * (site.MAX_CARD_BYTES + 1)):
        assert site.card_title(other) == ""
    assert site.page_title(b"<html><HEAD><Title lang='en'>Port &amp; strike\n log</TITLE></head></html>") == "Port & strike log"
    assert site.page_title(b"<p>no title</p>") == "" and site.page_title(b"<title>  </title>") == ""
    assert len(site.page_title(b"<title>" + b"t" * 900 + b"</title>")) == site.MAX_TITLE


def test_a_free_short_name_is_found_beside_the_taken_ones():
    assert githubpages.free_name("port-strike", {"port-strike"}) == "port-strike-2"
    assert githubpages.free_name("port-strike", {"port-strike", "port-strike-2", "Port-Strike-3"}) == "port-strike-4"
    # a name ending on a number goes on from it
    assert githubpages.free_name("port-strike-2", {"port-strike-2"}) == "port-strike-3"
    assert githubpages.free_name("report-2026", {"report-2026"}) == "report-2026-2"
    # a long name is cut to make room, never past what a short name may be
    made = githubpages.free_name("a" * githubpages.MAX_SHORT, {"a" * githubpages.MAX_SHORT})
    assert made == "a" * (githubpages.MAX_SHORT - 2) + "-2" and githubpages.SHORT.match(made)
    assert githubpages.free_name("x", {"x", *(f"x-{n}" for n in range(2, 102))}) == ""


# -- who owns what ----------------------------------------------------------------------------------


def test_the_live_files_are_azimuts_to_rewrite_and_the_analysts_home_is_not():
    assert site.owns_feed(_live("feed.xml")) and site.owns_sitemap(_live("sitemap.xml"))
    assert site.owns_articles(_live("articles.json"))
    assert not site.owns_home(_live("index.html"))


def test_a_home_is_azimuts_only_while_its_generator_carries_a_version():
    assert site.owns_home('<head><meta name="generator" content="Azimut 0.3.4"></head>')
    # a page Azimut made as an article carries the name alone: put at a site's root by hand, it is the analyst's
    assert not site.owns_home('<meta name="generator" content="Azimut">')
    assert not site.owns_home('<meta name="generator" content="WordPress 6.4">')
    assert not site.owns_articles('{"format": "something-else/1"}') and not site.owns_articles("nope")
    assert not site.owns_feed("<rss><channel><generator>WordPress</generator></channel></rss>")
    assert not site.owns_sitemap('<?xml version="1.0"?><urlset></urlset>')
    assert not site.owns_sitemap('<!-- generator: Azimut --><?xml version="1.0"?>')


# -- links, settings, counts ---------------------------------------------------------------------------


def test_the_links_of_a_page_are_the_folders_of_the_site_it_points_to():
    page = ('<a href="https://octo.github.io/articles/other-story/">one</a> <a href="../third/">two</a> '
            '<a href="https://octo.github.io/articles/deep/er/folder/#part">three</a> '
            '<a href="https://octo.github.io/articles/me/">itself</a> <a href="../">home</a> '
            '<a href="https://example.org/articles/x/">outside</a> <a href="../../etc/">up</a> '
            '<a class="a" href="../third/index.html?x=1">again</a> <link href="../not-a-link/">')
    here = Site(title="T", address="https://octo.github.io/articles/")
    assert site.links_of(page, here, "me") == ("other-story", "third", "deep/er/folder")


def test_the_site_is_read_from_the_settings_part_by_part():
    settings = {"site_title": "  The  Desk ", "report_name": "Someone", "site_tagline": "A line.",
                "site_credit_azimut": False, "site_stats": "goatcounter", "site_stats_code": "Desk-1"}
    made = site.from_settings(settings, address="https://x.org/", account="octo")
    assert (made.title, made.author, made.tagline, made.credit, made.counter) == ("The Desk", "Someone", "A line.",
                                                                                   False, "desk-1")
    # empty title reads the report name, then the account; the credit is on unless turned off
    assert site.from_settings({"report_name": "Someone"}, address="https://x.org/", account="octo").title == "Someone"
    bare = site.from_settings({}, address="https://x.org/", account="octo")
    assert (bare.title, bare.author, bare.credit, bare.stats) == ("octo", "octo", True, "")
    # a count whose code or token does not read counts nobody
    assert site.from_settings({"site_stats": "goatcounter", "site_stats_code": "no good"}, address="https://x.org/",
                              account="o").counter == ""
    assert site.from_settings({"site_stats": "cloudflare", "site_stats_token": "x'y"}, address="https://x.org/",
                              account="o").beacon == ""
    token = "0123456789abcdef0123456789abcdef"
    counted = site.from_settings({"site_stats": "cloudflare", "site_stats_token": token}, address="https://x.org/",
                                 account="o")
    assert counted.beacon == token and counted.counter == ""


def test_the_preferences_come_back_bounded_and_the_categories_clean():
    assert site.prefs_of({"site_stats": "nope", "site_stats_code": "NO GOOD"})["site_stats"] == ""
    assert site.prefs_of({})["site_credit_azimut"] is True
    assert site.categories_read(["b", " a ", "a", "", 3, "c" * 90]) == ["a", "b", "c" * 60]
    assert site.categories_read("a") == []


def test_a_count_lets_in_its_own_hosts_and_nothing_else():
    assert site.stats_sources() == {}
    assert site.stats_sources("desk") == {"img-src": ("https://desk.goatcounter.com",),
                                           "connect-src": ("https://desk.goatcounter.com",)}
    assert site.stats_sources("", "tok") == {"script-src": ("https://static.cloudflareinsights.com",),
                                              "connect-src": ("https://cloudflareinsights.com",)}
    both = site.stats_sources("desk", "tok")
    assert both["connect-src"] == ("https://desk.goatcounter.com", "https://cloudflareinsights.com")
    assert site.cloudflare_tag("tok") == ("<script type='module' src='https://static.cloudflareinsights.com/"
                                          "beacon.min.js' data-cf-beacon='{\"token\": \"tok\"}'></script>")


# -- the way back to the site ---------------------------------------------------------------------------


PROTOTYPE_BAR = ('<nav class="az-site-bar" aria-label="Site"><a href="../"><img src="site-logo.png" alt="">'
                 'OSINT Me That</a><a class="back" href="../">All articles</a></nav>')
PROTOTYPE_CRUMB = '<a class="az-site-crumb" href="../"><img src="site-logo.png" alt="">OSINT Me That</a>'


def test_the_bar_and_the_crumb_are_the_prototypes():
    frame = Frame(title="OSINT Me That")
    assert site.bar(frame, "site-logo.png") == site.BAR_STYLE + PROTOTYPE_BAR
    assert site.crumb(frame, "site-logo.png") == site.BAR_STYLE + PROTOTYPE_CRUMB
    # without a logo there is no picture, and a title is text, never markup
    assert "<img" not in site.bar(frame, "") and "<img" not in site.crumb(frame, "")
    assert "&lt;b&gt;" in site.bar(Frame(title="<b>"), "") and "<b>" not in site.bar(Frame(title="<b>"), "")


# -- the default home -------------------------------------------------------------------------------


def _home(home: Site = THE_SITE, cards: list[dict] | None = None) -> str:
    cards = cards if cards is not None else _cards()
    lines, maps, pages = site.listing(cards), site.map_view(cards), site.pages_of(cards)
    return site.fill(sitehome.home(home, lines, maps, pages), lines, maps, home.title, home.prefix)


def test_the_default_home_has_tabs_the_newest_large_and_the_marks_of_a_home_azimut_made():
    page = _home()
    assert site.owns_home(page) and f'content="Azimut {__version__}"' in page
    tabs = re.findall(r'data-category="([^"]*)" aria-pressed="[a-z]+">([^<]*)<span class="count">(\d+)', page)
    assert tabs[0] == ("", "All", "5") and ("__maps", "Maps", "2") in tabs
    assert ("conflict-watch", "Conflict Watch", "1") in tabs and ("methods-tools", "Methods &amp; Tools", "2") in tabs
    assert ("investigations", "Investigations", "2") in tabs
    # the same markers as a hand-made home, both filled: five articles and two maps
    assert page.count("<!-- azimut:articles") == 2 and page.count('<li class="az-item') == 7
    assert page.index("bab-el-mandab-2026/") < page.index("installing-azimut-the-complete-guide")
    assert 'href="feed.xml"' in page and 'rel="alternate" type="application/rss+xml"' in page
    assert f'<a href="{site.AZIMUT_REPO}">Made with Azimut {__version__}</a>' in page
    assert '<p class="site-intro">In a world of fragmented information' in page


def test_an_empty_home_has_no_tabs_and_they_come_with_the_first_listed_article():
    here = Site(title="Desk", address="https://octo.github.io/articles/")
    empty = _home(here, [])
    assert "site-tabs" not in empty and ">All<" not in empty
    assert "<main class=\"wrap\">\n<div class=\"articles-block\">" in empty and "No articles yet." in empty
    # a page alone lists nothing either; one article brings the row, a map nothing cites too
    assert "site-tabs" not in _home(here, [_card("legal", title="Legal notice", role="page")])
    one = _home(here, [_card("story", category="Investigations")])
    assert re.findall(r'data-category="([^"]*)" aria-pressed="[a-z]+">([^<]*)<span class="count">(\d+)', one) == [
        ("", "All", "1"), ("investigations", "Investigations", "1")]
    assert '<nav class="site-tabs" aria-label="Categories">' in _home(here, [_card("road", layout="map")])


def test_a_tab_hides_the_large_first_article_when_it_is_of_another_category():
    # The large first line's own `display` outranked `[hidden]`, so the newest article stayed
    # under every tab; a filtered list also lays its lines out alike.
    assert ".az-item[hidden]{display:none!important}" in sitehome.CSS
    featured = re.findall(r"\.az-list:not\(\.az-maps\)[^ ]* \.az-item:first-child", sitehome.CSS)
    assert featured and all(":not(.is-filtered)" in rule for rule in featured)
    assert "classList.toggle('is-filtered', want !== '')" in sitehome.TABS_JS


def test_the_credit_follows_its_setting_and_nothing_else():
    import dataclasses

    quiet = dataclasses.replace(THE_SITE, credit=False, tagline="")
    page = _home(quiet)
    assert "Made with Azimut" not in page and 'class="site-intro"' not in page
    assert site.owns_home(page) and 'href="feed.xml"' in page


def test_the_header_links_the_pages_and_a_site_under_a_path_links_under_it():
    here = Site(title="Desk", address="https://octo.github.io/articles/")
    page = _home(here, [_card("story"), _card("legal", title="Legal notice", role="page")])
    assert '<nav class="site-pages"><a href="/articles/legal/">Legal notice</a></nav>' in page
    assert 'href="/articles/story/"' in page
    assert "site-pages" not in _home(here, [_card("story")])
    assert 'No articles yet.' in _home(here, []) and 'No maps yet.' in _home(here, [])


def test_the_home_reads_its_title_and_logo_as_text_and_files():
    hostile = Site(title='<script>x</script> & "co"', address="https://x.org/", logo=b"\x89PNG\r\n\x1a\nxx")
    page = _home(hostile, [])
    assert "<script>x" not in page and "&lt;script&gt;x&lt;/script&gt; &amp; &quot;co&quot;" in page
    assert f'<img src="{sitehome.LOGO}" alt="">' in page
    assert sitehome.LOGO not in _home(THE_SITE, [])


def test_the_home_counts_its_readers_with_the_hosts_a_count_needs_and_no_others():
    plain = _home(THE_SITE, [])
    assert "goatcounter" not in plain and "cloudflare" not in plain and "az-counter" not in plain
    policy = re.search(r'http-equiv="Content-Security-Policy" content="([^"]*)"', plain).group(1)
    assert policy == sitehome.POLICY and "'unsafe-inline'" not in policy.split("script-src")[1].split(";")[0]
    import dataclasses

    counted = _home(dataclasses.replace(THE_SITE, stats="goatcounter", code="desk"), [])
    assert '<meta name="az-counter" content="desk">' in counted and f'src="{sitehome.COUNT}"' in counted
    directives = _directives(counted)
    assert directives["img-src"] == ["'self'", "https:", "https://desk.goatcounter.com"]
    assert directives["connect-src"] == ["https://desk.goatcounter.com"]
    beacon = "0123456789abcdef0123456789abcdef"
    cloud = _home(dataclasses.replace(THE_SITE, stats="cloudflare", token=beacon), [])
    assert site.cloudflare_tag(beacon) + "\n</body>" in cloud
    directives = _directives(cloud)
    assert directives["script-src"] == ["'self'", "https://static.cloudflareinsights.com"]
    assert directives["connect-src"] == ["https://cloudflareinsights.com"] and directives["default-src"] == ["'none'"]


def _directives(page: str) -> dict[str, list[str]]:
    policy = re.search(r'http-equiv="Content-Security-Policy" content="([^"]*)"', page).group(1)
    return {part.split()[0]: part.split()[1:] for part in policy.split("; ")}


def test_the_homes_files_are_stable_and_name_only_the_faces_that_exist():
    import dataclasses

    files = sitehome.kit(THE_SITE)
    assert set(files) >= {sitehome.STYLE, sitehome.SCRIPT} and all(path.startswith("azimut-site/") for path in files)
    faces = {path for path in files if path.endswith(".woff")}
    assert len(faces) == len(sitehome.FACES) and all(files[path][:4] == b"wOFF" for path in faces)
    # the same bytes from one publish to the next, so an unchanged home is not committed again
    assert sitehome.kit(THE_SITE) == files
    style = files[sitehome.STYLE].decode()
    assert style.count("@font-face") == len(faces) and "fonts/head-700.woff" in style
    assert sitehome.LOGO not in files and sitehome.COUNT not in files
    more = sitehome.kit(dataclasses.replace(THE_SITE, logo=b"\x89PNG\r\n\x1a\nxx", stats="goatcounter", code="desk"))
    assert more[sitehome.LOGO] == b"\x89PNG\r\n\x1a\nxx" and b"goatcounter.com" in more[sitehome.COUNT]


def test_a_face_that_cannot_be_cut_is_left_out_of_the_style_sheet(monkeypatch):
    from azimut.engine import notes_html

    monkeypatch.setattr(notes_html, "_subset", lambda filename, codes: None)
    files = sitehome.kit(THE_SITE)
    assert not any(path.endswith(".woff") for path in files)
    assert "@font-face" not in files[sitehome.STYLE].decode() and ":root{" in files[sitehome.STYLE].decode()


def test_the_legal_notice_names_the_host_and_leaves_the_publisher_lines():
    text = site.legal_notice()
    assert "GitHub, Inc., 88 Colin P. Kelly Jr. St., San Francisco, CA 94107, United States" in text
    assert "## Publisher" in text and "Name:\n" in text and "Contact:\n" in text
    assert site.LEGAL_SENTENCE == "Depending on your country, a website may need a legal notice."


def test_the_privacy_starter_is_the_same_page_for_everyone_with_the_counting_each_choice_names():
    assert site.PRIVACY_TITLE == "Privacy"

    def page(counting: str) -> str:
        return ("## Cookies\n\nThis site sets no cookies and has no accounts, forms or newsletter.\n\n"
                f"## Counting readers\n\n{counting}\n\n"
                "## Host\n\nGitHub, which hosts the site on GitHub Pages, logs visitors' IP addresses for "
                "security, as its documentation says.\n\n"
                "## Your data\n\nFor any question about your data, write to:\n\n"
                "You can also complain to your country's data protection authority.\n")

    assert site.privacy_notice("") == page("This site does not count its readers.")
    assert site.privacy_notice("goatcounter") == page(
        "Visits are counted with GoatCounter, which sets no cookie and keeps no personal data: "
        "the site sees totals only.")
    assert site.privacy_notice("cloudflare") == page(
        "Visits are counted with Cloudflare Web Analytics, which stores nothing on your device: your browser "
        "sends Cloudflare the page's address and how it loaded, and the site sees totals only.")
    assert list(site.COUNTING_SAID) == list(site.STATS)
    # a count it does not know is none
    assert site.privacy_notice("tracker") == site.privacy_notice("")
    for stats in site.STATS:
        text = site.privacy_notice(stats)
        # it names the host, and not a person, an address or a link for the link check to flag
        assert "## Host" in text and "GitHub Pages" in text and "logs visitors' IP addresses" in text
        assert "## Your data" in text and "write to:\n\n" in text
        assert not any(mark in text for mark in ("@", "http", "](", "www.")) and not any(c.isdigit() for c in text)
    assert "GoatCounter" not in site.privacy_notice("") + site.privacy_notice("cloudflare")
    assert "Cloudflare" not in site.privacy_notice("") + site.privacy_notice("goatcounter")


def test_the_site_copy_is_the_contracts():
    assert site.SITE_INTRO.startswith("Publish your notes as a simple website on GitHub Pages")
    assert [lead for lead, _ in site.SITE_OWN] == ["Your own home page", "Your own bar and footer",
                                                  "A page per category", "Your own domain", "Your own scripts"]
    assert githubpages.OURS == ("index.html", "share.jpg")


# -- the app says the engine's words ------------------------------------------------------------------

FRONTEND = Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib"


def _js_strings(source: str, name: str) -> list[str]:
    """The string literals an `export const <name> = …;` of a module holds, in order: one for a
    string, every string of the lists for an array (flattened). The module's own words, so each is
    single- or double-quoted with the escapes Python reads the same way."""
    start = source.index(f"export const {name} =") + len(f"export const {name} =")
    found: list[str] = []
    at = start
    while at < len(source):
        char = source[at]
        if char in "'\"":
            end = at + 1
            while source[end] != char:
                end += 2 if source[end] == "\\" else 1
            found.append(ast.literal_eval(source[at:end + 1]))
            at = end
        elif char == ";":
            break
        at += 1
    return found


def test_the_tab_and_the_dialog_say_the_engines_words():
    """Settings › Website and the publish dialog carry their own copy of what `HOW-TO-PUBLISH.md`
    says too (`lib/websiteSetup.js`): a word moved on one side fails here."""
    source = (FRONTEND / "websiteSetup.js").read_text(encoding="utf-8")
    for name in ("SITE_TITLE", "SITE_INTRO", "SITE_STAYS_YOURS", "SITE_OWN_TITLE", "LEGAL_SENTENCE", "HAND_EDITED",
                 "WORKFLOW_NOTICE"):
        assert _js_strings(source, name) == [getattr(site, name)], name
    assert _js_strings(source, "SITE_OWN") == [word for pair in site.SITE_OWN for word in pair]
    # the three ways readers are counted, by the engine's own names
    choices = _js_strings(source, "STATS_CHOICES")
    assert [choices[0], choices[2], choices[4]] == list(site.STATS)
    assert (re.search(r"const TOKEN = /(.+)/;", source) or [None, ""])[1] == site.BEACON_TOKEN.pattern
    code = (FRONTEND / "goatcounterSetup.js").read_text(encoding="utf-8")
    assert re.search(r"const CODE = /(.+)/;", code).group(1) == site.COUNTER_CODE.pattern
    # how long the settings a note and the tab keep may be, as the server bounds them
    assert f"TITLE_MAX = {settings_api.SITE_TITLE_MAX};" in source
    assert f"TAGLINE_MAX = {settings_api.SITE_TAGLINE_MAX};" in source
    assert f"CATEGORY_MAX = {notelook.CATEGORY_MAX};" in source
