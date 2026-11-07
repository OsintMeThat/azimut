"""The scenes of a video: the stretches Inspect keeps, and the proofs read back to them.

A long video holds several geolocations. The analyst marks the stretches in Inspect,
and each one a proof argues joins the same list, read off the frames it was built
from, so proofs made before scenes existed are found without being rewritten.
"""

from __future__ import annotations

import io
import json
import subprocess

import graph_read
import pytest
from PIL import Image

from azimut import layout
from azimut.engine import media as media_engine
from azimut.engine import scenes as scenes_engine
from azimut.workspace import Case

needs_ffmpeg = pytest.mark.skipif(not media_engine.ffmpeg_available(), reason="ffmpeg not installed")


def _case(client, name="Scenes") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _png(color=(120, 60, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (80, 60), color).save(buf, "PNG")
    return buf.getvalue()


def _upload_png(client, cid, name="photo.png") -> str:
    res = client.post(
        f"/api/cases/{cid}/media/upload", files={"file": (name, io.BytesIO(_png()), "image/png")}
    )
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _video(client, cid, tmp_path, name="clip.mp4", pattern="testsrc") -> str:
    """A real four-second clip whose every frame differs, so no two cuts are one picture."""
    path = tmp_path / name
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"{pattern}=s=64x48:r=10:d=4",
         "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    with path.open("rb") as fh:
        res = client.post(f"/api/cases/{cid}/media/upload", files={"file": (name, fh, "video/mp4")})
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _cut(client, cid, video, time) -> str:
    res = client.post(
        f"/api/cases/{cid}/inspect/save-frames", json={"items": [{"path": video, "time": time}]}
    )
    assert res.status_code == 200, res.text
    return res.json()["saved"][0]["item"]["path"]


def _proof(client, cid, title, *srcs, coords=None, **extra):
    spec = {"panels": [{"id": f"p{i}", "src": s} for i, s in enumerate(srcs)], **extra}
    if coords:
        spec["coordsText"] = coords
    res = client.post(f"/api/cases/{cid}/proofs", json={"title": title, "spec": spec})
    assert res.status_code == 200, res.text
    return res.json()


def _save_work(client, cid, path, **spec):
    return client.put(
        f"/api/cases/{cid}/inspect/work", json={"path": path, "spec": {"frames": [], **spec}}
    )


def _work(client, cid, path):
    return client.get(f"/api/cases/{cid}/inspect/work", params={"path": path}).json()["work"]


def _scenes(client, cid, video):
    res = client.get(f"/api/cases/{cid}/scenes", params={"video": video})
    assert res.status_code == 200, res.text
    return res.json()


# -- the stretches Inspect keeps ------------------------------------------------


def test_scenes_round_trip_sorted_and_counted(client):
    cid = _case(client)
    photo = _upload_png(client, cid)
    scenes = [
        {"id": "s2", "start": 30, "end": 41.5, "label": "  Bridge  "},
        {"id": "s1", "start": 4, "end": 9, "label": "Roundabout"},
    ]
    assert _save_work(client, cid, photo, scenes=scenes).status_code == 200

    stored = _work(client, cid, photo)["spec"]["scenes"]
    assert stored == [
        {"id": "s1", "start": 4.0, "end": 9.0, "label": "Roundabout"},
        {"id": "s2", "start": 30.0, "end": 41.5, "label": "Bridge"},
    ]
    row = next(w for w in client.get(f"/api/cases/{cid}/inspect/works").json())
    assert row["scenes"] == 2


def test_a_scene_is_an_instant_until_it_has_an_end(client):
    cid = _case(client)
    photo = _upload_png(client, cid)
    _save_work(client, cid, photo, scenes=[
        {"id": "s2", "start": 12, "end": 20, "label": ""},
        {"id": "s1", "start": 12, "label": "flash"},
        {"id": "s0", "start": 3, "end": None},
    ])
    stored = _work(client, cid, photo)["spec"]["scenes"]
    assert [(s["id"], s["start"], s["end"]) for s in stored] == [
        ("s0", 3.0, None), ("s1", 12.0, None), ("s2", 12.0, 20.0),
    ]


def test_a_scene_with_no_time_is_about_the_whole_video_and_comes_first(client):
    cid = _case(client)
    photo = _upload_png(client, cid)
    _save_work(client, cid, photo, scenes=[
        {"id": "s1", "start": 4, "end": None, "label": ""},
        {"id": "s0", "start": None, "end": None, "label": "somewhere on the road"},
        {"id": "s2", "label": "no keys at all"},
    ])
    stored = _work(client, cid, photo)["spec"]["scenes"]
    assert [(s["id"], s["start"], s["end"]) for s in stored] == [
        ("s0", None, None), ("s2", None, None), ("s1", 4.0, None),
    ]


def test_a_work_saved_without_scenes_stores_none(client):
    cid = _case(client)
    photo = _upload_png(client, cid)
    _save_work(client, cid, photo, marks=[{"id": "m1", "time": 1, "label": ""}])
    assert _work(client, cid, photo)["spec"]["scenes"] == []


@pytest.mark.parametrize("scenes", [
    "not a list",
    [{"start": 1, "end": 2}],
    [{"id": "s1", "start": 2, "end": 2}],
    [{"id": "s1", "start": 5, "end": 1}],
    [{"id": "s1", "start": -1, "end": 1}],
    [{"id": "s1", "end": 1}],
    [{"id": "s1", "start": 1, "end": "soon"}],
    [{"id": "s1", "start": True, "end": 3}],
    [{"id": "s1", "start": 1, "end": 2, "label": 7}],
    [{"id": "s1", "start": 1, "end": 2}, {"id": "s1", "start": 3, "end": 4}],
])
def test_a_bad_scene_is_refused(client, scenes):
    cid = _case(client)
    photo = _upload_png(client, cid)
    assert _save_work(client, cid, photo, scenes=scenes).status_code == 400


def test_scenes_are_bounded_and_labels_cut(client):
    cid = _case(client)
    photo = _upload_png(client, cid)
    too_many = [{"id": f"s{i}", "start": i, "end": i + 1} for i in range(201)]
    assert _save_work(client, cid, photo, scenes=too_many).status_code == 400

    _save_work(client, cid, photo, scenes=[{"id": "s1", "start": 1, "end": 2, "label": "x" * 500}])
    assert len(_work(client, cid, photo)["spec"]["scenes"][0]["label"]) == 200


def test_restoring_a_cleared_work_unions_the_scenes(client):
    cid = _case(client)
    photo = _upload_png(client, cid)
    _save_work(client, cid, photo, scenes=[{"id": "s_old", "start": 50, "end": 60, "label": "old"}])
    cleared = client.delete(f"/api/cases/{cid}/inspect/work", params={"path": photo}).json()
    _save_work(client, cid, photo, scenes=[{"id": "s_new", "start": 1, "end": 5, "label": "new"}])

    client.post(f"/api/cases/{cid}/trash/{cleared['trash']}/restore")

    scenes = _work(client, cid, photo)["spec"]["scenes"]
    assert [s["id"] for s in scenes] == ["s_new", "s_old"]


# -- the scenes of a video --------------------------------------------------------


@needs_ffmpeg
def test_a_proof_built_on_a_frame_joins_its_video_with_nothing_written(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    frame = _cut(client, cid, video, 1.5)
    _proof(client, cid, "Roundabout", frame, coords="48.51203, 35.04122")
    spec_path = Case.open(cid).resolve_inside(layout.proof_spec_rel("Roundabout"))
    before = spec_path.read_bytes()

    listed = _scenes(client, cid, video)

    assert listed["video"] == video
    assert listed["video_id"] == Case.open(cid).find_entity(attr="path", value=video)["id"]
    [scene] = listed["scenes"]
    assert scene["kind"] == "proof"
    assert scene["proof"] == "Roundabout"
    assert scene["title"] == "Roundabout"
    assert scene["proof_id"] == Case.open(cid).find_entity(
        attr="spec", value=layout.proof_spec_rel("Roundabout")
    )["id"]
    # traced off the frame: the instant it was cut at, and no moment nobody gave
    assert scene["stated"] is False
    assert scene["moments"] == []
    assert "start" not in scene and "end" not in scene
    assert scene["at"] == [pytest.approx(1.5, abs=0.11)]
    # the point carries the place the save filed, for a reader citing it by id
    [point] = scene["points"]
    assert (point["lat"], point["lon"]) == (48.51203, 35.04122)
    place = Case.open(cid).get_entity(point["place_id"])
    assert place["type"] == "place"
    # reading is reading: the proof on disk is byte for byte what the save wrote
    assert spec_path.read_bytes() == before


@needs_ffmpeg
def test_the_first_panel_cut_from_a_video_names_the_proofs_video(client, tmp_path):
    cid = _case(client)
    first = _video(client, cid, tmp_path, "first.mp4")
    second = _video(client, cid, tmp_path, "second.mp4", pattern="testsrc2")
    photo = _upload_png(client, cid)
    # a photo leads, then a frame of the first clip, then one of the second:
    # the second clip only confirms, so the proof is the first clip's scene
    _proof(client, cid, "Depot", photo, _cut(client, cid, first, 2.0), _cut(client, cid, second, 0.5))

    assert [s["proof"] for s in _scenes(client, cid, first)["scenes"]] == ["Depot"]
    assert _scenes(client, cid, second)["scenes"] == []


@needs_ffmpeg
def test_a_proof_on_no_video_is_no_scene(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Photo only", _upload_png(client, cid))
    assert _scenes(client, cid, video)["scenes"] == []


@needs_ffmpeg
def test_scenes_come_in_the_order_of_the_clip(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Late", _cut(client, cid, video, 3.0))
    _proof(client, cid, "Early", _cut(client, cid, video, 0.5))
    _save_work(client, cid, video, scenes=[
        {"id": "s_mid", "start": 1.8, "end": 2.4, "label": "Bridge?"},
        {"id": "s_flash", "start": 2.8, "label": ""},
        {"id": "s_all", "start": None, "end": None, "label": "Which city?"},
    ])

    scenes = _scenes(client, cid, video)["scenes"]

    # a scene about the whole video first, then the clip's order: a proof with no
    # moment of its own sits at the first frame it was built on
    assert [s.get("proof") or s.get("id") for s in scenes] == ["s_all", "Early", "s_mid", "s_flash", "Late"]
    assert scenes[0] == {
        "kind": "draft", "video": video, "id": "s_all", "start": None, "end": None, "label": "Which city?",
        "state": "todo", "captures": [], "abandoned": None, "file_kind": "video",
    }
    draft = scenes[2]
    assert draft == {
        "kind": "draft", "video": video, "id": "s_mid", "start": 1.8, "end": 2.4, "label": "Bridge?",
        "state": "todo", "captures": [], "abandoned": None, "file_kind": "video",
    }


@needs_ffmpeg
def test_a_stated_scene_takes_up_its_draft(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _save_work(client, cid, video, scenes=[
        {"id": "s1", "start": 0.2, "end": 1.0, "label": "Roundabout?"},
        {"id": "s2", "start": 2.0, "end": 3.5, "label": "Bridge?"},
    ])
    _proof(
        client, cid, "Bridge", _cut(client, cid, video, 2.5),
        scene={"video": video, "moments": [{"start": 2.1, "end": 3.4}], "draft": "s2"},
    )

    scenes = _scenes(client, cid, video)["scenes"]

    # the proof's own moment is the one said, and the draft it came from is gone
    assert [(s["kind"], s.get("id") or s.get("proof")) for s in scenes] == [
        ("draft", "s1"), ("proof", "Bridge"),
    ]
    assert scenes[1]["stated"] is True
    assert scenes[1]["moments"] == [{"start": 2.1, "end": 3.4}]
    # the work itself is untouched: a proof never writes into Inspect
    assert [s["id"] for s in _work(client, cid, video)["spec"]["scenes"]] == ["s1", "s2"]


@needs_ffmpeg
def test_a_proof_comes_back_in_several_moments_of_its_clip(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Crossroads", _cut(client, cid, video, 1.0), scene={"video": video, "moments": [
        {"start": 3.1, "end": 3.6}, {"start": 1.4}, {"start": 0.3, "end": 0.9},
    ]})
    [scene] = _scenes(client, cid, video)["scenes"]
    assert scene["stated"] is True
    # in clip order, each an instant or a passage
    assert scene["moments"] == [
        {"start": 0.3, "end": 0.9}, {"start": 1.4, "end": None}, {"start": 3.1, "end": 3.6},
    ]


def test_the_shape_before_moments_reads_as_one():
    """A proof given one start and end before moments existed is that one moment."""
    read = scenes_engine.read_scene({"video": "media/clip.mp4", "start": 2.0, "end": 5.0, "draft": "s1"})
    assert read == {"video": "media/clip.mp4", "moments": [{"start": 2.0, "end": 5.0}], "draft": "s1"}
    assert scenes_engine.read_scene({"video": "media/clip.mp4", "start": 1.4})["moments"] == [
        {"start": 1.4, "end": None},
    ]


@pytest.mark.parametrize("stated", [
    {"start": None, "end": 2.0},
    {"start": 3.0, "end": 2.0},
    {"start": 2.0, "end": "soon"},
    {"start": -1, "end": None},
    {"moments": [{"end": 2.0}, {"start": 3.0, "end": 2.0}, "soon", {"start": True}]},
])
def test_a_broken_moment_reads_as_none(stated):
    read = scenes_engine.read_scene({"video": "media/clip.mp4", **stated})
    assert read["moments"] == []
    assert scenes_engine.read_scene({"start": 1.0}) is None


@needs_ffmpeg
def test_a_renamed_video_keeps_its_scenes(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Roundabout", _cut(client, cid, video, 1.0))

    res = client.patch(f"/api/cases/{cid}/media", json={"path": video, "title": "convoy"})
    assert res.status_code == 200, res.text
    renamed = res.json()["path"]
    assert renamed != video

    # the frame's own record still names the old path; the graph followed the rename
    assert [s["proof"] for s in _scenes(client, cid, renamed)["scenes"]] == ["Roundabout"]


@needs_ffmpeg
def test_only_a_file_in_the_case_has_scenes_and_a_picture_none_until_marked(client, tmp_path):
    cid = _case(client)
    photo = _upload_png(client, cid)
    # a picture answers with what was marked in it, nothing yet (`test_geolocate.py`)
    assert client.get(f"/api/cases/{cid}/scenes", params={"video": photo}).json()["scenes"] == []
    assert client.get(
        f"/api/cases/{cid}/scenes", params={"video": "media/nothing.mp4"}
    ).status_code == 400


@needs_ffmpeg
def test_an_unreadable_proof_is_skipped_not_fatal(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Roundabout", _cut(client, cid, video, 1.0))
    broken = Case.open(cid).resolve_inside(layout.proof_spec_rel("broken"))
    broken.write_text("{not json", encoding="utf-8")
    assert [s["proof"] for s in _scenes(client, cid, video)["scenes"]] == ["Roundabout"]
    assert json.loads(
        Case.open(cid).resolve_inside(layout.proof_spec_rel("Roundabout")).read_text(encoding="utf-8")
    )["azimut_proof"] == 1


# -- when in its video a proof happens ---------------------------------------------------


def _state(client, cid, name, *moments):
    """State these moments, each a start or a (start, end)."""
    body = [{"start": m[0], "end": m[1]} if isinstance(m, tuple) else {"start": m, "end": None} for m in moments]
    return client.put(f"/api/cases/{cid}/proofs/{name}/scene", json={"moments": body})


def _spec(cid, name):
    return Case.open(cid).resolve_inside(layout.proof_spec_rel(name))


@needs_ffmpeg
def test_a_proof_is_given_an_instant_then_a_period_then_its_frame_back(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Roundabout", _cut(client, cid, video, 1.5))
    before = _spec(cid, "Roundabout").read_bytes()

    res = _state(client, cid, "Roundabout", 0.8)
    assert res.status_code == 200, res.text
    assert res.json() == {
        "proof": "Roundabout", "video": video, "moments": [{"start": 0.8, "end": None}],
        "at": [pytest.approx(1.5, abs=0.11)], "stated": True, "draft": None,
    }
    [scene] = _scenes(client, cid, video)["scenes"]
    assert (scene["moments"], scene["stated"]) == ([{"start": 0.8, "end": None}], True)

    # the same place again later in the clip: a second moment, kept in clip order
    assert _state(client, cid, "Roundabout", (3.0, 3.5), (0.8, 2.4)).status_code == 200
    [scene] = _scenes(client, cid, video)["scenes"]
    assert scene["moments"] == [{"start": 0.8, "end": 2.4}, {"start": 3.0, "end": 3.5}]
    # the scene and nothing else: every other key is what the save wrote
    written = json.loads(_spec(cid, "Roundabout").read_text(encoding="utf-8"))
    assert written.pop("scene") == {
        "video": video, "moments": [{"start": 0.8, "end": 2.4}, {"start": 3.0, "end": 3.5}], "draft": None,
    }
    assert written == json.loads(before)

    # taken back, the proof sits at its frame again and is byte for byte what it was
    res = _state(client, cid, "Roundabout")
    assert res.status_code == 200, res.text
    assert res.json()["stated"] is False
    assert _spec(cid, "Roundabout").read_bytes() == before
    [scene] = _scenes(client, cid, video)["scenes"]
    assert scene["moments"] == [] and scene["at"] == [pytest.approx(1.5, abs=0.11)]


@needs_ffmpeg
def test_a_proofs_draft_stays_when_its_time_changes_or_goes(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _save_work(client, cid, video, scenes=[{"id": "s2", "start": 2.0, "end": 3.5, "label": "Bridge?"}])
    _proof(
        client, cid, "Bridge", _cut(client, cid, video, 2.5),
        # the shape before moments, read as its one moment and written anew
        scene={"video": video, "start": 2.1, "end": 3.4, "draft": "s2"},
    )

    assert _state(client, cid, "Bridge", 2.0).status_code == 200
    assert json.loads(_spec(cid, "Bridge").read_text(encoding="utf-8"))["scene"] == {
        "video": video, "moments": [{"start": 2.0, "end": None}], "draft": "s2",
    }
    assert _state(client, cid, "Bridge").status_code == 200

    stored = json.loads(_spec(cid, "Bridge").read_text(encoding="utf-8"))["scene"]
    assert stored == {"video": video, "moments": [], "draft": "s2"}
    # still the proof's scene, so the draft it took up stays out of the list
    assert [s["kind"] for s in _scenes(client, cid, video)["scenes"]] == ["proof"]


@needs_ffmpeg
@pytest.mark.parametrize("body", [
    {},
    {"moments": "soon"},
    {"moments": ["soon"]},
    {"moments": [{"end": 2.0}]},
    {"moments": [{"start": 2.0, "end": 2.0}]},
    {"moments": [{"start": 3.0, "end": 1.0}]},
    {"moments": [{"start": -0.5}]},
    {"moments": [{"start": "soon"}]},
    {"moments": [{"start": True}]},
    {"moments": [{"start": 1.0, "end": [2]}]},
    # two passages that overlap, or one instant said twice, read as a slip
    {"moments": [{"start": 0.5, "end": 1.5}, {"start": 1.2, "end": 2.0}]},
    {"moments": [{"start": 0.5, "end": 1.5}, {"start": 0.5, "end": 0.9}]},
    {"moments": [{"start": 1.2}, {"start": 1.2, "end": None}]},
    {"moments": [{"start": i * 0.1} for i in range(21)]},
    # past the four seconds of the clip, beyond the slack a misread length is given
    {"moments": [{"start": 6.0}]},
    {"moments": [{"start": 0.2}, {"start": 1.0, "end": 9.0}]},
])
def test_a_time_that_cannot_be_the_proofs_is_refused(client, tmp_path, body):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Roundabout", _cut(client, cid, video, 1.5))
    before = _spec(cid, "Roundabout").read_bytes()

    res = client.put(f"/api/cases/{cid}/proofs/Roundabout/scene", json=body)
    assert res.status_code == 422, res.text
    assert _spec(cid, "Roundabout").read_bytes() == before


@needs_ffmpeg
def test_passages_may_touch_and_an_instant_may_sit_inside_one(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Roundabout", _cut(client, cid, video, 1.5))
    assert _state(client, cid, "Roundabout", (0.5, 1.5), (1.5, 2.0), 1.0, (2.5, 3.0), 2.5).status_code == 200


@needs_ffmpeg
def test_a_time_that_is_not_a_number_is_refused(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Roundabout", _cut(client, cid, video, 1.5))
    res = client.put(
        f"/api/cases/{cid}/proofs/Roundabout/scene",
        content=b'{"moments": [{"start": NaN}]}',
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 422
    assert "scene" not in json.loads(_spec(cid, "Roundabout").read_text(encoding="utf-8"))


def test_only_a_proof_on_a_video_has_a_time(client):
    cid = _case(client)
    _proof(client, cid, "Photo only", _upload_png(client, cid))
    assert _state(client, cid, "Photo only", 1.0).status_code == 409
    assert _state(client, cid, "Nobody", 1.0).status_code == 404
    assert "scene" not in json.loads(_spec(cid, "Photo only").read_text(encoding="utf-8"))


@needs_ffmpeg
def test_the_composer_saving_a_proof_keeps_its_time(client, tmp_path):
    """Geo Proof writes the whole composition and never the scene: the time stays."""
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    frame = _cut(client, cid, video, 1.5)
    _proof(client, cid, "Roundabout", frame)
    _state(client, cid, "Roundabout", (0.8, 2.4))

    opened = client.get(f"/api/cases/{cid}/proofs/Roundabout").json()
    composed = {key: value for key, value in opened.items() if key != "scene"}
    composed["description"] = "Seen from the north"
    res = client.post(
        f"/api/cases/{cid}/proofs",
        json={"rename_from": "Roundabout", "title": "Roundabout", "spec": composed},
    )
    assert res.status_code == 200, res.text

    [scene] = _scenes(client, cid, video)["scenes"]
    assert (scene["moments"], scene["description"]) == ([{"start": 0.8, "end": 2.4}], "Seen from the north")


@needs_ffmpeg
def test_a_stated_video_follows_its_rename(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Roundabout", _cut(client, cid, video, 1.0))
    _state(client, cid, "Roundabout", (0.5, 1.5))

    renamed = client.patch(f"/api/cases/{cid}/media", json={"path": video, "title": "convoy"}).json()["path"]

    stored = json.loads(_spec(cid, "Roundabout").read_text(encoding="utf-8"))["scene"]
    assert stored["video"] == renamed
    [scene] = _scenes(client, cid, renamed)["scenes"]
    assert (scene["moments"], scene["stated"]) == ([{"start": 0.5, "end": 1.5}], True)


@needs_ffmpeg
def test_a_video_a_proof_states_its_scene_in_is_used_by_it(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    other = _video(client, cid, tmp_path, "other.mp4", pattern="testsrc2")
    # cut from one clip, stated in the other: the second is used by the statement alone
    _proof(client, cid, "Roundabout", _cut(client, cid, video, 1.0), scene={"video": other, "moments": [{"start": 0.5}]})

    impact = client.post(f"/api/cases/{cid}/delete-impact", json={"paths": [other]}).json()
    assert {row["label"]: row["how"] for row in impact["touched"]} == {
        "Roundabout": ["geolocates a scene of it"],
    }


# -- the frames a proof lays out --------------------------------------------------------


@needs_ffmpeg
def test_the_scenes_name_each_frame_a_proof_lays_out(client, tmp_path):
    """Inspect says on a frame which proofs use it, whichever video each is about."""
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    other = _video(client, cid, tmp_path, "other.mp4", pattern="testsrc2")
    early, late, spare = (_cut(client, cid, video, t) for t in (0.5, 2.5, 3.5))
    _proof(client, cid, "Roundabout", early, late)
    # about the other clip, with a frame of this one to confirm the place
    _proof(client, cid, "Bridge", _cut(client, cid, other, 1.0), late)

    used = _scenes(client, cid, video)["used"]

    assert used == {
        early: [{"proof": "Roundabout", "title": "Roundabout"}],
        late: [{"proof": "Bridge", "title": "Bridge"}, {"proof": "Roundabout", "title": "Roundabout"}],
    }
    assert spare not in used
    assert list(_scenes(client, cid, other)["used"]) == [next(iter(
        p["src"] for p in json.loads(_spec(cid, "Bridge").read_text(encoding="utf-8"))["panels"]
    ))]


# -- the video and the draft a proof's scene names ----------------------------------------


@needs_ffmpeg
def test_the_star_moves_to_another_video_a_panel_was_cut_from(client, tmp_path):
    cid = _case(client)
    first = _video(client, cid, tmp_path, "first.mp4")
    second = _video(client, cid, tmp_path, "second.mp4", pattern="testsrc2")
    third = _video(client, cid, tmp_path, "third.mp4", pattern="smptebars")
    _proof(client, cid, "Depot", _cut(client, cid, first, 1.0), _cut(client, cid, second, 2.0))
    before = _spec(cid, "Depot").read_bytes()

    res = client.put(f"/api/cases/{cid}/proofs/Depot/scene", json={"moments": [{"start": 0.5, "end": 1.5}], "video": second})
    assert res.status_code == 200, res.text
    assert (res.json()["video"], res.json()["at"]) == (second, [pytest.approx(2.0, abs=0.11)])
    assert [s["proof"] for s in _scenes(client, cid, second)["scenes"]] == ["Depot"]
    assert _scenes(client, cid, first)["scenes"] == []

    # a clip the proof has nothing from, a photo, a file not in the case, or not a path
    photo = _upload_png(client, cid)
    for video in (third, photo, "media/nothing.mp4", "", 7):
        res = client.put(f"/api/cases/{cid}/proofs/Depot/scene", json={"moments": [], "video": video})
        assert res.status_code == 422, (video, res.text)
    assert json.loads(_spec(cid, "Depot").read_text(encoding="utf-8"))["scene"]["video"] == second

    # back on the clip its first frame names, with no time: the proof it was, byte for byte
    assert client.put(f"/api/cases/{cid}/proofs/Depot/scene", json={"moments": [], "video": first}).status_code == 200
    assert _spec(cid, "Depot").read_bytes() == before


@needs_ffmpeg
def test_a_proof_takes_up_one_draft_once(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _save_work(client, cid, video, scenes=[
        {"id": "s1", "start": 0.2, "end": 1.0, "label": "Roundabout?"},
        {"id": "s2", "start": 2.0, "end": 3.5, "label": "Bridge?"},
    ])
    _proof(client, cid, "Bridge", _cut(client, cid, video, 2.5))

    def put(**body):
        return client.put(f"/api/cases/{cid}/proofs/Bridge/scene", json={"moments": [{"start": 2.0, "end": 3.5}], **body})

    res = put(draft="s2", video=video)
    assert res.status_code == 200, res.text
    assert res.json()["draft"] == "s2"
    assert [(s["kind"], s.get("id") or s.get("proof")) for s in _scenes(client, cid, video)["scenes"]] == [
        ("draft", "s1"), ("proof", "Bridge"),
    ]
    # said again it changes nothing, and left out it stays
    assert put(draft="s2").status_code == 200
    assert put().json()["draft"] == "s2"
    # another one is refused: the proof already took a scene up
    assert put(draft="s1").status_code == 409
    for bad in (7, "", "x" * 65, ["s1"]):
        assert put(draft=bad).status_code == 422, bad
    assert json.loads(_spec(cid, "Bridge").read_text(encoding="utf-8"))["scene"]["draft"] == "s2"


@needs_ffmpeg
def test_a_draft_comes_back_with_its_proof_in_the_trash_and_goes_with_it_restored(client, tmp_path):
    """Deleting a proof gives its scene back to geolocate, at its own time."""
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    drafts = [{"id": "s2", "start": 2.0, "end": 3.5, "label": "Bridge?"}]
    _save_work(client, cid, video, scenes=drafts)
    _proof(client, cid, "Bridge", _cut(client, cid, video, 2.5))
    client.put(f"/api/cases/{cid}/proofs/Bridge/scene", json={"moments": [{"start": 2.1, "end": 3.4}], "draft": "s2"})
    # Inspect saving the work again keeps the draft it holds: hidden, not gone
    _save_work(client, cid, video, scenes=drafts)
    assert [s["kind"] for s in _scenes(client, cid, video)["scenes"]] == ["proof"]

    deleted = client.delete(f"/api/cases/{cid}/proofs/Bridge")
    assert deleted.status_code == 200, deleted.text
    assert _scenes(client, cid, video)["scenes"] == [
        {"kind": "draft", "video": video, "id": "s2", "start": 2.0, "end": 3.5, "label": "Bridge?",
         "state": "todo", "captures": [], "abandoned": None, "file_kind": "video"},
    ]

    restored = client.post(f"/api/cases/{cid}/trash/{deleted.json()['trash']}/restore")
    assert restored.status_code == 200, restored.text
    [scene] = _scenes(client, cid, video)["scenes"]
    assert (scene["kind"], scene["proof"], scene["moments"]) == ("proof", "Bridge", [{"start": 2.1, "end": 3.4}])
    assert [s["id"] for s in _work(client, cid, video)["spec"]["scenes"]] == ["s2"]


@needs_ffmpeg
def test_a_draft_stays_hidden_while_its_proof_is_about_another_video(client, tmp_path):
    cid = _case(client)
    first = _video(client, cid, tmp_path, "first.mp4")
    second = _video(client, cid, tmp_path, "second.mp4", pattern="testsrc2")
    _save_work(client, cid, first, scenes=[{"id": "s1", "start": 0.5, "end": 1.5, "label": "Depot?"}])
    _proof(client, cid, "Depot", _cut(client, cid, first, 1.0), _cut(client, cid, second, 2.0))
    put = client.put(f"/api/cases/{cid}/proofs/Depot/scene", json={"moments": [], "video": second, "draft": "s1"})
    assert put.status_code == 200, put.text

    listed = _scenes(client, cid, first)
    # the proof is about the second clip now; the scene it took up stays taken all the same
    assert (listed["scenes"], listed["taken"]) == ([], ["s1"])
    assert _scenes(client, cid, second)["taken"] == []

    client.delete(f"/api/cases/{cid}/proofs/Depot")
    listed = _scenes(client, cid, first)
    assert ([s["id"] for s in listed["scenes"]], listed["taken"]) == (["s1"], [])


# -- the date a proof states, about its video alone ---------------------------------------


def _date_claim(cid, name):
    return next(
        e for e in graph_read.entities(cid)
        if e["type"] == "claim" and e["attrs"].get("proof") == layout.proof_spec_rel(name)
    )


def _about(cid, claim_id):
    labels = {e["id"]: e["attrs"].get("path") for e in graph_read.entities(cid)}
    return sorted(labels[lk["to"]] for lk in graph_read.links(cid, "about") if lk["from"] == claim_id)


@needs_ffmpeg
def test_a_dated_proof_dates_its_video_and_never_the_one_that_confirms_it(client, tmp_path):
    cid = _case(client)
    first = _video(client, cid, tmp_path, "first.mp4")
    second = _video(client, cid, tmp_path, "second.mp4", pattern="testsrc2")
    photo = _upload_png(client, cid)
    saved = _proof(
        client, cid, "Depot", _cut(client, cid, first, 1.0), _cut(client, cid, second, 2.0), photo, when="2024-03-11",
    )

    claim = _date_claim(cid, "Depot")
    assert _about(cid, claim["id"]) == [first]
    assert saved["dated"] == [graph_read.entity(cid, path=first)["label"]]
    # traced off its frames, the proof is about the whole video: no span
    assert "span" not in claim["attrs"]


@needs_ffmpeg
def test_the_date_holds_for_the_moments_the_proof_states(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Roundabout", _cut(client, cid, video, 1.5), when="2024-03-11")
    claim_id = _date_claim(cid, "Roundabout")["id"]

    # the moments stated after the save reach the date at once
    assert _state(client, cid, "Roundabout", (0.5, 1.8), 3.0).status_code == 200
    claim = _date_claim(cid, "Roundabout")
    assert claim["id"] == claim_id
    assert claim["attrs"]["span"] == {"path": video, "moments": [{"start": 0.5, "end": 1.8}, {"start": 3.0, "end": None}]}
    assert claim["attrs"]["when"] == "2024-03-11"
    assert _about(cid, claim_id) == [video]

    # the Time panel of the video reads them beside the date
    entity = graph_read.entity(cid, path=video)
    page = client.get(f"/api/cases/{cid}/timeline", params={"entity": entity["id"], "category": "statement"}).json()
    [row] = [item for item in page["items"] if item["kind"] == "claim"]
    assert row["span"]["moments"] == [{"start": 0.5, "end": 1.8}, {"start": 3.0, "end": None}]

    # a save restates them as they are, and the whole video takes the span off
    opened = client.get(f"/api/cases/{cid}/proofs/Roundabout").json()
    client.post(f"/api/cases/{cid}/proofs", json={"rename_from": "Roundabout", "title": "Roundabout", "spec": opened})
    assert _date_claim(cid, "Roundabout")["attrs"]["span"]["moments"][0] == {"start": 0.5, "end": 1.8}
    assert _state(client, cid, "Roundabout").status_code == 200
    assert "span" not in _date_claim(cid, "Roundabout")["attrs"]
    page = client.get(f"/api/cases/{cid}/timeline", params={"entity": entity["id"], "category": "statement"}).json()
    assert all("span" not in item for item in page["items"])


@needs_ffmpeg
def test_moving_the_star_moves_the_date_and_leaves_the_analysts_words(client, tmp_path):
    cid = _case(client)
    first = _video(client, cid, tmp_path, "first.mp4")
    second = _video(client, cid, tmp_path, "second.mp4", pattern="testsrc2")
    _proof(client, cid, "Depot", _cut(client, cid, first, 1.0), _cut(client, cid, second, 2.0), when="2024-03-11")
    claim = _date_claim(cid, "Depot")
    # the analyst rewords it and grows it a confidence: the statement is theirs now
    Case.open(cid).update_entity(
        claim["id"], {"label": "Filmed the day of the strike", "attrs": {"confidence": "probable"}},
    )

    res = client.put(
        f"/api/cases/{cid}/proofs/Depot/scene", json={"moments": [{"start": 1.0, "end": 2.0}], "video": second},
    )
    assert res.status_code == 200, res.text

    claim = _date_claim(cid, "Depot")
    assert _about(cid, claim["id"]) == [second]
    assert claim["attrs"]["span"] == {"path": second, "moments": [{"start": 1.0, "end": 2.0}]}
    assert (claim["label"], claim["attrs"]["confidence"], claim["attrs"]["when"]) == (
        "Filmed the day of the strike", "probable", "2024-03-11",
    )


@needs_ffmpeg
def test_an_undated_proof_gets_no_date_from_its_moments(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Roundabout", _cut(client, cid, video, 1.5))
    assert _state(client, cid, "Roundabout", (0.5, 1.8)).status_code == 200
    assert [e for e in graph_read.entities(cid) if e["type"] == "claim"] == []


@needs_ffmpeg
def test_a_date_restated_by_hand_keeps_its_moments(client, tmp_path):
    """The analyst correcting the date in the Time panel corrects the date, not the moments."""
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Roundabout", _cut(client, cid, video, 1.5), when="2024-03-11")
    _state(client, cid, "Roundabout", (0.5, 1.8))
    claim_id = _date_claim(cid, "Roundabout")["id"]

    res = client.patch(f"/api/cases/{cid}/timeline/claims/{claim_id}", json={"when": "2024-03-12"})
    assert res.status_code == 200, res.text

    claim = _date_claim(cid, "Roundabout")
    assert (claim["attrs"]["when"], claim["attrs"]["span"]["moments"]) == ("2024-03-12", [{"start": 0.5, "end": 1.8}])
    # and a later change of moments leaves that date alone
    assert _state(client, cid, "Roundabout", (0.5, 2.2)).status_code == 200
    claim = _date_claim(cid, "Roundabout")
    assert (claim["attrs"]["when"], claim["attrs"]["span"]["moments"]) == ("2024-03-12", [{"start": 0.5, "end": 2.2}])


@needs_ffmpeg
def test_the_date_follows_the_star_from_the_first_save_on(client, tmp_path):
    """Geo Proof's way: a first save dates the video its panels name, then the scene it
    was made from arrives through the scene route, and later the analyst picks another ★."""
    cid = _case(client)
    first = _video(client, cid, tmp_path, "first.mp4")
    second = _video(client, cid, tmp_path, "second.mp4", pattern="testsrc2")
    _save_work(client, cid, second, scenes=[{"id": "s1", "start": 0.5, "end": 1.5, "label": "Depot?"}])
    _proof(client, cid, "Depot", _cut(client, cid, first, 1.0), _cut(client, cid, second, 1.0), when="2024-03-11")
    claim_id = _date_claim(cid, "Depot")["id"]
    assert _about(cid, claim_id) == [first]

    res = client.put(
        f"/api/cases/{cid}/proofs/Depot/scene",
        json={"moments": [{"start": 0.5, "end": 1.5}], "video": second, "draft": "s1"},
    )
    assert res.status_code == 200, res.text
    claim = _date_claim(cid, "Depot")
    assert (claim["id"], _about(cid, claim_id)) == (claim_id, [second])
    assert claim["attrs"]["span"] == {"path": second, "moments": [{"start": 0.5, "end": 1.5}]}

    # another ★, about the whole of it: the date moves there, with no span
    res = client.put(f"/api/cases/{cid}/proofs/Depot/scene", json={"video": first, "moments": []})
    assert res.status_code == 200, res.text
    claim = _date_claim(cid, "Depot")
    assert _about(cid, claim_id) == [first]
    assert "span" not in claim["attrs"]
    assert json.loads(_spec(cid, "Depot").read_text(encoding="utf-8"))["scene"] == {
        "video": first, "moments": [], "draft": "s1",
    }


# -- a proof sent to the Trash gives its scene back ----------------------------------------


def _drafts(client, cid, video):
    return [s for s in _scenes(client, cid, video)["scenes"] if s["kind"] == "draft"]


@needs_ffmpeg
def test_a_deleted_proof_gives_each_moment_back_to_geolocate_and_takes_them_on_restore(client, tmp_path):
    """A timecode is knowledge about the video: it does not leave with the proof."""
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Proof 32", _cut(client, cid, video, 1.0), scene={"video": video, "moments": [
        {"start": 0.5, "end": 1.5}, {"start": 3.0},
    ]})
    # the video was never opened in Inspect: the work is filed for the scenes

    deleted = client.delete(f"/api/cases/{cid}/proofs/Proof 32")
    assert deleted.status_code == 200, deleted.text

    given = _drafts(client, cid, video)
    assert [(d["start"], d["end"], d["label"]) for d in given] == [(0.5, 1.5, "Proof 32"), (3.0, None, "Proof 32")]
    ids = [d["id"] for d in given]
    assert [s["id"] for s in _work(client, cid, video)["spec"]["scenes"]] == ids

    restored = client.post(f"/api/cases/{cid}/trash/{deleted.json()['trash']}/restore")
    assert restored.status_code == 200, restored.text
    listed = _scenes(client, cid, video)
    assert [s["kind"] for s in listed["scenes"]] == ["proof"]
    assert listed["taken"] == sorted(ids)
    assert json.loads(_spec(cid, "Proof 32").read_text(encoding="utf-8"))["scene"]["gave"] == ids
    # hidden, never deleted: the work still holds them
    assert [s["id"] for s in _work(client, cid, video)["spec"]["scenes"]] == ids

    # a second delete gives nothing twice
    deleted = client.delete(f"/api/cases/{cid}/proofs/Proof 32")
    assert [d["id"] for d in _drafts(client, cid, video)] == ids
    assert len(_work(client, cid, video)["spec"]["scenes"]) == 2


@needs_ffmpeg
def test_a_deleted_proof_about_the_whole_video_gives_one_scene_back(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    # an older proof, traced off its frame and stating no time
    _proof(client, cid, "Proof 30", _cut(client, cid, video, 2.0))
    _save_work(client, cid, video, scenes=[{"id": "s1", "start": 0.2, "end": None, "label": "Mast?"}])

    deleted = client.delete(f"/api/cases/{cid}/proofs/Proof 30")

    drafts = _drafts(client, cid, video)
    assert [(d["start"], d["end"], d["label"]) for d in drafts] == [(None, None, "Proof 30"), (0.2, None, "Mast?")]
    client.post(f"/api/cases/{cid}/trash/{deleted.json()['trash']}/restore")
    assert [s.get("id") or s.get("proof") for s in _scenes(client, cid, video)["scenes"]] == ["s1", "Proof 30"]
    # restored, the proof states the video it is about, still the whole of it
    [scene] = [s for s in _scenes(client, cid, video)["scenes"] if s["kind"] == "proof"]
    assert (scene["moments"], scene["at"]) == ([], [pytest.approx(2.0, abs=0.11)])


@needs_ffmpeg
def test_a_proof_made_from_a_scene_gives_that_scene_back_and_no_other(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _save_work(client, cid, video, scenes=[{"id": "s2", "start": 2.0, "end": 3.5, "label": "Bridge?"}])
    _proof(client, cid, "Bridge", _cut(client, cid, video, 2.5))
    client.put(f"/api/cases/{cid}/proofs/Bridge/scene", json={"moments": [{"start": 2.1, "end": 3.4}], "draft": "s2"})
    before = _spec(cid, "Bridge").read_bytes()

    deleted = client.delete(f"/api/cases/{cid}/proofs/Bridge")

    assert [(d["id"], d["start"], d["end"]) for d in _drafts(client, cid, video)] == [("s2", 2.0, 3.5)]
    client.post(f"/api/cases/{cid}/trash/{deleted.json()['trash']}/restore")
    assert _drafts(client, cid, video) == []
    # nothing was written on the proof on its way out
    assert _spec(cid, "Bridge").read_bytes() == before


@needs_ffmpeg
def test_a_scene_already_there_at_the_same_time_is_not_given_twice(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _save_work(client, cid, video, scenes=[{"id": "s1", "start": 0.5, "end": 1.5, "label": "Depot?"}])
    _proof(client, cid, "Depot", _cut(client, cid, video, 1.0), scene={"video": video, "moments": [
        {"start": 0.5, "end": 1.5}, {"start": 2.0, "end": 3.0},
    ]})

    client.delete(f"/api/cases/{cid}/proofs/Depot")

    assert [(d["start"], d["end"], d["label"]) for d in _drafts(client, cid, video)] == [
        (0.5, 1.5, "Depot?"), (2.0, 3.0, "Depot"),
    ]


def test_a_proof_on_no_video_gives_nothing_back(client):
    cid = _case(client)
    _proof(client, cid, "Photo only", _upload_png(client, cid))
    assert client.delete(f"/api/cases/{cid}/proofs/Photo only").status_code == 200
    assert client.get(f"/api/cases/{cid}/inspect/works").json() == []


@needs_ffmpeg
def test_a_proof_leaving_with_its_video_gives_nothing_back(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Roundabout", _cut(client, cid, video, 1.0))
    case = Case.open(cid)
    ids = [
        case.find_entity(attr="spec", value=layout.proof_spec_rel("Roundabout"))["id"],
        case.find_entity(attr="path", value=video)["id"],
    ]
    res = client.post(f"/api/cases/{cid}/entities/delete", json={"ids": ids})
    assert res.status_code == 200, res.text
    assert client.get(f"/api/cases/{cid}/inspect/works").json() == []


@needs_ffmpeg
def test_a_given_back_scene_stays_named_on_the_proof_through_its_time_and_its_saves(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, "Depot", _cut(client, cid, video, 1.0), scene={"video": video, "moments": [{"start": 0.5}]})
    deleted = client.delete(f"/api/cases/{cid}/proofs/Depot")
    client.post(f"/api/cases/{cid}/trash/{deleted.json()['trash']}/restore")
    gave = json.loads(_spec(cid, "Depot").read_text(encoding="utf-8"))["scene"]["gave"]

    # its time taken back, then the composer saving it: the scenes it gave stay its own
    assert _state(client, cid, "Depot").status_code == 200
    opened = client.get(f"/api/cases/{cid}/proofs/Depot").json()
    client.post(f"/api/cases/{cid}/proofs", json={"rename_from": "Depot", "title": "Depot",
                                                   "spec": {k: v for k, v in opened.items() if k != "scene"}})
    assert json.loads(_spec(cid, "Depot").read_text(encoding="utf-8"))["scene"] == {
        "video": video, "moments": [], "draft": None, "gave": gave,
    }
    assert _drafts(client, cid, video) == []


# -- what Geo Proof's slides read -----------------------------------------------------


def _png_b64(color=(120, 60, 30)) -> str:
    import base64

    return base64.b64encode(_png(color)).decode()


def _exported(client, cid, title, *srcs, **extra):
    spec = {"panels": [{"id": f"p{i}", "src": s} for i, s in enumerate(srcs)], **extra}
    res = client.post(f"/api/cases/{cid}/proofs", json={"title": title, "spec": spec, "png_base64": _png_b64()})
    assert res.status_code == 200, res.text
    return res.json()


def _without_spec_thumb(cid, name):
    """What a proof saved before the spec recorded its thumbnail left on disk."""
    path = Case.open(cid).resolve_inside(layout.proof_spec_rel(name))
    spec = json.loads(path.read_text(encoding="utf-8"))
    spec.pop("thumb", None)
    path.write_text(json.dumps(spec), encoding="utf-8")
    return path


@needs_ffmpeg
def test_proof_row_thumb_falls_back_to_entity(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    saved = _exported(client, cid, "Bridge", _cut(client, cid, video, 1.0))
    assert saved["thumb"]
    spec_path = _without_spec_thumb(cid, "Bridge")
    before = spec_path.read_bytes()

    [row] = _scenes(client, cid, video)["scenes"]

    assert row["thumb"] == saved["thumb"]
    assert row["png"] == saved["png"]
    # read, not repaired: the spec stays as the old save left it
    assert spec_path.read_bytes() == before


@needs_ffmpeg
def test_proof_row_thumb_prefers_the_spec_and_skips_a_dead_one(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    saved = _exported(client, cid, "Bridge", _cut(client, cid, video, 1.0))
    case = Case.open(cid)
    entity = case.find_entity(attr="spec", value=layout.proof_spec_rel("Bridge"))

    # the entity naming a file that is gone, or one outside the case, reads as none
    case.update_entity(entity["id"], {"attrs": {"thumb": "../../outside.png"}})
    assert _scenes(client, cid, video)["scenes"][0]["thumb"] == saved["thumb"]
    _without_spec_thumb(cid, "Bridge")
    assert _scenes(client, cid, video)["scenes"][0]["thumb"] is None


@needs_ffmpeg
def test_proof_row_thumb_never_full_png(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    saved = _exported(client, cid, "Bridge", _cut(client, cid, video, 1.0))
    case = Case.open(cid)
    entity = case.find_entity(attr="spec", value=layout.proof_spec_rel("Bridge"))
    case.update_entity(entity["id"], {"attrs": {"thumb": ""}})
    spec_path = _without_spec_thumb(cid, "Bridge")
    case.resolve_inside(saved["thumb"]).unlink()
    before = spec_path.read_bytes()

    [row] = _scenes(client, cid, video)["scenes"]

    # no thumbnail anywhere: none, rather than the export a strip would load whole
    assert row["thumb"] is None
    assert row["png"] == saved["png"]
    # and none made on a read
    assert spec_path.read_bytes() == before
    assert not case.resolve_inside(saved["thumb"]).exists()
    assert case.get_entity(entity["id"])["attrs"]["thumb"] == ""


@needs_ffmpeg
def test_the_rows_of_a_video_look_their_proofs_and_places_up_once(client, tmp_path, monkeypatch):
    """`find_entity` scans every entity of the case. One per row made the read of a
    video with 150 proofs take a third of a second, and the strip reads it on every save."""
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    photo = _upload_png(client, cid)
    real = Case.find_entity

    def counted():
        asked = []

        def find_entity(self, **kwargs):
            asked.append(kwargs)
            return real(self, **kwargs)

        monkeypatch.setattr(Case, "find_entity", find_entity)
        try:
            rows = scenes_engine.video_scenes(Case.open(cid), video)["scenes"]
        finally:
            monkeypatch.setattr(Case, "find_entity", real)
        return len(asked), rows

    def prove(at):
        _proof(client, cid, f"Slide {at}", photo, coords=f"48.{at}1, 35.{at}2",
               scene={"video": video, "moments": [{"start": at * 0.4}]})

    for at in range(2):
        prove(at)
    few, _rows = counted()
    for at in range(2, 8):
        prove(at)
    many, rows = counted()

    assert many == few
    assert [r["proof"] for r in rows] == [f"Slide {at}" for at in range(8)]
    for row in rows:
        entity = Case.open(cid).find_entity(attr="spec", value=layout.proof_spec_rel(row["proof"]))
        assert row["proof_id"] == entity["id"]
        [point] = row["points"]
        assert Case.open(cid).get_entity(point["place_id"])["type"] == "place"


def _frames(client, cid, video, draft):
    return client.get(f"/api/cases/{cid}/scenes/{draft}/frames", params={"video": video})


def _work_frame(video, fid, time, filed=None):
    return {"id": fid, "path": video, "time": time, "filed": {"path": filed, "signature": "[]"} if filed else None}


@needs_ffmpeg
def test_draft_frames_route_lists_work_frames_in_moment(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)  # ten frames a second: half a frame is 0.05 s
    kept = _cut(client, cid, video, 1.5)
    gone = _cut(client, cid, video, 1.2)
    case = Case.open(cid)
    _save_work(client, cid, video, frames=[
        _work_frame(video, "late", 1.94),
        _work_frame(video, "kept", 1.5, kept),
        _work_frame(video, "edge_in", 0.96),       # its middle is past the start
        _work_frame(video, "edge_out", 1.96),      # its middle is past the end
        _work_frame(video, "before", 0.9),
        _work_frame(video, "gone", 1.2, gone),
        _work_frame(video, "flash", 2.96),         # starts within half a frame of 3.0
        _work_frame(video, "after_flash", 3.06),
        {"id": "untimed", "path": video, "time": None},
    ], scenes=[
        {"id": "s_pass", "start": 1.0, "end": 2.0, "label": "Bridge?"},
        {"id": "s_flash", "start": 3.0, "label": ""},
        {"id": "s_all", "start": None, "end": None, "label": "Which city?"},
    ])
    client.delete(f"/api/cases/{cid}/media", params={"path": gone})
    assert case.media_items_by_paths([gone]) == []
    work_path = case.resolve_inside(layout.session_rel(_work(client, cid, video)["name"]))
    before = work_path.read_bytes()

    res = _frames(client, cid, video, "s_pass")

    assert res.status_code == 200, res.text
    frames = res.json()["frames"]
    # in clip order, each with the picture it was saved as while the case holds it
    assert [f["id"] for f in frames] == ["edge_in", "gone", "kept", "late"]
    by_id = {f["id"]: f for f in frames}
    assert set(by_id["kept"]) == {"id", "time", "path", "thumb"}
    assert by_id["kept"]["path"] == kept and by_id["kept"]["time"] == 1.5
    [item] = case.media_items_by_paths([kept])
    assert by_id["kept"]["thumb"] == item.get("thumbnail") and by_id["kept"]["thumb"] != kept
    # never saved, or its picture deleted since: the composer files it first
    assert by_id["late"] == {"id": "late", "time": 1.94, "path": None, "thumb": None}
    assert by_id["gone"]["path"] is None and by_id["gone"]["thumb"] is None

    assert [f["id"] for f in _frames(client, cid, video, "s_flash").json()["frames"]] == ["flash"]
    # the whole video holds every frame with a time
    assert [f["id"] for f in _frames(client, cid, video, "s_all").json()["frames"]] == [
        "before", "edge_in", "gone", "kept", "late", "edge_out", "flash", "after_flash",
    ]
    # reading is reading
    assert work_path.read_bytes() == before


@needs_ffmpeg
def test_draft_frames_route_refuses_what_is_not_a_video_scene(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    photo = _upload_png(client, cid)
    _save_work(client, cid, photo, scenes=[{"id": "s_pic", "start": None, "end": None, "label": ""}])
    _save_work(client, cid, video, scenes=[{"id": "s_v", "start": 1.0, "label": ""}])

    assert _frames(client, cid, photo, "s_pic").status_code == 422
    assert _frames(client, cid, video, "s_nope").status_code == 404
    assert _frames(client, cid, "media/never.mp4", "s_v").status_code == 400
    assert _frames(client, cid, video, "s_v").json() == {"frames": []}
    # a video nothing was done to has no scene to read
    other = _video(client, cid, tmp_path, "other.mp4", pattern="testsrc2")
    assert _frames(client, cid, other, "s_v").status_code == 404


def test_frame_in_moment_is_inspects_rule():
    tenth = 0.1
    # a passage holds a frame by its middle, the end excluded
    assert scenes_engine.frame_in_moment(0.95, 1.0, 2.0, tenth)
    assert not scenes_engine.frame_in_moment(0.94, 1.0, 2.0, tenth)
    assert scenes_engine.frame_in_moment(1.94, 1.0, 2.0, tenth)
    assert not scenes_engine.frame_in_moment(1.95, 1.0, 2.0, tenth)
    # an instant is shown by the frame that starts within half a frame of it
    assert scenes_engine.frame_in_moment(2.96, 3.0, None, tenth)
    assert scenes_engine.frame_in_moment(3.04, 3.0, None, tenth)
    assert not scenes_engine.frame_in_moment(3.06, 3.0, None, tenth)
    assert not scenes_engine.frame_in_moment(2.94, 3.0, None, tenth)
    # an end that is no end after the start reads as the instant
    assert scenes_engine.frame_in_moment(3.0, 3.0, 3.0, tenth)
