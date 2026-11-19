"""A chart in a note (`engine/notes_charts.py`): the `::: chart` block, the numbers it reads,
the check's words, the layout's maths, the case's colours, and the two painters.

The acceptance chart is the reference's "At least 41 armoured vehicles, by model and grade"
(`fixtures/notes_charts/armoured.md`); the register is the reference's sixty vehicles, one row
each, their groups named by letter (`fixtures/notes_charts/groups.md`).
"""

from __future__ import annotations

import io
import re
from pathlib import Path
from xml.etree import ElementTree

import pytest
from PIL import Image

from azimut.engine import layerediting, notes_charts as nc, notes_html
from azimut.workspace import Case

FIXTURES = Path(__file__).parent / "fixtures" / "notes_charts"
SVG_NS = "{http://www.w3.org/2000/svg}"


def _body(name: str) -> str:
    """A fixture's block, without its two fence lines."""
    lines = (FIXTURES / name).read_text(encoding="utf-8").rstrip("\n").split("\n")
    assert lines[0] == "::: chart" and lines[-1] == ":::"
    return "\n".join(lines[1:-1])


def _block(text: str) -> nc.ChartBlock:
    return nc.parse_block(text)


def _messages(checks) -> list[str]:
    return [check.message for check in checks]


TABLE = "| Model | Grade | At least |\n| --- | --- | ---: |\n"


# -- the grammar -------------------------------------------------------------------------


def test_the_acceptance_block_reads_every_setting_and_its_table():
    block = _block(_body("armoured.md"))
    assert block.kind == "stacked bars"
    assert block.title == "At least 41 armoured vehicles, by model and grade"
    assert block.caption.startswith("Each vehicle counted once")
    assert (block.count, block.by, block.colour_by) == ("At least", "Model", "Grade")
    assert block.order == ["Confirmed", "Almost sure", "Strong doubt"]
    assert block.last == ["Model open"]
    assert block.source == "our vehicle register"
    assert block.table is not None
    assert block.table.headers == ["Model", "Grade", "At least"]
    assert block.table.align == ["", "", "right"]
    assert len(block.table.rows) == 13
    assert block.unread == []


def test_the_block_is_written_back_as_it_was_written():
    text = (FIXTURES / "armoured.md").read_text(encoding="utf-8").rstrip("\n")
    assert nc.block_text(_block(_body("armoured.md"))) == text
    groups = (FIXTURES / "groups.md").read_text(encoding="utf-8").rstrip("\n")
    assert nc.block_text(_block(_body("groups.md"))) == groups


def test_every_setting_survives_a_round_trip_in_the_notebooks_order():
    body = (
        "show: chart and table\nstyle: book\nfrom: note:n_1#register\nsort: a to z\nhighlight: UAE\n"
        "only: Grade is not Set aside\nonly: Class is Armoured\ncolours: Confirmed #184F95, UAE #eb6834\n"
        "last: Model open\norder: Confirmed, Almost sure\ncolour by: Grade\nby: Model\ncount: rows\n"
        "caption: One row a vehicle.\ntitle: At least 41 vehicles\nkind: columns\nsource: our register\n"
        "| Model | Grade | Class |\n| --- | --- | --- |\n| Streit Cougar | Confirmed | Armoured |"
    )
    written = nc.block_text(_block(body))
    assert written.split("\n")[1:14] == [
        "kind: columns", "title: At least 41 vehicles", "caption: One row a vehicle.", "count: rows",
        "by: Model", "colour by: Grade", "order: Confirmed, Almost sure",
        "colours: Confirmed #184f95, UAE #eb6834", "only: Grade is not Set aside", "only: Class is Armoured",
        "highlight: UAE", "sort: a to z", "last: Model open",
    ]
    assert written.split("\n")[14:18] == ["show: chart and table", "source: our register",
                                          "from: note:n_1#register", "style: book"]
    again = _block("\n".join(written.split("\n")[1:-1]))
    assert nc.block_text(again) == written
    assert again.shows_table()


@pytest.mark.parametrize("line, kind", [
    ("kind: bars", "bars"), ("kind: Column chart", "columns"), ("type: stacked", "stacked bars"),
    ("kind: stacked columns", "stacked columns"), ("kind: bars\nbars: up", "columns"),
    ("kind: columns\nbars: across", "bars"), ("kind: stacked\nbars: up", "stacked columns"),
])
def test_a_kind_reads_in_any_of_its_words_and_bars_turn_it(line, kind):
    block = _block(f"{line}\n{TABLE}| A | Confirmed | 1 |")
    assert nc.effective_kind(block).name == kind
    assert f"kind: {kind}" in nc.block_text(block)
    assert "bars:" not in nc.block_text(block)


@pytest.mark.parametrize("written", ["colour: Grade", "color by: Grade", "Coloured by: Grade", "colors by: x"])
def test_the_colour_column_reads_in_both_spellings(written):
    block = _block(f"{written}\n{TABLE}| A | Confirmed | 1 |")
    if written.startswith("colors by"):
        assert block.colour_by == "" and block.unread
    else:
        assert block.colour_by == "Grade"


def test_a_table_is_kept_line_for_line_and_a_chip_keeps_its_pipe():
    body = "|Model|Proof|At least|\n|:--|:-:|--:|\n| A \\| B | [[entity:e_1|Proof 1]] | 3 |"
    block = _block(body)
    assert block.table.align == ["left", "center", "right"]
    assert block.table.rows[0] == ["A | B", "Proof 1", "3"]
    assert block.table.text() == body
    assert nc.split_row("| [[entity:e_1|Proof 1]] | a \\| b |") == ["[[entity:e_1|Proof 1]]", "a \\| b"]
    assert nc.table_text(["Model", "Proof"], [["A | B", "[[entity:e_1|Proof 1]]"]], ["", "right"]) == (
        "| Model | Proof |\n| --- | ---: |\n| A \\| B | [[entity:e_1|Proof 1]] |")


