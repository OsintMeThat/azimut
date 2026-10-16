"""Map plates: a page laid out round the case's maps, kept as a layout, exported as files."""

import io
import json
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
    page = loaded["spec"]["page"]
    assert (page["paper"], page["orientation"], page["transparent"], page["background"]["kind"]) == ("a4", "landscape", False, "solid")
    assert loaded["spec"]["time"] == {"at": None, "step": None, "trail": True, "since": None, "window": None, "hold": 1.0}
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


def test_a_duplicate_takes_the_next_free_name_and_its_preview_along(client, owner):
    save(client, owner)
    client.put(f"/api/cases/{owner}/map-plates/Situation/thumb", files={"file": ("preview.png", io.BytesIO(png((160, 110))), "image/png")})
    copied = client.post(f"/api/cases/{owner}/map-plates/Situation/duplicate")
    assert copied.status_code == 200, copied.text
    assert copied.json()["name"] == "Situation copy"
    assert copied.json()["thumb"] == ".mapplates/Situation copy.webp"
    again = client.post(f"/api/cases/{owner}/map-plates/Situation/duplicate").json()
    assert again["name"] != "Situation copy"
    listed = {row["name"]: row["thumb"] for row in client.get(f"/api/cases/{owner}/map-plates").json()}
    assert listed["Situation copy"] == ".mapplates/Situation copy.webp"
    loaded = client.get(f"/api/cases/{owner}/map-plates/Situation copy").json()
    assert loaded["spec"]["elements"][0]["view"]["zoom"] == 12.4
    entity = Case.open(owner).find_entity(attr="spec", value=".mapplates/Situation copy.json")
    assert entity["attrs"]["thumb"] == ".mapplates/Situation copy.webp"
    assert client.post(f"/api/cases/{owner}/map-plates/Nowhere/duplicate").status_code == 404


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
    {"id": "z", "kind": "zone", "box": [0, 0, 1, 1], "of": "map", "points": [[0, 0], [1, 1]]},
    {"id": "r", "kind": "ring", "box": [0, 0, 1, 1], "of": "map"},
    {"id": "d", "kind": "measure", "box": [0, 0, 1, 1], "of": "map", "at": [0, 0]},
    {"id": "x", "kind": "text", "box": [0, 0, 10, 10], "until": "yesterday"},
    {"id": "x", "kind": "text", "box": [0, 0, 10, 10], "days": ["2026-10-01"]},
    {"id": "pic", "kind": "image", "box": [0, 0, 10, 10], "data": "data:text/html;base64,PHNjcmlwdD4="},
    {"id": "map", "kind": "map", "box": [0, 0, 1, 1], "of": "map", "view": {"lat": 0, "lon": 0, "zoom": 3}},
])
def test_a_layout_that_does_not_hold_is_refused(client, owner, element):
    spec = {"elements": [{"id": "map", "kind": "map", "box": [0, 0, 100, 100], "view": {"lat": 0, "lon": 0, "zoom": 3}}, element]}
    assert save(client, owner, spec=spec).status_code == 422


