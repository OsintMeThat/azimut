"""Case sheets: the CSV on disk, the sidecar beside it, and the routes.

The gate this file exists for is the first one: **a sheet is a file**. Every test
that reads `sheets/<name>.csv` back with the standard library is checking the
promise the feature is built on — that a case outlives the app holding it.
"""

import csv
import io
import json
import re
from pathlib import Path
from typing import Any

import pytest

from azimut import layout
from azimut.engine import artifacts, entities as entity_engine
from azimut.engine import sheetlinks, sheetpromote, sheetroles
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


def held(case_id, entity_id):
    """One entity as the case holds it, or None. There is no route that reads one."""
    from azimut.api.cases import get_case

    return get_case(case_id).get_entity(entity_id)


def case_entities(client, case_id, entity_type):
    from azimut.api.cases import get_case

    return [e for e in get_case(case_id).list_entities() if e.get("type") == entity_type]


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


# -- what the app knows about a column ----------------------------------------


def test_the_sidecar_keeps_roles_notes_and_the_progress_column():
    clean = sheet_engine.clean_meta(
        {
            "roles": {
                "Status": {"kind": "state", "values": ["seen", "geolocated"]},
                "Coordinates": {"kind": "latlon"},
                "Gone": {"kind": "when"},
                "Odd": {"kind": "invented"},
            },
            "notes": {"Status": "where this row got to", "Gone": "dropped with its column"},
            "progress": "Coordinates",
        },
        ["id", "Status", "Coordinates"],
        [],
    )
    assert clean["version"] == sheet_engine.META_VERSION == 6
    assert set(clean["roles"]) == {"Status", "Coordinates"}, "a role needs its column"
    assert clean["roles"]["Status"]["values"] == ["seen", "geolocated"], "the order is the ranking"
    assert clean["notes"] == {"Status": "where this row got to"}
    assert clean["progress"] == "Coordinates"


def test_a_role_keeps_only_the_fields_its_kind_uses():
    """A column that was a choice and became a when must not keep a vocabulary."""
    role = sheet_engine.clean_meta(
        {"roles": {"When": {"kind": "when", "values": ["a"], "multi": ", "}}}, ["id", "When"], []
    )["roles"]["When"]
    assert role == {"kind": "when", "shape": "date", "dayFirst": True}


def test_a_state_column_with_no_vocabulary_gets_the_default_one_painted():
    """The four words and the four colours together: a worklist is read at a glance."""
    role = sheet_engine.clean_meta({"roles": {"S": {"kind": "state"}}}, ["id", "S"], [])["roles"]["S"]
    assert role["values"] == list(sheetroles.STATE_DEFAULTS)
    assert role["colours"] == dict(sheetroles.STATE_COLOURS)


def test_the_birth_colours_lose_to_what_the_column_says():
    """Removing a colour from a line has to stick, or a value can never be un-painted."""
    roles = sheet_engine.clean_meta(
        {"roles": {"S": {"kind": "state", "values": list(sheetroles.STATE_DEFAULTS)}}},
        ["id", "S"],
        [],
    )["roles"]
    assert roles["S"]["colours"] == {}, "a vocabulary that says no colour has no colour"
    # A colour the column does state wins over the one it was born with, value by value.
    repainted = sheet_engine.clean_meta(
        {"roles": {"S": {"kind": "state", "colours": {"to do": "orange"}}}}, ["id", "S"], []
    )["roles"]["S"]
    assert repainted["colours"]["to do"] == "orange"
    assert repainted["colours"]["done"] == sheetroles.STATE_COLOURS["done"]
    # And a vocabulary the column brought itself is not painted at all: `done` among an
    # imported binder's own words means what the binder meant, not what the app assumes.
    own = sheet_engine.clean_meta(
        {"roles": {"S": {"kind": "state", "values": ["pass", "done"]}}}, ["id", "S"], []
    )["roles"]["S"]
    assert own["colours"] == {}


def test_a_boolean_column_holds_exactly_two_words():
    """Two words is what makes one click a toggle rather than a menu."""
    roles = sheet_engine.clean_meta(
        {"roles": {"Seen": {"kind": "boolean", "values": ["oui", "non", "peut-être"]}}},
        ["id", "Seen"],
        [],
    )["roles"]
    assert roles["Seen"]["values"] == ["oui", "non"]
    assert sheet_engine.clean_meta({"roles": {"S": {"kind": "boolean"}}}, ["id", "S"], [])["roles"][
        "S"
    ]["values"] == list(sheetroles.BOOLEAN_DEFAULTS)


def test_a_value_colour_is_kept_apart_from_the_value():
    """The value is what a cell is matched against, so it stays the word the file holds."""
    roles = sheet_engine.clean_meta(
        {
            "roles": {
                "Status": {
                    "kind": "state",
                    "values": ["to do", "done"],
                    "colours": {"done": "green", "gone": "red", "to do": "chartreuse"},
                }
            }
        },
        ["id", "Status"],
        [],
    )["roles"]
    assert roles["Status"]["values"] == ["to do", "done"]
    assert roles["Status"]["colours"] == {"done": "green"}


def test_a_number_column_carries_its_unit_and_where_it_is_written():
    """The sidecar has to survive the round trip, or the choice is made once per session."""
    roles = sheet_engine.clean_meta(
        {
            "roles": {
                "Share": {"kind": "number", "unit": " % ", "unitInCells": 1, "summary": "mean"},
                "Range": {"kind": "number", "unit": "km", "summary": "invented"},
            }
        },
        ["id", "Share", "Range"],
        [],
    )["roles"]
    assert roles["Share"] == {
        "kind": "number",
        "unit": "%",
        "unitInCells": True,
        "summary": "mean",
    }
    assert roles["Range"]["unitInCells"] is False, "the heading carries it until asked"
    assert roles["Range"]["summary"] == "sum", "a column of counts wants a total"


def test_a_when_column_is_told_which_of_the_three_it_holds():
    """Declared, not inferred: a column that is still empty has to be tellable."""
    roles = sheet_engine.clean_meta(
        {"roles": {"At": {"kind": "when", "shape": "time"}, "On": {"kind": "when", "shape": "odd"}}},
        ["id", "At", "On"],
        [],
    )["roles"]
    assert roles["At"]["shape"] == "time"
    assert roles["On"]["shape"] == "date"


def test_a_picture_column_is_stored_as_a_kind_and_nothing_else():
    """A picture is a lens like the others: the file keeps the address, and the grid is
    the only thing that draws anything from it."""
    roles = sheet_engine.clean_meta(
        {"roles": {"Shot": {"kind": "picture", "values": ["a"]}}}, ["id", "Shot"], []
    )["roles"]
    assert roles["Shot"] == {"kind": "picture"}


def test_a_column_of_values_no_longer_stores_a_way_to_count_them():
    """Reading `2x S-125` as two of `S-125` kept a count in a column of values. A count
    belongs in a number column beside a column naming what is counted."""
    roles = sheet_engine.clean_meta(
        {"roles": {"Equipments": {"kind": "choice", "multi": ", ", "quantities": True}}},
        ["id", "Equipments"],
        [],
    )["roles"]
    assert roles["Equipments"] == {
        "kind": "choice",
        "values": [],
        "colours": {},
        "multi": ", ",
    }


def test_a_computed_column_is_pinned_to_a_nature_the_server_knows():
    roles = sheet_engine.clean_meta(
        {"roles": {"On map": {"kind": "computed", "of": "invented"}}}, ["id", "On map"], []
    )["roles"]
    assert roles["On map"]["of"] == "has_point"


def test_a_row_column_names_the_column_whose_words_point_at_the_other_row():
    """Names and not keys: the file keeps the words, so a link a reader can follow."""
    roles = sheet_engine.clean_meta(
        {"roles": {"Links": {"kind": "row", "of": "Unit", "multi": ", "}}},
        ["id", "Unit", "Links"],
        [],
    )["roles"]
    assert roles["Links"] == {"kind": "row", "of": "Unit", "multi": ", "}
    # A naming column that left the file loses its pointer rather than keeping one into
    # a column nobody can see.
    gone = sheet_engine.clean_meta(
        {"roles": {"Links": {"kind": "row", "of": "Renamed"}}}, ["id", "Unit", "Links"], []
    )["roles"]
    assert gone["Links"]["of"] is None


def test_an_offset_column_names_its_anchor_even_before_the_anchor_is_dated():
    """Relative order is worth having long before anybody works out when the shot was."""
    clean = sheet_engine.clean_meta(
        {
            "roles": {"start synchro": {"kind": "offset", "anchor": "IGLA launch"}},
            "anchors": {"IGLA launch": {"at": ""}},
        },
        ["id", "start synchro"],
        [],
    )
    assert clean["roles"]["start synchro"]["anchor"] == "IGLA launch"
    assert clean["anchors"] == {"IGLA launch": {"at": ""}}


def test_an_anchor_takes_a_timestamp_and_never_a_bare_date():
    """A date read as midnight would hand ten videos a moment nobody claimed."""
    clean = sheet_engine.clean_meta(
        {
            "anchors": {
                "IGLA launch": {"at": "2026-01-03T01:57:00Z"},
                "second impact": {"at": "2026-01-03"},
                "  ": {"at": "2026-01-03T02:00:00Z"},
            }
        },
        ["id"],
        [],
    )
    assert clean["anchors"]["IGLA launch"] == {"at": "2026-01-03T01:57:00Z"}
    assert clean["anchors"]["second impact"] == {"at": ""}
    assert "  " not in clean["anchors"]


def test_a_linked_nature_names_the_column_whose_link_it_follows():
    """A sheet may point at the case from two columns, so "whatever this row points at"
    would answer about whichever one the walk reached first."""
    roles = sheet_engine.clean_meta(
        {
            "roles": {
                "Point": {"kind": "computed", "of": "point", "from": "Subject"},
                "Ties": {"kind": "computed", "of": "relations", "from": "Subject"},
                "Lost": {"kind": "computed", "of": "point", "from": "Renamed"},
            }
        },
        ["id", "Subject", "Point", "Ties", "Lost"],
        [],
    )["roles"]
    assert roles["Point"] == {"kind": "computed", "of": "point", "from": "Subject"}
    assert roles["Ties"]["multi"] == ", "
    assert roles["Lost"]["from"] is None


def test_a_row_keeps_the_case_files_it_carries_and_a_column_keeps_what_its_words_mean():
    """Two tables, two grains. A link is one cell pointing at one entity and cannot
    answer a cell holding three pieces of equipment; a vocabulary pointed at the case
    can, and it is the grain a whole column is promoted at."""
    clean = sheet_engine.clean_meta(
        {
            "attachments": {"r1": ["e_shot", "e_shot", ""], "r9": ["e_ghost"]},
            "values": {"Kit": {"Buk-M2E": "e_buk", " ": "e_blank"}, "Gone": {"x": "e_x"}},
            "description": "  What is left to geolocate.  ",
        },
        ["id", "Kit"],
        [["r1", "Buk-M2E"]],
    )
    assert clean["attachments"] == {"r1": ["e_shot"]}, "a row that left takes its pieces"
    assert clean["values"] == {"Kit": {"Buk-M2E": "e_buk"}}
    assert clean["description"] == "What is left to geolocate."


