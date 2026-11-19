"""A sheet on a map: its rows with a place as a personal layer kept in step with the sheet."""

from pathlib import Path

import pytest

from azimut.engine import bundles, notes_charts, sheetmap, workqueue
from azimut.workspace import Case

COLUMNS = ["id", "Identification", "Grade", "State", "Position", "Seen", "Gone"]
ROWS = [
    ["r1", "Streit Cougar", "confirmed", "burned", "12.74625, 43.49463 (±30 m)", "2026-09-03", "2026-09-10"],
    ["r2", "BATT UMG", "almost sure", "abandoned", "~12.7590, 43.4950 (±450 m)", "04/09/2026", ""],
    ["r3", "Oshkosh M-ATV", "confirmed", "destroyed", "zone: between Dhubab and the airport road", "", ""],
    ["r4", "Al-Wahsh MRAP", "set aside", "intact", "38P LV 36392 08400", "", ""],
    ["r5", "Toyota technical", "strong doubt", "burned", "Dhubab airport", "not a day", ""],
    ["r6", "Model unknown", "", "intact", "", "", ""],
]
CHOICE = {"place": "Position", "name": "Identification", "card": ["Grade", "State"], "colour": "Grade",
          "start": "Seen", "end": "Gone"}


@pytest.fixture
def owner(client):
    return client.post("/api/cases", json={"name": "Register"}).json()["id"]


def sheet_with(client, owner, columns=COLUMNS, rows=ROWS, meta=None, title="Vehicle register"):
    made = client.post(f"/api/cases/{owner}/sheets", json={"title": title}).json()
    saved = client.put(f"/api/cases/{owner}/sheets/{made['id']}",
                       json={"columns": columns, "rows": rows, "meta": meta or {}})
    assert saved.status_code == 200, saved.text
    return made["id"]


def edit_rows(client, owner, sheet_id, change):
    read = client.get(f"/api/cases/{owner}/sheets/{sheet_id}").json()
    columns, rows = read["columns"], [list(row) for row in read["rows"]]
    change(columns, rows)
    saved = client.put(f"/api/cases/{owner}/sheets/{sheet_id}",
                       json={"columns": columns, "rows": rows, "meta": read["meta"], "stamp": read["stamp"]})
    assert saved.status_code == 200, saved.text


def place(client, owner, label, lat, lon):
    made = client.post(f"/api/cases/{owner}/entities",
                       json={"type": "place", "label": label, "attrs": {"lat": lat, "lon": lon}})
    assert made.status_code == 200, made.text
    return made.json()


def make(client, owner, sheet_id, choice=CHOICE, **extra):
    made = client.post(f"/api/cases/{owner}/sheets/{sheet_id}/map", json={"choice": choice, **extra})
    assert made.status_code == 200, made.text
    return made.json()


def layer(client, owner, name):
    read = client.get(f"/api/cases/{owner}/map-layers/{name}/edit")
    assert read.status_code == 200, read.text
    return read.json()


def points(client, owner, name):
    return {f["properties"]["sheet_row"]: f for f in layer(client, owner, name)["document"]["features"]
            if f["properties"].get("sheet_row")}


def row_of(client, owner, name):
    return next(row for row in client.get(f"/api/cases/{owner}/map-layers").json() if row["name"] == name)


# -- reading a place ---------------------------------------------------------------------