def test_blocks_are_found_in_a_note_but_not_in_a_code_fence():
    note = ("Intro\n\n::: chart\ntitle: One\n| A | B |\n| --- | --- |\n| x | 1 |\n:::\n\n"
            "```\n::: chart\ntitle: Fenced\n:::\n```\n\n::: chart\ntitle: Two\n:::\n")
    assert [block.title for block in nc.blocks_in(note)] == ["One", "Two"]


@pytest.mark.parametrize("body, said", [
    ("colur: Grade\n" + TABLE + "| A | Confirmed | 1 |", '"colur" is not a chart setting'),
    ("kind: radar\n" + TABLE + "| A | Confirmed | 1 |", '"radar" is not a kind of chart (Bars, Columns'),
    ("Some words here\n" + TABLE + "| A | Confirmed | 1 |", 'cannot read "Some words here"'),
    ("show: maybe\n" + TABLE + "| A | Confirmed | 1 |", 'cannot read "show: maybe"'),
    ("only: Grade\n" + TABLE + "| A | Confirmed | 1 |", 'cannot read "only: Grade"'),
    ("colours: Confirmed blue\n" + TABLE + "| A | Confirmed | 1 |", 'cannot read "colours: Confirmed blue"'),
    ("title: One\ntitle: Two\n" + TABLE + "| A | Confirmed | 1 |", 'says "title" twice: the first one counts'),
    (TABLE + "| A | Confirmed | 1 |\n\n| X |\n| --- |\n| y |", "holds a second table: a chart reads one"),
    ("title: Empty", "holds no table: write its rows under its settings"),
    ("| Model | At least |\n| A | 1 |", "its table needs a line of dashes under its header"),
])
def test_a_line_the_block_cannot_read_is_named_by_the_check(body, said):
    checks = nc.read(_block(body)).checks
    assert any(said in message for message in _messages(checks)), _messages(checks)


def test_a_check_points_at_its_line_in_the_block():
    block = _block("title: Vehicles\ncolur: Grade\n" + TABLE + "| A | Confirmed | 1 |")
    check = next(check for check in nc.read(block).checks if "colur" in check.message)
    assert check.line == 1
    assert check.as_warning() == (check.message, "other", 1)


@pytest.mark.parametrize("body", [
    "", ":::", "|", "| a |", "kind:", ":", "title:\n|", "| a | b |\n| - | - |\n| 1 |", "count: rows\n| a |\n| --- |",
    "only: x is\n| a |\n| --- |\n| |", "colour by: a\nby: a\ncount: a\n| a |\n| --- |\n| -1 |", "\x00\n| \x00 |",
    "|" * 300, "| a |\n" * 600,
])
def test_no_block_breaks_the_reading_or_the_painters(body):
    block = _block(body)
    chart = nc.layout(block)
    ElementTree.fromstring(nc.svg(chart))
    assert nc.render_png(chart, 320)[:8] == b"\x89PNG\r\n\x1a\n"


# -- numbers -------------------------------------------------------------------------------


@pytest.mark.parametrize("cell, value, floor", [
    ("8", 8, False), ("1,234", 1234, False), ("1 234", 1234, False), ("≥ 41", 41, True), ("41+", 41, True),
    ("at least 60", 60, True), ("**35**", 35, False), ("$8.4M", 8.4e6, False), ("12.5%", 12.5, False),
    ("~15", 15, False), ("0", 0, False), ("≥8", 8, True),
])
def test_a_number_reads_as_a_cell_writes_it(cell, value, floor):
    number = nc.read_number(cell)
    assert isinstance(number, nc.Number)
    assert number.value == pytest.approx(value)
    assert number.floor is floor


@pytest.mark.parametrize("cell, why", [
    ("", "empty"), ("–", "empty"), ("-3", "negative"), ("−2", "negative"), ("$8.3M-$15.7M", "range"),
    ("8 to 15", "range"), ("n/a", "text"), ("360 m", "text"), ("min 5", "text"),
])
def test_a_cell_that_is_no_number_says_why(cell, why):
    assert nc.read_number(cell) == why


def test_numbers_print_with_their_thousands_and_ticks_compact_past_ten_thousand():
    assert nc.number_text(1234) == "1,234"
    assert nc.number_text(2.5) == "2.5"
    assert nc.number_text(8.0) == "8"
    assert nc.tick_text(20000, 40000) == "20K"
    assert nc.tick_text(2500000, 4000000) == "2.5M"
    assert nc.tick_text(5000, 8000) == "5,000"


@pytest.mark.parametrize("largest, ticks", [
    (8, (0, 2, 4, 6, 8)), (12, (0, 4, 8, 12)), (41, (0, 10, 20, 30, 40, 50)), (7, (0, 2, 4, 6, 8)),
    (25, (0, 5, 10, 15, 20, 25)), (1, (0, 1)), (3, (0, 1, 2, 3)), (0, (0, 1)), (60, (0, 20, 40, 60)),
])
def test_the_scale_steps_round_and_wastes_least(largest, ticks):
    assert nc.nice_scale(largest).ticks == ticks


def test_a_scale_of_fractions_steps_below_one():
    assert nc.nice_scale(0.6, whole=False).ticks[-1] >= 0.6
    assert nc.nice_scale(0.6, whole=False).ticks[1] < 1


# -- what the rows say -------------------------------------------------------------------------


def test_the_acceptance_chart_reads_25_10_and_6_grades_for_41_vehicles():
    reading = nc.read(_block(_body("armoured.md")))
    assert reading.values == ["Confirmed", "Almost sure", "Strong doubt"]
    assert reading.totals == {"Confirmed": 25, "Almost sure": 10, "Strong doubt": 6}
    assert reading.total == 41
    assert reading.floor and reading.graded
    names = [category.name for category in reading.categories]
    assert names[:3] == ["Streit Cougar", "Harrow Tygor E1", "Oshkosh M-ATV"]
    assert names[-1] == "Model open" and reading.categories[-1].last
    harrow = reading.categories[1]
    assert [(segment.value, segment.amount) for segment in harrow.segments] == [
        ("Confirmed", 1), ("Almost sure", 7), ("Strong doubt", 0)]
    assert _messages(reading.checks) == []


