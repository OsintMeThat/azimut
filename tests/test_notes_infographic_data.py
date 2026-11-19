"""An infographic's data (`engine/notes_infographic.py`): the ``data:`` line naming the sheet or
the note's table its charts are drawn from, the panels that inherit it, what the check says
when the data is gone or a panel's rows moved on, Read again (all panels) as the server reads
the rows, the sheet named counted as used (`engine/uses.py`), and a sheet made from a paste."""

from __future__ import annotations

import re

from azimut.engine import notecharts, notes_html, notes_pdf
from azimut.engine import notes_infographic as ig
from azimut.engine import sheets as sheets_engine
from azimut.engine import uses as uses_engine
from azimut.workspace import Case

from notecase import make_case, make_note

COLUMNS = ["Model", "Made in", "Grade"]
ROWS = [["Streit Cougar", "UAE", "Confirmed"], ["Oshkosh M-ATV", "USA", "Confirmed"], ["Al-Wahsh", "Jordan", "Almost sure"]]
FIGURES = """::: chart
kind: key figures
source: our vehicle register
| Figure | Words |
| --- | --- |
| 51 of 54 | vehicles we could place |
:::"""


def _case(client, name="Data") -> tuple[str, Case]:
    cid = make_case(client, name)
    return cid, Case.open(cid)


def _table(rows=ROWS, columns=COLUMNS) -> str:
    lines = ["| " + " | ".join(columns) + " |", "| " + " | ".join("---" for _ in columns) + " |"]
    return "\n".join([*lines, *("| " + " | ".join(row) + " |" for row in rows)])


def _chart(kind: str, title: str, table: str, *, origin: str = "", colour: str = "colour by: Grade") -> str:
    lines = ["::: chart", f"kind: {kind}", f"title: {title}", "count: rows", "by: Model", colour, "source: our vehicle register"]
    if origin:
        lines.append(f"from: {origin}")
    return "\n".join([*lines, table, ":::"])


def _graphic(data: str, *panels: str) -> str:
    head = [":::: infographic", "title: At least 3 vehicles lost"]
    if data:
        head.append(f"data: {data}")
    return "\n".join([*head, "", "\n\n".join(panels), "::::"])


def _body(graphic: str) -> str:
    return ig.block_of(graphic)


# -- the grammar --------------------------------------------------------------------------------------


def test_data_names_a_sheet_or_a_notes_table_and_nothing_else():
    graphic = ig.parse_block(_body(_graphic("sheet:e_abc123", _chart("bars", "Lost", _table()))))
    assert graphic.data == "sheet:e_abc123" and not graphic.unread
    assert ig.parse_block("data: note:e_1#the-register\n\n" + FIGURES).data == "note:e_1#the-register"
    refused = ig.parse_block("data: layer:Vehicles\n\n" + FIGURES)
    assert refused.data == "" and refused.unread[0][2].startswith('"layer:Vehicles" is no data')
    # the Notebook writes it first, before the title band
    assert ig.WRITTEN_ORDER[0] == "data" and ig.KEYS["data"] == "data"


def test_a_chart_with_no_from_whose_columns_the_data_holds_inherits_it():
    body = _body(_graphic("sheet:e_s1",
                          _chart("bars", "Lost", _table()),
                          FIGURES,
                          _chart("pie", "Grades", _table([[r[0], r[2]] for r in ROWS], ["Model", "Grade"])),
                          _chart("bars", "Copied", _table(), origin="note:e_n1#register"),
                          "::: chart\nkind: bars\n:::"))
    panels = ig.parse_block(body).panels
    # its rows, the same columns kept to a few, an empty chart: the data's; typed-in figures and
    # a from: of its own: their own
    assert [ig.inherits(panel, ["Model", "made in", "Grade", "State"]) for panel in panels] == [True, False, True, False, True]
    assert [ig.own_origin(panel) for panel in panels] == ["", "", "", "note:e_n1#register", ""]
    # a column the data lacks makes the rows the panel's own
    assert not ig.inherits(panels[0], ["Model", "Grade"])