def test_a_place_is_read_from_two_columns_one_cell_a_grid_reference_a_link_or_a_name(client, owner):
    assert sheetmap.read_place("12.5", lon_cell="43.4")["how"] == "columns"
    assert sheetmap.read_place("12,5", lon_cell="43,4")["lat"] == 12.5
    assert sheetmap.read_place("95", lon_cell="43")["reason"] == "outside"
    assert sheetmap.read_place("north", lon_cell="43")["reason"] == "unread"
    hedged = sheetmap.read_place("~12.7590, 43.4950 (±450 m)")
    assert (hedged["how"], hedged["approx"], hedged["radius"]) == ("coordinates", True, 450.0)
    grid = sheetmap.read_place("38P LV 36392 08400")
    assert grid["how"] == "mgrs" and 12 < grid["lat"] < 13 and 43 < grid["lon"] < 44
    assert sheetmap.read_place("  ")["reason"] == "empty"
    assert sheetmap.read_place("somewhere")["reason"] == "unread"
    assert sheetmap.read_place("100, 200")["reason"] == "outside"

    airport = place(client, owner, "Dhubab airport", 12.7385, 43.4981)
    place(client, owner, "Hill", 12.70, 43.50)
    place(client, owner, "Hill", 12.71, 43.51)
    sheet_id = sheet_with(client, owner, ["id", "Where"], [["r1", "Dhubab airport"], ["r2", "Hill"], ["r3", "the depot"]],
                          meta={"links": {"r3": {"Where": airport["id"]}}})
    answer = client.post(f"/api/cases/{owner}/sheets/{sheet_id}/map/preview",
                         json={"choice": {"place": "Where"}}).json()
    assert answer["hows"] == {"named": 1, "linked": 1}
    assert [(row["text"], row["reason"]) for row in answer["unplaced"]] == [("Hill", "ambiguous")]


def test_a_choice_names_columns_the_sheet_holds(client, owner):
    sheet_id = sheet_with(client, owner)
    for choice, said in (({}, "choose the column that holds the place"),
                         ({"place": "Nowhere"}, "is not in this sheet"),
                         ({"place": "id"}, "is not in this sheet"),
                         ({"place": "Position", "end": "Gone"}, "starts before"),
                         ({"place": "Position", "lon": "Position"}, "two columns"),
                         ({"place": "Position", "card": list(COLUMNS[1:]) * 2 + ["Nope"]}, "is not in this sheet")):
        refused = client.post(f"/api/cases/{owner}/sheets/{sheet_id}/map/preview", json={"choice": choice})
        assert refused.status_code == 422 and said in refused.json()["detail"], (choice, refused.text)
    assert client.post(f"/api/cases/{owner}/sheets/e_nothing/map/preview",
                       json={"choice": CHOICE}).status_code == 404


# -- making the layer --------------------------------------------------------------------


def test_the_preview_counts_lists_and_colours_before_anything_is_made(client, owner):
    sheet_id = sheet_with(client, owner)
    answer = client.post(f"/api/cases/{owner}/sheets/{sheet_id}/map/preview", json={"choice": CHOICE}).json()
    assert (answer["rows"], answer["placed"], answer["unplaced_count"]) == (6, 3, 3)
    assert answer["hows"] == {"coordinates": 2, "mgrs": 1}
    assert [(row["number"], row["name"], row["reason"]) for row in answer["unplaced"]] == [
        (3, "Oshkosh M-ATV", "unread"), (5, "Toyota technical", "unread"), (6, "Model unknown", "empty")]
    # graded values in the order and the colours a chart of the case gives them
    grades = {grade.key: grade.light for grade in notes_charts.GRADES}
    assert [(group["value"], group["colour"], group["count"]) for group in answer["groups"]] == [
        ("confirmed", grades["confirmed"], 1), ("almost sure", grades["almost"], 1), ("set aside", grades["aside"], 1)]
    assert (answer["dated"], answer["undated"], answer["first"], answer["last"]) == (2, 1, "2026-09-03", "2026-09-10")
    assert answer["layers"] == []
    assert client.get(f"/api/cases/{owner}/map-layers").json() == [], "a preview makes nothing"


def test_a_named_colour_of_the_case_wins_over_the_grade(client, owner):
    saved = client.put(f"/api/cases/{owner}/layer-palette", json={"colours": [{"name": "Set aside", "colour": "#123456"}]})
    assert saved.status_code == 200, saved.text
    sheet_id = sheet_with(client, owner)
    answer = client.post(f"/api/cases/{owner}/sheets/{sheet_id}/map/preview", json={"choice": CHOICE}).json()
    assert {group["value"]: group["colour"] for group in answer["groups"]}["set aside"] == "#123456"