def test_a_register_counts_its_rows_by_group_and_names_the_rows_with_none():
    reading = nc.read(_block(_body("groups.md")))
    totals = {category.name: category.total for category in reading.categories}
    assert totals == {"Group A": 8, "Group B": 11, "Group C": 8, "Group D": 5, "Group E": 7, "Group F": 12}
    assert reading.total == 51 and reading.all_rows == 60
    assert any('leaves out 9 rows with nothing in "Group"' in message for message in _messages(reading.checks))
    chart = nc.layout(_block(_body("groups.md")))
    assert "9 rows with no group are not drawn." in chart.notes


def test_one_number_column_is_counted_and_two_leave_the_rows_counted():
    one = nc.read(_block("| Model | Seen |\n| --- | --- |\n| A | 3 |\n| B | 5 |"))
    assert one.count == 1 and one.total == 8
    two = nc.read(_block("| Model | Seen | Lost |\n| --- | --- | --- |\n| A | 3 | 1 |\n| B | 5 | 2 |"))
    assert two.count is None and two.total == 2


def test_a_total_and_a_bold_subtotal_are_left_out_and_named():
    body = (TABLE + "| A | Confirmed | 3 |\n| **Identified armoured** | | **3** |\n| B | Confirmed | 2 |\n"
            "| All-terrain | Confirmed | 1 |\n| Total | | 6 |")
    reading = nc.read(_block(body))
    assert reading.total == 6
    said = _messages(reading.checks)
    assert any('leaves out the row "Identified armoured", which reads as a total' in message for message in said)
    assert any('leaves out the row "Total", which reads as a total' in message for message in said)


@pytest.mark.parametrize("cell, said", [
    ("n/a", 'the row "A" holds "n/a" in "At least", not a number, so it is left out.'),
    ("-3", 'the row "A" holds "-3", below zero, so it is left out: a chart of counts draws none.'),
    ("$8.3M-$15.7M", 'the row "A" holds a range, "$8.3M-$15.7M", so it is left out: give its floor a column'),
    ("", 'the row "A" has no number in "At least", so it is left out.'),
])
def test_a_row_with_no_number_is_left_out_said_and_noted(cell, said):
    reading = nc.read(_block(f"title: At least 2\n{TABLE}| A | Confirmed | {cell} |\n| B | Confirmed | 2 |"))
    assert reading.total == 2
    assert any(said in message for message in _messages(reading.checks)), _messages(reading.checks)
    assert "1 row with no number is not drawn." in nc.layout(reading.block).notes


def test_a_negative_value_is_refused_not_drawn():
    chart = nc.layout(_block(f"title: At least 4\n{TABLE}| A | Confirmed | -4 |\n| B | Confirmed | 4 |"))
    assert [bar.name for bar in chart.bars] == ["B"]
    assert all(bar.total >= 0 for bar in chart.bars)


def test_only_keeps_rows_says_so_on_the_figure_and_never_repaints():
    body = _body("groups.md")
    whole = nc.read(_block(body))
    kept = nc.read(_block(body.replace("source:", "only: Grade is Confirmed, Almost sure\nsource:")))
    assert kept.total == 29
    assert {value: paint.colour for value, paint in kept.paints.items()} == {
        value: paint.colour for value, paint in whole.paints.items()}
    chart = nc.layout(kept.block)
    assert "Only rows where Grade is Confirmed, Almost sure: 29 of 60." in chart.notes
    gone = nc.read(_block(body.replace("source:", "only: Side is Ours\nsource:")))
    assert any('keeps rows by "Side", a column its table does not have' in message for message in _messages(gone.checks))


def test_bars_of_several_colours_are_stacked_and_the_check_proposes_the_kind():
    reading = nc.read(_block(_body("armoured.md").replace("kind: stacked bars", "kind: bars")))
    check = next(check for check in reading.checks if "holds several values" in check.message)
    assert check.fix == (("kind", "stacked bars"),)
    assert [segment.amount for segment in reading.categories[1].segments if segment.amount] == [1, 7]


def test_too_many_columns_propose_bars():
    rows = "\n".join(f"| Place {index} | {index} |" for index in range(16))
    reading = nc.read(_block(f"kind: columns\n| Place | Count |\n| --- | --- |\n{rows}"))
    check = next(check for check in reading.checks if "too many for their names" in check.message)
    assert check.fix == (("kind", "bars"),)


def test_kinds_that_fit_a_table_are_named_for_the_picker():
    assert "stacked bars" in nc.fitting(_block(_body("armoured.md")).table)
    plain = _block("| Video | Seen |\n| --- | --- |\n| One | 33 |\n| Two | 46 |").table
    # two parts make no pie (`test_notes_chart_kinds` holds each kind's own rule)
    assert nc.fitting(plain) == ["bars", "columns", "segments", "pictograms", "silhouette rows", "waffle", "circles"]


# -- honesty -----------------------------------------------------------------------------------


def test_a_floor_column_asks_for_at_least_in_the_title_and_proposes_one():
    body = _body("armoured.md").replace("title: At least 41 armoured vehicles, by model and grade",
                                        "title: Armoured vehicles by model and grade")
    reading = nc.read(_block(body))
    check = next(check for check in reading.checks if "counts at least" in check.message)
    assert check.message == '"Armoured vehicles by model and grade" counts at least: say so in its title.'
    assert check.fix == (("title", "At least 41 armoured vehicles, by model and grade"),)
    assert check.line == 1


