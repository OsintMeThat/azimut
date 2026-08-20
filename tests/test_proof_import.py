"""Importing a geolocated post as a proof.

Three promises are what these tests hold to:

- **nothing enters the case until the preview is approved.** A cancelled or
  abandoned import leaves the case byte-for-byte as it was;
- **the graph it writes is the composer's,** not a second implementation of it:
  the same place dedup, the same verbs, the same derivation chain, and a proof
  that reopens, exports and travels like a hand-made one;
- **no post format is special.** The scan reads shapes, so a post that spells
  nothing out prefills nothing and the form is filled by hand.
"""

import io

from jobwait import job_result
from PIL import Image

from azimut import layout
from azimut.engine import geo
from azimut.engine import links as link_engine
from azimut.engine import media as media_engine
from azimut.engine import proofimport as import_engine

POST = """Hoyo de la Puerta, Miranda, Venezuela - 94V4+8XH

Point of view - Two helicopters were spotted heading East over Hoyo de la Puerta.

10.393313, -66.892504

Source:
https://instagram.com/reels/DTG728Xk"""


def make_case(client, name="Import"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def case_of(case_id):
    from azimut.api.cases import get_case

    return get_case(case_id)


def picture(colour=(30, 90, 140), size=(320, 200)):
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, "PNG")
    return buffer.getvalue()


def start(client, case_id):
    response = client.post(f"/api/cases/{case_id}/proof-imports")
    assert response.status_code == 200, response.text
    return response.json()["token"]


def attach(client, case_id, token, slot, content, filename, source_url=""):
    response = client.post(
        f"/api/cases/{case_id}/proof-imports/{token}/attach",
        files={"file": (filename, content, "application/octet-stream")},
        data={"slot": slot, "source_url": source_url},
    )
    assert response.status_code == 200, response.text
    return response.json()




FORM = {
    "title": "Hoyo de la Puerta",
    "coords": "10.393313, -66.892504",
    "source_urls": ["https://instagram.com/reels/DTG728Xk"],
    "note": "Two helicopters heading East",
    "pov": True,
}


def links_between(case, from_id, to_id):
    return {
        link["type"] for link in case.links_of(from_id) if link["from"] == from_id and link["to"] == to_id
    }


# -- reading a post ----------------------------------------------------------
#
# The scan is the only part that touches free text, so it is the only part that
# can be fooled by prose. Each of these is a shape, never a line or a keyword.


def test_the_scan_reads_a_position_out_of_a_post():
    found = geo.scan_coords(POST)
    assert [(round(c["lat"], 6), round(c["lon"], 6)) for c in found] == [(10.393313, -66.892504)]
    assert found[0]["format"] == "decimal"
    assert found[0]["text"] == "10.393313, -66.892504"


def test_the_scan_reads_every_notation_the_field_accepts():
    formats = {
        "48.8584, 2.2945": "decimal",
        "48°51'30.2\"N 2°17'40.2\"E": "dms",
        "grid 31U DQ 48250 11951 confirmed": "mgrs",
        "code 8FW4V75V+8Q here": "plus-code",
        "https://www.google.com/maps/@48.8584,2.2945,17z": "map-link",
        "https://www.openstreetmap.org/#map=17/48.8584/2.2945": "map-link",
    }
    for text, expected in formats.items():
        found = geo.scan_coords(text)
        assert found, text
        assert found[0]["format"] == expected, text
        assert abs(found[0]["lat"] - 48.858) < 0.01, text


def test_prose_that_merely_contains_numbers_states_no_position():
    for text in ("2 photos, 3 videos and 4 links", "MH-47 flew 300 m at 12.5, 3 pm", ""):
        assert geo.scan_coords(text) == []


def test_a_short_plus_code_is_not_decoded():
    """It needs a locality to resolve against, which a post does not carry. Read
    as a position it would put the point in the wrong hemisphere."""
    assert geo.scan_coords("Hoyo de la Puerta - 94V4+8XH") == []


def test_one_position_written_twice_is_offered_once():
    text = "10.393313, -66.892504 — https://maps.google.com/maps/@10.393313,-66.892504,17z"
    assert len(geo.scan_coords(text)) == 1


def test_the_scan_offers_the_post_s_links_but_not_the_post():
    urls = import_engine.scan_urls(POST, exclude="https://x.com/a/1")
    assert urls == ["https://instagram.com/reels/DTG728Xk"]
    assert import_engine.scan_urls("see https://x.com/a/1", exclude="https://x.com/a/1") == []


