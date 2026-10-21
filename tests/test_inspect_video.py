"""Inspect's frame-exact extraction, richer probe, adjust filters and video overview.

Everything that needs ffmpeg is skipped when it is not installed; the filter tests are
Pillow/OpenCV only.
"""

from __future__ import annotations

import io
import json
import subprocess

import numpy as np
import pytest
from jobwait import job_result
from PIL import Image

from azimut.engine import inspect as ie
from azimut.engine import media as media_engine
from azimut.engine import thumbnails
from azimut.workspace import Case

needs_ffmpeg = pytest.mark.skipif(not media_engine.ffmpeg_available(), reason="ffmpeg not installed")


def _ffmpeg(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def _upload_video(client, cid, path):
    with path.open("rb") as fh:
        return client.post(
            f"/api/cases/{cid}/media/upload", files={"file": (path.name, fh, "video/mp4")}
        ).json()["item"]


# --- frame-exact extraction -------------------------------------------------


def _numbered(tmp_path, rate):
    """A lossless clip whose frame N is a flat grey of luma N*4."""
    out = tmp_path / f"n{rate.replace('/', '_')}.mp4"
    _ffmpeg("-f", "lavfi", "-i", f"color=c=black:s=64x64:r={rate}:d=2,format=gray,geq=lum='N*4'",
            "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv444p", str(out))
    return out


def _frame_number(img: Image.Image) -> int:
    return (round(float(np.asarray(img.convert("L")).mean())) + 2) // 4


@needs_ffmpeg
@pytest.mark.parametrize("k", [0, 1, 7, 24, 33, 49])
def test_extract_frame_at_a_frames_own_timestamp_returns_that_frame(tmp_path, k):
    video = _numbered(tmp_path, "25")
    assert _frame_number(ie.extract_frame(video, k / 25)) == k


@needs_ffmpeg
@pytest.mark.parametrize("k", [1, 2, 3, 11, 29, 45])
def test_extract_frame_holds_on_29_97_fps_where_millisecond_rounding_overshot(tmp_path, k):
    video = _numbered(tmp_path, "30000/1001")
    assert _frame_number(ie.extract_frame(video, k * 1001 / 30000)) == k


@needs_ffmpeg
def test_frame_time_at_names_the_frame_whose_interval_holds_the_time(tmp_path):
    video = _numbered(tmp_path, "25")
    assert ie.frame_time_at(video, 0.5) == 0.48
    assert ie.frame_time_at(video, 0.48) == 0.48
    assert ie.frame_time_at(video, 0.0) == 0.0
    assert ie.frame_time_at(video, 1.999) == 1.96
    assert ie.frame_time_at(video, 99) == 1.96  # past the end: the last frame
    for t in (0.3, 0.77, 1.5):
        shown = ie.frame_time_at(video, t)
        assert _frame_number(ie.extract_frame(video, shown)) == round(shown * 25)


@needs_ffmpeg
def test_frame_time_at_on_a_variable_rate_clip_is_a_real_packet_time(tmp_path):
    video = tmp_path / "vfr.mp4"
    # 25 fps for the first second, then 5 fps; frame N is luma N*4 again
    _ffmpeg("-f", "lavfi", "-i", "color=c=black:s=64x64:r=25:d=2,format=gray,geq=lum='N*4'",
            "-vf", "setpts='if(lt(N,25),N/25,1+(N-25)/5)/TB'", "-fps_mode", "vfr",
            "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv444p", str(video))
    assert ie.frame_time_at(video, 0.5) == 0.48
    assert ie.frame_time_at(video, 1.1) == 1.0
    assert ie.frame_time_at(video, 1.25) == 1.2
    assert _frame_number(ie.extract_frame(video, ie.frame_time_at(video, 1.25))) == 26


def test_frame_time_at_without_ffprobe_is_unknown(tmp_path, monkeypatch):
    monkeypatch.setattr(ie.ffmpeg_engine, "ffprobe_available", lambda: False)
    assert ie.frame_time_at(tmp_path / "v.mp4", 1.0) is None


def test_the_seek_sits_a_hair_under_the_timestamp(tmp_path, monkeypatch):
    seen = {}

    def fake_run(cmd, **kwargs):
        seen["cmd"] = cmd
        buf = io.BytesIO()
        Image.new("RGB", (4, 4)).save(buf, "PNG")
        return subprocess.CompletedProcess(cmd, 0, buf.getvalue(), b"")

    monkeypatch.setattr(media_engine, "ffmpeg_available", lambda: True)
    monkeypatch.setattr(ie.subprocess, "run", fake_run)
    ie.extract_frame(tmp_path / "v.mp4", 1.0)
    assert seen["cmd"][seen["cmd"].index("-ss") + 1] == f"{1.0 - ie.FRAME_EPS:.6f}"
    ie.extract_frame(tmp_path / "v.mp4", 0.0)
    assert seen["cmd"][seen["cmd"].index("-ss") + 1] == "0.000000"


def _reset_frame_cache():
    with ie._frame_cache_lock:
        ie._frame_cache.clear()
        ie._frame_cache_pixels = 0


def test_a_decoded_frame_is_cached_and_handed_out_as_a_copy(tmp_path, monkeypatch):
    _reset_frame_cache()
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    calls = []

    def fake_extract(path, time_s):
        calls.append(time_s)
        return Image.new("RGB", (8, 8), (10, 20, 30))

    monkeypatch.setattr(ie, "extract_frame", fake_extract)
    first = ie._cached_frame(video, 1.25)
    first.putpixel((0, 0), (255, 255, 255))  # a caller may mutate what it was given
    second = ie._cached_frame(video, 1.25)
    ie._cached_frame(video, 1.2500004)  # rounds to the same key
    assert calls == [1.25]
    assert second.getpixel((0, 0)) == (10, 20, 30)
    ie._cached_frame(video, 2.0)
    assert calls == [1.25, 2.0]
    video.write_bytes(b"changed")  # a new size/mtime is a new key
    ie._cached_frame(video, 1.25)
    assert calls == [1.25, 2.0, 1.25]
    _reset_frame_cache()


def test_the_frame_cache_is_bounded_by_pixels(tmp_path, monkeypatch):
    _reset_frame_cache()
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    calls = []
    monkeypatch.setattr(ie, "FRAME_CACHE_PIXELS", 3 * 100)
    monkeypatch.setattr(
        ie, "extract_frame", lambda p, t: calls.append(t) or Image.new("RGB", (10, 10))
    )
    for t in (1, 2, 3, 4):
        ie._cached_frame(video, t)
    assert ie._frame_cache_pixels <= 300
    assert len(ie._frame_cache) == 3
    calls.clear()
    ie._cached_frame(video, 4)  # newest stays
    ie._cached_frame(video, 1)  # oldest was evicted
    assert calls == [1]
    _reset_frame_cache()


# --- richer probe -----------------------------------------------------------


def _clip(tmp_path, name, audio):
    out = tmp_path / name
    args = ["-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=25"]
    if audio:
        args += ["-f", "lavfi", "-i", "sine=frequency=440:duration=2"]
    _ffmpeg(*args, "-c:v", "libx264", *(["-c:a", "aac"] if audio else []), str(out))
    return out


@needs_ffmpeg
def test_probe_reports_the_extra_video_facts(client, tmp_path):
    cid = client.post("/api/cases", json={"name": "Probe"}).json()["id"]
    with_sound = _upload_video(client, cid, _clip(tmp_path, "sound.mp4", True))
    silent = _upload_video(client, cid, _clip(tmp_path, "silent.mp4", False))
    case = Case.open(cid)

    info = ie.probe(case, with_sound["path"])
    assert info["audio"] is True and info["audio_codec"] == "aac"
    assert info["pix_fmt"].startswith("yuv")
    assert info["size"] > 0 and info["bit_rate"] > 0
    assert info["frames"] == 50
    assert info["vfr"] is False
    assert info["rotation"] is None
    assert len(info["encoder"]) <= 120

    assert ie.probe(case, silent["path"])["audio"] is False
    assert ie.probe(case, silent["path"])["audio_codec"] is None


def test_probe_extras_read_rotation_encoder_and_variable_rate():
    stream = {
        "avg_frame_rate": "25/1", "r_frame_rate": "30/1", "pix_fmt": "yuv420p",
        "side_data_list": [{"side_data_type": "Display Matrix", "rotation": -90}],
        "tags": {"encoder": "  " + "x" * 200},
    }
    extras = ie._probe_extras({"format": {"bit_rate": "1000", "size": "55"}, "streams": [stream]}, stream)
    assert extras["rotation"] == -90 and extras["vfr"] is True
    assert extras["encoder"] == "x" * 120
    assert extras["bit_rate"] == 1000 and extras["size"] == 55 and extras["frames"] is None
    old = {"avg_frame_rate": "25/1", "r_frame_rate": "25/1", "tags": {"rotate": "90"}}
    assert ie._probe_extras({"format": {"tags": {"encoder": "Lavf"}}, "streams": [old]}, old)["rotation"] == 90
    assert ie._probe_extras({"format": {"tags": {"encoder": "Lavf"}}, "streams": [old]}, old)["encoder"] == "Lavf"


def test_probe_image_reports_format_and_mode(client):
    cid = client.post("/api/cases", json={"name": "Probe"}).json()["id"]
    buf = io.BytesIO()
    Image.new("RGB", (10, 8)).save(buf, "PNG")
    item = client.post(
        f"/api/cases/{cid}/media/upload", files={"file": ("a.png", io.BytesIO(buf.getvalue()), "image/png")}
    ).json()["item"]
    info = ie.probe(Case.open(cid), item["path"])
    assert info["format"] == "PNG" and info["mode"] == "RGB"


# --- adjust filters ---------------------------------------------------------


def _run(name, image, **params):
    return ie.apply_ops(image, [{"op": name, "params": params}])


def _noisy(size=(96, 96), sigma=25, seed=1):
    rng = np.random.default_rng(seed)
    arr = np.clip(rng.normal(128, sigma, (size[1], size[0], 3)), 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def _gradient(lo, hi, size=(128, 64)):
    ramp = np.linspace(lo, hi, size[0]).astype(np.uint8)
    return Image.fromarray(np.tile(ramp, (size[1], 1))).convert("RGB")


def _same(a, b):
    return np.array_equal(np.asarray(a.convert("RGB")), np.asarray(b.convert("RGB")))


@pytest.mark.parametrize("name,params", [
    ("denoise", {"amount": 0}), ("autolevels", {"on": 0}), ("clahe", {"amount": 0}),
    ("channel", {"pick": 0}), ("denoise", {}), ("channel", {"pick": "junk"}),
    ("clahe", {"amount": "junk"}),
])
def test_new_filters_are_the_identity_at_their_defaults(name, params):
    img = _noisy()
    assert _same(_run(name, img, **params), img)


def test_denoise_lowers_the_noise_of_a_flat_patch():
    img = _noisy()
    out = _run("denoise", img, amount=12)
    assert np.asarray(out).std() < np.asarray(img).std() / 2


def test_autolevels_widens_a_narrow_histogram():
    img = _gradient(100, 140)
    before = np.asarray(img)
    after = np.asarray(_run("autolevels", img, on=1))
    assert (after.max() - after.min()) > 2 * (before.max() - before.min())


def test_clahe_changes_a_low_contrast_gradient():
    img = _gradient(110, 150)
    assert not _same(_run("clahe", img, amount=3), img)


@pytest.mark.parametrize("pick,band", [(1, 0), (2, 1), (3, 2)])
def test_channel_replicates_one_band(pick, band):
    img = _noisy()
    out = np.asarray(_run("channel", img, pick=pick))
    src = np.asarray(img)
    assert np.array_equal(out[..., 0], src[..., band])
    assert np.array_equal(out[..., 1], src[..., band]) and np.array_equal(out[..., 2], src[..., band])


@pytest.mark.parametrize("name", ["denoise", "autolevels", "clahe", "channel"])
def test_new_filters_keep_the_alpha_channel(name):
    img = _noisy().convert("RGBA")
    img.putalpha(Image.new("L", img.size, 77))
    out = ie.apply_ops(img, [{"op": name, "params": {"amount": 5, "on": 1, "pick": 2}}])
    assert out.mode == "RGBA" and out.getchannel("A").getextrema() == (77, 77)


# --- video overview and shots ---------------------------------------------


def _two_shots(tmp_path):
    out = tmp_path / "shots.mp4"
    _ffmpeg("-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=25",
            "-f", "lavfi", "-i", "smptebars=duration=2:size=160x120:rate=25",
            "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out))
    return out


@needs_ffmpeg
def test_a_hard_cut_makes_two_shots(client, tmp_path):
    cid = client.post("/api/cases", json={"name": "Shots"}).json()["id"]
    item = _upload_video(client, cid, _two_shots(tmp_path))
    job = client.post(f"/api/cases/{cid}/inspect/suggest", json={"path": item["path"], "count": 3}).json()

    result = job_result(client, job["job_id"])

    assert len(result["frames"]) >= 1 and result["frames"][0]["rank"] == 0
    shots = result["shots"]
    assert len(shots) == 2
    assert shots[0]["start"] == 0 and shots[0]["end"] == pytest.approx(2.0, abs=0.1)
    assert shots[1]["start"] == pytest.approx(2.0, abs=0.1)
    for shot in shots:
        assert shot["start"] <= shot["best"] < shot["end"]
    # the scan outlives the job: reopening the video gets it back
    again = client.post(f"/api/cases/{cid}/inspect/overview", json={"path": item["path"]}).json()
    assert again["scan"] == result


@needs_ffmpeg
def test_a_continuous_clip_has_no_cuts(client, tmp_path):
    cid = client.post("/api/cases", json={"name": "One shot"}).json()["id"]
    item = _upload_video(client, cid, _clip(tmp_path, "calm.mp4", False))
    scan = ie.scan_video(Case.open(cid), item["path"])
    assert scan["cuts"] == []
    assert len(ie._shots(scan, 2.0)) == 1


def test_shots_are_capped_to_the_strongest_cuts():
    frames = [{"time": float(i), "score": 1.0} for i in range(1000)]
    cuts = [{"time": float(i), "score": float(i % 50)} for i in range(1, 600)]
    shots = ie._shots({"frames": frames, "cuts": cuts}, 1000.0)
    assert len(shots) == ie.SHOTS_CAP
    assert [s["start"] for s in shots] == sorted(s["start"] for s in shots)
    kept = {s["start"] for s in shots[1:]}
    assert min(c["score"] for c in cuts if float(c["time"]) in kept) >= 25


def _av(tmp_path, audio=True, seconds=3):
    out = tmp_path / f"av{int(audio)}.mp4"
    args = ["-f", "lavfi", "-i", f"testsrc=duration={seconds}:size=320x180:rate=25"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}"]
    _ffmpeg(*args, "-c:v", "libx264", "-pix_fmt", "yuv420p", *(["-c:a", "aac"] if audio else []), str(out))
    return out


@needs_ffmpeg
def test_overview_is_made_by_a_job_then_served_from_the_cache(client, tmp_path):
    cid = client.post("/api/cases", json={"name": "Overview"}).json()["id"]
    item = _upload_video(client, cid, _av(tmp_path))
    url = f"/api/cases/{cid}/inspect/overview"

    assert client.get(url + "/strip", params={"path": item["path"]}).status_code == 404
    first = client.post(url, json={"path": item["path"]}).json()
    assert "job_id" in first and first["scan"] is None
    overview = job_result(client, first["job_id"])

    assert overview["duration"] == pytest.approx(3.0, abs=0.2)
    tiles = overview["tiles"]
    assert (tiles["count"], tiles["columns"], tiles["rows"], tiles["width"]) == (3, 10, 1, 160)
    assert tiles["height"] == 90 and tiles["interval"] == pytest.approx(overview["duration"] / 3)
    assert len(overview["waveform"]) == ie.WAVEFORM_BUCKETS
    assert max(overview["waveform"]) > 0.1 and all(0 <= v <= 1 for v in overview["waveform"])

    strip = client.get(url + "/strip", params={"path": item["path"]})
    assert strip.status_code == 200 and strip.headers["content-type"] == "image/jpeg"
    assert strip.headers["cache-control"] == "no-cache"
    assert Image.open(io.BytesIO(strip.content)).size == (1600, 90)

    second = client.post(url, json={"path": item["path"]}).json()
    assert "job_id" not in second and second["overview"] == overview


@needs_ffmpeg
def test_a_video_without_sound_has_no_waveform(client, tmp_path):
    cid = client.post("/api/cases", json={"name": "Silent"}).json()["id"]
    item = _upload_video(client, cid, _av(tmp_path, audio=False))
    overview = ie.video_overview(Case.open(cid), item["path"])
    assert overview["waveform"] is None and overview["tiles"]["count"] == 3


@needs_ffmpeg
def test_a_tile_per_second_up_to_the_cap_and_rows_wrap(client, tmp_path):
    cid = client.post("/api/cases", json={"name": "Rows"}).json()["id"]
    item = _upload_video(client, cid, _av(tmp_path, audio=False, seconds=23))
    case = Case.open(cid)
    tiles = ie.video_overview(case, item["path"])["tiles"]
    assert (tiles["count"], tiles["rows"]) == (23, 3)
    assert Image.open(ie.overview_strip(case, item["path"])).size == (1600, 270)


def test_an_image_has_no_overview(client):
    cid = client.post("/api/cases", json={"name": "Still"}).json()["id"]
    buf = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buf, "PNG")
    item = client.post(
        f"/api/cases/{cid}/media/upload", files={"file": ("a.png", io.BytesIO(buf.getvalue()), "image/png")}
    ).json()["item"]
    url = f"/api/cases/{cid}/inspect/overview"
    assert client.post(url, json={"path": item["path"]}).status_code == 422
    assert client.get(url + "/strip", params={"path": item["path"]}).status_code == 422


def test_an_overview_outside_the_case_is_refused(client):
    cid = client.post("/api/cases", json={"name": "Escape"}).json()["id"]
    res = client.post(f"/api/cases/{cid}/inspect/overview", json={"path": "../../x.mp4"})
    assert res.status_code == 400


def test_an_unfiled_video_cannot_have_an_overview(client):
    cid = client.post("/api/cases", json={"name": "Unfiled"}).json()["id"]
    case = Case.open(cid)
    (case.subdir("media") / "loose.mp4").write_bytes(b"x")
    res = client.post(f"/api/cases/{cid}/inspect/overview", json={"path": "media/loose.mp4"})
    assert res.status_code == 400


# --- the cache and its sweep ----------------------------------------------


def test_the_cache_names_are_content_and_generation_addressed():
    names = thumbnails.video_cache_names("a" * 64)
    assert names == {
        "strip": f"{'a' * 24}-strip-g{thumbnails.VIDEO_CACHE_GEN}.jpg",
        "overview": f"{'a' * 24}-overview-g{thumbnails.VIDEO_CACHE_GEN}.json",
        "scan": f"{'a' * 24}-scan-g{thumbnails.VIDEO_CACHE_GEN}.json",
    }


@needs_ffmpeg
def test_repair_keeps_a_live_videos_overview_and_sweeps_it_once_the_video_is_gone(client, tmp_path):
    cid = client.post("/api/cases", json={"name": "Sweep"}).json()["id"]
    item = _upload_video(client, cid, _av(tmp_path))
    case = Case.open(cid)
    ie.video_overview(case, item["path"])
    names = thumbnails.video_cache_names(item["sha256"])
    cache = case.subdir("media") / thumbnails.THUMB_DIR
    assert (cache / names["strip"]).is_file() and (cache / names["overview"]).is_file()

    thumbnails.repair(case)
    assert (cache / names["strip"]).is_file() and (cache / names["overview"]).is_file()

    assert client.delete(f"/api/cases/{cid}/media", params={"path": item["path"]}).status_code == 200
    thumbnails.repair(case)
    assert not (cache / names["strip"]).exists() and not (cache / names["overview"]).exists()
    json.dumps(names)


@needs_ffmpeg
def test_render_preview_snaps_to_the_shown_frame_and_says_which(client, tmp_path):
    cid = client.post("/api/cases", json={"name": "Snap"}).json()["id"]
    item = _upload_video(client, cid, _numbered(tmp_path, "25"))
    url = f"/api/cases/{cid}/inspect/render-preview"

    snapped = client.post(url, json={"path": item["path"], "time": 0.5, "snap": True})
    assert snapped.status_code == 200
    assert snapped.headers["x-frame-time"] == "0.480000"
    assert _frame_number(Image.open(io.BytesIO(snapped.content))) == 12

    exact = client.post(url, json={"path": item["path"], "time": 0.5})  # stored times render as sent
    assert "x-frame-time" not in exact.headers
    assert _frame_number(Image.open(io.BytesIO(exact.content))) == 13


def test_snap_falls_back_to_the_given_time_when_the_frame_is_unknown(client, monkeypatch):
    cid = client.post("/api/cases", json={"name": "SnapFallback"}).json()["id"]
    seen = {}
    monkeypatch.setattr(ie, "frame_time_at", lambda path, t: None)
    monkeypatch.setattr(ie, "render_preview", lambda c, rel, **kw: seen.update(kw) or (b"x", "image/png"))
    res = client.post(
        f"/api/cases/{cid}/inspect/render-preview", json={"path": "media/a.mp4", "time": 1.25, "snap": True}
    )
    assert res.status_code == 200 and res.headers["x-frame-time"] == "1.250000"
    assert seen["time_s"] == 1.25


@needs_ffmpeg
def test_a_videos_lens_is_read_off_the_pan_around_a_moment(client, tmp_path):
    import math

    from stitchscene import _pan

    # a camera panning 5° a second through a 520 px wide frame, its focal 520 px: 53° across
    folder = tmp_path / "pan"
    folder.mkdir()
    for i, view in enumerate(_pan([5.0 * i / 10 for i in range(60)], width=520, height=420, focal=520.0)):
        view.save(folder / f"f{i:03d}.png")
    clip = tmp_path / "pan.mp4"
    _ffmpeg("-framerate", "10", "-i", str(folder / "f%03d.png"), "-c:v", "libx264", "-qp", "0",
            "-pix_fmt", "yuv444p", str(clip))
    cid = client.post("/api/cases", json={"name": "Pan"}).json()["id"]
    path = _upload_video(client, cid, clip)["path"]
    read = client.post("/api/horizon/lens", json={"case": cid, "path": path, "time": 3.0})
    assert read.status_code == 200, read.text
    found = read.json()
    assert found["fov"] == pytest.approx(2 * math.degrees(math.atan(260 / 520)), rel=0.06)
    assert found["times"] == [1.5, 3.0, 4.5] and found["turn"] == pytest.approx(15.0, abs=2.0)
    # a camera that never turns tells no lens, and says so
    still = tmp_path / "still.mp4"
    _ffmpeg("-loop", "1", "-i", str(folder / "f000.png"), "-t", "6", "-r", "10", "-c:v", "libx264", "-qp", "0",
            "-pix_fmt", "yuv444p", str(still))
    fixed = _upload_video(client, cid, still)["path"]
    refused = client.post("/api/horizon/lens", json={"case": cid, "path": fixed, "time": 3.0})
    assert refused.status_code == 422 and "hardly turned" in refused.json()["detail"]
    # a photo has no pan to read
    assert client.post("/api/horizon/lens", json={"case": cid, "path": "media/none.png", "time": 0}).status_code == 404
