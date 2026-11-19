"""The kind picker (`engine/notes_chart_picker.py`, `POST /notes/figure/kinds`): every
kind a table fits, drawn from its rows with the columns it would be written with, and
what the editor's chart card reads off the figure route (the fixes, the proposed title,
the kind). The engine's drawing is `tests/test_notes_charts.py`'s."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from azimut.engine import notecharts, notes_chart_kinds, notes_chart_picker, notes_charts

from test_notecharts import ARMOURED, _case
from test_notes_report import make_note

#: The register's shape: a row number, a model, a grade, a confidence, a state.
REGISTER = """| # | Identification | Grade | Conf. | State |
| --- | --- | --- | --- | --- |
| 1 | Streit Cougar | identified | 80% | burned |
| 2 | Streit Cougar | identified | 65% | burned, on its side |
| 3 | NIMR Ajban 440A | identified | 65% | abandoned |
| 4 | Harrow Tygor E1 | almost sure | 65% | abandoned |
| 5 | Harrow Tygor E1 | almost sure | 60% | burned |
| 6 | Model open | strong doubt | 30% | burned |
| 7 | Toyota pickup | set aside | 70% | destroyed |"""
FRONTEND = Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "notes" / "editor"


def _proposals(text: str) -> dict[str, dict[str, str]]:
    return {proposal.kind: proposal.settings for proposal in notes_chart_picker.proposals(notes_charts.parse_block(text))}


# -- what each kind is drawn by ----------------------------------------------------------------


def test_a_fresh_table_is_counted_by_rows_split_by_its_words_and_stacked_by_its_grades():
    found = _proposals(REGISTER)
    assert list(found) == notes_charts.fitting(notes_charts.parse_block(REGISTER).table)
    # a column of percentages and the row numbers are never what is counted
    assert found["bars"] == {"kind": "bars", "count": "rows", "by": "Identification"}
    assert found["stacked bars"] == {"kind": "stacked bars", "count": "rows", "colour by": "Grade", "by": "Identification"}
    # a kind of parts is drawn by the column of grades, not the first one
    for kind in ("pie", "donut", "segments", "pictograms", "waffle"):
        assert found[kind]["by"] == "Grade", kind


def test_a_table_with_one_column_of_whole_numbers_counts_it():
    found = _proposals(notes_charts.parse_block(ARMOURED).table.text())
    assert found["bars"]["count"] == "At least"
    assert found["stacked columns"] == {"kind": "stacked columns", "count": "At least", "colour by": "Grade", "by": "Model"}


def test_a_chart_changing_kind_keeps_its_own_settings_and_drops_what_the_new_kind_cannot_draw_by():
    block = ARMOURED.replace("kind: stacked bars", "kind: pictograms\nicon: dot")
    found = _proposals(notecharts.block_of(block))
    # the colour column is a pie's parts, written as its by; the icon goes
    assert found["pie"] == {"kind": "pie", "by": "Grade", "colour by": "", "icon": ""}
    assert found["pictograms"] == {"kind": "pictograms", "by": "Grade", "colour by": ""}
    # plain bars lose the column they would stack by
    assert found["bars"] == {"kind": "bars", "colour by": "", "icon": ""}
    assert found["stacked bars"] == {"kind": "stacked bars", "icon": ""}
    # a segmented bar by a column of twelve models takes the grades instead
    by_model = notecharts.block_of(ARMOURED).replace("colour by: Grade\n", "")
    assert _proposals(by_model)["segments"] == {"kind": "segments", "by": "Grade"}


def test_the_parts_column_reads_grades_first():
    table = notes_charts.parse_block(REGISTER).table
    low, high, whole = notes_chart_kinds.PARTS["pie"]
    assert [table.headers[column] for column in notes_chart_kinds.parts_columns(table, low, high, whole=whole)][0] == "Grade"


def test_a_new_chart_says_at_least_when_it_counts_a_floor_and_names_its_rows():
    block = notes_charts.parse_block(REGISTER)
    pie = notes_chart_picker.applied(block, _proposals(REGISTER)["pie"])
    assert notes_chart_picker.title_for(notes_charts.read(pie)) == "7 rows, by grade"
    floor = notes_charts.read(pie, note_text="Every figure here is a minimum.")
    assert notes_chart_picker.title_for(floor) == "At least 7 rows, by grade"
    stacked = notes_chart_picker.applied(block, _proposals(REGISTER)["stacked bars"])
    assert notes_chart_picker.title_for(notes_charts.read(stacked)) == "7 rows, by identification and grade"
    counted = notes_charts.parse_block(notes_charts.parse_block(ARMOURED).table.text())
    bars = notes_chart_picker.applied(counted, _proposals(counted.table.text())["bars"])
    assert notes_chart_picker.title_for(notes_charts.read(bars)) == "At least 41, by model"


def test_a_title_never_names_one_column_twice():
    block = notes_charts.parse_block("kind: pie\ncount: rows\nby: Grade\n" + REGISTER)
    assert notes_charts.propose_title(notes_charts.read(block)) == "7, by grade"


# -- the gallery ---------------------------------------------------------------------------------------


def test_the_gallery_draws_only_the_kinds_the_table_fits_from_its_own_rows():
    shown = notecharts.gallery(None, REGISTER)
    assert [item["kind"] for item in shown] == notes_charts.fitting(notes_charts.parse_block(REGISTER).table)
    assert "timeline" not in [item["kind"] for item in shown] and "line" not in [item["kind"] for item in shown]
    stacked = next(item for item in shown if item["kind"] == "stacked bars")
    assert stacked["label"] == "Stacked" and stacked["title"] == "7 rows, by identification and grade"
    assert ">Streit Cougar<" in stacked["svg"] and ">Harrow Tygor E1<" in stacked["svg"]
    # drawn without its title, each with an id of its own on one page
    assert stacked["title"] not in stacked["svg"].split("</title>", 1)[1]
    idents = [re.match(r'<svg [^>]*id="([^"]+)"', item["svg"]).group(1) for item in shown]
    assert len(set(idents)) == len(idents)


def test_the_kinds_route_answers_the_gallery_in_the_notes_look(client):
    cid, _ = _case(client)
    note = make_note(client, cid, title="Register", content=f"# Register\n\n{REGISTER}\n")
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "report", "font": "book"})
    answer = client.post(f"/api/cases/{cid}/notes/figure/kinds", json={"text": REGISTER, "note": note["id"]})
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["rows"] == 7
    assert [item["kind"] for item in body["kinds"]][:4] == ["bars", "columns", "stacked bars", "stacked columns"]
    assert "Literata" in body["kinds"][0]["svg"]
    # a chart's block reads the same, its settings kept
    kept = client.post(f"/api/cases/{cid}/notes/figure/kinds", json={"text": ARMOURED}).json()
    assert next(item for item in kept["kinds"] if item["kind"] == "pie")["settings"] == {"kind": "pie", "by": "Grade", "colour by": ""}


@pytest.mark.parametrize("body, status", [
    ({"text": "::: chart\ntitle: Nothing\n:::"}, 422),
    ({"text": REGISTER, "note": "../x"}, 422),
    ({"text": REGISTER, "note": "e_nowhere"}, 404),
    ({"text": "é" * 140_000}, 413),
])
def test_the_kinds_route_refuses_at_the_edge(client, body, status):
    cid, _ = _case(client)
    assert client.post(f"/api/cases/{cid}/notes/figure/kinds", json=body).status_code == status


# -- what the chart card reads off the figure route ------------------------------------------------------


def test_the_figure_route_says_the_fix_the_proposed_title_and_the_kind(client):
    cid, _ = _case(client)
    floor = ARMOURED.replace("title: At least 41", "title: 41")
    answer = client.post(f"/api/cases/{cid}/notes/figure", json={"text": floor})
    fixes = json.loads(answer.headers["x-note-warning-fixes"])
    assert len(fixes) == len(json.loads(answer.headers["x-note-warnings"]))
    assert fixes[0] == [["title", "At least 41 armoured vehicles, by model and grade"]]
    assert json.loads(answer.headers["x-chart-proposed-title"]) == "At least 41 armoured vehicles, by model and grade"
    assert json.loads(answer.headers["x-chart-kind"]) == {
        "name": "stacked bars", "label": "Stacked", "counts": True, "parts": False, "stacked": True, "up": False,
        "turns": "stacked columns", "style": "report"}
    booked = client.post(f"/api/cases/{cid}/notes/figure", json={"text": ARMOURED.replace("source:", "style: book\nsource:")})
    assert json.loads(booked.headers["x-chart-kind"])["style"] == "book"


def test_the_editor_reads_rows_of_its_own_note_itself(client):
    cid, _ = _case(client)
    note = make_note(client, cid, title="Register", content="# Register\n\n| Model |\n| --- |\n| Cougar |\n")
    chart = f"::: chart\ncount: rows\nby: Model\nsource: ours\nfrom: note:{note['id']}#register\n| Model |\n| --- |\n| Kirpi |\n:::"
    checked = client.post(f"/api/cases/{cid}/notes/figure", json={"text": chart})
    assert any("rows differ" in said for said in json.loads(checked.headers["x-note-warnings"]))
    left = client.post(f"/api/cases/{cid}/notes/figure", json={"text": chart, "origins": False})
    assert not any("rows differ" in said for said in json.loads(left.headers["x-note-warnings"]))


# -- where the rows came from --------------------------------------------------------------------------


def test_from_names_the_nth_table_under_a_heading_and_never_a_charts_own_rows():
    text = ("# A\n\n::: chart\n| q |\n| --- |\n| 9 |\n:::\n\n| x |\n| --- |\n| 1 |\n\n## Register\n\n```\n## Code\n| c |\n| --- |\n```\n\n"
            "| y |\n| --- |\n| 2 |\n\n| w |\n| --- |\n| 3 |\n")
    headers = {anchor: (table.headers if (table := notecharts._table_under(text, anchor)) else None)
               for anchor in ("", "/2", "/3", "register", "register/2", "register/3", "code")}
    assert headers == {"": ["x"], "/2": ["y"], "/3": ["w"], "register": ["y"], "register/2": ["w"], "register/3": None,
                       "code": None}


# -- the editor writes the block as the engine reads it -----------------------------------------------------


def test_the_editor_writes_settings_in_the_engines_order_and_words():
    source = (FRONTEND / "chartText.js").read_text(encoding="utf-8")
    order = re.search(r"WRITTEN_ORDER = \[([^\]]+)\]", source).group(1)
    last = re.search(r"WRITTEN_LAST = \[([^\]]+)\]", source).group(1)
    assert re.findall(r"'([^']+)'", order) == list(notes_charts.WRITTEN_ORDER)
    assert re.findall(r"'([^']+)'", last) == list(notes_charts.WRITTEN_LAST)
    keys = dict(re.findall(r"'?([a-z][a-z ]*)'?: '([a-z ]+)'", re.search(r"CHART_KEYS = \{(.*?)\};", source, re.S).group(1)))
    assert {key: value for key, value in keys.items() if key in notes_charts.KEYS} == notes_charts.KEYS
    every_kind_key = {key for kind in notes_charts.kinds() for key in kind.keys}
    assert every_kind_key <= set(keys)


def test_a_column_of_confidences_is_never_what_a_new_chart_counts():
    table = notes_charts.parse_block("| # | Model | Conf. |\n| --- | --- | --- |\n| 1 | A | 80 |\n| 2 | B | 65 |").table
    assert notes_chart_picker.count_column(table) == notes_charts.ROWS
    both = notes_charts.parse_block("| Model | Confidence | At least |\n| --- | --- | --- |\n| A | 80 | 3 |\n| B | 65 | 5 |").table
    assert notes_chart_picker.count_column(both) == "At least"
