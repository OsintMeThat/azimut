"""Inspect tool: probe, adjustments (bake), collage, analyses, frame capture.

Image-based features use Pillow only (deterministic, no ffmpeg). Frame capture
needs ffmpeg and is skipped when it is unavailable in the environment.
"""

import io
import subprocess
import threading

import graph_read

import pytest
from jobwait import job_result
from PIL import Image

from azimut.engine import inspect as inspect_engine
from azimut.engine import media as media_engine
from azimut.workspace import Case


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
    assert {a["id"] for a in ops["analyses"]} == {"ela"}
    channel = next(f for f in ops["filters"] if f["id"] == "channel")
    assert channel["params"][0]["type"] == "choice"
    assert [o["label"] for o in channel["params"][0]["options"]] == ["All", "Red", "Green", "Blue"]
    assert channel["css"] is None
    assert brightness["params"][0]["options"] == []
    assert {"denoise", "autolevels", "clahe", "channel"} <= ids


def test_video_rotation_filterchain_covers_every_orientation_control():
    assert inspect_engine._video_filterchain({}, -180) == "hflip,vflip"
    assert inspect_engine._video_filterchain({}, -90) == "transpose=cclock"
    assert inspect_engine._video_filterchain({}, 0) is None
    assert inspect_engine._video_filterchain({}, 90) == "transpose=clock"
    assert inspect_engine._video_filterchain({}, 180) == "hflip,vflip"
    with pytest.raises(ValueError, match="video rotation"):
        inspect_engine._video_filterchain({}, 45)


def test_brightness_slider_reaches_x4_on_a_curved_travel(client):
    filters = {f["id"]: f for f in client.get("/api/inspect/ops").json()["filters"]}
    brightness = filters["brightness"]["params"][0]
    assert (brightness["min"], brightness["max"], brightness["default"]) == (0, 4, 1)
    assert brightness["travel"] == "centred"
    assert {filters[k]["params"][0]["travel"] for k in ("contrast", "saturation", "gamma", "sharpness")} == {"linear"}


def test_video_brightness_multiplies_rgb_ahead_of_the_other_tones():
    """The preview's CSS runs brightness, contrast, saturate, grayscale, invert in that order."""
    gain = "round(val*3)"
    lut = f"lutrgb=r={gain}:g={gain}:b={gain},format=yuv420p"
    tones = {"brightness": 3, "contrast": 1.2, "saturation": 0.8, "gamma": 1, "grayscale": 0, "invert": 1}
    assert inspect_engine._video_filterchain(tones, 90) == (
        f"transpose=clock,{lut},eq=contrast=1.2:saturation=0.8:gamma=1.0,negate"
    )
    assert inspect_engine._video_filterchain({"brightness": 3}, 0) == lut
    assert inspect_engine._video_filterchain({"brightness": 1.35}, 0) == (
        "lutrgb=r=round(val*1.35):g=round(val*1.35):b=round(val*1.35),format=yuv420p"
    )
    # neutral brightness adds no lookup table, and `eq` never carries a brightness again
    assert inspect_engine._video_filterchain({"brightness": 1, "contrast": 1.2}, 0) == (
        "eq=contrast=1.2:saturation=1.0:gamma=1.0"
    )
    assert inspect_engine._video_filterchain({"brightness": 1, "grayscale": 1}, 0) == (
        "eq=contrast=1.0:saturation=0.0:gamma=1.0"
    )
    assert "brightness=" not in inspect_engine._video_filterchain(tones, 0)


@pytest.mark.parametrize("params", [
    {"brightness": 4}, {"brightness": 0}, {"brightness": 2}, {"contrast": 2, "gamma": 0.2},
])
def test_video_tones_up_to_their_slider_ends_are_accepted(params):
    assert inspect_engine._video_filterchain(params, 0)


@pytest.mark.parametrize("params,message", [
    ({"brightness": 4.2}, "brightness must be between 0 and 4"),
    ({"brightness": -1}, "brightness must be between 0 and 4"),
    ({"contrast": 3}, "contrast must be between 0 and 2"),
    ({"gamma": 0.1}, "gamma must be between 0.2 and 3"),
])
def test_video_tones_past_their_slider_are_refused(params, message):
    with pytest.raises(ValueError, match=message):
        inspect_engine._video_filterchain(params, 0)


def test_a_preview_past_x4_brightness_is_refused(client):
    cid = client.post("/api/cases", json={"name": "Bounds"}).json()["id"]
    item = _upload(client, cid, "img.png", _png_bytes(color=(40, 40, 40), size=(10, 10)))
    url = f"/api/cases/{cid}/inspect/render-preview"

    ok = client.post(url, json={"path": item["path"], "ops": [{"op": "brightness", "params": {"amount": 4}}]})
    assert ok.status_code == 200
    assert Image.open(io.BytesIO(ok.content)).convert("RGB").getpixel((0, 0)) == (160, 160, 160)
    old = client.post(url, json={"path": item["path"], "ops": [{"op": "brightness", "params": {"amount": 1.5}}]})
    assert Image.open(io.BytesIO(old.content)).convert("RGB").getpixel((0, 0)) == (60, 60, 60)

    res = client.post(url, json={"path": item["path"], "ops": [{"op": "brightness", "params": {"amount": 4.5}}]})
    assert res.status_code == 422
    assert "brightness must be between 0 and 4" in res.text


def test_focus_scan_redirects_stderr_and_terminates_a_stalled_decoder(client, monkeypatch):
    cid = client.post("/api/cases", json={"name": "Scan"}).json()["id"]
    case = Case.open(cid)
    video = case.subdir("media") / "clip.mp4"
    video.write_bytes(b"placeholder")
    stopped = threading.Event()
    seen = {}

    class BlockingStdout:
        def read(self, _size):
            stopped.wait(timeout=1)
            return b""

        def close(self):
            pass

    class FakeProcess:
        returncode = None

        def __init__(self, *args, stdout=None, stderr=None, **kwargs):
            seen["stderr"] = stderr
            self.stdout = BlockingStdout()

        def poll(self):
            return self.returncode

        def terminate(self):
            self.returncode = -15
            stopped.set()

        def kill(self):
            self.returncode = -9
            stopped.set()

        def wait(self, timeout=None):
            if self.returncode is None:
                raise subprocess.TimeoutExpired("ffmpeg", timeout)
            return self.returncode

    monkeypatch.setattr(media_engine, "ffmpeg_available", lambda: True)
    monkeypatch.setattr(inspect_engine, "probe", lambda *_args: {
        "fps": 25, "duration": 1, "width": 16, "height": 16,
    })
    monkeypatch.setattr(inspect_engine, "_scan_timeout", lambda _duration: 0.01)
    monkeypatch.setattr(inspect_engine.subprocess, "Popen", FakeProcess)

    with pytest.raises(RuntimeError, match="timed out"):
        inspect_engine.scan_video(case, "media/clip.mp4")
    assert stopped.is_set()
    assert seen["stderr"] is not subprocess.PIPE


