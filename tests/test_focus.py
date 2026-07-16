"""Sharpest-frame scan: the focus measure, the pick spreading, and the scan pass.

The measure is the interesting part. A naive Laplacian variance scales with the
scene's contrast as much as its focus, which is how a "sharpest frames" list ends
up full of soft, high-contrast frames — these tests pin the contrast invariance
that fixes it.
"""

import random
import subprocess

import pytest
from PIL import Image, ImageDraw, ImageFilter

from azimut.engine import inspect as ie
from azimut.engine import media as media_engine


def _textured(size=(320, 240), seed=5, contrast=1.0, bias=0) -> Image.Image:
    """A detailed scene, optionally flattened in contrast (never in focus)."""
    rng = random.Random(seed)
    img = Image.new("RGB", size, (128, 128, 128))
    draw = ImageDraw.Draw(img)
    for _ in range(160):
        x, y = rng.randrange(size[0]), rng.randrange(size[1])
        r = rng.randrange(4, 22)
        # Scale each blob's departure from mid-grey: contrast changes, detail doesn't.
        base = [rng.randrange(0, 255) for _ in range(3)]
        color = tuple(int(128 + (v - 128) * contrast + bias) for v in base)
        draw.rectangle([x, y, x + r, y + r], fill=color)
    return img


# --- the focus measure -----------------------------------------------------


def test_focus_score_drops_sharply_when_blurred():
    sharp = _textured()
    blurred = sharp.filter(ImageFilter.GaussianBlur(radius=3))
    assert ie._sharpness(blurred) < ie._sharpness(sharp) / 4


def test_focus_score_is_contrast_invariant():
    # The same scene at full and at a quarter contrast: equally in focus, so the
    # measure must not care. Raw Laplacian variance would fall ~16x here (it
    # scales with contrast squared) — that bias is exactly the reported bug,
    # where blurry-but-punchy frames outranked sharp flat ones.
    punchy = ie._sharpness(_textured(contrast=1.0))
    flat = ie._sharpness(_textured(contrast=0.25))
    assert flat == pytest.approx(punchy, rel=0.25)


def test_focus_score_prefers_a_sharp_flat_frame_over_a_blurry_punchy_one():
    sharp_flat = _textured(contrast=0.3)
    blurry_punchy = _textured(contrast=1.0).filter(ImageFilter.GaussianBlur(radius=3))
    assert ie._sharpness(sharp_flat) > ie._sharpness(blurry_punchy)


def test_focus_score_of_a_blank_frame_is_zero():
    assert ie._sharpness(Image.new("RGB", (64, 64), (17, 17, 17))) == 0.0


# --- scan plumbing ---------------------------------------------------------


def test_scan_size_caps_the_long_edge_and_keeps_dimensions_even():
    w, h = ie._scan_size(1920, 1080)
    assert max(w, h) <= ie.SCAN_DIM
    assert w % 2 == 0 and h % 2 == 0
    assert w / h == pytest.approx(1920 / 1080, rel=0.02)


def test_scan_size_never_upscales_a_small_video():
    assert ie._scan_size(320, 240) == (320, 240)


def test_spread_picks_takes_the_best_of_each_moment():
    # A sharp burst around t=1 and a softer one around t=9: one pick each, and
    # the burst must not eat both slots with near-identical neighbours.
    scored = [
        {"time": 0.9, "score": 0.8}, {"time": 1.0, "score": 0.9}, {"time": 1.1, "score": 0.85},
        {"time": 9.0, "score": 0.5}, {"time": 9.1, "score": 0.4},
    ]
    picks = ie._spread_picks(scored, count=2, min_gap=1.0)
    assert [p["time"] for p in picks] == [1.0, 9.0]


def test_spread_picks_honours_the_count():
    scored = [{"time": float(i), "score": 1.0 - i / 100} for i in range(30)]
    assert len(ie._spread_picks(scored, count=5, min_gap=0.5)) == 5


# --- end to end (needs ffmpeg) ---------------------------------------------


needs_ffmpeg = pytest.mark.skipif(
    not media_engine.ffmpeg_available(), reason="ffmpeg not available"
)


def _video_with_a_sharp_window(path, case_dir):
    """A 4s clip: blurred throughout except a sharp burst at ~2s."""
    frames_dir = case_dir / "src"
    frames_dir.mkdir(parents=True, exist_ok=True)
    scene = _textured(size=(320, 240))
    soft = scene.filter(ImageFilter.GaussianBlur(radius=4))
    for i in range(40):  # 4s @ 10fps
        (scene if 20 <= i <= 22 else soft).save(frames_dir / f"f{i:03d}.png")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-framerate", "10",
         "-i", str(frames_dir / "f%03d.png"), "-pix_fmt", "yuv420p", str(path)],
        check=True, capture_output=True,
    )


@needs_ffmpeg
def test_scan_focus_scores_every_frame_and_suggest_finds_the_sharp_window(tmp_workspace):
    from azimut.workspace import Case

    case = Case.create("Focus scan")
    video = case.subdir("media") / "clip.mp4"
    _video_with_a_sharp_window(video, case.path)
    rel = "media/clip.mp4"

    scored = ie.scan_focus(case, rel)
    # Every frame, not a handful of bins — the whole point of the rewrite.
    assert len(scored) >= 35
    assert [s["time"] for s in scored] == sorted(s["time"] for s in scored)

    picks = ie.suggest_frames(case, rel, count=3)
    assert picks[0]["rank"] == 0
    # The sharp burst sits at 2.0-2.2s; the best pick must land there rather than
    # wherever a fixed bin centre happened to fall.
    assert picks[0]["time"] == pytest.approx(2.1, abs=0.35)
    assert picks[0]["score"] > 2 * picks[-1]["score"]


@needs_ffmpeg
def test_suggest_frames_reports_progress(tmp_workspace):
    from azimut.workspace import Case

    case = Case.create("Focus progress")
    video = case.subdir("media") / "clip.mp4"
    _video_with_a_sharp_window(video, case.path)

    seen = []
    ie.suggest_frames(case, "media/clip.mp4", count=2, set_progress=lambda d: seen.append(d))
    assert seen and seen[-1]["percent"] == 100.0
