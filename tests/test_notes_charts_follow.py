"""What is published reads a chart's source as it is now, whichever export reads the note.

A chart's ``from: sheet:<id>`` (and an infographic's ``data:``) keeps a copy of the rows in
the note. The Notebook rewrites that copy by itself when the note is open, but an export
must not depend on that: a sheet edited in the Sheet tool, and the HTML page published the
next morning without the note being opened, has to show the sheet as it is.

So every document draws a chart through `notecharts.read` (and an infographic through
`notes_infographic.read`), and both draw from the source's current rows
(`notecharts.with_current_rows`). Each test here changes the sheet and leaves the note as
it is. The copy is drawn only once the source is gone, and the check says so then.

A linked cell of a sheet comes back to the note as the note's chip, so a picture wall reads
its pictures from a sheet.
"""

from __future__ import annotations

import io
import json
import re

import pytest
from pypdf import PdfReader

from azimut.engine import notecharts, notefill, notepieces, notes_charts, notes_html, notes_pdf, notes_web
from azimut.engine import notes_infographic as ig
from azimut.engine import notes_wordpress as wp
from azimut.engine import sheets as sheets_engine
from azimut.engine.notelook import NoteLook
from azimut.workspace import Case

from test_notes_report import make_case, make_note
from test_notes_wordpress import _placed

ME = notefill.Identity()


def _case(client) -> tuple[str, Case]:
    cid = make_case(client, "Follow")
    return cid, Case.open(cid)


def _sheet(case: Case) -> dict:
    return sheets_engine.create(case, "Register", ["Model", "Seen"], [["Cougar", "V1"], ["M-ATV", "V2"]])


def _note(sheet_id: str) -> str:
    """A chart whose copy in the note still holds the sheet's first two rows."""
    return (f"# Vehicles\n\n::: chart\nkind: bars\ntitle: Vehicles by model\ncount: rows\nby: Model\n"
            f"show: chart and table\nsource: the register\nfrom: sheet:{sheet_id}\n"
            "| Model | Seen |\n| --- | --- |\n| Cougar | V1 |\n| M-ATV | V2 |\n:::\n")


def _change(case: Case, sheet_id: str) -> None:
    """The sheet edited in the Sheet tool: a row renamed and one added. The note is not touched."""
    held = sheets_engine.read(case, sheet_id)
    rows = [list(row) for row in held["rows"]]
    rows[0][1] = "Kirpi"
    rows.append([sheets_engine.new_row_id(), "Kozak", "V3"])
    sheets_engine.write(case, sheet_id, held["columns"], rows, held["meta"], expected=held["stamp"])


def _pdf(case: Case, text: str) -> str:
    rendered = notes_pdf.render(case, title="Vehicles", text=text, identity=ME)
    return " ".join((page.extract_text() or "") for page in PdfReader(io.BytesIO(rendered.pdf)).pages)


def _html(case: Case, text: str, **look: str) -> str:
    return notes_html.render(case, title="Vehicles", text=text, look=NoteLook(**look), identity=ME).html.decode()


def _web_folder(case: Case, text: str) -> str:
    folder = notes_html.Folder(csp=notes_web.folder_csp())
    return notes_html.render(case, title="Vehicles", text=text, public=True, folder=folder, identity=ME).html.decode()


def _wordpress(case: Case, text: str) -> str:
    draft = wp.build(case, title="Vehicles", text=text, identity=ME)
    return draft.markup(_placed(draft)) + " ".join(upload.alt for upload in draft.uploads)


EXPORTS = {
    "pdf": _pdf,
    "html": _html,
    "story": lambda case, text: _html(case, text, web="story"),
    "map page": lambda case, text: _html(case, text, web="map"),
    "web folder": _web_folder,
    "wordpress": _wordpress,
}


