"""The sheet as a view of the case, rather than a copy of it drifting away.

A worklist built out of what the case already holds, a row moving up a floor once it has
been worked out, a binder arriving as a workbook, and the pieces a row carries. All of
them guard one claim: the sheet and the graph stay **two views of one case**, connected
by links, rather than two sets of the same names nobody reconciles.

The road the other way — what a column becomes in the case — is one declaration and one
press, and it is tested in `test_sheet_pass.py` and `test_sheet_claims.py`. The helpers
here are shared with both.

What each test is really guarding:

- a built sheet is a **file** like any other, with its rows keyed and its links in the
  sidecar, so nothing about it is special afterwards;
- the link lands where a promotion looks for one, which is what makes the round trip an
  update instead of a twin;
- throwing a worklist away throws the worklist away, not the subjects it established.
"""

import csv
import io

from azimut.engine import sheetfromcase as fromcase_engine


def make_case(client, name="Bridge"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def add(client, case_id, entity_type, label, **attrs):
    body = {"type": entity_type, "label": label}
    if attrs:
        body["attrs"] = attrs
    response = client.post(f"/api/cases/{case_id}/entities", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def read_sheet(client, case_id, sheet_id):
    response = client.get(f"/api/cases/{case_id}/sheets/{sheet_id}")
    assert response.status_code == 200, response.text
    return response.json()


def case_links(case_id):
    from azimut.api.cases import get_case

    return get_case(case_id).list_links()


def import_sheet(client, case_id, text, title="Tracker"):
    made = client.post(f"/api/cases/{case_id}/sheets/import", json={"title": title, "text": text})
    assert made.status_code == 200, made.text
    return read_sheet(client, case_id, made.json()["id"])


def post_sheet(client, case_id, sheet_id, tail, sheet, **asked):
    return client.post(
        f"/api/cases/{case_id}/sheets/{sheet_id}/{tail}",
        json={
            "columns": sheet["columns"],
            "rows": sheet["rows"],
            "meta": sheet["meta"],
            "stamp": sheet["stamp"],
            **asked,
        },
    )


def case_entities(case_id, entity_type):
    from azimut.api.cases import get_case

    return [e for e in get_case(case_id).list_entities() if e.get("type") == entity_type]


# -- a worklist out of the catalog --------------------------------------------


def test_a_sheet_built_from_the_case_holds_one_row_per_entity(client):
    case_id = make_case(client)
    add(client, case_id, "person", "Ivanov", role="driver")
    add(client, case_id, "person", "Petrov")
    add(client, case_id, "organization", "3rd Brigade")

    made = client.post(
        f"/api/cases/{case_id}/sheets/from-case",
        json={"title": "People to check", "type": "person", "fields": ["role"]},
    )
    assert made.status_code == 200, made.text
    assert made.json()["taken"] == 2
    assert made.json()["total"] == 2

    sheet = read_sheet(client, case_id, made.json()["id"])
    assert sheet["columns"] == ["id", "Name", "Role", "Status", "Notes"]
    # Ordered by name, because the analyst about to work through it looks rows up by name.
    assert [row[1] for row in sheet["rows"]] == ["Ivanov", "Petrov"]
    assert sheet["rows"][0][2] == "driver"
    # The two empty columns are the whole reason the rows are in a sheet.
    assert [row[3] for row in sheet["rows"]] == ["", ""]


def test_only_the_fields_asked_for_travel(client):
    case_id = make_case(client)
    add(client, case_id, "person", "Ivanov", role="driver", nationality="UA")

    made = client.post(
        f"/api/cases/{case_id}/sheets/from-case",
        json={"title": "People", "type": "person", "fields": ["nationality", "invented"]},
    ).json()

    sheet = read_sheet(client, case_id, made["id"])
    assert sheet["columns"] == ["id", "Name", "Nationality", "Status", "Notes"]
    assert sheet["rows"][0][2] == "UA"


def test_a_built_sheet_is_a_csv_on_disk_like_any_other(client):
    case_id = make_case(client)
    add(client, case_id, "place", "Quai sud", lat=46.6, lon=32.6)

    made = client.post(
        f"/api/cases/{case_id}/sheets/from-case", json={"title": "Places", "type": "place"}
    ).json()

    from azimut.api.cases import get_case

    path = get_case(case_id).resolve_inside(
        (get_case(case_id).get_entity(made["id"])["attrs"])["path"]
    )
    table = list(csv.reader(io.StringIO(path.read_text(encoding="utf-8-sig"))))
    assert table[0] == ["id", "Name", "Status", "Notes"]
    assert table[1][1] == "Quai sud"
    assert table[1][0], "every row is keyed"


def test_every_row_points_back_at_the_entity_it_came_from(client):
    case_id = make_case(client)
    person = add(client, case_id, "person", "Ivanov")

    made = client.post(
        f"/api/cases/{case_id}/sheets/from-case", json={"title": "People", "type": "person"}
    ).json()
    sheet = read_sheet(client, case_id, made["id"])

    key = sheet["rows"][0][0]
    assert sheet["meta"]["links"][key] == {"Name": person["id"]}
    # What the cell said when the case was read, which is what lets the row say later
    # that it has moved on.
    assert sheet["meta"]["promoted"][key] == {"Name": "Ivanov"}
    # And the edge that makes the sheet reachable from the subject's side.
    assert any(
        link["type"] == "mentions" and link["from"] == made["id"] and link["to"] == person["id"]
        for link in case_links(case_id)
    )


def test_a_built_worklist_can_already_count_its_own_progress(client):
    case_id = make_case(client)
    add(client, case_id, "person", "Ivanov")

    made = client.post(
        f"/api/cases/{case_id}/sheets/from-case", json={"title": "People", "type": "person"}
    ).json()
    sheet = read_sheet(client, case_id, made["id"])

    assert sheet["meta"]["progress"] == "Status"
    assert sheet["meta"]["roles"]["Status"]["kind"] == "state"
    assert sheet["meta"]["roles"]["Status"]["values"][0] == "to do"


def test_promoting_a_built_row_back_updates_rather_than_twinning(client):
    """The round trip. The link is written where a promotion looks for one, so a second
    press is an update — which is the difference between a bridge and a fork."""
    case_id = make_case(client)
    person = add(client, case_id, "person", "Ivanov")

    made = client.post(
        f"/api/cases/{case_id}/sheets/from-case",
        json={"title": "People", "type": "person", "fields": ["role"]},
    ).json()
    sheet = read_sheet(client, case_id, made["id"])
    key = sheet["rows"][0][0]
    sheet["rows"][0][2] = "driver"

    answer = post_sheet(
        client,
        case_id,
        made["id"],
        "promote",
        sheet,
        keys=[key],
        subject={"column": "Name", "type": "person", "fields": {"Role": "role"}},
    )
    assert answer.status_code == 200, answer.text
    counts = answer.json()["entities"][0]["counts"]
    assert (counts["make"], counts["update"]) == (0, 1)

    from azimut.api.cases import get_case

    people = [e for e in get_case(case_id).list_entities() if e["type"] == "person"]
    assert len(people) == 1
    assert people[0]["id"] == person["id"]
    assert people[0]["attrs"]["role"] == "driver"


def test_a_build_says_how_much_of_the_case_it_took(client):
    case_id = make_case(client)
    for index in range(4):
        add(client, case_id, "person", f"Person {index}")

    made = client.post(
        f"/api/cases/{case_id}/sheets/from-case",
        json={"title": "People", "type": "person", "limit": 2},
    ).json()
    assert (made["taken"], made["total"]) == (2, 4)


def test_a_type_the_vocabulary_never_heard_of_builds_an_empty_worklist(client):
    case_id = make_case(client)
    made = client.post(
        f"/api/cases/{case_id}/sheets/from-case", json={"title": "Nothing", "type": "invented"}
    )
    assert made.status_code == 200, made.text
    assert made.json()["taken"] == 0
    assert read_sheet(client, case_id, made.json()["id"])["rows"] == []


def test_a_stored_field_lands_as_text_a_spreadsheet_can_read(client):
    """A cell reading `["a", "b"]` is a cell nobody can filter on or hand over."""
    assert fromcase_engine._cell(["Ivan", "Vanya"]) == "Ivan, Vanya"
    assert fromcase_engine._cell(None) == ""
    assert fromcase_engine._cell(True) == "YES"
    assert fromcase_engine._cell(12) == "12"

    case_id = make_case(client)
    add(client, case_id, "person", "Ivanov", aliases="Ivan, Vanya")
    made = client.post(
        f"/api/cases/{case_id}/sheets/from-case",
        json={"title": "People", "type": "person", "fields": ["aliases"]},
    ).json()
    assert read_sheet(client, case_id, made["id"])["rows"][0][2] == "Ivan, Vanya"


# -- a row moving up a floor ---------------------------------------------------


def test_a_moved_row_lands_in_the_other_sheet_with_what_the_sidecar_held(client):
    """An inbox, a worklist and a reference table at one schema: a row moves up a floor
    once it has been worked out, and copying it by hand loses the colour, the link and
    the record that it was already promoted."""
    case_id = make_case(client)
    inbox = import_sheet(
        client, case_id, "Subject,Status\nQuai sud,to do\nPont nord,to do\n", "Inbox"
    )
    worklist = import_sheet(client, case_id, "Subject,Status\n", "Worklist")
    key = inbox["rows"][0][0]
    inbox["meta"]["colours"] = {key: "green"}

    answer = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move",
        inbox,
        to=worklist["id"],
        keys=[key],
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["moved"] == 1 and answer.json()["dropped"] == []

    left = read_sheet(client, case_id, inbox["id"])
    assert [row[1] for row in left["rows"]] == ["Pont nord"]
    assert left["meta"]["colours"] == {}

    landed = read_sheet(client, case_id, worklist["id"])
    assert [row[1] for row in landed["rows"]] == ["Quai sud"]
    assert landed["meta"]["colours"] == {key: "green"}


def test_a_column_the_destination_does_not_have_is_dropped_and_said(client):
    """The destination's shape is its own: a move that grew it by three columns would be
    an import wearing a different word. A silent loss reads as a clean move."""
    case_id = make_case(client)
    inbox = import_sheet(client, case_id, "Subject,Status,Scratch\nQuai sud,to do,mine\n", "Inbox")
    worklist = import_sheet(client, case_id, "Subject,Status\n", "Worklist")

    answer = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move",
        inbox,
        to=worklist["id"],
        keys=[inbox["rows"][0][0]],
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["dropped"] == ["Scratch"]
    assert read_sheet(client, case_id, worklist["id"])["columns"] == ["id", "Subject", "Status"]


def test_a_promoted_row_that_moves_is_still_reachable_from_its_subject(client):
    """Both sheets restate what they mention, so the edge follows the row."""
    case_id = make_case(client)
    inbox = import_sheet(client, case_id, "Subject\nQuai sud\n", "Inbox")
    worklist = import_sheet(client, case_id, "Subject\n", "Worklist")
    key = inbox["rows"][0][0]
    assert (
        post_sheet(
            client,
            case_id,
            inbox["id"],
            "promote",
            inbox,
            keys=[key],
            subject={"column": "Subject", "type": "structure"},
        ).status_code
        == 200
    )

    inbox = read_sheet(client, case_id, inbox["id"])
    answer = post_sheet(client, case_id, inbox["id"], "move", inbox, to=worklist["id"], keys=[key])
    assert answer.status_code == 200, answer.text

    made = case_entities(case_id, "structure")[0]["id"]
    mentions = {link["from"] for link in case_links(case_id) if link["type"] == "mentions"}
    assert mentions == {worklist["id"]}
    assert read_sheet(client, case_id, worklist["id"])["meta"]["links"][key]["Subject"] == made


def test_a_move_from_a_stale_grid_is_refused_like_any_other_write(client):
    case_id = make_case(client)
    inbox = import_sheet(client, case_id, "Subject\nQuai sud\n", "Inbox")
    worklist = import_sheet(client, case_id, "Subject\n", "Worklist")
    inbox["stamp"] = "0-0"
    answer = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move",
        inbox,
        to=worklist["id"],
        keys=[inbox["rows"][0][0]],
    )
    assert answer.status_code == 409


def test_a_move_whose_source_write_is_refused_leaves_no_row_in_both_sheets(client, monkeypatch):
    """A duplicate is the one of the two failures an analyst cannot see.

    The destination is written first, so a source that refuses — a spreadsheet holding the
    CSV open, which is the case `SheetUnwritable` exists for — used to leave the rows over
    there *and* in here, under another key in another sheet, while the route answered 409
    and the grid went on showing that nothing had moved. The destination goes back to the
    bytes it had now. `undo_move` reasons about the same window and reaches the same
    conclusion in its own comment.
    """
    from azimut import layout
    from azimut.api.cases import get_case
    from azimut.engine import sheets as sheet_engine

    case_id = make_case(client)
    inbox = import_sheet(client, case_id, "Subject\nQuai sud\nPont nord\n", "Inbox")
    worklist = import_sheet(client, case_id, "Subject\nAlready here\n", "Worklist")
    landing = get_case(case_id).resolve_inside(layout.sheet_rel("Worklist"))
    before = landing.read_bytes()
    real = sheet_engine.write_atomic

    def refuse_the_source(path, text, *, encoding):
        if path.name == "Inbox.csv":
            raise sheet_engine.SheetUnwritable("could not write “Inbox.csv”: it is open in Excel")
        return real(path, text, encoding=encoding)

    monkeypatch.setattr(sheet_engine, "write_atomic", refuse_the_source)
    answer = post_sheet(
        client, case_id, inbox["id"], "move", inbox, to=worklist["id"], keys=[inbox["rows"][0][0]]
    )

    assert answer.status_code == 409, answer.text
    assert landing.read_bytes() == before, "the destination is exactly as it was"
    monkeypatch.setattr(sheet_engine, "write_atomic", real)
    assert [row[1] for row in read_sheet(client, case_id, worklist["id"])["rows"]] == [
        "Already here"
    ]
    assert [row[1] for row in read_sheet(client, case_id, inbox["id"])["rows"]] == [
        "Quai sud",
        "Pont nord",
    ]


def test_a_row_cannot_be_moved_into_the_sheet_it_is_already_in(client):
    case_id = make_case(client)
    inbox = import_sheet(client, case_id, "Subject\nQuai sud\n", "Inbox")
    answer = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move",
        inbox,
        to=inbox["id"],
        keys=[inbox["rows"][0][0]],
    )
    assert answer.status_code == 422


