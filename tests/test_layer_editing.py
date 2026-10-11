"""Personal layers keep their markers separate from the case's places."""

import io
import json
from pathlib import Path

import pytest

from azimut import layout
from azimut.engine import bundles, maplayers, workqueue
from azimut.workspace import Case
from test_map_layers import dressed_kmz


@pytest.fixture
def owner(client):
    return client.post("/api/cases", json={"name": "Personal layers"}).json()["id"]


def create(client, owner, title="Working map"):
    response = client.post(f"/api/cases/{owner}/map-layers/editable", json={"title": title})
    assert response.status_code == 200, response.text
    return response.json()


def marker(client, owner, row, **changes):
    response = client.post(f"/api/cases/{owner}/map-layers/{row['name']}/markers",
                           json={"lat": 48.85, "lon": 2.35, **changes})
    assert response.status_code == 200, response.text
    return response.json()["marker"]


def read(client, owner, row):
    response = client.get(f"/api/cases/{owner}/map-layers/{row['name']}/edit")
    assert response.status_code == 200, response.text
    return response.json()


def places(owner):
    return [entity for entity in Case.open(owner).list_entities() if entity["type"] == "place"]


def test_empty_layer_is_saved_and_drawable_without_a_place(client, owner, monkeypatch):
    monkeypatch.setattr(maplayers, "fetch", lambda *a: pytest.fail("unexpected network"))
    row = create(client, owner)
    assert row["editable"] is True and row["features"] == 0
    assert read(client, owner, row)["document"]["features"] == []
    data = client.get(f"/api/cases/{owner}/map-layers/{row['name']}/data").json()
    assert data["features"] == []
    assert places(owner) == []
    assert [e["type"] for e in Case.open(owner).list_entities()] == ["map-layer"]


def test_repeated_clicks_save_distinct_markers_and_rebuild_stale_cache(client, owner):
    row = create(client, owner)
    url = f"/api/cases/{owner}/map-layers/{row['name']}/data"
    client.get(url)  # prime an empty cache
    first = marker(client, owner, row, name="North gate", colour="#d55e00", symbol="star")
    second = marker(client, owner, row, lat=48.86)
    data = client.get(url).json()
    assert len(data["features"]) == 2
    assert first["properties"]["key"] != second["properties"]["key"]
    assert data["features"][0]["properties"]["symbol"] == "star"
    assert data["features"][0]["properties"]["colour"] == "#d55e00"
    assert places(owner) == []


@pytest.mark.parametrize("changes", [
    {"lat": 91}, {"lon": 181}, {"lat": "nan"}, {"lon": "inf"},
    {"colour": "red"}, {"symbol": "remote.svg"}, {"name": "x" * 301},
])
def test_invalid_marker_is_refused_before_any_write(client, owner, changes):
    row = create(client, owner)
    response = client.post(f"/api/cases/{owner}/map-layers/{row['name']}/markers",
                           json={"lat": 48.85, "lon": 2.35, **changes})
    assert response.status_code == 422
    assert read(client, owner, row)["document"]["features"] == []


def test_kmz_working_copy_keeps_source_icons_and_groups_offline(client, owner, monkeypatch):
    data = dressed_kmz()
    monkeypatch.setattr(maplayers, "fetch", lambda *a: pytest.fail("unexpected network"))
    response = client.post(f"/api/cases/{owner}/map-layers/editable/upload",
                           files={"file": ("source.kmz", io.BytesIO(data))})
    assert response.status_code == 200, response.text
    row = response.json()
    assert row["editable"] and row["icons"] == 1 and row["features"] == 2
    assert row["origin"]["source"]["name"] == "source.kmz"
    assert row["origin"]["sha256"] == maplayers.digest(data)
    case = Case.open(owner)
    assert case.resolve_inside(layout.layer_snapshot_rel(row["name"])).read_bytes() == data
    feature = read(client, owner, row)["document"]["features"][0]
    assert feature["properties"]["category"] == "Checkpoints"
    icon = feature["properties"]["icon"]
    assert client.get(f"/api/cases/{owner}/map-layers/{row['name']}/icons/{icon}").status_code == 200
    marker(client, owner, row)
    assert case.resolve_inside(layout.layer_snapshot_rel(row["name"])).read_bytes() == data
    assert places(owner) == []


