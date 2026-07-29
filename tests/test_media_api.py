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


def test_media_list_reports_enrichment_state(client, monkeypatch):
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    cid = client.post("/api/cases", json={"name": "Enrichment state"}).json()["id"]
    _upload(client, cid, "shot.png", _png_bytes())

    assert client.get(f"/api/cases/{cid}/media").json()[0]["enrich_state"] == "queued"
    workqueue.drain(Case.open(cid))
    assert client.get(f"/api/cases/{cid}/media").json()[0]["enrich_state"] == "ready"


def test_video_thumbnail_is_queued_then_regenerated(client, monkeypatch):
    from azimut.engine import thumbnails, workqueue
    from azimut.workspace import Case

    # drive the queue by hand: disable the background worker, force a rendering
    # that always succeeds so the test never depends on a real ffmpeg.
    monkeypatch.setattr(workqueue, "start_workers", False)
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

    workqueue.drain(Case.open(cid))  # the worker's work, run synchronously
    item = client.get(f"/api/cases/{cid}/media").json()[0]
    assert item["thumb_state"] == "ready" and item["thumbnail"]


def test_regenerate_queues_missing_thumbnails(client, monkeypatch):
    from azimut.engine import workqueue

    monkeypatch.setattr(workqueue, "start_workers", False)
    cid = client.post("/api/cases", json={"name": "Regen"}).json()["id"]
    # an image whose cached thumbnail is then removed (as budget eviction would)
    item = _upload(client, cid, "shot.png", _png_bytes()).json()["item"]
    from azimut.workspace import Case

    Case.open(cid).resolve_inside(item["thumbnail"]).unlink()

    res = client.post(f"/api/cases/{cid}/media/thumbnails/regenerate", json={}).json()
    assert res["queued"] == 1  # the now-missing thumbnail is re-queued
    assert client.get(f"/api/cases/{cid}/media").json()[0]["thumb_state"] == "queued"


def test_enrich_backfill_queues_only_items_below_the_current_version(client, monkeypatch):
    from azimut.engine import enrich as enrich_engine
    from azimut.engine import media as media_engine
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    cid = client.post("/api/cases", json={"name": "Enrich backfill"}).json()["id"]
    rel = _upload(client, cid, "shot.png", _png_bytes()).json()["item"]["path"]
    case = Case.open(cid)

    workqueue.drain(case)
    assert client.post(f"/api/cases/{cid}/media/enrich", json={}).json() == {"queued": 0}

    # Simulate a sidecar written by an older enrichment version.
    media_engine.merge_item(case, rel, {"enrich_version": None})

    assert client.post(f"/api/cases/{cid}/media/enrich", json={}).json() == {"queued": 1}
    queued = case.list_jobs(kind=enrich_engine.ENRICH_KIND, state="queued")
    assert [job["payload"]["path"] for job in queued] == [rel]


def test_enrich_backfill_can_force_one_known_path(client, monkeypatch):
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    cid = client.post("/api/cases", json={"name": "Enrich one"}).json()["id"]
    rel = _upload(client, cid, "shot.png", _png_bytes()).json()["item"]["path"]
    case = Case.open(cid)
    workqueue.drain(case)

    response = client.post(f"/api/cases/{cid}/media/enrich", json={"path": rel})

    assert response.json() == {"queued": 1}
    assert case.list_jobs(kind="enrich", state="queued")[0]["payload"]["path"] == rel


def test_listing_carries_category_fields(client):
    """The Media Library groups items into facets (Images/Videos/Imports/…) purely
    from ``kind`` and ``source`` — guard that both survive upload + listing."""
    cid = client.post("/api/cases", json={"name": "Facets"}).json()["id"]
    _upload(client, cid, "shot.png", _png_bytes())

    item = client.get(f"/api/cases/{cid}/media").json()[0]
    assert item["kind"] == "image"  # drives the Images facet
    assert item["source"]["type"] == "upload"  # drives the Imports facet