def test_a_mapping_lands_a_column_under_the_name_the_other_sheet_uses(client):
    """`Adresse` into `Address` is one column spelled twice, and the name match alone
    called it a loss. What the analyst lined up on screen is what lands."""
    case_id = make_case(client)
    inbox = import_sheet(client, case_id, "Adresse,Statut\nQuai sud,à voir\n", "Inbox")
    worklist = import_sheet(client, case_id, "Address,Note\n", "Worklist")
    key = inbox["rows"][0][0]
    quai = add(client, case_id, "structure", "Quai sud")["id"]
    inbox["meta"]["links"] = {key: {"Adresse": quai}}

    answer = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move",
        inbox,
        to=worklist["id"],
        keys=[key],
        mapping={"Adresse": "Address"},
    )
    assert answer.status_code == 200, answer.text
    # Said before the press by the dialog, and answered again after it: `Statut` was
    # pointed at nothing, so it is a drop like any other.
    assert answer.json()["dropped"] == ["Statut"]

    landed = read_sheet(client, case_id, worklist["id"])
    assert landed["rows"][0][1] == "Quai sud" and landed["rows"][0][2] == ""
    # The link is keyed by column as well as by row, so it follows the rename rather
    # than pointing at a column that sheet does not have.
    assert landed["meta"]["links"][key] == {"Address": quai}


