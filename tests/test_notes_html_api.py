"""The HTML report's routes: the check before it, the Page pane's copy, the export and
the record of editions it keeps beside the PDF's."""

from __future__ import annotations

import hashlib

import pytest

from azimut.api import notes as notes_api
from azimut.engine import notes_html, notes_markdown
from azimut.server import BulkBodyLimit
from azimut.workspace import Case

from ambushfixture import DIAGRAM, DIAGRAM_SVG, FILMER, ambush_case, ambush_note
from test_notes_html import parse
from test_notes_pdf import exports_of
from test_notes_report import make_case, make_note


@pytest.fixture()
def ambush(client):
    """The ambush register as a filed note, with a look that numbers and lists its sources."""
    cid = make_case(client, "Ambush")
    made = ambush_case(Case.open(cid))
    note = make_note(client, cid, title="Ambush register", content=ambush_note(made))
    look = client.put(f"/api/cases/{cid}/notes/{note['id']}/look",
                      json={"style": "report", "toc": True, "numbered": True, "tlp": "green"})
    assert look.status_code == 200, look.text
    return {"cid": cid, "note": note["id"], "made": made}


def _check(client, ambush, **body):
    answer = client.post(f"/api/cases/{ambush['cid']}/notes/pdf/check",
                         json={"notes": [ambush["note"]], "format": "html", **body})
    assert answer.status_code == 200, answer.text
    return answer.json()["notes"][0]


def test_the_check_weighs_the_file_and_lists_links_points_of_view_and_counts(client, ambush):
    checked = _check(client, ambush, edition="public")
    assert checked["weight"] > 100_000 and checked["links"] == [] and checked["earlier"] == 0
    assert len(checked["pov"]) == 1 and f"{FILMER[0]:.6f}" in checked["pov"][0]["text"]
    assert isinstance(checked["pov"][0]["line"], int)
    kinds = {warning["kind"] for warning in checked["warnings"]}
    assert {"count", "internal", "unsourced"} <= kinds
    counted = [warning for warning in checked["warnings"] if warning["kind"] == "count"]
    assert len(counted) == 1 and counted[0]["text"].startswith('1 count reads as exact: "12 trucks"')
    assert isinstance(counted[0]["line"], int)
    # the PDF's check is as it was: no weight, no count
    pdf = client.post(f"/api/cases/{ambush['cid']}/notes/pdf/check", json={"notes": [ambush["note"]]}).json()
    assert "weight" not in pdf["notes"][0] and all(w["kind"] != "count" for w in pdf["notes"][0]["warnings"])


def test_the_check_names_each_clip_that_will_be_a_link(client, ambush, monkeypatch):
    monkeypatch.setattr(notes_html, "MAX_BYTES", 3000)
    checked = _check(client, ambush)
    assert [link["text"] for link in checked["links"]] == ["The strike"]
    assert any("past the" in warning["text"] for warning in checked["warnings"])


def test_an_export_writes_one_file_and_keeps_its_record(client, ambush):
    cid, note = ambush["cid"], ambush["note"]
    diagrams = {notes_markdown.diagram_key(DIAGRAM): DIAGRAM_SVG}
    answer = client.post(f"/api/cases/{cid}/notes/html", json={
        "notes": [note], "edition": "public", "diagrams": diagrams, "changes": "  First   public edition. "})
    assert answer.status_code == 200, answer.text
    written = answer.json()["written"][0]
    assert written["file"].endswith(" - public - " + written["file"].split(" - ")[-1])
    assert written["file"].endswith(".html") and written["edition"] == "public"
    data = (exports_of(cid) / written["file"]).read_bytes()
    assert written["bytes"] == len(data)
    page = parse(data)
    assert page.one("html").attrs["data-edition"] == "public" and page.one("svg").attrs["id"] == "az-diagram-1"
    assert "First public edition." in page.one("section", "az-corrections").words()
    editions = client.get(f"/api/cases/{cid}/notes/{note}/editions").json()["editions"]
    record = editions[0]
    assert set(record) == {"at", "edition", "file", "folder", "format", "sha256", "text_sha256", "changes"}
    assert record["format"] == "html" and record["sha256"] == hashlib.sha256(data).hexdigest()
    assert record["changes"] == "First public edition."
    ref = {"at": record["at"], "file": record["file"], "folder": record["folder"]}
    check = f"/api/cases/{cid}/notes/{note}/editions/check"
    assert client.post(check, json=ref).json() == {"state": "unchanged"}
    (exports_of(cid) / written["file"]).write_bytes(data + b"<!-- edited -->")
    assert client.post(check, json=ref).json() == {"state": "changed"}
    # the next export lists this one among the corrections, and the check counts it
    assert _check(client, ambush, edition="public")["earlier"] == 1
    second = client.post(f"/api/cases/{cid}/notes/html", json={"notes": [note], "edition": "public"}).json()
    again = parse((exports_of(cid) / second["written"][0]["file"]).read_bytes())
    corrections = again.one("section", "az-corrections")
    assert record["sha256"] in corrections.words() and "First public edition." in corrections.words()