@pytest.mark.parametrize("header, cell, note, floor", [
    ("At least", "8", "", True), ("Count (at least)", "8", "", True), ("Minimum", "8", "", True),
    ("Count", "≥ 8", "", True), ("Count", "8+", "", True), ("Count", "8", "Every figure is a minimum.", True),
    ("Count", "8", "The counts are floors.", True), ("Count", "8", "Counted twice.", False),
    ("Duration (min)", "8", "", False), ("Floor", "8", "", False),
])
def test_a_count_is_a_floor_by_its_column_its_cells_or_the_notes_words(header, cell, note, floor):
    block = _block(f"title: Vehicles by model\n| Model | {header} |\n| --- | --- |\n| A | {cell} |")
    reading = nc.read(block, note_text=note)
    assert reading.floor is floor
    assert any("counts at least" in message for message in _messages(reading.checks)) is floor


def test_a_title_that_says_at_least_is_left_alone_and_one_with_a_number_is_prefixed():
    reading = nc.read(_block("title: 41 armoured vehicles, by model\n| Model | At least |\n| --- | --- |\n| A | 41 |"))
    check = next(check for check in reading.checks if "counts at least" in check.message)
    assert check.fix == (("title", "At least 41 armoured vehicles, by model"),)
    fine = nc.read(_block("title: At least 41, by model\n| Model | At least |\n| --- | --- |\n| A | 41 |"))
    assert not any("counts at least" in message for message in _messages(fine.checks))


def test_a_chart_with_no_title_is_given_one_from_its_data():
    chart = nc.layout(_block("count: rows\nby: Model\n| Model |\n| --- |\n| A |\n| A |\n| B |"),
                      note_text="Every figure is a minimum.")
    assert chart.title == "At least 3, by model"


def test_the_axis_says_at_least_with_what_it_counts():
    chart = nc.layout(_block(_body("armoured.md")))
    assert any(isinstance(mark, nc.Text) and mark.text == "Armoured vehicles, at least" for mark in _flat(chart))


def test_the_legend_keeps_every_grade_even_at_zero():
    body = _body("armoured.md").replace("order: Confirmed, Almost sure, Strong doubt",
                                        "order: Confirmed, Almost sure, Strong doubt, Set aside")
    chart = nc.layout(_block(body))
    assert [(swatch.value, swatch.total) for swatch in chart.legend] == [
        ("Confirmed", 25), ("Almost sure", 10), ("Strong doubt", 6), ("Set aside", 0)]
    assert any('"Set aside" in its order is in no row, so its legend shows it at 0' in check.message
               for check in chart.checks)
    words = [mark.text for mark in _flat(chart) if isinstance(mark, nc.Text)]
    assert "Set aside" in words


def test_a_grade_filtered_out_stays_in_the_legend_at_zero():
    body = _body("armoured.md").replace("source:", "only: Grade is not Strong doubt\nsource:")
    chart = nc.layout(_block(body))
    assert ("Strong doubt", 0) in [(swatch.value, swatch.total) for swatch in chart.legend]


def test_the_credit_line_names_the_sources_the_table_cites():
    body = ("| Model | Seen | Source |\n| --- | --- | --- |\n"
            "| A | 3 | [[entity:e_1|Yemeni Military Media]] |\n| B | 2 | [Al Jazeera](https://aljazeera.com/x) |\n"
            "| C | 1 | [[entity:e_1|Yemeni Military Media]] |")
    assert nc.layout(_block(body)).credit == "Sources: Yemeni Military Media; Al Jazeera"
    assert nc.layout(_block("source: our vehicle register\n" + body)).credit == (
        "Sources: our vehicle register; Yemeni Military Media; Al Jazeera")
    assert nc.layout(_block("source: Footage: two videos\n" + body)).credit == (
        "Sources: Footage: two videos; Yemeni Military Media; Al Jazeera")
    many = "| Model | Seen | Source |\n| --- | --- | --- |\n" + "\n".join(
        f"| M{index} | 1 | [[entity:e_{index}|Source {index}]] |" for index in range(7))
    assert nc.layout(_block(many)).credit == "Sources: Source 0; Source 1; Source 2; Source 3; and 3 more"


def test_a_chart_that_cites_nothing_is_said_by_the_check():
    reading = nc.read(_block("| Model | Seen |\n| --- | --- |\n| A | 3 |"))
    check = next(check for check in reading.checks if "cites no source" in check.message)
    assert check.kind == nc.UNSOURCED


# -- colours ------------------------------------------------------------------------------------


@pytest.mark.parametrize("value, grade", [
    ("Confirmed", "confirmed"), ("identified", "confirmed"), ("almost sure, identified", "almost"),
    ("Probable", "almost"), ("strong doubt", "doubt"), ("Unconfirmed", "doubt"), ("claimed", "doubt"),
    ("set aside (#34 a pickup)", "aside"), ("Too far to type", "far"), ("UAE", None), ("Sure-footed", "confirmed"),
])
def test_a_value_reads_as_a_grade_by_its_words(value, grade):
    found = nc.grade_of(value)
    assert (found.key if found else None) == grade


def test_grades_take_the_blue_ramp_and_grey_and_doubt_is_hatched():
    reading = nc.read(_block(_body("groups.md")))
    paints = reading.paints
    assert [paints[value].colour for value in reading.values] == ["#184f95", "#3987e5", "#86b6ef", "#a9a79f"]
    assert paints["Strong doubt"].hatch and not paints["Confirmed"].hatch
    dark = nc.read(_block(_body("groups.md")), theme=nc.theme_for("dark")).paints
    assert dark["Confirmed"].colour == "#b7d3f6"


def test_the_case_names_a_colour_and_every_chart_wears_it(tmp_workspace):
    case = Case.create("Charts")
    layerediting.set_names(case, [{"name": "Confirmed", "colour": "#123456"}, {"name": "UAE", "colour": "#aa0000"}])
    palette = nc.case_palette(case)
    reading = nc.read(_block(_body("groups.md")), palette=palette)
    assert reading.paints["Confirmed"] == nc.Paint("#123456", origin="case")
    assert reading.paints["Almost sure"].origin == "grade"
    chart = nc.layout(_block(_body("groups.md")), palette=palette)
    assert 'fill="#123456"' in nc.svg(chart)


