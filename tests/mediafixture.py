"""Collected media and proofs shared by map and personal-layer tests."""

import base64
import io

from PIL import Image

from azimut.engine import media as media_engine
from azimut.workspace import Case


def _png_bytes(color=(200, 30, 30), size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def _upload(client, cid, name, color=(200, 30, 30)):
    return client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(_png_bytes(color)), "image/png")},
    ).json()["item"]["path"]


def _save_proof(client, cid, title, srcs, **spec_extra):
    spec = {"panels": [{"id": f"p{i}", "src": s} for i, s in enumerate(srcs)], **spec_extra}
    png = base64.b64encode(_png_bytes((10, 10, 10))).decode()
    res = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": title, "spec": spec, "png_base64": png},
    )
    assert res.status_code == 200, res.text


def _frame_of(cid, source_path, name="frame.png"):
    """A frame filed the way Inspect files one, derived from its video."""
    return media_engine.import_image(
        Case.open(cid),
        Image.new("RGB", (32, 24), (90, 90, 90)),
        name,
        {"type": "inspect", "from": source_path},
        by="inspect",
        dedupe=False,
    )["item"]["path"]


def _index(client, cid):
    res = client.get(f"/api/cases/{cid}/satellite/media")
    assert res.status_code == 200, res.text
    return res.json()


def _points(rows, path):
    return sorted((row["lat"], row["lon"]) for row in rows if row["path"] == path)
