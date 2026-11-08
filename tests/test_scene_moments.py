"""One scene, several moments: a place still to prove that shows again further on.

A scene still to prove holds one moment, kept as its own ``start`` and ``end``, and the
moments after it under ``more`` when the place comes back in the clip. A scene of one
moment is written byte for byte as before. Same place as… joins two scenes into one in
a single write, and its Undo puts both back as they were.
"""

from __future__ import annotations

import io
import os
import subprocess
from pathlib import Path

import onemoment
import pytest
from PIL import Image

from azimut import layout
from azimut.engine import inspectwork
from azimut.engine import media as media_engine
from azimut.workspace import Case

needs_ffmpeg = pytest.mark.skipif(not media_engine.ffmpeg_available(), reason="ffmpeg not installed")

FIXTURE = Path(__file__).parent / "fixtures" / "inspect-work-one-moment.json"


def _case(client, name="Moments") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _png(color=(120, 60, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (80, 60), color).save(buf, "PNG")
    return buf.getvalue()


def _upload(client, cid, name="clip.png") -> str:
    res = client.post(f"/api/cases/{cid}/media/upload", files={"file": (name, io.BytesIO(_png()), "image/png")})
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _video(client, cid, tmp_path, name="clip.mp4") -> str:
    path = tmp_path / name
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=64x48:r=10:d=4",
         "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    with path.open("rb") as fh:
        res = client.post(f"/api/cases/{cid}/media/upload", files={"file": (name, fh, "video/mp4")})
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _save(client, cid, path, scenes, **spec):
    return client.put(f"/api/cases/{cid}/inspect/work", json={"path": path, "spec": {"frames": [], "scenes": scenes, **spec}})


def _stored(client, cid, path):
    return client.get(f"/api/cases/{cid}/inspect/work", params={"path": path}).json()["work"]["spec"]["scenes"]


def _rows(client, cid, path):
    res = client.get(f"/api/cases/{cid}/scenes", params={"video": path})
    assert res.status_code == 200, res.text
    return {s["id"]: s for s in res.json()["scenes"] if s["kind"] == "draft"}


def _join(client, cid, path, draft, into):
    return client.post(f"/api/cases/{cid}/scenes/{draft}/join", json={"video": path, "into": into})


def _unjoin(client, cid, path, undo):
    return client.post(f"/api/cases/{cid}/scenes/{undo['kept']['id']}/unjoin", json={"video": path, **undo})


_shots = iter(range(1, 10_000))


def _capture(client, cid):
    client.put("/api/settings/keys", json={"google_js": "AIza.js"})
    shade = next(_shots)
    res = client.post(
        f"/api/cases/{cid}/satellite/screenshot",
        files={"image": ("shot.png", _png(color=(shade % 255, 80, 40)), "image/png")},
        data={"lat": "48.8584", "lon": "2.2945", "zoom": "18", "provider": "google-js"},
    )
    assert res.status_code == 200, res.text
    return res.json()["path"]


# -- one moment, as before -------------------------------------------------------------


def test_a_scene_of_one_moment_is_written_byte_for_byte_as_before(client):
    """The steps of `onemoment.py`, run on the code from before `more`, wrote the fixture."""
    cid = _case(client)
    photo = _upload(client, cid)
    case = Case.open(cid)

    rel = onemoment.write(inspectwork, case, photo)

    written = onemoment.scrub(case.resolve_inside(rel).read_text(encoding="utf-8"))
    if os.environ.get("AZIMUT_WRITE_GOLDEN") == "1":
        FIXTURE.write_text(written, encoding="utf-8")
    assert written == FIXTURE.read_text(encoding="utf-8")
    assert "more" not in written


# -- several moments ---------------------------------------------------------------------


def test_a_scene_keeps_its_first_moment_as_its_time_and_the_rest_after_it(client):
    cid = _case(client)
    photo = _upload(client, cid)
    res = _save(client, cid, photo, [
        {"id": "s1", "start": 65, "end": 72, "label": "Bridge", "more": [{"start": 0, "end": 7}, {"start": 30}]},
    ])
    assert res.status_code == 200, res.text

    [scene] = _stored(client, cid, photo)
    # every reader that knows one moment still reads the first
    assert scene == {
        "id": "s1", "start": 0.0, "end": 7.0, "label": "Bridge",
        "more": [{"start": 30.0, "end": None}, {"start": 65.0, "end": 72.0}],
    }
    assert list(scene) == ["id", "start", "end", "label", "more"]


def test_a_scene_back_to_one_moment_writes_no_more(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save(client, cid, photo, [{"id": "s1", "start": 0, "end": 7, "label": "", "more": [{"start": 65, "end": 72}]}])
    _save(client, cid, photo, [{"id": "s1", "start": 0, "end": 7, "label": "", "more": []}])
    assert _stored(client, cid, photo) == [{"id": "s1", "start": 0.0, "end": 7.0, "label": ""}]


@pytest.mark.parametrize("scene", [
    # two passages overlapping, and one instant twice: refused as a proof's are
    {"id": "s1", "start": 0, "end": 7, "more": [{"start": 5, "end": 9}]},
    {"id": "s1", "start": 3, "more": [{"start": 3}]},
    # a moment that is not one
    {"id": "s1", "start": 0, "end": 7, "more": [{"start": 9, "end": 8}]},
    {"id": "s1", "start": 0, "end": 7, "more": [{"end": 8}]},
    {"id": "s1", "start": 0, "end": 7, "more": ["soon"]},
    {"id": "s1", "start": 0, "end": 7, "more": {"start": 9}},
    # the whole video holds every moment already
    {"id": "s1", "start": None, "end": None, "more": [{"start": 9}]},
    # past the cap
    {"id": "s1", "start": 0, "more": [{"start": t} for t in range(1, inspectwork.MAX_SCENE_MOMENTS + 1)]},
])
def test_a_scene_whose_moments_do_not_read_is_refused(client, scene):
    cid = _case(client)
    photo = _upload(client, cid)
    assert _save(client, cid, photo, [scene]).status_code == 400


def test_two_passages_that_touch_and_an_instant_inside_a_passage_are_kept(client):
    cid = _case(client)
    photo = _upload(client, cid)
    res = _save(client, cid, photo, [{"id": "s1", "start": 0, "end": 7, "more": [{"start": 7, "end": 9}, {"start": 3}]}])
    assert res.status_code == 200, res.text
    [scene] = _stored(client, cid, photo)
    assert scene["more"] == [{"start": 3.0, "end": None}, {"start": 7.0, "end": 9.0}]


def test_a_save_says_the_scenes_moved_when_only_a_further_moment_did(client, monkeypatch):
    from azimut.api import events

    cid = _case(client)
    photo = _upload(client, cid)
    _save(client, cid, photo, [{"id": "s1", "start": 0, "end": 7, "label": ""}])
    heard = []
    monkeypatch.setattr(events, "publish", heard.append)
    _save(client, cid, photo, [{"id": "s1", "start": 0, "end": 7, "label": "", "more": [{"start": 65, "end": 72}]}])
    assert {"type": "scenes", "case_id": cid, "video": photo} in heard


def test_a_row_and_the_queue_say_every_moment_and_a_scene_of_one_says_none_more(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save(client, cid, photo, [
        {"id": "s1", "start": 0, "end": 7, "label": "Bridge", "more": [{"start": 65, "end": 72}]},
        {"id": "s2", "start": 30, "end": None, "label": "Mast"},
    ])
    rows = _rows(client, cid, photo)
    assert (rows["s1"]["start"], rows["s1"]["end"], rows["s1"]["more"]) == (0.0, 7.0, [{"start": 65.0, "end": 72.0}])
    assert "more" not in rows["s2"]

    [file] = client.get(f"/api/cases/{cid}/scenes/queue").json()["files"]
    queued = {s["id"]: s for s in file["scenes"]}
    assert queued["s1"]["more"] == [{"start": 65.0, "end": 72.0}]
    assert "more" not in queued["s2"]


def test_a_scene_takes_new_moments_alone_and_says_the_ones_it_had(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save(client, cid, photo, [{"id": "s1", "start": 0, "end": 7, "label": "Bridge"}])

    res = client.put(f"/api/cases/{cid}/scenes/s1/time", json={"video": photo, "start": 0, "end": 7, "more": [{"start": 65, "end": 72}]})
    assert res.status_code == 200, res.text
    assert res.json() == {"before": {"start": 0.0, "end": 7.0}}
    [scene] = _stored(client, cid, photo)
    assert scene["more"] == [{"start": 65.0, "end": 72.0}]

    # back to one: the moments it had are said, so an Undo puts them back
    res = client.put(f"/api/cases/{cid}/scenes/s1/time", json={"video": photo, "start": 2, "end": 7})
    assert res.json() == {"before": {"start": 0.0, "end": 7.0, "more": [{"start": 65.0, "end": 72.0}]}}
    assert _stored(client, cid, photo) == [{"id": "s1", "start": 2.0, "end": 7.0, "label": "Bridge"}]
    clash = client.put(f"/api/cases/{cid}/scenes/s1/time", json={"video": photo, "start": 0, "end": 7, "more": [{"start": 5, "end": 9}]})
    assert clash.status_code == 400


@needs_ffmpeg
def test_a_moment_marked_is_a_scene_of_its_own_beside_one_holding_it_among_more(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _save(client, cid, video, [{"id": "s1", "start": 0.5, "end": 1.0, "label": "", "more": [{"start": 3.0}]}])

    res = client.post(f"/api/cases/{cid}/scenes/mark", json={"path": video, "label": "again", "start": 0.5, "end": 1.0})

    assert res.status_code == 200, res.text
    marked = res.json()["scene"]
    assert marked["id"] != "s1" and marked["label"] == "again" and "more" not in marked
    assert [s.get("more") for s in _stored(client, cid, video)] == [[{"start": 3.0, "end": None}], None]
    # the same scene, every moment of it, is not added twice
    inspectwork.add_scenes(Case.open(cid), video, [{"start": 0.5, "end": 1.0, "label": "", "more": [{"start": 3.0, "end": None}]}])
    assert len(_stored(client, cid, video)) == 2


@needs_ffmpeg
def test_a_scene_s_frames_are_those_inside_any_of_its_moments(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)  # ten frames a second
    frame = lambda fid, time: {"id": fid, "path": video, "time": time, "filed": None}  # noqa: E731
    _save(client, cid, video, [
        {"id": "s1", "start": 0.5, "end": 1.0, "label": "", "more": [{"start": 3.0}]},
    ], frames=[frame("in_first", 0.7), frame("between", 2.0), frame("on_instant", 3.0), frame("after", 3.5)])

    res = client.get(f"/api/cases/{cid}/scenes/s1/frames", params={"video": video})
    assert res.status_code == 200, res.text
    assert [f["id"] for f in res.json()["frames"]] == ["in_first", "on_instant"]


@needs_ffmpeg
def test_a_proof_taking_up_a_scene_of_several_moments_states_them_all_and_hides_it(client, tmp_path):
    """A proof made in Geo Proof takes a scene up with every moment it holds."""
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _save(client, cid, video, [{"id": "s1", "start": 0.5, "end": 1.0, "label": "Bridge", "more": [{"start": 3.0}]}])
    cut = client.post(f"/api/cases/{cid}/inspect/save-frames", json={"items": [{"path": video, "time": 0.7}]})
    frame = cut.json()["saved"][0]["item"]["path"]
    made = client.post(f"/api/cases/{cid}/proofs", json={"title": "Bridge", "spec": {"panels": [{"id": "p0", "src": frame}]}})
    assert made.status_code == 200, made.text
    moments = [{"start": 0.5, "end": 1.0}, {"start": 3.0, "end": None}]

    res = client.put(f"/api/cases/{cid}/proofs/Bridge/scene", json={"moments": moments, "draft": "s1"})
    assert res.status_code == 200, res.text

    listed = client.get(f"/api/cases/{cid}/scenes", params={"video": video}).json()
    [proof] = listed["scenes"]
    assert proof["kind"] == "proof" and proof["moments"] == moments and proof["draft"] == "s1"
    assert listed["taken"] == ["s1"]


@needs_ffmpeg
def test_a_proof_with_no_place_reads_every_moment_in_the_to_do(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    cut = client.post(f"/api/cases/{cid}/inspect/save-frames", json={"items": [{"path": video, "time": 0.7}]})
    frame = cut.json()["saved"][0]["item"]["path"]
    moments = [{"start": 0.5, "end": 1.0}, {"start": 3.0, "end": None}]
    client.post(f"/api/cases/{cid}/proofs", json={"title": "Bridge", "spec": {
        "panels": [{"id": "p0", "src": frame}], "scene": {"video": video, "moments": moments},
    }})

    [file] = client.get(f"/api/cases/{cid}/scenes/queue").json()["files"]
    [row] = file["proofs"]
    assert (row["moments"], row["start"], row["end"]) == (moments, 0.5, 1.0)


def test_a_stray_work_merged_in_keeps_its_scenes_moments(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save(client, cid, photo, [{"id": "s_old", "start": 50, "end": 60, "label": "old", "more": [{"start": 90}]}])
    cleared = client.delete(f"/api/cases/{cid}/inspect/work", params={"path": photo}).json()
    _save(client, cid, photo, [{"id": "s_new", "start": 1, "end": 5, "label": "new"}])

    client.post(f"/api/cases/{cid}/trash/{cleared['trash']}/restore")

    scenes = {s["id"]: s for s in _stored(client, cid, photo)}
    assert scenes["s_old"]["more"] == [{"start": 90.0, "end": None}]
    assert "more" not in scenes["s_new"]


# -- Same place as… ------------------------------------------------------------------------


def test_same_place_joins_two_scenes_into_one_and_undo_puts_both_back(client, monkeypatch):
    from azimut.api import events

    cid = _case(client)
    photo = _upload(client, cid)
    _save(client, cid, photo, [
        {"id": "first", "start": 0, "end": 7, "label": "Bridge"},
        {"id": "later", "start": 65, "end": 72, "label": "Road bridge"},
    ])
    client.put(f"/api/cases/{cid}/geolocating", json={"video": photo, "draft": "later"})
    shot = _capture(client, cid)
    before = _stored(client, cid, photo)
    heard = []
    monkeypatch.setattr(events, "publish", heard.append)

    res = _join(client, cid, photo, "later", "first")

    assert res.status_code == 200, res.text
    answer = res.json()
    assert answer["scene"]["id"] == "first"
    assert (answer["scene"]["start"], answer["scene"]["end"], answer["scene"]["more"]) == (0.0, 7.0, [{"start": 65.0, "end": 72.0}])
    assert answer["scene"]["label"] == "Bridge / Road bridge"
    assert answer["scene"]["captures"] == [shot] and answer["scene"]["state"] == "progress"
    [joined] = _stored(client, cid, photo)
    assert joined == {
        "id": "first", "start": 0.0, "end": 7.0, "label": "Bridge / Road bridge",
        "more": [{"start": 65.0, "end": 72.0}], "captures": [shot],
    }
    # the scene being geolocated was one of them: the joined one is, and its captures land there
    assert client.get(f"/api/cases/{cid}/geolocating").json()["geolocating"]["id"] == "first"
    assert {"type": "scenes", "case_id": cid, "video": photo} in heard
    assert {"type": "geolocating", "case_id": cid, "video": photo, "draft": "first"} in heard
    again = _capture(client, cid)

    heard.clear()
    undone = _unjoin(client, cid, photo, answer["undo"])

    assert undone.status_code == 200, undone.text
    after = {s["id"]: s for s in _stored(client, cid, photo)}
    want = {s["id"]: s for s in before}
    # both as they were, and the capture gathered meanwhile stays with the scene kept
    assert after["later"] == want["later"]
    assert after["first"] == {**want["first"], "captures": [again]}
    assert [s["id"] for s in _stored(client, cid, photo)] == ["first", "later"]
    assert client.get(f"/api/cases/{cid}/geolocating").json()["geolocating"]["id"] == "later"
    assert {"type": "scenes", "case_id": cid, "video": photo} in heard
    # an Undo said twice finds the scene back already
    assert _unjoin(client, cid, photo, answer["undo"]).status_code == 400


def test_same_place_fuses_moments_that_overlap_and_keeps_one_label_said_twice(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save(client, cid, photo, [
        {"id": "a", "start": 0, "end": 7, "label": "Bridge?", "more": [{"start": 30}]},
        {"id": "b", "start": 5, "end": 9, "label": "bridge?", "more": [{"start": 30}, {"start": 40, "end": 41}]},
    ])

    res = _join(client, cid, photo, "a", "b")

    assert res.status_code == 200, res.text
    [joined] = _stored(client, cid, photo)
    assert joined["id"] == "b" and joined["label"] == "bridge?"
    assert (joined["start"], joined["end"]) == (0.0, 9.0)
    assert joined["more"] == [{"start": 30.0, "end": None}, {"start": 40.0, "end": 41.0}]


def test_same_place_keeps_the_only_label_given(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save(client, cid, photo, [{"id": "a", "start": 0, "label": ""}, {"id": "b", "start": 9, "label": "Mast"}])
    assert _join(client, cid, photo, "b", "a").json()["scene"]["label"] == "Mast"


def test_same_place_refuses_what_cannot_be_one_scene(client, tmp_path, monkeypatch):
    cid = _case(client)
    photo = _upload(client, cid)
    _save(client, cid, photo, [
        {"id": "whole", "start": None, "end": None, "label": ""},
        {"id": "a", "start": 0, "end": 7, "label": ""},
        {"id": "b", "start": 20, "label": ""},
        {"id": "gone", "start": 30, "label": ""},
    ])
    client.put(f"/api/cases/{cid}/scenes/gone/abandon", json={"video": photo, "reason": ""})

    assert _join(client, cid, photo, "a", "a").status_code == 400
    assert _join(client, cid, photo, "a", "whole").status_code == 400
    assert _join(client, cid, photo, "whole", "a").status_code == 400
    assert _join(client, cid, photo, "gone", "a").status_code == 400
    assert _join(client, cid, photo, "a", "nowhere").status_code == 400
    assert len(_stored(client, cid, photo)) == 4
    # past what one scene holds
    monkeypatch.setattr(inspectwork, "MAX_SCENE_MOMENTS", 1)
    assert _join(client, cid, photo, "a", "b").status_code == 400


@needs_ffmpeg
def test_same_place_refuses_a_scene_a_proof_took_up(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _save(client, cid, video, [{"id": "a", "start": 0.5, "end": 1.0, "label": ""}, {"id": "b", "start": 3.0, "label": ""}])
    cut = client.post(f"/api/cases/{cid}/inspect/save-frames", json={"items": [{"path": video, "time": 0.7}]})
    frame = cut.json()["saved"][0]["item"]["path"]
    client.post(f"/api/cases/{cid}/proofs", json={"title": "Bridge", "spec": {
        "panels": [{"id": "p0", "src": frame}], "scene": {"video": video, "moments": [{"start": 0.5, "end": 1.0}], "draft": "a"},
    }})
    assert Case.open(cid).resolve_inside(layout.proof_spec_rel("Bridge")).exists()

    assert _join(client, cid, video, "b", "a").status_code == 400
    assert _join(client, cid, video, "a", "b").status_code == 400


def test_an_undo_handed_back_wrong_is_refused(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save(client, cid, photo, [{"id": "a", "start": 0, "label": ""}, {"id": "b", "start": 9, "label": ""}])
    undo = _join(client, cid, photo, "b", "a").json()["undo"]

    bad = {**undo, "gone": {**undo["gone"], "start": -1}}
    assert _unjoin(client, cid, photo, bad).status_code == 400
    swapped = client.post(f"/api/cases/{cid}/scenes/b/unjoin", json={"video": photo, **undo})
    assert swapped.status_code == 400
    assert [s["id"] for s in _stored(client, cid, photo)] == ["a"]
