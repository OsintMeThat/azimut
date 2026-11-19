"""Ready to publish?: the check before export as the panel reads it.

The panel lists what the export check says, grouped, plus what only it asks
(`engine/noteready.py`). Its counts must be the dialog's: these tests hold the two to
one answer, in the PDF and in the HTML page.
"""

from __future__ import annotations

from PIL import Image

from azimut.engine import linkarchive, noteready
from azimut.engine import media as media_engine
from azimut.workspace import Case

from notecase import make_case, make_note

COUNTS = ("# Losses\n\nWe saw 12 trucks and at least 4 tanks on the road.\n\n"
          "> 30 tanks in a quote are not counted.\n\n## The road\n\n12 trucks burned, then 7 boats sank.\n")
CHART = ("::: chart\ntitle: Vehicles by maker\ncount: At least\nby: Maker\nsource: our register\n"
         "| Maker | At least |\n| --- | ---: |\n| Streit | 3 |\n| Cougar | 2 |\n:::")


def _check(client, cid, note_id, fmt="html", edition="internal", ready=True):
    answer = client.post(f"/api/cases/{cid}/notes/pdf/check",
                         json={"notes": [note_id], "format": fmt, "edition": edition, "ready": ready})
    assert answer.status_code == 200, answer.text
    return answer.json()["notes"][0]


def test_a_count_read_as_exact_is_one_line_with_each_count_under_it_in_the_pdf_as_in_the_page(client):
    cid = make_case(client)
    note = make_note(client, cid, title="Losses", content=COUNTS)
    lines = COUNTS.split("\n")
    said = {}
    for fmt in ("pdf", "html"):
        counted = [warning for warning in _check(client, cid, note["id"], fmt, ready=False)["warnings"]
                   if warning["kind"] == "count"]
        assert len(counted) == 1, fmt
        said[fmt] = counted[0]
    # one answer, whatever is written: the export dialog's count is the panel's
    assert said["pdf"] == said["html"]
    warning = said["pdf"]
    assert warning["text"] == '2 counts read as exact: "12 trucks", "7 boats". Say "at least" or give a range.'
    assert [item["text"] for item in warning["items"]] == ["12 trucks", "7 boats"]
    # a count written twice is one count, at its first line; a quote and a hedge are never read
    assert lines[warning["items"][0]["line"]].startswith("We saw 12 trucks")
    assert lines[warning["items"][1]["line"]].startswith("12 trucks burned")
    assert all(item["url"] == "" for item in warning["items"])


def test_the_ready_check_groups_every_warning_and_offers_a_chart_s_own_fix(client):
    cid = make_case(client)
    text = (f"# Article\n\nWe saw 12 trucks, see [the agency](https://agency.example.org/a).\n\n"
            f"## Empty\n\n## Figures\n\n{CHART}\n\n::: map\ntitle: The front\n:::\n")
    note = make_note(client, cid, title="Article", content=text)
    assert client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "report", "tlp": "amber"}).status_code == 200
    lines = text.split("\n")
    for fmt in ("pdf", "html", "web"):
        checked = _check(client, cid, note["id"], fmt)
        groups = {warning["text"]: warning["group"] for warning in checked["warnings"]}
        kinds = {warning["kind"]: warning["group"] for warning in checked["warnings"]}
        assert kinds["count"] == "words" and kinds["empty-section"] == "words", fmt
        assert kinds["unarchived"] == "sources" and kinds["unseen"] == "sources", fmt
        floor = next(warning for warning in checked["warnings"] if "say so in its title" in warning["text"])
        assert floor["group"] == "figures" and lines[floor["line"]] == "title: Vehicles by maker"
        assert floor["fix"] == [["title", "At least 5 vehicles, by maker"]]
        assert groups["The map \"The front\" has no ground picture, so it is drawn on a plain background."] == "figures"
        ready = checked["ready"]
        assert {key: ready[key] for key in ("format", "edition", "style", "tlp")} == {
            "format": fmt, "edition": "public" if fmt == "web" else "internal", "style": "report", "tlp": "amber"}
        assert ready["unarchived"] == ready["unseen"] == [
            {"text": "the agency", "url": "https://agency.example.org/a", "line": lines.index(
                "We saw 12 trucks, see [the agency](https://agency.example.org/a).")}]
    # without ready the export dialog's answer is as it was: no group, no extras
    plain = _check(client, cid, note["id"], "pdf", ready=False)
    assert "ready" not in plain and all("group" not in warning for warning in plain["warnings"])


