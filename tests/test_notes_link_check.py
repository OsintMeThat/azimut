"""The check before an export counts a note's outside links: those with no archived
copy, and those the case holds nothing of, so no day says when they were read.

One line each, however many links it counts, the links behind it listed for the dialog
to fold under it (`Cited.listed`, the check's `items`). Links to the case's own work are
left out, the public edition counts only what it prints, and nothing is fetched.
"""

from __future__ import annotations

import json
import socket

import pytest

from azimut.engine import notes_markdown, notes_pdf
from azimut.engine.notelook import NoteLook
from azimut.workspace import Case

from sourcesfixture import ARCHIVE_URL, MAPS_URL, NOTICE_URL, POST_URL, sourced_case, report_as_before
from test_notes_report import make_case, make_note

REPORT = NoteLook.model_validate({"style": "report"})
#: A page the case holds nothing of.
ELSEWHERE = "https://www.aljazeera.com/news/2026/9/10/houthis-take-mocha"


@pytest.fixture()
def sourced(client):
    cid = make_case(client, "Link check")
    case = Case.open(cid)
    return cid, case, sourced_case(case)


def _posted_proof(case, posted):
    return case.add_entity("proof", "Posted", attrs={"path": "proofs/Posted.png", "kind": "image", "posted_url": posted},
                           by="proof-composer")


# -- the check before export -------------------------------------------------------------


def _check(case, text, look=REPORT, **options):
    out = notes_pdf.render(case, title="T", text=text, look=look, light=True, **options)
    said = [(warning, line, kind) for warning, line, kind in zip(out.warnings, out.warning_lines, out.warning_kinds)
            if kind in (notes_markdown.UNARCHIVED, notes_markdown.UNSEEN)]
    return said, out.listed


@pytest.fixture(autouse=True)
def _report_as_before(monkeypatch):
    """A report here prints its sources short and its links grouped, as before profiles."""
    report_as_before(monkeypatch)


def test_outside_links_are_counted_once_a_page_in_one_line_each_with_their_list(sourced):
    _, case, _ = sourced
    text = ("Intro.\n\n"
            f"[Al Jazeera, 10 Sep]({ELSEWHERE}) and again [the same]({ELSEWHERE}#top).\n\n"
            f"[the notice]({NOTICE_URL}) [the post]({POST_URL}) https://www.bbc.com/news/articles/c1\n")
    said, listed = _check(case, text)
    assert said == [
        ("3 outside links have no archived copy.", 2, "unarchived"),
        ("2 links are not in the case, so no day says when they were read.", 2, "unseen"),
    ]
    assert listed["unarchived"] == [
        {"text": "Al Jazeera, 10 Sep", "url": ELSEWHERE, "line": 2},
        {"text": "the post", "url": POST_URL, "line": 4},
        {"text": "bbc.com/news/articles/c1", "url": "https://www.bbc.com/news/articles/c1", "line": 4},
    ]
    assert [item["text"] for item in listed["unseen"]] == ["Al Jazeera, 10 Sep", "bbc.com/news/articles/c1"]


def test_one_link_is_named_rather_than_counted(sourced):
    _, case, _ = sourced
    said, listed = _check(case, f"See [Al Jazeera, 10 Sep]({ELSEWHERE}).\n")
    assert said == [
        ("“Al Jazeera, 10 Sep” has no archived copy.", 0, "unarchived"),
        ("“Al Jazeera, 10 Sep” is not in the case, so no day says when it was read.", 0, "unseen"),
    ]
    assert listed == {}


def test_links_to_the_case_s_own_work_and_archived_copies_are_left_alone(sourced):
    _, case, _ = sourced
    mine = "https://x.com/me/status/7"
    _posted_proof(case, mine)
    text = (f"[a copy]({ARCHIVE_URL}) [another](https://archive.ph/Ab12c) [the berths]({MAPS_URL}) "
            "[Wayback](https://livingatlas.arcgis.com/wayback/#mapCenter=1%2C2%2C17&active=1) "
            "[pass](https://browser.dataspace.copernicus.eu/?zoom=17) "
            "[imagery](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer) "
            f"[our post]({mine})\n")
    assert _check(case, text) == ([], {})


def test_the_public_edition_checks_only_the_links_it_prints(sourced):
    _, case, _ = sourced
    text = f"[open]({ELSEWHERE})\n\n> [!internal] Ask [the team](https://example.org/team).\n"
    internal, _ = _check(case, text)
    public, _ = _check(case, text, public=True)
    assert internal[0][0] == "2 outside links have no archived copy."
    assert public[0][0] == "“open” has no archived copy."


def test_links_are_checked_only_while_the_sources_are_listed(sourced):
    _, case, _ = sourced
    text = f"[open]({ELSEWHERE})\n"
    for quiet in (NoteLook(), NoteLook.model_validate({"style": "report", "sources": "off"})):
        assert _check(case, text, look=quiet) == ([], {})
    assert _check(case, text, look=NoteLook.model_validate({"sources": "on"}))[0]


def test_a_template_is_never_told_about_its_links():
    out = notes_pdf.render(None, title="T", text=f"[open]({ELSEWHERE})\n", look=REPORT, light=True)
    assert out.warnings == [] and out.listed == {}


def test_the_check_answers_the_links_behind_each_line(client, sourced):
    cid, case, _ = sourced
    note = make_note(client, cid, title="Front", content=f"[a]({ELSEWHERE})\n\n[b](https://example.org/b)\n")
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "report"})
    for body in ({"notes": [note["id"]]}, {"notes": [note["id"]], "format": "html"},
                 {"notes": [note["id"]], "format": "web", "base_url": "https://me.github.io/front/"}):
        answer = client.post(f"/api/cases/{cid}/notes/pdf/check", json=body)
        assert answer.status_code == 200, answer.text
        warnings = {one["kind"]: one for one in answer.json()["notes"][0]["warnings"]}
        assert warnings["unarchived"] == {
            "text": "2 outside links have no archived copy.", "line": 0, "kind": "unarchived",
            "items": [{"text": "a", "url": ELSEWHERE, "line": 0},
                      {"text": "b", "url": "https://example.org/b", "line": 2}],
        }, body
        assert len(warnings["unseen"]["items"]) == 2


def test_the_preview_says_the_line_without_its_list(client, sourced):
    cid, _, _ = sourced
    note = make_note(client, cid, title="Front")
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "report"})
    text = f"[a]({ELSEWHERE}) [b](https://example.org/b)\n"
    response = client.post(f"/api/cases/{cid}/notes/preview", json={"note": note["id"], "text": text})
    assert response.status_code == 200, response.text
    assert json.loads(response.headers["x-note-warning-kinds"]) == ["unarchived", "unseen"]
    assert json.loads(response.headers["x-note-warnings"])[0] == "2 outside links have no archived copy."


def test_finding_and_checking_links_never_reaches_the_network(client, sourced, monkeypatch):
    cid, case, _ = sourced

    def refuse(*_args, **_kwargs):
        raise AssertionError("a link was looked up on the network")

    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)
    note = make_note(client, cid, title="Offline", content=f"[a]({ELSEWHERE}) [b]({POST_URL}) {NOTICE_URL}\n")
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "report"})
    for format_ in ("pdf", "html"):
        assert client.post(f"/api/cases/{cid}/notes/pdf/check", json={"notes": [note["id"]], "format": format_}).status_code == 200
    assert client.get(f"/api/cases/{cid}/sources/lookup", params={"url": POST_URL}).json()["known"]
    assert notes_pdf.render(case, title="T", text=f"[b]({POST_URL})\n", look=REPORT).pdf
