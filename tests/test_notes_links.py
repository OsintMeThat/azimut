"""A written link finds what the case holds at its address, cited elsewhere or not.

The item a link finds is read once per document from one index of the case
(`urltitles.AddressIndex`), whatever else the note cites. The print gains that item's
author, days and archived copy; a link the case holds nothing of prints as it always
did, which `test_notes_pdf_golden.py` holds to the drawing. The check before export
that counts the links nobody archived is `test_notes_link_check.py`.
"""

from __future__ import annotations

import pytest

from azimut.engine import notefill, notes_html, notes_pdf, notes_web, notes_wordpress, notesources, urltitles
from azimut.engine.notelook import NoteLook
from azimut.workspace import Case

from sourcesfixture import ARCHIVE_URL, MAPS_URL, NOTICE_URL, POST_URL, sourced_case
from test_notes_pdf import FakeCase, pdf_text
from test_notes_report import make_case, make_note

REPORT = NoteLook.model_validate({"style": "report"})
#: A page the case holds nothing of.
ELSEWHERE = "https://www.aljazeera.com/news/2026/9/10/houthis-take-mocha"


def squash(text: str) -> str:
    return "".join(text.split())


@pytest.fixture()
def sourced(client):
    cid = make_case(client, "Links")
    case = Case.open(cid)
    return cid, case, sourced_case(case)


def _imported_proof(case, published):
    return case.add_entity("proof", "Imported", attrs={"path": "proofs/Imported.png", "kind": "image",
                                                       "published_url": published}, by="proof-import")


# -- what a link finds -------------------------------------------------------------------


def test_a_link_to_a_downloaded_post_is_that_file_with_its_author_and_days(sourced):
    _, case, made = sourced
    found = notesources.Reader(case).link(POST_URL.replace("x.com", "twitter.com") + "?s=20", "the post")
    assert found.key == f"entity:{made['video']['id']}"
    assert (found.author, found.published, found.collected) == ("Port Watch", "2026-03-12", "2026-03-13")
    assert found.address == POST_URL and found.sha256 == made["video"]["sha256"]


def test_a_link_to_a_bookmarked_page_brings_its_archived_copy_and_the_day_it_was_seen(sourced):
    _, case, made = sourced
    found = notesources.Reader(case).link(f"http://www.{NOTICE_URL[8:]}/#:~:text=berths", "the notice")
    assert found.key == f"entity:{made['notice']['id']}"
    assert (found.archive, found.archived, found.collected) == (ARCHIVE_URL, "2026-03-13", "2026-03-13")


def test_a_link_to_a_captured_map_view_is_the_capture(sourced):
    _, case, made = sourced
    found = notesources.Reader(case).link(MAPS_URL, "the berths")
    assert found.key == f"entity:{made['screenshot']['id']}" and found.kind == notesources.IMAGERY


def test_a_link_to_the_post_a_proof_was_imported_from_stays_that_page_seen_that_day(sourced):
    _, case, _ = sourced
    post = "https://x.com/someone/status/42"
    proof = _imported_proof(case, post)
    found = notesources.Reader(case).link(post, "their post")
    assert found.key == f"url:{post}" and found.label == "their post"
    assert found.collected == proof["provenance"]["at"][:10] and not found.entity_id


def test_a_link_the_case_holds_nothing_of_is_a_bare_page(sourced):
    _, case, _ = sourced
    found = notesources.Reader(case).link(ELSEWHERE, "Al Jazeera, 10 Sep")
    assert found == notesources.Source(key=f"url:{ELSEWHERE}", label="Al Jazeera, 10 Sep", kind="page",
                                       noun="Web page", address=ELSEWHERE)


def test_a_page_two_items_hold_is_the_first_by_kind_then_by_day(sourced):
    _, case, made = sourced
    # a bookmark filed for the post the video was downloaded from: the file still answers
    case.add_entity("bookmark", "The post", attrs={"url": POST_URL}, by="extension")
    assert notesources.Reader(case).link(POST_URL).key == f"entity:{made['video']['id']}"
    later = case.add_entity("bookmark", "Same notice, later", attrs={"url": NOTICE_URL}, by="extension")
    assert notesources.Reader(case).link(NOTICE_URL).key == f"entity:{made['notice']['id']}" != later["id"]