def test_one_press_makes_a_personal_layer_of_the_placed_rows_dated_and_grouped(client, owner):
    sheet_id = sheet_with(client, owner)
    made = make(client, owner, sheet_id)
    assert made["editable"] and made["title"] == "Vehicle register"
    assert made["made"] == {"points": 3, "unplaced": 3, "dated": 2, "undated": 1}
    assert [row["number"] for row in made["unplaced"]] == [3, 5, 6]
    assert made["sheet"] == {"id": sheet_id, "title": "Vehicle register", "gone": False, "changed": False}
    assert made["origin"]["source"] == {"kind": "sheet", "name": "Vehicle register"}

    read = layer(client, owner, made["name"])
    groups = {group["id"]: group for group in read["groups"]}
    assert [group["name"] for group in read["groups"]] == ["confirmed", "almost sure", "set aside"]
    assert {group["mode"] for group in read["groups"]} == {"colour"}
    features = points(client, owner, made["name"])
    cougar = features["r1"]["properties"]
    assert features["r1"]["geometry"]["coordinates"] == [43.49463, 12.74625]
    assert cougar["name"] == "Streit Cougar"
    assert cougar["description"] == "Position: 12.74625, 43.49463 (±30 m)\nGrade: confirmed\nState: burned"
    assert (cougar["date"], cougar["date_end"]) == ("2026-09-03", "2026-09-10")
    assert groups[cougar["group"]]["name"] == "confirmed"
    umg = features["r2"]["properties"]
    assert umg["date"] == "2026-09-04" and "date_end" not in umg
    assert umg["description"].startswith("Position: ~12.7590, 43.4950 (±450 m)")
    # a grid reference is said on the card, as it was written
    assert features["r4"]["properties"]["description"].startswith("Position: 38P LV 36392 08400")
    assert "date" not in features["r4"]["properties"]
    # the layer's legend counts the groups, as any personal layer's does
    assert {entry["name"]: entry["count"] for entry in made["categories"]} == {
        "confirmed": 1, "almost sure": 1, "set aside": 1}


def test_a_sheet_with_no_readable_place_makes_no_layer(client, owner):
    sheet_id = sheet_with(client, owner, ["id", "Where"], [["r1", "somewhere"], ["r2", ""]])
    refused = client.post(f"/api/cases/{owner}/sheets/{sheet_id}/map", json={"choice": {"place": "Where"}})
    assert refused.status_code == 422 and "no row" in refused.json()["detail"]
    assert client.get(f"/api/cases/{owner}/map-layers").json() == []


def test_a_layer_not_coloured_by_a_column_is_one_group_named_after_its_sheet(client, owner):
    sheet_id = sheet_with(client, owner, ["id", "Lat", "Lon"], [["r1", "12.5", "43.4"], ["r2", "12.6", "43.5"]])
    made = make(client, owner, sheet_id, {"place": "Lat", "lon": "Lon"}, title="Two points")
    assert made["title"] == "Two points"
    read = layer(client, owner, made["name"])
    assert [group["name"] for group in read["groups"]] == ["Vehicle register"]
    assert {f["properties"]["name"] for f in read["document"]["features"]} == {"Row 1", "Row 2"}


# -- kept in step ------------------------------------------------------------------------


def test_the_layer_says_when_its_sheet_has_changed_and_not_when_only_the_view_did(client, owner):
    sheet_id = sheet_with(client, owner)
    made = make(client, owner, sheet_id)
    read = client.get(f"/api/cases/{owner}/sheets/{sheet_id}").json()
    # a filter or a colour painted is the sidecar alone, and moves nothing on the map
    meta = {**read["meta"], "colours": {"r1": "red"}}
    assert client.put(f"/api/cases/{owner}/sheets/{sheet_id}/meta", json={"meta": meta}).status_code == 200
    assert row_of(client, owner, made["name"])["sheet"]["changed"] is False
    # a cell that is not on the map does not either
    edit_rows(client, owner, sheet_id, lambda columns, rows: rows[2].__setitem__(3, "gone"))
    assert row_of(client, owner, made["name"])["sheet"]["changed"] is False
    edit_rows(client, owner, sheet_id, lambda columns, rows: rows[0].__setitem__(3, "towed away"))
    assert row_of(client, owner, made["name"])["sheet"]["changed"] is True
    preview = client.post(f"/api/cases/{owner}/sheets/{sheet_id}/map/preview", json={"choice": CHOICE}).json()
    assert [(one["name"], one["sheet"]["changed"]) for one in preview["layers"]] == [(made["name"], True)]


