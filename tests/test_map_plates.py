"""Map plates: a page laid out round the case's maps, kept as a layout, exported as files."""

import io
import zipfile

import pytest
from PIL import Image

from azimut import layout
from azimut.engine import ffmpeg, mapplates
from azimut.workspace import Case


@pytest.fixture
def owner(client):
    return client.post("/api/cases", json={"name": "Plates"}).json()["id"]


def plate_spec(**extra):
    return {"elements": [
        {"id": "map", "kind": "map", "box": [10, 20, 200, 150], "view": {"lat": 48.85, "lon": 2.29, "zoom": 12.4, "bearing": 15},
         "layers": [{"name": "front", "hidden": ["Old"], "stroke": 1.5}], "grid": "latlon"},
        {"id": "legend", "kind": "legend", "box": [215, 20, 70, 60], "of": "map", "names": {"front/Lines": "Front line"}},
        {"id": "label", "kind": "label", "box": [80, 60, 30, 8], "of": "map", "at": [2.3, 48.86], "text": "Depot", "style": "bubble"},
        {"id": "title", "kind": "text", "box": [10, 6, 200, 12], "text": "Situation on {date}", "size": 18, "weight": 700},
    ], **extra}


def save(client, owner, title="Situation", spec=None, **body):
    return client.post(f"/api/cases/{owner}/map-plates", json={"title": title, "spec": spec or plate_spec(), **body})


def png(size=(400, 300), colour=(240, 240, 240), fmt="PNG"):
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, fmt)
    return buf.getvalue()


def test_a_plate_is_kept_as_its_layout_and_listed(client, owner):
    saved = save(client, owner)
    assert saved.status_code == 200, saved.text
    assert saved.json()["spec_path"] == ".mapplates/Situation.json"
    loaded = client.get(f"/api/cases/{owner}/map-plates/Situation").json()
    assert loaded["spec"]["elements"][0]["view"]["zoom"] == 12.4
    assert loaded["spec"]["page"] == {"paper": "a4", "orientation": "landscape"}
    assert loaded["spec"]["time"] == {"at": None, "trail": True, "since": None, "window": 7}
    listed = client.get(f"/api/cases/{owner}/map-plates").json()
    assert [(row["name"], row["maps"], row["thumb"]) for row in listed] == [("Situation", 1, None)]
    entity = Case.open(owner).find_entity(attr="spec", value=".mapplates/Situation.json")
    assert (entity["type"], entity["label"]) == ("map-plate", "Situation")


def test_a_new_plate_never_writes_over_another(client, owner):
    save(client, owner)
    second = save(client, owner)
    assert second.json()["name"] != "Situation"
    assert len(client.get(f"/api/cases/{owner}/map-plates").json()) == 2


def test_a_rename_carries_the_preview_and_the_entity(client, owner):
    save(client, owner)
    thumb = client.put(f"/api/cases/{owner}/map-plates/Situation/thumb",
                       files={"file": ("preview.png", io.BytesIO(png((160, 110))), "image/png")})
    assert thumb.json()["thumb"] == ".mapplates/Situation.webp"
    renamed = save(client, owner, title="Front, October", rename_from="Situation")
    assert renamed.status_code == 200, renamed.text
    name = renamed.json()["name"]
    assert renamed.json()["thumb"] == layout.map_plate_thumb_rel(name)
    assert client.get(f"/api/cases/{owner}/map-plates/Situation").status_code == 404
    assert [row["name"] for row in client.get(f"/api/cases/{owner}/map-plates").json()] == [name]


def test_a_rename_onto_another_plate_is_refused(client, owner):
    save(client, owner)
    save(client, owner, title="Other")
    assert save(client, owner, title="Other", rename_from="Situation").status_code == 409


@pytest.mark.parametrize("element", [
    {"id": "legend", "kind": "legend", "box": [0, 0, 10, 10], "of": "nowhere"},
    {"id": "legend", "kind": "legend", "box": [0, 0, 10, 10]},
    {"id": "arrow", "kind": "arrow", "box": [0, 0, 10, 10], "of": "map", "at": [2, 48]},
    {"id": "label", "kind": "label", "box": [0, 0, 10, 10], "of": "map", "at": [200, 48]},
    {"id": "pic", "kind": "image", "box": [0, 0, 10, 10], "src": "../../etc/passwd"},
    {"id": "pic", "kind": "image", "box": [0, 0, 10, 10], "src": "/etc/passwd"},
    {"id": "map", "kind": "text", "box": [0, 0, 10, 10]},
    {"id": "x", "kind": "text", "box": [0, 0, 0, 10]},
    {"id": "x", "kind": "text", "box": [0, 0, 10, 10], "script": "alert(1)"},
])
def test_a_layout_that_does_not_hold_is_refused(client, owner, element):
    spec = {"elements": [{"id": "map", "kind": "map", "box": [0, 0, 100, 100], "view": {"lat": 0, "lon": 0, "zoom": 3}}, element]}
    assert save(client, owner, spec=spec).status_code == 422


