"""A post from X or Bluesky in a note (`engine/socialposts.py`, `api/socialposts.py`,
`engine/notes_posts.py`): read once on the analyst's press, kept in the case, and drawn by
every document from what the case keeps, never by the site's own widget.

X and Bluesky are stood in for (`fakeposts.py`): every request is mocked, and the tests
that open, describe and export say that nothing went out. Accounts are made up.
"""

from __future__ import annotations

import io
import json
import re
from pathlib import Path

import pytest
from fakeposts import BLUESKY_URL, X_TEXT_URL, X_URL, Sites, bluesky_thread, x_listing
from jobwait import job_result
from pypdf import PdfReader

from azimut import config, layout
from azimut.api.cases import get_case
from azimut.engine import notes_html, notes_pdf, notes_wordpress, notefill, socialposts, uses
from azimut.engine.notelook import NoteLook


@pytest.fixture()
def sites(monkeypatch):
    return Sites().install(monkeypatch)


def _case(client) -> str:
    return client.post("/api/cases", json={"name": "Coast road"}).json()["id"]


def _read(client, case_id: str, *links: str) -> list[dict]:
    job = client.post(f"/api/cases/{case_id}/social-posts/fetch", json={"links": list(links)})
    assert job.status_code == 200, job.text
    return job_result(client, job.json()["job_id"])["results"]


def _describe(client, case_id: str, text: str) -> dict:
    answer = client.post(f"/api/cases/{case_id}/social-posts/describe", json={"text": text})
    assert answer.status_code == 200, answer.text
    return answer.json()


def _note(client, case_id: str, content: str) -> str:
    made = client.post(f"/api/cases/{case_id}/notes", json={"title": "Coast road", "content": content})
    assert made.status_code == 200, made.text
    return made.json()["id"]


# -- addresses ------------------------------------------------------------------------


@pytest.mark.parametrize(("pasted", "key", "url"), [
    ("https://x.com/coast_monitor/status/12", "x:12", "https://x.com/coast_monitor/status/12"),
    ("https://twitter.com/coast_monitor/status/12?s=20&t=abc", "x:12", "https://x.com/coast_monitor/status/12"),
    ("https://mobile.twitter.com/coast_monitor/status/12/photo/1", "x:12", "https://x.com/coast_monitor/status/12"),
    ("vxtwitter.com/coast_monitor/status/12", "x:12", "https://x.com/coast_monitor/status/12"),
    ("https://fxtwitter.com/coast_monitor/status/12", "x:12", "https://x.com/coast_monitor/status/12"),
    ("https://fixupx.com/coast_monitor/status/12", "x:12", "https://x.com/coast_monitor/status/12"),
    ("https://x.com/i/web/status/12", "x:12", "https://x.com/i/status/12"),
    ("https://bsky.app/profile/redseadesk.bsky.social/post/3m7k", "bluesky:redseadesk.bsky.social/3m7k",
     "https://bsky.app/profile/redseadesk.bsky.social/post/3m7k"),
])
def test_a_post_is_known_by_its_address_on_x_its_mirrors_and_bluesky(pasted, key, url):
    link = socialposts.parse_link(pasted)
    assert link is not None and link.key == key and link.url == url


@pytest.mark.parametrize("pasted", [
    "https://x.com/coast_monitor", "https://example.org/coast_monitor/status/12", "file:///etc/passwd",
    "https://bsky.app/profile/redseadesk.bsky.social", "javascript:alert(1)", "",
])
def test_anything_else_is_not_a_post(pasted):
    assert socialposts.parse_link(pasted) is None


# -- reading on the press -------------------------------------------------------------


