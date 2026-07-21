"""Thumbnail cache and its durable job model (doc step 6, "Thumbnail and
background-job model").

Pins the guarantees the doc asks for: cheap image thumbnails render inline while
the CPU-heavy video path is queued to the single worker; generation is atomic and
content-addressed; a failure retries then fails without looping; the cache is
budgeted (LRU) and repairable; and a shared thumbnail survives one of its media
being deleted. `_render` is monkeypatched where a test must not depend on a real
ffmpeg being installed.
"""

from __future__ import annotations

import io
import time

import pytest
from PIL import Image

from azimut.engine import media as media_engine
from azimut.engine import thumbnails
from azimut.workspace import Case


@pytest.fixture()
def case(tmp_workspace, monkeypatch):
    """A fresh case with the background worker disabled, so tests drain the queue
    explicitly and deterministically."""
    monkeypatch.setattr(thumbnails, "start_workers", False)
    return Case.create("Thumbs")


def _png(color=(200, 30, 30), size=(80, 60)) -> io.BytesIO:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    buf.seek(0)
    return buf


def _register_video(case: Case, name="clip.mp4") -> dict:
    path = case.subdir("media") / name
    path.write_bytes(b"not a real video, just bytes")
    return media_engine._register(case, path, {"type": "upload"})


# -- inline images vs queued video ----------------------------------------


def test_image_thumbnail_renders_inline_and_is_content_addressed(case):
    res = media_engine.import_stream(case, "photo.png", _png())
    item = res["item"]
    assert item["thumbnail"] == thumbnails.thumb_relpath(item["sha256"], "image")
    assert case.resolve_inside(item["thumbnail"]).exists()
    # no job was needed for the fast path
    assert case.list_jobs(kind=thumbnails.THUMB_KIND) == []


def test_video_thumbnail_is_queued_not_inline(case):
    res = _register_video(case)
    assert res["item"]["thumbnail"] is None  # nothing rendered inline
    jobs = case.list_jobs(kind=thumbnails.THUMB_KIND)
    assert [(j["state"], j["key"]) for j in jobs] == [("queued", "media/clip.mp4")]


# -- draining the queue ----------------------------------------------------


def test_drain_generates_the_queued_thumbnail_and_updates_the_sidecar(case, monkeypatch):
    def fake_render(media_path, out_path, kind):
        out_path.write_bytes(b"\xff\xd8\xff\xe0jpeg")
        return True

    monkeypatch.setattr(thumbnails, "_render", fake_render)
    item = _register_video(case)["item"]

    assert thumbnails.drain(case) == 1
    job = case.list_jobs(kind=thumbnails.THUMB_KIND)[0]
    assert job["state"] == "ready"
    # the sidecar now points at the freshly generated, content-addressed file
    refreshed = media_engine.read_item(case, item["path"])
    assert refreshed["thumbnail"] == thumbnails.thumb_relpath(item["sha256"], "video")
    assert case.resolve_inside(refreshed["thumbnail"]).exists()


def test_a_failing_render_retries_then_fails_without_looping(case, monkeypatch):
    monkeypatch.setattr(thumbnails, "_render", lambda *a: False)  # produces nothing
    _register_video(case)

    handled = thumbnails.drain(case)  # claims, fails, requeues, up to the budget
    assert handled == 3  # default max_attempts
    job = case.list_jobs(kind=thumbnails.THUMB_KIND)[0]
    assert job["state"] == "failed" and job["attempts"] == 3


def test_drain_cancels_a_job_whose_media_is_gone(case):
    _register_video(case)
    (case.subdir("media") / "clip.mp4").unlink()
    (case.subdir("media") / ("clip.mp4" + media_engine.SIDECAR_SUFFIX)).unlink()

    thumbnails.drain(case)
    assert case.list_jobs(kind=thumbnails.THUMB_KIND)[0]["state"] == "cancelled"


# -- atomicity + content key ----------------------------------------------


def test_generate_leaves_no_partial_or_temp_on_failure(case, monkeypatch):
    path = case.subdir("media") / "clip.mp4"
    path.write_bytes(b"bytes")
    monkeypatch.setattr(thumbnails, "_render", lambda *a: False)

    with pytest.raises(thumbnails.ThumbnailError):
        thumbnails.generate(case, "media/clip.mp4", "deadbeef" * 8, "video")

    thumb_dir = case.subdir("media") / thumbnails.THUMB_DIR
    leftovers = list(thumb_dir.iterdir()) if thumb_dir.is_dir() else []
    assert leftovers == []  # neither a final file nor a .tmp.jpg is left behind