def test_an_update_takes_the_sheet_s_changes_and_keeps_the_analyst_s_own(client, owner):
    sheet_id = sheet_with(client, owner)
    made = make(client, owner, sheet_id)
    name = made["name"]
    url = f"/api/cases/{owner}/map-layers/{name}"
    before = points(client, owner, name)
    # the analyst moves one point, renames another, takes the third out and draws one of their own
    moved = client.patch(f"{url}/markers/{before['r1']['properties']['key']}",
                         json={"geometry": {"type": "Point", "coordinates": [43.5, 12.75]}})
    assert moved.status_code == 200, moved.text
    renamed = client.patch(f"{url}/markers/{before['r2']['properties']['key']}", json={"name": "UMG, burned out"})
    assert renamed.status_code == 200, renamed.text
    assert client.delete(f"{url}/markers/{before['r4']['properties']['key']}").status_code == 200
    own = client.post(f"{url}/markers", json={"lat": 12.7, "lon": 43.4, "name": "My own"})
    assert own.status_code == 200, own.text

    def change(columns, rows):
        rows[0][1] = "Streit Cougar (2)"  # a name the analyst left: taken
        rows[0][4] = "12.74700, 43.49500"  # a point the analyst moved: kept
        rows[1][3] = "burned"  # the card of the point renamed on the map: taken
        rows[1][1] = "BATT UMG (2)"  # its name, renamed on the map: kept
        rows[3][2] = "confirmed"  # the point taken out: stays out
        rows[4][4] = "12.7300, 43.4900"  # a row that had no place now has one: added
        rows.append(["r7", "ERAF Tares", "confirmed", "knocked out", "12.73472, 43.49491", "", ""])
        del rows[5]

    edit_rows(client, owner, sheet_id, change)
    assert row_of(client, owner, name)["sheet"]["changed"] is True
    updated = client.post(f"{url}/sheet", json={})
    assert updated.status_code == 200, updated.text
    answer = updated.json()
    assert answer["updated"] == {"added": 2, "changed": 2, "removed": 0, "kept": 2, "left_out": 1}
    assert answer["sheet"]["changed"] is False
    after = points(client, owner, name)
    assert set(after) == {"r1", "r2", "r5", "r7"}
    assert after["r1"]["geometry"]["coordinates"] == [43.5, 12.75], "the moved point stays where it was put"
    assert after["r1"]["properties"]["name"] == "Streit Cougar (2)"
    assert after["r2"]["properties"]["name"] == "UMG, burned out"
    assert "State: burned" in after["r2"]["properties"]["description"]
    every = layer(client, owner, name)["document"]["features"]
    assert any(f["properties"]["name"] == "My own" for f in every), "a point of the analyst's own is never touched"

    # one Undo puts the layer back as it was before the update
    undone = client.post(f"{url}/sheet/undo", json={"token": answer["undo"]})
    assert undone.status_code == 200, undone.text
    assert set(points(client, owner, name)) == {"r1", "r2"}
    assert row_of(client, owner, name)["sheet"]["changed"] is True
    again = client.post(f"{url}/sheet/undo", json={"token": answer["undo"]})
    assert again.status_code == 422

    # Replace my edits: every row's point as the sheet says
    replaced = client.post(f"{url}/sheet", json={"replace": True}).json()
    assert replaced["updated"]["left_out"] == 0
    final = points(client, owner, name)
    assert set(final) == {"r1", "r2", "r4", "r5", "r7"}
    assert final["r1"]["geometry"]["coordinates"] == [43.495, 12.747]
    assert final["r2"]["properties"]["name"] == "BATT UMG (2)"
    groups = {group["id"]: group["name"] for group in layer(client, owner, name)["groups"]}
    assert groups[final["r4"]["properties"]["group"]] == "confirmed"