def test_a_sheet_mentions_what_its_words_mean_and_what_its_rows_carry():
    """All three are the same statement — this sheet refers to that — so all three earn
    the edge. A piece reachable only from the sheet would be a file the subject's own
    panel could not see."""
    found = sheet_engine.linked_entity_ids(
        {
            "links": {"r1": {"Subject": "e_unit"}},
            "values": {"Kit": {"Buk-M2E": "e_buk"}},
            "attachments": {"r1": ["e_shot", "e_unit"]},
        }
    )
    assert found == ["e_unit", "e_buk", "e_shot"]


def test_the_key_column_is_found_whatever_case_the_file_spells_it_in():
    """An exported table routinely writes `ID`, and `normalize` keeps a file's own
    spelling — so every reader has to match without regard to case or the sidecar of the
    very files this module promises to adopt raises instead of cleaning."""
    columns, rows = sheet_engine.parse_csv("ID,Name\n42,Quai sud\n")
    assert columns == ["ID", "Name"]
    assert sheet_engine.key_index(columns) == 0
    clean = sheet_engine.clean_meta({"colours": {"42": "red"}}, columns, rows)
    assert clean["colours"] == {"42": "red"}


def test_an_older_sidecar_still_reads_and_is_written_as_the_current_one():
    """Reopening a sheet from before roles existed costs nothing."""
    clean = sheet_engine.clean_meta(
        {"version": 1, "widths": {"Status": 200}, "colours": {"r1": "red"}},
        ["id", "Status"],
        [["r1", "seen"]],
    )
    assert clean["version"] == sheet_engine.META_VERSION
    assert clean["widths"] == {"Status": 200}
    assert clean["colours"] == {"r1": "red"}
    assert clean["roles"] == {}
    assert clean["promoted"] == {}


def test_the_sidecar_keeps_what_a_promoted_cell_said_and_drops_the_rest():
    """A link cannot say a row has moved on: it is the same link after an edit."""
    clean = sheet_engine.clean_meta(
        {"promoted": {"r1": {"Unit": "3rd Brigade", "Gone": "x"}, "r9": {"Unit": "ghost"}}},
        ["id", "Unit"],
        [["r1", "3rd Separate Brigade"]],
    )
    assert clean["promoted"] == {"r1": {"Unit": "3rd Brigade"}}


def test_the_two_role_vocabularies_are_the_same_list_on_both_sides():
    """The browser draws chips from its own copy, so the two copies have to agree.

    Same gate as `ROW_COLOURS`: a role the grid offers and the server drops would be a
    column the analyst configures and the file never remembers.
    """
    source = (
        Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "sheetRoles.js"
    ).read_text(encoding="utf-8-sig")

    def js_list(name: str) -> list[str]:
        match = re.search(rf"export const {name} = \[(.*?)\]", source, re.S)
        assert match, f"{name} not found in sheetRoles.js"
        return re.findall(r"'([^']+)'", match.group(1))

    def js_map(name: str) -> dict[str, str]:
        match = re.search(rf"export const {name} = \{{(.*?)\n\}}", source, re.S)
        assert match, f"{name} not found in sheetRoles.js"
        return dict(re.findall(r"'([^']+)':\s*'([^']+)'", match.group(1)))

    assert js_list("ROLE_KINDS") == list(sheetroles.ROLE_KINDS)
    assert js_list("STATE_DEFAULTS") == list(sheetroles.STATE_DEFAULTS)
    assert js_map("STATE_COLOURS") == dict(sheetroles.STATE_COLOURS)
    assert js_list("BOOLEAN_DEFAULTS") == list(sheetroles.BOOLEAN_DEFAULTS)
    assert js_list("WHEN_SHAPES") == list(sheetroles.WHEN_SHAPES)
    assert js_list("COMPUTED_NATURES") == list(sheetroles.COMPUTED_NATURES)
    assert js_list("NUMBER_SUMMARIES") == list(sheetroles.NUMBER_SUMMARIES)
    assert js_list("ROW_COLOURS") == list(sheet_engine.ROW_COLOURS)


def test_the_server_reads_the_same_moment_out_of_a_cell_as_the_browser_does():
    """Promotion dates a Claim off a cell, so the reading cannot be the browser's alone.

    The impossible date is the one that matters: `Date.UTC` rolls 29 February in a common
    year forward to 1 March, so a column holding one used to sort as though it were the
    day after. Both sides refuse it now.
    """
    assert sheetroles.parse_when("01:57")["clock"] == "01:57:00"
    assert sheetroles.parse_when("31/01/2026")["date"] == "2026-01-31"
    assert sheetroles.parse_when("01/02/2026", {"dayFirst": False})["date"] == "2026-01-02"
    assert sheetroles.parse_when("Sat, 03 Jan 2026 06:42:02 GMT")["clock"] == "06:42:02"
    assert sheetroles.parse_when("29/02/2025") is None
    assert sheetroles.parse_when("?") is None


#: The cells both readers are held to, and the reading they must agree on. Lives beside the
#: browser's copy of the reader so one file cannot be edited without the other being seen.
READING_FIXTURE = (
    Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "sheetReading.fixture.json"
)


def shared_cells() -> dict[str, Any]:
    return json.loads(READING_FIXTURE.read_text(encoding="utf-8"))


def test_both_readers_answer_the_same_thing_about_a_shared_list_of_cells():
    """The parity gate the vocabulary lists had and the readings did not.

    Comparing `ROLE_KINDS` to `ROLE_KINDS` proves the two sides offer the same words, never
    that they *read* a cell the same way — and they had drifted where it counts: the server
    took `03/01/2026 99:00` for an hour and the browser took `12:30:75` for a time, so a
    cell the grid sorted without a word was refused at the promotion with a message about a
    value nobody had typed. The other half of this test is `lib/sheetRoles.test.js`, over
    this same file.
    """
    shared = shared_cells()
    assert shared["when"] and shared["point"], "the fixture is the gate; an empty one is none"

    for case in shared["when"]:
        read = sheetroles.parse_when(case["cell"], case.get("role"))
        wanted = case["reads"]
        if wanted is None:
            assert read is None, f"{case['cell']!r} should not read as a moment"
            continue
        assert read is not None, f"{case['cell']!r} should read as a moment"
        assert read["shape"] == wanted["shape"], case["cell"]
        assert read["text"] == wanted["text"], case["cell"]

    for case in shared["point"]:
        point = sheetroles.parse_latlon(case["cell"])
        wanted = case["reads"]
        if wanted is None:
            assert point is None, f"{case['cell']!r} should not read as a point"
            continue
        assert point is not None, f"{case['cell']!r} should read as a point"
        assert point["lat"] == pytest.approx(wanted["lat"], abs=1e-6), case["cell"]
        assert point["lon"] == pytest.approx(wanted["lon"], abs=1e-6), case["cell"]
        assert point["decimals"] == wanted["decimals"], case["cell"]


def test_the_types_that_own_a_file_are_the_same_list_on_both_sides():
    """The delete dialog promises what it is about to take, so it has to know.

    `artifacts.KINDS` is where a type declares its files and `lib/trash.FILE_BACKED` is what
    the confirmation reads to choose its sentence — two lists of one fact, and they drifted
    at the moment `sheet` gained a file: deleting the artifact whose whole design is "the
    file is the sheet" announced that only the item was going. Gated here like the role
    vocabularies, so the next type to gain a file cannot forget the dialog.
    """
    source = (
        Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "trash.js"
    ).read_text(encoding="utf-8-sig")
    match = re.search(r"export const FILE_BACKED = new Set\(\[(.*?)\]\)", source, re.S)
    assert match, "FILE_BACKED not found in trash.js"
    assert sorted(re.findall(r"'([^']+)'", match.group(1))) == sorted(artifacts.KINDS)


def test_no_sheet_route_carrying_a_table_is_parsed_before_it_is_bounded():
    """The gate that stops the fifth recurrence, rather than a fifth entry in a list.

    `BulkBodyLimit.ROUTES` is spelled out by hand, and four routes that carry a whole table
    had been added without one — `parse`, `move/undo`, `proofs` and `meta` — each of them
    letting Pydantic materialise the body before `normalize` could refuse it. Enumerated
    here instead: a body model holding a table or the text of a CSV must answer a limit.
    """
    from azimut.api import sheetproofs, sheets as sheets_api
    from azimut.server import BulkBodyLimit

    carries = {"columns", "rows", "text", "meta"}
    checked = 0
    for router in (sheets_api.router, sheetproofs.router):
        for route in router.routes:
            body = getattr(route, "body_field", None)
            model = getattr(getattr(body, "field_info", None), "annotation", None)
            fields = set(getattr(model, "model_fields", {}) or {})
            if not carries & fields:
                continue
            for method in sorted(getattr(route, "methods", set()) & {"POST", "PUT"}):
                path = re.sub(r"\{[^}]+\}", "x", route.path)
                limit = BulkBodyLimit._limit({"type": "http", "method": method, "path": path})
                assert limit is not None, f"{method} {route.path} carries {carries & fields}"
                checked += 1
    # The count is the test's own gate: a router that stopped exposing `body_field` would
    # otherwise make this pass by checking nothing.
    assert checked >= 8, checked


def test_a_comma_is_read_as_a_decimal_mark_and_never_as_a_thousands_separator():
    """One reading of a comma across the app, and it is the European one.

    A number and a point are the two places a comma is ambiguous, and guessing per column
    would be two answers to one question. So `1,234` is one and a bit, `1 234,5` is a
    thousand, `1,234,567` is refused rather than read as a million, and `48,8` is a number
    and not a pair of coordinates. Written down in UI.md where `dayFirst` is explained,
    because it is the same class of decision and the only other one the analyst cannot see.
    """
    field = entity_engine.Attr(key="count", label="Count", kind="number")
    assert sheetpromote.read_attr(field, "1,234") == (1.234, None)
    assert sheetpromote.read_attr(field, "1 234,5") == (1234.5, None)
    assert sheetpromote.read_attr(field, "12,5")[0] == 12.5
    # Two commas cannot be two decimal marks, so the cell is refused rather than guessed.
    assert sheetpromote.read_attr(field, "1,234,567")[0] is None
    assert "not a number" in str(sheetpromote.read_attr(field, "1,234,567")[1])


def test_a_bare_clock_is_dated_by_the_sheet_and_never_by_the_server():
    """The binders' `Local time` is `01:57` for an event whose date is in the title, and
    a moment invented for it would be invented evidence. Local by default, too: stamping
    `Z` on it would move the evidence by however far away it happened."""
    clock = sheetroles.parse_when("01:57")
    assert sheetroles.claim_moment(clock) is None
    assert sheetroles.claim_moment(clock, day="2026-01-03") == "2026-01-03T01:57:00"
    assert sheetroles.claim_moment(clock, day="2026-01-03", zone="Z") == "2026-01-03T01:57:00Z"
    # A cell that named only a day stays a day: a reduced date is inside the profile.
    assert sheetroles.claim_moment(sheetroles.parse_when("31/01/2026")) == "2026-01-31"