def test_probe_image(client):
    cid = client.post("/api/cases", json={"name": "Probe"}).json()["id"]
    item = _upload(client, cid, "shot.png", _png_bytes(size=(120, 90)))
    probe = client.get(f"/api/cases/{cid}/inspect/probe", params={"path": item["path"]}).json()
    assert probe["kind"] == "image"
    assert probe["width"] == 120 and probe["height"] == 90


def test_save_frames_files_adjusted_derivative(client):
    cid = client.post("/api/cases", json={"name": "Bake"}).json()["id"]
    item = _upload(client, cid, "orig.png")

    res = client.post(
        f"/api/cases/{cid}/inspect/save-frames",
        json={"items": [{"path": item["path"],
                         "ops": [{"op": "brightness", "params": {"amount": 1.4}}],
                         "label": "Brightened"}]},
    ).json()["saved"][0]
    assert res["duplicate"] is False
    new_path = res["item"]["path"]
    assert new_path != item["path"]

    # filed as a new media with inspect provenance and served
    listing = client.get(f"/api/cases/{cid}/media").json()
    assert len(listing) == 2
    entities = graph_read.entities(cid)
    derived = next(e for e in entities if e["attrs"]["path"] == new_path)
    assert derived["provenance"]["by"] == "inspect"
    assert client.get(f"/files/{cid}/{new_path}").status_code == 200

    # derivation recorded in the sidecar source (auditable)
    updated = next(m for m in listing if m["path"] == new_path)
    assert updated["source"]["op"] == "adjust"
    assert updated["source"]["from"] == item["path"]

    # the label reaches the sidecar title and the entity label — a labeled
    # save must never be a silent no-op
    assert updated["title"] == "Brightened"
    assert derived["label"] == "Brightened"


def test_save_frames_unknown_filter_is_rejected(client):
    cid = client.post("/api/cases", json={"name": "BadOp"}).json()["id"]
    item = _upload(client, cid, "x.png")
    res = client.post(
        f"/api/cases/{cid}/inspect/save-frames",
        json={"items": [{"path": item["path"], "ops": [{"op": "nope", "params": {}}]}]},
    )
    assert res.status_code == 422