def test_the_charts_own_colours_come_before_the_cases_and_the_order_skips_what_is_taken():
    body = "colour by: Maker\ncolours: USA #00aa00\n| Model | Maker |\n| --- | --- |\n" + "\n".join(
        f"| M{index} | {maker} |" for index, maker in enumerate(["UAE", "USA", "Jordan", "Saudi Arabia"]))
    palette = [{"name": "usa", "colour": "#0000aa"}, {"name": "Jordan", "colour": nc.CATEGORICAL[0]}]
    paints = nc.read(_block(body), palette=palette).paints
    assert paints["USA"] == nc.Paint("#00aa00", origin="chart")
    assert paints["Jordan"] == nc.Paint(nc.CATEGORICAL[0], origin="case")
    assert paints["UAE"] == nc.Paint(nc.CATEGORICAL[1], origin="order")
    assert paints["Saudi Arabia"] == nc.Paint(nc.CATEGORICAL[2], origin="order")


def test_the_cases_colours_can_be_switched_off_in_one_place(monkeypatch):
    monkeypatch.setattr(nc, "CASE_COLOURS", False)
    reading = nc.read(_block(_body("groups.md")), palette=[{"name": "Confirmed", "colour": "#123456"}])
    assert reading.paints["Confirmed"].colour == "#184f95"


def test_past_eight_values_the_rest_are_one_other():
    rows = "\n".join(f"| M{index} | Maker {index} |" for index in range(10))
    chart = nc.layout(_block(f"colour by: Maker\n| Model | Maker |\n| --- | --- |\n{rows}"))
    assert [swatch.value for swatch in chart.legend][-1] == "Other"
    assert len(chart.legend) == 9
    assert any('colours 10 values: past 8 the rest are drawn as "Other"' in check.message for check in chart.checks)


def test_the_folded_values_are_one_part_of_each_bar():
    rows = "\n".join(f"| A | Maker {index} |" for index in range(10))
    reading = nc.read(_block(f"colour by: Maker\n| Model | Maker |\n| --- | --- |\n{rows}"))
    assert reading.values[-1] == "Other" and len(reading.values) == 9
    assert [(segment.value, segment.amount) for segment in reading.categories[0].segments if segment.amount][-1] == (
        "Other", 2)


def test_past_forty_bars_the_rest_are_summed_in_one_and_said():
    rows = "\n".join(f"| Place {index:02d} | {100 - index} |" for index in range(45))
    chart = nc.layout(_block(f"last: Place 00\n| Place | Count |\n| --- | --- |\n{rows}"))
    names = [bar.name for bar in chart.bars]
    assert len(names) == nc.MAX_BARS and names[-1] == "Place 00" and names[-2] == "6 others"
    assert chart.bars[-2].total == sum(100 - index for index in range(39, 45))
    assert '"6 others" sums the bars past the first 39.' in chart.notes
    assert any("has 45 bars: past 39, the other 6 are summed in one" in check.message for check in chart.checks)


def test_a_highlight_paints_one_value_in_the_accent_and_greys_the_rest():
    body = "highlight: UAE\ncolour by: Maker\n| Model | Maker |\n| --- | --- |\n| A | UAE |\n| B | USA |\n| C | Jordan |"
    theme = nc.theme_for("report")
    chart = nc.layout(_block(body), theme=theme)
    assert [(swatch.value, swatch.paint.colour) for swatch in chart.legend] == [
        ("UAE", theme.accent), ("Other maker", theme.others)]
    bars = nc.layout(_block("highlight: B\n| Model | Seen |\n| --- | --- |\n| A | 3 |\n| B | 5 |"), theme=theme)
    fills = {mark.title.split(":")[0]: mark.marks[0].fill for mark in _flat(bars, groups=True)
             if isinstance(mark, nc.Group) and mark.title and mark.marks and isinstance(mark.marks[0], nc.Rect)}
    assert fills["B"] == theme.accent and fills["A"] == theme.others
    missing = nc.read(_block("highlight: Mars\n| Model | Seen |\n| --- | --- |\n| A | 3 |"))
    assert any('highlights "Mars", which no row holds' in message for message in _messages(missing.checks))


# -- the layout's maths -------------------------------------------------------------------------


def _flat(chart: nc.Layout, *, groups: bool = False) -> list:
    out = []

    def walk(mark):
        if isinstance(mark, nc.Group):
            if groups:
                out.append(mark)
            for inner in mark.marks:
                walk(inner)
        else:
            out.append(mark)

    for mark in chart.marks:
        walk(mark)
    return out


def test_bars_are_as_long_as_their_counts_and_stack_in_the_legends_order():
    chart = nc.layout(_block(_body("armoured.md")))
    assert chart.scale.ticks == (0, 2, 4, 6, 8)
    bars = {bar.name: bar for bar in chart.bars}
    cougar, kirpi, harrow = bars["Streit Cougar"], bars["BMC Kirpi II"], bars["Harrow Tygor E1"]
    full = cougar.parts[0][3]
    assert kirpi.parts[0][3] == pytest.approx(full / 8)
    (first, one, start_one, drawn_one), (second, seven, start_seven, drawn_seven) = harrow.parts
    assert (first, one, second, seven) == ("Confirmed", 1, "Almost sure", 7)
    assert drawn_one == pytest.approx(full / 8 - 2)  # the paper's 2 px gap between parts
    assert start_seven == pytest.approx(full / 8)
    assert start_seven + drawn_seven == pytest.approx(full)
    assert all(bar.thickness == cougar.thickness for bar in chart.bars)


def test_the_kept_last_bar_sits_after_a_rule():
    chart = nc.layout(_block(_body("armoured.md")))
    assert chart.bars[-1].name == "Model open"
    gap = chart.bars[-1].at - chart.bars[-2].at
    assert gap > chart.bars[-2].at - chart.bars[-3].at


