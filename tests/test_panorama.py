"""Collage → Panorama: the frames picked from a stretch of video (engine/panorama.py).

The videos are made here, a wide still picture seen through a window that slides a
known number of pixels a frame, so every pick can be checked against the travel
that put it there. Everything needs ffmpeg and is skipped without it.
"""

from __future__ import annotations

import io
import math
import random
import subprocess

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFilter

from azimut.engine import inspect as ie
from azimut.engine import media as media_engine
from azimut.engine import panorama
from azimut.workspace import Case

needs_ffmpeg = pytest.mark.skipif(not media_engine.ffmpeg_available(), reason="ffmpeg not installed")

FPS = 25
W, H = 240, 180


def _scene(width: int, seed: int = 3, ground_only: bool = False) -> np.ndarray:
    """A wide picture with detail to follow: blobs everywhere, or only along the bottom
    third under a flat sky."""
    rng = random.Random(seed)
    img = Image.new("RGB", (width, H), (120, 150, 190) if ground_only else (30, 34, 40))
    draw = ImageDraw.Draw(img)
    top = 2 * H // 3 if ground_only else 0
    if ground_only:
        draw.rectangle([0, top, width, H], fill=(90, 80, 60))
    for _ in range(width * (H - top) // 120):
        x, y = rng.randrange(width), rng.randrange(top, H)
        r = rng.randrange(4, 16)
        color = (rng.randrange(40, 255), rng.randrange(40, 255), rng.randrange(40, 255))
        draw.ellipse([x, y, x + r, y + r], fill=color)
    return np.asarray(img.filter(ImageFilter.GaussianBlur(0.8)))


def _video(path, frames: list[np.ndarray]) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-r", str(FPS), "-i", "pipe:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-g", "25",
         str(path)],
        input=b"".join(np.ascontiguousarray(f).tobytes() for f in frames), check=True,
    )


def _pan(scene: np.ndarray, speed: int, count: int, overlay=None) -> list[np.ndarray]:
    """``count`` frames of ``scene`` through a window moving ``speed`` pixels a frame."""
    frames = []
    for n in range(count):
        frame = scene[:, n * speed : n * speed + W].copy()
        if overlay is not None:
            overlay(frame)
        frames.append(frame)
    return frames


def _case_with(tmp_workspace, name: str, frames: list[np.ndarray]) -> tuple[Case, str]:
    case = Case.create(name)
    _video(case.subdir("media") / "pan.mp4", frames)
    return case, "media/pan.mp4"


def _travel(times: list[float], speed: int) -> list[float]:
    """The share of the picture the window slid between each kept frame and the next."""
    return [(b - a) * FPS * speed / W for a, b in zip(times, times[1:])]


@needs_ffmpeg
def test_a_pan_keeps_a_frame_every_third_of_the_picture(tmp_workspace):
    speed, count = 4, 100  # 396 px of travel: 1.65 pictures
    case, rel = _case_with(tmp_workspace, "Pan", _pan(_scene(W + speed * count), speed, count))

    picked = panorama.pick_frames(case, rel, 0.0, (count - 1) / FPS)

    times = picked["times"]
    assert picked["note"] is None
    assert 5 <= len(times) <= 7
    assert times == sorted(times)
    # each a frame's own timestamp, on the 25 fps grid
    assert all(abs(t * FPS - round(t * FPS)) < 1e-6 for t in times)
    steps = _travel(times, speed)
    low, high = panorama.STEP * (1 - panorama.STEP_WINDOW), panorama.STEP * (1 + panorama.STEP_WINDOW)
    assert all(low - 0.02 <= s <= high + 0.02 for s in steps[:-1])
    # the last step reaches the end's view, which may sit closer
    assert panorama.END_STEP - 0.02 <= steps[-1] <= high + 0.02
    # the first and last views are the stretch's own
    assert times[0] <= panorama.EDGE_TRAVEL * W / speed / FPS + 1e-6
    assert times[-1] >= (count - 1) / FPS - panorama.EDGE_TRAVEL * W / speed / FPS - 1e-6
    # the same stretch always answers the same times
    assert panorama.pick_frames(case, rel, 0.0, (count - 1) / FPS) == picked


@needs_ffmpeg
def test_a_still_camera_is_one_frame(tmp_workspace):
    case, rel = _case_with(tmp_workspace, "Still", _pan(_scene(W + 10), 0, 60))
    assert panorama.pick_frames(case, rel, 0.0, 2.0) == {"times": [], "note": panorama.NOTE_STILL}


@needs_ffmpeg
def test_too_short_a_stretch_is_said(tmp_workspace):
    case, rel = _case_with(tmp_workspace, "Short", _pan(_scene(W + 200), 4, 40))
    assert panorama.pick_frames(case, rel, 0.4, 0.44) == {"times": [], "note": panorama.NOTE_SHORT}


# bars of uneven widths, like the glyphs of a caption: a regular pattern would match
# itself a period away as well as in place
_BARS = [random.Random(5).choice((2, 3, 5, 8)) for _ in range(80)]


