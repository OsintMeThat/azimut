"""The Saved panel's Media position: images and videos placed on the map.

A file carries no coordinates (ONTOLOGY §2), so where it stands is read off the
graph. What must hold: every road that places a file counts (a relation to a place,
a GPS reading enrichment proposed, a proof reached through the derivation chain);
one file can stand in several places and is a row at each; roads that agree on a
point are one row; a file nothing places is not listed; only material the case
collected is listed, never what it made out of that material; and a row names the
proofs it can open.
"""

import base64
import io

from PIL import Image
import pytest

from azimut.engine import geo
from azimut.engine import media as media_engine
from azimut.workspace import Case

import graph_read


def _png_bytes(color=(200, 30, 30), size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture()
def sat_tiles(monkeypatch):
    """Captures without the network: every tile is a solid green square."""
    from azimut.engine import tiles

    monkeypatch.setattr(
        tiles, "_default_fetch", lambda client, url: Image.new("RGB", (256, 256), (10, 120, 10))
    )


def _ukraine(lat, lon, timeout=8, language=None):
    return {
        "display_name": "x",
        "address": {"country_code": "ua", "country": "Ukraine", "state": "Donetsk Oblast"},
        "attribution": "x",
    }


def _new_case(client, name="Media map"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _upload(client, cid, name, color=(200, 30, 30)):
    return client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(_png_bytes(color)), "image/png")},
    ).json()["item"]["path"]


def _id(cid, **attrs):
    found = graph_read.entity(cid, **attrs)
    assert found is not None, f"no entity with {attrs}"
    return found["id"]


def _place(client, cid, lat, lon):
    return client.post(
        f"/api/cases/{cid}/satellite/place", json={"lat": lat, "lon": lon}
    ).json()["id"]


def _link(client, cid, from_id, to_id, type_):
    res = client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": from_id, "to_id": to_id, "type": type_},
    )
    assert res.status_code == 200, res.text


def _sat(client, cid, lat, lon):
    return client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": lat, "lon": lon, "zoom": 16, "width": 256, "height": 256},
    ).json()["path"]


def _save_proof(client, cid, title, srcs, **spec_extra):
    spec = {"panels": [{"id": f"p{i}", "src": s} for i, s in enumerate(srcs)], **spec_extra}
    png = base64.b64encode(_png_bytes((10, 10, 10))).decode()
    res = client.post(
        f"/api/cases/{cid}/proofs",
        json={"title": title, "spec": spec, "png_base64": png},
    )
    assert res.status_code == 200, res.text


def _frame_of(cid, source_path, name="frame.png"):
    """A frame filed the way Inspect files one, derived from its video."""
    return media_engine.import_image(
        Case.open(cid),
        Image.new("RGB", (32, 24), (90, 90, 90)),
        name,
        {"type": "inspect", "from": source_path},
        by="inspect",
        dedupe=False,
    )["item"]["path"]


def _index(client, cid):
    res = client.get(f"/api/cases/{cid}/satellite/media")
    assert res.status_code == 200, res.text
    return res.json()


def _points(rows, path):
    return sorted((row["lat"], row["lon"]) for row in rows if row["path"] == path)


def test_a_file_placed_by_nothing_is_not_listed(client, sat_tiles):
    cid = _new_case(client)
    _upload(client, cid, "loose.png")
    _sat(client, cid, 50.45, 30.52)  # a capture is saved work, never a media row
    assert _index(client, cid) == []


def test_a_file_recorded_at_a_place_stands_there_with_its_geography(client, monkeypatch):
    monkeypatch.setattr(geo, "reverse_geocode", _ukraine)
    cid = _new_case(client)
    photo = _upload(client, cid, "quay.png")
    _link(client, cid, _id(cid, path=photo), _place(client, cid, 48.0159, 37.8029), "located-at")

    [row] = _index(client, cid)
    assert row["kind"] == "media"
    assert row["media_kind"] == "image"
    assert row["title"] == "quay"
    assert row["path"] == photo
    assert (row["lat"], row["lon"]) == (48.0159, 37.8029)
    assert row["key"] == f"{row['id']}@48.0159,37.8029"
    # borrowed from the place it stands on, so the tree files it under its country
    assert row["geo"]["country"] == "Ukraine"
    assert row["continent"] == "Europe"
    assert row["roads"] == [{"type": "located-at", "status": "confirmed"}]
    assert row["status"] == "confirmed"
    assert row["linked_proofs"] == []


def test_one_file_recorded_in_one_place_and_showing_another_is_two_rows(client):
    cid = _new_case(client)
    clip = _upload(client, cid, "rooftop.png")
    clip_id = _id(cid, path=clip)
    _link(client, cid, clip_id, _place(client, cid, 48.0, 37.0), "located-at")
    _link(client, cid, clip_id, _place(client, cid, 48.01, 37.02), "depicts")

    rows = _index(client, cid)
    assert _points(rows, clip) == [(48.0, 37.0), (48.01, 37.02)]
    roads = {(row["lat"], row["lon"]): row["roads"] for row in rows}
    assert roads[(48.0, 37.0)][0]["type"] == "located-at"
    assert roads[(48.01, 37.02)][0]["type"] == "depicts"
    # two rows of one file must not collide as render keys or marker identities
    assert len({row["key"] for row in rows}) == 2


