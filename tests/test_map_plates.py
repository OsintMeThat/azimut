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
    assert loaded["spec"]["time"] == {"at": None, "step": None, "trail": True, "since": None, "window": 7}
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
