"""The web page's sources: each one a card its words open, the list grouped by kind.

`notesources.card_entry` writes an entry the way osintmethat.com's older articles write
theirs (SOURCES 4B): who and where first, the work's own title linked to it, its day, its
archived copy. These tests hold the wording, the groups and what a post's address says by
itself; `test_notes_html.py` holds the page that carries them.
"""

from __future__ import annotations

import pytest

from azimut.engine import notesources
from azimut.engine.notesources import Part, Reading, Source

ARCHIVE = "https://web.archive.org/web/20261009125847/https://www.aljazeera.com/news/a"
POST = "https://x.com/mohdsalj/status/2108508784049926499"


def said(parts: list[Part]) -> str:
    return notesources.entry_text(parts)


# -- what a post's address says --------------------------------------------------------


@pytest.mark.parametrize("url, platform, account, post", [
    (POST, "X", "@mohdsalj", True),
    ("https://twitter.com/i/web/status/1", "X", "", True),
    ("https://x.com/port_watch", "X", "@port_watch", False),
    ("https://t.me/s/calden_front/4417", "Telegram", "@calden_front", True),
    ("https://t.me/calden_front", "Telegram", "@calden_front", False),
    ("https://www.tiktok.com/@food_2420/video/7456789012345678901", "TikTok", "@food_2420", True),
    ("https://www.instagram.com/p/DIC1c6ysX7w/", "Instagram", "", True),
    ("https://www.instagram.com/gaivire_8/", "Instagram", "@gaivire_8", False),
    ("https://www.facebook.com/watch/?v=819650357779648", "Facebook", "", True),
    ("https://bsky.app/profile/port.example/post/3k", "Bluesky", "@port.example", True),
    ("https://youtu.be/evNJQf0lrU8", "YouTube", "", True),
])
def test_a_post_or_an_account_is_read_off_its_address(url, platform, account, post):
    link = notesources.post_link(url)
    assert link is not None and (link.platform, link.account, link.post) == (platform, account, post)


def test_a_page_that_is_no_post_is_none():
    assert notesources.post_link("https://english.aawsat.com/node/5327743") is None
    assert notesources.post_link("https://x.com/home/foo/bar") is None


def test_x_and_tiktok_ids_say_when_the_post_went_up():
    # an X id counts milliseconds from X's epoch in its top bits, a TikTok id seconds
    assert notesources.post_link(POST).moment == "2026-10-09T10:44:00Z"
    assert notesources.post_link("https://www.tiktok.com/@a/video/7456789012345678901").moment == "2025-01-06T13:09:00Z"
    # an id too small to carry a moment, or one in the future, says nothing
    assert notesources.post_link("https://x.com/a/status/20").moment == ""
    assert notesources.post_link(f"https://x.com/a/status/{(10**13) << 22}").moment == ""


def test_walled_sites_and_documents_are_told_apart():
    assert notesources.walled(POST) and notesources.walled("https://m.facebook.com/x/posts/1")
    assert not notesources.walled("https://www.youtube.com/watch?v=1")
    assert notesources.is_report("https://ims.example/reports/14.PDF") and not notesources.is_report(POST)


# -- the groups ---------------------------------------------------------------------------


def page(address: str, **fields) -> Source:
    return Source(key=f"url:{address}", label=fields.pop("label", "the link's words"), kind=notesources.PAGE,
                  noun="Web page", address=address, **fields)


@pytest.mark.parametrize("source, group", [
    (page("https://www.aljazeera.com/news/a"), notesources.PAGES),
    (page("https://ims.example/reports/14.pdf"), notesources.BOOKS),
    (page(POST), notesources.POSTS),
    (page(ARCHIVE), notesources.PAGES),
    (Source(key="entity:v", kind=notesources.POST, noun="Video", address=POST, path="media/v.mp4"), notesources.POSTS),
    (Source(key="entity:a", kind=notesources.ACCOUNT, noun="Account", address="https://x.com/a"), notesources.POSTS),
    (Source(key="entity:c", kind=notesources.IMAGERY, noun="Imagery", readings=(Reading("Esri World Imagery"),)),
     notesources.IMAGERY_GROUP),
    (Source(key="entity:p", kind=notesources.FILE, noun="Proof", arrival="made", path="media/p.png"), notesources.MADE),
    (Source(key="entity:f", kind=notesources.FILE, noun="Picture", derived=True, path="media/f.png"), notesources.MADE),
    (Source(key="path:media/s.png", kind=notesources.FILE, noun="Picture", path="media/s.png"), notesources.FILES),
])
def test_each_source_falls_in_one_group(source, group):
    assert notesources.group(source) == group
    assert group in notesources.GROUPS


# -- the wording ----------------------------------------------------------------------------


def test_a_page_is_its_outlet_its_own_title_its_day_and_its_copy():
    source = Source(key="entity:b", label="Houthis take Mocha port", kind=notesources.PAGE, noun="Web page",
                    address="https://www.aljazeera.com/news/a", archive=ARCHIVE, title="Houthis take Mocha port",
                    published="2026-09-10", collected="2026-11-20", type="bookmark")
    parts = notesources.card_entry(source)
    assert said(parts) == ("Al Jazeera, Houthis take Mocha port, 10 September 2026, accessed 20 November 2026. "
                           "Archived copy")
    title = next(part for part in parts if part.kind == "title")
    assert title.link == "https://www.aljazeera.com/news/a"
    assert next(part for part in parts if part.kind == "archive").link == ARCHIVE
    assert notesources.card_label(source) == "Article"