def test_content_key_folds_in_the_generator_version(case, monkeypatch):
    first = thumbnails.thumb_relpath("a" * 64, "image")
    monkeypatch.setattr(thumbnails, "THUMB_GEN", thumbnails.THUMB_GEN + 1)
    bumped = thumbnails.thumb_relpath("a" * 64, "image")
    assert first != bumped  # a new generator maps the same original to a new file
    assert thumbnails.thumb_relpath("a" * 64, "audio") is None  # not thumbnailed


# -- budget + repair -------------------------------------------------------


def test_prune_cache_evicts_least_recently_used_over_budget(case):
    thumbs = case.subdir("media") / thumbnails.THUMB_DIR
    thumbs.mkdir(parents=True, exist_ok=True)
    files = []
    for i in range(3):
        f = thumbs / f"{i:024d}-g1.jpg"
        f.write_bytes(b"x" * 100)
        import os

        os.utime(f, (1000 + i, 1000 + i))  # oldest first
        files.append(f)

    evicted = thumbnails.prune_cache(case, budget_bytes=250)  # room for 2 of 3
    assert evicted == 1
    assert not files[0].exists()  # the oldest went
    assert files[1].exists() and files[2].exists()


def test_repair_removes_orphan_and_temp_files_only(case):
    item = media_engine.import_stream(case, "keep.png", _png())["item"]
    thumbs = case.subdir("media") / thumbnails.THUMB_DIR
    (thumbs / "orphan-g1.jpg").write_bytes(b"stale")
    (thumbs / ".half.tmp.jpg").write_bytes(b"partial")

    assert thumbnails.repair(case) == 2  # orphan + temp
    assert case.resolve_inside(item["thumbnail"]).exists()  # the referenced one stays


def test_deleting_one_of_two_media_sharing_a_thumbnail_keeps_it(case):
    # dedupe=False keeps two entities for identical bytes (satellite re-captures),
    # so both sidecars point at the same content-addressed thumbnail.
    img = Image.new("RGB", (40, 40), (10, 20, 30))
    a = media_engine.import_image(case, img, "a.png", {"type": "satellite"}, dedupe=False)["item"]
    b = media_engine.import_image(case, img, "b.png", {"type": "satellite"}, dedupe=False)["item"]
    assert a["thumbnail"] == b["thumbnail"]
    thumb = case.resolve_inside(a["thumbnail"])

    media_engine.delete_media_files(case, a["path"])
    assert thumb.exists()  # still referenced by b
    media_engine.delete_media_files(case, b["path"])
    assert not thumb.exists()  # last reference gone


# -- the background worker -------------------------------------------------


def test_startup_recovers_interrupted_jobs(case, monkeypatch):
    """The server's startup pass returns a job an earlier run left `running` back
    to the queue, so pending thumbnail work resumes instead of stalling."""
    from azimut import server

    _register_video(case)
    running = case.claim_job()  # simulate a crash mid-render
    assert running["state"] == "running"

    server._recover_jobs()  # what create_app runs on boot (worker disabled here)
    assert case.get_job(running["id"])["state"] == "queued"


def test_worker_wakes_and_drains_in_the_background(tmp_workspace, monkeypatch):
    monkeypatch.setattr(thumbnails, "start_workers", True)

    def fake_render(media_path, out_path, kind):
        out_path.write_bytes(b"\xff\xd8\xff\xe0jpeg")
        return True

    monkeypatch.setattr(thumbnails, "_render", fake_render)
    c = Case.create("Worker")
    item = _register_video(c)["item"]  # enqueues + wakes the worker

    deadline = time.time() + 5
    while time.time() < deadline:
        if media_engine.read_item(c, item["path"])["thumbnail"]:
            break
        time.sleep(0.05)
    refreshed = media_engine.read_item(c, item["path"])
    assert refreshed["thumbnail"] and c.resolve_inside(refreshed["thumbnail"]).exists()
    assert thumbnails.wait_until_idle()