def test_an_offset_is_read_in_the_four_spellings_a_player_produces():
    assert sheetroles.parse_offset("-00:01:50") == -110
    assert sheetroles.parse_offset("00:04:04") == 244
    assert sheetroles.parse_offset("1:05") == 65
    assert sheetroles.parse_offset("-110") == -110
    assert sheetroles.parse_offset("00:00:61") is None
    assert sheetroles.parse_offset("then") is None
    assert sheetroles.format_offset(-110) == "-00:01:50"
    assert sheetroles.offset_moment("2026-01-03T01:57:00Z", -110) == "2026-01-03T01:55:10Z"
    assert sheetroles.offset_moment("", -110) is None, "an undated anchor dates nothing"


def test_a_row_column_reaches_a_row_only_where_one_row_answers_to_the_name():
    """The binders' own version had already decayed to `#REF!`. Read from the words every
    time, the same decay becomes a list of what to fix."""
    columns = ["id", "Unit", "Links"]
    rows = [
        ["r1", "3rd Brigade", "1st Coy, 2nd Coy"],
        ["r2", "1st Coy", "3rd Brigade"],
        ["r3", "2nd Coy", "3rd Brigade"],
        ["r4", "Recon Coy", "3rd Bde"],
    ]
    found = sheetroles.row_targets(
        columns, rows, "Links", {"kind": "row", "of": "Unit", "multi": ", "}
    )
    assert found["r1"]["keys"] == ["r2", "r3"]
    assert found["r2"]["keys"] == ["r1"]
    assert found["r4"] == {"keys": [], "missing": ["3rd Bde"]}


def test_the_server_reads_the_three_shapes_a_point_is_written_in():
    """Promotion writes places, so the server reads a point rather than trusting one."""
    plain = sheetroles.parse_latlon("48.8566, 2.3522")
    assert (plain["lat"], plain["lon"]) == (48.8566, 2.3522)
    assert plain["decimals"] == 4 and not plain["out_of_bounds"]

    # A pair written with no hemisphere is northern and eastern. It came out mirrored
    # into the south Atlantic while an empty hemisphere counted as a match for "S".
    assert sheetroles.parse_latlon("48.8566 2.3522")["lat"] > 0

    hemispheres = sheetroles.parse_latlon("48.8566N, 2.3522W")
    assert (hemispheres["lat"], hemispheres["lon"]) == (48.8566, -2.3522)

    dms = sheetroles.parse_latlon("48°51'24\"N 2°21'08\"E")
    assert round(dms["lat"], 4) == 48.8567 and round(dms["lon"], 4) == 2.3522

    assert sheetroles.parse_latlon("1 234,5")["out_of_bounds"] is True
    assert sheetroles.parse_latlon("To be found") is None
    assert sheetroles.parse_latlon("") is None
    # Two decimals is about a kilometre, which is the claim the cell actually made.
    assert sheetroles.precision_metres(2) == 1113
    assert sheetroles.precision_metres(5) == 1


def test_a_claim_is_the_one_manual_type_a_row_cannot_become():
    from azimut.engine import sheetpromote

    promotable = sheetpromote.promotable_types()
    assert "person" in promotable and "place" in promotable
    assert "claim" not in promotable
    assert "media" not in promotable, "a media is born from an import, not from a row"


# -- the routes ---------------------------------------------------------------


def test_a_new_sheet_is_a_real_csv_in_the_case(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")

    assert sheet["type"] == "sheet"
    rel = sheet["attrs"]["path"]
    assert rel == layout.sheet_rel("Candidates")
    path = case_file(client, case_id, rel)
    assert path.is_file()
    assert path.read_text(encoding="utf-8-sig").splitlines()[0] == "id,Subject,Status,Notes"


def test_the_csv_carries_a_byte_order_mark_so_excel_reads_it(client):
    """Excel opens a UTF-8 CSV with no mark in the machine's legacy codepage, which turns
    every accent in a case into mojibake. We ship a Windows binary, so the mark goes in —
    and every reader in the engine opens files as `utf-8-sig`, which takes it back off."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={"columns": ["id", "Subject"], "rows": [["r1", "Rue de l'Égalité"]], "meta": {}},
    )
    path = case_file(client, case_id, sheet["attrs"]["path"])

    assert path.read_bytes().startswith(b"\xef\xbb\xbf"), "Excel needs the mark"
    read = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()
    assert read["columns"] == ["id", "Subject"], "and the grid never sees it"
    assert read["rows"][0][1] == "Rue de l'Égalité"


def test_the_sidecar_carries_no_mark(client):
    """A BOM in JSON breaks strict parsers, and nothing opens the sidecar in Excel."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={"columns": ["id"], "rows": [["r1"]], "meta": {"widths": {"id": 120}}},
    )
    meta_path = case_file(client, case_id, layout.sheet_meta_rel("Candidates"))

    assert not meta_path.read_bytes().startswith(b"\xef\xbb\xbf")
    assert json.loads(meta_path.read_text(encoding="utf-8"))["widths"] == {"id": 120}


def test_a_write_that_fails_leaves_the_previous_table_untouched(tmp_path):
    """`write_text` truncates and then writes, so dying in between costs the analyst the
    table. The sheet is *the* artifact here, so the new copy lands by rename or not at
    all."""
    path = tmp_path / "Candidates.csv"
    sheet_engine.write_atomic(path, "id,Subject\nr1,Quai sud\n", encoding=sheet_engine.CSV_ENCODING)
    before = path.read_bytes()

    with pytest.raises(sheet_engine.SheetUnwritable):
        sheet_engine.write_atomic(path / "not-a-directory", "x", encoding="utf-8")

    assert path.read_bytes() == before, "the table that was there is still there"
    assert not list(tmp_path.glob(".*.tmp")), "and nothing is left lying beside it"


def test_a_file_the_system_refuses_is_a_409_naming_it(client, monkeypatch):
    """The Windows case: the analyst has the CSV open in Excel, which holds the handle.
    That is not a bad request and not a stale grid — it is a file that is busy, and a 500
    reading `HTTP 500` in a toast tells the analyst nothing they can act on."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")

    def refuse(path, text, *, encoding):
        raise sheet_engine.SheetUnwritable("could not write “Candidates.csv”: it is open elsewhere")

    monkeypatch.setattr(sheet_engine, "write_atomic", refuse)
    answer = client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={"columns": ["id"], "rows": [["r1"]], "meta": {}},
    )

    assert answer.status_code == 409
    assert "open elsewhere" in answer.json()["detail"]


def test_a_file_the_system_refuses_leaves_no_sheet_in_the_case(client, monkeypatch):
    """A sheet the list shows and nothing can open is worse than no sheet at all.

    The row used to be filed first and the path written last, so the three cases
    `SheetUnwritable` exists for — a read-only folder, a full disk, a name taken by a
    directory — each left an entity with no `path`: it appeared in the list as an empty
    sheet, answered 404 on open, and the analyst could only delete it. The file is written
    first now, so a refusal leaves the case as it was.
    """
    case_id = make_case(client)

    def refuse(path, text, *, encoding):
        raise sheet_engine.SheetUnwritable("could not write “Candidates.csv”: the folder is read-only")

    monkeypatch.setattr(sheet_engine, "write_atomic", refuse)
    answer = client.post(f"/api/cases/{case_id}/sheets", json={"title": "Candidates"})

    assert answer.status_code == 409
    assert client.get(f"/api/cases/{case_id}/sheets").json()["sheets"] == []


def test_a_new_sheet_can_be_born_with_the_columns_a_template_names(client):
    """A template is a list of headings; what the app knows about them is the sidecar's,
    and it arrives by the save that follows."""
    case_id = make_case(client)
    made = client.post(
        f"/api/cases/{case_id}/sheets",
        json={"title": "Geo", "columns": ["Subject", "Picture", "Coordinates", "Status"]},
    )
    assert made.status_code == 200, made.text
    path = case_file(client, case_id, made.json()["attrs"]["path"])
    assert (
        path.read_text(encoding="utf-8-sig").splitlines()[0]
        == "id,Subject,Picture,Coordinates,Status"
    )


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
    assert path.read_text(encoding="utf-8-sig").startswith("id,plate")

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
    assert list(csv.reader(io.StringIO(path.read_text(encoding="utf-8-sig")))) == [
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
    text = case_file(client, case_id, sheet["attrs"]["path"]).read_text(encoding="utf-8-sig")
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


def test_deleting_an_entity_clears_the_cells_that_pointed_at_it(client):
    """A sheet cannot outlive what it points at.

    The link is an id in a sidecar rather than an edge, so nothing in the graph delete
    reaches it: the cell stayed marked as linked to a row the case no longer held, and
    the next save wrote the dead id back.
    """
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    going = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "person", "label": "Witness A"}
    ).json()
    staying = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "person", "label": "Witness B"}
    ).json()
    client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={
            "columns": ["id", "Subject"],
            "rows": [["r1", "Witness A"], ["r2", "Witness B"]],
            "meta": {
                "links": {"r1": {"Subject": going["id"]}, "r2": {"Subject": staying["id"]}},
                "values": {"Subject": {"Witness A": going["id"]}},
                "colours": {"r1": "grey"},
            },
        },
    )

    client.delete(f"/api/cases/{case_id}/entities/{going['id']}")

    read = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()
    assert read["meta"]["links"] == {"r2": {"Subject": staying["id"]}}
    assert read["meta"]["values"] == {}
    # only the pointers go: the reading built around them is not what was deleted
    assert read["meta"]["colours"] == {"r1": "grey"}
    assert read["rows"] == [["r1", "Witness A"], ["r2", "Witness B"]]


def test_a_selection_deleted_at_once_clears_every_sheet_it_was_read_in(client):
    case_id = make_case(client)
    first = new_sheet(client, case_id, "Candidates")
    second = new_sheet(client, case_id, "Sightings")
    going = [
        client.post(
            f"/api/cases/{case_id}/entities", json={"type": "person", "label": name}
        ).json()
        for name in ("Witness A", "Witness B")
    ]
    for sheet, entity in zip((first, second), going, strict=True):
        client.put(
            f"/api/cases/{case_id}/sheets/{sheet['id']}",
            json={
                "columns": ["id", "Subject"],
                "rows": [["r1", entity["label"]]],
                "meta": {"links": {"r1": {"Subject": entity["id"]}}},
            },
        )

    client.post(
        f"/api/cases/{case_id}/entities/delete", json={"ids": [row["id"] for row in going]}
    )

    for sheet in (first, second):
        read = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()
        assert read["meta"]["links"] == {}


def test_a_sheet_untouched_by_a_delete_keeps_its_file_as_it_was(client):
    """Only the sheets that pointed at the deleted material are rewritten."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    kept = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "person", "label": "Witness B"}
    ).json()
    other = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "person", "label": "Nobody"}
    ).json()
    client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={
            "columns": ["id", "Subject"],
            "rows": [["r1", "Witness B"]],
            "meta": {"links": {"r1": {"Subject": kept["id"]}}},
        },
    )
    meta_path = case_file(client, case_id, layout.sheet_meta_rel("Candidates"))
    before = meta_path.read_bytes()
    written = meta_path.stat().st_mtime_ns

    client.delete(f"/api/cases/{case_id}/entities/{other['id']}")

    assert meta_path.read_bytes() == before
    assert meta_path.stat().st_mtime_ns == written