def test_a_bluesky_post_is_read_with_no_account_and_kept_in_the_case(client, sites):
    case_id = _case(client)
    [answer] = _read(client, case_id, BLUESKY_URL)
    assert answer["id"] and answer["link"] == BLUESKY_URL
    asked = [request.url for request in sites.requests]
    assert asked[0].host == "public.api.bsky.app" and asked[0].path == "/xrpc/app.bsky.feed.getPostThread"
    assert asked[0].params["uri"] == "at://redseadesk.bsky.social/app.bsky.feed.post/3m7kfakepost"
    assert not sites.runs, "Bluesky is read without gallery-dl"

    case = get_case(case_id)
    entity = case.get_entity(answer["id"])
    assert entity["type"] == "social-post" and entity["attrs"]["url"] == BLUESKY_URL
    spec = json.loads(case.resolve_inside(entity["attrs"]["spec"]).read_text(encoding="utf-8"))
    assert spec["name"] == "Red Sea Desk" and spec["handle"] == "redseadesk.bsky.social"
    assert spec["posted_at"] == "2026-11-16T09:40:00Z" and spec["text"].startswith("Satellite pass")
    # the profile picture is the post's own, kept beside its record, a JPEG without metadata
    assert spec["avatar"] == f"{layout.social_post_files_rel(Path(entity['attrs']['spec']).stem)}/avatar.jpg"
    assert case.resolve_inside(spec["avatar"]).read_bytes()[:3] == b"\xff\xd8\xff"
    # its picture is media of the case, filed as a download from the post is
    [picture] = spec["pictures"]
    item = case.media_items_by_paths([picture["media"]])[0]
    assert item["source"]["url"] == BLUESKY_URL and item["source"]["uploader"] == "Red Sea Desk"
    assert picture["alt"] == "Checkpoint 1"


def test_a_post_kept_already_is_not_read_again(client, sites):
    case_id = _case(client)
    [first] = _read(client, case_id, BLUESKY_URL)
    went = sites.outside
    [again] = _read(client, case_id, BLUESKY_URL.replace("https://", "https://www."))
    assert again["id"] == first["id"]
    assert sites.outside == went


def test_an_x_post_is_read_through_gallery_dl_with_its_pictures_and_video(client, sites):
    sites.x = x_listing(video=True)
    case_id = _case(client)
    [answer] = _read(client, case_id, X_URL.replace("x.com", "fxtwitter.com"))
    [run] = sites.runs
    assert run[-1] == X_URL and "extractor.twitter.text-tweets=true" in run
    assert not any("extractor.cookies" in one for one in run), "public posts never touch the session"
    case = get_case(case_id)
    spec = socialposts.read_spec(case, case.get_entity(answer["id"]))
    assert spec["url"] == X_URL and spec["name"] == "Coast Monitor" and spec["lang"] == "ar"
    assert [one["kind"] for one in spec["pictures"]] == ["image", "video"]
    assert spec["pictures"][1]["duration"] == 42.0
    for one in spec["pictures"]:
        assert case.resolve_inside(one["media"]).is_file()
    hosts = {request.url.host for request in sites.requests}
    assert hosts == {"pbs.twimg.com", "video.twimg.com"}


def test_a_text_only_x_post_is_a_post(client, sites):
    sites.x = x_listing("All units have left the coastal sector.", media=False, tweet="1990000000000000002")
    case_id = _case(client)
    [answer] = _read(client, case_id, X_TEXT_URL)
    drawn = _describe(client, case_id, f"post: {answer['id']}")
    [post] = drawn["posts"]
    assert post["text"] == "All units have left the coastal sector." and post["pictures"] == []
    assert post["when"] == "15 Nov 2026 · 05:12 UTC" and post["site_label"] == "X"


def test_an_x_wall_asks_for_a_session_and_says_so(client, sites):
    sites.x_wall = True
    case_id = _case(client)
    [answer] = _read(client, case_id, X_URL)
    assert answer["needs_auth"] is True and answer["refused"] is False
    assert "signed-in session" in answer["error"]
    assert not get_case(case_id).page_entities(types=["social-post"])["items"]


def test_an_x_wall_is_tried_again_once_with_the_session_settings_hold(client, sites, tmp_path):
    cookies = tmp_path / "cookies.txt"
    cookies.write_text("# Netscape HTTP Cookie File\n", encoding="utf-8")
    config.save_settings({**config.load_settings(), "download_cookies": {"source": "file", "file": str(cookies)}})
    sites.x_wall, sites.x_wall_with_session = True, False
    case_id = _case(client)
    [answer] = _read(client, case_id, X_URL)
    assert answer.get("id"), answer
    assert [any("extractor.cookies" in one for one in run) for run in sites.runs] == [False, True]

    sites.runs.clear()
    sites.x_wall_with_session = True
    [refused] = _read(client, case_id, X_URL.replace("1990000000000000001", "1990000000000000009"))
    assert refused["needs_auth"] is True and refused["refused"] is True


