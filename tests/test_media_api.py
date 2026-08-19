"""Media Library: upload, dedupe, listing, file serving, deletion."""

import io
import json
import sys
import threading

import graph_read
import pytest
import time

from jobwait import job_result, wait_for_job
from PIL import Image

from azimut.engine.media import safe_filename


def _png_bytes(color=(200, 30, 30), size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def _upload(client, cid, name, data, source_url=None):
    return client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(data), "image/png")},
        **({"data": {"source_url": source_url}} if source_url is not None else {}),
    )


def test_safe_filename_sidesteps_the_windows_device_names():
    """A name reserved by Windows cannot be created there, extension or not.

    Nothing stops an analyst titling a frame "AUX", and the file would land fine
    on Linux and macOS. The case folder is meant to be copied between the three,
    so the name is defused here rather than at whichever platform breaks.
    """
    assert safe_filename("AUX.png") == "_AUX.png"
    assert safe_filename("con.mp4") == "_con.mp4"
    assert safe_filename("COM1.roof.png") == "_COM1.roof.png"
    # only the exact device names, not anything starting with one
    assert safe_filename("console.png") == "console.png"
    assert safe_filename("aux room.png") == "aux room.png"


def test_upload_and_list(client):
    cid = client.post("/api/cases", json={"name": "Media"}).json()["id"]

    res = _upload(client, cid, "frame one.png", _png_bytes()).json()
    assert res["duplicate"] is False
    item = res["item"]
    assert item["kind"] == "image"
    assert item["title"] == "frame one"
    assert item["filename"] == "frame one.png"
    assert len(item["sha256"]) == 64
    assert item["thumbnail"]  # Pillow thumbnail for images always works

    listed = client.get(f"/api/cases/{cid}/media").json()
    assert [m["filename"] for m in listed] == ["frame one.png"]

    # media entity was filed with provenance
    entities = graph_read.entities(cid)
    assert entities[0]["type"] == "media"
    assert entities[0]["label"] == "frame one"
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
    assert (
        client.get(f"/api/cases/{cid}/media/page", params={"q": "bridge river"}).json()["total"]
        == 1
    )
    assert (
        client.get(f"/api/cases/{cid}/media/page", params={"q": "bridge harbour"}).json()["total"]
        == 0
    )


def test_media_page_kind_and_folder_filters(client):
    cid = client.post("/api/cases", json={"name": "Filt"}).json()["id"]
    a = _upload(client, cid, "a.png", _png_bytes(color=(3, 0, 0))).json()["item"]
    _upload(client, cid, "b.png", _png_bytes(color=(4, 0, 0)))
    _set(client, cid, a["path"], folder="kyiv")

    assert client.get(f"/api/cases/{cid}/media/page", params={"kind": "image"}).json()["total"] == 2
    assert (
        client.get(f"/api/cases/{cid}/media/page", params={"folder": "kyiv"}).json()["total"] == 1
    )


def test_media_page_sort_name_and_size(client):
    cid = client.post("/api/cases", json={"name": "Sort"}).json()["id"]
    small = _upload(client, cid, "s.png", _png_bytes(color=(5, 0, 0), size=(16, 16))).json()["item"]
    big = _upload(client, cid, "b.png", _png_bytes(color=(6, 0, 0), size=(256, 256))).json()["item"]
    small = _set(client, cid, small["path"], title="Zebra")
    big = _set(client, cid, big["path"], title="Alpha")

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

    maps = client.get(f"/api/cases/{cid}/media/page", params={"category": "satellite"}).json()
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


# -- what the case collected, apart from what it made ------------------------
#
# A geolocation case ends up with far more extracted frames than collected files,
# and the chips cannot answer "what did we actually collect": they are
# single-select and each says "show me only X". This is the other axis, so it is a
# switch, and it scopes the counts as well as the page — a chooser still
# advertising rows the switch is hiding is a chooser that lies.


def _made_here(client, cid, source_path, *, name=None):
    """One derivative through the real Inspect route.

    The source colours matter: brightening a near-black pixel rounds back to
    itself, the bytes match, and dedupe hands back the *upload* — which is correct
    behaviour and a fixture that would test nothing.
    """
    res = client.post(
        f"/api/cases/{cid}/inspect/save-frames",
        json={
            "items": [
                {
                    "path": source_path,
                    "ops": [{"op": "brightness", "params": {"amount": 1.4}}],
                    **({"label": name} if name else {}),
                }
            ]
        },
    )
    assert res.status_code == 200, res.text
    saved = res.json()["saved"][0]
    assert saved["duplicate"] is False, "fixture produced bytes the case already held"
    return saved["item"]