def test_columns_stack_from_the_baseline_with_their_totals_on_the_caps():
    chart = nc.layout(_block(_body("groups.md")))
    assert chart.kind == "stacked columns"
    assert chart.scale.ticks == (0, 4, 8, 12)
    beach = next(bar for bar in chart.bars if bar.name == "Group F")
    assert [(value, amount) for value, amount, _, drawn in beach.parts if drawn] == [
        ("Confirmed", 6), ("Almost sure", 3), ("Set aside", 3)]
    words = [mark.text for mark in _flat(chart) if isinstance(mark, nc.Text)]
    assert words.count("12") >= 2  # the tick and the cap


def test_a_bar_that_counts_nothing_is_a_hairline():
    body = "| Video | Seen |\n| --- | --- |\n| One | 33 |\n| Three | 0 |"
    for kind, long_side in (("bars", "h"), ("columns", "w")):
        chart = nc.layout(_block(f"kind: {kind}\nsort: as written\n{body}"))
        zero = chart.bars[1]
        assert zero.total == 0 and zero.parts == [("", 0.0, 0.0, 0.0)]
        group = next(mark for mark in _flat(chart, groups=True) if isinstance(mark, nc.Group) and mark.title == "Three: 0")
        hairline = group.marks[0]
        assert (hairline.w if long_side == "h" else hairline.h) == 1.0


def test_a_long_name_wraps_and_a_longer_one_is_cut_with_its_whole_name_kept():
    name = "Toyota Land Cruiser 79 single-cab pickup, technical with a gun mount in the bed, unarmoured"
    chart = nc.layout(_block(f"| Model | Seen |\n| --- | --- |\n| {name} | 3 |\n| Short | 2 |"))
    cut = [mark for mark in _flat(chart) if isinstance(mark, nc.Text) and mark.full == name]
    assert len(cut) == 2 and cut[-1].text.endswith("…")
    assert nc.text_width(cut[0].text, 12.5, chart.theme.head) <= 640 * 0.36 + 0.5


def test_sorting_follows_the_block_or_the_kinds_habit():
    body = "| Place | Count |\n| --- | --- |\n| B | 1 |\n| A | 3 |\n| C | 2 |"
    assert [bar.name for bar in nc.layout(_block(body)).bars] == ["A", "C", "B"]
    assert [bar.name for bar in nc.layout(_block("kind: columns\n" + body)).bars] == ["B", "A", "C"]
    assert [bar.name for bar in nc.layout(_block("sort: a to z\n" + body)).bars] == ["A", "B", "C"]
    assert [bar.name for bar in nc.layout(_block("sort: smallest first\n" + body)).bars] == ["B", "C", "A"]


def test_a_fixed_frame_is_filled_and_an_overfull_one_grows_rather_than_cuts():
    block = _block(_body("groups.md"))
    chart = nc.layout(block, width=480, height=480)
    assert chart.height == 480
    credit = next(mark for mark in _flat(chart) if isinstance(mark, nc.Text) and mark.text.startswith("Source"))
    assert 440 < credit.y < 480
    crowded = nc.layout(_block(_body("armoured.md")), width=560, height=315)
    assert crowded.height > 315


def test_the_title_can_be_left_to_the_pages_caption():
    chart = nc.layout(_block(_body("armoured.md")), title=False)
    words = [mark.text for mark in _flat(chart) if isinstance(mark, nc.Text)]
    assert "At least 41 armoured vehicles, by model and grade" not in words
    assert chart.title == "At least 41 armoured vehicles, by model and grade"


def test_the_book_sets_its_title_in_capitals_over_a_rule_and_the_dark_plate_is_dark():
    book = nc.layout(_block(_body("armoured.md")), theme=nc.theme_for("book"))
    assert any(isinstance(mark, nc.Text) and mark.text == "AT LEAST 41 ARMOURED VEHICLES, BY MODEL AND GRADE"
               for mark in _flat(book))
    assert book.marks[0].fill == "#efe6d3"
    dark = nc.theme_for("dark")
    assert dark.dark and dark.paper == "#12161b"
    assert nc.preset_for("journal") == "report" and nc.preset_for("book") == "book"


def test_the_charts_words_follow_the_looks_face():
    theme = nc.theme_for("report", font="book")
    assert theme.head.file("") == "Literata-Regular.ttf"
    assert theme.head.file("B") == "Literata-Bold.ttf"
    assert "Literata" in theme.head.css
    plex = nc.theme_for("book", font="modern")
    assert plex.head.file("B") == "IBMPlexSans-Bold.ttf" and plex.body.file("") == "IBMPlexSans-Regular.ttf"
    assert nc.theme_for("report").head.file("") == "NotoSans-Regular.ttf"


def test_a_letter_the_face_lacks_is_set_in_a_face_that_has_it():
    parts = nc.runs("Al-Wahsh الوحش ≥ 41", "NotoSans-Regular.ttf")
    faces = [face for face, _ in parts]
    assert faces[0] == "NotoSans-Regular.ttf"
    assert "NotoSansArabic-Regular.ttf" in faces
    assert "".join(text for _, text in parts) == "Al-Wahsh الوحش ≥ 41"


# -- the SVG painter ----------------------------------------------------------------------------


def _svg_root(chart: nc.Layout, **options) -> ElementTree.Element:
    return ElementTree.fromstring(nc.svg(chart, **options))


def test_the_svg_is_well_formed_and_said_to_a_screen_reader():
    chart = nc.layout(_block(_body("armoured.md")))
    root = _svg_root(chart, ident="fig-3")
    assert root.get("role") == "img"
    assert root.get("aria-labelledby") == "fig-3-title fig-3-desc"
    title, desc = root[0], root[1]
    assert (title.tag, title.get("id"), title.text) == (f"{SVG_NS}title", "fig-3-title",
                                                       "At least 41 armoured vehicles, by model and grade")
    assert desc.get("id") == "fig-3-desc"
    assert "Harrow Tygor E1: 8 (Confirmed 1, Almost sure 7)" in desc.text
    hovers = [element.text for element in root.iter(f"{SVG_NS}title")]
    assert "Harrow Tygor E1, Almost sure: 7" in hovers
    assert "Strong doubt: 6" in hovers