def test_a_column_left_out_of_the_mapping_stays_behind_even_when_the_names_match(client):
    """The mapping is the whole answer where it is given: a column the analyst chose not
    to send is not sent back in by the name match."""
    case_id = make_case(client)
    inbox = import_sheet(client, case_id, "Subject,Scratch\nQuai sud,mine\n", "Inbox")
    worklist = import_sheet(client, case_id, "Subject,Scratch\n", "Worklist")

    answer = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move",
        inbox,
        to=worklist["id"],
        keys=[inbox["rows"][0][0]],
        mapping={"Subject": "Subject"},
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["dropped"] == ["Scratch"]
    assert read_sheet(client, case_id, worklist["id"])["rows"][0][2] == ""


def test_a_mapping_cannot_invent_a_column_or_pour_two_into_one(client):
    """The destination's shape stays its own, and one column cannot hold two answers."""
    case_id = make_case(client)
    inbox = import_sheet(client, case_id, "Subject,Alias\nQuai sud,QS\n", "Inbox")
    worklist = import_sheet(client, case_id, "Subject\n", "Worklist")
    key = inbox["rows"][0][0]

    invented = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move",
        inbox,
        to=worklist["id"],
        keys=[key],
        mapping={"Subject": "Nowhere"},
    )
    assert invented.status_code == 422

    both = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move",
        inbox,
        to=worklist["id"],
        keys=[key],
        mapping={"Subject": "Subject", "Alias": "Subject"},
    )
    assert both.status_code == 422
    # Refused before either file was touched.
    assert read_sheet(client, case_id, worklist["id"])["rows"] == []