def test_offline_a_read_fails_plainly_and_files_nothing(client, sites):
    sites.offline = True
    case_id = _case(client)
    [bluesky, x] = _read(client, case_id, BLUESKY_URL, X_URL)
    assert bluesky["error"] == "Bluesky could not be reached: no connection"
    assert x["error"].startswith("X did not show the post")
    assert "needs_auth" not in bluesky and "needs_auth" not in x
    case = get_case(case_id)
    assert not case.page_entities(types=["social-post"])["items"]
    assert not list((case.tool_root / layout.SOCIAL_POSTS_DIR).glob("*.json"))


def test_a_link_that_is_no_post_is_refused_before_anything_goes_out(client, sites):
    case_id = _case(client)
    [answer] = _read(client, case_id, "https://example.org/coast_monitor/status/12")
    assert answer["error"] == "This is not the address of a post on X or Bluesky"
    assert sites.outside == 0


def test_a_thread_is_read_in_order(client, sites):
    case_id = _case(client)
    answers = _read(client, case_id, X_URL, BLUESKY_URL)
    ids = [one["id"] for one in answers]
    drawn = _describe(client, case_id, "\n".join(f"post: {one}" for one in ids))
    assert [post["site"] for post in drawn["posts"]] == ["x", "bluesky"]
    assert drawn["span"] == "15 Nov 2026 · 05:12 UTC to 16 Nov 2026 · 09:40 UTC"


# -- what the case already holds, with no network -------------------------------------


def test_a_file_downloaded_from_a_post_is_offered_and_kept_with_no_network(client, sites):
    from azimut.engine import media as media_engine

    case_id = _case(client)
    case = get_case(case_id)
    picture = io.BytesIO()
    from PIL import Image

    Image.new("RGB", (40, 30), (10, 90, 160)).save(picture, "JPEG")
    filed = media_engine._register_downloaded_item(
        case, X_URL, "clip.jpg", picture.getvalue(), title="Coast road",
        source_extra={"title": "A column of vehicles", "description": "A column of vehicles heads south.",
                      "uploader": "Coast Monitor", "upload_date": "20261115"})
    offers = client.get(f"/api/cases/{case_id}/social-posts/offers").json()
    assert [row["url"] for row in offers["downloaded"]] == [X_URL]
    made = client.post(f"/api/cases/{case_id}/social-posts/from-case", json={"media": filed["item"]["path"]})
    assert made.status_code == 200, made.text
    [post] = _describe(client, case_id, f"post: {made.json()['id']}")["posts"]
    assert post["text"] == "A column of vehicles heads south." and post["name"] == "Coast Monitor"
    assert post["handle"] == "coast_monitor" and post["when"] == "15 Nov 2026"
    assert post["avatar"] == "" and post["initials"] == "CM"
    assert [one["media"] for one in post["pictures"]] == [filed["item"]["path"]]
    offers = client.get(f"/api/cases/{case_id}/social-posts/offers").json()
    assert offers["downloaded"] == [] and [row["id"] for row in offers["kept"]] == [made.json()["id"]]
    assert sites.outside == 0


def test_a_published_post_of_the_analyst_is_read_from_its_draft(client, sites):
    case_id = _case(client)
    saved = client.post(f"/api/cases/{case_id}/drafts", json={"title": "Coast road", "state": {
        "tweet1": "Geolocated: the column on the coast road, 4 km south of the town.",
        "publish": {"site": "x", "url": "https://x.com/analyst_desk/status/1990000000000000077",
                    "posted_at": "2026-11-15T09:00:00Z"},
    }})
    assert saved.status_code == 200, saved.text
    offers = client.get(f"/api/cases/{case_id}/social-posts/offers").json()
    assert [row["url"] for row in offers["mine"]] == ["https://x.com/analyst_desk/status/1990000000000000077"]
    [answer] = _read(client, case_id, "https://twitter.com/analyst_desk/status/1990000000000000077")
    [post] = _describe(client, case_id, f"post: {answer['id']}")["posts"]
    assert post["text"].startswith("Geolocated: the column") and post["when"] == "15 Nov 2026 · 09:00 UTC"
    assert sites.outside == 0