def test_the_case_is_read_once_per_document_however_many_links(sourced, monkeypatch):
    _, case, made = sourced
    pages: list[list[str]] = []
    real = case.page_entities

    def counted(**kwargs):
        pages.append(list(kwargs.get("types") or []))
        return real(**kwargs)

    monkeypatch.setattr(case, "page_entities", counted)
    text = "\n\n".join(f"[link {n}]({POST_URL}?n={n}) and [other {n}](https://example.org/{n})" for n in range(40))
    notes_pdf.render(case, title="T", text=text, look=REPORT)
    assert pages.count(list(urltitles.INDEXED)) == 1


def test_a_template_and_a_case_that_cannot_list_its_items_find_nothing(tmp_path):
    for owner in (None, FakeCase(tmp_path, {})):
        reader = notesources.Reader(owner)
        assert reader.link(POST_URL).key == f"url:{POST_URL}" and reader.held(POST_URL) is None


# -- what the print says --------------------------------------------------------------


def test_the_pdf_lists_what_the_case_knows_of_a_link_it_never_cited_otherwise(sourced):
    _, case, made = sourced
    text = f"Port Watch [posted it]({POST_URL}) and the port [closed the berths]({NOTICE_URL}).\n"
    printed = pdf_text(notes_pdf.render(case, title="T", text=text, look=REPORT).pdf)
    body, annex = printed.split("\nSources\n")
    assert "posted it[1]" in body and "closed the berths[2]" in body
    flat = squash(annex)
    assert squash("[1] Strike on the port · Video · x.com · by Port Watch · posted 12 March 2026 · collected 13 March 2026") in flat
    assert squash("[2] Port authority notice · Web page · port-authority.example.org · collected 13 March 2026") in flat
    assert squash(f"Archive: {ARCHIVE_URL}") in flat and "SHA-256" in annex


def test_the_html_page_lists_the_same(sourced):
    _, case, _ = sourced
    text = f"Port Watch [posted it]({POST_URL}) and [the notice]({NOTICE_URL}).\n"
    page = notes_html.render(case, title="T", text=text, look=REPORT).html.decode()
    sources = page[page.index('<section class="az-sources"'):]
    assert "by Port Watch · posted 12 March 2026 · collected 13 March 2026" in sources
    assert f'href="{ARCHIVE_URL}"' in sources and "Strike on the port" in sources


def test_the_web_folder_and_the_wordpress_draft_list_the_same(client, sourced):
    cid, case, _ = sourced
    text = f"Port Watch [posted it]({POST_URL}).\n"
    note = make_note(client, cid, title="Front", content=text)
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "report"})
    folder = notes_web.build(case, note["id"], base_url="https://me.github.io/front/", check=True)
    page = folder.files[folder.index].decode()
    assert "by Port Watch · posted 12 March 2026 · collected 13 March 2026" in page[page.index('class="az-sources"'):]
    draft = notes_wordpress.build(case, title="Front", text=text, look=REPORT, identity=notefill.Identity())
    assert "by Port Watch · posted 12 March 2026 · collected 13 March 2026" in draft.content


def test_a_link_to_an_item_the_note_also_shows_is_one_entry(sourced):
    _, case, made = sourced
    text = f"[[media:{made['video']['id']}|The video]]\n\nSee [the post]({POST_URL}).\n"
    annex = pdf_text(notes_pdf.render(case, title="T", text=text, look=REPORT).pdf).split("\nSources\n")[1]
    assert squash(annex).count("Strikeontheport") == 1 and "[2]" not in annex


# -- the lookup the citation card reads --------------------------------------------------