def test_the_links_a_platform_records_are_believed_over_the_ones_it_prints():
    """Where a post keeps its links decides whether they can be read at all.

    An AT Protocol post prints an address truncated to an ellipsis and keeps the whole
    of it in a facet beside the words. Scanning the words there hands back half an
    address with nothing to say it is half — so the recorded ones come first, in their
    own order, and the scan follows for the platforms that write theirs out in full.
    """
    post = import_engine.read_post(
        {
            "title": "Quito",
            "description": "Source: bsky.app/profile/x/post/…\nand https://t.me/chan/9",
            "links": ["https://x.com/atummundi/status/1"],
        },
        "https://bsky.app/profile/scaratlas.bsky.social/post/3mthgt4lups2f",
    )
    assert post["urls"][0] == "https://x.com/atummundi/status/1"
    assert "https://t.me/chan/9" in post["urls"]  # the scan still runs

    # The post's own address is not one of its sources, whichever half named it.
    own = "https://bsky.app/profile/a/post/1"
    assert import_engine.read_post({"links": [own], "description": ""}, own)["urls"] == []


def test_a_post_that_states_nothing_prefills_nothing():
    post = import_engine.read_post({"description": "Look at this"}, "https://x.com/a/1")
    assert post["coords"] == []
    assert post["urls"] == []
    assert post["title"] == ""


# -- the staging directory ---------------------------------------------------