def test_a_move_can_be_put_back_from_both_ends(client):
    """A move writes two files and the grid's undo stack reaches neither, which is what
    made a mis-aimed one final."""
    case_id = make_case(client)
    inbox = import_sheet(client, case_id, "Subject,Scratch\nQuai sud,mine\nPont nord,\n", "Inbox")
    worklist = import_sheet(client, case_id, "Subject\n", "Worklist")
    key = inbox["rows"][0][0]
    inbox["meta"]["colours"] = {key: "green"}
    before = read_sheet(client, case_id, inbox["id"])
    before["meta"]["colours"] = {key: "green"}

    moved = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move",
        inbox,
        to=worklist["id"],
        keys=[key],
    )
    assert moved.status_code == 200, moved.text
    landed = moved.json()["landed"]
    assert landed == [key]

    put_back = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move/undo",
        {**before, "stamp": moved.json()["stamp"]},
        to=worklist["id"],
        keys=landed,
    )
    assert put_back.status_code == 200, put_back.text
    assert put_back.json()["undone"] == 1

    # The source as it stood, colour and dropped column included: the undo restores the
    # table rather than replaying the move backwards.
    back = read_sheet(client, case_id, inbox["id"])
    assert [row[1] for row in back["rows"]] == ["Quai sud", "Pont nord"]
    assert back["rows"][0][2] == "mine"
    assert back["meta"]["colours"] == {key: "green"}
    assert read_sheet(client, case_id, worklist["id"])["rows"] == []