def test_a_delete_that_fails_gives_the_sheets_back_along_with_the_entities(client, monkeypatch):
    """The rollback restores the graph and the trash. It cannot restore a sidecar.

    So clearing the sheets inside the `try` meant a refused delete handed the entities back
    with the cells' links, the columns' vocabularies and the rows' attached pieces already
    gone for good, across every sheet in the case — an analyst looking at intact entities
    and vanished chips, with nothing to say why. Cleared after the commit now, where there
    is nothing left to roll back.
    """
    from azimut.engine import trash as trash_engine

    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    going = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "person", "label": "Witness A"}
    ).json()
    client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={
            "columns": ["id", "Subject"],
            "rows": [["r1", "Witness A"]],
            "meta": {
                "links": {"r1": {"Subject": going["id"]}},
                "values": {"Subject": {"Witness A": going["id"]}},
            },
        },
    )
    meta_path = case_file(client, case_id, layout.sheet_meta_rel("Candidates"))
    before = meta_path.read_bytes()

    def refuse(case, group_id):
        raise OSError("the trash could not be committed")

    monkeypatch.setattr(trash_engine, "commit", refuse)
    with pytest.raises(OSError, match="could not be committed"):
        client.delete(f"/api/cases/{case_id}/entities/{going['id']}")

    assert meta_path.read_bytes() == before, "the sidecar is byte-identical"
    read = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()
    assert read["meta"]["links"] == {"r1": {"Subject": going["id"]}}
    assert held(case_id, going["id"]) is not None, "and the entity came back"


def test_a_sheet_whose_sidecar_refuses_does_not_take_the_delete_down_with_it(client, monkeypatch):
    """One sheet whose file is busy is not a reason to fail a delete, which is what the
    sweep says it does — and `SheetUnwritable` is a `ValueError`, so it used to escape the
    sentence that was written to swallow exactly this."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    going = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "person", "label": "Witness A"}
    ).json()
    client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={
            "columns": ["id", "Subject"],
            "rows": [["r1", "Witness A"]],
            "meta": {"links": {"r1": {"Subject": going["id"]}}},
        },
    )

    def refuse(path, text, *, encoding):
        raise sheet_engine.SheetUnwritable("could not write “Candidates.json”: it is open")

    monkeypatch.setattr(sheet_engine, "write_atomic", refuse)
    answer = client.delete(f"/api/cases/{case_id}/entities/{going['id']}")

    assert answer.status_code == 200, answer.text
    assert held(case_id, going["id"]) is None, "the delete went through"


def test_a_link_the_case_cannot_answer_for_is_dropped_rather_than_refused(client):
    """The save lands and the dead link does not.

    A cell pointing at nothing is worse than a plain cell: it reads as work already
    done, and its mark opens a panel about an entity nobody can see. The words in the
    cell are the analyst's and stay — the link is what the case knows, the text is what
    the file says.
    """
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
    assert saved.json()["meta"]["links"] == {}
    assert saved.json()["rows"] == [["r1", "somewhere"]]


def test_a_sheet_stops_showing_a_link_the_case_no_longer_holds(client):
    """The rule holds however the dead id got there, not only through a delete.

    A sidecar carried in from another case, a case restored beside sheets written
    against older ids, a file edited by hand: none of those passes through the delete,
    and all of them leave a cell claiming a link to nothing.
    """
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    kept = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "person", "label": "Witness B"}
    ).json()
    client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={
            "columns": ["id", "Subject"],
            "rows": [["r1", "Witness B"], ["r2", "Nobody"]],
            "meta": {"links": {"r1": {"Subject": kept["id"]}}},
        },
    )
    # straight into the sidecar, behind the app's back
    meta_path = case_file(client, case_id, layout.sheet_meta_rel("Candidates"))
    stored = json.loads(meta_path.read_text(encoding="utf-8"))
    stored["links"]["r2"] = {"Subject": "e_from_another_case"}
    meta_path.write_text(json.dumps(stored), encoding="utf-8")
    csv_path = case_file(client, case_id, sheet["attrs"]["path"])
    before = csv_path.read_bytes()

    read = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()

    assert read["meta"]["links"] == {"r1": {"Subject": kept["id"]}}
    # reading never writes: the table is byte-identical and the sidecar still says what
    # it said, so a case opened to be looked at is left as it was found
    assert csv_path.read_bytes() == before
    assert "e_from_another_case" in meta_path.read_text(encoding="utf-8")


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


# -- the two columns the app fills, not the analyst ---------------------------
#
# Both land **in the CSV** rather than beside it. `On map: YES/NO` is precisely the
# column a collaborator opening the spreadsheet reads, and a sidecar copy of it would
# vanish at the moment the file is handed over.


def save(client, case_id, sheet, columns, rows, meta):
    return client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={"columns": columns, "rows": rows, "meta": meta},
    )


def test_a_stamped_column_dates_a_row_once_and_never_again(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Worklist")
    meta = {"roles": {"Added": {"kind": "stamped"}}}

    first = save(client, case_id, sheet, ["id", "Added", "Note"], [["r1", "", "a"]], meta)
    stamped = first.json()["rows"][0][1]
    assert stamped, "a new row is dated"

    # A stamp that moved on every save would say when the sheet was last touched, which
    # the filesystem already says, instead of when the row appeared.
    again = save(
        client, case_id, sheet, ["id", "Added", "Note"], [["r1", stamped, "b"], ["r2", "", "c"]], meta
    )
    rows = again.json()["rows"]
    assert rows[0][1] == stamped
    assert rows[1][1] == stamped, "and the new row is dated too"


def test_a_stamp_is_a_column_of_the_file(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Worklist")
    save(
        client, case_id, sheet, ["id", "Added"], [["r1", ""]], {"roles": {"Added": {"kind": "stamped"}}}
    )
    text = case_file(client, case_id, sheet["attrs"]["path"]).read_text(encoding="utf-8-sig")
    assert "id,Added" in text
    assert text.strip().splitlines()[1].startswith("r1,20"), "the date is in the CSV"


def test_a_computed_column_answers_from_the_case_and_not_from_the_cell(client):
    """`On map` is the binders' column, and what it meant was *this has a place*."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Registry")
    place = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": "place", "label": "Quai sud", "attrs": {"lat": 48.85, "lon": 2.35}},
    ).json()
    unit = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "organization", "label": "3rd Brigade"}
    ).json()

    answer = save(
        client,
        case_id,
        sheet,
        ["id", "Subject", "On map"],
        [["r1", "Quai sud", "whatever was typed"], ["r2", "3rd Brigade", ""]],
        {
            "roles": {"On map": {"kind": "computed", "of": "has_point"}},
            "links": {"r1": {"Subject": place["id"]}, "r2": {"Subject": unit["id"]}},
        },
    )
    rows = answer.json()["rows"]
    assert rows[0][2] == "YES", "the place has a point"
    # The brigade points at an entity and has no place: `linked` would have said YES
    # here, which is not what the binder's column says.
    assert rows[1][2] == "NO"


def test_a_counting_column_answers_from_the_row_and_never_walks_the_graph(client):
    """The one kind of formula this tool has: how many of the chosen columns are answered.

    A comparison grid is candidates down and criteria across, and the number the analyst
    wants at the end of the row is how many criteria this candidate meets. It reads the
    row's own cells, so a sheet whose only computed column is a score has no business
    listing every entity the case holds.
    """
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    answer = save(
        client,
        case_id,
        sheet,
        ["id", "Plate", "Face", "Time", "Complete"],
        [
            ["r1", "AB-123", "seen", "14:20", "whatever was typed"],
            ["r2", "AB-123", "", "", ""],
            ["r3", "", "", "", "3"],
        ],
        {
            "roles": {
                "Complete": {
                    "kind": "computed",
                    "of": "filled_of",
                    "columns": ["Plate", "Face", "Time"],
                }
            }
        },
    )
    assert [row[4] for row in answer.json()["rows"]] == ["3", "1", "0"]
    # The denominator is said in the panel and in the heading, never in four hundred
    # cells: the file holds the bare number a spreadsheet can add up.
    assert answer.json()["meta"]["roles"]["Complete"]["columns"] == ["Plate", "Face", "Time"]


def test_a_score_counts_a_yes_the_way_each_column_spells_one(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    answer = save(
        client,
        case_id,
        sheet,
        ["id", "Plate", "Face", "Score"],
        [
            # `oui` is this column's own first value; `x` is what a hand-typed tick holds.
            ["r1", "oui", "x", ""],
            ["r2", "non", "no", ""],
            # `yes` is not this column's word for yes, so the column's own vocabulary wins.
            ["r3", "yes", "TRUE", ""],
        ],
        {
            "roles": {
                "Plate": {"kind": "boolean", "values": ["oui", "non"]},
                "Score": {"kind": "computed", "of": "yes_of", "columns": ["Plate", "Face"]},
            }
        },
    )
    assert [row[3] for row in answer.json()["rows"]] == ["2", "0", "1"]


def test_a_counting_column_told_to_count_nothing_writes_nothing(client):
    """Not every column: a score over the whole sheet is a number nobody asked for, and it
    would change under the analyst every time a column is added."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    answer = save(
        client,
        case_id,
        sheet,
        ["id", "Plate", "Complete"],
        [["r1", "AB-123", "9"]],
        {"roles": {"Complete": {"kind": "computed", "of": "filled_of", "columns": []}}},
    )
    assert answer.json()["rows"][0][2] == ""


def test_a_counting_column_forgets_a_column_that_left_the_file(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    answer = save(
        client,
        case_id,
        sheet,
        ["id", "Plate", "Complete"],
        [["r1", "AB-123", ""]],
        {
            "roles": {
                "Complete": {"kind": "computed", "of": "filled_of", "columns": ["Plate", "Gone"]}
            }
        },
    )
    assert answer.json()["meta"]["roles"]["Complete"]["columns"] == ["Plate"]
    assert answer.json()["rows"][0][2] == "1", "counted over what is there"


def link(client, case_id, from_id, to_id, type_):
    made = client.post(
        f"/api/cases/{case_id}/links", json={"from_id": from_id, "to_id": to_id, "type": type_}
    )
    assert made.status_code == 200, made.text


def test_a_linked_column_writes_the_point_the_case_holds_and_not_a_yes(client):
    """What `has_point` is not. It answers *whether* the case knows; this answers **what**
    it knows, which is the number that was being copied by hand into the column along."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Registry")
    place = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": "place", "label": "Quai sud", "attrs": {"lat": 48.8566, "lon": 2.3522}},
    ).json()

    answer = save(
        client,
        case_id,
        sheet,
        ["id", "Subject", "Point"],
        [["r1", "Quai sud", ""], ["r2", "Pont nord", "stale"]],
        {
            "links": {"r1": {"Subject": place["id"]}},
            "roles": {"Point": {"kind": "computed", "of": "point", "from": "Subject"}},
        },
    )
    assert [row[2] for row in answer.json()["rows"]] == ["48.85660, 2.35220", ""]
    # Written into the CSV like every other computed column: the collaborator opening the
    # file is owed the coordinates, not an empty column.
    written = case_file(client, case_id, sheet["attrs"]["path"]).read_text(encoding="utf-8-sig")
    assert "48.85660, 2.35220" in written


