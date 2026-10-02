"""A worklist built out of the files the analyst imported, and kept level with the case.

`My geolocations` lists what was done, one row per proof. This lists what was brought in
to be done, one row per imported picture or video, and what each test guards:

- only imported material gets a row: a frame cut in Inspect, a sound file or a capture is
  not a file to geolocate;
- a proof answers for its file however many steps down it was made, so a proof built on a
  frame of a video marks the video done;
- the case's columns are locked and the analyst's two are free;
- refresh adds the files imported since, and moves a status to `done` once a proof
  answers for its file, but never over a status the analyst set to something else;
- the list says what each sheet is and how far along it is, so the Sheet home can.
"""

import io

import pytest
from PIL import Image

from azimut.engine import media as media_engine
from azimut.engine import sheetfromcase as fromcase_engine
from azimut.engine import sheets as sheet_engine
from azimut.engine import workqueue

from test_sheet_bridge import add, make_case, post_sheet, read_sheet


@pytest.fixture(autouse=True)
def no_background_worker(monkeypatch):
    """The link pass would otherwise file accounts while a test counts the case."""
    monkeypatch.setattr(workqueue, "start_workers", False)


def case_of(case_id):
    from azimut.api.cases import get_case

    return get_case(case_id)


def png(shade):
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (shade, 20, 60)).save(buffer, "PNG")
    return buffer.getvalue()


def download(case, title, shade, *, name="clip.png", url="https://x.com/someone/status/1"):
    return media_engine._register_downloaded_item(
        case, url, name, png(shade), title=title, source_extra={"downloader": "test"}
    )


def build(client, case_id, title="Files to geolocate"):
    made = client.post(
        f"/api/cases/{case_id}/sheets/from-case", json={"title": title, "shape": "files"}
    )
    assert made.status_code == 200, made.text
    return made.json()


COLUMNS = [
    "id", "File", "Source URL", "Proof", "Place", "Coordinates", "In case", "Status", "Notes",
]


def a_scene(client):
    """A video with a frame cut out of it and a proof built on the frame, a picture
    nobody has placed, a sound file and a frame: what an afternoon leaves in a case."""
    case_id = make_case(client)
    case = case_of(case_id)
    video = download(case, "Street video", 1, name="street.mp4",
                     url="https://x.com/BashaReport/status/7")
    picture = download(case, "Market picture", 2)
    download(case, "Radio chatter", 3, name="chatter.mp3")
    frame = media_engine.import_image(
        case, Image.new("RGB", (8, 8), (9, 9, 9)), "frame.png",
        {"type": "inspect", "op": "frame", "from": video["item"]["path"]},
    )
    place = add(client, case_id, "place", "Roundabout", lat=15.74, lon=45.03)["id"]
    proof = add(client, case_id, "proof", "Roundabout proof")["id"]
    case.add_link(proof, frame["entity"]["id"], "derived-from", by="test")
    case.add_link(proof, place, "depicts", by="test")
    return case_id, video["entity"]["id"], picture["entity"]["id"], proof, place


# -- the shape --------------------------------------------------------------------


def test_one_row_per_imported_picture_or_video_and_nothing_else(client):
    case_id, video, picture, _, _ = a_scene(client)

    made = build(client, case_id)

    assert made["taken"] == 2 and made["total"] == 2
    sheet = read_sheet(client, case_id, made["id"])
    assert sheet["columns"] == COLUMNS
    assert sorted(row[1] for row in sheet["rows"]) == ["Market picture", "Street video"]
    assert set(sheet["meta"]["built"].values()) == {video, picture}


def test_a_proof_on_a_frame_answers_for_the_video(client):
    case_id, video, _, proof, place = a_scene(client)

    sheet = read_sheet(client, case_id, build(client, case_id)["id"])
    row = next(row for row in sheet["rows"] if row[1] == "Street video")

    assert row[2] == "https://x.com/BashaReport/status/7"
    assert row[3:5] == ["Roundabout proof", "Roundabout"]
    assert row[5] == "15.74000, 45.03000"
    assert row[6] == "YES"
    assert row[7] == "done"
    assert sheet["meta"]["links"][row[0]] == {"File": video, "Proof": proof, "Place": place}


def test_a_file_nobody_placed_starts_to_do(client):
    case_id, *_ = a_scene(client)

    sheet = read_sheet(client, case_id, build(client, case_id)["id"])
    row = next(row for row in sheet["rows"] if row[1] == "Market picture")

    assert row[3:5] == ["", ""]
    assert row[7] == "to do"


def test_the_case_columns_are_locked_and_the_analysts_are_free(client):
    case_id, *_ = a_scene(client)

    roles = read_sheet(client, case_id, build(client, case_id)["id"])["meta"]["roles"]

    for column in ("File", "Source URL", "Proof", "Place"):
        assert roles[column]["kind"] == "locked"
    assert roles["Coordinates"] == {"kind": "computed", "of": "point", "from": "Place"}
    assert roles["Status"]["kind"] == "state"
    assert "Notes" not in roles


# -- refresh ------------------------------------------------------------------------