def test_a_held_file_is_not_in_the_case(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")

    case = case_of(case_id)
    assert case.list_entities() == []
    assert not any(case.media_dir.glob("*.png"))
    assert import_engine.staged_path(case, token, "panel") is not None


def test_cancelling_leaves_nothing_behind(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")

    assert client.delete(f"/api/cases/{case_id}/proof-imports/{token}").status_code == 200
    case = case_of(case_id)
    assert not (case.subdir("media") / ".dl").exists() or not list(
        (case.subdir("media") / ".dl").iterdir()
    )
    assert case.list_entities() == []


def test_an_abandoned_import_is_swept_by_the_next_one(client, monkeypatch):
    case_id = make_case(client)
    stale = start(client, case_id)
    attach(client, case_id, stale, "panel", picture(), "panel.png")
    case = case_of(case_id)
    directory = import_engine.staging_dir(case, stale)

    monkeypatch.setattr(import_engine, "_now", lambda: 9e9)
    start(client, case_id)
    assert not directory.exists()


def test_a_download_still_writing_is_not_swept_or_discarded(client, monkeypatch):
    """Staging shares `media/.dl/` with in-progress downloads, and shares their
    naming so the Windows path budget does not move. The manifest is what tells
    them apart, and getting that wrong deletes somebody's download mid-write."""
    case_id = make_case(client)
    case = case_of(case_id)
    scratch = case.subdir("media") / ".dl" / ("f" * 12)
    scratch.mkdir(parents=True)
    (scratch / "half-a-video.mp4.part").write_bytes(b"...")

    client.delete(f"/api/cases/{case_id}/proof-imports/{'f' * 12}")
    monkeypatch.setattr(import_engine, "_now", lambda: 9e9)
    start(client, case_id)  # opening an import sweeps

    assert (scratch / "half-a-video.mp4.part").is_file()


def test_a_token_this_case_never_minted_is_refused(client):
    """A token names a directory, so only the shape this module mints is read as
    one — a request cannot point the import at a path of its own choosing."""
    case_id = make_case(client)
    for token in ("....etc", "0" * 40, "abcdef"):
        response = client.post(f"/api/cases/{case_id}/proof-imports/{token}/preview", json=FORM)
        assert response.status_code == 404, token


def test_refilling_a_slot_drops_what_it_held(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture((10, 10, 10)), "first.png")
    attach(client, case_id, token, "panel", picture((200, 30, 30)), "second.png")

    case = case_of(case_id)
    held = list(import_engine.staging_dir(case, token).glob("*.png"))
    assert [path.name for path in held] == ["second.png"]


# -- fetching, without a network ---------------------------------------------


def test_the_fetch_holds_the_download_and_reads_the_post(client, monkeypatch):
    """The one path the hand-attached tests cannot reach: a real download, with
    the extractor faked. The file must land in staging and nowhere else, and the
    post's text must come back scanned."""
    from test_media_api import _install_fake_ydl

    _install_fake_ydl(
        monkeypatch,
        lambda ydl, url, download: {
            "id": "p1",
            "title": "Hoyo de la Puerta",
            "description": POST,
            "uploader": "someone",
            "upload_date": "20260301",
            "ext": "png",
        },
    )
    case_id = make_case(client)
    token = start(client, case_id)

    started = client.post(
        f"/api/cases/{case_id}/proof-imports/{token}/fetch",
        json={"url": "https://x.com/a/1", "slot": "panel"},
    )
    assert started.status_code == 200, started.text
    result = job_result(client, started.json()["job_id"])

    assert result["staged"]["kind"] == "image"
    assert result["post"]["coords"][0]["lat"] == 10.393313
    assert result["post"]["urls"] == ["https://instagram.com/reels/DTG728Xk"]

    case = case_of(case_id)
    assert case.list_entities() == []  # the case is untouched
    assert not any(case.media_dir.glob("*.png"))
    assert import_engine.staged_path(case, token, "panel") is not None


# -- the preview -------------------------------------------------------------


def preview(client, case_id, token, **overrides):
    response = client.post(
        f"/api/cases/{case_id}/proof-imports/{token}/preview", json={**FORM, **overrides}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_the_preview_lists_what_the_import_would_create(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")
    attach(client, case_id, token, "source", b"video-bytes", "reel.mp4")

    report = preview(client, case_id, token)
    assert report["ready"] is True
    assert [(e["slot"], e["type"], e["state"]) for e in report["entities"]] == [
        ("place", "place", "new"),
        ("source", "media", "new"),
        ("panel", "media", "new"),
        ("proof", "proof", "new"),
    ]
    edges = {(e["from"], e["type"], e["to"]) for e in report["links"]}
    assert ("source", link_engine.LOCATED_AT, "place") in edges
    assert ("proof", link_engine.DEPICTS, "place") in edges
    # The proof is what the constellation hangs off: it composes the picture and rests
    # on the material, and both are its own edges.
    assert ("proof", link_engine.DERIVED_FROM, "source") in edges
    assert ("proof", link_engine.DERIVED_FROM, "panel") in edges
    assert ("panel", link_engine.DERIVED_FROM, "source") not in edges


def test_without_the_camera_on_site_the_footage_shows_the_place(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")
    attach(client, case_id, token, "source", b"video-bytes", "reel.mp4")

    report = preview(client, case_id, token, pov=False)
    edges = {(e["from"], e["type"], e["to"]) for e in report["links"]}
    assert ("source", link_engine.DEPICTS, "place") in edges
    assert ("source", link_engine.LOCATED_AT, "place") not in edges


def test_neither_coordinates_nor_a_source_may_be_left_out(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")

    assert preview(client, case_id, token, coords="")["ready"] is False
    assert preview(client, case_id, token, source_urls=[])["ready"] is False
    assert "Coordinates are required." in preview(client, case_id, token, coords="")["blocking"]


def test_prose_in_the_coordinate_field_is_refused_by_name(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")

    report = preview(client, case_id, token, coords="somewhere near the ridge")
    assert report["ready"] is False
    assert any("is not a position" in line for line in report["blocking"])


def test_the_preview_says_when_the_footage_was_not_recovered(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")

    report = preview(client, case_id, token)
    assert report["ready"] is True  # a dead link is information, not a blockage
    assert any(w["code"] == "no-source-media" for w in report["warnings"])
    assert [e["slot"] for e in report["entities"]] == ["place", "panel", "proof"]


def test_a_missing_source_is_said_once_not_twice(client):
    """With no address typed, the blocking line is the whole answer: repeating it
    as a warning reads as two problems where there is one."""
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")

    report = preview(client, case_id, token, source_urls=[])
    assert "A source is required." in report["blocking"]
    assert not any(w["code"] == "no-source-media" for w in report["warnings"])


def test_the_source_field_holds_one_address_and_says_so(client):
    """The field is the address the footage is fetched from as much as the line the
    proof carries, so two of them is not extra information.

    Pasted as a pair it was posted to the downloader as one address, refused there,
    and reported as a source that "was not downloaded" — the import went through and
    filed a proof with no material and a line nothing could be traced from. The
    preview is where that is said, as it is for the coordinates and the name.
    """
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")

    report = preview(client, case_id, token, source_urls=["https://x.com/a/1 https://t.me/b/2"])
    assert report["ready"] is False
    assert "A source is one address, and this is several." in report["blocking"]

    report = preview(client, case_id, token, source_urls=["handed to me on a stick"])
    assert report["ready"] is False
    assert "A source is an address, and this is not one." in report["blocking"]

    # Two of them, each in its own box, is the ordinary thing a thread asks for.
    two = preview(client, case_id, token, source_urls=["https://x.com/a/1", "https://t.me/b/2"])
    assert two["ready"] is True


def test_a_point_the_case_already_holds_is_reused_not_pinned_twice(client):
    case_id = make_case(client)
    saved = client.post(
        f"/api/cases/{case_id}/satellite/place",
        json={"lat": 10.393313, "lon": -66.892504},
    )
    assert saved.status_code == 200, saved.text

    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")
    report = preview(client, case_id, token)
    place = next(e for e in report["entities"] if e["type"] == "place")
    assert place["state"] == "existing"


def test_the_preview_reads_the_bytes_it_holds_for_a_duplicate(client):
    case_id = make_case(client)
    same = picture()
    client.post(
        f"/api/cases/{case_id}/media/upload",
        files={"file": ("already-here.png", same, "image/png")},
    )
    token = start(client, case_id)
    attach(client, case_id, token, "panel", same, "panel.png")

    report = preview(client, case_id, token)
    panel = next(e for e in report["entities"] if e["slot"] == "panel")
    assert panel["state"] == "existing"
    assert any(w["code"] == "already-imported" for w in report["warnings"])


def test_the_same_post_twice_is_noticed_by_its_address(client):
    """Two different encodings of one picture still come from one post, so the
    address is asked as well as the bytes."""
    case_id = make_case(client)
    first = start(client, case_id)
    attach(client, case_id, first, "panel", picture(), "panel.png", source_url="https://x.com/a/1")
    commit(client, case_id, first)

    second = start(client, case_id)
    attach(
        client, case_id, second, "panel", picture((9, 9, 9)), "other.png",
        source_url="https://x.com/a/1",
    )
    # what the fetch would have written down about the post, without the download
    import_engine.record_post(case_of(case_id), second, {"url": "https://x.com/a/1"})

    report = preview(client, case_id, second, title="Second sighting")
    assert any(w["code"] == "already-imported" for w in report["warnings"])


def test_a_picture_larger_than_the_clamp_is_refused(client, monkeypatch):
    from azimut.api import proofimports

    monkeypatch.setattr(proofimports, "MAX_IMAGE_BYTES", 64)
    case_id = make_case(client)
    token = start(client, case_id)
    response = client.post(
        f"/api/cases/{case_id}/proof-imports/{token}/attach",
        files={"file": ("panel.png", picture(), "image/png")},
        data={"slot": "panel"},
    )
    assert response.status_code == 413
    assert import_engine.staged_path(case_of(case_id), token, "panel") is None


def test_the_footage_is_not_held_to_the_picture_s_clamp(client, monkeypatch):
    """The clamp answers a decompression bomb, and a video is not one. A reel the
    downloader could not reach is exactly the file somebody attaches by hand."""
    from azimut.api import proofimports

    monkeypatch.setattr(proofimports, "MAX_IMAGE_BYTES", 64)
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "source", b"x" * 5000, "reel.mp4")
    assert import_engine.staged_path(case_of(case_id), token, "source") is not None


def test_a_wall_of_text_is_read_up_to_a_bound(client):
    """Post text is attacker-controlled input feeding patterns that backtrack, so
    the length is capped once at the door rather than defended in each scan."""
    long_text = ("filler " * 2000) + "10.393313, -66.892504"
    post = import_engine.read_post({"description": long_text}, "https://x.com/a/1")
    assert len(post["text"]) == import_engine.MAX_POST_TEXT
    assert post["coords"] == []  # the position sat past the bound and was not read


def test_a_file_that_contradicts_the_typed_point_is_flagged(client, monkeypatch):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")
    monkeypatch.setattr(
        import_engine, "_stated_gps", lambda path, kind: {"lat": 10.40, "lon": -66.90}
    )

    report = preview(client, case_id, token)
    conflict = next(w for w in report["warnings"] if w["code"] == "gps-conflict")
    assert "10.400000" in conflict["text"]


def test_a_position_the_file_agrees_with_is_not_flagged(client, monkeypatch):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")
    monkeypatch.setattr(
        import_engine, "_stated_gps", lambda path, kind: {"lat": 10.393310, "lon": -66.892500}
    )

    report = preview(client, case_id, token)
    assert not any(w["code"] == "gps-conflict" for w in report["warnings"])


def test_a_name_another_proof_holds_is_refused(client):
    case_id = make_case(client)
    client.post(
        f"/api/cases/{case_id}/proofs",
        json={"title": "Hoyo de la Puerta", "spec": {"panels": []}},
    )
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")

    report = preview(client, case_id, token)
    assert report["ready"] is False
    assert any("already called" in line for line in report["blocking"])


def test_a_video_cannot_be_the_proof_s_picture(client):
    """Refused at the door it comes through, and refused again at the preview.

    A proof is composed of pictures: the composer lays panels out on a canvas and a clip
    has nothing to lay out. Saying so only at the preview meant the file was downloaded,
    staged and shown as "Proof: clip.mp4" before anything said no — two screens after the
    choice that made it, with nothing on the screen that made it hinting there was a rule.
    """
    case_id = make_case(client)
    token = start(client, case_id)

    refused = client.post(
        f"/api/cases/{case_id}/proof-imports/{token}/attach",
        files={"file": ("clip.mp4", b"video-bytes", "application/octet-stream")},
        data={"slot": "panel"},
    )
    assert refused.status_code == 422
    assert "pictures" in refused.json()["detail"]
    # and nothing is left holding it
    assert import_engine.staged_pairs(case_of(case_id), token, import_engine.SLOT_PANEL) == []

    # The preview keeps the line anyway: it is the invariant, whatever put a file there.
    staged = media_engine.stage_descriptor(
        _write(case_of(case_id), token, "clip.mp4", b"video-bytes"), {"type": "manual"}
    )
    import_engine.fill_slot(case_of(case_id), token, "panel", staged)
    report = preview(client, case_id, token)
    assert report["ready"] is False
    assert any("pictures" in line for line in report["blocking"])


def _write(case, token, name, data):
    """Put bytes in the staging directory without going through a route."""
    path = import_engine.staging_dir(case, token) / name
    path.write_bytes(data)
    return path


# -- the commit --------------------------------------------------------------


def commit(client, case_id, token, **overrides):
    response = client.post(
        f"/api/cases/{case_id}/proof-imports/{token}/commit", json={**FORM, **overrides}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_the_import_writes_the_graph_the_composer_would_have(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")
    attach(client, case_id, token, "source", b"video-bytes", "reel.mp4")

    created = commit(client, case_id, token)
    case = case_of(case_id)
    proof = case.find_entity(attr="spec", value=layout.proof_spec_rel(created["proof"]["name"]))
    place_id = created["place"]["id"]
    panel_id = created["panel"]["id"]
    source_id = created["source"]["id"]

    assert links_between(case, source_id, place_id) == {link_engine.LOCATED_AT}
    assert links_between(case, proof["id"], place_id) == {link_engine.DEPICTS}
    # The proof composes the picture and rests on the material: one node the whole
    # geolocation hangs off, which is what a hand-made proof writes too.
    assert link_engine.DERIVED_FROM in links_between(case, proof["id"], panel_id)
    assert link_engine.DERIVED_FROM in links_between(case, proof["id"], source_id)


def test_the_preview_promises_exactly_the_edges_the_commit_writes(client):
    """The gate this whole feature rests on. A preview that under-reports is
    worse than no preview: the analyst approved a graph they were not shown."""
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")
    attach(client, case_id, token, "source", b"video-bytes", "reel.mp4")

    promised = preview(client, case_id, token)
    created = commit(client, case_id, token)

    case = case_of(case_id)
    proof = case.find_entity(attr="spec", value=layout.proof_spec_rel(created["proof"]["name"]))
    by_slot = {
        "place": created["place"]["id"],
        "panel": created["panel"]["id"],
        "source": created["source"]["id"],
        "proof": proof["id"],
    }
    expected = {
        (by_slot[edge["from"]], edge["type"], by_slot[edge["to"]]) for edge in promised["links"]
    }
    written = {
        (link["from"], link["type"], link["to"])
        for link in case.list_links()
        if link["from"] in by_slot.values() and link["to"] in by_slot.values()
    }
    assert written == expected


def test_the_proof_is_a_real_proof(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")
    created = commit(client, case_id, token)
    name = created["proof"]["name"]

    listed = client.get(f"/api/cases/{case_id}/proofs").json()
    assert [p["name"] for p in listed] == [name]
    assert listed[0]["points"] == [
        {
            "lat": 10.393313, "lon": -66.892504,
            "coords": "10.393313, -66.892504", "label": "", "pov": True,
        }
    ]

    spec = client.get(f"/api/cases/{case_id}/proofs/{name}").json()
    assert spec["azimut_proof"] == 1
    assert spec["pov"] is True
    assert spec["sources"] == FORM["source_urls"]
    assert len(spec["panels"]) == 1
    assert spec["panels"][0]["natural"] == [320, 200]

    case = case_of(case_id)
    assert case.resolve_inside(layout.proof_export_rel(name)).is_file()
    assert case.resolve_inside(spec["panels"][0]["src"]).is_file()


def test_the_export_is_a_png_whatever_arrived(client):
    case_id = make_case(client)
    token = start(client, case_id)
    jpeg = io.BytesIO()
    Image.new("RGB", (64, 48), (200, 120, 40)).save(jpeg, "JPEG")
    attach(client, case_id, token, "panel", jpeg.getvalue(), "panel.jpg")

    created = commit(client, case_id, token)
    export = case_of(case_id).resolve_inside(layout.proof_export_rel(created["proof"]["name"]))
    with Image.open(export) as img:
        assert img.format == "PNG"


def test_the_post_travels_with_the_picture_it_published(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png", source_url="https://x.com/a/1")

    created = commit(client, case_id, token)
    case = case_of(case_id)
    panel = case.get_entity(created["panel"]["id"])
    assert panel["attrs"]["source_url"] == "https://x.com/a/1"


def test_committing_empties_the_staging_directory(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")
    commit(client, case_id, token)

    assert not import_engine.staging_dir(case_of(case_id), token).exists()


def test_a_refused_import_writes_nothing(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")

    response = client.post(
        f"/api/cases/{case_id}/proof-imports/{token}/commit", json={**FORM, "coords": ""}
    )
    assert response.status_code == 400
    case = case_of(case_id)
    assert case.list_entities() == []
    assert import_engine.staged_path(case, token, "panel") is not None


def test_the_place_is_filed_even_when_the_composer_would_have_asked(client):
    """`proof_place_auto` off makes the composer ask before pinning a point. The
    import already asked — the preview said "place: new" — so it files."""
    client.put("/api/settings", json={"proof_place_auto": False})
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")

    created = commit(client, case_id, token)
    case = case_of(case_id)
    assert case.get_entity(created["place"]["id"])["type"] == "place"


def test_the_same_picture_twice_is_one_media(client):
    case_id = make_case(client)
    same = picture()
    first = start(client, case_id)
    attach(client, case_id, first, "panel", same, "panel.png")
    created = commit(client, case_id, first)

    second = start(client, case_id)
    attach(client, case_id, second, "panel", same, "panel.png")
    again = commit(client, case_id, second, title="Hoyo de la Puerta 2")

    assert again["panel"]["id"] == created["panel"]["id"]
    assert again["panel"]["duplicate"] is True
    case = case_of(case_id)
    assert len([e for e in case.list_entities() if e["type"] == "media"]) == 1
    assert len([e for e in case.list_entities() if e["type"] == "proof"]) == 2


def test_the_import_names_the_place_it_landed_on_even_when_it_reused_one(client):
    case_id = make_case(client)
    standing = client.post(
        f"/api/cases/{case_id}/satellite/place",
        json={"lat": 10.393313, "lon": -66.892504},
    ).json()

    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")
    created = commit(client, case_id, token)

    assert created["place"]["id"] == standing["id"]


def test_a_second_proof_on_one_point_does_not_pin_it_twice(client):
    case_id = make_case(client)
    for index, colour in enumerate(((10, 10, 10), (200, 30, 30))):
        token = start(client, case_id)
        attach(client, case_id, token, "panel", picture(colour), "panel.png")
        commit(client, case_id, token, title=f"Sighting {index}")

    case = case_of(case_id)
    assert len([e for e in case.list_entities() if e["type"] == "place"]) == 1


def test_the_imported_proof_reopens_and_saves_like_any_other(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")
    created = commit(client, case_id, token)
    name = created["proof"]["name"]

    spec = client.get(f"/api/cases/{case_id}/proofs/{name}").json()
    spec["coordsText"] = "48.8584, 2.2945"
    again = client.post(
        f"/api/cases/{case_id}/proofs",
        json={"title": name, "spec": spec, "rename_from": name},
    )
    assert again.status_code == 200, again.text

    case = case_of(case_id)
    proof = case.find_entity(attr="spec", value=layout.proof_spec_rel(name))
    places = [e for e in case.list_entities() if e["type"] == "place"]
    stated = [
        link["to"]
        for link in case.links_of(proof["id"])
        if link["from"] == proof["id"] and link["type"] in (link_engine.DEPICTS,)
    ]
    assert len(stated) == 1
    assert case.get_entity(stated[0])["attrs"]["lat"] == 48.8584
    assert len(places) == 2  # the old point is left standing, not deleted


def test_deleting_the_imported_proof_takes_its_files(client):
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "panel.png")
    created = commit(client, case_id, token)
    name = created["proof"]["name"]

    case = case_of(case_id)
    spec_path = case.resolve_inside(layout.proof_spec_rel(name))
    export = case.resolve_inside(layout.proof_export_rel(name))
    assert client.delete(f"/api/cases/{case_id}/proofs/{name}").status_code == 200
    assert not spec_path.exists()
    assert not export.exists()


def hold_pictures(case_id, token, count):
    """Put a set of pictures in the panel slot, the way a picker answered with several
    ticks does. Distinct colours, because the library dedupes on the bytes."""
    from azimut.engine import media as media_engine

    case = case_of(case_id)
    stage = import_engine.staging_dir(case, token)
    held = []
    for at in range(count):
        path = stage / f"panel-{at}.png"
        path.write_bytes(picture(colour=(20 + at * 60, 90, 140), size=(300 + at * 10, 200)))
        held.append(media_engine.stage_descriptor(path, {"type": "test", "url": f"u{at}"}))
    import_engine.fill_files(case, token, import_engine.SLOT_PANEL, held)
    return held


def test_a_post_publishing_a_set_is_one_proof_of_several_panels(client):
    """A published geolocation is often the overhead, the ground shot and the match.

    Keeping one and dropping the rest keeps a third of what was published, and the thing
    that holds them is not new: a proof **is** a composition.
    """
    case_id = make_case(client)
    token = start(client, case_id)
    hold_pictures(case_id, token, 3)

    report = client.post(
        f"/api/cases/{case_id}/proof-imports/{token}/preview", json=FORM
    ).json()
    assert report["ready"] is True
    # Every picture is named in the preview, and named *apart*: three rows called `panel`
    # say nothing about which one an edge is about, and the screen that renders the report
    # is keyed on that name — so a shared one throws and blanks the whole reading.
    slots = [entity["slot"] for entity in report["entities"] if entity["type"] == "media"]
    assert slots == ["panel", "panel 2", "panel 3"]
    assert len(set(slots)) == len(slots)
    edges = [(link["from"], link["type"], link["to"]) for link in report["links"]]
    assert len(set(edges)) == len(edges), "every stated edge is its own line"
    chain = [link for link in report["links"] if link["from"] == "proof"]
    assert [link["to"] for link in chain] == ["panel", "panel 2", "panel 3", "place"]

    created = commit(client, case_id, token)
    name = created["proof"]["name"]
    spec = client.get(f"/api/cases/{case_id}/proofs/{name}").json()
    assert len(spec["panels"]) == 3
    assert [panel["natural"] for panel in spec["panels"]] == [[300, 200], [310, 200], [320, 200]]
    # The note is one sentence about the proof, not a caption per picture.
    assert [panel["caption"] for panel in spec["panels"]] == [FORM["note"], "", ""]

    case = case_of(case_id)
    for panel in spec["panels"]:
        assert case.resolve_inside(panel["src"]).is_file()


def test_a_picture_whose_bytes_went_missing_takes_its_own_provenance_with_it(client):
    """A wrong origin on a proof is worse than none: the panel claims a page it never
    came from, and nothing in the case contradicts it.

    The paths that survive and the entries describing them were two lists zipped by
    position, so one file gone from the staging directory — quarantined by an antivirus,
    swept by hand — shifted every picture after it onto its neighbour's post, title and
    derivation. Paired by identity now, so the second picture keeps its own `u1` or is not
    filed at all.
    """
    case_id = make_case(client)
    token = start(client, case_id)
    hold_pictures(case_id, token, 3)
    case = case_of(case_id)
    (import_engine.staging_dir(case, token) / "panel-1.png").unlink()

    created = commit(client, case_id, token)
    filed = created.get("panels") or [created["panel"]]
    origins = []
    for entry in filed:
        media = case.find_entity(attr="path", value=entry["path"])
        origins.append((media["attrs"].get("source_url"), entry["path"]))

    assert len(filed) == 2, "the picture whose bytes went is not filed"
    assert [url for url, _ in origins] == ["u0", "u2"], origins


def test_an_origin_that_is_not_a_link_is_refused_on_the_hand_attached_file(client):
    """An origin is a link, refused when it is not one — and this is the surface where it
    is typed by hand, which is the one that most needed the reading.

    The other two doors, an upload and a later correction in Details, both went through
    `stated_source`. This one wrote whatever arrived straight into the entity's own
    `source_url`, the proof plate's source line and the lineage a lost file leaves behind,
    all of which the rest of the app treats as an address.
    """
    case_id = make_case(client)
    token = start(client, case_id)

    refused = client.post(
        f"/api/cases/{case_id}/proof-imports/{token}/attach",
        files={"file": ("panel.png", picture(), "application/octet-stream")},
        data={"slot": "panel", "source_url": "handed to me on a stick"},
    )
    assert refused.status_code == 422
    assert "http(s)" in refused.json()["detail"]
    # And nothing was staged for it: the reading happens before the bytes are streamed.
    assert import_engine.staged_pairs(case_of(case_id), token, import_engine.SLOT_PANEL) == []

    # An empty origin is still a valid answer — most hand-attached files have none.
    attach(client, case_id, token, "panel", picture(), "panel.png")
    stated = attach(
        client, case_id, token, "panel", picture(colour=(1, 2, 3)), "panel.png",
        source_url="https://t.me/chan/12",
    )
    assert stated["staged"]["source"]["url"] == "https://t.me/chan/12"


def test_a_thread_states_its_point_once_and_rests_on_everything_it_hung_off_it(client):
    """One published proof, several pieces of material, spread over several posts.

    A geolocation thread states the point in its first post and hangs the photos and the
    clips it rests on off the ones after it. The composition is the small half — often a
    single picture the author laid out — and the material is the plural one, which is the
    opposite of what a slot holding exactly one file could take. Keeping the first of four
    filed one file and left the other three outside the case entirely.

    Every picture records every piece of material, because which photo of four a composite
    was laid out from is not something the post says, and a guessed pairing states one
    edge right and three wrong. The point reaches all of them through that chain.
    """
    case_id = make_case(client)
    token = start(client, case_id)
    attach(client, case_id, token, "panel", picture(), "composite.png")
    for at, url in enumerate(("https://x.com/a/2", "https://x.com/a/3", "https://x.com/a/4")):
        attach(
            client, case_id, token, "source", f"bytes-{at}".encode(), f"clip{at}.mp4",
            source_url=url,
        )
    urls = ["https://x.com/a/2", "https://x.com/a/3", "https://x.com/a/4"]

    report = preview(client, case_id, token, source_urls=urls)
    assert report["ready"] is True
    # One name per file, so a report about four of them can be read.
    assert [e["slot"] for e in report["entities"]] == [
        "place", "source", "source 2", "source 3", "panel", "proof",
    ]
    edges = {(e["from"], e["type"], e["to"]) for e in report["links"]}
    for slot in ("source", "source 2", "source 3"):
        assert ("proof", link_engine.DERIVED_FROM, slot) in edges
        assert (slot, link_engine.LOCATED_AT, "place") in edges  # POV is on in FORM

    created = commit(client, case_id, token, source_urls=urls)
    case = case_of(case_id)
    proof = case.find_entity(attr="spec", value=layout.proof_spec_rel(created["proof"]["name"]))
    panel = case.get_entity(created["panel"]["id"])
    sources = [case.get_entity(one["id"]) for one in created["sources"]]

    assert len(sources) == 3
    assert len({one["id"] for one in sources}) == 3  # three files, not one filed thrice
    for one in sources:
        assert link_engine.DERIVED_FROM in links_between(case, proof["id"], one["id"])
        # and not off the published picture, which is one file among the several rather
        # than the thing they all hang off
        assert links_between(case, panel["id"], one["id"]) == set()
    assert link_engine.DERIVED_FROM in links_between(case, proof["id"], panel["id"])

    # And the proof states all three addresses, so its line traces back to each post.
    spec = client.get(f"/api/cases/{case_id}/proofs/{created['proof']['name']}").json()
    assert spec["sources"] == urls


def test_a_set_has_no_render_yet_and_still_draws_in_the_graph(client):
    """A single picture is already a rendered proof, so it is filed as the export. A set
    has no render — laying panels out is the composer's canvas, in the browser — and a
    second renderer here would drift from it at the first change to a layout.

    So the set is saved without an export and borrows the first picture's thumbnail, or it
    would be the only blank node of its own constellation. The first save in the composer
    writes the real one.
    """
    case_id = make_case(client)
    token = start(client, case_id)
    hold_pictures(case_id, token, 2)
    created = commit(client, case_id, token)
    name = created["proof"]["name"]

    case = case_of(case_id)
    assert not case.resolve_inside(layout.proof_export_rel(name)).exists()
    proof = case.find_entity(attr="spec", value=layout.proof_spec_rel(name))
    assert "path" not in proof["attrs"]
    assert proof["attrs"].get("thumb"), "a proof with no render still draws, off a panel's"

    # And one picture is unchanged: it exports, exactly as it did before.
    other = start(client, case_id)
    attach(client, case_id, other, "panel", picture(colour=(9, 9, 9)), "solo.png")
    solo = commit(client, case_id, other, title="Solo proof")
    assert case.resolve_inside(layout.proof_export_rel(solo["proof"]["name"])).is_file()