# -- the check ----------------------------------------------------------------------------------------


def _sheet(case, rows=ROWS, title="Vehicle register"):
    return sheets_engine.create(case, title, COLUMNS, [list(row) for row in rows])


def _data_warnings(case, graphic: str, **options) -> list[tuple[str, str, int | None]]:
    page = ig.read(case, _body(graphic), maps=False, **options)
    return [warning for warning in page.warnings if "data" in warning[0] or "copied" in warning[0]]


def test_the_check_says_when_the_data_moved_on_or_left_the_case(client):
    cid, case = _case(client)
    sheet = _sheet(case)
    origin = f"sheet:{sheet['id']}"
    graphic = _graphic(origin, FIGURES, _chart("stacked bars", "At least 3 vehicles, by model and grade", _table()))
    # the panel holds the data's rows: nothing to say
    assert _data_warnings(case, graphic) == []
    # a row edited in the Sheet tool: the panel that reads it says so, at its own fence
    read = sheets_engine.read(case, sheet["id"])
    read["rows"][2][3] = "Confirmed"
    sheets_engine.write(case, sheet["id"], read["columns"], read["rows"], read["meta"])
    body = _body(graphic)
    fence = body.split("\n").index("::: chart", body.split("\n").index("::: chart") + 1)
    assert _data_warnings(case, graphic) == [(
        'The chart "At least 3 vehicles, by model and grade": its rows differ from the infographic\'s data, '
        '"Vehicle register". Read again (all panels) brings them up to date.', "other", fence)]
    # the editor says it itself as the note is typed
    assert _data_warnings(case, graphic, origins=False) == []
    # the sheet deleted: once, at the data's line, and no panel claims to differ from it
    assert client.delete(f"/api/cases/{cid}/entities/{sheet['id']}").status_code == 200
    assert _data_warnings(case, graphic) == [(ig.DATA_GONE, "missing", body.split("\n").index(f"data: {origin}"))]


def test_a_panel_keeps_its_own_source_and_the_check_reads_it(client):
    cid, case = _case(client)
    register = f"# Register\n\n## Register\n\n{_table()}\n"
    note = make_note(client, cid, title="Register", content=register)
    sheet = _sheet(case)
    graphic = _graphic(f"sheet:{sheet['id']}", _chart("bars", "Lost", _table(), origin=f"note:{note['id']}#register"))
    assert _data_warnings(case, graphic) == []
    client.put(f"/api/cases/{cid}/notes/{note['id']}", json={"text": register + "| Kirpi | Türkiye | Confirmed |\n"})
    said = _data_warnings(case, graphic)
    assert [message for message, _, _ in said] == [
        'The chart "Lost": its rows differ from "Register", where they were copied from. Read them again to bring '
        "them up to date."]


def test_read_again_for_all_panels_writes_the_rows_the_check_reads(client):
    """The editor's Read again (all panels) copies the rows `POST /notes/figure/rows` answers into
    every panel that inherits the data: once written, the check has nothing to say, and the
    panel with rows of its own is left as it was."""
    cid, case = _case(client)
    sheet = _sheet(case)
    origin = f"sheet:{sheet['id']}"
    stale = _table(ROWS[:2])
    graphic = _graphic(origin, FIGURES, _chart("bars", "Lost", stale), _chart("pie", "Grades", stale, colour=""))
    assert len(_data_warnings(case, graphic)) == 2
    answer = client.post(f"/api/cases/{cid}/notes/figure/rows", json={"origin": origin}).json()
    assert answer["found"] and answer["rows"] == 3 and answer["name"] == "Vehicle register"
    page = ig.parse_block(_body(graphic))
    assert [ig.inherits(panel, COLUMNS) for panel in page.panels] == [False, True, True]
    again = graphic.replace(stale, answer["text"])
    assert _data_warnings(case, again) == []
    assert FIGURES in again


