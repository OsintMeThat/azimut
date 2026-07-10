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


# -- session workspace: recipes -> filed entities (Save gate) ----------------


def test_save_frames_files_selected_images_into_folder(client):
    cid = client.post("/api/cases", json={"name": "Save"}).json()["id"]
    item = _upload(client, cid, "orig.png")
    before = len(client.get(f"/api/cases/{cid}/media").json())

    res = client.post(
        f"/api/cases/{cid}/inspect/save-frames",
        json={
            "items": [
                {"path": item["path"], "ops": [{"op": "brightness", "params": {"amount": 1.5}}],
                 "label": "Tuned"}
            ],
            "folder": "Frames",
        },
    ).json()
    saved = res["saved"]
    assert len(saved) == 1 and saved[0]["duplicate"] is False

    listing = client.get(f"/api/cases/{cid}/media").json()
    assert len(listing) == before + 1
    new_path = saved[0]["item"]["path"]
    entity = next(
        e for e in client.get(f"/api/cases/{cid}").json()["entities"]
        if e["attrs"].get("path") == new_path
    )
    assert entity["attrs"]["folder"] == "Frames"
    assert entity["provenance"]["by"] == "inspect"


def test_compose_perspective_files_one_collage(client):
    cid = client.post("/api/cases", json={"name": "Compose"}).json()["id"]
    a = _upload(client, cid, "a.png", _png_bytes(color=(10, 20, 30), size=(80, 60)))
    b = _upload(client, cid, "b.png", _png_bytes(color=(200, 100, 50), size=(80, 60)))
    before = len(client.get(f"/api/cases/{cid}/media").json())

    res = client.post(
        f"/api/cases/{cid}/inspect/compose",
        json={
            "width": 400, "height": 300,
            "nodes": [
                {"src": {"path": a["path"]},
                 "quad": [[0, 0], [200, 10], [190, 300], [0, 290]]},
                {"src": {"path": b["path"]},
                 "quad": [[200, 10], [400, 0], [400, 300], [190, 300]]},
            ],
        },
    ).json()
    assert res["duplicate"] is False
    assert len(client.get(f"/api/cases/{cid}/media").json()) == before + 1
    probe = client.get(
        f"/api/cases/{cid}/inspect/probe", params={"path": res["item"]["path"]}
    ).json()
    assert probe["width"] == 400 and probe["height"] == 300
    listing = client.get(f"/api/cases/{cid}/media").json()
    collage = next(m for m in listing if m["path"] == res["item"]["path"])
    assert collage["source"]["op"] == "collage" and collage["source"]["perspective"] is True


def test_compose_transparent_background_keeps_alpha(client):
    cid = client.post("/api/cases", json={"name": "Alpha"}).json()["id"]
    a = _upload(client, cid, "a.png", _png_bytes(color=(10, 20, 30), size=(80, 60)))

    res = client.post(
        f"/api/cases/{cid}/inspect/compose",
        json={
            "width": 400, "height": 300, "background": None,
            "nodes": [
                {"src": {"path": a["path"]},
                 "quad": [[20, 20], [120, 20], [120, 100], [20, 100]]},
            ],
        },
    ).json()
    assert res["duplicate"] is False

    png = client.get(f"/files/{cid}/{res['item']['path']}").content
    img = Image.open(io.BytesIO(png))
    assert img.mode == "RGBA"
    # a corner outside every quad stays fully transparent
    assert img.getpixel((0, 0))[3] == 0
    # a pixel inside the placed piece is opaque
    assert img.getpixel((60, 60))[3] == 255


def test_compose_node_crop_is_applied_before_warp(client):
    cid = client.post("/api/cases", json={"name": "CropWarp"}).json()["id"]
    # left half white, right half black — crop keeps the white half only
    two_tone = Image.new("RGB", (80, 60), (0, 0, 0))
    two_tone.paste((255, 255, 255), (0, 0, 40, 60))
    buf = io.BytesIO()
    two_tone.save(buf, "PNG")
    a = _upload(client, cid, "two.png", buf.getvalue())

    res = client.post(
        f"/api/cases/{cid}/inspect/compose",
        json={
            "width": 100, "height": 100, "background": None,
            "nodes": [
                {
                    "src": {"path": a["path"], "ops": [
                        {"op": "crop", "params": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0}},
                    ]},
                    "quad": [[0, 0], [100, 0], [100, 100], [0, 100]],
                },
            ],
        },
    ).json()
    assert res["duplicate"] is False

    png = client.get(f"/files/{cid}/{res['item']['path']}").content
    img = Image.open(io.BytesIO(png))
    # the whole canvas is filled by the (cropped) white half, so the interior is white
    r, g, b, alpha = img.getpixel((50, 50))
    assert alpha == 255
    assert r > 200 and g > 200 and b > 200


