"""Cut for the post: a passage of a proof's ★ video cut into a case file of its own.

The cut is re-encoded for X and Bluesky, filed in Media, and kept on the proof's scene
as ``clip``. The same passage asked again answers the same file, and the clip is a use
of that file wherever the case asks what leans on it.
"""

from __future__ import annotations

import io
import json
import subprocess
import threading

import pytest
from jobwait import job_result, wait_for_job
from test_scenes import _case, _cut, _proof, _scenes, _upload_png, needs_ffmpeg

from azimut import layout
from azimut.api import postclips as clip_api
from azimut.engine import ffmpeg as ffmpeg_engine
from azimut.engine import media as media_engine
from azimut.engine import postclips as clip_engine
from azimut.workspace import Case


def _video(client, cid, tmp_path, name="clip.mp4", *, seconds=4, rate=10, sound=False, size="64x48") -> str:
    path = tmp_path / name
    args = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=s={size}:r={rate}:d={seconds}"]
    if sound:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-c:a", "aac"]
    subprocess.run([*args, "-pix_fmt", "yuv420p", "-shortest", str(path)], check=True)
    with path.open("rb") as fh:
        res = client.post(f"/api/cases/{cid}/media/upload", files={"file": (name, fh, "video/mp4")})
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _passage_proof(client, cid, video, title="Bridge", moments=None):
    frame = _cut(client, cid, video, 1.5)
    return _proof(client, cid, title, frame, scene={
        "video": video, "moments": moments or [{"start": 1.0, "end": 2.5}],
    })


def _cut_clip(client, cid, name, start, end):
    return client.post(f"/api/cases/{cid}/proofs/{name}/clip", json={"start": start, "end": end})


def _clip(client, cid, name, start=1.0, end=2.5):
    res = _cut_clip(client, cid, name, start, end)
    assert res.status_code == 200, res.text
    answer = res.json()
    if "job_id" in answer:
        answer = job_result(client, answer["job_id"])
    return answer["clip"]


def _spec(cid, name):
    case = Case.open(cid)
    return json.loads(case.resolve_inside(layout.proof_spec_rel(name)).read_text(encoding="utf-8"))


