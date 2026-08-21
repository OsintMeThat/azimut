"""The real binders, imported.

`tests/fixtures/` holds the pathologies of three actual investigation binders, distilled
into synthetic files (see the README there). This module is the gate that says the app
reads them — as opposed to reading a table written to suit the parser, which is what every
other sheet test necessarily does.

Nothing here asserts a nice answer. It asserts that a semicolon export, a dead formula, a
coordinate written three ways and a status column of eight invented words all **land**,
because the alternative — refusing the file at the door — is the one failure mode a tool
that replaces a spreadsheet cannot have.
"""

from pathlib import Path

import pytest

from azimut.engine import sheets as sheet_engine

FIXTURES = Path(__file__).parent / "fixtures"


def read(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def imported(client, case_id: str, name: str, title: str) -> dict:
    response = client.post(
        f"/api/cases/{case_id}/sheets/import", json={"title": title, "text": read(name)}
    )
    assert response.status_code == 200, response.text
    return client.get(f"/api/cases/{case_id}/sheets/{response.json()['id']}").json()


@pytest.fixture
def case_id(client):
    return client.post("/api/cases", json={"name": "Binders"}).json()["id"]


def test_every_fixture_imports_without_being_refused(client, case_id):
    """The one thing that must never happen: a real file turned away at the door."""
    for path in sorted(FIXTURES.glob("*.csv")):
        sheet = imported(client, case_id, path.name, path.stem)
        assert sheet["rows"], f"{path.name} imported as an empty sheet"


def test_a_european_export_lands_as_a_table(client, case_id):
    sheet = imported(client, case_id, "binder-semicolon.csv", "Index")
    assert sheet["columns"] == [
        "id", "Date", "Nature", "Title", "Country", "Coordinates", "Geolocation",
    ]
    # The delimiter is guessed, the quoted comma stays inside its cell, and a coordinate
    # holding the delimiter survives because the export quoted it.
    assert sheet["rows"][0][3] == "Quay, south end"
    assert sheet["rows"][0][5] == "48,8566; 2,3522"


def test_a_dead_formula_is_a_value_like_any_other(client, case_id):
    """`#REF!` is what a binder's own validation left behind. It is data now."""
    sheet = imported(client, case_id, "binder-semicolon.csv", "Index")
    assert sheet["rows"][1][5] == "#REF!"


def test_a_worklist_with_no_status_column_keeps_its_gaps(client, case_id):
    """Its progress is the fill rate of one column, which is why that reading exists."""
    sheet = imported(client, case_id, "binder-worklist.csv", "Worklist")
    coordinates = [row[sheet["columns"].index("Coordinates")] for row in sheet["rows"]]
    assert len(coordinates) == 6
    assert sum(1 for value in coordinates if value.strip()) == 5
    assert "To be found" in coordinates and "-" in coordinates
    # Three formats in one column, which is what the normalise action exists for.
    assert any('°' in value for value in coordinates)


def test_a_timeline_keeps_a_bare_clock_and_a_note_in_prose(client, case_id):
    sheet = imported(client, case_id, "binder-timeline.csv", "Timeline")
    at = sheet["columns"].index
    assert sheet["rows"][0][at("Local time")] == "01:57"
    assert sheet["rows"][1][at("Note hour")] == "between 2:00 and 2:10"
    assert sheet["rows"][0][at("Equipments")] == "Buk-M2E, 2x S-125"
    assert sheet["rows"][0][at("start synchro")] == "-00:01:50"


def test_a_timeline_is_mostly_empty_and_that_is_the_normal_state(client, case_id):
    """111 filled of 969 in the original. A tool that treats empty as broken is wrong."""
    sheet = imported(client, case_id, "binder-timeline.csv", "Timeline")
    filled = [row for row in sheet["rows"] if any(cell.strip() for cell in row[1:])]
    assert len(filled) == 4
    assert len(sheet["rows"]) > len(filled) * 2


def test_a_status_column_of_eight_invented_words_lands_intact(client, case_id):
    """A state vocabulary has to be built from these, not from four words we chose."""
    sheet = imported(client, case_id, "binder-states.csv", "States")
    at = sheet["columns"].index("Status")
    assert [row[at] for row in sheet["rows"]] == [
        "To do", "OK en cours", "To be found", "pass", "x", "-", "AFTER", "?", "",
    ]


def test_a_fixture_that_already_keys_its_rows_keeps_its_own_column(client, case_id):
    sheet = imported(client, case_id, "binder-worklist.csv", "Worklist")
    assert [row[0] for row in sheet["rows"]][:3] == ["r1", "r2", "r3"]
    assert sheet["assigned"] is False


def test_a_binder_round_trips_through_the_writer_unchanged(client, case_id):
    """Import, save, re-read: the words a binder holds are the words it keeps."""
    sheet = imported(client, case_id, "binder-worklist.csv", "Worklist")
    saved = client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={"columns": sheet["columns"], "rows": sheet["rows"], "meta": sheet["meta"]},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["rows"] == sheet["rows"]


def test_the_delimiter_of_each_fixture_is_the_one_it_was_written_with(client, case_id):
    assert sheet_engine.sniff_delimiter(read("binder-semicolon.csv")) == ";"
    assert sheet_engine.sniff_delimiter(read("binder-worklist.csv")) == ","