def test_crop_op_reduces_dimensions(client):
    cid = client.post("/api/cases", json={"name": "Crop"}).json()["id"]
    item = _upload(client, cid, "big.png", _png_bytes(size=(200, 100)))
    res = client.post(
        f"/api/cases/{cid}/inspect/save-frames",
        json={"items": [{"path": item["path"],
                         "ops": [{"op": "crop",
                                  "params": {"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5}}]}]},
    ).json()["saved"][0]
    probe = client.get(
        f"/api/cases/{cid}/inspect/probe", params={"path": res["item"]["path"]}
    ).json()
    assert probe["width"] == 100 and probe["height"] == 50


def test_rotate_op_saves_image_in_selected_orientation(client):
    cid = client.post("/api/cases", json={"name": "Rotate image"}).json()["id"]
    item = _upload(client, cid, "landscape.png", _png_bytes(size=(120, 80)))
    res = client.post(
        f"/api/cases/{cid}/inspect/save-frames",
        json={"items": [{
            "path": item["path"],
            "ops": [{"op": "rotate", "params": {"angle": -90}}],
        }]},
    ).json()["saved"][0]
    probe = client.get(
        f"/api/cases/{cid}/inspect/probe", params={"path": res["item"]["path"]}
    ).json()
    assert probe["width"] == 80 and probe["height"] == 120


def test_compose_combines_images(client):
    cid = client.post("/api/cases", json={"name": "Collage"}).json()["id"]
    a = _upload(client, cid, "a.png", _png_bytes(color=(10, 20, 30)))
    b = _upload(client, cid, "b.png", _png_bytes(color=(200, 100, 50)))

    res = client.post(
        f"/api/cases/{cid}/inspect/compose",
        json={"width": 230, "height": 120,
              "nodes": [
                  {"src": {"path": a["path"]},
                   "quad": [[10, 10], [110, 10], [110, 110], [10, 110]]},
                  {"src": {"path": b["path"]},
                   "quad": [[120, 10], [220, 10], [220, 110], [120, 110]]},
              ]},
    ).json()
    assert res["duplicate"] is False
    probe = client.get(
        f"/api/cases/{cid}/inspect/probe", params={"path": res["item"]["path"]}
    ).json()
    assert probe["width"] == 230 and probe["height"] == 120
    assert client.get(f"/api/cases/{cid}/media").json().__len__() == 3


def test_compose_requires_nodes(client):
    cid = client.post("/api/cases", json={"name": "Empty"}).json()["id"]
    res = client.post(
        f"/api/cases/{cid}/inspect/compose",
        json={"width": 100, "height": 100, "nodes": []},
    )
    assert res.status_code == 422


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
        e for e in graph_read.entities(cid)
        if e["attrs"].get("path") == new_path
    )
    assert entity["attrs"]["folder"] == "Frames"
    assert entity["provenance"]["by"] == "inspect"


def test_saved_frame_is_filed_under_its_name_alone(client):
    """The tray's name is the filename: no wall-clock stamp trailing it.

    The name the tray sends already carries the timecode, and the analyst reads
    these files in a folder outside the app, so anything else added here is noise.
    """
    cid = client.post("/api/cases", json={"name": "Named"}).json()["id"]
    item = _upload(client, cid, "orig.png")

    res = client.post(
        f"/api/cases/{cid}/inspect/save-frames",
        json={"items": [{"path": item["path"],
                         "ops": [{"op": "brightness", "params": {"amount": 1.5}}],
                         "label": "00-00-19 Convoy dashcam"}]},
    ).json()

    assert res["saved"][0]["item"]["path"] == "media/00-00-19 Convoy dashcam.png"


def test_two_frames_saved_under_one_name_keep_both_files(client):
    """Dropping the stamp must not let the second save land on the first."""
    cid = client.post("/api/cases", json={"name": "Twice"}).json()["id"]
    item = _upload(client, cid, "orig.png")

    paths = []
    for amount in (1.5, 0.5):  # different pixels, so neither is deduped away
        res = client.post(
            f"/api/cases/{cid}/inspect/save-frames",
            json={"items": [{"path": item["path"],
                             "ops": [{"op": "brightness", "params": {"amount": amount}}],
                             "label": "00-00-19 Convoy dashcam"}]},
        ).json()
        paths.append(res["saved"][0]["item"]["path"])

    assert paths == ["media/00-00-19 Convoy dashcam.png", "media/00-00-19 Convoy dashcam-1.png"]
    assert len({m["path"] for m in client.get(f"/api/cases/{cid}/media").json()}) == 3


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


def _stripes(size=(100, 40), split=20) -> bytes:
    """Dark above, light from row ``split`` down: a level edge to bend."""
    img = Image.new("RGB", size, (0, 0, 0))
    img.paste((255, 255, 255), (0, split, size[0], size[1]))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _rect(left, top, right, bottom):
    return [[left, top], [right, top], [right, bottom], [left, bottom]]


def test_straighten_bends_each_piece_alike_and_files_one_picture_each(client):
    """Collage → Straighten: every column of every piece moved by its own shift, the pieces bent apart,
    each filed with the file and instant it was bent from, trimmed to what it holds, its box said."""
    cid = client.post("/api/cases", json={"name": "Bend"}).json()["id"]
    a = _upload(client, cid, "a.png", _stripes())
    b = _upload(client, cid, "b.png", _stripes(size=(60, 40)))
    # the edge falls 0 px at the left, 20 px at the right of the canvas: a slope across both pieces
    shifts = [-20.0 * x / 159 for x in range(160)]
    res = client.post(f"/api/cases/{cid}/inspect/straighten", json={
        "width": 160, "height": 80, "bend": shifts, "nodes": [
            {"src": {"path": a["path"]}, "quad": _rect(0, 30, 100, 70), "label": "Pan straightened a"},
            {"src": {"path": b["path"]}, "quad": _rect(100, 30, 160, 70), "label": "Pan straightened b"},
        ],
    })
    assert res.status_code == 200, res.text
    first, second = res.json()["pieces"]
    # its right column rises 20 * 99 / 159 = 12.45 px, so its top row is 17, its bottom stays at 70
    assert first["box"] == [0, 17, 100, 70] and second["box"][0] == 100 and second["box"][2] == 160
    listing = {m["path"]: m for m in client.get(f"/api/cases/{cid}/media").json()}
    for piece, source, title in ((first, a, "Pan straightened a"), (second, b, "Pan straightened b")):
        item = listing[piece["item"]["path"]]
        assert item["title"] == title
        assert item["source"]["op"] == "collage" and item["source"]["straightened"] is True
        assert (item["source"]["sources"], item["source"]["times"]) == ([source["path"]], [None])
    img = Image.open(io.BytesIO(client.get(f"/files/{cid}/{first['item']['path']}").content))
    assert img.size == (100, 53) and img.mode == "RGBA"
    # inside the piece, not just at its corners: the edge rises across it, column by column
    def edge(picture, x: int) -> int:
        return next(y for y in range(picture.height) if picture.getpixel((x, y))[0] > 128)
    assert edge(img, 0) == 50 - 17 and abs(edge(img, 99) - (50 - 20 * 99 / 159 - 17)) <= 1
    # the second piece carries the slope on where the first left it, so the seam holds
    other = Image.open(io.BytesIO(client.get(f"/files/{cid}/{second['item']['path']}").content))
    top = second["box"][1]
    assert abs((edge(other, 0) + top) - (edge(img, 99) + 17)) <= 1


def test_straighten_needs_a_shift_a_column(client):
    cid = client.post("/api/cases", json={"name": "Bend2"}).json()["id"]
    a = _upload(client, cid, "a.png", _png_bytes(size=(40, 40)))
    node = {"src": {"path": a["path"]}, "quad": _rect(0, 0, 40, 40)}
    short = client.post(f"/api/cases/{cid}/inspect/straighten", json={"width": 40, "height": 40, "bend": [0.0] * 20, "nodes": [node]})
    assert short.status_code == 422
    endless = client.post(f"/api/cases/{cid}/inspect/straighten",
                          json={"width": 40, "height": 40, "bend": [0.0] * 39 + ["NaN"], "nodes": [node]})
    assert endless.status_code == 422


def test_straighten_files_every_piece_or_none(client):
    cid = client.post("/api/cases", json={"name": "Bend3"}).json()["id"]
    a = _upload(client, cid, "a.png", _stripes())
    before = {m["path"] for m in client.get(f"/api/cases/{cid}/media").json()}
    res = client.post(f"/api/cases/{cid}/inspect/straighten", json={
        "width": 160, "height": 80, "bend": [0.0] * 160, "nodes": [
            {"src": {"path": a["path"]}, "quad": _rect(0, 20, 100, 60), "label": "Kept"},
            {"src": {"path": "media/gone.png"}, "quad": _rect(100, 20, 160, 60), "label": "Gone"},
        ],
    })
    assert res.status_code in (400, 422)
    # the first piece, filed before the second failed, is taken back
    assert {m["path"] for m in client.get(f"/api/cases/{cid}/media").json()} == before


def test_straightening_each_piece_composes_as_bending_the_whole_collage(client):
    """The pieces bent one by one and laid at their boxes against the whole collage composed then bent,
    as Straighten did before it kept one picture per piece. Overlapping pieces, three of them remapped
    onto a cylinder with their footprint in alpha, two laid across them higher and lower so their top
    and bottom edges cross the others, and a bend with fractional shifts.

    The two agree within 2 levels (rounding) everywhere but on each piece's soft top and bottom edge, the
    row of pixels its footprint only partly covers and the row either side of it. There the order
    differs: a bend reads each pixel between two rows, t of the way, and reading a piece and then laying
    it over the one below is not laying it and then reading both. The gap is exactly
    t(1 - t) * (how much the piece's cover changes between the rows) * (how much the picture below does),
    at most a quarter of a full step: 64 levels, 66 with the rounding. On these hard-edged blobs it
    reaches 17 to 33 levels on some 0.05% of the pixels; softer, camera-like pictures stay nearer 10."""
    import math

    import numpy as np

    cid = client.post("/api/cases", json={"name": "Equivalent"}).json()["id"]
    paths = [_upload(client, cid, f"v{i}.png", png)["path"] for i, png in enumerate(_pan_pngs())]
    solved = client.post(f"/api/cases/{cid}/inspect/auto-stitch", json={
        "width": 1200, "height": 600, "mode": "cylindrical", "nodes": [{"path": p} for p in paths],
    }).json()
    width, tall = solved["canvas"]["width"], solved["canvas"]["height"]
    nodes = [{"src": {"path": paths[n["index"]], "time": None, "ops": [n["op"]]}, "quad": n["quad"]} for n in solved["nodes"]]
    left_png, right_png = _overlapping_pair()
    a = _upload(client, cid, "a.png", left_png)["path"]
    b = _upload(client, cid, "b.png", right_png)["path"]
    nodes.append({"src": {"path": a, "time": None, "ops": []},
                  "quad": [[100, tall * 0.45], [520, tall * 0.42], [530, tall * 0.85], [110, tall * 0.88]]})
    nodes.append({"src": {"path": b, "time": None, "ops": []}, "quad": _rect(width * 0.5, 30.3, width * 0.5 + 400, 330.7)})
    shifts = [12.3 * math.sin(c / width * math.pi * 1.7) + 7.1 * c / width - 3.3 for c in range(width)]
    pad = math.ceil(-min(shifts))
    height = tall + pad + math.ceil(max(shifts))
    nodes = [{**n, "quad": [[x, y + pad] for x, y in n["quad"]]} for n in nodes]

    # before: the whole collage composed, then bent as one picture
    canvas, _, _ = inspect_engine._compose_canvas(Case.open(cid), width=width, height=height, nodes=nodes, background=None)
    whole = np.asarray(inspect_engine._bent(canvas, shifts)).astype(np.float64)
    # now: each piece bent and filed, then the pictures laid at their boxes as the collage exports them
    res = client.post(f"/api/cases/{cid}/inspect/straighten", json={
        "width": width, "height": height, "bend": shifts,
        "nodes": [{**n, "label": f"Piece {i}"} for i, n in enumerate(nodes)],
    })
    assert res.status_code == 200, res.text
    pieces = res.json()["pieces"]
    laid = client.post(f"/api/cases/{cid}/inspect/compose", json={
        "width": width, "height": height, "background": None,
        "nodes": [{"src": {"path": p["item"]["path"]}, "quad": _rect(*p["box"])} for p in pieces],
    }).json()
    apart = np.asarray(Image.open(io.BytesIO(client.get(f"/files/{cid}/{laid['item']['path']}").content)).convert("RGBA")).astype(np.float64)

    soft = np.zeros(whole.shape[:2], bool)
    for piece in pieces:
        left, top, right, bottom = piece["box"]
        alpha = np.asarray(Image.open(io.BytesIO(client.get(f"/files/{cid}/{piece['item']['path']}").content)))[..., 3]
        edge = (alpha > 0) & (alpha < 255)
        edge[1:] |= edge[:-1].copy()
        edge[:-1] |= edge[1:].copy()
        soft[top:bottom, left:right] |= edge
    assert soft.mean() < 0.05

    alpha_off = np.abs(whole[..., 3] - apart[..., 3])
    assert alpha_off[~soft].max() <= 1
    for ground in (0.0, 128.0, 255.0):
        def shown(px, ground=ground):
            cover = px[..., 3:4] / 255.0
            return px[..., :3] * cover + ground * (1 - cover)

        off = np.abs(shown(whole) - shown(apart)).max(axis=2)
        assert off[~soft].max() <= 2, ground
        assert (off[~soft] > 1).sum() <= 20, ground
        assert off[soft].max() <= 66, ground
        assert (off > 1).mean() < 0.001, ground


def test_compose_cuts_the_picture_to_the_collages_frame(client):
    """Collage → Cut: the picture keeps what lies inside the frame, the pieces composed whole first."""
    cid = client.post("/api/cases", json={"name": "Cut"}).json()["id"]
    a = _upload(client, cid, "a.png", _stripes(size=(100, 40), split=20))
    node = {"src": {"path": a["path"]}, "quad": _rect(0, 0, 100, 40)}

    res = client.post(f"/api/cases/{cid}/inspect/compose", json={
        "width": 100, "height": 40, "background": None, "nodes": [node], "clip": {"x": 10.4, "y": -5, "w": 60, "h": 30},
    })
    assert res.status_code == 200, res.text
    img = Image.open(io.BytesIO(client.get(f"/files/{cid}/{res.json()['item']['path']}").content))
    # cut to the frame where it lies over the canvas, the ragged lower part gone
    assert img.size == (60, 25)
    assert img.getpixel((0, 0))[:3] == (0, 0, 0) and img.getpixel((0, 24))[:3] == (255, 255, 255)

    for bad in ({"x": 0, "y": 0, "w": 0, "h": 10}, {"x": "NaN", "y": 0, "w": 10, "h": 10},
                {"x": 500, "y": 0, "w": 10, "h": 10}):
        refused = client.post(f"/api/cases/{cid}/inspect/compose", json={
            "width": 100, "height": 40, "background": None, "nodes": [node], "clip": bad,
        })
        assert refused.status_code == 422, bad


def test_compose_paints_through_a_remapped_piece_footprint(client):
    """A panorama piece's transparent corners must stay holes, not black wedges.

    The remap projects onto a curve, so the output rectangle overhangs the piece.
    Composited naively that overhang paints over whatever the piece overlaps —
    which, in a panorama, is always its neighbour.
    """
    cid = client.post("/api/cases", json={"name": "RemapCompose"}).json()["id"]
    pngs = _pan_pngs()
    paths = [_upload(client, cid, f"v{i}.png", png)["path"] for i, png in enumerate(pngs)]
    solved = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={
            "width": 1600, "height": 800, "mode": "cylindrical",
            "nodes": [{"path": p} for p in paths],
        },
    ).json()
    node = solved["nodes"][0]

    res = client.post(
        f"/api/cases/{cid}/inspect/compose",
        json={
            "width": 1600, "height": 800, "background": None,
            "nodes": [{"src": {"path": paths[0], "ops": [node["op"]]}, "quad": node["quad"]}],
        },
    ).json()

    png = client.get(f"/files/{cid}/{res['item']['path']}").content
    img = Image.open(io.BytesIO(png))
    quad = node["quad"]
    x0, y0 = quad[0]
    x1, y1 = quad[2]
    # Just inside the piece's own top-left corner: on the rectangle, off the curve.
    inset = (round(x0 + 2), round(y0 + 2))
    assert img.getpixel(inset)[3] == 0
    # ...while its middle is painted.
    assert img.getpixel((round((x0 + x1) / 2), round((y0 + y1) / 2)))[3] == 255


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


def _overlapping_pair(seed=13):
    """Two crops of one textured scene, sharing 200px — a stitchable pair."""
    import random

    from PIL import ImageDraw

    rng = random.Random(seed)
    scene = Image.new("RGB", (900, 500), (18, 20, 28))
    draw = ImageDraw.Draw(scene)
    for _ in range(220):
        x, y, r = rng.randrange(900), rng.randrange(500), rng.randrange(6, 34)
        color = (rng.randrange(40, 255), rng.randrange(40, 255), rng.randrange(40, 255))
        draw.ellipse([x, y, x + r, y + r], fill=color)
    out = []
    for box in [(0, 0, 500, 500), (300, 0, 800, 500)]:
        buf = io.BytesIO()
        scene.crop(box).save(buf, "PNG")
        out.append(buf.getvalue())
    return out


def test_auto_stitch_solves_quads_without_filing_anything(client):
    cid = client.post("/api/cases", json={"name": "Stitch"}).json()["id"]
    left_png, right_png = _overlapping_pair()
    a = _upload(client, cid, "left.png", left_png)
    b = _upload(client, cid, "right.png", right_png)
    before = len(client.get(f"/api/cases/{cid}/media").json())

    res = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={
            "width": 1200, "height": 600,
            "nodes": [{"path": a["path"]}, {"path": b["path"]}],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["dropped"] == []
    assert [n["index"] for n in body["nodes"]] == [0, 1]
    canvas = body["canvas"]
    for node in body["nodes"]:
        assert len(node["quad"]) == 4
        for x, y in node["quad"]:
            assert -1 <= x <= canvas["width"] + 1 and -1 <= y <= canvas["height"] + 1
    # Layout only: auto-stitch is not a Save gate, so no media may appear.
    assert len(client.get(f"/api/cases/{cid}/media").json()) == before


def test_auto_stitch_answers_with_the_canvas_the_stitch_is_worth(client):
    """The quads are only as good as the canvas they are read against, so the
    route says which one it sized them for. Here the caller's canvas is smaller
    than a single piece: keeping it would export the stitch at a fraction of the
    pixels it was solved from."""
    cid = client.post("/api/cases", json={"name": "StitchCanvas"}).json()["id"]
    left_png, right_png = _overlapping_pair()
    a = _upload(client, cid, "left.png", left_png)
    b = _upload(client, cid, "right.png", right_png)

    body = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={
            "width": 240, "height": 200,
            "nodes": [{"path": a["path"]}, {"path": b["path"]}],
        },
    ).json()

    # The pieces are 500px crops overlapping by 200, so the panorama is ~800 wide.
    assert body["canvas"]["width"] > 700
    assert body["canvas"]["height"] > 200
    # And the canvas stays composable: compose refuses a side over 8192.
    assert body["canvas"]["width"] <= 8192 and body["canvas"]["height"] <= 8192


def test_auto_stitch_reports_a_piece_it_cannot_place(client):
    cid = client.post("/api/cases", json={"name": "StitchDrop"}).json()["id"]
    left_png, right_png = _overlapping_pair()
    a = _upload(client, cid, "left.png", left_png)
    b = _upload(client, cid, "right.png", right_png)
    stranger, _ = _overlapping_pair(seed=777)
    c = _upload(client, cid, "stranger.png", stranger)

    body = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={
            "width": 1200, "height": 600,
            "nodes": [{"path": a["path"]}, {"path": b["path"]}, {"path": c["path"]}],
        },
    ).json()
    assert body["dropped"] == [2]
    assert [n["index"] for n in body["nodes"]] == [0, 1]


def test_auto_stitch_rejects_unrelated_imagery(client):
    cid = client.post("/api/cases", json={"name": "StitchNone"}).json()["id"]
    a = _upload(client, cid, "a.png", _overlapping_pair(seed=1)[0])
    b = _upload(client, cid, "b.png", _overlapping_pair(seed=2)[1])

    res = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={"width": 800, "height": 600, "nodes": [{"path": a["path"]}, {"path": b["path"]}]},
    )
    # A wrong stitch invents geometry the analyst may then reason about — better
    # to refuse outright than to place pieces on a coincidence.
    assert res.status_code == 422
    assert "no overlap" in res.json()["detail"]


def _pan_pngs(angles=(-20, 0, 20)):
    """Views of one world through a camera yawed by each angle, as PNG bytes."""
    from stitchscene import _pan

    out = []
    for view in _pan(list(angles)):
        buf = io.BytesIO()
        view.save(buf, "PNG")
        out.append(buf.getvalue())
    return out


def test_auto_stitch_defaults_to_planar_and_bakes_no_warp(client):
    cid = client.post("/api/cases", json={"name": "StitchPlanar"}).json()["id"]
    left_png, right_png = _overlapping_pair()
    a = _upload(client, cid, "left.png", left_png)
    b = _upload(client, cid, "right.png", right_png)

    body = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={"width": 1200, "height": 600, "nodes": [{"path": a["path"]}, {"path": b["path"]}]},
    ).json()

    # Planar's whole bargain: geometry only, so the pieces keep their own pixels
    # and stay hand-warpable.
    assert body["mode"] == "planar"
    assert [n["op"] for n in body["nodes"]] == [None, None]


@pytest.mark.parametrize("mode", ["cylindrical", "spherical"])
def test_auto_stitch_panorama_modes_return_a_remap_per_piece(client, mode):
    cid = client.post("/api/cases", json={"name": f"Stitch{mode}"}).json()["id"]
    paths = [
        _upload(client, cid, f"v{i}.png", png)["path"] for i, png in enumerate(_pan_pngs())
    ]
    before = len(client.get(f"/api/cases/{cid}/media").json())

    res = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={
            "width": 1600, "height": 800, "mode": mode,
            "nodes": [{"path": p} for p in paths],
        },
    )

    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == mode
    assert body["dropped"] == []
    for node in body["nodes"]:
        assert node["op"]["op"] == "remap"
        assert node["op"]["params"]["warp"] == mode
        assert len(node["op"]["params"]["r"]) == 9
    # Still not a Save gate: a panorama mode re-derives pixels, it does not file any.
    assert len(client.get(f"/api/cases/{cid}/media").json()) == before