@pytest.mark.parametrize("export", sorted(EXPORTS))
def test_every_export_draws_the_sheet_as_it_is_now(client, export):
    cid, case = _case(client)
    sheet = _sheet(case)
    text = _note(sheet["id"])
    assert "Kirpi" not in EXPORTS[export](case, text)

    _change(case, sheet["id"])

    drawn = EXPORTS[export](case, text)
    assert "Kirpi" in drawn and "Kozak" in drawn
    assert "Cougar" not in drawn


def test_to_post_hands_the_chart_drawn_from_the_sheet_as_it_is_now(client):
    cid, case = _case(client)
    sheet = _sheet(case)
    text = _note(sheet["id"])

    def picture() -> str:
        return next(piece["path"] for piece in notepieces.hand(case, title="Vehicles", text=text).pieces
                    if piece["kind"] == "media")

    before = picture()
    _change(case, sheet["id"])
    # another drawing, so another file: the one filed before showed the copy's rows
    assert picture() != before


def test_the_ready_check_says_nothing_of_a_source_that_stands_and_says_when_it_is_gone(client):
    cid, case = _case(client)
    sheet = _sheet(case)
    note = make_note(client, cid, title="Vehicles", content=_note(sheet["id"]))
    _change(case, sheet["id"])

    def warnings(fmt: str) -> list[dict]:
        answer = client.post(f"/api/cases/{cid}/notes/pdf/check",
                             json={"notes": [note["id"]], "format": fmt, "ready": True})
        assert answer.status_code == 200, answer.text
        return [warning for warning in answer.json()["notes"][0]["warnings"] if "Vehicles by model" in warning["text"]]

    for fmt in ("pdf", "html"):
        assert warnings(fmt) == []
    assert client.delete(f"/api/cases/{cid}/entities/{sheet['id']}").status_code == 200
    for fmt in ("pdf", "html"):
        said = warnings(fmt)
        assert [(warning["text"], warning["kind"]) for warning in said] == [
            ('The chart "Vehicles by model": what its rows came from is no longer in the case, so it shows the '
             "rows copied into the note.", "missing")]
    # the copy is what is drawn then
    assert "Cougar" in _html(case, _note(sheet["id"]))


def test_a_source_that_lost_the_charts_columns_keeps_the_copy_and_says_so(client):
    cid, case = _case(client)
    sheet = _sheet(case)
    held = sheets_engine.read(case, sheet["id"])
    sheets_engine.write(case, sheet["id"], ["id", "Other"], [[row[0], "x"] for row in held["rows"]], {})
    rendered = notes_html.render(case, title="Vehicles", text=_note(sheet["id"]), identity=ME)
    assert "Cougar" in rendered.html.decode()
    assert any("no longer has its columns" in message for message in rendered.warnings)


def test_a_table_of_another_note_is_followed_the_same_way(client):
    cid, case = _case(client)
    register = "# Register\n\n## Count\n\n| Model | Seen |\n| --- | --- |\n| Cougar | V1 |\n"
    source = make_note(client, cid, title="Register", content=register)
    text = _note("x").replace("from: sheet:x", f"from: note:{source['id']}#count")
    client.put(f"/api/cases/{cid}/notes/{source['id']}", json={"text": register + "| Kozak | V3 |\n"})
    assert "Kozak" in _html(case, text)


