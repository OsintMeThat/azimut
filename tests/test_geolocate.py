"""Geolocating a scene: the captures it gathers, its states, and the queue of those left.

A scene still to prove reads To geolocate until a capture is attached to it, In progress
while it holds one, Proved once a proof takes it up, and Abandoned when the analyst
gives up on it. While one is being geolocated, every capture filed in the case is
attached to it on the server, from the app's map tools or from the extension.
"""

from __future__ import annotations

import io
import json
import subprocess

import pytest
from PIL import Image

from azimut.engine import geolocate, inspectwork
from azimut.engine import media as media_engine
from azimut.engine import uses as uses_engine
from azimut.workspace import Case

needs_ffmpeg = pytest.mark.skipif(not media_engine.ffmpeg_available(), reason="ffmpeg not installed")


def _case(client, name="Geolocate") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _png(color=(120, 60, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (80, 60), color).save(buf, "PNG")
    return buf.getvalue()


def _upload(client, cid, name="photo.png", color=(120, 60, 30)) -> str:
    res = client.post(f"/api/cases/{cid}/media/upload", files={"file": (name, io.BytesIO(_png(color)), "image/png")})
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


def _save_work(client, cid, path, scenes):
    res = client.put(f"/api/cases/{cid}/inspect/work", json={"path": path, "spec": {"frames": [], "scenes": scenes}})
    assert res.status_code == 200, res.text


def _stored(client, cid, path):
    return client.get(f"/api/cases/{cid}/inspect/work", params={"path": path}).json()["work"]["spec"]["scenes"]


_shots = iter(range(1, 10_000))


def _capture(client, cid):
    """A capture filed by Satellite's screenshot route, which needs no network."""
    client.put("/api/settings/keys", json={"google_js": "AIza.js"})
    shade = next(_shots)
    res = client.post(
        f"/api/cases/{cid}/satellite/screenshot",
        files={"image": ("shot.png", _png(color=(shade % 255, 80, 40)), "image/png")},
        data={"lat": "48.8584", "lon": "2.2945", "zoom": "18", "provider": "google-js"},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _geolocate(client, cid, video, draft):
    return client.put(f"/api/cases/{cid}/geolocating", json={"video": video, "draft": draft})


def _queue(client, cid):
    res = client.get(f"/api/cases/{cid}/scenes/queue")
    assert res.status_code == 200, res.text
    return res.json()


SCENES = [
    {"id": "s1", "start": 4, "end": 9, "label": "Roundabout"},
    {"id": "s2", "start": None, "end": None, "label": "Whole"},
]


# -- gathering captures ------------------------------------------------------------


def test_a_capture_taken_while_a_scene_is_geolocated_is_attached_to_it(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)

    res = _geolocate(client, cid, photo, "s1")
    assert res.status_code == 200, res.text
    held = res.json()["geolocating"]
    assert (held["video"], held["id"], held["label"], held["state"]) == (photo, "s1", "Roundabout", "todo")

    shot = _capture(client, cid)
    assert shot["scene"] == {"video": photo, "id": "s1", "label": "Roundabout", "captures": 1}
    again = _capture(client, cid)
    s1 = next(s for s in _stored(client, cid, photo) if s["id"] == "s1")
    assert s1["captures"] == [shot["path"], again["path"]]

    # In progress now, and still the one being geolocated
    now = client.get(f"/api/cases/{cid}/geolocating").json()["geolocating"]
    assert now["state"] == "progress" and now["captures"] == [shot["path"], again["path"]]

    # stopped, a capture is a capture and nothing more
    assert client.delete(f"/api/cases/{cid}/geolocating").json() == {"ended": True}
    assert "scene" not in _capture(client, cid)
    assert client.get(f"/api/cases/{cid}/geolocating").json() == {"geolocating": None}
    assert client.delete(f"/api/cases/{cid}/geolocating").json() == {"ended": False}


def test_inspect_saving_its_scenes_keeps_what_the_server_holds_on_them(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    shot = _capture(client, cid)
    client.put(f"/api/cases/{cid}/scenes/s2/abandon", json={"video": photo, "reason": "no landmark"})

    # Inspect sends its scenes as it holds them, without captures or abandoned, and
    # even with a stale copy of them
    _save_work(client, cid, photo, [
        {"id": "s1", "start": 5, "end": 9, "label": "Roundabout north", "captures": []},
        {"id": "s2", "start": None, "end": None, "label": "Whole", "abandoned": None},
    ])
    stored = {s["id"]: s for s in _stored(client, cid, photo)}
    assert stored["s1"]["start"] == 5.0 and stored["s1"]["label"] == "Roundabout north"
    assert stored["s1"]["captures"] == [shot["path"]]
    assert stored["s2"]["abandoned"]["reason"] == "no landmark"


def test_a_scene_gone_from_its_work_ends_the_geolocating_and_takes_nothing(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    _save_work(client, cid, photo, [SCENES[1]])  # s1 removed in Inspect

    shot = _capture(client, cid)
    assert "scene" not in shot
    assert client.get(f"/api/cases/{cid}/geolocating").json() == {"geolocating": None}
    assert _geolocate(client, cid, photo, "s1").status_code == 400


def test_the_queue_reads_each_work_once_however_many_files_it_walks(client, monkeypatch):
    cid = _case(client)
    for n in range(4):
        photo = _upload(client, cid, f"p{n}.png", (n * 40, 10, 10))
        _save_work(client, cid, photo, SCENES)
    calls = []
    real = inspectwork._work_specs
    monkeypatch.setattr(inspectwork, "_work_specs", lambda case: calls.append(1) or real(case))
    assert len(_queue(client, cid)["files"]) == 4
    assert len(calls) <= 2  # the files, and the one pass the order reads them for


def test_a_scene_keeps_no_more_captures_than_its_limit(client, monkeypatch):
    monkeypatch.setattr(geolocate, "MAX_CAPTURES", 2)
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    paths = [_capture(client, cid)["path"] for _ in range(3)]
    assert next(s for s in _stored(client, cid, photo) if s["id"] == "s1")["captures"] == paths[:2]


# -- abandoning ----------------------------------------------------------------------


def test_an_abandoned_scene_stays_with_its_word_and_comes_back_as_it_was(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    shot = _capture(client, cid)

    res = client.put(f"/api/cases/{cid}/scenes/s1/abandon", json={"video": photo, "reason": "  too dark  "})
    assert res.status_code == 200, res.text
    scene = res.json()["scene"]
    assert scene["state"] == "abandoned" and scene["abandoned"]["reason"] == "too dark"
    # abandoning the scene being geolocated ends it
    assert client.get(f"/api/cases/{cid}/geolocating").json() == {"geolocating": None}
    assert _geolocate(client, cid, photo, "s1").status_code == 400

    back = client.delete(f"/api/cases/{cid}/scenes/s1/abandon", params={"video": photo})
    assert back.status_code == 200, back.text
    assert back.json()["scene"]["state"] == "progress"
    assert back.json()["scene"]["captures"] == [shot["path"]]
    assert _geolocate(client, cid, photo, "s1").status_code == 200


def test_abandoning_needs_no_word_and_refuses_a_scene_that_is_not_there(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    res = client.put(f"/api/cases/{cid}/scenes/s2/abandon", json={"video": photo})
    assert res.json()["scene"]["abandoned"]["reason"] == ""
    assert client.put(f"/api/cases/{cid}/scenes/nope/abandon", json={"video": photo}).status_code == 400


# -- the queue -----------------------------------------------------------------------


def test_the_queue_lists_every_file_s_scenes_to_prove_with_their_states(client):
    cid = _case(client)
    first = _upload(client, cid, "first.png", (10, 10, 10))
    second = _upload(client, cid, "second.png", (200, 10, 10))
    _save_work(client, cid, first, SCENES)
    _save_work(client, cid, second, [{"id": "t1", "start": 2, "end": None, "label": "Gate"}])
    _geolocate(client, cid, first, "s1")
    _capture(client, cid)
    client.put(f"/api/cases/{cid}/scenes/s2/abandon", json={"video": first, "reason": "blurred"})

    queue = _queue(client, cid)
    # the file last worked on first: the first one, which the capture just wrote to
    assert [f["video"] for f in queue["files"]] == [first, second]
    rows = {s["id"]: s for f in queue["files"] for s in f["scenes"]}
    assert rows["s1"]["state"] == "progress"
    assert rows["s2"]["state"] == "abandoned" and rows["s2"]["abandoned"]["reason"] == "blurred"
    assert rows["t1"]["state"] == "todo" and rows["t1"]["end"] is None
    # the whole video comes first in its file
    assert [s["id"] for s in queue["files"][0]["scenes"]] == ["s2", "s1"]
    assert queue["geolocating"]["id"] == "s1"


def test_a_file_sent_to_the_trash_leaves_the_queue(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    res = client.delete(f"/api/cases/{cid}/media", params={"path": photo})
    assert res.status_code == 200, res.text
    assert _queue(client, cid) == {"files": [], "geolocating": None}


@needs_ffmpeg
def test_a_proof_taking_the_scene_up_proves_it_and_ends_the_geolocating(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _save_work(client, cid, video, [{"id": "s1", "start": 1, "end": 2, "label": "Bridge"}])
    _geolocate(client, cid, video, "s1")
    shot = _capture(client, cid)

    scenes = client.get(f"/api/cases/{cid}/scenes", params={"video": video}).json()
    draft = next(s for s in scenes["scenes"] if s["kind"] == "draft")
    assert draft["state"] == "progress" and draft["captures"] == [shot["path"]]
    assert scenes["geolocating"] == "s1"
    # its place in the clip, which Inspect colours it by, travels with the queue and the pill
    assert _queue(client, cid)["files"][0]["scenes"][0]["order"] == 0
    assert client.get(f"/api/cases/{cid}/geolocating").json()["geolocating"]["order"] == 0

    # the proof the pill makes: the scene's frame beside the capture
    cut = client.post(f"/api/cases/{cid}/inspect/save-frames", json={"items": [{"path": video, "time": 1.5}]})
    frame = cut.json()["saved"][0]["item"]["path"]
    made = client.post(f"/api/cases/{cid}/proofs", json={"title": "Bridge", "spec": {"panels": [
        {"id": "p0", "src": frame}, {"id": "p1", "src": shot["path"]},
    ]}})
    assert made.status_code == 200, made.text
    name = made.json()["name"]
    res = client.put(f"/api/cases/{cid}/proofs/{name}/scene", json={"moments": [{"start": 1, "end": 2}], "video": video, "draft": "s1"})
    assert res.status_code == 200, res.text

    assert client.get(f"/api/cases/{cid}/geolocating").json() == {"geolocating": None}
    assert _queue(client, cid)["files"] == []
    assert client.get(f"/api/cases/{cid}/scenes", params={"video": video}).json()["geolocating"] is None


@needs_ffmpeg
def test_a_scene_s_order_is_its_place_among_the_video_s_scenes_proofs_included(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    frame = client.post(f"/api/cases/{cid}/inspect/save-frames", json={"items": [{"path": video, "time": 0.5}]})
    early = client.post(f"/api/cases/{cid}/proofs", json={"title": "Early", "spec": {"panels": [
        {"id": "p0", "src": frame.json()["saved"][0]["item"]["path"]},
    ]}})
    assert early.status_code == 200, early.text
    _save_work(client, cid, video, [
        {"id": "late", "start": 3, "end": None, "label": "Late"},
        {"id": "mid", "start": 1, "end": 2, "label": "Mid"},
    ])
    rows = {s["id"]: s["order"] for s in _queue(client, cid)["files"][0]["scenes"]}
    # the proof at 0:00.5 comes first, then the passage at 0:01, then the instant at 0:03
    assert rows == {"mid": 1, "late": 2}
    assert _geolocate(client, cid, video, "late").json()["geolocating"]["order"] == 2


def test_a_capture_attached_is_said_at_once_with_its_path_and_the_count(client, monkeypatch):
    from azimut.api import events

    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    heard = []
    monkeypatch.setattr(events, "publish", heard.append)
    first = _capture(client, cid)
    second = _capture(client, cid)
    said = [e for e in heard if e["type"] == "geolocating"]
    assert said == [
        {"type": "geolocating", "case_id": cid, "video": photo, "draft": "s1", "capture": first["path"], "captures": 1},
        {"type": "geolocating", "case_id": cid, "video": photo, "draft": "s1", "capture": second["path"], "captures": 2},
    ]


def test_saving_a_work_or_abandoning_a_scene_says_its_scenes_may_have_moved(client, monkeypatch):
    from azimut.api import events

    heard = []
    monkeypatch.setattr(events, "publish", heard.append)
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    assert {"type": "scenes", "case_id": cid, "video": photo} in heard
    # an autosave that changes nothing about the scenes says nothing
    heard.clear()
    _save_work(client, cid, photo, SCENES)
    assert heard == []
    moved = [{**SCENES[0], "label": "Roundabout north"}, SCENES[1]]
    _save_work(client, cid, photo, moved)
    assert {"type": "scenes", "case_id": cid, "video": photo} in heard
    heard.clear()
    client.put(f"/api/cases/{cid}/scenes/s2/abandon", json={"video": photo})
    assert {"type": "scenes", "case_id": cid, "video": photo} in heard
    heard.clear()
    client.delete(f"/api/cases/{cid}/scenes/s2/abandon", params={"video": photo})
    assert {"type": "scenes", "case_id": cid, "video": photo} in heard


# -- the extension -------------------------------------------------------------------


def _headers(client):
    return {"X-Azimut-Token": client.post("/api/settings/ingest-token").json()["ingest_token"]}


def test_the_extension_reads_the_queue_geolocates_and_its_captures_are_attached(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    headers = _headers(client)

    queue = client.get("/api/ingest/scenes", params={"case_id": cid}, headers=headers)
    assert queue.status_code == 200, queue.text
    assert [s["id"] for s in queue.json()["files"][0]["scenes"]] == ["s2", "s1"]

    res = client.post("/api/ingest/geolocating", json={"case_id": cid, "video": photo, "draft": "s1"}, headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["geolocating"]["id"] == "s1"

    shot = client.post(
        "/api/ingest/screenshot",
        files={"image": ("shot.png", _png((5, 90, 5)), "image/png")},
        data={"url": "https://www.google.com/maps/@48.8584,2.2945,17z", "case_id": cid},
        headers=headers,
    )
    assert shot.status_code == 200, shot.text
    assert shot.json()["scene"]["id"] == "s1"
    assert next(s for s in _stored(client, cid, photo) if s["id"] == "s1")["captures"] == [shot.json()["path"]]

    # one of the two only is refused; neither stops
    half = client.post("/api/ingest/geolocating", json={"case_id": cid, "video": photo}, headers=headers)
    assert half.status_code == 422
    stop = client.post("/api/ingest/geolocating", json={"case_id": cid}, headers=headers)
    assert stop.json() == {"geolocating": None}
    # and nothing without the pairing token
    assert client.get("/api/ingest/scenes", params={"case_id": cid}).status_code in (401, 403)


# -- what it leans on ----------------------------------------------------------------


def test_deleting_a_capture_a_scene_gathered_says_so(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
    _geolocate(client, cid, photo, "s1")
    shot = _capture(client, cid)
    client.delete(f"/api/cases/{cid}/geolocating")

    case = Case.open(cid)
    hows = [lean.how for _holder, lean in uses_engine._records(case) if lean.target == shot["path"]]
    assert hows == ["gathers it for a scene to geolocate"]


# -- a picture marked to geolocate --------------------------------------------------


def _mark(client, cid, path, label=""):
    return client.post(f"/api/cases/{cid}/scenes/mark", json={"path": path, "label": label})


def test_a_picture_is_marked_whole_once_and_queued_as_a_picture(client):
    cid = _case(client)
    photo = _upload(client, cid)
    res = _mark(client, cid, photo, "  Market  ")
    assert res.status_code == 200, res.text
    scene = res.json()["scene"]
    assert (scene["start"], scene["end"], scene["label"], scene["file_kind"]) == (None, None, "Market", "image")
    # marked again, it is the same scene
    assert _mark(client, cid, photo).json()["scene"]["id"] == scene["id"]
    [file] = _queue(client, cid)["files"]
    assert file["kind"] == "image" and [s["id"] for s in file["scenes"]] == [scene["id"]]
    # Inspect's own read of it
    listed = client.get(f"/api/cases/{cid}/scenes", params={"video": photo}).json()
    assert [s["kind"] for s in listed["scenes"]] == ["draft"]


def test_a_picture_is_proved_by_a_proof_laying_it_out_which_ends_its_geolocating(client):
    cid = _case(client)
    photo = _upload(client, cid)
    scene = _mark(client, cid, photo).json()["scene"]
    assert _geolocate(client, cid, photo, scene["id"]).status_code == 200
    shot = _capture(client, cid)
    assert shot["scene"]["id"] == scene["id"]

    made = client.post(f"/api/cases/{cid}/proofs", json={"title": "Market", "spec": {"panels": [
        {"id": "p0", "src": photo}, {"id": "p1", "src": shot["path"]},
    ]}})
    assert made.status_code == 200, made.text
    assert client.get(f"/api/cases/{cid}/geolocating").json() == {"geolocating": None}
    assert _queue(client, cid)["files"] == []
    listed = client.get(f"/api/cases/{cid}/scenes", params={"video": photo}).json()
    assert [(s["kind"], s.get("proof")) for s in listed["scenes"]] == [("proof", made.json()["name"])]
    assert listed["taken"] == [scene["id"]]
    assert _geolocate(client, cid, photo, scene["id"]).status_code == 400


def test_neither_a_capture_nor_a_frame_cut_from_a_video_is_marked(client, tmp_path):
    cid = _case(client)
    shot = _capture(client, cid)
    assert _mark(client, cid, shot["path"]).status_code == 400
    if media_engine.ffmpeg_available():
        video = _video(client, cid, tmp_path)
        cut = client.post(f"/api/cases/{cid}/inspect/save-frames", json={"items": [{"path": video, "time": 1.0}]})
        frame = cut.json()["saved"][0]["item"]["path"]
        assert _mark(client, cid, frame).status_code == 400
        # a whole video can be marked from outside Inspect too
        whole = _mark(client, cid, video)
        assert whole.status_code == 200 and whole.json()["scene"]["file_kind"] == "video"


# -- collages: one video's frames belong to its scenes; several sources make a picture ----


QUAD = [[0, 0], [64, 0], [64, 48], [0, 48]]


def _collage(client, cid, title, pieces, name=None):
    """A collage document of these (path, time) pieces, saved as the tool saves it."""
    nodes = [
        {"id": f"nd_{i}", "save": {"path": p, "time": t, "ops": []}, "w": 64, "h": 48, "quad": QUAD}
        for i, (p, t) in enumerate(pieces)
    ]
    res = client.post(f"/api/cases/{cid}/collages", json={
        "name": name, "title": title, "spec": {"width": 200, "height": 60, "nodes": nodes},
    })
    assert res.status_code == 200, res.text
    return res.json()["name"]


def _export(client, cid, name, pieces, label="Panorama"):
    res = client.post(f"/api/cases/{cid}/inspect/compose", json={
        "width": 200, "height": 60, "background": None, "label": label, "collage": name,
        "nodes": [{"src": {"path": p, "time": t, "ops": []}, "quad": QUAD} for p, t in pieces],
    })
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _record_export(client, cid, name, title, pieces, path):
    """The tool writes the picture it exported into its document."""
    nodes = [
        {"id": f"nd_{i}", "save": {"path": p, "time": t, "ops": []}, "w": 64, "h": 48, "quad": QUAD}
        for i, (p, t) in enumerate(pieces)
    ]
    signature = json.dumps([[n["save"], n["quad"]] for n in nodes])
    res = client.post(f"/api/cases/{cid}/collages", json={
        "name": name, "title": title,
        "spec": {"width": 200, "height": 60, "nodes": nodes, "exported": {"path": path, "signature": signature}},
    })
    assert res.status_code == 200, res.text


@needs_ffmpeg
def test_a_collage_of_one_video_belongs_to_it_and_marks_it(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    pieces = [(video, 1.0), (video, 2.5)]
    name = _collage(client, cid, "Bridge pano", pieces)
    picture = _export(client, cid, name, pieces)

    listed = client.get(f"/api/cases/{cid}/scenes", params={"video": video}).json()
    [row] = listed["collages"]
    assert (row["collage"], row["times"], row["start"], row["end"]) == (name, [1.0, 2.5], 1.0, 2.5)

    # marked from the Library, the collage marks its video, whole
    whole = client.post(f"/api/cases/{cid}/scenes/mark", json={"path": picture})
    assert whole.status_code == 200, whole.text
    assert (whole.json()["scene"]["video"], whole.json()["scene"]["start"]) == (video, None)
    # or over its period, from the Collage tool
    period = client.post(f"/api/cases/{cid}/scenes/mark", json={"path": video, "start": 1.0, "end": 2.5})
    assert period.status_code == 200, period.text
    assert (period.json()["scene"]["start"], period.json()["scene"]["end"]) == (1.0, 2.5)
    again = client.post(f"/api/cases/{cid}/scenes/mark", json={"path": picture, "start": 1.0, "end": 2.5})
    assert again.json()["scene"]["id"] == period.json()["scene"]["id"]

    # a proof of the collage alone states the video's scene, as a frame would let it
    made = client.post(f"/api/cases/{cid}/proofs", json={"title": "Pano", "spec": {"panels": [{"id": "p0", "src": picture}]}})
    assert made.status_code == 200, made.text
    stated = client.put(
        f"/api/cases/{cid}/proofs/{made.json()['name']}/scene",
        json={"moments": [{"start": 1.0, "end": 2.5}], "video": video, "draft": period.json()["scene"]["id"]},
    )
    assert stated.status_code == 200, stated.text
    assert [s["id"] for s in _queue(client, cid)["files"][0]["scenes"]] == [whole.json()["scene"]["id"]]


@needs_ffmpeg
def test_a_collage_exported_before_instants_were_recorded_is_read_from_its_document(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    pieces = [(video, 0.5)]
    name = _collage(client, cid, "Gate", pieces)
    picture = _export(client, cid, name, pieces)
    _record_export(client, cid, name, "Gate", pieces, picture)
    # as an older release wrote it: the files and no instants
    case = Case.open(cid)
    item = case.media_items_by_paths([picture])[0]
    sidecar = case.resolve_inside(f"media/.meta/{picture.split('/')[-1]}.json")
    data = json.loads(sidecar.read_text())
    data["source"].pop("times", None)
    sidecar.write_text(json.dumps(data))
    case.upsert_media_item({**item, "source": data["source"]}, entity_id=item.get("entity_id"))
    from azimut.engine import scenes as scenes_engine

    assert scenes_engine.frame_origins(case, [picture]) == {picture: (video, 0.5)}


def test_a_collage_of_several_pictures_is_a_picture_and_its_mark_follows_it(client):
    cid = _case(client)
    one = _upload(client, cid, "one.png", (10, 10, 10))
    two = _upload(client, cid, "two.png", (200, 10, 10))
    pieces = [(one, None), (two, None)]
    name = _collage(client, cid, "Both banks", pieces)
    first = _export(client, cid, name, pieces)
    _record_export(client, cid, name, "Both banks", pieces, first)
    mark = client.post(f"/api/cases/{cid}/scenes/mark", json={"path": first})
    assert mark.status_code == 200 and mark.json()["scene"]["file_kind"] == "image"
    scene = mark.json()["scene"]
    _geolocate(client, cid, first, scene["id"])
    shot = _capture(client, cid)

    # saved again, changed: a new picture, and the mark goes with it, captures and all
    second = _export(client, cid, name, [(two, None), (one, None)], label="Both banks again")
    assert second != first
    [file] = _queue(client, cid)["files"]
    assert file["video"] == second
    assert [s["id"] for s in file["scenes"]] == [scene["id"]]
    assert file["scenes"][0]["captures"] == [shot["path"]]
    assert client.get(f"/api/cases/{cid}/geolocating").json()["geolocating"]["video"] == second


def test_a_proved_collage_picture_keeps_its_mark_when_saved_again(client):
    cid = _case(client)
    one = _upload(client, cid, "one.png", (10, 10, 10))
    two = _upload(client, cid, "two.png", (200, 10, 10))
    pieces = [(one, None), (two, None)]
    name = _collage(client, cid, "Both banks", pieces)
    first = _export(client, cid, name, pieces)
    _record_export(client, cid, name, "Both banks", pieces, first)
    client.post(f"/api/cases/{cid}/scenes/mark", json={"path": first})
    client.post(f"/api/cases/{cid}/proofs", json={"title": "Banks", "spec": {"panels": [{"id": "p0", "src": first}]}})
    _export(client, cid, name, [(two, None), (one, None)], label="Both banks again")
    assert _queue(client, cid)["files"] == []
    listed = client.get(f"/api/cases/{cid}/scenes", params={"video": first}).json()
    assert [s["kind"] for s in listed["scenes"]] == ["proof"]


def test_a_picture_is_never_marked_over_a_moment(client):
    cid = _case(client)
    photo = _upload(client, cid)
    assert client.post(f"/api/cases/{cid}/scenes/mark", json={"path": photo, "start": 2}).status_code == 400


@needs_ffmpeg
def test_a_straightened_collage_of_one_video_keeps_its_video(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    pieces = [(video, 1.0), (video, 2.5)]
    # Straighten files the bent picture of the pieces, then the collage holds it alone
    bent = _export(client, cid, None, pieces, label="Pano straightened")
    name = _collage(client, cid, "Pano", [(bent, None)])
    [row] = client.get(f"/api/cases/{cid}/scenes", params={"video": video}).json()["collages"]
    assert (row["collage"], row["times"]) == (name, [1.0, 2.5])
    picture = _export(client, cid, name, [(bent, None)], label="Pano final")
    from azimut.engine import scenes as scenes_engine

    assert scenes_engine.frame_origins(Case.open(cid), [picture]) == {picture: (video, 1.0)}


def test_a_collage_keeps_the_areas_painted_out_of_its_stitch_and_refuses_bad_ones(client):
    cid = _case(client)
    one = _upload(client, cid, "one.png", (10, 10, 10))
    stroke = {"points": [[0.1, 0.2], [0.123456, 0.5]], "radius": 0.05}

    def save(exclude):
        return client.post(f"/api/cases/{cid}/collages", json={"name": None, "title": f"Brush {len(str(exclude))}", "spec": {
            "width": 200, "height": 60,
            "nodes": [{"id": "nd_0", "save": {"path": one, "time": None, "ops": []}, "w": 64, "h": 48, "quad": QUAD,
                       "exclude": exclude}],
        }})

    res = save([stroke])
    assert res.status_code == 200, res.text
    stored = Case.open(cid).resolve_inside(f".collages/{res.json()['name']}.json")
    node = json.loads(stored.read_text())["nodes"][0]
    assert node["exclude"] == [{"points": [[0.1, 0.2], [0.1235, 0.5]], "radius": 0.05}]
    # none painted: no key at all
    cleared = save([])
    assert "exclude" not in json.loads(Case.open(cid).resolve_inside(f".collages/{cleared.json()['name']}.json").read_text())["nodes"][0]
    for bad in (
        [{"points": [[1.2, 0.5]], "radius": 0.05}],
        [{"points": [[0.5, 0.5]], "radius": 0}],
        [{"points": [], "radius": 0.1}],
        [{"points": [[0.5, 0.5]], "radius": 0.1}] * 201,
        [{"points": [[0.5, 0.5]] * 401, "radius": 0.1}],
    ):
        assert save(bad).status_code == 400


def test_the_queue_names_the_collage_a_picture_was_exported_from(client):
    cid = _case(client)
    one = _upload(client, cid, "one.png", (10, 10, 10))
    two = _upload(client, cid, "two.png", (200, 10, 10))
    pieces = [(one, None), (two, None)]
    name = _collage(client, cid, "Both banks", pieces)
    picture = _export(client, cid, name, pieces)
    client.post(f"/api/cases/{cid}/scenes/mark", json={"path": picture})
    [file] = _queue(client, cid)["files"]
    assert (file["video"], file["collage"]) == (picture, name)
    plain = _upload(client, cid, "plain.png", (90, 90, 10))
    client.post(f"/api/cases/{cid}/scenes/mark", json={"path": plain})
    rows = {f["video"]: f for f in _queue(client, cid)["files"]}
    assert "collage" not in rows[plain]


def test_a_scene_takes_a_new_time_alone_and_says_the_time_it_had(client):
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, [{"id": "s1", "start": 4, "end": 9, "label": "Roundabout"}, SCENES[1]])
    res = client.put(f"/api/cases/{cid}/scenes/s1/time", json={"video": photo, "start": 5, "end": 12})
    assert res.status_code == 200, res.text
    assert res.json()["before"] == {"start": 4.0, "end": 9.0}
    stored = {s["id"]: s for s in _stored(client, cid, photo)}
    assert (stored["s1"]["start"], stored["s1"]["end"], stored["s1"]["label"]) == (5.0, 12.0, "Roundabout")
    # an instant, the whole video, and what a scene cannot be
    assert client.put(f"/api/cases/{cid}/scenes/s1/time", json={"video": photo, "start": 7}).status_code == 200
    assert {s["id"]: s for s in _stored(client, cid, photo)}["s1"]["end"] is None
    assert client.put(f"/api/cases/{cid}/scenes/s1/time", json={"video": photo, "start": 7, "end": 3}).status_code == 400
    assert client.put(f"/api/cases/{cid}/scenes/nope/time", json={"video": photo, "start": 1}).status_code == 400