def test_auto_stitch_remap_round_trips_through_the_render_pipeline(client):
    """The op the solver hands back must be one the recipe pipeline can replay.

    This is what carries the warp to the full-res export: nothing stores the
    stitched pixels, only the recipe that reproduces them.
    """
    cid = client.post("/api/cases", json={"name": "StitchReplay"}).json()["id"]
    paths = [
        _upload(client, cid, f"v{i}.png", png)["path"] for i, png in enumerate(_pan_pngs())
    ]
    body = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={
            "width": 1600, "height": 800, "mode": "cylindrical",
            "nodes": [{"path": p} for p in paths],
        },
    ).json()
    node = body["nodes"][0]

    res = client.post(
        f"/api/cases/{cid}/inspect/render-preview",
        json={"path": paths[0], "ops": [node["op"]]},
    )

    assert res.status_code == 200
    piece = Image.open(io.BytesIO(res.content))
    # The curved footprint has to survive to the canvas, or the piece would paint
    # black corners over its neighbours.
    assert piece.mode == "RGBA"
    assert piece.getchannel("A").getpixel((0, 0)) == 0
    quad = node["quad"]
    aspect = (quad[1][0] - quad[0][0]) / (quad[3][1] - quad[0][1])
    assert piece.width / piece.height == pytest.approx(aspect, rel=0.01)