def test_listing_derives_satellite_mode_for_legacy_extension_capture(client):
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Legacy satellite"}).json()["id"]
    media_engine.import_image(
        Case.open(cid),
        Image.new("RGB", (32, 24), (20, 80, 20)),
        "legacy-screenshot.png",
        {
            "type": "screenshot",
            "source_url": "https://www.google.com/maps/@48.8584,2.2945,2000m/data=!3m1!1e3",
        },
        entity_type="capture",
        dedupe=False,
    )

    item = client.get(f"/api/cases/{cid}/media").json()[0]
    assert item["source"]["imagery_mode"] == "satellite"


def _set(client, cid, path, **patch):
    return client.patch(f"/api/cases/{cid}/media", json={"path": path, **patch}).json()


def test_media_page_paginates(client):
    cid = client.post("/api/cases", json={"name": "Page"}).json()["id"]
    for i in range(5):
        _upload(client, cid, f"shot{i}.png", _png_bytes(color=(i, 0, 0)))

    first = client.get(f"/api/cases/{cid}/media/page", params={"limit": 2}).json()
    assert len(first["items"]) == 2
    assert first["total"] == 5
    assert first["next_cursor"] == "2"

    mid = client.get(
        f"/api/cases/{cid}/media/page", params={"limit": 2, "cursor": first["next_cursor"]}
    ).json()
    assert len(mid["items"]) == 2
    assert mid["next_cursor"] == "4"

    last = client.get(
        f"/api/cases/{cid}/media/page", params={"limit": 2, "cursor": mid["next_cursor"]}
    ).json()
    assert len(last["items"]) == 1
    assert last["next_cursor"] is None


def test_media_page_query_matches_title_notes_folder(client):
    cid = client.post("/api/cases", json={"name": "Q"}).json()["id"]
    a = _upload(client, cid, "alpha.png", _png_bytes(color=(1, 0, 0))).json()["item"]
    b = _upload(client, cid, "beta.png", _png_bytes(color=(2, 0, 0))).json()["item"]
    _set(client, cid, a["path"], notes="bridge over the river", folder="ukraine")
    _set(client, cid, b["path"], title="Harbour view")

    hit = client.get(f"/api/cases/{cid}/media/page", params={"q": "bridge"}).json()
    assert [i["path"] for i in hit["items"]] == [a["path"]]
    # folder + a source/title term both match
    assert client.get(f"/api/cases/{cid}/media/page", params={"q": "harbour"}).json()["total"] == 1
    # two space-split terms must both be present (AND)
    assert client.get(f"/api/cases/{cid}/media/page", params={"q": "bridge river"}).json()["total"] == 1
    assert client.get(f"/api/cases/{cid}/media/page", params={"q": "bridge harbour"}).json()["total"] == 0


def test_media_page_kind_and_folder_filters(client):
    cid = client.post("/api/cases", json={"name": "Filt"}).json()["id"]
    a = _upload(client, cid, "a.png", _png_bytes(color=(3, 0, 0))).json()["item"]
    _upload(client, cid, "b.png", _png_bytes(color=(4, 0, 0)))
    _set(client, cid, a["path"], folder="kyiv")

    assert client.get(f"/api/cases/{cid}/media/page", params={"kind": "image"}).json()["total"] == 2
    assert client.get(f"/api/cases/{cid}/media/page", params={"folder": "kyiv"}).json()["total"] == 1


def test_media_page_sort_name_and_size(client):
    cid = client.post("/api/cases", json={"name": "Sort"}).json()["id"]
    small = _upload(client, cid, "s.png", _png_bytes(color=(5, 0, 0), size=(16, 16))).json()["item"]
    big = _upload(client, cid, "b.png", _png_bytes(color=(6, 0, 0), size=(256, 256))).json()["item"]
    _set(client, cid, small["path"], title="Zebra")
    _set(client, cid, big["path"], title="Alpha")

    by_name = client.get(f"/api/cases/{cid}/media/page", params={"sort": "name"}).json()
    assert [i["title"] for i in by_name["items"]] == ["Alpha", "Zebra"]

    by_size = client.get(f"/api/cases/{cid}/media/page", params={"sort": "size"}).json()
    assert by_size["items"][0]["path"] == big["path"]

    name_desc = client.get(
        f"/api/cases/{cid}/media/page", params={"sort": "name", "direction": "desc"}
    ).json()
    assert [item["title"] for item in name_desc["items"]] == ["Zebra", "Alpha"]

    size_asc = client.get(
        f"/api/cases/{cid}/media/page", params={"sort": "size", "direction": "asc"}
    ).json()
    assert size_asc["items"][0]["path"] == small["path"]


