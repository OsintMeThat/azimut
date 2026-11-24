"""A zone saved in one go from Save place's arrow: a place with its area.

What must hold: the shape is written with the place, in one request, checked as
Details checks a footprint; the place is marked a zone, so the map's editor moves its
pin along when it is reshaped; and a shape the store would refuse is refused here.
"""

import graph_read
from azimut.workspace import Case

SQUARE = {"type": "Polygon", "coordinates": [[[37.80, 48.01], [37.81, 48.01], [37.81, 48.02], [37.80, 48.02], [37.80, 48.01]]]}


def _case(client):
    return client.post("/api/cases", json={"name": "Zones"}).json()["id"]


def test_a_zone_is_a_place_with_its_area_in_one_request(client):
    cid = _case(client)
    res = client.post(
        f"/api/cases/{cid}/satellite/place",
        json={"lat": 48.015, "lon": 37.805, "title": "North quay", "footprint": SQUARE},
    )
    assert res.status_code == 200, res.text
    place = Case.open(cid).get_entity(res.json()["id"])
    assert place["label"] == "North quay"
    assert place["attrs"]["footprint"] == SQUARE
    assert place["attrs"]["zone"] is True

    [row] = [r for r in client.get(f"/api/cases/{cid}/satellite/index").json() if r["kind"] == "place"]
    assert row["zone"] is True
    assert row["footprint"] == SQUARE


def test_a_place_saved_as_a_pin_is_no_zone(client):
    cid = _case(client)
    client.post(f"/api/cases/{cid}/satellite/place", json={"lat": 48.015, "lon": 37.805, "title": "Gate"})
    [row] = [r for r in client.get(f"/api/cases/{cid}/satellite/index").json() if r["kind"] == "place"]
    assert "zone" not in row


def test_a_shape_the_store_would_refuse_is_refused_and_nothing_is_filed(client):
    cid = _case(client)
    res = client.post(
        f"/api/cases/{cid}/satellite/place",
        json={"lat": 48.015, "lon": 37.805, "title": "Bad", "footprint": {"type": "Polygon", "coordinates": "x"}},
    )
    assert res.status_code == 400
    assert [e for e in graph_read.entities(cid) if e["type"] == "place"] == []