def test_an_undo_leaves_a_row_the_other_sheet_gained_in_between(client):
    """Only the keys the move answered are taken out, so a row somebody added over there
    afterwards is not collateral."""
    case_id = make_case(client)
    inbox = import_sheet(client, case_id, "Subject\nQuai sud\n", "Inbox")
    worklist = import_sheet(client, case_id, "Subject\nAlready here\n", "Worklist")
    key = inbox["rows"][0][0]
    before = read_sheet(client, case_id, inbox["id"])

    moved = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move",
        inbox,
        to=worklist["id"],
        keys=[key],
    )
    assert moved.status_code == 200, moved.text
    put_back = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move/undo",
        {**before, "stamp": moved.json()["stamp"]},
        to=worklist["id"],
        keys=moved.json()["landed"],
    )
    assert put_back.status_code == 200, put_back.text
    assert [row[1] for row in read_sheet(client, case_id, worklist["id"])["rows"]] == [
        "Already here"
    ]


def test_an_undo_of_a_sheet_that_moved_on_is_refused_rather_than_overwriting_it(client):
    """The analyst typed into the sheet after the move; the toast's button must not win
    over what they typed."""
    case_id = make_case(client)
    inbox = import_sheet(client, case_id, "Subject\nQuai sud\n", "Inbox")
    worklist = import_sheet(client, case_id, "Subject\n", "Worklist")
    before = read_sheet(client, case_id, inbox["id"])
    moved = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move",
        inbox,
        to=worklist["id"],
        keys=[inbox["rows"][0][0]],
    )
    assert moved.status_code == 200, moved.text

    stale = post_sheet(
        client,
        case_id,
        inbox["id"],
        "move/undo",
        {**before, "stamp": "0-0"},
        to=worklist["id"],
        keys=moved.json()["landed"],
    )
    assert stale.status_code == 409
    # Refused at the source, so the destination still holds the row it was sent.
    assert len(read_sheet(client, case_id, worklist["id"])["rows"]) == 1


def test_the_sheet_list_says_what_the_columns_are_called(client):
    """The move's mapping needs the other sheets' headings, and reading every sheet in
    the case whole to learn them is what this line is instead of."""
    case_id = make_case(client)
    import_sheet(client, case_id, "Subject,Status\nQuai sud,to do\n", "Inbox")
    listed = client.get(f"/api/cases/{case_id}/sheets").json()["sheets"]
    assert listed[0]["headings"] == ["id", "Subject", "Status"]
    assert listed[0]["columns"] == 3