def test_media_page_facets_count_full_set(client):
    cid = client.post("/api/cases", json={"name": "Facets2"}).json()["id"]
    a = _upload(client, cid, "a.png", _png_bytes(color=(7, 0, 0))).json()["item"]
    _upload(client, cid, "b.png", _png_bytes(color=(8, 0, 0)))
    _set(client, cid, a["path"], folder="kyiv")

    # facets reflect the whole filtered set even when a page slices it
    page = client.get(f"/api/cases/{cid}/media/page", params={"limit": 1}).json()
    assert len(page["items"]) == 1  # only one item on the page
    assert page["facets"]["kind_counts"]["image"] == 2  # ...but both counted
    assert page["facets"]["folder_counts"]["kyiv"] == 1
    assert page["facets"]["category_counts"]["image"] == 2
    assert page["facets"]["category_counts"]["upload"] == 2


def test_media_page_filters_categories_without_page_local_counts(client):
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Categories"}).json()["id"]
    generic = _upload(client, cid, "generic.png", _png_bytes()).json()["item"]
    satellite = media_engine.import_image(
        Case.open(cid),
        Image.new("RGB", (32, 24)),
        "map.png",
        {"type": "satellite"},
        entity_type="capture",
        dedupe=False,
    )["item"]

    images = client.get(
        f"/api/cases/{cid}/media/page", params={"category": "image", "limit": 1}
    ).json()
    assert images["total"] == 1
    assert [item["path"] for item in images["items"]] == [generic["path"]]
    # Counts describe all matching media, not only the selected page/category.
    assert images["facets"]["category_counts"]["image"] == 1
    assert images["facets"]["category_counts"]["satellite"] == 1

    maps = client.get(
        f"/api/cases/{cid}/media/page", params={"category": "satellite"}
    ).json()
    assert [item["path"] for item in maps["items"]] == [satellite["path"]]


def test_media_page_does_not_scan_sidecars_for_each_request(client, monkeypatch):
    from azimut.engine import media as media_engine

    cid = client.post("/api/cases", json={"name": "Indexed page"}).json()["id"]
    _upload(client, cid, "shot.png", _png_bytes())
    monkeypatch.setattr(
        media_engine,
        "list_media",
        lambda _case: (_ for _ in ()).throw(AssertionError("sidecar list called")),
    )

    page = client.get(f"/api/cases/{cid}/media/page").json()
    assert page["total"] == 1


def test_media_metadata_returns_only_requested_paths(client):
    cid = client.post("/api/cases", json={"name": "Metadata"}).json()["id"]
    first = _upload(client, cid, "first.png", _png_bytes(color=(10, 0, 0))).json()["item"]
    second = _upload(client, cid, "second.png", _png_bytes(color=(20, 0, 0))).json()["item"]

    items = client.post(
        f"/api/cases/{cid}/media/metadata",
        json={"paths": [second["path"], "media/missing.png", first["path"]]},
    ).json()
    assert [item["path"] for item in items] == [second["path"], first["path"]]
    assert all(item["thumb_state"] == "ready" for item in items)


def test_media_page_items_carry_thumb_state(client):
    cid = client.post("/api/cases", json={"name": "PageThumb"}).json()["id"]
    _upload(client, cid, "shot.png", _png_bytes())
    page = client.get(f"/api/cases/{cid}/media/page").json()
    assert page["items"][0]["thumb_state"] == "ready"