def test_keeping_from_the_case_names_only_its_own_media_and_drafts(client, sites):
    case_id = _case(client)
    route = f"/api/cases/{case_id}/social-posts/from-case"
    for asked in ({"media": "../case.json"}, {"media": "notes/a.md"}, {"draft": "../notes/a"}, {"draft": ".work"},
                  {"media": "media/a.jpg", "draft": "a"}, {}):
        assert client.post(route, json=asked).status_code == 422, asked
    assert sites.outside == 0


# -- the block --------------------------------------------------------------------------


def test_a_block_keeps_the_analysts_lines_for_each_post():
    block = socialposts.parse_block(
        "post: e_one\nhighlight: a column\nhighlight: south\ntranslation: Line one\\nline two\n"
        "link: https://x.com/a/status/2\npost: not/an/id\nform: compact\navatar: hidden\nqr: on\n")
    assert [(one.kind, one.value) for one in block.entries] == [("post", "e_one"), ("link", "https://x.com/a/status/2")]
    assert block.entries[0].highlights == ["a column", "south"]
    assert block.entries[0].translation == "Line one\nline two"
    assert (block.form, block.avatar, block.qr) == ("compact", False, True)


def test_each_paragraph_of_a_post_reads_in_its_own_direction():
    words = "غريرة، محافظة تعز - 7H45\n\nLoyalists post photos claiming to be on site.\n\n@source"
    assert [rtl for rtl, _ in socialposts.paragraphs(words, ["claiming"])] == [True, False, False]
    assert socialposts.paragraphs(words, ["claiming"])[1][1] == [
        ("Loyalists post photos ", False), ("claiming", True), (" to be on site.", False)]
    assert socialposts.is_rtl("2026 — رتل") and not socialposts.is_rtl("@source رتل")


def test_a_highlight_is_only_kept_where_the_words_hold_it(client, sites):
    case_id = _case(client)
    [answer] = _read(client, case_id, BLUESKY_URL)
    [post] = _describe(client, case_id, f"post: {answer['id']}\nhighlight: no vehicles left\nhighlight: not in the post")["posts"]
    assert post["highlights"] == ["no vehicles left"]
    assert socialposts.marked("one two three", ["two", "two three"]) == [("one ", False), ("two three", True)]


def test_a_post_gone_from_the_case_and_a_link_not_read_are_said(client, sites):
    case_id = _case(client)
    drawn = _describe(client, case_id, "post: e_gone\nlink: https://x.com/a/status/2")
    assert drawn["posts"] == [] and drawn["missing"] == ["e_gone", "https://x.com/a/status/2"]
    assert sites.outside == 0


# -- uses, Trash and the delete preview -------------------------------------------------


def test_a_note_leans_on_its_post_and_the_post_on_its_pictures(client, sites):
    case_id = _case(client)
    [answer] = _read(client, case_id, BLUESKY_URL)
    case = get_case(case_id)
    spec = socialposts.read_spec(case, case.get_entity(answer["id"]))
    picture = spec["pictures"][0]["media"]
    _note(client, case_id, f"Before.\n\n::: post\npost: {answer['id']}\n:::\n")
    used = uses.used_refs(case)
    assert answer["id"] in used and picture in used
    impact = client.post(f"/api/cases/{case_id}/delete-impact", json={"ids": [answer["id"]]}).json()
    assert uses.POST_HOW in json.dumps(impact)
    picture_entity = case.find_entity(attr="path", value=picture)
    impact = client.post(f"/api/cases/{case_id}/delete-impact", json={"ids": [picture_entity["id"]]}).json()
    assert "shows it in a post" in json.dumps(impact)