def test_an_empty_fork_keeps_the_shape_and_leaves_the_rows(client):
    """Which is the other thing an analyst wanted from a duplicate: the next floor up
    starts as this floor's columns with nothing under them."""
    case_id = make_case(client)
    sheet = import_sheet(client, case_id, "Subject,Status\nQuai sud,to do\n")
    sheet["meta"]["roles"] = {"Status": {"kind": "state", "values": ["to do", "done"]}}
    sheet["meta"]["notes"] = {"Status": "where this one got to"}
    sheet["meta"]["progress"] = "Status"
    assert (
        client.put(
            f"/api/cases/{case_id}/sheets/{sheet['id']}",
            json={
                "columns": sheet["columns"],
                "rows": sheet["rows"],
                "meta": sheet["meta"],
                "stamp": sheet["stamp"],
            },
        ).status_code
        == 200
    )

    made = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/duplicate",
        json={"title": "Worklist", "empty": True},
    )
    assert made.status_code == 200, made.text
    forked = read_sheet(client, case_id, made.json()["id"])
    assert forked["columns"] == ["id", "Subject", "Status"]
    assert forked["rows"] == []
    assert forked["meta"]["roles"]["Status"]["values"] == ["to do", "done"]
    assert forked["meta"]["notes"] == {"Status": "where this one got to"}
    assert forked["meta"]["progress"] == "Status"


# -- a binder arriving whole ---------------------------------------------------


def workbook(tabs):
    """A real .xlsx, built here so the test reads the file format and not a stub."""
    import io

    from openpyxl import Workbook

    book = Workbook()
    book.remove(book.active)
    for title, rows in tabs.items():
        tab = book.create_sheet(title)
        for row in rows:
            tab.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def test_every_tab_of_a_workbook_lands_as_its_own_sheet(client):
    """The binders arrive with five or six tabs. Asking the analyst to export each one to
    CSV by hand is asking them not to bother, and the tab that gets skipped is the one
    saying what the others mean."""
    case_id = make_case(client)
    data = workbook(
        {
            "Register": [["Unit", "On map"], ["3rd Brigade", "YES"]],
            "Tracker": [["Unit", "Note"], ["1st Coy", "seen"]],
        }
    )

    answer = client.post(
        f"/api/cases/{case_id}/sheets/import-xlsx",
        files={"file": ("binder.xlsx", data, "application/vnd.ms-excel")},
    )
    assert answer.status_code == 200, answer.text
    made = answer.json()["sheets"]
    assert [sheet["label"] for sheet in made] == ["Register", "Tracker"]

    register = read_sheet(client, case_id, made[0]["id"])
    assert register["columns"] == ["id", "Unit", "On map"]
    assert register["rows"][0][1:] == ["3rd Brigade", "YES"]


def test_a_tab_of_pasted_screenshots_is_named_rather_than_filed_as_an_empty_sheet(client):
    """Two tabs of a timeline binder hold nothing but images, and two empty sheets nobody
    asked for are worse than being told they were empty."""
    case_id = make_case(client)
    data = workbook({"Table": [["Unit"], ["3rd Brigade"]], "Proof of hour": []})

    answer = client.post(
        f"/api/cases/{case_id}/sheets/import-xlsx",
        files={"file": ("binder.xlsx", data, "application/vnd.ms-excel")},
    )
    assert answer.status_code == 200, answer.text
    assert len(answer.json()["sheets"]) == 1
    assert answer.json()["empty"] == ["Proof of hour"]


def test_a_workbook_cell_becomes_the_words_a_person_would_read(client):
    """A workbook has no words, only a serial number and a display format. ISO is the one
    spelling that means the same thing in every locale, and Excel's every-number-is-a-
    double is why a column of counts must not arrive reading `12.0`."""
    from datetime import date, datetime

    case_id = make_case(client)
    data = workbook(
        {
            "Table": [
                ["Day", "Moment", "Count", "Confirmed"],
                [date(2026, 1, 3), datetime(2026, 1, 3, 6, 42), 12.0, True],
            ]
        }
    )
    answer = client.post(
        f"/api/cases/{case_id}/sheets/import-xlsx",
        files={"file": ("binder.xlsx", data, "application/vnd.ms-excel")},
    )
    assert answer.status_code == 200, answer.text
    landed = read_sheet(client, case_id, answer.json()["sheets"][0]["id"])
    assert landed["rows"][0][1:] == ["2026-01-03", "2026-01-03 06:42", "12", "YES"]


def test_something_that_is_not_a_workbook_is_refused_rather_than_read(client):
    case_id = make_case(client)
    answer = client.post(
        f"/api/cases/{case_id}/sheets/import-xlsx",
        files={"file": ("notes.txt", b"not a workbook", "text/plain")},
    )
    assert answer.status_code == 422


