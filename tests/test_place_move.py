"""Moving a saved place from its card on the map.

What must hold: the place takes the new point with everything that says where it
is (coordinates, plus code, the dedup key, a traced footprint, a name that was only
its numbers) and looks its geography up again; the files standing on it follow
without being rewritten; a point a proof states stays where the proof put it, since
the proof holds and prints its own coordinates; and a point another place already
stands on is refused rather than merged.
"""

from PIL import Image
import pytest

import graph_read
from azimut.engine import geo
from azimut.engine import satellite as satellite_engine
from azimut.workspace import Case
from mediafixture import _frame_of, _index, _points, _save_proof, _upload


@pytest.fixture()
def sat_tiles(monkeypatch):
    from azimut.engine import tiles

    monkeypatch.setattr(
        tiles, "_default_fetch", lambda client, url: Image.new("RGB", (256, 256), (10, 120, 10))
    )


def _address(country_code, country):
    return lambda lat, lon, timeout=8, language=None: {
        "display_name": "x",
        "address": {"country_code": country_code, "country": country},
        "attribution": "x",
    }


def _case(client):
    return client.post("/api/cases", json={"name": "Move"}).json()["id"]


def _place(client, cid, lat, lon, **extra):
    res = client.post(f"/api/cases/{cid}/satellite/place", json={"lat": lat, "lon": lon, **extra})
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _move(client, cid, place_id, lat, lon):
    return client.post(
        f"/api/cases/{cid}/satellite/places/{place_id}/move", json={"lat": lat, "lon": lon}
    )


def _entity(cid, entity_id):
    return Case.open(cid).get_entity(entity_id)


def test_a_place_takes_the_new_point_and_its_geography(client, monkeypatch):
    monkeypatch.setattr(geo, "reverse_geocode", _address("ua", "Ukraine"))
    cid = _case(client)
    place_id = _place(client, cid, 48.0159, 37.8029)
    assert _entity(cid, place_id)["attrs"]["geo"]["country_code"] == "ua"

    monkeypatch.setattr(geo, "reverse_geocode", _address("pl", "Poland"))
    res = _move(client, cid, place_id, 50.0614, 19.9366)
    assert res.status_code == 200, res.text

    moved = _entity(cid, place_id)
    attrs = moved["attrs"]
    assert (attrs["lat"], attrs["lon"]) == (50.0614, 19.9366)
    assert attrs["coords"] == satellite_engine.coords_label(50.0614, 19.9366, "dd")
    assert attrs["plus_code"] == geo.plus_code(50.0614, 19.9366)
    # the old country was about the old point
    assert attrs["geo"]["country_code"] == "pl"
    # a place named by its numbers is named by the new ones
    assert moved["label"] == satellite_engine.coords_label(50.0614, 19.9366)
    [row] = [r for r in client.get(f"/api/cases/{cid}/satellite/index").json() if r["id"] == place_id]
    assert (row["lat"], row["lon"]) == (50.0614, 19.9366)


def test_a_name_the_analyst_gave_stays(client):
    cid = _case(client)
    place_id = _place(client, cid, 48.0159, 37.8029, title="checkpoint north")
    assert _move(client, cid, place_id, 48.02, 37.81).status_code == 200
    assert _entity(cid, place_id)["label"] == "checkpoint north"


def test_an_offline_lookup_leaves_the_place_for_the_locate_pass(client, monkeypatch):
    def offline(lat, lon, timeout=8, language=None):
        raise OSError("offline")

    cid = _case(client)
    place_id = _place(client, cid, 48.0159, 37.8029)
    monkeypatch.setattr(geo, "reverse_geocode", offline)
    assert _move(client, cid, place_id, 48.02, 37.81).status_code == 200
    assert satellite_engine.is_unlocated(_entity(cid, place_id))


def test_the_dedup_key_follows_so_the_point_is_found_where_it_went(client):
    cid = _case(client)
    case = Case.open(cid)
    place = satellite_engine.save_place(
        case, 48.0, 37.0, extra_attrs={satellite_engine.COORD_KEY: satellite_engine.coord_key(48.0, 37.0)}
    )
    assert _move(client, cid, place["id"], 48.5, 37.5).status_code == 200
    case = Case.open(cid)
    assert satellite_engine.place_at(case, 48.5, 37.5)["id"] == place["id"]
    assert satellite_engine.place_at(case, 48.0, 37.0) is None