def test_an_internal_export_keeps_its_passage_and_rounds_nothing_unasked(client, ambush):
    cid, note = ambush["cid"], ambush["note"]
    answer = client.post(f"/api/cases/{cid}/notes/html", json={"notes": [note], "edition": "internal"}).json()
    page = parse((exports_of(cid) / answer["written"][0]["file"]).read_bytes())
    assert page.one("aside", "az-internal")
    assert f"{FILMER[0]:.6f}" in page.one("a", "az-pov").words()
    rounded = client.post(f"/api/cases/{cid}/notes/html",
                          json={"notes": [note], "edition": "public", "round_pov": True}).json()
    page = parse((exports_of(cid) / rounded["written"][0]["file"]).read_bytes())
    assert f"{FILMER[0]:.6f}" not in page.one("a", "az-pov").words()


def test_a_record_that_is_not_what_an_export_writes_is_dropped():
    good = {"at": "2026-03-12T10:00:00Z", "edition": "public", "file": "Rooftop - 2026-03-12.html",
            "folder": "exports", "format": "html", "sha256": "a" * 64, "text_sha256": "b" * 64}
    assert notes_api._edition_record(good) == good
    assert notes_api._edition_record({**good, "changes": "  Fixed  a date. "})["changes"] == "Fixed a date."
    for broken in ({**good, "sha256": "nope"}, {**good, "text_sha256": None},
                   {key: value for key, value in good.items() if key != "sha256"}):
        assert notes_api._edition_record(broken) is None


def test_the_preview_is_lighter_sandboxed_and_written_nowhere(client, ambush):
    cid, note = ambush["cid"], ambush["note"]
    text = ambush_note(ambush["made"])
    before = sorted(path.name for path in exports_of(cid).glob("*")) if exports_of(cid).exists() else []
    answer = client.post(f"/api/cases/{cid}/notes/html/preview",
                         json={"note": note, "text": text, "edition": "internal"})
    assert answer.status_code == 200, answer.text
    assert answer.headers["content-type"].startswith("text/html")
    assert answer.headers["content-security-policy"].startswith("sandbox allow-scripts;")
    assert answer.headers["cache-control"] == "no-store" and answer.headers["x-note-internal"] == "1"
    assert "count" in answer.headers["x-note-warning-kinds"]
    diagrams = answer.headers["x-note-diagrams"]
    assert notes_markdown.diagram_key(DIAGRAM) in diagrams
    page = parse(answer.content)
    assert max(int(img.attrs.get("width") or 0) for img in page.find("img")) <= notes_html.PREVIEW_SIDE
    video = page.one("video", "az-clip")
    assert video.attrs.get("data-preview") == "true" and "src" not in video.attrs
    after = sorted(path.name for path in exports_of(cid).glob("*")) if exports_of(cid).exists() else []
    assert after == before


def test_the_routes_bound_their_diagrams_and_their_bodies(client, ambush):
    cid, note = ambush["cid"], ambush["note"]
    route = f"/api/cases/{cid}/notes/html"
    assert client.post(route, json={"notes": [note], "diagrams": {"bad key!": "<svg/>"}}).status_code == 422
    huge = "<svg>" + "x" * (notes_html.MAX_SVG_BYTES + 1) + "</svg>"
    assert client.post(route, json={"notes": [note], "diagrams": {"abc": huge}}).status_code == 422
    assert client.post(route, json={"notes": [note], "changes": "x" * 301}).status_code == 422
    for tail in (("notes", "html"), ("notes", "html", "preview")):
        path = f"/api/cases/{cid}/" + "/".join(tail)
        assert BulkBodyLimit._limit({"type": "http", "method": "POST", "path": path}) is not None
    assert client.post("/api/cases/nosuch/notes/html", json={"notes": [note]}).status_code == 404
    assert client.post(f"/api/cases/{cid}/notes/html/preview",
                       json={"note": "nosuchnote", "text": "x"}).status_code == 404


def test_the_full_case_notes_export_as_html_in_both_editions(client):
    import fullcase

    full = fullcase.build_full_case(client)
    cid = full.case_id
    for edition in ("internal", "public"):
        answer = client.post(f"/api/cases/{cid}/notes/html", json={"notes": [full.note_id, "case"],
                                                                    "edition": edition})
        assert answer.status_code == 200, answer.text
        assert len(answer.json()["written"]) == 2
        for written in answer.json()["written"]:
            page = parse((exports_of(cid) / written["file"]).read_bytes())
            assert page.one("main", "az-body") and page.one("footer", "az-footer")
            assert page.one("html").attrs["data-edition"] == written["edition"]
    editions = client.get(f"/api/cases/{cid}/notes/{full.note_id}/editions").json()["editions"]
    assert [record["format"] for record in editions[:2]] == ["html", "html"]