def test_auto_stitch_rejects_an_unknown_mode(client):
    cid = client.post("/api/cases", json={"name": "StitchBadMode"}).json()["id"]
    left_png, right_png = _overlapping_pair()
    a = _upload(client, cid, "left.png", left_png)
    b = _upload(client, cid, "right.png", right_png)

    res = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={
            "width": 800, "height": 600, "mode": "toroidal",
            "nodes": [{"path": a["path"]}, {"path": b["path"]}],
        },
    )
    assert res.status_code == 422


def test_auto_stitch_needs_two_pieces(client):
    cid = client.post("/api/cases", json={"name": "StitchOne"}).json()["id"]
    a = _upload(client, cid, "a.png")
    res = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={"width": 800, "height": 600, "nodes": [{"path": a["path"]}]},
    )
    assert res.status_code == 422


def _logo_pngs():
    """Two unrelated scenes wearing one textured logo at the same pixel."""
    from stitchscene import _scene

    logo = _scene(120, 70, seed=41, blobs=90)
    out = []
    for seed in (1, 2):
        img = _scene(width=500, height=500, seed=seed)
        img.paste(logo, (18, 18))
        buf = io.BytesIO()
        img.save(buf, "PNG")
        out.append(buf.getvalue())
    return out


def test_auto_stitch_keeps_off_what_the_analyst_painted_out(client):
    """The logo is all two unrelated scenes share, and it glues them together until
    it is painted out of both: then nothing is left to match and the stitch says so."""
    cid = client.post("/api/cases", json={"name": "StitchExclude"}).json()["id"]
    paths = [_upload(client, cid, f"s{i}.png", png)["path"] for i, png in enumerate(_logo_pngs())]
    body = {"width": 900, "height": 900, "nodes": [{"path": p} for p in paths]}
    logo = [{"points": [[78 / 500, 53 / 500]], "radius": 80 / 500}]

    glued = client.post(f"/api/cases/{cid}/inspect/auto-stitch", json=body)
    painted = client.post(f"/api/cases/{cid}/inspect/auto-stitch", json={**body, "exclude": [logo, logo]})

    assert glued.status_code == 200 and glued.json()["dropped"] == []
    assert painted.status_code == 422
    assert "no overlap" in painted.json()["detail"]
    # nothing painted, or a null per piece, is the stitch as it was
    unpainted = client.post(f"/api/cases/{cid}/inspect/auto-stitch", json={**body, "exclude": [None, []]})
    assert unpainted.json()["nodes"] == glued.json()["nodes"]