def test_a_linked_column_writes_what_the_case_joined_that_entity_to(client):
    """One hop and both directions: "is part of" and "contains" are one edge read from
    two ends, and a registry wants the brigade whichever way it was stated."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Registry")
    made = {}
    for label in ("3rd Brigade", "1st Coy", "2nd Coy"):
        made[label] = client.post(
            f"/api/cases/{case_id}/entities", json={"type": "organization", "label": label}
        ).json()
    link(client, case_id, made["1st Coy"]["id"], made["3rd Brigade"]["id"], "part-of")
    link(client, case_id, made["2nd Coy"]["id"], made["3rd Brigade"]["id"], "part-of")

    answer = save(
        client,
        case_id,
        sheet,
        ["id", "Unit", "Ties"],
        [["r1", "3rd Brigade", ""], ["r2", "1st Coy", ""]],
        {
            "links": {
                "r1": {"Unit": made["3rd Brigade"]["id"]},
                "r2": {"Unit": made["1st Coy"]["id"]},
            },
            "roles": {
                "Ties": {"kind": "computed", "of": "relations", "from": "Unit", "multi": ", "}
            },
        },
    )
    assert [row[2] for row in answer.json()["rows"]] == ["1st Coy, 2nd Coy", "3rd Brigade"]


def test_a_linked_column_says_nothing_where_the_case_has_nothing_to_say(client):
    """An empty cell rather than a word: a row whose subject the case does not place has
    no coordinates, and `unknown` written down four hundred rows is four hundred cells a
    filter would then have to unlearn. Two points reaching one entity is the same answer,
    because choosing between them would be the silent merge this app refuses."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Registry")
    unit = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "organization", "label": "3rd Brigade"}
    ).json()
    for label, lat in (("North", 48.0), ("South", 49.0)):
        place = client.post(
            f"/api/cases/{case_id}/entities",
            json={"type": "place", "label": label, "attrs": {"lat": lat, "lon": 2.0}},
        ).json()
        claim = client.post(
            f"/api/cases/{case_id}/entities", json={"type": "claim", "label": f"seen {label}"}
        ).json()
        link(client, case_id, claim["id"], place["id"], "at")
        link(client, case_id, claim["id"], unit["id"], "about")

    answer = save(
        client,
        case_id,
        sheet,
        ["id", "Unit", "Point"],
        [["r1", "3rd Brigade", ""], ["r2", "Nobody", ""]],
        {
            "links": {"r1": {"Unit": unit["id"]}},
            "roles": {"Point": {"kind": "computed", "of": "point", "from": "Unit"}},
        },
    )
    assert [row[2] for row in answer.json()["rows"]] == ["", ""]


def test_a_linked_column_told_to_follow_no_column_answers_nothing(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Registry")
    answer = save(
        client,
        case_id,
        sheet,
        ["id", "Subject", "Point"],
        [["r1", "Quai sud", ""]],
        {"roles": {"Point": {"kind": "computed", "of": "point"}}},
    )
    assert answer.json()["rows"][0][2] == ""


def test_a_structure_is_on_the_map_through_the_site_it_sits_at(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Registry")
    place = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": "place", "label": "Quai sud", "attrs": {"lat": 48.85, "lon": 2.35}},
    ).json()
    depot = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "structure", "label": "Dépôt"}
    ).json()
    link(client, case_id, depot["id"], place["id"], "sited-at")

    answer = save(
        client,
        case_id,
        sheet,
        ["id", "Subject", "On map"],
        [["r1", "Dépôt", ""]],
        {
            "roles": {"On map": {"kind": "computed", "of": "has_point"}},
            "links": {"r1": {"Subject": depot["id"]}},
        },
    )
    assert answer.json()["rows"][0][2] == "YES"


def test_a_unit_is_on_the_map_through_the_claim_that_places_it(client):
    """The hop a unit registry lives on.

    `located-at` is for collected media and `sited-at` for structures, so an
    organization or a vehicle is positioned by a dated Claim and by nothing else.
    Without that hop the column would answer NO for exactly the rows the binders' unit
    registry is made of.
    """
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Tracker")
    place = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": "place", "label": "Quai sud", "attrs": {"lat": 48.85, "lon": 2.35}},
    ).json()
    unit = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "organization", "label": "3rd Brigade"}
    ).json()
    claim = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "claim", "label": "Seen at the quay"}
    ).json()
    link(client, case_id, claim["id"], place["id"], "at")
    link(client, case_id, claim["id"], unit["id"], "about")

    answer = save(
        client,
        case_id,
        sheet,
        ["id", "Unit", "On map"],
        [["r1", "3rd Brigade", ""]],
        {
            "roles": {"On map": {"kind": "computed", "of": "has_point"}},
            "links": {"r1": {"Unit": unit["id"]}},
        },
    )
    assert answer.json()["rows"][0][2] == "YES"


def test_the_walk_stops_at_two_hops(client):
    """Three hops would answer "something near this is placed", which is not the column."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Tracker")
    place = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": "place", "label": "Quai sud", "attrs": {"lat": 48.85, "lon": 2.35}},
    ).json()
    company = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "organization", "label": "1st Company"}
    ).json()
    brigade = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "organization", "label": "3rd Brigade"}
    ).json()
    claim = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "claim", "label": "Seen at the quay"}
    ).json()
    link(client, case_id, claim["id"], place["id"], "at")
    link(client, case_id, claim["id"], company["id"], "about")
    link(client, case_id, company["id"], brigade["id"], "part-of")

    answer = save(
        client,
        case_id,
        sheet,
        ["id", "Unit", "On map"],
        [["r1", "1st Company", ""], ["r2", "3rd Brigade", ""]],
        {
            "roles": {"On map": {"kind": "computed", "of": "has_point"}},
            "links": {"r1": {"Unit": company["id"]}, "r2": {"Unit": brigade["id"]}},
        },
    )
    rows = answer.json()["rows"]
    assert rows[0][2] == "YES", "the company is where the claim puts it"
    assert rows[1][2] == "NO", "its brigade is not, and saying otherwise would be a guess"


def test_a_computed_column_is_restated_when_the_case_changes(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Registry")
    place = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "place", "label": "Somewhere"}
    ).json()
    body = (
        ["id", "Subject", "On map"],
        [["r1", "Somewhere", ""]],
        {
            "roles": {"On map": {"kind": "computed", "of": "has_point"}},
            "links": {"r1": {"Subject": place["id"]}},
        },
    )
    assert save(client, case_id, sheet, *body).json()["rows"][0][2] == "NO"

    client.patch(
        f"/api/cases/{case_id}/entities/{place['id']}",
        json={"attrs": {"lat": 48.85, "lon": 2.35}},
    )
    assert save(client, case_id, sheet, *body).json()["rows"][0][2] == "YES"


def test_a_computed_column_answers_on_a_read_too_and_still_writes_nothing(client):
    """It only moved on a save, so a place added an hour ago left the sheet reading NO."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Registry")
    place = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "place", "label": "Somewhere"}
    ).json()
    save(
        client,
        case_id,
        sheet,
        ["id", "Subject", "On map"],
        [["r1", "Somewhere", ""]],
        {
            "roles": {"On map": {"kind": "computed", "of": "has_point"}},
            "links": {"r1": {"Subject": place["id"]}},
        },
    )
    path = case_file(client, case_id, sheet["attrs"]["path"])
    before = path.read_bytes()

    client.patch(
        f"/api/cases/{case_id}/entities/{place['id']}",
        json={"attrs": {"lat": 48.85, "lon": 2.35}},
    )
    read = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()
    assert read["rows"][0][2] == "YES", "the grid shows what the case answers now"
    assert path.read_bytes() == before, "a case opened to be looked at stays byte-identical"


def test_a_promotion_records_what_the_cell_said_so_a_later_edit_shows(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    first = promote(
        client, case_id, sheet, ["id", "Unit"], [["r1", "3rd Brigade"]], {},
        keys=["r1"], type="organization", label_column="Unit",
    ).json()
    assert first["meta"]["promoted"] == {"r1": {"Unit": "3rd Brigade"}}

    # The link cannot say the row has moved on: it is the same link after the edit.
    saved = save(
        client, case_id, sheet, ["id", "Unit"], [["r1", "3rd Separate Brigade"]], first["meta"]
    ).json()
    assert saved["meta"]["promoted"] == {"r1": {"Unit": "3rd Brigade"}}
    assert saved["meta"]["links"]["r1"]["Unit"] == first["meta"]["links"]["r1"]["Unit"]


# -- the place the case already holds -----------------------------------------
#
# The half of a place column that must never leave the machine: a cell pointing at
# something the case has placed is answered off the graph, exactly, instead of being
# guessed from a word by a geocoder paced at a request a second.


def points(client, case_id, sheet, ids):
    response = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/points", json={"ids": ids}
    )
    assert response.status_code == 200, response.text
    return response.json()["points"]


def test_the_case_answers_the_place_of_an_entity_it_holds(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Index")
    place = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": "place", "label": "Quai sud", "attrs": {"lat": 48.85, "lon": 2.35}},
    ).json()

    answer = points(client, case_id, sheet, [place["id"]])
    assert answer[place["id"]] == {"lat": 48.85, "lon": 2.35}


def test_the_case_answers_through_the_claim_that_places_a_unit(client):
    """The hop `has_point` walks: a unit is positioned by a dated Claim and by nothing else."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Registry")
    place = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": "place", "label": "Quai sud", "attrs": {"lat": 48.85, "lon": 2.35}},
    ).json()
    company = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "organization", "label": "1st Company"}
    ).json()
    brigade = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "organization", "label": "3rd Brigade"}
    ).json()
    claim = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "claim", "label": "Seen at the quay"}
    ).json()
    link(client, case_id, claim["id"], place["id"], "at")
    link(client, case_id, claim["id"], company["id"], "about")
    link(client, case_id, company["id"], brigade["id"], "part-of")

    answer = points(client, case_id, sheet, [company["id"], brigade["id"]])
    assert answer[company["id"]] == {"lat": 48.85, "lon": 2.35}
    assert brigade["id"] not in answer, "a third hop would answer for something merely near"


def test_an_entity_two_points_reach_is_left_to_the_analyst(client):
    """Picking one of them would be the silent merge this app refuses everywhere else."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Index")
    first = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": "place", "label": "North bank", "attrs": {"lat": 48.85, "lon": 2.35}},
    ).json()
    second = client.post(
        f"/api/cases/{case_id}/entities",
        json={"type": "place", "label": "South bank", "attrs": {"lat": 48.86, "lon": 2.36}},
    ).json()
    depot = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "structure", "label": "A depot"}
    ).json()
    link(client, case_id, depot["id"], first["id"], "sited-at")
    link(client, case_id, depot["id"], second["id"], "sited-at")

    assert points(client, case_id, sheet, [depot["id"]]) == {}