def test_a_workbook_keeps_the_seconds_a_timecode_column_is_counted_in(client):
    """ISO 8601 carries seconds and `parse_when` reads them, so cutting to `hh:mm` threw
    away information both ends could handle.

    The road this feeds is the one the spec sells as an absolute time *to the second*: a
    timecode of `00:01:23` arriving as `00:01` moves a synchronised video by twenty three
    seconds, and nothing on screen says so. A whole minute still writes no `:00`, so a
    column of dates keeps the spelling somebody typed.
    """
    from datetime import datetime, time

    from azimut.engine import sheetroles

    case_id = make_case(client)
    data = workbook(
        {
            "Table": [
                ["Offset", "Moment", "Round"],
                [time(0, 1, 23), datetime(2026, 1, 3, 1, 57, 33), datetime(2026, 1, 3, 6, 42)],
            ]
        }
    )
    answer = client.post(
        f"/api/cases/{case_id}/sheets/import-xlsx",
        files={"file": ("binder.xlsx", data, "application/vnd.ms-excel")},
    )
    assert answer.status_code == 200, answer.text
    landed = read_sheet(client, case_id, answer.json()["sheets"][0]["id"])
    assert landed["rows"][0][1:] == ["00:01:23", "2026-01-03 01:57:33", "2026-01-03 06:42"]

    # And the round trip: what was written is what the two readers take back out.
    assert sheetroles.parse_offset("00:01:23") == 83
    assert sheetroles.parse_when("2026-01-03 01:57:33")["clock"] == "01:57:33"


def test_a_workbook_says_which_tabs_and_cells_it_left_out(client, monkeypatch):
    """Three ceilings, and each of them used to apply in silence.

    A thirty thousand row export arriving as twenty thousand under a toast reading
    "5 tabs filed" is a sheet that looks whole, with nothing on screen to suspect otherwise.
    Lowered here rather than built at full size: the ceilings are the behaviour under test,
    not the memory it takes to reach them.
    """
    from azimut.engine import sheetxlsx

    monkeypatch.setattr(sheetxlsx, "MAX_TABS", 2)
    monkeypatch.setattr(sheetxlsx, "MAX_ROWS", 2)
    monkeypatch.setattr(sheetxlsx, "MAX_COLUMNS", 2)
    case_id = make_case(client)
    data = workbook(
        {
            "Wide": [["Unit", "Note", "Extra"], ["3rd", "seen", "dropped"]],
            "Tall": [["Unit"], ["a"], ["b"], ["c"]],
            "Third": [["Unit"], ["d"]],
        }
    )

    answer = client.post(
        f"/api/cases/{case_id}/sheets/import-xlsx",
        files={"file": ("binder.xlsx", data, "application/vnd.ms-excel")},
    )
    assert answer.status_code == 200, answer.text
    filed = answer.json()
    assert filed["dropped"] == ["Third"], "the tab past the ceiling is named"
    cut = {entry["title"]: entry for entry in filed["cut"]}
    assert cut["Wide"]["columns"] == 2 and cut["Wide"]["rows"] is None
    assert cut["Tall"]["rows"] == 2 and cut["Tall"]["columns"] is None


def test_a_workbook_declaring_gigabytes_of_xml_is_refused_before_it_is_unzipped(client):
    """An .xlsx is compressed XML, and `read_only` streams no part of its shared strings.

    So the bound on the bytes received was not a bound at all: thirty two megabytes of
    zeroes can declare gigabytes, and the reader would materialise them before the first
    cell. The app already clamps images for this exact reason.
    """
    import zipfile

    from azimut.engine import sheetxlsx

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("xl/sharedStrings.xml", b"\0" * (sheetxlsx.MAX_XLSX_UNZIPPED_BYTES + 1))
    bomb = buffer.getvalue()
    assert len(bomb) < sheetxlsx.MAX_XLSX_BYTES, "the point is that the compressed size passes"

    case_id = make_case(client)
    answer = client.post(
        f"/api/cases/{case_id}/sheets/import-xlsx",
        files={"file": ("binder.xlsx", bomb, "application/vnd.ms-excel")},
    )
    assert answer.status_code == 422
    assert "once unzipped" in answer.json()["detail"]