def test_a_page_with_no_title_of_its_own_never_quotes_the_link_s_words():
    source = page("https://www.aljazeera.com/news/a", label="AFP via Mereja, 10 Oct", words=("AFP via Mereja, 10 Oct",))
    parts = notesources.card_entry(source)
    assert said(parts) == "Al Jazeera, page."
    assert parts[-2] == Part("page", "link", "https://www.aljazeera.com/news/a")
    assert notesources.card_label(source) == "Page"
    # a bookmark the note's links filed is named by the link's words: no title either
    filed = Source(key="entity:b", label="his post, 9 Oct", kind=notesources.PAGE, address="https://e.org/a",
                   type="bookmark")
    assert said(notesources.card_entry(filed)) == "e.org, page."


def test_a_written_link_to_a_post_is_its_account_its_platform_and_its_moment():
    parts = notesources.card_entry(page(POST, label="his post, 9 Oct"))
    assert said(parts) == "@mohdsalj on X, post, 9 October 2026, 10:44 UTC."
    assert notesources.card_label(page(POST)) == "Post on X"


def test_a_downloaded_video_is_who_posted_it_its_name_and_its_days():
    video = Source(key="entity:v", label="Strike on the port", kind=notesources.POST, noun="Video",
                   address="https://x.com/portwatch/status/1899200000000000001", author="Port Watch",
                   published="2026-03-12", collected="2026-03-13", sha256="a" * 64, path="media/v.mp4")
    assert said(notesources.card_entry(video)) == (
        "Port Watch (@portwatch) on X, Strike on the port, 12 March 2026, collected 13 March 2026.")
    assert notesources.card_label(video) == "Video on X"
    assert notesources.short_name(video) == "Port Watch (@portwatch) on X (video)"
    # a file's name or a stock name is no title: the entry says what it is
    named = Source(key="entity:w", label="2108508784049926499.mp4", kind=notesources.POST, noun="Video", address=POST)
    assert said(notesources.card_entry(named)) == "@mohdsalj on X, video, 9 October 2026, 10:44 UTC."


def test_what_was_made_names_what_it_was_made_from_each_linked_to_its_entry():
    video = Source(key="entity:v", kind=notesources.POST, noun="Video", address=POST, path="media/v.mp4")
    imagery = Source(key="entity:c", kind=notesources.IMAGERY, readings=(Reading("Esri World Imagery", "2024-03-02"),))
    proof = Source(key="entity:p", label="Strike geolocated", kind=notesources.FILE, noun="Proof", arrival="made",
                   collected="2026-03-15", path="media/p.png")
    parts = notesources.card_entry(proof, [(3, video), (4, imagery)])
    assert said(parts) == ("Strike geolocated, proof, made from @mohdsalj on X (video) and Esri World Imagery, "
                           "made 15 March 2026.")
    assert [(part.text, part.number) for part in parts if part.kind == "ref"] == [
        ("@mohdsalj on X (video)", 3), ("Esri World Imagery", 4)]
    assert notesources.card_label(proof) == "Proof"


def test_imagery_says_whose_and_of_which_day():
    capture = Source(key="entity:c", label="Port from above", kind=notesources.IMAGERY, noun="Imagery",
                     readings=(Reading("Esri World Imagery", "2024-03-02~"),), attribution="Esri, Maxar",
                     collected="2026-03-14", arrival="captured", path="media/c.png")
    assert said(notesources.card_entry(capture)) == (
        "Port from above, Esri World Imagery, about 2 March 2024 · Esri, Maxar, captured 14 March 2026.")
    assert notesources.card_label(capture) == "Imagery"


def test_a_report_is_its_outlet_and_its_title_or_the_word_report():
    pdf = page("https://ims.example/reports/14.pdf")
    assert said(notesources.card_entry(pdf)) == "ims.example, report."
    assert notesources.card_label(pdf) == "Report"


def test_an_unknown_part_is_left_out_never_made_up():
    bare = Source(key="path:media/s.png", label="", kind=notesources.FILE, noun="Picture", path="media/s.png")
    text = said(notesources.card_entry(bare))
    assert text == "Picture." and "n.d." not in text


def test_a_bookmark_named_by_the_words_citing_its_site_has_no_title(client):
    from azimut.workspace import Case
    from test_notes_report import make_case

    case = Case.open(make_case(client, "Marks"))
    url = "https://www.thenationalnews.com/news/mena/2026/10/05/strait"
    case.add_entity("bookmark", "The National, 5 Oct", {"url": url}, by="extension")
    page_url = "https://port.example.org/notice"
    case.add_entity("bookmark", "Port authority notice", {"url": page_url}, by="extension")
    reader = notesources.Reader(case)
    assert reader.link(url, "The National, 5 Oct").title == ""
    assert said(notesources.card_entry(reader.link(url, "The National, 5 Oct"))).startswith("The National, page, accessed ")
    assert reader.link(page_url, "the notice").title == "Port authority notice"
