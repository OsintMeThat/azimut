"""A place a proof filed under its footage is not a place of the Saved list or map.

A proof files its point as a place so that the footage behind it stands somewhere,
and the Media layer draws that footage on the point. Listed and drawn too, the place
would be the same point twice. What must hold: such a place leaves the saved index
(the Places list, the map, the search, the extension's Points tool all read it) but
stays in the graph with the file standing on it; a place the analyst saved by hand
stays in sight whatever stands on it; a proof with no collected footage keeps its
place in sight, since nothing else draws its point; and a place nothing but a frame
cut here stands on stays too, since the layer never draws a frame.
"""

from PIL import Image
import pytest

import graph_read
from azimut.engine import satellite as satellite_engine
from azimut.workspace import Case
from mediafixture import _frame_of, _index, _points, _save_proof, _upload


@pytest.fixture()
def sat_tiles(monkeypatch):
    from azimut.engine import tiles

    monkeypatch.setattr(
        tiles, "_default_fetch", lambda client, url: Image.new("RGB", (256, 256), (10, 120, 10))
    )


POINT = {"lat": 50.4501, "lon": 30.5234}


def _case(client):
    return client.post("/api/cases", json={"name": "Behind"}).json()["id"]


def _capture(client, cid):
    return client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={**POINT, "zoom": 16, "width": 256, "height": 256},
    ).json()["path"]


def _index_places(client, cid):
    rows = client.get(f"/api/cases/{cid}/satellite/index").json()
    return [row for row in rows if row["kind"] == "place"]


def _places(cid):
    return [e for e in graph_read.entities(cid) if e["type"] == "place"]


def test_a_proof_place_under_its_footage_leaves_the_list_and_stays_in_the_graph(client, sat_tiles):
    cid = _case(client)
    video = _upload(client, cid, "clip.png")
    _save_proof(client, cid, "Roofline", [_frame_of(cid, video), _capture(client, cid)], coords=POINT)

    [place] = _places(cid)
    assert _index_places(client, cid) == []
    # the file still stands on it, which is how the map draws the point
    assert _points(_index(client, cid), video) == [(50.4501, 30.5234)]
    assert place["provenance"]["by"] == "proof-composer"


def test_a_place_saved_by_hand_stays_in_sight_under_a_proof_and_its_footage(client, sat_tiles):
    cid = _case(client)
    own = client.post(f"/api/cases/{cid}/satellite/place", json={**POINT, "title": "Port gate"}).json()
    video = _upload(client, cid, "clip.png")
    _save_proof(client, cid, "Roofline", [_frame_of(cid, video), _capture(client, cid)], coords=POINT)

    # the proof joined the place standing there rather than filing its own
    assert [p["id"] for p in _places(cid)] == [own["id"]]
    assert [row["title"] for row in _index_places(client, cid)] == ["Port gate"]


def test_a_proof_with_no_footage_keeps_its_place_in_sight(client, sat_tiles):
    cid = _case(client)
    _save_proof(client, cid, "From above", [_capture(client, cid)], coords=POINT)

    [row] = _index_places(client, cid)
    assert (row["lat"], row["lon"]) == (50.4501, 30.5234)
    assert row["proofs"] == 1


def test_a_place_only_a_frame_cut_here_stands_on_stays_in_sight(client):
    """The Media layer never draws a frame: it stands where its video stands."""
    cid = _case(client)
    video = _upload(client, cid, "clip.png")
    frame = _frame_of(cid, video)
    case = Case.open(cid)
    place = satellite_engine.save_place(case, POINT["lat"], POINT["lon"], by="proof-composer")
    case.add_link(graph_read.entity(cid, path=frame)["id"], place["id"], "depicts", by="proof-composer")

    assert [row["id"] for row in _index_places(client, cid)] == [place["id"]]


def test_a_sheet_built_proof_place_under_a_file_leaves_the_list_too(client):
    cid = _case(client)
    photo = _upload(client, cid, "gate.png")
    case = Case.open(cid)
    place = satellite_engine.save_place(case, POINT["lat"], POINT["lon"], by="sheet-proofs")
    case.add_link(graph_read.entity(cid, path=photo)["id"], place["id"], "located-at", by="sheet-proofs")

    assert _index_places(client, cid) == []
    assert _points(_index(client, cid), photo) == [(50.4501, 30.5234)]
