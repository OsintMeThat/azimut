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
        # and no page elsewhere may frame it, with or without the sandbox
        assert served.headers["x-frame-options"] == "SAMEORIGIN"


def test_pictures_are_not_sandboxed_but_never_sniffed(client):
    cid = client.post("/api/cases", json={"name": "Files"}).json()["id"]
    item = _upload(client, cid)

    served = client.get(f"/files/{cid}/{item['path']}")

    assert "content-security-policy" not in served.headers
    assert served.headers["x-content-type-options"] == "nosniff"


# -- a player is answered a piece at a time ------------------------------------------


def _write_case_file(cid, rel, data):
    from azimut.api.cases import get_case

    target = get_case(cid).resolve_inside(rel)
    target.write_bytes(data)
    return rel


def test_a_player_gets_a_long_video_a_piece_at_a_time(client, monkeypatch):
    """A media element asks from where it reads to the end of the file and stops
    reading once its buffer is full, which kept one of the browser's six connections
    to the app for as long as the player stayed open. A short answer lands whole and
    frees it; the player asks again for the next piece, and a seek still lands."""
    from azimut.api import files

    monkeypatch.setattr(files, "PLAYER_PIECE", 1000)
    cid = client.post("/api/cases", json={"name": "Files"}).json()["id"]
    data = bytes(range(256)) * 20  # 5120 bytes
    rel = _write_case_file(cid, "media/clip.mp4", data)

    first = client.get(f"/files/{cid}/{rel}", headers={"Range": "bytes=0-"})
    assert first.status_code == 206
    assert first.headers["content-range"] == "bytes 0-999/5120"
    assert first.content == data[:1000]

    # Chrome's next ask names the last byte and the version it holds: still the rest
    etag = first.headers["etag"]
    then = client.get(f"/files/{cid}/{rel}", headers={"Range": "bytes=1000-5119", "If-Range": etag})
    assert then.status_code == 206
    assert then.headers["content-range"] == "bytes 1000-1999/5120"
    assert then.content == data[1000:2000]

    # a seek far into the file is answered from there, one piece long
    seek = client.get(f"/files/{cid}/{rel}", headers={"Range": "bytes=2500-"})
    assert seek.headers["content-range"] == "bytes 2500-3499/5120"
    assert seek.content == data[2500:3500]

    # the last piece is whatever is left
    tail = client.get(f"/files/{cid}/{rel}", headers={"Range": "bytes=4500-"})
    assert tail.headers["content-range"] == "bytes 4500-5119/5120"
    assert tail.content == data[4500:]

    # the answer still says the file's whole length, which the player reads its duration against
    assert all(r.headers["accept-ranges"] == "bytes" for r in (first, seek, tail))


def test_what_is_not_a_player_ask_is_served_as_asked(client, monkeypatch):
    from azimut.api import files

    monkeypatch.setattr(files, "PLAYER_PIECE", 100)
    cid = client.post("/api/cases", json={"name": "Files"}).json()["id"]
    data = bytes(range(256)) * 4
    video = _write_case_file(cid, "media/clip.mp4", data)
    picture = _upload(client, cid)

    # the whole file, without a Range: a download, the Media Library's Open
    whole = client.get(f"/files/{cid}/{video}")
    assert whole.status_code == 200 and whole.content == data

    # a range with an end is what was asked, past the piece too
    closed = client.get(f"/files/{cid}/{video}", headers={"Range": "bytes=0-499"})
    assert closed.headers["content-range"] == "bytes 0-499/1024"
    assert len(closed.content) == 500

    # a picture asked open-ended is never shortened: only players hold a connection
    png = (client.get(f"/files/{cid}/{picture['path']}")).content
    assert len(png) > 100
    rest = client.get(f"/files/{cid}/{picture['path']}", headers={"Range": "bytes=10-"})
    assert rest.content == png[10:]


def test_only_an_open_ended_ask_longer_than_a_piece_is_shortened(monkeypatch):
    from azimut.api import files

    monkeypatch.setattr(files, "PLAYER_PIECE", 1000)
    assert files.player_range("bytes=0-", 5000) == "bytes=0-999"
    assert files.player_range("bytes = 200 -", 5000) == "bytes=200-1199"
    assert files.player_range("bytes=1000-4999", 5000) == "bytes=1000-1999"  # to the last byte
    assert files.player_range("bytes=1000-9999", 5000) == "bytes=1000-1999"  # past it, the same
    assert files.player_range("bytes=4500-", 5000) is None  # what is left is short already
    assert files.player_range("bytes=0-99", 5000) is None
    assert files.player_range("bytes=0-4998", 5000) is None  # stops short of the end: as asked
    assert files.player_range("bytes=-500", 5000) is None
    assert files.player_range("bytes=0-,2000-", 5000) is None
    assert files.player_range(None, 5000) is None
    assert files.player_range("items=0-", 5000) is None
