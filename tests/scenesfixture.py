"""A case with a real video, its cut frames and the proofs built on them.

Shared by the scenes and the proof slides tests, which sit in different Windows shards.
"""

from __future__ import annotations

import io
import subprocess

import pytest
from PIL import Image

from azimut.engine import media as media_engine

needs_ffmpeg = pytest.mark.skipif(not media_engine.ffmpeg_available(), reason="ffmpeg not installed")


def _case(client, name="Scenes") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _png(color=(120, 60, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (80, 60), color).save(buf, "PNG")
    return buf.getvalue()


def _upload_png(client, cid, name="photo.png") -> str:
    res = client.post(
        f"/api/cases/{cid}/media/upload", files={"file": (name, io.BytesIO(_png()), "image/png")}
    )
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _video(client, cid, tmp_path, name="clip.mp4", pattern="testsrc") -> str:
    """A real four-second clip whose every frame differs, so no two cuts are one picture."""
    path = tmp_path / name
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"{pattern}=s=64x48:r=10:d=4",
         "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    with path.open("rb") as fh:
        res = client.post(f"/api/cases/{cid}/media/upload", files={"file": (name, fh, "video/mp4")})
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _cut(client, cid, video, time) -> str:
    res = client.post(
        f"/api/cases/{cid}/inspect/save-frames", json={"items": [{"path": video, "time": time}]}
    )
    assert res.status_code == 200, res.text
    return res.json()["saved"][0]["item"]["path"]


def _proof(client, cid, title, *srcs, coords=None, **extra):
    spec = {"panels": [{"id": f"p{i}", "src": s} for i, s in enumerate(srcs)], **extra}
    if coords:
        spec["coordsText"] = coords
    res = client.post(f"/api/cases/{cid}/proofs", json={"title": title, "spec": spec})
    assert res.status_code == 200, res.text
    return res.json()


def _save_work(client, cid, path, **spec):
    return client.put(
        f"/api/cases/{cid}/inspect/work", json={"path": path, "spec": {"frames": [], **spec}}
    )


def _work(client, cid, path):
    return client.get(f"/api/cases/{cid}/inspect/work", params={"path": path}).json()["work"]


def _scenes(client, cid, video):
    res = client.get(f"/api/cases/{cid}/scenes", params={"video": video})
    assert res.status_code == 200, res.text
    return res.json()