def test_a_post_goes_to_the_trash_with_its_profile_picture_and_comes_back(client, sites):
    case_id = _case(client)
    [answer] = _read(client, case_id, BLUESKY_URL)
    case = get_case(case_id)
    spec_rel = case.get_entity(answer["id"])["attrs"]["spec"]
    avatar = case.resolve_inside(socialposts.read_spec(case, case.get_entity(answer["id"]))["avatar"])
    deleted = client.delete(f"/api/cases/{case_id}/entities/{answer['id']}")
    assert deleted.status_code == 200, deleted.text
    assert not case.resolve_inside(spec_rel).exists() and not avatar.exists()
    group = deleted.json()["trash"]
    restored = client.post(f"/api/cases/{case_id}/trash/{group}/restore")
    assert restored.status_code == 200, restored.text
    assert case.resolve_inside(spec_rel).is_file() and avatar.is_file()


# -- what each document draws -----------------------------------------------------------


@pytest.fixture()
def kept(client, sites):
    """An Arabic post from X with two pictures, a Bluesky post, and a proof published at the X post."""
    sites.x = x_listing(video=True)
    case_id = _case(client)
    x_post, bluesky = (one["id"] for one in _read(client, case_id, X_URL, BLUESKY_URL))
    case = get_case(case_id)
    proof = case.add_entity("proof", "Proof 12", attrs={"posted_url": "https://x.com/analyst_desk/status/55"}, by="test")
    spec = socialposts.read_spec(case, case.get_entity(x_post))
    source = case.find_entity(attr="path", value=spec["pictures"][0]["media"])
    case.add_link(proof["id"], source["id"], "derived-from", by="test")
    sites.requests.clear()
    sites.runs.clear()
    return {"case": case, "x": x_post, "bluesky": bluesky, "proof": proof, "sites": sites}


def _html(case, text: str, **look) -> str:
    return notes_html.render(case, title="Coast road", text=text, look=NoteLook(**look)).html.decode("utf-8")


def test_the_html_page_draws_the_card_in_its_own_look(kept):
    text = (f"The first sign.\n\n::: post\npost: {kept['x']}\nhighlight: رتل من المركبات\n"
            "translation: A column of vehicles heads south.\nqr: on\n:::\n")
    page = _html(kept["case"], text, style="report")
    card = re.search(r'<figure class="az-figure az-post".*?</figure>', page, re.S).group(0)
    assert 'data-form="card"' in card
    assert '<div class="az-post-text" dir="rtl" lang="ar"><p dir="rtl"><mark>رتل من المركبات</mark>' in card
    assert '<small>Translation</small>A column of vehicles heads south.' in card
    assert 'Coast Monitor' in card and '@coast_monitor' in card
    assert '<time datetime="2026-11-15T05:12:00Z">15 Nov 2026 · 05:12 UTC</time> · captured on ' in card
    assert 'href="https://x.com/coast_monitor/status/1990000000000000001"' in card
    assert 'Geolocated · Proof 12' in card and 'href="https://x.com/analyst_desk/status/55"' in card
    # every picture is inside the page, the profile picture too: nothing loads from the site;
    # a video with no still yet is a dark tile with its length, linked to the post
    assert card.count('src="data:image/') == 2
    assert 'class="az-post-shot az-post-blank"' in card
    assert "twimg.com" not in page and "bsky.app/img" not in page and "<iframe" not in card
    assert 'class="az-post-dur">0:42<' in card
    # no counter: frozen at the read, it says nothing
    assert ">900<" not in card and " 900 " not in card and "favorite" not in card
    assert "/* a post from X or Bluesky" in page
    assert kept["sites"].outside == 0
    # the post is a source the page cites, listed with the others
    assert re.search(r'class="az-cite" href="#src-1"', card)
    assert "coast_monitor" in page[page.index('id="sources"'):]


def test_a_page_without_a_post_does_not_carry_its_style(kept):
    assert "/* a post from X or Bluesky" not in _html(kept["case"], "Words only.\n")


def test_the_profile_picture_can_be_hidden_for_initials_on_the_accounts_colours(kept):
    page = _html(kept["case"], f"::: post\npost: {kept['bluesky']}\navatar: hidden\n:::\n")
    card = re.search(r'<figure class="az-figure az-post".*?</figure>', page, re.S).group(0)
    assert 'class="az-post-avatar az-post-initials"' in card and ">RS</span>" in card
    first, second = socialposts.tint("redseadesk.bsky.social")
    assert f"--az-a:{first};--az-b:{second}" in card
    assert card.count('src="data:image/') == 1