def test_a_plate_has_a_bound_on_its_elements(client, owner):
    spec = {"elements": [{"id": f"t{index}", "kind": "text", "box": [0, 0, 10, 10]} for index in range(mapplates.MAX_ELEMENTS + 1)]}
    assert save(client, owner, spec=spec).status_code == 422


def test_deleting_a_plate_sends_it_and_its_preview_to_the_trash(client, owner):
    save(client, owner)
    client.put(f"/api/cases/{owner}/map-plates/Situation/thumb",
               files={"file": ("preview.png", io.BytesIO(png((160, 110))), "image/png")})
    assert client.delete(f"/api/cases/{owner}/map-plates/Situation").status_code == 200
    assert client.get(f"/api/cases/{owner}/map-plates").json() == []
    # the name is held by the Trash, so a new plate takes the next one
    assert save(client, owner).json()["name"] != "Situation"


# -- templates ------------------------------------------------------------------------


def test_a_template_keeps_the_layout_and_never_a_case_s_data(client):
    data = mapplates.template_of(plate_spec())
    kinds = [element["kind"] for element in data["elements"]]
    assert kinds == ["map", "legend", "text"]
    assert "view" not in data["elements"][0] and "layers" not in data["elements"][0]
    saved = client.post("/api/templates/map", json={"name": "House style", "data": data})
    assert saved.status_code == 200, saved.text
    assert client.get("/api/templates").json()["map"][0]["name"] == "House style"
    leaking = client.post("/api/templates/map", json={"name": "Leak", "data": plate_spec()})
    assert leaking.status_code == 422


# -- exports --------------------------------------------------------------------------


def export(client, owner, fmt, frames, **form):
    files = [("frames", (f"f{index}.png", io.BytesIO(frame), "image/png")) for index, frame in enumerate(frames)]
    return client.post(f"/api/cases/{owner}/map-plates/export", files=files,
                       data={"format": fmt, "filename": "Front line", **form})


def test_a_page_is_written_as_a_png_in_the_views_folder(client, owner):
    answer = export(client, owner, "png", [png(fmt="JPEG")])
    assert answer.status_code == 200, answer.text
    assert answer.json()["file"] == "Front line.png"
    from pathlib import Path

    assert (Path(answer.json()["path"]) / "Front line.png").read_bytes().startswith(b"\x89PNG")


def test_a_pdf_is_the_paper_size(client, owner):
    answer = export(client, owner, "pdf", [png((3508, 2480))], width_mm="297", height_mm="210")
    assert answer.status_code == 200, answer.text
    from pathlib import Path

    written = Path(answer.json()["path"]) / answer.json()["file"]
    data = written.read_bytes()
    assert data.startswith(b"%PDF")
    # 297 by 210 mm is 841.89 by 595.28 points
    assert b"/MediaBox [0 0 841.89 595.28]" in data


def test_a_played_plate_is_a_gif_of_its_days(client, owner):
    answer = export(client, owner, "gif", [png(colour=(200, 0, 0)), png(colour=(0, 0, 200)), png(colour=(0, 200, 0))])
    assert answer.status_code == 200, answer.text
    from pathlib import Path

    with Image.open(Path(answer.json()["path"]) / answer.json()["file"]) as gif:
        assert gif.n_frames == 3


@pytest.mark.skipif(not ffmpeg.ffmpeg_available(), reason="no ffmpeg on this machine")
def test_a_played_plate_is_an_mp4_of_its_days(client, owner):
    answer = export(client, owner, "mp4", [png((641, 361)), png((641, 361), (0, 0, 0))], interval="500")
    assert answer.status_code == 200, answer.text
    from pathlib import Path

    assert (Path(answer.json()["path"]) / answer.json()["file"]).read_bytes()[4:8] == b"ftyp"


@pytest.mark.parametrize(("fmt", "frames"), [
    ("png", [png(), png()]),
    ("gif", [png()]),
    ("png", [b"not a picture"]),
    ("png", [zipfile.ZipFile.__doc__.encode()]),
])
def test_an_export_that_does_not_hold_is_refused(client, owner, fmt, frames):
    assert export(client, owner, fmt, frames).status_code == 422