def test_auto_stitch_answers_each_placed_piece_with_the_picture_size_it_matched(client):
    cid = client.post("/api/cases", json={"name": "StitchSize"}).json()["id"]
    left_png, right_png = _overlapping_pair()
    a = _upload(client, cid, "left.png", left_png)
    b = _upload(client, cid, "right.png", right_png)
    # the right piece cropped to its left 400 px: strokes are read on that picture
    crop = {"op": "crop", "params": {"x": 0.0, "y": 0.0, "w": 0.8, "h": 1.0}}

    body = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={"width": 1200, "height": 600, "nodes": [{"path": a["path"]}, {"path": b["path"], "ops": [crop]}]},
    ).json()

    assert [n["size"] for n in body["nodes"]] == [[500, 500], [400, 500]]


_STROKE = {"points": [[0.1, 0.1], [0.2, 0.2]], "radius": 0.05}


@pytest.mark.parametrize(
    ("exclude", "says"),
    [
        ([[_STROKE]], "one entry per node"),
        ([[_STROKE], None, None], "one entry per node"),
        ([[{**_STROKE, "radius": 0}], None], "radius is a fraction"),
        ([[{**_STROKE, "radius": 1.5}], None], "radius is a fraction"),
        ([[{**_STROKE, "points": [[1.2, 0.5]]}], None], "within the piece"),
        ([[{**_STROKE, "points": [[0.5, -0.1]]}], None], "within the piece"),
        ([[{**_STROKE, "points": []}], None], "1 to 400 points"),
        ([[{**_STROKE, "points": [[0.5]]}], None], "point is [x, y]"),
        ([[_STROKE] * 201, None], "at most 200 painted strokes"),
        ([[{**_STROKE, "points": [[0.5, 0.5]] * 401}], None], "1 to 400 points"),
        ([["stroke"], None], "Exclude"),
        ("everything", "Exclude"),
    ],
)
def test_auto_stitch_refuses_a_malformed_exclusion(client, exclude, says):
    cid = client.post("/api/cases", json={"name": "StitchBadExclude"}).json()["id"]
    a = _upload(client, cid, "a.png")
    b = _upload(client, cid, "b.png")
    res = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={"width": 800, "height": 600, "nodes": [{"path": a["path"]}, {"path": b["path"]}], "exclude": exclude},
    )
    # refused at the edge, before any matching (two flat pictures would say "no overlap")
    assert res.status_code == 422
    assert says in res.json()["detail"]