def test_a_plate_keeps_what_it_draws_beyond_its_maps(client, owner):
    """Annotations tied to days, ground shapes, a detail map, a picture kept inside, the page's own look."""
    spec = {
        "page": {"paper": "custom", "size": [300, 160], "background": {"kind": "gradient", "colour": "#eeeeee", "angle": 180},
                 "frame": True, "transparent": True},
        "theme": {"font": "serif", "preset": "report"},
        "elements": [
            {"id": "map", "kind": "map", "box": [0, 0, 100, 100], "view": {"lat": 0, "lon": 0, "zoom": 3}, "grid": "mgrs",
             "grid_style": {"step": 1000, "ticks": True}, "tone": {"saturation": -1}, "plain": {"lang": "fr", "roads": False}},
            {"id": "detail", "kind": "map", "of": "map", "box": [60, 0, 40, 40], "view": {"lat": 0, "lon": 0, "zoom": 6}},
            {"id": "z", "kind": "zone", "of": "map", "box": [0, 0, 1, 1], "points": [[0, 0], [1, 0], [1, 1]], "mask": {"on": True},
             "onward": "2026-10-01", "until": "2026-10-05T14:30"},
            {"id": "r", "kind": "ring", "of": "map", "box": [0, 0, 1, 1], "at": [0, 0], "radii": [1, 5]},
            {"id": "c", "kind": "cone", "of": "map", "box": [0, 0, 1, 1], "at": [0, 0], "bearing": 90, "spread": 40, "reach": 2},
            {"id": "a", "kind": "arrow", "of": "map", "box": [0, 0, 1, 1], "at": [0, 0], "to": [1, 1], "shape": "offensive", "bend": 0.3},
            {"id": "logo", "kind": "image", "box": [0, 0, 10, 10], "data": "data:image/png;base64,iVBORw0KGgo="},
            {"id": "q", "kind": "qr", "box": [0, 0, 20, 20], "text": "https://example.org"},
            {"id": "n", "kind": "label", "of": "map", "box": [0, 0, 5, 5], "at": [0, 0], "style": "number", "ref": {"layer": "front", "key": "k1"}},
        ],
    }
    answer = save(client, owner, spec=spec)
    assert answer.status_code == 200, answer.text
    kept = client.get(f"/api/cases/{owner}/map-plates/Situation").json()["spec"]
    zone = next(element for element in kept["elements"] if element["id"] == "z")
    assert zone["onward"] == "2026-10-01" and zone["until"] == "2026-10-05T14:30"
    assert kept["page"]["size"] == [300, 160]
    assert mapplates.paper_mm(kept["page"]) == (300, 160)


def test_a_plate_that_listed_its_days_reads_as_the_period_they_span(client, owner):
    """Annotations saved with a list of days come back with a first and a last day, and save again."""
    save(client, owner)
    path = Case.open(owner).resolve_inside(".mapplates/Situation.json")
    saved = json.loads(path.read_text(encoding="utf-8"))
    saved["spec"]["elements"] += [
        {"id": "one", "kind": "text", "box": [0, 0, 5, 5], "days": ["2026-10-03"]},
        {"id": "run", "kind": "text", "box": [0, 0, 5, 5], "days": ["2026-10-09", "2026-10-01"], "onward": None},
        {"id": "on", "kind": "text", "box": [0, 0, 5, 5], "days": ["2026-10-01"], "onward": "2026-10-05"},
        {"id": "now", "kind": "text", "box": [0, 0, 5, 5], "days": ["2026-10-02", "now"]},
        {"id": "all", "kind": "text", "box": [0, 0, 5, 5], "days": None, "onward": None},
    ]
    path.write_text(json.dumps(saved), encoding="utf-8")
    spec = client.get(f"/api/cases/{owner}/map-plates/Situation").json()["spec"]
    periods = {element["id"]: (element.get("onward"), element.get("until"))
               for element in spec["elements"] if element["kind"] == "text" and element["id"] != "title"}
    assert periods == {"one": ("2026-10-03", "2026-10-03"), "run": ("2026-10-01", "2026-10-09"),
                       "on": ("2026-10-01", None), "now": ("2026-10-02", None), "all": (None, None)}
    assert not any("days" in element for element in spec["elements"])
    assert save(client, owner, spec=spec, rename_from="Situation").status_code == 200


def test_events_stay_on_a_plate_for_good_unless_it_keeps_them_some_days(client, owner):
    """A plate saved while seven days was the default wrote it out: it reads as for good now."""
    assert save(client, owner, spec=plate_spec(time={"window": 3})).status_code == 200
    assert client.get(f"/api/cases/{owner}/map-plates/Situation").json()["spec"]["time"]["window"] == 3
    path = Case.open(owner).resolve_inside(".mapplates/Situation.json")
    saved = json.loads(path.read_text(encoding="utf-8"))
    saved["spec"]["time"]["window"] = 7
    path.write_text(json.dumps(saved), encoding="utf-8")
    spec = client.get(f"/api/cases/{owner}/map-plates/Situation").json()["spec"]
    assert spec["time"]["window"] is None
    assert save(client, owner, spec=spec, rename_from="Situation").status_code == 200
    assert save(client, owner, spec=plate_spec(time={"window": 400}), title="Too long").status_code == 422


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