def test_media_page_can_leave_out_what_the_case_made(client):
    cid = client.post("/api/cases", json={"name": "Collected"}).json()["id"]
    original = _upload(client, cid, "orig.png", _png_bytes()).json()["item"]
    made = _made_here(client, cid, original["path"])

    everything = client.get(f"/api/cases/{cid}/media/page").json()
    assert {item["path"] for item in everything["items"]} == {original["path"], made["path"]}
    # The number is reported whether the switch is on or off: off, it is what
    # turning it on would hide.
    assert everything["facets"]["made_here_count"] == 1

    collected = client.get(
        f"/api/cases/{cid}/media/page", params={"collected_only": "true"}
    ).json()
    assert [item["path"] for item in collected["items"]] == [original["path"]]
    assert collected["total"] == 1
    assert collected["facets"]["made_here_count"] == 1


def test_leaving_them_out_scopes_the_counts_too(client):
    """Otherwise the Collages chip offers thirty rows and clicking it shows none."""
    cid = client.post("/api/cases", json={"name": "Scoped counts"}).json()["id"]
    original = _upload(client, cid, "orig.png", _png_bytes()).json()["item"]
    _made_here(client, cid, original["path"])

    page = client.get(f"/api/cases/{cid}/media/page", params={"collected_only": "true"}).json()
    assert page["facets"]["category_counts"]["image"] == 1
    assert page["facets"]["category_counts"]["upload"] == 1
    assert page["facets"]["kind_counts"]["image"] == 1


