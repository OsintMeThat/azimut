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


def test_a_name_holding_a_hash_is_served_under_its_encoded_url(client):
    """A TikTok download lands as `#3deenero2025.mp4`, and the name is kept.

    Raw in a URL that `#` opens a fragment: the request arrives as the directory
    and the browser never sees the file, which is how a downloaded video came to
    play nowhere while its hash-named thumbnail showed fine. The UI encodes the
    path (`lib/fileUrl.js`); this is the other half — the route resolving it back
    to the file, rather than reading the escape as traversal.
    """
    cid = client.post("/api/cases", json={"name": "Files"}).json()["id"]
    item = _upload(client, cid, name="#3deenero2025.png")
    assert item["path"] == "media/#3deenero2025.png"

    served = client.get(f"/files/{cid}/media/%233deenero2025.png")
    assert served.status_code == 200
    assert served.content == _png_bytes()

    # what the browser asked for before the encoding: the directory, not a file
    assert client.get(f"/files/{cid}/media/").status_code == 404


SCRIPTED_SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
    b"<script>fetch('/api/settings')</script><rect width='10' height='10'/></svg>"
)


def _upload_bytes(client, cid, name, data, mime):
    res = client.post(
        f"/api/cases/{cid}/media/upload", files={"file": (name, io.BytesIO(data), mime)}
    )
    assert res.status_code == 200, res.text
    return res.json()["item"]


def test_a_case_svg_is_served_sandboxed_so_its_script_never_runs_here(client):
    cid = client.post("/api/cases", json={"name": "Files"}).json()["id"]
    item = _upload_bytes(client, cid, "map.svg", SCRIPTED_SVG, "image/svg+xml")

    served = client.get(f"/files/{cid}/{item['path']}")

    assert served.status_code == 200
    assert served.headers["content-type"].startswith("image/svg+xml")
    policy = served.headers["content-security-policy"]
    assert policy.startswith("sandbox;") and "allow-scripts" not in policy
    assert "default-src 'none'" in policy
    assert served.headers["x-content-type-options"] == "nosniff"
    # still the file, so an <img> of it keeps drawing
    assert served.content == SCRIPTED_SVG

    again = client.get(f"/files/{cid}/{item['path']}", headers={"If-None-Match": served.headers["etag"]})
    assert again.status_code == 304
    assert again.headers["content-security-policy"] == policy


def test_a_case_page_or_an_unnamed_type_is_sandboxed_too(client):
    cid = client.post("/api/cases", json={"name": "Files"}).json()["id"]
    page = _upload_bytes(client, cid, "saved.html", b"<script>alert(1)</script>", "text/html")
    odd = _upload_bytes(client, cid, "blob.weird", b"<script>alert(1)</script>", "application/octet-stream")

    for item in (page, odd):
        served = client.get(f"/files/{cid}/{item['path']}")
        assert served.headers["content-security-policy"].startswith("sandbox;")
        assert served.headers["x-content-type-options"] == "nosniff"


def test_pictures_are_not_sandboxed_but_never_sniffed(client):
    cid = client.post("/api/cases", json={"name": "Files"}).json()["id"]
    item = _upload(client, cid)

    served = client.get(f"/files/{cid}/{item['path']}")

    assert "content-security-policy" not in served.headers
    assert served.headers["x-content-type-options"] == "nosniff"
