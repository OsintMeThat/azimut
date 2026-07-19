"""Resolution of the ffmpeg / ffprobe binaries the engines shell out to.

A pip install relies on a system copy on PATH; the release binary bundles one
beside the executable (sys._MEIPASS). These check both regimes without needing a
real ffmpeg present.
"""

from __future__ import annotations

import sys

from azimut.engine import ffmpeg


def test_prefers_path_when_not_frozen(monkeypatch):
    # no sys._MEIPASS (a plain source run) → resolution falls through to PATH
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    monkeypatch.setattr(ffmpeg.shutil, "which", lambda name: f"/usr/bin/{name}")
    assert ffmpeg.ffmpeg_path() == "/usr/bin/ffmpeg"
    assert ffmpeg.ffprobe_path() == "/usr/bin/ffprobe"
    assert ffmpeg.ffmpeg_available() and ffmpeg.ffprobe_available()
    # yt-dlp needs no hint for a PATH copy — it searches PATH itself
    assert ffmpeg.location_for_ytdlp() is None


def test_missing_everywhere_is_unavailable(monkeypatch):
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    monkeypatch.setattr(ffmpeg.shutil, "which", lambda name: None)
    assert ffmpeg.ffmpeg_path() is None
    assert not ffmpeg.ffmpeg_available()
    # the exe helpers still yield the bare name so a subprocess call is well-formed
    assert ffmpeg.ffmpeg_exe() == "ffmpeg"
    assert ffmpeg.ffprobe_exe() == "ffprobe"


def test_bundled_beats_path(monkeypatch, tmp_path):
    # simulate a frozen bundle carrying its own ffmpeg + ffprobe
    exe = ".exe" if sys.platform == "win32" else ""
    for name in ("ffmpeg", "ffprobe"):
        (tmp_path / f"{name}{exe}").write_bytes(b"")
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    # PATH also has a copy; the bundled one must win
    monkeypatch.setattr(ffmpeg.shutil, "which", lambda name: f"/usr/bin/{name}")

    assert ffmpeg.ffmpeg_path() == str(tmp_path / f"ffmpeg{exe}")
    assert ffmpeg.ffprobe_path() == str(tmp_path / f"ffprobe{exe}")
    assert ffmpeg.ffmpeg_exe() == str(tmp_path / f"ffmpeg{exe}")
    # yt-dlp gets pointed at the bundle dir (it isn't on PATH)
    assert ffmpeg.location_for_ytdlp() == str(tmp_path)


def test_frozen_without_bundled_ffmpeg_uses_path(monkeypatch, tmp_path):
    # a frozen bundle that happens to carry no ffmpeg still falls back to PATH,
    # and hands yt-dlp no bogus location
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    monkeypatch.setattr(ffmpeg.shutil, "which", lambda name: f"/usr/bin/{name}")
    assert ffmpeg.ffmpeg_path() == "/usr/bin/ffmpeg"
    assert ffmpeg.location_for_ytdlp() is None


def test_download_points_ytdlp_at_the_bundled_ffmpeg(client, monkeypatch):
    """A bundled ffmpeg isn't on PATH, so the download opts must carry
    ``ffmpeg_location`` or yt-dlp can't merge audio+video."""
    from azimut.engine import media
    from azimut.workspace import Case

    monkeypatch.setattr(media.ffmpeg_engine, "ffmpeg_available", lambda: True)
    monkeypatch.setattr(
        media.ffmpeg_engine, "location_for_ytdlp", lambda: "/bundle/dir"
    )

    captured: dict = {}

    class _FakeYDL:
        def __init__(self, opts):
            captured.update(opts)

        def __enter__(self):
            raise RuntimeError("stop — we only care about the opts")

        def __exit__(self, *a):
            return False

    fake_mod = type("m", (), {"YoutubeDL": _FakeYDL})
    monkeypatch.setitem(sys.modules, "yt_dlp", fake_mod)

    cid = client.post("/api/cases", json={"name": "DL"}).json()["id"]
    case = Case.open(cid)
    try:
        media.download_url(case, "https://example.com/v")
    except RuntimeError:
        pass
    assert captured.get("ffmpeg_location") == "/bundle/dir"
    # ffmpeg present → no degraded single-stream format forced
    assert "format" not in captured


def test_download_forces_single_stream_without_ffmpeg(client, monkeypatch):
    from azimut.engine import media
    from azimut.workspace import Case

    monkeypatch.setattr(media.ffmpeg_engine, "ffmpeg_available", lambda: False)

    captured: dict = {}

    class _FakeYDL:
        def __init__(self, opts):
            captured.update(opts)

        def __enter__(self):
            raise RuntimeError("stop")

        def __exit__(self, *a):
            return False

    monkeypatch.setitem(sys.modules, "yt_dlp", type("m", (), {"YoutubeDL": _FakeYDL}))

    cid = client.post("/api/cases", json={"name": "DL"}).json()["id"]
    case = Case.open(cid)
    try:
        media.download_url(case, "https://example.com/v")
    except RuntimeError:
        pass
    # no ffmpeg → the degraded muxed-only format is forced, no location hint
    assert captured.get("format") == "best[acodec!=none][vcodec!=none]/best"
    assert "ffmpeg_location" not in captured