def test_the_lookup_says_what_the_case_knows_of_a_page(client, sourced):
    cid, _, made = sourced
    known = client.get(f"/api/cases/{cid}/sources/lookup", params={"url": f"{NOTICE_URL}#top"}).json()["known"]
    assert known == {
        "id": made["notice"]["id"], "type": "bookmark", "label": "Port authority notice", "noun": "Web page",
        "address": NOTICE_URL, "author": "", "published": "", "archive": ARCHIVE_URL, "archived_at": "2026-03-13",
        "seen": "2026-03-13", "arrival": "collected", "sha256": "", "thumb": "",
    }
    post = client.get(f"/api/cases/{cid}/sources/lookup", params={"url": POST_URL}).json()["known"]
    assert (post["type"], post["author"], post["published"], post["seen"]) == ("media", "Port Watch", "2026-03-12", "2026-03-13")
    assert post["sha256"] == made["video"]["sha256"]
    assert client.get(f"/api/cases/{cid}/sources/lookup", params={"url": ELSEWHERE}).json()["known"] is None


def test_the_lookup_says_the_entry_a_link_prints_as_named_by_its_words(client, sourced):
    cid, _, made = sourced
    bare = client.get(f"/api/cases/{cid}/sources/lookup", params={"url": ELSEWHERE, "words": "Al Jazeera, 10 Sep"}).json()
    assert bare["reference"] == f"Al Jazeera, 10 Sep · Web page · aljazeera.com. {ELSEWHERE}"
    held = client.get(f"/api/cases/{cid}/sources/lookup", params={"url": NOTICE_URL, "words": "the notice"}).json()
    # the item the case holds at the page is the entry, whatever the link's words
    assert held["reference"] == (f"Port authority notice · Web page · port-authority.example.org · collected 13 March 2026. "
                                 f"{NOTICE_URL} Archive: {ARCHIVE_URL}")


# -- the item a chip cites, for the citation card ----------------------------------------


def test_the_card_reads_a_cited_file_with_its_author_days_and_fingerprint(client, sourced):
    cid, _, made = sourced
    said = client.get(f"/api/cases/{cid}/sources/item", params={"id": made["video"]["id"]}).json()
    known = said["known"]
    assert (known["id"], known["type"], known["noun"], known["address"]) == (made["video"]["id"], "media", "Video", POST_URL)
    assert (known["author"], known["published"], known["seen"], known["arrival"]) == ("Port Watch", "2026-03-12", "2026-03-13", "collected")
    assert known["sha256"] == made["video"]["sha256"] and known["archive"] == ""
    assert said["reference"] == (f"Strike on the port · Video · x.com · by Port Watch · posted 12 March 2026 · "
                                 f"collected 13 March 2026. {POST_URL} SHA-256 {made['video']['sha256']}")


def test_the_card_says_what_a_proof_was_made_from_its_own_picture(client, sourced):
    cid, case, made = sourced
    case.update_entity(made["proof"]["id"], {"attrs": {"thumb": "media/.thumbs/strike-g1.jpg"}})
    known = client.get(f"/api/cases/{cid}/sources/item", params={"id": made["proof"]["id"]}).json()["known"]
    assert (known["noun"], known["arrival"], known["thumb"]) == ("Proof", "made", "media/.thumbs/strike-g1.jpg")


def test_the_card_copies_no_entry_for_what_the_list_leaves_out_and_says_a_gone_item_is_gone(client, sourced):
    cid, _, made = sourced
    place = client.get(f"/api/cases/{cid}/sources/item", params={"id": made["place"]["id"]}).json()
    assert place["known"]["label"] == "Berth 12" and place["reference"] == ""
    assert client.get(f"/api/cases/{cid}/sources/item", params={"id": "e_gone"}).json() == {"known": None, "reference": ""}
    assert client.get(f"/api/cases/{cid}/sources/item", params={"id": "../case.json"}).status_code == 422


def test_the_card_reaches_nothing_outside_the_case(client, sourced, monkeypatch):
    cid, _, made = sourced
    import socket

    def refused(*_args, **_kwargs):
        raise AssertionError("the citation card reached the network")

    monkeypatch.setattr(socket, "create_connection", refused)
    monkeypatch.setattr(socket.socket, "connect", refused)
    for item in ("video", "notice", "proof", "place"):
        assert client.get(f"/api/cases/{cid}/sources/item", params={"id": made[item]["id"]}).status_code == 200
    for url in (ELSEWHERE, NOTICE_URL, POST_URL):
        assert client.get(f"/api/cases/{cid}/sources/lookup", params={"url": url, "words": "w"}).status_code == 200