def test_a_template_keeps_a_logo_and_the_signature_but_not_a_case_picture(client):
    spec = plate_spec()
    spec["elements"] += [
        {"id": "logo", "kind": "image", "box": [0, 0, 10, 10], "data": "data:image/png;base64,iVBORw0KGgo="},
        {"id": "badge", "kind": "image", "box": [0, 0, 10, 10], "src": mapplates.SIGNATURE},
        {"id": "photo", "kind": "image", "box": [0, 0, 10, 10], "src": "media/photo.jpg", "of": "map", "at": [44.2, 15.3]},
        {"id": "z", "kind": "zone", "of": "map", "box": [0, 0, 1, 1], "points": [[0, 0], [1, 0], [1, 1]]},
        {"id": "signed", "kind": "signature", "box": [0, 0, 40, 8], "text": "{handle}"},
        {"id": "made", "kind": "brand", "box": [0, 0, 40, 4], "text": "Made with"},
    ]
    data = mapplates.template_of(spec)
    by_id = {element["id"]: element for element in data["elements"]}
    assert by_id["logo"]["data"].startswith("data:image/png")
    assert by_id["badge"]["src"] == mapplates.SIGNATURE
    assert "src" not in by_id["photo"]
    # a picture pointing at the ground keeps its frame, never the place it pointed at
    assert "at" not in by_id["photo"]
    assert "z" not in by_id
    # the signature and the mark are the layout's, so a template keeps them
    assert by_id["signed"]["kind"] == "signature" and by_id["made"]["kind"] == "brand"
    assert client.post("/api/templates/map", json={"name": "With a logo", "data": data}).status_code == 200


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


def test_a_png_keeps_its_paper_see_through_when_asked(client, owner):
    buf = io.BytesIO()
    Image.new("RGBA", (40, 30), (0, 0, 0, 0)).save(buf, "PNG")
    answer = export(client, owner, "png", [buf.getvalue()], transparent="true")
    assert answer.status_code == 200, answer.text
    from pathlib import Path

    written = Image.open(Path(answer.json()["path"]) / answer.json()["file"])
    assert written.mode == "RGBA" and written.getpixel((0, 0))[3] == 0
    flat = export(client, owner, "png", [buf.getvalue()], filename="Flat")
    assert Image.open(Path(flat.json()["path"]) / flat.json()["file"]).mode == "RGB"


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


# -- steps and their videos ------------------------------------------------------------


def stepped_spec(**element):
    spec = plate_spec()
    spec["steps"] = {"now": [{"id": "s1", "name": "Strike", "duration": 4}, {"id": "s2"}]}
    spec["time"] = {"step": "s1"}
    spec["elements"].append({"id": "clip", "kind": "video", "box": [20, 30, 80, 45], "step": "s1", "src": "media/strike.mp4",
                             "clip": [12.5, 21], "sound": True, "volume": 0.8, "caption": True, "text": "@poster · x.com",
                             "of": "map", "at": [2.3, 48.86], **element})
    return spec


def test_a_day_keeps_its_steps_and_the_videos_on_them(client, owner):
    saved = save(client, owner, spec=stepped_spec())
    assert saved.status_code == 200, saved.text
    loaded = client.get(f"/api/cases/{owner}/map-plates/Situation").json()["spec"]
    assert [step["id"] for step in loaded["steps"]["now"]] == ["s1", "s2"]
    assert loaded["steps"]["now"][1]["duration"] == 3
    assert loaded["time"]["step"] == "s1"
    clip = next(element for element in loaded["elements"] if element["id"] == "clip")
    assert (clip["clip"], clip["sound"], clip["caption"], clip["carry"]) == ([12.5, 21], True, True, False)


