"""Proofs: save spec+PNG, list, reload, entity upsert, delete."""

import base64
import io

from PIL import Image


def _png_b64() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (80, 50), (40, 40, 60)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


SPEC = {
    "templateId": "dark-house",
    "captionSize": 24,
    "legendSize": 22,
    "footerSize": 18,
    "footer": "Custom footer line",
    "panels": [
        {"id": "p1", "src": "media/frame.png", "caption": "Frame", "row": 0, "natural": [1280, 720], "meta": {}},
        {"id": "p2", "src": "satellite/sat.png", "caption": "Esri", "row": 1, "natural": [1000, 700],
         "meta": {"kind": "satellite", "attribution": "Esri", "lat": 1.0, "lon": 2.0}},
    ],
    "shapes": [
        {"id": "s1", "panel": "p1", "kind": "rect", "x": 10, "y": 10, "w": 100, "h": 50,
         "color": "#ff5252", "strokeWidth": 4, "comment": "blue roof"},
    ],
    "coords": {"lat": 1.0, "lon": 2.0},
    "notes": {"#ff5252": "blue roof matches"},
}


def test_save_load_roundtrip(client):
    cid = client.post("/api/cases", json={"name": "Proofs"}).json()["id"]

    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Kharkiv strike proof", "spec": SPEC, "png_base64": _png_b64()},
    ).json()
    assert saved["name"] == "kharkiv-strike-proof"
    assert saved["png"] == "proofs/kharkiv-strike-proof.png"

    listed = client.get(f"/api/cases/{cid}/proofs").json()
    assert len(listed) == 1
    assert listed[0]["panels"] == 2 and listed[0]["shapes"] == 1

    spec = client.get(f"/api/cases/{cid}/proofs/kharkiv-strike-proof").json()
    assert spec["title"] == "Kharkiv strike proof"
    assert spec["shapes"][0]["comment"] == "blue roof"
    assert spec["notes"] == {"#ff5252": "blue roof matches"}  # legend text is per color
    assert spec["panels"][0]["id"] == "p1"  # panel ids survive → shapes stay bound
    # multi-row layout + text sizes + custom footer survive the round-trip
    assert [p["row"] for p in spec["panels"]] == [0, 1]
    assert spec["captionSize"] == 24
    assert spec["legendSize"] == 22
    assert spec["footerSize"] == 18
    assert spec["footer"] == "Custom footer line"
    assert spec["templateId"] == "dark-house"

    # PNG served
    assert client.get(f"/files/{cid}/{saved['png']}").status_code == 200

    # proof entity filed once, updated on resave
    client.post(
        f"/api/cases/{cid}/proofs",
        json={"name": saved["name"], "title": "Renamed proof", "spec": SPEC},
    )
    entities = [e for e in client.get(f"/api/cases/{cid}").json()["entities"] if e["type"] == "proof"]
    assert len(entities) == 1
    assert entities[0]["label"] == "Renamed proof"


def test_resave_with_png_adds_the_path_to_the_entity(client):
    cid = client.post("/api/cases", json={"name": "SpecFirst"}).json()["id"]

    # first save is spec-only: no PNG, so the entity has no path
    saved = client.post(
        f"/api/cases/{cid}/proofs", json={"title": "Draft proof", "spec": SPEC}
    ).json()
    entity = next(
        e for e in client.get(f"/api/cases/{cid}").json()["entities"] if e["type"] == "proof"
    )
    assert "path" not in entity["attrs"]

    # exporting later re-saves with the PNG — the entity must gain the path,
    # or the sidebar preview and delete_by_path can't see the file
    client.post(
        f"/api/cases/{cid}/proofs",
        json={"name": saved["name"], "title": "Draft proof", "spec": SPEC, "png_base64": _png_b64()},
    )
    entity = next(
        e for e in client.get(f"/api/cases/{cid}").json()["entities"] if e["type"] == "proof"
    )
    assert entity["attrs"]["path"] == f"proofs/{saved['name']}.png"


def test_invalid_png_rejected(client):
    cid = client.post("/api/cases", json={"name": "Bad"}).json()["id"]
    res = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "x", "spec": SPEC, "png_base64": "not-base64!!!"},
    )
    assert res.status_code == 422


def test_delete_proof(client):
    cid = client.post("/api/cases", json={"name": "DelProof"}).json()["id"]
    saved = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": "Temp", "spec": SPEC, "png_base64": _png_b64()},
    ).json()
    client.delete(f"/api/cases/{cid}/proofs/{saved['name']}")
    assert client.get(f"/api/cases/{cid}/proofs").json() == []
    assert client.get(f"/api/cases/{cid}/proofs/{saved['name']}").status_code == 404
    assert [e for e in client.get(f"/api/cases/{cid}").json()["entities"] if e["type"] == "proof"] == []