def test_an_unplaced_or_unknown_entity_answers_nothing_rather_than_a_zero(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Index")
    nowhere = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "place", "label": "To be found"}
    ).json()

    assert points(client, case_id, sheet, [nowhere["id"], "no-such-entity"]) == {}


def test_the_places_route_refuses_an_id_that_is_not_a_sheet(client):
    case_id = make_case(client)
    place = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "place", "label": "Quai sud"}
    ).json()
    response = client.post(
        f"/api/cases/{case_id}/sheets/{place['id']}/points", json={"ids": [place["id"]]}
    )
    assert response.status_code == 404


def test_a_sheet_with_no_role_is_written_exactly_as_it_was_sent(client):
    """The columns the app fills are opt-in: without a role, nothing is touched."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Plain")
    rows = [["r1", "", ""]]
    assert save(client, case_id, sheet, ["id", "A", "B"], rows, {}).json()["rows"] == rows


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
    assert "typed in LibreOffice" in path.read_text(encoding="utf-8-sig"), "nothing was written"


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


# -- rows into what the case believes -----------------------------------------
#
# The bridge the whole plan pays for. A sheet says what is being checked; the graph says
# what the case believes, and this is the one road between them.


def promote(client, case_id, sheet, columns, rows, meta, **body):
    """The pass, asked for its row mode in the words these tests are about.

    One screen sends a whole sheet now, and a declaration says what every column becomes.
    What these tests exercise is the **row** mode of it — a name is not an identity, a field
    is checked before it is stored, only the mapped columns travel — so the declaration is
    assembled here rather than restated at twenty call sites. The shape of the request is
    `tests/test_sheet_pass.py`'s subject.
    """
    subject = {
        "column": body.pop("label_column", ""),
        "type": body.pop("type", ""),
        "fields": body.pop("attr_columns", {}) or {},
        "attach": body.pop("attach", {}) or {},
        "skip": body.pop("skip", []) or [],
        "group": body.pop("group", False),
        "group_label": body.pop("group_label", None),
    }
    return client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/promote",
        json={
            "columns": columns,
            "rows": rows,
            "meta": meta,
            "subject": subject,
            "point": body.pop("point_column", None) or "",
            "addresses": body.pop("link_column", None) or "",
            **body,
        },
    )


def counts(answer, mode="row"):
    """One layer's five words. Every road out of a sheet answers in the same five."""
    for layer in answer.get("entities", []):
        if layer["mode"] == mode:
            return layer["counts"]
    return dict.fromkeys(("make", "join", "update", "skip", "error"), 0)


def plan_rows(answer, mode="row"):
    """What one layer decided, row by row."""
    for layer in answer.get("entities", []):
        if layer["mode"] == mode:
            return layer["plan"]
    return []


def test_a_promoted_row_becomes_an_entity_the_sheet_points_at(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    answer = promote(
        client,
        case_id,
        sheet,
        ["id", "Unit", "Notes"],
        [["r1", "3rd Brigade", "seen at the quay"]],
        {},
        keys=["r1"],
        type="organization",
        label_column="Unit",
    )
    assert answer.status_code == 200, answer.text
    assert counts(answer.json())["make"] == 1

    made = case_entities(client, case_id, "organization")
    assert [e["label"] for e in made] == ["3rd Brigade"]
    # The cell now points at what it made, which is what makes a second press an update.
    assert answer.json()["meta"]["links"]["r1"]["Unit"] == made[0]["id"]
    # And the sheet mentions it, so the row is visible from the brigade's side.
    assert any(
        link["from"] == sheet["id"] and link["to"] == made[0]["id"] and link["type"] == "mentions"
        for link in case_links(client, case_id)
    )
    assert made[0]["provenance"]["by"] == "sheet", "the case records where the row came from"


def test_promoting_twice_updates_instead_of_making_a_twin(client):
    """The mechanism is the sidecar link, which was already there for hand-made ones."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    columns = ["id", "Unit"]
    first = promote(
        client, case_id, sheet, columns, [["r1", "3rd Brigade"]], {},
        keys=["r1"], type="organization", label_column="Unit",
    ).json()

    second = promote(
        client, case_id, sheet, columns, [["r1", "3rd Separate Brigade"]], first["meta"],
        keys=["r1"], type="organization", label_column="Unit",
    ).json()
    assert counts(second)["make"] == 0 and counts(second)["update"] == 1

    made = case_entities(client, case_id, "organization")
    assert len(made) == 1, "one brigade, not two"
    assert made[0]["label"] == "3rd Separate Brigade", "the name followed the cell"


def test_a_name_the_case_already_holds_is_offered_rather_than_merged(client):
    """Two people share a name. A same label is a candidate, never a match."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    existing = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "organization", "label": "3rd Brigade"}
    ).json()

    answer = promote(
        client, case_id, sheet, ["id", "Unit"], [["r1", "3rd Brigade"]], {},
        keys=["r1"], type="organization", label_column="Unit",
    ).json()
    assert counts(answer)["join"] == 0 and counts(answer)["make"] == 1
    assert answer["meta"]["links"]["r1"]["Unit"] != existing["id"]
    # And the plan said the case already held the name, so the analyst could have said
    # otherwise before pressing.
    assert plan_rows(answer)[0]["candidates"] == [{"id": existing["id"], "label": "3rd Brigade"}]


def test_a_row_joins_the_entity_the_analyst_attached_it_to(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    existing = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "organization", "label": "3rd Brigade"}
    ).json()

    answer = promote(
        client, case_id, sheet, ["id", "Unit", "Echelon"], [["r1", "3rd Bde", "brigade"]], {},
        keys=["r1"], type="organization", label_column="Unit",
        attr_columns={"Echelon": "echelon"},
        attach={"r1": existing["id"]},
    ).json()
    assert counts(answer)["join"] == 1 and counts(answer)["make"] == 0
    assert answer["meta"]["links"]["r1"]["Unit"] == existing["id"]
    joined = case_entities(client, case_id, "organization")
    assert len(joined) == 1, "no twin was minted beside the one it joined"
    assert joined[0]["attrs"]["echelon"] == "brigade", "the mapped columns still landed"
    assert joined[0]["label"] == "3rd Brigade", "joining does not rename what was there"


def test_an_identifier_is_joined_on_its_value_because_the_value_is_the_identity(client):
    """The one family where ONTOLOGY §2 does not hold: one address is one email."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Contacts")
    existing = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "email", "label": "a@example.org"}
    ).json()

    answer = promote(
        client, case_id, sheet, ["id", "Address"], [["r1", "A@Example.org"]], {},
        keys=["r1"], type="email", label_column="Address",
    ).json()
    assert counts(answer)["join"] == 1 and counts(answer)["make"] == 0
    assert answer["meta"]["links"]["r1"]["Address"] == existing["id"]


def test_two_rows_with_one_name_are_flagged_rather_than_folded_together(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    answer = promote(
        client, case_id, sheet, ["id", "Unit"], [["r1", "3rd Brigade"], ["r2", "3RD BRIGADE"]], {},
        keys=["r1", "r2"], type="organization", label_column="Unit",
    ).json()
    assert counts(answer)["make"] == 2
    assert [row["repeat"] for row in plan_rows(answer)] == [False, True]


def test_a_row_the_analyst_left_out_of_the_preview_is_not_promoted(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    answer = promote(
        client, case_id, sheet, ["id", "Unit"], [["r1", "A"], ["r2", "B"]], {},
        keys=["r1", "r2"], type="organization", label_column="Unit", skip=["r2"],
    ).json()
    assert (counts(answer)["make"], counts(answer)["skip"]) == (1, 1)
    assert set(answer["meta"]["links"]) == {"r1"}


def test_a_cell_that_cannot_be_read_as_its_field_stops_that_row(client):
    """Promotion was the one write that reached the store without passing a form."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Places")
    answer = promote(
        client, case_id, sheet, ["id", "Name", "Precision"],
        [["r1", "Quai sud", "about 30"], ["r2", "Pont nord", "50"]], {},
        keys=["r1", "r2"], type="place", label_column="Name",
        point_column="Name", attr_columns={"Precision": "radius_m"},
    )
    assert answer.status_code == 200, answer.text
    read = answer.json()
    assert counts(read)["error"] == 2, "neither row holds a point in the column named"
    assert not case_entities(client, case_id, "place")
    # Every reason, not the first one: a row is fixed in one pass or not at all.
    assert plan_rows(read)[0]["problems"] == [
        "Uncertainty radius (m): 'about 30' is not a number",
        "no point could be read in 'Name'",
    ]
    assert plan_rows(read)[1]["problems"] == ["no point could be read in 'Name'"]