def test_refresh_adds_new_files_and_moves_answered_ones_to_done(client):
    case_id, _, picture, _, _ = a_scene(client)
    case = case_of(case_id)
    made = build(client, case_id)
    later = download(case, "Later picture", 4)["entity"]["id"]
    place = add(client, case_id, "place", "Market", lat=15.0, lon=45.0)["id"]
    proof = add(client, case_id, "proof", "Market proof")["id"]
    case.add_link(proof, picture, "derived-from", by="test")
    case.add_link(proof, place, "depicts", by="test")

    sheet = read_sheet(client, case_id, made["id"])
    answer = post_sheet(client, case_id, made["id"], "refresh", sheet)

    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["added"] == 1
    fresh = read_sheet(client, case_id, made["id"])
    by_file = {row[1]: row for row in fresh["rows"]}
    assert by_file["Market picture"][3] == "Market proof"
    assert by_file["Market picture"][7] == "done"
    assert by_file["Later picture"][7] == "to do"
    assert later in fresh["meta"]["built"].values()


def test_refresh_leaves_a_status_the_analyst_set(client):
    case_id, _, picture, _, _ = a_scene(client)
    case = case_of(case_id)
    made = build(client, case_id)
    sheet = read_sheet(client, case_id, made["id"])
    at = next(index for index, row in enumerate(sheet["rows"]) if row[1] == "Market picture")
    sheet["rows"][at][7] = "ruled out"
    sheet["rows"][at][8] = "Too dark to read"
    saved = client.put(
        f"/api/cases/{case_id}/sheets/{made['id']}",
        json={"columns": sheet["columns"], "rows": sheet["rows"], "meta": sheet["meta"],
              "stamp": sheet["stamp"]},
    )
    assert saved.status_code == 200, saved.text
    proof = add(client, case_id, "proof", "Market proof")["id"]
    case.add_link(proof, picture, "derived-from", by="test")

    sheet = read_sheet(client, case_id, made["id"])
    assert post_sheet(client, case_id, made["id"], "refresh", sheet).status_code == 200

    row = next(row for row in read_sheet(client, case_id, made["id"])["rows"]
               if row[1] == "Market picture")
    assert row[3] == "Market proof"
    assert row[7:9] == ["ruled out", "Too dark to read"]


def test_a_proofs_sheet_still_refreshes_as_one(client):
    case_id, *_ = a_scene(client)
    made = client.post(
        f"/api/cases/{case_id}/sheets/from-case",
        json={"title": "My geolocations", "shape": "proofs"},
    ).json()
    add(client, case_id, "proof", "Second proof")

    sheet = read_sheet(client, case_id, made["id"])
    answer = post_sheet(client, case_id, made["id"], "refresh", sheet)

    assert answer.status_code == 200, answer.text
    assert answer.json()["added"] == 1


def test_a_sheet_somebody_typed_is_not_refreshed(client):
    case_id = make_case(client)
    made = client.post(f"/api/cases/{case_id}/sheets", json={"title": "Mine"}).json()

    sheet = read_sheet(client, case_id, made["id"])
    answer = post_sheet(client, case_id, made["id"], "refresh", sheet)

    assert answer.status_code == 422


# -- what the home reads ------------------------------------------------------------------


def test_the_preview_counts_and_finds_the_worklist_already_built(client):
    case_id, *_ = a_scene(client)
    before = client.get(f"/api/cases/{case_id}/sheets/from-case/files").json()
    assert before == {"total": 2, "answered": 1, "sheet": None}

    made = build(client, case_id)

    after = client.get(f"/api/cases/{case_id}/sheets/from-case/files").json()
    assert after["sheet"] == made["id"]


def test_the_preview_finds_its_sheet_without_reading_the_whole_case(client, monkeypatch):
    """The Sheet home asks for this on every visit, so it pages sheets by type."""
    from azimut.sqlite_backend import SqliteCase

    case_id, *_ = a_scene(client)
    made = build(client, case_id)

    def whole_case(*args, **kwargs):
        raise AssertionError("files_preview read every entity")

    monkeypatch.setattr(SqliteCase, "list_entities", whole_case)
    assert client.get(f"/api/cases/{case_id}/sheets/from-case/files").json()["sheet"] == made["id"]


def test_the_list_says_what_each_sheet_is_and_how_far_along(client):
    case_id, *_ = a_scene(client)
    built = build(client, case_id)
    typed = client.post(f"/api/cases/{case_id}/sheets", json={"title": "Mine"}).json()

    listed = {sheet["id"]: sheet for sheet in client.get(f"/api/cases/{case_id}/sheets").json()["sheets"]}

    assert listed[built["id"]]["shape"] == "files"
    assert listed[built["id"]]["progress"] == {
        "kind": "state", "column": "Status", "count": 1, "total": 2,
    }
    assert listed[built["id"]]["modified_at"]
    assert listed[typed["id"]]["shape"] is None
    assert listed[typed["id"]]["progress"] is None


def test_the_list_and_the_builder_name_the_shapes_by_the_same_column():
    assert dict(sheet_engine.BUILT_SHAPES) == {
        "files": fromcase_engine.FILE_COLUMN,
        "proofs": fromcase_engine.TITLE_COLUMN,
    }
