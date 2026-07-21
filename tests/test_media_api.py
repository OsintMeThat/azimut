"""Media Library: upload, dedupe, listing, file serving, deletion."""

import io

import graph_read
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
    entities = graph_read.entities(cid)
    assert entities[0]["type"] == "media"
    assert entities[0]["provenance"]["by"] == "media-library"

    # the file and its thumbnail are served
    assert client.get(f"/files/{cid}/{item['path']}").status_code == 200
    assert client.get(f"/files/{cid}/{item['thumbnail']}").status_code == 200


def test_media_list_reports_thumb_state(client):
    cid = client.post("/api/cases", json={"name": "Thumbs"}).json()["id"]
    _upload(client, cid, "shot.png", _png_bytes())

    item = client.get(f"/api/cases/{cid}/media").json()[0]
    assert item["thumb_state"] == "ready"  # image thumbnails render inline


def test_video_thumbnail_is_queued_then_regenerated(client, monkeypatch):
    from azimut.engine import thumbnails
    from azimut.workspace import Case

    # drive the queue by hand: disable the background worker, force a rendering
    # that always succeeds so the test never depends on a real ffmpeg.
    monkeypatch.setattr(thumbnails, "start_workers", False)
    monkeypatch.setattr(
        thumbnails, "_render", lambda mp, out, kind: (out.write_bytes(b"\xff\xd8jpg"), True)[1]
    )
    cid = client.post("/api/cases", json={"name": "Video"}).json()["id"]
    client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": ("clip.mp4", io.BytesIO(b"bytes"), "video/mp4")},
    )

    item = client.get(f"/api/cases/{cid}/media").json()[0]
    assert item["thumbnail"] is None and item["thumb_state"] == "queued"

    thumbnails.drain(Case.open(cid))  # the worker's work, run synchronously
    item = client.get(f"/api/cases/{cid}/media").json()[0]
    assert item["thumb_state"] == "ready" and item["thumbnail"]


def test_regenerate_queues_missing_thumbnails(client, monkeypatch):
    from azimut.engine import thumbnails

    monkeypatch.setattr(thumbnails, "start_workers", False)
    cid = client.post("/api/cases", json={"name": "Regen"}).json()["id"]
    # an image whose cached thumbnail is then removed (as budget eviction would)
    item = _upload(client, cid, "shot.png", _png_bytes()).json()["item"]
    from azimut.workspace import Case

    Case.open(cid).resolve_inside(item["thumbnail"]).unlink()

    res = client.post(f"/api/cases/{cid}/media/thumbnails/regenerate", json={}).json()
    assert res["queued"] == 1  # the now-missing thumbnail is re-queued
    assert client.get(f"/api/cases/{cid}/media").json()[0]["thumb_state"] == "queued"


def test_listing_carries_category_fields(client):
    """The Media Library groups items into facets (Images/Videos/Imports/…) purely
    from ``kind`` and ``source`` — guard that both survive upload + listing."""
    cid = client.post("/api/cases", json={"name": "Facets"}).json()["id"]
    _upload(client, cid, "shot.png", _png_bytes())

    item = client.get(f"/api/cases/{cid}/media").json()[0]
    assert item["kind"] == "image"  # drives the Images facet
    assert item["source"]["type"] == "upload"  # drives the Imports facet


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
    assert graph_read.entities(cid) == []
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
    entity = graph_read.entities(cid)[0]
    assert entity["attrs"]["folder"] == "ukraine"
    assert entity["attrs"]["notes"] == "found at coordinates"

    # clearing the folder mirrors an empty value on the entity
    client.patch(f"/api/cases/{cid}/media", json={"path": item["path"], "folder": ""})
    entity = graph_read.entities(cid)[0]
    assert entity["attrs"]["folder"] == ""


def test_update_media_title(client):
    cid = client.post("/api/cases", json={"name": "Title"}).json()["id"]
    item = _upload(client, cid, "img.png", _png_bytes()).json()["item"]

    updated = client.patch(
        f"/api/cases/{cid}/media",
        json={"path": item["path"], "title": "Strike video — Kharkiv"},
    ).json()
    # the media's own title lives on the sidecar (shown in the Media tab)
    assert updated["title"] == "Strike video — Kharkiv"

    # the entity label mirrors the title so the case sidebar stays in sync
    entities = graph_read.entities(cid)
    assert entities[0]["label"] == "Strike video — Kharkiv"

    # clearing the title reverts to no custom title
    cleared = client.patch(
        f"/api/cases/{cid}/media", json={"path": item["path"], "title": ""}
    ).json()
    assert "title" not in cleared

    # the entity label falls back to the filename — it must not freeze on the
    # old title once that title is gone
    entities = graph_read.entities(cid)
    assert entities[0]["label"] == item["path"].rsplit("/", 1)[-1]


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