def test_a_number_field_refuses_prose_and_reads_a_european_spelling(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Places")
    answer = promote(
        client, case_id, sheet, ["id", "Name", "Point", "Precision"],
        [
            ["r1", "Quai sud", "48.8566, 2.3522", "1 234,5"],
            ["r2", "Pont nord", "48.8570, 2.3530", "roughly 30"],
        ],
        {},
        keys=["r1", "r2"], type="place", label_column="Name",
        point_column="Point", attr_columns={"Precision": "radius_m"},
    ).json()
    assert (counts(answer)["make"], counts(answer)["error"]) == (1, 1)
    made = case_entities(client, case_id, "place")
    assert made[0]["attrs"]["radius_m"] == 1234.5
    assert "is not a number" in plan_rows(answer)[1]["reason"]


def test_a_cell_already_pointing_at_another_type_is_left_alone(client):
    """A cell pointing at a place is not a person waiting to be overwritten."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    place = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "place", "label": "Quai sud"}
    ).json()
    answer = promote(
        client, case_id, sheet, ["id", "Unit"], [["r1", "3rd Brigade"]],
        {"links": {"r1": {"Unit": place["id"]}}},
        keys=["r1"], type="organization", label_column="Unit",
    ).json()
    assert (counts(answer)["make"], counts(answer)["skip"]) == (0, 1)
    assert "already points at a place" in plan_rows(answer)[0]["reason"]
    assert answer["meta"]["links"]["r1"]["Unit"] == place["id"], "the hand-made link stands"


def test_a_point_column_promotes_into_places_carrying_their_precision(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Sites")
    answer = promote(
        client, case_id, sheet, ["id", "Name", "Point"],
        [["r1", "Quai sud", "48.8566, 2.3522"], ["r2", "Vague", "48.86, 2.35"]], {},
        keys=["r1", "r2"], type="place", label_column="Name", point_column="Point",
    )
    assert answer.status_code == 200, answer.text
    made = {entity["label"]: entity for entity in case_entities(client, case_id, "place")}
    assert round(made["Quai sud"]["attrs"]["lat"], 4) == 48.8566
    assert round(made["Quai sud"]["attrs"]["lon"], 4) == 2.3522
    # Four decimals is about eleven metres; two is about a kilometre. A place stored
    # without saying so reads on the map as a pinpoint somebody established.
    assert made["Quai sud"]["attrs"]["radius_m"] == 11
    assert made["Vague"]["attrs"]["radius_m"] == 1113


def test_a_place_without_a_point_column_is_refused_at_the_door(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Sites")
    answer = promote(
        client, case_id, sheet, ["id", "Name"], [["r1", "Quai sud"]], {},
        keys=["r1"], type="place", label_column="Name",
    )
    assert answer.status_code == 422
    assert "coordinates" in answer.json()["detail"]


def test_a_claim_is_not_a_thing_a_bare_row_can_become(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Notes")
    answer = promote(
        client, case_id, sheet, ["id", "What"], [["r1", "Seen at the quay"]], {},
        keys=["r1"], type="claim", label_column="What",
    )
    assert answer.status_code == 422


def test_a_link_column_files_its_pages_as_sources_that_mention_the_row(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    answer = promote(
        client, case_id, sheet, ["id", "Unit", "Source"],
        [
            ["r1", "3rd Brigade", "https://example.org/a"],
            ["r2", "4th Brigade", "https://example.org/a"],
        ],
        {},
        keys=["r1", "r2"], type="organization", label_column="Unit", link_column="Source",
    )
    assert answer.status_code == 200, answer.text
    bookmarks = case_entities(client, case_id, "bookmark")
    assert len(bookmarks) == 1, "a page cited by two rows is one bookmark"
    assert bookmarks[0]["attrs"]["url"] == "https://example.org/a"
    units = {entity["label"]: entity["id"] for entity in case_entities(client, case_id, "organization")}
    mentioned = {
        link["to"]
        for link in case_links(client, case_id)
        if link["from"] == bookmarks[0]["id"] and link["type"] == "mentions"
    }
    assert mentioned == set(units.values())


def test_a_preview_says_what_would_happen_and_changes_nothing(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    answer = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/promote/preview",
        json={
            "columns": ["id", "Unit"],
            "rows": [["r1", "3rd Brigade"], ["r2", "   "]],
            "meta": {},
            "keys": ["r1", "r2"],
            "subject": {"column": "Unit", "type": "organization"},
        },
    )
    assert answer.status_code == 200, answer.text
    read = answer.json()
    layer = read["entities"][0]
    assert [row["action"] for row in layer["rows"]] == ["make", "skip"]
    assert layer["counts"] == {"make": 1, "join": 0, "update": 0, "skip": 1, "error": 0}
    assert not case_entities(client, case_id, "organization"), "a preview writes nothing"


def test_a_promotion_refused_by_the_file_leaves_no_entity_behind(client, monkeypatch):
    """The 409 used to arrive after the case had already gained forty subjects."""
    from azimut.engine import sheets as sheet_engine

    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    read = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()

    real_write = sheet_engine.write

    def losing_write(*args, **kwargs):
        raise sheet_engine.SheetConflict("this file changed on disk since it was opened")

    monkeypatch.setattr(sheet_engine, "write", losing_write)
    answer = promote(
        client, case_id, sheet, ["id", "Unit"], [["r1", "3rd Brigade"]], {},
        keys=["r1"], type="organization", label_column="Unit", stamp=read["stamp"],
    )
    monkeypatch.setattr(sheet_engine, "write", real_write)
    assert answer.status_code == 409
    assert not case_entities(client, case_id, "organization"), "the promotion was taken back"


def test_only_the_columns_asked_for_travel_into_the_case(client):
    """A promotion that swept every column would put a worklist's notes in the graph."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "People")
    answer = promote(
        client,
        case_id,
        sheet,
        ["id", "Name", "Role", "Private"],
        [["r1", "Witness A", "driver", "do not contact"]],
        {},
        keys=["r1"],
        type="person",
        label_column="Name",
        attr_columns={"Role": "role", "Private": "Private"},
    )
    assert answer.status_code == 200, answer.text
    person = case_entities(client, case_id, "person")[0]
    assert person["attrs"].get("role") == "driver"
    # `Private` is not a declared field of a person, so it stays in the sheet where it
    # was written rather than becoming a field of the case's vocabulary.
    assert "Private" not in person["attrs"]


def test_a_row_with_no_label_is_left_alone(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    answer = promote(
        client, case_id, sheet, ["id", "Unit"], [["r1", "   "], ["r2", "3rd Brigade"]], {},
        keys=["r1", "r2"], type="organization", label_column="Unit",
    ).json()
    assert counts(answer)["make"] == 1
    assert "r1" not in answer["meta"]["links"]


def test_only_the_ticked_rows_are_promoted(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    answer = promote(
        client, case_id, sheet, ["id", "Unit"], [["r1", "A"], ["r2", "B"]], {},
        keys=["r2"], type="organization", label_column="Unit",
    ).json()
    assert counts(answer)["make"] == 1
    assert set(answer["meta"]["links"]) == {"r2"}


def test_a_promotion_saves_the_table_it_was_given(client):
    """The analyst promotes what is on screen, which may hold unsaved edits."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    promote(
        client, case_id, sheet, ["id", "Unit"], [["r1", "3rd Brigade"]], {},
        keys=["r1"], type="organization", label_column="Unit",
    )
    text = case_file(client, case_id, sheet["attrs"]["path"]).read_text(encoding="utf-8-sig")
    assert "3rd Brigade" in text


def test_a_promotion_is_refused_when_the_file_moved_on(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    read = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()
    case_file(client, case_id, sheet["attrs"]["path"]).write_text(
        "id,Unit\nr1,elsewhere\n", encoding="utf-8"
    )
    answer = promote(
        client, case_id, sheet, ["id", "Unit"], [["r1", "3rd Brigade"]], {},
        keys=["r1"], type="organization", label_column="Unit", stamp=read["stamp"],
    )
    assert answer.status_code == 409


def test_a_type_or_a_column_the_sheet_does_not_have_is_refused(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Units")
    body = dict(keys=["r1"], type="organization", label_column="Unit")
    assert promote(
        client, case_id, sheet, ["id", "Unit"], [["r1", "A"]], {}, **{**body, "type": "invented"}
    ).status_code == 422
    assert promote(
        client, case_id, sheet, ["id", "Unit"], [["r1", "A"]], {}, **{**body, "label_column": "Gone"}
    ).status_code == 422


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


# -- the question the sheet was left on ---------------------------------------
#
# The sort and the hidden columns were always in the sidecar; the half that decides
# which rows are on screen lived in the browser tab and died with it. On a tool whose
# answer to saved views is *a sheet is its own saved reading*, that was the gap.


def test_the_sidecar_remembers_the_question_the_rows_were_left_under():
    clean = sheet_engine.clean_meta(
        {
            "query": "kherson",
            "filters": {
                "Status": {"values": ["to do", "to do", "done"], "fill": "blank"},
                "Subject": {"contains": "quai"},
                "Gone": {"values": ["anything"]},
                "Notes": {"values": [], "fill": "invented"},
            },
        },
        ["id", "Status", "Subject", "Notes"],
        [],
    )
    assert clean["query"] == "kherson"
    # A filter on a column somebody deleted in a spreadsheet is a question about nothing.
    assert set(clean["filters"]) == {"Status", "Subject"}
    assert clean["filters"]["Status"]["values"] == ["to do", "done"], "said twice is said once"
    assert clean["filters"]["Status"]["fill"] == "blank"
    # A clause naming nothing is not a clause, and a filter of nothing is not a filter.
    assert "Notes" not in clean["filters"], "an ask nobody can answer is dropped whole"


def test_a_query_longer_than_a_search_is_cut_rather_than_stored():
    clean = sheet_engine.clean_meta({"query": "x" * 400}, ["id"], [])
    assert len(clean["query"]) == sheet_engine.MAX_QUERY


def test_a_second_sort_key_is_dropped_when_it_names_the_first():
    """Breaking a column's ties with itself is not a sort, it is a loop."""
    same = sheet_engine.clean_meta(
        {"sort": {"column": "Status", "desc": False, "then": {"column": "Status", "desc": True}}},
        ["id", "Status", "Subject"],
        [],
    )
    assert same["sort"] == {"column": "Status", "desc": False}

    kept = sheet_engine.clean_meta(
        {"sort": {"column": "Status", "desc": False, "then": {"column": "Subject", "desc": True}}},
        ["id", "Status", "Subject"],
        [],
    )
    assert kept["sort"]["then"] == {"column": "Subject", "desc": True}


def test_a_legend_names_a_colour_the_palette_has_and_a_pin_names_a_row_that_exists():
    clean = sheet_engine.clean_meta(
        {
            "legend": {"red": "ruled out", "puce": "invented", "blue": "   "},
            "pinned": "r_gone",
            "tall": 1,
        },
        ["id", "Subject"],
        [["r1", "Quai sud"]],
    )
    assert clean["legend"] == {"red": "ruled out"}
    assert clean["pinned"] is None, "a reference row that is not in the file is not a reference"
    assert clean["tall"] is True

    kept = sheet_engine.clean_meta({"pinned": "r1"}, ["id", "Subject"], [["r1", "Quai sud"]])
    assert kept["pinned"] == "r1"


def test_the_grid_own_state_is_written_without_touching_the_file(client):
    """The whole reason the second route exists.

    Rewriting the CSV to record that a funnel was clicked moved the modification time the
    stamp is made of, so the analyst's own next save answered a conflict nobody caused.
    """
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    save(client, case_id, sheet, ["id", "Subject"], [["r1", "Quai sud"]], {})
    path = case_file(client, case_id, sheet["attrs"]["path"])
    before = path.read_bytes()
    stamp = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}/stamp").json()["stamp"]

    written = client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/meta",
        json={"meta": {"colours": {"r1": "red"}, "query": "quai", "pinned": "r1"}},
    )
    assert written.status_code == 200, written.text
    assert written.json()["meta"]["colours"] == {"r1": "red"}
    assert written.json()["meta"]["pinned"] == "r1"
    assert path.read_bytes() == before, "the artifact is byte-identical"
    assert client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}/stamp").json()["stamp"] == stamp


