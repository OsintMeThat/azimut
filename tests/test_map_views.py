"""Saved map compositions own their spec and reference live layer data."""

import copy

import pytest

from azimut import layout
from azimut.engine import bundles, mapviews
from azimut.workspace import Case


@pytest.fixture
def view_case(client):
    owner = client.post("/api/cases", json={"name": "Saved maps"}).json()["id"]
    layer = client.post(f"/api/cases/{owner}/map-layers/editable", json={"title": "Places"}).json()
    body = {"title": " Review map ", "provider": "esri", "camera": {"lat": 48.8, "lon": 2.3, "zoom": 12, "bearing": 25, "pitch": 10},
            "layers": [{"name": layer["name"], "hidden": ["Hidden group"]}], "overlays": ["borders"],
            "legend": [{"label": "Places", "colour": "#0072b2"}], "note": "Analyst notes", "show_legend": True}
    return owner, layer, body


def test_map_specs_update_without_cloning_or_changing_layers_and_use_trash(client, view_case):
    owner, layer, body = view_case
    url = f"/api/cases/{owner}/map-views"
    saved = client.post(url, json=body).json()
    assert saved["title"] == "Review map"
    assert client.get(url).json() == [saved]
    assert client.get(f"{url}/{saved['id']}").json() == saved
    original_layer = client.get(f"/api/cases/{owner}/map-layers/{layer['name']}/edit").json()
    updated = client.post(url, json={**body, "id": saved["id"], "title": "Renamed"}).json()
    assert len(client.get(url).json()) == 1
    assert updated["id"] == saved["id"]
    assert client.get(f"/api/cases/{owner}/map-layers/{layer['name']}/edit").json() == original_layer
    entity = Case.open(owner).find_entity(attr="spec", value=layout.map_view_rel(saved["id"]))
    assert entity["type"] == "map-view" and entity["label"] == "Renamed"
    deleted = client.delete(f"{url}/{saved['id']}").json()
    assert client.get(url).json() == []
    assert client.post(url, json={**body, "id": saved["id"]}).status_code == 422
    assert client.post(f"/api/cases/{owner}/trash/{deleted['trash']}/restore").status_code == 200
    assert client.get(url).json() == [updated]


@pytest.mark.parametrize("change", [
    {"title": " "}, {"id": "../../escape"}, {"camera": {"lat": 91, "lon": 2, "zoom": 10}},
    {"camera": {"lat": 48, "lon": 2, "zoom": 27}}, {"layers": [{"name": "../escape"}]},
    {"legend": [{"label": "Bad", "colour": "red"}]},
])
def test_invalid_composition_does_not_create_files_or_entities(client, view_case, change):
    owner, _, body = view_case
    assert client.post(f"/api/cases/{owner}/map-views", json={**body, **change}).status_code == 422
    assert mapviews.listing(Case.open(owner)) == []
    assert list(Case.open(owner).subdir(layout.MAP_VIEWS_DIR).iterdir()) == []


def test_composition_survives_a_missing_layer_and_a_case_bundle(client, view_case):
    owner, layer, body = view_case
    saved = client.post(f"/api/cases/{owner}/map-views", json=body).json()
    assert client.delete(f"/api/cases/{owner}/map-layers/{layer['name']}").status_code == 200
    assert mapviews.read(Case.open(owner), saved["id"])["layers"] == body["layers"]
    bundle = bundles.export_case(Case.open(owner))
    imported_id = client.post("/api/cases", json={"name": "Restored map"}).json()["id"]
    imported = Case.open(imported_id)
    bundles.import_into(imported, bundle)
    imported = Case.open(imported_id)
    assert mapviews.read(imported, saved["id"]) == saved


def test_engine_checks_names_and_does_not_mutate_the_callers_snapshot(client, view_case):
    owner, _, body = view_case
    before = copy.deepcopy(body)
    mapviews.save(Case.open(owner), body)
    assert body == before
    with pytest.raises(ValueError):
        mapviews.save(Case.open(owner), {**body, "id": "../escape"})


def test_case_rename_is_visible_in_the_map_list_and_on_reopening(client, view_case):
    owner, _, body = view_case
    view = client.post(f"/api/cases/{owner}/map-views", json=body).json()
    case = Case.open(owner)
    entity = case.find_entity(attr="spec", value=layout.map_view_rel(view["id"]))
    case.update_entity(entity["id"], {"label": "Renamed in the case"})
    assert mapviews.read(case, view["id"])["title"] == "Renamed in the case"
    assert mapviews.listing(case)[0]["title"] == "Renamed in the case"
