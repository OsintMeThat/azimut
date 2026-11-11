"""The whole video, said or not said, on a proof of a video.

A proof that states no scene is read off its frames, about the whole video, and Geo
Proof may propose the scene still to prove its frames fall in. The whole video asked for
is the analyst's answer: it is kept on the proof (`scene.moments == []`), so nothing is
proposed in its place again, and only ``traced``, the Undo of a first time, takes the
proof back to its frames. A proof that never stated a scene reads exactly as before.
"""

from __future__ import annotations

import json
import subprocess

import pytest

from azimut import layout
from azimut.engine import media as media_engine
from azimut.workspace import Case

needs_ffmpeg = pytest.mark.skipif(not media_engine.ffmpeg_available(), reason="ffmpeg not installed")


def _case(client) -> str:
    return client.post("/api/cases", json={"name": "Whole video"}).json()["id"]


def _video(client, cid, tmp_path) -> str:
    path = tmp_path / "clip.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=64x48:r=10:d=4",
         "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    with path.open("rb") as fh:
        res = client.post(f"/api/cases/{cid}/media/upload", files={"file": ("clip.mp4", fh, "video/mp4")})
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _proof(client, cid, video, title="Lookout", time=1.5) -> None:
    """A proof made by hand on a frame cut from the clip, stating nothing."""
    cut = client.post(f"/api/cases/{cid}/inspect/save-frames", json={"items": [{"path": video, "time": time}]})
    assert cut.status_code == 200, cut.text
    src = cut.json()["saved"][0]["item"]["path"]
    res = client.post(f"/api/cases/{cid}/proofs", json={"title": title, "spec": {"panels": [{"id": "p0", "src": src}]}})
    assert res.status_code == 200, res.text


def _spec(cid, name="Lookout") -> dict:
    return json.loads(Case.open(cid).resolve_inside(layout.proof_spec_rel(name)).read_text(encoding="utf-8"))


def _row(client, cid, video, name="Lookout") -> dict:
    scenes = client.get(f"/api/cases/{cid}/scenes", params={"video": video}).json()["scenes"]
    return next(s for s in scenes if s["kind"] == "proof" and s["proof"] == name)


def _put(client, cid, body, name="Lookout"):
    return client.put(f"/api/cases/{cid}/proofs/{name}/scene", json=body)


def _queued(client, cid) -> list[str]:
    files = client.get(f"/api/cases/{cid}/scenes/queue").json()["files"]
    return [p["id"] for f in files for p in f.get("proofs", [])]


@needs_ffmpeg
def test_a_proof_that_never_stated_a_scene_reads_as_before(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, video)
    assert "scene" not in _spec(cid)
    row = _row(client, cid, video)
    assert (row["moments"], row["stated"], row["draft"]) == ([], False, None)
    assert row["at"] == [pytest.approx(1.5, abs=0.11)]
    # Geo Proof's save sends no scene: the proof keeps none
    spec = client.get(f"/api/cases/{cid}/proofs/Lookout").json()
    assert "scene" not in spec
    client.post(f"/api/cases/{cid}/proofs", json={"rename_from": "Lookout", "title": "Lookout", "spec": {"panels": spec["panels"]}})
    assert "scene" not in _spec(cid)
    # a proof traced off its frames was never asked to be one of the video's places
    assert _queued(client, cid) == []


@needs_ffmpeg
def test_the_whole_video_asked_for_is_kept_and_read_back_by_both_tabs(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, video)
    assert _put(client, cid, {"moments": [{"start": 1.0, "end": 2.0}]}).status_code == 200

    res = _put(client, cid, {"moments": []})
    assert res.status_code == 200, res.text
    assert res.json() == {"proof": "Lookout", "video": video, "moments": [], "at": [pytest.approx(1.5, abs=0.11)], "stated": True, "draft": None}
    assert _spec(cid)["scene"] == {"video": video, "moments": [], "draft": None}
    # Inspect's row and Geo Proof's open read the same: the whole video, said
    row = _row(client, cid, video)
    assert (row["moments"], row["stated"]) == ([], True)
    assert client.get(f"/api/cases/{cid}/proofs/Lookout").json()["scene"] == {"video": video, "moments": [], "draft": None}
    # a save from Geo Proof keeps it
    spec = client.get(f"/api/cases/{cid}/proofs/Lookout").json()
    client.post(f"/api/cases/{cid}/proofs", json={"rename_from": "Lookout", "title": "Lookout", "spec": {"panels": spec["panels"]}})
    assert _spec(cid)["scene"] == {"video": video, "moments": [], "draft": None}
    # said about the video and no place yet: the To-do counts it, as any proof stating its scene
    assert _queued(client, cid) == ["proof:Lookout"]