def test_the_meta_route_cleans_against_the_file_on_disk(client):
    """It is the file that says which columns exist, not the body being written."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    save(client, case_id, sheet, ["id", "Subject"], [["r1", "Quai sud"]], {})

    written = client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/meta",
        json={"meta": {"widths": {"Subject": 200, "Invented": 200}}},
    )
    assert written.json()["meta"]["widths"] == {"Subject": 200}


def test_the_stamp_route_answers_what_a_save_would_be_asked_to_present(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    read = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}").json()
    assert client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}/stamp").json() == {
        "stamp": read["stamp"]
    }

    path = case_file(client, case_id, sheet["attrs"]["path"])
    path.write_text("id,Subject\nr1,Written elsewhere\n", encoding="utf-8")
    moved = client.get(f"/api/cases/{case_id}/sheets/{sheet['id']}/stamp").json()["stamp"]
    assert moved != read["stamp"], "the grid can tell it is showing an old table"


def test_the_stamp_of_a_sheet_that_is_not_one_is_refused(client):
    case_id = make_case(client)
    other = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "subject", "label": "Someone"}
    ).json()
    assert client.get(f"/api/cases/{case_id}/sheets/{other['id']}/stamp").status_code == 404


# -- a batch of rows, and a second reading of them ----------------------------


def test_a_table_is_parsed_without_anything_being_filed(client):
    """One CSV parser in the app. A second one in the browser would guess the delimiter
    differently, and the file it disagreed about is the one being imported."""
    case_id = make_case(client)
    before = client.get(f"/api/cases/{case_id}/sheets").json()["sheets"]

    read = client.post(
        f"/api/cases/{case_id}/sheets/parse", json={"text": "handle;seen\n@a;yes\n@b;no\n"}
    )
    assert read.status_code == 200, read.text
    # Keyed by the same parser that keys an import, so the mapping screen and the append
    # both see the table the way the app always sees one.
    assert read.json()["columns"] == ["id", "handle", "seen"]
    assert [row[1:] for row in read.json()["rows"]] == [["@a", "yes"], ["@b", "no"]]
    assert client.get(f"/api/cases/{case_id}/sheets").json()["sheets"] == before


def test_a_duplicate_carries_the_whole_sidecar_and_its_own_edges(client):
    """Forking meant exporting the CSV and importing it back, which arrives stripped of
    every colour, role, note and link."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    person = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "person", "label": "Witness A"}
    ).json()
    meta = {
        "roles": {"Status": {"kind": "state", "values": ["to do", "done"]}},
        "notes": {"Status": "where this row got to"},
        "colours": {"r1": "red"},
        "links": {"r1": {"Subject": person["id"]}},
        "legend": {"red": "ruled out"},
        "query": "quai",
    }
    save(client, case_id, sheet, ["id", "Subject", "Status"], [["r1", "Quai sud", "done"]], meta)

    made = client.post(f"/api/cases/{case_id}/sheets/{sheet['id']}/duplicate", json={})
    assert made.status_code == 200, made.text
    copy = made.json()
    assert copy["id"] != sheet["id"]
    assert copy["label"] == "Candidates copy"
    assert copy["meta"]["roles"]["Status"]["values"] == ["to do", "done"]
    assert copy["meta"]["notes"] == {"Status": "where this row got to"}
    assert copy["meta"]["colours"] == {"r1": "red"}
    assert copy["meta"]["legend"] == {"red": "ruled out"}
    assert copy["meta"]["query"] == "quai"

    # Two files, and the copy is a real one.
    assert copy["attrs"]["path"] != sheet["attrs"]["path"]
    rows = list(csv.reader(io.StringIO(case_file(client, case_id, copy["attrs"]["path"]).read_text())))
    assert rows[1][1] == "Quai sud", "the rows keep their keys and their words"

    # Its cells point where the original's did, so the case knows both sheets rest on it.
    mentions = [
        link
        for link in case_links(client, case_id)
        if link["type"] == "mentions" and link["to"] == person["id"]
    ]
    assert {link["from"] for link in mentions} == {sheet["id"], copy["id"]}


def test_a_duplicate_can_be_named_and_a_sheet_that_is_not_one_cannot_be_forked(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    made = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/duplicate", json={"title": "Second pass"}
    )
    assert made.json()["label"] == "Second pass"

    other = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "subject", "label": "Someone"}
    ).json()
    assert (
        client.post(f"/api/cases/{case_id}/sheets/{other['id']}/duplicate", json={}).status_code
        == 404
    )


# -- whether a column of sources still answers --------------------------------
#
# The only part of a sheet that reaches the network, and it goes on a press. The five
# states are the point: a checker reporting true/false would put "this page is gone"
# and "this machine is offline" in one bucket.


def fake_http(monkeypatch, answers):
    """A real httpx client over a transport that answers from a table of addresses.

    The client is the real one — not a stand-in — because what it does with a redirect is
    exactly what is under test: a `Location` pointing at the loopback is refused, and that
    refusal lives in how the hops are followed.

    A table value is a status, an exception to raise, or a `("redirect", url)` pair.
    """
    asked: list[str] = []

    def handle(request):
        url = str(request.url)
        asked.append(url)
        answer = answers[url]
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, tuple):
            return sheetlinks.httpx.Response(302, headers={"Location": answer[1]})
        return sheetlinks.httpx.Response(answer)

    monkeypatch.setattr(
        sheetlinks,
        "_client",
        lambda: sheetlinks.httpx.Client(
            transport=sheetlinks.httpx.MockTransport(handle), follow_redirects=False
        ),
    )
    return asked


def test_a_link_sweep_tells_gone_from_refused_from_unreachable(client, monkeypatch):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    answers = {
        "https://a.org/live": 200,
        "https://a.org/deleted": 404,
        "https://a.org/behind-a-login": 403,
        "https://a.org/nowhere": sheetlinks.httpx.ConnectError("no route"),
    }
    fake_http(monkeypatch, answers)

    checked = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/links/check", json={"urls": list(answers)}
    )
    assert checked.status_code == 200, checked.text
    links = checked.json()["links"]
    assert links["https://a.org/live"]["state"] == "ok"
    assert links["https://a.org/deleted"] == {"state": "gone", "code": 404, "reason": ""}
    # A 403 behind a login says nothing about whether the page is there, so it is not dead.
    assert links["https://a.org/behind-a-login"]["state"] == "refused"
    assert links["https://a.org/nowhere"]["state"] == "unreachable"


def test_one_address_said_eleven_times_is_asked_once(client, monkeypatch):
    """Eleven rows sourced to one channel hold one address eleven times, and asking that
    host eleven times would be the rudest way to learn one fact."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    asked = fake_http(monkeypatch, {"https://a.org/one": 200})

    checked = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/links/check",
        json={"urls": ["https://a.org/one"] * 11},
    )
    assert asked == ["https://a.org/one"]
    assert list(checked.json()["links"]) == ["https://a.org/one"]


def test_something_that_is_not_an_address_is_answered_rather_than_fetched(client, monkeypatch):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    asked = fake_http(monkeypatch, {})

    checked = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/links/check",
        json={"urls": ["file:///etc/passwd", "not a link at all"]},
    )
    assert asked == [], "nothing left the machine"
    assert all(entry["state"] == "refused" for entry in checked.json()["links"].values())


def test_a_sweep_that_runs_out_of_its_budget_says_which_addresses_it_never_asked(
    client, monkeypatch
):
    """The per-address timeout never bounded the batch.

    Twenty five addresses, each taking a HEAD and then a GET at six seconds, is five minutes
    of one held request and one occupied thread — the same hung screen the six seconds were
    chosen to avoid. Past the budget the rest come back `skipped`, which is a different
    answer from `unreachable`: nobody asked, so nothing was learnt about the page.
    """
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    urls = [f"https://a.org/{n}" for n in range(4)]
    fake_http(monkeypatch, dict.fromkeys(urls, 200))
    ticks = iter([0.0, 0.0, 1.0, sheetlinks.BUDGET + 1, sheetlinks.BUDGET + 2])
    monkeypatch.setattr(sheetlinks, "_now", lambda: next(ticks))

    links = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/links/check", json={"urls": urls}
    ).json()["links"]

    assert [links[url]["state"] for url in urls] == ["ok", "ok", "skipped", "skipped"]
    assert links[urls[2]]["reason"] == "the batch ran out of time"


def test_the_check_does_not_follow_a_redirect_onto_the_machine_itself(client, monkeypatch):
    """The addresses come from the sheet, and a sheet arrives by import, paste or workbook.

    A column of links from a third party could otherwise make this app knock on its own
    ports and report which of them answered: the loopback guard asks only that the Host be a
    loopback name, so a remote host answering `Location: 127.0.0.1:8000` walked straight
    through it. What leaks is only "this port answered" — the checker reads a status and
    never a body — which is why this is a refusal with its own reason rather than a 500.
    """
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    asked = fake_http(
        monkeypatch,
        {
            "https://a.org/redirect": ("redirect", "http://127.0.0.1:8000/api/cases"),
            "https://a.org/onward": ("redirect", "https://b.org/landed"),
            "https://b.org/landed": 200,
        },
    )

    links = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/links/check",
        json={
            "urls": [
                "https://a.org/redirect",
                "https://a.org/onward",
                "http://localhost:8000/api/cases",
                "http://192.168.1.4/router",
            ]
        },
    ).json()["links"]

    assert links["https://a.org/redirect"]["state"] == "refused"
    assert links["https://a.org/redirect"]["reason"] == "redirected to a local address"
    # A redirect that stays outside is followed as it always was.
    assert links["https://a.org/onward"]["state"] == "ok"
    # And a local address written in the cell itself never leaves at all.
    assert links["http://localhost:8000/api/cases"]["reason"] == "a local address"
    assert links["http://192.168.1.4/router"]["reason"] == "a local address"
    assert "http://127.0.0.1:8000/api/cases" not in asked
    assert "http://192.168.1.4/router" not in asked


def test_a_batch_over_the_cap_is_refused_at_the_door(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    over = [f"https://a.org/{n}" for n in range(sheetlinks.MAX_LINKS + 1)]
    response = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/links/check", json={"urls": over}
    )
    assert response.status_code == 422


# -- the reading, written out --------------------------------------------------


def test_an_export_lands_in_the_case_exports_folder(client):
    """A file, not a download. Every other finished thing in this app lands in a folder
    the analyst chose, and a table in the browser's downloads was the one export nobody
    could find twice."""
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")

    answer = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/csv",
        json={"columns": ["id", "Subject"], "rows": [["r1", "Quai sud"]]},
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["file"] == "Candidates.csv"

    written = case_file(client, case_id, "exports/Candidates.csv")
    assert written.is_file()
    assert written.read_text(encoding="utf-8-sig") == "id,Subject\nr1,Quai sud\n"
    # No byte of the file goes back to the browser: what it gets is where it went.
    assert "csv" not in answer.json()


def test_a_second_export_inside_the_case_overwrites_rather_than_piling_up(client):
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")
    body = {"columns": ["id", "Subject"], "rows": [["r1", "Quai sud"]]}
    client.post(f"/api/cases/{case_id}/sheets/{sheet['id']}/csv", json=body)
    client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/csv",
        json={**body, "rows": [["r1", "Pont nord"]]},
    )

    from azimut.api.cases import get_case

    exports = get_case(case_id).resolve_inside("exports")
    assert [path.name for path in sorted(exports.iterdir())] == ["Candidates.csv"]
    assert "Pont nord" in (exports / "Candidates.csv").read_text(encoding="utf-8-sig")


def test_an_export_writes_to_the_folder_saved_for_sheets(client, tmp_path):
    chosen = tmp_path / "tables"
    chosen.mkdir()
    client.put("/api/settings/prefs", json={"export_dirs": {"sheets": str(chosen)}})
    case_id = make_case(client)
    sheet = new_sheet(client, case_id, "Candidates")

    answer = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/csv",
        json={"columns": ["id"], "rows": [["r1"]]},
    )
    assert answer.json()["path"] == str(chosen)
    assert (chosen / "Candidates.csv").is_file()

    # Outside the case nothing is ever overwritten: the files there are the analyst's.
    client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/csv",
        json={"columns": ["id"], "rows": [["r2"]]},
    )
    assert len(list(chosen.iterdir())) == 2


def test_exporting_a_sheet_that_is_not_one_is_refused(client):
    case_id = make_case(client)
    person = client.post(
        f"/api/cases/{case_id}/entities", json={"type": "person", "label": "Witness A"}
    ).json()
    answer = client.post(
        f"/api/cases/{case_id}/sheets/{person['id']}/csv",
        json={"columns": ["id"], "rows": [["r1"]]},
    )
    assert answer.status_code == 404