def _burnt_in(frame: np.ndarray) -> None:
    """A caption strip across the top and a channel bug below it, high contrast,
    pinned to the picture while the scene slides under them."""
    x, ink = 4, True
    for width in _BARS:
        if x >= W - 4:
            break
        frame[12:48, x : min(x + width, W - 4)] = 255 if ink else 0
        x, ink = x + width, not ink
    frame[66:114, 6:54] = 0
    frame[74:106, 14:46] = 255
    frame[84:96, 24:36] = 0


@needs_ffmpeg
def test_a_burnt_in_logo_does_not_stop_the_pan_being_read(tmp_workspace):
    """The scene shows detail only along the bottom third, under a flat sky, so the
    strip and the bug hold more of the readable blocks than the scene does: left in,
    the median of the blocks is the overlay's, standing still."""
    speed, count = 4, 100
    frames = _pan(_scene(W + speed * count, ground_only=True), speed, count, overlay=_burnt_in)
    case, rel = _case_with(tmp_workspace, "Logo", frames)
    end = (count - 1) / FPS

    picked = panorama.pick_frames(case, rel, 0.0, end)
    assert picked["note"] is None
    assert 5 <= len(picked["times"]) <= 7

    # what it steps round: the blocks holding the bug and the strip are found pinned, the
    # ground's never (one strip block may read the bars a period away, and so move)
    stretch, _, tracker = panorama._read(case.resolve_inside(rel), ie.probe(case, rel), 0.0, end + 1 / FPS, 1)
    pinned = panorama._pinned_blocks(stretch.readings, len(tracker.boxes))
    side = tracker.side
    assert not any(pinned[k] for k, (_, y) in enumerate(tracker.boxes) if y >= 2 * H // 3)
    assert pinned[tracker.boxes.index((0, side))]
    assert sum(bool(pinned[k]) for k, (_, y) in enumerate(tracker.boxes) if y == 0) >= 3


@needs_ffmpeg
def test_a_shot_cut_is_never_crossed(tmp_workspace):
    speed = 4
    first = _pan(_scene(W + speed * 60, seed=11), speed, 60)
    second = _pan(_scene(W + speed * 35, seed=29), speed, 35)
    case, rel = _case_with(tmp_workspace, "Cut", first + second)

    picked = panorama.pick_frames(case, rel, 0.0, 94 / FPS)

    assert picked["note"] == panorama.NOTE_CUT
    assert len(picked["times"]) >= 3
    # all from the longer part, before the cut at frame 60
    assert all(t < 60 / FPS - 1e-6 for t in picked["times"])
    assert all(s >= panorama.END_STEP - 0.02 for s in _travel(picked["times"], speed))


@needs_ffmpeg
def test_a_long_pan_is_capped_and_spread_evenly(tmp_workspace):
    speed, count = 12, 160  # 1908 px: 8 pictures, some 25 frames at a third each
    case, rel = _case_with(tmp_workspace, "Long", _pan(_scene(W + speed * count), speed, count))

    picked = panorama.pick_frames(case, rel, 0.0, (count - 1) / FPS)

    times = picked["times"]
    assert panorama.MAX_FRAMES - 2 <= len(times) <= panorama.MAX_FRAMES
    # spread over 16 the overlap stays near half, enough to stitch: nothing to say
    assert picked["note"] is None
    steps = _travel(times, speed)
    assert max(steps) <= 0.62
    assert sum(steps) >= 7.5


@needs_ffmpeg
def test_a_pan_too_long_for_the_cap_says_its_overlap_is_thin(tmp_workspace):
    speed, count = 16, 200  # 3184 px: over 13 pictures
    case, rel = _case_with(tmp_workspace, "Longer", _pan(_scene(W + speed * count), speed, count))

    picked = panorama.pick_frames(case, rel, 0.0, (count - 1) / FPS)

    assert panorama.MAX_FRAMES - 2 <= len(picked["times"]) <= panorama.MAX_FRAMES
    assert picked["note"] is not None and "may not stitch" in picked["note"]


@needs_ffmpeg
def test_stamps_name_the_frame_a_preview_renders_on_a_variable_rate(tmp_path):
    """The shared reader's times are each frame's own: extracted at it, the frame is the
    one the stream decoded, a 25 fps run then a 5 fps run, read from mid-stretch."""
    video = tmp_path / "vfr.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", "color=c=black:s=64x64:r=25:d=2,format=gray,geq=lum='N*4'",
         "-vf", "setpts='if(lt(N,25),N/25,1+(N-25)/5)/TB'", "-fps_mode", "vfr",
         "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv444p", str(video)],
        check=True,
    )
    levels: list[float] = []
    times = ie.grey_stream(
        video, (64, 64), lambda grey: levels.append(float(grey.mean())), timeout=30,
        start=0.7, length=1.0, stamps=True,
    )
    assert times is not None and len(times) == len(levels) > 5
    assert times[:2] == [0.72, 0.76] and times[-1] == pytest.approx(1.6)
    for at, level in zip(times, levels):
        assert float(np.asarray(ie.extract_frame(video, at).convert("L")).mean()) == pytest.approx(level, abs=1.5)