def test_media_page_reports_pending_thumbnails_beyond_the_loaded_page(client, monkeypatch):
    from azimut.engine import workqueue

    monkeypatch.setattr(workqueue, "start_workers", False)
    cid = client.post("/api/cases", json={"name": "Paged thumbnail jobs"}).json()["id"]
    for index, name in enumerate(("a.mp4", "b.mp4")):
        client.post(
            f"/api/cases/{cid}/media/upload",
            files={"file": (name, io.BytesIO(f"video {index}".encode()), "video/mp4")},
        )

    page = client.get(f"/api/cases/{cid}/media/page", params={"limit": 1}).json()

    assert len(page["items"]) == 1
    assert page["facets"]["thumbnail_pending"] == 2


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
        lambda case, url, progress_hook=None, index=None, title=None, cookies=None: {
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


def _install_failing_ydl(monkeypatch, message="No video could be found in this tweet"):
    """A fake yt_dlp module whose extract_info always raises DownloadError —
    used to exercise the gallery-dl fallback (yt-dlp's extractors are
    video-first and hard-fail on e.g. a photo-only tweet). ``message`` lets a
    test choose an auth-shaped vs. a generic failure."""
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
            raise DownloadError(message)

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


# --- gated downloads: on-demand cookies (v2) ------------------------------


def test_public_download_never_passes_cookies(client, monkeypatch):
    """Local-first: the first (default) attempt must carry no cookie options at
    all — public media is downloaded without ever touching the browser session,
    even once a cookie source has been saved."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "NoCookies"}).json()["id"]
    case = Case.open(cid)

    def extract_info(ydl, url, download):
        assert "cookiesfrombrowser" not in ydl.opts
        assert "cookiefile" not in ydl.opts
        return {"id": "abc123", "title": "Public clip"}

    _install_fake_ydl(monkeypatch, extract_info)
    result = media_engine.download_url(case, "https://example.com/watch?v=abc123")
    assert result["item"]["title"] == "Public clip"


def test_auth_wall_returns_needs_auth(client, monkeypatch):
    """A login-gated link (yt-dlp reports an auth-shaped error, gallery-dl has
    no extractor) must not just error — it returns a needs_auth signal carrying
    the platform so the UI can offer the cookie affordance."""
    import sys

    import gallery_dl.extractor as gdl_extractor

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Gated"}).json()["id"]
    case = Case.open(cid)

    _install_failing_ydl(monkeypatch, "ERROR: Private video. Sign in if you've been granted access")
    monkeypatch.setattr(gdl_extractor, "find", lambda url: None)

    result = media_engine.download_url(case, "https://youtube.com/watch?v=priv")
    assert result == {"needs_auth": True, "platform": sys.platform}


def test_gallery_auth_error_returns_needs_auth(client, monkeypatch):
    """The image path can hit the wall too: gallery-dl raising its typed
    AuthenticationError must surface needs_auth, not crash the job."""
    import sys

    import gallery_dl.extractor as gdl_extractor

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "GatedImg"}).json()["id"]
    case = Case.open(cid)

    class AuthenticationError(Exception):
        pass

    def boom(url):
        raise AuthenticationError("Login required")

    _install_failing_ydl(monkeypatch, "No video could be found")
    monkeypatch.setattr(gdl_extractor, "find", boom)

    result = media_engine.download_url(case, "https://instagram.com/p/priv")
    assert result == {"needs_auth": True, "platform": sys.platform}


def test_non_auth_failure_does_not_prompt_cookies(client, monkeypatch):
    """A dead link (no auth signal anywhere) keeps today's behavior: a plain
    error, never a cookie prompt the user can do nothing useful with."""
    import gallery_dl.extractor as gdl_extractor

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Dead"}).json()["id"]
    case = Case.open(cid)

    _install_failing_ydl(monkeypatch, "ERROR: Unable to download webpage: HTTP Error 404")
    monkeypatch.setattr(gdl_extractor, "find", lambda url: None)

    try:
        media_engine.download_url(case, "https://example.com/nope")
        raise AssertionError("expected RuntimeError, not a needs_auth prompt")
    except RuntimeError as exc:
        assert "no extractor" in str(exc)


def test_retry_with_browser_threads_cookiesfrombrowser(client, monkeypatch):
    """Retrying a gated link with a browser cookie source hands yt-dlp
    cookiesfrombrowser=(name,) so it downloads as the logged-in user."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "CookieBrowser"}).json()["id"]
    case = Case.open(cid)

    def extract_info(ydl, url, download):
        assert ydl.opts["cookiesfrombrowser"] == ("firefox",)
        return {"id": "abc123", "title": "Gated clip"}

    _install_fake_ydl(monkeypatch, extract_info)
    result = media_engine.download_url(
        case, "https://youtube.com/watch?v=priv", cookies={"browser": "firefox"}
    )
    assert result["item"]["title"] == "Gated clip"


def test_windows_chromium_returns_guidance(client, monkeypatch):
    """On Windows a Chromium cookie DB is locked/app-bound-encrypted, so we do
    not even attempt it: pick Chrome there and the backend returns a guidance
    signal instead of constructing yt-dlp."""
    import sys

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "WinChrome"}).json()["id"]
    case = Case.open(cid)

    monkeypatch.setattr(sys, "platform", "win32")
    called = []
    _install_fake_ydl(monkeypatch, lambda ydl, url, download: called.append(1) or {"id": "x"})

    result = media_engine.download_url(
        case, "https://youtube.com/watch?v=priv", cookies={"browser": "chrome"}
    )
    assert result == {"needs_auth": True, "guidance": "windows-chromium"}
    assert called == [], "must not touch yt-dlp for a locked Windows Chromium store"


