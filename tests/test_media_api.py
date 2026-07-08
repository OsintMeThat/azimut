"""Media Library: upload, dedupe, listing, file serving, deletion."""

import io
import time

from PIL import Image


def _png_bytes(color=(200, 30, 30), size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def _upload(client, cid, name, data):
    return client.post(
        f"/api/cases/{cid}/media/upload", files={"file": (name, io.BytesIO(data), "image/png")}
    )


def test_upload_and_list(client):
    cid = client.post("/api/cases", json={"name": "Media"}).json()["id"]

    res = _upload(client, cid, "frame one.png", _png_bytes()).json()
    assert res["duplicate"] is False
    item = res["item"]
    assert item["kind"] == "image"
    assert len(item["sha256"]) == 64
    assert item["thumbnail"]  # Pillow thumbnail for images always works

    listed = client.get(f"/api/cases/{cid}/media").json()
    assert [m["filename"] for m in listed] == ["frame one.png"]

    # media entity was filed with provenance
    case = client.get(f"/api/cases/{cid}").json()
    assert case["entities"][0]["type"] == "media"
    assert case["entities"][0]["provenance"]["by"] == "media-library"

    # the file and its thumbnail are served
    assert client.get(f"/files/{cid}/{item['path']}").status_code == 200
    assert client.get(f"/files/{cid}/{item['thumbnail']}").status_code == 200


def test_duplicate_detection(client):
    cid = client.post("/api/cases", json={"name": "Dup"}).json()["id"]
    data = _png_bytes(color=(1, 2, 3))
    first = _upload(client, cid, "a.png", data).json()
    second = _upload(client, cid, "b.png", data).json()
    assert second["duplicate"] is True
    assert second["entity"]["id"] == first["entity"]["id"]
    assert len(client.get(f"/api/cases/{cid}/media").json()) == 1


def test_delete_media_removes_entity(client):
    cid = client.post("/api/cases", json={"name": "Del"}).json()["id"]
    item = _upload(client, cid, "x.png", _png_bytes()).json()["item"]
    client.delete(f"/api/cases/{cid}/media", params={"path": item["path"]})
    assert client.get(f"/api/cases/{cid}/media").json() == []
    assert client.get(f"/api/cases/{cid}").json()["entities"] == []
    assert client.get(f"/files/{cid}/{item['path']}").status_code == 404


def test_path_traversal_refused(client):
    cid = client.post("/api/cases", json={"name": "Sec"}).json()["id"]
    # percent-encoded so the HTTP client doesn't normalize it away:
    # the decoded rel_path reaching the route is "../../etc/passwd"
    res = client.get(f"/files/{cid}/%2e%2e/%2e%2e/%2e%2e/etc/passwd")
    assert res.status_code in (403, 404)
    assert b"root:" not in res.content


def test_update_media_notes_and_folder(client):
    cid = client.post("/api/cases", json={"name": "Update"}).json()["id"]
    item = _upload(client, cid, "clip.png", _png_bytes()).json()["item"]

    updated = client.patch(
        f"/api/cases/{cid}/media",
        json={"path": item["path"], "notes": "found at coordinates", "folder": "ukraine"},
    ).json()
    assert updated["notes"] == "found at coordinates"
    assert updated["folder"] == "ukraine"

    # persisted: shows up in listing
    listing = client.get(f"/api/cases/{cid}/media").json()
    assert listing[0]["notes"] == "found at coordinates"
    assert listing[0]["folder"] == "ukraine"

    # folder + notes mirrored onto the media entity (so the sidebar sees them)
    entity = client.get(f"/api/cases/{cid}").json()["entities"][0]
    assert entity["attrs"]["folder"] == "ukraine"
    assert entity["attrs"]["notes"] == "found at coordinates"

    # clearing the folder mirrors an empty value on the entity
    client.patch(f"/api/cases/{cid}/media", json={"path": item["path"], "folder": ""})
    entity = client.get(f"/api/cases/{cid}").json()["entities"][0]
    assert entity["attrs"]["folder"] == ""


def test_update_media_label(client):
    cid = client.post("/api/cases", json={"name": "Label"}).json()["id"]
    item = _upload(client, cid, "img.png", _png_bytes()).json()["item"]

    updated = client.patch(
        f"/api/cases/{cid}/media",
        json={"path": item["path"], "label": "Strike video — Kharkiv"},
    ).json()
    assert updated["label"] == "Strike video — Kharkiv"

    # entity label updated too
    entities = client.get(f"/api/cases/{cid}").json()["entities"]
    assert entities[0]["label"] == "Strike video — Kharkiv"

    # clear label reverts to no custom label
    cleared = client.patch(
        f"/api/cases/{cid}/media", json={"path": item["path"], "label": ""}
    ).json()
    assert "label" not in cleared


def test_update_media_clear_notes(client):
    cid = client.post("/api/cases", json={"name": "Clear"}).json()["id"]
    item = _upload(client, cid, "img.png", _png_bytes()).json()["item"]

    client.patch(f"/api/cases/{cid}/media", json={"path": item["path"], "notes": "initial"})
    updated = client.patch(
        f"/api/cases/{cid}/media", json={"path": item["path"], "notes": ""}
    ).json()
    assert "notes" not in updated


def test_update_media_bad_path(client):
    cid = client.post("/api/cases", json={"name": "Bad"}).json()["id"]
    res = client.patch(
        f"/api/cases/{cid}/media",
        json={"path": "media/nonexistent.png", "notes": "x"},
    )
    assert res.status_code == 400


def test_download_job_bad_url(client):
    cid = client.post("/api/cases", json={"name": "Job"}).json()["id"]
    job_id = client.post(
        f"/api/cases/{cid}/media/download",
        json={"url": "https://localhost:1/nothing-here"},
    ).json()["job_id"]

    for _ in range(100):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] != "running":
            break
        time.sleep(0.1)
    assert job["status"] == "error"
    assert job["error"]
