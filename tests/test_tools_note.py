"""What the tools file when they put a picture in a pinned note.

A map view or a Compare pair is filed once for one state and cited again after
that; a capture hands back the record the note cites; a proof keeps its panels'
imagery credits on its record and inside its PNG, printed only when asked.
"""

import base64
import io
import subprocess

import graph_read
import pytest
from PIL import Image

from azimut.api import proofs as proofs_api
from azimut.engine import media as media_engine
from azimut.engine import snapshots, tiles


def _fake_tile(client, url):  # offline: every tile is a solid green square
    return Image.new("RGB", (256, 256), (10, 120, 10))


def _case(client, name="Note"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _captures(cid):
    return [e for e in graph_read.entities(cid) if e["type"] == "capture"]


def _png_bytes(w=320, h=200, color=(30, 90, 30)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


VIEW = {"lat": 15.36941, "lon": 44.19104, "zoom": 17, "width": 512, "height": 512,
        "bearing": 30, "imagery_date": "2024-05-03", "imagery_exact": False}


# -- the map view -------------------------------------------------------------------


def test_a_capture_hands_back_the_record_a_note_cites(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = _case(client)
    answer = client.post(f"/api/cases/{cid}/satellite/capture", json=VIEW).json()
    [capture] = _captures(cid)
    assert answer["entity"]["id"] == capture["id"]
    assert answer["entity"]["attrs"]["path"] == answer["path"]
    # the state it was taken in is kept on the record and in its sidecar
    assert capture["attrs"][snapshots.VIEW_KEY] == answer[snapshots.VIEW_KEY]
    media = client.get(f"/api/cases/{cid}/media").json()
    [row] = [m for m in media if m["path"] == answer["path"]]
    assert row["source"][snapshots.VIEW_KEY] == answer[snapshots.VIEW_KEY]
    # what the note's credit reads
    assert row["source"]["imagery_date"] == "2024-05-03"
    assert row["source"]["provider"] == "esri-world-imagery"


def test_the_same_view_put_in_twice_is_filed_once(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = _case(client)
    first = client.post(f"/api/cases/{cid}/satellite/capture", json={**VIEW, "reuse": True}).json()
    fetched = []
    monkeypatch.setattr(tiles, "_default_fetch", lambda c, url: fetched.append(url) or _fake_tile(c, url))
    again = client.post(f"/api/cases/{cid}/satellite/capture", json={**VIEW, "reuse": True}).json()
    assert again["reused"] is True
    assert again["entity"]["id"] == first["entity"]["id"]
    assert again["path"] == first["path"]
    assert fetched == []  # nothing fetched for a view already filed
    assert len(_captures(cid)) == 1


def test_a_plain_capture_still_files_a_new_picture_each_press(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = _case(client)
    client.post(f"/api/cases/{cid}/satellite/capture", json=VIEW)
    client.post(f"/api/cases/{cid}/satellite/capture", json=VIEW)
    assert len(_captures(cid)) == 2


def test_another_state_is_another_picture(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = _case(client)
    first = client.post(f"/api/cases/{cid}/satellite/capture", json={**VIEW, "reuse": True}).json()
    for change in ({"bearing": 31}, {"zoom": 16}, {"imagery_date": "2025-01-01"},
                   {"width": 640}, {"lat": VIEW["lat"] + 0.001}, {"scale_north": True}):
        other = client.post(f"/api/cases/{cid}/satellite/capture",
                            json={**VIEW, **change, "reuse": True}).json()
        assert other.get("reused") is not True, change
        assert other["entity"]["id"] != first["entity"]["id"]


def test_a_view_whose_picture_went_to_the_trash_is_filed_again(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = _case(client)
    first = client.post(f"/api/cases/{cid}/satellite/capture", json={**VIEW, "reuse": True}).json()
    client.delete(f"/api/cases/{cid}/entities/{first['entity']['id']}")
    again = client.post(f"/api/cases/{cid}/satellite/capture", json={**VIEW, "reuse": True}).json()
    assert again.get("reused") is not True
    assert again["entity"]["id"] != first["entity"]["id"]


def test_a_tilted_view_put_in_twice_is_filed_once(client):
    cid = _case(client)
    data = {"lat": "46.5776", "lon": "8.0053", "zoom": "13.6274", "provider": "esri-world-imagery",
            "bearing": "150", "pitch": "62", "reuse": "true"}
    send = lambda: client.post(  # noqa: E731
        f"/api/cases/{cid}/satellite/oblique",
        files={"image": ("tilted.png", _png_bytes(w=800), "image/png")}, data=data,
    ).json()
    first = send()
    again = send()
    assert first["entity"]["id"] == again["entity"]["id"]
    assert again["reused"] is True
    assert len(_captures(cid)) == 1


def test_a_google_screenshot_hands_back_its_record(client):
    client.put("/api/settings/keys", json={"google_js": "AIza.js"})
    cid = _case(client)
    answer = client.post(
        f"/api/cases/{cid}/satellite/screenshot",
        files={"image": ("shot.png", _png_bytes(), "image/png")},
        data={"lat": "48.8584", "lon": "2.2945", "zoom": "18", "provider": "google-js", "framed": "true"},
    ).json()
    [capture] = _captures(cid)
    assert answer["entity"]["id"] == capture["id"]


# -- the Compare pair -----------------------------------------------------------------


COMPARE_SPEC = {
    "camera": {"lat": 15.36941, "lon": 44.19104, "zoom": 16, "bearing": 0},
    "mode": "side",
    "a": {"provider": "esri-world-imagery"},
    "b": {"provider": "osm"},
}


def _keep(client, cid, name, reuse=True, spec=COMPARE_SPEC):
    return client.post(
        f"/api/cases/{cid}/compare/sessions/{name}/images",
        files={"image_a": ("pair.png", _png_bytes(), "image/png")},
        data={"format": "png", "filename": "pair", "spec": __import__("json").dumps(spec),
              "imagery_a": "2024-05-03", "imagery_a_exact": "false", "imagery_b": "2026-09-02",
              **({"reuse": "true"} if reuse else {})},
    )


def test_a_comparison_named_for_a_note_takes_the_next_free_name(client):
    cid = _case(client)
    body = {"title": "Port, 2024-05-03 to 2026-09-02", "spec": COMPARE_SPEC}
    first = client.post(f"/api/cases/{cid}/compare/sessions", json=body).json()
    # a name the analyst typed is still refused when taken
    assert client.post(f"/api/cases/{cid}/compare/sessions", json=body).status_code == 409
    second = client.post(f"/api/cases/{cid}/compare/sessions", json={**body, "unique": True}).json()
    assert first["name"] == "Port, 2024-05-03 to 2026-09-02"
    assert second["name"] == "Port, 2024-05-03 to 2026-09-02 2"


def test_a_pair_kept_for_a_note_carries_both_dates_and_is_kept_once(client):
    cid = _case(client)
    name = client.post(f"/api/cases/{cid}/compare/sessions",
                       json={"title": "Port", "spec": COMPARE_SPEC}).json()["name"]
    first = _keep(client, cid, name)
    assert first.status_code == 200, first.text
    again = _keep(client, cid, name).json()
    assert again["reused"] is True
    assert again["entity"] == first.json()["entity"]
    media = client.get(f"/api/cases/{cid}/media").json()
    [row] = [m for m in media if m["path"] == first.json()["path"]]
    # the credit names both halves (engine/notesources reads these)
    assert (row["source"]["imagery_a"], row["source"]["imagery_a_exact"]) == ("2024-05-03", False)
    assert row["source"]["imagery_b"] == "2026-09-02"
    assert row["source"]["mode"] == "side"
    # a keep from the export panel is never folded into another
    assert _keep(client, cid, name, reuse=False).json()["entity"] != first.json()["entity"]


# -- the proof's imagery credits --------------------------------------------------------


PROOF_SPEC = {
    "panels": [
        {"id": "p1", "src": "media/a.png", "natural": [100, 100],
         "meta": {"kind": "satellite", "attribution": "© Copernicus Sentinel data / Sentinel Hub",
                  "imagery_date": "2024-07-01"}},
        {"id": "p2", "src": "media/b.png", "natural": [100, 100],
         "meta": {"kind": "satellite", "attribution": "Esri, Vantor, Earthstar Geographics"}},
        {"id": "p3", "src": "media/c.png", "natural": [100, 100],
         "meta": {"kind": "satellite", "attribution": "Esri, Vantor, Earthstar Geographics"}},
        {"id": "p4", "src": "media/d.png", "natural": [100, 100], "meta": {"kind": "media"}},
    ],
    "shapes": [],
}
CREDITS = "Contains modified Copernicus Sentinel data 2024 · Esri, Vantor, Earthstar Geographics"


def _png_b64():
    return base64.b64encode(_png_bytes(80, 50)).decode()


def test_the_proof_keeps_its_panels_imagery_credits_on_its_record(client):
    cid = _case(client)
    saved = client.post(f"/api/cases/{cid}/proofs",
                        json={"title": "Credited", "spec": PROOF_SPEC, "png_base64": _png_b64()}).json()
    proof = next(e for e in graph_read.entities(cid) if e["id"] == saved["id"])
    assert proof["attrs"]["imagery_credits"] == CREDITS
    # a re-save with other panels keeps the record current
    fewer = {**PROOF_SPEC, "panels": PROOF_SPEC["panels"][1:]}
    client.post(f"/api/cases/{cid}/proofs",
                json={"title": "Credited", "rename_from": "Credited", "spec": fewer, "png_base64": _png_b64()})
    proof = next(e for e in graph_read.entities(cid) if e["id"] == saved["id"])
    assert proof["attrs"]["imagery_credits"] == "Esri, Vantor, Earthstar Geographics"


def test_the_proof_png_carries_its_credits_in_a_copyright_text_chunk(client):
    cid = _case(client)
    saved = client.post(f"/api/cases/{cid}/proofs",
                        json={"title": "Chunk", "spec": PROOF_SPEC, "png_base64": _png_b64()}).json()
    data = client.get(f"/files/{cid}/{saved['png']}").content
    image = Image.open(io.BytesIO(data))
    assert image.text["Copyright"] == CREDITS
    assert image.size == (80, 50)  # the pixels as sent


def test_the_credit_chunk_leaves_anything_else_alone():
    png = _png_bytes(10, 10)
    assert proofs_api.with_credits(png, "") == png
    assert proofs_api.with_credits(b"not a png", CREDITS) == b"not a png"
    marked = proofs_api.with_credits(png, "Esri · ©2026 Google · Mapterhorn → relief")
    assert Image.open(io.BytesIO(marked)).text["Copyright"] == "Esri · ©2026 Google · Mapterhorn → relief"


def test_the_entity_type_declares_the_credits_read_only(client):
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}
    field = next(a for a in rows["proof"]["attrs"] if a["key"] == "imagery_credits")
    assert field["editable"] is False
    assert field["aside"] == "From the panels"
    legacy = next(a for a in rows["ip"]["attrs"] if a["key"] == "network")
    assert legacy["aside"] == ""


# -- the way back from a picture ----------------------------------------------------------


def _upload(client, cid, name, data, kind="image/png"):
    return client.post(f"/api/cases/{cid}/media/upload", files={"file": (name, io.BytesIO(data), kind)}).json()["item"]


def test_a_collage_export_names_the_collage_it_came_from(client):
    cid = _case(client)
    a = _upload(client, cid, "a.png", _png_bytes(color=(10, 20, 30)))
    quad = [[0, 0], [100, 0], [100, 100], [0, 100]]
    res = client.post(f"/api/cases/{cid}/inspect/compose", json={
        "width": 100, "height": 100, "nodes": [{"src": {"path": a["path"]}, "quad": quad}],
        "collage": "Quay panorama", "label": "Quay panorama",
    }).json()
    assert res["entity"]["attrs"]["collage"] == "Quay panorama"
    # a straightened picture, or any compose not asked for it, names none
    b = _upload(client, cid, "b.png", _png_bytes(color=(200, 100, 50)))
    other = client.post(f"/api/cases/{cid}/inspect/compose", json={
        "width": 100, "height": 100, "nodes": [{"src": {"path": b["path"]}, "quad": quad}], "label": "Loose",
    }).json()
    assert "collage" not in other["entity"]["attrs"]


@pytest.mark.skipif(not media_engine.ffmpeg_available(), reason="ffmpeg not installed")
def test_a_frame_names_its_video_and_the_instant_it_was_cut(client, tmp_path):
    clip = tmp_path / "clip.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=64x64:r=25:d=2",
                    "-pix_fmt", "yuv420p", str(clip)], check=True)
    cid = _case(client)
    video = _upload(client, cid, "clip.mp4", clip.read_bytes(), "video/mp4")
    saved = client.post(f"/api/cases/{cid}/inspect/save-frames", json={
        "items": [{"path": video["path"], "time": 1.2345, "ops": [], "label": "Frame at 00:01.235"}],
    }).json()["saved"][0]
    assert saved["entity"]["attrs"]["frame_of"] == video["path"]
    assert saved["entity"]["attrs"]["frame_time"] == 1.234 or saved["entity"]["attrs"]["frame_time"] == 1.235