# --- the route --------------------------------------------------------------


def _upload_pan(client, name: str, speed: int = 4, count: int = 100, tmp=None) -> tuple[str, str]:
    cid = client.post("/api/cases", json={"name": name}).json()["id"]
    path = tmp / f"{name}.mp4"
    _video(path, _pan(_scene(W + speed * count), speed, count))
    with path.open("rb") as fh:
        item = client.post(
            f"/api/cases/{cid}/media/upload", files={"file": (path.name, fh, "video/mp4")}
        ).json()["item"]
    return cid, item["path"]


@needs_ffmpeg
def test_the_route_answers_times_that_render_their_very_frames(client, tmp_path):
    speed, count = 4, 100
    cid, rel = _upload_pan(client, "Route", speed, count, tmp_path)
    scene = _scene(W + speed * count)

    res = client.post(f"/api/cases/{cid}/inspect/panorama-frames", json={"path": rel, "start": 0, "end": 3.96})

    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body) == {"times", "note"} and body["note"] is None
    for t in body["times"][:3]:
        png = client.post(f"/api/cases/{cid}/inspect/render-preview", json={"path": rel, "time": t})
        shown = np.asarray(Image.open(io.BytesIO(png.content)).convert("RGB")).astype(np.float64)
        n = round(t * FPS)

        def off(k: int) -> float:
            return float(np.abs(shown - scene[:, k * speed : k * speed + W]).mean())

        assert off(n) < 6 and off(n) < min(off(n - 1) if n else math.inf, off(n + 1)) / 2


@needs_ffmpeg
def test_a_still_stretch_answers_why_through_the_route(client, tmp_path):
    cid, rel = _upload_pan(client, "RouteStill", speed=0, count=40, tmp=tmp_path)
    res = client.post(f"/api/cases/{cid}/inspect/panorama-frames", json={"path": rel, "start": 0.2, "end": 1.5})
    assert res.status_code == 200
    assert res.json() == {"times": [], "note": panorama.NOTE_STILL}


@pytest.mark.parametrize("body", [
    {"start": 2, "end": 1},
    {"start": 1, "end": 1},
    {"start": -1, "end": 1},
    {"start": 0, "end": panorama.MAX_STRETCH + 1},
    {"start": 0},
])
def test_a_stretch_that_is_no_stretch_is_refused(client, body):
    cid = client.post("/api/cases", json={"name": "Bad"}).json()["id"]
    res = client.post(f"/api/cases/{cid}/inspect/panorama-frames", json={"path": "media/v.mp4", **body})
    assert res.status_code == 422


def test_numbers_that_are_not_numbers_are_refused(client):
    cid = client.post("/api/cases", json={"name": "NaN"}).json()["id"]
    res = client.post(
        f"/api/cases/{cid}/inspect/panorama-frames",
        content=b'{"path": "media/v.mp4", "start": NaN, "end": 2}',
        headers={"content-type": "application/json"},
    )
    assert res.status_code == 422


def test_a_path_outside_the_case_is_refused(client):
    cid = client.post("/api/cases", json={"name": "Escape"}).json()["id"]
    res = client.post(f"/api/cases/{cid}/inspect/panorama-frames", json={"path": "../../x.mp4", "start": 0, "end": 2})
    assert res.status_code == 400


def test_a_picture_or_a_missing_video_is_refused(client):
    cid = client.post("/api/cases", json={"name": "NotVideo"}).json()["id"]
    buf = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buf, "PNG")
    item = client.post(
        f"/api/cases/{cid}/media/upload", files={"file": ("a.png", io.BytesIO(buf.getvalue()), "image/png")}
    ).json()["item"]
    url = f"/api/cases/{cid}/inspect/panorama-frames"
    assert client.post(url, json={"path": item["path"], "start": 0, "end": 2}).status_code == 422
    assert client.post(url, json={"path": "media/none.mp4", "start": 0, "end": 2}).status_code == 422


@needs_ffmpeg
def test_a_stretch_past_the_video_is_refused(client, tmp_path):
    cid, rel = _upload_pan(client, "Past", count=50, tmp=tmp_path)  # 2 s
    url = f"/api/cases/{cid}/inspect/panorama-frames"
    assert client.post(url, json={"path": rel, "start": 2.5, "end": 3}).status_code == 422
    assert client.post(url, json={"path": rel, "start": 1, "end": 4}).status_code == 422


def test_without_ffmpeg_the_route_says_so(client, monkeypatch):
    cid = client.post("/api/cases", json={"name": "NoFfmpeg"}).json()["id"]
    case = Case.open(cid)
    (case.subdir("media") / "v.mp4").write_bytes(b"x")
    monkeypatch.setattr(media_engine, "ffmpeg_available", lambda: False)
    res = client.post(f"/api/cases/{cid}/inspect/panorama-frames", json={"path": "media/v.mp4", "start": 0, "end": 2})
    assert res.status_code == 422 and "ffmpeg" in res.json()["detail"]
