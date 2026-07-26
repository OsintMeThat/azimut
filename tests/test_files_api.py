"""Serving case files: revalidation and cache policy.

The pickers (proof panels, media grid, Files) re-render the same images every
time a dialog opens. Without these headers the browser refetches every byte on
each open, which is what made those dialogs feel slow.
"""

import io

from PIL import Image


def _png_bytes(color=(200, 30, 30), size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def _upload(client, cid, name="shot.png"):
    return client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(_png_bytes()), "image/png")},
    ).json()["item"]


def test_unchanged_file_revalidates_to_304(client):
    cid = client.post("/api/cases", json={"name": "Files"}).json()["id"]
    item = _upload(client, cid)

    first = client.get(f"/files/{cid}/{item['path']}")
    assert first.status_code == 200
    etag = first.headers["etag"]

    again = client.get(f"/files/{cid}/{item['path']}", headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""
    assert again.headers["etag"] == etag


def test_thumbnails_are_cached_forever_and_other_files_revalidate(client):
    cid = client.post("/api/cases", json={"name": "Files"}).json()["id"]
    item = _upload(client, cid)

    # thumbnail names carry the content hash and a generation, so a given URL
    # can never change meaning: the browser may keep it without asking again.
    thumb = client.get(f"/files/{cid}/{item['thumbnail']}")
    assert "immutable" in thumb.headers["cache-control"]

    # the original can be re-imported or edited in place under the same name
    original = client.get(f"/files/{cid}/{item['path']}")
    assert original.headers["cache-control"] == "no-cache"


def test_edited_file_is_served_fresh(client):
    cid = client.post("/api/cases", json={"name": "Files"}).json()["id"]
    item = _upload(client, cid)
    stale = client.get(f"/files/{cid}/{item['path']}").headers["etag"]

    from azimut.api.cases import get_case

    target = get_case(cid).resolve_inside(item["path"])
    target.write_bytes(_png_bytes(color=(10, 10, 200), size=(80, 80)))

    res = client.get(f"/files/{cid}/{item['path']}", headers={"If-None-Match": stale})
    assert res.status_code == 200
    assert res.headers["etag"] != stale
