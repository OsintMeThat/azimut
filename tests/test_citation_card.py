"""The citation card copies a reference as the note's list of sources writes it, and says
who posted an item, as the academic list leads with it.

The style is the note's (`notelook.effective(...).profile().sources_style`): Academic for a
report, Web for a web article, Short for the rest and for no note at all. The entry is
`notesources.reference`, the renderers' own words. Who posted is the author the case
records, else the account the address names (`notesources.handle_of`). The card's other
readings are `test_notes_links.py`'s.
"""

from __future__ import annotations

import pytest

from azimut.workspace import Case

from sourcesfixture import ARCHIVE_URL, NOTICE_URL, POST_URL, sourced_case
from notecase import make_case, make_note

#: A page the case holds nothing of.
ELSEWHERE = "https://www.aljazeera.com/news/2026/9/10/houthis-take-mocha"


@pytest.fixture()
def sourced(client):
    cid = make_case(client, "Card")
    case = Case.open(cid)
    return cid, case, sourced_case(case)


def _note_in(client, cid, style):
    note = make_note(client, cid, title=f"A {style}")
    assert client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": style}).status_code == 200
    return note["id"]


def test_a_report_copies_the_academic_entry_a_brief_the_short_one(client, sourced):
    cid, _, made = sourced
    sha = made["video"]["sha256"]
    item = f"/api/cases/{cid}/sources/item"
    report = client.get(item, params={"id": made["video"]["id"], "note": _note_in(client, cid, "report")}).json()["reference"]
    assert report == (f"Port Watch (@portwatch), \u201cStrike on the port\u201d, video, X, 12 March 2026, {POST_URL}, "
                      f"collected 13 March 2026. SHA-256 {sha}")
    short = (f"Strike on the port · Video · x.com · by Port Watch · posted 12 March 2026 · collected 13 March 2026. "
             f"{POST_URL} SHA-256 {sha}")
    assert client.get(item, params={"id": made["video"]["id"], "note": _note_in(client, cid, "brief")}).json()["reference"] == short
    # no note named, or one with no look: the short form
    assert client.get(item, params={"id": made["video"]["id"]}).json()["reference"] == short


def test_a_web_article_copies_the_web_entry_its_linked_words_followed_by_their_address(client, sourced):
    cid, _, _ = sourced
    said = client.get(f"/api/cases/{cid}/sources/lookup", params={
        "url": NOTICE_URL, "words": "the notice", "note": _note_in(client, cid, "article")}).json()
    assert said["reference"] == (f"port-authority.example.org, \u201cPort authority notice\u201d ({NOTICE_URL}). "
                                 f"Archived copy ({ARCHIVE_URL}).")


def test_a_bare_link_is_titled_by_the_notes_other_words_as_the_list_reads_them(client, sourced):
    cid, _, _ = sourced
    words = ["Al Jazeera, 10 Sep", "Yemen's Houthis seize strategic Red Sea city of Mocha"]
    said = client.get(f"/api/cases/{cid}/sources/lookup", params={
        "url": ELSEWHERE, "words": words, "note": _note_in(client, cid, "report")}).json()
    assert said["reference"] == f"\u201c{words[1]}\u201d, Al Jazeera, {ELSEWHERE}."
    assert client.get(f"/api/cases/{cid}/sources/lookup", params={"url": ELSEWHERE, "note": "../x"}).status_code == 422


def test_the_card_names_the_account_an_address_names_when_the_case_records_no_author(client, sourced):
    cid, case, _ = sourced
    bare = case.add_entity("media", "Ground tour", attrs={"path": "media/tour.mp4", "kind": "video",
                                                          "source_url": "https://x.com/MMY1444/status/2122054923298996698"}, by="user")
    known = client.get(f"/api/cases/{cid}/sources/item", params={"id": bare["id"]}).json()["known"]
    assert (known["author"], known["account"]) == ("", "@MMY1444")
    post = client.get(f"/api/cases/{cid}/sources/lookup", params={"url": POST_URL}).json()["known"]
    assert (post["author"], post["account"]) == ("Port Watch", "@portwatch")
    channel = client.get(f"/api/cases/{cid}/sources/lookup", params={"url": "https://t.me/portnews/512"}).json()["known"]
    assert channel["account"] == "@portnews"