def test_leaving_them_out_does_not_touch_collected_material(client):
    """A satellite capture is original imagery brought into the case, not something
    composed out of what the case already holds. Same for a download and an import."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Untouched"}).json()["id"]
    upload = _upload(client, cid, "orig.png", _png_bytes()).json()["item"]
    capture = media_engine.import_image(
        Case.open(cid),
        Image.new("RGB", (32, 24)),
        "map.png",
        {"type": "satellite"},
        entity_type="capture",
        dedupe=False,
    )["item"]

    page = client.get(f"/api/cases/{cid}/media/page", params={"collected_only": "true"}).json()
    assert {item["path"] for item in page["items"]} == {upload["path"], capture["path"]}
    assert page["facets"]["made_here_count"] == 0


def test_the_switch_reads_how_a_file_entered_not_everything_true_about_it(client):
    """Dedupe hands back the entity that is already there, and its row with it. Bytes
    that arrived as an upload stay on the collected side even once Inspect produces
    the same picture, because that is how they entered the case."""
    cid = client.post("/api/cases", json={"name": "Entered by"}).json()["id"]
    original = _upload(client, cid, "orig.png", _png_bytes()).json()["item"]
    made = _made_here(client, cid, original["path"])
    same_bytes = client.get(f"/files/{cid}/{made['path']}").content

    again = _upload(client, cid, "handed-over.png", same_bytes).json()
    assert again["duplicate"] is True

    page = client.get(f"/api/cases/{cid}/media/page", params={"collected_only": "true"}).json()
    # Still one made-here row, not two, and the import did not resurrect it.
    assert [item["path"] for item in page["items"]] == [original["path"]]
    assert page["facets"]["made_here_count"] == 1


def test_leaving_them_out_pages_and_counts_together(client):
    """The page and the total come from the same SQL, so a client-side filter would
    have produced a right-looking first page and a wrong count under it."""
    cid = client.post("/api/cases", json={"name": "Paged"}).json()["id"]
    originals = [
        _upload(client, cid, f"orig{i}.png", _png_bytes(color=(40 + i * 40, 20, 20))).json()["item"]
        for i in range(3)
    ]
    for original in originals:
        _made_here(client, cid, original["path"])

    first = client.get(
        f"/api/cases/{cid}/media/page", params={"collected_only": "true", "limit": 2}
    ).json()
    assert first["total"] == 3
    assert len(first["items"]) == 2
    assert first["next_cursor"] == "2"

    rest = client.get(
        f"/api/cases/{cid}/media/page",
        params={"collected_only": "true", "limit": 2, "cursor": first["next_cursor"]},
    ).json()
    assert len(rest["items"]) == 1
    assert rest["next_cursor"] is None
    seen = {item["path"] for item in first["items"] + rest["items"]}
    assert seen == {item["path"] for item in originals}


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
    from azimut import layout
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Title"}).json()["id"]
    item = _upload(client, cid, "img.png", _png_bytes()).json()["item"]

    updated = client.patch(
        f"/api/cases/{cid}/media",
        json={"path": item["path"], "title": "Strike video — Kharkiv"},
    ).json()
    # the media's own title lives on the sidecar (shown in the Media tab)
    assert updated["title"] == "Strike video — Kharkiv"
    assert updated["filename"] == "Strike video — Kharkiv.png"
    assert updated["path"] == "media/Strike video — Kharkiv.png"
    case = Case.open(cid)
    assert not case.resolve_inside(item["path"]).exists()
    assert not case.resolve_inside(layout.sidecar_rel("img.png")).exists()
    assert case.resolve_inside(updated["path"]).is_file()
    assert case.resolve_inside(layout.sidecar_rel(updated["filename"])).is_file()

    # the entity label mirrors the title so the case sidebar stays in sync
    entities = graph_read.entities(cid)
    assert entities[0]["label"] == "Strike video — Kharkiv"

    # An empty edit keeps the current filename stem: media no longer have a
    # second, nullable display name that can drift from the file.
    cleared = client.patch(
        f"/api/cases/{cid}/media", json={"path": updated["path"], "title": ""}
    ).json()
    assert cleared["title"] == "Strike video — Kharkiv"
    assert cleared["filename"] == "Strike video — Kharkiv.png"
    assert cleared["path"] == "media/Strike video — Kharkiv.png"

    # The graph label is the same stem too.
    entities = graph_read.entities(cid)
    assert entities[0]["label"] == "Strike video — Kharkiv"


def test_media_rename_rewrites_exact_references_everywhere(client):
    from azimut import layout
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Rename references"}).json()["id"]
    source = _upload(client, cid, "source.png", _png_bytes()).json()["item"]
    derived = _upload(client, cid, "derived.png", _png_bytes(color=(20, 40, 60))).json()["item"]
    case = Case.open(cid)
    old = source["path"]
    sentence = f"Analyst prose mentions {old} but is not a path field."
    media_engine.merge_item(
        case,
        derived["path"],
        {
            "source": {
                "type": "inspect",
                "from": old,
                "sources": [old],
                "description": sentence,
            }
        },
    )
    reference = case.add_entity(
        "bookmark",
        "Reference",
        {"path": old, "nested": [old], "notes": sentence},
        by="user",
    )
    job = case.enqueue_job(
        "thumbnail",
        key=old,
        payload={"path": old, "nested": [old], "notes": sentence},
    )
    records = {
        layout.proof_spec_rel("Ref proof"): {"panels": [{"src": old}], "notes": sentence},
        layout.session_rel("Ref inspect"): {"source": {"path": old}, "notes": sentence},
        layout.draft_rel("Ref post"): {
            "state": {"mediaPath": old, "mediaPaths": [old]},
            "notes": sentence,
        },
        layout.grid_rel("ref-search"): {"source": old, "notes": sentence},
    }
    for rel, data in records.items():
        path = case.resolve_inside(rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")

    renamed = media_engine.update_media(case, old, {"title": "Canonical source"})
    new = renamed["path"]

    dependent = media_engine.read_item(case, derived["path"])
    assert dependent["source"]["from"] == new
    assert dependent["source"]["sources"] == [new]
    assert dependent["source"]["description"] == sentence
    entity = case.get_entity(reference["id"])
    assert entity["attrs"]["path"] == new
    assert entity["attrs"]["nested"] == [new]
    assert entity["attrs"]["notes"] == sentence
    queued = case.get_job(job["id"])
    assert queued["key"] == new
    assert queued["payload"]["path"] == new
    assert queued["payload"]["nested"] == [new]
    assert queued["payload"]["notes"] == sentence
    proof = json.loads(
        case.resolve_inside(layout.proof_spec_rel("Ref proof")).read_text(encoding="utf-8")
    )
    inspect = json.loads(
        case.resolve_inside(layout.session_rel("Ref inspect")).read_text(encoding="utf-8")
    )
    post = json.loads(case.resolve_inside(layout.draft_rel("Ref post")).read_text(encoding="utf-8"))
    search = json.loads(
        case.resolve_inside(layout.grid_rel("ref-search")).read_text(encoding="utf-8")
    )
    assert proof["panels"][0]["src"] == new
    assert inspect["source"]["path"] == new
    assert post["state"]["mediaPath"] == new
    assert post["state"]["mediaPaths"] == [new]
    assert search["source"] == new
    assert {proof["notes"], inspect["notes"], post["notes"], search["notes"]} == {sentence}


def test_media_rename_recovers_after_files_moved_before_database_update(client, monkeypatch):
    from azimut import layout
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Rename recovery"}).json()["id"]
    item = _upload(client, cid, "before.png", _png_bytes()).json()["item"]
    case = Case.open(cid)
    real_replace = Case.replace_path_references

    def interrupt(_case, _old, _new):
        raise RuntimeError("simulated interruption")

    monkeypatch.setattr(Case, "replace_path_references", interrupt)
    with pytest.raises(RuntimeError, match="simulated interruption"):
        media_engine.rename_media(case, item["path"], "After")

    journal = case.resolve_inside(f"{layout.DATA_DIR}/rename.json")
    assert journal.is_file()
    assert case.resolve_inside("media/After.png").is_file()
    assert not case.resolve_inside(item["path"]).exists()

    monkeypatch.setattr(Case, "replace_path_references", real_replace)
    media_engine.recover_media_rename(case)

    recovered = media_engine.read_item(case, "media/After.png")
    assert recovered["title"] == "After"
    assert case.find_entity(attr="path", value="media/After.png")["label"] == "After"
    assert not journal.exists()


def test_media_rename_uses_portable_case_insensitive_collisions(client):
    cid = client.post("/api/cases", json={"name": "Portable names"}).json()["id"]
    _upload(client, cid, "Clip.png", _png_bytes()).json()["item"]
    other = _upload(client, cid, "other.png", _png_bytes(color=(90, 80, 70))).json()["item"]

    renamed = _set(client, cid, other["path"], title="clip")

    assert renamed["title"] == "clip-1"
    assert renamed["filename"] == "clip-1.png"


def test_update_media_clear_notes(client):
    cid = client.post("/api/cases", json={"name": "Clear"}).json()["id"]
    item = _upload(client, cid, "img.png", _png_bytes()).json()["item"]

    client.patch(f"/api/cases/{cid}/media", json={"path": item["path"], "notes": "initial"})
    updated = client.patch(
        f"/api/cases/{cid}/media", json={"path": item["path"], "notes": ""}
    ).json()
    assert "notes" not in updated


def test_import_states_where_the_file_came_from(client):
    """A file fetched by hand elsewhere carries no address of its own, and the
    import is the first chance to state one.

    Stated, never fetched: the source type stays ``upload``, so the facet still
    reads how the file arrived and a reader can tell this address from the one a
    download really pulled from.
    """
    cid = client.post("/api/cases", json={"name": "Stated"}).json()["id"]
    item = _upload(
        client, cid, "shot.png", _png_bytes(), source_url="https://t.me/channel/42"
    ).json()["item"]

    assert item["source"] == {
        "type": "upload",
        "original_name": "shot.png",
        "url": "https://t.me/channel/42",
    }
    entity = graph_read.entities(cid)[0]
    assert entity["attrs"]["source_url"] == "https://t.me/channel/42"

    # searchable like a download's address, through the same indexed field
    hit = client.get(f"/api/cases/{cid}/media/page", params={"q": "t.me/channel"}).json()
    assert [i["path"] for i in hit["items"]] == [item["path"]]

    # and still an import, not a download
    assert (
        client.get(f"/api/cases/{cid}/media/page", params={"category": "upload"}).json()["total"]
        == 1
    )


def test_a_stated_source_must_be_a_link(client):
    cid = client.post("/api/cases", json={"name": "Not a link"}).json()["id"]
    res = _upload(client, cid, "shot.png", _png_bytes(), source_url="a friend sent it")
    assert res.status_code == 422
    assert client.get(f"/api/cases/{cid}/media").json() == []


def test_a_source_can_be_stated_after_the_import(client):
    """The origin is often remembered after the files have landed — and for a batch
    dropped in one go, stated once for all of them."""
    cid = client.post("/api/cases", json={"name": "Later"}).json()["id"]
    item = _upload(client, cid, "shot.png", _png_bytes()).json()["item"]

    updated = _set(client, cid, item["path"], source_url="https://example.org/post/7")
    assert updated["source"]["url"] == "https://example.org/post/7"
    assert updated["source"]["type"] == "upload"
    assert graph_read.entities(cid)[0]["attrs"]["source_url"] == "https://example.org/post/7"

    # and taken back, without disturbing the rest of what the sidecar records
    cleared = _set(client, cid, item["path"], source_url="")
    assert "url" not in cleared["source"]
    assert cleared["source"]["original_name"] == "shot.png"
    assert graph_read.entities(cid)[0]["attrs"]["source_url"] == ""

    # typed wrong, refused at the edge like every other surface that takes one
    assert (
        client.patch(
            f"/api/cases/{cid}/media", json={"path": item["path"], "source_url": "ftp://host/x"}
        ).status_code
        == 422
    )


def test_only_a_file_brought_in_by_hand_can_be_given_a_source(client):
    """What a tool recorded about where bytes came from is not something a later
    edit gets to write over: a case that cannot tell a fetched address from a
    stated one is holding neither."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Fetched"}).json()["id"]
    filed = media_engine.import_image(
        Case.open(cid),
        Image.new("RGB", (32, 24), (10, 10, 90)),
        "post.png",
        {
            "type": "download",
            "url": "https://x.com/user/status/1",
            "webpage_url": "https://x.com/user/status/1",
        },
    )

    res = client.patch(
        f"/api/cases/{cid}/media",
        json={"path": filed["item"]["path"], "source_url": "https://example.org/other"},
    )
    assert res.status_code == 400
    assert "brought in by hand" in res.json()["detail"]

    listed = client.get(f"/api/cases/{cid}/media").json()[0]
    assert listed["source"]["url"] == "https://x.com/user/status/1"


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
            "thumbnails": [
                {"url": "https://x.test/p2-small.jpg"},
                {"url": "https://x.test/p2.jpg"},
            ],
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

    result = job_result(client, job_id)
    assert result["multi"] is True
    assert [i["title"] for i in result["items"]] == ["a", "b"]


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