def test_cookies_file_threads_absolute_cookiefile(client, monkeypatch):
    """A cookies.txt source hands yt-dlp an absolute cookiefile path (resolved
    against the workspace when relative)."""
    import os

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "CookieFile"}).json()["id"]
    case = Case.open(cid)

    def extract_info(ydl, url, download):
        assert os.path.isabs(ydl.opts["cookiefile"])
        assert ydl.opts["cookiefile"].endswith("cookies.txt")
        return {"id": "abc123", "title": "Gated via file"}

    _install_fake_ydl(monkeypatch, extract_info)
    result = media_engine.download_url(
        case, "https://youtube.com/watch?v=priv", cookies={"file": "cookies.txt"}
    )
    assert result["item"]["title"] == "Gated via file"


def test_apply_gallery_cookies_sets_browser_then_file(monkeypatch):
    """The gallery-dl path threads cookies through gallery_dl.config: a browser
    source as a [name] list, a file source as a path string."""
    import sys
    import types

    from azimut.engine import media as media_engine

    calls = []
    config_mod = types.ModuleType("gallery_dl.config")
    config_mod.set = lambda path, key, value: calls.append((path, key, value))
    gdl = types.ModuleType("gallery_dl")
    gdl.config = config_mod
    monkeypatch.setitem(sys.modules, "gallery_dl", gdl)
    monkeypatch.setitem(sys.modules, "gallery_dl.config", config_mod)

    media_engine._apply_gallery_cookies({"browser": "firefox"})
    assert calls[-1] == (("extractor",), "cookies", ["firefox"])

    media_engine._apply_gallery_cookies({"file": "cookies.txt"})
    path, key, value = calls[-1]
    assert (path, key) == (("extractor",), "cookies")
    assert value.endswith("cookies.txt")

    calls.clear()
    media_engine._apply_gallery_cookies(None)
    assert calls == [], "no cookies → no gallery-dl config mutation"


def test_cookies_from_preference_maps_each_source():
    from azimut.engine import media as media_engine

    assert media_engine.cookies_from_preference(None) is None
    assert media_engine.cookies_from_preference({"source": "none"}) is None
    assert media_engine.cookies_from_preference({"source": "browser", "browser": "firefox"}) == {
        "browser": "firefox"
    }
    assert media_engine.cookies_from_preference({"source": "file", "file": "cookies.txt"}) == {
        "file": "cookies.txt"
    }
    # an incomplete record is treated as off, never a half-applied source
    assert media_engine.cookies_from_preference({"source": "browser"}) is None