def test_a_gps_reading_nobody_confirmed_reads_as_a_proposal(client):
    cid = _new_case(client)
    photo = _upload(client, cid, "exif.png")
    case = Case.open(cid)
    place = case.add_entity(
        "place", "48.8583, 2.2945", {"lat": 48.8583, "lon": 2.2945}, by="enrich",
        status="suggested",
    )
    edge = case.add_link(
        _id(cid, path=photo), place["id"], "located-at", by="enrich", status="suggested"
    )

    [row] = _index(client, cid)
    assert row["status"] == "suggested"
    assert row["roads"] == [{"type": "located-at", "status": "suggested"}]

    client.patch(f"/api/cases/{cid}/entities/{place['id']}", json={"status": "confirmed"})
    client.patch(f"/api/cases/{cid}/links/{edge['id']}", json={"status": "confirmed"})
    [row] = _index(client, cid)
    assert row["status"] == "confirmed"


def test_a_video_stands_where_the_proof_using_its_frame_concludes(client, sat_tiles):
    """video ◀ frame ◀ proof ▶ capture: the video is placed three hops away, and the
    row names the proof that placed it so the viewer can open it."""
    cid = _new_case(client)
    video = _upload(client, cid, "clip.png")
    frame = _frame_of(cid, video)
    cap = _sat(client, cid, 50.4501, 30.5234)
    _save_proof(client, cid, "Roofline", [frame, cap], coords={"lat": 50.4501, "lon": 30.5234})

    rows = _index(client, cid)
    assert _points(rows, video) == [(50.4501, 30.5234)]
    # the frame was cut here and stands where the video already stands: listing it
    # would mark one spot twice and bury the footage under what came out of it
    assert _points(rows, frame) == []
    [video_row] = [row for row in rows if row["path"] == video]
    assert {"type": "proof", "name": "Roofline"}.items() <= video_row["roads"][-1].items()
    assert video_row["linked_proofs"][0]["name"] == "Roofline"
    assert video_row["linked_proofs"][0]["title"] == "Roofline"


def test_two_clips_one_post_collected_stay_on_their_own_geolocation(client, sat_tiles):
    """A post publishing two clips is not a claim that they were filmed together.

    The walk crosses the chain in both directions, so a document holding several
    files joined them end to end: each clip reached the other's proof and stood on
    its point. Two geolocations became four rows, and the map drew a 2 on each.
    """
    cid = _new_case(client)
    north = _upload(client, cid, "north.png")
    south = _upload(client, cid, "south.png", color=(30, 30, 200))
    _save_proof(
        client, cid, "North",
        [_frame_of(cid, north, "n.png"), _sat(client, cid, 50.4501, 30.5234)],
        coords={"lat": 50.4501, "lon": 30.5234},
    )
    _save_proof(
        client, cid, "South",
        [_frame_of(cid, south, "s.png"), _sat(client, cid, 48.8584, 2.2945)],
        coords={"lat": 48.8584, "lon": 2.2945},
    )

    case = Case.open(cid)
    post = case.add_entity("post", "The thread", {}, by="user")
    for path in (north, south):
        case.add_link(post["id"], _id(cid, path=path), "derived-from", by="user")

    rows = _index(client, cid)
    assert _points(rows, north) == [(50.4501, 30.5234)]
    assert _points(rows, south) == [(48.8584, 2.2945)]


def test_roads_that_agree_on_a_point_are_one_row(client, sat_tiles):
    """The composer poses the proof's point on its material as `depicts`, and the
    same file reaches that proof along the chain. One file on one metre is one mark,
    keeping both reasons."""
    cid = _new_case(client)
    frame = _upload(client, cid, "frame.png")
    cap = _sat(client, cid, 50.4501, 30.5234)
    _save_proof(client, cid, "Roofline", [frame, cap], coordsText="50.4501, 30.5234")

    [row] = [row for row in _index(client, cid) if row["path"] == frame]
    assert [road["type"] for road in row["roads"]] == ["depicts", "proof"]
    assert [proof["name"] for proof in row["linked_proofs"]] == ["Roofline"]


def test_what_the_case_made_is_not_listed_beside_what_it_collected(client, sat_tiles):
    """Frames, captures and rendered comparisons are working material: they stand
    where their source stands, and the Media position is about what was brought in.
    Same question the Media Library asks with its own switch (`links.PRODUCED_HERE`)."""
    cid = _new_case(client)
    video = _upload(client, cid, "clip.png")
    frame = _frame_of(cid, video)
    cap = _sat(client, cid, 50.4501, 30.5234)
    _save_proof(client, cid, "Roofline", [frame, cap], coords={"lat": 50.4501, "lon": 30.5234})

    assert [row["path"] for row in _index(client, cid)] == [video]


def test_a_proof_composing_the_file_is_offered_even_when_a_capture_placed_it(
    client, sat_tiles
):
    """A proof saved without a point of its own places nothing, so the walk credits
    the capture. The proof is still one click from the file it was built on."""
    cid = _new_case(client)
    photo = _upload(client, cid, "photo.png")
    cap = _sat(client, cid, 50.4501, 30.5234)
    _save_proof(client, cid, "Unstated", [photo, cap])

    [row] = _index(client, cid)
    assert row["roads"][0]["type"] == "capture"
    assert [proof["name"] for proof in row["linked_proofs"]] == ["Unstated"]