def test_telegram_embed_media_parses_photos(monkeypatch):
    """The Telegram embed reader extracts photo CDN URLs and reports no size
    wall, while a non-Telegram URL makes no network call at all."""
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

    photos, too_large = media_engine._telegram_embed_media(
        "https://t.me/exilenova_plus/24988"
    )
    assert [p["url"] for p in photos] == [
        "https://cdn1.telesco.pe/file/AAA",
        "https://cdn1.telesco.pe/file/BBB",
    ]
    assert too_large is False

    def boom(*a, **kw):
        raise AssertionError("must not be called for a non-Telegram URL")

    monkeypatch.setattr(requests, "get", boom)
    assert media_engine._telegram_embed_media("https://x.com/u/status/1") == ([], False)


def test_telegram_embed_media_detects_video_too_large(monkeypatch):
    """Telegram replaces the video URL with this wall for large app-only
    videos; preserve that distinction instead of treating it as a broken URL."""
    from azimut.engine import media as media_engine

    html = """
    <a class="tgme_widget_message_video_player not_supported js-message_video_player">
      <div class="message_media_not_supported_label">Media is too big</div>
      <span class="message_media_view_in_telegram">VIEW IN TELEGRAM</span>
    </a>
    """

    class FakeResp:
        text = html

        def raise_for_status(self):
            pass

    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **kw: FakeResp())

    assert media_engine._telegram_embed_media(
        "https://t.me/warhistoryalconafter/104333"
    ) == ([], True)