def test_a_row_gone_from_the_sheet_takes_its_point_and_an_undo_waits_for_nothing_newer(client, owner):
    sheet_id = sheet_with(client, owner)
    name = make(client, owner, sheet_id)["name"]
    url = f"/api/cases/{owner}/map-layers/{name}"
    edit_rows(client, owner, sheet_id, lambda columns, rows: rows.pop(0))
    answer = client.post(f"{url}/sheet", json={}).json()
    assert answer["updated"]["removed"] == 1 and "r1" not in points(client, owner, name)
    client.post(f"{url}/markers", json={"lat": 12.7, "lon": 43.4, "name": "Later"})
    refused = client.post(f"{url}/sheet/undo", json={"token": answer["undo"]})
    assert refused.status_code == 422 and "changed since" in refused.json()["detail"]


def test_an_update_waits_for_an_editing_session_to_finish(client, owner):
    sheet_id = sheet_with(client, owner)
    name = make(client, owner, sheet_id)["name"]
    assert client.post(f"/api/cases/{owner}/map-layers/{name}/edit").status_code == 200
    refused = client.post(f"/api/cases/{owner}/map-layers/{name}/sheet", json={})
    assert refused.status_code == 422 and "finish editing" in refused.json()["detail"]


def test_a_layer_whose_sheet_lost_a_column_says_so(client, owner):
    sheet_id = sheet_with(client, owner)
    name = make(client, owner, sheet_id)["name"]

    def drop(columns, rows):
        at = columns.index("Grade")
        columns.pop(at)
        for row in rows:
            row.pop(at)

    edit_rows(client, owner, sheet_id, drop)
    said = row_of(client, owner, name)["sheet"]
    assert said["changed"] is True and "Grade" in said["problem"]
    refused = client.post(f"/api/cases/{owner}/map-layers/{name}/sheet", json={})
    assert refused.status_code == 422


# -- the sheet's delete, the Trash and the bundle ----------------------------------------


def test_deleting_the_sheet_warns_the_layer_is_made_from_it_and_the_layer_stays(client, owner):
    sheet_id = sheet_with(client, owner)
    made = make(client, owner, sheet_id)
    impact = client.post(f"/api/cases/{owner}/delete-impact", json={"ids": [sheet_id]}).json()
    touched = {row["label"]: row["how"] for row in impact["touched"]}
    assert touched[made["title"]] == ["is made from it"]
    deleted = client.post(f"/api/cases/{owner}/entities/delete", json={"ids": [sheet_id]})
    assert deleted.status_code == 200, deleted.text
    said = row_of(client, owner, made["name"])["sheet"]
    assert said["gone"] is True and said["title"] == "Vehicle register"
    assert len(points(client, owner, made["name"])) == 3, "the layer keeps its points"
    refused = client.post(f"/api/cases/{owner}/map-layers/{made['name']}/sheet", json={})
    assert refused.status_code == 422 and "no longer in the case" in refused.json()["detail"]


def test_a_bundle_carries_the_layer_with_its_sheet_and_their_link(client, owner, monkeypatch):
    monkeypatch.setattr(workqueue, "start_workers", False)
    sheet_id = sheet_with(client, owner)
    made = make(client, owner, sheet_id)
    case = Case.open(owner)
    job = bundles.queue_export(case)
    workqueue.drain(case)
    imported, import_job = bundles.queue_import(Path(job["payload"]["output"]))
    workqueue.drain(imported)
    imported = Case.open(imported.id)
    assert imported.get_job(import_job["id"])["state"] == "ready"
    row = row_of(client, imported.id, made["name"])
    assert row["sheet"] == {"id": sheet_id, "title": "Vehicle register", "gone": False, "changed": False}
    edit_rows(client, imported.id, sheet_id, lambda columns, rows: rows[0].__setitem__(1, "Cougar"))
    updated = client.post(f"/api/cases/{imported.id}/map-layers/{made['name']}/sheet", json={})
    assert updated.status_code == 200 and updated.json()["updated"]["changed"] == 1