def test_download_use_cookies_threads_saved_preference(client, monkeypatch):
    """The download route stays cookie-less by default; only ``use_cookies``
    reads the saved preference and hands it to the engine — that's what keeps
    public media off the login session."""
    from azimut.engine import media as media_engine

    cid = client.post("/api/cases", json={"name": "UseCookies"}).json()["id"]
    client.put(
        "/api/settings/prefs",
        json={"download_cookies": {"source": "browser", "browser": "firefox"}},
    )

    seen = []

    def fake_download(case, url, progress_hook=None, *, index=None, title=None, cookies=None):
        seen.append(cookies)
        return {"multi": False, "duplicate": False, "item": {"path": "media/x"}, "entity": {}}

    monkeypatch.setattr(media_engine, "download_url", fake_download)

    for use_cookies, expected in ((False, None), (True, {"browser": "firefox"})):
        job_id = client.post(
            f"/api/cases/{cid}/media/download",
            json={"url": "https://x.test/1", "use_cookies": use_cookies},
        ).json()["job_id"]
        for _ in range(100):
            job = client.get(f"/api/jobs/{job_id}").json()
            if job["status"] != "running":
                break
            time.sleep(0.05)
        assert job["status"] == "done"

    assert seen == [None, {"browser": "firefox"}]