def test_the_quote_and_compact_forms_and_a_thread(kept):
    quote = _html(kept["case"], f"::: post\npost: {kept['bluesky']}\nhighlight: no vehicles left\nform: quote\n:::\n")
    assert '<blockquote class="az-post-quote"' in quote and "“no vehicles left”" in quote
    assert "Red Sea Desk</b> on Bluesky · 16 Nov 2026" in quote
    compact = _html(kept["case"], f"::: post\npost: {kept['x']}\npost: {kept['bluesky']}\nform: compact\n:::\n")
    assert compact.count('class="az-post-line"') == 2
    thread = _html(kept["case"], f"::: post\npost: {kept['x']}\npost: {kept['bluesky']}\n:::\n")
    assert 'class="az-post-card az-post-thread"' in thread
    assert '<span class="az-post-num">1/2</span>' in thread and '<span class="az-post-num">2/2</span>' in thread
    assert "15 Nov 2026 · 05:12 UTC to 16 Nov 2026 · 09:40 UTC" in thread


def test_a_story_draws_the_card_on_its_dark_band(kept):
    page = _html(kept["case"], f"::: post\npost: {kept['bluesky']}\n:::\n", web="story")
    assert '[data-web="story"] .az-body > .az-post' in page and "#0f1012" in page
    assert 'data-web="story"' in page


def test_the_pdf_draws_the_card_with_its_link_and_a_qr_code(kept):
    text = (f"The first sign.\n\n::: post\npost: {kept['x']}\nhighlight: رتل من المركبات\n"
            "translation: A column of vehicles heads south.\nqr: on\n:::\n\n"
            f"::: post\npost: {kept['bluesky']}\nform: quote\navatar: hidden\n:::\n\n"
            f"::: post\npost: {kept['x']}\npost: {kept['bluesky']}\nform: compact\n:::\n")
    rendered = notes_pdf.render(kept["case"], title="Coast road", text=text, look=NoteLook())
    assert not [one for one in rendered.warnings if "post" in one.lower()]
    reader = PdfReader(io.BytesIO(rendered.pdf))
    words = " ".join(page.extract_text() for page in reader.pages)
    assert "TRANSLATION" in re.sub(r"\s", "", words), "the label is spaced out, as the page sets it"
    for said in ("Coast Monitor", "@coast_monitor", "A column of vehicles heads south.",
                 "Geolocated · Proof 12", "View on X", "Red Sea Desk", "x.com/coast_monitor/…"):
        assert said in words, said
    links = [annotation.get_object().get("/A", {}).get("/URI") for page in reader.pages
             for annotation in page.get("/Annots") or []]
    assert X_URL in links and BLUESKY_URL in links
    assert links.count(X_URL) >= 3, "the name, View on X and the QR code each lead to the post"
    assert kept["sites"].outside == 0
    # every stretch of words names its face in the page's stream, a script's fallback face too
    for page in reader.pages:
        assert _shown_without_a_face(page, reader) == 0


def _shown_without_a_face(page, reader) -> int:
    """How many stretches of text a page shows with no face set in its state (`Tf`)."""
    from pypdf.generic import ContentStream

    stack: list = []
    face = None
    missing = 0
    for _operands, operator in ContentStream(page.get_contents(), reader).operations:
        if operator == b"q":
            stack.append(face)
        elif operator == b"Q":
            face = stack.pop() if stack else None
        elif operator == b"Tf":
            face = _operands[0]
        elif operator in (b"Tj", b"TJ") and face is None:
            missing += 1
    return missing


def test_without_the_qr_option_the_pdf_draws_no_code(kept):
    with_code = notes_pdf.render(kept["case"], title="t", text=f"::: post\npost: {kept['bluesky']}\nqr: on\n:::\n",
                                 look=NoteLook()).pdf
    without = notes_pdf.render(kept["case"], title="t", text=f"::: post\npost: {kept['bluesky']}\n:::\n", look=NoteLook()).pdf
    assert "bsky.app/redseadesk.bsky.social/…" in PdfReader(io.BytesIO(with_code)).pages[0].extract_text()
    assert "bsky.app/redseadesk.bsky.social/…" not in PdfReader(io.BytesIO(without)).pages[0].extract_text()


