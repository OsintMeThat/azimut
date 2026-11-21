"""The one reader of a cell (`engine/cellread.py`): days in any language, numbers with
either decimal mark, and the charts and sheets that read their cells through it.

`frontend/src/lib/cellReading.fixture.json` is the contract both readers answer alike;
`lib/cellRead.test.js` runs the same cases in the browser.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

import pytest

from azimut.engine import cellread, notes_chart_kinds as kinds, notes_chart_timeline as timeline
from azimut.engine import notes_charts as nc, sheetmap, sheetroles

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "frontend" / "src" / "lib" / "cellReading.fixture.json"
ENGINE_WORDS = ROOT / "src" / "azimut" / "engine" / "cell_words.json"
BROWSER_WORDS = ROOT / "frontend" / "src" / "lib" / "cellWords.json"


def _fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


# -- the contract ---------------------------------------------------------------------------------


@pytest.mark.parametrize("case", _fixture()["days"], ids=lambda case: case["cell"] or "empty")
def test_a_day_reads_as_the_contract_says(case):
    found = cellread.read_day(case["cell"])
    read = None if found is None else {"precision": found.precision, "date": found.day.isoformat(),
                                       "year": found.year}
    assert read == case["reads"]


@pytest.mark.parametrize("case", _fixture()["numbers"], ids=lambda case: case["cell"] or "empty")
def test_a_number_reads_as_the_contract_says(case):
    found = cellread.read_amount(case["cell"], case.get("decimal"))
    read = None if found is None or found.value is None else {"value": found.value, "floor": found.floor}
    assert read == case["reads"]


@pytest.mark.parametrize("case", _fixture()["columns"], ids=lambda case: "|".join(case["cells"]))
def test_a_column_says_its_own_decimal_mark(case):
    marks = cellread.column_marks(case["cells"])
    values = [found.value if (found := cellread.read_amount(cell, marks.decimal)) else None for cell in case["cells"]]
    assert values == case["values"]


def test_the_engine_and_the_browser_read_one_table_of_words():
    assert ENGINE_WORDS.read_bytes() == BROWSER_WORDS.read_bytes(), "run node scripts/cell_words.mjs"


def test_every_word_of_the_table_is_written_as_it_folds():
    data = json.loads(ENGINE_WORDS.read_text(encoding="utf-8"))
    words = [*data["months"], *data["weekdays"]]
    assert len(words) > 2000
    assert [word for word in words if cellread.fold(word) != word] == []


# -- the reader's own rules -----------------------------------------------------------------------


def test_a_word_folds_as_the_browser_folds_it():
    assert cellread.fold("Févr.") == "fevr"
    assert cellread.fold("MARS") == "mars"
    assert cellread.fold("ß") == "ß", "lower case, never casefold: ß stays ß in both readers"
    assert cellread.fold("Μαρτίου") == "μαρτίου", "accents stay outside the Latin script"
    assert cellread.fold("5º") == "5o"
    assert cellread.fold("كانون‏  الثاني") == "كانون الثاني"


def test_any_script_s_digits_read_as_ascii():
    assert cellread.digits("٥ مارس ٢٠٢٦") == "5 مارس 2026"
    assert cellread.digits("١٫٥ ١٬٢٠٠ ۱۲ ６０ ५") == "1.5 1,200 12 60 5"
    assert cellread.digits("x² 1st") == "x² 1st"


@pytest.mark.parametrize("word, month", [
    ("mars", 3), ("Févr.", 2), ("listopad", 11), ("במרץ", 3), ("арван нэгдүгээр сар", 11), ("rover", None),
])
def test_a_month_word_names_its_month_in_any_language(word, month):
    assert cellread.month_word(word) == month


def test_a_day_without_its_year_takes_the_one_given_and_says_so():
    assert cellread.read_day("5 mars", 2026) == cellread.Day(date(2026, 3, 5), "day", True)
    assert cellread.read_day("Mars", 2026) == cellread.Day(date(2026, 3, 1), "month", True)
    assert cellread.read_day("Mars") == cellread.Day(date(cellread.NO_YEAR, 3, 1), "month", False)
    assert cellread.read_day("29 Feb", 2025) is None


@pytest.mark.parametrize("cell", [
    "0999", "1.5 March", "5 6 March", "March April", "5 Mar 2026 2027", "tháng 13 2026", "26年3月", "Mars, Mars",
])
def test_a_cell_saying_more_or_less_than_one_day_is_none(cell):
    assert cellread.read_day(cell) is None


def test_a_bare_year_is_a_number_and_a_month_is_not():
    assert cellread.read_amount("2026").value == 2026
    assert cellread.read_amount("2026-03") is None
    assert cellread.read_amount("360 m").unit == "m"
    assert cellread.read_amount("5 mart") is None, "a month word after a number is a day, not a unit"
    assert cellread.read_amount("up to 20").ceiling


# -- the charts -----------------------------------------------------------------------------------


@pytest.mark.parametrize("days", [
    ("5 mars 2026", "12 mars 2026", "1er avril 2026"),
    ("5 марта 2026 г.", "12 марта 2026", "1 апреля 2026"),
    ("5 مارس 2026", "١٢ مارس ٢٠٢٦", "1 أبريل 2026"),
])
def test_a_timeline_draws_its_events_from_days_in_any_language(days):
    rows = "\n".join(f"| {day} | Event {index} |" for index, day in enumerate(days, start=1))
    block = nc.parse_block(f"kind: timeline\nsource: x\n| Date | What |\n| --- | --- |\n{rows}")
    events, unread, had_year = timeline.events_of(nc.read(block), nc.theme_for("report"))
    assert unread == 0 and had_year
    assert [event.start.day for event in events] == [date(2026, 3, 5), date(2026, 3, 12), date(2026, 4, 1)]
    svg = nc.svg(nc.layout(block))
    assert all(f"Event {index}" in svg for index in (1, 2, 3))


def test_a_bar_chart_of_comma_decimals_draws_them_whole():
    block = nc.parse_block("kind: bars\nsource: x\n| Site | Tonnes |\n| --- | --- |\n| North | 1,5 |\n"
                           "| South | 2,25 |\n| East | 1,500 |")
    reading = nc.read(block)
    assert {category.name: category.total for category in reading.categories} == {
        "North": 1.5, "South": 2.25, "East": 1.5}
    texts = re.findall(r">([^<>]+)</text>", nc.svg(nc.layout(block)))
    assert "2.25" in texts and "1.5" in texts


def test_a_column_of_thousands_keeps_its_comma_as_a_separator():
    block = nc.parse_block("kind: bars\nsource: x\n| Site | People |\n| --- | --- |\n| North | 1,500 |\n"
                           "| South | 12,750 |")
    assert [category.total for category in nc.read(block).categories] == [12750, 1500]


def test_a_line_reads_its_comma_decimals_along_its_days():
    block = nc.parse_block("kind: line\nsource: x\n| Day | Rate |\n| --- | --- |\n| 5 mars 2026 | 1,5 |\n"
                           "| 6 mars 2026 | 2,25 |")
    chart = nc.layout(block)
    texts = re.findall(r">([^<>]+)</text>", nc.svg(chart))
    assert "2.25" in texts and not [check for check in nc.read(block).checks if "not drawn" in check.message]


MONTHS = "| Month | Count |\n| --- | --- |\n| Jan | 4 |\n| Feb | 7 |\n| Mar | 2 |"


@pytest.mark.parametrize("kind", ["bars", "columns", "pie", "donut", "waffle"])
def test_a_categories_chart_of_month_words_keeps_its_rows_as_written(kind):
    """`Jan` alone reads as a month now; a chart of categories still draws one bar per row,
    in the table's order, named as written."""
    reading = nc.read(nc.parse_block(f"kind: {kind}\nsource: x\n{MONTHS}"))
    names = {category.name: category.total for category in reading.categories}
    assert names == {"Jan": 4, "Feb": 7, "Mar": 2}