def test_compose_requires_nodes(client):
    cid = client.post("/api/cases", json={"name": "NoNodes"}).json()["id"]
    res = client.post(
        f"/api/cases/{cid}/inspect/compose", json={"width": 100, "height": 100, "nodes": []}
    )
    assert res.status_code == 422


def test_compose_preview_returns_png_without_filing(client):
    cid = client.post("/api/cases", json={"name": "Preview"}).json()["id"]
    a = _upload(client, cid, "a.png", _png_bytes(color=(10, 20, 30), size=(80, 60)))
    before = len(client.get(f"/api/cases/{cid}/media").json())

    res = client.post(
        f"/api/cases/{cid}/inspect/compose-preview",
        json={
            "width": 400, "height": 300, "background": None,
            "nodes": [
                {"src": {"path": a["path"]},
                 "quad": [[20, 20], [120, 20], [120, 100], [20, 100]]},
            ],
        },
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    img = Image.open(io.BytesIO(res.content))
    # downscaled to max_dim=640 (so <= the 400x300 request) and transparent alpha
    assert img.mode == "RGBA"
    assert max(img.size) <= 640
    assert img.getpixel((0, 0))[3] == 0
    # nothing was filed to the case
    assert len(client.get(f"/api/cases/{cid}/media").json()) == before


def test_analyze_accepts_transient_ops_without_filing(client):
    cid = client.post("/api/cases", json={"name": "AnalyzeOps"}).json()["id"]
    item = _upload(client, cid, "img.png", _png_bytes(color=(255, 0, 0), size=(20, 20)))
    before = len(client.get(f"/api/cases/{cid}/media").json())

    res = client.post(
        f"/api/cases/{cid}/inspect/analyze",
        json={"path": item["path"], "name": "histogram",
              "ops": [{"op": "invert", "params": {"on": 1}}]},
    ).json()
    assert res["kind"] == "histogram"
    # inverting pure red pushes the red channel to 0
    assert res["channels"]["r"][0] == 400
    # analysing a transient recipe files nothing
    assert len(client.get(f"/api/cases/{cid}/media").json()) == before


@pytest.mark.skipif(not media_engine.ffmpeg_available(), reason="ffmpeg not installed")
def test_frame_preview_returns_png_without_filing(client, tmp_path):
    import subprocess

    video = tmp_path / "clip.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", "testsrc=duration=2:size=160x120:rate=10", str(video)],
        check=True,
    )
    cid = client.post("/api/cases", json={"name": "Preview"}).json()["id"]
    with video.open("rb") as fh:
        item = client.post(
            f"/api/cases/{cid}/media/upload", files={"file": ("clip.mp4", fh, "video/mp4")}
        ).json()["item"]
    before = len(client.get(f"/api/cases/{cid}/media").json())

    res = client.post(
        f"/api/cases/{cid}/inspect/frame/preview", json={"path": item["path"], "time": 1.0}
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(res.content)).size == (160, 120)
    # a preview never files anything
    assert len(client.get(f"/api/cases/{cid}/media").json()) == before


@pytest.mark.skipif(not media_engine.ffmpeg_available(), reason="ffmpeg not installed")
def test_enhance_video_files_new_video(client, tmp_path):
    import subprocess

    video = tmp_path / "clip.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", "testsrc=duration=1:size=160x120:rate=10", str(video)],
        check=True,
    )
    cid = client.post("/api/cases", json={"name": "Enhance"}).json()["id"]
    with video.open("rb") as fh:
        item = client.post(
            f"/api/cases/{cid}/media/upload", files={"file": ("clip.mp4", fh, "video/mp4")}
        ).json()["item"]

    res = client.post(
        f"/api/cases/{cid}/inspect/enhance-video",
        json={"path": item["path"], "params": {"brightness": 1.3, "contrast": 1.2},
              "folder": "Enhanced"},
    ).json()
    assert res["duplicate"] is False
    new_path = res["item"]["path"]
    assert new_path.endswith(".mp4")
    probe = client.get(
        f"/api/cases/{cid}/inspect/probe", params={"path": new_path}
    ).json()
    assert probe["kind"] == "video"
    entity = next(
        e for e in client.get(f"/api/cases/{cid}").json()["entities"]
        if e["attrs"].get("path") == new_path
    )
    assert entity["attrs"]["folder"] == "Enhanced"


def test_render_preview_applies_ops_without_filing(client):
    cid = client.post("/api/cases", json={"name": "Render"}).json()["id"]
    item = _upload(client, cid, "img.png", _png_bytes(color=(255, 0, 0), size=(30, 20)))
    before = len(client.get(f"/api/cases/{cid}/media").json())

    res = client.post(
        f"/api/cases/{cid}/inspect/render-preview",
        json={"path": item["path"], "ops": [{"op": "crop", "params": {"x": 0, "y": 0, "w": 0.5, "h": 1}}]},
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(res.content)).size == (15, 20)  # cropped to half width
    assert len(client.get(f"/api/cases/{cid}/media").json()) == before  # nothing filed


