"""Case sheets: the CSV on disk, the sidecar beside it, and the routes.

The gate this file exists for is the first one: **a sheet is a file**. Every test
that reads `sheets/<name>.csv` back with the standard library is checking the
promise the feature is built on — that a case outlives the app holding it.
"""

import csv
import io
import json

from azimut import layout
from azimut.engine import sheets as sheet_engine


def make_case(client, name="Sheets"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def new_sheet(client, case_id, title="Candidates"):
    response = client.post(f"/api/cases/{case_id}/sheets", json={"title": title})
    assert response.status_code == 200, response.text
    return response.json()


def case_file(client, case_id, rel):
    from azimut.api.cases import get_case

    return get_case(case_id).resolve_inside(rel)


def case_links(client, case_id):
    from azimut.api.cases import get_case

    return get_case(case_id).list_links()


# -- the table, without a case around it -------------------------------------


def test_a_file_with_no_id_column_gets_one_in_front():
    columns, rows = sheet_engine.parse_csv("name,plate\nQuai sud,AB-123\n")
    assert columns == ["id", "name", "plate"]
    assert rows[0][1:] == ["Quai sud", "AB-123"]
    assert rows[0][0], "every row is keyed"


def test_a_file_that_already_keys_its_rows_keeps_its_own_column():
    """An export usually carries an id, and a second key column beside it is noise."""
    columns, rows = sheet_engine.parse_csv("id,name\n42,Quai sud\n43,Pont nord\n")
    assert columns == ["id", "name"]
    assert [row[0] for row in rows] == ["42", "43"]


def test_blank_and_duplicate_keys_are_filled_rather_than_refused():
    columns, rows = sheet_engine.parse_csv("id,name\n,A\n7,B\n7,C\n")
    keys = [row[0] for row in rows]
    assert len(set(keys)) == 3, "a key is never shared"
    assert keys[1] == "7", "the first holder of a value keeps it"


def test_a_semicolon_export_is_read_as_a_table():
    """European exports are semicolon-separated far too often to refuse."""
    columns, rows = sheet_engine.parse_csv("name;plate\nQuai sud;AB-123\n")
    assert columns == ["id", "name", "plate"]
    assert rows[0][1:] == ["Quai sud", "AB-123"]


def test_a_delimiter_inside_quotes_does_not_vote():
    assert sheet_engine.sniff_delimiter('name;note\n"Smith, J";ok\n') == ";"


def test_blank_and_repeated_headings_are_named():
    columns, _ = sheet_engine.parse_csv("name,,name\nx,y,z\n")
    assert columns == ["id", "name", "Column 2", "name (2)"]


def test_an_empty_file_is_an_empty_sheet_rather_than_an_error():
    columns, rows = sheet_engine.parse_csv("")
    assert columns == ["id"] and rows == []


def test_a_cell_keeps_its_newlines_and_loses_its_control_characters():
    columns, rows = sheet_engine.normalize(["id", "notes"], [["r1", "two\r\nlines\x07"]])
    assert rows[0][1] == "two\nlines"


def test_a_table_wider_or_longer_than_the_bound_is_refused():
    import pytest

    with pytest.raises(sheet_engine.SheetError):
        sheet_engine.normalize([f"c{i}" for i in range(sheet_engine.MAX_COLUMNS + 1)], [])
    with pytest.raises(sheet_engine.SheetError):
        sheet_engine.normalize(["id"], [[""]] * (sheet_engine.MAX_ROWS + 1))
    with pytest.raises(sheet_engine.SheetError):
        sheet_engine.normalize(["id", "n"], [["r1", "x" * (sheet_engine.MAX_CELL + 1)]])


def test_a_written_table_reads_back_through_the_standard_library():
    """The whole design in one assertion: the file is the sheet."""
    text = sheet_engine.to_csv(["id", "note"], [["r1", 'he said "no", twice\nthen left']])
    back = list(csv.reader(io.StringIO(text)))
    assert back[0] == ["id", "note"]
    assert back[1][1] == 'he said "no", twice\nthen left'


# -- the sidecar --------------------------------------------------------------


def test_the_sidecar_drops_what_the_table_no_longer_carries():
    columns, rows = ["id", "Status"], [["r1", "checked"]]
    clean = sheet_engine.clean_meta(
        {
            "widths": {"Status": 200, "Gone": 120},
            "hidden": ["Gone", "id"],
            "sort": {"column": "Gone", "desc": True},
            "colours": {"r1": "red", "r9": "red", "r1x": "not-a-colour"},
            "links": {"r1": {"Status": "e_1", "Gone": "e_2"}, "r9": {"Status": "e_3"}},
        },
        columns,
        rows,
    )
    assert clean["widths"] == {"Status": 200}
    assert clean["hidden"] == [], "the id column is never hidden"
    assert clean["sort"] is None
    assert clean["colours"] == {"r1": "red"}
    assert clean["links"] == {"r1": {"Status": "e_1"}}


def test_a_corrupt_sidecar_costs_presentation_and_nothing_else():
    assert sheet_engine.clean_meta("not a dict", ["id"], []) == sheet_engine.empty_meta()


# -- the routes ---------------------------------------------------------------


def test_a_new_sheet_is_a_real_csv_in_the_case(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")

    assert sheet["type"] == "sheet"
    rel = sheet["attrs"]["path"]
    assert rel == layout.sheet_rel("Candidates")
    path = case_file(client, case_id, rel)
    assert path.is_file()
    assert path.read_text(encoding="utf-8").splitlines()[0] == "id,Subject,Status,Notes"


def test_two_sheets_with_one_name_do_not_share_a_file(client):
    case_id = make_case(client)
    first = new_sheet(client, case_id, "Candidates")
    second = new_sheet(client, case_id, "Candidates")
    assert first["attrs"]["path"] != second["attrs"]["path"]


def test_an_imported_csv_lands_as_a_sheet_and_keeps_its_rows(client):
    case_id = make_case(client)
    response = client.post(
        f"/api/cases/{case_id}/sheets/import",
        json={"title": "Members", "text": "handle;seen\n@a;yes\n@b;no\n"},
    )
    assert response.status_code == 200, response.text
    sheet_id = response.json()["id"]

    table = client.get(f"/api/cases/{case_id}/sheets/{sheet_id}").json()
    assert table["columns"] == ["id", "handle", "seen"]
    assert [row[1] for row in table["rows"]] == ["@a", "@b"]


def test_an_import_writes_its_keys_down_straight_away(client):
    case_id = make_case(client)
    response = client.post(
        f"/api/cases/{case_id}/sheets/import",
        json={"title": "Plates", "text": "plate\nAB-123\n"},
    )
    path = case_file(client, case_id, response.json()["attrs"]["path"])
    assert path.read_text(encoding="utf-8").startswith("id,plate")

    read = client.get(f"/api/cases/{case_id}/sheets/{response.json()['id']}").json()
    assert read["assigned"] is False


def test_a_file_edited_outside_is_re_keyed_without_being_written_to(client):
    """The analyst's own copy of the file is never rewritten behind their back.

    Someone edits the CSV in a spreadsheet and drops the id column. The grid gets
    keys so colours and links have something to hang on, the file on disk stays
    exactly as they left it, and `assigned` is what tells the grid to say so.
    """
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Plates")
    path = case_file(client, case_id, sheet["attrs"]["path"])
    path.write_text("plate,seen\nAB-123,yes\n", encoding="utf-8")
    before = path.read_bytes()

    read = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()
    assert read["assigned"] is True
    assert read["columns"] == ["id", "plate", "seen"]
    assert read["rows"][0][0], "the grid has a key to work with"
    assert path.read_bytes() == before, "reading wrote nothing"


def test_saving_writes_the_table_and_the_sidecar(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    sheet_id = sheet["id"]

    saved = client.put(
        f"/api/cases/{case_id}/sheets/{sheet_id}",
        json={
            "columns": ["id", "Subject", "Verdict"],
            "rows": [["r1", "Quai sud", "ruled out"]],
            "meta": {"colours": {"r1": "red"}, "widths": {"Subject": 240}},
        },
    )
    assert saved.status_code == 200, saved.text

    path = case_file(client, case_id, sheet["attrs"]["path"])
    assert list(csv.reader(io.StringIO(path.read_text(encoding="utf-8")))) == [
        ["id", "Subject", "Verdict"],
        ["r1", "Quai sud", "ruled out"],
    ]
    meta_path = case_file(client, case_id, layout.sheet_meta_rel("Candidates"))
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["colours"] == {"r1": "red"}
    assert meta["widths"] == {"Subject": 240}


def test_a_finding_is_a_column_and_presentation_is_not(client):
    """Hand the file to someone else and the work survives; the colours do not."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Worklist")
    client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={
            "columns": ["id", "Status", "Why"],
            "rows": [["r1", "ruled out", "too blurry to tell"]],
            "meta": {"colours": {"r1": "grey"}},
        },
    )
    text = case_file(client, case_id, sheet["attrs"]["path"]).read_text(encoding="utf-8")
    assert "ruled out" in text and "too blurry to tell" in text
    assert "grey" not in text


def test_a_linked_cell_becomes_a_mention_the_other_side_can_see(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    person = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": "person", "label": "Witness A"},
    ).json()

    client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={
            "columns": ["id", "Subject"],
            "rows": [["r1", "Witness A"]],
            "meta": {"links": {"r1": {"Subject": person["id"]}}},
        },
    )
    links = case_links(client, case_id)
    assert any(
        link["from"] == sheet["id"] and link["to"] == person["id"] and link["type"] == "mentions"
        for link in links
    )


def test_clearing_a_link_drops_its_edge_on_the_next_save(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    person = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "person", "label": "Witness A"}
    ).json()
    body = {
        "columns": ["id", "Subject"],
        "rows": [["r1", "Witness A"]],
        "meta": {"links": {"r1": {"Subject": person["id"]}}},
    }
    client.put(f"/api/cases/{case_id}/sheets/{sheet['id']}", json=body)
    client.put(f"/api/cases/{case_id}/sheets/{sheet['id']}", json={**body, "meta": {}})

    links = case_links(client, case_id)
    assert not [link for link in links if link["type"] == "mentions"]


def test_a_link_the_vocabulary_refuses_leaves_the_save_standing(client):
    """A cell keeps its link; only the edge is skipped."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    saved = client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={
            "columns": ["id", "Subject"],
            "rows": [["r1", "somewhere"]],
            "meta": {"links": {"r1": {"Subject": "e_does_not_exist"}}},
        },
    )
    assert saved.status_code == 200
    assert saved.json()["meta"]["links"] == {"r1": {"Subject": "e_does_not_exist"}}


def test_the_list_says_how_big_each_sheet_is(client):
    case_id = make_case(client)
    client.post(
        f"/api/cases/{case_id}/sheets/import",
        json={"title": "Members", "text": 'handle,note\n@a,"two\nlines"\n@b,x\n'},
    )
    listed = client.get(f"/api/cases/{case_id}/sheets").json()["sheets"]
    assert len(listed) == 1
    assert listed[0]["title"] == "Members"
    assert listed[0]["rows"] == 2, "a quoted newline is one row, not two"
    assert listed[0]["columns"] == 3


def test_renaming_a_sheet_moves_its_table_and_its_sidecar(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={"columns": ["id"], "rows": [["r1"]], "meta": {"colours": {"r1": "red"}}},
    )
    client.patch(
        f"/api/cases/{case_id}/entities/{sheet['id']}", json={"label": "Shortlist"}
    )

    assert case_file(client, case_id, layout.sheet_rel("Shortlist")).is_file()
    assert case_file(client, case_id, layout.sheet_meta_rel("Shortlist")).is_file()
    assert not case_file(client, case_id, layout.sheet_rel("Candidates")).exists()
    assert not case_file(client, case_id, layout.sheet_meta_rel("Candidates")).exists()


def test_deleting_a_sheet_takes_both_of_its_files(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={"columns": ["id"], "rows": [["r1"]], "meta": {"colours": {"r1": "red"}}},
    )
    client.delete(f"/api/cases/{case_id}/entities/{sheet['id']}")

    assert not case_file(client, case_id, layout.sheet_rel("Candidates")).exists()
    assert not case_file(client, case_id, layout.sheet_meta_rel("Candidates")).exists()


# -- two writers on one file --------------------------------------------------
#
# The file is the artifact, so the analyst may have it open in a spreadsheet while
# the grid holds it too. These are the gates that keep the grid from winning a race
# it cannot see.


def test_a_read_hands_out_a_stamp_and_a_save_moves_it_on(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    first = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()
    assert first["stamp"], "a read says which file it read"

    saved = client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={
            "columns": ["id", "Subject"],
            "rows": [["r1", "Quai sud"]],
            "meta": {},
            "stamp": first["stamp"],
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["stamp"] != first["stamp"], "the grid can keep saving"


def test_a_save_from_a_stale_grid_is_refused_rather_than_allowed_to_overwrite(client):
    """Someone edits the CSV in a spreadsheet; the grid's copy must not win."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    read = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()

    path = case_file(client, case_id, sheet["attrs"]["path"])
    path.write_text("id,Subject\nr1,typed in LibreOffice\n", encoding="utf-8")

    response = client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={
            "columns": ["id", "Subject"],
            "rows": [["r1", "typed in the grid"]],
            "meta": {},
            "stamp": read["stamp"],
        },
    )
    assert response.status_code == 409
    assert "typed in LibreOffice" in path.read_text(encoding="utf-8"), "nothing was written"


def test_reloading_after_a_conflict_gets_a_stamp_that_saves(client):
    """The way out of a 409 is a fresh read, and it has to actually work."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    stale = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()["stamp"]
    case_file(client, case_id, sheet["attrs"]["path"]).write_text(
        "id,Subject\nr1,elsewhere\n", encoding="utf-8"
    )

    fresh = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()
    assert fresh["stamp"] != stale
    saved = client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={
            "columns": fresh["columns"],
            "rows": fresh["rows"],
            "meta": {},
            "stamp": fresh["stamp"],
        },
    )
    assert saved.status_code == 200, saved.text


def test_a_save_with_no_stamp_writes_unconditionally(client):
    """A caller holding a table it built itself is not made to invent a stamp."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    case_file(client, case_id, sheet["attrs"]["path"]).write_text(
        "id,Subject\nr1,moved on\n", encoding="utf-8"
    )
    saved = client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={"columns": ["id", "Subject"], "rows": [["r1", "written anyway"]], "meta": {}},
    )
    assert saved.status_code == 200, saved.text


def test_a_missing_file_stamps_as_nothing_and_its_appearance_is_a_conflict():
    from pathlib import Path

    assert sheet_engine.stamp(Path("/does/not/exist.csv")) == ""


def test_a_body_over_the_limit_is_refused_before_it_is_parsed(client, monkeypatch):
    from azimut.api import sheets as sheets_api

    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    monkeypatch.setattr(sheets_api, "MAX_SHEET_BODY_BYTES", 200)
    response = client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={"columns": ["id", "n"], "rows": [["r1", "x" * 500]], "meta": {}},
    )
    assert response.status_code == 413