def test_a_workbook_whose_tab_cannot_be_written_files_none_of_them(client, monkeypatch):
    """All of the tabs or none.

    A binder whose second tab refuses used to leave the first one standing *and* a sheet
    with no file for the one that failed, so the retry landed a second copy of half a
    binder beside a row nobody could open.
    """
    from azimut import layout
    from azimut.api.cases import get_case
    from azimut.engine import sheets as sheet_engine

    case_id = make_case(client)
    data = workbook({"One": [["Unit"], ["3rd"]], "Two": [["Unit"], ["1st"]]})
    real = sheet_engine.write_atomic
    tables: list[str] = []

    def refuse_the_second(path, text, *, encoding):
        if path.suffix == ".csv":
            tables.append(path.name)
            if len(tables) > 1:
                raise sheet_engine.SheetUnwritable("could not write “Two.csv”: the disk is full")
        return real(path, text, encoding=encoding)

    monkeypatch.setattr(sheet_engine, "write_atomic", refuse_the_second)
    answer = client.post(
        f"/api/cases/{case_id}/sheets/import-xlsx",
        files={"file": ("binder.xlsx", data, "application/vnd.ms-excel")},
    )

    assert answer.status_code == 409, answer.text
    assert client.get(f"/api/cases/{case_id}/sheets").json()["sheets"] == []
    folder = get_case(case_id).resolve_inside(layout.sheet_rel("One")).parent
    assert not list(folder.glob("*.csv")), "and the file the first tab wrote is gone too"


# -- a row and the file the library already downloaded -------------------------


def test_a_row_finds_the_media_the_library_imported_from_the_same_page(client):
    """A worklist's link column and the library's imports are the same pages twice, and
    nothing joined them: the analyst had the video, and the row pointing at its post
    could not say so."""
    case_id = make_case(client)
    video = add(client, case_id, "media", "clip.mp4", source_url="https://example.org/post/1")
    sheet = import_sheet(
        client, case_id, "Subject,Video\nFirst impact,https://example.org/post/1\n"
    )

    answer = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/media",
        json={"urls": ["https://example.org/post/1", "https://example.org/post/2"]},
    )
    assert answer.status_code == 200, answer.text
    found = answer.json()["media"]
    assert found["https://example.org/post/1"]["id"] == video["id"]
    assert "https://example.org/post/2" not in found, "a page nobody downloaded answers nothing"


def test_a_piece_attached_to_a_row_is_referenced_and_mentioned_never_copied(client):
    """The screenshot of the message giving the hour, which lived in a tab of its own.
    The entity is already the case's, so nothing new is filed and no artifact is owned
    twice — and the edge is what makes it visible from the piece's own side."""
    case_id = make_case(client)
    shot = add(client, case_id, "media", "message.png")
    sheet = import_sheet(client, case_id, "Subject\nFirst impact\n")
    key = sheet["rows"][0][0]
    sheet["meta"]["attachments"] = {key: [shot["id"]]}

    saved = client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={
            "columns": sheet["columns"],
            "rows": sheet["rows"],
            "meta": sheet["meta"],
            "stamp": sheet["stamp"],
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["meta"]["attachments"] == {key: [shot["id"]]}
    # Ids and only ids in the sidecar — a label beside one goes stale the moment the
    # entity is renamed — so the read answers what each of them is called. Without this
    # the panel lists `e_58fea8e8f0`, and anything but a string is dropped in silence,
    # which is how attaching came to look like it did nothing at all.
    read = read_sheet(client, case_id, sheet["id"])
    assert read["pieces"][shot["id"]] == {"label": "message.png", "type": "media"}
    mentions = {
        (link["from"], link["to"]) for link in case_links(case_id) if link["type"] == "mentions"
    }
    assert (sheet["id"], shot["id"]) in mentions


# -- deleting a sheet that promoted --------------------------------------------


def test_deleting_a_sheet_that_promoted_drops_its_edges_and_keeps_the_entities(client):
    """The Trash gate this road needed and never had. A sheet says what is being checked
    and the graph says what the case believes: throwing the worklist away is throwing the
    worklist away, not the subjects it established."""
    case_id = make_case(client)
    sheet = import_sheet(client, case_id, "Subject\nQuai sud\nPont nord\n")
    assert (
        post_sheet(
            client,
            case_id,
            sheet["id"],
            "promote",
            sheet,
            keys=[row[0] for row in sheet["rows"]],
            subject={"column": "Subject", "type": "structure"},
        ).status_code
        == 200
    )
    made = {e["id"] for e in case_entities(case_id, "structure")}
    assert len(made) == 2

    gone = client.delete(f"/api/cases/{case_id}/entities/{sheet['id']}")
    assert gone.status_code == 200, gone.text

    assert {e["id"] for e in case_entities(case_id, "structure")} == made
    assert [link for link in case_links(case_id) if link["type"] == "mentions"] == []