def test_concurrent_sidecar_merges_do_not_drop_each_other(client, monkeypatch):
    """Two background writers touching one sidecar keep both fields: the merge is
    a read-modify-write under the case lock, not a last-writer-wins overwrite.

    The real worker is off: this is about the lock, not about when enrichment
    happens to land.
    """
    import threading

    from azimut.engine import media as media_engine
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    cid = client.post("/api/cases", json={"name": "Merge"}).json()["id"]
    rel = _upload(client, cid, "shot.png", _png_bytes()).json()["item"]["path"]
    case = Case.open(cid)

    start = threading.Barrier(2)

    def write(patch):
        start.wait(timeout=5)
        for _ in range(20):
            media_engine.merge_item(case, rel, patch)

    threads = [
        threading.Thread(target=write, args=({"thumbnail": "media/.thumbs/x.jpg"},)),
        threading.Thread(target=write, args=({"dhash": "ff00ff00ff00ff00"},)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    item = media_engine.read_item(case, rel)
    assert item["thumbnail"] == "media/.thumbs/x.jpg"
    assert item["dhash"] == "ff00ff00ff00ff00"


def test_naming_an_item_survives_the_enrichment_of_the_same_sidecar(client, monkeypatch):
    """The Save gate names an item just after filing it, while the enrichment job
    that filing queued is writing the file's own facts to the same sidecar. Both
    writes have to survive: the regression this guards dropped the typed name.
    """
    import threading

    from azimut.engine import media as media_engine
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    cid = client.post("/api/cases", json={"name": "Naming"}).json()["id"]
    rel = _upload(client, cid, "shot.png", _png_bytes()).json()["item"]["path"]
    case = Case.open(cid)

    start = threading.Barrier(2)

    def name_it():
        start.wait(timeout=5)
        for _ in range(20):
            media_engine.update_media(case, rel, {"title": "Yard panorama"})

    def enrich_it():
        start.wait(timeout=5)
        for _ in range(20):
            media_engine.merge_item(case, rel, {"dhash": "ff00ff00ff00ff00"})

    threads = [threading.Thread(target=name_it), threading.Thread(target=enrich_it)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    item = media_engine.read_item(case, rel)
    assert item["title"] == "Yard panorama"
    assert item["dhash"] == "ff00ff00ff00ff00"


def test_media_page_filters_and_counts_the_files_that_state_a_position(client):
    """The GPS facet is the browse-time half of import enrichment: a case of four
    hundred files, and the question is which ones told us where they were taken.
    A video's container tags count exactly like an image's EXIF — both land on the
    same sidecar field."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Positions"}).json()["id"]
    case = Case.open(cid)
    photo = _upload(client, cid, "photo.png", _png_bytes(color=(9, 0, 0))).json()["item"]
    clip = _upload(client, cid, "clip.png", _png_bytes(color=(10, 0, 0))).json()["item"]
    _upload(client, cid, "plain.png", _png_bytes(color=(11, 0, 0)))

    media_engine.merge_item(case, photo["path"], {"gps": {"lat": 48.8583, "lon": 2.2945}})
    # a video states its position in the container tags, not in EXIF
    media_engine.merge_item(
        case, clip["path"], {"kind": "video", "gps": {"lat": -33.86, "lon": 151.21}}
    )

    everything = client.get(f"/api/cases/{cid}/media/page").json()
    assert everything["total"] == 3
    assert everything["facets"]["gps_count"] == 2

    located = client.get(f"/api/cases/{cid}/media/page", params={"gps": "true"}).json()
    assert located["total"] == 2
    assert {item["path"] for item in located["items"]} == {photo["path"], clip["path"]}
    # the type chooser keeps counting inside the GPS filter, so its numbers say
    # what clicking one would actually give
    assert located["facets"]["category_counts"]["video"] == 1
    assert located["facets"]["category_counts"]["image"] == 1

    # ...and the GPS count follows the selected category the same way
    videos = client.get(
        f"/api/cases/{cid}/media/page", params={"gps": "true", "category": "video"}
    ).json()
    assert videos["total"] == 1
    assert videos["facets"]["gps_count"] == 1


def test_media_page_ignores_a_half_written_position(client):
    """Enrichment never writes a partial point, but a hand-edited sidecar can hold
    one. A row the map could not place must not be offered as locatable."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Half position"}).json()["id"]
    case = Case.open(cid)
    item = _upload(client, cid, "odd.png", _png_bytes(color=(12, 0, 0))).json()["item"]

    for broken in ({"lat": 48.0}, {"lat": 48.0, "lon": None}, {"lat": "north", "lon": "east"}):
        media_engine.merge_item(case, item["path"], {"gps": broken})
        page = client.get(f"/api/cases/{cid}/media/page").json()
        assert page["facets"]["gps_count"] == 0, broken


def test_the_browse_index_leaves_the_metadata_dumps_to_the_per_item_read(client):
    """Enrichment's full EXIF/video dumps are hundreds of rows per file. The
    listings are read 200 at a time (and whole, by the pickers), so a fat field on
    every row would multiply every one of those responses. They live in the
    sidecar and reach the UI one file at a time."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Fat metadata"}).json()["id"]
    case = Case.open(cid)
    item = _upload(client, cid, "shot.png", _png_bytes()).json()["item"]
    exif = {f"Tag{n:03d}": "v" * 64 for n in range(120)}
    media_engine.merge_item(case, item["path"], {"exif": exif, "gps": {"lat": 1.0, "lon": 2.0}})

    page = client.get(f"/api/cases/{cid}/media/page").json()
    listed = client.get(f"/api/cases/{cid}/media").json()
    assert "exif" not in page["items"][0]
    assert "exif" not in listed[0]
    # the parsed facts are small and stay indexed: the grid's pin and the GPS
    # filter both read them off the page
    assert page["items"][0]["gps"] == {"lat": 1.0, "lon": 2.0}
    assert page["facets"]["gps_count"] == 1

    one = client.get(f"/api/cases/{cid}/media/item", params={"path": item["path"]}).json()
    assert one["exif"] == exif
    assert one["path"] == item["path"]
    # the states the UI polls come along, so one read serves the whole panel
    assert one["thumb_state"] == "ready"
    assert one["entity_id"] == graph_read.entities(cid)[0]["id"]


def test_the_per_item_read_refuses_a_path_outside_the_case(client):
    cid = client.post("/api/cases", json={"name": "Traversal"}).json()["id"]

    assert client.get(f"/api/cases/{cid}/media/item", params={"path": "../../etc/passwd"}).status_code == 400
    assert client.get(f"/api/cases/{cid}/media/item", params={"path": "media/gone.png"}).status_code == 404


def test_enrich_counts_the_jobs_the_queue_took(client):
    """Naming a file whose kind carries no enrichment queues nothing, and the
    toast must not announce work that will never run."""
    from azimut.engine import workqueue

    cid = client.post("/api/cases", json={"name": "Enrich count"}).json()["id"]
    image = _upload(client, cid, "shot.png", _png_bytes()).json()["item"]
    audio = client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": ("note.mp3", io.BytesIO(b"ID3\x04\x00\x00\x00\x00\x00\x00"), "audio/mpeg")},
    ).json()["item"]

    assert audio["kind"] not in ("image", "video")
    assert client.post(
        f"/api/cases/{cid}/media/enrich", json={"path": audio["path"]}
    ).json() == {"queued": 0}
    assert client.post(
        f"/api/cases/{cid}/media/enrich", json={"path": image["path"]}
    ).json() == {"queued": 1}
    workqueue.wait_until_idle()
