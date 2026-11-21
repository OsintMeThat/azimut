"""A note's chips arriving in a sheet, and the pictures a cell links.

A note writes a picture of the case as ``[[media:id|label]]``. A sheet made from a chart's
rows, a pasted table and an imported file used to show that code in the cell. Every way
into a sheet now reads a chip as the sheet's own link: its label in the file, its id in
the sidecar, and a column of pictures becomes a `picture` column.

What each test is really guarding:

- the conversion happens in the engine, so creating, saving, importing and reading all
  agree, and an old sheet holding chips reads right before it is saved again;
- a role the analyst gave a column is never replaced;
- a linked picture is a use of the media, as any other link of a sheet is;
- the grid can ask what a picture is before the next read (`/pictures`).
"""

from pathlib import Path

from azimut.engine import sheets as sheet_engine
from azimut.engine import uses

from test_sheet_bridge import add, case_links, make_case, read_sheet


def get_case_(case_id):
    from azimut.api.cases import get_case

    return get_case(case_id)


def picture(client, case_id, label, *, kind="image", path=None):
    suffix = ".jpg" if kind == "image" else ".mp4"
    return add(client, case_id, "media", label, path=path or f"media/{label}{suffix}", kind=kind)["id"]


def cell(sheet, row, name):
    return sheet["rows"][row][sheet["columns"].index(name)]


def link_of(sheet, row, name):
    return (sheet["meta"]["links"].get(sheet["rows"][row][0]) or {}).get(name)


def test_a_sheet_made_from_a_walls_rows_holds_labels_links_and_a_picture_column(client):
    case_id = make_case(client)
    first, second = picture(client, case_id, "frame-1"), picture(client, case_id, "frame-2")
    made = client.post(f"/api/cases/{case_id}/sheets", json={
        "title": "Wall rows",
        "columns": ["Picture", "#", "Model"],
        "rows": [[f"[[media:{first}|#1]]", "1", "Cougar"], [f"[[media:{second}|#2]]{{width=40%}}", "2", "M-ATV"]],
    })
    assert made.status_code == 200, made.text

    sheet = read_sheet(client, case_id, made.json()["id"])
    assert [cell(sheet, row, "Picture") for row in range(2)] == ["#1", "#2"]
    assert [link_of(sheet, row, "Picture") for row in range(2)] == [first, second]
    assert sheet["meta"]["roles"]["Picture"] == {"kind": "picture"}
    # the file holds the words, never the code
    text = Path(get_case_(case_id).resolve_inside(sheet["path"])).read_text(encoding="utf-8-sig")
    assert "[[" not in text and "#1" in text
    # what a picture cell draws, read with the sheet
    assert sheet["pictures"][first] == {"label": "frame-1", "type": "media", "kind": "image",
                                        "thumb": "media/frame-1.jpg"}
    # the sheet mentions what its cells point at from its first moment, and the media is used
    mentioned = {link["to"] for link in case_links(case_id) if link["from"] == sheet["id"] and link["type"] == "mentions"}
    assert {first, second} <= mentioned
    assert {first, second} <= uses.used_refs(get_case_(case_id))


def test_a_save_adopts_a_pasted_chip_and_keeps_the_role_a_column_already_has(client):
    case_id = make_case(client)
    shot = picture(client, case_id, "frame-1")
    place = add(client, case_id, "place", "Rooftop", lat=47.1, lon=37.5)["id"]
    sheet = read_sheet(client, case_id, client.post(f"/api/cases/{case_id}/sheets", json={
        "title": "Leads", "columns": ["Lead", "Where", "Seen"]}).json()["id"])
    sheet["rows"] = [["", f"[[media:{shot}|frame one]]", f"[[entity:{place}|Rooftop]]", "yes"]]
    sheet["meta"]["roles"] = {"Lead": {"kind": "choice", "values": ["frame one"]}}
    sheet["columns"] = ["id", "Lead", "Where", "Seen"]
    saved = client.put(f"/api/cases/{case_id}/sheets/{sheet['id']}",
                       json={key: sheet[key] for key in ("columns", "rows", "meta", "stamp")})
    assert saved.status_code == 200, saved.text

    answer = saved.json()
    assert answer["rows"][0][1:] == ["frame one", "Rooftop", "yes"]
    assert link_of(answer, 0, "Lead") == shot and link_of(answer, 0, "Where") == place
    # the analyst's role stands; a place is no picture, so its column gets none
    assert answer["meta"]["roles"]["Lead"]["kind"] == "choice"
    assert "Where" not in answer["meta"]["roles"]


