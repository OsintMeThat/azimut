"""Geolocating a scene: the captures it gathers, its states, and the queue of those left.

A scene still to prove reads To geolocate until a capture is attached to it, In progress
while it holds one, Proved once a proof takes it up, and Abandoned when the analyst
gives up on it. While one is being geolocated, every capture filed in the case is
attached to it on the server, from the app's map tools or from the extension.
"""

from __future__ import annotations

import io
import subprocess

import pytest
from PIL import Image

from azimut.engine import geolocate
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
    assert shot["scene"] == {"video": photo, "id": "s1", "label": "Roundabout"}
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


def test_saving_a_work_or_abandoning_a_scene_says_its_scenes_may_have_moved(client, monkeypatch):
    from azimut.api import events

    heard = []
    monkeypatch.setattr(events, "publish", heard.append)
    cid = _case(client)
    photo = _upload(client, cid)
    _save_work(client, cid, photo, SCENES)
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