def test_the_svg_draws_real_text_a_hatch_pattern_and_rounded_data_ends():
    text = nc.svg(nc.layout(_block(_body("armoured.md"))), ident="c1")
    assert '<pattern id="c1-h1"' in text and 'fill="url(#c1-h1)"' in text
    assert ">Streit Cougar</text>" in text
    assert 'font-family="&#x27;Noto Sans&#x27;' in text
    assert re.search(r'<path d="M[\d.]+ [\d.]+H[\d.]+Q', text)


def test_the_svg_passes_the_html_reports_cleaner_untouched():
    for name in ("armoured.md", "groups.md"):
        chart = nc.layout(_block(_body(name)))
        raw = nc.svg(chart, ident="az-fig-1")
        cleaned = notes_html._clean_svg(raw, "az-fig-1")
        before = [(element.tag.rsplit("}", 1)[-1], dict(element.attrib), element.text)
                  for element in ElementTree.fromstring(raw).iter()]
        after = [(element.tag.rsplit("}", 1)[-1], dict(element.attrib), element.text)
                 for element in ElementTree.fromstring(cleaned).iter()]
        assert after == before


def test_a_transparent_svg_leaves_the_paper_to_the_page_and_names_the_pages_faces():
    chart = nc.layout(_block(_body("armoured.md")))
    root = _svg_root(chart, transparent=True, faces={"head": "az-head", "body": "az-body"})
    assert root.get("font-family").startswith("az-head, ")
    first_drawn = next(element for element in root if element.tag not in (f"{SVG_NS}title", f"{SVG_NS}desc",
                                                                         f"{SVG_NS}defs"))
    assert not (first_drawn.tag == f"{SVG_NS}rect" and first_drawn.get("width") == "640")


def test_a_cut_name_keeps_its_whole_name_as_a_hover():
    name = "Toyota Land Cruiser 79 single-cab pickup, technical with a gun mount in the bed, unarmoured"
    root = _svg_root(nc.layout(_block(f"| Model | Seen |\n| --- | --- |\n| {name} | 3 |")))
    assert name in [element.text for element in root.iter(f"{SVG_NS}title")]


def test_the_numbers_are_a_table_for_screen_readers():
    chart = nc.layout(_block(_body("armoured.md")))
    table = ElementTree.fromstring(nc.data_table_html(chart))
    assert table.get("class") == "az-chart-data"
    assert table.find("caption").text == chart.title
    assert [cell.text for cell in table.find("thead/tr")] == ["Model", "Confirmed", "Almost sure", "Strong doubt", "All"]
    rows = table.findall("tbody/tr")
    assert len(rows) == 12
    harrow = next(row for row in rows if row[0].text == "Harrow Tygor E1")
    assert harrow[0].get("scope") == "row"
    assert [cell.text for cell in harrow[1:]] == ["1", "7", "0", "8"]
    single = nc.layout(_block("| Video | Seen |\n| --- | --- |\n| One | 33 |"))
    assert single.table_head == ["Video", "Seen"]


# -- the PNG painter ----------------------------------------------------------------------------