def test_session_save_list_load_delete_roundtrip(client):
    cid = client.post("/api/cases", json={"name": "Session"}).json()["id"]
    item = _upload(client, cid, "clip.png")
    spec = {
        "source": {"path": item["path"], "kind": "image"},
        "videoAdjust": {},
        "frames": [{"id": "fr1", "path": item["path"], "time": None, "adjust": {"brightness": 1.4}, "crop": None}],
        "collage": {"width": 800, "height": 400, "background": "#101010", "nodes": []},
    }
    saved = client.post(
        f"/api/cases/{cid}/inspect/sessions", json={"title": "My session", "spec": spec}
    ).json()
    assert saved["name"] == "my-session"

    listing = client.get(f"/api/cases/{cid}/inspect/sessions").json()
    assert len(listing) == 1 and listing[0]["title"] == "My session" and listing[0]["frames"] == 1

    # an inspect-session entity is upserted so it reopens from the sidebar
    entities = client.get(f"/api/cases/{cid}").json()["entities"]
    ent = next(e for e in entities if e["type"] == "inspect-session")
    assert ent["attrs"]["spec"] == "inspect/my-session.json"

    loaded = client.get(f"/api/cases/{cid}/inspect/sessions/my-session").json()
    assert loaded["ozimut_inspect"] == 1
    assert loaded["frames"][0]["adjust"]["brightness"] == 1.4

    # re-saving under the same title updates in place (no duplicate entity)
    client.post(f"/api/cases/{cid}/inspect/sessions", json={"title": "My session", "spec": spec})
    entities = client.get(f"/api/cases/{cid}").json()["entities"]
    assert sum(1 for e in entities if e["type"] == "inspect-session") == 1

    client.delete(f"/api/cases/{cid}/inspect/sessions/my-session")
    assert client.get(f"/api/cases/{cid}/inspect/sessions").json() == []
    entities = client.get(f"/api/cases/{cid}").json()["entities"]
    assert not any(e["type"] == "inspect-session" for e in entities)


def test_session_delete_via_sidebar_entity_removes_spec(client):
    # Deleting the inspect-session row from the sidebar (the generic entity
    # delete) must also drop the spec file, or the session keeps showing up in
    # the Inspect "Open" dialog and can be reloaded.
    cid = client.post("/api/cases", json={"name": "Sidebar delete"}).json()["id"]
    item = _upload(client, cid, "clip.png")
    spec = {"source": {"path": item["path"], "kind": "image"}, "frames": [], "collage": {"nodes": []}}
    client.post(f"/api/cases/{cid}/inspect/sessions", json={"title": "Doomed", "spec": spec})

    entities = client.get(f"/api/cases/{cid}").json()["entities"]
    ent = next(e for e in entities if e["type"] == "inspect-session")

    client.delete(f"/api/cases/{cid}/entities/{ent['id']}")

    # gone from the Open list (spec file unlinked) and not reloadable
    assert client.get(f"/api/cases/{cid}/inspect/sessions").json() == []
    assert client.get(f"/api/cases/{cid}/inspect/sessions/doomed").status_code == 404


def test_session_resave_by_name_overwrites_after_rename(client):
    # Reopening a session then saving it re-uses its slug (name), so a title
    # change updates the same session in place instead of forking a new one.
    cid = client.post("/api/cases", json={"name": "Rename"}).json()["id"]
    item = _upload(client, cid, "clip.png")
    spec = {"source": {"path": item["path"], "kind": "image"}, "frames": [], "collage": {"nodes": []}}

    first = client.post(
        f"/api/cases/{cid}/inspect/sessions", json={"title": "Original", "spec": spec}
    ).json()
    assert first["name"] == "original"

    client.post(
        f"/api/cases/{cid}/inspect/sessions",
        json={"name": first["name"], "title": "Renamed", "spec": spec},
    )
    listing = client.get(f"/api/cases/{cid}/inspect/sessions").json()
    assert len(listing) == 1
    assert listing[0]["name"] == "original" and listing[0]["title"] == "Renamed"
    entities = client.get(f"/api/cases/{cid}").json()["entities"]
    assert sum(1 for e in entities if e["type"] == "inspect-session") == 1


@pytest.mark.skipif(not media_engine.ffmpeg_available(), reason="ffmpeg not installed")
def test_enhance_video_rejects_neutral_params(client, tmp_path):
    import subprocess

    video = tmp_path / "clip.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", "testsrc=duration=1:size=160x120:rate=10", str(video)],
        check=True,
    )
    cid = client.post("/api/cases", json={"name": "Neutral"}).json()["id"]
    with video.open("rb") as fh:
        item = client.post(
            f"/api/cases/{cid}/media/upload", files={"file": ("clip.mp4", fh, "video/mp4")}
        ).json()["item"]
    res = client.post(
        f"/api/cases/{cid}/inspect/enhance-video", json={"path": item["path"], "params": {}}
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