def test_download_reports_large_telegram_video_without_fallback(client, monkeypatch):
    """An app-only Telegram video is an actionable result, not the generic
    `no extractor recognizes this link` error from the gallery-dl fallback."""
    import gallery_dl.extractor as gdl_extractor

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "TelegramLarge"}).json()["id"]
    case = Case.open(cid)
    url = "https://t.me/warhistoryalconafter/104333"

    _install_fake_ydl(monkeypatch, lambda ydl, target, download: None)
    monkeypatch.setattr(media_engine, "_telegram_embed_media", lambda target: ([], True))
    monkeypatch.setattr(
        gdl_extractor,
        "find",
        lambda target: (_ for _ in ()).throw(AssertionError("gallery-dl must not run")),
    )

    assert media_engine.download_url(case, url) == {"telegram_only": True}
    assert case.list_entities() == []


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
        "_telegram_embed_media",
        lambda url: ([{"url": "https://cdn/a.jpg"}, {"url": "https://cdn/b.jpg"}], False),
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

    entries = [
        {"id": "v1", "title": "clip one", "ext": "mp4"},
        {"id": "v2", "title": "clip two", "ext": "mp4"},
    ]
    _install_fake_ydl(
        monkeypatch, lambda ydl, url, download: {"_type": "playlist", "entries": entries}
    )
    monkeypatch.setattr(
        media_engine,
        "_telegram_embed_media",
        lambda url: ([{"url": "https://cdn/a.jpg"}, {"url": "https://cdn/b.jpg"}], False),
    )

    captured = {}

    def fake_register(case_, post_url, photo, *, title=None, stage=None):
        captured["photo"] = photo
        captured["stage"] = stage
        return {"multi": False, "item": {"filename": "a.jpg"}}

    monkeypatch.setattr(media_engine, "_register_telegram_photo", fake_register)

    result = media_engine.download_url(case, "https://t.me/exilenova_plus/24988", index=3)
    assert captured["photo"]["url"] == "https://cdn/a.jpg"
    assert result["item"]["filename"] == "a.jpg"
    # No staging directory asked for, so this path files into the library as before
    assert captured["stage"] is None