@needs_ffmpeg
def test_traced_takes_a_first_time_back_to_the_frames_byte_for_byte(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, video)
    path = Case.open(cid).resolve_inside(layout.proof_spec_rel("Lookout"))
    before = path.read_bytes()
    assert _put(client, cid, {"moments": []}).status_code == 200
    assert "scene" in _spec(cid)

    res = _put(client, cid, {"moments": [], "traced": True})
    assert res.status_code == 200, res.text
    assert res.json()["stated"] is False
    assert path.read_bytes() == before


@needs_ffmpeg
def test_traced_lets_the_scene_taken_up_go_back_to_geolocate(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    work = {"path": video, "spec": {"frames": [], "scenes": [{"id": "s1", "start": 1.0, "end": 2.0, "label": "Mast?"}]}}
    assert client.put(f"/api/cases/{cid}/inspect/work", json=work).status_code == 200
    _proof(client, cid, video)
    drafts = lambda: [s["id"] for s in client.get(f"/api/cases/{cid}/scenes", params={"video": video}).json()["scenes"] if s["kind"] == "draft"]  # noqa: E731
    assert drafts() == ["s1"]

    # Take it up: the scene's time, and the scene hidden while the proof cites it
    assert _put(client, cid, {"moments": [{"start": 1.0, "end": 2.0}], "video": video, "draft": "s1"}).status_code == 200
    assert drafts() == []
    # its Undo: back to the frames, the scene listed again
    assert _put(client, cid, {"moments": [], "video": video, "traced": True}).status_code == 200
    assert "scene" not in _spec(cid)
    assert drafts() == ["s1"]


@needs_ffmpeg
def test_traced_states_no_time_and_takes_no_scene(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, video)
    assert _put(client, cid, {"moments": [{"start": 1.0, "end": None}], "traced": True}).status_code == 422
    assert _put(client, cid, {"moments": [], "draft": "s1", "traced": True}).status_code == 422
    assert _put(client, cid, {"moments": [], "traced": "yes"}).status_code == 422
    assert "scene" not in _spec(cid)


@needs_ffmpeg
def test_a_proof_said_about_the_whole_video_gives_one_scene_back_as_a_traced_one_does(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, video)
    assert _put(client, cid, {"moments": []}).status_code == 200

    deleted = client.delete(f"/api/cases/{cid}/proofs/Lookout")
    assert deleted.status_code == 200, deleted.text
    scenes = client.get(f"/api/cases/{cid}/inspect/work", params={"path": video}).json()["work"]["spec"]["scenes"]
    assert [(s["start"], s["end"], s["label"]) for s in scenes] == [(None, None, "Lookout")]
    # restored, it says the whole video again, the scene it gave hidden
    client.post(f"/api/cases/{cid}/trash/{deleted.json()['trash']}/restore")
    row = _row(client, cid, video)
    assert (row["moments"], row["stated"]) == ([], True)
    assert [s for s in client.get(f"/api/cases/{cid}/scenes", params={"video": video}).json()["scenes"] if s["kind"] == "draft"] == []


@needs_ffmpeg
def test_a_proof_row_carries_its_point_plus_code(client, tmp_path):
    """The thread labels two places of one region apart by their plus codes."""
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _proof(client, cid, video)
    assert _row(client, cid, video)["plus_code"] == ""
    spec = client.get(f"/api/cases/{cid}/proofs/Lookout").json()
    point = {"lat": 16.01874, "lon": 45.528599, "coords": "16.018740, 45.528599"}
    res = client.post(
        f"/api/cases/{cid}/proofs",
        json={"rename_from": "Lookout", "title": "Lookout", "spec": {"panels": spec["panels"], "points": [point]}},
    )
    assert res.status_code == 200, res.text
    assert _row(client, cid, video)["plus_code"] == "7H872G9H+FC"