def test_month_words_alone_now_draw_a_line_and_are_a_column_of_days():
    rows = [row for row in nc.parse_block(f"kind: line\nsource: x\n{MONTHS}").table.rows]
    assert kinds.day_column(rows, 0)
    texts = re.findall(r">([^<>]+)</text>", nc.svg(nc.layout(nc.parse_block(f"kind: line\nsource: x\n{MONTHS}"))))
    assert "1 Feb" in texts and "2000" not in " ".join(texts), "a year no cell said is never printed"


def test_a_number_with_its_column_s_mark_and_its_reasons():
    assert nc.read_number("1,500", ",") == nc.Number(1.5)
    assert nc.read_number("1,500") == nc.Number(1500)
    assert nc.read_number("1 200 €") == nc.Number(1200)
    assert nc.read_number("2026-03") == "text"
    assert nc.column_decimal([["1,5"], ["2,25"]], 0) == "," and nc.column_decimal([], None) is None


# -- the sheets -----------------------------------------------------------------------------------


@pytest.mark.parametrize("cell, text", [
    ("5 mars 2026", "2026-03-05"), ("March 5, 2026", "2026-03-05"), ("mars 2026", "2026-03"), ("2026", "2026"),
    ("03/2026", "2026-03"), ("2026年3月5日", "2026-03-05"),
])
def test_a_sheet_reads_a_day_its_own_grammar_misses_at_its_precision(cell, text):
    assert sheetroles.parse_when(cell) == {"shape": "moment", "date": text, "clock": "", "text": text}


@pytest.mark.parametrize("cell", ["5 mars", "Mars", "Mars rover", "8–10"])
def test_a_sheet_never_invents_the_year_of_a_day(cell):
    assert sheetroles.parse_when(cell) is None


@pytest.mark.parametrize("cell", ["03/13/2026", "29/02/2025", "03/01/2026 99:00", "24:00"])
def test_a_cell_the_sheet_s_own_grammar_refuses_stays_refused(cell):
    """The fallback reads only what no shape of the binders' matched: a day-first column's
    `03/13/2026` is not the 13th of March read month first."""
    assert sheetroles.parse_when(cell) is None


def test_a_sheet_s_month_dates_a_claim_but_no_map_point():
    assert sheetroles.claim_moment(sheetroles.parse_when("mars 2026")) == "2026-03"
    assert sheetmap._day("mars 2026", None) == ""
    assert sheetmap._day("5 mars 2026", None) == "2026-03-05"