def test_copying_a_followed_layer_preserves_snapshot_and_never_refreshes(client, owner, monkeypatch):
    monkeypatch.setattr(maplayers, "fetch", lambda *a: (dressed_kmz(), "source.kmz"))
    source = client.post(f"/api/cases/{owner}/map-layers",
                         json={"url": "https://example.test/map.kmz"}).json()
    monkeypatch.setattr(maplayers, "fetch", lambda *a: pytest.fail("unexpected refresh"))
    response = client.post(f"/api/cases/{owner}/map-layers/{source['name']}/editable-copy",
                           json={"title": "My copy"})
    assert response.status_code == 200, response.text
    row = response.json()
    marker(client, owner, row)
    assert client.get(f"/api/cases/{owner}/map-layers/{source['name']}").json()["features"] == 2
    assert row["origin"]["source"]["url"] == "https://example.test/map.kmz"
    assert row["refresh"] == {} and not row["stale"]
    assert client.post(f"/api/cases/{owner}/map-layers/{row['name']}/refresh").status_code == 422
    assert places(owner) == []


def test_edit_routes_refuse_to_change_an_imported_source(client, owner):
    source = client.post(f"/api/cases/{owner}/map-layers/upload",
                         files={"file": ("source.kmz", io.BytesIO(dressed_kmz()))}).json()
    response = client.post(f"/api/cases/{owner}/map-layers/{source['name']}/markers",
                           json={"lat": 48.85, "lon": 2.35})
    assert response.status_code == 422
    assert "editable copy" in response.json()["detail"]


def test_selected_marker_is_edited_without_changing_its_identity_or_creating_places(client, owner):
    row = create(client, owner)
    first = marker(client, owner, row)
    key = first["properties"]["key"]
    response = client.patch(f"/api/cases/{owner}/map-layers/{row['name']}/markers/{key}",
                            json={"name": "Tower", "colour": "#cc79a7", "symbol": "flag"})
    assert response.status_code == 200
    edited = read(client, owner, row)["document"]["features"][0]
    assert edited["properties"]["key"] == key
    assert edited["properties"]["name"] == "Tower"
    assert edited["properties"]["symbol"] == "flag"
    assert places(owner) == []


def test_promoting_a_marker_is_explicit_and_idempotent(client, owner):
    row = create(client, owner)
    first = marker(client, owner, row, name="Tower")
    url = f"/api/cases/{owner}/map-layers/{row['name']}/markers/{first['properties']['key']}/place"
    assert places(owner) == []
    one = client.post(url, json={}).json()
    two = client.post(url, json={}).json()
    assert one["place"]["id"] == two["place"]["id"]
    assert len(places(owner)) == 1
    assert one["place"]["label"] == "Tower"
    assert one["place"]["attrs"]["layer_origin"]["feature"] == first["properties"]["key"]
    assert read(client, owner, row)["document"]["features"][0]["properties"]["place_id"] == one["place"]["id"]


def test_promotion_reuses_an_existing_case_place_without_renaming_it(client, owner):
    existing = client.post(f"/api/cases/{owner}/satellite/place",
                           json={"lat": 48.85, "lon": 2.35, "title": "Established place"}).json()
    row = create(client, owner)
    first = marker(client, owner, row, name="My label")
    promoted = client.post(f"/api/cases/{owner}/map-layers/{row['name']}/markers/{first['properties']['key']}/place",
                            json={}).json()["place"]
    assert promoted["id"] == existing["id"] and promoted["label"] == "Established place"
    assert len(places(owner)) == 1


def test_layer_trash_round_trip_preserves_edits_without_deleting_promoted_places(client, owner):
    row = create(client, owner)
    feature = marker(client, owner, row, symbol="circle")
    promoted = client.post(f"/api/cases/{owner}/map-layers/{row['name']}/markers/{feature['properties']['key']}/place",
                            json={}).json()["place"]
    before = read(client, owner, row)["document"]
    result = client.delete(f"/api/cases/{owner}/map-layers/{row['name']}").json()
    assert Case.open(owner).get_entity(promoted["id"]) is not None
    response = client.post(f"/api/cases/{owner}/trash/{result['trash']}/restore")
    assert response.status_code == 200
    assert read(client, owner, row)["document"] == before
    assert client.get(f"/api/cases/{owner}/map-layers/{row['name']}/data").json()["features"] == before["features"]


def test_bundle_round_trip_rebuilds_the_working_copy_and_keeps_its_original(client, owner):
    data = dressed_kmz()
    row = client.post(f"/api/cases/{owner}/map-layers/editable/upload",
                      files={"file": ("source.kmz", io.BytesIO(data))}).json()
    marker(client, owner, row, name="New marker", symbol="flag")
    before = read(client, owner, row)["document"]
    case = Case.open(owner)
    job = bundles.queue_export(case)
    workqueue.drain(case)
    imported, _ = bundles.queue_import(Path(job["payload"]["output"]))
    workqueue.drain(imported)
    assert read(client, imported.id, row)["document"] == before
    assert imported.resolve_inside(layout.layer_snapshot_rel(row["name"])).read_bytes() == data
    cache = maplayers.drawing(imported, row["name"])
    assert json.loads(cache.read_text())["features"] == before["features"]