def _image(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    image.load()
    return image


@pytest.mark.parametrize("where, size", [
    ("x", (1600, 900)), ("portrait", (1080, 1350)), ("square", (1080, 1080)),
])
def test_a_picture_for_a_destination_is_its_exact_size_even_when_crowded(where, size):
    image = _image(nc.render(_block(_body("armoured.md")), where))
    assert image.size == size


def test_a_pdf_page_picture_is_the_reports_frame_at_300_dpi():
    image = _image(nc.render(_block(_body("armoured.md")), "page"))
    assert image.width == 1960
    assert image.info["dpi"] == pytest.approx((300, 300), abs=0.01)
    assert 1960 / 300 * 25.4 == pytest.approx(166, abs=0.1)


def test_the_png_is_painted_in_the_grades_colours_on_its_paper():
    image = _image(nc.render_png(nc.layout(_block(_body("armoured.md"))), 1280)).convert("RGB")
    colours = {colour for _, colour in image.getcolors(1_000_000)}
    assert (255, 255, 255) in colours
    assert (0x18, 0x4F, 0x95) in colours and (0x39, 0x87, 0xE5) in colours
    assert len(colours) > 50  # smooth edges and real words, not flat boxes


def test_every_painter_primitive_draws_in_both_painters():
    theme = nc.theme_for("report")
    marks = [
        nc.Rect(0, 0, 200, 120, theme.paper),
        nc.Group((nc.Circle(50, 50, 20, "#e34948", stroke="#0b0b0b", stroke_width=2),), "A dot"),
        nc.Shape("M0 0L10 0L10 10Z", "#1baf7a", x=100, y=20, scale=4, stroke="#0b0b0b", stroke_width=0.5),
        nc.Shape("M0 0L10 0L10 10L0 10Z", "#86b6ef", x=150, y=70, scale=3, hatch="#d5e6fa"),
        nc.Line(((10, 100), (190, 100)), "#6250d6", 2, dash=(4, 3)),
        nc.Line(((10, 110), (100, 115), (190, 110)), "#0b0b0b", 1),
        nc.Text(100, 90, "Words", 12, theme.ink, bold=True, anchor="middle", italic=True),
    ]
    chart = nc.Layout(200, 120, theme, marks, "Primitives", "Every mark.", [], [], None, [], [], "", "test", [],
                      [], [])
    text = nc.svg(chart, ident="p")
    root = ElementTree.fromstring(text)
    assert root.find(f"{SVG_NS}g/{SVG_NS}circle") is not None
    assert 'transform="translate(100 20) scale(4)"' in text
    assert 'stroke-dasharray="4 3"' in text and "<polyline" in text
    assert 'font-style="italic"' in text and 'url(#p-h1)' in text
    image = _image(nc.render_png(chart, 400)).convert("RGB")
    assert image.getpixel((100, 100)) == (0xE3, 0x49, 0x48)  # the circle's middle
    assert image.getpixel((270, 50)) == (0x1B, 0xAF, 0x7A)  # inside the triangle


def test_the_same_chart_is_the_same_bytes():
    block = _block(_body("armoured.md"))
    assert nc.svg(nc.layout(block)) == nc.svg(nc.layout(_block(_body("armoured.md"))))
    assert nc.render(block, "square") == nc.render(_block(_body("armoured.md")), "square")
    assert nc.render_png(nc.layout(block, theme=nc.theme_for("book")), 900) == nc.render_png(
        nc.layout(block, theme=nc.theme_for("book")), 900)


def test_alt_text_says_the_title_then_every_bar():
    chart = nc.layout(_block(_body("armoured.md")))
    lines = chart.alt.split("\n")
    assert lines[0] == "At least 41 armoured vehicles, by model and grade"
    assert "Streit Cougar: 8 (Confirmed 8)" in lines
    assert len(lines) == 13


# -- a kind registered from outside -------------------------------------------------------------


@pytest.fixture()
def dots():
    """A kind made the way B1k adds one: a plot, a key of its own, one register line."""
    def plot(reading, theme, box):
        marks = [nc.Group((nc.Circle(box.x + 20 + 30 * index, box.y + 20, 8 + category.total, theme.series),),
                          f"{category.name}: {nc.number_text(category.total)}")
                 for index, category in enumerate(reading.categories)]
        own = [nc.Swatch(category.name, nc.Paint(theme.series), category.total) for category in reading.categories]
        legend, height = nc.legend_marks(own, theme, box.x, box.y + 50, box.width)
        return nc.Plot([*marks, *legend], 60 + height, lines=[category.name for category in reading.categories],
                       legend=own, facts={"of": reading.block.extra.get("of")}, notes=["Areas to scale."])

    # what the registry held before, given back whole: a waffle reads "of" too, and a test after
    # this one in the same worker must still find it
    kept = (dict(nc.KINDS), dict(nc._KIND_WORDS), dict(nc._KIND_KEYS))
    kind = nc.register(nc.Kind("dots", "Dots", plot, words=("dot chart",), keys=("of",), legend=False))
    yield kind
    for registry, before in zip((nc.KINDS, nc._KIND_WORDS, nc._KIND_KEYS), kept):
        registry.clear()
        registry.update(before)


def test_a_registered_kind_is_read_written_laid_and_painted(dots):
    block = _block("kind: dot chart\nof: 10000\n| Place | Count |\n| --- | --- |\n| A | 3 |\n| B | 5 |")
    assert block.kind == "dots" and block.extra == {"of": "10000"}
    assert "kind: dots\nof: 10000\n" in nc.block_text(block)
    chart = nc.layout(block)
    assert chart.kind == "dots" and chart.facts == {"of": "10000"}
    assert [(swatch.value, swatch.total) for swatch in chart.legend] == [("B", 5), ("A", 3)]
    assert chart.notes[0] == "Areas to scale."
    assert "Areas to scale." in [mark.text for mark in _flat(chart) if isinstance(mark, nc.Text)]
    assert "<circle" in nc.svg(chart)
    assert nc.render_png(chart, 400)[:4] == b"\x89PNG"
    assert [kind.name for kind in nc.kinds()][-1] == "dots"
    bars = nc.read(_block("kind: bars\nof: 3\n| Place | Count |\n| --- | --- |\n| A | 3 |"))
    assert any('a bars chart does not read "of"' in message for message in _messages(bars.checks))


# -- what a chart counts with no count written ------------------------------------------------------------


REGISTER_ROWS = ("| # | Identification | Grade | Conf. |\n| --- | --- | --- | --- |\n| 1 | Streit Cougar | identified | 80% |\n"
                 "| 2 | Streit Cougar | identified | 65% |\n| 3 | NIMR Ajban 440A | almost sure | 65% |")


def test_a_column_of_percentages_is_never_summed_with_no_count_written():
    reading = nc.read(_block("kind: bars\nby: Identification\n" + REGISTER_ROWS))
    assert reading.count is None and reading.total == 3
    said = [check for check in reading.checks if "counts its rows" in check.message]
    assert [check.message for check in said] == [
        'A chart counts its rows: "Conf." reads as a share, which is never summed on its own.']
    assert said[0].fix == (("count", "rows"),)
    # a confidence or a ratio by its header, whole numbers or not
    for header in ("Confidence", "Share of the total", "Ratio", "Conf %", "Rate"):
        table = f"| Model | {header} |\n| --- | --- |\n| A | 80 |\n| B | 65 |"
        assert nc.read(_block(table)).count is None, header


def test_the_one_column_of_amounts_is_summed_and_the_check_says_which():
    reading = nc.read(_block("kind: bars\n| Model | Conf. | At least |\n| --- | --- | --- |\n| A | 80% | 3 |\n"
                             "| B | 65% | 5 |"))
    assert reading.count == 2 and reading.total == 8
    said = [check for check in reading.checks if "sums" in check.message]
    assert [check.message for check in said] == ['A chart sums "At least", its one column of amounts, as no count '
                                                 'is written.']
    assert said[0].fix == (("count", "At least"),)
    written = nc.read(_block("kind: bars\ncount: At least\n| Model | At least |\n| --- | --- |\n| A | 3 |"))
    assert not any("sums" in check.message for check in written.checks)


def test_a_share_named_in_count_is_summed_as_written():
    reading = nc.read(_block("kind: bars\ncount: Conf.\nby: Identification\n" + REGISTER_ROWS))
    assert reading.count == 3 and reading.total == 210
