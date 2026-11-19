"""A chart from scratch: what each kind's form writes, read by the engine, and what *Fill
from the case* proposes (`engine/notes_chart_fill.py`, `api/notecharts.py`).

What must hold: every block a form writes (`tests/fixtures/chart_forms.json`, written byte
for byte by `chartFormText.test.js`) is drawn as its kind from its rows; a kind's empty
starter is a table the engine reads; a timeline of one event is drawn; a waffle's whole is
no part of what it counts. The case's events are its proofs' days and its Timeline's
Claims within a period, a proof's own dating Claim never twice, a refuted one said so; a
count reads a note's table or a sheet by one column and a split, sums a column of numbers
and says when one is a floor, and says what it left out. Nothing is written.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from azimut.engine import links as link_engine
from azimut.engine import notecharts, notes_chart_fill, notes_charts
from azimut.engine import notes_infographic as ig
from azimut.engine import sheets as sheets_engine
from azimut.workspace import Case

from notecase import make_case, make_note

FORMS = json.loads((Path(__file__).parent / "fixtures" / "chart_forms.json").read_text(encoding="utf-8"))


def _case(client, name="Forms") -> tuple[str, Case]:
    cid = make_case(client, name)
    return cid, Case.open(cid)


# -- what the forms write -------------------------------------------------------------------------------


@pytest.mark.parametrize("form", FORMS["forms"], ids=[form["name"] for form in FORMS["forms"]])
def test_each_form_block_is_drawn_as_its_kind_from_its_rows(form):
    chart = notecharts.read(None, notecharts.block_of(form["block"]))
    assert chart.layout.kind == form["engine"]["kind"] == notes_charts.effective_kind(chart.block).name
    assert chart.layout.lines == form["engine"]["lines"]
    assert chart.proposed == form["engine"]["proposed"]
    # nothing in a form's block is unread, missing or left out
    assert [kind for _, kind, _ in chart.warnings if kind not in ("unsourced", "other")] == []
    assert not chart.block.unread
    assert not any("not drawn" in note or "left out" in note for note in chart.layout.notes)


@pytest.mark.parametrize("kind", list(FORMS["starters"]))
def test_each_starter_is_the_kind_and_its_columns_with_no_row(kind):
    block = notecharts.block_of(FORMS["starters"][kind])
    chart = notecharts.read(None, block)
    assert chart.drawable and chart.block.kind == kind
    assert chart.block.table is not None and chart.block.table.rows == []
    assert notes_charts.kind_named(kind) is not None


def test_a_timeline_of_one_event_is_drawn_by_its_column_of_days():
    one = "::: chart\nkind: timeline\n| When | What happened |\n| --- | --- |\n| 18 Oct 2026 | Giants Brigades on a peak |\n:::"
    chart = notecharts.read(None, notecharts.block_of(one))
    assert chart.layout.lines == ["18 Oct 2026: Giants Brigades on a peak"]
    assert [kind for _, kind, _ in chart.warnings if kind == "missing"] == []
    # a column of one day not named for days is still no column of days
    other = one.replace("| When |", "| Note |")
    assert "has no column of days" in " ".join(message for message, _, _ in notecharts.read(None, notecharts.block_of(other)).warnings)


def test_a_waffle_whole_written_as_a_row_is_not_counted():
    block = next(form["block"] for form in FORMS["forms"] if form["kind"] == "waffle")
    reading = notes_charts.read(notes_charts.parse_block(notecharts.block_of(block)))
    assert reading.total == 23
    assert notecharts.read(None, notecharts.block_of(block)).proposed == "23, by part"


def test_rows_a_form_wrote_say_so_and_never_take_an_infographics_data():
    own = "::: chart\nkind: donut\ncount: Count\nby: Category\nrows: own\n| Category | Count |\n| --- | ---: |\n| MRAP | 23 |\n:::"
    block = notes_charts.parse_block(notecharts.block_of(own))
    assert block.own_rows and not block.unread
    # written back where the Notebook writes it, after the source and from: lines
    assert notes_charts.block_text(block).split("\n")[1:5] == ["kind: donut", "count: Count", "by: Category", "rows: own"]
    assert notes_charts.parse_block("rows: theirs\n| A |\n| --- |").unread[0][2] == "unreadable"
    page = ig.parse_block(f"data: sheet:e_s1\n\n{own}\n\n{own.replace('rows: own', '')}")
    # the same columns as the data: the one its form wrote keeps its rows, the other takes the data
    assert [ig.inherits(panel, ["Category", "Count"]) for panel in page.panels] == [False, True]


# -- the case's events ----------------------------------------------------------------------------------


def _proof(case: Case, title: str, when: str = "", notes: str = "") -> str:
    attrs = {"kind": "image", "spec": f"proofs/.meta/{title}.json", **({"when": when} if when else {}),
             **({"notes": notes} if notes else {})}
    return case.add_entity("proof", title, attrs, by="proof-composer")["id"]


def _claim(case: Case, statement: str, when: str, *, by: str = "user", **attrs: str) -> str:
    return case.add_entity("claim", statement, {"when": when, "time_role": "occurred", **attrs}, by=by)["id"]


def test_events_are_the_proofs_days_and_the_claims_within_a_period(client):
    cid, case = _case(client)
    p17 = _proof(case, "Proof 17", "2026-10-19~", "Fighters on the heights")
    _proof(case, "Proof 50")  # no day: said, never listed
    _proof(case, "Proof 55", "2026-11-10/2026-11-14", "Presence northeast of Huwayrib")
    # the composer's own Claim dating Proof 17 is that proof's row, not a second one
    dating = _claim(case, "Material of Proof 17 was taken", "2026-10-19~", by="proof-composer",
                    proof="proofs/.meta/Proof 17.json")
    case.add_link(dating, p17, link_engine.CITES, by="proof-composer")
    _claim(case, "The airport falls", "2026-11-13")
    _claim(case, "A strike on the port", "2026-11", confidence="refuted")
    _claim(case, "Before it all", "2026-09-01")

    every = notes_chart_fill.case_events(case)
    assert [(item["day"], item["type"], item["what"]) for item in every["items"]] == [
        ("2026-09-01", "claim", "Before it all"),
        ("2026-10-19", "proof", "Fighters on the heights"),
        ("2026-11-01", "claim", "A strike on the port"),
        ("2026-11-10", "proof", "Presence northeast of Huwayrib"),
        ("2026-11-13", "claim", "The airport falls"),
    ]
    assert every["undated"] == 1 and every["total"] == 5
    assert (every["first"], every["last"]) == ("2026-09-01", "2026-11-30")
    port = every["items"][2]
    assert port["precision"] == "month" and port["last"] == "2026-11-30" and port["refuted"] is True
    heights = every["items"][1]
    assert heights["approximate"] is True and heights["last"] == "" and heights["precision"] == "day"
    assert every["items"][3]["last"] == "2026-11-14"

    # a period keeps what overlaps it: the month-long claim and the five-day proof reach into it
    inside = notes_chart_fill.case_events(case, start=date(2026, 11, 12), end=date(2026, 11, 20))
    assert [item["what"] for item in inside["items"]] == [
        "A strike on the port", "Presence northeast of Huwayrib", "The airport falls"]
    assert inside["first"] == "2026-09-01"
    with pytest.raises(ValueError):
        notes_chart_fill.case_events(case, start=date(2026, 11, 2), end=date(2026, 11, 1))

    # the route reads the same, and refuses a day it cannot read
    res = client.get(f"/api/cases/{cid}/notes/figure/events", params={"from": "2026-11-12", "to": "2026-11-20"})
    assert res.status_code == 200 and [item["what"] for item in res.json()["items"]] == [
        "A strike on the port", "Presence northeast of Huwayrib", "The airport falls"]
    assert client.get(f"/api/cases/{cid}/notes/figure/events", params={"from": "12/11/2026"}).status_code == 422
    assert client.get(f"/api/cases/{cid}/notes/figure/events", params={"from": "2026-11-20", "to": "2026-11-12"}).status_code == 422


def test_events_are_read_on_the_case_clock(client):
    _, case = _case(client)
    _claim(case, "Late at night", "2026-10-19T22:30:00Z")
    assert notes_chart_fill.case_events(case)["items"][0]["day"] == "2026-10-19"
    assert notes_chart_fill.case_events(case, zone="Asia/Aden")["items"][0]["day"] == "2026-10-20"


# -- counts ---------------------------------------------------------------------------------------------


REGISTER = (["#", "Model", "Class", "Grade", "Seen"], [
    ["1", "Streit Cougar", "MRAP", "Identified", "≥ 3"],
    ["2", "Streit Cougar", "MRAP", "Almost sure", "2"],
    ["3", "Al-Wahsh", "APC", "Identified", "4"],
    ["4", "Toyota Hilux", "", "Identified", "1"],
    ["5", "Al-Wahsh", "APC", "Identified", "a few"],
    ["Total", "", "", "", "10"],
])


def test_counts_read_one_column_split_by_another_or_sum_a_column():
    headers, rows = REGISTER
    rows_counted = notes_chart_fill.counts(headers, rows, by="Class")
    assert rows_counted["rows"] == [{"value": "MRAP", "split": "", "count": "2"}, {"value": "APC", "split": "", "count": "2"}]
    assert (rows_counted["blank"], rows_counted["totals"], rows_counted["floor"]) == (1, 1, False)

    split = notes_chart_fill.counts(headers, rows, by="model", split="Grade")
    assert split["rows"] == [
        {"value": "Streit Cougar", "split": "Identified", "count": "1"},
        {"value": "Streit Cougar", "split": "Almost sure", "count": "1"},
        {"value": "Al-Wahsh", "split": "Identified", "count": "2"},
        {"value": "Toyota Hilux", "split": "Identified", "count": "1"},
    ]

    # a sum adds the numbers, a floor among them making it a floor, a cell that is no number left out
    summed = notes_chart_fill.counts(headers, rows, by="Model", amount="Seen")
    assert summed["rows"] == [{"value": "Streit Cougar", "split": "", "count": "5"}, {"value": "Al-Wahsh", "split": "", "count": "4"},
                              {"value": "Toyota Hilux", "split": "", "count": "1"}]
    assert (summed["floor"], summed["unread"]) == (True, 1)
    with pytest.raises(KeyError):
        notes_chart_fill.counts(headers, rows, by="Colour")


def test_counts_along_days_are_one_day_however_written_in_the_days_order():
    headers = ["Day", "Side", "Strikes"]
    rows = [["2026-10-05", "North", "3"], ["4 Oct 2026", "North", "1"], ["5 Oct 2026", "South", "2"],
            ["sometime", "North", "9"]]
    found = notes_chart_fill.counts(headers, rows, by="Day", split="Side", amount="Strikes", days=True)
    assert found["rows"] == [{"value": "4 Oct 2026", "split": "North", "count": "1"},
                             {"value": "5 Oct 2026", "split": "North", "count": "3"},
                             {"value": "5 Oct 2026", "split": "South", "count": "2"}]
    assert found["unread"] == 1 and found["values"] == 2


def test_counts_read_a_note_table_or_a_sheet_through_the_route(client):
    cid, case = _case(client)
    note = make_note(client, cid, "Register",
                     "## Seen\n\n| Model | Class |\n| --- | --- |\n| Cougar | MRAP |\n| M-ATV | MRAP |\n| BMP | APC |\n")
    sheet = sheets_engine.create(case, "Sightings", ["Model", "Seen"], [["Cougar", "2"], ["BMP", "at least 3"]])
    ask = lambda **body: client.post(f"/api/cases/{cid}/notes/figure/counts", json=body)  # noqa: E731

    from_note = ask(origin=f"note:{note['id']}#seen", by="Class")
    assert from_note.status_code == 200, from_note.text
    assert from_note.json()["rows"] == [{"value": "MRAP", "split": "", "count": "2"}, {"value": "APC", "split": "", "count": "1"}]
    assert from_note.json()["name"] == "Register"
    from_sheet = ask(origin=f"sheet:{sheet['id']}", by="Model", amount="Seen").json()
    assert from_sheet["rows"] == [{"value": "Cougar", "split": "", "count": "2"}, {"value": "BMP", "split": "", "count": "3"}]
    assert from_sheet["floor"] is True
    assert ask(origin="sheet:e_gone0000", by="Model").json()["found"] is False
    assert ask(origin=f"sheet:{sheet['id']}", by="Colour").status_code == 422
    assert ask(origin="layer:Vehicles", by="Model").status_code == 422
    # nothing was written
    assert [row[-2:] for row in notecharts.origin_rows(case, f"sheet:{sheet['id']}")[2]] == [["Cougar", "2"], ["BMP", "at least 3"]]