@pytest.mark.parametrize("element", [
    {"step": None},
    {"step": "elsewhere"},
    {"clip": [21, 12.5]},
    {"clip": [0, 700]},
    {"src": "../outside.mp4"},
])
def test_a_video_off_its_step_or_running_backward_is_refused(client, owner, element):
    assert save(client, owner, spec=stepped_spec(**element)).status_code == 422


def test_two_steps_never_share_an_id(client, owner):
    spec = stepped_spec()
    spec["steps"]["2026-10-15"] = [{"id": "s1"}]
    assert save(client, owner, spec=spec).status_code == 422


def test_a_template_leaves_the_steps_and_what_stands_on_them(client):
    spec = stepped_spec()
    spec["elements"].append({"id": "note", "kind": "text", "box": [0, 0, 20, 5], "text": "Step two", "step": "s2", "carry": True})
    data = mapplates.template_of(spec)
    assert "steps" not in data
    assert {element["id"] for element in data["elements"]} == {"map", "legend", "title"}
    assert client.post("/api/templates/map", json={"name": "Clean", "data": data}).status_code == 200
    assert client.post("/api/templates/map", json={"name": "Stepped", "data": {**data, "steps": {"now": [{"id": "s1"}]}}}).status_code == 422


def test_a_beat_runs_its_clips_in_their_boxes_with_the_sound_asked_for(tmp_path):
    loud = mapplates.ClipOut(src="media/a.mp4", start=2, end=7, box=(100, 50, 320, 180), sound=True, volume=0.5)
    quiet = mapplates.ClipOut(src="media/b.mp4", start=0, end=3, box=(500, 50, 200, 200), fit="cover")
    command = mapplates.beat_command("ffmpeg", tmp_path / "f.png", 5, [(loud, tmp_path / "a.mp4", True), (quiet, tmp_path / "b.mp4", False)],
                                     tmp_path / "o.png", tmp_path / "beat.mp4")
    graph = command[command.index("-filter_complex") + 1]
    # each clip is seeked and cut to its part
    at = command.index(str(tmp_path / "a.mp4"))
    assert command[at - 5:at] == ["-ss", "2.000", "-t", "5.000", "-i"]
    assert "scale=320:180:force_original_aspect_ratio=decrease" in graph
    assert "overlay=x=100+(320-w)/2:y=50+(180-h)/2" in graph
    assert "force_original_aspect_ratio=increase,crop=200:200" in graph
    # what stands over the clips is laid last, on the whole frame
    assert "[b2][4:v]overlay=0:0[b3]" in graph
    # only the clip asked to sound is heard, padded to the beat
    assert "[2:a]volume=0.50" in graph and "[3:a]" not in graph and "apad=whole_dur=5.000[a]" in graph
    assert command[command.index("-map", command.index("[v]") - 2) + 1:][:3] == ["[v]", "-map", "[a]"]
    silent = mapplates.beat_command("ffmpeg", tmp_path / "f.png", 2, [], None, tmp_path / "s.mp4")
    assert "1:a" in silent and "[b0]format=yuv420p[v]" in silent[silent.index("-filter_complex") + 1]


@pytest.mark.parametrize(("raw", "frames", "overs"), [
    ("[{\"seconds\": 2}]", 2, 0),
    ("[{\"seconds\": 2, \"over\": 1}]", 1, 1),
    (json.dumps([{"seconds": 600}] * 4), 4, 0),
    ("{\"seconds\": 2}", 1, 0),
    ("[{\"seconds\": 2, \"clips\": [{\"src\": \"m.mp4\", \"start\": 4, \"end\": 2, \"box\": [0, 0, 10, 10]}]}]", 1, 0),
])
def test_a_sequence_that_does_not_hold_is_refused(raw, frames, overs):
    with pytest.raises(mapplates.ExportError):
        mapplates.read_beats(raw, frames, overs)