def test_an_infographic_draws_its_data_and_a_panels_own_source_as_they_are_now(client):
    cid, case = _case(client)
    sheet = _sheet(case)
    other = sheets_engine.create(case, "Grades", ["Grade", "Seen"], [["Confirmed", "V1"]])
    body = (f"data: sheet:{sheet['id']}\ntitle: The vehicles\n\n"
            "::: chart\nkind: bars\ntitle: By model\ncount: rows\nby: Model\nsource: the register\n"
            "| Model | Seen |\n| --- | --- |\n| Cougar | V1 |\n:::\n\n"
            "::: chart\nkind: bars\ntitle: By grade\ncount: rows\nby: Grade\nsource: the register\n"
            f"from: sheet:{other['id']}\n| Grade | Seen |\n| --- | --- |\n| Confirmed | V1 |\n:::")
    _change(case, sheet["id"])
    held = sheets_engine.read(case, other["id"])
    sheets_engine.write(case, other["id"], held["columns"], [*held["rows"], ["r2", "Probable", "V9"]], held["meta"])

    page = ig.read(case, body)
    lines = [line for drawn in (panel for band in page.bands for panel in band.panels) if drawn.chart is not None
             for line in drawn.chart.lines]
    assert any("Kozak" in line for line in lines) and any("Probable" in line for line in lines)
    assert not any("Cougar" in line for line in lines)
    assert not [warning for warning in page.warnings if "differ" in warning[0]]


def test_a_sheets_linked_cells_come_back_to_the_note_as_chips(client):
    cid, case = _case(client)
    shot = case.add_entity("media", "frame-1", {"path": "media/frame-1.jpg", "kind": "image"}, by="test")
    place = case.add_entity("place", "Rooftop", {"lat": 47.1, "lon": 37.5}, by="test")
    sheet = sheets_engine.create(case, "Wall", ["Picture", "#", "Where", "File"], [
        [f"[[media:{shot['id']}|#1]]", "1", f"[[entity:{place['id']}|Rooftop]]", ""]])
    name, table = notecharts.origin_table(case, f"sheet:{sheet['id']}")
    assert name == "Wall"
    row = table.split("\n")[2]
    assert f"[[media:{shot['id']}|#1]]" in row and f"[[entity:{place['id']}|Rooftop]]" in row
    # what the check compares is still the words a reader sees
    assert notecharts.origin_rows(case, f"sheet:{sheet['id']}")[2][0][1] == "#1"


def test_a_picture_cell_holding_a_case_path_is_written_as_that_medias_chip(client, monkeypatch):
    cid, case = _case(client)
    sheet = sheets_engine.create(case, "Wall", ["Picture", "#"], [["media/frame-1.jpg", "1"]])
    held = sheets_engine.read(case, sheet["id"])
    sheets_engine.write(case, sheet["id"], held["columns"], held["rows"],
                        {**held["meta"], "roles": {"Picture": {"kind": "picture"}}})
    monkeypatch.setattr(type(case), "media_items_by_paths",
                        lambda self, paths: [{"path": "media/frame-1.jpg", "entity_id": "e_frame00001",
                                              "title": "Frame one"}] if "media/frame-1.jpg" in paths else [])
    _, table = notecharts.origin_table(case, f"sheet:{sheet['id']}")
    assert table.split("\n")[2] == "| [[media:e_frame00001|Frame one]] | 1 |"


def test_the_rows_route_answers_a_sheets_current_rows_with_its_chips(client):
    cid, case = _case(client)
    shot = case.add_entity("media", "frame-1", {"path": "media/frame-1.jpg", "kind": "image"}, by="test")
    sheet = sheets_engine.create(case, "Wall", ["Picture"], [[f"[[media:{shot['id']}|#1]]"]])
    answer = client.post(f"/api/cases/{cid}/notes/figure/rows", json={"origin": f"sheet:{sheet['id']}"}).json()
    assert answer == {"found": True, "name": "Wall", "rows": 1,
                      "text": f"| Picture |\n| --- |\n| [[media:{shot['id']}|#1]] |"}
    # a wall drawn from it finds its picture
    block = notes_charts.parse_block(f"kind: pictures\nfrom: sheet:{sheet['id']}\n| Picture |\n| --- |\n| #1 |")
    drawn = notecharts.with_current_rows(case, "\n".join(
        [f"kind: pictures\nfrom: sheet:{sheet['id']}", *block.table.lines]))
    assert f"[[media:{shot['id']}|#1]]" in drawn
    assert json.dumps(drawn).count("[[media:") == 1
    assert not re.search(r"\| #1 \|", drawn)