def test_auto_stitch_takes_exclusions_up_to_the_limits_a_collage_keeps(client):
    """The route checks strokes by the rule the saved collage keeps them under, so
    whatever a collage holds can be stitched."""
    from azimut.engine import inspectwork

    cid = client.post("/api/cases", json={"name": "StitchExcludeLimits"}).json()["id"]
    left_png, right_png = _overlapping_pair()
    a = _upload(client, cid, "left.png", left_png)
    b = _upload(client, cid, "right.png", right_png)
    corner = {"points": [[0.0, 0.0]] * inspectwork.MAX_EXCLUDE_POINTS, "radius": 0.01}
    full = [corner] * inspectwork.MAX_EXCLUDE_STROKES

    res = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={"width": 1200, "height": 600, "nodes": [{"path": a["path"]}, {"path": b["path"]}], "exclude": [full, full]},
    )

    assert res.status_code == 200
    assert res.json()["dropped"] == []


def test_auto_stitch_hands_the_solver_each_pieces_file_time_and_strokes(client, monkeypatch):
    """Frames of one video are told apart from pictures by their file and time, and
    the strokes arrive one entry per piece, as checked."""
    from azimut.engine import stitch

    seen = {}

    def solve(images, **kwargs):
        seen.update(kwargs)
        return {"quads": {0: [[0, 0], [1, 0], [1, 1], [0, 1]]}, "dropped": [1, 2], "why": ["no-overlap", "no-detail"],
                "canvas": {"width": 16, "height": 16}}

    monkeypatch.setattr(inspect_engine, "_source_image", lambda case, path, time, ops: Image.new("RGB", (64, 48)))
    monkeypatch.setattr(stitch, "solve_layout", solve)
    cid = client.post("/api/cases", json={"name": "StitchSources"}).json()["id"]
    stroke = {"points": [[0.123456, 0.5]], "radius": 0.1}

    res = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={
            "width": 800, "height": 600,
            "nodes": [{"path": "media/clip.mp4", "time": 1.5}, {"path": "media/clip.mp4", "time": 3.0},
                      {"path": "media/photo.jpg"}],
            "exclude": [[stroke], None, []],
        },
    )

    assert res.status_code == 200
    assert seen["sources"] == [("media/clip.mp4", 1.5), ("media/clip.mp4", 3.0), ("media/photo.jpg", None)]
    assert seen["exclude"] == [[{"points": [[0.1235, 0.5]], "radius": 0.1}], None, None]
    assert res.json()["nodes"][0]["size"] == [64, 48]
    assert (res.json()["dropped"], res.json()["why"]) == ([1, 2], ["no-overlap", "no-detail"])


def test_auto_stitch_says_why_it_left_each_piece_out(client):
    """A stranger has detail and none of it matches; a blank picture and one painted out whole have
    nothing to match at all."""
    cid = client.post("/api/cases", json={"name": "StitchWhy"}).json()["id"]
    left_png, right_png = _overlapping_pair()
    a = _upload(client, cid, "left.png", left_png)
    b = _upload(client, cid, "right.png", right_png)
    stranger = _upload(client, cid, "stranger.png", _overlapping_pair(seed=777)[0])
    blank = _upload(client, cid, "blank.png", _png_bytes(color=(90, 90, 90), size=(500, 500)))
    painted = _upload(client, cid, "painted.png", right_png)
    whole = [{"points": [[0.5, 0.5]], "radius": 1.0}]

    body = client.post(
        f"/api/cases/{cid}/inspect/auto-stitch",
        json={
            "width": 1200, "height": 600,
            "nodes": [{"path": item["path"]} for item in (a, b, stranger, blank, painted)],
            "exclude": [None, None, None, None, whole],
        },
    ).json()

    assert body["dropped"] == [2, 3, 4]
    assert body["why"] == ["no-overlap", "no-detail", "no-detail"]