def test_a_played_gif_holds_each_beat_its_own_time(client, owner):
    beats = json.dumps([{"seconds": 1}, {"seconds": 2.5}])
    answer = export(client, owner, "gif", [png(colour=(200, 0, 0)), png(colour=(0, 0, 200))], beats=beats)
    assert answer.status_code == 200, answer.text
    from pathlib import Path

    with Image.open(Path(answer.json()["path"]) / answer.json()["file"]) as gif:
        held = []
        for index in range(gif.n_frames):
            gif.seek(index)
            held.append(gif.info["duration"])
    # the last is held three times, as a played GIF always holds it
    assert held == [1000, 7500]


def test_a_clip_must_be_a_video_of_the_case(client, owner):
    root = Case.open(owner).tool_root
    (root / "media").mkdir(parents=True, exist_ok=True)
    (root / "media" / "notes.txt").write_text("not a video")

    def sent(src):
        beats = json.dumps([{"seconds": 1, "clips": [{"src": src, "start": 0, "end": 1, "box": [0, 0, 40, 30]}]}])
        return export(client, owner, "mp4", [png()], beats=beats)

    for src in ("../../elsewhere.mp4", "media/notes.txt", "media/gone.mp4"):
        answer = sent(src)
        assert answer.status_code == 422, src