def test_download_picks_yt_dlp_video_from_mixed_post(client, monkeypatch):
    """Picking index 2 out of the same merged post must still resolve to
    yt-dlp's second video entry, not a photo."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "TelegramPickVideo"}).json()["id"]
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
        "_telegram_embed_media",
        lambda url: ([{"url": "https://cdn/a.jpg"}, {"url": "https://cdn/b.jpg"}], False),
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
        monkeypatch,
        extract_info,
        content_fn=lambda info: _png_bytes(color=(int(info["id"][4:]), 0, 0)),
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

    job = wait_for_job(client, job_id)
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
    """A cookies.txt source hands yt-dlp its protected absolute path."""
    import os

    from azimut import config
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "CookieFile"}).json()["id"]
    case = Case.open(cid)

    def extract_info(ydl, url, download):
        assert os.path.isabs(ydl.opts["cookiefile"])
        assert ydl.opts["cookiefile"] == str(config.cookies_file_path())
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
        job_result(client, job_id)

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

    enrichment_started = threading.Event()
    let_enrichment_finish = threading.Event()
    real_write = media_engine._write_sidecar
    blocked_once = False

    def block_enrichment_write(path, data):
        nonlocal blocked_once
        if data.get("dhash") and not blocked_once:
            blocked_once = True
            enrichment_started.set()
            assert let_enrichment_finish.wait(timeout=5)
        real_write(path, data)

    monkeypatch.setattr(media_engine, "_write_sidecar", block_enrichment_write)
    enrich_thread = threading.Thread(
        target=media_engine.merge_item,
        args=(case, rel, {"dhash": "ff00ff00ff00ff00"}),
    )
    enrich_thread.start()
    assert enrichment_started.wait(timeout=5)

    renamed = {}

    def name_it():
        renamed.update(media_engine.update_media(case, rel, {"title": "Yard panorama"}))

    name_thread = threading.Thread(target=name_it)
    name_thread.start()
    let_enrichment_finish.set()
    enrich_thread.join(timeout=10)
    name_thread.join(timeout=10)
    assert not enrich_thread.is_alive()
    assert not name_thread.is_alive()

    item = media_engine.read_item(case, renamed["path"])
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

    assert (
        client.get(f"/api/cases/{cid}/media/item", params={"path": "../../etc/passwd"}).status_code
        == 400
    )
    assert (
        client.get(f"/api/cases/{cid}/media/item", params={"path": "media/gone.png"}).status_code
        == 404
    )


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
    assert client.post(f"/api/cases/{cid}/media/enrich", json={"path": audio["path"]}).json() == {
        "queued": 0
    }
    assert client.post(f"/api/cases/{cid}/media/enrich", json={"path": image["path"]}).json() == {
        "queued": 1
    }
    workqueue.wait_until_idle()


# ── clipboard paste ──────────────────────────────────────────────────────────
# A screenshot taken with the system tool exists only in the clipboard, so there
# is no file to drop and no name or origin to read off one. That is the whole
# reason this route is not `upload`: the title and the source are stated in the
# dialog or not at all, and the provenance must not claim a file was chosen.


def _paste(client, cid, data=None, name="image.png", **fields):
    return client.post(
        f"/api/cases/{cid}/media/paste",
        files={"file": (name, io.BytesIO(_png_bytes() if data is None else data), "image/png")},
        data=fields,
    )


def test_paste_files_the_image_under_its_typed_title_and_source(client):
    cid = client.post("/api/cases", json={"name": "Paste"}).json()["id"]

    body = _paste(
        client, cid, title="Front gate", source_url="https://example.com/page"
    ).json()

    assert body["duplicate"] is False
    item = body["item"]
    # the title names the file, because "image.png" is what every clipboard calls it
    assert item["filename"] == "Front gate.png"
    assert item["title"] == "Front gate"
    assert item["kind"] == "image"
    # recorded as a paste, never as an upload: a screenshot with no stated source
    # must not read like a file somebody picked off a disk
    assert item["source"]["type"] == "clipboard"
    assert item["source"]["url"] == "https://example.com/page"
    assert item["source"]["original_name"] == "image.png"

    entity = graph_read.entities(cid)[0]
    assert entity["type"] == "media"
    assert entity["label"] == "Front gate"
    assert entity["provenance"]["by"] == "paste"
    assert entity["attrs"]["source_url"] == "https://example.com/page"
    assert client.get(f"/files/{cid}/{item['path']}").status_code == 200


def test_paste_without_a_title_is_stamped_rather_than_called_image(client):
    cid = client.post("/api/cases", json={"name": "Unnamed paste"}).json()["id"]

    item = _paste(client, cid).json()["item"]

    assert item["filename"].startswith("paste-")
    assert item["filename"].endswith(".png")
    # nothing was stated, so nothing is claimed
    assert "url" not in item["source"]


def test_pasting_the_same_crop_twice_is_one_file(client):
    """Deduped like any import: the bytes are the identity, whatever gesture
    brought them in, and a second Ctrl+V is usually a doubt about the first."""
    cid = client.post("/api/cases", json={"name": "Twice"}).json()["id"]
    pixels = _png_bytes(color=(3, 9, 27))

    first = _paste(client, cid, pixels, title="Gate").json()
    again = _paste(client, cid, pixels, title="Gate again").json()

    assert first["duplicate"] is False and again["duplicate"] is True
    assert len(client.get(f"/api/cases/{cid}/media").json()) == 1


def test_a_paste_and_a_drop_count_as_one_facet(client):
    """Both are material the analyst brought in by hand, which is what the
    Imports filter asks. They stay two source types because only one of them can
    say where it came from."""
    cid = client.post("/api/cases", json={"name": "Facet"}).json()["id"]
    _upload(client, cid, "dropped.png", _png_bytes(color=(1, 2, 3)))
    _paste(client, cid, _png_bytes(color=(4, 5, 6)), title="Pasted")

    facets = client.get(f"/api/cases/{cid}/media/page").json()["facets"]
    assert facets["category_counts"]["upload"] == 2

    filtered = client.get(
        f"/api/cases/{cid}/media/page", params={"category": "upload"}
    ).json()
    assert len(filtered["items"]) == 2


def test_paste_refuses_anything_that_is_not_a_readable_image(client):
    """The clipboard is not a file picker: a case takes a pasted screenshot, not
    an arbitrary payload."""
    cid = client.post("/api/cases", json={"name": "Not an image"}).json()["id"]

    refused = _paste(client, cid, b"this is not a png", name="clip.txt")

    assert refused.status_code == 422
    assert "readable image" in refused.json()["detail"]
    assert client.get(f"/api/cases/{cid}/media").json() == []


def test_paste_refuses_a_source_that_is_not_an_http_url(client):
    """The source is provenance. A `javascript:` or `data:` string is not one,
    and it would be read back as a link in the details panel."""
    cid = client.post("/api/cases", json={"name": "Bad source"}).json()["id"]

    refused = _paste(client, cid, title="Gate", source_url="javascript:alert(1)")

    assert refused.status_code == 422
    assert "http(s)" in refused.json()["detail"]
    assert client.get(f"/api/cases/{cid}/media").json() == []


def test_paste_is_bounded_at_the_edge_like_every_other_swallowed_image(client, monkeypatch):
    """Refusing early is what keeps a mistaken Ctrl+V from writing an enormous
    temporary nobody asked for."""
    from azimut.api import media as media_api
    from azimut.workspace import Case

    monkeypatch.setattr(media_api, "MAX_IMAGE_BYTES", 100)
    cid = client.post("/api/cases", json={"name": "Bounded paste"}).json()["id"]

    refused = _paste(client, cid, title="Huge")

    assert refused.status_code == 413
    assert "under" in refused.json()["detail"]
    assert list(Case.open(cid).media_dir.glob("*.png")) == []


def test_cancelling_a_job_is_a_flag_and_never_a_kill(client):
    """A thread cannot be interrupted from outside, so a cancel is a question the work
    answers where stopping is safe. What the route owes the caller is whether anybody
    heard — and a job already over heard nothing, which is not an error about it."""
    from azimut import jobs

    finished = jobs.start("test", lambda set_progress: "done")
    for _ in range(100):
        if jobs.get(finished)["status"] != "running":
            break
        time.sleep(0.02)
    assert client.post(f"/api/jobs/{finished}/cancel").json() == {"stopped": False}

    held = threading.Event()
    running = jobs.start("test", lambda set_progress, stopping: held.wait(5), stoppable=True)
    assert client.post(f"/api/jobs/{running}/cancel").json() == {"stopped": True}
    assert jobs.cancelled(running) is True
    held.set()

    assert client.post("/api/jobs/nope/cancel").status_code == 404


def test_a_slot_that_needs_a_picture_is_not_handed_the_quoted_video(client, monkeypatch):
    """A post publishing a geolocation carries the picture *and* quotes the footage.

    yt-dlp reads a post for its video, so it answers with the clip and the published
    picture stays invisible — and the slot that receives it is the one place in the app
    that has nowhere to put a video. Saying so before the download is what lets the image
    extractor be tried at all, where today it is only reached when yt-dlp found nothing.
    """
    import gallery_dl.extractor as gdl_extractor

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "QuotedVideo"}).json()["id"]
    case = Case.open(cid)
    _install_fake_ydl(
        monkeypatch,
        lambda ydl, url, download=False: {
            "id": "v1", "title": "the quoted clip", "ext": "mp4", "extractor": "twitter",
        },
        # Distinct bytes from the picture below, or the library would dedupe the two and
        # the test would be reading the first download back twice.
        content_fn=lambda info: _png_bytes(color=(10, 90, 200)),
    )
    monkeypatch.setattr(
        gdl_extractor,
        "find",
        lambda url: _FakeGalleryExtractor(
            [("https://pbs.twimg.com/media/proof.jpg",
              {"filename": "proof", "extension": "jpg", "content": "the published proof"})]
        ),
    )

    # Asked for nothing in particular, the clip is a perfectly good answer.
    plain = media_engine.download_url(case, "https://x.com/u/status/1")
    assert plain["item"]["source"]["title"] == "the quoted clip"
    assert plain["item"]["source"]["downloader"] == "yt-dlp"

    # Asked for a picture, the same post answers with the picture instead.
    wanted = media_engine.download_url(case, "https://x.com/u/status/2", wants="image")
    assert wanted["item"]["source"]["downloader"] == "gallery-dl"
    assert wanted["item"]["title"] == "the published proof"


def test_a_tombstone_is_read_as_a_wall_so_the_cookies_can_be_offered(client, monkeypatch):
    """What a site says about content a guest cannot see is what it says about content
    that is gone, and X says both in the same words.

    Read as a plain failure, a login wall was unrecoverable: no ``needs_auth``, so no
    prompt, so no cookie source was ever stored — and every later retry went out
    cookie-less too, because the only thing that sets that source is the prompt.
    """
    import gallery_dl.extractor as gdl_extractor

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    class AbortExtraction(Exception):
        pass

    cid = client.post("/api/cases", json={"name": "Tombstone"}).json()["id"]
    case = Case.open(cid)
    _install_failing_ydl(monkeypatch, message="No video could be found in this tweet")
    monkeypatch.setattr(
        gdl_extractor, "find", lambda url: (_ for _ in ()).throw(AbortExtraction("Unavailable"))
    )

    assert media_engine.download_url(case, "https://x.com/u/status/1") == {
        "needs_auth": True,
        "platform": sys.platform,
    }

    # Refused *with* a session is a third answer, and it is the one worth saying out loud:
    # the platform's own wording is a tombstone nobody can act on, where "the session did
    # not get through" names the thing to fix.
    refused = media_engine.download_url(
        case, "https://x.com/u/status/1", cookies={"browser": "firefox"}
    )
    assert refused == {"needs_auth": True, "platform": sys.platform, "refused": True}


def test_a_session_given_once_is_not_asked_for_again(client, monkeypatch):
    """An answer given once should not be asked for again.

    The wall prompt is what *stores* a cookie source, and every road went out cookie-less,
    hit the wall and put the question back on screen — which for a hundred rows of a binder
    is a hundred questions with one answer. Public media still never touches the session:
    cookie-less first, then once, on a wall, with whatever the settings hold.
    """
    import gallery_dl.extractor as gdl_extractor

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Session"}).json()["id"]
    case = Case.open(cid)
    _install_failing_ydl(monkeypatch, message="No video could be found in this tweet")
    tried: list[str] = []

    def find(url):
        tried.append(url)
        raise RuntimeError("Unavailable")

    # With nothing configured, the wall stands and the prompt is what has to appear.
    monkeypatch.setattr(gdl_extractor, "find", find)
    assert media_engine.fetch_url(case, "https://x.com/u/status/1")["needs_auth"] is True
    assert len(tried) == 1, "no session to try, so one attempt"

    # With one configured, the same wall is answered rather than reported — and when the
    # session does not get past it either, the real error surfaces instead of the question
    # being asked a second time.
    client.put(
        "/api/settings/prefs",
        json={"download_cookies": {"source": "browser", "browser": "firefox"}},
    )
    tried.clear()
    answer = media_engine.fetch_url(case, "https://x.com/u/status/2")
    assert answer["needs_auth"] is True and answer["refused"] is True
    assert len(tried) == 2, "cookie-less first, then once with the stored session"

    # And a caller that named its own session is answered on its own attempt alone. A
    # cookie file rather than a browser, because a Chromium pick is answered by the
    # Windows guard before anything is tried and the assertion would be about that.
    tried.clear()
    assert media_engine.fetch_url(
        case, "https://x.com/u/status/3", cookies={"file": "cookies.txt"}
    )["refused"] is True
    assert len(tried) == 1


def test_a_link_that_only_says_unavailable_is_retried_with_the_session(client, monkeypatch):
    """The accepted cost of reading a tombstone as a wall, stated as a test.

    "Unavailable" is what X says about a post a guest cannot read *and* about one that was
    deleted, so a dead link gets the second attempt too, and that attempt carries the
    analyst's cookies to a host that never asked for them. Kept, because the alternative is
    a question in the middle of a hundred-row press and because the first attempt is always
    cookie-less — and written down here and in SPEC's security posture so it is a decision
    rather than a surprise.
    """
    import gallery_dl.extractor as gdl_extractor

    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": "Dead"}).json()["id"]
    case = Case.open(cid)
    _install_failing_ydl(monkeypatch, message="Unable to extract")
    sessions = []

    def find(_url):
        raise RuntimeError("Unavailable")

    monkeypatch.setattr(gdl_extractor, "find", find)
    real = media_engine.download_url

    def watched(case_, url, **asked):  # noqa: ANN001 — a spy over one call
        sessions.append(asked.get("cookies"))
        return real(case_, url, **asked)

    monkeypatch.setattr(media_engine, "download_url", watched)
    client.put(
        "/api/settings/prefs",
        json={"download_cookies": {"source": "browser", "browser": "firefox"}},
    )

    media_engine.fetch_url(case, "https://x.com/u/status/9")
    assert sessions[0] is None, "the first attempt is cookie-less, always"
    assert sessions[1] == {"browser": "firefox"}, "and the wall is answered with the session"