def test_an_imported_csv_holding_chips_is_read_the_same_way(client):
    case_id = make_case(client)
    shot = picture(client, case_id, "frame-1", kind="video")
    made = client.post(f"/api/cases/{case_id}/sheets/import", json={
        "title": "Imported", "text": f"Frame,Note\n[[media:{shot}|clip]],hello\n"})
    assert made.status_code == 200, made.text

    sheet = read_sheet(client, case_id, made.json()["id"])
    assert cell(sheet, 0, "Frame") == "clip" and link_of(sheet, 0, "Frame") == shot
    assert sheet["meta"]["roles"]["Frame"] == {"kind": "picture"}
    # a video the case has no still of draws its chip: no file to draw
    assert sheet["pictures"][shot]["kind"] == "video" and sheet["pictures"][shot]["thumb"] == ""


def test_an_old_sheet_holding_chips_reads_as_labels_and_settles_on_its_next_save(client):
    case_id = make_case(client)
    shot = picture(client, case_id, "frame-1")
    case = get_case_(case_id)
    made = sheet_engine.create(case, "Old", ["Picture", "#"], [["placeholder", "1"]])
    path = case.resolve_inside(made["attrs"]["path"])
    # written before chips were read: the code itself is in the file
    path.write_text(f"id,Picture,#\nr1,[[media:{shot}|#1]],1\n", encoding="utf-8-sig")
    before = path.read_bytes()

    sheet = read_sheet(client, case_id, made["id"])
    assert cell(sheet, 0, "Picture") == "#1" and link_of(sheet, 0, "Picture") == shot
    assert sheet["meta"]["roles"]["Picture"]["kind"] == "picture"
    assert shot in sheet["pictures"]
    # reading never writes
    assert path.read_bytes() == before

    saved = client.put(f"/api/cases/{case_id}/sheets/{made['id']}",
                       json={key: sheet[key] for key in ("columns", "rows", "meta", "stamp")})
    assert saved.status_code == 200, saved.text
    assert "[[" not in path.read_text(encoding="utf-8-sig")


def test_a_chip_naming_nothing_the_case_holds_keeps_its_label_and_no_link(client):
    case_id = make_case(client)
    made = client.post(f"/api/cases/{case_id}/sheets", json={
        "title": "Gone", "columns": ["Picture"], "rows": [["[[media:e_gone000000|#9]]"]]}).json()
    sheet = read_sheet(client, case_id, made["id"])
    assert cell(sheet, 0, "Picture") == "#9"
    assert link_of(sheet, 0, "Picture") is None
    assert "Picture" not in sheet["meta"]["roles"]


def test_the_pictures_route_answers_by_id_and_by_path_and_leaves_out_the_rest(client):
    case_id = make_case(client)
    shot = picture(client, case_id, "frame-1")
    place = add(client, case_id, "place", "Rooftop", lat=47.1, lon=37.5)["id"]
    sheet_id = client.post(f"/api/cases/{case_id}/sheets", json={"title": "S"}).json()["id"]

    answer = client.post(f"/api/cases/{case_id}/sheets/{sheet_id}/pictures", json={"ids": [shot, place]})
    assert answer.status_code == 200, answer.text
    assert list(answer.json()["pictures"]) == [shot]
    missing = client.post(f"/api/cases/{case_id}/sheets/nope/pictures", json={"ids": [shot]})
    assert missing.status_code == 404