def test_wordpress_gets_a_static_card_with_its_pictures_uploaded(kept):
    text = f"::: post\npost: {kept['x']}\nhighlight: رتل من المركبات\ntranslation: A column of vehicles.\n:::\n"
    draft = notes_wordpress.build(kept["case"], title="Coast road", text=text, look=NoteLook(),
                                  identity=notefill.Identity())
    content = draft.content
    assert '<!-- wp:group {"className":"azimut-post"} -->' in content
    assert "<strong>Coast Monitor</strong> @coast_monitor · X" in content
    assert '<mark style="background-color:#f8f1e8" class="has-inline-color">رتل من المركبات</mark>' in content
    assert "<em>Translation:</em> A column of vehicles." in content
    assert 'href="https://x.com/coast_monitor/status/1990000000000000001"' in content
    assert "Geolocated · Proof 12" in content
    # the profile picture and the post's pictures go up as the note's others do
    assert len(draft.uploads) >= 2 and all(upload.data[:2] in (b"\xff\xd8", b"\x89P") for upload in draft.uploads)
    hidden = notes_wordpress.build(kept["case"], title="t", text=f"::: post\npost: {kept['x']}\navatar: hidden\n:::\n",
                                   look=NoteLook(), identity=notefill.Identity())
    assert len(hidden.uploads) == len(draft.uploads) - 1
    assert kept["sites"].outside == 0


def test_a_post_handed_to_post_is_its_link(client, kept):
    text = f"Seen.\n\n::: post\npost: {kept['bluesky']}\n:::\n"
    note_id = _note(client, kept["case"].id, text)
    pieces = client.post(f"/api/cases/{kept['case'].id}/notes/{note_id}/pieces", json={"text": text}).json()
    assert {"kind": "source", "url": BLUESKY_URL, "label": "@redseadesk.bsky.social"} in pieces["pieces"]


def test_nothing_goes_out_when_a_note_holding_posts_is_opened_and_exported(client, kept):
    case_id = kept["case"].id
    note_id = _note(client, case_id, f"::: post\npost: {kept['x']}\n:::\n\n::: post\nlink: {BLUESKY_URL}\n:::\n")
    assert client.get(f"/api/cases/{case_id}/notes/{note_id}").status_code == 200
    _describe(client, case_id, f"post: {kept['x']}\nlink: {BLUESKY_URL}")
    client.get(f"/api/cases/{case_id}/social-posts/offers")
    preview = client.post(f"/api/cases/{case_id}/notes/html/preview",
                          json={"note": note_id, "text": f"::: post\npost: {kept['x']}\n:::\n", "title": "t"})
    assert preview.status_code == 200, preview.text
    assert kept["sites"].outside == 0


def test_a_bluesky_reply_with_no_picture_and_a_quoted_post_with_one(client, sites):
    sites.bluesky = bluesky_thread("A reply, words only.", pictures=0)
    case_id = _case(client)
    [answer] = _read(client, case_id, BLUESKY_URL)
    [post] = _describe(client, case_id, f"post: {answer['id']}")["posts"]
    assert post["text"] == "A reply, words only." and post["pictures"] == []


def test_a_web_folder_carries_the_card_its_pictures_as_files_beside_the_page(client, kept):
    from test_notes_pdf import exports_of

    case_id = kept["case"].id
    note_id = _note(client, case_id, f"Seen.\n\n::: post\npost: {kept['bluesky']}\n:::\n")
    written = client.post(f"/api/cases/{case_id}/notes/web", json={"notes": [note_id]})
    assert written.status_code == 200, written.text
    folder = exports_of(case_id) / "web" / written.json()["written"][0]["file"]
    page = (folder / "index.html").read_text(encoding="utf-8")
    card = re.search(r'<figure class="az-figure az-post".*?</figure>', page, re.S).group(0)
    shown = re.findall(r'src="([^"]+)"', card)
    assert len(shown) == 2 and not any(one.startswith("data:") for one in shown)
    assert all((folder / one).is_file() for one in shown)
    sheet = re.search(r'<link rel="stylesheet" id="az-reader" href="([^"]+)"', page).group(1)
    assert "/* a post from X or Bluesky" in (folder / sheet).read_text(encoding="utf-8")
    assert kept["sites"].outside == 0