def test_analyze_accepts_transient_ops_without_filing(client):
    cid = client.post("/api/cases", json={"name": "AnalyzeOps"}).json()["id"]
    item = _upload(client, cid, "img.png", _png_bytes(color=(255, 0, 0), size=(20, 20)))
    before = len(client.get(f"/api/cases/{cid}/media").json())

    res = client.post(
        f"/api/cases/{cid}/inspect/analyze",
        json={"path": item["path"], "name": "ela",
              "ops": [{"op": "invert", "params": {"on": 1}}]},
    ).json()
    assert res["kind"] == "image"
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
        f"/api/cases/{cid}/inspect/render-preview", json={"path": item["path"], "time": 1.0}
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
              "rotation": 90, "folder": "Enhanced"},
    ).json()
    assert res["duplicate"] is False
    new_path = res["item"]["path"]
    assert new_path.endswith(".mp4")
    probe = client.get(
        f"/api/cases/{cid}/inspect/probe", params={"path": new_path}
    ).json()
    assert probe["kind"] == "video"
    assert probe["width"] == 120 and probe["height"] == 160
    saved = next(m for m in client.get(f"/api/cases/{cid}/media").json() if m["path"] == new_path)
    assert saved["source"]["rotation"] == 90
    entity = next(
        e for e in graph_read.entities(cid)
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


def test_render_preview_can_answer_in_jpeg(client):
    cid = client.post("/api/cases", json={"name": "RenderJpeg"}).json()["id"]
    item = _upload(client, cid, "img.png", _png_bytes(color=(255, 0, 0), size=(30, 20)))
    url = f"/api/cases/{cid}/inspect/render-preview"

    res = client.post(url, json={"path": item["path"], "format": "jpeg"})
    assert res.status_code == 200 and res.headers["content-type"] == "image/jpeg"
    img = Image.open(io.BytesIO(res.content))
    assert img.format == "JPEG" and img.size == (30, 20) and img.mode == "RGB"

    plain = client.post(url, json={"path": item["path"]})  # PNG stays the default
    assert plain.headers["content-type"] == "image/png"
    assert client.post(url, json={"path": item["path"], "format": "gif"}).status_code == 422


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


def test_enhance_video_rejects_non_right_angle_rotation(client):
    cid = client.post("/api/cases", json={"name": "Bad rotation"}).json()["id"]
    res = client.post(
        f"/api/cases/{cid}/inspect/enhance-video",
        json={"path": "media/clip.mp4", "params": {}, "rotation": 45},
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
        f"/api/cases/{cid}/inspect/save-frames",
        json={"items": [{"path": item["path"], "time": 1.0}]},
    ).json()["saved"][0]
    assert res["item"]["kind"] == "image"
    assert client.get(f"/files/{cid}/{res['item']['path']}").status_code == 200

    # sharpest-frame suggestion runs as a job
    job_id = client.post(
        f"/api/cases/{cid}/inspect/suggest", json={"path": item["path"], "bins": 4}
    ).json()["job_id"]
    assert len(job_result(client, job_id)["frames"]) >= 1


def test_saved_frame_filename_follows_the_typed_name(client):
    cid = client.post("/api/cases", json={"name": "Naming"}).json()["id"]
    item = _upload(client, cid, "dsc_00421.png")

    res = client.post(
        f"/api/cases/{cid}/inspect/save-frames",
        json={
            "items": [
                {"path": item["path"], "ops": [{"op": "brightness", "params": {"amount": 1.4}}],
                 "label": "Hangar roof"}
            ],
            "notes": "Roof line matches the satellite view",
        },
    ).json()["saved"][0]

    name = res["item"]["path"].rsplit("/", 1)[-1]
    assert name == "Hangar roof.png"
    assert "dsc_00421" not in name

    media = next(
        m for m in client.get(f"/api/cases/{cid}/media").json()
        if m["path"] == res["item"]["path"]
    )
    assert media["title"] == "Hangar roof"
    assert media["notes"] == "Roof line matches the satellite view"


def test_saved_frame_name_is_scrubbed_for_the_filesystem(client):
    cid = client.post("/api/cases", json={"name": "Scrub"}).json()["id"]
    item = _upload(client, cid, "orig.png")

    res = client.post(
        f"/api/cases/{cid}/inspect/save-frames",
        json={
            "items": [
                {"path": item["path"], "ops": [{"op": "contrast", "params": {"amount": 1.3}}],
                 "label": 'a/b:c*d?"e'}
            ]
        },
    ).json()["saved"][0]

    name = res["item"]["path"].rsplit("/", 1)[-1]
    assert not set(name) & set('/:*?"<>|\\')
    # The canonical, portable stem is both the filename and the title.
    media = next(
        m for m in client.get(f"/api/cases/{cid}/media").json()
        if m["path"] == res["item"]["path"]
    )
    assert media["title"] == "a_b_c_d_e"


def test_unnamed_frame_keeps_the_source_stem_and_tag(client):
    cid = client.post("/api/cases", json={"name": "Unnamed"}).json()["id"]
    item = _upload(client, cid, "orig.png")

    res = client.post(
        f"/api/cases/{cid}/inspect/save-frames",
        json={
            "items": [
                {"path": item["path"], "ops": [{"op": "brightness", "params": {"amount": 1.6}}]}
            ]
        },
    ).json()["saved"][0]

    name = res["item"]["path"].rsplit("/", 1)[-1]
    assert name == "orig_edit.png"


def test_composed_collage_filename_follows_the_typed_name(client):
    cid = client.post("/api/cases", json={"name": "ComposeName"}).json()["id"]
    a = _upload(client, cid, "a.png", _png_bytes(color=(10, 20, 30)))
    b = _upload(client, cid, "b.png", _png_bytes(color=(200, 100, 50)))

    res = client.post(
        f"/api/cases/{cid}/inspect/compose",
        json={
            "width": 400, "height": 300,
            "nodes": [
                {"src": {"path": a["path"]}, "quad": [[0, 0], [200, 10], [190, 300], [0, 290]]},
                {"src": {"path": b["path"]}, "quad": [[200, 10], [400, 0], [400, 300], [190, 300]]},
            ],
            "label": "Yard panorama",
            "notes": "Two angles of the same yard",
        },
    ).json()

    assert res["item"]["path"].rsplit("/", 1)[-1] == "Yard panorama.png"
    media = next(
        m for m in client.get(f"/api/cases/{cid}/media").json()
        if m["path"] == res["item"]["path"]
    )
    assert media["title"] == "Yard panorama"
    assert media["notes"] == "Two angles of the same yard"


def test_duplicate_save_renames_the_media_it_landed_on(client):
    """Re-saving an unchanged collage hits the same pixels, so it hits the same
    entity. The name typed at the gate has to reach it anyway — that silent drop
    is what made a collage look like it ignored its name."""
    cid = client.post("/api/cases", json={"name": "Dupe"}).json()["id"]
    a = _upload(client, cid, "a.png", _png_bytes(color=(10, 20, 30)))
    b = _upload(client, cid, "b.png", _png_bytes(color=(200, 100, 50)))
    body = {
        "width": 400, "height": 300,
        "nodes": [
            {"src": {"path": a["path"]}, "quad": [[0, 0], [200, 10], [190, 300], [0, 290]]},
            {"src": {"path": b["path"]}, "quad": [[200, 10], [400, 0], [400, 300], [190, 300]]},
        ],
        "label": "First name",
    }
    first = client.post(f"/api/cases/{cid}/inspect/compose", json=body).json()
    assert first["duplicate"] is False

    body["label"] = "Second name"
    again = client.post(f"/api/cases/{cid}/inspect/compose", json=body).json()
    assert again["duplicate"] is True
    assert again["item"]["path"] == "media/Second name.png"
    assert again["item"]["path"] != first["item"]["path"]

    media = next(
        m for m in client.get(f"/api/cases/{cid}/media").json()
        if m["path"] == again["item"]["path"]
    )
    assert media["title"] == "Second name"


def test_duplicate_save_files_no_second_copy(client):
    cid = client.post("/api/cases", json={"name": "DupeCount"}).json()["id"]
    item = _upload(client, cid, "orig.png")
    body = {
        "items": [
            {"path": item["path"], "ops": [{"op": "brightness", "params": {"amount": 1.4}}],
             "label": "Roof"}
        ]
    }
    client.post(f"/api/cases/{cid}/inspect/save-frames", json=body)
    after_first = len(client.get(f"/api/cases/{cid}/media").json())
    client.post(f"/api/cases/{cid}/inspect/save-frames", json=body)
    assert len(client.get(f"/api/cases/{cid}/media").json()) == after_first
