"""Deleting a proof withdraws the geolocation it stated.

What must hold: the place only the proof held goes with it, edges and all, so the
footage stops standing there; a place the analyst saved by hand stays and loses only
what the proof posed on it; a point another proof still concludes on is left whole;
a place something else holds stays; and restoring the proof from the Trash puts the
whole geolocation back.
"""

from PIL import Image
import pytest

import graph_read
from azimut.workspace import Case
from mediafixture import _frame_of, _index, _points, _save_proof, _upload


@pytest.fixture()
def sat_tiles(monkeypatch):
    from azimut.engine import tiles

    monkeypatch.setattr(
        tiles, "_default_fetch", lambda client, url: Image.new("RGB", (256, 256), (10, 120, 10))
    )


POINT = {"lat": 50.4501, "lon": 30.5234}
SPOT = [(50.4501, 30.5234)]


def _case(client):
    return client.post("/api/cases", json={"name": "Delete"}).json()["id"]


def _capture(client, cid):
    return client.post(
        f"/api/cases/{cid}/satellite/capture", json={**POINT, "zoom": 16, "width": 256, "height": 256}
    ).json()["path"]


def _places(cid):
    return [e for e in graph_read.entities(cid) if e["type"] == "place"]


def _proof_on_video(client, cid, title="Roofline", video=None):
    video = video or _upload(client, cid, "clip.png")
    _save_proof(client, cid, title, [_frame_of(cid, video, f"{title}.png"), _capture(client, cid)], coords=POINT)
    return video


def _delete(client, cid, name):
    res = client.delete(f"/api/cases/{cid}/proofs/{name}")
    assert res.status_code == 200, res.text
    return res.json()


def test_the_place_only_the_proof_held_goes_with_it_and_the_footage_stops_standing_there(client, sat_tiles):
    cid = _case(client)
    video = _proof_on_video(client, cid)
    [place] = _places(cid)
    assert _points(_index(client, cid), video) == SPOT

    deleted = _delete(client, cid, "Roofline")

    assert place["id"] in deleted["deleted"]
    assert _places(cid) == []
    assert _points(_index(client, cid), video) == []


def test_restoring_the_proof_puts_its_geolocation_back(client, sat_tiles):
    cid = _case(client)
    video = _proof_on_video(client, cid)
    [place] = _places(cid)
    group = _delete(client, cid, "Roofline")["trash"]

    assert client.post(f"/api/cases/{cid}/trash/{group}/restore").status_code == 200
    assert [p["id"] for p in _places(cid)] == [place["id"]]
    assert _points(_index(client, cid), video) == SPOT


def test_a_place_saved_by_hand_stays_and_loses_only_what_the_proof_posed(client, sat_tiles):
    cid = _case(client)
    own = client.post(f"/api/cases/{cid}/satellite/place", json={**POINT, "title": "Port gate"}).json()
    photo = _upload(client, cid, "gate.png", color=(30, 30, 200))
    # the analyst's own statement about another file stays whatever the proof does
    res = client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": graph_read.entity(cid, path=photo)["id"], "to_id": own["id"], "type": "located-at"},
    )
    assert res.status_code == 200, res.text
    video = _proof_on_video(client, cid)
    assert _points(_index(client, cid), video) == SPOT

    group = _delete(client, cid, "Roofline")["trash"]

    assert [p["id"] for p in _places(cid)] == [own["id"]]
    assert _points(_index(client, cid), video) == []
    assert _points(_index(client, cid), photo) == SPOT
    # and the Trash holds what the proof posed, so a restore puts the video back
    assert client.post(f"/api/cases/{cid}/trash/{group}/restore").status_code == 200
    assert _points(_index(client, cid), video) == SPOT


def test_a_point_another_proof_concludes_on_is_left_whole(client, sat_tiles):
    cid = _case(client)
    video = _proof_on_video(client, cid, "Roofline")
    _proof_on_video(client, cid, "Second angle", video=video)
    [place] = _places(cid)

    _delete(client, cid, "Roofline")

    assert [p["id"] for p in _places(cid)] == [place["id"]]
    assert _points(_index(client, cid), video) == SPOT


def test_a_place_something_else_holds_stays(client, sat_tiles):
    cid = _case(client)
    video = _proof_on_video(client, cid)
    [place] = _places(cid)
    note = Case.open(cid).add_entity("person", "Witness", {}, by="user")
    Case.open(cid).add_link(note["id"], place["id"], "located-at", by="user")

    _delete(client, cid, "Roofline")

    assert [p["id"] for p in _places(cid)] == [place["id"]]
    # the proof's point on the footage still goes: the proof no longer says it
    assert _points(_index(client, cid), video) == []


def test_a_proof_with_no_footage_takes_its_place(client, sat_tiles):
    cid = _case(client)
    _save_proof(client, cid, "From above", [_capture(client, cid)], coords=POINT)
    assert len(_places(cid)) == 1

    _delete(client, cid, "From above")
    assert _places(cid) == []


def _proof_id(cid, title):
    return next(e["id"] for e in graph_read.entities(cid) if e["type"] == "proof" and e["label"] == title)


def test_the_sidebar_delete_withdraws_the_point_too(client, sat_tiles):
    cid = _case(client)
    video = _proof_on_video(client, cid)
    res = client.delete(f"/api/cases/{cid}/entities/{_proof_id(cid, 'Roofline')}")
    assert res.status_code == 200, res.text
    assert _places(cid) == []
    assert _points(_index(client, cid), video) == []


def test_two_proofs_deleted_together_take_the_point_they_shared(client, sat_tiles):
    cid = _case(client)
    video = _proof_on_video(client, cid, "Roofline")
    _proof_on_video(client, cid, "Second angle", video=video)
    ids = [_proof_id(cid, "Roofline"), _proof_id(cid, "Second angle")]

    res = client.post(f"/api/cases/{cid}/entities/delete", json={"ids": ids})
    assert res.status_code == 200, res.text
    assert _places(cid) == []
    assert _points(_index(client, cid), video) == []