def test_the_pdf_and_the_html_check_say_where_the_rows_came_from(client):
    cid, case = _case(client)
    sheet = _sheet(case)
    graphic = _graphic(f"sheet:{sheet['id']}", _chart("bars", "Lost", _table(ROWS[:1])))
    note = f"# Losses\n\n{graphic}\n"
    for rendered in (notes_pdf.render(case, title="Losses", text=note, light=True),
                     notes_html.render(case, title="Losses", text=note)):
        assert any("differ from the infographic's data" in message for message in rendered.warnings)


def test_the_route_leaves_where_the_rows_came_from_to_the_editor_when_asked(client):
    cid, case = _case(client)
    sheet = _sheet(case)
    graphic = _graphic(f"sheet:{sheet['id']}", _chart("bars", "Lost", _table(ROWS[:1])))
    said = client.post(f"/api/cases/{cid}/notes/infographic", json={"text": graphic}).json()["warnings"]
    assert any("differ from the infographic's data" in warning["message"] for warning in said)
    quiet = client.post(f"/api/cases/{cid}/notes/infographic", json={"text": graphic, "origins": False}).json()["warnings"]
    assert not any("data" in warning["message"] for warning in quiet)


# -- uses ---------------------------------------------------------------------------------------------


def test_a_sheet_an_infographic_or_a_chart_reads_is_used_and_its_delete_says_so(client):
    cid, case = _case(client)
    sheet = _sheet(case)
    other = _sheet(case, title="Sightings")
    graphic = _graphic(f"sheet:{sheet['id']}", _chart("bars", "Lost", _table()))
    chart = _chart("bars", "Seen", _table(), origin=f"sheet:{other['id']}")
    note = make_note(client, cid, title="Losses", content=f"# Losses\n\n{graphic}\n\n{chart}\n")
    assert {sheet["id"], other["id"]} <= uses_engine.used_refs(case)
    impact = client.post(f"/api/cases/{cid}/delete-impact", json={"ids": [sheet["id"]]}).json()
    assert {row["label"]: row["how"] for row in impact["touched"]} == {"Losses": [uses_engine.DATA_HOW]}
    impact = client.post(f"/api/cases/{cid}/delete-impact", json={"ids": [other["id"]]}).json()
    assert {row["label"]: row["how"] for row in impact["touched"]} == {"Losses": [uses_engine.FROM_HOW]}
    # a figure drawn from the note's own table is no lean of the note on itself
    own = make_note(client, cid, title="Own")
    client.put(f"/api/cases/{cid}/notes/{own['id']}", json={"text": (
        f"## Register\n\n{_table()}\n\n" + _graphic(f"note:{own['id']}#register", _chart("bars", "Lost", _table())) + "\n")})
    assert own["id"] not in uses_engine.used_refs(case)
    # the delete of the note goes without the infographic: its data is not the note's
    assert note["id"] not in uses_engine.used_refs(case)


# -- the routes the Data bar uses --------------------------------------------------------------------


def test_a_pasted_table_becomes_a_sheet_with_its_rows(client):
    cid, case = _case(client)
    made = client.post(f"/api/cases/{cid}/sheets", json={"title": "Vehicle register", "columns": COLUMNS, "rows": ROWS})
    assert made.status_code == 200, made.text
    read = sheets_engine.read(case, made.json()["id"])
    assert read["columns"][1:] == COLUMNS and [row[1:] for row in read["rows"]] == ROWS
    rows = client.post(f"/api/cases/{cid}/notes/figure/rows", json={"origin": f"sheet:{made.json()['id']}"}).json()
    assert rows["text"] == _table()


def test_the_rows_route_says_how_many_rows_a_chart_left_out(client):
    cid, case = _case(client)
    many = sheets_engine.create(case, "Long", ["Model"], [[f"V{number}"] for number in range(620)])
    answer = client.post(f"/api/cases/{cid}/notes/figure/rows", json={"origin": f"sheet:{many['id']}"}).json()
    assert answer["rows"] == 620
    assert len(re.findall(r"^\| V\d+ \|$", answer["text"], re.M)) == notecharts.notes_charts.MAX_ROWS