@pytest.mark.skipif(not ffmpeg.ffmpeg_available(), reason="no ffmpeg on this machine")
def test_a_played_plate_runs_its_steps_clips_with_their_sound(client, owner):
    import subprocess
    from pathlib import Path

    root = Case.open(owner).tool_root
    (root / "media").mkdir(parents=True, exist_ok=True)
    source = root / "media" / "strike.mp4"
    subprocess.run([ffmpeg.ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=15:duration=3",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    str(source)], check=True, timeout=60)
    over = io.BytesIO()
    Image.new("RGBA", (320, 240), (0, 0, 0, 0)).save(over, "PNG")
    beats = json.dumps([{"seconds": 0.5}, {"seconds": 1.5, "over": 0, "clips": [
        {"src": "media/strike.mp4", "start": 1, "end": 2.5, "box": [40, 30, 160, 120], "sound": True}]}])
    files = [("frames", ("0.png", io.BytesIO(png((320, 240))), "image/png")), ("frames", ("1.png", io.BytesIO(png((320, 240), (0, 0, 0))), "image/png")),
             ("overs", ("o.png", io.BytesIO(over.getvalue()), "image/png"))]
    answer = client.post(f"/api/cases/{owner}/map-plates/export", files=files, data={"format": "mp4", "filename": "Sequence", "beats": beats})
    assert answer.status_code == 200, answer.text
    written = Path(answer.json()["path"]) / answer.json()["file"]
    probe = subprocess.run([ffmpeg.ffprobe_exe(), "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(written)],
                           check=True, capture_output=True, text=True, timeout=60)
    read = json.loads(probe.stdout)
    assert sorted(stream["codec_type"] for stream in read["streams"]) == ["audio", "video"]
    assert 1.8 <= float(read["format"]["duration"]) <= 2.4


# -- words, lines, framing and transitions -----------------------------------------------


def test_words_on_the_ground_keep_their_look_and_older_plates_stay_bold(client, owner):
    spec = plate_spec()
    spec["elements"] += [
        {"id": "z", "kind": "zone", "of": "map", "box": [0, 0, 1, 1], "points": [[0, 0], [1, 0], [1, 1]], "text": "Depot",
         "size": 9, "weight": 600, "ink": "#112233", "back": "box", "fill": "#ffeedd", "upper": True},
        {"id": "l", "kind": "line", "of": "map", "box": [0, 0, 1, 1], "points": [[0, 0], [0.5, 0.2], [1, 1]], "shape": "curve",
         "heads": "end", "text": "Road"},
    ]
    assert save(client, owner, spec=spec).status_code == 200
    kept = {element["id"]: element for element in client.get(f"/api/cases/{owner}/map-plates/Situation").json()["spec"]["elements"]}
    assert (kept["z"]["weight"], kept["z"]["ink"], kept["z"]["back"], kept["z"]["fill"]) == (600, "#112233", "box", "#ffeedd")
    assert kept["l"]["shape"] == "curve" and len(kept["l"]["points"]) == 3
    # a plate saved before words on the ground had a look wrote them all regular, which they never were
    path = Case.open(owner).resolve_inside(".mapplates/Situation.json")
    saved = json.loads(path.read_text(encoding="utf-8"))
    for element in saved["spec"]["elements"]:
        element.pop("back", None)
        element["weight"] = 400
    path.write_text(json.dumps(saved), encoding="utf-8")
    read = {element["id"]: element for element in client.get(f"/api/cases/{owner}/map-plates/Situation").json()["spec"]["elements"]}
    assert "weight" not in read["z"] and "weight" not in read["l"]
    # words written on the page keep the weight they were saved with
    assert read["title"]["weight"] == 400


def test_a_map_saved_without_saying_keeps_its_frame(client, owner):
    """A map is framed unless the analyst unticks it: a plate opened again draws it as it was."""
    assert save(client, owner).status_code == 200
    elements = {element["id"]: element for element in client.get(f"/api/cases/{owner}/map-plates/Situation").json()["spec"]["elements"]}
    assert elements["map"]["border"] is None and elements["title"]["border"] is None


@pytest.mark.parametrize("element", [
    {"id": "l", "kind": "line", "of": "map", "box": [0, 0, 1, 1], "points": [[0, 0]]},
    {"id": "l", "kind": "line", "box": [0, 0, 1, 1], "points": [[0, 0], [1, 1]]},
    {"id": "t", "kind": "text", "box": [0, 0, 10, 10], "back": "glow"},
    {"id": "t", "kind": "text", "box": [0, 0, 10, 10], "ink": "red"},
])
def test_a_line_or_a_look_that_does_not_hold_is_refused(client, owner, element):
    spec = {"elements": [{"id": "map", "kind": "map", "box": [0, 0, 100, 100], "view": {"lat": 0, "lon": 0, "zoom": 3}}, element]}
    assert save(client, owner, spec=spec).status_code == 422


def test_a_symbol_stands_on_its_point_and_is_one_of_the_layers_markers(client, owner):
    spec = plate_spec()
    spec["elements"].append({"id": "s", "kind": "symbol", "of": "map", "box": [40, 40, 8, 8], "at": [2.35, 48.85],
                             "symbol": "badge-tank", "colour": "#c8102e", "status": "destroyed", "rotate": 30})
    assert save(client, owner, spec=spec).status_code == 200
    kept = {element["id"]: element for element in client.get(f"/api/cases/{owner}/map-plates/Situation").json()["spec"]["elements"]}
    assert (kept["s"]["symbol"], kept["s"]["status"], kept["s"]["at"], kept["s"]["rotate"]) == ("badge-tank", "destroyed", [2.35, 48.85], 30)
    # without its point, its map, or with a marker that is no id, it does not hold
    for broken in ({"at": None}, {"of": None}, {"symbol": "../tank"}, {"status": "burnt"}):
        bad = plate_spec()
        bad["elements"].append({**kept["s"], **broken})
        assert save(client, owner, spec=bad).status_code == 422, broken
    # a template keeps no ground, so no symbol
    data = mapplates.template_of({**plate_spec(), "elements": [*plate_spec()["elements"], kept["s"]]})
    assert "symbol" not in [element["kind"] for element in data["elements"]]
    leaking = {**data, "elements": [*data["elements"], kept["s"]]}
    assert client.post("/api/templates/map", json={"name": "Symbols", "data": leaking}).status_code == 422
    assert client.post("/api/templates/map", json={"name": "Symbols", "data": data}).status_code == 200


def test_a_day_or_a_step_frames_its_maps_its_own_way(client, owner):
    spec = stepped_spec()
    spec["framing"] = {"2026-10-12": {"map": {"lat": 48.9, "lon": 2.3, "zoom": 13, "bearing": 0}},
                       "s2": {"map": {"lat": 48.8, "lon": 2.2, "zoom": 14, "bearing": 30, "pitch": 55}}}
    spec["transitions"] = {"on": True, "seconds": 1.2, "appear": "draw"}
    spec["steps"]["now"][1]["transition"] = "none"
    assert save(client, owner, spec=spec).status_code == 200
    loaded = client.get(f"/api/cases/{owner}/map-plates/Situation").json()["spec"]
    assert loaded["framing"]["s2"]["map"]["pitch"] == 55
    assert loaded["transitions"] == {"on": True, "seconds": 1.2, "fade": True, "move": True, "blur": True, "appear": "draw"}
    assert loaded["steps"]["now"][1]["transition"] == "none"
    for framing in ({"s9": {"map": {"lat": 0, "lon": 0, "zoom": 3}}}, {"now": {"nowhere": {"lat": 0, "lon": 0, "zoom": 3}}},
                    {"now": {"map": {"lat": 0, "lon": 0, "zoom": 3, "pitch": 90}}}):
        assert save(client, owner, spec={**spec, "framing": framing}).status_code == 422
    # a template keeps how the video moves, never how a day of a case is framed
    data = mapplates.template_of(loaded)
    assert data["transitions"]["on"] is True and "framing" not in data
    assert client.post("/api/templates/map", json={"name": "Framed", "data": {**data, "framing": {"now": {}}}}).status_code == 422


def test_a_3d_map_keeps_its_tilt_its_heights_and_its_ridges(client, owner):
    spec = plate_spec()
    spec["elements"][0].update({"view": {"lat": 45.8, "lon": 6.8, "zoom": 12, "bearing": 40, "pitch": 60}, "terrain": 1.5, "ridges": True,
                                "basemap": "plain-topo", "plain": {"contours": False, "peaks": True, "rails": False},
                                "overlays": ["relief", "railway", "power", "seamarks"]})
    assert save(client, owner, spec=spec).status_code == 200
    map_ = client.get(f"/api/cases/{owner}/map-plates/Situation").json()["spec"]["elements"][0]
    assert (map_["view"]["pitch"], map_["terrain"], map_["ridges"]) == (60, 1.5, True)
    assert (map_["plain"]["contours"], map_["plain"]["tints"], map_["plain"]["rails"], map_["plain"]["roads"]) == (False, True, False, True)
    assert map_["overlays"] == ["relief", "railway", "power", "seamarks"]


def test_a_transition_plays_its_frames_before_its_beat_holds(tmp_path):
    command = mapplates.tween_command("ffmpeg", tmp_path / "t%04d.png", 3, 24, tmp_path / "w.mp4")
    at = command.index(str(tmp_path / "t%04d.png"))
    # twenty-four frames at the video's own thirty a second: counted on the way in, never on the way out
    assert command[at - 7:at] == ["-framerate", str(mapplates.TWEEN_FPS), "-start_number", "3", "-t", "0.800", "-i"]
    assert "-frames:v" not in command
    # encoded as a beat is, so the two join as they are
    assert command[command.index("-r") + 1] == str(mapplates.VIDEO_FPS) and "aac" in command
    assert mapplates.TWEEN_FPS == mapplates.VIDEO_FPS
    beats = mapplates.read_beats(json.dumps([{"seconds": 1}, {"seconds": 1, "tween": [0, 16]}]), 2, 0, 16)
    assert beats[1].tween == (0, 16)
    with pytest.raises(mapplates.ExportError):
        mapplates.read_beats(json.dumps([{"seconds": 1}, {"seconds": 1, "tween": [8, 16]}]), 2, 0, 16)


def test_only_a_video_plays_transitions(client, owner):
    files = [("frames", ("0.png", io.BytesIO(png()), "image/png")), ("frames", ("1.png", io.BytesIO(png()), "image/png")),
             ("tweens", ("t.jpg", io.BytesIO(png(fmt="JPEG")), "image/jpeg"))]
    beats = json.dumps([{"seconds": 1}, {"seconds": 1, "tween": [0, 1]}])
    answer = client.post(f"/api/cases/{owner}/map-plates/export", files=files, data={"format": "gif", "filename": "G", "beats": beats})
    assert answer.status_code == 422


@pytest.mark.skipif(not ffmpeg.ffmpeg_available(), reason="no ffmpeg on this machine")
def test_a_played_plate_opens_its_beats_on_their_transitions(client, owner):
    import subprocess
    from pathlib import Path

    tweens = [("tweens", (f"t{index}.jpg", io.BytesIO(png((320, 240), (index * 15, 0, 0), fmt="JPEG")), "image/jpeg")) for index in range(15)]
    files = [("frames", ("0.png", io.BytesIO(png((320, 240))), "image/png")), ("frames", ("1.png", io.BytesIO(png((320, 240), (0, 0, 0))), "image/png")),
             *tweens]
    beats = json.dumps([{"seconds": 0.5}, {"seconds": 1, "tween": [0, 15]}])
    answer = client.post(f"/api/cases/{owner}/map-plates/export", files=files, data={"format": "mp4", "filename": "Moving", "beats": beats})
    assert answer.status_code == 200, answer.text
    written = Path(answer.json()["path"]) / answer.json()["file"]
    probe = subprocess.run([ffmpeg.ffprobe_exe(), "-v", "error", "-show_entries", "format=duration", "-of", "json", str(written)],
                           check=True, capture_output=True, text=True, timeout=60)
    # half a second, half a second of transition at 30 frames a second, then one second held
    assert 1.9 <= float(json.loads(probe.stdout)["format"]["duration"]) <= 2.15


def test_each_day_holds_its_own_seconds_or_the_plate_s(client, owner):
    spec = plate_spec(time={"hold": 2.5}, holds={"2026-10-14": 6, "now": 0.5})
    saved = save(client, owner, spec=spec)
    assert saved.status_code == 200, saved.text
    loaded = client.get(f"/api/cases/{owner}/map-plates/Situation").json()["spec"]
    assert loaded["time"]["hold"] == 2.5
    assert loaded["holds"] == {"2026-10-14": 6, "now": 0.5}
    for holds in ({"yesterday": 2}, {"2026-10-14": 0.1}, {"2026-10-14": 500}):
        assert save(client, owner, spec=plate_spec(holds=holds)).status_code == 422
    # a template keeps the plate's time, never a day's own
    data = mapplates.template_of(spec)
    assert "holds" not in data and data["time"] == {"hold": 2.5}
    assert client.post("/api/templates/map", json={"name": "Held", "data": data}).status_code == 200
    assert client.post("/api/templates/map", json={"name": "Held", "data": {**data, "holds": {"now": 3}}}).status_code == 422


def test_a_plate_draws_a_bounded_number_of_maps(client, owner):
    maps = [{"id": f"m{index}", "kind": "map", "box": [0, 0, 10, 10], "view": {"lat": 0, "lon": 0, "zoom": 3}} for index in range(mapplates.MAX_MAPS)]
    assert save(client, owner, spec={"elements": maps}).status_code == 200
    one_more = {"id": "inset", "kind": "inset", "box": [0, 0, 10, 10], "of": "m0"}
    assert save(client, owner, spec={"elements": [*maps, one_more]}).status_code == 422


def test_a_video_frame_is_kept_on_disk_at_the_sequence_s_size_its_sides_even(tmp_path):
    big = Image.new("RGB", (803, 601), (10, 20, 30))
    mapplates.keep_frame(big, (401, 301), tmp_path / "f0000.png")
    with Image.open(tmp_path / "f0000.png") as kept:
        assert kept.size == (400, 300)
    frame = mapplates.gif_frame(big, (401, 301))
    assert (frame.mode, frame.size) == ("P", (401, 301))