def test_a_traced_footprint_moves_with_its_place(client):
    cid = _case(client)
    place_id = _place(client, cid, 48.0, 37.0)
    square = {
        "type": "Polygon",
        "coordinates": [[[36.99, 47.99], [37.01, 47.99], [37.01, 48.01], [36.99, 48.01], [36.99, 47.99]]],
    }
    res = client.patch(f"/api/cases/{cid}/entities/{place_id}", json={"attrs": {"footprint": square}})
    assert res.status_code == 200, res.text

    assert _move(client, cid, place_id, 48.5, 37.25).status_code == 200
    ring = _entity(cid, place_id)["attrs"]["footprint"]["coordinates"][0]
    assert [[round(lon, 6), round(lat, 6)] for lon, lat in ring] == [
        [37.24, 48.49], [37.26, 48.49], [37.26, 48.51], [37.24, 48.51], [37.24, 48.49],
    ]


def test_the_files_standing_on_it_follow(client):
    cid = _case(client)
    photo = _upload(client, cid, "quay.png")
    place_id = _place(client, cid, 48.0159, 37.8029)
    photo_id = graph_read.entity(cid, path=photo)["id"]
    res = client.post(
        f"/api/cases/{cid}/links", json={"from_id": photo_id, "to_id": place_id, "type": "located-at"}
    )
    assert res.status_code == 200, res.text

    assert _move(client, cid, place_id, 48.1, 37.9).status_code == 200
    assert _points(_index(client, cid), photo) == [(48.1, 37.9)]


def test_a_point_a_proof_states_is_moved_in_the_proof(client, sat_tiles):
    cid = _case(client)
    video = _upload(client, cid, "clip.png")
    frame = _frame_of(cid, video)
    cap = client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 50.4501, "lon": 30.5234, "zoom": 16, "width": 256, "height": 256},
    ).json()["path"]
    _save_proof(client, cid, "Roofline", [frame, cap], coords={"lat": 50.4501, "lon": 30.5234})
    [place] = [p for p in graph_read.entities(cid) if p["type"] == "place"]

    res = _move(client, cid, place["id"], 50.46, 30.53)
    assert res.status_code == 409
    assert "Roofline" in res.json()["detail"] and "proof" in res.json()["detail"]
    attrs = _entity(cid, place["id"])["attrs"]
    assert (attrs["lat"], attrs["lon"]) == (50.4501, 30.5234)
    # its footage draws the point, so the place itself has no card to move it from
    assert place["id"] not in [r["id"] for r in client.get(f"/api/cases/{cid}/satellite/index").json()]


def test_the_card_of_a_proof_place_with_no_footage_knows_a_proof_holds_it(client, sat_tiles):
    cid = _case(client)
    cap = client.post(
        f"/api/cases/{cid}/satellite/capture",
        json={"lat": 50.4501, "lon": 30.5234, "zoom": 16, "width": 256, "height": 256},
    ).json()["path"]
    _save_proof(client, cid, "From above", [cap], coords={"lat": 50.4501, "lon": 30.5234})
    [place] = [p for p in graph_read.entities(cid) if p["type"] == "place"]

    # the index counts the proofs concluding there, so Move opens the proof
    [row] = [r for r in client.get(f"/api/cases/{cid}/satellite/index").json() if r["id"] == place["id"]]
    assert row["proofs"] == 1
    assert _move(client, cid, place["id"], 50.46, 30.53).status_code == 409


def test_a_point_another_place_stands_on_is_refused(client):
    cid = _case(client)
    first = _place(client, cid, 48.0, 37.0)
    _place(client, cid, 48.5, 37.5, title="depot")
    res = _move(client, cid, first, 48.5, 37.5)
    assert res.status_code == 409
    assert "depot" in res.json()["detail"]
    assert _entity(cid, first)["attrs"]["lat"] == 48.0
    # the same point again is not a collision with itself
    assert _move(client, cid, first, 48.0, 37.0).status_code == 200


def test_only_a_place_on_the_globe_is_moved(client):
    cid = _case(client)
    place_id = _place(client, cid, 48.0, 37.0)
    assert _move(client, cid, place_id, 91, 37.0).status_code == 422
    assert _move(client, cid, place_id, 48.0, 181).status_code == 422
    assert _move(client, cid, "nope", 48.0, 37.0).status_code == 404
    photo = _upload(client, cid, "quay.png")
    assert _move(client, cid, graph_read.entity(cid, path=photo)["id"], 48.0, 37.0).status_code == 404