def test_the_panel_lists_pictures_claims_and_gone_pages_beside_the_check(client):
    cid = make_case(client)
    case = Case.open(cid)
    pasted = media_engine.import_image(case, Image.new("RGB", (320, 200), (90, 90, 90)), "Pasted.png",
                                       {"type": "clipboard"}, title="Pasted", dedupe=False)["entity"]
    named = media_engine.import_image(case, Image.new("RGB", (320, 200), (30, 90, 150)), "Port.png",
                                      {"type": "clipboard"}, title="Port", dedupe=False)["entity"]
    bare = case.add_entity("claim", "The convoy was hit twice", {}, by="user")
    sourced = case.add_entity("claim", "The port closed", {}, by="user")
    page = case.add_entity("bookmark", "Port notice", {"url": "https://port.example.org/notice"}, by="user")
    case.add_link(sourced["id"], page["id"], "cites", by="user")
    text = (f"# Article\n\n[[entity:{bare['id']}|hit twice]] and [[entity:{sourced['id']}|closed]], "
            f"says [the agency](https://agency.example.org/a).\n\n"
            f"[[media:{pasted['id']}|Figure 3]]\n\n"
            f"[[media:{named['id']}|Figure 4]]{{caption=\"The quay at dawn. Footage: Port Watch.\"}}\n")
    note = make_note(client, cid, title="Article", content=text)
    case.update_entity(note["id"], {"attrs": {linkarchive.RECORD: {
        "version": linkarchive.VERSION, "state": linkarchive.DONE,
        "links": [{"url": "https://agency.example.org/a", "text": "the agency", "state": linkarchive.FAILED,
                   "reason": "The page no longer answers.", "gone": True},
                  {"url": "https://other.example.org/b", "text": "not in the note", "state": linkarchive.FAILED,
                   "gone": True}]}}})
    lines = text.split("\n")
    for fmt in ("pdf", "html"):
        ready = _check(client, cid, note["id"], fmt)["ready"]
        # a bare label tells a reader nothing; a caption that names its footage is alt text and a credit
        assert ready["pictures"] == [{"text": "Figure 3", "line": lines.index(f"[[media:{pasted['id']}|Figure 3]]"),
                                      "alt": False, "credit": False}], fmt
        assert ready["claims"] == [{"id": bare["id"], "text": "hit twice", "line": 2}]
        # the run's record, read as it was left: only a page the note still links to
        assert ready["gone"] == [{"text": "the agency", "url": "https://agency.example.org/a", "line": 2}]


def test_a_picture_the_check_says_has_no_source_is_not_said_twice():
    ready = {"pictures": [{"text": "Figure 3", "line": 4, "alt": True, "credit": False},
                          {"text": "Figure 5", "line": 6, "alt": False, "credit": False}]}
    warnings = [{"text": 'Picture "Figure 3" has no source.', "line": 4, "kind": "unsourced"},
                {"text": 'Picture "Figure 5" has no source.', "line": 6, "kind": "unsourced"}]
    found = noteready.extras(None, "case", ready, warnings)  # type: ignore[arg-type]
    assert found["pictures"] == [{"text": "Figure 5", "line": 6, "alt": False, "credit": True}]


def test_a_warning_goes_in_the_group_its_kind_or_its_line_says():
    text = "# T\n\nWords.\n\n::: chart\ntitle: A\n| A | B |\n| --- | --- |\n:::\n\n```mermaid\ngraph LR\n```\n"
    figures = noteready.figure_lines(text)
    assert {4, 5, 6, 7, 8, 10, 11, 12} <= figures and 2 not in figures
    group = noteready.group_of
    assert group("other", 5, "A chart says…", figures, set()) == "figures"
    assert group("other", 2, "Something else.", figures, set()) == "words"
    assert group("missing", 2, 'The record "X" is no longer in the case.', figures, set()) == "sources"
    assert group("missing", 2, 'Picture "X" is no longer in the case.', figures, {2}) == "figures"
    assert group("other", None, "The page weighs 30 MB, past the 25 MB it aims for.", figures, set()) == "reach"
    assert group("setting", None, "Your logo is not set.", figures, set()) == "edition"
    assert group("stale", 5, "Its rows differ.", figures, set()) == "figures"