def test_download_captures_description(client, monkeypatch):
    """yt-dlp's info dict already carries the video description — it must land
    in the media item's source sidecar so we can show it on the source panel."""
    import sys
    import types

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Desc"}).json()["id"]
    case = Case.open(cid)

    info = {
        "id": "abc123",
        "title": "A clip",
        "description": "Line one\nLine two with a link https://example.com",
        "uploader": "Some Channel",
        "upload_date": "20260701",
        "webpage_url": "https://example.com/watch?v=abc123",
        "extractor": "generic",
        "duration": 12,
    }

    class FakeYDL:
        def __init__(self, opts):
            self._tmpl = opts["outtmpl"]

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def prepare_filename(self, info):
            import os

            path = os.path.join(os.path.dirname(self._tmpl), f"{info['title']} [{info['id']}].png")
            with open(path, "wb") as fh:
                fh.write(_png_bytes())
            return path

        def process_ie_result(self, info, download=True):
            return info

        def extract_info(self, url, download=False):
            return info

    fake = types.ModuleType("yt_dlp")
    fake.YoutubeDL = FakeYDL
    monkeypatch.setitem(sys.modules, "yt_dlp", fake)

    result = media_engine.download_url(case, "https://example.com/watch?v=abc123")
    assert result["item"]["source"]["description"] == info["description"]
    assert result["item"]["source"]["title"] == "A clip"


def _install_fake_ydl(monkeypatch, extract_info_fn, content_fn=None):
    """Patch a fake ``yt_dlp`` module. ``extract_info_fn(ydl, url, download)``
    returns the info dict from the (single) ``extract_info`` call; ``prepare_filename``
    writes a placeholder PNG next to the resolved name so ``download_url`` finds it
    — ``content_fn(info)`` picks its bytes (default: identical for every call;
    pass a per-``info`` variant to avoid sha256-dedup collisions across items
    that are supposed to be distinct, e.g. in a concurrency test).
    ``process_ie_result`` is a passthrough, matching the real "download from
    already-extracted info, no second extraction" call ``download_url`` makes."""
    import sys
    import types

    content_fn = content_fn or (lambda info: _png_bytes())

    class FakeYDL:
        def __init__(self, opts):
            self.opts = opts

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def prepare_filename(self, info):
            import os

            path = os.path.join(
                os.path.dirname(self.opts["outtmpl"]), f"{info['title']} [{info['id']}].png"
            )
            with open(path, "wb") as fh:
                fh.write(content_fn(info))
            return path

        def process_ie_result(self, info, download=True):
            return info

        def extract_info(self, url, download=False):
            return extract_info_fn(self, url, download)

    fake = types.ModuleType("yt_dlp")
    fake.YoutubeDL = FakeYDL
    monkeypatch.setitem(sys.modules, "yt_dlp", fake)


