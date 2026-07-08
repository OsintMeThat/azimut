"""Inspect tool: probe, adjustments (bake), collage, analyses, frame capture.

Image-based features use Pillow only (deterministic, no ffmpeg). Frame capture
needs ffmpeg and is skipped when it is unavailable in the environment.
"""

import io
import time

import pytest
from PIL import Image

from ozimut.engine import media as media_engine


def _png_bytes(color=(120, 60, 30), size=(80, 60)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def _upload(client, cid, name, data=None):
    return client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(data or _png_bytes()), "image/png")},
    ).json()["item"]


def test_ops_registry_is_self_describing(client):
    ops = client.get("/api/inspect/ops").json()
    ids = {f["id"] for f in ops["filters"]}
    assert {"brightness", "contrast", "gamma", "crop", "rotate"} <= ids
    brightness = next(f for f in ops["filters"] if f["id"] == "brightness")
    assert brightness["css"] == "brightness({v})"
    assert brightness["params"][0]["default"] == 1
    assert {a["id"] for a in ops["analyses"]} >= {"histogram", "exif", "ela"}


def test_probe_image(client):
    cid = client.post("/api/cases", json={"name": "Probe"}).json()["id"]
    item = _upload(client, cid, "shot.png", _png_bytes(size=(120, 90)))
    probe = client.get(f"/api/cases/{cid}/inspect/probe", params={"path": item["path"]}).json()
    assert probe["kind"] == "image"
    assert probe["width"] == 120 and probe["height"] == 90


def test_bake_creates_derivative_media(client):
    cid = client.post("/api/cases", json={"name": "Bake"}).json()["id"]
    item = _upload(client, cid, "orig.png")

    res = client.post(
        f"/api/cases/{cid}/inspect/bake",
        json={"path": item["path"], "ops": [{"op": "brightness", "params": {"amount": 1.4}}],
              "label": "Brightened"},
    ).json()
    assert res["duplicate"] is False
    new_path = res["item"]["path"]
    assert new_path != item["path"]

    # filed as a new media with inspect provenance and served
    listing = client.get(f"/api/cases/{cid}/media").json()
    assert len(listing) == 2
    entities = client.get(f"/api/cases/{cid}").json()["entities"]
    derived = next(e for e in entities if e["attrs"]["path"] == new_path)
    assert derived["provenance"]["by"] == "inspect"
    assert client.get(f"/files/{cid}/{new_path}").status_code == 200

    # derivation recorded in the sidecar source (auditable)
    updated = next(m for m in listing if m["path"] == new_path)
    assert updated["source"]["op"] == "adjust"
    assert updated["source"]["from"] == item["path"]


def test_bake_unknown_filter_is_rejected(client):
    cid = client.post("/api/cases", json={"name": "BadOp"}).json()["id"]
    item = _upload(client, cid, "x.png")
    res = client.post(
        f"/api/cases/{cid}/inspect/bake",
        json={"path": item["path"], "ops": [{"op": "nope", "params": {}}]},
    )
    assert res.status_code == 422


def test_crop_op_reduces_dimensions(client):
    cid = client.post("/api/cases", json={"name": "Crop"}).json()["id"]
    item = _upload(client, cid, "big.png", _png_bytes(size=(200, 100)))
    res = client.post(
        f"/api/cases/{cid}/inspect/bake",
        json={"path": item["path"],
              "ops": [{"op": "crop", "params": {"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5}}]},
    ).json()
    probe = client.get(
        f"/api/cases/{cid}/inspect/probe", params={"path": res["item"]["path"]}
    ).json()
    assert probe["width"] == 100 and probe["height"] == 50


def test_collage_combines_images(client):
    cid = client.post("/api/cases", json={"name": "Collage"}).json()["id"]
    a = _upload(client, cid, "a.png", _png_bytes(color=(10, 20, 30)))
    b = _upload(client, cid, "b.png", _png_bytes(color=(200, 100, 50)))

    res = client.post(
        f"/api/cases/{cid}/inspect/collage",
        json={"paths": [a["path"], b["path"]], "columns": 2, "cell": 100, "gap": 10},
    ).json()
    assert res["duplicate"] is False
    probe = client.get(
        f"/api/cases/{cid}/inspect/probe", params={"path": res["item"]["path"]}
    ).json()
    # 2 columns × 100 cell + 3 gaps × 10 = 230 wide, 1 row = 120 tall
    assert probe["width"] == 230 and probe["height"] == 120
    assert client.get(f"/api/cases/{cid}/media").json().__len__() == 3


def test_collage_requires_paths(client):
    cid = client.post("/api/cases", json={"name": "Empty"}).json()["id"]
    res = client.post(f"/api/cases/{cid}/inspect/collage", json={"paths": []})
    assert res.status_code == 422


def test_analyze_histogram(client):
    cid = client.post("/api/cases", json={"name": "Hist"}).json()["id"]
    item = _upload(client, cid, "img.png", _png_bytes(color=(255, 0, 0), size=(20, 20)))
    res = client.post(
        f"/api/cases/{cid}/inspect/analyze", json={"path": item["path"], "name": "histogram"}
    ).json()
    assert res["kind"] == "histogram"
    # a pure-red image piles every pixel into R=255
    assert res["channels"]["r"][255] == 400


def test_analyze_exif_keyvalue(client):
    cid = client.post("/api/cases", json={"name": "Exif"}).json()["id"]
    item = _upload(client, cid, "img.png")
    res = client.post(
        f"/api/cases/{cid}/inspect/analyze", json={"path": item["path"], "name": "exif"}
    ).json()
    assert res["kind"] == "keyvalue"
    assert res["rows"]["Format"] == "PNG"


def test_analyze_ela_returns_image(client):
    cid = client.post("/api/cases", json={"name": "Ela"}).json()["id"]
    item = _upload(client, cid, "img.png")
    res = client.post(
        f"/api/cases/{cid}/inspect/analyze", json={"path": item["path"], "name": "ela"}
    ).json()
    assert res["kind"] == "image"
    assert res["data_url"].startswith("data:image/png;base64,")


def test_analyze_unknown_is_rejected(client):
    cid = client.post("/api/cases", json={"name": "BadA"}).json()["id"]
    item = _upload(client, cid, "img.png")
    res = client.post(
        f"/api/cases/{cid}/inspect/analyze", json={"path": item["path"], "name": "nope"}
    )
    assert res.status_code == 422


@pytest.mark.skipif(not media_engine.ffmpeg_available(), reason="ffmpeg not installed")
def test_frame_capture_from_video(client, tmp_path):
    import subprocess

    video = tmp_path / "clip.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", "testsrc=duration=2:size=160x120:rate=10", str(video)],
        check=True,
    )
    cid = client.post("/api/cases", json={"name": "Frames"}).json()["id"]
    with video.open("rb") as fh:
        item = client.post(
            f"/api/cases/{cid}/media/upload",
            files={"file": ("clip.mp4", fh, "video/mp4")},
        ).json()["item"]

    res = client.post(
        f"/api/cases/{cid}/inspect/frame", json={"path": item["path"], "time": 1.0}
    ).json()
    assert res["item"]["kind"] == "image"
    assert client.get(f"/files/{cid}/{res['item']['path']}").status_code == 200

    # sharpest-frame suggestion runs as a job
    job_id = client.post(
        f"/api/cases/{cid}/inspect/suggest", json={"path": item["path"], "bins": 4}
    ).json()["job_id"]
    for _ in range(100):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] != "running":
            break
        time.sleep(0.1)
    assert job["status"] == "done"
    assert len(job["result"]["frames"]) >= 1