def _probe(cid, rel):
    path = Case.open(cid).resolve_inside(rel)
    out = subprocess.run(
        [ffmpeg_engine.ffprobe_exe(), "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, check=True,
    )
    data = json.loads(out.stdout)
    video = next(s for s in data["streams"] if s["codec_type"] == "video")
    audio = [s for s in data["streams"] if s["codec_type"] == "audio"]
    return float(data["format"]["duration"]), video, audio


def _media_paths(client, cid):
    page = client.get(f"/api/cases/{cid}/media/page", params={"limit": 500}).json()
    return sorted(item["path"] for item in page["items"])


# -- the cut -----------------------------------------------------------------------


@needs_ffmpeg
def test_a_passage_is_cut_into_a_clip_x_and_bluesky_both_take(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path, sound=True, size="320x180", rate=25)
    _passage_proof(client, cid, video)

    clip = _clip(client, cid, "Bridge")

    assert clip["path"].startswith("media/") and clip["path"].endswith(".mp4")
    assert (clip["start"], clip["end"]) == (1.0, 2.5)
    assert clip["title"] == "clip 0m01s–0m02s"
    assert clip["size"] == Case.open(cid).resolve_inside(clip["path"]).stat().st_size
    duration, stream, audio = _probe(cid, clip["path"])
    # cut on the frame, not on the keyframe before it
    assert abs(duration - 1.5) < 0.15
    assert (stream["codec_name"], stream["profile"], stream["pix_fmt"]) == ("h264", "High", "yuv420p")
    assert (stream["width"], stream["height"]) == (320, 180)
    assert [(a["codec_name"], a["channels"]) for a in audio] == [("aac", 2)]
    # filed like a file Inspect made, saying where it was cut from
    item = media_engine.read_item(Case.open(cid), clip["path"])
    assert item["kind"] == "video"
    assert {k: item["source"][k] for k in ("type", "op", "from", "start", "end", "proof")} == {
        "type": "inspect", "op": "clip", "from": video, "start": 1.0, "end": 2.5, "proof": "Bridge",
    }
    # kept on the proof's scene, and nothing else of it touched
    scene = _spec(cid, "Bridge")["scene"]
    assert scene == {
        "video": video, "moments": [{"start": 1.0, "end": 2.5}], "draft": None,
        "clip": {"path": clip["path"], "start": 1.0, "end": 2.5},
    }


@needs_ffmpeg
def test_a_clip_without_sound_has_none_and_a_big_picture_comes_down_to_1920(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path, size="2560x1440", seconds=2)
    _passage_proof(client, cid, video, moments=[{"start": 0.0, "end": 1.0}])

    clip = _clip(client, cid, "Bridge", 0.0, 1.0)

    _duration, stream, audio = _probe(cid, clip["path"])
    assert (stream["width"], stream["height"]) == (1920, 1080)
    assert audio == []


@needs_ffmpeg
def test_the_same_passage_again_answers_the_same_clip_and_files_nothing(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _passage_proof(client, cid, video)
    first = _clip(client, cid, "Bridge")
    before = _media_paths(client, cid)

    again = _cut_clip(client, cid, "Bridge", 1.0, 2.5)

    assert again.status_code == 200
    assert again.json() == {"clip": first}  # no job at all
    assert _media_paths(client, cid) == before


@needs_ffmpeg
def test_another_proof_of_the_same_passage_gets_the_clip_already_in_media(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _passage_proof(client, cid, video, "Bridge")
    _passage_proof(client, cid, video, "Market")
    first = _clip(client, cid, "Bridge")
    before = _media_paths(client, cid)

    other = _cut_clip(client, cid, "Market", 1.0, 2.5).json()

    assert other == {"clip": first}
    assert _media_paths(client, cid) == before
    assert _spec(cid, "Market")["scene"]["clip"]["path"] == first["path"]


@needs_ffmpeg
def test_two_presses_while_the_cut_runs_share_one_job(client, tmp_path, monkeypatch):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _passage_proof(client, cid, video)
    release = threading.Event()
    real = clip_engine.run

    def held_back(case, cut, set_progress):
        release.wait(10)
        return real(case, cut, set_progress)

    monkeypatch.setattr(clip_engine, "run", held_back)
    first = _cut_clip(client, cid, "Bridge", 1.0, 2.5).json()
    second = _cut_clip(client, cid, "Bridge", 1.0, 2.5).json()
    release.set()

    assert first == second and "job_id" in first
    job_result(client, first["job_id"])
    assert clip_api._running == {}


@needs_ffmpeg
def test_the_job_says_how_far_it_got(client, tmp_path, monkeypatch):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _passage_proof(client, cid, video)
    seen = []
    real = clip_engine._encode

    def watched(src, target, cut, set_progress):
        def keep(progress):
            seen.append(progress)
            set_progress(progress)

        real(src, target, cut, keep)

    monkeypatch.setattr(clip_engine, "_encode", watched)
    _clip(client, cid, "Bridge")

    percents = [p["percent"] for p in seen]
    assert percents and all(0 <= p <= 99 for p in percents)
    assert percents == sorted(percents)


# -- what is refused ---------------------------------------------------------------


@needs_ffmpeg
@pytest.mark.parametrize(
    ("start", "end", "words"),
    [
        (1.0, 9.0, "past the end of the video"),
        (2.0, 2.0, "end after it starts"),
        (3.0, 1.0, "end after it starts"),
        (0.0, 0.2, "half a second at least"),
        (0.0, 601.0, "ten minutes at most"),
        (-1.0, 2.0, "from 0"),
        (True, 2.0, "from 0"),
        ("1", 2.0, "from 0"),
    ],
)
def test_a_passage_outside_the_video_or_past_the_limits_is_refused(client, tmp_path, start, end, words):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _passage_proof(client, cid, video)

    res = _cut_clip(client, cid, "Bridge", start, end)

    assert res.status_code == 422
    assert words in res.json()["detail"]


def test_a_proof_on_pictures_alone_has_nothing_to_cut(client):
    cid = _case(client)
    _proof(client, cid, "Holiday", _upload_png(client, cid))

    res = _cut_clip(client, cid, "Holiday", 0.0, 2.0)

    assert res.status_code == 422
    assert res.json()["detail"] == "this proof rests on no video in the case"
    assert client.get(f"/api/cases/{cid}/proofs/Holiday/clip").json() == {
        "proof": "Holiday", "video": None, "clip": None,
    }


def test_a_proof_whose_scene_names_a_picture_has_nothing_to_cut(client):
    cid = _case(client)
    photo = _upload_png(client, cid)
    _proof(client, cid, "Still", photo, scene={"video": photo, "moments": [{"start": 0.0, "end": 2.0}]})

    res = _cut_clip(client, cid, "Still", 0.0, 2.0)

    assert res.status_code == 422


def test_an_unknown_proof_is_not_found(client):
    cid = _case(client)
    assert _cut_clip(client, cid, "Nobody", 0.0, 2.0).status_code == 404
    assert client.get(f"/api/cases/{cid}/proofs/Nobody/clip").status_code == 404


@needs_ffmpeg
def test_without_ffmpeg_the_cut_says_where_to_get_it(client, tmp_path, monkeypatch):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _passage_proof(client, cid, video)
    monkeypatch.setattr(ffmpeg_engine, "ffmpeg_available", lambda: False)

    res = _cut_clip(client, cid, "Bridge", 1.0, 2.5)

    assert res.status_code == 422
    assert res.json()["detail"] == clip_engine.NO_FFMPEG


@needs_ffmpeg
def test_a_cut_ffmpeg_cannot_make_fails_with_its_reason_and_leaves_nothing(client, tmp_path, monkeypatch):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _passage_proof(client, cid, video)
    before = _media_paths(client, cid)
    monkeypatch.setattr(clip_engine, "PRESET", "no-such-preset")

    answer = _cut_clip(client, cid, "Bridge", 1.0, 2.5).json()
    job = wait_for_job(client, answer["job_id"])

    assert job["status"] == "error"
    assert job["error"].startswith("ffmpeg could not cut this video")
    assert _media_paths(client, cid) == before
    assert "clip" not in _spec(cid, "Bridge")["scene"]
    assert not list(Case.open(cid).subdir("media").glob(".clip-*"))


# -- the clip, read back -----------------------------------------------------------


@needs_ffmpeg
def test_the_scene_tab_and_the_strip_read_the_clip_while_its_file_is_in_the_case(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _passage_proof(client, cid, video)
    assert client.get(f"/api/cases/{cid}/proofs/Bridge/clip").json() == {
        "proof": "Bridge", "video": video, "clip": None,
    }
    assert "clip" not in _scenes(client, cid, video)["scenes"][0]
    clip = _clip(client, cid, "Bridge")

    assert client.get(f"/api/cases/{cid}/proofs/Bridge/clip").json()["clip"] == clip
    assert _scenes(client, cid, video)["scenes"][0]["clip"] == clip

    # sent to the Trash, it reads as none; restored, it is back
    deleted = client.delete(f"/api/cases/{cid}/media", params={"path": clip["path"]}).json()
    assert client.get(f"/api/cases/{cid}/proofs/Bridge/clip").json()["clip"] is None
    assert "clip" not in _scenes(client, cid, video)["scenes"][0]
    assert client.post(f"/api/cases/{cid}/trash/{deleted['trash']}/restore").status_code == 200
    assert client.get(f"/api/cases/{cid}/proofs/Bridge/clip").json()["clip"] == clip


@needs_ffmpeg
def test_cut_again_after_the_clip_went_to_the_trash_makes_a_new_one(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _passage_proof(client, cid, video)
    first = _clip(client, cid, "Bridge")
    client.delete(f"/api/cases/{cid}/media", params={"path": first["path"]})

    res = _cut_clip(client, cid, "Bridge", 1.0, 2.5).json()

    assert "job_id" in res
    again = job_result(client, res["job_id"])["clip"]
    assert again["path"] in _media_paths(client, cid)


# -- the clip and the rest of the proof ---------------------------------------------


@needs_ffmpeg
def test_the_clip_stays_through_a_change_of_time_and_a_save_and_goes_when_the_star_moves(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    other = _video(client, cid, tmp_path, name="other.mp4", seconds=5)
    frame = _cut(client, cid, video, 1.5)
    confirm = _cut(client, cid, other, 1.0)
    _proof(client, cid, "Bridge", frame, confirm, scene={"video": video, "moments": [{"start": 1.0, "end": 2.5}]})
    clip = _clip(client, cid, "Bridge")
    held = {"path": clip["path"], "start": 1.0, "end": 2.5}

    # another time: the clip stays, even with the passage gone
    res = client.put(f"/api/cases/{cid}/proofs/Bridge/scene", json={"moments": [{"start": 3.0, "end": None}]})
    assert res.status_code == 200, res.text
    assert _spec(cid, "Bridge")["scene"]["clip"] == held
    # the whole video again: the scene stays for the clip's sake
    client.put(f"/api/cases/{cid}/proofs/Bridge/scene", json={"moments": []})
    assert _spec(cid, "Bridge")["scene"] == {"video": video, "moments": [], "draft": None, "clip": held}
    # a save from Geo Proof names no scene and keeps it
    _proof(client, cid, "Bridge", frame, confirm)
    assert _spec(cid, "Bridge")["scene"]["clip"] == held
    # the ★ moved to the other video: the clip is let go, its file stays in Media
    res = client.put(f"/api/cases/{cid}/proofs/Bridge/scene", json={"moments": [], "video": other})
    assert res.status_code == 200, res.text
    assert "clip" not in _spec(cid, "Bridge")["scene"]
    assert clip["path"] in _media_paths(client, cid)


@needs_ffmpeg
def test_deleting_the_clip_names_the_proof_that_keeps_it(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    _passage_proof(client, cid, video)
    clip = _clip(client, cid, "Bridge")

    impact = client.post(f"/api/cases/{cid}/delete-impact", json={"paths": [clip["path"]]}).json()

    assert {row["label"]: row["how"] for row in impact["touched"]} == {"Bridge": ["keeps it as the clip for its post"]}
    page = client.get(f"/api/cases/{cid}/media/page", params={"unused": "true", "limit": 500}).json()
    assert clip["path"] not in {item["path"] for item in page["items"]}


@needs_ffmpeg
def test_a_proof_sent_to_the_trash_keeps_its_clip_when_restored(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path)
    proof = _passage_proof(client, cid, video)
    clip = _clip(client, cid, "Bridge")
    entity = Case.open(cid).find_entity(attr="spec", value=proof["spec_path"])

    deleted = client.delete(f"/api/cases/{cid}/entities/{entity['id']}")
    assert deleted.status_code == 200, deleted.text
    restored = client.post(f"/api/cases/{cid}/trash/{deleted.json()['trash']}/restore")
    assert restored.status_code == 200, restored.text

    assert _spec(cid, "Bridge")["scene"]["clip"] == {"path": clip["path"], "start": 1.0, "end": 2.5}


# -- the pieces, without ffmpeg ---------------------------------------------------


# -- the contact sheet ------------------------------------------------------------------


def _sheet_bytes(size=(1600, 900), kind="JPEG", color=(20, 23, 28)) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, kind)
    return out.getvalue()


def _file_sheet(client, cid, video, data, name="sheet.jpg"):
    return client.post(
        f"/api/cases/{cid}/scenes/sheet", data={"video": video}, files={"image": (name, io.BytesIO(data), "image/jpeg")},
    )


@needs_ffmpeg
def test_a_contact_sheet_is_filed_in_media_made_from_its_video(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path, "convoy.mp4")

    res = _file_sheet(client, cid, video, _sheet_bytes())

    assert res.status_code == 200, res.text
    path = res.json()["path"]
    assert path == "media/convoy contact sheet.jpg"
    item = media_engine.read_item(Case.open(cid), path)
    assert item["kind"] == "image"
    assert (item["source"]["type"], item["source"]["op"], item["source"]["from"]) == ("inspect", "sheet", video)
    case = Case.open(cid)
    sheet = case.find_entity(attr="path", value=path)
    made_from = [link["to"] for link in case.links_of(sheet["id"]) if link["type"] == "derived-from" and link["from"] == sheet["id"]]
    assert made_from == [case.find_entity(attr="path", value=video)["id"]]

    # the same picture again is the same file
    again = _file_sheet(client, cid, video, _sheet_bytes())
    assert again.json()["path"] == path
    assert len([one for one in case.list_media_items() if "contact sheet" in one["path"]]) == 1


@needs_ffmpeg
def test_a_contact_sheet_is_refused_unless_it_is_a_sheet_of_a_video_of_the_case(client, tmp_path):
    cid = _case(client)
    video = _video(client, cid, tmp_path, "convoy.mp4")
    photo = _upload_png(client, cid)

    assert _file_sheet(client, cid, photo, _sheet_bytes()).status_code == 422
    assert _file_sheet(client, cid, "media/none.mp4", _sheet_bytes()).status_code == 422
    assert _file_sheet(client, cid, video, b"not a picture").status_code == 422
    assert _file_sheet(client, cid, video, _sheet_bytes(size=(4000, 900))).status_code == 422
    assert _file_sheet(client, cid, video, _sheet_bytes(kind="GIF")).status_code == 422
    assert _file_sheet(client, cid, video, b"x" * (clip_engine.SHEET_MAX_BYTES + 1)).status_code == 413
    assert not [one for one in Case.open(cid).list_media_items() if "contact sheet" in one["path"]]


def test_progress_reads_microseconds_off_either_key():
    assert clip_engine._progress_at("out_time_us=1500000\n") == 1.5
    assert clip_engine._progress_at("out_time_ms=2000000") == 2.0
    assert clip_engine._progress_at("out_time=00:00:01.500000") is None
    assert clip_engine._progress_at("out_time_us=N/A") is None
    assert clip_engine._progress_at("progress=end") is None


def test_a_clip_is_named_with_no_colon_in_it():
    assert clip_engine._clock(0.0) == "0m00s"
    assert clip_engine._clock(65.9) == "1m05s"
    assert clip_engine._clock(3725.0) == "1h02m05s"


def test_the_encode_caps_the_frame_rate_only_past_60(tmp_path):
    def graph(fps):
        cut = clip_engine.Cut(proof="p", video="media/v.mp4", start=1.0, end=3.0, length=2.0, fps=fps)
        command = clip_engine._command(tmp_path / "in.mp4", tmp_path / "out.mp4", cut)
        return command[command.index("-vf") + 1], command

    assert "fps=" not in graph(30.0)[0]
    assert "fps=" not in graph(None)[0]
    assert graph(120.0)[0].endswith(",fps=60,format=yuv420p")
    command = graph(30.0)[1]
    # the start before the input, the length after it: a frame-exact cut
    assert command.index("-ss") < command.index("-i") < command.index("-t")
    assert command[command.index("-t") + 1] == "2.000"
    assert "-map_metadata" in command and "+faststart" in command


def test_the_longest_clip_stays_under_bluesky_file_limit():
    """Ten minutes at the capped rate, sound included, is under 300 MB."""
    video = int(clip_engine.MAXRATE.removesuffix("k")) * 1000
    audio = int(clip_engine.AUDIO_RATE.removesuffix("k")) * 1000
    assert (video + audio) * clip_engine.MAX_SECONDS / 8 < 300_000_000 * 0.95