def test_download_reports_multi_without_downloading(client, monkeypatch):
    """A post with several attachments (e.g. a tweet with photos) comes back
    from yt-dlp as a playlist with ``entries``. Without an ``index``,
    ``download_url`` must report each candidate (title/thumbnail/kind) for a
    picker and download *nothing* — one extraction, no file, no case entity."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Multi"}).json()["id"]
    case = Case.open(cid)
    entries = [
        {"id": "p1", "title": "photo 1", "ext": "jpg", "thumbnail": "https://x.test/p1.jpg"},
        {
            "id": "p2",
            "title": "photo 2",
            "ext": "jpg",
            "thumbnails": [{"url": "https://x.test/p2-small.jpg"}, {"url": "https://x.test/p2.jpg"}],
        },
        {"id": "p3", "title": None, "ext": "mp4"},
    ]
    _install_fake_ydl(
        monkeypatch, lambda ydl, url, download: {"_type": "playlist", "entries": entries}
    )

    result = media_engine.download_url(case, "https://x.com/user/status/123")
    assert result == {
        "multi": True,
        "items": [
            {"index": 1, "title": "photo 1", "thumbnail": "https://x.test/p1.jpg", "kind": "image"},
            {"index": 2, "title": "photo 2", "thumbnail": "https://x.test/p2.jpg", "kind": "image"},
            {"index": 3, "title": "p3", "thumbnail": None, "kind": "video"},
        ],
    }
    assert case.list_entities() == []
    assert client.get(f"/api/cases/{cid}/media").json() == []


def test_download_route_surfaces_multi_via_job(client, monkeypatch):
    """Same as above, exercised through the actual HTTP route + job polling
    (not just the engine function) to check the request/response wiring."""
    from azimut.engine import media as media_engine

    cid = client.post("/api/cases", json={"name": "MultiRoute"}).json()["id"]
    entries = [{"id": "p1", "title": "a", "ext": "jpg"}, {"id": "p2", "title": "b", "ext": "jpg"}]
    monkeypatch.setattr(
        media_engine,
        "download_url",
        lambda case, url, progress_hook=None, index=None, title=None: {
            "multi": True,
            "items": media_engine._picker_items(entries),
        },
    )

    job_id = client.post(
        f"/api/cases/{cid}/media/download", json={"url": "https://x.com/u/status/1"}
    ).json()["job_id"]

    for _ in range(100):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] != "running":
            break
        time.sleep(0.1)
    assert job["status"] == "done"
    assert job["result"]["multi"] is True
    assert [i["title"] for i in job["result"]["items"]] == ["a", "b"]


def test_download_with_index_picks_entry_and_keeps_custom_title(client, monkeypatch):
    """Downloading item #2 of a multi-item post must fetch that specific entry
    (via yt-dlp's ``playlist_items``) and let the caller override the display
    title while keeping the originally-extracted title in the source record."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "MultiPick"}).json()["id"]
    case = Case.open(cid)
    entries = [{"id": "p1", "title": "photo one"}, {"id": "p2", "title": "photo two"}]

    def extract_info(ydl, url, download):
        assert ydl.opts["playlist_items"] == "2"
        return {"_type": "playlist", "entries": [entries[int(ydl.opts["playlist_items"]) - 1]]}

    _install_fake_ydl(monkeypatch, extract_info)

    result = media_engine.download_url(
        case, "https://x.com/user/status/123", index=2, title="My custom title"
    )
    assert result["item"]["title"] == "My custom title"
    assert result["item"]["source"]["title"] == "photo two"  # provenance stays honest


def test_download_autofills_title_from_extraction(client, monkeypatch):
    """No explicit title given — the display title should default to whatever
    yt-dlp reported, instead of leaving the media card stuck on the raw
    filename until the analyst manually renames it."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "AutoTitle"}).json()["id"]
    case = Case.open(cid)

    _install_fake_ydl(
        monkeypatch, lambda ydl, url, download: {"id": "abc123", "title": "Strike footage"}
    )

    result = media_engine.download_url(case, "https://example.com/watch?v=abc123")
    assert result["item"]["title"] == "Strike footage"


def _install_failing_ydl(monkeypatch):
    """A fake yt_dlp module whose extract_info always raises DownloadError —
    used to exercise the gallery-dl fallback (yt-dlp's extractors are
    video-first and hard-fail on e.g. a photo-only tweet)."""
    import sys
    import types

    class DownloadError(Exception):
        pass

    class FakeYDL:
        def __init__(self, opts):
            self.opts = opts

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def extract_info(self, url, download=False):
            raise DownloadError("No video could be found in this tweet")

    utils = types.ModuleType("yt_dlp.utils")
    utils.DownloadError = DownloadError
    fake = types.ModuleType("yt_dlp")
    fake.YoutubeDL = FakeYDL
    fake.utils = utils
    monkeypatch.setitem(sys.modules, "yt_dlp", fake)
    monkeypatch.setitem(sys.modules, "yt_dlp.utils", utils)


class _FakeGalleryExtractor:
    """Mimics a gallery-dl extractor: iterating yields (message_type, url,
    kwdict) tuples, type 3 being ``Message.Url`` (a downloadable file)."""

    def __init__(self, items):
        self._items = items

    def __iter__(self):
        yield (2, "", {})  # Message.Directory — ignored by our code
        for url, kw in self._items:
            yield (3, url, kw)

    def request(self, url):
        class Resp:
            content = _png_bytes()

        return Resp()


def test_gallery_dl_fallback_downloads_single_image(client, monkeypatch):
    """A photo-only tweet: yt-dlp raises, gallery-dl finds one image — it
    must still land in the case, with provenance naming gallery-dl."""
    import gallery_dl.extractor as gdl_extractor

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "GalleryFallback"}).json()["id"]
    case = Case.open(cid)

    _install_failing_ydl(monkeypatch)
    items = [
        (
            "https://pbs.twimg.com/media/abc.jpg",
            {
                "filename": "abc",
                "extension": "jpg",
                "content": "Impact on the substation\nsecond line",
                "author": {"nick": "someone"},
            },
        )
    ]
    monkeypatch.setattr(gdl_extractor, "find", lambda url: _FakeGalleryExtractor(items))

    result = media_engine.download_url(case, "https://x.com/u/status/1")
    assert result["multi"] is False
    assert result["item"]["source"]["downloader"] == "gallery-dl"
    assert result["item"]["title"] == "Impact on the substation"
    assert result["item"]["source"]["uploader"] == "someone"


def test_gallery_dl_fallback_multi_images(client, monkeypatch):
    """Two photos on the same post: reported as a picker like the yt-dlp
    path, downloads nothing until an ``index`` is picked."""
    import gallery_dl.extractor as gdl_extractor

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "GalleryMulti"}).json()["id"]
    case = Case.open(cid)
    items = [
        ("https://pbs.twimg.com/media/a.jpg", {"filename": "a", "extension": "jpg"}),
        ("https://pbs.twimg.com/media/b.png", {"filename": "b", "extension": "png"}),
    ]

    _install_failing_ydl(monkeypatch)
    monkeypatch.setattr(gdl_extractor, "find", lambda url: _FakeGalleryExtractor(items))

    result = media_engine.download_url(case, "https://x.com/u/status/2")
    assert result == {
        "multi": True,
        "items": [
            {"index": 1, "title": "a", "thumbnail": items[0][0], "kind": "image"},
            {"index": 2, "title": "b", "thumbnail": items[1][0], "kind": "image"},
        ],
    }
    assert case.list_entities() == []

    picked = media_engine.download_url(case, "https://x.com/u/status/2", index=2)
    assert picked["multi"] is False
    assert picked["item"]["filename"].startswith("b")


def test_gallery_dl_fallback_no_extractor_raises(client, monkeypatch):
    """Neither yt-dlp nor gallery-dl recognizes the link — a clear error, not
    a silent no-op."""
    import gallery_dl.extractor as gdl_extractor

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "GalleryNone"}).json()["id"]
    case = Case.open(cid)

    _install_failing_ydl(monkeypatch)
    monkeypatch.setattr(gdl_extractor, "find", lambda url: None)

    try:
        media_engine.download_url(case, "https://example.com/nope")
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        assert "no extractor" in str(exc)


def test_telegram_extra_photos_parses_embed_html(monkeypatch):
    """Unit test for the Telegram photo scraper itself: extracts photo CDN
    URLs from the embed page's markup, and never makes a network call at all
    for a non-Telegram URL (the domain check short-circuits first)."""
    from azimut.engine import media as media_engine

    html = """
    <a class="tgme_widget_message_photo_wrap grouped_media_wrap blured js-message_photo"
       style="background-image:url('https://cdn1.telesco.pe/file/AAA')"></a>
    <a class="tgme_widget_message_photo_wrap grouped_media_wrap blured js-message_photo"
       style="background-image:url('https://cdn1.telesco.pe/file/BBB')"></a>
    """

    class FakeResp:
        text = html

        def raise_for_status(self):
            pass

    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **kw: FakeResp())

    photos = media_engine._telegram_extra_photos("https://t.me/exilenova_plus/24988")
    assert [p["url"] for p in photos] == [
        "https://cdn1.telesco.pe/file/AAA",
        "https://cdn1.telesco.pe/file/BBB",
    ]

    def boom(*a, **kw):
        raise AssertionError("must not be called for a non-Telegram URL")

    monkeypatch.setattr(requests, "get", boom)
    assert media_engine._telegram_extra_photos("https://x.com/u/status/1") == []


def test_download_merges_telegram_video_and_photos(client, monkeypatch):
    """A mixed Telegram album (2 videos yt-dlp finds + 2 photos it silently
    drops) must surface all 4 in one picker, videos first then photos, not
    just the videos yt-dlp itself reports."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "TelegramMixed"}).json()["id"]
    case = Case.open(cid)

    entries = [
        {"id": "v1", "title": "clip one", "ext": "mp4"},
        {"id": "v2", "title": "clip two", "ext": "mp4"},
    ]
    _install_fake_ydl(
        monkeypatch, lambda ydl, url, download: {"_type": "playlist", "entries": entries}
    )
    monkeypatch.setattr(
        media_engine,
        "_telegram_extra_photos",
        lambda url: [{"url": "https://cdn/a.jpg"}, {"url": "https://cdn/b.jpg"}],
    )

    result = media_engine.download_url(case, "https://t.me/exilenova_plus/24988")
    assert result["multi"] is True
    assert [(i["index"], i["kind"]) for i in result["items"]] == [
        (1, "video"),
        (2, "video"),
        (3, "image"),
        (4, "image"),
    ]
    assert case.list_entities() == []  # detection only — nothing downloaded


def test_download_picks_telegram_photo_from_mixed_post(client, monkeypatch):
    """Picking index 3 out of the merged 2-video + 2-photo post must resolve
    to the *first* extra photo, not a yt-dlp entry."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "TelegramPickPhoto"}).json()["id"]
    case = Case.open(cid)

    entries = [{"id": "v1", "title": "clip one", "ext": "mp4"}, {"id": "v2", "title": "clip two", "ext": "mp4"}]
    _install_fake_ydl(
        monkeypatch, lambda ydl, url, download: {"_type": "playlist", "entries": entries}
    )
    monkeypatch.setattr(
        media_engine,
        "_telegram_extra_photos",
        lambda url: [{"url": "https://cdn/a.jpg"}, {"url": "https://cdn/b.jpg"}],
    )

    captured = {}

    def fake_register(case_, post_url, photo, *, title=None):
        captured["photo"] = photo
        return {"multi": False, "item": {"filename": "a.jpg"}}

    monkeypatch.setattr(media_engine, "_register_telegram_photo", fake_register)

    result = media_engine.download_url(case, "https://t.me/exilenova_plus/24988", index=3)
    assert captured["photo"]["url"] == "https://cdn/a.jpg"
    assert result["item"]["filename"] == "a.jpg"


def test_download_picks_yt_dlp_video_from_mixed_post(client, monkeypatch):
    """Picking index 2 out of the same merged post must still resolve to
    yt-dlp's second video entry, not a photo."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "TelegramPickVideo"}).json()["id"]
    case = Case.open(cid)

    entries = [{"id": "v1", "title": "clip one", "ext": "mp4"}, {"id": "v2", "title": "clip two", "ext": "mp4"}]
    _install_fake_ydl(
        monkeypatch, lambda ydl, url, download: {"_type": "playlist", "entries": entries}
    )
    monkeypatch.setattr(
        media_engine,
        "_telegram_extra_photos",
        lambda url: [{"url": "https://cdn/a.jpg"}, {"url": "https://cdn/b.jpg"}],
    )

    result = media_engine.download_url(case, "https://t.me/exilenova_plus/24988", index=2)
    assert result["item"]["source"]["title"] == "clip two"


def test_concurrent_downloads_dont_lose_entities(client, monkeypatch):
    """The multi-item picker fires one download per selected attachment, and
    those run concurrently (each on its own job thread). Every one of them
    ends in ``_register`` -> ``case.add_entity``, a read-modify-write of
    case.json — without a lock, whichever thread wins the write races drops
    every entity added in between (regression: reported as attachments
    silently vanishing / only one of several selected items ending up filed)."""
    import threading

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Concurrent"}).json()["id"]
    case = Case.open(cid)
    n = 8

    def extract_info(ydl, url, download):
        idx = int(ydl.opts["playlist_items"])
        time.sleep(0.02)  # widen the race window
        return {"id": f"item{idx}", "title": f"clip {idx}"}

    # distinct bytes per item — identical content would legitimately dedup
    # via sha256 and mask what this test is actually checking (entity loss,
    # not the separate dedup-check race)
    _install_fake_ydl(
        monkeypatch, extract_info, content_fn=lambda info: _png_bytes(color=(int(info["id"][4:]), 0, 0))
    )

    errors = []

    def run(i):
        try:
            media_engine.download_url(case, "https://x.com/u/status/1", index=i, title=f"title {i}")
        except Exception:  # pragma: no cover - assertion below reports it
            import traceback

            errors.append(traceback.format_exc())

    threads = [threading.Thread(target=run, args=(i,)) for i in range(1, n + 1)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == [], "\n\n".join(errors)
    assert len(case.list_entities()) == n
    assert len(client.get(f"/api/cases/{cid}/media").json()) == n


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
